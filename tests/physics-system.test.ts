// Loom Engine - PhysicsSystem (2D AABB collision primitive) tests.
//
// Covers the ColliderHandle helpers, constructor validation, the
// spawn / recycle lifecycle with generation-validated handles, the
// position / velocity setters, integrate(), syncGrid() and its
// grid-contract guards, and the Codex gates:
//   gate 1 - resolve() re-reads positions fresh (the stale-ax/ay test
//            asserts exact post-resolve coordinates that only hold if
//            each pair sees the prior pair's moves).
//   gate 2 - detect() refuses a stale broadphase (positions moved
//            since syncGrid(), grid epoch changed, or a different grid).
//   gate 3 - exercised implicitly: detect() only uses SpatialGrid's
//            public API, so cross-cell-boundary detection working
//            proves the public-API broadphase is correct.
//   gate 4 - dense-collision benchmarks with exact contact counts
//            (K coincident -> K*(K-1)/2; a 4x4 king lattice -> 42).
//   gate 5 - vacuous (no Euclidean distance computed); the AABB
//            overlap + min-translation behaviour tests confirm it.
//   gate 6 - single ownership: the contact buffer overflow throws
//            rather than corrupting, and clear() fully resets.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  PhysicsSystem,
  makeColliderHandle,
  colliderSlot,
  colliderGeneration,
  SpatialGrid,
} from '../src/index.js';

// Build a PhysicsSystem with `n` unit colliders (halfW = halfH = 1) all
// coincident at the origin, plus a grid, synced and detected. Every
// pair overlaps, so the contact buffer holds n*(n-1)/2 pairs.
function makeCoincident(n: number): { ps: PhysicsSystem; grid: SpatialGrid } {
  const ps = new PhysicsSystem(Math.max(n, 1), 4096);
  const grid = new SpatialGrid(4, 8, 8, Math.max(n, 1));
  for (let s = 0; s < n; s++) ps.spawn(s, 0, 0, 1, 1);
  ps.syncGrid(grid);
  ps.detect(grid);
  return { ps, grid };
}

test('physics system: ColliderHandle packs and unpacks slot + generation', () => {
  for (const [slot, gen] of [[0, 0], [5, 1], [12345, 200], [0x00ffffff, 0xff]] as const) {
    const h = makeColliderHandle(slot, gen);
    assert.equal(colliderSlot(h), slot, 'slot ' + slot);
    assert.equal(colliderGeneration(h), gen, 'gen ' + gen);
  }
});

test('physics system: constructor validates capacity and maxContacts', () => {
  const ps = new PhysicsSystem(64, 256);
  assert.equal(ps.capacity, 64);
  assert.equal(ps.maxContacts, 256);
  assert.equal(ps.getActiveColliderCount(), 0);
  assert.equal(ps.getContactCount(), 0);
  assert.throws(() => new PhysicsSystem(0, 256), /capacity/);
  assert.throws(() => new PhysicsSystem(-1, 256), /capacity/);
  assert.throws(() => new PhysicsSystem(2.5, 256), /capacity/);
  assert.throws(() => new PhysicsSystem((1 << 18) + 1, 256), /capacity/);
  assert.throws(() => new PhysicsSystem(64, 0), /maxContacts/);
  assert.throws(() => new PhysicsSystem(64, 2.5), /maxContacts/);
  assert.throws(() => new PhysicsSystem(64, (1 << 22) + 1), /maxContacts/);
});

