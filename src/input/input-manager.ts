// InputManager - DOM event listener that accumulates input state
// between ticks. Read by InputSystem in PHASE_INPUT, which promotes
// the accumulator to a frame-coherent InputResource that other
// systems read.
//
// What it tracks:
//   - Keyboard: keys held (Set<string>), keys pressed this frame
//     (transitioned up->down between last beginFrame and this one),
//     keys released this frame
//   - Pointer: position in canvas-relative coordinates, button state,
//     pressed-this-frame, released-this-frame
//   - Touches: an array of active touch points (id, x, y)
//
// Frame-coherence model:
//   Per-frame transient state (pressedThisFrame / releasedThisFrame /
//   wheelDeltaThisFrame) accumulates DOM events between calls to
//   beginFrame(). beginFrame() snapshots the transient state into
//   "current frame" buffers and clears the accumulators for the next
//   tick. Held / position / buttons remain continuous.
//
// Browsers fire DOM events asynchronously. RAF gives one tick per
// vsync; multiple events can fire between ticks. Callers must call
// beginFrame() once per frame (the InputSystem does this in
// PHASE_INPUT, the very first phase, so all other systems read
// stable state for the rest of the tick).

export interface PointerSnapshot {
  // Canvas-relative pixel coordinates. clientX/Y minus the canvas's
  // bounding rect; the manager handles DPR scaling so callers get
  // the same coordinate space as the canvas's `width`/`height`.
  x: number;
  y: number;
  // Most recent buttons mask (1 = primary held, 2 = secondary, 4 = mid).
  buttons: number;
  // True if the pointer is currently over the canvas.
  inside: boolean;
}

export interface TouchPoint {
  id: number;
  x: number;
  y: number;
}

// Read-only snapshot the InputSystem hands to the world resource.
export interface InputSnapshot {
  // Set of physical key codes currently held (e.g. "KeyW", "ArrowUp",
  // "Space", "Escape"). Lowercase letters NOT used; KeyboardEvent.code
  // is the source.
  keysHeld: ReadonlySet<string>;
  keysPressedThisFrame: ReadonlySet<string>;
  keysReleasedThisFrame: ReadonlySet<string>;

  pointer: Readonly<PointerSnapshot>;
  pointerPressedThisFrame: number;     // bitmask of buttons that went down this frame
  pointerReleasedThisFrame: number;
  wheelDeltaThisFrame: number;         // accumulated wheel deltaY between frames

  touches: ReadonlyArray<TouchPoint>;
  touchesStartedThisFrame: ReadonlyArray<TouchPoint>;
  touchesEndedThisFrame: ReadonlyArray<TouchPoint>;
}

export class InputManager {
  private keysHeld: Set<string> = new Set();
  private keysPressedAccum: Set<string> = new Set();
  private keysReleasedAccum: Set<string> = new Set();

  private pointer: PointerSnapshot = { x: 0, y: 0, buttons: 0, inside: false };
  private pointerPressedAccum: number = 0;
  private pointerReleasedAccum: number = 0;
  private wheelDeltaAccum: number = 0;

  private activeTouches: Map<number, TouchPoint> = new Map();
  private touchesStartedAccum: TouchPoint[] = [];
  private touchesEndedAccum: TouchPoint[] = [];

  // Per-frame buffers (snapshot at beginFrame).
  private currentKeysPressed: Set<string> = new Set();
  private currentKeysReleased: Set<string> = new Set();
  private currentPointerPressed: number = 0;
  private currentPointerReleased: number = 0;
  private currentWheelDelta: number = 0;
  private currentTouchesStarted: TouchPoint[] = [];
  private currentTouchesEnded: TouchPoint[] = [];

  // Phase 9.1: cached snapshot + cached touches array, mutated in
  // place each frame so RESOURCE_INPUT readers don't trigger an
  // allocation per tick. The fields below alias the manager's own
  // collections; the snapshot's identity is stable across frames.
  private cachedTouchesArray: TouchPoint[] = [];
  private cachedSnapshot: InputSnapshot;

