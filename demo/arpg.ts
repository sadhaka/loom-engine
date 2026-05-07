// Loom Engine - Phase 8 ARPG first slice demo.
//
// Hub: Lastlight Plaza. Knight player. One NPC (Misha Dev) at the
// gate with a greeting line. One portal at the south edge that
// transitions to Iron Reach (Strknot starter zone).
//
// Per LOOM-CLASS-SYSTEM-SPEC §3 + §4 + the v1 hotkey lock list in
// CLAUDE.md (E + Enter open NPC dialog).

import {
  LOOM_ENGINE_VERSION,
  Engine,
  POOL_TRANSFORM,
  POOL_SPRITE,
  POOL_ANIMATION,
  POOL_INTERACTABLE,
  ISO_TILE_WIDTH,
  ISO_TILE_HEIGHT,
  TransformPool,
  SpritePool,
  AnimationStatePool,
  InteractablePool,
  AnimationSystem,
  SpriteRenderSystem,
  InputSystem,
  InteractionSystem,
  ZONE_CATALOG,
  beginTransition,
  tickTransition,
  isTransitioning,
  RESOURCE_DEVICE,
  RESOURCE_CAMERA,
  RESOURCE_TIME,
  RESOURCE_INPUT,
  RESOURCE_ZONE_STATE,
  RESOURCE_LAST_INTERACTION,
  SYSTEM_PHASE_INPUT,
  SYSTEM_PHASE_LOGIC,
  SYSTEM_PHASE_ANIMATION,
  SYSTEM_PHASE_RENDER,
  loadSpriteSheet,
  rgbaToHexString,
  type LoadedSpriteSheet,
  type System,
  type World,
  type IGraphicsDevice,
  type CameraView,
  type TimeResource,
  type AtlasHandle,
  type EntityId,
  type ZoneId,
  type ZoneStateResource,
  type InputSnapshot,
  type LastInteractionResource,
  type ZoneCatalogEntry,
} from '../dist/index.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const stats = document.getElementById('stats') as HTMLDivElement;
const dialogBox = document.getElementById('dialog') as HTMLDivElement;
const dialogSpeaker = document.getElementById('dialog-speaker') as HTMLSpanElement;
const dialogLine = document.getElementById('dialog-line') as HTMLSpanElement;
const dialogClose = document.getElementById('dialog-close') as HTMLSpanElement;

dialogClose.addEventListener('click', () => {
  dialogBox.classList.remove('show');
});

// ---------- Procedural tile atlas builder per zone palette ----------

function makeTileAtlasFor(zone: ZoneCatalogEntry): HTMLCanvasElement {
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
function makeMishaSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 32;
  const ctx = c.getContext('2d')!;
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

// Portal - a glowing diamond marker.
function makePortalSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#9b5de5';
  ctx.beginPath();
  ctx.moveTo(16, 4);
  ctx.lineTo(28, 16);
  ctx.lineTo(16, 28);
  ctx.lineTo(4, 16);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ffd86a';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Sigil core
  ctx.fillStyle = '#ffd86a';
  ctx.fillRect(14, 14, 4, 4);
  return c;
}

// ---------- Demo systems ----------

class ZoneTileRenderSystem implements System {
  readonly name: string = 'arpg-tile-render';
  // Per-zone atlas handles. The system picks the right one based
  // on the active zone in ZoneStateResource.
  private atlasByZone: Map<ZoneId, AtlasHandle> = new Map();
  constructor(private radius: number) {}
  registerAtlas(zoneId: ZoneId, atlas: AtlasHandle): void {
    this.atlasByZone.set(zoneId, atlas);
  }
  update(world: World, _dt: number): void {
    const device = world.resources.require<IGraphicsDevice>(RESOURCE_DEVICE);
    const camera = world.resources.require<CameraView>(RESOURCE_CAMERA);
    const zone = world.resources.require<ZoneStateResource>(RESOURCE_ZONE_STATE);
    const atlas = this.atlasByZone.get(zone.activeZoneId);
    if (atlas === undefined) return;
    device.setCamera(camera);
    for (let ty = -this.radius; ty <= this.radius; ty++) {
      for (let tx = -this.radius; tx <= this.radius; tx++) {
        device.drawTile(tx, ty, atlas, 0);
      }
    }
  }
}

