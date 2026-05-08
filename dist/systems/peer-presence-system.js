// PeerPresenceSystem - drains the IMultiplayerBridge each tick, applies
// presence messages to the PeerPool, and (optionally) broadcasts the
// local character's position via PeerBroadcastBridge.
//
// PeerRenderSystem - iterates PeerPool at frame time, computes each
// peer's interpolated position from prev/current samples, looks up
// their sprite via PeerSpritePool, and submits drawSprite + drawText
// (name label) calls to the device.
//
// Phasing rationale (matches DirectorSystem):
//   PHASE_INPUT  - PeerPresenceSystem drains the bridge so peers are
//                  fresh before any logic system reads them. Mirrors
//                  the DirectorSystem ordering.
//   PHASE_RENDER - PeerRenderSystem submits draw calls. Per-peer
//                  interp factor is computed from the current
//                  TimeResource clock, so peers move smoothly even on
//                  frames with no inbound update.
//
// PeerPresenceSystem also routes the snapshot, update, and depart
// message kinds to the right PeerPool method:
//   snapshot -> applySnapshot (drops anyone not in the snapshot)
//   update   -> upsert
//   depart   -> remove
//
// Self-filter: callers register the local character_id via
// peerPool.setLocalCharacterId(...) at startup. The pool refuses to
// store an entry with that id; if a snapshot or update mentions it,
// it's silently skipped (we don't render ourselves as a ghost).
import { RESOURCE_MULTIPLAYER_BRIDGE, RESOURCE_PEER_POOL, } from '../network/multiplayer-bridge.js';
import { POOL_PEER_SPRITE } from '../components/peer-sprite.js';
import { RESOURCE_DEVICE, RESOURCE_CAMERA, RESOURCE_TIME, } from '../resources.js';
export class PeerPresenceSystem {
    name = 'peer-presence';
    update(world, _dt) {
        const bridge = world.resources.get(RESOURCE_MULTIPLAYER_BRIDGE);
        const pool = world.resources.get(RESOURCE_PEER_POOL);
        if (!bridge || !pool)
            return;
        const messages = bridge.pollMessages();
        if (messages.length === 0)
            return;
        for (let i = 0; i < messages.length; i++) {
            const m = messages[i];
            if (!m)
                continue;
            switch (m.kind) {
                case 'update':
                    pool.upsert(m.characterId, m.x, m.y, m.zone, m.tsMs, m.name);
                    break;
                case 'depart':
                    pool.remove(m.characterId);
                    break;
                case 'snapshot':
                    pool.applySnapshot(m.peers);
                    break;
            }
        }
    }
}
// Render-phase counterpart. Optional - consumers who only want to
// surface peer state (e.g. on a minimap) can read PeerPool directly
// and skip this system.
export class PeerRenderSystem {
    name = 'peer-render';
    // Reused per-frame to avoid allocation in the per-peer hot path.
    scratchTextStyle = {
        font: '12px sans-serif',
        fill: { r: 1, g: 1, b: 1, a: 1 },
        align: 'center',
        baseline: 'bottom',
    };
    scratchTint = {
        r: 1, g: 1, b: 1, a: 1,
    };
    // Vertical offset (world units) applied to the name label so it
    // sits just above the sprite. Tuned for the engine's standard
    // 64-px sprite cell; consumers with custom art can override via
    // the PeerRenderSystem constructor.
    labelYOffset;
    showNames;
    constructor(opts = {}) {
        this.labelYOffset = opts.labelYOffset ?? -32;
        this.showNames = opts.showNames ?? true;
    }
    update(world, _dt) {
        const pool = world.resources.get(RESOURCE_PEER_POOL);
        const sprites = world.getPool(POOL_PEER_SPRITE);
        const device = world.resources.get(RESOURCE_DEVICE);
        const camera = world.resources.get(RESOURCE_CAMERA);
        const time = world.resources.get(RESOURCE_TIME);
        if (!pool || !sprites || !device || !camera)
            return;
        device.setCamera(camera);
        // Deterministic clock - TimeResource only. Earlier versions added
        // performance.now() to mask Engine.tick callers that did not
        // advance time; the HeadlessTicker advances it correctly. Adding
        // wall-clock noise here was making peer interpolation diverge
        // across replays.
        const nowMs = time ? time.elapsed * 1000 : 0;
        const frame = time ? time.frame : -1;
        // Capture the values we need from each peer before drawing.
        // forEachRendered's view is reused; we have to read fields out
        // before the next iteration mutates the scratch.
        pool.forEachRendered(nowMs, frame, (view) => {
            const entry = sprites.resolve(view.characterId);
            if (entry.tint) {
                const t = this.scratchTint;
                t.r = entry.tint.r;
                t.g = entry.tint.g;
                t.b = entry.tint.b;
                t.a = entry.tint.a;
                device.drawSprite(view.x, view.y, 0, entry.atlas, entry.frame, t);
            }
            else {
                device.drawSprite(view.x, view.y, 0, entry.atlas, entry.frame);
            }
            if (this.showNames && view.name) {
                device.drawText(view.x, view.y + this.labelYOffset, view.name, this.scratchTextStyle);
            }
        });
    }
}
//# sourceMappingURL=peer-presence-system.js.map