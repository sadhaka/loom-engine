// Loom Engine - Phase 8.4 mobile / touch input tests.
//
// Covers:
//   - InputManager touch injection helpers (used both by tests and
//     by VirtualDpad for synthetic press paths)
//   - VirtualDpad: detection, mount/unmount, key injection on press,
//     multi-touch refcount, onPress callback, headless press path
//   - TapToWalkSystem: tap detection, drag rejection, multi-touch
//     rejection, manual-WASD cancel, tile-coord math via iso inverse
//
// Tests run in Node via tsx and rely on a hand-built fake DOM so we
// don't pull in a full jsdom dependency. The fake covers exactly the
// surface VirtualDpad and InputManager touch helpers need.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  InputManager,
  TapToWalkSystem,
  RESOURCE_TAP_WALK,
  RESOURCE_INPUT,
  RESOURCE_INPUT_MANAGER,
  RESOURCE_TIME,
  RESOURCE_CAMERA,
  createTimeResource,
  createCamera,
  createTapWalkTarget,
  InputSystem,
  SYSTEM_PHASE_INPUT,
  SYSTEM_PHASE_LOGIC,
  VirtualDpad,
  type TapWalkTargetResource,
  type DpadDirection,
} from '../src/index.js';

// ---------- Fake DOM ----------
//
// Just enough surface for VirtualDpad: createElement returns nodes
// that record their style assignments and parent linkage. Listeners
// are stored so a test can fire a synthetic event by name.

interface FakeNode {
  tagName: string;
  className: string;
  textContent: string;
  attributes: Record<string, string>;
  style: FakeCSSStyleDeclaration;
  children: FakeNode[];
  parentNode: FakeNode | null;
  listeners: Map<string, Array<(e: unknown) => void>>;
  appendChild(child: FakeNode): FakeNode;
  removeChild(child: FakeNode): FakeNode;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, handler: (e: unknown) => void): void;
  removeEventListener(type: string, handler: (e: unknown) => void): void;
  dispatchEvent(type: string, ev: unknown): void;
}

class FakeCSSStyleDeclaration {
  private props: Record<string, string> = {};

  setProperty(name: string, value: string): void {
    this.props[name] = value;
  }

  getProperty(name: string): string {
    return this.props[name] ?? '';
  }

  // Generic property setter so `style.position = 'fixed'` works.
  // We use a Proxy-free approach: TypeScript indexing through a
  // Record-shaped type would require dynamic typing. The test only
  // reads getProperty / a few hard-coded fields, so simple setters
  // are enough.
}

