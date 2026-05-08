// Loom Engine - Phase 15.1 multiplayer presence tests.
//
// PeerPool interpolation + departure + snapshot semantics.
// MockMultiplayerBridge enqueue / poll / rate-limit contract.
// PeerPresenceSystem end-to-end against a fake bridge + world.
// PeerRenderSystem submits one drawSprite per peer and a name label
// when one is set.
//
// All tests run in Node via tsx --test; SSEMultiplayerBridge has its
// own browser-only path that's exercised by the plaza-multiplayer
// demo's preview verification.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  // Multiplayer
  PeerPool,
  MockMultiplayerBridge,
  PeerPresenceSystem,
  PeerRenderSystem,
  PeerSpritePool,
  POOL_PEER_SPRITE,
  RESOURCE_MULTIPLAYER_BRIDGE,
  RESOURCE_PEER_POOL,
  BROADCAST_HZ,
  BROADCAST_MIN_INTERVAL_MS,
  // World
  World,
  ResourceRegistry,
  createTimeResource,
  RESOURCE_TIME,
  RESOURCE_CAMERA,
  RESOURCE_DEVICE,
  SYSTEM_PHASE_INPUT,
  SYSTEM_PHASE_RENDER,
  approxEq,
  type IGraphicsDevice,
  type CameraView,
  type AtlasDescriptor,
  type AtlasHandle,
  type ColorRGBA,
  type TextStyle,
  type PresenceMessage,
} from '../src/index.js';

// ----- Synthetic device for render-system tests -----

interface CapturedDraw {
  kind: 'sprite' | 'text';
  x: number;
  y: number;
  z: number;
  atlas: AtlasHandle;
  frame: number;
  tinted: boolean;
  text?: string;
}

class FakeDevice implements IGraphicsDevice {
  readonly canvas: HTMLCanvasElement = {} as HTMLCanvasElement;
  readonly viewportWidth: number = 640;
  readonly viewportHeight: number = 400;
  drawCalls: CapturedDraw[] = [];
  cameraSet: number = 0;

  beginFrame(): void { this.drawCalls = []; }
  endFrame(): void {}
  setCamera(_c: Readonly<CameraView>): void { this.cameraSet++; }
  registerAtlas(_d: AtlasDescriptor): AtlasHandle { return 0; }
  releaseAtlas(_h: AtlasHandle): void {}
  drawSprite(x: number, y: number, z: number, atlas: AtlasHandle, frame: number, tint?: Readonly<ColorRGBA>): void {
    this.drawCalls.push({ kind: 'sprite', x, y, z, atlas, frame, tinted: !!tint });
  }
  drawTile(_x: number, _y: number, _a: AtlasHandle, _f: number): void {}
  drawText(x: number, y: number, text: string, _s: TextStyle): void {
    this.drawCalls.push({ kind: 'text', x, y, z: 0, atlas: -1, frame: 0, tinted: false, text });
  }
  drawParticle(_x: number, _y: number, _z: number, _s: number, _c: Readonly<ColorRGBA>, _a: boolean): void {}
  getDrawCallCount(): number { return this.drawCalls.length; }
}

function makeCamera(): CameraView {
  return { x: 0, y: 0, zoom: 1, viewportWidth: 640, viewportHeight: 400 } as unknown as CameraView;
}

// ===== PeerPool =====

test('peer pool: first update sets prev=current; renders at sent position', () => {
  const pool = new PeerPool();
  pool.upsert('p1', 10, 20, 'plaza', 1000, 'Alice');
  const pos = pool.getRenderedPosition('p1', 1000);
  assert.ok(pos);
  assert.equal(pos!.x, 10);
  assert.equal(pos!.y, 20);
  assert.equal(pool.size(), 1);
});

test('peer pool: interpolation between two samples', () => {
  const pool = new PeerPool();
  // t=0 at (0,0), t=1000 at (10,10). Mid-way (t=500) renders at (5,5).
  pool.upsert('p1', 0, 0, 'plaza', 0);
  pool.upsert('p1', 10, 10, 'plaza', 1000);
  const mid = pool.getRenderedPosition('p1', 500);
  assert.ok(mid);
  assert.ok(approxEq(mid!.x, 5));
  assert.ok(approxEq(mid!.y, 5));
});

test('peer pool: factor saturates above 1 (peer freezes after currentTs)', () => {
  const pool = new PeerPool();
  pool.upsert('p1', 0, 0, 'plaza', 0);
  pool.upsert('p1', 10, 10, 'plaza', 1000);
  // Way past currentTs; should stay at (10,10), not extrapolate.
  const future = pool.getRenderedPosition('p1', 5000);
  assert.ok(future);
  assert.equal(future!.x, 10);
  assert.equal(future!.y, 10);
});

