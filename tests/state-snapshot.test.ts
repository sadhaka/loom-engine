// Loom Engine - deterministic binary state snapshot tests.
//
// Covers the SnapshotWriter / SnapshotReader byte primitives, the
// FNV-1a hash, and the StateSnapshot orchestrator round-tripping the
// two real ISnapshotable parts shipped so far (EntityAllocator,
// Entropy) plus a fixture pool that stands in for "pool flags +
// typed-array slices".

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  SnapshotWriter,
  SnapshotReader,
  StateSnapshot,
  fnv1a32,
  STATE_SNAPSHOT_VERSION,
  type ISnapshotable,
  EntityAllocator,
  entityIndex,
  createEntropy,
  NULL_ENTITY,
  TransformPool,
  SpritePool,
  HealthPool,
  PursuePool,
  RangedAttackPool,
  ParticleEmitterPool,
  ParticlePool,
  ProjectilePool,
  InteractablePool,
  AnimationStatePool,
  type SpriteSheetManifest,
  World,
  RESOURCE_ENTROPY,
  isSnapshotable,
} from '../src/index.js';

// A stand-in component pool: exactly the shape the dossier names -
// "pool flags + typed-array slices" - so the test proves ISnapshotable
// handles a real pool layout without coupling to a production pool.
class MockSnapshotablePool implements ISnapshotable {
  readonly snapshotKey: string = 'test.mock-pool';
  flags: Uint8Array = new Uint8Array(8);
  x: Float32Array = new Float32Array(8);
  hp: Uint32Array = new Uint32Array(8);
  highWaterMark: number = 0;

  snapshotInto(w: SnapshotWriter): void {
    w.writeU32(this.highWaterMark);
    w.writeU8Slice(this.flags, this.highWaterMark);
    w.writeF32Slice(this.x, this.highWaterMark);
    w.writeU32Slice(this.hp, this.highWaterMark);
  }

  restoreFrom(r: SnapshotReader): void {
    this.highWaterMark = r.readU32();
    const f = r.readU8Slice();
    const x = r.readF32Slice();
    const hp = r.readU32Slice();
    this.flags = new Uint8Array(Math.max(8, f.length));
    this.flags.set(f);
    this.x = new Float32Array(Math.max(8, x.length));
    this.x.set(x);
    this.hp = new Uint32Array(Math.max(8, hp.length));
    this.hp.set(hp);
  }
}

// ----- SnapshotWriter / SnapshotReader -----

test('snapshot writer/reader: every scalar round-trips little-endian', () => {
  const w = new SnapshotWriter();
  w.writeU8(0xab);
  w.writeU16(0xbeef);
  w.writeU32(0xdeadbeef);
  w.writeI32(-12345);
  w.writeF32(1.5);
  w.writeF64(Math.PI);

  const r = new SnapshotReader(w.bytes().slice());
  assert.equal(r.readU8(), 0xab);
  assert.equal(r.readU16(), 0xbeef);
  assert.equal(r.readU32(), 0xdeadbeef);
  assert.equal(r.readI32(), -12345);
  assert.equal(r.readF32(), 1.5);
  assert.equal(r.readF64(), Math.PI);
  assert.equal(r.remaining, 0);
});

test('snapshot writer/reader: typed-array slices round-trip', () => {
  const w = new SnapshotWriter();
  const u8 = new Uint8Array([1, 2, 3, 4, 5]);
  const u32 = new Uint32Array([10, 0xffffffff, 30]);
  const f32 = new Float32Array([0.25, -8, 100.5]);
  // Write only a prefix of an over-allocated array, like a real pool
  // serializing [0, highWaterMark).
  const padded = new Uint8Array(16);
  padded.set([9, 8, 7]);
  w.writeU8Slice(u8, u8.length);
  w.writeU32Slice(u32, u32.length);
  w.writeF32Slice(f32, f32.length);
  w.writeU8Slice(padded, 3);

  const r = new SnapshotReader(w.bytes().slice());
  assert.deepEqual(Array.from(r.readU8Slice()), [1, 2, 3, 4, 5]);
  assert.deepEqual(Array.from(r.readU32Slice()), [10, 0xffffffff, 30]);
  assert.deepEqual(Array.from(r.readF32Slice()), [0.25, -8, 100.5]);
  assert.deepEqual(Array.from(r.readU8Slice()), [9, 8, 7]);
  assert.equal(r.remaining, 0);
});

