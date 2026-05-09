// ScreenShake - camera trauma model.
//
// 0.92.0 enabling primitive. The standard "trauma" approach
// (Squirrel Eiserloh / Brackeys): a single scalar t in [0, 1]
// represents the SHAKE STATE; the per-frame offset is
//
//   offset.x = (rng() * 2 - 1) * maxOffsetPx * trauma^2
//   offset.y = (rng() * 2 - 1) * maxOffsetPx * trauma^2
//   angle   = (rng() * 2 - 1) * maxAngleRad * trauma^2
//
// Quadratic dampening (trauma^2) means low-trauma jitter is barely
// visible while high-trauma feels punchy. Trauma decays linearly
// per second; consumers add trauma on impact events (boss hit,
// player damage, environment break) and the camera settles
// automatically once those stop.
//
//   var shake = ScreenShake.create({
//     decayPerSecond: 1.5,
//     maxOffsetPx: 16,
//   });
//   on hit:        shake.addTrauma(0.4);
//   each frame:    shake.tick(dtMs);
//                  var off = shake.getOffset();
//                  cam.x = baseX + off.x; cam.y = baseY + off.y;
//
// Pairs with CameraController (0.27) for the camera math; consumers
// add the offset/angle to the controller's centerX/Y/rotation.
//
// Code style: var-only in browser source.
const DEFAULT_DECAY_PER_SECOND = 1.5;
const DEFAULT_MAX_OFFSET_PX = 16;
const DEFAULT_MAX_ANGLE_RAD = 0.05;
export class ScreenShake {
    trauma = 0;
    decayPerSecond;
    maxOffsetPx;
    maxAngleRad;
    rng;
    disposed = false;
    constructor(opts) {
        this.decayPerSecond = opts.decayPerSecond !== undefined
            && isFinite(opts.decayPerSecond) && opts.decayPerSecond >= 0
            ? opts.decayPerSecond : DEFAULT_DECAY_PER_SECOND;
        this.maxOffsetPx = opts.maxOffsetPx !== undefined
            && isFinite(opts.maxOffsetPx) && opts.maxOffsetPx >= 0
            ? opts.maxOffsetPx : DEFAULT_MAX_OFFSET_PX;
        this.maxAngleRad = opts.maxAngleRad !== undefined
            && isFinite(opts.maxAngleRad) && opts.maxAngleRad >= 0
            ? opts.maxAngleRad : DEFAULT_MAX_ANGLE_RAD;
        this.rng = opts.rng ?? Math.random;
    }
    static create(opts = {}) {
        return new ScreenShake(opts);
    }
    // Add to current trauma. Clamps to [0, 1]. Negative values
    // reduce trauma (rare but supported for "absorb shake" mechanics).
    addTrauma(amount) {
        if (this.disposed)
            return;
        if (!isFinite(amount) || amount === 0)
            return;
        var t = this.trauma + amount;
        if (t < 0)
            t = 0;
        if (t > 1)
            t = 1;
        this.trauma = t;
    }
    setTrauma(value) {
        if (this.disposed)
            return;
        if (!isFinite(value))
            return;
        var v = value;
        if (v < 0)
            v = 0;
        if (v > 1)
            v = 1;
        this.trauma = v;
    }
    getTrauma() { return this.trauma; }
    // Per-frame offset. Quadratic dampening so low-trauma is barely
    // visible. Each call samples the RNG twice (x, y) and once for
    // angle. Caller is responsible for applying the offset to camera.
    getOffset() {
        if (this.trauma <= 0) {
            return { x: 0, y: 0, angle: 0 };
        }
        var t2 = this.trauma * this.trauma;
        return {
            x: (this.rng() * 2 - 1) * this.maxOffsetPx * t2,
            y: (this.rng() * 2 - 1) * this.maxOffsetPx * t2,
            angle: (this.rng() * 2 - 1) * this.maxAngleRad * t2,
        };
    }
    // Advance trauma decay by dt. Trauma decays linearly per second
    // until it hits 0.
    tick(dtMs) {
        if (this.disposed)
            return;
        if (this.trauma <= 0)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        var decay = this.decayPerSecond * (dt / 1000);
        var next = this.trauma - decay;
        if (next < 0)
            next = 0;
        this.trauma = next;
    }
    isShaking() { return this.trauma > 0; }
    setMaxOffset(px) {
        if (this.disposed)
            return;
        if (!isFinite(px) || px < 0)
            return;
        this.maxOffsetPx = px;
    }
    setDecayPerSecond(rate) {
        if (this.disposed)
            return;
        if (!isFinite(rate) || rate < 0)
            return;
        this.decayPerSecond = rate;
    }
    setMaxAngleRad(rad) {
        if (this.disposed)
            return;
        if (!isFinite(rad) || rad < 0)
            return;
        this.maxAngleRad = rad;
    }
    // Snap trauma back to 0 (e.g. on scene transition).
    reset() {
        if (this.disposed)
            return;
        this.trauma = 0;
    }
    dispose() {
        this.trauma = 0;
        this.disposed = true;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_SCREEN_SHAKE = 'screen_shake';
//# sourceMappingURL=screen-shake.js.map