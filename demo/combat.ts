// Loom Engine - Phase 7 combat slice demo.
//
// Validates the Phase 7 combat primitives end-to-end:
//   - 1 player entity (Transform + Sprite + Animation + Health)
//   - 3 enemy entities (Transform + Sprite + Health + Pursue)
//   - PursueSystem walks enemies toward player; contacts deal 5 dmg
//     per second
//   - AttackSystem applies 25 dmg to nearest enemy on click
//   - DamageSystem cleans up dead enemies
//   - When all enemies die, wave respawns
//
// Reuses the existing Phase 6 demo's procedural tile + knight asset
// loading. Adds enemy sprite (red square) painted procedurally.

import {
  LOOM_ENGINE_VERSION,
  Engine,
  POOL_TRANSFORM,
  POOL_SPRITE,
  POOL_ANIMATION,
  POOL_HEALTH,
  POOL_PURSUE,
  POOL_PROJECTILE,
  POOL_RANGED,
  ISO_TILE_WIDTH,
  ISO_TILE_HEIGHT,
  TransformPool,
  SpritePool,
  HealthPool,
  PursuePool,
  ProjectilePool,
  ProjectileSystem,
  ProjectileRenderSystem,
  RangedAttackSystem,
  spawnMob,
  type MobArchetype,
  AnimationStatePool,
  AnimationSystem,
  SpriteRenderSystem,
  ParticleEmitterPool,
  ParticleSimulationSystem,
  ParticleEmitterSystem,
  ParticleRenderSystem,
  InputSystem,
  PursueSystem,
  AttackSystem,
  DamageSystem,
  DeathLog,
  RESOURCE_DEVICE,
  RESOURCE_CAMERA,
  RESOURCE_TIME,
  RESOURCE_DEATH_LOG,
  POOL_EMITTER,
  SYSTEM_PHASE_INPUT,
  SYSTEM_PHASE_LOGIC,
  SYSTEM_PHASE_PHYSICS,
  SYSTEM_PHASE_ANIMATION,
  SYSTEM_PHASE_RENDER,
  loadSpriteSheet,
  hexToRgba,
  type LoadedSpriteSheet,
  type System,
  type World,
  type IGraphicsDevice,
  type CameraView,
  type TimeResource,
  type AtlasHandle,
  type EntityId,
} from '../dist/index.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const stats = document.getElementById('stats') as HTMLDivElement;

// ---------- Procedural atlases ----------

function makeTileAtlas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = ISO_TILE_WIDTH;
  c.height = ISO_TILE_HEIGHT;
  const ctx = c.getContext('2d')!;
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
  return c;
}

// Enemy sprite: a small dark-red mob with a white skull mark.
function makeEnemyAtlas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 24;
  const ctx = c.getContext('2d')!;
  // Body
  ctx.fillStyle = '#8a2820';
  ctx.fillRect(4, 8, 8, 14);
  // Head
  ctx.fillStyle = '#d8b878';
  ctx.fillRect(5, 2, 6, 6);
  // Eye dots
  ctx.fillStyle = '#000';
  ctx.fillRect(6, 4, 1, 1);
  ctx.fillRect(9, 4, 1, 1);
  // Legs
  ctx.fillStyle = '#3a1a14';
  ctx.fillRect(4, 22, 2, 2);
  ctx.fillRect(10, 22, 2, 2);
  // Skull mark on chest
  ctx.fillStyle = '#e8d8b6';
  ctx.fillRect(7, 12, 2, 2);
  return c;
}

// ---------- Demo systems ----------

class TileRenderSystem implements System {
  readonly name: string = 'demo-tile-render';
  constructor(private atlas: AtlasHandle, private radius: number) {}
  update(world: World, _dt: number): void {
    const device = world.resources.require<IGraphicsDevice>(RESOURCE_DEVICE);
    const camera = world.resources.require<CameraView>(RESOURCE_CAMERA);
    device.setCamera(camera);
    for (let ty = -this.radius; ty <= this.radius; ty++) {
      for (let tx = -this.radius; tx <= this.radius; tx++) {
        device.drawTile(tx, ty, this.atlas, 0);
      }
    }
  }
}

