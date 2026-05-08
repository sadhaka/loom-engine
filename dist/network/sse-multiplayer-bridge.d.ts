import { type IMultiplayerBridge, type MultiplayerBridgeStatus, type MultiplayerBridgeStats, type PresenceMessage } from './multiplayer-bridge.js';
export interface SSEMultiplayerBridgeOptions {
    baseUrl: string;
    broadcastUrl?: string;
    characterId: string;
    zone: string;
    eventSourceFactory?: (url: string) => EventSource;
    fetchFn?: typeof fetch;
}
export declare class SSEMultiplayerBridge implements IMultiplayerBridge {
    private readonly baseUrl;
    private readonly broadcastUrl;
    private readonly characterId;
    private readonly zone;
    private readonly eventSourceFactory;
    private readonly fetchFn;
    private es;
    private queue;
    private statusValue;
    private statsValue;
    private lastBroadcastMs;
    constructor(opts: SSEMultiplayerBridgeOptions);
    connect(): void;
    disconnect(): void;
    status(): MultiplayerBridgeStatus;
    pollMessages(): PresenceMessage[];
    broadcastPosition(x: number, y: number, zone: string, tsMs: number): void;
    stats(): Readonly<MultiplayerBridgeStats>;
    private buildUrl;
    private openConnection;
    private closeConnection;
    private handleUpdate;
    private handleDepart;
    private handleSnapshot;
}
//# sourceMappingURL=sse-multiplayer-bridge.d.ts.map