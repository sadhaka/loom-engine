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
import { growF32, growU8, nextPow2, tightenHighWaterMark } from '../util/typed-arrays.js';
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
    // Lower highWaterMark past trailing stopped slots. play() sets the
    // ACTIVE flag, stop() zeros the flags byte, so a zero flags byte
    // marks a slot with no animation.
    tighten() {
        this.highWaterMark = tightenHighWaterMark(this.flags, this.highWaterMark);
    }
    // --- ISnapshotable: the hot elapsedMs column, the clipName string
    // column, and flags - all [0, highWaterMark). ---
    //
    // The manifest column is deliberately NOT in the snapshot. It is a
    // runtime ref to static, asset-loaded data, and excluding it is
    // correct for both jobs the snapshot does:
    //
    //   - Determinism hash: manifest is only ever written next to
    //     clipName - play() sets both, stop() clears both - so a pool
    //     can never differ in manifest without also differing in
    //     clipName or flags. The three serialized columns already
    //     witness every reachable divergence.
    //   - Restore: the pool has no name -> SpriteSheetManifest
    //     registry, so restoreFrom cannot rebind the object; it leaves
    //     manifest[i] null. AnimationSystem already skips an ACTIVE
    //     slot whose manifest is null, so a restored pool is safe to
    //     tick - it just will not advance until a layer that owns the
    //     asset registry rebinds the manifests.
    snapshotKey = 'loom.animation-state-pool';
    snapshotInto(w) {
        const n = this.highWaterMark;
        w.writeU32(n);
        w.writeF32Slice(this.elapsedMs, n);
        // clipName is a plain array with no self-describing slice writer,
        // so n (written above) is its element count.
        for (let i = 0; i < n; i++)
            w.writeString(this.clipName[i] ?? '');
        w.writeU8Slice(this.flags, n);
    }
    restoreFrom(r) {
        const n = r.readU32();
        this.elapsedMs = r.readF32Slice();
        this.clipName = new Array(n);
        for (let i = 0; i < n; i++)
            this.clipName[i] = r.readString();
        this.flags = r.readU8Slice();
        // manifest is not in the snapshot (see above): a restored pool
        // has null manifests until a higher layer rebinds them.
        this.manifest = new Array(n).fill(null);
        // Match TransformPool: a restored pool is exactly-sized, capacity
        // == highWaterMark, growing via nextPow2 on the next play().
        this.capacity = n;
        this.highWaterMark = n;
    }
}
//# sourceMappingURL=animation-state-pool.js.map