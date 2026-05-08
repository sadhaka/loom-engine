import type { ZoneEvent } from './zone-event-envelope.js';
export interface ZoneBossHitRecord {
    amount: number;
    at_ms: number;
    from_character_id: string;
}
export interface ZoneBossEntity {
    zone_id: string;
    boss_id: string;
    name: string;
    type: string;
    hp_max: number;
    hp_current: number;
    dmg: number;
    x: number;
    y: number;
    knot_flavor: string;
    spawned_at_ms: number;
    last_tick_ms: number;
    recent_hits: ZoneBossHitRecord[];
}
export interface ZoneBossEntityResource {
    byZone: Map<string, ZoneBossEntity | null>;
}
export declare const RESOURCE_ZONE_BOSS_ENTITY = "zone_boss_entity";
export declare const RECENT_HITS_RING_SIZE = 32;
export declare function createZoneBossEntityResource(): ZoneBossEntityResource;
export declare function buildEntityFromSpawn(env: ZoneEvent): ZoneBossEntity;
export declare function applyTick(entity: ZoneBossEntity, env: ZoneEvent): void;
//# sourceMappingURL=zone-boss-entity.d.ts.map