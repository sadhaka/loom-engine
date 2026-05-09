export type QuestState = 'offered' | 'accepted' | 'active' | 'complete' | 'failed';
export interface QuestObjective {
    id: string;
    required: number;
    progress: number;
    done: boolean;
    data?: Record<string, unknown>;
}
export interface QuestEntry {
    id: string;
    state: QuestState;
    stateChangedAtMs: number;
    objectives: QuestObjective[];
}
export interface OfferQuestOptions {
    objectives: Array<{
        id: string;
        required: number;
        data?: Record<string, unknown>;
    }>;
}
export interface QuestLogOptions {
    now?: () => number;
    onStateChanged?: (questId: string, prev: QuestState, next: QuestState) => void;
    onObjectiveProgress?: (questId: string, objectiveId: string, progress: number, required: number) => void;
}
export declare class QuestLog {
    private quests;
    private nowFn;
    private onStateChanged;
    private onObjectiveProgress;
    private disposed;
    private constructor();
    static create(opts?: QuestLogOptions): QuestLog;
    offer(questId: string, opts: OfferQuestOptions): boolean;
    accept(questId: string): boolean;
    decline(questId: string): boolean;
    fail(questId: string): boolean;
    complete(questId: string): boolean;
    addProgress(questId: string, objectiveId: string, n?: number): boolean;
    getState(questId: string): QuestState | null;
    get(questId: string): QuestEntry | null;
    has(questId: string): boolean;
    listIds(filter?: QuestState): string[];
    list(filter?: QuestState): QuestEntry[];
    count(filter?: QuestState): number;
    toSnapshot(): QuestEntry[];
    fromSnapshot(snap: ReadonlyArray<QuestEntry>): void;
    dispose(): void;
    private transition;
    private allDone;
}
export declare const RESOURCE_QUEST_LOG = "quest_log";
//# sourceMappingURL=quest-log.d.ts.map