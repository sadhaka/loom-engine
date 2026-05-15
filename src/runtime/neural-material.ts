// NeuralMaterial - the runtime PBR-material synthesis kernel: an
// async job pipeline that takes (materialId, latentVector) requests,
// allocates an atlas slot, picks the best shader path the device can
// support, and tracks per-job latency so the consumer can budget the
// render frame.
//
// The Trinity dossier's section 17 (Gemini Volume I). The Gemini sketch
// was an `async synthesizeMaterial(materialId, device) { encoder
// = device.createCommandEncoder(); pass = encoder.beginComputePass();
// pass.setPipeline(this.pipeline); pass.dispatchWorkgroups(32,32);
// pass.end(); device.queue.submit([encoder.finish()]) }`. The Codex
// audit: "useful async generator, but WebGPU FP8 / Tensor Core claims
// are not portable." The sketch had no feature detection (assumed
// shader-f16 + packed 4x8), no f32 fallback path, no pixel / material
// bounds checks, no atlas / array-texture addressing for batched
// generation, no mipmap or LRU integration, and no GPU-timestamp
// benchmarking - it just synced + dispatched and prayed.
//
// This is the corrected build, single-thread / single-owner like every
// shipped Trinity component. The actual WebGPU device calls
// (createComputePipeline, dispatchWorkgroups, GPUTextureView,
// GPUTimestampQuerySet) are the deferred integration layer; this is
// the pure-logic JOB-QUEUE / ATLAS-LRU / PATH-SELECTION / LATENCY-
// TRACKER kernel that drives them.
//
// JOB QUEUE (gate 1). requestMaterial(materialId, latentVector,
// currentTick) atomically allocates an atlas slot (LRU-evicting the
// stalest material if full) and pushes an SoA job record onto the
// queue. The consumer drains with dequeueJob - one job at a time,
// no Promise-per-material - and dispatches to the deferred GPU
// encoder. completeJob(jobId, ...) finalises the slot to RESIDENT and
// records latency. This is the no-fan-out / no-microtask-flood
// pattern AssetVirtualizer uses too.
//
// CAPABILITY DETECTION (gate 2). The constructor takes a
// DeviceCapabilities bitset describing what the live GPU can do:
//   shader-f16, packed 4x8 dot product, RGBA16Float texture,
//   timestamp queries. Selection of the synthesis path is purely
//   from these flags - no runtime queries, no allocations.
//
// PATH SELECTION (gate 3). Three pipeline paths, in preference order:
//   PATH_PACKED_F16 - shader-f16 + packed-4x8 (best, ~4x throughput)
//   PATH_F16        - shader-f16 only (mid)
//   PATH_F32        - the universal fallback (every WebGPU device)
// pickPath(capabilities) returns the first path the device supports;
// this is THE feature gate - the Gemini sketch assumed PACKED_F16
// always. Each job records the path the dispatcher must use.
//
// ATLAS LRU + ARRAY ADDRESSING (gate 5, 6). Atlas is a logical 2D
// grid of (atlasCols * atlasRows) slots; the GPU side may back this
// with an array texture or a single big atlas texture - either way
// the slot index translates to (sliceIndex, u, v) coordinates the
// dispatcher writes into. Atlas eviction is wrap-safe LRU, mirroring
// AssetVirtualizer; an evicted slot's GPU resources go on a
// destruction queue with delay so the GPU finishes its current frame
// first. Mipmap-ready bits (gate 6) per slot track which mipmap
// levels have been generated; markMipmapReady(slot, levels) is
// called after the deferred GPU mipmap pass completes.
//
// BOUNDS CHECKS (gate 4). materialId, atlas slot, pixel coords (the
// per-job dispatch grid is always [0, dispatchTilePixels)) - all
// validated. Out-of-range inputs return INVALID sentinels rather
// than throwing, matching AssetVirtualizer.
//
// GPU TIMESTAMP BENCHMARKING (gate 7). completeJob takes a duration
// (the GPU-timestamp delta the deferred layer measured). The kernel
// stores the last benchmarkWindow samples in a ring; getLatencyP50
// / getLatencyP95 sort the window on demand for the frame budget.
// This is the data the dispatcher reads to decide "how many materials
// can I synthesize this frame without missing the budget."
//
// The 7 Codex gates for NeuralMaterial, enforced:
//   1. "treat synthesis as async asset generation" - request /
//      dequeue / complete pipeline; no Promise-per-material; the
//      deferred WebGPU dispatch is the integration layer.
//   2. "feature-detect shader-f16, packed 4x8, texture format" -
//      DeviceCapabilities bitset; selection is bit-test only.
//   3. "f32 fallback and non-packed weight path" - PATH_F32 is
//      always supported; PATH_F16 / PATH_PACKED_F16 are gated.
//   4. "bounds-check pixel coords and material IDs" -
//      requireMaterialId / requireSlot / requirePixelCoord; out of
//      range returns INVALID, never throws.
//   5. "use array textures or atlas addressing for batched
//      generation" - atlas slot allocator; getAtlasCoords(slot)
//      yields (sliceIndex, u, v) for the dispatch.
//   6. "mipmap generation and cache/LRU integration" - per-slot
//      mipmapReadyMask Uint8 (bit 0 = level 0 ready, etc.);
//      markMipmapReady; LRU eviction matches AssetVirtualizer.
//   7. "benchmark with GPU timestamps before frame-budget claims" -
//      completeJob(jobId, gpuDurationUs); rolling sample window;
//      getLatencyP50 / getLatencyP95.
//
// Non-negotiable engine gates: no RNG, no wall clock - currentTick
// is an injected parameter; no Atomics, no SAB; every materialId /
// slot / job-id bounds-checked; fixed-capacity storage - the queue
// drops past capacity with a counter (jobsDroppedTotal).

