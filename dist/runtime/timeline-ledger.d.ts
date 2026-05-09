export interface TimelineEvent<T = Record<string, unknown>> {
    id: string;
    atTime: number;
    kind: string;
    label?: string;
    tags?: string[];
    payload?: T;
}
export interface TimelineWindow {
    startTime: number;
    endTime: number;
}
export interface RenderedEvent<T = Record<string, unknown>> {
    id: string;
    atTime: number;
    kind: string;
    label: string | null;
    tags: string[] | null;
    payload?: T;
    px: number;
    inWindow: boolean;
    windowPct: number;
}
export interface TimelineSnapshot<T = Record<string, unknown>> {
    width: number;
    paddingLeft: number;
    paddingRight: number;
    window: TimelineWindow;
    totalRange: TimelineWindow;
    events: RenderedEvent<T>[];
}
export interface TimelineLedgerOptions {
    width: number;
    paddingLeft?: number;
    paddingRight?: number;
}
export declare class TimelineLedger<T = Record<string, unknown>> {
    private events;
    private widthVal;
    private padL;
    private padR;
    private windowStart;
    private windowEnd;
    private windowExplicit;
    private disposed;
    private constructor();
    static create<T = Record<string, unknown>>(opts: TimelineLedgerOptions): TimelineLedger<T>;
    add(event: TimelineEvent<T>): boolean;
    remove(id: string): boolean;
    has(id: string): boolean;
    get(id: string): TimelineEvent<T> | null;
    count(): number;
    list(): TimelineEvent<T>[];
    byRange(startTime: number, endTime: number): TimelineEvent<T>[];
    byKind(kind: string): TimelineEvent<T>[];
    byTag(tag: string): TimelineEvent<T>[];
    setWindow(startTime: number, endTime: number): boolean;
    resetWindow(): void;
    getWindow(): TimelineWindow;
    setSize(width: number, paddingLeft?: number, paddingRight?: number): boolean;
    totalRange(): TimelineWindow;
    getSnapshot(): TimelineSnapshot<T>;
    forEach(cb: (e: RenderedEvent<T>) => void): void;
    clear(): void;
    dispose(): void;
    private recomputeAutoWindow;
    private publicEvent;
}
export declare const RESOURCE_TIMELINE_LEDGER = "timeline_ledger";
//# sourceMappingURL=timeline-ledger.d.ts.map