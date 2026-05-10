// MobCatalog - data table of Survivor-style mob archetypes.
//
// Each entry describes an archetype's stats, AI behaviour, and
// rendering. Phase 7 deeper port: 3 baseline archetypes derived from
// the legacy Survivor (skel_warrior melee, skel_archer ranged,
// skel_caster homing) but rebuilt as engine-side configuration data
// rather than copying the legacy three.js sprite code.
//
// spawnMob(world, type, x, y, target, atlas) is the factory: it
// creates an entity and attaches the components implied by the
// catalog entry. The actual sprite atlas is passed in by the caller
// because asset registration is application-side; the catalog only
// describes WHICH frame + tint to use, not how to load the asset.
import { POOL_TRANSFORM, POOL_SPRITE } from '../world.js';
import { POOL_HEALTH } from '../components/health.js';
import { POOL_PURSUE } from '../components/pursue.js';
import { POOL_RANGED } from '../components/ranged-attack.js';
import { hexToRgba } from '../util/color.js';
export const MOB_CATALOG = {
    skel_warrior: {
        archetype: 'skel_warrior',
        name: 'Skeleton Warrior',
        hp: 50,
        speed: 0.8,
        stopDistance: 0.5,
        contactDamage: 8,
        contactCooldownMs: 1000,
        tint: hexToRgba(0xffffff, 1), // bone-white default; demo colors via per-spawn override
        ranged: null,
    },
    skel_archer: {
        archetype: 'skel_archer',
        name: 'Skeleton Archer',
        hp: 35,
        speed: 0.6,
        stopDistance: 3.0, // hangs back at 3 tiles
        contactDamage: 0,
        contactCooldownMs: 1000,
        tint: hexToRgba(0xfff0a0, 1), // pale yellow-bone
        ranged: {
            range: 4.0,
            minRange: 1.0,
            cooldownMs: 1500,
            damage: 6,
            projectileSpeed: 5.0,
            projectileLife: 2.0,
            projectileSize: 5,
            projectileColor: hexToRgba(0xffeb88, 1), // pale-gold arrow
            homing: false,
        },
    },
    skel_caster: {
        archetype: 'skel_caster',
        name: 'Skeleton Caster',
        hp: 30,
        speed: 0.4,
        stopDistance: 4.5, // stays far back
        contactDamage: 0,
        contactCooldownMs: 1000,
        tint: hexToRgba(0xc88cff, 1), // violet-bone (sigil-orb hint)
        ranged: {
            range: 5.0,
            minRange: 1.5,
            cooldownMs: 2200,
            damage: 12,
            projectileSpeed: 3.0,
            projectileLife: 4.0,
            projectileSize: 6,
            projectileColor: hexToRgba(0xb86eff, 1), // homing violet bolt
            homing: true,
        },
    },
};
// Spawn a mob entity with all components attached per the catalog.
// Returns the new EntityId.
export function spawnMob(world, archetype, x, y, target, atlas, frame = 0) {
    const cat = MOB_CATALOG[archetype];
    const e = world.createEntity();
    const transforms = world.requirePool(POOL_TRANSFORM);
    const sprites = world.requirePool(POOL_SPRITE);
    const health = world.requirePool(POOL_HEALTH);
    const pursuit = world.requirePool(POOL_PURSUE);
    transforms.attach(e, x, y, 0);
    sprites.attach(e, atlas, frame, cat.tint);
    health.attach(e, cat.hp);
    pursuit.attach(e, target, cat.speed, cat.stopDistance, cat.contactDamage, cat.contactCooldownMs);
    if (cat.ranged) {
        const ranged = world.requirePool(POOL_RANGED);
        ranged.attach(e, {
            target,
            range: cat.ranged.range,
            minRange: cat.ranged.minRange,
            cooldownMs: cat.ranged.cooldownMs,
            damage: cat.ranged.damage,
            projectileSpeed: cat.ranged.projectileSpeed,
            projectileLife: cat.ranged.projectileLife,
            projectileSize: cat.ranged.projectileSize,
            projectileColor: cat.ranged.projectileColor,
            homing: cat.ranged.homing,
        });
    }
    return e;
}
//# sourceMappingURL=mob-catalog.js.map