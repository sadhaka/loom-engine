// DamageNumberPipeline - bridge from DamageFormula (0.66) to FloatingText (0.37).
//
// 0.72.0 enabling primitive. Most action / RPG consumers wire
// computeDamage + FloatingText.emit by hand at every attack site -
// same boilerplate, same color/scale rules, every time. The pipeline
// owns that wiring: pass attacker + defender + position, get back
// the DamageResult AND a styled floating-text spawn dispatched
// automatically.
//
//   var pipeline = DamageNumberPipeline.create({
//     floatingText: floatingTextResource,
//     style: {
//       normalColor: 0xffffff,
//       critColor: 0xffd560,
//       blockedColor: 0x808080,
//       critScale: 1.4,
//       lifetimeMs: 900,
//     },
//   });
//   var hit = pipeline.publish(attacker, defender, target.x, target.y);
//   target.hp -= hit.final;
//
// The pipeline never iterates the FloatingText pool - it only emits.
// The consumer's HUD render loop pulls active texts via
// FloatingText.forEach(...). On a full pool the publish call still
// computes damage and returns the result; only the spawn step is
// dropped.
//
// Pairs with DamageFormula (0.66) and FloatingText (0.37).
//
// Code style: var-only in browser source.
import { computeDamage } from './damage-formula.js';
const DEFAULT_NORMAL_COLOR = 0xffffff;
const DEFAULT_CRIT_COLOR = 0xffd560;
const DEFAULT_BLOCKED_COLOR = 0x808080;
const DEFAULT_NORMAL_SCALE = 1;
const DEFAULT_CRIT_SCALE = 1.4;
const DEFAULT_CRIT_SUFFIX = '!';
export class DamageNumberPipeline {
    floatingText;
    compute;
    style;
    formatText;
    blockedAtOrBelow;
    userProvidedFormat;
    disposed = false;
    constructor(opts) {
        this.floatingText = opts.floatingText;
        this.compute = opts.compute ?? computeDamage;
        this.style = resolveStyle(opts.style);
        this.userProvidedFormat = opts.formatText !== undefined;
        this.formatText = opts.formatText ?? makeDefaultFormat(this.style);
        this.blockedAtOrBelow = opts.blockedAtOrBelow !== undefined && isFinite(opts.blockedAtOrBelow)
            ? opts.blockedAtOrBelow : 0;
    }
    static create(opts) {
        return new DamageNumberPipeline(opts);
    }
    // Compute damage, spawn a styled floating text at (x, y), and
    // return the result. Returns a DamageResult either way (even when
    // the floating-text pool is full).
    publish(attacker, defender, x, y, opts) {
        var result = this.compute(attacker, defender, opts);
        if (!this.disposed) {
            this.spawn(result, x, y);
        }
        return result;
    }
    // Spawn from an already-computed result (e.g. caller computed
    // damage independently to feed multiple side effects).
    publishResult(result, x, y) {
        if (this.disposed)
            return;
        this.spawn(result, x, y);
    }
    setStyle(style) {
        if (this.disposed)
            return;
        this.style = resolveStyle(style);
        // If the user did NOT provide a custom formatText, refresh the
        // default closure so it picks up the new critSuffix.
        if (!this.userProvidedFormat) {
            this.formatText = makeDefaultFormat(this.style);
        }
    }
    getStyle() {
        var out = {
            normalColor: this.style.normalColor,
            critColor: this.style.critColor,
            blockedColor: this.style.blockedColor,
            normalScale: this.style.normalScale,
            critScale: this.style.critScale,
            critSuffix: this.style.critSuffix,
        };
        if (this.style.lifetimeMs !== undefined)
            out.lifetimeMs = this.style.lifetimeMs;
        return out;
    }
    dispose() {
        this.disposed = true;
    }
    // ---------- private ----------
    spawn(result, x, y) {
        var isCrit = !!result.isCrit;
        var blocked = result.final <= this.blockedAtOrBelow;
        var color;
        var scale;
        if (blocked) {
            color = this.style.blockedColor;
            scale = this.style.normalScale;
        }
        else if (isCrit) {
            color = this.style.critColor;
            scale = this.style.critScale;
        }
        else {
            color = this.style.normalColor;
            scale = this.style.normalScale;
        }
        var spawn = {
            x: x,
            y: y,
            text: this.formatText(result),
            color: color,
            scale: scale,
        };
        if (this.style.lifetimeMs !== undefined) {
            spawn.lifetimeMs = this.style.lifetimeMs;
        }
        this.floatingText.emit(spawn);
    }
}
function resolveStyle(style) {
    return {
        normalColor: style && style.normalColor !== undefined ? style.normalColor : DEFAULT_NORMAL_COLOR,
        critColor: style && style.critColor !== undefined ? style.critColor : DEFAULT_CRIT_COLOR,
        blockedColor: style && style.blockedColor !== undefined ? style.blockedColor : DEFAULT_BLOCKED_COLOR,
        normalScale: style && style.normalScale !== undefined && style.normalScale > 0
            ? style.normalScale : DEFAULT_NORMAL_SCALE,
        critScale: style && style.critScale !== undefined && style.critScale > 0
            ? style.critScale : DEFAULT_CRIT_SCALE,
        lifetimeMs: style && style.lifetimeMs !== undefined && style.lifetimeMs > 0
            ? style.lifetimeMs : undefined,
        critSuffix: style && style.critSuffix !== undefined ? style.critSuffix : DEFAULT_CRIT_SUFFIX,
    };
}
function makeDefaultFormat(style) {
    return function (result) {
        var n = Math.round(result.final);
        if (!isFinite(n) || n < 0)
            n = 0;
        return result.isCrit ? (n.toString() + style.critSuffix) : n.toString();
    };
}
// Resource key for the world's resource registry.
export const RESOURCE_DAMAGE_NUMBER_PIPELINE = 'damage_number_pipeline';
//# sourceMappingURL=damage-number-pipeline.js.map