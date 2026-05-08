import type { ZoneEvent } from './zone-event-envelope.js';
export type ZoneEventBridgeStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'snapshot-required' | 'closed';
export interface ZoneEventBridgeStats {
    eventsReceived: number;
    reconnects: number;
    outOfOrderEvents: number;
    serverDropsP1: number;
    serverDropsP2: number;
    lastEventIdByZone: ReadonlyMap<string, number>;
}
export interface IZoneEventBridge {
    start(): void;
    stop(): void;
    status(): ZoneEventBridgeStatus;
    isConnected(): boolean;
    getLastEventId(zone: string): number;
    pollEvents(): ZoneEvent[];
    stats(): Readonly<ZoneEventBridgeStats>;
}
export declare const RESOURCE_ZONE_EVENT_BRIDGE = "zone_event_bridge";
//# sourceMappingURL=zone-event-bridge.d.ts.map