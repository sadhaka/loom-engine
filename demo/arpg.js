// Loom Engine - Phase 8 v1 ARPG demo.
//
// Lastlight Plaza is the only playable zone in v1. Every knot
// archetype (str / dex / int / hybrids / center) spawns here on
// /arpg-loom/ load - the knot still drives palette + HUD but does
// not branch the spawn location until subsequent phases ship more
// zones. Misha Dev is the only NPC.
//
// Per LOOM-CLASS-SYSTEM-SPEC §3 (knot data shape) and the v1
// hotkey lock list in CLAUDE.md (E + Enter open NPC dialog).
import { LOOM_ENGINE_VERSION, Engine, POOL_TRANSFORM, POOL_SPRITE, POOL_ANIMATION, POOL_INTERACTABLE, ISO_TILE_WIDTH, ISO_TILE_HEIGHT, AnimationSystem, SpriteRenderSystem, InputSystem, InteractionSystem, ZONE_CATALOG, tickTransition, isTransitioning, RESOURCE_DEVICE, RESOURCE_CAMERA, RESOURCE_TIME, RESOURCE_INPUT, RESOURCE_ZONE_STATE, RESOURCE_LAST_INTERACTION, SYSTEM_PHASE_INPUT, SYSTEM_PHASE_LOGIC, SYSTEM_PHASE_ANIMATION, SYSTEM_PHASE_RENDER, loadSpriteSheet, rgbaToHexString, } from '../dist/index.js';
const canvas = document.getElementById('stage');
const stats = document.getElementById('stats');
const dialogBox = document.getElementById('dialog');
const dialogSpeaker = document.getElementById('dialog-speaker');
const dialogLine = document.getElementById('dialog-line');
const dialogClose = document.getElementById('dialog-close');
dialogClose.addEventListener('click', () => {
    dialogBox.classList.remove('show');
});
// ---------- Procedural tile atlas builder per zone palette ----------
function makeTileAtlasFor(zone) {
    const c = document.createElement('canvas');
    c.width = ISO_TILE_WIDTH;
    c.height = ISO_TILE_HEIGHT;
    const ctx = c.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(ISO_TILE_WIDTH / 2, 0);
    ctx.lineTo(ISO_TILE_WIDTH, ISO_TILE_HEIGHT / 2);
    ctx.lineTo(ISO_TILE_WIDTH / 2, ISO_TILE_HEIGHT);
    ctx.lineTo(0, ISO_TILE_HEIGHT / 2);
    ctx.closePath();
    ctx.fillStyle = rgbaToHexString(zone.palette.fill);
    ctx.fill();
    ctx.strokeStyle = rgbaToHexString(zone.palette.stroke);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ISO_TILE_WIDTH / 2, 1);
    ctx.lineTo(ISO_TILE_WIDTH - 1, ISO_TILE_HEIGHT / 2);
    ctx.lineTo(ISO_TILE_WIDTH / 2, ISO_TILE_HEIGHT - 1);
    ctx.strokeStyle = rgbaToHexString(zone.palette.highlight);
    ctx.stroke();
    return c;
}
// Misha Dev NPC sprite - tall figure in Strknot iron-red, distinct
// from generic enemy sprites.
function makeMishaSprite() {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 32;
    const ctx = c.getContext('2d');
    // Body - deep iron-red robe.
    ctx.fillStyle = '#7a3a1c';
    ctx.fillRect(4, 12, 8, 16);
    // Robe trim - brighter iron-red.
    ctx.fillStyle = '#b04a24';
    ctx.fillRect(4, 12, 8, 2);
    ctx.fillRect(4, 24, 8, 1);
    // Head - tan.
    ctx.fillStyle = '#d8b878';
    ctx.fillRect(5, 4, 6, 6);
    // Eyes
    ctx.fillStyle = '#000';
    ctx.fillRect(6, 6, 1, 1);
    ctx.fillRect(9, 6, 1, 1);
    // Hair / cap - dark brown.
    ctx.fillStyle = '#3a2616';
    ctx.fillRect(4, 2, 8, 3);
    // Staff in right hand
    ctx.fillStyle = '#8a6a40';
    ctx.fillRect(13, 6, 1, 22);
    // Glow at staff top
    ctx.fillStyle = '#ffd86a';
    ctx.fillRect(12, 4, 3, 3);
    return c;
}
// ---------- Demo systems ----------
class ZoneTileRenderSystem {
    radius;
    name = 'arpg-tile-render';
    // Per-zone atlas handles. The system picks the right one based
    // on the active zone in ZoneStateResource.
    atlasByZone = new Map();
    constructor(radius) {
        this.radius = radius;
    }
    registerAtlas(zoneId, atlas) {
        this.atlasByZone.set(zoneId, atlas);
    }
    update(world, _dt) {
        const device = world.resources.require(RESOURCE_DEVICE);
        const camera = world.resources.require(RESOURCE_CAMERA);
        const zone = world.resources.require(RESOURCE_ZONE_STATE);
        const atlas = this.atlasByZone.get(zone.activeZoneId);
        if (atlas === undefined)
            return;
        device.setCamera(camera);
        for (let ty = -this.radius; ty <= this.radius; ty++) {
            for (let tx = -this.radius; tx <= this.radius; tx++) {
                device.drawTile(tx, ty, atlas, 0);
            }
        }
    }
}
class WASDMoveSystem {
    player;
    speed;
    name = 'arpg-wasd-move';
    constructor(player, speed) {
        this.player = player;
        this.speed = speed;
    }
    update(world, dt) {
        const input = world.resources.get(RESOURCE_INPUT);
        const transforms = world.requirePool(POOL_TRANSFORM);
        const zone = world.resources.require(RESOURCE_ZONE_STATE);
        if (!input)
            return;
        if (isTransitioning(zone))
            return; // freeze input during fade
        let dx = 0, dy = 0;
        if (input.keysHeld.has('ArrowLeft') || input.keysHeld.has('KeyA'))
            dx -= 1;
        if (input.keysHeld.has('ArrowRight') || input.keysHeld.has('KeyD'))
            dx += 1;
        if (input.keysHeld.has('ArrowUp') || input.keysHeld.has('KeyW'))
            dy -= 1;
        if (input.keysHeld.has('ArrowDown') || input.keysHeld.has('KeyS'))
            dy += 1;
        if (dx === 0 && dy === 0)
            return;
        const len = Math.sqrt(dx * dx + dy * dy);
        const i = this.player & 0x00ffffff;
        const x = transforms.x[i] ?? 0;
        const y = transforms.y[i] ?? 0;
        transforms.setPosition(this.player, x + (dx / len) * this.speed * dt, y + (dy / len) * this.speed * dt, transforms.z[i] ?? 0);
    }
}
// Reads LastInteractionResource each tick, dispatches NPC dialog.
// (Portal handling intentionally omitted - v1 has only one zone, so
// portals don't exist yet. The kind='portal' code path remains in
// the engine surface for when subsequent phases add more zones.)
class InteractionDispatchSystem {
    name = 'arpg-interaction-dispatch';
    lastSeenFrame = -1;
    update(_world, _dt) {
        const _last = _world.resources.require(RESOURCE_LAST_INTERACTION);
        if (_last.atFrame === this.lastSeenFrame)
            return;
        if (_last.entityIndex < 0) {
            this.lastSeenFrame = _last.atFrame;
            return;
        }
        this.lastSeenFrame = _last.atFrame;
        if (_last.kind === 'npc') {
            const lines = {
                misha_greet: {
                    speaker: 'Misha Dev',
                    line: 'Lastlight holds the seam. The Loom set you down here whichever knot you pulled. Wait. Listen. The next step is named when it is named.',
                },
            };
            const dl = lines[_last.payload];
            if (dl) {
                dialogSpeaker.textContent = dl.speaker;
                dialogLine.textContent = dl.line;
                dialogBox.classList.add('show');
            }
        }
    }
}
// Ticks ZoneStateResource transitions each frame. After fade ends,
// reload tile atlas / palette (handled by ZoneTileRenderSystem
// reading the active zone fresh each tick).
class ZoneTransitionTickSystem {
    name = 'arpg-zone-tick';
    update(world, _dt) {
        const zone = world.resources.require(RESOURCE_ZONE_STATE);
        const now = typeof performance !== 'undefined' ? performance.now() : 0;
        tickTransition(zone, now);
    }
}
// ---------- Engine boot ----------
(async function boot() {
    stats.textContent = 'booting... (load assets)';
    const engine = Engine.create({ canvas });
    // Register only the Plaza atlas - v1 ships a single playable
    // zone. Other zone palettes still live in ZONE_CATALOG for when
    // subsequent phases add their atlases here.
    const tileRender = new ZoneTileRenderSystem(2);
    const plazaAtlas = engine.device.registerAtlas({
        image: makeTileAtlasFor(ZONE_CATALOG.lastlight_plaza),
        frames: [{ x: 0, y: 0, w: ISO_TILE_WIDTH, h: ISO_TILE_HEIGHT }],
        name: 'tile-plaza',
    });
    tileRender.registerAtlas('lastlight_plaza', plazaAtlas);
    const mishaAtlas = engine.device.registerAtlas({
        image: makeMishaSprite(),
        frames: [{ x: 0, y: 0, w: 16, h: 32 }],
        name: 'misha-dev',
    });
    // Knight player (reuses Phase 1 asset).
    let knightSheet;
    try {
        knightSheet = await loadSpriteSheet('../assets/knight/walk.json');
    }
    catch (err) {
        stats.textContent = 'asset load failed:\n' + (err instanceof Error ? err.message : String(err));
        throw err;
    }
    const knightAtlas = engine.device.registerAtlas(knightSheet.atlas);
    const transforms = engine.world.requirePool(POOL_TRANSFORM);
    const sprites = engine.world.requirePool(POOL_SPRITE);
    const animations = engine.world.requirePool(POOL_ANIMATION);
    const interactables = engine.world.requirePool(POOL_INTERACTABLE);
    // Player at world origin.
    const player = engine.world.createEntity();
    transforms.attach(player, 0, 0, 0.2);
    sprites.attach(player, knightAtlas, 0);
    animations.play(player, knightSheet.manifest, 'default');
    // Misha Dev NPC at (1, -1) - the only NPC on the Plaza.
    const misha = engine.world.createEntity();
    transforms.attach(misha, 1, -1, 0);
    sprites.attach(misha, mishaAtlas, 0);
    interactables.attach(misha, {
        kind: 'npc',
        prompt: 'Talk to Misha Dev',
        payload: 'misha_greet',
        radius: 1.5,
    });
    // System order:
    //   PHASE_INPUT     InputSystem (snapshot ready for downstream)
    //   PHASE_LOGIC     WASDMove, InteractionSystem, dispatch, zone tick
    //   PHASE_ANIMATION AnimationSystem (knight walk cycle)
    //   PHASE_RENDER    Tile (zone-aware), Sprite (entities)
    engine.world.addSystem(new InputSystem(), SYSTEM_PHASE_INPUT);
    engine.world.addSystem(new WASDMoveSystem(player, 3.0), SYSTEM_PHASE_LOGIC);
    engine.world.addSystem(new InteractionSystem({ player }), SYSTEM_PHASE_LOGIC);
    engine.world.addSystem(new InteractionDispatchSystem(), SYSTEM_PHASE_LOGIC);
    engine.world.addSystem(new ZoneTransitionTickSystem(), SYSTEM_PHASE_LOGIC);
    engine.world.addSystem(new AnimationSystem(), SYSTEM_PHASE_ANIMATION);
    engine.world.addSystem(tileRender, SYSTEM_PHASE_RENDER);
    engine.world.addSystem(new SpriteRenderSystem(), SYSTEM_PHASE_RENDER);
    function tick(now) {
        engine.tick(now);
        const t = engine.world.resources.require(RESOURCE_TIME);
        const zone = engine.world.resources.require(RESOURCE_ZONE_STATE);
        const last = engine.world.resources.require(RESOURCE_LAST_INTERACTION);
        const px = transforms.x[player & 0x00ffffff] ?? 0;
        const py = transforms.y[player & 0x00ffffff] ?? 0;
        const zoneCat = ZONE_CATALOG[zone.activeZoneId];
        const fading = isTransitioning(zone) ? ' (fading -> ' + (zone.transition?.toZoneId ?? '') + ')' : '';
        stats.textContent =
            'engine     ' + LOOM_ENGINE_VERSION + '\n' +
                'frame      ' + t.frame + '   elapsed ' + t.elapsed.toFixed(1) + 's\n' +
                'zone       ' + zoneCat.name + ' [' + zoneCat.knot + ']' + fading + '   (v1: only zone)\n' +
                'player     pos=(' + px.toFixed(2) + ',' + py.toFixed(2) + ')\n' +
                'last NPC   ' + (last.entityIndex >= 0 ? last.kind + ' / ' + last.payload : '(none)') + '\n' +
                'controls   WASD/arrows = move   click Misha or stand near + E/Enter to talk';
        schedule();
    }
    function schedule() {
        if (document.hidden) {
            setTimeout(() => tick(performance.now()), 16);
        }
        else {
            requestAnimationFrame(tick);
        }
    }
    tick(performance.now());
})().catch((err) => {
    const msg = err instanceof Error ? err.message + '\n' + (err.stack ?? '') : String(err);
    stats.textContent = 'boot failed:\n' + msg;
});
//# sourceMappingURL=arpg.js.map