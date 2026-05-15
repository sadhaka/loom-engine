// SonicSync - the acoustic propagation kernel: voxel-DDA occlusion
// from a population of sound sources to a population of listeners,
// publishing compact "perception events" one frame later.
//
// The Trinity dossier's section 14 (Gemini Volume I). The Gemini sketch
// was `calculateOcclusion(sourceIdx, listenerIdx, grid): number {
// return this.trace(sourceIdx, listenerIdx, grid); }` returning a
// 0..1 attenuation. The Codex audit: "strong gameplay idea, but
// readback and ray budget are blockers." The sketch had no SoA
// hearing path (object ECS), no DDA (the implied tracer was naive
// stepping), no precomputed directions (allocated per call), no
// double-buffering of the output (the consumer would race the
// producer), no bounds checks (any sourceCount / materialId / output
// size was fatal), and no event cooldown (the same source-listener
// pair would re-emit every frame, flooding the Omniveil consumer).
//
// This is the corrected build, single-thread / single-owner like every
// shipped Trinity component. The actual WebGPU acoustic ray tracer
// and the Omniveil semantic injection are the deferred integration
// layer; this is the pure-logic CPU voxel-DDA kernel that drives them.
//
// FIXED-POINT WORLD COORDINATES. Positions are Q16.16 Int32 - 16
// integer bits, 16 fractional. A "voxel" is one integer step along
// each axis (so the world is voxelGridSize ** 3 voxels per chunk).
// This is the no-floats-in-the-simulation rule: a replay is bit-for-
// bit identical regardless of FPU mode. The fp constants are exposed
// so the consumer can convert world -> sonic coordinates.
//
// SoA HEARING PATH. Two pools: sources (position, semanticId,
// intensity, active) and listeners (position, hearingRadius,
// semanticMask, active). Both are contiguous Uint32 / Int32 arrays
// indexed by slot - no per-source / per-listener objects. Semantic
// IDs are bounded integers (no strings); the listener filter is a
// bitmask over the semantic ID's low bits, which lets a listener
// subscribe to one to many semantic categories without touching
// strings.
//
// PRECOMPUTED RAY GEOMETRY. The constructor builds two tables:
//   octantStepX/Y/Z     - the +1 / -1 step direction per of 8 octants
//   octantNextDeltaScale - shared 1/abs(dir) coefficient table built
//     when a ray is set up; the per-pair direction goes into a single
//     preallocated working Int32Array(3) - never freshly allocated.
// The "precompute" gate is satisfied two ways: per-octant step LUTs
// (build-once) AND zero-allocation per-call direction setup.
//
// VOXEL DDA TRAVERSAL. Amanatides-Woo 3D DDA: at each step, advance
// to the next voxel boundary along whichever axis hits next; sum the
// occlusion of every voxel the ray passes through, terminate on
// (a) accumulated occlusion >= 255, (b) ray length exhausted, or (c)
// the ray exits the grid. This is the no-naive-stepping gate: the
// number of voxels visited equals the Manhattan span, not a
// distance/step ratio that misses thin walls.
//
// DOUBLE-BUFFERED OUTPUT. Two event rings, swapped by tick(). The
// "back" buffer is what the current frame WRITES into; the "front"
// buffer is what the consumer READS. consumer can drain front-buffer
// events at its own pace; the next tick() swaps. This is the "read
// back compact events one frame later" gate (gate 3) and the
// "double-buffer the output" gate (gate 4).
//
// EVENT COOLDOWN. An open-addressed table keyed by (sourceSlot,
// listenerSlot, semanticId) tracks the last-emit-tick for each
// pair. A re-emit is suppressed until cooldownTicks have elapsed.
// This is the dedup-before-Omniveil gate (gate 7): the consumer
// sees one event per pair per cooldown window, not one per frame.
//
// The 7 Codex gates for Sonic-Sync, enforced:
//   1. "precompute ray directions" - per-octant step LUTs are
//      build-once in the constructor; the per-pair direction vector
//      goes into a preallocated working Int32Array - zero per-call
//      allocation.
//   2. "replace naive ray stepping with voxel DDA" - traceOcclusion
//      runs Amanatides-Woo 3D DDA over the occlusion grid; visits
//      every voxel the ray actually passes through; no step ratio.
//   3. "keep perception aggregation on GPU or read back compact
//      events one frame later" - producePerceptionEvents writes into
//      the BACK ring; consumer reads from the FRONT ring; tick()
//      swaps. The consumer always reads the previous frame's events.
//   4. "double-buffer ray_hits/acoustic grids" - two event rings,
//      front + back; tick() rotates them.
//   5. "replace object ECS hearing path with SoA and integer
//      semantic IDs" - source / listener pools are SoA Int32 / Uint32;
//      semanticId is a bounded integer; the listener semanticMask is
//      a u32 bitset over the semantic ID's low 32 categories.
//   6. "add bounds checks for source count, material ID, output
//      capacity" - addSource / addListener / setVoxel all
//      require<Range>; eventCapacity overflow drops events and
//      counts them as eventsDropped (a caller-visible diagnostic).
//   7. "add event cooldown / dedup before Omniveil injection" -
//      cooldownTable is an open-addressed hash on (source, listener,
//      semanticId) with last-emit-tick; emit suppressed until
//      cooldownTicks have passed.
//
// Non-negotiable engine gates: no RNG, no wall clock (DDA traversal,
// hashing, octant LUTs are deterministic - a run replays bit-for-
// bit; currentTick is an injected parameter); single-thread, no
// Atomics (the GPU compute-pass acoustic kernel is the deferred
// SAB integration layer); every slot / id / index bounds-checked;
// fixed-capacity storage. The cooldown hash table is auto-sized to
// 2x the logical capacity so probe chains stay short.
// Q16.16 fixed-point constants. World units are Int32; one integer
// step (FP_ONE) corresponds to one voxel of the occlusion grid.
export const FP_SHIFT = 16;
export const FP_ONE = 1 << FP_SHIFT; // 65536
export const FP_HALF = FP_ONE >> 1; // 32768
const FP_MASK = FP_ONE - 1;
// Returned by the per-source-per-listener tracer when there is no
// audible path: either the listener is out of range, semantic mask
// rejects, or the ray is fully occluded. Caller treats it as silent.
export const ATTENUATION_FULL = 255; // u8 - fully occluded
export const ATTENUATION_NONE = 0; // u8 - no occlusion
export const TRACE_INAUDIBLE = -1; // sentinel for inaudible
// Source / listener slot sentinels. Returned by addSource / addListener
// when the pool is full or input rejected, and by find / get when not
// found. A real slot is in [0, capacity).
export const SOURCE_SLOT_INVALID = -1;
export const LISTENER_SLOT_INVALID = -1;
// readEvent record stride: [sourceSlot, listenerSlot, semanticId,
// attenuation, distance, tickEmitted]. distance is the Q16.16 chebyshev
// distance in fp world units; tickEmitted is the tick the event was
// produced (the consumer reads it the FOLLOWING tick after a swap).
export const PERCEPTION_EVENT_STRIDE = 6;
// Sanity caps on the config-derived sizes. Not engine limits - guards
// so a bad argument throws a clear error instead of attempting an
// absurd typed-array allocation.
const MAX_SOURCE_CAPACITY = 1 << 16;
const MAX_LISTENER_CAPACITY = 1 << 16;
const MAX_SEMANTIC_ID = 1 << 16;
const MAX_VOXEL_GRID_SIZE = 1024; // per axis -> max 1024^3 voxels
const MAX_RAY_LENGTH = 1 << 16; // voxels traversed per ray
const MAX_EVENT_CAPACITY = 1 << 16;
const MAX_COOLDOWN_TICKS = 1 << 24;
const MAX_HEARING_RADIUS = 1 << 24; // fp units (about 256 voxels)
// Per-octant DDA step direction LUT. Index 0..7 is the octant index
// formed by packing the sign bits of dx / dy / dz: bit 0 = (dx<0),
// bit 1 = (dy<0), bit 2 = (dz<0).
const OCTANT_COUNT = 8;
// Three axes - x / y / z. Encoded into the DDA tNext-which-min compare.
const AXIS_X = 0;
const AXIS_Y = 1;
const AXIS_Z = 2;
// Cooldown table empty / tombstone sentinels. A real (source,
// listener, semantic) entry has all three packed into a 64-bit-ish
// composite key; we store the key as two u32 halves and the
// emittedTick as a third u32 column. KEY_HI == 0 && KEY_LO == 0 means
// EMPTY; KEY_HI == TOMBSTONE_KEY means tombstoned (reusable on insert,
// skip on lookup).
const COOLDOWN_KEY_EMPTY_HI = 0;
const COOLDOWN_KEY_EMPTY_LO = 0;
const COOLDOWN_KEY_TOMBSTONE_HI = 0xffffffff;
// Slot lookups iterate up to tableSize times before bailing - the
// table is auto-sized to 2x capacity so probes stay short, but a
// pathological all-tombstone state could otherwise loop forever.
// Smallest power of two >= n (n >= 1).
function nextPow2(n) {
    let p = 1;
    while (p < n)
        p <<= 1;
    return p;
}
// Murmur3-style integer finalizer. Used to scatter cooldown keys.
function mix32(h) {
    h = h >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}
