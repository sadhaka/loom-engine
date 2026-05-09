export interface EventRecord<T = unknown> {
    seq: number;
    type: string;
    payload: T;
}
export interface EventLogOptions {
    capacity?: number;
}
export declare class EventLog<T = unknown> {
    private records;
    private capacityNum;
    private nextSeq;
    private disposed;
    private constructor();
    static create<T = unknown>(opts?: EventLogOptions): EventLog<T>;
    append(type: string, payload: T): number;
    bySeq(seq: number): EventRecord<T> | null;
    byType(type: string): EventRecord<T>[];
    filter(pred: (rec: EventRecord<T>) => boolean): EventRecord<T>[];
    list(): EventRecord<T>[];
    forEach(cb: (rec: EventRecord<T>) => void): void;
    clear(): void;
    size(): number;
    capacity(): number;
    highWaterMark(): number;
    toSnapshot(): EventRecord<T>[];
    fromSnapshot(records: EventRecord<T>[]): void;
    dispose(): void;
}
export declare const RESOURCE_EVENT_LOG = "event_log";
//# sourceMappingURL=event-log.d.ts.map