test('peer pool: factor floors at 0 (peer renders at prev before prevTs)', () => {
  const pool = new PeerPool();
  pool.upsert('p1', 0, 0, 'plaza', 1000);
  pool.upsert('p1', 10, 10, 'plaza', 2000);
  // Before prevTs - factor < 0, clamped to 0, render at prev.
  const past = pool.getRenderedPosition('p1', 500);
  assert.ok(past);
  assert.equal(past!.x, 0);
  assert.equal(past!.y, 0);
});

test('peer pool: third update slides prev <- current, current <- new', () => {
  const pool = new PeerPool();
  pool.upsert('p1', 0, 0, 'plaza', 0);
  pool.upsert('p1', 10, 10, 'plaza', 1000);
  pool.upsert('p1', 20, 20, 'plaza', 2000);
  // After third update, prev=(10,10)@1000, current=(20,20)@2000. Mid = (15,15).
  const mid = pool.getRenderedPosition('p1', 1500);
  assert.ok(mid);
  assert.ok(approxEq(mid!.x, 15));
  assert.ok(approxEq(mid!.y, 15));
});

test('peer pool: out-of-order update older than current is dropped', () => {
  const pool = new PeerPool();
  pool.upsert('p1', 0, 0, 'plaza', 0);
  pool.upsert('p1', 10, 10, 'plaza', 1000);
  // Older ts arrives - should be ignored.
  pool.upsert('p1', 99, 99, 'plaza', 500);
  const at = pool.getRenderedPosition('p1', 1000);
  assert.ok(at);
  assert.equal(at!.x, 10);
  assert.equal(at!.y, 10);
});

test('peer pool: remove drops the peer', () => {
  const pool = new PeerPool();
  pool.upsert('p1', 5, 5, 'plaza', 100);
  assert.equal(pool.size(), 1);
  assert.equal(pool.remove('p1'), true);
  assert.equal(pool.size(), 0);
  assert.equal(pool.has('p1'), false);
});

test('peer pool: applySnapshot replaces roster (drops anyone missing)', () => {
  const pool = new PeerPool();
  pool.upsert('p1', 1, 1, 'plaza', 0);
  pool.upsert('p2', 2, 2, 'plaza', 0);
  pool.upsert('p3', 3, 3, 'plaza', 0);
  pool.applySnapshot([
    { characterId: 'p2', x: 22, y: 22, zone: 'plaza', tsMs: 100 },
    { characterId: 'p4', x: 44, y: 44, zone: 'plaza', tsMs: 100, name: 'Newbie' },
  ]);
  assert.equal(pool.size(), 2);
  assert.equal(pool.has('p1'), false);
  assert.equal(pool.has('p2'), true);
  assert.equal(pool.has('p3'), false);
  assert.equal(pool.has('p4'), true);
  assert.equal(pool.get('p4')?.name, 'Newbie');
});

test('peer pool: self-filter ignores upserts and snapshot entries with local id', () => {
  const pool = new PeerPool();
  pool.setLocalCharacterId('me');
  pool.upsert('me', 1, 1, 'plaza', 0);
  assert.equal(pool.has('me'), false);
  pool.applySnapshot([
    { characterId: 'me', x: 1, y: 1, zone: 'plaza', tsMs: 0 },
    { characterId: 'p1', x: 5, y: 5, zone: 'plaza', tsMs: 0 },
  ]);
  assert.equal(pool.has('me'), false);
  assert.equal(pool.has('p1'), true);
});

test('peer pool: setLocalCharacterId removes local peer if already tracked', () => {
  const pool = new PeerPool();
  pool.upsert('me', 1, 1, 'plaza', 0);
  assert.equal(pool.has('me'), true);
  pool.setLocalCharacterId('me');
  assert.equal(pool.has('me'), false);
});

test('peer pool: forEachRendered visits each peer exactly once', () => {
  const pool = new PeerPool();
  pool.upsert('a', 0, 0, 'plaza', 0);
  pool.upsert('a', 10, 10, 'plaza', 1000);
  pool.upsert('b', 100, 100, 'plaza', 0);
  pool.upsert('b', 200, 200, 'plaza', 1000);
  const visited: Array<{ id: string; x: number; y: number }> = [];
  pool.forEachRendered(500, 0, (v) => {
    visited.push({ id: v.characterId, x: v.x, y: v.y });
  });
  assert.equal(visited.length, 2);
  const a = visited.find((p) => p.id === 'a');
  const b = visited.find((p) => p.id === 'b');
  assert.ok(a && approxEq(a.x, 5) && approxEq(a.y, 5));
  assert.ok(b && approxEq(b.x, 150) && approxEq(b.y, 150));
});

