import type { DirectorEvent } from './event-envelope.js';
export type DirectorBridgeStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'snapshot-required' | 'closed';
export interface DirectorBridgeStats {
    eventsReceived: number;
    reconnects: number;
    lastEventId: number;
    outOfOrderEvents: number;
    serverDropsP1: number;
    serverDropsP2: number;
}
export interface IDirectorBridge {
    start(): void;
    stop(): void;
    status(): DirectorBridgeStatus;
    isConnected(): boolean;
    getLastEventId(): number;
    pollEvents(): DirectorEvent[];
    stats(): Readonly<DirectorBridgeStats>;
}
export declare const RESOURCE_DIRECTOR_BRIDGE = "director_bridge";
export declare const RESOURCE_KNOT_CONTEXT = "knot_context";
//# sourceMappingURL=director-bridge.d.ts.map