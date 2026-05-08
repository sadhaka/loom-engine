export interface DirectorZoneStateResource {
    byZone: Map<string, Map<string, unknown>>;
}
export declare const RESOURCE_DIRECTOR_ZONE_STATE = "director_zone_state";
export declare function createDirectorZoneStateResource(): DirectorZoneStateResource;
export declare function getOrCreateZoneStateMap(res: DirectorZoneStateResource, zoneId: string): Map<string, unknown>;
export declare function applyZoneStateChanges(res: DirectorZoneStateResource, zoneId: string, changes: ReadonlyArray<{
    key: string;
    value: unknown;
}>): void;
export declare function replaceZoneStateFromSnapshot(res: DirectorZoneStateResource, zoneId: string, state: ReadonlyArray<{
    key: string;
    value: unknown;
}>): void;
//# sourceMappingURL=zone-state-resource.d.ts.map