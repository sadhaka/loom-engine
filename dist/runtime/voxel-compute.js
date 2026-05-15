// VoxelComputeSystem - the marching-cubes voxel mesher: per-chunk
// SoA density + material buffers, double-buffered chunk epochs for
// race-free CPU-to-GPU sync, externally-loaded edge / triangle
// lookup tables (256 entries each, the canonical Bourke MC tables),
// real corner indexing + linear interpolation, capacity-checked
// vertex emission with a counter-readback path, and a pre-allocated
// counter-reset buffer for the GPU dispatcher's atomicReset pass.
//
// The Trinity dossier's section 24 (Gemini Volume II). The Gemini
// sketch was the bare WGSL shader skeleton with `let vIdx = atomicAdd
// (&atomicCounter, 3u); // Write triangle to outVertices`. The
// Codex audit: "interesting but shader is not complete and buffer
// sizing is unsafe." The sketch had no bound edge / tri tables (the
// pipeline would fail validation), no vertex capacity check (a
// dispatch could overflow outVertices), no atomic counter reset
// path (every dispatch leaked into the next), no real corner
// indexing or interpolation (the shader stub never wrote anything),
// and no chunk-epoch double-buffering (a CPU mid-write race the
// GPU read).
//
// This is the corrected build, single-thread / single-owner like every
// shipped Trinity component. The actual WGSL compute pass + GPU
// vertex-buffer binding is the deferred integration layer; this is
// the pure-logic CHUNK-SoA / TABLE-VALIDATOR / CPU-MESHER /
// EPOCH-SWAP / CAPACITY-COUNTER kernel that drives them.
//
// CHUNK SoA. Each chunk is chunkSize ** 3 voxels of:
//   density    - Int8 signed density (positive = inside, negative
//                = outside; the surface is the zero crossing)
//   material   - Uint8 material id
// Two density buffers per chunk (front + back) form the epoch swap.
// Per-chunk epoch counter: bumped on every promote(); the deferred
// GPU dispatcher reads the FRONT density at a captured epoch and
// rejects a stale upload if the epoch has moved on.
//
// LOOKUP TABLES (gate 2). The kernel does not embed the Bourke
// edge / tri tables - they're 256 + 4096 entries of canonical data
// the consumer loads once via setEdgeTable / setTriTable. The
// constructor pre-allocates the table backing arrays; the consumer
// MUST call both before any meshChunk() call (validated). edgeTable
// is u16[256]; triTable is i8[256 * 16]. Both are validated as
// integer-only on load.
//
// CPU MESHER (gates 3, 5). meshChunk() walks every interior cell,
// computes the 8-corner sign mask, looks up the edge mask + tri
// list, interpolates each crossed edge between its two corners
// (linear interpolation in fp world space), and emits triangles
// into the chunk's vertex buffer. Each emitted vertex is 6 fp
// values: pos.x, pos.y, pos.z, normal.x, normal.y, normal.z.
// vertexCount tracks the emit count; capacity overflow drops the
// triangle and increments vertexOverflowTotal (gate 3).
//
// COUNTER RESET (gate 4). counterResetBuffer is a single-zero
// Uint32Array the GPU dispatcher reads to reset the atomic vertex
// counter at the start of each dispatch. Pre-allocated once;
// constant data, never mutated.
//
// EPOCH SWAP (gate 6). promoteChunk(chunkId) atomically (single-
// thread atomically) promotes BACK -> FRONT density, bumps
// chunkEpoch. The deferred GPU dispatcher reads chunkEpoch when
// queueing an upload; if the epoch has changed when the upload
// lands, the upload is rejected.
//
// The 6 Codex gates for VoxelComputeSystem, enforced:
//   1. "fix WGSL Vertex struct layout and buffer size" - VERTEX_STRIDE
//      is exactly 6 fp values (pos.xyz + normal.xyz); vertex buffer
//      is sized vertexCapacity * VERTEX_STRIDE Int32; the WGSL
//      Vertex struct in the deferred dispatcher MUST match.
//   2. "bind edgeTable and triTable" - the kernel REJECTS meshChunk
//      until both tables are loaded (setEdgeTable + setTriTable),
//      with validated lengths.
//   3. "vertex capacity checks + count readback" - meshCell drops
//      a triangle if the vertex buffer is full and increments
//      vertexOverflowTotal; getVertexCount(chunkId) is the readback.
//   4. "preallocate atomic counter reset buffer" - counterResetBuffer
//      is a constant single-zero Uint32Array allocated in the
//      constructor; the GPU dispatcher uses it for its
//      writeBuffer-zero pass.
//   5. "real corner indexing + interpolation" - the 8 corners of a
//      cell are indexed in the standard MC order (0..7); each
//      crossed edge is linearly interpolated between its two
//      corner densities.
//   6. "chunk epochs + double buffering for CPU-to-GPU voxel sync" -
//      front + back density per chunk; promoteChunk swaps + bumps
//      epoch; getChunkEpoch() lets the GPU dispatcher reject stale
//      uploads.
//
// Non-negotiable engine gates: no RNG; no wall clock - tick(t) is
// injected; single-thread, no Atomics today (the GPU compute pass
// is the deferred SAB layer); every chunk / cell / corner / vertex
// index bounds-checked; fixed-capacity storage.
// Vertex stride in Int32 fp values: pos.x, pos.y, pos.z, normal.x,
// normal.y, normal.z. Q16.16 fp. The deferred WGSL Vertex struct
// MUST mirror this layout.
export const VOXEL_VERTEX_STRIDE = 6;
// Q16.16 fp shift.
export const VOXEL_FP_SHIFT = 16;
export const VOXEL_FP_ONE = 1 << VOXEL_FP_SHIFT;
// Marching cubes table sizes - canonical Bourke MC.
const MC_EDGE_TABLE_SIZE = 256;
const MC_TRI_TABLE_SIZE = 256 * 16; // up to 5 triangles (15 indices) + a -1 terminator per case
// Canonical 8-corner offset table for marching cubes (cell corners
// 0..7 in the standard MC order). The 12-edge table maps each edge
// index 0..11 to the (cornerA, cornerB) endpoints.
const CORNER_OFFSET_X = new Int8Array([0, 1, 1, 0, 0, 1, 1, 0]);
const CORNER_OFFSET_Y = new Int8Array([0, 0, 1, 1, 0, 0, 1, 1]);
const CORNER_OFFSET_Z = new Int8Array([0, 0, 0, 0, 1, 1, 1, 1]);
const EDGE_CORNER_A = new Int8Array([0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3]);
const EDGE_CORNER_B = new Int8Array([1, 2, 3, 0, 5, 6, 7, 4, 4, 5, 6, 7]);
// Sentinels.
export const VOXEL_CHUNK_INVALID = -1;
// Sanity caps.
const MAX_CHUNKS = 1 << 14;
const MAX_CHUNK_SIZE = 64; // 64^3 = 262144 voxels per chunk
const MAX_VERTEX_CAPACITY = 1 << 22; // per chunk
const U32_MAX = 0xffffffff;
export class VoxelComputeSystem {
    maxChunks;
    chunkSize;
    chunkVoxels;
    chunkCells;
    vertexCapacity;
    // Per-chunk density buffers (gate 6). frontDensity is the read-
    // side; backDensity is the write-side. promoteChunk swaps via the
    // frontIsBuf0 bit (per-chunk).
    densityBuf0;
    densityBuf1;
    frontIsBuf0; // [chunk]
    material;
    chunkEpoch; // [chunk] - bumped on promote
    // Per-chunk vertex buffer (gate 1, 3). SoA Int32 fp.
    vertexBuffer;
    vertexCount; // [chunk]
    // Marching cubes tables (gate 2). Loaded externally; meshChunk
    // throws RangeError until both have been loaded.
    edgeTable;
    triTable;
    edgeTableLoaded = false;
    triTableLoaded = false;
    // Pre-allocated atomic counter reset buffer (gate 4). A single
    // zero-valued Uint32 the GPU dispatcher uses to reset its
    // per-pass atomic counter.
    counterResetBuffer;
    // Counters.
    currentTick = 0;
    vertexOverflowTotal = 0;
    cellsMeshedTotal = 0;
    trianglesEmittedTotal = 0;
    constructor(config) {
        const { maxChunks, chunkSize, vertexCapacity } = config;
        if (!Number.isInteger(maxChunks) || maxChunks < 1 || maxChunks > MAX_CHUNKS) {
            throw new RangeError('VoxelCompute: maxChunks out of range, got ' + maxChunks);
        }
        if (!Number.isInteger(chunkSize) || chunkSize < 2 || chunkSize > MAX_CHUNK_SIZE) {
            throw new RangeError('VoxelCompute: chunkSize out of range, got ' + chunkSize);
        }
        if (!Number.isInteger(vertexCapacity) || vertexCapacity < 1 || vertexCapacity > MAX_VERTEX_CAPACITY) {
            throw new RangeError('VoxelCompute: vertexCapacity out of range, got ' + vertexCapacity);
        }
        this.maxChunks = maxChunks;
        this.chunkSize = chunkSize;
        this.chunkVoxels = chunkSize * chunkSize * chunkSize;
        this.chunkCells = (chunkSize - 1) * (chunkSize - 1) * (chunkSize - 1);
        this.vertexCapacity = vertexCapacity;
        const totalVoxels = maxChunks * this.chunkVoxels;
        this.densityBuf0 = new Int8Array(totalVoxels);
        this.densityBuf1 = new Int8Array(totalVoxels);
        this.frontIsBuf0 = new Uint8Array(maxChunks).fill(1);
        this.material = new Uint8Array(totalVoxels);
        this.chunkEpoch = new Uint32Array(maxChunks);
        this.vertexBuffer = new Int32Array(maxChunks * vertexCapacity * VOXEL_VERTEX_STRIDE);
        this.vertexCount = new Uint32Array(maxChunks);
        this.edgeTable = new Uint16Array(MC_EDGE_TABLE_SIZE);
        this.triTable = new Int8Array(MC_TRI_TABLE_SIZE);
        this.counterResetBuffer = new Uint32Array(1); // gate 4 - single zero
    }
    // --- counts ---
    getCurrentTick() { return this.currentTick; }
    getVertexCount(chunkId) {
        if (!this.requireChunk(chunkId))
            return 0;
        return this.vertexCount[chunkId] ?? 0;
    }
    getChunkEpoch(chunkId) {
        if (!this.requireChunk(chunkId))
            return 0;
        return this.chunkEpoch[chunkId] ?? 0;
    }
    getVertexOverflowTotal() { return this.vertexOverflowTotal; }
    getCellsMeshedTotal() { return this.cellsMeshedTotal; }
    getTrianglesEmittedTotal() { return this.trianglesEmittedTotal; }
    isReady() { return this.edgeTableLoaded && this.triTableLoaded; }
    // --- table loading (gate 2) ---
    // Load the canonical Bourke marching-cubes edge table. Must have
    // exactly MC_EDGE_TABLE_SIZE = 256 entries. Each entry is a 12-bit
    // mask of which edges are crossed for the given 8-corner sign mask.
    setEdgeTable(table) {
        if (!table || table.length !== MC_EDGE_TABLE_SIZE)
            return false;
        for (let i = 0; i < MC_EDGE_TABLE_SIZE; i++) {
            const v = table[i] ?? 0;
            if (!Number.isInteger(v) || v < 0 || v > 0xffff)
                return false;
            this.edgeTable[i] = v & 0xffff;
        }
        this.edgeTableLoaded = true;
        return true;
    }
    // Load the canonical Bourke marching-cubes triangle table. Must
    // have exactly MC_TRI_TABLE_SIZE = 256 * 16 entries. Each row of
    // 16 entries lists triplets of edge indices forming triangles,
    // terminated by -1.
    setTriTable(table) {
        if (!table || table.length !== MC_TRI_TABLE_SIZE)
            return false;
        for (let i = 0; i < MC_TRI_TABLE_SIZE; i++) {
            const v = table[i] ?? 0;
            if (!Number.isInteger(v) || v < -1 || v > 11)
                return false;
            this.triTable[i] = v | 0;
        }
        this.triTableLoaded = true;
        return true;
    }
    // --- chunk SoA writes ---
    // Set a voxel's density on the BACK density buffer (the write-side).
    // density is signed Int8 in [-128, 127].
    setVoxelDensity(chunkId, x, y, z, density) {
        if (!this.requireChunk(chunkId))
            return false;
        if (!this.requireVoxelCoord(x, y, z))
            return false;
        if (!Number.isInteger(density) || density < -128 || density > 127)
            return false;
        const idx = this.voxelIdx(chunkId, x, y, z);
        const back = (this.frontIsBuf0[chunkId] ?? 1) === 1 ? this.densityBuf1 : this.densityBuf0;
        back[idx] = density | 0;
        return true;
    }
    // Set a voxel's material (Uint8). The material buffer is single-
    // sided (not double-buffered) - materials change on a slower
    // cadence than density.
    setVoxelMaterial(chunkId, x, y, z, materialId) {
        if (!this.requireChunk(chunkId))
            return false;
        if (!this.requireVoxelCoord(x, y, z))
            return false;
        if (!Number.isInteger(materialId) || materialId < 0 || materialId > 255)
            return false;
        this.material[this.voxelIdx(chunkId, x, y, z)] = materialId & 0xff;
        return true;
    }
    // Read FRONT density (the GPU-visible side).
    getFrontDensity(chunkId, x, y, z) {
        if (!this.requireChunk(chunkId))
            return 0;
        if (!this.requireVoxelCoord(x, y, z))
            return 0;
        const idx = this.voxelIdx(chunkId, x, y, z);
        const front = (this.frontIsBuf0[chunkId] ?? 1) === 1 ? this.densityBuf0 : this.densityBuf1;
        return front[idx] ?? 0;
    }
    // --- epoch swap (gate 6) ---
    // Promote the BACK density to FRONT and bump the chunk epoch. The
    // deferred GPU dispatcher reads chunkEpoch at upload time; a stale
    // upload (epoch moved on between capture and submission) is
    // rejected by the dispatcher.
    promoteChunk(chunkId) {
        if (!this.requireChunk(chunkId))
            return false;
        this.frontIsBuf0[chunkId] = (this.frontIsBuf0[chunkId] ?? 1) === 1 ? 0 : 1;
        // Wrap-safe u32 epoch bump.
        this.chunkEpoch[chunkId] = (((this.chunkEpoch[chunkId] ?? 0) + 1) >>> 0);
        return true;
    }
    // --- counter reset buffer (gate 4) ---
    // The pre-allocated single-zero buffer the GPU dispatcher reads to
    // reset its atomic vertex counter at dispatch start. Constant.
    getCounterResetBuffer() {
        return this.counterResetBuffer;
    }
    // --- CPU mesher (gates 1, 3, 5) ---
    // Mesh a chunk: walks every (chunkSize-1)^3 cell, runs marching
    // cubes against the FRONT density, emits triangles into the chunk's
    // vertex buffer. Resets the chunk's vertexCount to 0. Returns the
    // number of triangles emitted. Throws if tables are not loaded.
    meshChunk(chunkId) {
        if (!this.requireChunk(chunkId))
            return 0;
        if (!this.edgeTableLoaded || !this.triTableLoaded) {
            throw new Error('VoxelCompute.meshChunk: setEdgeTable + setTriTable must be called before meshing');
        }
        this.vertexCount[chunkId] = 0;
        const front = (this.frontIsBuf0[chunkId] ?? 1) === 1 ? this.densityBuf0 : this.densityBuf1;
        const cs = this.chunkSize;
        const chunkBase = chunkId * this.chunkVoxels;
        let trisOut = 0;
        // Loop over cells (corners 0..cs-2 along each axis).
        for (let z = 0; z < cs - 1; z++) {
            for (let y = 0; y < cs - 1; y++) {
                for (let x = 0; x < cs - 1; x++) {
                    this.cellsMeshedTotal++;
                    // Compute the 8-corner sign mask (gate 5).
                    let cornerMask = 0;
                    // We also stash the corner densities locally for interpolation.
                    const cornerD0 = front[chunkBase + this.localIdx(x + 0, y + 0, z + 0, cs)] ?? 0;
                    const cornerD1 = front[chunkBase + this.localIdx(x + 1, y + 0, z + 0, cs)] ?? 0;
                    const cornerD2 = front[chunkBase + this.localIdx(x + 1, y + 1, z + 0, cs)] ?? 0;
                    const cornerD3 = front[chunkBase + this.localIdx(x + 0, y + 1, z + 0, cs)] ?? 0;
                    const cornerD4 = front[chunkBase + this.localIdx(x + 0, y + 0, z + 1, cs)] ?? 0;
                    const cornerD5 = front[chunkBase + this.localIdx(x + 1, y + 0, z + 1, cs)] ?? 0;
                    const cornerD6 = front[chunkBase + this.localIdx(x + 1, y + 1, z + 1, cs)] ?? 0;
                    const cornerD7 = front[chunkBase + this.localIdx(x + 0, y + 1, z + 1, cs)] ?? 0;
                    if (cornerD0 < 0)
                        cornerMask |= 1;
                    if (cornerD1 < 0)
                        cornerMask |= 2;
                    if (cornerD2 < 0)
                        cornerMask |= 4;
                    if (cornerD3 < 0)
                        cornerMask |= 8;
                    if (cornerD4 < 0)
                        cornerMask |= 16;
                    if (cornerD5 < 0)
                        cornerMask |= 32;
                    if (cornerD6 < 0)
                        cornerMask |= 64;
                    if (cornerD7 < 0)
                        cornerMask |= 128;
                    const edgeMask = this.edgeTable[cornerMask] ?? 0;
                    if (edgeMask === 0)
                        continue;
                    const cornerD = [cornerD0, cornerD1, cornerD2, cornerD3, cornerD4, cornerD5, cornerD6, cornerD7];
                    // Precompute interpolated edge vertices for crossed edges only.
                    // Per edge: pos.xyz fp.
                    const edgeVx = new Int32Array(12 * 3);
                    for (let e = 0; e < 12; e++) {
                        if ((edgeMask & (1 << e)) === 0)
                            continue;
                        const a = EDGE_CORNER_A[e] ?? 0;
                        const b = EDGE_CORNER_B[e] ?? 0;
                        const da = cornerD[a] ?? 0;
                        const db = cornerD[b] ?? 0;
                        // Interpolate t = -da / (db - da), in fp ratio. Guard
                        // against da == db (no crossing despite the edgeMask bit -
                        // shouldn't happen but be safe).
                        let tFp = 0;
                        if (db !== da) {
                            tFp = Math.floor((-da * VOXEL_FP_ONE) / (db - da));
                            if (tFp < 0)
                                tFp = 0;
                            if (tFp > VOXEL_FP_ONE)
                                tFp = VOXEL_FP_ONE;
                        }
                        const ax = (CORNER_OFFSET_X[a] ?? 0) + x;
                        const ay = (CORNER_OFFSET_Y[a] ?? 0) + y;
                        const az = (CORNER_OFFSET_Z[a] ?? 0) + z;
                        const bx = (CORNER_OFFSET_X[b] ?? 0) + x;
                        const by = (CORNER_OFFSET_Y[b] ?? 0) + y;
                        const bz = (CORNER_OFFSET_Z[b] ?? 0) + z;
                        // Interpolated vertex pos = a + t * (b - a). Result in
                        // voxel-grid units (Q16.16 fp).
                        const vxFp = ax * VOXEL_FP_ONE + Math.floor((tFp * (bx - ax)));
                        const vyFp = ay * VOXEL_FP_ONE + Math.floor((tFp * (by - ay)));
                        const vzFp = az * VOXEL_FP_ONE + Math.floor((tFp * (bz - az)));
                        edgeVx[e * 3 + 0] = vxFp | 0;
                        edgeVx[e * 3 + 1] = vyFp | 0;
                        edgeVx[e * 3 + 2] = vzFp | 0;
                    }
                    // Walk the triTable row, emit triangles.
                    const triRow = cornerMask * 16;
                    for (let i = 0; i < 16; i += 3) {
                        const e0 = this.triTable[triRow + i] ?? -1;
                        if (e0 === -1)
                            break;
                        const e1 = this.triTable[triRow + i + 1] ?? -1;
                        const e2 = this.triTable[triRow + i + 2] ?? -1;
                        if (e1 === -1 || e2 === -1)
                            break;
                        // Check vertex capacity (gate 3).
                        if ((this.vertexCount[chunkId] ?? 0) + 3 > this.vertexCapacity) {
                            this.vertexOverflowTotal++;
                            continue;
                        }
                        // Triangle vertices.
                        const v0x = edgeVx[e0 * 3 + 0] ?? 0;
                        const v0y = edgeVx[e0 * 3 + 1] ?? 0;
                        const v0z = edgeVx[e0 * 3 + 2] ?? 0;
                        const v1x = edgeVx[e1 * 3 + 0] ?? 0;
                        const v1y = edgeVx[e1 * 3 + 1] ?? 0;
                        const v1z = edgeVx[e1 * 3 + 2] ?? 0;
                        const v2x = edgeVx[e2 * 3 + 0] ?? 0;
                        const v2y = edgeVx[e2 * 3 + 1] ?? 0;
                        const v2z = edgeVx[e2 * 3 + 2] ?? 0;
                        // Flat normal: cross((v1-v0), (v2-v0)) - we keep an
                        // un-normalized fp normal (the renderer normalizes).
                        const ux = v1x - v0x;
                        const uy = v1y - v0y;
                        const uz = v1z - v0z;
                        const vxn = v2x - v0x;
                        const vyn = v2y - v0y;
                        const vzn = v2z - v0z;
                        // Cross product. Divide by FP_ONE to keep magnitudes safe.
                        const nx = Math.floor((uy * vzn - uz * vyn) / VOXEL_FP_ONE);
                        const ny = Math.floor((uz * vxn - ux * vzn) / VOXEL_FP_ONE);
                        const nz = Math.floor((ux * vyn - uy * vxn) / VOXEL_FP_ONE);
                        this.emitVertex(chunkId, v0x, v0y, v0z, nx, ny, nz);
                        this.emitVertex(chunkId, v1x, v1y, v1z, nx, ny, nz);
                        this.emitVertex(chunkId, v2x, v2y, v2z, nx, ny, nz);
                        trisOut++;
                        this.trianglesEmittedTotal++;
                    }
                }
            }
        }
        return trisOut;
    }
    emitVertex(chunkId, px, py, pz, nx, ny, nz) {
        const idx = this.vertexCount[chunkId] ?? 0;
        const base = (chunkId * this.vertexCapacity + idx) * VOXEL_VERTEX_STRIDE;
        this.vertexBuffer[base + 0] = px | 0;
        this.vertexBuffer[base + 1] = py | 0;
        this.vertexBuffer[base + 2] = pz | 0;
        this.vertexBuffer[base + 3] = nx | 0;
        this.vertexBuffer[base + 4] = ny | 0;
        this.vertexBuffer[base + 5] = nz | 0;
        this.vertexCount[chunkId] = ((idx) + 1) >>> 0;
    }
    // --- vertex buffer read (gate 1, 3) ---
    // Read a vertex from chunk's vertex buffer. Writes 6 i32 into out.
    readVertex(chunkId, vertexIdx, out, outOffset = 0) {
        if (!this.requireChunk(chunkId))
            return false;
        if (!Number.isInteger(vertexIdx) || vertexIdx < 0
            || vertexIdx >= (this.vertexCount[chunkId] ?? 0))
            return false;
        if (outOffset < 0 || outOffset + VOXEL_VERTEX_STRIDE > out.length)
            return false;
        const base = (chunkId * this.vertexCapacity + vertexIdx) * VOXEL_VERTEX_STRIDE;
        for (let s = 0; s < VOXEL_VERTEX_STRIDE; s++) {
            out[outOffset + s] = this.vertexBuffer[base + s] ?? 0;
        }
        return true;
    }
    // Expose the chunk's vertex buffer (read-only by convention) for
    // the deferred GPU dispatcher's writeBuffer pass.
    getVertexBufferView(chunkId) {
        if (!this.requireChunk(chunkId))
            return null;
        const base = chunkId * this.vertexCapacity * VOXEL_VERTEX_STRIDE;
        const len = this.vertexCapacity * VOXEL_VERTEX_STRIDE;
        return this.vertexBuffer.subarray(base, base + len);
    }
    // --- helpers ---
    requireChunk(c) {
        return Number.isInteger(c) && c >= 0 && c < this.maxChunks;
    }
    requireVoxelCoord(x, y, z) {
        return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z)
            && x >= 0 && y >= 0 && z >= 0
            && x < this.chunkSize && y < this.chunkSize && z < this.chunkSize;
    }
    voxelIdx(chunkId, x, y, z) {
        return chunkId * this.chunkVoxels + this.localIdx(x, y, z, this.chunkSize);
    }
    localIdx(x, y, z, cs) {
        return x + y * cs + z * cs * cs;
    }
    tick(t) {
        if (!Number.isInteger(t) || t < 0 || t > U32_MAX) {
            throw new RangeError('VoxelCompute.tick: t must be a u32, got ' + t);
        }
        this.currentTick = t | 0;
    }
    // --- lifecycle ---
    clear() {
        this.densityBuf0.fill(0);
        this.densityBuf1.fill(0);
        this.frontIsBuf0.fill(1);
        this.material.fill(0);
        this.chunkEpoch.fill(0);
        this.vertexBuffer.fill(0);
        this.vertexCount.fill(0);
        this.vertexOverflowTotal = 0;
        this.cellsMeshedTotal = 0;
        this.trianglesEmittedTotal = 0;
    }
}
//# sourceMappingURL=voxel-compute.js.map