test('physics system: spawn / isAlive / isStatic / getters', () => {
  const ps = new PhysicsSystem(16, 64);
  const h = ps.spawn(3, 10, 20, 2, 4, 1, -1);
  assert.equal(ps.isAlive(h), true);
  assert.equal(ps.isStatic(h), false);
  assert.equal(ps.getX(h), 10);
  assert.equal(ps.getY(h), 20);
  assert.equal(ps.getHalfW(h), 2);
  assert.equal(ps.getHalfH(h), 4);
  assert.equal(ps.getVelX(h), 1);
  assert.equal(ps.getVelY(h), -1);
  assert.equal(ps.getActiveColliderCount(), 1);
  // A static collider.
  const s = ps.spawn(4, 0, 0, 1, 1, 0, 0, true);
  assert.equal(ps.isStatic(s), true);
  assert.equal(ps.getActiveColliderCount(), 2);
  // Spawning into an occupied slot throws.
  assert.throws(() => ps.spawn(3, 0, 0, 1, 1), /already active/);
  // A never-spawned handle is not alive; reads return NaN.
  const ghost = makeColliderHandle(7, 0);
  assert.equal(ps.isAlive(ghost), false);
  assert.equal(ps.isStatic(ghost), false);
  assert.ok(Number.isNaN(ps.getX(ghost)));
  assert.ok(Number.isNaN(ps.getVelY(ghost)));
});

test('physics system: spawn rejects malformed arguments', () => {
  const ps = new PhysicsSystem(8, 64);
  assert.throws(() => ps.spawn(-1, 0, 0, 1, 1), /slot/);
  assert.throws(() => ps.spawn(8, 0, 0, 1, 1), /slot/);
  assert.throws(() => ps.spawn(1.5, 0, 0, 1, 1), /slot/);
  assert.throws(() => ps.spawn(0, NaN, 0, 1, 1), /finite/);
  assert.throws(() => ps.spawn(0, 0, Infinity, 1, 1), /finite/);
  assert.throws(() => ps.spawn(0, 0, 0, 0, 1), /positive finite/);
  assert.throws(() => ps.spawn(0, 0, 0, -1, 1), /positive finite/);
  assert.throws(() => ps.spawn(0, 0, 0, 1, NaN), /positive finite/);
  assert.throws(() => ps.spawn(0, 0, 0, 1, 1, NaN, 0), /vx . vy/);
});

test('physics system: recycle frees the slot and invalidates the old handle', () => {
  const ps = new PhysicsSystem(8, 64);
  const h = ps.spawn(0, 5, 5, 1, 1);
  assert.equal(ps.recycle(h), true);
  assert.equal(ps.isAlive(h), false, 'the recycled handle is dead');
  assert.equal(ps.getActiveColliderCount(), 0);
  assert.ok(Number.isNaN(ps.getX(h)), 'a dead handle reads NaN');
  assert.equal(ps.recycle(h), false, 'recycling a dead handle is a no-op');
  // Re-spawning the slot gives a fresh handle; the old one stays dead.
  const h2 = ps.spawn(0, 1, 2, 1, 1);
  assert.notEqual(h2, h, 'generation bumped, so the handle differs');
  assert.equal(ps.isAlive(h2), true);
  assert.equal(ps.isAlive(h), false);
  assert.equal(ps.getX(h2), 1);
});

test('physics system: setPosition / setVelocity update live colliders only', () => {
  const ps = new PhysicsSystem(8, 64);
  const h = ps.spawn(0, 0, 0, 1, 1);
  assert.equal(ps.setPosition(h, 7, 8), true);
  assert.equal(ps.getX(h), 7);
  assert.equal(ps.getY(h), 8);
  assert.equal(ps.setVelocity(h, -2, 3), true);
  assert.equal(ps.getVelX(h), -2);
  assert.equal(ps.getVelY(h), 3);
  // Non-finite arguments throw.
  assert.throws(() => ps.setPosition(h, NaN, 0), /finite/);
  assert.throws(() => ps.setVelocity(h, 0, Infinity), /finite/);
  // A stale handle is a silent no-op (returns false).
  ps.recycle(h);
  assert.equal(ps.setPosition(h, 1, 1), false);
  assert.equal(ps.setVelocity(h, 1, 1), false);
});

