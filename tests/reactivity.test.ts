// Phase 0.77.0 - Reactivity tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  Reactivity,
  RESOURCE_REACTIVITY,
} from '../src/index.js';

test('reactivity: RESOURCE_REACTIVITY is the stable string', () => {
  assert.equal(RESOURCE_REACTIVITY, 'reactivity');
});

test('reactivity: signal get + set + peek', () => {
  const rx = Reactivity.create();
  const s = rx.signal(10);
  assert.equal(s.get(), 10);
  assert.equal(s.peek(), 10);
  s.set(20);
  assert.equal(s.get(), 20);
});

test('reactivity: effect runs on creation + on signal write', () => {
  const rx = Reactivity.create();
  const s = rx.signal(0);
  const log: number[] = [];
  rx.effect(() => { log.push(s.get()); });
  assert.deepEqual(log, [0]);
  s.set(1);
  assert.deepEqual(log, [0, 1]);
  s.set(2);
  assert.deepEqual(log, [0, 1, 2]);
});

test('reactivity: setting same value (Object.is) does not fire effect', () => {
  const rx = Reactivity.create();
  const s = rx.signal(5);
  let fires = 0;
  rx.effect(() => { void s.get(); fires++; });
  assert.equal(fires, 1);
  s.set(5);
  assert.equal(fires, 1);
  s.set(6);
  assert.equal(fires, 2);
});

test('reactivity: peek does NOT subscribe', () => {
  const rx = Reactivity.create();
  const s = rx.signal(0);
  let fires = 0;
  rx.effect(() => { void s.peek(); fires++; });
  assert.equal(fires, 1);
  s.set(1);
  assert.equal(fires, 1);
});

test('reactivity: untrack does NOT subscribe', () => {
  const rx = Reactivity.create();
  const s = rx.signal(0);
  let fires = 0;
  rx.effect(() => {
    rx.untrack(() => s.get());
    fires++;
  });
  assert.equal(fires, 1);
  s.set(99);
  assert.equal(fires, 1);
});

test('reactivity: computed derives from signals', () => {
  const rx = Reactivity.create();
  const a = rx.signal(2);
  const b = rx.signal(3);
  const sum = rx.computed(() => a.get() + b.get());
  assert.equal(sum.get(), 5);
  a.set(10);
  assert.equal(sum.get(), 13);
  b.set(20);
  assert.equal(sum.get(), 30);
});

test('reactivity: computed propagates to effects', () => {
  const rx = Reactivity.create();
  const a = rx.signal(1);
  const doubled = rx.computed(() => a.get() * 2);
  const log: number[] = [];
  rx.effect(() => log.push(doubled.get()));
  assert.deepEqual(log, [2]);
  a.set(5);
  assert.deepEqual(log, [2, 10]);
});

test('reactivity: chained computeds propagate transitively', () => {
  const rx = Reactivity.create();
  const a = rx.signal(1);
  const b = rx.computed(() => a.get() + 1);
  const c = rx.computed(() => b.get() * 2);
  assert.equal(c.get(), 4);
  a.set(10);
  assert.equal(c.get(), 22);
});

test('reactivity: computed with no change in value does not fire downstream', () => {
  const rx = Reactivity.create();
  const a = rx.signal(0);
  const isPos = rx.computed(() => a.get() > 0);
  let fires = 0;
  rx.effect(() => { void isPos.get(); fires++; });
  assert.equal(fires, 1);
  a.set(5);  // becomes true
  assert.equal(fires, 2);
  a.set(10); // still true; isPos unchanged
  assert.equal(fires, 2);
  a.set(0);  // false
  assert.equal(fires, 3);
});

test('reactivity: dynamic dependency tracking - new deps after rerun', () => {
  const rx = Reactivity.create();
  const cond = rx.signal(true);
  const a = rx.signal(1);
  const b = rx.signal(100);
  const log: number[] = [];
  rx.effect(() => {
    log.push(cond.get() ? a.get() : b.get());
  });
  assert.deepEqual(log, [1]);
  // Switch to depend on b instead.
  cond.set(false);
  // After this, the effect ran once with cond=false; logged b's value.
  assert.deepEqual(log, [1, 100]);
  // a no longer affects the effect.
  a.set(999);
  assert.deepEqual(log, [1, 100]);
  // b does now affect it.
  b.set(200);
  assert.deepEqual(log, [1, 100, 200]);
});

test('reactivity: effect.dispose stops re-runs', () => {
  const rx = Reactivity.create();
  const s = rx.signal(0);
  let fires = 0;
  const eff = rx.effect(() => { void s.get(); fires++; });
  s.set(1);
  assert.equal(fires, 2);
  eff.dispose();
  assert.ok(eff.isDisposed());
  s.set(2);
  assert.equal(fires, 2);
});

