export type LeaderboardOrder = 'desc' | 'asc';
export interface ScoreEntry {
    id: string;
    name: string;
    score: number;
    submittedAt: number;
    rank?: number;
    data?: Record<string, unknown>;
}
export interface LeaderboardSubmission {
    id: string;
    name: string;
    score: number;
    data?: Record<string, unknown>;
}
export interface LeaderboardPersistAdapter {
    save: (entries: ScoreEntry[]) => void;
    load: () => ScoreEntry[];
}
export interface LeaderboardRemoteAdapter {
    submit?: (entry: ScoreEntry) => Promise<void>;
    fetch?: () => Promise<ScoreEntry[]>;
}
export interface LeaderboardOptions {
    order?: LeaderboardOrder;
    capacity?: number;
    persist?: LeaderboardPersistAdapter;
    remote?: LeaderboardRemoteAdapter;
}
export declare class Leaderboard {
    private byId;
    private order;
    private capacityNum;
    private persist;
    private remote;
    private submitSeq;
    private disposed;
    private constructor();
    static create(opts?: LeaderboardOptions): Leaderboard;
    submit(entry: LeaderboardSubmission): boolean;
    remove(id: string): boolean;
    clear(): void;
    size(): number;
    byIdEntry(id: string): ScoreEntry | null;
    rankOf(id: string): number;
    top(n: number): ScoreEntry[];
    around(id: string, before: number, after: number): ScoreEntry[];
    list(): ScoreEntry[];
    saveLocal(): void;
    loadLocal(): void;
    uploadRemote(id: string): Promise<void>;
    syncRemote(): Promise<void>;
    setOrder(order: LeaderboardOrder): void;
    getOrder(): LeaderboardOrder;
    dispose(): void;
    private beats;
    private compareEntries;
    private sortedEntries;
    private evictIfFull;
    private withRank;
}
export declare const RESOURCE_LEADERBOARD = "leaderboard";
//# sourceMappingURL=leaderboard.d.ts.map