// Spawns a wave of mixed mob archetypes. Uses MobCatalog + spawnMob
// so the demo exercises all 3 mob types: warrior (melee), archer
// (ranged + arrows), caster (ranged homing bolts).
class WaveSpawnerSystem implements System {
  readonly name: string = 'wave-spawner';
  private waveCount: number = 0;
  constructor(
    private player: EntityId,
    private enemyAtlas: AtlasHandle,
    private targetEnemyCount: number,
    private radius: number,
  ) {}
  getWaveCount(): number {
    return this.waveCount;
  }
  update(world: World, _dt: number): void {
    const pursuit = world.requirePool<PursuePool>(POOL_PURSUE);

    const playerIdx = (this.player as number) & 0x00ffffff;
    const hwm = pursuit.getHighWaterMark();
    let live = 0;
    for (let i = 1; i < hwm; i++) {
      if (i === playerIdx) continue;
      if ((pursuit.flags[i] ?? 0) & 1) live++;
    }
    if (live >= this.targetEnemyCount) return;

    // Wave composition: 2 warriors + 1 archer + 1 caster cycling.
    // Position around the player at edge-of-floor.
    const types: MobArchetype[] = ['skel_warrior', 'skel_archer', 'skel_warrior', 'skel_caster'];
    const need = this.targetEnemyCount - live;
    for (let k = 0; k < need; k++) {
      const t = types[(this.waveCount * this.targetEnemyCount + k + live) % types.length];
      const angle = Math.random() * Math.PI * 2;
      const r = this.radius - 0.3;
      const ex = Math.cos(angle) * r;
      const ey = Math.sin(angle) * r;
      spawnMob(world, t ?? 'skel_warrior', ex, ey, this.player, this.enemyAtlas);
    }
    this.waveCount++;
  }
}

// Spawns a small VFX burst on each death this tick by reading the
// DeathLog. Hooks into the existing ParticleEmitter pool by spawning
// an ephemeral emitter entity with a one-shot burst, then removing
// the emitter component (the entity itself stays for one frame then
// gets cleaned by DamageSystem next tick if HP=0; we skip the entity
// path here and just push particles directly via emitterPool.burst
// on a transient entity).
class DeathFxSystem implements System {
  readonly name: string = 'death-fx';
  private lastSeenKills: number = 0;
  update(world: World, _dt: number): void {
    const log = world.resources.get<DeathLog>(RESOURCE_DEATH_LOG);
    if (!log) return;
    const kills = log.totalKills;
    if (kills === this.lastSeenKills) return;

    const transforms = world.requirePool<TransformPool>(POOL_TRANSFORM);
    const emitters = world.requirePool<ParticleEmitterPool>(POOL_EMITTER);
    // For each new kill, spawn an emitter entity at the dead entity's
    // last known position and burst 16 particles.
    const newKills = kills - this.lastSeenKills;
    for (let k = 0; k < newKills && k < log.recent.length; k++) {
      const ev = log.recent[k];
      if (!ev) continue;
      // Read the dead entity's last position from the transform pool
      // (it's still there until DamageSystem detaches next frame; we
      // run AFTER DamageSystem in PHASE_LOGIC ordering... actually
      // before. The transforms.x at the dead entity's index is what
      // it was before the kill; if DamageSystem ran first, it's been
      // detached and reads return defaults. Capture as best effort.)
      const idx = ev.entityIndex;
      const px = transforms.x[idx] ?? 0;
      const py = transforms.y[idx] ?? 0;
      // Spawn a transient burst emitter on a fresh entity. The emitter
      // fires once + then sits idle. For a real game we'd recycle a
      // pool of fx emitters; demo keeps it simple.
      const fx = world.createEntity();
      transforms.attach(fx, px, py, 0.1);
      emitters.attach(fx, {
        rate: 0,
        particleLife: 0.7,
        speedMin: 1.5, speedMax: 3.0,
        dirX: 0, dirY: 0, dirZ: 1,
        coneRadians: Math.PI,
        ax: 0, ay: 0, az: -3.0,
        startSize: 5,
        endSize: 1,
        startColor: hexToRgba(0xff8080, 1.0),
        endColor: hexToRgba(0x800000, 0),
        additive: true,
      });
      emitters.burst(fx, 16);
    }
    this.lastSeenKills = kills;
  }
}

// ---------- Engine boot ----------