class WASDMoveSystem implements System {
  readonly name: string = 'arpg-wasd-move';
  constructor(private player: EntityId, private speed: number) {}
  update(world: World, dt: number): void {
    const input = world.resources.get<InputSnapshot>(RESOURCE_INPUT);
    const transforms = world.requirePool<TransformPool>(POOL_TRANSFORM);
    const zone = world.resources.require<ZoneStateResource>(RESOURCE_ZONE_STATE);
    if (!input) return;
    if (isTransitioning(zone)) return;   // freeze input during fade
    let dx = 0, dy = 0;
    if (input.keysHeld.has('ArrowLeft') || input.keysHeld.has('KeyA')) dx -= 1;
    if (input.keysHeld.has('ArrowRight') || input.keysHeld.has('KeyD')) dx += 1;
    if (input.keysHeld.has('ArrowUp') || input.keysHeld.has('KeyW')) dy -= 1;
    if (input.keysHeld.has('ArrowDown') || input.keysHeld.has('KeyS')) dy += 1;
    if (dx === 0 && dy === 0) return;
    const len = Math.sqrt(dx * dx + dy * dy);
    const i = (this.player as number) & 0x00ffffff;
    const x = transforms.x[i] ?? 0;
    const y = transforms.y[i] ?? 0;
    transforms.setPosition(this.player, x + (dx / len) * this.speed * dt, y + (dy / len) * this.speed * dt, transforms.z[i] ?? 0);
  }
}

// Reads LastInteractionResource each tick, dispatches:
//   kind=npc -> show dialog
//   kind=portal -> begin zone transition
class InteractionDispatchSystem implements System {
  readonly name: string = 'arpg-interaction-dispatch';
  private lastSeenFrame: number = -1;
  update(world: World, _dt: number): void {
    const last = world.resources.require<LastInteractionResource>(RESOURCE_LAST_INTERACTION);
    if (last.atFrame === this.lastSeenFrame) return;
    if (last.entityIndex < 0) {
      this.lastSeenFrame = last.atFrame;
      return;
    }
    this.lastSeenFrame = last.atFrame;

    if (last.kind === 'npc') {
      // Payload is the dialog line id. Demo's dialog table:
      const lines: Record<string, { speaker: string; line: string }> = {
        misha_greet: {
          speaker: 'Misha Dev',
          line: 'You came through the smoke and the iron is still hot. Steady. Speak when the Loom asks.',
        },
      };
      const dl = lines[last.payload];
      if (dl) {
        dialogSpeaker.textContent = dl.speaker;
        dialogLine.textContent = dl.line;
        dialogBox.classList.add('show');
      }
    } else if (last.kind === 'portal') {
      const target = last.payload as ZoneId;
      const zone = world.resources.require<ZoneStateResource>(RESOURCE_ZONE_STATE);
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      beginTransition(zone, target, 'walk', 600, now);
      // Reset player position to the new zone's origin.
      const transforms = world.requirePool<TransformPool>(POOL_TRANSFORM);
      // We don't have the player handle here; use the convention that
      // index 1 is the first-created entity (the player) in this demo.
      // A real game tracks the player handle properly.
      transforms.setPosition({ ...{ valueOf: () => 1 } } as unknown as EntityId, 0, 0, 0);
      dialogBox.classList.remove('show');
    }
  }
}

// Ticks ZoneStateResource transitions each frame. After fade ends,
// reload tile atlas / palette (handled by ZoneTileRenderSystem
// reading the active zone fresh each tick).
class ZoneTransitionTickSystem implements System {
  readonly name: string = 'arpg-zone-tick';
  update(world: World, _dt: number): void {
    const zone = world.resources.require<ZoneStateResource>(RESOURCE_ZONE_STATE);
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    tickTransition(zone, now);
  }
}

// ---------- Engine boot ----------

