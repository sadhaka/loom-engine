import type { DirectorEvent } from './event-envelope.js';
import { type IDirectorBridge, type DirectorBridgeStatus, type DirectorBridgeStats } from './director-bridge.js';
export interface SSEDirectorBridgeOptions {
    baseUrl: string;
    characterId: string;
    fps?: number;
    dropP2?: boolean;
    eventSourceFactory?: (url: string) => EventSource;
    initialLastEventId?: number;
}
export declare class SSEDirectorBridge implements IDirectorBridge {
    private readonly baseUrl;
    private readonly characterId;
    private readonly fps;
    private readonly dropP2;
    private readonly eventSourceFactory;
    private es;
    private queue;
    private statusValue;
    private statsValue;
    private reorderBuffer;
    private reorderTimeoutHandle;
    private static readonly REORDER_BUFFER_MAX;
    private static readonly REORDER_TIMEOUT_MS;
    constructor(opts: SSEDirectorBridgeOptions);
    start(): void;
    stop(): void;
    status(): DirectorBridgeStatus;
    isConnected(): boolean;
    getLastEventId(): number;
    pollEvents(): DirectorEvent[];
    stats(): Readonly<DirectorBridgeStats>;
    private buildUrl;
    private openConnection;
    private closeConnection;
    private handleRaw;
    private armReorderTimeout;
    private drainReorderBuffer;
    private flushReorderBufferAsIs;
    private clearReorderBuffer;
}
//# sourceMappingURL=sse-director-bridge.d.ts.map