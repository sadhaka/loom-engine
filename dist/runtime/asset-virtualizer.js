// AssetVirtualizer - a bounded LRU cache for virtualized GPU assets:
// more asset IDs exist than fit in memory, so the cache keeps a fixed
// set of resident assets, evicts the least-recently-used when full,
// and tracks generation counters so a stale async load is rejected.
//
// The Trinity dossier's section 12 (Gemini Volume I). The Gemini sketch
// was a thin `AssetVirtualizer` with a Map<number,{id,gen}> registry
// and `requestAsset(id, currentGen) { if (registry.get(id)?.gen !==
// currentGen) return; loadAsset(id) }`. The Codex audit: "useful
// design but async and GPU lifetime handling are unsafe." The stale-
// load check was incomplete, asset IDs were unbounded, there was no
// LRU eviction (let alone a wrap-safe one), no delayed GPUTexture
// destruction, no dispose path, and the async ingestion would fan out
// one Promise per asset.
//
// This is the corrected build, single-thread / single-owner like every
// shipped Trinity component. The actual GPUTexture creation and
// destruction, and the async asset loading, are the deferred
// integration layer - this is the pure-logic cache that drives them.
//
// PER FRAME the caller touch()es every asset it wants to draw. A touch
// either HITs (the asset is QUEUED / LOADING / RESIDENT - its LRU
// timestamp is refreshed) or MISSes (a slot is allocated, evicting the
// LRU asset if the cache is full, and the slot is pushed onto the load
// queue). The caller drains the load queue with dequeueLoad at its own
// batched pace - no Promise-per-asset - kicks off the async load, and
// calls completeLoad when the GPU texture is ready. An evicted
// RESIDENT slot's GPU texture is NOT destroyed immediately: it goes on
// a destruction queue and drainDestroyed only yields it once a delay
// has elapsed, so the GPU is no longer using it.
//
// The 6 Codex gates for AssetVirtualizationLayer, enforced:
//   1. "bounds-check asset IDs" - requireAssetId validates against
//      maxAssetId; every handle / slot / index is bounds-checked.
//   2. "add dispose() and placeholder destruction" - dispose() queues
//      every resident GPU handle AND the shared placeholder onto the
//      destruction queue, then resets the cache; getGpuHandle returns
//      the placeholder for any not-yet-RESIDENT asset.
//   3. "delayed GPUTexture destruction after the GPU is done" - an
//      evicted RESIDENT handle is pushed to the destruction queue with
//      readyAtTick = currentTick + destroyDelay; drainDestroyed only
//      yields a handle once that delay has elapsed.
//   4. "fix Uint32 tick wrap for LRU" - the LRU victim maximizes the
//      UNSIGNED age (currentTick - lastUsedTick) >>> 0; the
//      destruction-ready test is the wrap-safe (currentTick -
//      readyAtTick) >>> 0 < 2^31. Both are correct across a u32 wrap.
//   5. "avoid Promise microtask flood for asset ingestion" - the cache
//      does NO async. touch() on a miss enqueues the slot on a load
//      queue; the deferred loader drains it with dequeueLoad in
//      batches. The load queue is the no-microtask-flood seam.
//   6. "generation counters for stale async load completion" - every
//      slot is generation-stamped; eviction bumps the generation;
//      completeLoad rejects a handle whose generation no longer
//      matches (the slot was evicted and reused), queuing the orphaned
//      GPU handle for delayed destruction.
//
// Non-negotiable engine gates: no RNG, no wall clock (the hash, the
// LRU scan, and the tie-breaks are deterministic - a run replays
// bit-for-bit; currentTick is an injected parameter); single-thread;
// every handle / id / index bounds-checked; fixed-capacity storage.
// The hash table is auto-sized to 2x the logical capacity so probe
// chains stay short even at a full cache.
// Slot lifecycle states. FREE / QUEUED / LOADING / RESIDENT are
// exported so a caller can interpret getState(); TOMBSTONE is an
// internal open-addressing marker, never returned to a caller.
export const SLOT_STATE_FREE = 0;
export const SLOT_STATE_QUEUED = 1; // allocated, in the load queue, loader has not claimed it
export const SLOT_STATE_LOADING = 2; // a loader claimed it via dequeueLoad, load in flight
export const SLOT_STATE_RESIDENT = 3; // loaded, the GPU handle is set
const SLOT_STATE_TOMBSTONE = 4; // evicted: probe-past, reusable-by-insert
// Returned by findAsset (not cached) and dequeueLoad (queue empty).
// Never a valid handle: a real handle's slot is in [0, tableSize).
export const ASSET_HANDLE_INVALID = -1;
// Returned by drainDestroyed when no GPU handle is ready to destroy.
export const DESTROY_NONE = -1;
// AssetHandle layout, mirroring EntityId: low 24 bits slot, high 8
// bits generation.
const ASSET_INDEX_MASK = 0x00ffffff;
const ASSET_GENERATION_SHIFT = 24;
const ASSET_GENERATION_MASK = 0xff;
// Sanity caps on the config-derived sizes.
const MAX_CAPACITY = 1 << 18; // logical LRU cap
const MAX_ASSET_ID = 1 << 24; // the virtual asset-id space
const MAX_DESTROY_DELAY = 1 << 16; // ticks
const MAX_DESTROY_QUEUE_SIZE = 1 << 20;
const U32_MAX = 0xffffffff;
// Wrap-safe "A >= B" threshold: an unsigned difference below this is
// "A is at or after B" (assuming the two ticks never drift > 2^31).
const U32_HALF = 0x80000000;
// destroyQueue record stride: [gpuHandle, readyAtTick].
const DESTROY_RECORD_STRIDE = 2;
export function makeAssetHandle(slot, generation) {
    return ((generation & ASSET_GENERATION_MASK) << ASSET_GENERATION_SHIFT)
        | (slot & ASSET_INDEX_MASK);
}
export function assetSlot(handle) {
    return handle & ASSET_INDEX_MASK;
}
export function assetGeneration(handle) {
    return (handle >>> ASSET_GENERATION_SHIFT) & ASSET_GENERATION_MASK;
}
// Smallest power of two >= n (n >= 1).
function nextPow2(n) {
    let p = 1;
    while (p < n)
        p <<= 1;
    return p;
}
// A murmur3-style integer finalizer - scatters an asset id so probe
// chains stay short. Deterministic; no BigInt.
function hashAssetId(id) {
    let h = id >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}
