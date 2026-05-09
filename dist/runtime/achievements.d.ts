export interface AchievementSpec {
    id: string;
    target?: number;
    data?: Record<string, unknown>;
}
export interface ActiveAchievement {
    spec: AchievementSpec;
    progress: number;
    unlocked: boolean;
    unlockedAt: number;
}
export interface AchievementsOptions {
    onUnlocked?: (spec: AchievementSpec, progress: number) => void;
    onProgress?: (spec: AchievementSpec, progress: number, prev: number) => void;
}
export interface AchievementSnapshotEntry {
    progress: number;
    unlocked: boolean;
    unlockedAt?: number;
}
export declare class Achievements {
    private entries;
    private onUnlocked;
    private onProgress;
    private unlockSeq;
    private disposed;
    private constructor();
    static create(opts?: AchievementsOptions): Achievements;
    register(spec: AchievementSpec): boolean;
    unregister(id: string): boolean;
    has(id: string): boolean;
    isUnlocked(id: string): boolean;
    getProgress(id: string): number;
    add(id: string, delta: number): boolean;
    set(id: string, value: number): boolean;
    reset(id: string): boolean;
    resetAll(): number;
    list(): ActiveAchievement[];
    toSnapshot(): Record<string, AchievementSnapshotEntry>;
    fromSnapshot(snap: Record<string, AchievementSnapshotEntry>): void;
    dispose(): void;
    private applyProgress;
}
export declare const RESOURCE_ACHIEVEMENTS = "achievements";
//# sourceMappingURL=achievements.d.ts.map