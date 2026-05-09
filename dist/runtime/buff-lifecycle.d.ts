import type { Modifier } from './stat-stack.js';
export interface Buff {
    id: string;
    durationMs: number;
    modifiers?: Modifier[];
    tickIntervalMs?: number;
    data?: Record<string, unknown>;
}
export interface ActiveBuff {
    buff: Buff;
    remainingMs: number;
    elapsedMs: number;
    ticksFired: number;
}
interface IStatStackLike {
    addModifier(m: Modifier): boolean;
    removeBySource(source: string): number;
}
export interface BuffLifecycleOptions {
    statStack?: IStatStackLike;
    sourcePrefix?: string;
    onApplied?: (buff: Buff, isRefresh: boolean) => void;
    onExpired?: (buff: Buff) => void;
    onRemoved?: (buff: Buff) => void;
    onTick?: (buff: Buff, tickIndex: number) => void;
}
export declare class BuffLifecycle {
    private active;
    private statStack;
    private sourcePrefix;
    private onApplied;
    private onExpired;
    private onRemoved;
    private onTick;
    private disposed;
    private constructor();
    static create(opts?: BuffLifecycleOptions): BuffLifecycle;
    apply(buff: Buff): boolean;
    refresh(id: string): boolean;
    remove(id: string): boolean;
    removeAll(): number;
    has(id: string): boolean;
    remainingMs(id: string): number;
    list(): ActiveBuff[];
    tick(dtMs: number): void;
    dispose(): void;
    private cleanup;
}
export declare const RESOURCE_BUFF_LIFECYCLE = "buff_lifecycle";
export {};
//# sourceMappingURL=buff-lifecycle.d.ts.map