test('physics system: integrate projects dynamic colliders, leaves statics', () => {
  const ps = new PhysicsSystem(8, 64);
  const dyn = ps.spawn(0, 0, 0, 1, 1, 2, -3);
  const sta = ps.spawn(1, 5, 5, 1, 1, 1, 1, true);
  ps.integrate(0.5);
  assert.equal(ps.getX(dyn), 1, 'dynamic: x += vx * dt');
  assert.equal(ps.getY(dyn), -1.5, 'dynamic: y += vy * dt');
  assert.equal(ps.getX(sta), 5, 'static colliders are never integrated');
  assert.equal(ps.getY(sta), 5);
  // dt must be a finite number >= 0.
  assert.throws(() => ps.integrate(-1), /dt/);
  assert.throws(() => ps.integrate(NaN), /dt/);
  assert.doesNotThrow(() => ps.integrate(0), 'dt 0 is a valid paused frame');
});

test('physics system: syncGrid enforces the grid-capacity and cell-size contract', () => {
  const ps = new PhysicsSystem(10, 64);
  ps.spawn(0, 0, 0, 1, 1);
  // grid.maxEntities must cover every collider slot.
  assert.throws(() => ps.syncGrid(new SpatialGrid(4, 8, 8, 5)), /maxEntities/);
  // grid.cellSize must be >= the largest collider full extent.
  const big = new PhysicsSystem(10, 64);
  big.spawn(0, 0, 0, 3, 1);   // full width 6
  assert.throws(() => big.syncGrid(new SpatialGrid(4, 8, 8, 10)), /cellSize/);
  // A grid that satisfies both is accepted.
  assert.doesNotThrow(() => ps.syncGrid(new SpatialGrid(4, 8, 8, 10)));
});

test('physics system: detect refuses a stale broadphase (gate 2)', () => {
  const ps = new PhysicsSystem(8, 64);
  const grid = new SpatialGrid(4, 8, 8, 8);
  const h = ps.spawn(0, 0, 0, 1, 1);
  ps.spawn(1, 0.5, 0, 1, 1);
  // spawn() dirtied positions - detect() before syncGrid() throws.
  assert.throws(() => ps.detect(grid), /syncGrid/);
  ps.syncGrid(grid);
  assert.doesNotThrow(() => ps.detect(grid), 'a fresh sync makes detect() valid');
  // detect() is read-only - calling it again is still valid.
  assert.doesNotThrow(() => ps.detect(grid));
  // Moving a collider dirties the broadphase again.
  ps.setPosition(h, 2, 2);
  assert.throws(() => ps.detect(grid), /syncGrid/);
  // A grid mutated by anyone else fails the epoch check.
  ps.syncGrid(grid);
  grid.insert(7, 0);
  assert.throws(() => ps.detect(grid), /grid was modified/);
  // Passing a different grid than syncGrid() last built also fails.
  ps.syncGrid(grid);
  assert.throws(() => ps.detect(new SpatialGrid(4, 8, 8, 8)), /grid was modified/);
});

test('physics system: detect finds overlapping pairs, skips disjoint ones', () => {
  const ps = new PhysicsSystem(8, 64);
  const grid = new SpatialGrid(4, 8, 8, 8);
  // Three unit colliders in a row: 0-1 and 1-2 overlap, 0-2 do not.
  ps.spawn(0, 0, 0, 0.6, 0.6);
  ps.spawn(1, 1, 0, 0.6, 0.6);
  ps.spawn(2, 2, 0, 0.6, 0.6);
  ps.syncGrid(grid);
  assert.equal(ps.detect(grid), 2);
  // Contacts are emitted with contactA < contactB, each pair once.
  const pairs = [
    [ps.getContactA(0), ps.getContactB(0)],
    [ps.getContactA(1), ps.getContactB(1)],
  ];
  assert.deepEqual(pairs, [[0, 1], [1, 2]]);
  // Pull the far colliders apart - now nothing overlaps.
  ps.setPosition(makeColliderHandle(1, 0), 10, 10);
  ps.syncGrid(grid);
  assert.equal(ps.detect(grid), 0);
});

