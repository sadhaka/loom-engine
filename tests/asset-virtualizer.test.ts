// Loom Engine - AssetVirtualizer (bounded LRU GPU-asset cache) tests.
//
// Covers constructor validation, the touch/load/complete lifecycle,
// and the 6 Codex gates:
//   gate 1 - asset IDs are bounds-checked.
//   gate 2 - dispose() queues resident handles + the placeholder for
//            destruction; getGpuHandle returns the placeholder.
//   gate 3 - an evicted GPU handle waits destroyDelay ticks before
//            drainDestroyed yields it.
//   gate 4 - LRU eviction is wrap-safe: a pre-wrap asset is correctly
//            evicted over a post-wrap one.
//   gate 5 - touch enqueues a load queue; dequeueLoad pulls it.
//   gate 6 - completeLoad rejects a stale handle (the slot was
//            evicted and reused) and safely queues the orphan handle.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AssetVirtualizer,
  SLOT_STATE_FREE,
  SLOT_STATE_QUEUED,
  SLOT_STATE_LOADING,
  SLOT_STATE_RESIDENT,
  ASSET_HANDLE_INVALID,
  DESTROY_NONE,
  type AssetVirtualizerConfig,
} from '../src/index.js';

// A default config with selective overrides.
function cfg(over: Partial<AssetVirtualizerConfig> = {}): AssetVirtualizerConfig {
  return {
    capacity: 4,
    maxAssetId: 1000,
    destroyDelay: 3,
    destroyQueueSize: 16,
    ...over,
  };
}

test('asset virtualizer: constructor validates the config', () => {
  const av = new AssetVirtualizer(cfg());
  assert.equal(av.capacity, 4);
  assert.equal(av.maxAssetId, 1000);
  assert.equal(av.destroyDelay, 3);
  assert.equal(av.tableSize, 8, 'the hash table is auto-sized to 2 * nextPow2(capacity)');
  assert.equal(av.getCachedCount(), 0);
  assert.throws(() => new AssetVirtualizer(cfg({ capacity: 0 })), /capacity/);
  assert.throws(() => new AssetVirtualizer(cfg({ capacity: 1.5 })), /capacity/);
  assert.throws(() => new AssetVirtualizer(cfg({ maxAssetId: 0 })), /maxAssetId/);
  assert.throws(() => new AssetVirtualizer(cfg({ destroyDelay: -1 })), /destroyDelay/);
  // destroyQueueSize must be >= capacity + 1 (so dispose always fits).
  assert.throws(() => new AssetVirtualizer(cfg({ capacity: 4, destroyQueueSize: 4 })), /destroyQueueSize/);
  assert.doesNotThrow(() => new AssetVirtualizer(cfg({ capacity: 4, destroyQueueSize: 5 })));
  assert.doesNotThrow(() => new AssetVirtualizer(cfg({ destroyDelay: 0 })), 'destroyDelay 0 is valid');
});

test('asset virtualizer: touch misses then hits, and validates its arguments (gates 1, 5)', () => {
  const av = new AssetVirtualizer(cfg());
  const h = av.touch(42, 1);
  assert.notEqual(h, ASSET_HANDLE_INVALID);
  assert.equal(av.getState(h), SLOT_STATE_QUEUED, 'a fresh touch is a miss -> QUEUED');
  assert.equal(av.getAssetId(h), 42);
  assert.equal(av.getCachedCount(), 1);
  assert.equal(av.getLoadQueueCount(), 1);
  // A second touch of the same asset is a hit - no new slot, not re-enqueued.
  const h2 = av.touch(42, 2);
  assert.equal(h2, h);
  assert.equal(av.getCachedCount(), 1);
  assert.equal(av.getLoadQueueCount(), 1);
  // Argument validation.
  assert.throws(() => av.touch(-1, 0), /assetId/);
  assert.throws(() => av.touch(1000, 0), /assetId/);
  assert.throws(() => av.touch(1, -1), /currentTick/);
  assert.throws(() => av.touch(1, 0x100000000), /currentTick/);
});