(async function boot(): Promise<void> {
  stats.textContent = 'booting... (load assets)';
  const engine = Engine.create({ canvas });

  // Register tile atlases for the 2 zones we ship in the first
  // slice. Future zones add their own atlas registrations.
  const tileRender = new ZoneTileRenderSystem(2);
  const plazaAtlas = engine.device.registerAtlas({
    image: makeTileAtlasFor(ZONE_CATALOG.lastlight_plaza),
    frames: [{ x: 0, y: 0, w: ISO_TILE_WIDTH, h: ISO_TILE_HEIGHT }],
    name: 'tile-plaza',
  });
  const ironAtlas = engine.device.registerAtlas({
    image: makeTileAtlasFor(ZONE_CATALOG.iron_reach),
    frames: [{ x: 0, y: 0, w: ISO_TILE_WIDTH, h: ISO_TILE_HEIGHT }],
    name: 'tile-iron',
  });
  tileRender.registerAtlas('lastlight_plaza', plazaAtlas);
  tileRender.registerAtlas('iron_reach', ironAtlas);

  const mishaAtlas = engine.device.registerAtlas({
    image: makeMishaSprite(),
    frames: [{ x: 0, y: 0, w: 16, h: 32 }],
    name: 'misha-dev',
  });
  const portalAtlas = engine.device.registerAtlas({
    image: makePortalSprite(),
    frames: [{ x: 0, y: 0, w: 32, h: 32 }],
    name: 'portal',
  });

  // Knight player (reuses Phase 1 asset).
  let knightSheet: LoadedSpriteSheet;
  try {
    knightSheet = await loadSpriteSheet('../assets/knight/walk.json');
  } catch (err) {
    stats.textContent = 'asset load failed:\n' + (err instanceof Error ? err.message : String(err));
    throw err;
  }
  const knightAtlas = engine.device.registerAtlas(knightSheet.atlas);

  const transforms = engine.world.requirePool<TransformPool>(POOL_TRANSFORM);
  const sprites = engine.world.requirePool<SpritePool>(POOL_SPRITE);
  const animations = engine.world.requirePool<AnimationStatePool>(POOL_ANIMATION);
  const interactables = engine.world.requirePool<InteractablePool>(POOL_INTERACTABLE);

  // Player at world origin.
  const player = engine.world.createEntity();
  transforms.attach(player, 0, 0, 0.2);
  sprites.attach(player, knightAtlas, 0);
  animations.play(player, knightSheet.manifest, 'default');

  // Misha Dev NPC at (1, -1) - just north-east of player.
  const misha = engine.world.createEntity();
  transforms.attach(misha, 1, -1, 0);
  sprites.attach(misha, mishaAtlas, 0);
  interactables.attach(misha, {
    kind: 'npc',
    prompt: 'Talk to Misha Dev',
    payload: 'misha_greet',
    radius: 1.5,
  });

  // Iron Reach portal at (0, 1.5) - south of player.
  const portal = engine.world.createEntity();
  transforms.attach(portal, 0, 1.5, 0);
  sprites.attach(portal, portalAtlas, 0);
  interactables.attach(portal, {
    kind: 'portal',
    prompt: 'Enter Iron Reach',
    payload: 'iron_reach',
    radius: 0.8,
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

  function tick(now: number): void {
    engine.tick(now);
    const t = engine.world.resources.require<TimeResource>(RESOURCE_TIME);
    const zone = engine.world.resources.require<ZoneStateResource>(RESOURCE_ZONE_STATE);
    const last = engine.world.resources.require<LastInteractionResource>(RESOURCE_LAST_INTERACTION);
    const px = transforms.x[(player as number) & 0x00ffffff] ?? 0;
    const py = transforms.y[(player as number) & 0x00ffffff] ?? 0;
    const zoneCat = ZONE_CATALOG[zone.activeZoneId];
    const fading = isTransitioning(zone) ? ' (fading -> ' + (zone.transition?.toZoneId ?? '') + ')' : '';

    stats.textContent =
      'engine     ' + LOOM_ENGINE_VERSION + '\n' +
      'frame      ' + t.frame + '   elapsed ' + t.elapsed.toFixed(1) + 's\n' +
      'zone       ' + zoneCat.name + ' [' + zoneCat.knot + ']' + fading + '\n' +
      'player     pos=(' + px.toFixed(2) + ',' + py.toFixed(2) + ')\n' +
      'last NPC   ' + (last.entityIndex >= 0 ? last.kind + ' / ' + last.payload : '(none)') + '\n' +
      'controls   WASD/arrows = move   click NPC or stand near + E/Enter to interact';

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