test('physics system: detect spans cell boundaries (public-API broadphase, gate 3)', () => {
  const ps = new PhysicsSystem(8, 64);
  const grid = new SpatialGrid(2, 8, 8, 8);
  // Two unit colliders that overlap but sit in different grid cells:
  // (1.5,1) is in cell col 0, (2.5,1) is in cell col 1.
  ps.spawn(0, 1.5, 1, 1, 1);
  ps.spawn(1, 2.5, 1, 1, 1);
  ps.syncGrid(grid);
  assert.equal(ps.detect(grid), 1, 'the 3x3 block finds the cross-cell pair');
});

test('physics system: dense benchmark - K coincident colliders give K*(K-1)/2 contacts (gate 4)', () => {
  for (const k of [2, 3, 10, 25]) {
    const { ps } = makeCoincident(k);
    assert.equal(ps.getContactCount(), (k * (k - 1)) / 2, k + ' coincident colliders');
  }
});

test('physics system: dense benchmark - a 4x4 king lattice gives 42 contacts (gate 4)', () => {
  // 16 colliders on a unit lattice, half-extent 0.6: every collider
  // overlaps its 8 king-move neighbours (spacing 1 < 1.2 = sum of
  // half-extents) but nothing 2 cells away (2 > 1.2). Edge count of a
  // 4x4 king graph: 2*(N-1)*(2N-1) = 2*3*7 = 42.
  const ps = new PhysicsSystem(16, 256);
  const grid = new SpatialGrid(2, 6, 6, 16);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      ps.spawn(row * 4 + col, 1 + col, 1 + row, 0.6, 0.6);
    }
  }
  ps.syncGrid(grid);
  assert.equal(ps.detect(grid), 42);
});

test('physics system: detect throws when the contact buffer overflows (gate 6)', () => {
  const ps = new PhysicsSystem(10, 2);   // room for only 2 contacts
  const grid = new SpatialGrid(4, 8, 8, 10);
  for (let s = 0; s < 4; s++) ps.spawn(s, 0, 0, 1, 1);   // 6 pairs
  ps.syncGrid(grid);
  assert.throws(() => ps.detect(grid), /contact buffer full/);
});

test('physics system: resolve pushes two dynamic colliders symmetrically apart', () => {
  const ps = new PhysicsSystem(8, 64);
  const grid = new SpatialGrid(4, 8, 8, 8);
  const a = ps.spawn(0, 0, 0, 1, 1);
  const b = ps.spawn(1, 1, 0, 1, 1);   // overlap 1 on x, 2 on y -> push on x
  ps.syncGrid(grid);
  assert.equal(ps.detect(grid), 1);
  assert.equal(ps.resolve(1), 1, 'one push applied');
  // Overlap on x was 1; split 50/50 -> each moves 0.5 along x.
  assert.equal(ps.getX(a), -0.5);
  assert.equal(ps.getX(b), 1.5);
  assert.equal(ps.getY(a), 0, 'y is untouched - x was the min-penetration axis');
  assert.equal(ps.getY(b), 0);
  // They are now exactly touching, not overlapping.
  ps.syncGrid(grid);
  assert.equal(ps.detect(grid), 0);
});

