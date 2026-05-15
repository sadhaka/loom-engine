export declare const SHADER_STAGE_VERTEX = 1;
export declare const SHADER_STAGE_FRAGMENT = 2;
export declare const SHADER_STAGE_COMPUTE = 4;
export declare const BUFFER_TYPE_UNIFORM = 0;
export declare const BUFFER_TYPE_STORAGE = 1;
export declare const BUFFER_TYPE_READ_ONLY_STORAGE = 2;
export declare const UPLOAD_NONE = -1;
export interface BufferBindingDescriptor {
    binding: number;
    visibility: number;
    bufferType: number;
}
export interface WebGPURendererConfig {
    bufferCount: number;
    byteCapacity: number;
    maxStorageBufferBindingSize: number;
    bindings: readonly BufferBindingDescriptor[];
}
export declare class WebGPURenderer {
    readonly bufferCount: number;
    readonly byteCapacity: number;
    readonly maxStorageBufferBindingSize: number;
    readonly bindingCount: number;
    private readonly backing;
    private readonly validBytes;
    private writeCursor;
    private readonly bindingNumber;
    private readonly bindingVisibility;
    private readonly bindingBufferType;
    private deviceLost;
    private captureCount;
    private droppedCount;
    constructor(config: WebGPURendererConfig);
    getBindingNumber(i: number): number;
    getBindingVisibility(i: number): number;
    getBindingBufferType(i: number): number;
    isDeviceLost(): boolean;
    markDeviceLost(): void;
    markDeviceRestored(): void;
    captureSnapshot(source: Uint8Array, activeCount: number, strideBytes: number): number;
    getUploadView(index: number): Uint8Array;
    getUploadByteLength(index: number): number;
    getCaptureCount(): number;
    getDroppedCount(): number;
    clear(): void;
    private requireBindingIndex;
    private requireBufferIndex;
}
//# sourceMappingURL=webgpu-renderer.d.ts.map