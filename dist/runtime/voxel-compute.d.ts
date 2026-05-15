export declare const VOXEL_VERTEX_STRIDE = 6;
export declare const VOXEL_FP_SHIFT = 16;
export declare const VOXEL_FP_ONE: number;
export declare const VOXEL_CHUNK_INVALID = -1;
export interface VoxelComputeConfig {
    maxChunks: number;
    chunkSize: number;
    vertexCapacity: number;
}
export declare class VoxelComputeSystem {
    readonly maxChunks: number;
    readonly chunkSize: number;
    readonly chunkVoxels: number;
    readonly chunkCells: number;
    readonly vertexCapacity: number;
    private readonly densityBuf0;
    private readonly densityBuf1;
    private readonly frontIsBuf0;
    private readonly material;
    private readonly chunkEpoch;
    private readonly vertexBuffer;
    private readonly vertexCount;
    private readonly edgeTable;
    private readonly triTable;
    private edgeTableLoaded;
    private triTableLoaded;
    private readonly counterResetBuffer;
    private currentTick;
    private vertexOverflowTotal;
    private cellsMeshedTotal;
    private trianglesEmittedTotal;
    constructor(config: VoxelComputeConfig);
    getCurrentTick(): number;
    getVertexCount(chunkId: number): number;
    getChunkEpoch(chunkId: number): number;
    getVertexOverflowTotal(): number;
    getCellsMeshedTotal(): number;
    getTrianglesEmittedTotal(): number;
    isReady(): boolean;
    setEdgeTable(table: Uint16Array | number[]): boolean;
    setTriTable(table: Int8Array | number[]): boolean;
    setVoxelDensity(chunkId: number, x: number, y: number, z: number, density: number): boolean;
    setVoxelMaterial(chunkId: number, x: number, y: number, z: number, materialId: number): boolean;
    getFrontDensity(chunkId: number, x: number, y: number, z: number): number;
    promoteChunk(chunkId: number): boolean;
    getCounterResetBuffer(): Uint32Array;
    meshChunk(chunkId: number): number;
    private emitVertex;
    readVertex(chunkId: number, vertexIdx: number, out: Int32Array, outOffset?: number): boolean;
    getVertexBufferView(chunkId: number): Int32Array | null;
    private requireChunk;
    private requireVoxelCoord;
    private voxelIdx;
    private localIdx;
    tick(t: number): void;
    clear(): void;
}
//# sourceMappingURL=voxel-compute.d.ts.map