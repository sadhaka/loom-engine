export interface QueueEntry<T = Record<string, unknown>> {
    id: string;
    skill: number;
    partySize: number;
    enqueuedAt: number;
    data?: T;
}
export interface QueueOptions<T = Record<string, unknown>> {
    partySize?: number;
    data?: T;
}
export interface Match<T = Record<string, unknown>> {
    ids: string[];
    skillSpread: number;
    matchedAt: number;
    entries: QueueEntry<T>[];
}
export interface MatchmakingOptions {
    partySize?: number;
    initialSkillRange?: number;
    expansionPerSec?: number;
    maxSkillRange?: number;
    maxEntries?: number;
}
export declare class MatchmakingPool<T = Record<string, unknown>> {
    private entries;
    private defaultPartySize;
    private initialSkillRange;
    private expansionPerSec;
    private maxSkillRange;
    private maxEntries;
    private constructor();
    static create<T = Record<string, unknown>>(opts?: MatchmakingOptions): MatchmakingPool<T>;
    queue(id: string, skill: number, now: number, opts?: QueueOptions<T>): QueueEntry<T> | null;
    cancel(id: string): boolean;
    tick(now: number): Match<T>[];
    has(id: string): boolean;
    get(id: string): QueueEntry<T> | null;
    count(): number;
    list(): QueueEntry<T>[];
    currentRange(entry: QueueEntry<T>, now: number): number;
    waitMs(id: string, now: number): number;
    getDefaultPartySize(): number;
    getInitialSkillRange(): number;
    getExpansionPerSec(): number;
    getMaxSkillRange(): number;
    clear(): void;
    private snapshot;
    private evictOldest;
}
export declare const RESOURCE_MATCHMAKING_POOL = "matchmaking_pool";
//# sourceMappingURL=matchmaking-pool.d.ts.map