// AnimationStatePool - per-entity animation state.
//
// Companion to TransformPool + SpritePool. An entity that has
// AnimationState gets its sprite frame advanced by AnimationSystem
// each tick.
//
// State per entity:
//   - manifest: which sheet's clips[] to look in
//   - clipName: which named clip is currently playing
//   - elapsedMs: time since the clip started, monotonically advanced
//                by AnimationSystem
//   - flags: ACTIVE, FINISHED (non-looping clip past its duration)
//
// elapsedMs is hot data - a Float32Array indexed by entity index.
// manifest + clipName are cold (per-entity object refs / strings),
// in plain arrays.
import { entityIndex } from '../entity.js';
import { growF32, growU8, nextPow2 } from '../util/typed-arrays.js';
export const ANIMATION_FLAG_ACTIVE = 1 << 0;
export const ANIMATION_FLAG_FINISHED = 1 << 1;
export class AnimationStatePool {
    // Hot data
    elapsedMs;
    // Cold data - per-entity object/string refs
    manifest;
    clipName;
    // Bitflags
    flags;
    highWaterMark = 0;
    capacity = 0;
    constructor(initialCapacity = 64) {
        this.capacity = nextPow2(initialCapacity);
        this.elapsedMs = new Float32Array(this.capacity);
        this.manifest = new Array(this.capacity).fill(null);
        this.clipName = new Array(this.capacity).fill('');
        this.flags = new Uint8Array(this.capacity);
    }
    ensureCapacity(neededIndex) {
        if (neededIndex < this.capacity)
            return;
        const next = nextPow2(neededIndex + 1);
        this.elapsedMs = growF32(this.elapsedMs, next);
        // Plain JS arrays don't have a "grow" helper; just resize.
        this.manifest.length = next;
        this.clipName.length = next;
        for (let i = this.capacity; i < next; i++) {
            this.manifest[i] = null;
            this.clipName[i] = '';
        }
        this.flags = growU8(this.flags, next);
        this.capacity = next;
    }
    // Start a clip on an entity. Resets elapsedMs to 0 so the clip
    // plays from frame 0 (or the user-supplied startMs offset).
    play(e, manifest, clipName, options = {}) {
        const i = entityIndex(e);
        this.ensureCapacity(i);
        this.manifest[i] = manifest;
        this.clipName[i] = clipName;
        this.elapsedMs[i] = options.startMs ?? 0;
        this.flags[i] = ANIMATION_FLAG_ACTIVE;
        if (i >= this.highWaterMark)
            this.highWaterMark = i + 1;
    }
    // Stop animation on an entity. Frame stays where it was; the
    // sprite-render system continues drawing whatever frame the
    // SpritePool currently holds.
    stop(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return;
        this.flags[i] = 0;
        this.manifest[i] = null;
        this.clipName[i] = '';
    }
    // True if the entity has an ACTIVE animation right now.
    isActive(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return false;
        return ((this.flags[i] ?? 0) & ANIMATION_FLAG_ACTIVE) !== 0;
    }
    // True if the entity's last clip was non-looping and ran out.
    // Cleared by play(); systems can poll this to chain transitions
    // (e.g. attack -> idle).
    isFinished(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return false;
        return ((this.flags[i] ?? 0) & ANIMATION_FLAG_FINISHED) !== 0;
    }
    // The active clip name. Empty string when no clip is playing.
    getClipName(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return '';
        return this.clipName[i] ?? '';
    }
    // The active manifest. Null when no clip is playing.
    getManifest(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return null;
        return this.manifest[i] ?? null;
    }
    getHighWaterMark() {
        return this.highWaterMark;
    }
    getCapacity() {
        return this.capacity;
    }
}
//# sourceMappingURL=animation-state-pool.js.map