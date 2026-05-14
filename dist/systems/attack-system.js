// AttackSystem - reads input + camera + transforms and applies
// damage to the entity nearest the click point. Phase 7's minimum
// player attack.
//
// For Phase 7's combat slice, this is intentionally simple:
//   - Click anywhere -> damage the nearest pursuing entity
//   - Damage amount is a constructor parameter
//   - Range is a constructor parameter (max world distance from
//     click)
//
// Real Survivor combat will replace this with a per-skill router:
//   - Different click positions = different skills
//   - Skills have cooldowns, projectiles, AoE patterns
//   - Knot-context modifies damage type
// All of which fit the engine's existing surface (TimeResource for
// cooldowns, ParticleEmitterPool for projectiles, KnotContextResource
// for damage tinting). For Phase 7's first slice we ship the simplest
// working attack.
import { POOL_TRANSFORM } from '../world.js';
import { POOL_HEALTH } from '../components/health.js';
import { POOL_PURSUE } from '../components/pursue.js';
import { RESOURCE_INPUT, } from '../input/input-manager.js';
import { RESOURCE_CAMERA, RESOURCE_TIME, } from '../resources.js';
import { isoToTile } from '../renderer/iso-projection.js';
import { vec2 } from '../util/math.js';
const SCRATCH_TILE = vec2(0, 0);
export class AttackSystem {
    opts;
    name = 'attack';
    // Last entity damaged this tick (for VFX hooks). -1 if no hit.
    lastTargetIndex = -1;
    lastDamageApplied = 0;
    constructor(opts) {
        this.opts = opts;
    }
    update(world, _dt) {
        const input = world.resources.get(RESOURCE_INPUT);
        const camera = world.resources.get(RESOURCE_CAMERA);
        if (!input || !camera)
            return;
        const transforms = world.getPool(POOL_TRANSFORM);
        const health = world.getPool(POOL_HEALTH);
        const pursuit = world.getPool(POOL_PURSUE);
        if (!transforms || !health || !pursuit)
            return;
        this.lastTargetIndex = -1;
        this.lastDamageApplied = 0;
        // Only react to a fresh primary-button click.
        const leftClicked = (input.pointerPressedThisFrame & 1) !== 0;
        if (!leftClicked)
            return;
        // Convert click pixel coords -> world iso -> tile.
        const worldIsoX = (input.pointer.x - camera.viewportWidth / 2) / camera.zoom + camera.centerX;
        const worldIsoY = (input.pointer.y - camera.viewportHeight / 2) / camera.zoom + camera.centerY;
        isoToTile(worldIsoX, worldIsoY, SCRATCH_TILE);
        const clickTileX = SCRATCH_TILE.x;
        const clickTileY = SCRATCH_TILE.y;
        // Find the nearest pursuer (i.e. enemy) within range.
        const playerIdx = this.opts.player & 0x00ffffff;
        const hwm = pursuit.getHighWaterMark();
        let bestIdx = -1;
        let bestDist = this.opts.range;
        for (let i = 1; i < hwm; i++) {
            if (i === playerIdx)
                continue; // never damage the player via this attack
            const f = pursuit.flags[i] ?? 0;
            if ((f & 1) === 0)
                continue; // PURSUE_FLAG_ACTIVE
            // Only attack live entities. entityAt(i) is the canonical
            // handle for the slot - never makeEntity(i, 0), which goes
            // stale the moment the slot is recycled.
            if (health.isDead(world.entityAt(i)))
                continue;
            const tx = transforms.x[i] ?? 0;
            const ty = transforms.y[i] ?? 0;
            const dx = tx - clickTileX;
            const dy = ty - clickTileY;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        if (bestIdx < 0)
            return;
        const target = world.entityAt(bestIdx);
        // Deterministic clock - TimeResource (engine-driven) instead of
        // performance.now(). Same seed + same tick stream => same `now`,
        // so trace replays observe identical applyDamage timestamps.
        const time = world.resources.get(RESOURCE_TIME);
        const now = time ? time.elapsed * 1000 : 0;
        const applied = health.applyDamage(target, this.opts.damage, now);
        if (applied > 0) {
            this.lastTargetIndex = bestIdx;
            this.lastDamageApplied = applied;
        }
    }
}
//# sourceMappingURL=attack-system.js.map