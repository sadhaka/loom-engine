// DebugHUD - opt-in stats overlay for the Loom Engine.
//
// 0.24.0 enabling primitive. Consumers want to see fps / entity
// count / system count / batch stats / signature version / etc.
// without each app rolling their own. DebugHUD is a tiny self-
// contained class that:
//
//   1. Tracks per-frame timing (rolling 60-sample fps).
//   2. Lets consumers register custom stat lines via addLine().
//   3. Renders the line list as a top-left overlay div on
//      attachToDom(parent), or returns formatted text via toText().
//
// Backwards-compatible addition. Nothing in the engine forces it on
// you - construct one yourself when you want it.
// Rolling sample buffer for fps. 60 samples ~ 1 second at 60fps.
var FPS_WINDOW_SAMPLES = 60;
export class DebugHUD {
    lines = [];
    // Rolling fps samples; index wraps at FPS_WINDOW_SAMPLES.
    samples = new Float32Array(FPS_WINDOW_SAMPLES);
    samplesFilled = 0;
    samplesIndex = 0;
    // -1 sentinel means "no prior frame seen". Using -1 (not 0) so a
    // clock that starts at 0 still trips the guard correctly on the
    // second beginFrame.
    lastFrameMs = -1;
    // Cumulative frame counter (never wraps; consumers can read).
    frameCountValue = 0;
    // DOM reference if attached. Engine-internal; null when detached
    // or when running headless.
    rootEl = null;
    nowFn;
    rootClass;
    lineClass;
    constructor(opts = {}) {
        this.rootClass = opts.rootClass ?? 'loom-debug-hud';
        this.lineClass = opts.lineClass ?? 'loom-debug-line';
        if (opts.nowFn) {
            this.nowFn = opts.nowFn;
        }
        else if (typeof performance !== 'undefined'
            && typeof performance.now === 'function') {
            this.nowFn = function () { return performance.now(); };
        }
        else {
            this.nowFn = function () { return Date.now(); };
        }
    }
    // Mark the start of a frame so fps tracking can compute deltas.
    // Call once per render frame from the consumer's tick / render
    // entry point. Safe to call before any addLine.
    beginFrame() {
        var now = this.nowFn();
        if (this.lastFrameMs >= 0) {
            var deltaMs = now - this.lastFrameMs;
            if (deltaMs > 0) {
                this.samples[this.samplesIndex] = 1000 / deltaMs;
                this.samplesIndex = (this.samplesIndex + 1) % FPS_WINDOW_SAMPLES;
                if (this.samplesFilled < FPS_WINDOW_SAMPLES) {
                    this.samplesFilled++;
                }
            }
        }
        this.lastFrameMs = now;
        this.frameCountValue++;
    }
    // Average fps over the rolling window. Returns 0 until the first
    // sample lands.
    fps() {
        if (this.samplesFilled === 0)
            return 0;
        var sum = 0;
        for (var i = 0; i < this.samplesFilled; i++) {
            sum += this.samples[i] ?? 0;
        }
        return sum / this.samplesFilled;
    }
    // Min / max fps across the rolling window. Useful to see a stutter.
    fpsRange() {
        if (this.samplesFilled === 0)
            return { min: 0, max: 0 };
        var min = Infinity;
        var max = -Infinity;
        for (var i = 0; i < this.samplesFilled; i++) {
            var v = this.samples[i] ?? 0;
            if (v < min)
                min = v;
            if (v > max)
                max = v;
        }
        return { min: min, max: max };
    }
    // Cumulative frame count since construction.
    frameCount() {
        return this.frameCountValue;
    }
    // Add a custom stat line. Static value if `value` is a string;
    // dynamic if a function. Call once per stat at setup; the line
    // re-renders with the current value on every render() call.
    addLine(label, value) {
        this.lines.push({ label: label, value: value });
    }
    // Drop all custom lines. Built-ins (fps / frame count) come from
    // dedicated getters and are unaffected.
    clearLines() {
        this.lines.length = 0;
    }
    // Number of registered custom lines. Test affordance.
    lineCount() {
        return this.lines.length;
    }
    // Build a text snapshot of the current stats. Consumers that don't
    // want a DOM overlay (server-side render, CLI tools, e2e snapshot
    // assertions) call this. Format: one line per stat, "label: value".
    toText() {
        var rows = [];
        rows.push('fps: ' + this.fps().toFixed(1));
        var range = this.fpsRange();
        rows.push('fps range: ' + range.min.toFixed(1) + '..' + range.max.toFixed(1));
        rows.push('frame: ' + this.frameCountValue);
        for (var i = 0; i < this.lines.length; i++) {
            var line = this.lines[i];
            if (!line)
                continue;
            var v;
            try {
                v = typeof line.value === 'function' ? line.value() : line.value;
            }
            catch {
                v = '<error>';
            }
            rows.push(line.label + ': ' + v);
        }
        return rows.join('\n');
    }
    // Mount a DOM overlay div under `parent`. Returns the created
    // root element so consumers can style it further. Idempotent: a
    // second attachToDom is a no-op (returns the same node).
    attachToDom(parent) {
        if (this.rootEl)
            return this.rootEl;
        if (typeof document === 'undefined') {
            throw new Error('DebugHUD.attachToDom requires a DOM');
        }
        var el = document.createElement('div');
        el.className = this.rootClass;
        el.style.position = 'absolute';
        el.style.top = '8px';
        el.style.left = '8px';
        el.style.padding = '6px 8px';
        el.style.background = 'rgba(0, 0, 0, 0.6)';
        el.style.color = '#aef';
        el.style.font = '11px ui-monospace, Consolas, monospace';
        el.style.lineHeight = '14px';
        el.style.pointerEvents = 'none';
        el.style.zIndex = '999';
        el.style.whiteSpace = 'pre';
        parent.appendChild(el);
        this.rootEl = el;
        return el;
    }
    // Tear down the DOM overlay if attached.
    detachFromDom() {
        if (this.rootEl && this.rootEl.parentNode) {
            this.rootEl.parentNode.removeChild(this.rootEl);
        }
        this.rootEl = null;
    }
    // Refresh the DOM overlay text (if attached) AND return the
    // current snapshot. Call once per frame after beginFrame() so
    // fps reflects the just-completed frame.
    render() {
        var text = this.toText();
        if (this.rootEl) {
            this.rootEl.textContent = text;
        }
        return text;
    }
}
// Resource key for a world-attached HUD instance.
export const RESOURCE_DEBUG_HUD = 'loom.debug_hud';
//# sourceMappingURL=debug-hud.js.map