test('snapshot writer: grows past initial capacity, content survives', () => {
  const w = new SnapshotWriter(16);
  for (let i = 0; i < 50; i++) w.writeU32(i * 7);
  assert.equal(w.length, 200);
  const r = new SnapshotReader(w.bytes().slice());
  for (let i = 0; i < 50; i++) assert.equal(r.readU32(), i * 7);
});

test('snapshot writer: reset reuses the buffer', () => {
  const w = new SnapshotWriter();
  w.writeU32(1);
  w.writeU32(2);
  assert.equal(w.length, 8);
  w.reset();
  assert.equal(w.length, 0);
  w.writeU8(42);
  assert.equal(w.length, 1);
  assert.equal(new SnapshotReader(w.bytes().slice()).readU8(), 42);
});

test('snapshot reader: an over-read throws instead of returning garbage', () => {
  const r = new SnapshotReader(new Uint8Array(2));
  r.readU8();
  assert.throws(() => r.readU32(), /over-read/);
});

test('snapshot writer/reader: UTF-8 strings round-trip, including non-ASCII', () => {
  const w = new SnapshotWriter();
  // Thai + Russian: the non-Latin scripts the engine actually ships
  // copy in, so the snapshot must survive multi-byte UTF-8.
  const thai = 'สวัสดี';
  const russian = 'Привет';
  const astral = 'a\u{1F9F5}b';   // a 4-byte UTF-8 codepoint
  w.writeString('');                  // empty string
  w.writeString('Talk to Misha Dev'); // pure ASCII
  w.writeString(thai);
  w.writeString(russian);
  w.writeString(astral);
  w.writeString('npc');               // a kind tag

  const r = new SnapshotReader(w.bytes().slice());
  assert.equal(r.readString(), '');
  assert.equal(r.readString(), 'Talk to Misha Dev');
  assert.equal(r.readString(), thai);
  assert.equal(r.readString(), russian);
  assert.equal(r.readString(), astral);
  assert.equal(r.readString(), 'npc');
  assert.equal(r.remaining, 0, 'byte-length prefix accounting is exact');
});

test('snapshot reader: readString rejects malformed UTF-8 instead of decoding garbage', () => {
  const w = new SnapshotWriter();
  w.writeU32(2);     // claims a 2-byte string...
  w.writeU8(0xff);   // ...but 0xff 0xfe is not a valid UTF-8 sequence
  w.writeU8(0xfe);
  const r = new SnapshotReader(w.bytes().slice());
  assert.throws(() => r.readString());
});

// ----- FNV-1a -----

test('fnv1a32: empty input is the offset basis', () => {
  // No bytes mixed -> the hash is exactly the FNV offset basis.
  assert.equal(fnv1a32(new Uint8Array(0)), 0x811c9dc5);
});

test('fnv1a32: deterministic and sensitive to content, order, length', () => {
  const a = new Uint8Array([1, 2, 3, 4]);
  const same = new Uint8Array([1, 2, 3, 4]);
  const flipped = new Uint8Array([1, 2, 3, 5]);   // one byte differs
  const reordered = new Uint8Array([1, 2, 4, 3]); // same bytes, swapped
  const longer = new Uint8Array([1, 2, 3, 4, 0]); // trailing zero added

  assert.equal(fnv1a32(a), fnv1a32(same), 'identical bytes hash identically');
  assert.notEqual(fnv1a32(a), fnv1a32(flipped), 'one changed byte changes the hash');
  assert.notEqual(fnv1a32(a), fnv1a32(reordered), 'byte order changes the hash');
  assert.notEqual(fnv1a32(a), fnv1a32(longer), 'length changes the hash');
  // Offset / length window is honoured.
  assert.equal(fnv1a32(longer, 0, 4), fnv1a32(a));
});

// ----- EntityAllocator as ISnapshotable -----

