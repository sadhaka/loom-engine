import type { DirectorEvent } from './event-envelope.js';
import { type IDirectorBridge, type DirectorBridgeStatus, type DirectorBridgeStats } from './director-bridge.js';
export declare class MockDirectorBridge implements IDirectorBridge {
    private queue;
    private statusValue;
    private statsValue;
    start(): void;
    stop(): void;
    status(): DirectorBridgeStatus;
    isConnected(): boolean;
    getLastEventId(): number;
    pollEvents(): DirectorEvent[];
    stats(): Readonly<DirectorBridgeStats>;
    enqueue(event: DirectorEvent): void;
    enqueueAll(events: ReadonlyArray<DirectorEvent>): void;
    pending(): number;
}
//# sourceMappingURL=mock-director-bridge.d.ts.map