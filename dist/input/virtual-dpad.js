// VirtualDpad - on-screen 4-direction touch overlay that injects WASD
// key events into an InputManager. Lets every input-consuming system
// (movement, interaction, menu nav) keep reading keysHeld with no
// branching for "is this a touch device?" - the keys are already there.
//
// Layout: bottom-left of the viewport, a 3x3 grid where the four
// edge cells are directional buttons (up = KeyW, down = KeyS,
// left = KeyA, right = KeyD) and the center cell is a deadzone /
// label. Corners are inert. The grid is fixed-position so it stays
// pinned regardless of page scroll.
//
// Multi-touch: each direction tracks the set of touch identifiers
// currently pressing it. KeyDown injects only when the count goes
// 0->1; KeyUp injects only when it returns to 0. Fingers can slide
// off (touchcancel) without leaving a phantom held key.
//
// Visibility: by default the overlay only mounts when
// `'ontouchstart' in window` is true (or navigator.maxTouchPoints > 0).
// Callers can override via opts.visible for tests / forced display.
const KEY_FOR_DIRECTION = {
    up: 'KeyW',
    down: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
};
export class VirtualDpad {
    opts;
    root = null;
    buttons = null;
    mounted = false;
    visible;
    constructor(opts) {
        this.opts = opts;
        this.visible = opts.visible ?? VirtualDpad.detectTouchSupport();
    }
    // Heuristic: any modern phone / tablet exposes ontouchstart on
    // window. iPad with iPadOS 13+ pretends to be desktop Safari but
    // still reports navigator.maxTouchPoints > 0. Either signal is
    // enough to consider the device touch-capable.
    static detectTouchSupport(win) {
        const w = win ?? (typeof window !== 'undefined' ? window : undefined);
        if (!w)
            return false;
        if ('ontouchstart' in w)
            return true;
        const nav = w.navigator;
        if (nav && typeof nav.maxTouchPoints === 'number' && nav.maxTouchPoints > 0)
            return true;
        return false;
    }
    isMounted() {
        return this.mounted;
    }
    isVisible() {
        return this.visible;
    }
    // Attach the overlay DOM. No-op on desktop (visible=false), so the
    // caller can mount unconditionally and let the class decide.
    mount() {
        if (this.mounted)
            return;
        if (!this.visible)
            return;
        const doc = this.opts.document ?? (typeof document !== 'undefined' ? document : undefined);
        if (!doc)
            return;
        const parent = this.opts.parent ?? doc.body;
        if (!parent)
            return;
        const root = doc.createElement('div');
        root.className = 'loom-virtual-dpad';
        this.styleRoot(root);
        const buttons = {
            up: this.buildButton(doc, 'up', '▲'),
            down: this.buildButton(doc, 'down', '▼'),
            left: this.buildButton(doc, 'left', '◀'),
            right: this.buildButton(doc, 'right', '▶'),
        };
        // 3x3 grid. Corners are inert spacers - cleaner press surface
        // than a single round pad and easier to thumb on phones.
        const grid = doc.createElement('div');
        this.styleGrid(grid);
        grid.appendChild(this.spacer(doc));
        grid.appendChild(buttons.up.el);
        grid.appendChild(this.spacer(doc));
        grid.appendChild(buttons.left.el);
        grid.appendChild(this.deadzone(doc));
        grid.appendChild(buttons.right.el);
        grid.appendChild(this.spacer(doc));
        grid.appendChild(buttons.down.el);
        grid.appendChild(this.spacer(doc));
        root.appendChild(grid);
        parent.appendChild(root);
        this.root = root;
        this.buttons = buttons;
        this.attachListeners();
        this.mounted = true;
    }
    // Remove the overlay and release any held WASD keys it had injected.
    unmount() {
        if (!this.mounted)
            return;
        if (this.buttons) {
            for (const dir of Object.keys(this.buttons)) {
                const b = this.buttons[dir];
                if (b.active.size > 0) {
                    b.active.clear();
                    this.opts.inputManager.injectKeyUp(KEY_FOR_DIRECTION[dir]);
                }
            }
        }
        if (this.root && this.root.parentNode) {
            this.root.parentNode.removeChild(this.root);
        }
        this.root = null;
        this.buttons = null;
        this.mounted = false;
    }
    // Synthetic press / release for tests. Bypasses DOM listeners but
    // exercises the same accounting as a real touch.
    pressDirection(dir, touchId = -1) {
        const b = this.requireButton(dir);
        const wasActive = b.active.size > 0;
        b.active.add(touchId);
        if (!wasActive) {
            this.opts.inputManager.injectKeyDown(KEY_FOR_DIRECTION[dir]);
            if (this.opts.onPress)
                this.opts.onPress(dir);
        }
    }
    releaseDirection(dir, touchId = -1) {
        const b = this.requireButton(dir);
        if (!b.active.delete(touchId))
            return;
        if (b.active.size === 0) {
            this.opts.inputManager.injectKeyUp(KEY_FOR_DIRECTION[dir]);
        }
    }
    // Number of unique touch IDs currently pressing a direction. Test
    // helper; production code should read InputManager.snapshot().
    pressedTouchCount(dir) {
        if (!this.buttons)
            return 0;
        return this.buttons[dir].active.size;
    }
    requireButton(dir) {
        if (!this.buttons) {
            // pressDirection / releaseDirection used before mount. Build a
            // headless button record so tests can drive synthetic presses
            // without DOM mounting.
            const headless = {
                up: { el: null, active: new Set() },
                down: { el: null, active: new Set() },
                left: { el: null, active: new Set() },
                right: { el: null, active: new Set() },
            };
            this.buttons = headless;
        }
        return this.buttons[dir];
    }
    buildButton(doc, dir, glyph) {
        const el = doc.createElement('div');
        el.className = 'loom-virtual-dpad-btn loom-virtual-dpad-' + dir;
        el.textContent = glyph;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', 'Move ' + dir);
        this.styleButton(el);
        return { el, active: new Set() };
    }
    spacer(doc) {
        const el = doc.createElement('div');
        el.className = 'loom-virtual-dpad-spacer';
        el.style.pointerEvents = 'none';
        return el;
    }
    deadzone(doc) {
        const el = doc.createElement('div');
        el.className = 'loom-virtual-dpad-deadzone';
        el.style.pointerEvents = 'none';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.color = 'rgba(214, 198, 148, 0.45)';
        el.style.fontSize = '10px';
        el.style.letterSpacing = '0.08em';
        el.style.textTransform = 'uppercase';
        el.style.fontFamily = 'ui-monospace, Consolas, monospace';
        el.textContent = 'move';
        return el;
    }
    styleRoot(root) {
        const s = root.style;
        s.position = 'fixed';
        // env() falls back to 12px when safe-area-inset is unsupported.
        s.bottom = 'calc(12px + env(safe-area-inset-bottom, 0px))';
        s.left = 'calc(12px + env(safe-area-inset-left, 0px))';
        s.zIndex = '9000';
        s.userSelect = 'none';
        s.touchAction = 'none';
        s.setProperty('-webkit-user-select', 'none');
    }
    styleGrid(grid) {
        const s = grid.style;
        s.display = 'grid';
        s.gridTemplateColumns = '56px 56px 56px';
        s.gridTemplateRows = '56px 56px 56px';
        s.gap = '4px';
    }
    styleButton(btn) {
        const s = btn.style;
        s.display = 'flex';
        s.alignItems = 'center';
        s.justifyContent = 'center';
        s.background = 'rgba(20, 17, 13, 0.72)';
        s.border = '1px solid rgba(214, 198, 148, 0.35)';
        s.borderRadius = '6px';
        s.color = '#d6c694';
        s.fontSize = '20px';
        s.fontWeight = '700';
        s.touchAction = 'none';
        s.cursor = 'pointer';
        s.userSelect = 'none';
        s.setProperty('-webkit-user-select', 'none');
        s.setProperty('-webkit-tap-highlight-color', 'transparent');
    }
    attachListeners() {
        if (!this.buttons)
            return;
        const dirs = ['up', 'down', 'left', 'right'];
        for (const dir of dirs) {
            const b = this.buttons[dir];
            // touchstart / touchend / touchcancel cover the touch case.
            // mousedown / mouseup are added too so a desktop tester with a
            // visible pad (opts.visible = true) can drive it from a mouse.
            b.el.addEventListener('touchstart', (e) => {
                const te = e;
                for (let i = 0; i < te.changedTouches.length; i++) {
                    const t = te.changedTouches[i];
                    if (t)
                        this.pressDirection(dir, t.identifier);
                }
                te.preventDefault();
            }, { passive: false });
            const endHandler = (e) => {
                const te = e;
                for (let i = 0; i < te.changedTouches.length; i++) {
                    const t = te.changedTouches[i];
                    if (t)
                        this.releaseDirection(dir, t.identifier);
                }
            };
            b.el.addEventListener('touchend', endHandler);
            b.el.addEventListener('touchcancel', endHandler);
            b.el.addEventListener('mousedown', (e) => {
                this.pressDirection(dir, -1);
                e.preventDefault();
            });
            // mouseup is on window so a press-then-drag-off-and-release
            // doesn't leave a phantom held key.
            const win = (typeof window !== 'undefined' ? window : undefined);
            if (win) {
                win.addEventListener('mouseup', () => this.releaseDirection(dir, -1));
            }
        }
    }
}
//# sourceMappingURL=virtual-dpad.js.map