// Atlas slot lifecycle. FREE / QUEUED / SYNTHESIZING / RESIDENT are
// exported so the consumer can interpret getSlotState; TOMBSTONE is
// internal.
export const NEURAL_SLOT_STATE_FREE = 0;
export const NEURAL_SLOT_STATE_QUEUED = 1;       // job requested, waiting for dequeue
export const NEURAL_SLOT_STATE_SYNTHESIZING = 2; // dequeued; the GPU encoder owns it
export const NEURAL_SLOT_STATE_RESIDENT = 3;     // synthesized; mipmaps may still be in flight
const NEURAL_SLOT_STATE_TOMBSTONE = 4;

// Pipeline paths. Path indices match the order the deferred dispatcher
// looks up its compute pipeline by.
export const PATH_PACKED_F16 = 0;
export const PATH_F16 = 1;
export const PATH_F32 = 2;
export const PATH_INVALID = -1;

// DeviceCapabilities bit flags - OR these into a u32 the constructor
// consumes. Bit positions are stable so a snapshot with capabilities
// recorded survives engine upgrades.
export const CAP_SHADER_F16 = 1 << 0;
export const CAP_PACKED_4X8 = 1 << 1;
export const CAP_TEXTURE_RGBA16F = 1 << 2;
export const CAP_TIMESTAMP_QUERY = 1 << 3;

// Sentinels.
export const MATERIAL_HANDLE_INVALID = -1;
export const JOB_ID_INVALID = -1;
export const ATLAS_SLOT_INVALID = -1;
export const NEURAL_DESTROY_NONE = -1;

// Atlas slot handle layout (mirrors AssetVirtualizer): low 24 bits
// slot, high 8 bits generation. A handle to a slot that has since
// been evicted-and-reused fails generation validation.
const SLOT_INDEX_MASK = 0x00ffffff;
const SLOT_GENERATION_SHIFT = 24;
const SLOT_GENERATION_MASK = 0xff;

// Job record stride - dequeueJob writes 8 i32 values:
// [materialId, slot, generation, path, mipmapLevels, dispatchPx,
// requestedAtTick, jobId]. The deferred dispatcher uses these to
// pick the pipeline + dispatch + bind a texture view.
export const JOB_RECORD_STRIDE = 8;

// Latency record - completeJob stores [jobId, gpuDurationUs] in the
// rolling sample window.
const LATENCY_RECORD_STRIDE = 2;

// Sanity caps on config - guards so bad arguments throw a clear error
// instead of attempting absurd typed-array allocations.
const MAX_ATLAS_SLOTS = 1 << 16;
const MAX_MATERIAL_ID = 1 << 24;
const MAX_LATENT_DIM = 256;
const MAX_DISPATCH_PIXELS = 4096;
const MAX_JOB_QUEUE = 1 << 14;
const MAX_DESTROY_QUEUE = 1 << 14;
const MAX_DESTROY_DELAY = 1 << 16;
const MAX_BENCHMARK_WINDOW = 1 << 12;
const MAX_MIPMAP_LEVELS = 8;
const U32_MAX = 0xffffffff;

