// InteractionSystem - detects player interactions with Interactable
// entities (NPCs, portals, lore stones).
//
// Two trigger paths:
//   1. Click on or near an interactable entity (within its radius)
//   2. Press 'KeyE' or 'Enter' while in range of any interactable
//      (per CLAUDE.md hotkey lock list: E + Enter open NPC dialog)
//
// Output: writes the most recently triggered interaction to the
// LastInteractionResource. Gameplay code reads this to show dialog,
// trigger zone transitions, etc. Cleared after one tick of being
// read so each interaction fires exactly once.
import { POOL_TRANSFORM } from '../world.js';
import { POOL_INTERACTABLE, INTERACTABLE_FLAG_ACTIVE, } from '../components/interactable.js';
import { RESOURCE_INPUT, } from '../input/input-manager.js';
import { RESOURCE_CAMERA } from '../resources.js';
import { isoToTile } from '../renderer/iso-projection.js';
import { vec2 } from '../util/math.js';
import { makeEntity, entityIndex } from '../entity.js';
const SCRATCH_TILE = vec2(0, 0);
export function createLastInteraction() {
    return {
        entityIndex: -1,
        atFrame: -1,
        kind: 'npc',
        payload: '',
        prompt: '',
    };
}
export const RESOURCE_LAST_INTERACTION = 'last_interaction';
export class InteractionSystem {
    opts;
    name = 'interaction';
    constructor(opts) {
        this.opts = opts;
    }
    update(world, _dt) {
        const input = world.resources.get(RESOURCE_INPUT);
        if (!input)
            return;
        const camera = world.resources.get(RESOURCE_CAMERA);
        const transforms = world.getPool(POOL_TRANSFORM);
        const interactables = world.getPool(POOL_INTERACTABLE);
        const last = world.resources.get(RESOURCE_LAST_INTERACTION);
        if (!camera || !transforms || !interactables || !last)
            return;
        const playerIdx = entityIndex(this.opts.player);
        const px = transforms.x[playerIdx] ?? 0;
        const py = transforms.y[playerIdx] ?? 0;
        // Trigger paths:
        //   - Left click anywhere -> find interactable nearest the click
        //     point that is within its own radius
        //   - 'KeyE' or 'Enter' pressedThisFrame -> find nearest
        //     interactable to the player that is within its own radius
        const leftClicked = (input.pointerPressedThisFrame & 1) !== 0;
        const eKey = input.keysPressedThisFrame.has('KeyE') || input.keysPressedThisFrame.has('Enter');
        if (!leftClicked && !eKey)
            return;
        let probeX;
        let probeY;
        if (leftClicked) {
            // Convert click pixel coords -> world iso -> tile.
            const worldIsoX = (input.pointer.x - camera.viewportWidth / 2) / camera.zoom + camera.centerX;
            const worldIsoY = (input.pointer.y - camera.viewportHeight / 2) / camera.zoom + camera.centerY;
            isoToTile(worldIsoX, worldIsoY, SCRATCH_TILE);
            probeX = SCRATCH_TILE.x;
            probeY = SCRATCH_TILE.y;
        }
        else {
            // E / Enter: probe at player's position.
            probeX = px;
            probeY = py;
        }
        // Find the nearest interactable whose radius contains the probe.
        const hwm = interactables.getHighWaterMark();
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 1; i < hwm; i++) {
            if (i === playerIdx)
                continue;
            const f = interactables.flags[i] ?? 0;
            if ((f & INTERACTABLE_FLAG_ACTIVE) === 0)
                continue;
            const tx = transforms.x[i] ?? 0;
            const ty = transforms.y[i] ?? 0;
            const dx = tx - probeX;
            const dy = ty - probeY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const radius = interactables.radius[i] ?? 0;
            if (dist > radius)
                continue;
            // For E/Enter: also require the player itself be within radius
            // (so the player can't trigger an NPC across the map by pressing
            // E while standing right next to a different one).
            if (eKey) {
                const playerDx = tx - px;
                const playerDy = ty - py;
                if (Math.sqrt(playerDx * playerDx + playerDy * playerDy) > radius)
                    continue;
            }
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = i;
            }
        }
        if (bestIdx < 0)
            return;
        last.entityIndex = bestIdx;
        last.kind = interactables.kind[bestIdx] ?? 'npc';
        last.payload = interactables.payload[bestIdx] ?? '';
        last.prompt = interactables.prompt[bestIdx] ?? '';
        // atFrame is read by the gameplay handler to detect "new" - we
        // bump it to the entity index plus a tick salt so successive
        // identical-target reads still register as new. Simpler: any
        // monotonic increment works.
        last.atFrame = (last.atFrame ?? 0) + 1;
        void makeEntity; // imported but only used by callers via index
    }
}
//# sourceMappingURL=interaction-system.js.map