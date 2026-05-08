import type { World } from '../world.js';
import type { EventEnvelope } from './event-envelope.js';
export interface SnapshotResponse {
    ok: boolean;
    character_id: string;
    tail_id: number;
    snapshot: {
        knot_context: EventEnvelope<'knot.context'> | null;
        ve_budget: EventEnvelope<'ve.budget.update'> | null;
        scene: EventEnvelope<'scene.transition'> | null;
        active_encounter: EventEnvelope<'encounter.spawn'> | null;
    };
    ts: number;
}
export declare class SnapshotFetchError extends Error {
    readonly kind: 'network' | 'http' | 'parse' | 'invalid';
    readonly status: number;
    readonly url: string;
    constructor(kind: SnapshotFetchError['kind'], url: string, message: string, status?: number);
}
export interface SnapshotRecoveryOptions {
    baseUrl: string;
    characterId: string;
    fetchImpl?: typeof fetch;
}
export declare class SnapshotRecoveryHelper {
    private readonly baseUrl;
    private readonly characterId;
    private readonly fetchImpl;
    constructor(opts: SnapshotRecoveryOptions);
    fetchSnapshot(): Promise<SnapshotResponse>;
    applySnapshot(world: World, snapshot: SnapshotResponse): void;
    recover(world: World): Promise<number>;
    private buildUrl;
    private validateResponse;
}
//# sourceMappingURL=snapshot-recovery.d.ts.map