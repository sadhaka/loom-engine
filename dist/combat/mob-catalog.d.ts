import type { World } from '../world.js';
import type { ColorRGBA } from '../util/color.js';
import type { AtlasHandle } from '../renderer/graphics-device.js';
import type { EntityId } from '../entity.js';
export type MobArchetype = 'skel_warrior' | 'skel_archer' | 'skel_caster';
export interface MobCatalogEntry {
    archetype: MobArchetype;
    name: string;
    hp: number;
    speed: number;
    stopDistance: number;
    contactDamage: number;
    contactCooldownMs: number;
    tint: Readonly<ColorRGBA>;
    ranged: {
        range: number;
        minRange: number;
        cooldownMs: number;
        damage: number;
        projectileSpeed: number;
        projectileLife: number;
        projectileSize: number;
        projectileColor: Readonly<ColorRGBA>;
        homing: boolean;
    } | null;
}
export declare const MOB_CATALOG: Record<MobArchetype, MobCatalogEntry>;
export declare function spawnMob(world: World, archetype: MobArchetype, x: number, y: number, target: EntityId, atlas: AtlasHandle, frame?: number): EntityId;
//# sourceMappingURL=mob-catalog.d.ts.map