test('entity allocator: snapshot/restore reproduces a recycled-slot history', () => {
  // Build a non-trivial allocator state: live slots, a bumped
  // generation, and a populated free list.
  const a = new EntityAllocator();
  const h1 = a.create();
  const h2 = a.create();
  const h3 = a.create();
  a.destroy(h2);                       // h2's slot -> free list, gen bumped
  a.destroyByLiveIndex(entityIndex(h3));
  const h4 = a.create();               // recycles a freed slot

  const w = new SnapshotWriter();
  a.snapshotInto(w);
  const bytes = w.bytes().slice();

  // Restore into a fresh allocator.
  const b = new EntityAllocator();
  b.restoreFrom(new SnapshotReader(bytes));

  // Observable state matches.
  assert.equal(b.count(), a.count());
  assert.equal(b.capacity(), a.capacity());
  assert.equal(b.isAlive(h1), a.isAlive(h1));
  assert.equal(b.isAlive(h2), a.isAlive(h2));
  assert.equal(b.isAlive(h3), a.isAlive(h3));
  assert.equal(b.isAlive(h4), a.isAlive(h4));

  // And behaviour matches: the next creates / destroys move in
  // lockstep, which can only happen if the free list + generations
  // were restored exactly.
  assert.equal(b.create(), a.create());
  assert.equal(b.create(), a.create());
  const x = a.create();
  const y = b.create();
  assert.equal(y, x);
  assert.equal(b.destroy(x), a.destroy(x));
  assert.equal(b.count(), a.count());
});

// ----- Entropy as ISnapshotable -----

test('entropy: snapshot/restore resumes the stream exactly', () => {
  const e = createEntropy(0x12345);
  for (let i = 0; i < 17; i++) e.random();   // advance to a non-trivial state

  const w = new SnapshotWriter();
  e.snapshotInto(w);
  const bytes = w.bytes().slice();

  // Record the next 8 draws from the live stream.
  const expected: number[] = [];
  for (let i = 0; i < 8; i++) expected.push(e.random());

  // A fresh entropy restored from the snapshot must produce the same
  // 8 draws.
  const restored = createEntropy(0);
  restored.restoreFrom(new SnapshotReader(bytes));
  for (let i = 0; i < 8; i++) {
    assert.equal(restored.random(), expected[i], 'draw ' + i + ' diverged');
  }
});

// ----- MockSnapshotablePool: flags + typed-array slices -----

test('mock pool: flags + typed-array slices round-trip', () => {
  const p = new MockSnapshotablePool();
  p.highWaterMark = 5;
  p.flags.set([1, 0, 3, 0, 7]);
  p.x.set([1.5, 2.5, -3.5, 0, 9.25]);
  p.hp.set([100, 0, 4294967295, 1, 50]);

  const w = new SnapshotWriter();
  p.snapshotInto(w);

  const q = new MockSnapshotablePool();
  q.restoreFrom(new SnapshotReader(w.bytes().slice()));

  assert.equal(q.highWaterMark, 5);
  assert.deepEqual(Array.from(q.flags.subarray(0, 5)), [1, 0, 3, 0, 7]);
  assert.deepEqual(Array.from(q.x.subarray(0, 5)), [1.5, 2.5, -3.5, 0, 9.25]);
  assert.deepEqual(Array.from(q.hp.subarray(0, 5)), [100, 0, 4294967295, 1, 50]);
});

// ----- StateSnapshot orchestrator -----

function buildWorld(seed: number, creates: number, destroyEvery: number): {
  alloc: EntityAllocator;
  entropy: ReturnType<typeof createEntropy>;
  pool: MockSnapshotablePool;
  snap: StateSnapshot;
} {
  const alloc = new EntityAllocator();
  const entropy = createEntropy(seed);
  const pool = new MockSnapshotablePool();
  const handles: number[] = [];
  for (let i = 0; i < creates; i++) {
    handles.push(alloc.create());
    if (i % destroyEvery === destroyEvery - 1 && handles.length > 0) {
      alloc.destroy(handles.shift()!);
    }
    entropy.random();
  }
  pool.highWaterMark = Math.min(8, creates);
  for (let i = 0; i < pool.highWaterMark; i++) {
    pool.flags[i] = i & 0xff;
    pool.x[i] = i * 1.25;
    pool.hp[i] = i * 1000;
  }
  const snap = new StateSnapshot();
  snap.register(alloc);
  snap.register(entropy);
  snap.register(pool);
  return { alloc, entropy, pool, snap };
}

