export type ZoneId = 'lastlight_plaza' | 'iron_reach' | 'saltsprig' | 'the_archive' | 'hammerwash' | 'crystwell' | 'forge_archive' | 'centerknot_crossroads';
export type TransitionKind = 'walk' | 'portal' | 'cinematic' | 'instant';
export interface ZoneStateResource {
    activeZoneId: ZoneId;
    transition: {
        fromZoneId: ZoneId;
        toZoneId: ZoneId;
        kind: TransitionKind;
        startMs: number;
        durationMs: number;
    } | null;
}
export declare function createZoneState(initial?: ZoneId): ZoneStateResource;
export declare function beginTransition(state: ZoneStateResource, toZoneId: ZoneId, kind: TransitionKind, durationMs: number, nowMs: number): boolean;
export declare function tickTransition(state: ZoneStateResource, nowMs: number): number;
export declare function isTransitioning(state: ZoneStateResource): boolean;
export declare const RESOURCE_ZONE_STATE = "zone_state";
//# sourceMappingURL=zone-state.d.ts.map