function makeNode(tagName: string): FakeNode {
  const node: FakeNode = {
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: '',
    attributes: {},
    style: new FakeCSSStyleDeclaration() as FakeCSSStyleDeclaration,
    children: [],
    parentNode: null,
    listeners: new Map(),
    appendChild(child: FakeNode): FakeNode {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child: FakeNode): FakeNode {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    setAttribute(name: string, value: string): void {
      this.attributes[name] = value;
    },
    addEventListener(type: string, handler: (e: unknown) => void): void {
      let arr = this.listeners.get(type);
      if (!arr) {
        arr = [];
        this.listeners.set(type, arr);
      }
      arr.push(handler);
    },
    removeEventListener(type: string, handler: (e: unknown) => void): void {
      const arr = this.listeners.get(type);
      if (!arr) return;
      const i = arr.indexOf(handler);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatchEvent(type: string, ev: unknown): void {
      const arr = this.listeners.get(type);
      if (!arr) return;
      for (const h of arr.slice()) h(ev);
    },
  };
  // Intercept arbitrary style assignments. Real CSSStyleDeclaration
  // accepts `style.xyz = 'value'`. Our FakeCSSStyleDeclaration
  // doesn't but we only need it for reading back; setters can no-op
  // via Proxy.
  node.style = new Proxy(node.style, {
    set(target: FakeCSSStyleDeclaration, _key: string | symbol, value: unknown): boolean {
      // Allow assignment of any string property without enforcing
      // the typed surface.
      (target as unknown as Record<string, unknown>)[_key as string] = value;
      return true;
    },
  });
  return node;
}

function makeFakeDocument(): { doc: Document; body: FakeNode } {
  const body = makeNode('body');
  const doc = {
    createElement(tag: string): FakeNode {
      return makeNode(tag);
    },
    body,
  } as unknown as Document;
  return { doc, body };
}

function fakeTouchEvent(touches: Array<{ identifier: number; clientX: number; clientY: number }>): {
  changedTouches: Array<{ identifier: number; clientX: number; clientY: number }>;
  preventDefault: () => void;
} {
  return {
    changedTouches: touches,
    preventDefault: () => {},
  };
}

// ---------- InputManager touch injection ----------

test('input manager: injectTouchStart / End feed accumulators', () => {
  const m = new InputManager();
  m.injectTouchStart(7, 100, 200);
  m.beginFrame();
  const s1 = m.snapshot();
  assert.equal(s1.touches.length, 1, 'touch present in active set');
  assert.equal(s1.touchesStartedThisFrame.length, 1);
  assert.equal(s1.touchesStartedThisFrame[0]!.id, 7);
  assert.equal(s1.touchesStartedThisFrame[0]!.x, 100);

  m.injectTouchEnd(7, 110, 205);
  m.beginFrame();
  const s2 = m.snapshot();
  assert.equal(s2.touches.length, 0, 'active set drained on end');
  assert.equal(s2.touchesEndedThisFrame.length, 1);
  assert.equal(s2.touchesEndedThisFrame[0]!.id, 7);
});

test('input manager: injectTouchMove updates active set without enqueuing started/ended', () => {
  const m = new InputManager();
  m.injectTouchStart(3, 0, 0);
  m.beginFrame();
  m.injectTouchMove(3, 25, 25);
  m.beginFrame();
  const s = m.snapshot();
  assert.equal(s.touches.length, 1);
  assert.equal(s.touches[0]!.x, 25);
  assert.equal(s.touchesStartedThisFrame.length, 0);
  assert.equal(s.touchesEndedThisFrame.length, 0);
});

// ---------- VirtualDpad ----------

test('virtual dpad: detectTouchSupport reads ontouchstart / maxTouchPoints', () => {
  // No window in scope -> false.
  assert.equal(VirtualDpad.detectTouchSupport(undefined as unknown as Window), false);

  const winA = { navigator: { maxTouchPoints: 5 } } as unknown as Window;
  assert.equal(VirtualDpad.detectTouchSupport(winA), true, 'maxTouchPoints triggers');

  const winB = { navigator: { maxTouchPoints: 0 } } as unknown as Window;
  // 'ontouchstart' in winB -> false. Cast through unknown to keep
  // TypeScript happy.
  Object.defineProperty(winB, 'ontouchstart', { value: null });
  assert.equal(VirtualDpad.detectTouchSupport(winB), true, 'ontouchstart triggers');

  const winC = { navigator: { maxTouchPoints: 0 } } as unknown as Window;
  assert.equal(VirtualDpad.detectTouchSupport(winC), false, 'pure desktop returns false');
});

test('virtual dpad: visible=false skips DOM mount, no children appended', () => {
  const m = new InputManager();
  const { doc, body } = makeFakeDocument();
  const pad = new VirtualDpad({
    inputManager: m,
    document: doc,
    parent: body as unknown as HTMLElement,
    visible: false,
  });
  pad.mount();
  assert.equal(pad.isMounted(), false, 'mount no-ops when visible=false');
  assert.equal(body.children.length, 0);
});

test('virtual dpad: visible=true builds 9-cell grid + four directional buttons', () => {
  const m = new InputManager();
  const { doc, body } = makeFakeDocument();
  const pad = new VirtualDpad({
    inputManager: m,
    document: doc,
    parent: body as unknown as HTMLElement,
    visible: true,
  });
  pad.mount();
  assert.equal(pad.isMounted(), true);
  assert.equal(body.children.length, 1, 'one root added to body');
  const root = body.children[0]!;
  assert.equal(root.children.length, 1, 'root holds the grid');
  const grid = root.children[0]!;
  assert.equal(grid.children.length, 9, '3x3 grid has 9 cells');
});

test('virtual dpad: pressDirection injects KeyW / KeyA / KeyS / KeyD', () => {
  const m = new InputManager();
  const pad = new VirtualDpad({ inputManager: m, visible: false });
  pad.pressDirection('up');
  pad.pressDirection('left');
  m.beginFrame();
  const s = m.snapshot();
  assert.equal(s.keysHeld.has('KeyW'), true);
  assert.equal(s.keysHeld.has('KeyA'), true);
  assert.equal(s.keysHeld.has('KeyS'), false);
  assert.equal(s.keysHeld.has('KeyD'), false);
});

test('virtual dpad: releaseDirection only emits keyUp when last touch leaves', () => {
  const m = new InputManager();
  const pad = new VirtualDpad({ inputManager: m, visible: false });
  // Two fingers on the same direction.
  pad.pressDirection('right', 1);
  pad.pressDirection('right', 2);
  m.beginFrame();
  assert.equal(m.snapshot().keysHeld.has('KeyD'), true);
  // First finger releases -> still held.
  pad.releaseDirection('right', 1);
  m.beginFrame();
  assert.equal(m.snapshot().keysHeld.has('KeyD'), true, 'still held with second finger');
  // Second finger releases -> KeyUp emitted.
  pad.releaseDirection('right', 2);
  m.beginFrame();
  assert.equal(m.snapshot().keysHeld.has('KeyD'), false);
  assert.equal(pad.pressedTouchCount('right'), 0);
});

test('virtual dpad: onPress fires once on initial press of a direction', () => {
  const m = new InputManager();
  const presses: DpadDirection[] = [];
  const pad = new VirtualDpad({
    inputManager: m,
    visible: false,
    onPress: (d) => { presses.push(d); },
  });
  pad.pressDirection('up', 1);
  pad.pressDirection('up', 2);   // second finger same dir - no second callback
  pad.pressDirection('down', 3);
  assert.deepEqual(presses, ['up', 'down']);
});

test('virtual dpad: unmount removes DOM and releases held keys', () => {
  const m = new InputManager();
  const { doc, body } = makeFakeDocument();
  const pad = new VirtualDpad({
    inputManager: m,
    document: doc,
    parent: body as unknown as HTMLElement,
    visible: true,
  });
  pad.mount();
  pad.pressDirection('up', 1);
  pad.pressDirection('left', 2);
  m.beginFrame();
  assert.equal(m.snapshot().keysHeld.size, 2);
  pad.unmount();
  m.beginFrame();
  assert.equal(m.snapshot().keysHeld.size, 0, 'all keys released on unmount');
  assert.equal(body.children.length, 0, 'DOM root removed');
  assert.equal(pad.isMounted(), false);
});

test('virtual dpad: real touchstart on button DOM injects key', async () => {
  const m = new InputManager();
  const { doc, body } = makeFakeDocument();
  const pad = new VirtualDpad({
    inputManager: m,
    document: doc,
    parent: body as unknown as HTMLElement,
    visible: true,
  });
  pad.mount();
  // Drill into the grid -> the second cell (top-middle) is the up button.
  const root = body.children[0]!;
  const grid = root.children[0]!;
  const upBtn = grid.children[1]!;
  upBtn.dispatchEvent('touchstart', fakeTouchEvent([{ identifier: 11, clientX: 0, clientY: 0 }]));
  m.beginFrame();
  assert.equal(m.snapshot().keysHeld.has('KeyW'), true, 'touchstart on up cell injects KeyW');
  upBtn.dispatchEvent('touchend', fakeTouchEvent([{ identifier: 11, clientX: 0, clientY: 0 }]));
  m.beginFrame();
  assert.equal(m.snapshot().keysHeld.has('KeyW'), false, 'touchend releases KeyW');
});

// ---------- TapToWalkSystem ----------
//
// Run the system end-to-end against a tiny World wired with the same
// resources Engine.create would set up. This exercises the public
// API contract (resources / inputs / outputs).

async function makeWorldWithInput(): Promise<{
  world: import('../src/world.js').World;
  manager: InputManager;
  target: TapWalkTargetResource;
}> {
  const { World } = await import('../src/world.js');
  const w = new World();
  const m = new InputManager();
  w.resources.set(RESOURCE_INPUT_MANAGER, m);
  w.resources.set(RESOURCE_TIME, createTimeResource());
  w.resources.set(RESOURCE_CAMERA, createCamera(640, 400));
  const target = createTapWalkTarget();
  w.resources.set(RESOURCE_TAP_WALK, target);
  w.addSystem(new InputSystem(), SYSTEM_PHASE_INPUT);
  w.addSystem(new TapToWalkSystem(), SYSTEM_PHASE_LOGIC);
  return { world: w, manager: m, target };
}

test('tap to walk: short tap on canvas center publishes target (0, 0)', async () => {
  const { world, manager, target } = await makeWorldWithInput();
  // Canvas center on 640x400 viewport with camera at origin.
  manager.injectTouchStart(1, 320, 200);
  world.update(0.016);
  manager.injectTouchEnd(1, 320, 200);
  world.update(0.016);
  assert.equal(target.active, true);
  assert.ok(Math.abs(target.x - 0) < 0.001, 'tile x ~ 0');
  assert.ok(Math.abs(target.y - 0) < 0.001, 'tile y ~ 0');
});

test('tap to walk: tap east of center maps to tile (1, 0)', async () => {
  // Tile (1, 0) projects to iso (32, 16). Canvas pixel = center + that.
  const { world, manager, target } = await makeWorldWithInput();
  manager.injectTouchStart(2, 352, 216);
  world.update(0.016);
  manager.injectTouchEnd(2, 352, 216);
  world.update(0.016);
  assert.equal(target.active, true);
  assert.ok(Math.abs(target.x - 1) < 0.001, 'tile x ~ 1');
  assert.ok(Math.abs(target.y - 0) < 0.001, 'tile y ~ 0');
});

test('tap to walk: drag (large move between start and end) is rejected', async () => {
  const { world, manager, target } = await makeWorldWithInput();
  manager.injectTouchStart(3, 100, 100);
  world.update(0.016);
  manager.injectTouchMove(3, 200, 200);
  world.update(0.016);
  manager.injectTouchEnd(3, 200, 200);
  world.update(0.016);
  assert.equal(target.active, false);
});

test('tap to walk: multi-touch aborts the in-flight tap', async () => {
  const { world, manager, target } = await makeWorldWithInput();
  manager.injectTouchStart(4, 320, 200);
  world.update(0.016);
  // Second finger -> abort.
  manager.injectTouchStart(5, 100, 100);
  world.update(0.016);
  manager.injectTouchEnd(4, 320, 200);
  world.update(0.016);
  manager.injectTouchEnd(5, 100, 100);
  world.update(0.016);
  assert.equal(target.active, false, 'multi-touch must not produce a target');
});

test('tap to walk: held WASD clears existing target and blocks new ones', async () => {
  const { world, manager, target } = await makeWorldWithInput();
  // Land a real target first.
  manager.injectTouchStart(6, 320, 200);
  world.update(0.016);
  manager.injectTouchEnd(6, 320, 200);
  world.update(0.016);
  assert.equal(target.active, true);
  // Now hold KeyW (as the D-pad would on a real press).
  manager.injectKeyDown('KeyW');
  world.update(0.016);
  assert.equal(target.active, false, 'held WASD cancels target');
  // Subsequent taps while WASD held are ignored.
  manager.injectTouchStart(7, 320, 200);
  world.update(0.016);
  manager.injectTouchEnd(7, 320, 200);
  world.update(0.016);
  assert.equal(target.active, false);
});

test('tap to walk: held ArrowLeft also cancels (keyboard parity with D-pad)', async () => {
  const { world, manager, target } = await makeWorldWithInput();
  manager.injectKeyDown('ArrowLeft');
  manager.injectTouchStart(8, 320, 200);
  world.update(0.016);
  manager.injectTouchEnd(8, 320, 200);
  world.update(0.016);
  assert.equal(target.active, false);
});

test('tap to walk: target.frameSet records the publishing frame', async () => {
  const { world, manager, target } = await makeWorldWithInput();
  // World.update does NOT advance time.frame (only Engine.tick does);
  // mutate it directly to simulate frame progression.
  const time = world.resources.require<{ frame: number }>(RESOURCE_TIME);
  time.frame = 5;
  manager.injectTouchStart(9, 320, 200);
  world.update(0.016);
  time.frame = 7;
  manager.injectTouchEnd(9, 320, 200);
  world.update(0.016);
  assert.equal(target.active, true);
  assert.equal(target.frameSet, 7, 'frameSet captures time.frame at publish');
});