test('state snapshot: serialize -> restore -> re-serialize is byte-identical', () => {
  const a = buildWorld(99, 40, 4);
  const bytesA = a.snap.serialize().slice();

  // Fresh, empty parts; restore the frame into them.
  const b = buildWorld(1, 0, 1);   // different seed, no history
  b.snap.restore(bytesA);
  const bytesB = b.snap.serialize().slice();

  assert.deepEqual(Array.from(bytesB), Array.from(bytesA),
    'restoring then re-serializing must reproduce the exact frame');
});

test('state snapshot: hash is stable for identical state, diverges on mutation', () => {
  const a = buildWorld(0xC0FFEE, 30, 3);
  const b = buildWorld(0xC0FFEE, 30, 3);
  assert.equal(a.snap.hash(), b.snap.hash(),
    'identical construction must hash identically');

  // Mutate one entity in world B - one extra allocation.
  b.alloc.create();
  assert.notEqual(a.snap.hash(), b.snap.hash(),
    'a single extra entity must change the hash');
});

test('state snapshot: STATE_SNAPSHOT_VERSION is a stable constant', () => {
  assert.equal(STATE_SNAPSHOT_VERSION, 1);
});

test('state snapshot: register rejects a duplicate snapshotKey', () => {
  const snap = new StateSnapshot();
  snap.register(new MockSnapshotablePool());
  assert.throws(() => snap.register(new MockSnapshotablePool()), /duplicate snapshotKey/);
});

test('state snapshot: restore rejects bad magic and a part-count mismatch', () => {
  const snap = new StateSnapshot();
  snap.register(new EntityAllocator());
  // 20 zero bytes -> magic reads as 0.
  assert.throws(() => snap.restore(new Uint8Array(20)), /bad magic/);

  // A valid 1-part frame restored into a 2-part snapshot.
  const oneFrame = (() => {
    const s = new StateSnapshot();
    s.register(new EntityAllocator());
    return s.serialize().slice();
  })();
  const twoPart = new StateSnapshot();
  twoPart.register(new EntityAllocator());
  twoPart.register(new MockSnapshotablePool());
  assert.throws(() => twoPart.restore(oneFrame), /1 parts, 2 registered/);
});

test('state snapshot: restore rejects a part that under-reads its blob', () => {
  // snapshotInto writes 8 bytes; restoreFrom only consumes 4. The
  // blob-length frame catches the 4 leftover bytes.
  const lazy: ISnapshotable = {
    snapshotKey: 'test.lazy',
    snapshotInto(w: SnapshotWriter): void { w.writeU32(1); w.writeU32(2); },
    restoreFrom(r: SnapshotReader): void { r.readU32(); },
  };
  const snap = new StateSnapshot();
  snap.register(lazy);
  const bytes = snap.serialize().slice();
  assert.throws(() => snap.restore(bytes), /left 4 of 8 bytes unconsumed/);
});

// ----- Component pools as ISnapshotable -----

// A minimal sprite-sheet manifest for exercising AnimationStatePool.
// The manifest is intentionally outside the snapshot, so its only
// role here is to give play() an object ref to store.
function makeAnimManifest(name: string): SpriteSheetManifest {
  return {
    name,
    image: name + '.png',
    frames: [{ x: 0, y: 0, w: 16, h: 16 }, { x: 16, y: 0, w: 16, h: 16 }],
    anchor: { x: 8, y: 16 },
    fps: 8,
    clips: [{ name: 'walk', frames: [0, 1], loop: true }],
  };
}

