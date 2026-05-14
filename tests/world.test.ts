// Loom Engine - Phase 2 ECS smoke test.
//
// Node-based, no DOM. Asserts World, ResourceRegistry, system
// scheduling, SpritePool, and an end-to-end run with a synthetic
// device. The Canvas2DDevice itself is browser-only and tested by
// demo/index.html landing in the preview.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  // World + scheduling
  World,
  POOL_TRANSFORM,
  POOL_SPRITE,
  ResourceRegistry,
  createTimeResource,
  RESOURCE_TIME,
  RESOURCE_CAMERA,
  RESOURCE_DEVICE,
  SYSTEM_PHASE_INPUT,
  SYSTEM_PHASE_LOGIC,
  SYSTEM_PHASE_RENDER,
  SYSTEM_PHASE_POST_RENDER,
  // Components
  TransformPool,
  SpritePool,
  SPRITE_FLAG_ACTIVE,
  SPRITE_FLAG_TINTED,
  approxEq,
  // Systems
  SpriteRenderSystem,
  // Misc
  EntityAllocator,
  entityIndex,
  entityGeneration,
  NULL_ENTITY,
  COLOR_KNOT_INT,
  type System,
  type EntityId,
  type IGraphicsDevice,
  type CameraView,
  type AtlasDescriptor,
  type AtlasHandle,
  type ColorRGBA,
  type TimeResource,
} from '../src/index.js';

// ----- Synthetic device for capture-and-assert -----

interface CapturedDraw {
  kind: 'sprite' | 'tile' | 'text';
  x: number;
  y: number;
  z: number;
  atlas: AtlasHandle;
  frame: number;
  tinted: boolean;
}

class FakeDevice implements IGraphicsDevice {
  readonly canvas: HTMLCanvasElement = {} as HTMLCanvasElement;
  readonly viewportWidth: number = 640;
  readonly viewportHeight: number = 400;
  drawCalls: CapturedDraw[] = [];
  cameraSet: number = 0;
  beginFrames: number = 0;
  endFrames: number = 0;

  beginFrame(): void { this.beginFrames++; this.drawCalls = []; }
  endFrame(): void { this.endFrames++; }
  setCamera(_c: Readonly<CameraView>): void { this.cameraSet++; }
  registerAtlas(_d: AtlasDescriptor): AtlasHandle { return 0; }
  releaseAtlas(_h: AtlasHandle): void {}
  drawSprite(x: number, y: number, z: number, atlas: AtlasHandle, frame: number, tint?: Readonly<ColorRGBA>): void {
    this.drawCalls.push({ kind: 'sprite', x, y, z, atlas, frame, tinted: !!tint });
  }
  drawTile(x: number, y: number, atlas: AtlasHandle, frame: number): void {
    this.drawCalls.push({ kind: 'tile', x, y, z: 0, atlas, frame, tinted: false });
  }
  drawText(_x: number, _y: number, _t: string, _s: { font: string; fill: ColorRGBA }): void {}
  getDrawCallCount(): number { return this.drawCalls.length; }
}

// ----- ResourceRegistry -----

test('resources: set/get/require/has/remove', () => {
  const r = new ResourceRegistry();
  assert.equal(r.has('a'), false);
  assert.equal(r.get('a'), undefined);
  r.set('a', 42);
  assert.equal(r.get<number>('a'), 42);
  assert.equal(r.require<number>('a'), 42);
  assert.equal(r.has('a'), true);
  assert.equal(r.remove('a'), true);
  assert.equal(r.has('a'), false);
});

test('resources: require throws on missing', () => {
  const r = new ResourceRegistry();
  assert.throws(() => r.require('missing'), /not registered/);
});

// ----- World -----

test('world: registers and retrieves pools', () => {
  const w = new World();
  const t = new TransformPool();
  w.registerPool(POOL_TRANSFORM, t);
  assert.equal(w.getPool(POOL_TRANSFORM), t);
  assert.equal(w.requirePool(POOL_TRANSFORM), t);
});

