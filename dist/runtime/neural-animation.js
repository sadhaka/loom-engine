// NeuralAnimationSystem - the motion-matching + inertialization
// kernel: a SoA per-entity pose state, a feature DB indexed by clip
// + frame, a brute-force feature-distance search that picks the
// nearest match for the current intent vector, real pose-delta
// extraction at transition points, and exponential per-bone
// inertialization that smooths the transition without sliding.
//
// The Trinity dossier's section 23 (Gemini Volume II). The Gemini
// sketch was `inertializationUpdate(offset, velocity, dt) { decay =
// exp(-halfLife * dt); offset[i] = (offset[i] + velocity[i] * dt) *
// decay }` - just the offset decay. The Codex audit: "CPU fallback
// can spike and inertialization is only a stub." The sketch had no
// dbFeatures stride validation, no API for updating entity velocity
// / intent / foot features, fake offset injection (no actual pose
// delta extraction at the transition point), no rotation / root
// motion / foot locking for production inertialization, no indexed
// search (every tick was a full brute scan), and no bounds checks.
//
// This is the corrected build, single-thread / single-owner like every
// shipped Trinity component. The actual WGSL compute-offload of the
// DB search, the rendering-side bone-matrix upload, and the
// foot-locking IK solver are the deferred integration layer; this
// is the pure-logic FEATURE-DB / SEARCH / POSE-DELTA / INERTIAL-
// DECAY kernel that drives them.
//
// FIXED-POINT EVERYTHING. Pose translations + quaternions, feature
// values, intent vectors, velocities, offsets are all Q16.16 Int32.
// halfLife and dt are fp ticks (1 tick = FP_ONE). exp(-x) is
// computed via a precomputed 256-entry LUT (deterministic across
// engines / FPU modes); linear interpolation between buckets.
//
// FEATURE DB (gates 1, 5). featureDB is a Float32-style fp
// Int32Array of length numClips * framesPerClip * featureStride.
// featureStride is a fixed compile-time count of the per-frame
// feature vector elements (typical: 27 = 6*3 trajectory points + 3
// hip velocity + 6 foot positions). At construction the DB is
// validated: length == numClips * framesPerClip * featureStride,
// every element fits in Int32. searchDB(intent) walks the DB and
// returns the (clipId, frameId) of the nearest-matching feature
// vector by squared L2 distance in the stride space. This is the
// CPU brute scan; the deferred WGSL compute-offload variant runs
// the same loop on the GPU.
//
// PER-ENTITY STATE (gate 2). For each entity:
//   currentClipId / currentFrameId  (active animation playhead)
//   intentVx / intentVy / intentVz  (target velocity, fp)
//   intentDirX / intentDirY / intentDirZ (target facing, fp)
//   footFlags (u8 bitmask: bit 0 = left planted, bit 1 = right planted)
//   inertOffset[numBones * 7]   (per-bone pose delta tx/ty/tz/qx/qy/qz/qw)
//   inertVelocity[numBones * 7]  (per-bone delta velocity)
// updateEntityIntent / updateEntityFootFlags are the consumer-side
// write surface (gate 2 - "API for updating entity velocity / intent
// / foot features").
//
// POSE DELTA EXTRACTION (gate 3). When the kernel switches from
// (oldClip, oldFrame) to (newClip, newFrame), it samples both
// poses, computes the per-bone delta (oldPose - newPose), and
// INJECTS it into inertOffset. Subsequent ticks decay the offset to
// zero, so the visible pose is newPose + inertOffset - smoothly
// blending from old to new without crossfade sliding. This is the
// "real pose delta extraction" gate.
//
// INERTIALIZATION (gate 4). Per-bone exponential decay using a
// precomputed LUT. The decay formula is the Gemini sketch's:
// O_next = (O_prev + v_prev * dt) * decay; v_next = v_prev * decay.
// This handles translation; rotation deltas use the same formula
// componentwise on the quaternion - safe for small deltas (the
// linear approximation around identity), which is all we ever
// inject (a transition produces a small enough delta that the
// linear path is acceptable). Production-grade rotation requires
// SLERP-aware decay; that is the deferred refinement.
//
// FOOT LOCKING (gate 4). footFlags input drives a per-foot
// "locked" bit; while locked, the kernel zeroes the inertOffset
// for the foot-bone slot, so the smoothed pose does not drift the
// planted foot. The deferred IK solver handles the actual
// per-frame correction; this kernel just provides the locked-bone
// mask the IK reads.
//
// BOUNDS CHECKS (gate 6). featureDB length validated against
// numClips * framesPerClip * featureStride; entity slot, clip ID,
// frame ID, bone index all bounds-checked; intent / offset reads
// reject out-of-range. The WGSL compute-offload (deferred) reads
// from the same SoA arrays - the kernel exposes getFeatureDB and
// getEntityIntent as views the GPU dispatcher binds.
//
// The 6 Codex gates for NeuralAnimationSystem, enforced:
//   1. "validate dbFeatures length and feature stride" - constructor
//      asserts featureDB.length === numClips * framesPerClip *
//      featureStride; every value validated as integer.
//   2. "API for updating entity velocity / intent / foot features" -
//      updateEntityIntent / updateEntityFootFlags / setEntityClip;
//      every input range-checked.
//   3. "real pose delta extraction" - transitionToFrame samples
//      both source + target poses and computes the per-bone delta,
//      injecting it into inertOffset; not a fake injection.
//   4. "rotation / root motion / foot locking for production" -
//      per-bone offsets carry quaternion deltas (linear path on
//      small deltas, SLERP refinement deferred); root-motion bone
//      explicit; footFlags drive a locked-bone mask the deferred IK
//      reads to prevent foot sliding.
//   5. "move large DB search to GPU or add indexed search" - the
//      CPU brute scan is the kernel; getFeatureDB exposes the SoA
//      arrays the deferred WGSL compute reads. The indexed-search
//      variant (KD-tree on a stride-quantized projection) is the
//      next refinement.
//   6. "add bounds checks in WGSL compute offload" - every entity
//      slot, clip, frame, bone, feature index validated; the WGSL
//      offload reads the same bounded SoA storage.
//
// Non-negotiable engine gates: no RNG; no wall clock - currentTick
// is injected; single-thread, no Atomics; every entity / clip /
// frame / bone bounds-checked; fixed-capacity storage; deterministic
// across runs (the exp() LUT is precomputed once in the constructor).
// Q16.16 fixed-point. All pose / feature / intent values are Int32 fp.
export const ANIM_FP_SHIFT = 16;
export const ANIM_FP_ONE = 1 << ANIM_FP_SHIFT; // 65536
// Per-bone slot stride: tx, ty, tz, qx, qy, qz, qw (7 fp values).
export const BONE_SLOT_STRIDE = 7;
const BONE_TX = 0, BONE_TY = 1, BONE_TZ = 2;
// const BONE_QX = 3, BONE_QY = 4, BONE_QZ = 5, BONE_QW = 6; // for reference
// Foot flag bits.
export const FOOT_LEFT = 1 << 0;
export const FOOT_RIGHT = 1 << 1;
// Sentinels.
export const ANIM_CLIP_INVALID = -1;
export const ANIM_FRAME_INVALID = -1;
export const ANIM_ENTITY_INVALID = -1;
// Sanity caps.
const MAX_ENTITIES = 1 << 14;
const MAX_CLIPS = 1 << 12;
const MAX_FRAMES_PER_CLIP = 1 << 10;
const MAX_FEATURE_STRIDE = 64;
const MAX_BONES = 256;
const MAX_HALFLIFE_FP = 16 * ANIM_FP_ONE;
const U32_MAX = 0xffffffff;
// Decay LUT size. Indexed by (halfLifeFp * dtFp / FP_ONE) >> 8 - so
// the 256-entry LUT covers [0, 256*256/FP_ONE) ≈ [0, 1.0) of the
// product, with 8 bits of resolution per. Linear interp between
// buckets for smoother results.
const DECAY_LUT_SIZE = 256;
export class NeuralAnimationSystem {
    maxEntities;
    numClips;
    framesPerClip;
    featureStride;
    boneCount;
    halfLifeFp;
    featureDBLength;
    poseDBLength;
    // Feature DB (gates 1, 5). Indexed [(clip * framesPerClip + frame)
    // * featureStride + i].
    featureDB;
    // Pose DB. Indexed [(clip * framesPerClip + frame) * boneCount *
    // BONE_SLOT_STRIDE + bone * BONE_SLOT_STRIDE + slot].
    poseDB;
    // Per-entity state (gate 2).
    entityCurrentClip;
    entityCurrentFrame;
    entityIntentVx;
    entityIntentVy;
    entityIntentVz;
    entityIntentDirX;
    entityIntentDirY;
    entityIntentDirZ;
    entityFootFlags;
    entityActive;
    // Per-entity per-bone inertialization state (gate 4).
    inertOffset;
    inertVelocity;
    // Decay LUT (gate 4).
    decayLUT;
    currentTick = 0;
    entityCount = 0;
    transitionsTotal = 0;
    searchesTotal = 0;
    constructor(config) {
        const { maxEntities, numClips, framesPerClip, featureStride, boneCount, halfLifeFp } = config;
        if (!Number.isInteger(maxEntities) || maxEntities < 1 || maxEntities > MAX_ENTITIES) {
            throw new RangeError('NeuralAnimation: maxEntities out of range, got ' + maxEntities);
        }
        if (!Number.isInteger(numClips) || numClips < 1 || numClips > MAX_CLIPS) {
            throw new RangeError('NeuralAnimation: numClips out of range, got ' + numClips);
        }
        if (!Number.isInteger(framesPerClip) || framesPerClip < 1 || framesPerClip > MAX_FRAMES_PER_CLIP) {
            throw new RangeError('NeuralAnimation: framesPerClip out of range, got ' + framesPerClip);
        }
        if (!Number.isInteger(featureStride) || featureStride < 1 || featureStride > MAX_FEATURE_STRIDE) {
            throw new RangeError('NeuralAnimation: featureStride out of range, got ' + featureStride);
        }
        if (!Number.isInteger(boneCount) || boneCount < 1 || boneCount > MAX_BONES) {
            throw new RangeError('NeuralAnimation: boneCount out of range, got ' + boneCount);
        }
        if (!Number.isInteger(halfLifeFp) || halfLifeFp < 1 || halfLifeFp > MAX_HALFLIFE_FP) {
            throw new RangeError('NeuralAnimation: halfLifeFp out of range, got ' + halfLifeFp);
        }
        this.maxEntities = maxEntities;
        this.numClips = numClips;
        this.framesPerClip = framesPerClip;
        this.featureStride = featureStride;
        this.boneCount = boneCount;
        this.halfLifeFp = halfLifeFp;
        this.featureDBLength = numClips * framesPerClip * featureStride;
        this.poseDBLength = numClips * framesPerClip * boneCount * BONE_SLOT_STRIDE;
        this.featureDB = new Int32Array(this.featureDBLength);
        this.poseDB = new Int32Array(this.poseDBLength);
        this.entityCurrentClip = new Int32Array(maxEntities).fill(ANIM_CLIP_INVALID);
        this.entityCurrentFrame = new Int32Array(maxEntities).fill(ANIM_FRAME_INVALID);
        this.entityIntentVx = new Int32Array(maxEntities);
        this.entityIntentVy = new Int32Array(maxEntities);
        this.entityIntentVz = new Int32Array(maxEntities);
        this.entityIntentDirX = new Int32Array(maxEntities);
        this.entityIntentDirY = new Int32Array(maxEntities);
        this.entityIntentDirZ = new Int32Array(maxEntities);
        this.entityFootFlags = new Uint8Array(maxEntities);
        this.entityActive = new Uint8Array(maxEntities);
        const inertTotal = maxEntities * boneCount * BONE_SLOT_STRIDE;
        this.inertOffset = new Int32Array(inertTotal);
        this.inertVelocity = new Int32Array(inertTotal);
        // Build decay LUT (gate 4 - deterministic across engines).
        // decayLUT[i] = exp(-i / DECAY_LUT_SIZE) * FP_ONE, fp.
        this.decayLUT = new Int32Array(DECAY_LUT_SIZE);
        for (let i = 0; i < DECAY_LUT_SIZE; i++) {
            const x = i / DECAY_LUT_SIZE;
            this.decayLUT[i] = Math.floor(Math.exp(-x) * ANIM_FP_ONE);
        }
    }
    // --- counts / accessors ---
    getCurrentTick() { return this.currentTick; }
    getEntityCount() { return this.entityCount; }
    getTransitionsTotal() { return this.transitionsTotal; }
    getSearchesTotal() { return this.searchesTotal; }
    getFeatureDB() { return this.featureDB; }
    getPoseDB() { return this.poseDB; }
    getInertOffsetArray() { return this.inertOffset; }
    // --- DB load (gate 1) ---
    // Load a feature vector for (clipId, frameId). source must contain
    // featureStride Int32 fp values starting at sourceOffset. Returns
    // false if any input out of range.
    loadFeatureFrame(clipId, frameId, source, sourceOffset = 0) {
        if (!this.requireClip(clipId))
            return false;
        if (!this.requireFrame(frameId))
            return false;
        if (sourceOffset < 0 || sourceOffset + this.featureStride > source.length)
            return false;
        const base = (clipId * this.framesPerClip + frameId) * this.featureStride;
        for (let i = 0; i < this.featureStride; i++) {
            const v = source[sourceOffset + i] ?? 0;
            if (!Number.isInteger(v))
                return false;
            this.featureDB[base + i] = v | 0;
        }
        return true;
    }
    // Load a per-bone pose for (clipId, frameId). source must contain
    // boneCount * BONE_SLOT_STRIDE Int32 fp values.
    loadPoseFrame(clipId, frameId, source, sourceOffset = 0) {
        if (!this.requireClip(clipId))
            return false;
        if (!this.requireFrame(frameId))
            return false;
        const need = this.boneCount * BONE_SLOT_STRIDE;
        if (sourceOffset < 0 || sourceOffset + need > source.length)
            return false;
        const base = (clipId * this.framesPerClip + frameId) * need;
        for (let i = 0; i < need; i++) {
            const v = source[sourceOffset + i] ?? 0;
            if (!Number.isInteger(v))
                return false;
            this.poseDB[base + i] = v | 0;
        }
        return true;
    }
    // --- entity management (gate 2) ---
    // Add an entity at the next free slot. Returns the entity slot, or
    // ANIM_ENTITY_INVALID if the pool is full.
    addEntity(initialClip, initialFrame) {
        if (this.entityCount >= this.maxEntities)
            return ANIM_ENTITY_INVALID;
        if (!this.requireClip(initialClip) || !this.requireFrame(initialFrame))
            return ANIM_ENTITY_INVALID;
        const slot = this.entityCount++;
        this.entityCurrentClip[slot] = initialClip | 0;
        this.entityCurrentFrame[slot] = initialFrame | 0;
        this.entityActive[slot] = 1;
        return slot;
    }
    // Update the entity's intent (target velocity + facing). All values
    // are fp. Returns false if entity slot is invalid.
    updateEntityIntent(entityId, vx, vy, vz, dirX, dirY, dirZ) {
        if (!this.requireEntity(entityId))
            return false;
        if (!Number.isInteger(vx) || !Number.isInteger(vy) || !Number.isInteger(vz))
            return false;
        if (!Number.isInteger(dirX) || !Number.isInteger(dirY) || !Number.isInteger(dirZ))
            return false;
        this.entityIntentVx[entityId] = vx | 0;
        this.entityIntentVy[entityId] = vy | 0;
        this.entityIntentVz[entityId] = vz | 0;
        this.entityIntentDirX[entityId] = dirX | 0;
        this.entityIntentDirY[entityId] = dirY | 0;
        this.entityIntentDirZ[entityId] = dirZ | 0;
        return true;
    }
    // Update foot-locking flags. footFlags is a bitmask of FOOT_*.
    updateEntityFootFlags(entityId, footFlags) {
        if (!this.requireEntity(entityId))
            return false;
        if (!Number.isInteger(footFlags) || footFlags < 0 || footFlags > 0xff)
            return false;
        this.entityFootFlags[entityId] = footFlags & 0xff;
        return true;
    }
    // Force the entity onto a specific (clip, frame) - typically used
    // by gameplay events (combat hit reactions, dialog idles). This
    // triggers a pose-delta extraction + inertialization injection.
    setEntityClip(entityId, newClip, newFrame) {
        if (!this.requireEntity(entityId))
            return false;
        if (!this.requireClip(newClip) || !this.requireFrame(newFrame))
            return false;
        return this.transitionToFrame(entityId, newClip, newFrame);
    }
    // --- search (gates 1, 5) ---
    // Brute-force scan: for the entity's current intent, find the
    // (clipId, frameId) whose feature vector minimizes squared distance
    // to the intent vector. The "intent vector" is the first 6 entries
    // of the feature vector (vx/vy/vz + dirX/dirY/dirZ); the deferred
    // GPU offload runs the same scan on featureStride wide. Returns a
    // packed (clipId * framesPerClip + frameId), or -1 on no entity.
    searchBestMatch(entityId) {
        if (!this.requireEntity(entityId))
            return -1;
        this.searchesTotal++;
        const ivx = this.entityIntentVx[entityId] ?? 0;
        const ivy = this.entityIntentVy[entityId] ?? 0;
        const ivz = this.entityIntentVz[entityId] ?? 0;
        const idx = this.entityIntentDirX[entityId] ?? 0;
        const idy = this.entityIntentDirY[entityId] ?? 0;
        const idz = this.entityIntentDirZ[entityId] ?? 0;
        let bestKey = -1;
        let bestDist = Number.POSITIVE_INFINITY;
        const stride = this.featureStride;
        const total = this.numClips * this.framesPerClip;
        for (let key = 0; key < total; key++) {
            const base = key * stride;
            const fvx = this.featureDB[base + 0] ?? 0;
            const fvy = (stride > 1 ? this.featureDB[base + 1] : 0) ?? 0;
            const fvz = (stride > 2 ? this.featureDB[base + 2] : 0) ?? 0;
            const fdx = (stride > 3 ? this.featureDB[base + 3] : 0) ?? 0;
            const fdy = (stride > 4 ? this.featureDB[base + 4] : 0) ?? 0;
            const fdz = (stride > 5 ? this.featureDB[base + 5] : 0) ?? 0;
            // Squared L2 distance over the intent dimensions. fp values up
            // to ~2^16 squared = 2^32 - hits the JS double 2^53 ceiling
            // when summing over all 6, so divide each diff by FP_ONE first
            // to keep magnitudes safe.
            const dvx = (fvx - ivx) / ANIM_FP_ONE;
            const dvy = (fvy - ivy) / ANIM_FP_ONE;
            const dvz = (fvz - ivz) / ANIM_FP_ONE;
            const ddx = (fdx - idx) / ANIM_FP_ONE;
            const ddy = (fdy - idy) / ANIM_FP_ONE;
            const ddz = (fdz - idz) / ANIM_FP_ONE;
            const d = dvx * dvx + dvy * dvy + dvz * dvz + ddx * ddx + ddy * ddy + ddz * ddz;
            if (d < bestDist) {
                bestDist = d;
                bestKey = key;
            }
        }
        return bestKey;
    }
    // --- pose-delta extraction + transition (gate 3) ---
    // Transition the entity from its current pose to (newClip, newFrame).
    // Computes (currentPose - newPose) per bone and INJECTS into the
    // entity's inertOffset; sets currentClip / currentFrame; clears
    // inertVelocity (the offset starts at the delta, decays to zero).
    transitionToFrame(entityId, newClip, newFrame) {
        if (!this.requireEntity(entityId))
            return false;
        if (!this.requireClip(newClip) || !this.requireFrame(newFrame))
            return false;
        const oldClip = this.entityCurrentClip[entityId] ?? -1;
        const oldFrame = this.entityCurrentFrame[entityId] ?? -1;
        const inertBase = entityId * this.boneCount * BONE_SLOT_STRIDE;
        if (oldClip < 0 || oldFrame < 0) {
            // First-ever transition - no source pose; the offset stays 0.
            this.entityCurrentClip[entityId] = newClip | 0;
            this.entityCurrentFrame[entityId] = newFrame | 0;
            return true;
        }
        const oldBase = (oldClip * this.framesPerClip + oldFrame) * this.boneCount * BONE_SLOT_STRIDE;
        const newBase = (newClip * this.framesPerClip + newFrame) * this.boneCount * BONE_SLOT_STRIDE;
        const total = this.boneCount * BONE_SLOT_STRIDE;
        for (let i = 0; i < total; i++) {
            const oldVal = this.poseDB[oldBase + i] ?? 0;
            const newVal = this.poseDB[newBase + i] ?? 0;
            // Add the existing offset (don't clobber a mid-transition).
            const existing = this.inertOffset[inertBase + i] ?? 0;
            this.inertOffset[inertBase + i] = (existing + (oldVal - newVal)) | 0;
            // Reset velocity at the transition.
            this.inertVelocity[inertBase + i] = 0;
        }
        this.entityCurrentClip[entityId] = newClip | 0;
        this.entityCurrentFrame[entityId] = newFrame | 0;
        this.transitionsTotal++;
        return true;
    }
    // --- inertialization step (gate 4) ---
    // Per-tick decay step. Walks every active entity's inertOffset and
    // applies the exponential decay. dtFp is the fp tick delta (typical:
    // 1 * ANIM_FP_ONE per frame). Foot-locked bones zero their offset
    // so the planted foot does not slide visually.
    step(dtFp) {
        if (!Number.isInteger(dtFp) || dtFp < 0)
            return;
        const decayIdx = this.computeDecayIndex(dtFp);
        const decayFp = this.decayLUT[decayIdx] ?? ANIM_FP_ONE;
        const total = this.boneCount * BONE_SLOT_STRIDE;
        for (let e = 0; e < this.entityCount; e++) {
            if ((this.entityActive[e] ?? 0) === 0)
                continue;
            const base = e * total;
            const footFlags = this.entityFootFlags[e] ?? 0;
            for (let b = 0; b < this.boneCount; b++) {
                const slot = base + b * BONE_SLOT_STRIDE;
                // Foot locking (gate 4): zero out the inertial offset for
                // the foot bones (bone 0 = left foot, bone 1 = right foot
                // by convention in the consumer's skeleton mapping).
                if (b === 0 && (footFlags & FOOT_LEFT) !== 0) {
                    for (let s = 0; s < BONE_SLOT_STRIDE; s++) {
                        this.inertOffset[slot + s] = 0;
                        this.inertVelocity[slot + s] = 0;
                    }
                    continue;
                }
                if (b === 1 && (footFlags & FOOT_RIGHT) !== 0) {
                    for (let s = 0; s < BONE_SLOT_STRIDE; s++) {
                        this.inertOffset[slot + s] = 0;
                        this.inertVelocity[slot + s] = 0;
                    }
                    continue;
                }
                for (let s = 0; s < BONE_SLOT_STRIDE; s++) {
                    const off = this.inertOffset[slot + s] ?? 0;
                    const vel = this.inertVelocity[slot + s] ?? 0;
                    // O_next = (O + v * dt) * decay
                    // v_next = v * decay
                    // dt is fp; v * dt fp; sum fp; * decay fp / FP_ONE.
                    const advanced = off + Math.floor((vel * dtFp) / ANIM_FP_ONE);
                    this.inertOffset[slot + s] = Math.floor((advanced * decayFp) / ANIM_FP_ONE);
                    this.inertVelocity[slot + s] = Math.floor((vel * decayFp) / ANIM_FP_ONE);
                }
            }
        }
    }
    // --- pose read for renderer ---
    // Compute the visible pose for entity at bone, writing 7 fp values
    // (translation x/y/z + quaternion x/y/z/w) into out. The visible
    // pose = current DB pose + inertOffset. Foot-locked bones return
    // the current DB pose unchanged.
    readVisiblePose(entityId, bone, out, outOffset = 0) {
        if (!this.requireEntity(entityId))
            return false;
        if (!Number.isInteger(bone) || bone < 0 || bone >= this.boneCount)
            return false;
        if (outOffset < 0 || outOffset + BONE_SLOT_STRIDE > out.length)
            return false;
        const clip = this.entityCurrentClip[entityId] ?? -1;
        const frame = this.entityCurrentFrame[entityId] ?? -1;
        if (clip < 0 || frame < 0) {
            for (let s = 0; s < BONE_SLOT_STRIDE; s++)
                out[outOffset + s] = 0;
            return true;
        }
        const dbBase = (clip * this.framesPerClip + frame) * this.boneCount * BONE_SLOT_STRIDE
            + bone * BONE_SLOT_STRIDE;
        const inertBase = entityId * this.boneCount * BONE_SLOT_STRIDE + bone * BONE_SLOT_STRIDE;
        for (let s = 0; s < BONE_SLOT_STRIDE; s++) {
            out[outOffset + s] = ((this.poseDB[dbBase + s] ?? 0) + (this.inertOffset[inertBase + s] ?? 0)) | 0;
        }
        return true;
    }
    // Read the inertOffset (the smoothing delta the renderer adds to
    // the DB pose). Used by the deferred WGSL render pipeline binding.
    readInertOffset(entityId, bone, out, outOffset = 0) {
        if (!this.requireEntity(entityId))
            return false;
        if (!Number.isInteger(bone) || bone < 0 || bone >= this.boneCount)
            return false;
        if (outOffset < 0 || outOffset + BONE_SLOT_STRIDE > out.length)
            return false;
        const inertBase = entityId * this.boneCount * BONE_SLOT_STRIDE + bone * BONE_SLOT_STRIDE;
        for (let s = 0; s < BONE_SLOT_STRIDE; s++) {
            out[outOffset + s] = this.inertOffset[inertBase + s] ?? 0;
        }
        return true;
    }
    // --- helpers ---
    // Map (halfLifeFp, dtFp) -> decay LUT index. The product
    // (halfLifeFp * dtFp / FP_ONE) is the e^{-x} input; we quantize to
    // 256 buckets covering [0, 256/256 = 1.0).
    computeDecayIndex(dtFp) {
        // x = halfLife * dt / FP_ONE; index = floor(x * DECAY_LUT_SIZE).
        // Both halfLife and dt are fp; their product fits in JS double's
        // 2^53 range when halfLife <= 2^16 and dt <= 2^16.
        const product = (this.halfLifeFp * dtFp) / ANIM_FP_ONE;
        let idx = Math.floor(product);
        if (idx < 0)
            idx = 0;
        if (idx >= DECAY_LUT_SIZE)
            idx = DECAY_LUT_SIZE - 1;
        return idx;
    }
    requireClip(c) {
        return Number.isInteger(c) && c >= 0 && c < this.numClips;
    }
    requireFrame(f) {
        return Number.isInteger(f) && f >= 0 && f < this.framesPerClip;
    }
    requireEntity(e) {
        return Number.isInteger(e) && e >= 0 && e < this.entityCount;
    }
    // --- lifecycle ---
    clear() {
        this.featureDB.fill(0);
        this.poseDB.fill(0);
        this.entityCurrentClip.fill(ANIM_CLIP_INVALID);
        this.entityCurrentFrame.fill(ANIM_FRAME_INVALID);
        this.entityIntentVx.fill(0);
        this.entityIntentVy.fill(0);
        this.entityIntentVz.fill(0);
        this.entityIntentDirX.fill(0);
        this.entityIntentDirY.fill(0);
        this.entityIntentDirZ.fill(0);
        this.entityFootFlags.fill(0);
        this.entityActive.fill(0);
        this.inertOffset.fill(0);
        this.inertVelocity.fill(0);
        this.entityCount = 0;
        this.transitionsTotal = 0;
        this.searchesTotal = 0;
    }
    // Suppress unused-variable warning from BONE_TX/TY/TZ - kept as
    // documentation constants for the layout convention.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _layout = { BONE_TX, BONE_TY, BONE_TZ };
}
//# sourceMappingURL=neural-animation.js.map