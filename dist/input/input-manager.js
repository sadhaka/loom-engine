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
export class InputManager {
    keysHeld = new Set();
    keysPressedAccum = new Set();
    keysReleasedAccum = new Set();
    pointer = { x: 0, y: 0, buttons: 0, inside: false };
    pointerPressedAccum = 0;
    pointerReleasedAccum = 0;
    wheelDeltaAccum = 0;
    activeTouches = new Map();
    touchesStartedAccum = [];
    touchesEndedAccum = [];
    // Per-frame buffers (snapshot at beginFrame).
    currentKeysPressed = new Set();
    currentKeysReleased = new Set();
    currentPointerPressed = 0;
    currentPointerReleased = 0;
    currentWheelDelta = 0;
    currentTouchesStarted = [];
    currentTouchesEnded = [];
    // Phase 9.1: cached snapshot + cached touches array, mutated in
    // place each frame so RESOURCE_INPUT readers don't trigger an
    // allocation per tick. The fields below alias the manager's own
    // collections; the snapshot's identity is stable across frames.
    cachedTouchesArray = [];
    cachedSnapshot;
    // Bound listener refs so dispose() can detach them cleanly.
    boundKeyDown = this.onKeyDown.bind(this);
    boundKeyUp = this.onKeyUp.bind(this);
    boundPointerMove = this.onPointerMove.bind(this);
    boundPointerDown = this.onPointerDown.bind(this);
    boundPointerUp = this.onPointerUp.bind(this);
    boundPointerEnter = this.onPointerEnter.bind(this);
    boundPointerLeave = this.onPointerLeave.bind(this);
    boundWheel = this.onWheel.bind(this);
    boundTouchStart = this.onTouchStart.bind(this);
    boundTouchMove = this.onTouchMove.bind(this);
    boundTouchEnd = this.onTouchEnd.bind(this);
    boundTouchCancel = this.onTouchCancel.bind(this);
    boundContextMenu = this.onContextMenu.bind(this);
    canvas = null;
    targetWindow = null;
    attached = false;
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
    attach(canvas, win = window) {
        if (this.attached)
            return;
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
    detach() {
        if (!this.attached)
            return;
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
    beginFrame() {
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
    snapshot() {
        const snap = this.cachedSnapshot;
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
    injectKeyDown(code) {
        if (!this.keysHeld.has(code)) {
            this.keysPressedAccum.add(code);
            this.keysHeld.add(code);
        }
    }
    injectKeyUp(code) {
        if (this.keysHeld.has(code)) {
            this.keysReleasedAccum.add(code);
            this.keysHeld.delete(code);
        }
    }
    injectPointerMove(x, y, buttons, inside = true) {
        this.pointer.x = x;
        this.pointer.y = y;
        this.pointer.buttons = buttons;
        this.pointer.inside = inside;
    }
    injectPointerDown(buttonsBit) {
        this.pointerPressedAccum |= buttonsBit;
        this.pointer.buttons |= buttonsBit;
    }
    injectPointerUp(buttonsBit) {
        this.pointerReleasedAccum |= buttonsBit;
        this.pointer.buttons &= ~buttonsBit;
    }
    // Inject a synthetic touchstart for tests / virtual-input adapters.
    // Coordinates are in canvas-internal pixel space (same space as the
    // real touch listener produces after DPR scaling).
    injectTouchStart(id, x, y) {
        const tp = { id, x, y };
        this.activeTouches.set(id, tp);
        this.touchesStartedAccum.push(tp);
    }
    injectTouchMove(id, x, y) {
        const tp = { id, x, y };
        this.activeTouches.set(id, tp);
    }
    injectTouchEnd(id, x, y) {
        const tp = { id, x, y };
        this.activeTouches.delete(id);
        this.touchesEndedAccum.push(tp);
    }
    // ---------- DOM listener implementations ----------
    onKeyDown(e) {
        if (!this.keysHeld.has(e.code)) {
            this.keysPressedAccum.add(e.code);
            this.keysHeld.add(e.code);
        }
    }
    onKeyUp(e) {
        if (this.keysHeld.has(e.code)) {
            this.keysReleasedAccum.add(e.code);
            this.keysHeld.delete(e.code);
        }
    }
    updatePointerFromEvent(e) {
        if (!this.canvas)
            return;
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
    onPointerMove(e) {
        this.updatePointerFromEvent(e);
    }
    onPointerDown(e) {
        this.updatePointerFromEvent(e);
        const bit = 1 << e.button;
        this.pointerPressedAccum |= bit;
    }
    onPointerUp(e) {
        this.updatePointerFromEvent(e);
        const bit = 1 << e.button;
        this.pointerReleasedAccum |= bit;
    }
    onPointerEnter(e) {
        this.updatePointerFromEvent(e);
        this.pointer.inside = true;
    }
    onPointerLeave(_e) {
        this.pointer.inside = false;
        this.pointer.buttons = 0;
    }
    onWheel(e) {
        this.wheelDeltaAccum += e.deltaY;
        e.preventDefault();
    }
    updateTouchPoint(t) {
        if (!this.canvas)
            return { id: t.identifier, x: 0, y: 0 };
        const rect = this.canvas.getBoundingClientRect();
        const sx = this.canvas.width / Math.max(1, rect.width);
        const sy = this.canvas.height / Math.max(1, rect.height);
        return {
            id: t.identifier,
            x: (t.clientX - rect.left) * sx,
            y: (t.clientY - rect.top) * sy,
        };
    }
    onTouchStart(e) {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (!t)
                continue;
            const tp = this.updateTouchPoint(t);
            this.activeTouches.set(tp.id, tp);
            this.touchesStartedAccum.push(tp);
        }
        e.preventDefault();
    }
    onTouchMove(e) {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (!t)
                continue;
            const tp = this.updateTouchPoint(t);
            this.activeTouches.set(tp.id, tp);
        }
        e.preventDefault();
    }
    onTouchEnd(e) {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (!t)
                continue;
            const tp = this.updateTouchPoint(t);
            this.activeTouches.delete(tp.id);
            this.touchesEndedAccum.push(tp);
        }
    }
    onTouchCancel(e) {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (!t)
                continue;
            this.activeTouches.delete(t.identifier);
        }
    }
    // Default-prevent the right-click menu so a Phase 6+ ARPG can use
    // RMB without the OS context menu. Callers that need the menu can
    // wrap the canvas in a parent and listen there instead.
    onContextMenu(e) {
        e.preventDefault();
    }
}
// Resource key. Engine.create registers the InputManager + a current
// snapshot under these keys.
export const RESOURCE_INPUT_MANAGER = 'input_manager';
export const RESOURCE_INPUT = 'input';
//# sourceMappingURL=input-manager.js.map