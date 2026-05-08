// Phase 0.21.0 - IManagedResource lifecycle hooks tests.
//
// Coverage: attach calls onAttach with bound world; detach calls
// onDetach + dispose; disposeAll iterates everything; world.dispose
// disposes resources + notifies systems via onDispose; legacy set/
// remove path bypasses the hooks (back-compat); errors in hooks are
// logged but never block the registry op.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { World } from '../src/world.js';
import { ResourceRegistry, type IManagedResource, type LifecycleWorld } from '../src/resources.js';
import { type System, SYSTEM_PHASE_LOGIC } from '../src/system.js';

// ----- Helpers -----

class TrackedResource implements IManagedResource {
  attached: number = 0;
  detached: number = 0;
  disposed: number = 0;
  attachedWith: LifecycleWorld | null = null;

  onAttach(world: LifecycleWorld): void {
    this.attached++;
    this.attachedWith = world;
  }

  onDetach(_world: LifecycleWorld): void {
    this.detached++;
  }

  dispose(): void {
    this.disposed++;
  }
}


// ----- Tests -----

test('lifecycle: attach calls onAttach with the bound world', function () {
  var w = new World();
  var r = new TrackedResource();
  w.resources.attach('r', r);
  assert.equal(r.attached, 1);
  assert.equal(r.detached, 0);
  assert.equal(r.disposed, 0);
  assert.equal(r.attachedWith, w);
});

test('lifecycle: detach calls onDetach + dispose then removes the row', function () {
  var w = new World();
  var r = new TrackedResource();
  w.resources.attach('r', r);
  var removed = w.resources.detach('r');
  assert.equal(removed, true);
  assert.equal(r.detached, 1);
  assert.equal(r.disposed, 1);
  assert.equal(w.resources.has('r'), false);
});

test('lifecycle: detach on missing key returns false; no hooks called', function () {
  var w = new World();
  var removed = w.resources.detach('does-not-exist');
  assert.equal(removed, false);
});

test('lifecycle: re-attach detaches the prior value first', function () {
  var w = new World();
  var first = new TrackedResource();
  var second = new TrackedResource();
  w.resources.attach('r', first);
  w.resources.attach('r', second);
  // First was detached + disposed before second's attach.
  assert.equal(first.detached, 1);
  assert.equal(first.disposed, 1);
  assert.equal(second.attached, 1);
  assert.equal(second.detached, 0);
});

test('lifecycle: legacy set() does NOT call onAttach (back-compat)', function () {
  var w = new World();
  var r = new TrackedResource();
  w.resources.set('r', r);
  assert.equal(r.attached, 0,
    'set() must not trigger onAttach (back-compat with pre-0.21 callers)');
  // The resource IS in the registry though.
  assert.equal(w.resources.get('r'), r);
});

test('lifecycle: legacy remove() does NOT call onDetach (back-compat)', function () {
  var w = new World();
  var r = new TrackedResource();
  // Use attach so onAttach fires once - then verify remove() does not.
  w.resources.attach('r', r);
  assert.equal(r.attached, 1);
  w.resources.remove('r');
  // remove() bypasses hooks. detach() is the lifecycle path.
  assert.equal(r.detached, 0,
    'remove() must not trigger onDetach (back-compat with pre-0.21 callers)');
});

test('lifecycle: disposeAll iterates every registered resource', function () {
  var w = new World();
  var a = new TrackedResource();
  var b = new TrackedResource();
  var c = new TrackedResource();
  w.resources.attach('a', a);
  w.resources.attach('b', b);
  w.resources.attach('c', c);
  w.resources.disposeAll();
  assert.equal(a.detached, 1);
  assert.equal(a.disposed, 1);
  assert.equal(b.detached, 1);
  assert.equal(b.disposed, 1);
  assert.equal(c.detached, 1);
  assert.equal(c.disposed, 1);
  // Registry empty after.
  assert.equal(w.resources.has('a'), false);
  assert.equal(w.resources.has('b'), false);
  assert.equal(w.resources.has('c'), false);
});

test('lifecycle: resources without IManagedResource methods skip silently', function () {
  var w = new World();
  // Plain object, no lifecycle methods. Must not throw.
  var plain = { count: 1 };
  w.resources.attach('plain', plain);
  assert.equal(w.resources.get('plain'), plain);
  var removed = w.resources.detach('plain');
  assert.equal(removed, true);
  assert.equal(w.resources.has('plain'), false);
});

test('lifecycle: errors in onAttach are logged but do NOT block registration', function () {
  var w = new World();
  var bad: IManagedResource = {
    onAttach() { throw new Error('intentional'); },
  };
  w.resources.attach('bad', bad);
  // Resource is still registered despite the throw.
  assert.equal(w.resources.has('bad'), true);
});

test('lifecycle: errors in onDetach do NOT block dispose() call', function () {
  var w = new World();
  var detachThrew = false;
  var disposed = 0;
  var weird: IManagedResource = {
    onDetach() { detachThrew = true; throw new Error('boom-detach'); },
    dispose() { disposed++; },
  };
  w.resources.attach('weird', weird);
  w.resources.detach('weird');
  assert.equal(detachThrew, true);
  assert.equal(disposed, 1, 'dispose() should still run after onDetach throws');
});

test('lifecycle: errors in dispose() do NOT block row removal', function () {
  var w = new World();
  var weird: IManagedResource = {
    dispose() { throw new Error('boom-dispose'); },
  };
  w.resources.attach('weird', weird);
  w.resources.detach('weird');
  assert.equal(w.resources.has('weird'), false,
    'dispose() throwing must still remove the row');
});

test('lifecycle: World.dispose disposes all resources + clears systems', function () {
  var w = new World();
  var r = new TrackedResource();
  w.resources.attach('r', r);

  var sysCallCount = 0;
  var sys: System & { onDispose?: (w: World) => void } = {
    update() { /* noop */ },
    onDispose(_w: World) { sysCallCount++; },
  };
  w.addSystem(sys, SYSTEM_PHASE_LOGIC);
  assert.equal(w.countSystems(), 1);

  w.dispose();

  assert.equal(r.detached, 1);
  assert.equal(r.disposed, 1);
  assert.equal(sysCallCount, 1, 'system onDispose should be called');
  assert.equal(w.countSystems(), 0, 'systems cleared after dispose()');
});

test('lifecycle: World.dispose is idempotent', function () {
  var w = new World();
  var r = new TrackedResource();
  w.resources.attach('r', r);
  w.dispose();
  // Second call should be a no-op (registry already empty).
  w.dispose();
  assert.equal(r.detached, 1, 'detach should fire exactly once');
  assert.equal(r.disposed, 1, 'dispose should fire exactly once');
});

test('lifecycle: standalone ResourceRegistry without bindWorld skips hooks', function () {
  // Construct a bare registry - no world binding. Lifecycle hooks
  // require a bound world; without one, attach should still register
  // but onAttach must NOT fire (no world to pass).
  var reg = new ResourceRegistry();
  var r = new TrackedResource();
  reg.attach('r', r);
  assert.equal(r.attached, 0,
    'unbound registry must not call onAttach - it has no world to pass');
  assert.equal(reg.get('r'), r,
    'attach must still register the row even when hooks are skipped');
});
