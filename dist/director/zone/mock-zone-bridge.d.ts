import type { ZoneEvent } from './zone-event-envelope.js';
import { type IZoneEventBridge, type ZoneEventBridgeStatus, type ZoneEventBridgeStats } from './zone-event-bridge.js';
export declare class MockZoneBridge implements IZoneEventBridge {
    private queue;
    private statusValue;
    private readonly lastEventIdByZone;
    private readonly statsValue;
    start(): void;
    stop(): void;
    status(): ZoneEventBridgeStatus;
    isConnected(): boolean;
    getLastEventId(zone: string): number;
    pollEvents(): ZoneEvent[];
    stats(): Readonly<ZoneEventBridgeStats>;
    enqueueIncoming(event: ZoneEvent): void;
    enqueueIncomingJson(json: string): boolean;
    enqueueAll(events: ReadonlyArray<ZoneEvent>): void;
    bumpReconnect(): void;
    setServerDrops(p1: number, p2: number): void;
    pending(): number;
}
//# sourceMappingURL=mock-zone-bridge.d.ts.map