export type ScheduleCondition = (ctx: Record<string, unknown>) => boolean;
export interface ScheduleBlock {
    id: string;
    characterId: string;
    startMinute: number;
    endMinute: number;
    location: string;
    activity?: string;
    weekdays?: number[];
    priority?: number;
    condition?: ScheduleCondition;
    data?: Record<string, unknown>;
}
export interface ActiveBlock extends ScheduleBlock {
    progress: number;
    remainingMinutes: number;
}
export interface ScheduleQueryContext {
    minute: number;
    weekday?: number;
    [key: string]: unknown;
}
export interface SchedulePlanOptions {
}
export declare class SchedulePlan {
    private blocks;
    private insertCounter;
    private disposed;
    private constructor();
    static create(opts?: SchedulePlanOptions): SchedulePlan;
    addBlock(block: ScheduleBlock): boolean;
    removeBlock(id: string): boolean;
    updateBlock(id: string, partial: Partial<ScheduleBlock>): boolean;
    hasBlock(id: string): boolean;
    getBlock(id: string): ScheduleBlock | null;
    blockCount(): number;
    current(characterId: string, ctx: ScheduleQueryContext): ActiveBlock | null;
    allActive(characterId: string, ctx: ScheduleQueryContext): ActiveBlock[];
    blocksFor(characterId: string): ScheduleBlock[];
    allCurrent(ctx: ScheduleQueryContext): Record<string, ActiveBlock | null>;
    list(): ScheduleBlock[];
    clear(): void;
    dispose(): void;
    private blockMatches;
    private toActive;
    private publicBlock;
}
export declare const RESOURCE_SCHEDULE_PLAN = "schedule_plan";
//# sourceMappingURL=schedule-plan.d.ts.map