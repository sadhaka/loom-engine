// Loom Engine - Phase 2 demo (ECS-driven).
//
// Same visual output as Phase 1: 5x5 iso tile diamond + a hovering
// iron-red knight sprite. But everything is now driven through the
// ECS pipeline:
//
//   - The knight is an entity with Transform + Sprite components
//   - A custom HoverSystem (PHASE_LOGIC) bobs the knight's Z
//   - A custom TileRenderSystem (PHASE_RENDER) draws the ground
//   - The built-in SpriteRenderSystem (PHASE_RENDER) draws sprites
//   - Engine.tick(now) advances all of them
//
// Tiles aren't entities yet (terrain doesn't need ECS at this
// scale); they live in a pure render system that walks a fixed
// grid. Phase 3+ might promote them to entities if dynamic terrain
// becomes a thing.

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
  COLOR_KNOT_STR,
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
  ctx.beginPath();
  ctx.moveTo(ISO_TILE_WIDTH / 2, 1);
  ctx.lineTo(ISO_TILE_WIDTH - 1, ISO_TILE_HEIGHT / 2);
  ctx.lineTo(ISO_TILE_WIDTH / 2, ISO_TILE_HEIGHT - 1);
  ctx.strokeStyle = '#7a6a48';
  ctx.stroke();
  return c;
}

function makeSpriteAtlas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#b04a24';
  ctx.fillRect(5, 14, 6, 12);
  ctx.fillStyle = '#d8b878';
  ctx.fillRect(6, 6, 4, 6);
  ctx.fillStyle = '#7a3416';
  ctx.fillRect(5, 4, 6, 3);
  ctx.fillStyle = '#3a2616';
  ctx.fillRect(5, 26, 2, 5);
  ctx.fillRect(9, 26, 2, 5);
  ctx.fillStyle = '#c8c0a8';
  ctx.fillRect(12, 14, 1, 12);
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

// ---------- Engine boot ----------

const engine = Engine.create({ canvas });

// Atlases.
const tileAtlas = engine.device.registerAtlas({
  image: makeTileAtlas(),
  frames: [{ x: 0, y: 0, w: ISO_TILE_WIDTH, h: ISO_TILE_HEIGHT }],
  name: 'demo-tile',
});
const spriteAtlas = engine.device.registerAtlas({
  image: makeSpriteAtlas(),
  frames: [{ x: 0, y: 0, w: 16, h: 32 }],
  name: 'demo-knight',
});

// One knight entity at world origin.
const transforms = engine.world.requirePool<TransformPool>(POOL_TRANSFORM);
const sprites = engine.world.requirePool<SpritePool>(POOL_SPRITE);
const knight = engine.world.createEntity();
transforms.attach(knight, 0, 0, 0.2);
sprites.attach(knight, spriteAtlas, 0, COLOR_KNOT_STR);

// Systems: hover (logic) -> tiles (render) -> sprites (render).
// Within a phase, registration order = run order.
engine.world.addSystem(new HoverSystem(knight, 0.1, 1.5, 0.2), SYSTEM_PHASE_LOGIC);
engine.world.addSystem(new TileRenderSystem(tileAtlas, 2), SYSTEM_PHASE_RENDER);
engine.world.addSystem(new SpriteRenderSystem(), SYSTEM_PHASE_RENDER);

// ---------- Frame loop ----------

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
    'camera     center=(' + engine.camera.centerX.toFixed(2) + ',' + engine.camera.centerY.toFixed(2) + ') zoom=' + engine.camera.zoom.toFixed(2);

  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