export class AssetVirtualizer {
    // Logical LRU cap.
    capacity;
    // The virtual asset-id space upper bound.
    maxAssetId;
    // Eviction-to-destruction delay in ticks.
    destroyDelay;
    // Destruction-queue ring capacity.
    destroyQueueSize;
    // Hash-table size: 2 * nextPow2(capacity), a power of two.
    tableSize;
    // tableSize - 1: the open-addressing wrap mask.
    mask;
    // Slot columns, indexed by slot, sized tableSize.
    slotAssetId;
    slotState;
    slotGpuHandle; // the real handle when RESIDENT; 0 otherwise
    slotLastUsedTick; // LRU metadata
    slotGeneration; // bumped on eviction - the epoch (gate 6)
    slotLoadIndex; // index in the load queue, or -1
    // Load queue: a dense list of QUEUED slots (gate 5). Swap-pop, so an
    // eviction removes a queued entry in O(1).
    loadQueue;
    loadQueueCount = 0;
    // Destruction queue: a ring of [gpuHandle, readyAtTick] records
    // (gate 3), drained front-to-back by drainDestroyed.
    destroyQueue;
    destroyHead = 0;
    destroyCount = 0;
    // The shared placeholder GPU handle (gate 2); 0 = none.
    placeholderHandle = 0;
    // Cached (QUEUED + LOADING + RESIDENT) slot count - the LRU "full"
    // trigger compares this to capacity.
    cachedCount = 0;
    constructor(config) {
        const { capacity, maxAssetId, destroyDelay, destroyQueueSize } = config;
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
            throw new RangeError('AssetVirtualizer: capacity must be an integer in [1, ' + MAX_CAPACITY + '], got ' + capacity);
        }
        if (!Number.isInteger(maxAssetId) || maxAssetId < 1 || maxAssetId > MAX_ASSET_ID) {
            throw new RangeError('AssetVirtualizer: maxAssetId must be an integer in [1, ' + MAX_ASSET_ID + '], got ' + maxAssetId);
        }
        if (!Number.isInteger(destroyDelay) || destroyDelay < 0 || destroyDelay > MAX_DESTROY_DELAY) {
            throw new RangeError('AssetVirtualizer: destroyDelay must be an integer in [0, ' + MAX_DESTROY_DELAY + '], got ' + destroyDelay);
        }
        if (!Number.isInteger(destroyQueueSize) || destroyQueueSize < capacity + 1
            || destroyQueueSize > MAX_DESTROY_QUEUE_SIZE) {
            throw new RangeError('AssetVirtualizer: destroyQueueSize must be an integer in [capacity + 1 = ' + (capacity + 1)
                + ', ' + MAX_DESTROY_QUEUE_SIZE + '], got ' + destroyQueueSize);
        }
        this.capacity = capacity;
        this.maxAssetId = maxAssetId;
        this.destroyDelay = destroyDelay;
        this.destroyQueueSize = destroyQueueSize;
        this.tableSize = 2 * nextPow2(capacity);
        this.mask = this.tableSize - 1;
        this.slotAssetId = new Uint32Array(this.tableSize);
        this.slotState = new Uint8Array(this.tableSize);
        this.slotGpuHandle = new Uint32Array(this.tableSize);
        this.slotLastUsedTick = new Uint32Array(this.tableSize);
        this.slotGeneration = new Uint8Array(this.tableSize);
        this.slotLoadIndex = new Int32Array(this.tableSize).fill(-1);
        this.loadQueue = new Int32Array(capacity);
        this.destroyQueue = new Uint32Array(destroyQueueSize * DESTROY_RECORD_STRIDE);
    }
    // --- placeholder (gate 2) ---
    // Register the shared placeholder GPU handle - the texture
    // getGpuHandle returns for any asset that is not yet RESIDENT. 0
    // clears it.
    setPlaceholder(gpuHandle) {
        if (!Number.isInteger(gpuHandle) || gpuHandle < 0 || gpuHandle > U32_MAX) {
            throw new RangeError('AssetVirtualizer.setPlaceholder: gpuHandle must be an integer in [0, ' + U32_MAX + '], got ' + gpuHandle);
        }
        this.placeholderHandle = gpuHandle;
    }
    // The shared placeholder GPU handle (0 if none).
    getPlaceholder() {
        return this.placeholderHandle;
    }
    // --- counts ---
    // Cached (QUEUED + LOADING + RESIDENT) asset count - against capacity.
    getCachedCount() {
        return this.cachedCount;
    }
    // Slots waiting in the load queue (QUEUED, not yet dequeued).
    getLoadQueueCount() {
        return this.loadQueueCount;
    }
    // GPU handles waiting on the destruction queue.
    getDestroyQueueCount() {
        return this.destroyCount;
    }
    // --- the per-frame access path (gates 4, 5) ---
    // Mark asset `assetId` as used this tick. If it is cached (QUEUED /
    // LOADING / RESIDENT), its LRU timestamp is refreshed and its handle
    // returned. If not (a miss), a slot is allocated - evicting the
    // least-recently-used asset if the cache is full - the slot is
    // pushed onto the load queue in QUEUED state, and its handle is
    // returned. Use getState() to tell a hit from a fresh miss.
    touch(assetId, currentTick) {
        this.requireAssetId(assetId, 'touch');
        this.requireTick(currentTick, 'touch');
        const found = this.findSlot(assetId);
        if (found >= 0) {
            // HIT - refresh the LRU timestamp whatever the state.
            this.slotLastUsedTick[found] = currentTick;
            return makeAssetHandle(found, this.slotGeneration[found] ?? 0);
        }
        // MISS - make room if the cache is full, then allocate a slot.
        if (this.cachedCount >= this.capacity) {
            this.evictLRU(currentTick);
        }
        const slot = this.registerSlot(assetId);
        this.slotState[slot] = SLOT_STATE_QUEUED;
        this.slotGpuHandle[slot] = 0;
        this.slotLastUsedTick[slot] = currentTick;
        this.cachedCount++;
        this.pushLoadQueue(slot);
        return makeAssetHandle(slot, this.slotGeneration[slot] ?? 0);
    }
    // Look up `assetId` WITHOUT refreshing its LRU timestamp. Returns
    // its handle, or ASSET_HANDLE_INVALID if it is not cached.
    findAsset(assetId) {
        this.requireAssetId(assetId, 'findAsset');
        const slot = this.findSlot(assetId);
        if (slot < 0)
            return ASSET_HANDLE_INVALID;
        return makeAssetHandle(slot, this.slotGeneration[slot] ?? 0);
    }
    // --- queries ---
    // The asset's slot state (SLOT_STATE_QUEUED / LOADING / RESIDENT),
    // or SLOT_STATE_FREE for a stale / invalid handle.
    getState(handle) {
        const slot = this.resolveSlot(handle);
        return slot < 0 ? SLOT_STATE_FREE : (this.slotState[slot] ?? SLOT_STATE_FREE);
    }
    // True only for a fully-loaded (RESIDENT) asset.
    isResident(handle) {
        return this.getState(handle) === SLOT_STATE_RESIDENT;
    }
    // The asset id behind `handle`, or -1 for a stale / invalid handle.
    getAssetId(handle) {
        const slot = this.resolveSlot(handle);
        return slot < 0 ? -1 : (this.slotAssetId[slot] ?? -1);
    }
    // The GPU texture handle to draw with: the real handle when the
    // asset is RESIDENT, otherwise the shared placeholder (so the caller
    // always has something drawable). 0 for a stale / invalid handle.
    getGpuHandle(handle) {
        const slot = this.resolveSlot(handle);
        if (slot < 0)
            return 0;
        if ((this.slotState[slot] ?? SLOT_STATE_FREE) === SLOT_STATE_RESIDENT) {
            return this.slotGpuHandle[slot] ?? 0;
        }
        return this.placeholderHandle;
    }
    // --- the load pipeline (gate 5) ---
    // Pop the next asset waiting to load, transitioning it QUEUED ->
    // LOADING, and return its handle. Returns ASSET_HANDLE_INVALID when
    // the load queue is empty. The deferred loader reads getAssetId,
    // loads the texture, and calls completeLoad.
    dequeueLoad() {
        if (this.loadQueueCount === 0)
            return ASSET_HANDLE_INVALID;
        this.loadQueueCount--;
        const slot = this.loadQueue[this.loadQueueCount] ?? 0;
        this.slotLoadIndex[slot] = -1;
        this.slotState[slot] = SLOT_STATE_LOADING;
        return makeAssetHandle(slot, this.slotGeneration[slot] ?? 0);
    }
    // Hand a loaded GPU texture back to the cache: LOADING -> RESIDENT.
    // Returns false - and queues `gpuHandle` for delayed destruction -
    // if the handle is stale (the asset was evicted while loading) or
    // the slot is not LOADING. So a stale loader's response is rejected
    // and its orphaned GPU resource is still safely cleaned up (gate 6).
    completeLoad(handle, gpuHandle, currentTick) {
        this.requireGpuHandle(gpuHandle, 'completeLoad');
        this.requireTick(currentTick, 'completeLoad');
        const slot = this.resolveSlot(handle);
        if (slot < 0 || (this.slotState[slot] ?? SLOT_STATE_FREE) !== SLOT_STATE_LOADING) {
            this.pushDestroy(gpuHandle, (currentTick + this.destroyDelay) >>> 0);
            return false;
        }
        this.slotGpuHandle[slot] = gpuHandle;
        this.slotState[slot] = SLOT_STATE_RESIDENT;
        return true;
    }
    // --- the destruction pipeline (gate 3) ---
    // Pop the next GPU handle whose destruction delay has elapsed, or
    // DESTROY_NONE if none is ready. The caller loops this every frame
    // and destroys each returned handle.
    drainDestroyed(currentTick) {
        this.requireTick(currentTick, 'drainDestroyed');
        if (this.destroyCount === 0)
            return DESTROY_NONE;
        const base = this.destroyHead * DESTROY_RECORD_STRIDE;
        const readyAtTick = this.destroyQueue[base + 1] ?? 0;
        // Wrap-safe "currentTick >= readyAtTick" (gate 4).
        if (((currentTick - readyAtTick) >>> 0) >= U32_HALF)
            return DESTROY_NONE;
        const gpuHandle = this.destroyQueue[base] ?? 0;
        this.destroyHead = (this.destroyHead + 1) % this.destroyQueueSize;
        this.destroyCount--;
        return gpuHandle;
    }
    // --- lifecycle ---
    // Graceful teardown: queue every resident GPU handle AND the shared
    // placeholder onto the destruction queue (with the normal delay -
    // the GPU may still be mid-frame), then reset the cache. The caller
    // keeps calling drainDestroyed afterward to release them.
    dispose(currentTick) {
        this.requireTick(currentTick, 'dispose');
        const readyAtTick = (currentTick + this.destroyDelay) >>> 0;
        for (let slot = 0; slot < this.tableSize; slot++) {
            if ((this.slotState[slot] ?? SLOT_STATE_FREE) === SLOT_STATE_RESIDENT) {
                this.pushDestroy(this.slotGpuHandle[slot] ?? 0, readyAtTick);
            }
        }
        if (this.placeholderHandle !== 0) {
            this.pushDestroy(this.placeholderHandle, readyAtTick);
            this.placeholderHandle = 0;
        }
        this.slotAssetId.fill(0);
        this.slotState.fill(SLOT_STATE_FREE);
        this.slotGpuHandle.fill(0);
        this.slotLastUsedTick.fill(0);
        this.slotGeneration.fill(0);
        this.slotLoadIndex.fill(-1);
        this.loadQueueCount = 0;
        this.cachedCount = 0;
    }
    // Hard reset to the constructed-but-empty state, INCLUDING the
    // destruction queue and the placeholder - the caller owns any GPU
    // cleanup. Use dispose() for a teardown that routes GPU handles
    // through the destruction queue.
    clear() {
        this.slotAssetId.fill(0);
        this.slotState.fill(SLOT_STATE_FREE);
        this.slotGpuHandle.fill(0);
        this.slotLastUsedTick.fill(0);
        this.slotGeneration.fill(0);
        this.slotLoadIndex.fill(-1);
        this.loadQueueCount = 0;
        this.destroyQueue.fill(0);
        this.destroyHead = 0;
        this.destroyCount = 0;
        this.cachedCount = 0;
        this.placeholderHandle = 0;
    }
    // --- private ---
    // Linear-probe for the slot holding `assetId`, or -1 if not cached.
    // Tombstones are probed past; a FREE slot ends the chain.
    findSlot(assetId) {
        const start = hashAssetId(assetId) & this.mask;
        for (let probe = 0; probe < this.tableSize; probe++) {
            const slot = (start + probe) & this.mask;
            const state = this.slotState[slot] ?? SLOT_STATE_FREE;
            if (state === SLOT_STATE_FREE)
                return -1;
            if (state === SLOT_STATE_TOMBSTONE)
                continue;
            if ((this.slotAssetId[slot] ?? 0) === assetId)
                return slot;
        }
        return -1;
    }
    // Claim a slot for `assetId`: the first FREE or TOMBSTONE on the
    // probe chain. Writes the asset id; the caller sets the state. The
    // table never overflows (tableSize is 2x capacity, touch evicts
    // first) - the throw is an invariant tripwire.
    registerSlot(assetId) {
        const start = hashAssetId(assetId) & this.mask;
        let firstTombstone = -1;
        let insertSlot = -1;
        for (let probe = 0; probe < this.tableSize; probe++) {
            const slot = (start + probe) & this.mask;
            const state = this.slotState[slot] ?? SLOT_STATE_FREE;
            if (state === SLOT_STATE_FREE) {
                insertSlot = firstTombstone >= 0 ? firstTombstone : slot;
                break;
            }
            if (state === SLOT_STATE_TOMBSTONE && firstTombstone < 0) {
                firstTombstone = slot;
            }
        }
        if (insertSlot < 0)
            insertSlot = firstTombstone;
        if (insertSlot < 0) {
            throw new Error('AssetVirtualizer: registry full - capacity invariant violated');
        }
        this.slotAssetId[insertSlot] = assetId;
        return insertSlot;
    }
    // Evict the least-recently-used cached slot. The victim maximizes
    // the UNSIGNED age (currentTick - lastUsedTick) >>> 0, which is
    // correct across a u32 tick wrap (gate 4). A RESIDENT victim's GPU
    // handle is queued for delayed destruction (gate 3).
    evictLRU(currentTick) {
        let victim = -1;
        let maxAge = -1;
        for (let slot = 0; slot < this.tableSize; slot++) {
            const state = this.slotState[slot] ?? SLOT_STATE_FREE;
            if (state !== SLOT_STATE_QUEUED && state !== SLOT_STATE_LOADING && state !== SLOT_STATE_RESIDENT) {
                continue;
            }
            const age = (currentTick - (this.slotLastUsedTick[slot] ?? 0)) >>> 0;
            if (age > maxAge) {
                maxAge = age;
                victim = slot;
            }
        }
        if (victim < 0) {
            throw new Error('AssetVirtualizer: evictLRU found no victim - cache invariant violated');
        }
        if ((this.slotState[victim] ?? SLOT_STATE_FREE) === SLOT_STATE_RESIDENT) {
            this.pushDestroy(this.slotGpuHandle[victim] ?? 0, (currentTick + this.destroyDelay) >>> 0);
        }
        this.freeSlot(victim);
    }
    // Free a slot: remove it from the load queue if queued, mark it a
    // tombstone, and bump its generation so every handle to it goes
    // stale (gate 6).
    freeSlot(slot) {
        if ((this.slotState[slot] ?? SLOT_STATE_FREE) === SLOT_STATE_QUEUED) {
            this.removeFromLoadQueue(slot);
        }
        this.slotState[slot] = SLOT_STATE_TOMBSTONE;
        this.slotGpuHandle[slot] = 0;
        this.slotGeneration[slot] = ((this.slotGeneration[slot] ?? 0) + 1) & ASSET_GENERATION_MASK;
        this.cachedCount--;
    }
    // Append a slot to the dense load queue.
    pushLoadQueue(slot) {
        this.loadQueue[this.loadQueueCount] = slot;
        this.slotLoadIndex[slot] = this.loadQueueCount;
        this.loadQueueCount++;
    }
    // Swap-pop a slot out of the dense load queue in O(1).
    removeFromLoadQueue(slot) {
        const idx = this.slotLoadIndex[slot] ?? -1;
        if (idx < 0)
            return;
        const lastIdx = this.loadQueueCount - 1;
        const lastSlot = this.loadQueue[lastIdx] ?? 0;
        this.loadQueue[idx] = lastSlot;
        this.slotLoadIndex[lastSlot] = idx;
        this.loadQueueCount = lastIdx;
        this.slotLoadIndex[slot] = -1;
    }
    // Append a GPU handle to the destruction-queue ring. Throws if the
    // ring is full - a caller that does not drain drainDestroyed.
    pushDestroy(gpuHandle, readyAtTick) {
        if (this.destroyCount >= this.destroyQueueSize) {
            throw new Error('AssetVirtualizer: destruction queue full (destroyQueueSize=' + this.destroyQueueSize
                + ') - drain it every frame with drainDestroyed');
        }
        const idx = (this.destroyHead + this.destroyCount) % this.destroyQueueSize;
        const base = idx * DESTROY_RECORD_STRIDE;
        this.destroyQueue[base] = gpuHandle;
        this.destroyQueue[base + 1] = readyAtTick;
        this.destroyCount++;
    }
    // Resolve a handle to its slot, or -1: a non-integer, an
    // out-of-range slot, a slot that holds no live asset (FREE /
    // TOMBSTONE), or a generation mismatch (the slot was evicted and
    // reused - a stale epoch).
    resolveSlot(handle) {
        if (!Number.isInteger(handle))
            return -1;
        const slot = assetSlot(handle);
        if (slot >= this.tableSize)
            return -1;
        const state = this.slotState[slot] ?? SLOT_STATE_FREE;
        if (state === SLOT_STATE_FREE || state === SLOT_STATE_TOMBSTONE)
            return -1;
        if ((this.slotGeneration[slot] ?? 0) !== assetGeneration(handle))
            return -1;
        return slot;
    }
    requireAssetId(assetId, op) {
        if (!Number.isInteger(assetId) || assetId < 0 || assetId >= this.maxAssetId) {
            throw new RangeError('AssetVirtualizer.' + op + ': assetId ' + assetId + ' out of [0, ' + this.maxAssetId + ')');
        }
    }
    requireTick(currentTick, op) {
        if (!Number.isInteger(currentTick) || currentTick < 0 || currentTick > U32_MAX) {
            throw new RangeError('AssetVirtualizer.' + op + ': currentTick must be an integer in [0, ' + U32_MAX + '], got ' + currentTick);
        }
    }
    requireGpuHandle(gpuHandle, op) {
        if (!Number.isInteger(gpuHandle) || gpuHandle < 1 || gpuHandle > U32_MAX) {
            throw new RangeError('AssetVirtualizer.' + op + ': gpuHandle must be an integer in [1, ' + U32_MAX + '], got ' + gpuHandle);
        }
    }
}
//# sourceMappingURL=asset-virtualizer.js.map