test('world: requirePool throws on missing', () => {
  const w = new World();
  assert.throws(() => w.requirePool('missing'), /not registered/);
});

test('world: systems run in phase order', () => {
  const w = new World();
  const callOrder: string[] = [];
  const sysFactory = (name: string): System => ({
    name,
    update: () => callOrder.push(name),
  });
  w.addSystem(sysFactory('post-render-a'), SYSTEM_PHASE_POST_RENDER);
  w.addSystem(sysFactory('input-a'), SYSTEM_PHASE_INPUT);
  w.addSystem(sysFactory('logic-a'), SYSTEM_PHASE_LOGIC);
  w.addSystem(sysFactory('render-a'), SYSTEM_PHASE_RENDER);
  w.addSystem(sysFactory('logic-b'), SYSTEM_PHASE_LOGIC);
  w.update(0.016);
  assert.deepEqual(callOrder, ['input-a', 'logic-a', 'logic-b', 'render-a', 'post-render-a']);
});

test('world: createEntity / destroyEntity through facade', () => {
  const w = new World();
  const e = w.createEntity();
  assert.ok(w.entities.isAlive(e));
  assert.equal(w.countEntities(), 1);
  assert.ok(w.destroyEntity(e));
  assert.equal(w.countEntities(), 0);
});

test('world: destroyEntityByLiveIndex destroys a recycled slot', () => {
  const w = new World();
  const a = w.createEntity();
  const ai = entityIndex(a);
  // First life: destroy through the index path.
  assert.ok(w.destroyEntityByLiveIndex(ai));
  assert.ok(!w.entities.isAlive(a));
  // Recycle the same slot. The generation has bumped, so a stale
  // makeEntity(ai, 0) handle would no longer validate - but the
  // index path destroys the live slot regardless of generation.
  const b = w.createEntity();
  assert.equal(entityIndex(b), ai, 'slot recycled');
  assert.notEqual(b, a, 'generation bumped so the handle differs');
  assert.ok(w.destroyEntityByLiveIndex(ai), 'recycled slot destroys cleanly');
  assert.ok(!w.entities.isAlive(b));
  assert.equal(w.countEntities(), 0);
});

test('world: destroyEntityByLiveIndex rejects a double destroy', () => {
  const w = new World();
  const e = w.createEntity();
  const i = entityIndex(e);
  assert.ok(w.destroyEntityByLiveIndex(i));
  // Second call must be a no-op - the slot is already on the free
  // list; pushing it again would hand the same index out twice.
  assert.equal(w.destroyEntityByLiveIndex(i), false);
  assert.equal(w.countEntities(), 0);
});

test('world: entityAt returns the live handle, NULL for dead slots', () => {
  const w = new World();
  const e = w.createEntity();
  const i = entityIndex(e);
  assert.equal(w.entityAt(i), e, 'live slot returns its canonical handle');
  w.destroyEntityByLiveIndex(i);
  assert.equal(w.entityAt(i), NULL_ENTITY, 'dead slot returns NULL_ENTITY');
  // Recycle: entityAt reflects the new generation, not the old one.
  const e2 = w.createEntity();
  assert.equal(w.entityAt(i), e2);
  assert.notEqual(w.entityAt(i), e);
});

// ----- EntityAllocator.tighten() -----

test('entity allocator: tighten lowers capacity past trailing dead slots', () => {
  const alloc = new EntityAllocator();
  const a = alloc.create();   // index 1
  const b = alloc.create();   // index 2
  const c = alloc.create();   // index 3
  const d = alloc.create();   // index 4
  assert.equal(alloc.capacity(), 5);
  // Destroy the top two. nextFresh does not shrink on its own.
  assert.ok(alloc.destroy(d));
  assert.ok(alloc.destroy(c));
  assert.equal(alloc.capacity(), 5, 'nextFresh does not shrink on destroy');
  alloc.tighten();
  assert.equal(alloc.capacity(), 3, 'tighten dropped the two trailing dead slots');
  assert.ok(alloc.isAlive(a));
  assert.ok(alloc.isAlive(b));
});

