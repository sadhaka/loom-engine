// Loom Engine - Phase 1 demo.
//
// Renders one iso tile + one sprite at 60fps. Verifies that:
//   - Canvas2DDevice initializes
//   - registerAtlas accepts a procedural OffscreenCanvas image
//   - drawTile and drawSprite produce visible output
//   - Camera setCamera + worldToScreen path works end-to-end
//   - iso projection puts the sprite on top of the tile
//
// The demo paints its own atlas images procedurally so the demo
// has no asset dependencies. A real game ships preloaded PNGs.

import {
  LOOM_ENGINE_VERSION,
  Canvas2DDevice,
  createCamera,
  ISO_TILE_WIDTH,
  ISO_TILE_HEIGHT,
  hexToRgba,
} from '../dist/index.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const stats = document.getElementById('stats') as HTMLDivElement;

const device = new Canvas2DDevice(canvas);
const camera = createCamera(canvas.width, canvas.height);
camera.zoom = 1;
camera.centerX = 0;
camera.centerY = 0;

// Procedural tile atlas: a 64x32 dimetric diamond with a stone fill.
function makeTileAtlas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = ISO_TILE_WIDTH;
  c.height = ISO_TILE_HEIGHT;
  const ctx = c.getContext('2d')!;
  // Diamond outline.
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
  // Subtle highlight on the top half.
  ctx.beginPath();
  ctx.moveTo(ISO_TILE_WIDTH / 2, 1);
  ctx.lineTo(ISO_TILE_WIDTH - 1, ISO_TILE_HEIGHT / 2);
  ctx.lineTo(ISO_TILE_WIDTH / 2, ISO_TILE_HEIGHT - 1);
  ctx.strokeStyle = '#7a6a48';
  ctx.lineWidth = 1;
  ctx.stroke();
  return c;
}

// Procedural sprite atlas: a tiny knight silhouette in iron-red
// (Strknot palette per LOOM-CLASS-SYSTEM-SPEC).
function makeSpriteAtlas(): HTMLCanvasElement {
  const w = 16;
  const h = 32;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  // Body
  ctx.fillStyle = '#b04a24';
  ctx.fillRect(5, 14, 6, 12);
  // Head
  ctx.fillStyle = '#d8b878';
  ctx.fillRect(6, 6, 4, 6);
  // Helm crest
  ctx.fillStyle = '#7a3416';
  ctx.fillRect(5, 4, 6, 3);
  // Legs
  ctx.fillStyle = '#3a2616';
  ctx.fillRect(5, 26, 2, 5);
  ctx.fillRect(9, 26, 2, 5);
  // Sword on the right side
  ctx.fillStyle = '#c8c0a8';
  ctx.fillRect(12, 14, 1, 12);
  return c;
}

const tileImg = makeTileAtlas();
const spriteImg = makeSpriteAtlas();

const tileAtlas = device.registerAtlas({
  image: tileImg,
  frames: [{ x: 0, y: 0, w: ISO_TILE_WIDTH, h: ISO_TILE_HEIGHT }],
  name: 'demo-tile',
});

const spriteAtlas = device.registerAtlas({
  image: spriteImg,
  frames: [{ x: 0, y: 0, w: 16, h: 32 }],
  name: 'demo-sprite-knight',
});

device.setCamera(camera);

let frameCount = 0;
let lastFpsAt = performance.now();
let lastFps = 0;

// Animate: gentle hover so we see the engine actually ticking.
function tick(now: number): void {
  const t = now / 1000;

  device.beginFrame();
  device.setCamera(camera);

  // Ground: 5x5 tiles centered on origin.
  for (let ty = -2; ty <= 2; ty++) {
    for (let tx = -2; tx <= 2; tx++) {
      device.drawTile(tx, ty, tileAtlas, 0);
    }
  }

  // Knight at world (0,0) with a slow z hover.
  const z = 0.2 + Math.sin(t * 1.5) * 0.1;
  device.drawSprite(0, 0, z, spriteAtlas, 0, hexToRgba(0xffffff));

  device.endFrame();

  frameCount++;
  if (now - lastFpsAt >= 500) {
    lastFps = Math.round((frameCount * 1000) / (now - lastFpsAt));
    frameCount = 0;
    lastFpsAt = now;
  }

  stats.textContent =
    'engine     ' + LOOM_ENGINE_VERSION + '\n' +
    'fps        ' + lastFps + '\n' +
    'draw calls ' + device.getDrawCallCount() + ' (per frame)\n' +
    'camera     center=(' + camera.centerX.toFixed(2) + ',' + camera.centerY.toFixed(2) + ') zoom=' + camera.zoom.toFixed(2) + '\n' +
    'tile atlas ' + tileAtlas + '   sprite atlas ' + spriteAtlas;

  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
