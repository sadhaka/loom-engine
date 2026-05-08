import { type IMultiplayerBridge, type MultiplayerBridgeStatus, type MultiplayerBridgeStats, type PresenceMessage } from './multiplayer-bridge.js';
export interface MockMultiplayerBridgeOptions {
    nowMs?: () => number;
}
interface SentBroadcast {
    x: number;
    y: number;
    zone: string;
    tsMs: number;
    sentAtMs: number;
}
export declare class MockMultiplayerBridge implements IMultiplayerBridge {
    private queue;
    private statusValue;
    private statsValue;
    private readonly nowMs;
    private lastBroadcastMs;
    private sentBroadcasts;
    constructor(opts?: MockMultiplayerBridgeOptions);
    connect(): void;
    disconnect(): void;
    status(): MultiplayerBridgeStatus;
    pollMessages(): PresenceMessage[];
    broadcastPosition(x: number, y: number, zone: string, tsMs: number): void;
    stats(): Readonly<MultiplayerBridgeStats>;
    enqueueIncoming(msg: PresenceMessage): void;
    enqueueIncomingAll(msgs: ReadonlyArray<PresenceMessage>): void;
    getSentBroadcasts(): ReadonlyArray<Readonly<SentBroadcast>>;
    pendingIncoming(): number;
    resetRateLimit(): void;
    getLastBroadcastMs(): number;
}
export {};
//# sourceMappingURL=mock-multiplayer-bridge.d.ts.map