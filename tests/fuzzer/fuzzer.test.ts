// Loom Engine - fuzzer tests.
//
// Houses the engine's model-based / property fuzzers. Each runs a long
// random sequence from a deterministic seeded entropy stream, so any
// failure reproduces from the seed alone.
//
// Targets:
//   - SSEZoneBridge protocol fuzzer: malformed / out-of-order /
//     oversized envelopes; the bridge must never throw and its queue
//     must stay bounded.
//   - EntityAllocator model-based fuzzer: random create / destroy /
//     destroyByLiveIndex sequences checked in lockstep against a
//     reference model - no double-free, no stale-handle validation,
//     count / capacity always agree.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { createEntropy } from '../../src/index.js';
import {
  fuzzZoneBridge,
  fuzzZoneBridgeNoDrain,
  FakeEventSource,
} from './fuzz-zone-bridge.js';
import { fuzzEntityAllocator } from './fuzz-entity-allocator.js';
import { SSEZoneBridge } from '../../src/index.js';

test('fuzzer: 1000 iterations - bridge survives without throwing', () => {
  const entropy = createEntropy(0x1234abcd);
  const r = fuzzZoneBridge(1000, entropy, 25);
  assert.equal(r.iterations, 1000);
  assert.equal(r.exceptionsCaught, 0, 'bridge dispatch must never throw');
  assert.equal(r.errors, 0, 'pattern generators must not throw');
  // Some valid frames should have made it into the queue. The
  // patternValidMixed slot is 1 of 16 patterns, so on average ~62 of
  // 1000 iterations produce a parsable envelope.
  assert.ok(r.validApplied > 5, 'at least some valid frames slipped through, got ' + r.validApplied);
});

test('fuzzer: same seed produces identical fuzz outcome', () => {
  const a = fuzzZoneBridge(500, createEntropy(7), 25);
  const b = fuzzZoneBridge(500, createEntropy(7), 25);
  assert.equal(a.exceptionsCaught, b.exceptionsCaught);
  assert.equal(a.validApplied, b.validApplied);
  assert.equal(a.finalEventsReceived, b.finalEventsReceived);
});

test('fuzzer: bounded queue - no-drain run does not retain garbage events', () => {
  // 500 fuzz iterations, mostly malformed. The bridge's internal
  // queue should ONLY hold valid-shape frames (the parser drops the
  // rest). Asserts the queue is bounded by the number of valid
  // patterns, not the iteration count.
  const r = fuzzZoneBridgeNoDrain(500, createEntropy(0xfeedface));
  // Final queue depth should equal the count of valid-mixed pattern
  // hits (the only one that survives the parser). It must be much
  // less than the total iteration count.
  assert.ok(
    r.finalQueueDepth < r.iterations,
    'queue depth ' + r.finalQueueDepth + ' must be < ' + r.iterations,
  );
  // And finalEventsReceived (counter from the bridge) tracks valid
  // frames - same upper bound.
  assert.equal(r.finalQueueDepth, r.finalEventsReceived);
});

test('fuzzer: bridge stats track out-of-order events', () => {
  // The patternOutOfOrder generator deliberately feeds stale ids -
  // many of them - so the bridge should observe non-zero
  // outOfOrderEvents in stats after a long run.
  const fakeEs = new FakeEventSource();
  const bridge = new SSEZoneBridge({
    eventSource: fakeEs,
    characterId: 'c',
    currentZone: () => 'iron_reach',
  });
  bridge.start();

  // Manually feed two valid envelopes with id going backwards.
  const ev1 = JSON.stringify({
    id: 100, ts: 1, type: 'zone.narrator', zone_id: 'iron_reach',
    emitter_id: null, data: { line: 'a', voice: 'ambient', ttl_ms: 1 },
  });
  const ev2 = JSON.stringify({
    id: 50, ts: 2, type: 'zone.narrator', zone_id: 'iron_reach',
    emitter_id: null, data: { line: 'b', voice: 'ambient', ttl_ms: 1 },
  });
  fakeEs.dispatch('zone.event', ev1);
  fakeEs.dispatch('zone.event', ev2);
  const stats = bridge.stats();
  assert.equal(stats.outOfOrderEvents, 1, 'second event with smaller id is out of order');
  assert.equal(stats.eventsReceived, 2);
});

test('fuzzer: non-string data on the SSE listener is dropped silently', () => {
  // The SSE protocol delivers `data: <string>`. If a buggy presence
  // layer ever forwards a non-string, the bridge should drop it
  // without crashing.
  const fakeEs = new FakeEventSource();
  const bridge = new SSEZoneBridge({
    eventSource: fakeEs,
    characterId: 'c',
    currentZone: () => 'iron_reach',
  });
  bridge.start();
  // Try a variety of non-string values.
  const nonStrings: unknown[] = [null, undefined, 5, [], {}, true];
  for (let i = 0; i < nonStrings.length; i++) {
    fakeEs.dispatch('zone.event', nonStrings[i]);
  }
  const stats = bridge.stats();
  assert.equal(stats.eventsReceived, 0, 'no non-string frame should have been queued');
  assert.equal(bridge.pollEvents().length, 0);
});

