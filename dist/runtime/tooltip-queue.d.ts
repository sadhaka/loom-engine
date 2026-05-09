export type TooltipState = 'fadeIn' | 'visible' | 'fadeOut';
export interface Tooltip {
    id: number;
    anchorId: string;
    content: string;
    state: TooltipState;
    alpha: number;
    ageMs: number;
    remainingMs: number;
    data?: Record<string, unknown>;
}
export interface ShowOptions {
    lifetimeMs?: number;
    data?: Record<string, unknown>;
}
export interface TooltipQueueOptions {
    capacity?: number;
    fadeInMs?: number;
    fadeOutMs?: number;
    defaultLifetimeMs?: number;
    replaceOnSameAnchor?: boolean;
    onShow?: (t: Tooltip) => void;
    onRemoved?: (t: Tooltip, reason: 'expired' | 'hidden' | 'evicted') => void;
}
export declare class TooltipQueue {
    private tips;
    private nextId;
    private capacityNum;
    private fadeInDefault;
    private fadeOutDefault;
    private defaultLifetime;
    private replaceOnSameAnchor;
    private onShow;
    private onRemoved;
    private disposed;
    private constructor();
    static create(opts?: TooltipQueueOptions): TooltipQueue;
    show(anchorId: string, content: string, opts?: ShowOptions): number;
    hide(anchorId: string): number;
    hideById(id: number): boolean;
    tick(dtMs: number): void;
    forEach(cb: (t: Tooltip) => void): void;
    list(): Tooltip[];
    byAnchor(anchorId: string): Tooltip[];
    count(): number;
    capacity(): number;
    clear(): void;
    dispose(): void;
    private beginFadeOut;
    private evictOne;
    private publicView;
}
export declare const RESOURCE_TOOLTIP_QUEUE = "tooltip_queue";
//# sourceMappingURL=tooltip-queue.d.ts.map