test('asset virtualizer: a full cache evicts the least-recently-used asset', () => {
  const av = new AssetVirtualizer(cfg({ capacity: 2, destroyQueueSize: 3 }));
  av.touch(1, 1);   // A
  av.touch(2, 2);   // B
  av.touch(3, 3);   // C - cache full -> evict the LRU, which is A (tick 1).
  assert.equal(av.findAsset(1), ASSET_HANDLE_INVALID, 'A was the LRU and was evicted');
  assert.notEqual(av.findAsset(2), ASSET_HANDLE_INVALID);
  assert.notEqual(av.findAsset(3), ASSET_HANDLE_INVALID);
  assert.equal(av.getCachedCount(), 2);
});

test('asset virtualizer: touch refreshes an asset, sparing it from eviction', () => {
  const av = new AssetVirtualizer(cfg({ capacity: 2, destroyQueueSize: 3 }));
  av.touch(1, 1);   // A
  av.touch(2, 2);   // B
  av.touch(1, 3);   // A again - refreshes A's LRU timestamp to tick 3.
  av.touch(3, 4);   // C - the LRU is now B (tick 2), not A (tick 3).
  assert.equal(av.findAsset(2), ASSET_HANDLE_INVALID, 'B was the LRU');
  assert.notEqual(av.findAsset(1), ASSET_HANDLE_INVALID, 'A was refreshed and survived');
  assert.notEqual(av.findAsset(3), ASSET_HANDLE_INVALID);
});

test('asset virtualizer: LRU eviction is wrap-safe across the u32 tick boundary (gate 4)', () => {
  // A is touched at a tick near the u32 ceiling; B just after the wrap.
  // The genuinely-oldest asset is A - a naive min(tick) would wrongly
  // pick B (5 < 0xFFFFFFF0). The unsigned-age comparison gets it right.
  const av = new AssetVirtualizer(cfg({ capacity: 2, destroyDelay: 0, destroyQueueSize: 3 }));
  av.touch(10, 0xFFFFFFF0);   // A - pre-wrap
  av.touch(20, 0x00000005);   // B - post-wrap
  av.touch(30, 0x00000010);   // C - cache full -> evict the genuine LRU.
  assert.equal(av.findAsset(10), ASSET_HANDLE_INVALID, 'A (genuinely oldest, pre-wrap) was evicted');
  assert.notEqual(av.findAsset(20), ASSET_HANDLE_INVALID, 'B (recent, post-wrap) survived');
  assert.notEqual(av.findAsset(30), ASSET_HANDLE_INVALID);
});

test('asset virtualizer: dequeueLoad -> completeLoad takes an asset to RESIDENT (gate 5)', () => {
  const av = new AssetVirtualizer(cfg());
  const h = av.touch(7, 1);
  assert.equal(av.getState(h), SLOT_STATE_QUEUED);
  const loading = av.dequeueLoad();
  assert.equal(loading, h);
  assert.equal(av.getState(h), SLOT_STATE_LOADING);
  assert.equal(av.getLoadQueueCount(), 0);
  assert.equal(av.dequeueLoad(), ASSET_HANDLE_INVALID, 'an empty load queue returns the invalid sentinel');
  assert.equal(av.completeLoad(h, 123, 2), true);
  assert.equal(av.getState(h), SLOT_STATE_RESIDENT);
  assert.equal(av.isResident(h), true);
  assert.equal(av.getGpuHandle(h), 123);
  // completeLoad only fires from LOADING - a second call is rejected.
  assert.equal(av.completeLoad(h, 999, 3), false);
  // gpuHandle validation.
  assert.throws(() => av.completeLoad(h, 0, 1), /gpuHandle/);
});

