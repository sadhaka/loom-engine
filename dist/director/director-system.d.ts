import type { System } from '../system.js';
import type { World } from '../world.js';
import type { DirectorEvent, VeilTier } from './event-envelope.js';
export interface DirectorEventLog {
    recent: DirectorEvent[];
    lastNarratorLine: string | null;
    lastNarratorTtlMs: number;
    lastKnot: string | null;
    activeEncounterId: string | null;
    lastTier: VeilTier;
    eventsApplied: number;
}
export declare const RESOURCE_DIRECTOR_LOG = "director_log";
export declare function createDirectorEventLog(): DirectorEventLog;
export declare class DirectorSystem implements System {
    readonly name: string;
    update(world: World, _dt: number): void;
}
//# sourceMappingURL=director-system.d.ts.map