test('reactivity: computed.dispose stops recomputing + downstream effects stop seeing changes', () => {
  const rx = Reactivity.create();
  const s = rx.signal(0);
  const c = rx.computed(() => s.get() * 10);
  const log: number[] = [];
  rx.effect(() => log.push(c.get()));
  assert.deepEqual(log, [0]);
  s.set(1);
  assert.deepEqual(log, [0, 10]);
  c.dispose();
  s.set(99);
  // computed no longer recomputed; effect still sees old value (10)
  // and won't be re-triggered because computed source no longer
  // notifies. So no change.
  assert.deepEqual(log, [0, 10]);
});

test('reactivity: batch coalesces multiple writes', () => {
  const rx = Reactivity.create();
  const a = rx.signal(0);
  const b = rx.signal(0);
  let fires = 0;
  rx.effect(() => {
    void a.get();
    void b.get();
    fires++;
  });
  assert.equal(fires, 1);
  rx.batch(() => {
    a.set(1);
    b.set(2);
    a.set(3);
  });
  // Single re-run after the batch.
  assert.equal(fires, 2);
});

test('reactivity: nested batches flush at outermost', () => {
  const rx = Reactivity.create();
  const s = rx.signal(0);
  let fires = 0;
  rx.effect(() => { void s.get(); fires++; });
  rx.batch(() => {
    rx.batch(() => {
      s.set(1);
      s.set(2);
    });
    // Inner batch did not flush yet.
    assert.equal(fires, 1);
  });
  // Outer flush.
  assert.equal(fires, 2);
});

test('reactivity: multiple effects on the same signal all fire', () => {
  const rx = Reactivity.create();
  const s = rx.signal(0);
  let a = 0, b = 0, c = 0;
  rx.effect(() => { void s.get(); a++; });
  rx.effect(() => { void s.get(); b++; });
  rx.effect(() => { void s.get(); c++; });
  s.set(1);
  assert.equal(a, 2);
  assert.equal(b, 2);
  assert.equal(c, 2);
});

test('reactivity: throwing effect body is isolated', () => {
  const rx = Reactivity.create();
  const s = rx.signal(0);
  let fires = 0;
  rx.effect(() => { void s.get(); throw new Error('boom'); });
  // Should not throw.
  assert.doesNotThrow(() => s.set(1));
  // We don't enforce a fire count semantic here - just no propagation.
  void fires;
});

test('reactivity: throwing computed body keeps prior value', () => {
  const rx = Reactivity.create();
  const s = rx.signal(1);
  const c = rx.computed(() => {
    if (s.get() === 0) throw new Error('zero!');
    return s.get() * 2;
  });
  assert.equal(c.get(), 2);
  s.set(0);
  // Body threw - prior value retained.
  assert.equal(c.get(), 2);
  s.set(5);
  assert.equal(c.get(), 10);
});

test('reactivity: custom equals controls change detection', () => {
  const rx = Reactivity.create({
    equals: (a, b) => Math.floor(a as number) === Math.floor(b as number),
  });
  const s = rx.signal(1.0);
  let fires = 0;
  rx.effect(() => { void s.get(); fires++; });
  s.set(1.4); // floor still 1 - no fire
  assert.equal(fires, 1);
  s.set(2.0); // floor changed
  assert.equal(fires, 2);
});

test('reactivity: dispose tears down everything', () => {
  const rx = Reactivity.create();
  const s = rx.signal(0);
  let fires = 0;
  rx.effect(() => { void s.get(); fires++; });
  rx.dispose();
  s.set(1);
  // No fire after dispose.
  assert.equal(fires, 1);
});

test('reactivity: realistic HUD binding (hp / max -> percentage label)', () => {
  const rx = Reactivity.create();
  const hp = rx.signal(100);
  const max = rx.signal(100);
  const pct = rx.computed(() => Math.round((hp.get() / max.get()) * 100));
  const labels: string[] = [];
  rx.effect(() => {
    labels.push(pct.get() + '%');
  });
  assert.deepEqual(labels, ['100%']);
  hp.set(50);
  assert.deepEqual(labels, ['100%', '50%']);
  max.set(200); // hp 50 / max 200 = 25%
  assert.deepEqual(labels, ['100%', '50%', '25%']);
});

test('reactivity: write to signal while inside effect is supported (stability)', () => {
  const rx = Reactivity.create();
  const a = rx.signal(0);
  const b = rx.signal(0);
  // Effect that reads a and writes b.
  rx.effect(() => {
    b.set(a.get() * 2);
  });
  assert.equal(b.peek(), 0);
  a.set(5);
  assert.equal(b.peek(), 10);
});