test('asset virtualizer: completeLoad rejects a stale handle and salvages its GPU handle (gate 6)', () => {
  // A is dequeued (LOADING), then evicted while still loading. The
  // loader finishes and calls completeLoad with the now-stale handle:
  // it must be rejected, and the orphaned GPU texture queued for
  // safe destruction.
  const av = new AssetVirtualizer(cfg({ capacity: 2, destroyDelay: 0, destroyQueueSize: 4 }));
  const a = av.touch(10, 1);
  const aLoading = av.dequeueLoad();   // A -> LOADING
  assert.equal(aLoading, a);
  av.touch(20, 2);                     // B
  av.touch(30, 3);                     // C - cache full -> evict the LRU, which is A.
  assert.equal(av.getState(a), SLOT_STATE_FREE, 'the stale handle no longer resolves');
  // The loader's late response is rejected; handle 555 is salvaged.
  assert.equal(av.completeLoad(aLoading, 555, 3), false, 'a stale load completion is rejected');
  assert.equal(av.drainDestroyed(3), 555, 'the orphaned GPU handle is queued for destruction');
});

test('asset virtualizer: getGpuHandle returns the placeholder until an asset is RESIDENT (gate 2)', () => {
  const av = new AssetVirtualizer(cfg());
  av.setPlaceholder(900);
  assert.equal(av.getPlaceholder(), 900);
  const h = av.touch(5, 1);
  assert.equal(av.getGpuHandle(h), 900, 'a QUEUED asset draws with the placeholder');
  av.dequeueLoad();
  assert.equal(av.getGpuHandle(h), 900, 'a LOADING asset still draws with the placeholder');
  av.completeLoad(h, 42, 2);
  assert.equal(av.getGpuHandle(h), 42, 'a RESIDENT asset draws with its real texture');
  // An invalid handle has no texture.
  assert.equal(av.getGpuHandle(ASSET_HANDLE_INVALID), 0);
  // setPlaceholder validates.
  assert.throws(() => av.setPlaceholder(-1), /gpuHandle/);
  assert.doesNotThrow(() => av.setPlaceholder(0), 'placeholder 0 clears it');
});

test('asset virtualizer: an evicted GPU texture is destroyed only after the delay (gate 3)', () => {
  const av = new AssetVirtualizer(cfg({ capacity: 1, destroyDelay: 5, destroyQueueSize: 4 }));
  const h = av.touch(1, 10);
  av.completeLoad(av.dequeueLoad(), 100, 10);   // A RESIDENT, GPU handle 100
  av.touch(2, 12);                              // cache full -> evict A; 100 -> destruction queue, ready at 17
  assert.equal(av.getDestroyQueueCount(), 1);
  assert.equal(av.drainDestroyed(12), DESTROY_NONE, 'not ready at tick 12');
  assert.equal(av.drainDestroyed(16), DESTROY_NONE, 'not ready at tick 16');
  assert.equal(av.drainDestroyed(17), 100, 'ready exactly destroyDelay ticks after eviction');
  assert.equal(av.drainDestroyed(17), DESTROY_NONE, 'the queue is now empty');
});

test('asset virtualizer: the destruction queue throws when it overflows', () => {
  // capacity 1: each load evicts the previous RESIDENT asset, pushing
  // its handle. destroyQueueSize 2 holds two; the third push throws.
  const av = new AssetVirtualizer(cfg({ capacity: 1, destroyDelay: 100, destroyQueueSize: 2 }));
  let tick = 1;
  const load = (id: number): void => {
    av.touch(id, tick);
    av.completeLoad(av.dequeueLoad(), id * 10, tick);
    tick++;
  };
  load(1);   // A RESIDENT
  load(2);   // evicts A -> pushes handle 10
  load(3);   // evicts B -> pushes handle 20 (the queue is now full)
  assert.throws(() => load(4), /destruction queue full/);
});

test('asset virtualizer: eviction pulls a QUEUED asset out of the load queue', () => {
  const av = new AssetVirtualizer(cfg({ capacity: 2, destroyQueueSize: 3 }));
  av.touch(1, 1);   // A QUEUED
  av.touch(2, 2);   // B QUEUED
  assert.equal(av.getLoadQueueCount(), 2);
  av.touch(3, 3);   // C - evicts A; A must also leave the load queue.
  assert.equal(av.getLoadQueueCount(), 2, 'A left the load queue, C joined');
  const seen = new Set<number>();
  let h = av.dequeueLoad();
  while (h !== ASSET_HANDLE_INVALID) {
    seen.add(av.getAssetId(h));
    h = av.dequeueLoad();
  }
  assert.deepEqual([...seen].sort((x, y) => x - y), [2, 3], 'only B and C remain queued, not the evicted A');
});