(async function boot(): Promise<void> {
  stats.textContent = 'booting... (load assets)';

  const engine = Engine.create({ canvas });

  const tileAtlas = engine.device.registerAtlas({
    image: makeTileAtlas(),
    frames: [{ x: 0, y: 0, w: ISO_TILE_WIDTH, h: ISO_TILE_HEIGHT }],
    name: 'demo-tile',
  });

  const enemyAtlas = engine.device.registerAtlas({
    image: makeEnemyAtlas(),
    frames: [{ x: 0, y: 0, w: 16, h: 24 }],
    name: 'demo-enemy',
  });

  let knightSheet: LoadedSpriteSheet;
  try {
    knightSheet = await loadSpriteSheet('../assets/knight/walk.json');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.textContent = 'asset load failed:\n' + msg;
    throw err;
  }
  const knightAtlas = engine.device.registerAtlas(knightSheet.atlas);

  const transforms = engine.world.requirePool<TransformPool>(POOL_TRANSFORM);
  const sprites = engine.world.requirePool<SpritePool>(POOL_SPRITE);
  const animations = engine.world.requirePool<AnimationStatePool>(POOL_ANIMATION);
  const health = engine.world.requirePool<HealthPool>(POOL_HEALTH);

  // Player knight at world origin, with 200 HP.
  const knight = engine.world.createEntity();
  transforms.attach(knight, 0, 0, 0.2);
  sprites.attach(knight, knightAtlas, 0);
  animations.play(knight, knightSheet.manifest, 'default');
  health.attach(knight, 200);

  // Phase order: input first, then attack (PHASE_LOGIC), pursuers
  // (PHASE_LOGIC), wave spawner (PHASE_LOGIC), then physics for
  // particle simulation, then animation, then render.
  const attack = new AttackSystem({ damage: 25, range: 1.5, player: knight });
  const waveSpawner = new WaveSpawnerSystem(knight, enemyAtlas, 3, 2);

  engine.world.addSystem(new InputSystem(), SYSTEM_PHASE_INPUT);
  engine.world.addSystem(attack, SYSTEM_PHASE_LOGIC);
  engine.world.addSystem(new PursueSystem(), SYSTEM_PHASE_LOGIC);
  engine.world.addSystem(new RangedAttackSystem(), SYSTEM_PHASE_LOGIC);
  engine.world.addSystem(waveSpawner, SYSTEM_PHASE_LOGIC);
  engine.world.addSystem(new DeathFxSystem(), SYSTEM_PHASE_LOGIC);
  engine.world.addSystem(new DamageSystem(), SYSTEM_PHASE_LOGIC);
  engine.world.addSystem(new ParticleEmitterSystem(), SYSTEM_PHASE_LOGIC);
  engine.world.addSystem(new ProjectileSystem(), SYSTEM_PHASE_PHYSICS);
  engine.world.addSystem(new ParticleSimulationSystem(), SYSTEM_PHASE_PHYSICS);
  engine.world.addSystem(new AnimationSystem(), SYSTEM_PHASE_ANIMATION);
  engine.world.addSystem(new TileRenderSystem(tileAtlas, 2), SYSTEM_PHASE_RENDER);
  engine.world.addSystem(new SpriteRenderSystem(), SYSTEM_PHASE_RENDER);
  engine.world.addSystem(new ParticleRenderSystem(), SYSTEM_PHASE_RENDER);
  engine.world.addSystem(new ProjectileRenderSystem(), SYSTEM_PHASE_RENDER);

  let frameCount = 0;
  let lastFpsAt = performance.now();
  let lastFps = 0;

  function tick(now: number): void {
    engine.tick(now);

    frameCount++;
    if (now - lastFpsAt >= 500) {
      lastFps = Math.round((frameCount * 1000) / (now - lastFpsAt));
      frameCount = 0;
      lastFpsAt = now;
    }

    const t = engine.world.resources.require<TimeResource>(RESOURCE_TIME);
    const deathLog = engine.world.resources.require<DeathLog>(RESOURCE_DEATH_LOG);
    const playerHp = health.getHp(knight);
    const playerMax = health.getMaxHp(knight);
    const lastHit = attack.lastTargetIndex >= 0 ? ' hit=' + attack.lastTargetIndex + ' (-' + attack.lastDamageApplied + ')' : '';

    // Count alive enemies.
    const pursuit = engine.world.requirePool<PursuePool>(POOL_PURSUE);
    const playerIdx = (knight as number) & 0x00ffffff;
    let alive = 0;
    const hwm = pursuit.getHighWaterMark();
    for (let i = 1; i < hwm; i++) {
      if (i === playerIdx) continue;
      if ((pursuit.flags[i] ?? 0) & 1) alive++;
    }

    const projectiles = engine.world.requirePool<ProjectilePool>(POOL_PROJECTILE);
    const liveProjectiles = projectiles.getLiveCount();
    stats.textContent =
      'engine     ' + LOOM_ENGINE_VERSION + '\n' +
      'fps        ' + lastFps + '\n' +
      'frame      ' + t.frame + '   elapsed ' + t.elapsed.toFixed(1) + 's\n' +
      'player     hp=' + playerHp.toFixed(0) + '/' + playerMax.toFixed(0) + (health.isAlive(knight) ? ' alive' : ' DEAD') + '\n' +
      'enemies    ' + alive + ' alive   wave=' + waveSpawner.getWaveCount() + '   kills=' + deathLog.totalKills + '\n' +
      'projectiles ' + liveProjectiles + ' in flight\n' +
      'attack     range=1.5 dmg=25' + lastHit + '\n' +
      'mix        warrior (melee) + archer (arrows) + caster (homing bolt)\n' +
      'controls   click on/near enemy to attack';

    schedule();
  }

  function schedule(): void {
    if (document.hidden) {
      setTimeout(() => tick(performance.now()), 16);
    } else {
      requestAnimationFrame(tick);
    }
  }

  tick(performance.now());
})().catch((err) => {
  const msg = err instanceof Error ? err.message + '\n' + (err.stack ?? '') : String(err);
  stats.textContent = 'boot failed:\n' + msg;
});