// Build one of every snapshotable pool, populated with non-trivial
// state (varied columns, set flags, recycled free-list slots), plus
// the allocator + entropy - all registered into a StateSnapshot in a
// fixed order.
function buildPopulated() {
  const alloc = new EntityAllocator();
  const entropy = createEntropy(0x5151);
  const transform = new TransformPool();
  const sprite = new SpritePool();
  const health = new HealthPool();
  const pursue = new PursuePool();
  const ranged = new RangedAttackPool();
  const emitter = new ParticleEmitterPool();
  const particles = new ParticlePool();
  const projectiles = new ProjectilePool();
  const interactable = new InteractablePool();
  const animation = new AnimationStatePool();

  // Entities with a recycle history.
  const e: number[] = [];
  for (let i = 0; i < 6; i++) e.push(alloc.create());
  alloc.destroy(e[1]!);
  alloc.destroyByLiveIndex(entityIndex(e[3]!));
  const e6 = alloc.create();   // recycles a freed slot
  for (let i = 0; i < 20; i++) entropy.random();

  const color = { r: 0.8, g: 0.4, b: 0.2, a: 1 };
  const color2 = { r: 0.1, g: 0.2, b: 0.3, a: 0 };

  transform.attach(e[0]!, 1.5, -2.25, 0.5);
  transform.attach(e[2]!, 10, 20, 30);
  transform.attach(e6, -5, -5, 0);
  transform.setRotation(e[2]!, 1.5707);
  transform.setScale(e[0]!, 2, 3);

  sprite.attach(e[0]!, 7, 2, color);
  sprite.attach(e[2]!, 3, 0);
  sprite.setFrame(e[2]!, 5);

  health.attach(e[0]!, 100);
  health.attach(e[2]!, 50);
  health.attach(e6, 30);
  health.applyDamage(e[2]!, 17, 1234);

  pursue.attach(e[2]!, e[0]!, 1.5, 0.5, 4, 1000);
  pursue.attach(e6, e[0]!, 2, 0.25);

  ranged.attach(e[0]!, {
    target: e[2]!, range: 6, minRange: 1, cooldownMs: 800, damage: 12,
    projectileSpeed: 7, projectileLife: 2, projectileSize: 4,
    projectileColor: color, homing: true,
  });

  emitter.attach(e[0]!, {
    rate: 30, particleLife: 1.5, speedMin: 1, speedMax: 4,
    dirX: 0, dirY: -1, dirZ: 0, coneRadians: 0.3,
    ax: 0, ay: 9.8, az: 0, startSize: 4, endSize: 1,
    startColor: color, endColor: color2, additive: true,
  });
  emitter.burst(e[0]!, 12);

  // Free-list history in the vfx pools: spawn, kill some, spawn again.
  for (let i = 0; i < 5; i++) {
    particles.spawn({ x: i, y: i * 2, z: 0, life: 1 + i, color });
  }
  particles.kill(1);
  particles.kill(3);
  particles.spawn({ x: 99, y: 99, z: 0, life: 0.5, color: color2, additive: true });

  for (let i = 0; i < 4; i++) {
    projectiles.spawn({
      x: i, y: 0, z: 0, vx: 1, vy: 0, vz: 0, life: 3, damage: 5 + i,
      ownerEntity: e[0]!, targetEntity: i % 2 === 0 ? e[2]! : NULL_ENTITY,
      size: 5, color, homing: i % 2 === 0,
    });
  }
  projectiles.kill(2);

  interactable.attach(e[0]!, { kind: 'npc', prompt: 'Greet the Architect', payload: 'dlg.architect', radius: 1.5 });
  interactable.attach(e[4]!, { kind: 'portal', prompt: 'เข้าสู่ Iron Reach', payload: 'zone.iron-reach', radius: 0.5 });
  interactable.attach(e[5]!, { kind: 'lore', prompt: 'Читать', payload: 'lore.01', radius: 2 });
  interactable.detach(e[4]!);   // flags-cleared slot inside the high-water mark

  animation.play(e[0]!, makeAnimManifest('knight-walk'), 'walk', { startMs: 90 });
  animation.play(e[2]!, makeAnimManifest('goblin-idle'), 'idle');
  animation.play(e6, makeAnimManifest('knight-walk'), 'attack');
  animation.stop(e[2]!);   // flags-cleared slot inside the high-water mark

  const snap = new StateSnapshot();
  snap.register(alloc);
  snap.register(entropy);
  snap.register(transform);
  snap.register(sprite);
  snap.register(health);
  snap.register(pursue);
  snap.register(ranged);
  snap.register(emitter);
  snap.register(particles);
  snap.register(projectiles);
  snap.register(interactable);
  snap.register(animation);

  return { alloc, entropy, transform, sprite, health, pursue, ranged, emitter, particles, projectiles, interactable, animation, snap };
}

