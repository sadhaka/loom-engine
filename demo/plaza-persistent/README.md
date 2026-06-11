# Plaza Persistent

The plaza that remembers: persistence + partial sync, proven in one seeded,
deterministic end-to-end run. Twelve villagers across four regions live two
epochs on an HMAC event chain, the world suspends into a sealed bundle,
resumes through full chain verification plus twelve offline epochs, then an
in-page client pulls ONLY the regions that changed and proves the recombined
Merkle root against the server root.

## Run it

```sh
# from the repo root
npm run build:all
python -m http.server 8765
# browse http://localhost:8765/demo/plaza-persistent/
```

`build:all` compiles both the engine (`tsc`) and every demo
(`tsc -p tsconfig.demo.json`). The demo's HTML uses an `importmap`
to resolve `@sadhaka/loom-engine` to the local `dist/index.js`, so the
TypeScript source reads identically to a real npm consumer.

## What it proves (the #checks list)

Every value on screen is asserted against `vector.json`, which is
byte-identical to `test_vectors/v6_1_plaza_persistent.json` - the same
vector `tests/plaza-persistent.test.ts` drives headlessly in `npm test`,
so the demo and the test suite pin the same hashes and neither can rot.

1. **Build** - S0 (12 villagers, 4 regions) hashes to the pinned
   `worldStateHash`.
2. **Live play** - `tickEpoch` epochs 1..2; both `EpochResolved` events are
   appended to an `EventChain` and the record signatures + chain head match
   the pins.
3. **Suspend** - `suspend()` packs the snapshot (index 0) + the 2-event HMAC
   tail and EMBEDS `chain.seal()` in the bundle (bundle format v2 - the seal
   is structural, not external bookkeeping). The demo also shows the hole the
   seal closes: a TRUNCATED tail passes a bare hash-chain verify and is
   rejected only when the seal's (count, head) commitment is checked.
4. **Resume** - `resume()` verifies the snapshot hash, verifies the bundle's
   structural seal fail-closed (a missing, forged, or tail-disagreeing seal
   is rejected), verifies the tail HMAC + linkage, replays the tail via the
   recorded-mutation reducer
   (post-tail hash == pinned == the live state), then resolves 12 offline
   epochs deterministically (0 voided) to the pinned final state hash.
5. **Partial sync** - `partitionRegions` splits the resumed (server) and
   pre-suspend (client) states into per-region partitions;
   `diffRegionLeaves` reports EXACTLY the 2 regions the offline proposals
   touched (east + south); the client pulls only those 2 partitions and
   `applyPartialSync` verifies each leaf, recombines with the kept cached
   regions, and constant-time compares the recomputed root to the server
   root - with a pinned bytes-pulled vs full-state metric.
6. **Determinism** - the whole flow runs TWICE in-process and must be
   byte-identical. Same seed, same world, same hashes, every run.

The **tamper** button corrupts one pulled region and shows the red
fail-closed rejection path (interactive only, not part of determinism).

## Where to read next

- `src/runtime/world-session.ts` - the suspend/resume lifecycle.
- `src/runtime/event-chain.ts` - the HMAC chain + the seal commitment.
- `src/runtime/world-epoch.ts` - the deterministic offline epoch tick.
- `src/runtime/region-hash.ts` - per-region leaves + the global Merkle root.
- `src/runtime/region-sync.ts` - the partial-sync client consumer
  (`partitionRegions` / `diffRegionLeaves` / `applyPartialSync`).
- `tools/gen-plaza-persistent-vectors.ts` - the single source of truth that
  writes both vector copies.