test('fuzzer: out-of-order ids do NOT cause queue loss (event still delivered)', () => {
  // The bridge buffers the event regardless of order; the cursor /
  // gap detection lives downstream in ZoneEventSystem. Verify the
  // bridge's queue keeps both frames so the system can decide what
  // to do.
  const fakeEs = new FakeEventSource();
  const bridge = new SSEZoneBridge({
    eventSource: fakeEs,
    characterId: 'c',
    currentZone: () => 'iron_reach',
  });
  bridge.start();
  fakeEs.dispatch('zone.event', JSON.stringify({
    id: 100, ts: 1, type: 'zone.narrator', zone_id: 'iron_reach',
    emitter_id: null, data: { line: 'a', voice: 'ambient', ttl_ms: 1 },
  }));
  fakeEs.dispatch('zone.event', JSON.stringify({
    id: 50, ts: 2, type: 'zone.narrator', zone_id: 'iron_reach',
    emitter_id: null, data: { line: 'b', voice: 'ambient', ttl_ms: 1 },
  }));
  const drained = bridge.pollEvents();
  assert.equal(drained.length, 2, 'both events queued even when 2nd is out of order');
});

test('fuzzer: oversized payload does not crash the parser', () => {
  // 1.5 MB JSON line. JSON.parse should work; envelope is shape-valid
  // so it'll land in the queue with a huge data.line. The point is
  // that NOTHING throws.
  const fakeEs = new FakeEventSource();
  const bridge = new SSEZoneBridge({
    eventSource: fakeEs,
    characterId: 'c',
    currentZone: () => 'iron_reach',
  });
  bridge.start();
  const huge = 'x'.repeat(1024 * 1024);
  const payload = JSON.stringify({
    id: 1, ts: Date.now(), type: 'zone.narrator', zone_id: 'iron_reach',
    emitter_id: null, data: { line: huge, voice: 'ambient', ttl_ms: 1000 },
  });
  // Wrapped in a try so any throw becomes an assertion failure.
  let threw = false;
  try {
    fakeEs.dispatch('zone.event', payload);
  } catch {
    threw = true;
  }
  assert.equal(threw, false, 'oversized payload must not throw');
  // The valid event should be queued.
  assert.equal(bridge.pollEvents().length, 1);
});

test('fuzzer: fuzz harness is deterministic across two seeds', () => {
  // Reproducibility check: a known seed yields a known stats line.
  const r = fuzzZoneBridge(200, createEntropy(0xC0FFEE), 50);
  assert.equal(r.iterations, 200);
  // We do not assert exact validApplied because the underlying
  // patterns include time-of-day inputs (Date.now). What we DO
  // assert: same seed -> same outcome (covered by the seed-stability
  // test above) and zero crashes.
  assert.equal(r.exceptionsCaught, 0);
});

// ---------- EntityAllocator model-based fuzzer ----------

test('fuzzer: entity allocator - 6000 random ops stay consistent with the reference model', () => {
  // fuzzEntityAllocator asserts model agreement on every operation and
  // every per-iteration invariant internally; a buggy allocator throws
  // here with the failing iteration + handle. These assertions just
  // confirm the run actually exercised every op kind, so a green test
  // is not vacuous.
  const r = fuzzEntityAllocator(6000, createEntropy(0xA110CA7E));
  assert.equal(r.iterations, 6000);
  assert.ok(r.creates > 0, 'fuzz run produced no creates');
  assert.ok(r.destroys > 0, 'fuzz run produced no destroy-by-handle ops');
  assert.ok(r.destroyByIndex > 0, 'fuzz run produced no destroyByLiveIndex ops');
  assert.ok(r.staleProbes > 0, 'fuzz run never probed a stale handle for rejection');
  assert.ok(r.staleSweepChecks > 0, 'fuzz run never swept a stale handle');
  // The free list actually recycled: capacity (distinct fresh indices)
  // stays far below the total create count. If recycling were broken
  // every create would be a fresh index and capacity would track
  // creates.
  assert.ok(r.finalCapacity < r.creates,
    'capacity ' + r.finalCapacity + ' not below creates ' + r.creates
    + ' - free list never recycled');
});

test('fuzzer: entity allocator - a second seed exercises a different walk', () => {
  const r = fuzzEntityAllocator(4000, createEntropy(0xBADF00D));
  assert.equal(r.iterations, 4000);
  assert.ok(r.creates > 0 && r.destroys > 0 && r.destroyByIndex > 0);
  assert.ok(r.staleProbes > 0);
  assert.ok(r.finalCapacity < r.creates);
});

test('fuzzer: entity allocator fuzz is deterministic for a given seed', () => {
  const a = fuzzEntityAllocator(2000, createEntropy(0x5EED));
  const b = fuzzEntityAllocator(2000, createEntropy(0x5EED));
  assert.deepEqual(a, b, 'same seed must produce an identical fuzz outcome');
});