function buildEmpty(): StateSnapshot {
  const snap = new StateSnapshot();
  snap.register(new EntityAllocator());
  snap.register(createEntropy(0));
  snap.register(new TransformPool());
  snap.register(new SpritePool());
  snap.register(new HealthPool());
  snap.register(new PursuePool());
  snap.register(new RangedAttackPool());
  snap.register(new ParticleEmitterPool());
  snap.register(new ParticlePool());
  snap.register(new ProjectilePool());
  snap.register(new InteractablePool());
  snap.register(new AnimationStatePool());
  return snap;
}

test('component pools: every pool round-trips through StateSnapshot byte-identically', () => {
  const a = buildPopulated();
  const bytesA = a.snap.serialize().slice();

  const empty = buildEmpty();
  empty.restore(bytesA);
  const bytesB = empty.serialize().slice();

  assert.equal(empty.partCount, 12, 'allocator + entropy + 10 pools registered');
  assert.deepEqual(Array.from(bytesB), Array.from(bytesA),
    'restore -> re-serialize must reproduce the exact frame for all 12 parts');
});

test('component pools: hash diverges when any pool column is mutated', () => {
  const a = buildPopulated();
  const b = buildPopulated();
  assert.equal(a.snap.hash(), b.snap.hash(), 'identical builds hash identically');

  // Nudge a single Float32 in a single pool of world B.
  b.transform.x[0] = (b.transform.x[0] ?? 0) + 0.0001;
  assert.notEqual(a.snap.hash(), b.snap.hash(),
    'a one-field change in one pool must change the world hash');
});

test('component pools: Int32 sentinel columns round-trip (-1 stays -1)', () => {
  // TransformPool.parent and SpritePool.atlas hold -1 sentinels; the
  // I32 slice path must preserve the sign, not wrap it to 0xffffffff.
  const alloc = new EntityAllocator();
  const e0 = alloc.create();
  const e1 = alloc.create();

  const t = new TransformPool();
  t.attach(e0, 0, 0, 0);
  t.attach(e1, 0, 0, 0);   // parent defaults to -1
  const tw = new SnapshotWriter();
  t.snapshotInto(tw);
  const t2 = new TransformPool();
  t2.restoreFrom(new SnapshotReader(tw.bytes().slice()));
  assert.equal(t2.parent[entityIndex(e0)], -1);
  assert.equal(t2.parent[entityIndex(e1)], -1);

  const s = new SpritePool();
  s.attach(e0, 4, 1);
  s.attach(e1, 9, 2);
  s.detach(e0);            // atlas[e0] -> -1, still within highWaterMark
  const sw = new SnapshotWriter();
  s.snapshotInto(sw);
  const s2 = new SpritePool();
  s2.restoreFrom(new SnapshotReader(sw.bytes().slice()));
  assert.equal(s2.atlas[entityIndex(e0)], -1, 'detached atlas -1 survives');
  assert.equal(s2.atlas[entityIndex(e1)], 9);
});

test('component pools: ParticlePool free-list + live count survive a round-trip', () => {
  const p = new ParticlePool();
  const color = { r: 1, g: 1, b: 1, a: 1 };
  for (let i = 0; i < 6; i++) p.spawn({ x: i, y: 0, z: 0, life: 1, color });
  p.kill(2);
  p.kill(4);
  assert.equal(p.getLiveCount(), 4);

  const w = new SnapshotWriter();
  p.snapshotInto(w);
  const q = new ParticlePool();
  q.restoreFrom(new SnapshotReader(w.bytes().slice()));

  assert.equal(q.getLiveCount(), 4);
  assert.equal(q.getHighWaterMark(), p.getHighWaterMark());
  assert.equal(q.isAlive(2), false, 'killed slot stays killed');
  assert.equal(q.isAlive(4), false);
  assert.equal(q.isAlive(0), true, 'live slot stays live');
  // The restored free list must hand recycled slots back on spawn.
  const slot = q.spawn({ x: 0, y: 0, z: 0, life: 1, color });
  assert.ok(slot === 2 || slot === 4, 'spawn recycles a freed slot, got ' + slot);
});