test('entity allocator: tighten is a no-op when the top slot is live', () => {
  const alloc = new EntityAllocator();
  alloc.create();             // index 1
  const b = alloc.create();   // index 2
  alloc.create();             // index 3 - stays live, pins nextFresh
  assert.equal(alloc.capacity(), 4);
  assert.ok(alloc.destroy(b)); // free a middle slot, not the top
  alloc.tighten();
  assert.equal(alloc.capacity(), 4, 'a live top slot pins nextFresh');
});

test('entity allocator: tighten drops free-list entries above the new mark, keeps those below', () => {
  const alloc = new EntityAllocator();
  alloc.create();             // index 1 - live, pins the floor
  const b = alloc.create();   // index 2
  alloc.create();             // index 3 - live
  const d = alloc.create();   // index 4
  assert.equal(alloc.capacity(), 5);
  // Free a middle slot (2) and a trailing slot (4).
  assert.ok(alloc.destroy(b));
  assert.ok(alloc.destroy(d));
  alloc.tighten();
  // Slot 4 was trailing dead -> reclaimed; slot 2 sits below the live
  // slot 3, so it stays on the free list.
  assert.equal(alloc.capacity(), 4);
  // Next create recycles slot 2 (still on the free list)...
  assert.equal(entityIndex(alloc.create()), 2);
  // ...and the one after is a fresh index 4, not a stale free-list hit.
  assert.equal(entityIndex(alloc.create()), 4);
  assert.equal(alloc.capacity(), 5);
});

test('entity allocator: tighten resets reclaimed slots to generation 0', () => {
  const alloc = new EntityAllocator();
  alloc.create();             // index 1 - keeps the floor live
  const b = alloc.create();   // index 2
  assert.equal(entityGeneration(b), 0);
  assert.ok(alloc.destroy(b)); // slot 2's generation bumps to 1
  alloc.tighten();             // slot 2 is trailing dead -> reclaimed
  assert.equal(alloc.capacity(), 2);
  // Re-grow into slot 2. Without the generation reset it would come
  // back at generation 1; tighten returns the slot to pristine state
  // so snapshotInto's "slots >= nextFresh look never-allocated"
  // invariant still holds.
  const b2 = alloc.create();
  assert.equal(entityIndex(b2), 2);
  assert.equal(entityGeneration(b2), 0, 'reclaimed slot is pristine, not generation 1');
});

test('entity allocator: tighten never lowers capacity below 1', () => {
  const alloc = new EntityAllocator();
  const a = alloc.create();   // index 1
  assert.equal(alloc.capacity(), 2);
  assert.ok(alloc.destroy(a));
  alloc.tighten();            // every live slot is gone
  assert.equal(alloc.capacity(), 1, 'index 0 is reserved; nextFresh floors at 1');
  // The allocator is fully usable again - next create is a clean index 1.
  const a2 = alloc.create();
  assert.equal(entityIndex(a2), 1);
  assert.equal(entityGeneration(a2), 0);
  assert.equal(alloc.capacity(), 2);
});

test('entity allocator: tighten preserves live handles below the mark', () => {
  const alloc = new EntityAllocator();
  const a = alloc.create();   // index 1
  const b = alloc.create();   // index 2
  const c = alloc.create();   // index 3
  const d = alloc.create();   // index 4
  assert.ok(alloc.destroy(c));
  assert.ok(alloc.destroy(d));
  alloc.tighten();
  assert.equal(alloc.capacity(), 3);
  // Survivors still validate and round-trip through entityAt.
  assert.ok(alloc.isAlive(a));
  assert.ok(alloc.isAlive(b));
  assert.equal(alloc.entityAt(entityIndex(a)), a);
  assert.equal(alloc.entityAt(entityIndex(b)), b);
  // Reclaimed slots are dead and out of range.
  assert.equal(alloc.isAlive(c), false);
  assert.equal(alloc.isAlive(d), false);
  assert.equal(alloc.entityAt(entityIndex(c)), NULL_ENTITY);
  assert.equal(alloc.entityAt(entityIndex(d)), NULL_ENTITY);
  assert.equal(alloc.count(), 2, 'liveCount untouched - reclaimed slots were already dead');
});