  // Bound listener refs so dispose() can detach them cleanly.
  private boundKeyDown = this.onKeyDown.bind(this);
  private boundKeyUp = this.onKeyUp.bind(this);
  private boundPointerMove = this.onPointerMove.bind(this);
  private boundPointerDown = this.onPointerDown.bind(this);
  private boundPointerUp = this.onPointerUp.bind(this);
  private boundPointerEnter = this.onPointerEnter.bind(this);
  private boundPointerLeave = this.onPointerLeave.bind(this);
  private boundWheel = this.onWheel.bind(this);
  private boundTouchStart = this.onTouchStart.bind(this);
  private boundTouchMove = this.onTouchMove.bind(this);
  private boundTouchEnd = this.onTouchEnd.bind(this);
  private boundTouchCancel = this.onTouchCancel.bind(this);
  private boundContextMenu = this.onContextMenu.bind(this);

  private canvas: HTMLCanvasElement | null = null;
  private targetWindow: Window | null = null;
  private attached: boolean = false;

  constructor() {
    // Build a stable cached snapshot once. snapshot() returns this
    // same reference each frame, having mutated only the fields that
    // change. Phase 9.1 alloc-churn fix.
    this.cachedSnapshot = {
      keysHeld: this.keysHeld,
      keysPressedThisFrame: this.currentKeysPressed,
      keysReleasedThisFrame: this.currentKeysReleased,
      pointer: this.pointer,
      pointerPressedThisFrame: 0,
      pointerReleasedThisFrame: 0,
      wheelDeltaThisFrame: 0,
      touches: this.cachedTouchesArray,
      touchesStartedThisFrame: this.currentTouchesStarted,
      touchesEndedThisFrame: this.currentTouchesEnded,
    };
  }

  // Attach DOM listeners. Keyboard goes on window so the canvas
  // doesn't need focus to receive arrow keys. Pointer + wheel go on
  // the canvas so coordinates resolve cleanly.
  attach(canvas: HTMLCanvasElement, win: Window = window): void {
    if (this.attached) return;
    this.canvas = canvas;
    this.targetWindow = win;
    win.addEventListener('keydown', this.boundKeyDown);
    win.addEventListener('keyup', this.boundKeyUp);
    canvas.addEventListener('mousemove', this.boundPointerMove);
    canvas.addEventListener('mousedown', this.boundPointerDown);
    canvas.addEventListener('mouseup', this.boundPointerUp);
    canvas.addEventListener('mouseenter', this.boundPointerEnter);
    canvas.addEventListener('mouseleave', this.boundPointerLeave);
    canvas.addEventListener('wheel', this.boundWheel, { passive: false });
    canvas.addEventListener('touchstart', this.boundTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.boundTouchEnd);
    canvas.addEventListener('touchcancel', this.boundTouchCancel);
    canvas.addEventListener('contextmenu', this.boundContextMenu);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    const c = this.canvas;
    const w = this.targetWindow;
    if (w) {
      w.removeEventListener('keydown', this.boundKeyDown);
      w.removeEventListener('keyup', this.boundKeyUp);
    }
    if (c) {
      c.removeEventListener('mousemove', this.boundPointerMove);
      c.removeEventListener('mousedown', this.boundPointerDown);
      c.removeEventListener('mouseup', this.boundPointerUp);
      c.removeEventListener('mouseenter', this.boundPointerEnter);
      c.removeEventListener('mouseleave', this.boundPointerLeave);
      c.removeEventListener('wheel', this.boundWheel);
      c.removeEventListener('touchstart', this.boundTouchStart);
      c.removeEventListener('touchmove', this.boundTouchMove);
      c.removeEventListener('touchend', this.boundTouchEnd);
      c.removeEventListener('touchcancel', this.boundTouchCancel);
      c.removeEventListener('contextmenu', this.boundContextMenu);
    }
    this.canvas = null;
    this.targetWindow = null;
    this.attached = false;
  }