test('component pools: InteractablePool round-trips kind/prompt/payload + radius + flags', () => {
  const alloc = new EntityAllocator();
  const e0 = alloc.create();
  const e1 = alloc.create();
  const e2 = alloc.create();
  const e3 = alloc.create();

  const p = new InteractablePool();
  p.attach(e0, { kind: 'npc', prompt: 'Talk to Misha Dev', payload: 'dlg.misha.intro', radius: 1.5 });
  // Non-ASCII prompts: the string columns must survive UTF-8, not the
  // ASCII-truncating writeKey path.
  p.attach(e1, { kind: 'portal', prompt: 'เข้าสู่ Iron Reach', payload: 'zone.iron-reach', radius: 0.75 });
  p.attach(e2, { kind: 'lore', prompt: 'Читать камень', payload: 'lore.stone.01', radius: 2 });
  p.attach(e3, { kind: 'item', prompt: 'Pick up', payload: 'item.shard', radius: 0.5 });
  p.detach(e2);   // a flags-cleared slot inside the high-water mark

  const w = new SnapshotWriter();
  p.snapshotInto(w);
  const q = new InteractablePool();
  q.restoreFrom(new SnapshotReader(w.bytes().slice()));

  assert.equal(q.getHighWaterMark(), p.getHighWaterMark());
  for (const e of [e0, e1, e2, e3]) {
    const i = entityIndex(e);
    assert.equal(q.getKind(e), p.getKind(e), 'kind at ' + i);
    assert.equal(q.getPrompt(e), p.getPrompt(e), 'prompt at ' + i);
    assert.equal(q.getPayload(e), p.getPayload(e), 'payload at ' + i);
    assert.equal(q.radius[i], p.radius[i], 'radius at ' + i);
    assert.equal(q.isActive(e), p.isActive(e), 'active flag at ' + i);
  }
  // detach() clears the flag but leaves the cold string columns - the
  // round-trip must preserve exactly that.
  assert.equal(q.isActive(e2), false, 'detached slot stays detached');
  assert.equal(q.getPayload(e2), 'lore.stone.01', 'detached slot keeps its cold columns');
  assert.equal(q.isActive(e0), true, 'attached slot stays active');
});

test('component pools: AnimationStatePool round-trips elapsedMs/clipName/flags; manifest is excluded', () => {
  const alloc = new EntityAllocator();
  const e0 = alloc.create();
  const e1 = alloc.create();
  const e2 = alloc.create();

  const p = new AnimationStatePool();
  p.play(e0, makeAnimManifest('knight-walk'), 'walk', { startMs: 120 });
  p.play(e1, makeAnimManifest('goblin-attack'), 'attack', { startMs: 0 });
  p.play(e2, makeAnimManifest('knight-walk'), 'idle');
  p.stop(e1);   // flags-cleared slot inside the high-water mark

  const w = new SnapshotWriter();
  p.snapshotInto(w);
  const q = new AnimationStatePool();
  q.restoreFrom(new SnapshotReader(w.bytes().slice()));

  assert.equal(q.getHighWaterMark(), p.getHighWaterMark());
  for (const e of [e0, e1, e2]) {
    const i = entityIndex(e);
    assert.equal(q.elapsedMs[i], p.elapsedMs[i], 'elapsedMs at ' + i);
    assert.equal(q.getClipName(e), p.getClipName(e), 'clipName at ' + i);
    assert.equal(q.isActive(e), p.isActive(e), 'active flag at ' + i);
    assert.equal(q.isFinished(e), p.isFinished(e), 'finished flag at ' + i);
  }
  assert.equal(q.isActive(e1), false, 'stopped slot stays stopped');
  assert.equal(q.isActive(e0), true, 'playing slot stays active');
  // The manifest is deliberately outside the snapshot - a restored
  // pool has null manifests regardless of what was playing.
  assert.equal(q.getManifest(e0), null, 'restore does not rebind the manifest');
  assert.equal(q.getManifest(e2), null);
});

// ----- isSnapshotable + World.snapshotState -----