test('asset virtualizer: dispose queues resident handles + the placeholder, then resets (gate 2)', () => {
  const av = new AssetVirtualizer(cfg({ capacity: 4, destroyDelay: 2, destroyQueueSize: 8 }));
  av.setPlaceholder(7);
  av.touch(1, 1);
  av.completeLoad(av.dequeueLoad(), 100, 1);
  av.touch(2, 1);
  av.completeLoad(av.dequeueLoad(), 200, 1);
  assert.equal(av.getCachedCount(), 2);
  av.dispose(10);
  assert.equal(av.getCachedCount(), 0, 'dispose resets the cache');
  assert.equal(av.getPlaceholder(), 0, 'dispose clears the placeholder');
  assert.equal(av.getDestroyQueueCount(), 3, 'two resident handles + the placeholder');
  // Everything is queued at tick 10 + destroyDelay 2 = 12.
  const drained: number[] = [];
  let h = av.drainDestroyed(12);
  while (h !== DESTROY_NONE) {
    drained.push(h);
    h = av.drainDestroyed(12);
  }
  assert.deepEqual(drained.sort((x, y) => x - y), [7, 100, 200]);
  assert.equal(av.findAsset(1), ASSET_HANDLE_INVALID);
});

test('asset virtualizer: clear is a hard reset of every structure', () => {
  const av = new AssetVirtualizer(cfg({ capacity: 2, destroyDelay: 1, destroyQueueSize: 4 }));
  av.setPlaceholder(9);
  av.touch(1, 1);
  av.completeLoad(av.dequeueLoad(), 100, 1);
  av.touch(2, 2);
  av.touch(3, 3);   // evicts the LRU resident -> pushes to the destruction queue
  assert.ok(av.getCachedCount() > 0 && av.getDestroyQueueCount() > 0);
  av.clear();
  assert.equal(av.getCachedCount(), 0);
  assert.equal(av.getLoadQueueCount(), 0);
  assert.equal(av.getDestroyQueueCount(), 0, 'clear empties the destruction queue too');
  assert.equal(av.getPlaceholder(), 0);
  assert.equal(av.findAsset(1), ASSET_HANDLE_INVALID);
  // Reusable after clear.
  const h = av.touch(1, 1);
  assert.equal(av.getState(h), SLOT_STATE_QUEUED);
});

test('asset virtualizer: the full pipeline is deterministic - identical runs match', () => {
  function run(): number[] {
    const av = new AssetVirtualizer(cfg({ capacity: 3, maxAssetId: 64, destroyDelay: 2, destroyQueueSize: 16 }));
    av.setPlaceholder(1);
    const out: number[] = [];
    for (let tick = 1; tick <= 20; tick++) {
      // Touch a small rotating working set that exceeds capacity.
      av.touch(tick % 5, tick);
      av.touch((tick * 3) % 7, tick);
      // Load up to two queued assets.
      for (let i = 0; i < 2; i++) {
        const h = av.dequeueLoad();
        if (h === ASSET_HANDLE_INVALID) break;
        av.completeLoad(h, av.getAssetId(h) + 1000, tick);
      }
      // Drain whatever destruction is ready.
      let d = av.drainDestroyed(tick);
      while (d !== DESTROY_NONE) {
        out.push(d);
        d = av.drainDestroyed(tick);
      }
      out.push(av.getCachedCount(), av.getLoadQueueCount(), av.getDestroyQueueCount());
    }
    // Final residency of every asset id.
    for (let id = 0; id < 8; id++) {
      const h = av.findAsset(id);
      out.push(h === ASSET_HANDLE_INVALID ? -1 : av.getState(h));
    }
    return out;
  }
  assert.deepEqual(run(), run(), 'no RNG, no clock - the cache is fully reproducible');
});