  // Promote accumulated state to per-frame buffers and reset
  // accumulators. Called once per tick by InputSystem in PHASE_INPUT.
  //
  // Phase 9.1 alloc-churn fix: ping-pong the accumulator/current pair
  // and clear in place rather than allocating fresh Sets and arrays
  // each tick. The snapshot's identity is stable across frames; only
  // its contained collections change. Consumers must not retain a
  // reference across frames (documented at the top of this module).
  beginFrame(): void {
    // Swap accumulator <-> current. After the swap, the old "current"
    // (which is now the accumulator) gets cleared in place to be the
    // collection for the next tick's events.
    const swapPressed = this.currentKeysPressed;
    this.currentKeysPressed = this.keysPressedAccum;
    this.keysPressedAccum = swapPressed;
    swapPressed.clear();

    const swapReleased = this.currentKeysReleased;
    this.currentKeysReleased = this.keysReleasedAccum;
    this.keysReleasedAccum = swapReleased;
    swapReleased.clear();

    this.currentPointerPressed = this.pointerPressedAccum;
    this.currentPointerReleased = this.pointerReleasedAccum;
    this.currentWheelDelta = this.wheelDeltaAccum;
    this.pointerPressedAccum = 0;
    this.pointerReleasedAccum = 0;
    this.wheelDeltaAccum = 0;

    const swapStarted = this.currentTouchesStarted;
    this.currentTouchesStarted = this.touchesStartedAccum;
    this.touchesStartedAccum = swapStarted;
    swapStarted.length = 0;

    const swapEnded = this.currentTouchesEnded;
    this.currentTouchesEnded = this.touchesEndedAccum;
    this.touchesEndedAccum = swapEnded;
    swapEnded.length = 0;
  }

  // Build the immutable snapshot that systems read. Phase 9.1: returns
  // a cached snapshot object, mutating only the fields that change so
  // RESOURCE_INPUT updates are zero-alloc per frame. The touches array
  // is rebuilt in place into the cached array (no Array.from).
  snapshot(): InputSnapshot {
    const snap = this.cachedSnapshot as {
      keysHeld: ReadonlySet<string>;
      keysPressedThisFrame: ReadonlySet<string>;
      keysReleasedThisFrame: ReadonlySet<string>;
      pointer: Readonly<PointerSnapshot>;
      pointerPressedThisFrame: number;
      pointerReleasedThisFrame: number;
      wheelDeltaThisFrame: number;
      touches: ReadonlyArray<TouchPoint>;
      touchesStartedThisFrame: ReadonlyArray<TouchPoint>;
      touchesEndedThisFrame: ReadonlyArray<TouchPoint>;
    };
    snap.keysPressedThisFrame = this.currentKeysPressed;
    snap.keysReleasedThisFrame = this.currentKeysReleased;
    snap.pointerPressedThisFrame = this.currentPointerPressed;
    snap.pointerReleasedThisFrame = this.currentPointerReleased;
    snap.wheelDeltaThisFrame = this.currentWheelDelta;
    snap.touchesStartedThisFrame = this.currentTouchesStarted;
    snap.touchesEndedThisFrame = this.currentTouchesEnded;

    // Rebuild touches array in place from the active-touches map.
    const touchesArr = this.cachedTouchesArray;
    touchesArr.length = 0;
    for (const tp of this.activeTouches.values()) {
      touchesArr.push(tp);
    }
    return this.cachedSnapshot;
  }

  // ---------- Test / synthetic injection helpers ----------

  // Inject a keydown without a real DOM event (for unit tests).
  injectKeyDown(code: string): void {
    if (!this.keysHeld.has(code)) {
      this.keysPressedAccum.add(code);
      this.keysHeld.add(code);
    }
  }

  injectKeyUp(code: string): void {
    if (this.keysHeld.has(code)) {
      this.keysReleasedAccum.add(code);
      this.keysHeld.delete(code);
    }
  }

  injectPointerMove(x: number, y: number, buttons: number, inside: boolean = true): void {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.buttons = buttons;
    this.pointer.inside = inside;
  }

  injectPointerDown(buttonsBit: number): void {
    this.pointerPressedAccum |= buttonsBit;
    this.pointer.buttons |= buttonsBit;
  }

  injectPointerUp(buttonsBit: number): void {
    this.pointerReleasedAccum |= buttonsBit;
    this.pointer.buttons &= ~buttonsBit;
  }

