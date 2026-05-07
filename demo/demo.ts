// Loom Engine - Phase 2 demo (ECS-driven, asset-loaded knight).
//
// Scene: 5x5 iso tile diamond + a hovering, walking weaver-knight
// driven through the ECS pipeline:
//
//   - The tile atlas stays procedural (terrain doesn't ship as art
//     yet; that's a Phase 7 / world-builder concern)
//   - The knight sprite sheet is LOADED from assets/knight/walk.json
//     via the new sprite-sheet-loader. PNG + JSON manifest pair.
//   - The knight is an entity with Transform + Sprite components
//   - HoverSystem (PHASE_LOGIC) bobs the knight's Z
//   - WalkCycleSystem (PHASE_LOGIC) steps the sprite frame from
//     the manifest's per-frame durations
//   - TileRenderSystem (PHASE_RENDER) draws the ground tiles
//   - SpriteRenderSystem (PHASE_RENDER) draws sprites
//   - Engine.tick(now) advances all of them
//
// The HTML host is `demo/index.html`; relative path to the asset
// from there is `../assets/knight/walk.json`.

import {
  LOOM_ENGINE_VERSION,
  Engine,
  POOL_TRANSFORM,
  POOL_SPRITE,
  ISO_TILE_WIDTH,
  ISO_TILE_HEIGHT,
  TransformPool,
  SpritePool,
  SpriteRenderSystem,
  RESOURCE_DEVICE,
  RESOURCE_CAMERA,
  RESOURCE_TIME,
  SYSTEM_PHASE_LOGIC,
  SYSTEM_PHASE_RENDER,
  loadSpriteSheet,
  computeFrameIndex,
  type SpriteSheetManifest,
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

// Bobs an entity's Z based on a wave function. Demo runs in
// PHASE_LOGIC so the new Z is in place before render.
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

// Walks a fixed iso tile grid each frame and submits drawTile calls.
// Tiles are not ECS entities; this system reads its config directly.
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

// Advances an entity's sprite frame from a sheet manifest each tick.
// Uses computeFrameIndex which honors per-frame duration_ms; falls
// back to manifest.fps if the manifest is uniform.
class WalkCycleSystem implements System {
  readonly name: string = 'demo-walk-cycle';
  private startMs: number = -1;
  constructor(private entity: EntityId, private manifest: SpriteSheetManifest) {}
  update(world: World, _dt: number): void {
    const now = performance.now();
    if (this.startMs < 0) this.startMs = now;
    const sprites = world.requirePool<SpritePool>(POOL_SPRITE);
    sprites.setFrame(this.entity, computeFrameIndex(this.manifest, now, this.startMs));
  }
}

// ---------- Engine boot (async IIFE; demo.js stays browser-portable
// without relying on top-level await semantics) ----------

(async function boot(): Promise<void> {
  stats.textContent = 'booting... (load assets)';

  const engine = Engine.create({ canvas });

  // Tile atlas (procedural, code-painted).
  const tileAtlas = engine.device.registerAtlas({
    image: makeTileAtlas(),
    frames: [{ x: 0, y: 0, w: ISO_TILE_WIDTH, h: ISO_TILE_HEIGHT }],
    name: 'demo-tile',
  });

  // Knight atlas - LOADED from disk via the sprite-sheet pipeline.
  let knightSheet: LoadedSpriteSheet;
  try {
    knightSheet = await loadSpriteSheet('../assets/knight/walk.json');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.textContent = 'asset load failed:\n' + msg;
    throw err;
  }
  const knightAtlas = engine.device.registerAtlas(knightSheet.atlas);

  // One knight entity at world origin. No tint - the loaded asset has
  // its own baked palette (Veil-weaver violet/teal).
  const transforms = engine.world.requirePool<TransformPool>(POOL_TRANSFORM);
  const sprites = engine.world.requirePool<SpritePool>(POOL_SPRITE);
  const knight = engine.world.createEntity();
  transforms.attach(knight, 0, 0, 0.2);
  sprites.attach(knight, knightAtlas, 0);

  // Systems: hover + walk-cycle (logic) -> tiles + sprites (render).
  // Within a phase, registration order = run order.
  engine.world.addSystem(new HoverSystem(knight, 0.1, 1.5, 0.2), SYSTEM_PHASE_LOGIC);
  engine.world.addSystem(new WalkCycleSystem(knight, knightSheet.manifest), SYSTEM_PHASE_LOGIC);
  engine.world.addSystem(new TileRenderSystem(tileAtlas, 2), SYSTEM_PHASE_RENDER);
  engine.world.addSystem(new SpriteRenderSystem(), SYSTEM_PHASE_RENDER);

  // Frame loop. Schedule via rAF when the tab is visible (smooth, vsync-aligned)
  // and fall back to setTimeout when hidden so the preview / background tabs
  // still animate. Browsers throttle or pause rAF in hidden tabs - that breaks
  // any headless / iframe preview flow that doesn't have focus.
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
    stats.textContent =
      'engine     ' + LOOM_ENGINE_VERSION + '\n' +
      'fps        ' + lastFps + '\n' +
      'draw calls ' + engine.device.getDrawCallCount() + ' (per frame)\n' +
      'frame      ' + t.frame + '   elapsed ' + t.elapsed.toFixed(2) + 's\n' +
      'entities   ' + engine.world.countEntities() + '   systems ' + engine.world.countSystems() + '\n' +
      'sheet      ' + knightSheet.manifest.name + '   frames ' + knightSheet.manifest.frames.length + '   fps ' + knightSheet.manifest.fps + '\n' +
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

  // Run one immediate tick so the scene paints even if the tab is
  // hidden and the first scheduled frame is delayed.
  tick(performance.now());
})().catch((err) => {
  const msg = err instanceof Error ? err.message + '\n' + (err.stack ?? '') : String(err);
  stats.textContent = 'boot failed:\n' + msg;
});
