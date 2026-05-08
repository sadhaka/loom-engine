// Loom Engine - Plaza Multiplayer example.
//
// Walkable iso plaza with three synthetic peers wandering randomly,
// driven entirely by a MockMultiplayerBridge. Demonstrates the
// PeerPresenceSystem -> PeerPool -> PeerRenderSystem pipeline.
//
// Production code swaps the mock bridge for
//   new SSEMultiplayerBridge({ baseUrl: '/api/v1/loom/presence/events',
//                              characterId, zone })
// and the rest of the engine code is unchanged - that's the point of
// the bridge abstraction.

import {
  Engine,
  POOL_TRANSFORM,
  POOL_SPRITE,
  TransformPool,
  SpritePool,
  ISO_TILE_WIDTH,
  ISO_TILE_HEIGHT,
  InputSystem,
  SpriteRenderSystem,
  RESOURCE_DEVICE,
  RESOURCE_CAMERA,
  RESOURCE_INPUT,
  SYSTEM_PHASE_INPUT,
  SYSTEM_PHASE_LOGIC,
  SYSTEM_PHASE_RENDER,
  // Multiplayer
  MockMultiplayerBridge,
  PeerPool,
  PeerPresenceSystem,
  PeerRenderSystem,
  PeerSpritePool,
  POOL_PEER_SPRITE,
  RESOURCE_MULTIPLAYER_BRIDGE,
  RESOURCE_PEER_POOL,
  type AtlasHandle,
  type CameraView,
  type EntityId,
  type IGraphicsDevice,
  type InputSnapshot,
  type System,
  type World,
} from '@sadhaka/loom-engine';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const statsEl = document.getElementById('stats') as HTMLDivElement;

const LOCAL_ID = 'me';
const ZONE = 'plaza';

function makeTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = ISO_TILE_WIDTH; c.height = ISO_TILE_HEIGHT;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  ctx.moveTo(ISO_TILE_WIDTH / 2, 0);
  ctx.lineTo(ISO_TILE_WIDTH, ISO_TILE_HEIGHT / 2);
  ctx.lineTo(ISO_TILE_WIDTH / 2, ISO_TILE_HEIGHT);
  ctx.lineTo(0, ISO_TILE_HEIGHT / 2);
  ctx.closePath();
  ctx.fillStyle = '#3a322a'; ctx.fill();
  ctx.strokeStyle = '#7a6a48'; ctx.stroke();
  return c;
}

function makeSprite(body: string, hat: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 24;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = body; ctx.fillRect(4, 8, 8, 14);
  ctx.fillStyle = '#d8b878'; ctx.fillRect(5, 2, 6, 6);
  ctx.fillStyle = hat; ctx.fillRect(4, 1, 8, 3);
  ctx.fillStyle = '#000'; ctx.fillRect(6, 4, 1, 1); ctx.fillRect(9, 4, 1, 1);
  return c;
}