test('isSnapshotable: duck-types ISnapshotable parts', () => {
  assert.equal(isSnapshotable(new EntityAllocator()), true);
  assert.equal(isSnapshotable(createEntropy(1)), true);
  assert.equal(isSnapshotable(new TransformPool()), true);
  assert.equal(isSnapshotable({ notAPart: true }), false);
  assert.equal(isSnapshotable(null), false);
  assert.equal(isSnapshotable(42), false);
  // Has the keys but wrong member types.
  assert.equal(isSnapshotable({ snapshotKey: 'x', snapshotInto: 1, restoreFrom: 2 }), false);
});

// Builds a World with two snapshotable pools + a seeded entropy
// resource + 8 entities carrying transform + health state.
function makeTestWorld(seed: number) {
  const w = new World();
  const transform = new TransformPool();
  const health = new HealthPool();
  const entropy = createEntropy(seed);
  w.registerPool('transform', transform);
  w.registerPool('health', health);
  w.resources.set(RESOURCE_ENTROPY, entropy);
  for (let i = 0; i < 8; i++) {
    const e = w.createEntity();
    transform.attach(e, i, i * 2, 0);
    health.attach(e, 100 - i);
  }
  return { w, transform, health, entropy };
}

// One tick of deterministic, seeded-entropy-driven mutation - stands
// in for a real simulation system advancing pool state.
function jitterTick(
  transform: TransformPool,
  entropy: { random(): number },
  count: number,
): void {
  for (let i = 1; i <= count; i++) {
    transform.x[i] = (transform.x[i] ?? 0) + entropy.random();
    transform.y[i] = (transform.y[i] ?? 0) - entropy.random();
  }
}

test('world snapshotState: collects the allocator, snapshotable pools, and snapshotable resources', () => {
  const w = new World();
  w.registerPool('transform', new TransformPool());     // ISnapshotable
  w.registerPool('health', new HealthPool());           // ISnapshotable
  w.registerPool('plain', { notAPool: true });          // skipped
  w.resources.set(RESOURCE_ENTROPY, createEntropy(1));  // ISnapshotable
  w.resources.set('misc', { value: 42 });               // skipped

  // allocator + transform + health + entropy = 4; the plain pool and
  // misc resource are not snapshotable and are not registered.
  assert.equal(w.snapshotState().partCount, 4);
});

test('world snapshotState: hash is deterministic and catches state drift', () => {
  const a = makeTestWorld(77);
  const b = makeTestWorld(77);
  assert.equal(a.w.snapshotState().hash(), b.w.snapshotState().hash(),
    'identically-built worlds hash identically');

  // Mutate one entity's health in world B.
  b.health.applyDamage(b.w.entityAt(1), 5, 0);
  assert.notEqual(a.w.snapshotState().hash(), b.w.snapshotState().hash(),
    'a single applyDamage must change the world hash');
});

test('world determinism: per-tick hash sequences match identical runs, diverge on a different seed', () => {
  function run(seed: number): number[] {
    const { w, transform, entropy } = makeTestWorld(seed);
    const snap = w.snapshotState();          // build once after setup
    const hashes: number[] = [];
    for (let tick = 0; tick < 20; tick++) {
      jitterTick(transform, entropy, 8);
      hashes.push(snap.hash());              // hash every tick
    }
    return hashes;
  }
  const a = run(0xABCD);
  const b = run(0xABCD);
  assert.deepEqual(a, b, 'same seed must produce an identical per-tick hash sequence');
  const c = run(0x1234);
  assert.notDeepEqual(c, a, 'a different seed must diverge the hash sequence');
});

test('world snapshotState: serialize -> restore -> re-serialize is byte-identical', () => {
  const a = makeTestWorld(0xBEEF);
  for (let t = 0; t < 5; t++) jitterTick(a.transform, a.entropy, 8);
  const bytesA = a.w.snapshotState().serialize().slice();

  // A different world (different seed + state); restore overwrites it.
  const b = makeTestWorld(0x9999);
  const bSnap = b.w.snapshotState();
  bSnap.restore(bytesA);
  const bytesB = bSnap.serialize().slice();

  assert.deepEqual(Array.from(bytesB), Array.from(bytesA));
});
