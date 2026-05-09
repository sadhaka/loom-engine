export interface DialogChoiceRecord {
    nodeId: string;
    choiceIndex: number;
    choiceLabel?: string;
    seq: number;
}
export interface DialogChoiceHistoryOptions {
    capacity?: number;
}
export declare class DialogChoiceHistory {
    private records;
    private capacityNum;
    private nextSeq;
    private disposed;
    private constructor();
    static create(opts?: DialogChoiceHistoryOptions): DialogChoiceHistory;
    record(nodeId: string, choiceIndex: number, choiceLabel?: string): boolean;
    byNode(nodeId: string): DialogChoiceRecord[];
    lastChoice(nodeId: string): DialogChoiceRecord | null;
    has(nodeId: string, choiceIndex: number): boolean;
    count(nodeId: string, choiceIndex: number): number;
    countByNode(nodeId: string): number;
    totalCount(): number;
    capacity(): number;
    list(): DialogChoiceRecord[];
    clear(): void;
    toSnapshot(): DialogChoiceRecord[];
    fromSnapshot(records: DialogChoiceRecord[]): void;
    dispose(): void;
}
export declare const RESOURCE_DIALOG_CHOICE_HISTORY = "dialog_choice_history";
//# sourceMappingURL=dialog-choice-history.d.ts.map