class TileFloorSystem implements System {
  readonly name: string = 'tile-floor';
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

// WASD + arrow keys translate the player Transform AND broadcast the
// new position to the bridge. The bridge rate-limits broadcasts to
// 10 Hz, so calling broadcastPosition every frame is fine.
class WalkBroadcastSystem implements System {
  readonly name: string = 'walk-broadcast';
  constructor(private player: EntityId, private speed: number) {}
  update(world: World, dt: number): void {
    const input = world.resources.get<InputSnapshot>(RESOURCE_INPUT);
    if (!input) return;
    const transforms = world.requirePool<TransformPool>(POOL_TRANSFORM);
    const bridge = world.resources.get<MockMultiplayerBridge>(RESOURCE_MULTIPLAYER_BRIDGE);
    const i = (this.player as number) & 0x00ffffff;
    let dx = 0, dy = 0;
    if (input.keysHeld.has('ArrowLeft') || input.keysHeld.has('KeyA')) dx -= 1;
    if (input.keysHeld.has('ArrowRight') || input.keysHeld.has('KeyD')) dx += 1;
    if (input.keysHeld.has('ArrowUp') || input.keysHeld.has('KeyW')) dy -= 1;
    if (input.keysHeld.has('ArrowDown') || input.keysHeld.has('KeyS')) dy += 1;
    if (dx !== 0 || dy !== 0) {
      const len = Math.sqrt(dx * dx + dy * dy);
      transforms.setPosition(this.player,
        (transforms.x[i] ?? 0) + dx / len * this.speed * dt,
        (transforms.y[i] ?? 0) + dy / len * this.speed * dt,
        transforms.z[i] ?? 0);
    }
    if (bridge) {
      bridge.broadcastPosition(
        transforms.x[i] ?? 0,
        transforms.y[i] ?? 0,
        ZONE,
        Date.now(),
      );
    }
  }
}

// Surface bridge stats and peer count to the DOM. Pure read.
class StatsOverlaySystem implements System {
  readonly name: string = 'stats-overlay';
  update(world: World, _dt: number): void {
    const bridge = world.resources.get<MockMultiplayerBridge>(RESOURCE_MULTIPLAYER_BRIDGE);
    const pool = world.resources.get<PeerPool>(RESOURCE_PEER_POOL);
    if (!bridge || !pool) return;
    const s = bridge.stats();
    statsEl.textContent =
      'status:    ' + bridge.status() + '\n' +
      'peers:     ' + pool.size() + '\n' +
      'received:  ' + s.messagesReceived + '\n' +
      'sent:      ' + s.messagesSent + '\n' +
      'rate-drops: ' + s.rateLimitedDrops;
  }
}

(async function boot(): Promise<void> {
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
  const peerAtlasRed = engine.device.registerAtlas({
    image: makeSprite('#7a3a1c', '#3a2616'),
    frames: [{ x: 0, y: 0, w: 16, h: 24 }],
    name: 'peer-red',
  });
  const peerAtlasGreen = engine.device.registerAtlas({
    image: makeSprite('#3a7a3a', '#1a4a1a'),
    frames: [{ x: 0, y: 0, w: 16, h: 24 }],
    name: 'peer-green',
  });
  const peerAtlasYellow = engine.device.registerAtlas({
    image: makeSprite('#b89a2a', '#5a4a16'),
    frames: [{ x: 0, y: 0, w: 16, h: 24 }],
    name: 'peer-yellow',
  });

  const transforms = engine.world.requirePool<TransformPool>(POOL_TRANSFORM);
  const sprites = engine.world.requirePool<SpritePool>(POOL_SPRITE);

  const player = engine.world.createEntity();
  transforms.attach(player, 0, 0, 0.2);
  sprites.attach(player, playerAtlas, 0);

  // Multiplayer wiring.
  const bridge = new MockMultiplayerBridge();
  bridge.connect();
  const peerPool = new PeerPool();
  peerPool.setLocalCharacterId(LOCAL_ID);
  const peerSprites = new PeerSpritePool({ defaultAtlas: peerAtlasRed });
  peerSprites.setOverride('alice', { atlas: peerAtlasRed,    frame: 0, tint: null });
  peerSprites.setOverride('bob',   { atlas: peerAtlasGreen,  frame: 0, tint: null });
  peerSprites.setOverride('carol', { atlas: peerAtlasYellow, frame: 0, tint: null });

  engine.world.resources.set(RESOURCE_MULTIPLAYER_BRIDGE, bridge);
  engine.world.resources.set(RESOURCE_PEER_POOL, peerPool);
  engine.world.registerPool(POOL_PEER_SPRITE, peerSprites);

  // Push an initial snapshot so the three peers materialize at known
  // starting positions, then drive them with periodic random-walk
  // updates. This is exactly what a real backend would do over SSE.
  const peers = [
    { id: 'alice', x: -2, y: -1, name: 'Alice' },
    { id: 'bob',   x:  2, y: -1, name: 'Bob' },
    { id: 'carol', x:  0, y:  2, name: 'Carol' },
  ];
  bridge.enqueueIncoming({
    kind: 'snapshot',
    peers: peers.map((p) => ({
      characterId: p.id,
      x: p.x,
      y: p.y,
      zone: ZONE,
      tsMs: Date.now(),
      name: p.name,
    })),
  });

  setInterval(() => {
    for (let i = 0; i < peers.length; i++) {
      const p = peers[i];
      if (!p) continue;
      // Small random step; clamp to a 5x5 plaza so they don't wander off.
      p.x = Math.max(-3, Math.min(3, p.x + (Math.random() - 0.5) * 0.8));
      p.y = Math.max(-3, Math.min(3, p.y + (Math.random() - 0.5) * 0.8));
      bridge.enqueueIncoming({
        kind: 'update',
        characterId: p.id,
        x: p.x,
        y: p.y,
        zone: ZONE,
        tsMs: Date.now(),
        name: p.name,
      });
    }
  }, 500);

  engine.world.addSystem(new InputSystem(), SYSTEM_PHASE_INPUT);
  engine.world.addSystem(new PeerPresenceSystem(), SYSTEM_PHASE_INPUT);
  engine.world.addSystem(new WalkBroadcastSystem(player, 3.0), SYSTEM_PHASE_LOGIC);
  engine.world.addSystem(new StatsOverlaySystem(), SYSTEM_PHASE_LOGIC);
  engine.world.addSystem(new TileFloorSystem(tileAtlas, 3), SYSTEM_PHASE_RENDER);
  engine.world.addSystem(new SpriteRenderSystem(), SYSTEM_PHASE_RENDER);
  engine.world.addSystem(new PeerRenderSystem(), SYSTEM_PHASE_RENDER);

  function tick(now: number): void {
    engine.tick(now);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})().catch((err) => {
  statsEl.textContent = 'boot failed: ' + (err instanceof Error ? err.message : String(err));
});