test('physics system: resolve never moves STATIC colliders', () => {
  // Static A vs dynamic B: only B moves.
  const ps1 = new PhysicsSystem(8, 64);
  const g1 = new SpatialGrid(4, 8, 8, 8);
  const sa = ps1.spawn(0, 0, 0, 1, 1, 0, 0, true);
  const db = ps1.spawn(1, 1, 0, 1, 1);
  ps1.syncGrid(g1);
  ps1.detect(g1);
  ps1.resolve(1);
  assert.equal(ps1.getX(sa), 0, 'static A stays put');
  assert.equal(ps1.getX(db), 2, 'dynamic B absorbs the whole 1.0 correction');
  // Dynamic A vs static B: only A moves (exercises the other branch).
  const ps2 = new PhysicsSystem(8, 64);
  const g2 = new SpatialGrid(4, 8, 8, 8);
  const da = ps2.spawn(0, 0, 0, 1, 1);
  const sb = ps2.spawn(1, 1, 0, 1, 1, 0, 0, true);
  ps2.syncGrid(g2);
  ps2.detect(g2);
  ps2.resolve(1);
  assert.equal(ps2.getX(da), -1, 'dynamic A absorbs the whole correction');
  assert.equal(ps2.getX(sb), 1, 'static B stays put');
  // Two statics that overlap cannot be separated - resolve is a no-op.
  const ps3 = new PhysicsSystem(8, 64);
  const g3 = new SpatialGrid(4, 8, 8, 8);
  const s1 = ps3.spawn(0, 0, 0, 1, 1, 0, 0, true);
  const s2 = ps3.spawn(1, 1, 0, 1, 1, 0, 0, true);
  ps3.syncGrid(g3);
  ps3.detect(g3);
  assert.equal(ps3.resolve(1), 0, 'two statics: no push applied');
  assert.equal(ps3.getX(s1), 0);
  assert.equal(ps3.getX(s2), 1);
});

test('physics system: resolve pushes along the minimum-penetration axis', () => {
  // Overlap is small on x (0.5), large on y (1.5) -> push on x.
  const psx = new PhysicsSystem(8, 64);
  const gx = new SpatialGrid(4, 8, 8, 8);
  const ax = psx.spawn(0, 0, 0, 1, 1);
  const bx = psx.spawn(1, 1.5, 0.5, 1, 1);
  psx.syncGrid(gx);
  psx.detect(gx);
  psx.resolve(1);
  assert.equal(psx.getX(ax), -0.25);
  assert.equal(psx.getX(bx), 1.75);
  assert.equal(psx.getY(ax), 0, 'y untouched');
  assert.equal(psx.getY(bx), 0.5);
  // Overlap large on x (1.5), small on y (0.5) -> push on y.
  const psy = new PhysicsSystem(8, 64);
  const gy = new SpatialGrid(4, 8, 8, 8);
  const ay = psy.spawn(0, 0, 0, 1, 1);
  const by = psy.spawn(1, 0.5, 1.5, 1, 1);
  psy.syncGrid(gy);
  psy.detect(gy);
  psy.resolve(1);
  assert.equal(psy.getY(ay), -0.25);
  assert.equal(psy.getY(by), 1.75);
  assert.equal(psy.getX(ay), 0, 'x untouched');
  assert.equal(psy.getX(by), 0.5);
});

test('physics system: resolve re-reads positions fresh after each move (gate 1)', () => {
  // Three coincident unit colliders. detect() emits contacts in grid
  // order - the SpatialGrid cell chain is newest-first, so the pairs
  // come out (0,2), (0,1), (1,2). resolve(1) processes them in that
  // order and each pair must see the moves the earlier pairs applied.
  // The exact final coordinates below only hold if resolve() re-reads
  // posX/posY fresh per pair - a cached read (snapshotting all three
  // at (0,0) up front) would instead produce y = -1, -1, 1.
  const { ps } = makeCoincident(3);
  assert.equal(ps.resolve(1), 3, 'all three coincident pairs pushed');
  const h0 = makeColliderHandle(0, 0);
  const h1 = makeColliderHandle(1, 0);
  const h2 = makeColliderHandle(2, 0);
  // (0,2): tie -> y, half 1.0     -> c0.y=-1,    c2.y=1.
  // (0,1): c0.y now -1 -> overlapY 1, half 0.5  -> c0.y=-1.5, c1.y=0.5.
  // (1,2): c1.y=0.5, c2.y=1 -> overlapY 1.5, half 0.75 -> c1.y=-0.25,
  //        c2.y=1.75.
  assert.equal(ps.getY(h0), -1.5, 'collider 0 reflects both its pairs');
  assert.equal(ps.getY(h1), -0.25, 'collider 1 reflects the fresh read in (1,2)');
  assert.equal(ps.getY(h2), 1.75, 'collider 2 reflects the fresh read in (1,2)');
  assert.equal(ps.getX(h0), 0);
  assert.equal(ps.getX(h1), 0);
  assert.equal(ps.getX(h2), 0);
});

