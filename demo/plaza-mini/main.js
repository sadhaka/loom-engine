// Loom Engine - Plaza-Mini example.
//
// Walkable iso plaza with one NPC and a Director-driven narrator
// overlay. The mock bridge enqueues a synthetic narrator.line every
// few seconds; DirectorSystem writes it to DirectorEventLog; a tiny
// custom system mirrors the latest line into a DOM overlay that fades
// after its TTL. Showcases iso projection, WASD movement, and the
// (Mock|SSE)DirectorBridge -> DirectorSystem -> DOM-overlay pipeline.
import { Engine, POOL_TRANSFORM, POOL_SPRITE, ISO_TILE_WIDTH, ISO_TILE_HEIGHT, InputSystem, SpriteRenderSystem, MockDirectorBridge, DirectorSystem, RESOURCE_DEVICE, RESOURCE_CAMERA, RESOURCE_DIRECTOR_BRIDGE, RESOURCE_DIRECTOR_LOG, RESOURCE_INPUT, SYSTEM_PHASE_INPUT, SYSTEM_PHASE_LOGIC, SYSTEM_PHASE_RENDER, } from '@sadhaka/loom-engine';
const canvas = document.getElementById('stage');
const narratorEl = document.getElementById('narrator');
function makeTile() {
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
    ctx.fillStyle = '#3a322a';
    ctx.fill();
    ctx.strokeStyle = '#7a6a48';
    ctx.stroke();
    return c;
}
function makeSprite(body, hat) {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 24;
    const ctx = c.getContext('2d');
    ctx.fillStyle = body;
    ctx.fillRect(4, 8, 8, 14);
    ctx.fillStyle = '#d8b878';
    ctx.fillRect(5, 2, 6, 6);
    ctx.fillStyle = hat;
    ctx.fillRect(4, 1, 8, 3);
    ctx.fillStyle = '#000';
    ctx.fillRect(6, 4, 1, 1);
    ctx.fillRect(9, 4, 1, 1);
    return c;
}
// Fill a 5x5 floor with the registered tile atlas each frame.
class TileFloorSystem {
    atlas;
    radius;
    name = 'tile-floor';
    constructor(atlas, radius) {
        this.atlas = atlas;
        this.radius = radius;
    }
    update(world, _dt) {
        const device = world.resources.require(RESOURCE_DEVICE);
        const camera = world.resources.require(RESOURCE_CAMERA);
        device.setCamera(camera);
        for (let ty = -this.radius; ty <= this.radius; ty++) {
            for (let tx = -this.radius; tx <= this.radius; tx++) {
                device.drawTile(tx, ty, this.atlas, 0);
            }
        }
    }
}
// WASD + arrow keys translate the player Transform.
class WalkSystem {
    player;
    speed;
    name = 'walk';
    constructor(player, speed) {
        this.player = player;
        this.speed = speed;
    }
    update(world, dt) {
        const input = world.resources.get(RESOURCE_INPUT);
        if (!input)
            return;
        const transforms = world.requirePool(POOL_TRANSFORM);
        const i = this.player & 0x00ffffff;
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
        transforms.setPosition(this.player, (transforms.x[i] ?? 0) + dx / len * this.speed * dt, (transforms.y[i] ?? 0) + dy / len * this.speed * dt, transforms.z[i] ?? 0);
    }
}
// Mirror DirectorEventLog.lastNarratorLine into a DOM overlay. When
// the line changes, set the text and trigger a fade after its TTL.
class NarratorOverlaySystem {
    name = 'narrator-overlay';
    lastSeen = null;
    hideAt = 0;
    update(world, _dt) {
        const log = world.resources.require(RESOURCE_DIRECTOR_LOG);
        if (log.lastNarratorLine !== this.lastSeen) {
            this.lastSeen = log.lastNarratorLine;
            if (log.lastNarratorLine) {
                narratorEl.textContent = log.lastNarratorLine;
                narratorEl.classList.add('show');
                this.hideAt = performance.now() + log.lastNarratorTtlMs;
            }
        }
        if (this.hideAt && performance.now() > this.hideAt) {
            narratorEl.classList.remove('show');
            this.hideAt = 0;
        }
    }
}
(async function boot() {
    const engine = Engine.create({ canvas });
    const tileAtlas = engine.device.registerAtlas({
        image: makeTile(),
        frames: [{ x: 0, y: 0, w: ISO_TILE_WIDTH, h: ISO_TILE_HEIGHT }],
        name: 'tile',
    });
    const playerAtlas = engine.device.registerAtlas({
        image: makeSprite('#3a4a8a', '#1a2a5a'),
        frames: [{ x: 0, y: 0, w: 16, h: 24 }],
        name: 'player',
    });
    const npcAtlas = engine.device.registerAtlas({
        image: makeSprite('#7a3a1c', '#3a2616'),
        frames: [{ x: 0, y: 0, w: 16, h: 24 }],
        name: 'npc',
    });
    const transforms = engine.world.requirePool(POOL_TRANSFORM);
    const sprites = engine.world.requirePool(POOL_SPRITE);
    const player = engine.world.createEntity();
    transforms.attach(player, 0, 0, 0.2);
    sprites.attach(player, playerAtlas, 0);
    const npc = engine.world.createEntity();
    transforms.attach(npc, 1.5, -1, 0.2);
    sprites.attach(npc, npcAtlas, 0);
    // MockDirectorBridge stands in for an SSE backend. Real production
    // code swaps this for `new SSEDirectorBridge({ baseUrl, characterId })`.
    const bridge = new MockDirectorBridge();
    bridge.start();
    engine.world.resources.set(RESOURCE_DIRECTOR_BRIDGE, bridge);
    const lines = [
        'The Loom shifts. Footsteps echo before they fall.',
        'Lastlight holds. A name is named when it is named.',
        'A shadow leans against the seam. Listen.',
    ];
    let nextEventId = 1;
    let lineIdx = 0;
    setInterval(() => {
        bridge.enqueue({
            id: nextEventId++,
            ts: Date.now() / 1000,
            type: 'narrator.line',
            character_id: 'demo',
            encounter_id: null,
            data: { line: lines[lineIdx % lines.length] ?? '', voice: 'whisper', ttl_ms: 4000 },
        });
        lineIdx++;
    }, 5000);
    engine.world.addSystem(new InputSystem(), SYSTEM_PHASE_INPUT);
    engine.world.addSystem(new DirectorSystem(), SYSTEM_PHASE_INPUT);
    engine.world.addSystem(new WalkSystem(player, 3.0), SYSTEM_PHASE_LOGIC);
    engine.world.addSystem(new NarratorOverlaySystem(), SYSTEM_PHASE_LOGIC);
    engine.world.addSystem(new TileFloorSystem(tileAtlas, 2), SYSTEM_PHASE_RENDER);
    engine.world.addSystem(new SpriteRenderSystem(), SYSTEM_PHASE_RENDER);
    function tick(now) {
        engine.tick(now);
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
})().catch((err) => { narratorEl.textContent = 'boot failed: ' + (err instanceof Error ? err.message : String(err)); narratorEl.classList.add('show'); });
//# sourceMappingURL=main.js.map