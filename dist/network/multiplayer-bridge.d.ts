export type MultiplayerBridgeStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';
export interface MultiplayerBridgeStats {
    messagesReceived: number;
    messagesSent: number;
    rateLimitedDrops: number;
    reconnects: number;
}
export interface PresenceUpdate {
    kind: 'update';
    characterId: string;
    x: number;
    y: number;
    zone: string;
    tsMs: number;
    name?: string;
}
export interface PresenceDepart {
    kind: 'depart';
    characterId: string;
}
export interface PresenceSnapshot {
    kind: 'snapshot';
    peers: ReadonlyArray<{
        characterId: string;
        x: number;
        y: number;
        zone: string;
        tsMs: number;
        name?: string;
    }>;
}
export type PresenceMessage = PresenceUpdate | PresenceDepart | PresenceSnapshot;
export interface IMultiplayerBridge {
    connect(): void;
    disconnect(): void;
    status(): MultiplayerBridgeStatus;
    pollMessages(): PresenceMessage[];
    broadcastPosition(x: number, y: number, zone: string, tsMs: number): void;
    stats(): Readonly<MultiplayerBridgeStats>;
}
export declare const RESOURCE_MULTIPLAYER_BRIDGE = "multiplayer_bridge";
export declare const RESOURCE_PEER_POOL = "peer_pool";
export declare const BROADCAST_HZ = 10;
export declare const BROADCAST_MIN_INTERVAL_MS: number;
//# sourceMappingURL=multiplayer-bridge.d.ts.map