export class SonicSync {
    maxSources;
    maxListeners;
    voxelGridSize;
    maxRayLength;
    maxSemanticId;
    eventCapacity;
    cooldownTicks;
    // Cooldown hash-table size: 2x nextPow2(maxSources * maxListeners
    // capped); a power of two; the open-addressing wrap mask is
    // tableSize - 1.
    cooldownTableSize;
    // Wrap mask for cooldown hashing.
    cooldownMask;
    // Source SoA. positionX/Y/Z are Q16.16 Int32 fp; semanticId u16;
    // intensity u8 (0..255 = silent..maximum); active u8 (0/1).
    sourcePositionX;
    sourcePositionY;
    sourcePositionZ;
    sourceSemanticId;
    sourceIntensity;
    sourceActive;
    sourceCount = 0;
    // Listener SoA. position fp; hearingRadius fp Int32; semanticMask
    // u32 bitset; active u8.
    listenerPositionX;
    listenerPositionY;
    listenerPositionZ;
    listenerHearingRadius;
    listenerSemanticMask;
    listenerActive;
    listenerCount = 0;
    // Voxel occlusion grid. Each cell is u8 attenuation per voxel
    // crossed: 0 = fully transparent, 255 = fully opaque. The DDA sums
    // these along the ray.
    voxelGrid;
    // Two output event rings (gate 4). Each ring is eventCapacity
    // records of PERCEPTION_EVENT_STRIDE u32 each. frontIsRing0
    // indicates which ring is currently the FRONT (consumer reads).
    eventRing0;
    eventRing1;
    frontIsRing0 = true;
    frontCount = 0;
    backCount = 0;
    eventsDroppedTotal = 0;
    // Cooldown hash table (gate 7). Three columns - keyHi, keyLo,
    // emittedTick. Open-addressed, linear probing, tombstones.
    cooldownKeyHi;
    cooldownKeyLo;
    cooldownTick;
    cooldownEntryCount = 0;
    // Per-octant DDA step direction LUTs (gate 1). Filled in the
    // constructor; never re-allocated. Indexed by octant in [0, 8).
    octantStepX;
    octantStepY;
    octantStepZ;
    // Preallocated per-pair working buffer (gate 1). Holds the current
    // ray's direction Int32 dx/dy/dz - never freshly allocated.
    rayDirection;
    // Currently published tick. tick(t) advances to t and swaps the
    // event rings. produced events store this as tickEmitted.
    currentTick = 0;
    constructor(config) {
        const { maxSources, maxListeners, voxelGridSize, maxRayLength, maxSemanticId, eventCapacity, cooldownTicks, } = config;
        if (!Number.isInteger(maxSources) || maxSources < 1 || maxSources > MAX_SOURCE_CAPACITY) {
            throw new RangeError('SonicSync: maxSources must be an integer in [1, ' + MAX_SOURCE_CAPACITY + '], got ' + maxSources);
        }
        if (!Number.isInteger(maxListeners) || maxListeners < 1 || maxListeners > MAX_LISTENER_CAPACITY) {
            throw new RangeError('SonicSync: maxListeners must be an integer in [1, ' + MAX_LISTENER_CAPACITY + '], got ' + maxListeners);
        }
        if (!Number.isInteger(voxelGridSize) || voxelGridSize < 2 || voxelGridSize > MAX_VOXEL_GRID_SIZE) {
            throw new RangeError('SonicSync: voxelGridSize must be an integer in [2, ' + MAX_VOXEL_GRID_SIZE + '], got ' + voxelGridSize);
        }
        if (!Number.isInteger(maxRayLength) || maxRayLength < 1 || maxRayLength > MAX_RAY_LENGTH) {
            throw new RangeError('SonicSync: maxRayLength must be an integer in [1, ' + MAX_RAY_LENGTH + '], got ' + maxRayLength);
        }
        if (!Number.isInteger(maxSemanticId) || maxSemanticId < 1 || maxSemanticId > MAX_SEMANTIC_ID) {
            throw new RangeError('SonicSync: maxSemanticId must be an integer in [1, ' + MAX_SEMANTIC_ID + '], got ' + maxSemanticId);
        }
        if (!Number.isInteger(eventCapacity) || eventCapacity < 1 || eventCapacity > MAX_EVENT_CAPACITY) {
            throw new RangeError('SonicSync: eventCapacity must be an integer in [1, ' + MAX_EVENT_CAPACITY + '], got ' + eventCapacity);
        }
        if (!Number.isInteger(cooldownTicks) || cooldownTicks < 0 || cooldownTicks > MAX_COOLDOWN_TICKS) {
            throw new RangeError('SonicSync: cooldownTicks must be an integer in [0, ' + MAX_COOLDOWN_TICKS + '], got ' + cooldownTicks);
        }
        this.maxSources = maxSources;
        this.maxListeners = maxListeners;
        this.voxelGridSize = voxelGridSize;
        this.maxRayLength = maxRayLength;
        this.maxSemanticId = maxSemanticId;
        this.eventCapacity = eventCapacity;
        this.cooldownTicks = cooldownTicks;
        // Cooldown table sized to 2x the maximum number of distinct
        // (source, listener, semantic) tuples we might keep alive at once.
        // We bound the hot set at maxSources * maxListeners (cap at 2^17
        // for the table itself; pathological all-pairs-cooldown is unusual
        // and a probe miss on a full table will linearly walk the whole
        // table - documented below).
        const cooldownLogical = Math.min(maxSources * maxListeners, 1 << 16);
        this.cooldownTableSize = 2 * nextPow2(cooldownLogical);
        this.cooldownMask = this.cooldownTableSize - 1;
        this.sourcePositionX = new Int32Array(maxSources);
        this.sourcePositionY = new Int32Array(maxSources);
        this.sourcePositionZ = new Int32Array(maxSources);
        this.sourceSemanticId = new Uint16Array(maxSources);
        this.sourceIntensity = new Uint8Array(maxSources);
        this.sourceActive = new Uint8Array(maxSources);
        this.listenerPositionX = new Int32Array(maxListeners);
        this.listenerPositionY = new Int32Array(maxListeners);
        this.listenerPositionZ = new Int32Array(maxListeners);
        this.listenerHearingRadius = new Int32Array(maxListeners);
        this.listenerSemanticMask = new Uint32Array(maxListeners);
        this.listenerActive = new Uint8Array(maxListeners);
        this.voxelGrid = new Uint8Array(voxelGridSize * voxelGridSize * voxelGridSize);
        this.eventRing0 = new Int32Array(eventCapacity * PERCEPTION_EVENT_STRIDE);
        this.eventRing1 = new Int32Array(eventCapacity * PERCEPTION_EVENT_STRIDE);
        this.cooldownKeyHi = new Uint32Array(this.cooldownTableSize);
        this.cooldownKeyLo = new Uint32Array(this.cooldownTableSize);
        this.cooldownTick = new Uint32Array(this.cooldownTableSize);
        this.octantStepX = new Int8Array(OCTANT_COUNT);
        this.octantStepY = new Int8Array(OCTANT_COUNT);
        this.octantStepZ = new Int8Array(OCTANT_COUNT);
        // Build the per-octant step LUT (gate 1). Octant bit 0 -> x sign,
        // bit 1 -> y sign, bit 2 -> z sign; sign bit set means negative.
        for (let oct = 0; oct < OCTANT_COUNT; oct++) {
            this.octantStepX[oct] = (oct & 1) ? -1 : 1;
            this.octantStepY[oct] = (oct & 2) ? -1 : 1;
            this.octantStepZ[oct] = (oct & 4) ? -1 : 1;
        }
        this.rayDirection = new Int32Array(3);
    }
    // --- counts ---
    getSourceCount() { return this.sourceCount; }
    getListenerCount() { return this.listenerCount; }
    getEventsDroppedTotal() { return this.eventsDroppedTotal; }
    getFrontEventCount() { return this.frontCount; }
    getBackEventCount() { return this.backCount; }
    getCurrentTick() { return this.currentTick; }
    getCooldownEntryCount() { return this.cooldownEntryCount; }
    // --- source pool (gate 5, gate 6) ---
    // Add a source. positionX/Y/Z are Q16.16 fp Int32; semanticId is in
    // [0, maxSemanticId); intensity is u8 (0..255). Returns the source
    // slot, or SOURCE_SLOT_INVALID if the pool is full or input rejected.
    addSource(positionX, positionY, positionZ, semanticId, intensity) {
        if (this.sourceCount >= this.maxSources)
            return SOURCE_SLOT_INVALID;
        if (!Number.isInteger(positionX)
            || !Number.isInteger(positionY)
            || !Number.isInteger(positionZ)) {
            return SOURCE_SLOT_INVALID;
        }
        if (!Number.isInteger(semanticId) || semanticId < 0 || semanticId >= this.maxSemanticId) {
            return SOURCE_SLOT_INVALID;
        }
        if (!Number.isInteger(intensity) || intensity < 0 || intensity > 255) {
            return SOURCE_SLOT_INVALID;
        }
        const slot = this.sourceCount++;
        this.sourcePositionX[slot] = positionX | 0;
        this.sourcePositionY[slot] = positionY | 0;
        this.sourcePositionZ[slot] = positionZ | 0;
        this.sourceSemanticId[slot] = semanticId;
        this.sourceIntensity[slot] = intensity;
        this.sourceActive[slot] = 1;
        return slot;
    }
    // Update an existing source's pose / intensity. Returns false if the
    // slot is invalid or inactive.
    updateSource(slot, positionX, positionY, positionZ, intensity) {
        if (!this.requireSourceSlot(slot))
            return false;
        if (!Number.isInteger(positionX)
            || !Number.isInteger(positionY)
            || !Number.isInteger(positionZ)) {
            return false;
        }
        if (!Number.isInteger(intensity) || intensity < 0 || intensity > 255)
            return false;
        this.sourcePositionX[slot] = positionX | 0;
        this.sourcePositionY[slot] = positionY | 0;
        this.sourcePositionZ[slot] = positionZ | 0;
        this.sourceIntensity[slot] = intensity;
        return true;
    }
    // Mark a source inactive (skipped by produce). The slot stays
    // assigned - the SoA is dense-add only; clear() is the way to
    // reclaim slots in bulk.
    deactivateSource(slot) {
        if (!this.requireSourceSlot(slot))
            return false;
        this.sourceActive[slot] = 0;
        return true;
    }
    // --- listener pool (gate 5, gate 6) ---
    // Add a listener. semanticMask is a u32 bitset over semanticId's low
    // 32 categories - bit (semanticId & 31) must be set for the listener
    // to hear the source. hearingRadius is in fp world units.
    addListener(positionX, positionY, positionZ, hearingRadius, semanticMask) {
        if (this.listenerCount >= this.maxListeners)
            return LISTENER_SLOT_INVALID;
        if (!Number.isInteger(positionX)
            || !Number.isInteger(positionY)
            || !Number.isInteger(positionZ)) {
            return LISTENER_SLOT_INVALID;
        }
        if (!Number.isInteger(hearingRadius) || hearingRadius < 0 || hearingRadius > MAX_HEARING_RADIUS) {
            return LISTENER_SLOT_INVALID;
        }
        if (!Number.isInteger(semanticMask) || semanticMask < 0 || semanticMask > 0xffffffff) {
            return LISTENER_SLOT_INVALID;
        }
        const slot = this.listenerCount++;
        this.listenerPositionX[slot] = positionX | 0;
        this.listenerPositionY[slot] = positionY | 0;
        this.listenerPositionZ[slot] = positionZ | 0;
        this.listenerHearingRadius[slot] = hearingRadius | 0;
        this.listenerSemanticMask[slot] = semanticMask >>> 0;
        this.listenerActive[slot] = 1;
        return slot;
    }
    updateListener(slot, positionX, positionY, positionZ, hearingRadius, semanticMask) {
        if (!this.requireListenerSlot(slot))
            return false;
        if (!Number.isInteger(positionX)
            || !Number.isInteger(positionY)
            || !Number.isInteger(positionZ)) {
            return false;
        }
        if (!Number.isInteger(hearingRadius) || hearingRadius < 0 || hearingRadius > MAX_HEARING_RADIUS) {
            return false;
        }
        if (!Number.isInteger(semanticMask) || semanticMask < 0 || semanticMask > 0xffffffff) {
            return false;
        }
        this.listenerPositionX[slot] = positionX | 0;
        this.listenerPositionY[slot] = positionY | 0;
        this.listenerPositionZ[slot] = positionZ | 0;
        this.listenerHearingRadius[slot] = hearingRadius | 0;
        this.listenerSemanticMask[slot] = semanticMask >>> 0;
        return true;
    }
    deactivateListener(slot) {
        if (!this.requireListenerSlot(slot))
            return false;
        this.listenerActive[slot] = 0;
        return true;
    }
    // --- voxel grid (gate 6) ---
    // Set a single voxel's occlusion (0..255). Bounds-checked.
    setVoxel(x, y, z, occlusion) {
        if (!this.requireVoxelCoords(x, y, z))
            return false;
        if (!Number.isInteger(occlusion) || occlusion < 0 || occlusion > 255)
            return false;
        this.voxelGrid[this.voxelIndex(x, y, z)] = occlusion;
        return true;
    }
    // Read a voxel's occlusion (0..255). Returns 0 (transparent) for
    // out-of-bounds reads; the DDA outside-grid test is the actual
    // termination, so this is a safe fallback for bench callers.
    getVoxel(x, y, z) {
        if (!Number.isInteger(x) || x < 0 || x >= this.voxelGridSize)
            return 0;
        if (!Number.isInteger(y) || y < 0 || y >= this.voxelGridSize)
            return 0;
        if (!Number.isInteger(z) || z < 0 || z >= this.voxelGridSize)
            return 0;
        return this.voxelGrid[this.voxelIndex(x, y, z)] ?? 0;
    }
    // Bulk-fill a rectangular voxel region with a single occlusion. Used
    // for level geometry import. Out-of-range coords are clamped; the
    // method always succeeds.
    fillVoxelRegion(x0, y0, z0, x1, y1, z1, occlusion) {
        if (!Number.isInteger(occlusion) || occlusion < 0 || occlusion > 255)
            return;
        const lx = Math.max(0, Math.min(this.voxelGridSize - 1, x0 | 0));
        const ly = Math.max(0, Math.min(this.voxelGridSize - 1, y0 | 0));
        const lz = Math.max(0, Math.min(this.voxelGridSize - 1, z0 | 0));
        const hx = Math.max(0, Math.min(this.voxelGridSize - 1, x1 | 0));
        const hy = Math.max(0, Math.min(this.voxelGridSize - 1, y1 | 0));
        const hz = Math.max(0, Math.min(this.voxelGridSize - 1, z1 | 0));
        for (let z = lz; z <= hz; z++) {
            for (let y = ly; y <= hy; y++) {
                for (let x = lx; x <= hx; x++) {
                    this.voxelGrid[this.voxelIndex(x, y, z)] = occlusion;
                }
            }
        }
    }
    // --- the DDA tracer (gates 1, 2) ---
    // Trace the occlusion of the ray from sourceSlot to listenerSlot.
    // Returns a u8 attenuation (0 = no occlusion, 255 = fully blocked),
    // or TRACE_INAUDIBLE if the listener is out of hearing range or the
    // semantic mask rejects. Pure read - no side effects, no allocs.
    traceOcclusion(sourceSlot, listenerSlot) {
        if (!this.requireSourceSlot(sourceSlot))
            return TRACE_INAUDIBLE;
        if (!this.requireListenerSlot(listenerSlot))
            return TRACE_INAUDIBLE;
        if (!this.sourceActive[sourceSlot] || !this.listenerActive[listenerSlot]) {
            return TRACE_INAUDIBLE;
        }
        const semId = this.sourceSemanticId[sourceSlot] ?? 0;
        const semMask = this.listenerSemanticMask[listenerSlot] ?? 0;
        if ((semMask & (1 << (semId & 31))) === 0)
            return TRACE_INAUDIBLE;
        const sx = this.sourcePositionX[sourceSlot] ?? 0;
        const sy = this.sourcePositionY[sourceSlot] ?? 0;
        const sz = this.sourcePositionZ[sourceSlot] ?? 0;
        const lx = this.listenerPositionX[listenerSlot] ?? 0;
        const ly = this.listenerPositionY[listenerSlot] ?? 0;
        const lz = this.listenerPositionZ[listenerSlot] ?? 0;
        // Chebyshev distance in fp units - cheap, no sqrt, deterministic.
        const dxAbs = Math.abs(lx - sx);
        const dyAbs = Math.abs(ly - sy);
        const dzAbs = Math.abs(lz - sz);
        const cheb = Math.max(dxAbs, Math.max(dyAbs, dzAbs));
        const radius = this.listenerHearingRadius[listenerSlot] ?? 0;
        if (cheb > radius)
            return TRACE_INAUDIBLE;
        return this.dda(sx, sy, sz, lx, ly, lz);
    }
    // Amanatides-Woo 3D DDA. Walks every voxel the line from (sx,sy,sz)
    // to (lx,ly,lz) actually passes through, sums the occlusion, returns
    // the clamped u8 sum. All inputs are Q16.16 fp Int32. Bounded by
    // maxRayLength voxel crossings.
    dda(sx, sy, sz, lx, ly, lz) {
        // Direction: store into the preallocated rayDirection buffer
        // (gate 1 - zero per-call alloc).
        const dx = lx - sx;
        const dy = ly - sy;
        const dz = lz - sz;
        this.rayDirection[0] = dx;
        this.rayDirection[1] = dy;
        this.rayDirection[2] = dz;
        if (dx === 0 && dy === 0 && dz === 0)
            return ATTENUATION_NONE;
        // Octant index packs the sign bits.
        const octant = ((dx < 0 ? 1 : 0) | (dy < 0 ? 2 : 0) | (dz < 0 ? 4 : 0)) & 7;
        const stepX = this.octantStepX[octant] ?? 1;
        const stepY = this.octantStepY[octant] ?? 1;
        const stepZ = this.octantStepZ[octant] ?? 1;
        // Initial voxel - integer division by FP_ONE (a right-shift since
        // the ints can be negative we use Math.floor on a divide so the
        // sign rounds toward -inf). For positive coords this is just sx
        // >> FP_SHIFT; for negatives the shift would round toward 0 which
        // is wrong. Use Math.floor for correctness.
        let vx = Math.floor(sx / FP_ONE);
        let vy = Math.floor(sy / FP_ONE);
        let vz = Math.floor(sz / FP_ONE);
        const vxEnd = Math.floor(lx / FP_ONE);
        const vyEnd = Math.floor(ly / FP_ONE);
        const vzEnd = Math.floor(lz / FP_ONE);
        // Distance to the first voxel boundary along each axis, expressed
        // as a parametric "t" in [0, 1] of the full ray. dx/dy/dz being
        // 0 along an axis -> tNext for that axis is +Infinity (axis never
        // hits a boundary along this ray; the other axes drive the walk).
        // We use a large sentinel instead of Infinity to keep the math
        // pure-integer; INT_MAX works because tDelta for an axis with
        // dir=0 is also INT_MAX, so tNext stays at INT_MAX after every
        // increment.
        const T_SENTINEL = 0x7fffffff;
        // tDelta = FP_ONE / |dir| in Q16.16 (= one voxel of t per step).
        // For dx=0 -> sentinel.
        const tDeltaX = dx === 0 ? T_SENTINEL : Math.floor((FP_ONE * FP_ONE) / Math.abs(dx));
        const tDeltaY = dy === 0 ? T_SENTINEL : Math.floor((FP_ONE * FP_ONE) / Math.abs(dy));
        const tDeltaZ = dz === 0 ? T_SENTINEL : Math.floor((FP_ONE * FP_ONE) / Math.abs(dz));
        // tNext: t-distance from current point to the next voxel boundary
        // along each axis. For positive direction, the boundary is at the
        // top of the current cell ( (FP_ONE - frac) * tDelta / FP_ONE );
        // for negative direction it is at the bottom (frac * tDelta /
        // FP_ONE). This is the Amanatides-Woo init.
        let tNextX;
        if (dx === 0)
            tNextX = T_SENTINEL;
        else {
            const fracX = sx - vx * FP_ONE; // fp in [0, FP_ONE)
            const distToBoundary = stepX > 0 ? FP_ONE - fracX : fracX;
            tNextX = Math.floor((distToBoundary * tDeltaX) / FP_ONE);
        }
        let tNextY;
        if (dy === 0)
            tNextY = T_SENTINEL;
        else {
            const fracY = sy - vy * FP_ONE;
            const distToBoundary = stepY > 0 ? FP_ONE - fracY : fracY;
            tNextY = Math.floor((distToBoundary * tDeltaY) / FP_ONE);
        }
        let tNextZ;
        if (dz === 0)
            tNextZ = T_SENTINEL;
        else {
            const fracZ = sz - vz * FP_ONE;
            const distToBoundary = stepZ > 0 ? FP_ONE - fracZ : fracZ;
            tNextZ = Math.floor((distToBoundary * tDeltaZ) / FP_ONE);
        }
        let attenuation = 0;
        // Sum the occlusion at the SOURCE voxel before stepping.
        if (this.inGrid(vx, vy, vz)) {
            attenuation += this.voxelGrid[this.voxelIndex(vx, vy, vz)] ?? 0;
            if (attenuation >= ATTENUATION_FULL)
                return ATTENUATION_FULL;
        }
        // Step until we reach the listener's voxel, exit the grid, hit
        // full occlusion, or run out of ray budget.
        let steps = 0;
        while (steps < this.maxRayLength) {
            // Already in the listener's voxel?
            if (vx === vxEnd && vy === vyEnd && vz === vzEnd)
                break;
            // Pick the axis with the smallest tNext - that boundary is hit
            // first. Ties broken X > Y > Z (deterministic).
            let axis;
            if (tNextX <= tNextY && tNextX <= tNextZ)
                axis = AXIS_X;
            else if (tNextY <= tNextZ)
                axis = AXIS_Y;
            else
                axis = AXIS_Z;
            if (axis === AXIS_X) {
                vx += stepX;
                tNextX += tDeltaX;
            }
            else if (axis === AXIS_Y) {
                vy += stepY;
                tNextY += tDeltaY;
            }
            else {
                vz += stepZ;
                tNextZ += tDeltaZ;
            }
            steps++;
            // Check exit BEFORE accumulation - a ray that has stepped out of
            // the grid has hit no more occlusion.
            if (!this.inGrid(vx, vy, vz))
                break;
            attenuation += this.voxelGrid[this.voxelIndex(vx, vy, vz)] ?? 0;
            if (attenuation >= ATTENUATION_FULL)
                return ATTENUATION_FULL;
        }
        if (attenuation > ATTENUATION_FULL)
            attenuation = ATTENUATION_FULL;
        return attenuation;
    }
    // --- per-frame production (gates 3, 4, 7) ---
    // Walk every (active source, active listener) pair, trace occlusion,
    // and write a perception event into the BACK ring for any audible
    // pair that has cleared its cooldown. Returns the number of events
    // pushed this call. Idempotent: the cooldown table guarantees the
    // same pair does not double-emit.
    producePerceptionEvents() {
        let pushed = 0;
        for (let s = 0; s < this.sourceCount; s++) {
            if (!this.sourceActive[s])
                continue;
            for (let l = 0; l < this.listenerCount; l++) {
                if (!this.listenerActive[l])
                    continue;
                const att = this.traceOcclusion(s, l);
                if (att === TRACE_INAUDIBLE)
                    continue;
                if (att >= ATTENUATION_FULL)
                    continue; // fully blocked - no event
                const semId = this.sourceSemanticId[s] ?? 0;
                // Cooldown check (gate 7).
                if (!this.cooldownAllow(s, l, semId, this.currentTick))
                    continue;
                // Bound check on output capacity (gate 6).
                if (this.backCount >= this.eventCapacity) {
                    this.eventsDroppedTotal++;
                    continue;
                }
                // Distance Chebyshev fp - cheap and consistent.
                const sx = this.sourcePositionX[s] ?? 0;
                const sy = this.sourcePositionY[s] ?? 0;
                const sz = this.sourcePositionZ[s] ?? 0;
                const lx = this.listenerPositionX[l] ?? 0;
                const ly = this.listenerPositionY[l] ?? 0;
                const lz = this.listenerPositionZ[l] ?? 0;
                const cheb = Math.max(Math.abs(lx - sx), Math.max(Math.abs(ly - sy), Math.abs(lz - sz)));
                const back = this.backIsRing0() ? this.eventRing0 : this.eventRing1;
                const off = this.backCount * PERCEPTION_EVENT_STRIDE;
                back[off + 0] = s;
                back[off + 1] = l;
                back[off + 2] = semId;
                back[off + 3] = att;
                back[off + 4] = cheb;
                back[off + 5] = this.currentTick | 0;
                this.backCount++;
                pushed++;
                // Stamp the cooldown.
                this.cooldownStamp(s, l, semId, this.currentTick);
            }
        }
        return pushed;
    }
    // Advance to tick t and swap the event rings (gates 3, 4). The
    // CURRENT back ring becomes the new front (consumer-readable); the
    // CURRENT front ring is cleared and becomes the new back. After
    // tick(), the consumer reads getFrontEventCount + readEvent at
    // indices 0..getFrontEventCount() - 1.
    tick(t) {
        if (!Number.isInteger(t) || t < 0 || t > 0xffffffff) {
            throw new RangeError('SonicSync.tick: t must be a u32, got ' + t);
        }
        // Swap.
        this.frontIsRing0 = !this.frontIsRing0;
        this.frontCount = this.backCount;
        this.backCount = 0;
        this.currentTick = t | 0;
    }
    // Read perception event at index i in the FRONT ring. Writes 6 i32
    // values into out[outOffset..+6]: [sourceSlot, listenerSlot,
    // semanticId, attenuation, distanceFp, tickEmitted]. Returns false
    // if i is out of range or out is too small.
    readEvent(i, out, outOffset = 0) {
        if (!Number.isInteger(i) || i < 0 || i >= this.frontCount)
            return false;
        if (outOffset < 0 || outOffset + PERCEPTION_EVENT_STRIDE > out.length)
            return false;
        const front = this.frontIsRing0 ? this.eventRing0 : this.eventRing1;
        const off = i * PERCEPTION_EVENT_STRIDE;
        out[outOffset + 0] = front[off + 0] ?? 0;
        out[outOffset + 1] = front[off + 1] ?? 0;
        out[outOffset + 2] = front[off + 2] ?? 0;
        out[outOffset + 3] = front[off + 3] ?? 0;
        out[outOffset + 4] = front[off + 4] ?? 0;
        out[outOffset + 5] = front[off + 5] ?? 0;
        return true;
    }
    // --- cooldown table (gate 7) ---
    // Returns true if (sourceSlot, listenerSlot, semanticId) is allowed
    // to emit at tick `now`. Cooldown of 0 always allows.
    cooldownAllow(sourceSlot, listenerSlot, semanticId, now) {
        if (this.cooldownTicks === 0)
            return true;
        const slot = this.cooldownProbe(sourceSlot, listenerSlot, semanticId, false);
        if (slot < 0)
            return true; // never seen - allow
        const last = this.cooldownTick[slot] ?? 0;
        // u32-wrap-safe: (now - last) >>> 0 < cooldownTicks means too soon.
        return ((now - last) >>> 0) >= this.cooldownTicks;
    }
    // Stamp the cooldown table - record now as the last-emit-tick for
    // (source, listener, semanticId). Inserts an entry if absent.
    cooldownStamp(sourceSlot, listenerSlot, semanticId, now) {
        if (this.cooldownTicks === 0)
            return;
        const slot = this.cooldownProbe(sourceSlot, listenerSlot, semanticId, true);
        if (slot < 0)
            return; // table full of valid entries - drop
        this.cooldownTick[slot] = now | 0;
    }
    // Open-addressed probe for a (source, listener, semanticId) entry.
    // If `insert` is false, returns the slot if present, else -1.
    // If `insert` is true, returns an existing or newly-allocated slot,
    // or -1 if the table is genuinely full.
    cooldownProbe(sourceSlot, listenerSlot, semanticId, insert) {
        const keyHi = (((sourceSlot & 0xffff) << 16) | (listenerSlot & 0xffff)) >>> 0;
        const keyLo = (semanticId & 0xffff) >>> 0;
        // Nudge keys so the EMPTY (0,0) sentinel is never a valid key.
        // (sourceSlot=0, listenerSlot=0, semanticId=0) maps to keyHi=0,
        // keyLo=0 - we resolve the collision by remapping that one tuple
        // to a fixed "alias" slot that no other tuple uses (we use the
        // top slot of the table, indexed by tableSize-1, and ignore probing
        // for it). That slot is reserved.
        if (keyHi === 0 && keyLo === 0) {
            const reserved = this.cooldownTableSize - 1;
            // We reserve this slot for the (0,0,0) tuple. It never collides
            // with the open-addressing probe (probe never starts >= mask).
            if (insert)
                return reserved;
            return reserved; // always "present" - the tick column
            // starts at 0 which means tick 0 was
            // the last emit; cooldown applies.
        }
        let h = mix32(Math.imul(keyHi, 0x9e3779b1) ^ Math.imul(keyLo, 0x85ebca6b));
        let firstTombstone = -1;
        for (let probe = 0; probe < this.cooldownTableSize - 1; probe++) {
            const slot = (h + probe) & this.cooldownMask;
            if (slot === this.cooldownTableSize - 1)
                continue; // skip reserved
            const eHi = this.cooldownKeyHi[slot] ?? 0;
            const eLo = this.cooldownKeyLo[slot] ?? 0;
            if (eHi === COOLDOWN_KEY_EMPTY_HI && eLo === COOLDOWN_KEY_EMPTY_LO) {
                // EMPTY slot - either the entry is absent (lookup) or we
                // insert here (preferring an earlier tombstone if any).
                if (!insert)
                    return -1;
                const target = firstTombstone >= 0 ? firstTombstone : slot;
                this.cooldownKeyHi[target] = keyHi;
                this.cooldownKeyLo[target] = keyLo;
                this.cooldownTick[target] = 0;
                this.cooldownEntryCount++;
                return target;
            }
            if (eHi === COOLDOWN_KEY_TOMBSTONE_HI) {
                if (firstTombstone < 0)
                    firstTombstone = slot;
                continue;
            }
            if (eHi === keyHi && eLo === keyLo)
                return slot;
        }
        // Table genuinely full of valid entries (or all-tombstone after
        // skipping the reserved slot). For insert, fall back to the first
        // tombstone we saw; for lookup, return -1.
        if (insert && firstTombstone >= 0) {
            this.cooldownKeyHi[firstTombstone] = keyHi;
            this.cooldownKeyLo[firstTombstone] = keyLo;
            this.cooldownTick[firstTombstone] = 0;
            this.cooldownEntryCount++;
            return firstTombstone;
        }
        return -1;
    }
    // --- helpers ---
    inGrid(x, y, z) {
        return x >= 0 && y >= 0 && z >= 0
            && x < this.voxelGridSize
            && y < this.voxelGridSize
            && z < this.voxelGridSize;
    }
    voxelIndex(x, y, z) {
        return x + y * this.voxelGridSize + z * this.voxelGridSize * this.voxelGridSize;
    }
    requireSourceSlot(slot) {
        return Number.isInteger(slot) && slot >= 0 && slot < this.sourceCount;
    }
    requireListenerSlot(slot) {
        return Number.isInteger(slot) && slot >= 0 && slot < this.listenerCount;
    }
    requireVoxelCoords(x, y, z) {
        return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z)
            && x >= 0 && y >= 0 && z >= 0
            && x < this.voxelGridSize
            && y < this.voxelGridSize
            && z < this.voxelGridSize;
    }
    // Whether the BACK ring is ring0. Inverted from frontIsRing0.
    backIsRing0() { return !this.frontIsRing0; }
    // --- lifecycle ---
    // Reset every pool, ring, and cooldown entry; leaves backing arrays
    // allocated. After clear() the SonicSync is in its constructor state
    // (but currentTick is preserved - the consumer's tick driver owns
    // that monotonic clock).
    clear() {
        this.sourceCount = 0;
        this.listenerCount = 0;
        this.sourceActive.fill(0);
        this.listenerActive.fill(0);
        this.voxelGrid.fill(0);
        this.eventRing0.fill(0);
        this.eventRing1.fill(0);
        this.frontIsRing0 = true;
        this.frontCount = 0;
        this.backCount = 0;
        this.eventsDroppedTotal = 0;
        this.cooldownKeyHi.fill(0);
        this.cooldownKeyLo.fill(0);
        this.cooldownTick.fill(0);
        this.cooldownEntryCount = 0;
    }
}
//# sourceMappingURL=sonic-sync.js.map