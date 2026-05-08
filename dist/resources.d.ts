export declare class ResourceRegistry {
    private resources;
    set<T>(key: string, value: T): void;
    get<T>(key: string): T | undefined;
    require<T>(key: string): T;
    has(key: string): boolean;
    remove(key: string): boolean;
    keys(): IterableIterator<string>;
}
export interface TimeResource {
    elapsed: number;
    delta: number;
    frame: number;
}
export declare function createTimeResource(): TimeResource;
export declare const RESOURCE_TIME = "time";
export declare const RESOURCE_CAMERA = "camera";
export declare const RESOURCE_DEVICE = "device";
export interface VeilBudgetResource {
    particleBudget: number;
    shaderBudget: number;
    eventBudget: number;
    audioBudget: number;
    lastUpdatedFrame: number;
}
export declare function createVeilBudgetResource(): VeilBudgetResource;
export declare const RESOURCE_VEIL_BUDGET = "veil_budget";
//# sourceMappingURL=resources.d.ts.map