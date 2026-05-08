// Loom Engine - Phase 5 demo (audio + input).
//
// Adds to the Phase 4 scene:
//   - InputSystem in PHASE_INPUT promotes DOM events to a frame-
//     coherent InputSnapshot resource each tick
//   - VeilBudgetSystem propagates VeilBudget.audioBudget into the
//     AudioBus and budget.particleBudget into the ParticlePool
//   - Arrow keys / WASD pan the camera
//   - Click anywhere on the canvas: bursts 24 sparkle particles AND
//     plays a violet -> teal chirp through the AudioBus 'sfx' bus
//     (after first user gesture, which also unlocks AudioContext)
//   - Mouse hover reports the iso tile coordinate under the cursor
//   - The knight's continuous sparkle emitter from Phase 4 stays
//     active
import { LOOM_ENGINE_VERSION, Engine, POOL_TRANSFORM, POOL_SPRITE, POOL_ANIMATION, POOL_PARTICLE, POOL_EMITTER, ISO_TILE_WIDTH, ISO_TILE_HEIGHT, AnimationSystem, SpriteRenderSystem, ParticleSimulationSystem, ParticleEmitterSystem, ParticleRenderSystem, InputSystem, VeilBudgetSystem, isoToTile, RESOURCE_DEVICE, RESOURCE_CAMERA, RESOURCE_TIME, RESOURCE_INPUT, SYSTEM_PHASE_INPUT, SYSTEM_PHASE_LOGIC, SYSTEM_PHASE_PHYSICS, SYSTEM_PHASE_ANIMATION, SYSTEM_PHASE_RENDER, loadSpriteSheet, hexToRgba, vec2, 
// Phase 6: Director-bridge
MockDirectorBridge, DirectorSystem, RESOURCE_DIRECTOR_BRIDGE, RESOURCE_DIRECTOR_LOG, RESOURCE_KNOT_CONTEXT, } from '../dist/index.js';
const canvas = document.getElementById('stage');
const stats = document.getElementById('stats');
// ---------- Procedural tile atlas ----------
function makeTileAtlas() {
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
    ctx.strokeStyle = '#5a4e38';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ISO_TILE_WIDTH / 2, 1);
    ctx.lineTo(ISO_TILE_WIDTH - 1, ISO_TILE_HEIGHT / 2);
    ctx.lineTo(ISO_TILE_WIDTH / 2, ISO_TILE_HEIGHT - 1);
    ctx.strokeStyle = '#7a6a48';
    ctx.stroke();
    return c;
}
// ---------- Demo systems ----------
class HoverSystem {
    entity;
    amplitude;
    freq;
    base;
    name = 'demo-hover';
    constructor(entity, amplitude, freq, base) {
        this.entity = entity;
        this.amplitude = amplitude;
        this.freq = freq;
        this.base = base;
    }
    update(world, _dt) {
        const t = world.resources.require(RESOURCE_TIME);
        const transforms = world.requirePool(POOL_TRANSFORM);
        const z = this.base + Math.sin(t.elapsed * this.freq) * this.amplitude;
        transforms.setPosition(this.entity, 0, 0, z);
    }
}
class TileRenderSystem {
    atlas;
    radius;
    name = 'demo-tile-render';
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
// Reads the InputSnapshot each tick, pans the camera with arrow keys
// or WASD, and updates a shared "last hover tile" for the stats panel.
class CameraInputSystem {
    speed;
    name = 'demo-camera-input';
    hoverTileX = 0;
    hoverTileY = 0;
    hoverInside = false;
    constructor(speed) {
        this.speed = speed;
    }
    update(world, dt) {
        const input = world.resources.get(RESOURCE_INPUT);
        const camera = world.resources.get(RESOURCE_CAMERA);
        if (!input || !camera)
            return;
        let dx = 0;
        let dy = 0;
        if (input.keysHeld.has('ArrowLeft') || input.keysHeld.has('KeyA'))
            dx -= 1;
        if (input.keysHeld.has('ArrowRight') || input.keysHeld.has('KeyD'))
            dx += 1;
        if (input.keysHeld.has('ArrowUp') || input.keysHeld.has('KeyW'))
            dy -= 1;
        if (input.keysHeld.has('ArrowDown') || input.keysHeld.has('KeyS'))
            dy += 1;
        if (dx !== 0 || dy !== 0) {
            const len = Math.sqrt(dx * dx + dy * dy);
            camera.centerX += (dx / len) * this.speed * dt;
            camera.centerY += (dy / len) * this.speed * dt;
        }
        // Mouse-to-tile picking: take pointer canvas coords, undo camera
        // transform to get iso world coords, then iso -> tile.
        this.hoverInside = input.pointer.inside;
        if (input.pointer.inside) {
            const worldIsoX = (input.pointer.x - camera.viewportWidth / 2) / camera.zoom + camera.centerX;
            const worldIsoY = (input.pointer.y - camera.viewportHeight / 2) / camera.zoom + camera.centerY;
            const out = vec2(0, 0);
            isoToTile(worldIsoX, worldIsoY, out);
            this.hoverTileX = Math.round(out.x);
            this.hoverTileY = Math.round(out.y);
        }
    }
}
// Listens for left-click. On click: burst 24 particles from the knight
// AND play a violet -> teal chirp on the SFX bus. Also unlocks audio.
class ClickInputSystem {
    knight;
    name = 'demo-click-input';
    burstCount = 0;
    constructor(knight) {
        this.knight = knight;
    }
    update(world, _dt) {
        const input = world.resources.get(RESOURCE_INPUT);
        if (!input)
            return;
        const leftClicked = (input.pointerPressedThisFrame & 1) !== 0;
        if (!leftClicked)
            return;
        // Burst particles via the existing emitter.
        const emitters = world.requirePool(POOL_EMITTER);
        emitters.burst(this.knight, 24);
        // Play a SFX chirp. Engine.audio is exposed via a helper attach
        // below; we read it from the world resource registry here for
        // proper indirection.
        const audioAny = world.__audio;
        if (audioAny) {
            // Browsers require unlock inside the user gesture - the click
            // we just observed IS the user gesture for THIS frame, so it's
            // OK to call here despite being a system (the system runs
            // synchronously inside a click handler-driven tick path).
            void audioAny.unlock();
            // 880 Hz fade to 440 Hz isn't easy with a single tone, so do
            // two quick chirps that suggest a violet -> teal arc.
            audioAny.playTone('sfx', 880, 80, { gain: 0.18, type: 'triangle' });
            setTimeout(() => audioAny.playTone('sfx', 440, 100, { gain: 0.14, type: 'sine' }), 60);
        }
        this.burstCount++;
    }
}
// ---------- Engine boot ----------
(async function boot() {
    stats.textContent = 'booting... (load assets)';
    const engine = Engine.create({ canvas });
    const tileAtlas = engine.device.registerAtlas({
        image: makeTileAtlas(),
        frames: [{ x: 0, y: 0, w: ISO_TILE_WIDTH, h: ISO_TILE_HEIGHT }],
        name: 'demo-tile',
    });
    let knightSheet;
    try {
        knightSheet = await loadSpriteSheet('../assets/knight/walk.json');
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stats.textContent = 'asset load failed:\n' + msg;
        throw err;
    }
    const knightAtlas = engine.device.registerAtlas(knightSheet.atlas);
    const transforms = engine.world.requirePool(POOL_TRANSFORM);
    const sprites = engine.world.requirePool(POOL_SPRITE);
    const animations = engine.world.requirePool(POOL_ANIMATION);
    const knight = engine.world.createEntity();
    transforms.attach(knight, 0, 0, 0.2);
    sprites.attach(knight, knightAtlas, 0);
    animations.play(knight, knightSheet.manifest, 'default');
    const emitters = engine.world.requirePool(POOL_EMITTER);
    emitters.attach(knight, {
        rate: 30,
        particleLife: 1.2,
        speedMin: 0.6,
        speedMax: 1.4,
        dirX: 0, dirY: 0, dirZ: 1,
        coneRadians: Math.PI / 4,
        ax: 0, ay: 0, az: -0.8,
        startSize: 6,
        endSize: 1,
        startColor: hexToRgba(0xc88cff, 1.0),
        endColor: hexToRgba(0x6effff, 0),
        additive: true,
    });
    // Stash audio bus as an opaque ref so the click system can find it.
    // (Demo-only shortcut; production code would inject via constructor.)
    if (engine.audio) {
        engine.world.__audio = engine.audio;
    }
    // Phase 6: subscribe to a MockDirectorBridge. Production replaces
    // this with new SSEDirectorBridge({baseUrl, characterId}). Mock keeps
    // the demo backend-independent.
    const bridge = new MockDirectorBridge();
    bridge.start();
    engine.world.resources.set(RESOURCE_DIRECTOR_BRIDGE, bridge);
    // Demo systems registered explicitly.
    // Phase 6 ordering: Director first to mutate VeilBudgetResource,
    // then VeilBudgetSystem same tick to propagate the new values into
    // ParticlePool + AudioBus. Reverse order would lag by 1 frame.
    const cameraInput = new CameraInputSystem(2.5); // 2.5 world-units/sec pan speed
    engine.world.addSystem(new InputSystem(), SYSTEM_PHASE_INPUT);
    engine.world.addSystem(new DirectorSystem(), SYSTEM_PHASE_INPUT);
    engine.world.addSystem(new VeilBudgetSystem(), SYSTEM_PHASE_INPUT);
    engine.world.addSystem(cameraInput, SYSTEM_PHASE_LOGIC);
    engine.world.addSystem(new ClickInputSystem(knight), SYSTEM_PHASE_LOGIC);
    engine.world.addSystem(new HoverSystem(knight, 0.1, 1.5, 0.2), SYSTEM_PHASE_LOGIC);
    engine.world.addSystem(new ParticleEmitterSystem(), SYSTEM_PHASE_LOGIC);
    engine.world.addSystem(new ParticleSimulationSystem(), SYSTEM_PHASE_PHYSICS);
    engine.world.addSystem(new AnimationSystem(), SYSTEM_PHASE_ANIMATION);
    engine.world.addSystem(new TileRenderSystem(tileAtlas, 2), SYSTEM_PHASE_RENDER);
    engine.world.addSystem(new SpriteRenderSystem(), SYSTEM_PHASE_RENDER);
    engine.world.addSystem(new ParticleRenderSystem(), SYSTEM_PHASE_RENDER);
    const particles = engine.world.requirePool(POOL_PARTICLE);
    const knotCtx = engine.world.resources.require(RESOURCE_KNOT_CONTEXT);
    const directorLog = engine.world.resources.require(RESOURCE_DIRECTOR_LOG);
    // Synthetic event timeline: cycle through Strknot -> Dexknot ->
    // Intknot -> Centerknot palettes every 6 seconds with a 600ms
    // crossfade. Also fire ve.budget.update tier shifts every 12s
    // (green -> amber -> red -> green) to demonstrate the audio +
    // particle gating loop. This is what a real Director would push
    // over SSE.
    const mockBridge = bridge;
    let nextEventId = 1;
    function pushEvent(ev) {
        mockBridge.enqueue(ev);
    }
    const KNOT_CYCLE = [
        { knot: 'str', primary: '#b04a24', secondary: '#7a3416', accent: '#ffd86a' },
        { knot: 'dex', primary: '#5ac9d6', secondary: '#2a8c95', accent: '#ffd86a' },
        { knot: 'int', primary: '#9b5de5', secondary: '#603b91', accent: '#ffd86a' },
        { knot: 'center', primary: '#ffd86a', secondary: '#ffffff', accent: '#ffffff' },
    ];
    let knotIdx = 0;
    setInterval(() => {
        const k = KNOT_CYCLE[knotIdx % KNOT_CYCLE.length];
        if (k) {
            pushEvent({
                id: nextEventId++,
                ts: Date.now() / 1000,
                type: 'knot.context',
                character_id: 'demo',
                encounter_id: null,
                data: {
                    knot: k.knot,
                    palette: { primary: k.primary, secondary: k.secondary, accent: k.accent },
                    mood: 'tense',
                    fade_ms: 600,
                },
            });
        }
        knotIdx++;
    }, 6000);
    const TIER_CYCLE = [
        { tier: 'green', ve: 8000, ceil: 10000 },
        { tier: 'amber', ve: 3000, ceil: 10000 },
        { tier: 'red', ve: 500, ceil: 10000 },
    ];
    let tierIdx = 0;
    let lastTier = 'green';
    setInterval(() => {
        const t = TIER_CYCLE[tierIdx % TIER_CYCLE.length];
        if (t) {
            pushEvent({
                id: nextEventId++,
                ts: Date.now() / 1000,
                type: 've.budget.update',
                character_id: 'demo',
                encounter_id: null,
                data: {
                    ve_remaining_month: t.ve,
                    ve_ceiling_month: t.ceil,
                    tier: t.tier,
                    tier_prev: lastTier,
                    encounter_budget_ve: t.tier === 'red' ? 20 : t.tier === 'amber' ? 60 : 120,
                    encounter_budget_usd: t.tier === 'red' ? 0.20 : t.tier === 'amber' ? 0.60 : 1.20,
                },
            });
            lastTier = t.tier;
        }
        tierIdx++;
    }, 12000);
    let frameCount = 0;
    let lastFpsAt = performance.now();
    let lastFps = 0;
    function tick(now) {
        engine.tick(now);
        frameCount++;
        if (now - lastFpsAt >= 500) {
            lastFps = Math.round((frameCount * 1000) / (now - lastFpsAt));
            frameCount = 0;
            lastFpsAt = now;
        }
        const t = engine.world.resources.require(RESOURCE_TIME);
        const activeClip = animations.getClipName(knight);
        const audioState = engine.audio
            ? (engine.audio.isUnlocked() ? 'unlocked' : 'locked (click to unlock)')
            : 'unavailable';
        const hover = cameraInput.hoverInside
            ? '(' + cameraInput.hoverTileX + ',' + cameraInput.hoverTileY + ')'
            : '(off)';
        const palette = knotCtx.hexSnapshot();
        const fadeStatus = knotCtx.isFading() ? ' (fading)' : '';
        stats.textContent =
            'engine     ' + LOOM_ENGINE_VERSION + '\n' +
                'fps        ' + lastFps + '\n' +
                'draw calls ' + engine.device.getDrawCallCount() + ' (per frame)\n' +
                'frame      ' + t.frame + '   elapsed ' + t.elapsed.toFixed(2) + 's\n' +
                'entities   ' + engine.world.countEntities() + '   systems ' + engine.world.countSystems() + '\n' +
                'audio      ' + audioState + '\n' +
                'sheet      ' + knightSheet.manifest.name + '   playing ' + (activeClip || '(none)') + '   frame ' + sprites.frame[0 + (knight & 0x00ffffff)] + '\n' +
                'particles  ' + particles.getLiveCount() + ' live  cap ' + particles.getMaxParticles() + '\n' +
                'director   knot=' + knotCtx.knot + '  mood=' + knotCtx.mood + '  tier=' + directorLog.lastTier + '  events=' + directorLog.eventsApplied + fadeStatus + '\n' +
                'palette    ' + palette.primary + ' / ' + palette.secondary + ' / ' + palette.accent + '\n' +
                'camera     center=(' + engine.camera.centerX.toFixed(2) + ',' + engine.camera.centerY.toFixed(2) + ')   hover tile ' + hover + '\n' +
                'controls   click = burst+chirp   arrows/WASD = pan camera';
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
//# sourceMappingURL=demo.js.map