test('physics system: resolve relaxation iterations and validation', () => {
  // resolve() iterates the SAME contact set; a deep cluster needs more
  // than one pass, so more iterations apply strictly more pushes.
  const one = makeCoincident(3);
  const many = makeCoincident(3);
  assert.equal(one.ps.resolve(1), 3);
  assert.ok(many.ps.resolve(8) > 3, 'more iterations apply more push-aparts');
  // iterations must be an integer in [1, 64].
  const { ps } = makeCoincident(2);
  assert.throws(() => ps.resolve(0), /iterations/);
  assert.throws(() => ps.resolve(65), /iterations/);
  assert.throws(() => ps.resolve(1.5), /iterations/);
});

test('physics system: step runs integrate + syncGrid + detect + resolve', () => {
  const ps = new PhysicsSystem(8, 64);
  const grid = new SpatialGrid(4, 8, 8, 8);
  const a = ps.spawn(0, 0, 0, 1, 1, 1, 0);    // moving +x
  const b = ps.spawn(1, 3, 0, 1, 1, -1, 0);   // moving -x
  // dt 1: a -> (1,0), b -> (2,0); overlap 1 on x; split -> a -0.5, b +0.5.
  const stats = ps.step(1, grid);
  assert.equal(stats.contacts, 1);
  assert.equal(stats.resolved, 1);
  assert.equal(ps.getX(a), 0.5);
  assert.equal(ps.getX(b), 2.5);
  // step() left positions dirty (resolve moved them) - a bare detect()
  // now must throw until the next syncGrid().
  assert.throws(() => ps.detect(grid), /syncGrid/);
  // dt must be a finite number >= 0.
  assert.throws(() => ps.step(-1, grid), /dt/);
  assert.throws(() => ps.step(NaN, grid), /dt/);
});

test('physics system: getContactA / getContactB are bounds-checked', () => {
  const { ps } = makeCoincident(2);
  assert.equal(ps.getContactCount(), 1);
  assert.equal(ps.getContactA(0), 0);
  assert.equal(ps.getContactB(0), 1);
  assert.throws(() => ps.getContactA(1), /index/);
  assert.throws(() => ps.getContactA(-1), /index/);
  assert.throws(() => ps.getContactB(1.5), /index/);
});

test('physics system: clear resets to the constructed-but-empty state', () => {
  const { ps, grid } = makeCoincident(4);
  assert.equal(ps.getActiveColliderCount(), 4);
  assert.ok(ps.getContactCount() > 0);
  ps.clear();
  assert.equal(ps.getActiveColliderCount(), 0);
  assert.equal(ps.getContactCount(), 0);
  assert.equal(ps.isAlive(makeColliderHandle(0, 0)), false);
  // After clear() a slot can be spawned and the pipeline run again.
  ps.spawn(0, 0, 0, 1, 1);
  ps.spawn(1, 0.5, 0, 1, 1);
  ps.syncGrid(grid);
  assert.equal(ps.detect(grid), 1);
});

test('physics system: step is deterministic - identical runs match bit-for-bit', () => {
  function run(): number[] {
    const ps = new PhysicsSystem(12, 256);
    const grid = new SpatialGrid(4, 12, 12, 12);
    // A staggered cluster with assorted velocities.
    for (let s = 0; s < 9; s++) {
      const col = s % 3;
      const row = (s - col) / 3;
      ps.spawn(s, col * 0.7, row * 0.7, 1, 1, col - 1, row - 1);
    }
    for (let frame = 0; frame < 6; frame++) ps.step(0.25, grid, 4);
    const out: number[] = [];
    for (let s = 0; s < 9; s++) {
      const h = makeColliderHandle(s, 0);
      out.push(ps.getX(h), ps.getY(h));
    }
    return out;
  }
  assert.deepEqual(run(), run(), 'no RNG, no clock - the sim is fully reproducible');
});