test('entity allocator: tighten on a fresh allocator is a no-op and is idempotent', () => {
  const fresh = new EntityAllocator();
  fresh.tighten();
  assert.equal(fresh.capacity(), 1);

  const alloc = new EntityAllocator();
  alloc.create();             // index 1 - live
  const b = alloc.create();   // index 2
  const c = alloc.create();   // index 3
  assert.ok(alloc.destroy(b));
  assert.ok(alloc.destroy(c));
  alloc.tighten();
  const afterFirst = alloc.capacity();
  alloc.tighten();
  assert.equal(alloc.capacity(), afterFirst, 'second tighten changes nothing');
  assert.equal(afterFirst, 2);
});

test('world: countSystems totals across phases', () => {
  const w = new World();
  const noop: System = { name: 'noop', update: () => {} };
  w.addSystem(noop, SYSTEM_PHASE_INPUT);
  w.addSystem(noop, SYSTEM_PHASE_LOGIC);
  w.addSystem(noop, SYSTEM_PHASE_LOGIC);
  assert.equal(w.countSystems(), 3);
  assert.equal(w.countSystemsInPhase(SYSTEM_PHASE_LOGIC), 2);
});

// ----- SpritePool -----

test('sprite pool: attach with tint sets ACTIVE+TINTED', () => {
  const pool = new SpritePool();
  const w = new World();
  const e = w.createEntity();
  pool.attach(e, 0, 0, COLOR_KNOT_INT);
  const i = entityIndex(e);
  assert.equal(pool.atlas[i], 0);
  assert.equal(pool.frame[i], 0);
  assert.ok(pool.isActive(e));
  assert.equal((pool.flags[i] ?? 0) & SPRITE_FLAG_ACTIVE, SPRITE_FLAG_ACTIVE);
  assert.equal((pool.flags[i] ?? 0) & SPRITE_FLAG_TINTED, SPRITE_FLAG_TINTED);
  assert.ok(approxEq(pool.tintR[i] ?? 0, COLOR_KNOT_INT.r, 1e-6), 'tintR within Float32 precision of source');
});

test('sprite pool: attach without tint clears TINTED', () => {
  const pool = new SpritePool();
  const w = new World();
  const e = w.createEntity();
  pool.attach(e, 7, 3);
  const i = entityIndex(e);
  assert.equal(pool.atlas[i], 7);
  assert.equal(pool.frame[i], 3);
  assert.equal((pool.flags[i] ?? 0) & SPRITE_FLAG_TINTED, 0);
  assert.equal(pool.tintR[i], 1);
});

test('sprite pool: setFrame, clearTint, detach', () => {
  const pool = new SpritePool();
  const w = new World();
  const e = w.createEntity();
  pool.attach(e, 0, 0, COLOR_KNOT_INT);
  const i = entityIndex(e);
  pool.setFrame(e, 4);
  assert.equal(pool.frame[i], 4);
  pool.clearTint(e);
  assert.equal((pool.flags[i] ?? 0) & SPRITE_FLAG_TINTED, 0);
  assert.equal(pool.tintR[i], 1);
  pool.detach(e);
  assert.equal(pool.atlas[i], -1);
  assert.ok(!pool.isActive(e));
});

// ----- SpriteRenderSystem end-to-end -----