// ===== MockMultiplayerBridge =====

test('mock bridge: connect/disconnect/status', () => {
  const b = new MockMultiplayerBridge();
  assert.equal(b.status(), 'idle');
  b.connect();
  assert.equal(b.status(), 'connected');
  b.disconnect();
  assert.equal(b.status(), 'closed');
});

test('mock bridge: enqueueIncoming + pollMessages drains FIFO', () => {
  const b = new MockMultiplayerBridge();
  b.connect();
  const messages: PresenceMessage[] = [
    { kind: 'snapshot', peers: [] },
    { kind: 'update', characterId: 'p1', x: 0, y: 0, zone: 'plaza', tsMs: 0 },
    { kind: 'depart', characterId: 'p1' },
  ];
  b.enqueueIncomingAll(messages);
  assert.equal(b.pendingIncoming(), 3);
  const drained = b.pollMessages();
  assert.equal(drained.length, 3);
  assert.equal(drained[0]!.kind, 'snapshot');
  assert.equal(drained[1]!.kind, 'update');
  assert.equal(drained[2]!.kind, 'depart');
  assert.equal(b.pollMessages().length, 0);
  assert.equal(b.stats().messagesReceived, 3);
});

test('mock bridge: rate limit caps broadcastPosition to BROADCAST_HZ', () => {
  // Inject a wall clock that advances 0.1 ms per call. 100 calls span
  // ~10ms - well under the 100 ms / call rate-limit bucket - so only
  // the first call should be admitted.
  let nowMs = 0;
  const b = new MockMultiplayerBridge({ nowMs: () => nowMs });
  b.connect();
  for (let i = 0; i < 100; i++) {
    b.broadcastPosition(i, i, 'plaza', i);
    nowMs += 0.1;
  }
  assert.equal(b.stats().messagesSent, 1);
  assert.equal(b.stats().rateLimitedDrops, 99);
});

test('mock bridge: 100 calls over 1 simulated second send at most BROADCAST_HZ', () => {
  // Spread 100 calls evenly across exactly 1000 ms. Rate limit allows
  // BROADCAST_HZ (10) - one per 100 ms bucket.
  let nowMs = 0;
  const b = new MockMultiplayerBridge({ nowMs: () => nowMs });
  b.connect();
  for (let i = 0; i < 100; i++) {
    b.broadcastPosition(i, i, 'plaza', i);
    nowMs += 10;   // 10 ms apart -> 100 calls in 1 sec
  }
  assert.ok(b.stats().messagesSent <= BROADCAST_HZ + 1);
  assert.ok(b.stats().messagesSent >= BROADCAST_HZ - 1);
  assert.equal(b.stats().messagesSent + b.stats().rateLimitedDrops, 100);
});

test('mock bridge: broadcastPosition captures sent payloads', () => {
  let nowMs = 0;
  const b = new MockMultiplayerBridge({ nowMs: () => nowMs });
  b.connect();
  b.broadcastPosition(1, 2, 'plaza', 1000);
  nowMs += BROADCAST_MIN_INTERVAL_MS + 1;
  b.broadcastPosition(3, 4, 'plaza', 2000);
  const sent = b.getSentBroadcasts();
  assert.equal(sent.length, 2);
  assert.equal(sent[0]!.x, 1);
  assert.equal(sent[0]!.y, 2);
  assert.equal(sent[0]!.tsMs, 1000);
  assert.equal(sent[1]!.x, 3);
  assert.equal(sent[1]!.y, 4);
  assert.equal(sent[1]!.tsMs, 2000);
});

// ===== PeerPresenceSystem (end-to-end) =====

function setupWorld(): { world: World; bridge: MockMultiplayerBridge; pool: PeerPool; device: FakeDevice } {
  const world = new World();
  const bridge = new MockMultiplayerBridge({ nowMs: () => 0 });
  const pool = new PeerPool();
  const device = new FakeDevice();
  world.resources.set(RESOURCE_MULTIPLAYER_BRIDGE, bridge);
  world.resources.set(RESOURCE_PEER_POOL, pool);
  world.resources.set(RESOURCE_DEVICE, device);
  world.resources.set(RESOURCE_CAMERA, makeCamera());
  world.resources.set(RESOURCE_TIME, createTimeResource());
  bridge.connect();
  return { world, bridge, pool, device };
}

