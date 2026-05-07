// Loom Engine - Phase 3 demo (animation-system driven).
//
// Same scene as Phase 2 (knight + 5x5 iso tile diamond), but the
// walk cycle is now driven by the formal AnimationSystem. The
// demo's old WalkCycleSystem is gone; the demo just calls
// AnimationStatePool.play(knight, manifest, 'default') once on boot
// and the engine handles frame stepping in PHASE_ANIMATION.
//
// The knight asset's manifest has no clips[] field, so the loader
// synthesizes a 'default' clip covering all 4 frames, looping. A
// real game ships manifests with named clips (idle / walk / attack).
// The 'default' synthesis is just backward-compat with Phase 2
// manifests.

import {
  LOOM_ENGINE_VERSION,
  Engine,
  POOL_TRANSFORM,
  POOL_SPRITE,
  POOL_ANIMATION,
  POOL_PARTICLE,
  POOL_EMITTER,
  ISO_TILE_WIDTH,
  ISO_TILE_HEIGHT,
  TransformPool,
  SpritePool,
  AnimationStatePool,
  AnimationSystem,
  SpriteRenderSystem,
  ParticlePool,
  ParticleEmitterPool,
  ParticleSimulationSystem,
  ParticleEmitterSystem,
  ParticleRenderSystem,
  RESOURCE_DEVICE,
  RESOURCE_CAMERA,
  RESOURCE_TIME,
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

// ---------- Procedural tile atlas (terrain stays code-only) ----------

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
  ctx.beginPath();
  ctx.moveTo(ISO_TILE_WIDTH / 2, 1);
  ctx.lineTo(ISO_TILE_WIDTH - 1, ISO_TILE_HEIGHT / 2);
  ctx.lineTo(ISO_TILE_WIDTH / 2, ISO_TILE_HEIGHT - 1);
  ctx.strokeStyle = '#7a6a48';
  ctx.stroke();
  return c;
}

// ---------- Custom systems for the demo ----------

class HoverSystem implements System {
  readonly name: string = 'demo-hover';
  constructor(private entity: EntityId, private amplitude: number, private freq: number, private base: number) {}
  update(world: World, _dt: number): void {
    const t = world.resources.require<TimeResource>(RESOURCE_TIME);
    const transforms = world.requirePool<TransformPool>(POOL_TRANSFORM);
    const z = this.base + Math.sin(t.elapsed * this.freq) * this.amplitude;
    transforms.setPosition(this.entity, 0, 0, z);
  }
}

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

// ---------- Engine boot ----------

(async function boot(): Promise<void> {
  stats.textContent = 'booting... (load assets)';

  const engine = Engine.create({ canvas });

  const tileAtlas = engine.device.registerAtlas({
    image: makeTileAtlas(),
    frames: [{ x: 0, y: 0, w: ISO_TILE_WIDTH, h: ISO_TILE_HEIGHT }],
    name: 'demo-tile',
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

  // One knight entity. Transform + Sprite as before; AnimationState
  // is the new component that swaps in a clip and the AnimationSystem
  // advances the frame field on SpritePool each tick.
  const transforms = engine.world.requirePool<TransformPool>(POOL_TRANSFORM);
  const sprites = engine.world.requirePool<SpritePool>(POOL_SPRITE);
  const animations = engine.world.requirePool<AnimationStatePool>(POOL_ANIMATION);

  const knight = engine.world.createEntity();
  transforms.attach(knight, 0, 0, 0.2);
  sprites.attach(knight, knightAtlas, 0);
  // Manifests without an explicit clips[] get a synthesized 'default'
  // clip covering all frames in order, looping. The knight sheet does
  // not declare clips, so 'default' is what we play.
  animations.play(knight, knightSheet.manifest, 'default');

  // Phase 4: violet/teal sparkle emitter attached to the knight. The
  // emitter spawns 30 particles/sec in an upward cone, additive
  // blended for a soft glow. Veil-weaver palette: hot purple -> cool
  // cyan as particles age.
  const emitters = engine.world.requirePool<ParticleEmitterPool>(POOL_EMITTER);
  emitters.attach(knight, {
    rate: 30,
    particleLife: 1.2,
    speedMin: 0.6,
    speedMax: 1.4,
    dirX: 0,
    dirY: 0,
    dirZ: 1,                  // upward in iso world (Z is height)
    coneRadians: Math.PI / 4,  // 45 degree half-angle cone
    ax: 0,
    ay: 0,
    az: -0.8,                  // gravity pulls back down
    startSize: 6,
    endSize: 1,
    startColor: hexToRgba(0xc88cff, 1.0),   // violet
    endColor: hexToRgba(0x6effff, 0),        // teal fade
    additive: true,
  });

  // Phase order:
  //   LOGIC      hover bobs the knight, emitter system spawns
  //              this tick's particles
  //   PHYSICS    particle simulation advances life + integrates
  //              velocity / acceleration
  //   ANIMATION  knight sprite frame steps
  //   RENDER     tiles, sprites, particles (in this order so
  //              particles draw above sprites)
  engine.world.addSystem(new HoverSystem(knight, 0.1, 1.5, 0.2), SYSTEM_PHASE_LOGIC);
  engine.world.addSystem(new ParticleEmitterSystem(), SYSTEM_PHASE_LOGIC);
  engine.world.addSystem(new ParticleSimulationSystem(), SYSTEM_PHASE_PHYSICS);
  engine.world.addSystem(new AnimationSystem(), SYSTEM_PHASE_ANIMATION);
  engine.world.addSystem(new TileRenderSystem(tileAtlas, 2), SYSTEM_PHASE_RENDER);
  engine.world.addSystem(new SpriteRenderSystem(), SYSTEM_PHASE_RENDER);
  engine.world.addSystem(new ParticleRenderSystem(), SYSTEM_PHASE_RENDER);
  const particles = engine.world.requirePool<ParticlePool>(POOL_PARTICLE);

  // Frame loop with the parallel session's hidden-tab fallback so the
  // preview keeps animating when not focused.
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
    const activeClip = animations.getClipName(knight);
    stats.textContent =
      'engine     ' + LOOM_ENGINE_VERSION + '\n' +
      'fps        ' + lastFps + '\n' +
      'draw calls ' + engine.device.getDrawCallCount() + ' (per frame)\n' +
      'frame      ' + t.frame + '   elapsed ' + t.elapsed.toFixed(2) + 's\n' +
      'entities   ' + engine.world.countEntities() + '   systems ' + engine.world.countSystems() + '\n' +
      'sheet      ' + knightSheet.manifest.name + '   clips ' + knightSheet.manifest.clips.length + '\n' +
      'playing    ' + (activeClip || '(none)') + '   frame idx ' + sprites.frame[0 + (knight & 0x00ffffff)] + '\n' +
      'particles  ' + particles.getLiveCount() + ' live  cap ' + particles.getMaxParticles() + '\n' +
      'camera     center=(' + engine.camera.centerX.toFixed(2) + ',' + engine.camera.centerY.toFixed(2) + ') zoom=' + engine.camera.zoom.toFixed(2);

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