  // Inject a synthetic touchstart for tests / virtual-input adapters.
  // Coordinates are in canvas-internal pixel space (same space as the
  // real touch listener produces after DPR scaling).
  injectTouchStart(id: number, x: number, y: number): void {
    const tp: TouchPoint = { id, x, y };
    this.activeTouches.set(id, tp);
    this.touchesStartedAccum.push(tp);
  }

  injectTouchMove(id: number, x: number, y: number): void {
    const tp: TouchPoint = { id, x, y };
    this.activeTouches.set(id, tp);
  }

  injectTouchEnd(id: number, x: number, y: number): void {
    const tp: TouchPoint = { id, x, y };
    this.activeTouches.delete(id);
    this.touchesEndedAccum.push(tp);
  }

  // ---------- DOM listener implementations ----------

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.keysHeld.has(e.code)) {
      this.keysPressedAccum.add(e.code);
      this.keysHeld.add(e.code);
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (this.keysHeld.has(e.code)) {
      this.keysReleasedAccum.add(e.code);
      this.keysHeld.delete(e.code);
    }
  }

  private updatePointerFromEvent(e: MouseEvent): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    // Account for canvas display-size vs internal-resolution: the
    // canvas may be CSS-scaled. We multiply by the ratio so the
    // returned coords match the canvas's intrinsic pixel space.
    const sx = this.canvas.width / Math.max(1, rect.width);
    const sy = this.canvas.height / Math.max(1, rect.height);
    this.pointer.x = (e.clientX - rect.left) * sx;
    this.pointer.y = (e.clientY - rect.top) * sy;
    this.pointer.buttons = e.buttons;
    this.pointer.inside = true;
  }

  private onPointerMove(e: MouseEvent): void {
    this.updatePointerFromEvent(e);
  }

  private onPointerDown(e: MouseEvent): void {
    this.updatePointerFromEvent(e);
    const bit = 1 << e.button;
    this.pointerPressedAccum |= bit;
  }

  private onPointerUp(e: MouseEvent): void {
    this.updatePointerFromEvent(e);
    const bit = 1 << e.button;
    this.pointerReleasedAccum |= bit;
  }

  private onPointerEnter(e: MouseEvent): void {
    this.updatePointerFromEvent(e);
    this.pointer.inside = true;
  }

  private onPointerLeave(_e: MouseEvent): void {
    this.pointer.inside = false;
    this.pointer.buttons = 0;
  }

  private onWheel(e: WheelEvent): void {
    this.wheelDeltaAccum += e.deltaY;
    e.preventDefault();
  }

  private updateTouchPoint(t: Touch): TouchPoint {
    if (!this.canvas) return { id: t.identifier, x: 0, y: 0 };
    const rect = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / Math.max(1, rect.width);
    const sy = this.canvas.height / Math.max(1, rect.height);
    return {
      id: t.identifier,
      x: (t.clientX - rect.left) * sx,
      y: (t.clientY - rect.top) * sy,
    };
  }

  private onTouchStart(e: TouchEvent): void {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (!t) continue;
      const tp = this.updateTouchPoint(t);
      this.activeTouches.set(tp.id, tp);
      this.touchesStartedAccum.push(tp);
    }
    e.preventDefault();
  }

  private onTouchMove(e: TouchEvent): void {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (!t) continue;
      const tp = this.updateTouchPoint(t);
      this.activeTouches.set(tp.id, tp);
    }
    e.preventDefault();
  }

  private onTouchEnd(e: TouchEvent): void {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (!t) continue;
      const tp = this.updateTouchPoint(t);
      this.activeTouches.delete(tp.id);
      this.touchesEndedAccum.push(tp);
    }
  }

  private onTouchCancel(e: TouchEvent): void {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (!t) continue;
      this.activeTouches.delete(t.identifier);
    }
  }

  // Default-prevent the right-click menu so a Phase 6+ ARPG can use
  // RMB without the OS context menu. Callers that need the menu can
  // wrap the canvas in a parent and listen there instead.
  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }
}

// Resource key. Engine.create registers the InputManager + a current
// snapshot under these keys.
export const RESOURCE_INPUT_MANAGER = 'input_manager';
export const RESOURCE_INPUT = 'input';
