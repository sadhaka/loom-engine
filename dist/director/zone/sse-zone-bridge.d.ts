import type { ZoneEvent } from './zone-event-envelope.js';
import { type IZoneEventBridge, type ZoneEventBridgeStatus, type ZoneEventBridgeStats } from './zone-event-bridge.js';
export interface SSEZoneBridgeEventSource {
    readonly readyState: number;
    addEventListener(type: string, listener: (event: {
        data?: unknown;
    }) => void): void;
    removeEventListener?(type: string, listener: (event: {
        data?: unknown;
    }) => void): void;
}
export interface SSEZoneBridgeOptions {
    eventSource: SSEZoneBridgeEventSource;
    characterId: string;
    currentZone: () => string;
    eventName?: string;
    filterAtReceive?: boolean;
    nowFn?: () => number;
    statusEventTarget?: EventTarget | null;
}
export declare class SSEZoneBridge implements IZoneEventBridge {
    private readonly es;
    private readonly characterId;
    private readonly currentZone;
    private readonly eventName;
    private readonly filterAtReceive;
    private readonly nowFn;
    private readonly statusEventTarget;
    private listener;
    private queue;
    private statusValue;
    private readonly lastEventIdByZone;
    private readonly statsValue;
    constructor(opts: SSEZoneBridgeOptions);
    private transitionTo;
    start(): void;
    stop(): void;
    status(): ZoneEventBridgeStatus;
    isConnected(): boolean;
    getLastEventId(zone: string): number;
    pollEvents(): ZoneEvent[];
    stats(): Readonly<ZoneEventBridgeStats>;
    private handleRaw;
}
//# sourceMappingURL=sse-zone-bridge.d.ts.map