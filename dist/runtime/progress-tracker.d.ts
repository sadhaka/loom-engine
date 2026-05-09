export type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
export interface SkillSpec<T = Record<string, unknown>> {
    id: string;
    name: string;
    decayPerDay?: number;
    levelWeights?: Partial<Record<BloomLevel, number>>;
    data?: T;
}
export interface SkillState<T = Record<string, unknown>> {
    id: string;
    name: string;
    levels: Record<BloomLevel, number>;
    overallMastery: number;
    evidenceCount: number;
    lastEvidenceAt: number;
    data?: T;
}
export interface ProgressTrackerOptions {
    now?: () => number;
    defaultDecayPerDay?: number;
}
export declare class ProgressTracker<T = Record<string, unknown>> {
    private skills;
    private nowFn;
    private defaultDecay;
    private lastTickAt;
    private hasTicked;
    private disposed;
    private constructor();
    static create<T = Record<string, unknown>>(opts?: ProgressTrackerOptions): ProgressTracker<T>;
    defineSkill(spec: SkillSpec<T>): boolean;
    hasSkill(id: string): boolean;
    removeSkill(id: string): boolean;
    recordEvidence(skillId: string, level: BloomLevel, score: number, now?: number): SkillState<T> | null;
    tick(now?: number): void;
    getSkill(id: string): SkillState<T> | null;
    list(): SkillState<T>[];
    count(): number;
    highMastery(threshold: number): SkillState<T>[];
    lowMastery(threshold: number): SkillState<T>[];
    resetSkill(id: string): boolean;
    clear(): void;
    dispose(): void;
    private snapshot;
}
export declare const RESOURCE_PROGRESS_TRACKER = "progress_tracker";
//# sourceMappingURL=progress-tracker.d.ts.map