test('sprite render: submits one draw per active sprite, sorted by depth', () => {
  const w = new World();
  const tp = new TransformPool();
  const sp = new SpritePool();
  w.registerPool(POOL_TRANSFORM, tp);
  w.registerPool(POOL_SPRITE, sp);
  const device = new FakeDevice();
  w.resources.set(RESOURCE_DEVICE, device);
  w.resources.set(RESOURCE_CAMERA, { centerX: 0, centerY: 0, zoom: 1, rotation: 0, viewportWidth: 640, viewportHeight: 400 });
  w.resources.set(RESOURCE_TIME, createTimeResource());

  const front = w.createEntity();   // x+y = 4 (drawn last)
  const back = w.createEntity();    // x+y = 0 (drawn first)
  const mid = w.createEntity();     // x+y = 2
  tp.attach(front, 2, 2, 0);
  tp.attach(back, 0, 0, 0);
  tp.attach(mid, 1, 1, 0);
  sp.attach(front, 0, 0);
  sp.attach(back, 0, 0);
  sp.attach(mid, 0, 0);

  w.addSystem(new SpriteRenderSystem(), SYSTEM_PHASE_RENDER);
  device.beginFrame();
  w.update(0);

  assert.equal(device.drawCalls.length, 3);
  const calls = device.drawCalls;
  assert.equal(calls[0]?.x, 0);   // back
  assert.equal(calls[0]?.y, 0);
  assert.equal(calls[1]?.x, 1);   // mid
  assert.equal(calls[2]?.x, 2);   // front
});

test('sprite render: skips entities without a sprite', () => {
  const w = new World();
  const tp = new TransformPool();
  const sp = new SpritePool();
  w.registerPool(POOL_TRANSFORM, tp);
  w.registerPool(POOL_SPRITE, sp);
  const device = new FakeDevice();
  w.resources.set(RESOURCE_DEVICE, device);
  w.resources.set(RESOURCE_CAMERA, { centerX: 0, centerY: 0, zoom: 1, rotation: 0, viewportWidth: 640, viewportHeight: 400 });
  w.resources.set(RESOURCE_TIME, createTimeResource());

  // Two entities, only one with a sprite.
  const a = w.createEntity();
  const b = w.createEntity();
  tp.attach(a, 0, 0, 0);
  tp.attach(b, 1, 1, 0);
  sp.attach(a, 0, 0);

  w.addSystem(new SpriteRenderSystem(), SYSTEM_PHASE_RENDER);
  device.beginFrame();
  w.update(0);
  assert.equal(device.drawCalls.length, 1);
});

test('sprite render: skips invisible transforms', () => {
  const w = new World();
  const tp = new TransformPool();
  const sp = new SpritePool();
  w.registerPool(POOL_TRANSFORM, tp);
  w.registerPool(POOL_SPRITE, sp);
  const device = new FakeDevice();
  w.resources.set(RESOURCE_DEVICE, device);
  w.resources.set(RESOURCE_CAMERA, { centerX: 0, centerY: 0, zoom: 1, rotation: 0, viewportWidth: 640, viewportHeight: 400 });

  const e: EntityId = w.createEntity();
  tp.attach(e, 0, 0, 0);
  sp.attach(e, 0, 0);
  tp.setVisible(e, false);

  w.addSystem(new SpriteRenderSystem(), SYSTEM_PHASE_RENDER);
  device.beginFrame();
  w.update(0);
  assert.equal(device.drawCalls.length, 0);
});

// ----- Time + tick math -----

test('time resource: advances on update via a custom system', () => {
  const w = new World();
  const time = createTimeResource();
  w.resources.set(RESOURCE_TIME, time);
  let ticked = 0;
  const sys: System = {
    name: 'tick-counter',
    update: (_w, dt) => { ticked++; time.elapsed += dt; time.frame += 1; },
  };
  w.addSystem(sys, SYSTEM_PHASE_LOGIC);
  w.update(0.016);
  w.update(0.016);
  assert.equal(ticked, 2);
  assert.ok(Math.abs(time.elapsed - 0.032) < 1e-9);
  assert.equal(time.frame, 2);
});