test('peer presence system: drains snapshot into pool', () => {
  const { world, bridge, pool } = setupWorld();
  bridge.enqueueIncoming({
    kind: 'snapshot',
    peers: [
      { characterId: 'p1', x: 1, y: 2, zone: 'plaza', tsMs: 0, name: 'Alice' },
      { characterId: 'p2', x: 3, y: 4, zone: 'plaza', tsMs: 0 },
    ],
  });
  world.addSystem(new PeerPresenceSystem(), SYSTEM_PHASE_INPUT);
  world.update(1 / 60);
  assert.equal(pool.size(), 2);
  assert.equal(pool.get('p1')?.name, 'Alice');
});

test('peer presence system: drains update into pool', () => {
  const { world, bridge, pool } = setupWorld();
  bridge.enqueueIncoming({ kind: 'update', characterId: 'p1', x: 5, y: 6, zone: 'plaza', tsMs: 0 });
  world.addSystem(new PeerPresenceSystem(), SYSTEM_PHASE_INPUT);
  world.update(1 / 60);
  assert.equal(pool.has('p1'), true);
  assert.equal(pool.get('p1')?.currentX, 5);
});

test('peer presence system: drains depart and removes peer', () => {
  const { world, bridge, pool } = setupWorld();
  pool.upsert('p1', 0, 0, 'plaza', 0);
  bridge.enqueueIncoming({ kind: 'depart', characterId: 'p1' });
  world.addSystem(new PeerPresenceSystem(), SYSTEM_PHASE_INPUT);
  world.update(1 / 60);
  assert.equal(pool.has('p1'), false);
});

test('peer presence system: cold-connect snapshot materializes all peers', () => {
  const { world, bridge, pool } = setupWorld();
  bridge.enqueueIncoming({
    kind: 'snapshot',
    peers: [
      { characterId: 'p1', x: 0, y: 0, zone: 'plaza', tsMs: 0 },
      { characterId: 'p2', x: 1, y: 1, zone: 'plaza', tsMs: 0 },
      { characterId: 'p3', x: 2, y: 2, zone: 'plaza', tsMs: 0 },
    ],
  });
  world.addSystem(new PeerPresenceSystem(), SYSTEM_PHASE_INPUT);
  world.update(1 / 60);
  assert.equal(pool.size(), 3);
});

// ===== PeerRenderSystem =====

test('peer render system: submits one drawSprite per peer + name label', () => {
  const { world, pool, device } = setupWorld();
  pool.upsert('p1', 10, 20, 'plaza', 0, 'Alice');
  pool.upsert('p2', 30, 40, 'plaza', 0, 'Bob');
  // PeerSpritePool is a component pool, not a resource.
  const sprites = new PeerSpritePool({ defaultAtlas: 0, defaultFrame: 7 });
  world.registerPool(POOL_PEER_SPRITE, sprites);
  world.addSystem(new PeerRenderSystem(), SYSTEM_PHASE_RENDER);
  device.beginFrame();
  world.update(1 / 60);
  // 2 sprites + 2 name labels = 4 draw calls.
  assert.equal(device.drawCalls.length, 4);
  const sprites2d = device.drawCalls.filter((c) => c.kind === 'sprite');
  const texts = device.drawCalls.filter((c) => c.kind === 'text');
  assert.equal(sprites2d.length, 2);
  assert.equal(texts.length, 2);
  assert.ok(sprites2d.every((c) => c.frame === 7));
  assert.ok(texts.some((c) => c.text === 'Alice'));
  assert.ok(texts.some((c) => c.text === 'Bob'));
});

test('peer render system: skips name label when name is null', () => {
  const { world, pool, device } = setupWorld();
  pool.upsert('p1', 10, 20, 'plaza', 0);   // no name
  const sprites = new PeerSpritePool({ defaultAtlas: 0 });
  world.registerPool(POOL_PEER_SPRITE, sprites);
  world.addSystem(new PeerRenderSystem(), SYSTEM_PHASE_RENDER);
  device.beginFrame();
  world.update(1 / 60);
  assert.equal(device.drawCalls.filter((c) => c.kind === 'sprite').length, 1);
  assert.equal(device.drawCalls.filter((c) => c.kind === 'text').length, 0);
});

test('peer render system: per-peer sprite override replaces default', () => {
  const { world, pool, device } = setupWorld();
  pool.upsert('p1', 10, 20, 'plaza', 0);
  const sprites = new PeerSpritePool({ defaultAtlas: 0, defaultFrame: 0 });
  sprites.setOverride('p1', { atlas: 0, frame: 99, tint: null });
  world.registerPool(POOL_PEER_SPRITE, sprites);
  world.addSystem(new PeerRenderSystem(), SYSTEM_PHASE_RENDER);
  device.beginFrame();
  world.update(1 / 60);
  const sprite = device.drawCalls.find((c) => c.kind === 'sprite');
  assert.ok(sprite);
  assert.equal(sprite!.frame, 99);
});