// Smallest power of two >= n (n >= 1).
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// Murmur3-style integer finalizer for materialId hashing.
function hashMaterialId(id: number): number {
  let h = id >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export type NeuralMaterialHandle = number;

export function makeNeuralMaterialHandle(slot: number, generation: number): NeuralMaterialHandle {
  return ((generation & SLOT_GENERATION_MASK) << SLOT_GENERATION_SHIFT)
    | (slot & SLOT_INDEX_MASK);
}

export function neuralMaterialSlot(handle: NeuralMaterialHandle): number {
  return handle & SLOT_INDEX_MASK;
}

export function neuralMaterialGeneration(handle: NeuralMaterialHandle): number {
  return (handle >>> SLOT_GENERATION_SHIFT) & SLOT_GENERATION_MASK;
}

// Pick the best supported path for the live device's capabilities.
// Returns PATH_INVALID if the device does not even support PATH_F32
// (which would mean a non-WebGPU device, in which case the kernel
// should not have been instantiated).
export function pickPath(capabilities: number): number {
  // PATH_F32 is universal; PATH_F16 needs CAP_SHADER_F16; PATH_PACKED_F16
  // needs both. We always have PATH_F32 - the gate-3 universal fallback.
  if ((capabilities & (CAP_SHADER_F16 | CAP_PACKED_4X8)) === (CAP_SHADER_F16 | CAP_PACKED_4X8)) {
    return PATH_PACKED_F16;
  }
  if ((capabilities & CAP_SHADER_F16) !== 0) {
    return PATH_F16;
  }
  return PATH_F32;
}

export interface NeuralMaterialConfig {
  // Atlas geometry - logical slots = atlasCols * atlasRows. The GPU
  // side may use an array texture (one slice per sliceCapacity slots)
  // or one big atlas; the math here is identical.
  atlasCols: number;
  atlasRows: number;
  // Capacity per atlas slice - if the GPU side uses an array texture,
  // sliceCapacity = atlasCols * atlasRows yields a single-slice
  // mapping; smaller values pack across multiple slices.
  sliceCapacity: number;
  // The materialId space upper bound.
  maxMaterialId: number;
  // Latent vector length per material - the deferred dispatcher reads
  // (latentDim) f32 weights per job. Bounded by MAX_LATENT_DIM.
  latentDim: number;
  // Per-job dispatch tile in pixels (square). dispatchTilePixels x
  // dispatchTilePixels = the per-material output texture size.
  dispatchTilePixels: number;
  // Number of mipmap levels to generate per material (>= 1; 1 = no
  // mipmaps). <= MAX_MIPMAP_LEVELS.
  mipmapLevels: number;
  // Job queue capacity - a backpressured drop happens past this
  // (jobsDroppedTotal counts).
  jobQueueCapacity: number;
  // Destruction queue capacity (delayed GPU resource release, mirrors
  // AssetVirtualizer). Must be >= the atlas slot count + 1.
  destroyQueueCapacity: number;
  // Eviction-to-destruction delay in ticks.
  destroyDelay: number;
  // Latency benchmark sample-window size; getLatencyP50 / P95 read
  // these. Larger window = more stable percentile, slower sort.
  benchmarkWindow: number;
  // Device capabilities (CAP_* OR'd together). Constructor picks the
  // path once; the consumer can call setCapabilities to re-pick if
  // the device is recreated.
  capabilities: number;
}

export class NeuralMaterial {
  readonly atlasCols: number;
  readonly atlasRows: number;
  readonly atlasSlotCount: number;
  readonly sliceCapacity: number;
  readonly maxMaterialId: number;
  readonly latentDim: number;
  readonly dispatchTilePixels: number;
  readonly mipmapLevels: number;
  readonly jobQueueCapacity: number;
  readonly destroyQueueCapacity: number;
  readonly destroyDelay: number;
  readonly benchmarkWindow: number;
  // Hash table size: 2x the atlas slot count, a power of two.
  readonly hashTableSize: number;

  private readonly hashMask: number;

  // Slot columns, indexed by slot, sized hashTableSize. The atlas
  // logical index is recovered from slot via slotToAtlasIndex.
  private readonly slotMaterialId: Int32Array;
  private readonly slotState: Uint8Array;
  private readonly slotGeneration: Uint8Array;
  private readonly slotLastUsedTick: Uint32Array;
  private readonly slotMipmapReady: Uint8Array;     // bit i = mipmap level i ready
  private readonly slotAtlasIndex: Int32Array;      // dense atlas slot in [0, atlasSlotCount)

  // Per-atlas-slot reverse lookup; -1 if unassigned.
  private readonly atlasSlotToTableSlot: Int32Array;

  // Job queue (SoA, drained one record at a time).
  private readonly jobMaterialId: Int32Array;
  private readonly jobSlot: Int32Array;
  private readonly jobGeneration: Uint8Array;
  private readonly jobPath: Uint8Array;
  private readonly jobRequestedAtTick: Uint32Array;
  private readonly jobId: Int32Array;
  private jobHead: number = 0;
  private jobTail: number = 0;
  private nextJobId: number = 1;     // jobId 0 reserved as INVALID-but-not-quite

  // Destruction queue ring (mirrors AssetVirtualizer). Each record:
  // [atlasIndex, readyAtTick].
  private readonly destroyAtlasIndex: Int32Array;
  private readonly destroyReadyAtTick: Uint32Array;
  private destroyHead: number = 0;
  private destroyCount: number = 0;

  // Latency benchmark ring.
  private readonly latencyBuffer: Uint32Array;
  private latencyHead: number = 0;
  private latencyCount: number = 0;

  // Counts.
  private cachedCount: number = 0;
  private jobsDroppedTotal: number = 0;
  private completedJobsTotal: number = 0;

  // Capability bits + selected path (gate 2, 3).
  private capabilities: number;
  private selectedPath: number;

  constructor(config: NeuralMaterialConfig) {
    const {
      atlasCols, atlasRows, sliceCapacity, maxMaterialId, latentDim,
      dispatchTilePixels, mipmapLevels, jobQueueCapacity, destroyQueueCapacity,
      destroyDelay, benchmarkWindow, capabilities,
    } = config;
    if (!Number.isInteger(atlasCols) || atlasCols < 1 || atlasCols > MAX_ATLAS_SLOTS) {
      throw new RangeError('NeuralMaterial: atlasCols out of range, got ' + atlasCols);
    }
    if (!Number.isInteger(atlasRows) || atlasRows < 1 || atlasRows > MAX_ATLAS_SLOTS) {
      throw new RangeError('NeuralMaterial: atlasRows out of range, got ' + atlasRows);
    }
    const slotCount = atlasCols * atlasRows;
    if (slotCount > MAX_ATLAS_SLOTS) {
      throw new RangeError('NeuralMaterial: atlasCols*atlasRows must be <= ' + MAX_ATLAS_SLOTS + ', got ' + slotCount);
    }
    if (!Number.isInteger(sliceCapacity) || sliceCapacity < 1 || sliceCapacity > slotCount) {
      throw new RangeError('NeuralMaterial: sliceCapacity must be in [1, ' + slotCount + '], got ' + sliceCapacity);
    }
    if (!Number.isInteger(maxMaterialId) || maxMaterialId < 1 || maxMaterialId > MAX_MATERIAL_ID) {
      throw new RangeError('NeuralMaterial: maxMaterialId out of range, got ' + maxMaterialId);
    }
    if (!Number.isInteger(latentDim) || latentDim < 1 || latentDim > MAX_LATENT_DIM) {
      throw new RangeError('NeuralMaterial: latentDim out of range, got ' + latentDim);
    }
    if (!Number.isInteger(dispatchTilePixels) || dispatchTilePixels < 1 || dispatchTilePixels > MAX_DISPATCH_PIXELS) {
      throw new RangeError('NeuralMaterial: dispatchTilePixels out of range, got ' + dispatchTilePixels);
    }
    if (!Number.isInteger(mipmapLevels) || mipmapLevels < 1 || mipmapLevels > MAX_MIPMAP_LEVELS) {
      throw new RangeError('NeuralMaterial: mipmapLevels out of range, got ' + mipmapLevels);
    }
    if (!Number.isInteger(jobQueueCapacity) || jobQueueCapacity < 1 || jobQueueCapacity > MAX_JOB_QUEUE) {
      throw new RangeError('NeuralMaterial: jobQueueCapacity out of range, got ' + jobQueueCapacity);
    }
    if (!Number.isInteger(destroyQueueCapacity) || destroyQueueCapacity < slotCount + 1
      || destroyQueueCapacity > MAX_DESTROY_QUEUE) {
      throw new RangeError('NeuralMaterial: destroyQueueCapacity must be in ['
        + (slotCount + 1) + ', ' + MAX_DESTROY_QUEUE + '], got ' + destroyQueueCapacity);
    }
    if (!Number.isInteger(destroyDelay) || destroyDelay < 0 || destroyDelay > MAX_DESTROY_DELAY) {
      throw new RangeError('NeuralMaterial: destroyDelay out of range, got ' + destroyDelay);
    }
    if (!Number.isInteger(benchmarkWindow) || benchmarkWindow < 1 || benchmarkWindow > MAX_BENCHMARK_WINDOW) {
      throw new RangeError('NeuralMaterial: benchmarkWindow out of range, got ' + benchmarkWindow);
    }
    if (!Number.isInteger(capabilities) || capabilities < 0 || capabilities > 0xffff) {
      throw new RangeError('NeuralMaterial: capabilities must be in [0, 65535], got ' + capabilities);
    }

    this.atlasCols = atlasCols;
    this.atlasRows = atlasRows;
    this.atlasSlotCount = slotCount;
    this.sliceCapacity = sliceCapacity;
    this.maxMaterialId = maxMaterialId;
    this.latentDim = latentDim;
    this.dispatchTilePixels = dispatchTilePixels;
    this.mipmapLevels = mipmapLevels;
    this.jobQueueCapacity = jobQueueCapacity;
    this.destroyQueueCapacity = destroyQueueCapacity;
    this.destroyDelay = destroyDelay;
    this.benchmarkWindow = benchmarkWindow;
    this.hashTableSize = 2 * nextPow2(slotCount);
    this.hashMask = this.hashTableSize - 1;
    this.capabilities = capabilities;
    this.selectedPath = pickPath(capabilities);

    this.slotMaterialId = new Int32Array(this.hashTableSize).fill(-1);
    this.slotState = new Uint8Array(this.hashTableSize);
    this.slotGeneration = new Uint8Array(this.hashTableSize);
    this.slotLastUsedTick = new Uint32Array(this.hashTableSize);
    this.slotMipmapReady = new Uint8Array(this.hashTableSize);
    this.slotAtlasIndex = new Int32Array(this.hashTableSize).fill(-1);
    this.atlasSlotToTableSlot = new Int32Array(this.atlasSlotCount).fill(-1);

    this.jobMaterialId = new Int32Array(jobQueueCapacity);
    this.jobSlot = new Int32Array(jobQueueCapacity);
    this.jobGeneration = new Uint8Array(jobQueueCapacity);
    this.jobPath = new Uint8Array(jobQueueCapacity);
    this.jobRequestedAtTick = new Uint32Array(jobQueueCapacity);
    this.jobId = new Int32Array(jobQueueCapacity);

    this.destroyAtlasIndex = new Int32Array(destroyQueueCapacity);
    this.destroyReadyAtTick = new Uint32Array(destroyQueueCapacity);

    this.latencyBuffer = new Uint32Array(benchmarkWindow * LATENCY_RECORD_STRIDE);
  }

  // --- counts ---

  getCachedCount(): number { return this.cachedCount; }
  getJobQueueCount(): number { return this.jobTail - this.jobHead; }
  getJobsDroppedTotal(): number { return this.jobsDroppedTotal; }
  getCompletedJobsTotal(): number { return this.completedJobsTotal; }
  getDestroyQueueCount(): number { return this.destroyCount; }
  getLatencySampleCount(): number { return this.latencyCount; }
  getCapabilities(): number { return this.capabilities; }
  getSelectedPath(): number { return this.selectedPath; }

  // --- capability re-detection (gate 2) ---

  // Re-pick the synthesis path. Used when the GPU device is recreated
  // (e.g. tab focus / device-lost recovery).
  setCapabilities(capabilities: number): void {
    if (!Number.isInteger(capabilities) || capabilities < 0 || capabilities > 0xffff) return;
    this.capabilities = capabilities;
    this.selectedPath = pickPath(capabilities);
  }

  // --- material request (gates 1, 4, 5) ---

  // Request synthesis of `materialId`, allocating an atlas slot if
  // necessary. Returns a NeuralMaterialHandle, or MATERIAL_HANDLE_INVALID
  // if materialId is out of range. If the material is already cached
  // (QUEUED / SYNTHESIZING / RESIDENT), refresh its LRU timestamp and
  // return the existing handle. Otherwise allocate (LRU-evicting if
  // full), enqueue a job, and return the handle.
  requestMaterial(materialId: number, currentTick: number): NeuralMaterialHandle {
    if (!this.requireMaterialId(materialId)) return MATERIAL_HANDLE_INVALID;
    if (!this.requireTick(currentTick)) return MATERIAL_HANDLE_INVALID;
    const found = this.findSlot(materialId);
    if (found >= 0) {
      this.slotLastUsedTick[found] = currentTick >>> 0;
      return makeNeuralMaterialHandle(found, this.slotGeneration[found] ?? 0);
    }
    if (this.cachedCount >= this.atlasSlotCount) {
      this.evictLRU(currentTick);
    }
    const slot = this.registerSlot(materialId);
    if (slot < 0) return MATERIAL_HANDLE_INVALID;
    this.slotState[slot] = NEURAL_SLOT_STATE_QUEUED;
    this.slotLastUsedTick[slot] = currentTick >>> 0;
    this.slotMipmapReady[slot] = 0;
    this.cachedCount++;
    // Allocate an atlas index.
    const atlasIdx = this.allocAtlasIndex();
    if (atlasIdx < 0) {
      // No free atlas index (shouldn't happen if cachedCount tracks
      // correctly) - fail the request.
      this.unregisterSlot(slot);
      return MATERIAL_HANDLE_INVALID;
    }
    this.slotAtlasIndex[slot] = atlasIdx;
    this.atlasSlotToTableSlot[atlasIdx] = slot;
    // Enqueue the job.
    if (this.jobTail - this.jobHead >= this.jobQueueCapacity) {
      this.jobsDroppedTotal++;
      // Slot stays QUEUED but no job will dispatch - the consumer will
      // never call complete; the slot will eventually be LRU'd.
    } else {
      const qSlot = this.jobTail % this.jobQueueCapacity;
      this.jobMaterialId[qSlot] = materialId | 0;
      this.jobSlot[qSlot] = slot | 0;
      this.jobGeneration[qSlot] = this.slotGeneration[slot] ?? 0;
      this.jobPath[qSlot] = this.selectedPath & 0xff;
      this.jobRequestedAtTick[qSlot] = currentTick >>> 0;
      this.jobId[qSlot] = this.nextJobId++;
      this.jobTail++;
    }
    return makeNeuralMaterialHandle(slot, this.slotGeneration[slot] ?? 0);
  }

  // --- job pipeline (gates 1, 5, 6) ---

  // Drain one job. Writes JOB_RECORD_STRIDE i32 values into out at
  // outOffset: [materialId, slot, generation, path, mipmapLevels,
  // dispatchTilePixels, requestedAtTick, jobId]. Returns false if the
  // queue is empty or out is too small.
  dequeueJob(out: Int32Array, outOffset: number = 0): boolean {
    if (this.jobHead >= this.jobTail) return false;
    if (outOffset < 0 || outOffset + JOB_RECORD_STRIDE > out.length) return false;
    const qSlot = this.jobHead % this.jobQueueCapacity;
    const slot = this.jobSlot[qSlot] ?? -1;
    const gen = this.jobGeneration[qSlot] ?? 0;
    // If the slot was evicted between request and dequeue, skip the
    // job (it's stale; the slot is now serving a different material).
    if (slot < 0 || (this.slotGeneration[slot] ?? 0) !== gen
      || this.slotState[slot] !== NEURAL_SLOT_STATE_QUEUED) {
      this.jobHead++;
      return this.dequeueJob(out, outOffset);     // tail-call into the next job
    }
    out[outOffset + 0] = this.jobMaterialId[qSlot] ?? 0;
    out[outOffset + 1] = slot;
    out[outOffset + 2] = gen;
    out[outOffset + 3] = this.jobPath[qSlot] ?? 0;
    out[outOffset + 4] = this.mipmapLevels;
    out[outOffset + 5] = this.dispatchTilePixels;
    out[outOffset + 6] = this.jobRequestedAtTick[qSlot] ?? 0;
    out[outOffset + 7] = this.jobId[qSlot] ?? 0;
    // Mark slot as SYNTHESIZING (the GPU encoder owns it now).
    this.slotState[slot] = NEURAL_SLOT_STATE_SYNTHESIZING;
    this.jobHead++;
    return true;
  }

  // Mark a job complete. handle binds the slot the job was about;
  // gpuDurationUs is the GPU-timestamp delta the deferred layer
  // measured. Slot transitions SYNTHESIZING -> RESIDENT. A stale
  // handle (slot evicted while the GPU was working) is rejected.
  completeJob(handle: NeuralMaterialHandle, jobId: number, gpuDurationUs: number): boolean {
    const slot = neuralMaterialSlot(handle);
    const gen = neuralMaterialGeneration(handle);
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.hashTableSize) return false;
    if ((this.slotGeneration[slot] ?? 0) !== gen) return false;
    if (this.slotState[slot] !== NEURAL_SLOT_STATE_SYNTHESIZING) return false;
    if (!Number.isInteger(jobId) || jobId < 1) return false;
    if (!Number.isInteger(gpuDurationUs) || gpuDurationUs < 0 || gpuDurationUs > U32_MAX) return false;
    this.slotState[slot] = NEURAL_SLOT_STATE_RESIDENT;
    // Mark mip level 0 ready by default; consumer calls
    // markMipmapReady for the rest as their downsample passes finish.
    this.slotMipmapReady[slot] = 1;
    this.completedJobsTotal++;
    // Record the latency sample.
    const lSlot = this.latencyHead;
    this.latencyBuffer[lSlot * LATENCY_RECORD_STRIDE + 0] = jobId >>> 0;
    this.latencyBuffer[lSlot * LATENCY_RECORD_STRIDE + 1] = gpuDurationUs >>> 0;
    this.latencyHead = (this.latencyHead + 1) % this.benchmarkWindow;
    if (this.latencyCount < this.benchmarkWindow) this.latencyCount++;
    return true;
  }

  // --- mipmaps (gate 6) ---

  // Mark mipmap level `level` as ready for `handle`. Multiple mipmap
  // levels can be marked across multiple frames as the deferred GPU
  // mipmap pipeline finishes them.
  markMipmapReady(handle: NeuralMaterialHandle, level: number): boolean {
    const slot = neuralMaterialSlot(handle);
    const gen = neuralMaterialGeneration(handle);
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.hashTableSize) return false;
    if ((this.slotGeneration[slot] ?? 0) !== gen) return false;
    if (this.slotState[slot] !== NEURAL_SLOT_STATE_RESIDENT) return false;
    if (!Number.isInteger(level) || level < 0 || level >= this.mipmapLevels) return false;
    const cur = this.slotMipmapReady[slot] ?? 0;
    this.slotMipmapReady[slot] = (cur | (1 << level)) & 0xff;
    return true;
  }

  // Return the bitmask of mipmap levels ready for `handle`. 0 if the
  // material is not yet RESIDENT.
  getMipmapReady(handle: NeuralMaterialHandle): number {
    const slot = neuralMaterialSlot(handle);
    const gen = neuralMaterialGeneration(handle);
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.hashTableSize) return 0;
    if ((this.slotGeneration[slot] ?? 0) !== gen) return 0;
    return this.slotMipmapReady[slot] ?? 0;
  }

  // --- atlas addressing (gate 5) ---

  // Translate a slot's atlas index into (sliceIndex, u, v). u and v
  // are in [0, atlasCols) and [0, atlasRows) on the slice (consumers
  // multiply by dispatchTilePixels for pixel offsets).
  getAtlasCoords(handle: NeuralMaterialHandle, out: Int32Array, outOffset: number = 0): boolean {
    const slot = neuralMaterialSlot(handle);
    const gen = neuralMaterialGeneration(handle);
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.hashTableSize) return false;
    if ((this.slotGeneration[slot] ?? 0) !== gen) return false;
    if (outOffset < 0 || outOffset + 3 > out.length) return false;
    const atlasIdx = this.slotAtlasIndex[slot] ?? -1;
    if (atlasIdx < 0) return false;
    const sliceIndex = Math.floor(atlasIdx / this.sliceCapacity);
    const inSlice = atlasIdx - sliceIndex * this.sliceCapacity;
    const v = Math.floor(inSlice / this.atlasCols);
    const u = inSlice - v * this.atlasCols;
    out[outOffset + 0] = sliceIndex;
    out[outOffset + 1] = u;
    out[outOffset + 2] = v;
    return true;
  }

  // --- destruction queue (gate 6 - delayed GPU resource release) ---

  // Drain one destruction record once it is past its readyAtTick.
  // Returns the freed atlas index, or NEURAL_DESTROY_NONE if the front
  // record is not yet ready (or the queue is empty). The deferred
  // dispatcher releases the GPU texture view at this point.
  drainDestroyed(currentTick: number): number {
    if (this.destroyCount === 0) return NEURAL_DESTROY_NONE;
    if (!this.requireTick(currentTick)) return NEURAL_DESTROY_NONE;
    const slotPos = this.destroyHead;
    const readyAt = this.destroyReadyAtTick[slotPos] ?? 0;
    // Wrap-safe "currentTick >= readyAt": if the unsigned diff is in
    // the high half (> 2^31), the destroy is in the future.
    if (((currentTick - readyAt) >>> 0) >= 0x80000000) return NEURAL_DESTROY_NONE;
    const atlasIdx = this.destroyAtlasIndex[slotPos] ?? -1;
    this.destroyHead = (this.destroyHead + 1) % this.destroyQueueCapacity;
    this.destroyCount--;
    return atlasIdx;
  }

  // --- latency benchmark (gate 7) ---

  // 50th-percentile GPU duration over the rolling sample window, in
  // microseconds. Returns 0 if no samples yet.
  getLatencyP50(): number {
    return this.percentile(0.5);
  }

  // 95th-percentile GPU duration over the rolling sample window, in
  // microseconds. Returns 0 if no samples yet.
  getLatencyP95(): number {
    return this.percentile(0.95);
  }

  private percentile(p: number): number {
    if (this.latencyCount === 0) return 0;
    // Copy the durations into a scratch array, sort, pick.
    const samples = new Uint32Array(this.latencyCount);
    for (let i = 0; i < this.latencyCount; i++) {
      samples[i] = this.latencyBuffer[i * LATENCY_RECORD_STRIDE + 1] ?? 0;
    }
    // In-place sort - Uint32Array's sort is by lex by default; pass
    // a numeric comparator.
    samples.sort((a, b) => a - b);
    const idx = Math.min(this.latencyCount - 1, Math.floor(p * this.latencyCount));
    return samples[idx] ?? 0;
  }

  // --- slot table primitives ---

  // Find a slot for a given materialId; returns the slot, or -1.
  private findSlot(materialId: number): number {
    const start = hashMaterialId(materialId);
    for (let probe = 0; probe < this.hashTableSize; probe++) {
      const slot = (start + probe) & this.hashMask;
      const id = this.slotMaterialId[slot] ?? -1;
      const state = this.slotState[slot] ?? 0;
      if (id < 0 && state === NEURAL_SLOT_STATE_FREE) return -1;       // EMPTY
      if (state === NEURAL_SLOT_STATE_TOMBSTONE) continue;
      if (id === materialId) return slot;
    }
    return -1;
  }

  // Allocate a slot for a new materialId, using the first FREE or
  // TOMBSTONE slot in the probe chain. Returns slot or -1 if full.
  private registerSlot(materialId: number): number {
    const start = hashMaterialId(materialId);
    let firstTombstone = -1;
    for (let probe = 0; probe < this.hashTableSize; probe++) {
      const slot = (start + probe) & this.hashMask;
      const state = this.slotState[slot] ?? 0;
      if (state === NEURAL_SLOT_STATE_TOMBSTONE) {
        if (firstTombstone < 0) firstTombstone = slot;
        continue;
      }
      if (state === NEURAL_SLOT_STATE_FREE) {
        const target = firstTombstone >= 0 ? firstTombstone : slot;
        this.slotMaterialId[target] = materialId | 0;
        // Bump generation on registration (gate 5/6 staleness epoch).
        this.slotGeneration[target] = ((this.slotGeneration[target] ?? 0) + 1) & SLOT_GENERATION_MASK;
        return target;
      }
    }
    if (firstTombstone >= 0) {
      this.slotMaterialId[firstTombstone] = materialId | 0;
      this.slotGeneration[firstTombstone] = ((this.slotGeneration[firstTombstone] ?? 0) + 1) & SLOT_GENERATION_MASK;
      return firstTombstone;
    }
    return -1;
  }

  // Remove a slot's contents (post-eviction or rollback).
  private unregisterSlot(slot: number): void {
    this.slotMaterialId[slot] = -1;
    this.slotState[slot] = NEURAL_SLOT_STATE_TOMBSTONE;
    const atlasIdx = this.slotAtlasIndex[slot] ?? -1;
    this.slotAtlasIndex[slot] = -1;
    this.slotMipmapReady[slot] = 0;
    if (atlasIdx >= 0) {
      this.atlasSlotToTableSlot[atlasIdx] = -1;
      // Queue for destruction.
      if (this.destroyCount < this.destroyQueueCapacity) {
        const tail = (this.destroyHead + this.destroyCount) % this.destroyQueueCapacity;
        this.destroyAtlasIndex[tail] = atlasIdx;
        this.destroyReadyAtTick[tail] = ((this.slotLastUsedTick[slot] ?? 0) + this.destroyDelay) >>> 0;
        this.destroyCount++;
      }
    }
  }

  // Allocate the lowest-indexed free atlas slot. O(atlasSlotCount) -
  // the atlas is small enough this is fine.
  private allocAtlasIndex(): number {
    for (let i = 0; i < this.atlasSlotCount; i++) {
      if ((this.atlasSlotToTableSlot[i] ?? -1) < 0) return i;
    }
    return -1;
  }

  // LRU eviction: unsigned (currentTick - lastUsedTick) max wins.
  // Wrap-safe so a u32 wrap doesn't mis-rank.
  private evictLRU(currentTick: number): void {
    let victim = -1;
    let victimAge = -1;
    for (let i = 0; i < this.hashTableSize; i++) {
      const state = this.slotState[i] ?? 0;
      if (state === NEURAL_SLOT_STATE_FREE || state === NEURAL_SLOT_STATE_TOMBSTONE) continue;
      const age = ((currentTick - (this.slotLastUsedTick[i] ?? 0)) >>> 0);
      if (age > victimAge) { victim = i; victimAge = age; }
    }
    if (victim < 0) return;
    // Bump generation to invalidate any in-flight job on this slot.
    this.slotGeneration[victim] = ((this.slotGeneration[victim] ?? 0) + 1) & SLOT_GENERATION_MASK;
    this.unregisterSlot(victim);
    this.cachedCount--;
  }

  // --- bounds check helpers (gate 4) ---

  private requireMaterialId(id: number): boolean {
    return Number.isInteger(id) && id >= 0 && id < this.maxMaterialId;
  }

  private requireTick(t: number): boolean {
    return Number.isInteger(t) && t >= 0 && t <= 0xffffffff;
  }

  // Public bounds check for pixel coords - the consumer's deferred
  // GPU pass calls this before writing pixels (gate 4).
  isValidPixelCoord(u: number, v: number): boolean {
    if (!Number.isInteger(u) || !Number.isInteger(v)) return false;
    if (u < 0 || v < 0) return false;
    if (u >= this.dispatchTilePixels || v >= this.dispatchTilePixels) return false;
    return true;
  }

  // Read a slot's state - the consumer uses this to tell hit /
  // freshly-queued / synthesizing / resident apart.
  getSlotState(handle: NeuralMaterialHandle): number {
    const slot = neuralMaterialSlot(handle);
    const gen = neuralMaterialGeneration(handle);
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.hashTableSize) return NEURAL_SLOT_STATE_FREE;
    if ((this.slotGeneration[slot] ?? 0) !== gen) return NEURAL_SLOT_STATE_FREE;
    return this.slotState[slot] ?? NEURAL_SLOT_STATE_FREE;
  }

  // --- lifecycle ---

  // Reset every slot, queue, and counter; leaves backing arrays
  // allocated. After clear() the kernel is in its constructor state
  // (capabilities + selectedPath preserved).
  clear(): void {
    this.slotMaterialId.fill(-1);
    this.slotState.fill(0);
    this.slotGeneration.fill(0);
    this.slotLastUsedTick.fill(0);
    this.slotMipmapReady.fill(0);
    this.slotAtlasIndex.fill(-1);
    this.atlasSlotToTableSlot.fill(-1);
    this.jobMaterialId.fill(0);
    this.jobSlot.fill(0);
    this.jobGeneration.fill(0);
    this.jobPath.fill(0);
    this.jobRequestedAtTick.fill(0);
    this.jobId.fill(0);
    this.jobHead = 0;
    this.jobTail = 0;
    this.nextJobId = 1;
    this.destroyAtlasIndex.fill(0);
    this.destroyReadyAtTick.fill(0);
    this.destroyHead = 0;
    this.destroyCount = 0;
    this.latencyBuffer.fill(0);
    this.latencyHead = 0;
    this.latencyCount = 0;
    this.cachedCount = 0;
    this.jobsDroppedTotal = 0;
    this.completedJobsTotal = 0;
  }
}
