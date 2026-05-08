// Loom Engine - Survivor-Mini example.
//
// 150-line autobattler. Player at world center; mobs spawn from
// random screen edges and pursue; player auto-fires projectiles at
// the nearest live mob each tick.
//
// Demonstrates:
//   - Engine.create + per-frame tick loop
//   - ECS pools: Transform, Sprite, Health, Pursue, RangedAttack
//   - Auto-targeting via setTarget on the player's RangedAttackPool
//   - spawnMob from MOB_CATALOG (saves the per-archetype boilerplate)
//   - System ordering across PHASE_INPUT / LOGIC / PHYSICS / RENDER
//
// Read top-to-bottom: every block is one engine concept.
import { Engine, POOL_TRANSFORM, POOL_SPRITE, POOL_HEALTH, POOL_PURSUE, POOL_RANGED, InputSystem, PursueSystem, RangedAttackSystem, ProjectileSystem, ProjectileRenderSystem, DamageSystem, AnimationSystem, SpriteRenderSystem, spawnMob, hexToRgba, RESOURCE_DEATH_LOG, RESOURCE_TIME, SYSTEM_PHASE_INPUT, SYSTEM_PHASE_LOGIC, SYSTEM_PHASE_PHYSICS, SYSTEM_PHASE_ANIMATION, SYSTEM_PHASE_RENDER, } from '@sadhaka/loom-engine';
const canvas = document.getElementById('stage');
const stats = document.getElementById('stats');
// Procedural sprites - colored rectangles, no asset files needed.
function paintSprite(w, h, body, eye) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = eye;
    ctx.fillRect(w * 0.25, h * 0.25, 2, 2);
    ctx.fillRect(w * 0.65, h * 0.25, 2, 2);
    return c;
}
// Custom system: each tick, point the player's ranged attack at the
// nearest live enemy. Without this the RangedAttackSystem's stored
// targetIndex would never change once the first target dies.
class AutoTargetSystem {
    player;
    name = 'auto-target';
    constructor(player) {
        this.player = player;
    }
    update(world, _dt) {
        const ranged = world.requirePool(POOL_RANGED);
        const transforms = world.requirePool(POOL_TRANSFORM);
        const pursuit = world.requirePool(POOL_PURSUE);
        const playerIdx = this.player & 0x00ffffff;
        const px = transforms.x[playerIdx] ?? 0;
        const py = transforms.y[playerIdx] ?? 0;
        let bestIdx = -1;
        let bestDist = Infinity;
        const hwm = pursuit.getHighWaterMark();
        // Pursue flag bit 0 = ACTIVE; DamageSystem clears it on death.
        for (let i = 1; i < hwm; i++) {
            if (i === playerIdx)
                continue;
            if (((pursuit.flags[i] ?? 0) & 1) === 0)
                continue;
            const dx = (transforms.x[i] ?? 0) - px;
            const dy = (transforms.y[i] ?? 0) - py;
            const d = dx * dx + dy * dy;
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        ranged.targetIndex[playerIdx] = bestIdx;
    }
}
// Custom system: every cooldown ms, spawn a skeleton at a random edge
// of the visible play area. Uses MOB_CATALOG via spawnMob.
class EdgeSpawnerSystem {
    player;
    atlas;
    cooldownMs;
    radius;
    name = 'edge-spawner';
    nextSpawnAt = 0;
    constructor(player, atlas, cooldownMs, radius) {
        this.player = player;
        this.atlas = atlas;
        this.cooldownMs = cooldownMs;
        this.radius = radius;
    }
    update(_world, _dt) {
        const now = performance.now();
        if (now < this.nextSpawnAt)
            return;
        this.nextSpawnAt = now + this.cooldownMs;
        const angle = Math.random() * Math.PI * 2;
        const x = Math.cos(angle) * this.radius;
        const y = Math.sin(angle) * this.radius;
        spawnMob(_world, 'skel_warrior', x, y, this.player, this.atlas);
    }
}
(async function boot() {
    const engine = Engine.create({ canvas });
    engine.camera.zoom = 3;
    const playerAtlas = engine.device.registerAtlas({
        image: paintSprite(16, 24, '#f8d878', '#000'),
        frames: [{ x: 0, y: 0, w: 16, h: 24 }],
        name: 'player',
    });
    const enemyAtlas = engine.device.registerAtlas({
        image: paintSprite(16, 24, '#a8a0a0', '#400'),
        frames: [{ x: 0, y: 0, w: 16, h: 24 }],
        name: 'enemy',
    });
    const transforms = engine.world.requirePool(POOL_TRANSFORM);
    const sprites = engine.world.requirePool(POOL_SPRITE);
    const health = engine.world.requirePool(POOL_HEALTH);
    const ranged = engine.world.requirePool(POOL_RANGED);
    const player = engine.world.createEntity();
    transforms.attach(player, 0, 0, 0.2);
    sprites.attach(player, playerAtlas, 0);
    health.attach(player, 100);
    ranged.attach(player, {
        target: player,
        range: 6, minRange: 0, cooldownMs: 350,
        damage: 18, projectileSpeed: 8, projectileLife: 1.2,
        projectileSize: 4, projectileColor: hexToRgba(0xfff0a0, 1), homing: false,
    });
    // System order: input first, auto-target before ranged-fire so the
    // target index is fresh, projectile physics, then animation+render.
    engine.world.addSystem(new InputSystem(), SYSTEM_PHASE_INPUT);
    engine.world.addSystem(new AutoTargetSystem(player), SYSTEM_PHASE_LOGIC);
    engine.world.addSystem(new EdgeSpawnerSystem(player, enemyAtlas, 1200, 5.5), SYSTEM_PHASE_LOGIC);
    engine.world.addSystem(new PursueSystem(), SYSTEM_PHASE_LOGIC);
    engine.world.addSystem(new RangedAttackSystem(), SYSTEM_PHASE_LOGIC);
    engine.world.addSystem(new DamageSystem(), SYSTEM_PHASE_LOGIC);
    engine.world.addSystem(new ProjectileSystem(), SYSTEM_PHASE_PHYSICS);
    engine.world.addSystem(new AnimationSystem(), SYSTEM_PHASE_ANIMATION);
    engine.world.addSystem(new SpriteRenderSystem(), SYSTEM_PHASE_RENDER);
    engine.world.addSystem(new ProjectileRenderSystem(), SYSTEM_PHASE_RENDER);
    let frames = 0;
    let lastFpsAt = performance.now();
    let fps = 0;
    function tick(now) {
        engine.tick(now);
        frames++;
        if (now - lastFpsAt >= 500) {
            fps = Math.round(frames * 1000 / (now - lastFpsAt));
            frames = 0;
            lastFpsAt = now;
        }
        const t = engine.world.resources.require(RESOURCE_TIME);
        const log = engine.world.resources.require(RESOURCE_DEATH_LOG);
        stats.textContent =
            'fps   ' + fps + '\n' +
                'time  ' + t.elapsed.toFixed(1) + 's\n' +
                'kills ' + log.totalKills + '\n' +
                'hp    ' + health.getHp(player).toFixed(0) + ' / ' + health.getMaxHp(player).toFixed(0);
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
})().catch((err) => { stats.textContent = 'boot failed: ' + (err instanceof Error ? err.message : String(err)); });
//# sourceMappingURL=main.js.map