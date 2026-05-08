export interface IMemorySource {
    estimateBytes(): number;
}
export interface MemoryReport {
    bySource: Array<{
        name: string;
        bytes: number;
    }>;
    totalBytes: number;
    sourceCount: number;
}
export interface MemoryBudgetOptions {
    onReport?: (report: MemoryReport) => void;
}
export declare class MemoryBudget {
    private sources;
    private order;
    private onReport;
    private disposed;
    private constructor();
    static create(opts?: MemoryBudgetOptions): MemoryBudget;
    register(name: string, source: IMemorySource): void;
    unregister(name: string): boolean;
    has(name: string): boolean;
    sources_(): string[];
    getBytes(name: string): number;
    totalBytes(): number;
    report(): MemoryReport;
    clear(): void;
    dispose(): void;
}
export declare function estimateTypedArrayBytes(...arrs: ArrayBufferView[]): number;
export declare function estimateMapBytes(map: Map<unknown, unknown> | null | undefined, perEntryBytes?: number): number;
export declare function estimateSetBytes(set: Set<unknown> | null | undefined, perEntryBytes?: number): number;
export declare function estimateArrayBytes(arr: unknown[] | null | undefined, perElementBytes: number): number;
export declare function estimateObjectBytes(obj: object | null | undefined, perPropertyBytes?: number): number;
export declare const RESOURCE_MEMORY_BUDGET = "memory_budget";
//# sourceMappingURL=memory-budget.d.ts.map