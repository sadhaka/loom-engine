export interface ParseStats {
    accepted: number;
    rejected: number;
    dropped: number;
}
export declare class AIActionInterpreter {
    readonly maxQueueSize: number;
    readonly maxEntityId: number;
    private readonly ring;
    private readonly mask;
    private head;
    private tail;
    constructor(maxQueueSize: number, maxEntityId: number);
    get capacity(): number;
    count(): number;
    isEmpty(): boolean;
    isFull(): boolean;
    clear(): void;
    pop(out: Uint32Array): boolean;
    private pushRecord;
    parse(input: string): ParseStats;
}
//# sourceMappingURL=ai-action-interpreter.d.ts.map