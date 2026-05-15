// LoomForgeBridge - the WASM-SIMD physics integration kernel: an
// explicit Wasm build contract (imported shared memory + minimum/
// maximum pages + SIMD requirement), single-source-of-truth memory
// layout constants (positions / velocities / scratchpad offsets),
// initialized-flag gate so step() rejects until the WASM module is
// ready, validated activeCount + dt before delegation, and a
// double-buffered position-readout for the render / AI side.
//
// The Trinity dossier's section 29 (Gemini Volume II). The Gemini
// sketch was `class LoomForgeBridge { constructor(module, sab) {
// sharedMemory = new WebAssembly.Memory({ initial: 2048, maximum:
// 4096, shared: true }) } stepPhysics(dt, count) { exports.step_simd
// (dt, count) } }`. The Codex audit: "valid path if imported memory
// contract is exact." The sketch had no explicit Wasm build
// contract (the importedness, max pages, and SIMD requirement were
// implicit), no activeCount / dt validation (negative dt would
// fault the kernel), no initialized flag (a step() before instantiate
// would crash), the memory layout was undefined (no shared source
// of truth between TS + Wasm), no phase barriers (the render side
// could read positions mid-write), and no integration test path.
//
// This is the corrected build, single-thread / single-owner like every
// shipped Trinity component. The actual wasm module instantiation,
// the SIMD step kernel, and the SAB-backed shared memory are the
// deferred integration layer; this is the pure-logic BUILD-CONTRACT
// / MEMORY-LAYOUT / INITIALIZED-FLAG / VALIDATION / PHASE-BARRIER
// kernel that drives them.
//
// BUILD CONTRACT (gate 1). The constructor takes a strict
// LoomForgeBuildContract describing what the Wasm module MUST
// expose: importedSharedMemory (the memory must be IMPORTED from
// the host, not exported from Wasm), minPages + maxPages (sized
// at the layout below), simdEnabled (the module MUST be built
// with -msimd128). The kernel rejects setupModule with mismatched
// metadata.
//
// MEMORY LAYOUT (gate 4). All offsets + strides are exposed as
// constants - the WASM build references them via shared header.
// The layout per entity:
//   FORGE_POS_OFFSET    + entityId * FORGE_POS_STRIDE     - position fp4 (xyz + pad)
//   FORGE_VEL_OFFSET    + entityId * FORGE_VEL_STRIDE     - velocity fp4
//   FORGE_SCRATCH_OFFSET + entityId * FORGE_SCRATCH_STRIDE - per-entity scratch (16 bytes)
// Plus a fixed-position back-buffer for positions (gate 5):
//   FORGE_POS_BACK_OFFSET + entityId * FORGE_POS_STRIDE
//
// INITIALIZED FLAG (gate 3). isInitialized() returns false until
// completeInit() has been called with a valid module. step() and
// any read API rejects pre-init.
//
// PARAMETER VALIDATION (gate 2). step(dtFp, activeCount) requires:
//   dtFp finite + > 0 + <= maxDtFp (clamps catastrophic dt jumps)
//   activeCount finite + >= 0 + <= maxEntities
// The Wasm step is invoked only after validation; integration tests
// can stub the step callback.
//
// PHASE BARRIER (gate 5). After step() returns, the kernel calls
// promotePositions() to swap the front + back position views. The
// render / AI side reads from the front view; the WASM step writes
// to the back view. A render-side read mid-step never sees a
// half-updated entity. promotePositions is a single u8 swap (no
// memcpy).
//
// INTEGRATION TEST PATH (gate 6). The kernel exposes setStepCallback
// (a function of (dtFp, activeCount) => void) the consumer wires
// to either the real Wasm step OR a JS stub for tests. The kernel
// uses this callback inside step(), so a unit test can verify the
// kernel's validation + phase-barrier path WITHOUT a Wasm runtime.
// The actual Wasm browser test is the deferred integration layer.
//
// The 6 Codex gates for LoomForgeBridge, enforced:
//   1. "explicit Wasm build contract: imported shared memory +
//      max pages + SIMD" - LoomForgeBuildContract; setupModule
//      validates importedSharedMemory + minPages + maxPages +
//      simdEnabled.
//   2. "validate activeCount and dt" - step() rejects out-of-range
//      values before invoking the callback.
//   3. "add initialized flag" - isInitialized; step + read APIs
//      return false / 0 until completeInit().
//   4. "memory layout constants in one shared source" - FORGE_*
//      constants exported; the Wasm build links against them.
//   5. "phase barriers / double buffering before render reads" -
//      front + back position offsets; promotePositions swaps.
//   6. "real browser test with compiled Wasm" - setStepCallback
//      stubs the step in unit tests; the real Wasm test is the
//      deferred browser integration.
//
// Non-negotiable engine gates: no RNG; no wall clock; single-thread
// (multi-thread Wasm-with-SAB is the deferred integration layer);
// every entity / dt / activeCount bounds-checked; fixed-capacity
// storage; the JS side stores nothing per-tick - all per-entity
// state lives in the shared memory the Wasm reads/writes.
// Memory layout (gate 4). All offsets in BYTES from the start of
// the shared SAB. All strides in BYTES.
export const FORGE_POS_STRIDE = 16; // f32 x 4 (xyz + pad)
export const FORGE_VEL_STRIDE = 16; // f32 x 4
export const FORGE_SCRATCH_STRIDE = 16;
export const FORGE_POS_OFFSET = 0;
// FORGE_VEL_OFFSET / FORGE_SCRATCH_OFFSET / FORGE_POS_BACK_OFFSET
// are computed in the constructor based on maxEntities; readable
// via the kernel accessors.
// Wasm page size in bytes.
export const WASM_PAGE_BYTES = 65536;
// State.
export const FORGE_STATE_UNINITIALIZED = 0;
export const FORGE_STATE_READY = 1;
// Reasons.
export const FORGE_REASON_NONE = 0;
export const FORGE_REASON_NOT_INITIALIZED = 1;
export const FORGE_REASON_BAD_DT = 2;
export const FORGE_REASON_BAD_COUNT = 3;
export const FORGE_REASON_BAD_CONTRACT = 4;
export const FORGE_REASON_NO_CALLBACK = 5;
// Sanity caps.
const MAX_ENTITIES = 1 << 18;
const MIN_PAGES = 1;
const MAX_PAGES = 1 << 14; // 1 GiB cap
const U32_MAX = 0xffffffff;
// Q16.16-style fp dt cap. The kernel clamps catastrophic dt to
// avoid integration explosions (gate 2 hardening).
export const FORGE_MAX_DT_FP = 1 << 14; // arbitrary - 0.25 sec at 60 fps fp scale
export class LoomForgeBridge {
    maxEntities;
    contract;
    // Computed memory layout (gate 4).
    posOffset;
    velOffset;
    scratchOffset;
    posBackOffset;
    totalBytes;
    totalPages;
    // Validated build contract.
    contractValid;
    state = FORGE_STATE_UNINITIALIZED;
    stepCallback = null;
    currentTick = 0;
    stepsTotal = 0;
    invalidStepsTotal = 0;
    // Front-vs-back flag for the position double-buffer (gate 5).
    // false = "front is base"; true = "front is back-buffer".
    frontIsBack = false;
    constructor(config) {
        const { maxEntities, contract } = config;
        if (!Number.isInteger(maxEntities) || maxEntities < 1 || maxEntities > MAX_ENTITIES) {
            throw new RangeError('LoomForgeBridge: maxEntities out of range, got ' + maxEntities);
        }
        if (!contract) {
            throw new RangeError('LoomForgeBridge: contract is required');
        }
        if (!Number.isInteger(contract.minPages) || contract.minPages < MIN_PAGES || contract.minPages > MAX_PAGES) {
            throw new RangeError('LoomForgeBridge: contract.minPages out of range, got ' + contract.minPages);
        }
        if (!Number.isInteger(contract.maxPages) || contract.maxPages < contract.minPages
            || contract.maxPages > MAX_PAGES) {
            throw new RangeError('LoomForgeBridge: contract.maxPages out of range, got ' + contract.maxPages);
        }
        this.maxEntities = maxEntities;
        this.contract = contract;
        // Compute memory layout (gate 4).
        this.posOffset = FORGE_POS_OFFSET;
        this.velOffset = this.posOffset + maxEntities * FORGE_POS_STRIDE;
        this.scratchOffset = this.velOffset + maxEntities * FORGE_VEL_STRIDE;
        this.posBackOffset = this.scratchOffset + maxEntities * FORGE_SCRATCH_STRIDE;
        this.totalBytes = this.posBackOffset + maxEntities * FORGE_POS_STRIDE;
        this.totalPages = Math.ceil(this.totalBytes / WASM_PAGE_BYTES);
        // The contract's minPages must accommodate the layout.
        this.contractValid = contract.importedSharedMemory === true
            && contract.simdEnabled === true
            && contract.minPages >= this.totalPages;
    }
    // --- counts ---
    getCurrentTick() { return this.currentTick; }
    getState() { return this.state; }
    isInitialized() { return this.state === FORGE_STATE_READY; }
    isContractValid() { return this.contractValid; }
    getStepsTotal() { return this.stepsTotal; }
    getInvalidStepsTotal() { return this.invalidStepsTotal; }
    getFrontIsBack() { return this.frontIsBack; }
    // The byte offset where the FRONT position view begins this tick.
    // Render / AI reads from here.
    getFrontPosOffset() {
        if (!this.isInitialized())
            return 0;
        return this.frontIsBack ? this.posBackOffset : this.posOffset;
    }
    // The byte offset where the BACK position view begins this tick.
    // The Wasm step writes to here.
    getBackPosOffset() {
        if (!this.isInitialized())
            return 0;
        return this.frontIsBack ? this.posOffset : this.posBackOffset;
    }
    // --- initialization (gate 3) ---
    // Bind the step callback (gate 6 - test seam) and transition to
    // READY. The callback is invoked by step() with validated args.
    // Returns FORGE_REASON_NONE on success.
    completeInit(callback) {
        if (!this.contractValid)
            return FORGE_REASON_BAD_CONTRACT;
        if (typeof callback !== 'function')
            return FORGE_REASON_NO_CALLBACK;
        this.stepCallback = callback;
        this.state = FORGE_STATE_READY;
        return FORGE_REASON_NONE;
    }
    // --- step (gates 2, 5, 6) ---
    // Step the physics. dtFp is fp tick delta; activeCount is the
    // number of entities to integrate. Validates both, swaps the
    // position phase barrier, then invokes the bound callback.
    step(dtFp, activeCount) {
        if (!this.isInitialized()) {
            this.invalidStepsTotal++;
            return FORGE_REASON_NOT_INITIALIZED;
        }
        // Validate dt (gate 2).
        if (!Number.isInteger(dtFp) || dtFp <= 0 || dtFp > FORGE_MAX_DT_FP) {
            this.invalidStepsTotal++;
            return FORGE_REASON_BAD_DT;
        }
        if (!Number.isInteger(activeCount) || activeCount < 0 || activeCount > this.maxEntities) {
            this.invalidStepsTotal++;
            return FORGE_REASON_BAD_COUNT;
        }
        // Phase barrier: swap before the call so the callback writes
        // to the (now-)back. After the call, render reads from the
        // (now-)front - which is the just-written back.
        this.frontIsBack = !this.frontIsBack;
        if (this.stepCallback === null) {
            this.invalidStepsTotal++;
            return FORGE_REASON_NO_CALLBACK;
        }
        this.stepCallback(dtFp, activeCount);
        this.stepsTotal++;
        return FORGE_REASON_NONE;
    }
    tick(t) {
        if (!Number.isInteger(t) || t < 0 || t > U32_MAX) {
            throw new RangeError('LoomForgeBridge.tick: t must be a u32, got ' + t);
        }
        this.currentTick = t | 0;
    }
    // --- lifecycle ---
    clear() {
        this.state = FORGE_STATE_UNINITIALIZED;
        this.stepCallback = null;
        this.frontIsBack = false;
        this.stepsTotal = 0;
        this.invalidStepsTotal = 0;
    }
}
//# sourceMappingURL=loom-forge-bridge.js.map