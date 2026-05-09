// TextScroll - typewriter text reveal with skip-on-click.
//
// 0.79.0 enabling primitive. Dialog boxes / lore text / cinematic
// captions all benefit from a typewriter-style reveal: characters
// appear one at a time, pauses linger on punctuation, the player
// can skip to the full text on click. TextScroll owns that
// state; consumers wire `visibleText()` into their renderer each
// frame and pipe input clicks to `skip()`.
//
//   var scroll = TextScroll.create({
//     charsPerSecond: 40,
//     punctPauseMs: { '.': 200, '!': 200, '?': 200, ',': 80 },
//     onChar: (ch) => audio.playClick(),
//     onComplete: () => hud.showAdvanceArrow(),
//   });
//   scroll.start('Hello, traveler. What brings you here?');
//   each frame: scroll.tick(dtMs); render(scroll.visibleText());
//   on click: scroll.isComplete() ? advance() : scroll.skip();
//
// Pairs with DialogTree (0.61) and DialogChoiceHistory (deferred).
//
// Code style: var-only in browser source.
const DEFAULT_RATE = 60;
const DEFAULT_PAUSES = {
    '.': 250, '!': 250, '?': 250, ',': 100, ';': 150, ':': 100,
};
export class TextScroll {
    text = '';
    chars = [];
    revealed = 0;
    msPerChar;
    accumulatorMs = 0;
    pauseRemainingMs = 0;
    punct;
    onChar;
    onComplete;
    completedFired = false;
    paused = false;
    disposed = false;
    constructor(opts) {
        var rate = opts.charsPerSecond !== undefined && isFinite(opts.charsPerSecond) && opts.charsPerSecond > 0
            ? opts.charsPerSecond : DEFAULT_RATE;
        this.msPerChar = 1000 / rate;
        this.punct = opts.punctPauseMs ?? DEFAULT_PAUSES;
        this.onChar = opts.onChar ?? null;
        this.onComplete = opts.onComplete ?? null;
    }
    static create(opts = {}) {
        return new TextScroll(opts);
    }
    // Start a new scroll. Replaces any in-progress text.
    start(text) {
        if (this.disposed)
            return;
        this.text = typeof text === 'string' ? text : '';
        // Split by Unicode codepoints (Array.from handles surrogate
        // pairs / emoji correctly).
        this.chars = Array.from(this.text);
        this.revealed = 0;
        this.accumulatorMs = 0;
        this.pauseRemainingMs = 0;
        this.completedFired = false;
        this.paused = false;
    }
    // Append more text to the current scroll without restarting.
    // Useful for streaming dialog from a slow source.
    append(text) {
        if (this.disposed)
            return;
        if (typeof text !== 'string' || text.length === 0)
            return;
        this.text += text;
        var more = Array.from(text);
        for (var i = 0; i < more.length; i++)
            this.chars.push(more[i]);
        // If we already fired complete, the new text means we are no
        // longer complete - reset that flag so onComplete fires again
        // when the new content finishes revealing.
        this.completedFired = false;
    }
    // Skip to fully revealed. Fires onComplete if not yet fired.
    skip() {
        if (this.disposed)
            return;
        if (this.revealed < this.chars.length) {
            this.revealed = this.chars.length;
        }
        this.fireCompleteIfDone();
    }
    pause() {
        if (this.disposed)
            return;
        this.paused = true;
    }
    resume() {
        if (this.disposed)
            return;
        this.paused = false;
    }
    clear() {
        if (this.disposed)
            return;
        this.text = '';
        this.chars = [];
        this.revealed = 0;
        this.accumulatorMs = 0;
        this.pauseRemainingMs = 0;
        this.completedFired = false;
        this.paused = false;
    }
    // Advance reveal by dt. No-op when paused, complete, or dt
    // invalid. Fires onChar per revealed char and onComplete when
    // done.
    tick(dtMs) {
        if (this.disposed)
            return;
        if (this.paused)
            return;
        if (this.revealed >= this.chars.length)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        // Burn off any active punctuation pause first.
        if (this.pauseRemainingMs > 0) {
            var consume = Math.min(dt, this.pauseRemainingMs);
            this.pauseRemainingMs -= consume;
            dt -= consume;
            if (dt <= 0)
                return;
        }
        this.accumulatorMs += dt;
        while (this.accumulatorMs >= this.msPerChar && this.revealed < this.chars.length) {
            this.accumulatorMs -= this.msPerChar;
            var ch = this.chars[this.revealed];
            this.revealed += 1;
            if (this.onChar) {
                try {
                    this.onChar(ch, this.revealed - 1);
                }
                catch { /* ignore */ }
            }
            // Apply punctuation pause AFTER the char is revealed (matches
            // typewriter convention - pause comes after the period, not
            // before it).
            var pause = this.punct[ch];
            if (pause !== undefined && pause > 0) {
                this.pauseRemainingMs = pause;
                // Drain any remaining accumulator into the pause too so we
                // stop until the pause clears.
                if (this.accumulatorMs > 0) {
                    this.pauseRemainingMs += 0; // explicit; accumulator stays
                }
                break;
            }
        }
        this.fireCompleteIfDone();
    }
    // The text revealed so far.
    visibleText() {
        if (this.revealed >= this.chars.length)
            return this.text;
        return this.chars.slice(0, this.revealed).join('');
    }
    // The full source text, regardless of progress.
    fullText() {
        return this.text;
    }
    isComplete() {
        return this.revealed >= this.chars.length;
    }
    isPaused() { return this.paused; }
    // Total chars revealed so far (1-based count).
    revealedCount() { return this.revealed; }
    // Total chars in full text.
    totalCount() { return this.chars.length; }
    setCharsPerSecond(rate) {
        if (this.disposed)
            return;
        if (!isFinite(rate) || rate <= 0)
            return;
        this.msPerChar = 1000 / rate;
    }
    dispose() {
        this.text = '';
        this.chars = [];
        this.onChar = null;
        this.onComplete = null;
        this.disposed = true;
    }
    // ---------- private ----------
    fireCompleteIfDone() {
        if (this.completedFired)
            return;
        if (this.revealed < this.chars.length)
            return;
        this.completedFired = true;
        if (this.onComplete) {
            try {
                this.onComplete();
            }
            catch { /* ignore */ }
        }
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_TEXT_SCROLL = 'text_scroll';
//# sourceMappingURL=text-scroll.js.map