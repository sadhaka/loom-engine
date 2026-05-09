export type TriggerDirection = 'below' | 'above';
export interface ThresholdSpec {
    id: string;
    threshold: number;
    direction: TriggerDirection;
    hysteresis?: number;
    onTrigger?: (value: number) => void;
    onRearm?: (value: number) => void;
    data?: Record<string, unknown>;
}
export declare class ThresholdTrigger {
    private entries;
    private disposed;
    private constructor();
    static create(): ThresholdTrigger;
    register(spec: ThresholdSpec): boolean;
    unregister(id: string): boolean;
    has(id: string): boolean;
    update(id: string, value: number): boolean;
    reset(id: string): boolean;
    isArmed(id: string): boolean;
    isTriggered(id: string): boolean;
    lastValueOf(id: string): number;
    size(): number;
    list(): ThresholdSpec[];
    dispose(): void;
}
export declare const RESOURCE_THRESHOLD_TRIGGER = "threshold_trigger";
//# sourceMappingURL=threshold-trigger.d.ts.map