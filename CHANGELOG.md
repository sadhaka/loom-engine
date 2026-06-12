# Changelog

Loom Engine - cumulative phase-by-phase log. Each version line links
to the spec phase in [LOOM-ENGINE-SPEC.md](../docker/LOOM-ENGINE-SPEC.md)
Section 7 and the GitHub commit. Format follows the spirit of
[Keep a Changelog](https://keepachangelog.com/) but is organized by
phase rather than calendar release - solo-dev project, no semver
contract yet.

## 3.1.0 - 2026-06-12 (AST v2 + 5e Action Pack + forge-proof persistence + delve-mini - the audited content milestone)

- **3.1.0 release audit (Codex round 4) - all findings fixed by hand before this
  tag.** HIGH: Rust `bundle_bind_message` now validates NFC on every identity
  string exactly like TS `assertCleanString` / Python `assert_clean_string` -
  a Rust producer can no longer SIGN a non-NFC worldId into a bundle the other
  two surfaces reject ("binding invalid"), which was a cross-surface
  persistence fork; `bind_bundle` returns `Err` (never panics) and
  `verify_bundle_binding` fails closed to `false`, with a regression test in
  both directions. MEDIUM: Rust `resume()` gained `expected_world_id`
  (+ `expectedWorldId` on the JSON surface for WASM/PyO3) with the identical
  TS/Python gate position (first, before any parse or crypto) and wording, so
  a host that knows which world it asked for refuses a cross-world bundle at
  the core boundary on every surface. LOW sweep: the delve-mini fingerprint
  now folds the TileMap stage in (every room-centre marker is READ BACK
  through `map.get` into `mapChecksum`; pin re-pinned `23f71bf5` ->
  `d5c0904c`), the delve README claim is narrowed to the TypeScript headless
  proof, `sanitizeSlotPool` is actually exported from the public root (the
  entry below claimed it already), the stale "bundle format v2 / KNOWN
  RESIDUAL" module headers + vector notes are rewritten to v3 binding
  semantics (vectors regenerated - data byte-identical, notes only), and
  nested-demo build artifacts are ignored/cleaned so a stray tsc run can
  never land in the repo.

- **demo/delve-mini - a seeded roguelike run proving "same seed = same dungeon =
  same run"** (`tests/delve-mini-run.ts`, `tests/delve-mini.test.ts`,
  `demo/delve-mini/README.md`). Chains seven primitives that shipped in isolation
  into one deterministic pipeline from a single seed: DungeonGenerator (BSP) ->
  bestiary -> TileMap -> Pcg32 combat -> LootTable -> InventoryGrid, plus
  SaveSlots + Leaderboard for the meta-loop. The headless test runs the whole
  crawl TWICE in-process and asserts the results are byte-identical, pins a run
  fingerprint as a regression, proves different seeds diverge, and round-trips a
  run through SaveSlots + Leaderboard - it runs in npm test so the demo logic
  cannot rot. The reference seed `crypt-of-names` carves a 14-room crypt and
  dies in room 11 to the bone-host, score 1172, fingerprint 23f71bf5. (The
  interactive browser page is a documented follow-up; the determinism guarantee
  it would show is already proven by the test.)
- **SECURITY / BREAKING (bundle format v3): a signed bundle binding closes the
  leading-truncation and cross-world forges** (`runtime/event-chain`,
  `runtime/world-session`, the Rust `loom_events` / `loom_session` ports, the
  Python `event_chain` / `world_session` ports, `test_vectors/v3_4` / `v3_5` /
  `v6_1`, `demo/plaza-persistent`). A Codex adversarial audit proved the v2
  seal - which signs only `(count, head)` - left a forge needing NO key: the
  snapshot hash binds the STATE but not its chain POSITION, so a forger could
  rewrite `snapshot.eventIndex` + `tailGenesis` together to drop the LEADING
  prefix of `chainTail` (every structural check still passed; the dropped
  record's mutations were silently lost), or splice a snapshot from another
  world. `suspend()` now also signs a BINDING over `worldId` + snapshot
  `stateHash` + `eventIndex` + `tailGenesis` + the sealed `(count, head)` via
  `EventChain.bindBundle` (domain `loom.bundle.bind/1`, length-prefixed,
  byte-identical on every surface); `resume()` re-derives it and rejects
  fail-closed BEFORE the structural checks the forger can satisfy. `resume()`
  also gains an optional `expectedWorldId`; WorldState shape is validated
  fail-closed (Rust previously no-opped a malformed state while TS/Python threw);
  and `chainTail` must be an array. The KNOWN RESIDUAL documented in the v2
  entry is RESOLVED. Negative tests on TS, Rust and Python construct the exact
  audit forge and confirm rejection.
- **5e content pack: RAW blinded / petrified / invisible, a malformed-pool guard,
  and a Blindness/Deafness deafness variant** (`runtime/srd5e-conditions`,
  `runtime/srd5e-spell-slots`, `runtime/srd5e-pack`, the Python + Rust ports,
  `packs/srd5e/srd5e_actions_v1.json` 245 -> 246 actions). Codex audit: the
  advantage / auto-fail tables were missing three conditions (attacks against a
  blinded/petrified target have advantage; a blinded attacker has disadvantage;
  invisible attacker advantage / target disadvantage; petrified auto-fails STR
  and DEX) - combat math was silently wrong; now correct and unit-tested on all
  three surfaces. An untrusted slot pool is clamped at every public boundary
  (`{ max: 1, used: -100 }` no longer reports 101 available slots - a
  slot-minting exploit), with an exported `sanitizeSlotPool` helper. The shipped
  pack JSON no longer references private host tuning.
- **AST v2: cross-language parity forks closed + a name budget** (`runtime/
  ruleset-ast`, the Python + Rust ports, `test_vectors/ast_v2_families.json`).
  Codex audit: a PRESENT non-integer (incl. null) property read returned 0 on
  Rust where TS/Python threw; `set_prop`/`add_prop` read the previous value
  three different ways; and the `pub` shared-rng entry points (`loom_epoch` /
  `loom_frame` callers) skipped validation, letting an external Rust consumer
  bypass it. All three are fail-closed and identical now, plus a 256-UTF-16-unit
  cap on property/tag names. Seven new golden vectors (G1-G7) pin every fix
  byte-identical across TS, Python and Rust.

- **BREAKING (bundle format v2): the WorldBundle carries a structural ChainSeal -
  end-truncation of the chain tail is now rejected fail-closed on resume**
  (`runtime/world-session`, `test_vectors/v3_4_world_session.json`,
  `test_vectors/v3_5_session_soak.json`, `test_vectors/v6_1_plaza_persistent.json`,
  `demo/plaza-persistent`): the persistent-proof recon proved that `resume()`
  silently accepted a bundle whose `chainTail` lost its TRAILING records - a
  bare hash chain cannot see records dropped off its end, the bundle carried no
  `ChainSeal`, and the dropped history was silently replaced by re-simulated
  catch-up. `EventChain.seal()` existed but the lifecycle never used it; the S4
  soak case and the plaza demo verified seals EXTERNALLY only. Now structural:
  (1) `WorldBundle` gains a required `seal` field; `suspend()` embeds
  `chain.seal()` at pack time. (2) `resume()` verifies the seal FAIL-CLOSED
  before trusting the tail: a missing seal (pre-v2 bundle), a forged seal
  signature, a sealed head that disagrees with the tail's last record (the
  end-truncation case), or a sealed count that disagrees with
  `snapshot.eventIndex + chainTail.length` is rejected with a precise reason.
  NO compatibility escape hatch - pre-seal bundles are rejected outright
  (re-suspend with the current engine); the engine is unreleased between
  milestones, and fail-closed beats compatible-but-spoofable. (3) `suspend()`
  validates `snapshotEventIndex` against the chain's last seq fail-closed - an
  index past the end used to yield a bundle claiming a snapshot at a
  nonexistent event; it now throws, as do negative / non-integer indexes and a
  chain whose seq numbering cannot align with the index. (4) Every vector that
  embeds a bundle was regenerated via its generator (meta/provenance preserved;
  payload deltas are exactly the added `seal` fields); the plaza demo, the
  plaza headless test, and the soak suite now exercise the embedded seal
  instead of external seal bookkeeping, with new negative pins: end-truncated
  tail rejected, seal-less bundle rejected, forged seal rejected, swapped
  valid-but-stale seal rejected, out-of-range `snapshotEventIndex` rejected.
  KNOWN RESIDUAL (documented in the module header): the snapshot hash binds the
  state but not its claimed chain POSITION, so a forger rewriting
  `snapshot.eventIndex` + `tailGenesis` together while dropping LEADING tail
  records still presents a structurally consistent bundle; closing that needs
  the snapshot commitment to fold in (worldId, eventIndex) - a future format
  revision. The Python and Rust ports enforce the same seal checks in their
  `resume` (`python/loom_engine/world_session.py`,
  `rust/loom_session/src/lib.rs`) with the same rejection reasons, pinned by
  the same negative cases in their suites. Also:
  `@types/node` added as a devDependency so ad-hoc `tsc` runs stop reporting
  node resolution noise.
- **Persistent world proven, not promised - session soak + partial-sync client +
  the plaza-persistent end-to-end demo** (`runtime/region-sync`,
  `demo/plaza-persistent`, `test_vectors/v3_5_session_soak.json`,
  `test_vectors/v6_1_plaza_persistent.json`): the two "reference flow is
  planned" labels are now real code. (1) v3.5 SESSION SOAK golden vectors
  (`tools/gen-session-soak-vectors.ts`) pin the composed long-horizon flows a
  public audit flagged as unexercised: 120-epoch catch-up run both single-shot
  and in four 30-epoch chunks (byte-identical, checkpoint-pinned), the
  zero-catch-up resume boundary + mid-chain suspend, three
  suspend -> resume -> re-suspend cycles on ONE accumulating chain equal to a
  single 21-epoch resume, chain seal verification across the whole gap
  including the negative space (tail truncation verifies CLEAN without a seal -
  the documented WorldBundle hole - and is caught with one), and void-at-scale
  (400 of 500 epochs lost) with a deterministic second resume across the void
  boundary. Driven on all three surfaces: `tests/world-session-soak.test.ts`,
  `python/tests/test_world_session_soak.py`, and
  `rust/loom_session/tests/golden_session_soak.rs` (16 tests each, including
  the bundle-v2 seal negative cases). (2) The
  partial-sync CLIENT consumer (`partitionRegions` / `diffRegionLeaves` /
  `applyPartialSync`): partition a world into per-region world-shaped
  partitions (each entity carries exactly one `region:<id>` tag, fail-closed;
  partition epoch pinned to 0 so a leaf is a content address, not a time
  address), diff cached vs server leaves, then fail-closed assembly - verify
  every pulled region's leaf, recombine with kept cached regions, and
  constant-time compare the recomputed Merkle root to the server root, so a
  stale or tampered cached region can never ride the cheap path. (3) The
  Python port of the persistence lifecycle (`loom_engine.event_chain` +
  `loom_engine.world_session` - HMAC chain with seal commitments, suspend /
  resume / recorded-mutation replay) and detailed Rust chain verification
  (`verify_records_detailed` returning per-record mismatch reasons, TS-parity
  `sig_mismatch` / `broken_chain_link` / `seal_mismatch`). (4) The
  [Plaza Persistent demo](demo/plaza-persistent/) - one seeded end-to-end run:
  12 villagers in 4 regions live 2 epochs on an HMAC chain, suspend into a
  sealed bundle, resume through full verification + 12 offline epochs, then a
  client pulls only the 2 changed regions and proves the recombined root.
  Every on-screen value asserts against `vector.json`, byte-identical to the
  canonical `test_vectors/v6_1_plaza_persistent.json` that
  `tests/plaza-persistent.test.ts` drives headlessly in `npm test` - the demo
  and the suite pin the same hashes, so neither can rot. README + landing
  labels that said the end-to-end flow "is planned" now point at the real
  demo. Persistence + partial sync proven end-to-end; still no sharding or
  instancing claims.
- **SRD 5e action pack - a playable 5e core, actions as data**
  (`runtime/srd5e-spell-slots`, `runtime/srd5e-concentration`,
  `runtime/srd5e-conditions`, `runtime/srd5e-pack`): production-proven
  resolvers extracted from a live game, ported to all three surfaces
  (TypeScript, Python, Rust). Pure modules: the spell-slot economy
  (full/half/pact-caster tables, spend/restore, short/long rest, the level-up
  widen-merge, "At Higher Levels" upcast scaling), the concentration state
  machine (one spell at a time, maintain DC = max(10, floor(damage/2)); the
  caller rolls the CON save and passes the total), and condition tables
  (condition -> advantage/disadvantage MODE on attacks, STR/DEX auto-fail,
  incapacitated reaction denial). The pack module ships mechanics-only
  cantrip + leveled-spell catalogs, AST v2 document builders (every emitted
  document passes the v2 validators), and `planLeveledCast` - the dice-free
  economy half of a cast. `tools/gen-srd5e-pack.ts` generates 245 concrete
  action documents to `packs/srd5e/srd5e_actions_v1.json` (shipped in the npm
  package). Mechanics are public; game-specific tuning is caller config with
  neutral defaults. Content is SRD 5.1 (CC-BY-4.0) mechanics and numbers only,
  no descriptive prose - see NOTICE.md. 72 shared golden vectors
  (`test_vectors/srd5e_pack_v1.json`, emitted by `tools/gen-srd5e-vectors.ts`
  after asserting the real TS modules + AST evaluator against hand-computed
  expectations) pin builder drift and prove TS/Python/Rust parity across
  slot-economy transitions, concentration flows, and scripted-dice AST
  evaluation of the built action documents.
- **Ruleset AST v2 - six additive node families** (`runtime/ruleset-ast`, spec:
  [docs/specs/AST-V2-SPEC.md](docs/specs/AST-V2-SPEC.md)): the rules AST now
  speaks system families - PbtA-style moves and d100 BRP-style skill checks are
  expressible as pure JSON data, no engine code per system. New nodes:
  `nat_roll_gte` / `nat_roll_lte` (natural-roll range conditions), `and`
  (boolean conjunction), `compare` / `has_tag` (RNG-free state conditions),
  `if` (conditional mutations), `foreach_target` (bounded multi-target mutation
  scope), and `repeat` (bounded per-target iteration). Budgets stay fail-closed:
  a static multiplicity multiplier `M` charges every branch document-globally at
  validation, before any RNG draw, under new hard caps (`MAX_TARGETS` 32,
  `MAX_ITERATIONS` 16, `MAX_APPLIED_MUTATIONS` 1024, `MAX_WORLD_ENTITIES`
  65536); v1 documents validate and evaluate unchanged (`M` = 1), and unknown or
  over-budget input rejects at validation with zero draws and the state
  untouched. 38 shared golden vectors (`test_vectors/ast_v2_families.json`,
  emitted by `tools/gen-ast-v2-vectors.ts` after asserting the real TS evaluator
  against every hand-computed spec expectation) prove all-surface parity:
  identical accept/reject boundaries, PRNG consumption, resolved degrees, and
  applied-mutation lists on TypeScript, Python, and Rust.

## 3.0.0 - 2026-06-05 (Living Persistent World + cross-language surfaces + real-time multiplayer core)

The engine becomes a deterministic, server-authoritative world engine: the same logic
compiled to a Rust core and bound to TypeScript (npm), WASM (browser), a native Python
wheel (PyO3), and a C ABI (Unity / Godot / Go), producing byte-identical results from
the same seed on every surface - proven by shared golden vectors.

- **Any-System ruleset AST** (`runtime/ruleset-ast`): a strict, data-driven JSON
  interpreter - bring any tabletop system (5e / PF2e / homebrew) as DATA, with no
  untrusted-code execution. Checks (roll vs DC -> degree -> mutations), expressions
  (dice / prop refs / integer math / floor_div toward -inf), and a fail-closed static
  validation pass that runs before any RNG draw.
- **World snapshot + replay** (`runtime/world-state-snapshot`, `runtime/world-replay`):
  a pure content `state_hash` (HMAC over canonical, integer-only JSON) so a world is
  persisted compactly and reconstructed from a verified snapshot + the events after it
  - provably equal to replay-from-genesis.
- **Epoch world-tick** (`runtime/world-epoch`): the between-session tick - offline
  factions act deterministically against a PRNG seeded purely from (worldId, epoch),
  fail-closed (a rejected proposal consumes zero RNG) and bounded (max-actions, a
  capped catch-up that voids excess offline time).
- **WorldSession lifecycle** (`runtime/world-session`): suspend packs a world into a
  verifiable bundle; resume verifies the snapshot hash, verifies + replays the HMAC
  chain tail via a recorded-mutation reducer, rejects time-travel, and fast-forwards
  bounded offline epochs.
- **Real-time multiplayer core** (`runtime/world-frame`, `runtime/region-hash`): a
  server-authoritative command-frame tick (commands sorted by a numeric-aware player
  id, resolved through the AST, fail-closed + rate-capped), client-side rollback
  reconciliation (replay unconfirmed commands over the corrected server frame), and
  region hashing (a 2-level Merkle so a partial-sync client verifies only its own
  region + the root). The client can predict but can never forge an outcome. The
  frame PRNG is derived from structured length-prefixed fields
  (`field('loom.frame/1') || field(worldId) || LE64(frameNumber)`), injective across
  world ids; every command's `playerId`/`seq` and the reconcile anchor
  (`correctedState.frame`/`toFrame`) are validated fail-closed at the boundary and the
  rollback window is bounded, so the ordering and replay are byte-identical on every
  surface (no silent seq coercion, no unbounded replay).
- **Four binding surfaces**: a Rust workspace (`loom_math`, `loom_events`,
  `loom_snapshot`, `loom_ruleset`, `loom_epoch`, `loom_session`, `loom_frame`) bound to
  WASM (`loom_wasm`), a PyO3 wheel (`loom_py`), and a panic-guarded C ABI
  (`loom_c_abi`), each verified against the shared golden vectors. The C ABI is hardened
  against FFI misuse: no Rust panic crosses the boundary, every caller slice is
  length-checked, and bounded-read `_n` variants avoid unbounded C-string scans.

Every deterministic primitive is pinned by a cross-language golden vector. SRD 5.1
(CC-BY-4.0) + PF2e Remaster (ORC) attributed in `NOTICE.md`; source-available under
BUSL-1.1.

## 2.3.0 - 2026-06-05 (Combat determinism extraction - range bands + reaction economy + narration contract)

Extracts the generic, framework-agnostic deterministic combat primitives proven
in production (TheWorldTable / LoomMaster) into the public engine. Each is pure +
deterministic (no RNG, no wall-clock) so it replays byte-identically - the basis
for server-authoritative anti-cheat + honest AI-narrated play.

- **Range Bands** (`runtime/range-bands`): grid-free relative positioning - every
  combatant pair has a band (Engaged <=5ft / Near <=30ft / Far) instead of (x, y),
  so an AI narrator's weak spatial reasoning never decides positioning. Raw-float
  thresholds (5.49ft is Near, not rounded to Engaged); an insertion-ordered
  `RangeBandField` snapshots / replays identically. `bandFromDistanceFt` /
  `bandWithin` / `compareBands` + the field API.
- **Reaction Economy** (`runtime/reaction-economy`): the per-round "1 reaction per
  combatant" ceiling (kills infinite-reaction loops), as a storage-free
  `ReactionLedger`. Each spend is round-tagged, so a stale prior-round spend is
  inert even if a reset is missed. `canReact` / `spendReaction` /
  `advanceReactionRound`.
- **Narration Contract** (`runtime/narration-contract`): the engine-owns-outcomes
  guarantee - the differentiator vs pure-LLM story apps. `findInventedNumber`
  flags any mechanics number the prose states that the engine did NOT produce,
  catching numerals AND number-words ("seven", "twenty-one"). Validate-before-show
  for AI-narrated dice.

- **Ruleset Adapters** (`runtime/ruleset`): the three mechanics that differ by
  system, deterministic + content-agnostic. Action economy (`startTurnBudget` -
  5e action+bonus+reaction, PF2e 3-actions+reaction; `canSpend`/`spend`),
  `initiativeOrder` (total desc, tiebreak modifier > natural d20 > id - one
  tiebreak correct for both 5e and PF2e), and a condition-duration tracker
  (`applyCondition`/`tickConditions`/`activeConditions`, names supplied by the
  caller so no SRD text is reproduced). Compatible with the D&D 5e SRD (CC-BY-4.0)
  and the Pathfinder Second Edition Remaster ruleset (ORC License); attribution
  in NOTICE.md. Not affiliated with or endorsed by Wizards of the Coast or Paizo.

35 new tests (raw-float band edges, the reaction ceiling + round-tag robustness,
invented-number detection incl. number-words, the initiative tiebreak, condition
ticking). `tsc` clean. SRD/ORC attribution added (NOTICE.md).

## 2.2.5 - 2026-05-21 (EventChain - round-3/4 audit: DoS depth bound + transactional snapshot)

Closes the round-3 audit LOW (DoS hardening) and the round-4 regression it
surfaced, before promoting 2.2.5 to npm `latest`.

- LOW (unbounded recursion): `canonicalJson` and `deepCloneJson` now thread a
  depth counter and throw past `MAX_CANONICAL_DEPTH` (256) - far above any
  legitimate event nesting - so a hostile deeply-nested payload from an
  untrusted `verifyRecords` / `fromVerifiedSnapshot` input is rejected early and
  fails closed (append -> null, verify -> sig_mismatch) instead of consuming
  stack + CPU up to a RangeError. Also documents the intentional null-proto
  JSON-value equivalence.
- MED (fail-open snapshot regression): the new depth guard let a raw
  `fromSnapshot` throw mid-mutation (it cleared `this.records` before cloning),
  leaving the instance desynced (records=[] with a stale headSig). The clone now
  builds into locals and swaps `records` / `nextSeq` / `headSig` in only after
  the FULL clone succeeds; any `deepCloneJson` failure returns with the prior
  state intact (fail closed).

Round-4 boundary tests (depth 256 signs / 257 rejects; equivalent nested
payloads sign identically across instances) + the no-mutate regression. Full
suite 4087 / 4087 green. **2.2.5 is the current npm `latest`** (`npm install
loom-engine`).

## 2.2.4 - 2026-05-21 (EventChain - reject __proto__ data key)

Self-found while landing 2.2.3's `deepCloneJson`: a JSON-parsed payload can
carry an own `"__proto__"` data key, which a normal-prototype clone cannot
faithfully round-trip (`out[key]=...` hits the prototype setter). It already
failed CLOSED (sig_mismatch, never a verify bypass) - so 2.2.3 on beta was safe
- but the canonical boundary is hardened anyway:

- `assertObjectSurface` rejects an own `"__proto__"` key fail-closed.
- `deepCloneJson` assigns via `Object.defineProperty`, so no clone path
  (including raw untrusted `fromSnapshot`) can trigger the prototype setter.

A `__proto__`-rejection test. Full suite 4082 / 4082 green.

## 2.2.3 - 2026-05-21 (EventChain - round-2 audit: injectivity + clone isolation)

Round-2 Codex audit of 2.2.2 found one surviving HIGH and three MEDs in the
canonicalization / snapshot trust boundary, all fixed fail-closed:

- HIGH (signed-zero collision): `canonicalJson` accepted `-0`, which `String()`s
  to `"0"` yet is a distinct JS value (`Object.is(-0, 0) === false`) - so a
  signed zero could collide with positive zero under one signature. Now handled
  so distinct values cannot share an HMAC.
- MED: residual injectivity + clone-isolation gaps at the snapshot trust
  boundary, hardened so an adversarial input cannot desync or alias a verified
  instance.

New injectivity + clone-isolation tests. Full suite green.

## 2.2.2 - 2026-05-21 (EventChain - round-1 external crypto audit fixes)

Fixes from an independent Codex audit of the 2.2.1 EventChain, before promoting
to npm `latest`. All HIGH/MED findings closed; the encoding is now provably
injective and fails closed on anything it cannot faithfully sign.

- HIGH (injectivity): canonical strings could collide because TextEncoder maps
  lone surrogates lossily to U+FFFD (two distinct strings -> same bytes -> same
  HMAC). `assertCleanString` now rejects unpaired surrogates in every signed
  field (type, prevSig, payload strings + object keys); valid Unicode is
  unaffected.
- HIGH (semantic collisions): `canonicalJson` previously collapsed
  `undefined` / `NaN` / `Infinity` / `Date` / `Map` / `Set` / sparse-array holes
  / functions / symbols / bigint to `null` or `{}`, so distinct payloads could
  share a signature. It is now STRICT - any value that is not faithfully,
  injectively serializable throws; `append()` rejects it (no seq burned) and
  `verifyRecords()` marks such a stored record `sig_mismatch` (never throws).
- MED (fail-open snapshot): new `fromVerifiedSnapshot(records, seal?)` verifies
  BEFORE mutating and leaves the instance untouched when verification fails, so
  an adversarial snapshot cannot desync it. `fromSnapshot` stays for trusted
  loads.
- Tests: lone-surrogate rejection + collision, `{x:null}` vs `{x:NaN}` /
  `undefined` / Date / Map / Set rejection, `fromVerifiedSnapshot` no-mutate,
  and a node:crypto parity sweep for SHA-256 + HMAC across block-boundary
  lengths (0..200 bytes, keys above + below the 64-byte block).

6 new tests; full suite 4072 / 4072 green.

## 2.2.1 - 2026-05-21 (EventChain hardening - pre-`latest` audit pass)

Security + correctness hardening of the 2.2.0 EventChain before promoting it
from the npm `beta` tag to `latest`. Additive API only. The record signing
format changed (length-prefix + domain tag), so 2.2.1 signatures differ from
2.2.0 - fine on the rapid-stream beta, and a chain is always self-consistent
within a single version.

- INJECTIVE ENCODING: the signed message is now length-prefixed and
  domain-separated (`<len>:<value>` per field, tagged `loom.chain.rec/1`)
  instead of raw `|` joins. A `type` or payload string can no longer forge a
  field boundary - the encoding is provably injective.
- TAIL-TRUNCATION DETECTION: new `seal()` returns a signed (count, head)
  commitment; `verify(seal)` / `verifyRecords(..., seal)` and the static
  `EventChain.verifySeal()` detect records dropped off the END of the log -
  something a bare hash chain cannot see without an external length
  commitment. New `seal_mismatch` reason + `ChainSeal` type.
- CONSTANT-TIME COMPARE: signature verification now uses `timingSafeEqualHex`
  (also exported) instead of `!==`, removing the early-exit timing signal if
  verification ever runs in an online / oracle context.

8 new tests (delimiter-injection, boundary-shift non-collision, seal
round-trip, tail-truncation with/without seal, constant-time compare); full
suite 4066 / 4066 green.

## 2.2.0 - 2026-05-21 (EventChain - tamper-evident HMAC-chained event log)

**One new pure-logic kernel.** `EventChain` is the integrity-bearing
sibling of `EventLog` (0.83.0): every appended record is signed with
HMAC-SHA-256, and each signature folds in the previous record's
signature, so the whole log is a hash chain. `verify()` recomputes every
signature AND checks the chain linkage, catching three tamper classes a
plain log cannot:

- field tampering   - a payload / type / seq edited at rest (sig_mismatch)
- record deletion   - a middle record removed (broken_chain_link)
- record reordering - records shuffled (broken_chain_link)

Use it for audit trails, anti-cheat event tapes, economy / ledger logs,
or any "prove this sequence was not altered" requirement. The pattern is
ported from the server-authoritative event tape running in production in
TheWorldTable's LoomMaster backend (the same chain that guards its combat
resolution and currency ledger).

Ships with `hmacSha256` - a small, dependency-free, SYNCHRONOUS
HMAC-SHA-256 (FIPS 180-4 + RFC 2104). The engine's other crypto
(`sealed-asset`) uses async Web Crypto; EventChain needs a sync signer so
`append()` / `verify()` stay synchronous like every other kernel. It is
verified against the published NIST SHA-256 and RFC 4231 HMAC test
vectors, depends only on `TextEncoder` + typed arrays, and runs
identically in the browser and Node.

API: `EventChain.create({ key, genesis? })`, `append(type, payload)`,
`verify()`, and static `EventChain.verifyRecords(key, records, genesis?)`
to verify an external snapshot, plus `toSnapshot` / `fromSnapshot`,
`bySeq`, `byType`, `head`. New exports: `EventChain`,
`RESOURCE_EVENT_CHAIN`, `sha256Hex`, `sha256Bytes`, `hmacSha256Hex`,
`hmacSha256Bytes`.

INTEGRITY, NOT SECRECY: payloads are stored in the clear; the signature
proves they were not altered. The HMAC key is a runtime parameter, never
persisted or logged by the engine. Canonical JSON sorts object keys so
signing is order-independent; output is self-consistent within the engine
and is not promised byte-compatible with other languages' HMAC framing.

26 new tests (11 HMAC known-answer vectors + 15 EventChain integrity
checks) bring the suite to 4058 / 4058 green. Also corrects the long-stale
`LOOM_ENGINE_VERSION` constant (was '1.7.5', adrift since the 2.x bumps) so
it tracks package.json again, and rewrites the two version-pin tests
(smoke + webgl2-device) to read package.json dynamically so they can never
drift on a future release.

## 2.1.0 - 2026-05-17 (Bestiary - Trinity Wave 2.1 universal creature lifecycle kernel)

**One new pure-logic kernel.** `BestiaryKernel` is the universal NPC
creature lifecycle primitive: SoA storage at <100 bytes per creature,
generational 32-bit handles, per-slot pre-allocated BehaviorTree
instances, double-buffered death FX event ring, and zero-allocation
hot-loop ticks. Integrates the existing Trinity kernels through one
facade so consumers stop writing their own ad-hoc AI / spawn / death
pipelines:

- `SonicSync` perception drained into per-slot blackboards
- `LoomPulse` mood values pulled into BT context each tick
- `InferenceOrchestrator` cloud-lane requests submitted for T3+ only
- `NarrativeMemory` prior-death recall biases initial mood
- `BehaviorTree` instances drive intent (action, velocity, facing)
  per tick; the kernel reads intent and writes SoA

Ships with `CREATURE_CATALOG`: 6 skeleton variants for Wave 2.1 -
warrior, archer, caster (T1 fodder), bone reaver, choir skeleton
(T2 elite), and First Standing (T3 mini-boss with cloud inference).
Each variant declares spec data (sizeScale, palette key, BT id,
mood channel, audible signature, perception radius, inference lane,
death FX taxonomy, signature behaviors) so adding a new family
requires zero kernel code changes.

`defaultBehaviorTreeFactory` ships authored fallback BTs for all 6
variants - pursue / kite / channel / charge / wail / fallback-selector
patterns matching the signatureBehaviors field. Consumers can swap
the factory wholesale via `setBehaviorTreeFactory` for richer per-
variant authoring.

All 48 BestiaryKernel tests pass (full suite: 4032 / 4032 green,
up from 3984 at v2.0.0); 30 concurrent creatures × 60 ticks
completes in under 4ms on a desktop V8.

## 2.0.1 - 2026-05-15 (Description refresh - npm card + landing + README)

**No code changes.** Refreshes the engine description copy across
`package.json`, `README.md`, `landing/index.html` (loom-engine.pages.dev),
the GitHub repo subtitle, and the consumer-side TWT `/engine/` page.
The pre-Trinity copy ("Browser-first 2D / 2.5D game engine") undersold
what v2.0.0 actually shipped; new copy names the existing v1.x niches
(NarrativeMemory, RelationshipGraph + EmotionState, deterministic
replay) AND the Trinity Mainframe v2.0 kernel categories (acoustic
propagation, voxel mesh, packet routing, AI Director governance,
anti-cheat). npm card refresh requires this version bump because the
registry only refreshes description on publish.

## 2.0.0 - 2026-05-15 (Trinity Mainframe complete - 14 components, full Vol I + Vol II ingestion)

**Closes the Trinity Mainframe ingestion: 14 new pure-logic kernels
that take the Loom Engine from a Canvas2D / ECS engine into the
foundation of an AI-driven MMORPG runtime. Every kernel is the
single-thread / single-owner safe core that drives a deferred
WebGPU / WebTransport / WebCrypto / WASM-SIMD / SQLite-WAL
integration layer. All Codex hardening gates enforced inline; all
non-negotiable engine gates (no RNG, no wall clock, no Atomics,
fixed-capacity, every input bounds-checked) honoured across the
board.**

3984 tests pass (previously 3671); 313 new tests across the 14
components. tsc + build:demos + bench:fast all clean. No regression
in the existing surface; every Trinity export is additive.

### Volume I (§14, §16-§20)

- **§14 SonicSync** - acoustic propagation: Q16.16 fp source/listener
  pools, Amanatides-Woo 3D DDA voxel occlusion, double-buffered
  perception-event ring, (source, listener, semantic) cooldown hash.
  [PR #17](https://github.com/sadhaka/loom-engine/pull/17), 40 tests, 7 gates.
- **§16 LoomVerify** - anti-cheat verifier: PASS/RESYNC/REJECT
  verdicts, integer-only claim envelope, regional Merkle witnesses,
  key-epoch rotation with grace, value-class gated ZK escalation,
  TTL-decayed per-entity violation score.
  [PR #18](https://github.com/sadhaka/loom-engine/pull/18), 36 tests, 7 gates.
- **§17 NeuralMaterial** - PBR material synthesis: capability-gated
  PACKED_F16 / F16 / F32 path picker, atlas LRU + array-texture
  addressing, mipmap-ready bits, async job queue with stale-job
  drop, GPU-timestamp p50/p95 latency window.
  [PR #19](https://github.com/sadhaka/loom-engine/pull/19), 33 tests, 7 gates.
- **§18 InferenceOrchestrator** - NPC AI router: two lanes
  (LOCAL_SLM consented + CLOUD rate-limited), batched inference
  (no Promise per NPC), critical-priority budget ceiling, consent
  re-routing, post-inference allowed-action-mask validation.
  [PR #20](https://github.com/sadhaka/loom-engine/pull/20), 37 tests, 6 gates.
- **§19 LoomPulse** - player-vibe inference: Q16.16 EMA + confidence
  decay + hysteresis, default-deny consent kill switch, NO direct
  permanent-reputation surface, corroboration-required reputation
  read, atmosphere-impact clamp for "subtle local effects only".
  [PR #21](https://github.com/sadhaka/loom-engine/pull/21), 22 tests, 7 gates.
- **§20 LoomFlow** - adaptive networking: three integer lanes
  (UNRELIABLE_MOVEMENT / RELIABLE_COMBAT / RELIABLE_ECONOMY),
  per-lane sequence + epoch + idempotency, jitter buffer with TTL,
  per-client throttle hysteresis, WebTransport > WebRTC > WebSocket.
  [PR #22](https://github.com/sadhaka/loom-engine/pull/22), 37 tests, 6 gates.

### Volume II (§23, §24, §26-§31)

- **§23 NeuralAnimationSystem** - motion-matching + inertialization:
  Q16.16 feature DB, brute-force squared-L2 search, per-bone pose
  delta extraction at transitions, exponential decay via precomputed
  exp() LUT, foot-locking mask.
  [PR #23](https://github.com/sadhaka/loom-engine/pull/23), 24 tests, 6 gates.
- **§24 VoxelComputeSystem** - marching-cubes mesher: SoA per-chunk
  density (front/back epoch-swapped) + material, externally-loaded
  Bourke MC tables, capacity-checked vertex emit, pre-allocated
  counter-reset buffer for the GPU dispatcher.
  [PR #24](https://github.com/sadhaka/loom-engine/pull/24), 24 tests, 6 gates.
- **§26 AetherGrid** - N2N authority handoff: per-entity
  (ownerNode, epoch) fencing token, two-phase transfer state
  machine, per-fromNode idempotency dedup, split-brain detection,
  crash-recovery via checkpoint reload, control + data plane split.
  [PR #25](https://github.com/sadhaka/loom-engine/pull/25), 29 tests, 6 gates.
- **§27 LoomFSR** - temporal upscaler: precomputed Halton(2,3) jitter,
  per-channel ping-pong color/depth/normal history (no GPU copy),
  per-pixel reactive/disocclusion mask, FSR-class spatial sharpening,
  texture format/usage/alignment validation.
  [PR #26](https://github.com/sadhaka/loom-engine/pull/26), 26 tests, 7 gates.
- **§28 SealedAssetRegistry** - delayed-key disclosure: AES-GCM
  envelope packing, AAD binding (event/asset/version/contentHash),
  per-event entitlement + region scoped key release, opaque CDN-hash
  indirection, transferable-buffer accounting, generation counters
  for stale-callback rejection.
  [PR #27](https://github.com/sadhaka/loom-engine/pull/27), 27 tests, 7 gates.
- **§29 LoomForgeBridge** - WASM-SIMD physics integration: explicit
  Wasm build contract (importedSharedMemory + min/max pages + SIMD),
  single-source memory layout constants, initialized-flag gate,
  validated dt + activeCount, double-buffered position phase barrier.
  [PR #28](https://github.com/sadhaka/loom-engine/pull/28), 26 tests, 6 gates.
- **§30 GlobalStateLedger** - spatio-temporal persistence:
  (regionId, lamport64, nodeId, sequence) total ordering, per-delta
  idempotency + epoch, versioned NewValue codec, per-component
  merge-rule registry, atomic + auditable compaction, vector-DB
  marker bit (derived index only).
  [PR #29](https://github.com/sadhaka/loom-engine/pull/29), 27 tests, 7 gates.
- **§31 LoomStudioOrchestrator** - AI Director governance:
  per-tick double-buffered telemetry epoch, batched SLM query queue,
  per-queryType allowed-action-mask validation, fact proposals with
  (sourceId, expiresAtTick, telemetryEpoch, factTier) provenance,
  reserved fact-index 0 + VERIFIED-tier admin-only path.
  [PR #30](https://github.com/sadhaka/loom-engine/pull/30), 29 tests, 6 gates.

### Trinity protocol notes

Each kernel was implemented from the Trinity dossier (Gemini blueprint
+ Codex hardening audit) under a strict per-component workflow: a
fresh branch off main, the dossier sections re-read at fork time, the
6-7 Codex gates enforced explicitly with named tests, all three
verification gates (tsc / tsx --test / build:demos) green before any
push. Internal mechanic decisions (hashing, ring wrap policy, fp vs
float) were committed in code without escalation; product/scope/naming
decisions went through AskUserQuestion. The pure-logic core ships in
each kernel's .ts file; the deferred integration layer (WebGPU
dispatch, WebTransport channel binding, WebCrypto AES-GCM call,
wasm-simd module instantiation, SQLite WAL writes, etc.) is the next
ingestion wave.

### Naming collisions resolved by export aliasing

- `MaterialHandle` / `makeMaterialHandle` / `materialSlot` /
  `materialGeneration` (LoomDecay) vs `NeuralMaterialHandle` /
  `makeNeuralMaterialHandle` / `neuralMaterialSlot` /
  `neuralMaterialGeneration` (NeuralMaterial)
- `SLOT_STATE_FREE` / `_QUEUED` / `_RESIDENT` (AssetVirtualizer) vs
  `NEURAL_SLOT_STATE_*` (NeuralMaterial)
- `DESTROY_NONE` (AssetVirtualizer) vs `NEURAL_DESTROY_NONE`
  (NeuralMaterial)
- `AUDIT_RECORD_STRIDE` (BlackSwan) vs `PULSE_AUDIT_RECORD_STRIDE`
  (LoomPulse)
- `REASON_NONE` / `REASON_BAD_ACTION` (LoomVerify) vs
  `INFERENCE_REASON_NONE` / `INFERENCE_REASON_BAD_ACTION`
  (InferenceOrchestrator)

## 1.7.6 - 2026-05-14 (Generational-handle hardening + determinism verification harness)

**Hardens the ECS core against use-after-free, adds a deterministic
binary snapshot + per-tick hash for cross-runtime verification, and
cuts hot-loop allocation across the pools.**

Generational handles. EntityAllocator gains a per-slot alive bitmap
plus `destroyByLiveIndex(index)` and `entityAt(index)`: systems that
sweep a component pool by dense index no longer fabricate a
0-generation handle, which silently failed to destroy any recycled
slot and leaked it. Pool cross-reference fields - PursuePool /
RangedAttackPool / ProjectilePool target + owner - now store full
EntityId handles in Uint32Array instead of raw indices, so a target
whose slot was recycled into a fresh tenant fails the generation
check instead of being silently followed onto the wrong entity.

Determinism verification harness. New `runtime/state-snapshot.ts`:
SnapshotWriter / SnapshotReader (canonical little-endian byte
buffer), an ISnapshotable interface, StateSnapshot (frames the
registered parts and FNV-1a hashes them), and fnv1a32. EntityAllocator,
Entropy and all eight SoA component / vfx pools implement
ISnapshotable. `World.snapshotState()` builds a StateSnapshot of the
whole simulation - allocator + pools + RNG - in a fixed
cross-runtime-stable order; build it once, call `.hash()` per tick
as the determinism fingerprint. A model-based EntityAllocator
fuzzer checks random create / destroy / destroyByLiveIndex
sequences against a reference model.

Hot-loop allocation. ParticlePool / ProjectilePool gain `spawnRaw()`:
the spawn implementation as positional scalars, so
ParticleEmitterSystem and RangedAttackSystem no longer build a
spawn object + nested color objects per particle / shot. Every pool
gains `tighten()`, which lowers highWaterMark past trailing dead
slots so a create/destroy spike stops costing every future scan
(TransformPool and ParticleEmitterPool gain an explicit ATTACHED
flag for this). ComponentSignature.collectMatching scans the
high-water mark instead of the pow-2-rounded capacity and is
two-pass count-then-fill, dropping the intermediate growable array.

Hygiene. 108 stale generated .js / .js.map files removed from src/
(tsc emits to dist/; the src copies had drifted from the .ts
sources and are now gitignored). tsconfig.demo.json drops the
deprecated baseUrl option.

## 1.7.5 MILESTONE - 2026-05-10 (Wave 1.7 networking COMPLETE)

**ChatChannel + ChatChannelRegistry — moderated multi-channel chat
with rate limit + filter hooks. Closes Wave 1.7 networking.**

ChatChannel: per-channel member roster + rolling message history +
per-sender rate limit (N msgs in M ms) + filter chain. Filters are
consumer-supplied predicates that pass / drop / transform messages
(badword filter, sanitizer, link rewriter, etc). Filter exceptions
are caught + treated as drops (safe).

ChatChannelRegistry: multi-channel container so a chat app can
manage many parallel channels (global, guild, party, whisper) by id
without juggling instances.

Public surface (ChatChannel): `create({ id, historySize?,
rateLimitMessages?, rateLimitWindowMs?, maxBodyLen? })`,
`join(id, now)`, `leave(id)`, `send(senderId, body, now, meta?)`
returning SendResult, `installFilter(fn)`, `uninstallFilter(fn)`,
`recent(limit?)`, `sendsInWindow(senderId, now)`, `members$ /
hasMember / memberCount / clearHistory`.

Public surface (Registry): `create()`, `create(opts)`, `get(id)`,
`has(id)`, `remove(id)`, `count()`, `ids()`, `clear()`.

SendResult.reason: 'not-member' | 'rate-limit' | 'filtered' |
'empty' | 'too-long'. Filter drops do NOT count toward rate limit
(consumer's moderation choice shouldn't punish sender mechanically).

Reference WebSocket adapter shipped (attachChatChannelToWs).
Inbound: join / leave / send (channelId routes to right channel).
Outbound onMessage(channelId, msg) for broadcast; onReject for
rate-limit / filter explanations.

Tests 3316 -> 3349 (+33). Pure addition.

### Wave 1.7 networking - COMPLETE
Five primitives shipped (1.7.0 PresenceTracker, 1.7.1 LobbyState,
1.7.2 MatchmakingPool, 1.7.3 AuthorityHandoff, 1.7.4 LagCompensation,
1.7.5 ChatChannel) + matching WebSocket reference adapters. Engine
remains transport-agnostic; adapters demonstrate one wire pattern.

## 1.7.4 - 2026-05-10 (Wave 1.7 networking)

**LagCompensation — client-side rollback netcode primitive.**
Stores a circular buffer of (tick, state) snapshots + (tick, input)
records. When authoritative state arrives for a past tick, rewind()
returns the snapshot at-or-before that tick PLUS the inputs recorded
since, so the consumer's tick function can re-simulate forward from
the auth state. resync() drops obsolete history + returns the inputs
needing re-application.

Public surface: `create({ historySize?, stateSerialize? })`,
`recordState(tick, state)`, `recordInput(tick, input)`, `rewind(tick)`
returning RewindResult | null, `resync(tick, authState)` returning
surviving inputs, `snapshotCount / inputCount / oldestSnapshotTick /
newestSnapshotTick / newestInputTick / setHistorySize / clear`.

Out-of-order input arrival handled (sorted insert). Optional
stateSerialize lets consumer deep-clone snapshots so post-record
mutation doesn't poison the history.

Reference WebSocket adapter shipped (attachLagCompensationToWs).
Inbound: input / state / auth-state / rewind. Outbound onResync()
fires after auth-state ingest with surviving inputs to re-apply.

Tests 3295 -> 3315 (+20). Pure addition. Pairs with PresenceTracker
(1.7.0) for round-trip ping; with AuthorityHandoff (1.7.3) for who
emits authoritative state.

## 1.7.3 - 2026-05-10 (Wave 1.7 networking)

**AuthorityHandoff — host election + failover when current authority drops.**
Tracks a current host across a peer set; on heartbeat expiry of the
host, promotes the next candidate via deterministic election. Pairs
with PresenceTracker (1.7.0) for the heartbeat signal. Three election
strategies: 'oldest' (earliest firstSeenAt wins, most stable),
'lowest-id' (lex order, deterministic across peers without coordination),
or a custom function over the peer list.

Public surface: `create({ hostId?, timeoutMs?, electionStrategy? })`,
`heartbeat(id, now)`, `setHost(newHost|null, now)`, `removePeer(id, now)`,
`tick(now)` returning AuthorityChange | null, `elect()` for diagnostics,
`getHostId / hasPeer / peerCount / list / setTimeoutMs / clear`.

AuthorityChange.kind: 'handoff' | 'host-leave' | 'no-host' | 'reclaim'.

Reference WebSocket adapter shipped (attachAuthorityHandoffToWs).
Inbound: heartbeat / leave / set-host / tick. Outbound onChange()
broadcasts new host to peers so they agree on the new authority.

Tests 3274 -> 3294 (+20). Pure addition.

## 1.7.2 - 2026-05-10 (Wave 1.7 networking)

**MatchmakingPool — skill-based pairing with widening windows.**
Players queue with a skill rating + party size; tick() greedily
groups them by sorted skill within a per-player skill window that
EXPANDS the longer they wait. Rare-skill / low-traffic queues
resolve eventually instead of starving. The longest-waiting player
in a candidate group drives the match window (the smallest range
across the party wins).

Public surface: `create({ partySize?, initialSkillRange?,
expansionPerSec?, maxSkillRange?, maxEntries? })`, `queue(id,
skill, now, opts?)`, `cancel(id)`, `tick(now)` (returns matches +
removes matched ids), `currentRange / waitMs / has / get / count
/ list / clear`. Buckets by partySize so a 4-player queue can't
fill from a 2-player request.

Tests 3252 -> 3274 (22 new). Pure addition. Pairs with
PresenceTracker (1.7.0) for liveness checks before honoring
matches; with LobbyState (1.7.1) to spin up a lobby per match.

## 1.7.1 - 2026-05-09 (Wave 1.7 networking)

**LobbyState — pre-game waiting room with ready states.**
Players join, mark ready, leave, get kicked. Lobby starts when
minSize is met AND every member is ready. First-joiner becomes
host; on host-leave, the next-oldest member is auto-promoted.
Optional per-member timeout sweeps via `tick(now)`.

Public surface: `create({ id, minSize?, maxSize?, hostId?,
memberTimeoutMs? })`, `join / leave / kick / markReady / touch /
tick / canStart / start / end / setHost`. State machine: waiting
-> started -> ended.

Tests 3234 -> 3252 (18 new). Pure addition. Pairs with
PresenceTracker (1.7.0) for member-timeout heartbeats.

## 1.7.0 - 2026-05-09 (Wave 1.7 networking opens)

**PresenceTracker — online roster with heartbeat + auto-timeout.**
"Who is online right now?" Tracks per-key last-heartbeat ms;
entries auto-expire after a configurable timeout. Foundation for
LobbyState (1.7.1), AuthorityHandoff (1.7.3), ChatChannel (1.7.5
milestone).

Public surface: `create({ timeoutMs?, maxEntries? })`,
`heartbeat(id, data, now)`, `tick(now)` (sweeps + returns expired
ids), `get(id)`, `has(id)`, `list()`, `count()`, `staleCount(now)`,
`remove(id)`, `clear()`, `setTimeoutMs(ms)`. maxEntries triggers
LRU eviction by lastSeenAt on insert.

Tests 3218 -> 3234 (16 new). Pure addition.

## 1.6.5 - 2026-05-09 (Wave 1.6 procgen MILESTONE)

**WorldSeed — single-seed reproducible worlds.**
The capstone of Wave 1.6. One seed string deterministically
reproduces an entire world: a name, regions, biomes, dungeons,
elevation + moisture maps. Stitches all five Wave 1.6 enabling
primitives + NameGenerator into one call:

  NameGenerator (1.6.0)     -> world / region / dungeon names
  NoiseField (1.6.1)        -> elevation + moisture scalar fields
  VoronoiPartition (1.6.2)  -> region boundaries
  DungeonGenerator (1.6.3)  -> N dungeons placed at region centers
  BiomeMixer (1.6.4)        -> per-cell biome classification

Each primitive gets its own derived sub-seed so they are
independently reproducible AND the whole world is reproducible.

### Public surface

- `WorldSeed.create({ seed, nameCorpus? })`
- `generateWorld({ width, height, regionCount?, dungeonCount?,
   dungeonWidth?, dungeonHeight?, biomes?, elevationScale?,
   moistureScale?, octaves? })` -> `WorldSeedSnapshot`
- `WorldSeedSnapshot`:
  - `seed`, `worldName`, `width`, `height`
  - `elevation: Float32Array(width * height)`
  - `moisture: Float32Array(width * height)`
  - `biomeId: Uint16Array(width * height)`  (index into `biomeNames`)
  - `regionId: Uint16Array(width * height)` (index into `regions`)
  - `biomeNames: string[]`
  - `regions: WorldRegion[]`
  - `dungeons: WorldDungeon[]` (each with placement + DungeonResult)
- `RESOURCE_WORLD_SEED` constant.

### Wave 1.6 procgen depth - complete

  1.6.0  NameGenerator      - Markov-chain procedural names
  1.6.1  NoiseField         - deterministic 2D fractal noise
  1.6.2  VoronoiPartition   - 2D region partitioning
  1.6.3  DungeonGenerator   - BSP rooms + corridors
  1.6.4  BiomeMixer         - Whittaker climate classifier
  1.6.5  WorldSeed          - single-seed reproducible worlds (this)

### Tests

3199 -> 3218 (19 new). Includes byte-for-byte determinism test:
two WorldSeeds with the same seed produce identical
`elevation`/`moisture`/`biomeId`/`regionId` arrays + identical
region + dungeon names.

### Backwards compatibility

Pure addition. Type renamed `WorldSnapshot` -> `WorldSeedSnapshot`
to avoid collision with the existing save-system `WorldSnapshot`
(0.45). No existing exports affected.

## 1.6.4 - 2026-05-09 (Wave 1.6 procgen)

**BiomeMixer — Whittaker-style biome classifier.**
Each biome is a rectangle in (elevation, moisture) space. Pass
two scalar samples in, get the matching biome id (or fallback) out.
First-match-in-insertion-order, so layered cases work naturally.
Pairs with NoiseField (1.6.1) - feed elevation + moisture noise
fields through it to label a tile map.

Public surface: `create<T>()`, `defineBiome({ id, minElev?, maxElev?,
minMoist?, maxMoist?, data? })`, `removeBiome(id)`, `setFallback(id)`,
`classify(elev, moist)`, `classifyFull(elev, moist)`, `list()`,
`count()`, `hasBiome(id)`, `clear()`.

Tests 3184 -> 3199 (15 new). Pure addition.

## 1.6.3 - 2026-05-09 (Wave 1.6 procgen)

**DungeonGenerator — BSP rooms-and-corridors layout.**
Produces a 2D tile map (0 = wall, 1 = floor) plus the room +
corridor lists that built it. Uses Binary Space Partitioning to
recursively split the map, places one room per leaf, connects
sibling rooms via L-shaped corridors. Standard roguelike pattern.

Public surface: `create({ seed?, width, height, minRoomSize?,
maxRoomSize?, minLeafSize?, maxDepth? })`, `generate()` ->
`{ width, height, tiles: Uint8Array, rooms[], corridors[] }`.

Tests 3170 -> 3184 (14 new). Includes a flood-fill connectivity
test verifying every room is reachable from rooms[0]. Pure addition.

## 1.6.2 - 2026-05-09 (Wave 1.6 procgen)

**VoronoiPartition — 2D Voronoi region partitioning.**
Pick N seed points in a rectangle; for any (x, y), the "site" is
whichever seed is nearest. Result: tiling of the rectangle into
N polygonal regions. Used for biome borders, district maps,
fault lines, region boundaries on a generated world.

Public surface: `create({ seed?, width, height, count, distance?,
sites? })`, `nearestSite(x, y)`, `twoNearest(x, y)`, `onBoundary(x, y, eps)`,
`sites()`, `count()`, plus `getWidth / getHeight / getDistance`.
Distance metrics: `'euclidean'` (default, squared internally) /
`'manhattan'` / `'chebyshev'`. Brute-force O(N) per query - fine for
the 32-128 site range typical of region maps.

Tests 3155 -> 3170 (15 new). Pure addition.

## 1.6.1 - 2026-05-09 (Wave 1.6 procgen)

**NoiseField — deterministic 2D fractal noise (multi-octave).**
Workhorse for terrain elevation, moisture maps, density fields,
fog. Same seed + same (x, y) always returns the same value, so
worlds reproduce from a seed string. Internal: value noise with
smootherstep interpolation + summed octaves, configurable
persistence + lacunarity + scale.

Public surface: `create({ seed?, octaves?, persistence?,
lacunarity?, scale? })`, `sample(x, y)` -> [-1, 1], `sample01(x, y)`
-> [0, 1], `setSeed(seed)`, plus `getSeed / getOctaves /
getPersistence / getLacunarity / getScale` for diagnostics.

Tests 3140 -> 3155 (15 new). Pure addition.

## 1.6.0 - 2026-05-09 (Wave 1.6 procgen opens)

**NameGenerator — Markov-chain procedural names.**
Trains an order-N character chain on a corpus, then emits new
names that read like the corpus but aren't in it. FNV-1a hashed
seeds + mulberry32 RNG = deterministic by default; same seed +
same corpus + same options always gives the same sequence.

Public surface: `create({ seed?, order?, startToken?, endToken? })`,
`train(corpus[])`, `generate({ minLen?, maxLen?, maxAttempts?,
titleCase? })`, `setSeed(seed)`, `reset()`, `count()`, `states()`.
Order 1/2/3 supported; default 2.

Tests 3125 -> 3140 (15 new). Pure addition.

## 1.5.5 - 2026-05-09 (Wave 1.5 educational MILESTONE)

**KnowledgeMap — prerequisite-graph topology for learning + skill trees.**
The capstone primitive of Wave 1.5. ProgressTracker (1.5.4) holds
per-skill mastery; KnowledgeMap is the structure that says WHICH
skills matter and IN WHAT ORDER. Each topic links to a mastery skill
via `masterySkillId`; prerequisite edges say "you can't unlock topic
B until topic A's mastery passes a threshold." Pair gives the standard
learning-app + skill-tree + quest-dependency-graph pattern.

### Added

- `src/runtime/knowledge-map.ts` - `KnowledgeMap<T>` class
  (type-generic over per-topic payload):
  - `create<T>({ minMasteryThreshold? })` - default threshold 0.7.
  - `addTopic({ id, name, masterySkillId?, data? })` - link to a
    ProgressTracker skill (or leave bare for milestone/lore topics
    that gate without quizzes).
  - `addPrerequisite(prerequisiteId, dependentId, threshold?)` -
    directed edge with optional per-edge threshold override.
    Rejects self-loops, missing endpoints, duplicates, and cycles
    (BFS reachability check on the outgoing graph).
  - `removeTopic(id)` - drops the topic AND all its incoming +
    outgoing edges from neighbor lists.
  - `removePrerequisite(prerequisiteId, dependentId)`.
  - `prerequisitesOf(id)` / `dependentsOf(id)`.
  - `isUnlocked(id, masterySource)` - all prereq edges satisfied?
    Topics with no prereqs are always unlocked.
  - `unlocked(masterySource)` / `locked(masterySource)`.
  - `getMastery(id, masterySource)` - read mastery via the linked
    skill; 0 for unlinked topics or missing skills.
  - `learningPath(targetId)` - DFS topo sort, returns ordered list
    of all transitive prereqs ending at the target. Returns null
    on cycle or missing target.
  - `list()` / `count()` / `clear()` / `dispose()`.
- `MasterySource` interface: `{ getSkill(id): { overallMastery: number } | null }`.
  ProgressTracker's `getSkill` matches this shape natively, so the
  pair drops in without an adapter.
- `RESOURCE_KNOWLEDGE_MAP` constant.

### Tests

3098 -> 3125 (27 new). Direct integration test demonstrates passing
a `ProgressTracker` instance straight into `isUnlocked()`.

### Backwards compatibility

Pure addition. Wave 1.5 educational depth complete: ChartRenderer
(1.5.0) + TimelineLedger (1.5.1) + GraphLayout (1.5.2) +
QuestionBank (1.5.3) + ProgressTracker (1.5.4) + KnowledgeMap (1.5.5).

## 1.5.4 - 2026-05-09

**ProgressTracker — skill mastery ledger using Bloom's taxonomy.**
Used for learning-progress dashboards, adaptive content selection
(only show advanced material once basics are mastered), achievement
milestones based on mastery, learning analytics. Each skill tracks
per-level mastery (0..1) across Bloom's six cognitive levels
(remember / understand / apply / analyze / evaluate / create) plus
a weighted aggregate.

### Added

- `src/runtime/progress-tracker.ts` - `ProgressTracker<T>` class
  (type-generic over per-skill payload):
  - `create<T>({ now?, defaultDecayPerDay? })`.
  - `defineSkill({ id, name, decayPerDay?, levelWeights?, data? })` -
    `levelWeights` defaults favor higher Bloom's levels.
  - `recordEvidence(skillId, level, score, now?)` - EMA toward
    score (alpha=0.3 = ~3-4 events for 75% influence).
  - `tick(now?)` - applies decay since last tick.
  - `getSkill(id)` returns
    `{ id, name, levels (per-Bloom), overallMastery, evidenceCount, lastEvidenceAt, data? }`.
  - `list()` / `count()`.
  - `highMastery(threshold)` / `lowMastery(threshold)` - filtered
    skill lists.
  - `resetSkill(id)` / `removeSkill(id)` / `hasSkill(id)`.
  - `clear()` / `dispose()`.
- `BloomLevel`: `'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create'`.
- `overallMastery` is weighted average across **measured** levels
  using per-skill `levelWeights` (default ascending). Untouched
  levels are excluded so they do not dilute the aggregate; a
  skill practiced only at `remember` and `create` reads as the
  weighted blend of just those two.
- Engine doesn't pin to wall clock; consumer supplies `now` /
  clock seam.
- `RESOURCE_PROGRESS_TRACKER` constant.

### Tests

3078 -> 3098 (20 new).

### Backwards compatibility

Pure addition. Pairs with QuestionBank (1.5.3, evidence source -
quiz scores feed mastery), KnowledgeMap (1.5.5 capstone,
prerequisite gating), ChartRenderer (1.5.0, mastery-over-time
visualization).

## 1.5.3 - 2026-05-09

**QuestionBank — quiz items + SM-2 spaced repetition scheduler.**
Used for learning apps, in-game tutorials with knowledge checks,
training simulations, language flashcards. Implements SuperMemo 2
(SM-2): each item has an ease factor, interval (days), and
repetition count. After each review, the consumer passes a 0-5
rating and the algorithm updates state to schedule the next
review.

### Added

- `src/runtime/question-bank.ts` - `QuestionBank<T>` class
  (type-generic over per-item payload):
  - `create<T>({ now?, initialEaseFactor?, minEaseFactor? })`.
    Defaults: clock returns 0, ease 2.5, min 1.3.
  - `add({ id, prompt, answers?, correct?, tags?, data? })` -
    starts with fresh SRS state.
  - `remove(id)` / `has(id)` / `get(id)` / `count`.
  - `reviewState(id)` returns full SRS state
    `{ easeFactor, intervalDays, repetitions, nextReviewAt, lastReviewAt, totalReviews, lastRating }`.
  - `due({ now?, limit?, tag? })` - items where nextReviewAt <=
    now, sorted asc.
  - `review(itemId, rating, now?)` - apply SM-2 update:
    - `rating < 3` resets interval to 1 day, repetitions=0.
    - `rating >= 3`: interval grows (1 → 6 → 6 × ease → ...).
    - `easeFactor` adjusts per `q` per SM-2 formula; clamped to
      minEase.
    - Returns updated state.
  - `skip(itemId, now?)` - push to tomorrow without changing SRS.
  - `reset(itemId, now?)` - back to fresh state.
  - `byTag(tag)` / `list` / `totalReviews` / `unreviewed`.
  - `clear()` / `dispose()`.
- Engine doesn't pin to wall clock; consumer passes ms-timestamp
  via `now` (or supplies a clock seam).
- `RESOURCE_QUESTION_BANK` constant.

### Tests

3053 -> 3078 (25 new).

### Backwards compatibility

Pure addition. Pairs with ProgressTracker (1.5.4 next, mastery
levels), KnowledgeMap (1.5.5 capstone, prerequisite graph),
TimelineLedger (1.5.1, review history visualization).

## 1.5.2 - 2026-05-09

**GraphLayout — force-directed node graph layout.** Used for
knowledge maps (concept relationships), NPC relationship diagrams,
quest dependency graphs, skill trees, network topology displays.
Nodes repel each other (Coulomb-like 1/r²), edges pull connected
nodes together (Hooke spring), optional center force keeps the
graph from drifting. Each tick integrates forces and updates
positions.

### Added

- `src/runtime/graph-layout.ts` - `GraphLayout<T>` class
  (type-generic over per-node payload):
  - `create<T>({ repulsion?, attraction?, damping?, centerForce?, stableThreshold?, rng?, seed?, maxStabilizeIterations? })`.
    Defaults: 1000 / 0.05 / 0.85 / 0.01 / 0.5 / mulberry32.
  - `addNode({ id, x?, y?, mass?, pinned?, data? })` - random
    initial position if x/y omitted.
  - `removeNode(id)` - drops node + connected edges.
  - `hasNode` / `getNode` / `setPosition` / `setPinned` / `nodeCount`.
  - `addEdge({ fromId, toId, restLength?, strength? })` - rejects
    self-loops, unknown nodes, duplicates. Default rest 50, strength 0.1.
  - `removeEdge(from, to)` / `hasEdge(from, to)` / `edgeCount`.
  - `tick(dtMs)` - one simulation step (16ms = 1 unit of force
    integration).
  - `stabilize(maxIterations?)` - run ticks until energy <
    threshold or maxIter reached. Returns iteration count used.
  - `positions()` - all `NodePosition` snapshots.
  - `getSnapshot()` returns
    `{ nodes, edges (with from/to coords), energy, isStable }`.
  - `forEach(cb)` / `clear()` / `dispose()`.
- Pinned nodes are anchors (don't move under forces).
- Mass scales force impact (heavier = harder to move).
- Energy = sum of squared velocities; `isStable` when energy <
  threshold.
- All callbacks isolated.
- NaN / Infinity / negative dt no-op.
- `RESOURCE_GRAPH_LAYOUT` constant.

### Tests

3031 -> 3053 (22 new).

### Backwards compatibility

Pure addition. Pairs with TimelineLedger (1.5.1, time-axis events),
RegionGraph (1.2.1, world topology - feed it nodes + edges),
RelationshipGraph (1.3.1, character bonds visualizable here).

## 1.5.1 - 2026-05-09

**TimelineLedger — events along a time axis (history view,
replay scrubber, lesson timeline).** ChartRenderer (1.5.0) is for
X/Y data series. TimelineLedger is purpose-built for time-anchored
EVENTS: a flag at t=300s, a milestone at t=1200s, a phase change
at t=1800s. The consumer's renderer reads `getSnapshot().events`
each frame and draws ticks / pins / labels along the timeline UI.

### Added

- `src/runtime/timeline-ledger.ts` - `TimelineLedger<T>` class
  (type-generic over per-event payload):
  - `create<T>({ width, paddingLeft?, paddingRight? })`.
  - `add({ id, atTime, kind, label?, tags?, payload? })`.
  - `remove(id)` / `has(id)` / `get(id)` / `count()`.
  - `list()` - all events sorted by atTime asc.
  - `byRange(start, end)` / `byKind(kind)` / `byTag(tag)`.
  - `setWindow(startTime, endTime)` - explicit visible window;
    disables auto-window.
  - `resetWindow()` / `getWindow()` - re-enable auto from data.
  - `setSize(width, paddingLeft?, paddingRight?)`.
  - `totalRange()` - { startTime, endTime } across all events.
  - `getSnapshot()` returns
    `{ width, paddingLeft, paddingRight, window, totalRange, events[] }`
    with each event mapped to screen `px` and `inWindow` /
    `windowPct`.
  - `forEach(cb)` / `clear()` / `dispose()`.
- Engine treats `atTime` as opaque scalar (ms / game-tick /
  lesson-position - all work).
- Auto-window: when no explicit `setWindow`, view auto-fits to
  data range.
- All callbacks isolated.
- `RESOURCE_TIMELINE_LEDGER` constant.

### Tests

3006 -> 3031 (25 new).

### Backwards compatibility

Pure addition. Pairs with ChartRenderer (1.5.0, line/bar/scatter),
ReplayRecorder (0.58, deterministic event recording),
NarrativeMemory (1.3.5, remembered events).

## 1.5.0 - 2026-05-09

**Wave 1.5 educational / interactive sim depth opens —
ChartRenderer: line / bar / scatter chart render-state.**
Tutorials, dashboards, training apps, learning platforms, in-game
stat screens, end-of-run summaries - they all want charts.
ChartRenderer is the data + axis + scaling layer the consumer's
renderer reads each frame to draw lines, bars, scatter plots.

### Added

- `src/runtime/chart-renderer.ts` - `ChartRenderer` class:
  - `create({ width, height, padding?, autoFitX?, autoFitY? })`.
  - `addSeries({ id, kind?, points, color?, label?, data? })`.
    Default kind 'line'. Points accept tuples `[x, y]` OR
    objects `{ x, y }`.
  - `updatePoints(id, points)` / `removeSeries(id)` / `hasSeries(id)` /
    `seriesCount`.
  - `setAxisRange(axis, min, max)` - explicit axis range; disables
    auto-fit for that axis.
  - `resetAxis(axis)` - re-enable auto-fit.
  - `getAxisRange(axis)`.
  - `setSize(width, height)`.
  - `getSnapshot()` returns
    `{ width, height, plotArea, axisX, axisY, series[] }` with
    points already mapped to screen coords (pixels).
  - `toScreen(x, y)` - convert one data point to pixels.
  - `forEach(cb)` / `list()` / `clear()` / `dispose()`.
- Engine ships zero render path - consumer reads `RenderedSeries.points`
  (each with `px`, `py`, `x`, `y`) and draws in whatever style fits
  (Canvas2D, WebGL, SVG, DOM).
- Y-axis is inverted at render time (data y up, screen y down).
- Non-finite points are filtered.
- All callbacks isolated.
- `RESOURCE_CHART_RENDERER` constant.

### Tests

2984 -> 3006 (22 new).

### Backwards compatibility

Pure addition. Pairs with TimelineLedger (1.5.1 next, time-series
events), NumberFormatter (0.98, axis tick labels), Localization
(0.46, chart titles).

## 1.4.5 - 2026-05-09

**🟧 Wave 1.4 milestone — SoundtrackDirector: context-driven
music orchestration.** The conductor that ties all audio
primitives together. MusicPlaylist (0.95) shuffles tracks within
a mood. AmbientLayerMixer (1.4.0) layers ambient stems. AudioDuck
(1.4.1) ducks music for SFX. SoundtrackDirector is the
orchestrator on top: define music states (peace, combat, dialog,
boss, victory), define transitions between them with per-pair
fade timings + min-hold rules, and play one-shot stingers
(cinematic flourishes) over the current state.

### Added

- `src/runtime/soundtrack-director.ts` - `SoundtrackDirector` class:
  - `create({ rng?, seed? })` - default seeded mulberry32 PRNG.
  - `defineState({ id, trackIds, transitions?, defaultFadeMs?, minHoldMs?, data? })`.
    `transitions: { sourceStateId: { fadeMs } }` for per-pair
    overrides. `minHoldMs` enforces a minimum stay-time.
  - `hasState(id)` / `stateIds()`.
  - `setState(stateId, { fadeMs?, force? })` - transition. Returns
    false if unknown state OR minHoldMs not yet elapsed (unless
    force).
  - `getCurrentState()` / `pickTrack(stateId?)`.
  - `playStinger({ id, trackId, durationMs, resumeAfter? })` -
    one-shot flourish. `resumeAfter: true` (default) restores
    the state after the stinger ends.
  - `cancelStinger(id)`.
  - `getSnapshot()` returns
    `{ currentState, currentTrackId, previousState, previousTrackId, fadeProgress, stinger? }`.
  - `tick(dtMs)` - ages current state, advances fade, ages stinger.
  - `clear()` / `dispose()`.
- Track selection within a state uses the seeded RNG (deterministic
  for replays).
- `RESOURCE_SOUNDTRACK_DIRECTOR` constant.

### Tests

2961 -> 2984 (23 new).

### Backwards compatibility

Pure addition. Pairs with MusicPlaylist (0.95, the per-state
track shuffler), AmbientLayerMixer (1.4.0), AudioCueQueue (0.94),
AudioDuck (1.4.1).

### 🟧 Milestone — Wave 1.4 audio / cinematic depth complete

**6 versions shipped (1.4.0 → 1.4.5)**: AmbientLayerMixer
(cross-faded ambient stems), AudioDuck (auto-music-ducking on
SFX), SubtitleQueue (timed dialog / caption display),
VoiceLineQueue (per-channel VO with interruption + resume),
CinematicLetterbox (cutscene framing bars), SoundtrackDirector
(state-machine music orchestration).

Together these deliver a **complete cinematic audio + visual
framing pipeline**: ambient bed under music under VO under SFX
under stingers, with subtitles, ducking, and letterboxing - all
without engine-level audio code (consumer brings the audio bus).

### Wave 1.5+

Roadmap continues per Misha's "ask me" cadence: themes proposed
via AskUserQuestion after each milestone. Engine adaptability
vision (project_engine_adaptability_vision.md) directs themes
toward broadening the engine's APPLICABLE DOMAIN (sim / strategy
/ multiplayer / proc-gen / educational / accessibility / etc.),
not just deepening action-RPG.

## 1.4.4 - 2026-05-09

**CinematicLetterbox — cutscene framing bars with smooth open/close.**
Standard movie-style framing for cutscenes / dialogue / boss
reveals: black bars slide in from top + bottom to crop the frame,
then slide out when the moment ends.

### Added

- `src/runtime/cinematic-letterbox.ts` - `CinematicLetterbox` class:
  - `create({ defaultBarPct?, defaultFadeMs? })`. Defaults 0.12 / 600ms.
  - `close(opts?)` - slide bars in (target=1).
  - `open(opts?)` - slide bars out (target=0).
  - `toggle(opts?)` - flip between open / closed.
  - `setTarget(value, opts?)` - manual 0..1 control.
  - `pulse({ barPct?, holdMs?, fadeMs?, onComplete? })` - one-shot
    flash: close, hold, open.
  - `getState()` returns `{ current, target, topBarPct, bottomBarPct, isAnimating }`.
  - `isOpen()` / `isClosed()` / `isAnimating()`.
  - `tick(dtMs)` / `dispose()`.
- Engine ships zero render path - consumer reads `topBarPct` /
  `bottomBarPct` and draws the bars.
- All callbacks isolated.
- NaN / Infinity / negative dt no-op.
- `RESOURCE_CINEMATIC_LETTERBOX` constant.

### Tests

2945 -> 2961 (16 new).

### Backwards compatibility

Pure addition. Pairs with CameraDirector (1.1.3, camera moves),
CutsceneSequencer (1.1.4, broader timeline), AmbientLayerMixer
(1.4.0, ambient bed often dips during letterboxed sequences).

## 1.4.3 - 2026-05-09

**VoiceLineQueue — per-channel interruption-aware VO queue.**
DialogVoice (1.3.3) is dialog-tree-bound. VoiceLineQueue is the
general VO surface: per-channel queues for narrator, system
announcements, NPC barks, training prompts. Each channel has its
own queue. Higher-priority lines interrupt lower on the same
channel; interrupted lines optionally resume.

### Added

- `src/runtime/voice-line-queue.ts` - `VoiceLineQueue` class:
  - `create({ onStart?, onEnd?, onInterrupt? })`.
  - `enqueue({ id, cueId, durationMs, channel?, priority?, resumeOnInterrupt?, data? })`.
    Default channel `'default'`, priority 0.
  - `cancelLine(id)` - cancel anywhere; advances queue if active.
  - `cancelChannel(channelId)` - clear active + queue.
  - `pauseChannel(id)` / `resumeChannel(id)` - pause halts tick
    advancement on that channel.
  - `setChannelMute(id, muted)` / `isMuted(id)` - muted channels
    return null from `getActive`.
  - `getActive(channelId)` - currently playing line or null.
  - `isPlaying(channelId?)` - any channel by default.
  - `channels()` - active line snapshots across all channels.
  - `queueLength(channelId)` / `tick(dtMs)` / `clear` / `dispose`.
- Higher priority interrupts lower on same channel; queue
  insertion within channel sorted priority desc.
- `resumeOnInterrupt: true` re-queues the interrupted line at
  the front (preserving elapsedMs) so it resumes when the
  interrupting line ends.
- All callbacks isolated.
- NaN / Infinity / negative dt no-op.
- `RESOURCE_VOICE_LINE_QUEUE` constant.

### Tests

2922 -> 2945 (23 new).

### Backwards compatibility

Pure addition. Pairs with DialogVoice (1.3.3, dialog-bound),
AudioCueQueue (0.94, the actual audio playback), AudioDuck (1.4.1,
ducks music when high-priority lines play), SubtitleQueue (1.4.2,
the visual side - share `id`).

## 1.4.2 - 2026-05-09

**SubtitleQueue — timed subtitle display + fade for dialog,
captions, narrator.** ToastQueue (0.65) is global notifications.
TooltipQueue (0.97) is anchored UI hints. SubtitleQueue is the
dialog-bottom-of-screen surface: speaker-attributed lines that
appear in sync with voice, fade in / out, queue or display
concurrently.

### Added

- `src/runtime/subtitle-queue.ts` - `SubtitleQueue` class:
  - `create({ maxConcurrent?, onPush?, onRemoved? })`. Default
    maxConcurrent 3.
  - `push({ id, text, durationMs, speakerId?, priority?, fadeInMs?, fadeOutMs?, data? })`.
    durationMs=-1 = sticky. Same id replaces existing line.
  - `cancel(id)` - force fade-out.
  - `cancelAll()` / `clear()` - immediate removal of all lines.
  - `isShowing(id)` / `count()`.
  - `visible(maxLines?)` - top-priority lines, capped at
    maxConcurrent (or override). Sorted by priority desc.
  - `list()` - all lines (unfiltered).
  - `forEach(cb)` - iterates visible() result.
  - `tick(dtMs)` - advances state with per-phase dt accounting.
  - `dispose()`.
- States: `'fadeIn' | 'visible' | 'fadeOut'`. Alpha ramps
  computed each tick.
- Default fadeInMs 150, fadeOutMs 250.
- Priority filter: at most `maxConcurrent` lines visible; lower
  priorities still tick + age but don't render.
- All callbacks isolated.
- NaN / Infinity / negative dt no-op.
- `RESOURCE_SUBTITLE_QUEUE` constant.

### Tests

2899 -> 2922 (23 new).

### Backwards compatibility

Pure addition. Pairs with DialogVoice (1.3.3, the audio side -
share `id` to link subtitle to spoken line), DialogTree (0.61),
VoiceLineQueue (1.4.3 next).

## 1.4.1 - 2026-05-09

**AudioDuck — automatic music ducking when high-priority SFX
fires.** Classic mixer trick: when a critical sound fires (boss
roar, dialog line, story beat), the music + ambient bed
automatically dip in volume so the SFX stands out, then smoothly
restore. AudioDuck owns that timeline: trigger a duck event with
target channels, attack / release / hold timing, and ducked
volume. Mixer reads each channel's current multiplier per frame
and applies it.

### Added

- `src/runtime/audio-duck.ts` - `AudioDuck` class:
  - `create({})`.
  - `registerChannel({ id, baseVolume?, data? })`.
  - `setBaseVolume(id, volume)` / `removeChannel(id)` /
    `hasChannel(id)` / `channelCount`.
  - `triggerDuck({ id, durationMs?, attackMs?, releaseMs?, duckTo?, channels? })`.
    Defaults: attack 100ms, release 500ms, duckTo 0.3, all
    channels.
  - `cancelDuck(eventId)` - manually transition to release.
  - `hasEvent(eventId)` / `eventCount`.
  - `getChannelMultiplier(channelId)` - current duck multiplier
    (1 = unducked).
  - `getChannel(channelId)` returns
    `{ id, volume, baseVolume, isDucking, data? }`.
  - `tick(dtMs)` - advance phases (attack -> hold -> release ->
    done; auto-removes done events).
  - `forEach(cb)` / `list()` / `clear()` / `dispose()`.
- Multiple ducks on one channel: deepest (lowest multiplier) wins.
- `durationMs: 0` = manual-cancel-only (holds at duckTo until
  cancelDuck is called).
- All callbacks isolated.
- NaN / Infinity / negative dt no-op.
- `RESOURCE_AUDIO_DUCK` constant.

### Tests

2875 -> 2899 (24 new).

### Backwards compatibility

Pure addition. Pairs with AmbientLayerMixer (1.4.0, the layered
ambient bed), MusicPlaylist (0.95, music tracks), AudioCueQueue
(0.94, the SFX side that triggers ducks).

## 1.4.0 - 2026-05-09

**Wave 1.4 audio cinematic depth opens — AmbientLayerMixer:
cross-faded ambient music layer mixer.** MusicPlaylist (0.95) is
a track sequencer (one ambient track at a time). AmbientLayerMixer
is what plays UNDER the music: layered ambient stems (rain, wind,
crickets, distant battle) that fade in / out independently as
zone or context changes.

### Added

- `src/runtime/ambient-layer-mixer.ts` - `AmbientLayerMixer` class:
  - `create({ volumeClamp? })`. Default clamp `[0, 1]`.
  - `registerLayer({ id, volume?, target?, defaultFadeMs?, data? })`.
  - `removeLayer(id)` / `hasLayer(id)` / `getLayer(id)` /
    `layerCount` / `layerIds`.
  - `setTarget(id, target, { fadeMs? })` - lerp current toward
    target over fadeMs (default `defaultFadeMs` from spec, or
    1000ms).
  - `setTargets(targetsMap, opts?)` - batch update.
  - `snap(id, volume)` - shorthand for setTarget with fadeMs=0.
  - `silenceAll()` - snap every layer to 0.
  - `tick(dtMs)` - advance active fades.
  - `forEach(cb)` / `list()` / `clear()` / `dispose()`.
- Mid-fade `setTarget` restarts the lerp from the current
  in-flight volume (smooth handoff).
- All callbacks isolated.
- NaN / Infinity / negative dt no-op.
- `RESOURCE_AMBIENT_LAYER_MIXER` constant.

### Tests

2853 -> 2875 (22 new).

### Backwards compatibility

Pure addition. Pairs with MusicPlaylist (0.95, music tracks above
the ambient bed), AudioCueQueue (0.94, one-shot SFX), AudioBus,
AudioDuck (1.4.1 next, ducks ambient when SFX fires).

## 1.3.5 - 2026-05-09

**🟪 Wave 1.3 milestone — NarrativeMemory: cross-session NPC
recall ledger.** THE uniquely-Loom primitive: what NPCs REMEMBER
about the player across sessions. PersonaTrait (1.3.0) is who
they are. EmotionState (1.3.2) is how they feel right now.
RelationshipGraph (1.3.1) is who they care about. NarrativeMemory
is what they REMEMBER and recall when prompted.

Each fact: a (character, subject) pair with kind, content,
salience (vividness), tags, recorded time. Recall ranks by
salience × weight + recency × weight, filtered by tags / kind /
minSalience. Facts decay over time per their kind's half-life.
Cross-session: serialize to JSON, restore on next play.

### Added

- `src/runtime/narrative-memory.ts` - `NarrativeMemory<T>` class
  (type-generic over the per-fact payload):
  - `create<T>({ defaultKind?, onRemember?, onForget? })`.
  - **Kind specs**:
    - `defineKind({ id, decayHalfLifeMs?, autoPurgeBelow? })`.
      Default decay 86400000 (1 day); autoPurge 0.05.
    - `decayHalfLifeMs: 0` = permanent (trauma).
    - `autoPurgeBelow: 0` = never auto-purge.
    - `hasKind` / `kindIds`.
  - **Fact CRUD**:
    - `remember({ id, characterId, subjectId, kind, content, recordedAt, salience, tags?, data? })`
      - auto-defines unknown kind. Replaces if id exists.
    - `forget(factId)` / `forgetAbout(characterId, subjectId)`.
    - `has(factId)` / `get(factId)`.
    - `adjustSalience(factId, delta)` - reinforce / fade.
  - **Bulk reads**:
    - `factsAbout(characterId, subjectId)`.
    - `factsBy(characterId)`.
    - `factsAboutSubject(subjectId)`.
    - `list()` / `size()`.
  - **Recall** (the main read API):
    - `recall(characterId, subjectId, ctx?)` - returns ranked
      `RecallResult[]` with `recencyScore` and `rankScore`.
      ctx: `{ tags?, kind?, minSalience?, limit?, now?, recencyHalfLifeMs?, salienceWeight?, recencyWeight? }`.
      Default weights 0.6 salience / 0.4 recency.
    - `topMemory(characterId, subjectId, ctx?)` - convenience
      for limit:1.
  - **Decay**:
    - `tick(dtMs)` - decays every fact's salience per its kind's
      half-life. Auto-purges facts below threshold; fires onForget
      with reason 'purge'.
  - **Cross-session persistence**:
    - `exportSession(characterId?)` - JSON string of kinds + facts
      (optionally filtered by character).
    - `importSession(jsonString)` - merges kinds + facts; same id
      overwrites.
  - `clear()` / `dispose()`.
- All callbacks isolated.
- NaN / negative dt no-op.
- `RESOURCE_NARRATIVE_MEMORY` constant.

### Tests

2823 -> 2853 (30 new).

### Backwards compatibility

Pure addition. Pairs with PersonaTrait (1.3.0), RelationshipGraph
(1.3.1), EmotionState (1.3.2), DialogTree (0.61, dialog can
branch on recalled memories), DialogChoiceHistory (0.89, what was
said before).

### 🟪 Milestone — Wave 1.3 AI persona depth complete

**6 versions shipped (1.3.0 → 1.3.5)**: PersonaTrait (long-term
trait vector), RelationshipGraph (asymmetric per-pair bonds),
EmotionState (right-now mood gauges), DialogVoice (voice-line
scheduler), SchedulePlan (NPC daily routines), NarrativeMemory
(cross-session recall).

Together these make NPCs feel like **PEOPLE**, not state machines.
The most "uniquely Loom" wave - the layer most game engines don't
build because most games don't think about NPCs as long-term
acting agents. The Loom does.

What 1.3 unlocks at the consumer layer:
- Personality-driven dialog (DialogTree gated by PersonaTrait).
- Asymmetric relationships (Mira pines, Thane oblivious).
- Reactive emotion (panic threshold triggers berserker).
- Lip-synced voice lines with marker hooks.
- Living-world routines (Stardew-style schedule).
- True memory across sessions ("you stole from me last week").

Wave 1.4 (audio / cinematic depth) opens next: AmbientLayerMixer,
AudioDuck, SubtitleQueue, VoiceLineQueue, CinematicLetterbox,
SoundtrackDirector (1.4 milestone).

## 1.3.4 - 2026-05-09

**SchedulePlan — NPC daily routine ledger.** The Stardew Valley
/ Skyrim / Persona pattern: each NPC has a schedule of "at 8am
go to the bakery, at noon go to the temple, at 6pm go home."
SchedulePlan is the time-indexed registry: blocks per character
with start / end minute, location, activity, weekday filter,
optional gate predicate, and priority for overlap resolution.

### Added

- `src/runtime/schedule-plan.ts` - `SchedulePlan` class:
  - `create({})`.
  - `addBlock({ id, characterId, startMinute, endMinute, location, activity?, weekdays?, priority?, condition?, data? })`.
  - `removeBlock(id)` / `updateBlock(id, partial)` / `hasBlock(id)`
    / `getBlock(id)` / `blockCount`.
  - `current(characterId, ctx)` - highest-priority active block
    or null. Returns `ActiveBlock` with `progress` (0..1) and
    `remainingMinutes`.
  - `allActive(characterId, ctx)` - all matching blocks, no
    priority resolution.
  - `blocksFor(characterId)` - all regular blocks for a character.
  - `allCurrent(ctx)` - map of all characters → their current
    block (or null).
  - `list()` / `clear()` / `dispose()`.
- Block window supports midnight wrap (`startMinute > endMinute`
  means wraps through midnight, e.g. 22:00 → 06:00).
- Weekday filter (0=Sun..6=Sat). When ctx.weekday omitted,
  weekday filter is ignored (every-day match).
- Priority resolves overlap: higher wins; same-priority broken
  by insertion order (later wins).
- `condition(ctx)` predicate for gate; throwing predicate treated
  as false.
- `RESOURCE_SCHEDULE_PLAN` constant.

### Tests

2803 -> 2823 (20 new).

### Backwards compatibility

Pure addition. Pairs with PersonaTrait (1.3.0, who they are),
EmotionState (1.3.2, current mood), RegionGraph (1.2.1, the
location ids), EncounterTable (1.2.3, what spawns where).

## 1.3.3 - 2026-05-09

**DialogVoice — voice-line scheduler for DialogTree nodes.**
DialogTree (0.61) handles BRANCHING (which line plays next).
DialogVoice handles AUDIO + TIMING: each dialog node maps to a
voice cue id with a duration and inline markers (phonemes for
lip-sync, gesture triggers, emote shifts, scene beats). Plays
lines, manages a queue, supports interruption, fires markers as
time passes.

### Added

- `src/runtime/dialog-voice.ts` - `DialogVoice` class:
  - `create({})`.
  - `registerLine({ nodeId, cueId, durationMs, markers?, data? })`
    - markers auto-sorted by atMs at registration.
  - `unregisterLine(nodeId)` / `hasLine(nodeId)` / `getLine(nodeId)`
    / `lineCount`.
  - `play(nodeId, { speed?, onMarker?, onLineEnd?, autoAdvance? })`
    - replaces current line if any.
  - `playQueue({ nodeIds, ... })` - first plays now; rest queue;
    auto-advances on line end (unless autoAdvance: false).
  - `enqueue(nodeId, opts?)` - add to existing queue.
  - `interrupt()` - stops current + clears queue. Does NOT fire
    onLineEnd.
  - `pause()` / `resume()`.
  - `getCurrent()` returns `VoiceLineState | null`.
  - `tick(dtMs)` - advances elapsed; fires markers as crossed;
    fires onLineEnd at end; auto-advances to queue next.
  - `isPlaying` / `isPaused` / `queueLength` / `clear` / `dispose`.
- `VoiceMarker { atMs, kind, payload? }` - markers fire ONCE per
  play; kind is opaque to engine ('phoneme' / 'gesture' / 'emote'
  / 'beat' / consumer-defined).
- Engine ships zero audio: consumer reads `getCurrent()` /
  handles `onLineEnd` and routes `cueId` to AudioCueQueue (0.94)
  or other audio system.
- All callbacks isolated.
- NaN / Infinity / negative dt no-op.
- `RESOURCE_DIALOG_VOICE` constant.

### Tests

2780 -> 2803 (23 new).

### Backwards compatibility

Pure addition. Pairs with DialogTree (0.61, branching),
AudioCueQueue (0.94, the actual audio playback), CutsceneSequencer
(1.1.4, broader scripted timeline), DialogChoiceHistory (0.89).

## 1.3.2 - 2026-05-09

**EmotionState — per-character mood / fear / anger / joy gauges
with threshold callbacks.** PersonaTrait (1.3.0) is the LONG-TERM
bias of an NPC ("Mira is brave"). EmotionState is the RIGHT-NOW
state ("Mira is terrified at this moment"). Different timescale:
traits decay over hours; emotions decay over seconds. Pulse on
events, decay otherwise, fire threshold callbacks (panic, rage,
joy-spike) when intensities cross.

### Added

- `src/runtime/emotion-state.ts` - `EmotionState` class:
  - `create({ valueClamp?, onChange? })`. Default clamp `[-1, 1]`.
  - `defineEmotion({ id, baseline?, decayHalfLifeMs?, thresholds?, data? })`.
    Default decay 5000ms (vs 0 for traits).
  - `pulse(characterId, emotionId, delta)` - additive bump;
    auto-defines spec.
  - `set(characterId, emotionId, value)` - direct set.
  - `getValue` / `get` (full snapshot) / `has` / `remove`.
  - `isAbove(characterId, emotionId, threshold)` /
    `isBelow(...)` - quick gate checks.
  - `forCharacter(characterId)` - all emotions on one character.
  - `dominant(characterId)` - highest absolute value emotion;
    returns `DominantEmotion { ..., positive: boolean }` for
    rendering / facial expression.
  - `resetPeaks(characterId?)` - clear peak tracking.
  - `tick(dtMs)` - exponential decay toward baseline.
  - `removeEmotion(id)` - drops spec + all entries.
  - `entryCount` / `emotionCount` / `list` / `clear` / `dispose`.
- Threshold callbacks fire ONCE on upward cross; re-arm when
  value falls back below.
- Peak tracking: each entry tracks `peakValue` = highest absolute
  value reached.
- All callbacks isolated.
- `RESOURCE_EMOTION_STATE` constant.

### Tests

2751 -> 2780 (29 new).

### Backwards compatibility

Pure addition. Pairs with PersonaTrait (1.3.0, long-term bias),
RelationshipGraph (1.3.1, per-pair bonds), DialogTree (0.61, often
gated by emotion thresholds), VignetteRenderState (0.99, visualize
fear / panic as red overlay).

## 1.3.1 - 2026-05-09

**RelationshipGraph — per-pair character bonds (asymmetric).**
PersonaTrait (1.3.0) is what an NPC IS in isolation.
RelationshipGraph is who they CARE about, in both directions:
Mira's friendship for Thane is one bond; Thane's friendship for
Mira is a separate bond. The asymmetric model makes unrequited
love, one-sided rivalries, stalker dynamics, and uneven mentor-
student relationships expressible.

### Added

- `src/runtime/relationship-graph.ts` - `RelationshipGraph` class:
  - `create({ valueClamp?, onChange? })`. Default clamp `[-1, 1]`.
  - `defineBondType({ id, baseline?, decayHalfLifeMs?, data? })` -
    register a bond type.
  - `setBond(fromId, toId, bondType, value)` - directed bond;
    auto-defines spec.
  - `setMutual(aId, bId, bondType, value)` - sets both directions.
  - `adjustBond(fromId, toId, bondType, delta)` - additive update.
  - `getBond(fromId, toId, bondType)` - single bond snapshot.
  - `removeBond(fromId, toId, bondType)` / `hasBond`.
  - `bondsFor(characterId, filter?)` - outgoing bonds.
  - `bondsTo(characterId, filter?)` - incoming bonds.
  - `bondsBetween(aId, bId, filter?)` - both directions.
  - `list(filter?)` - all bonds (filtered).
  - `findStrongest(bondType, filter?)` / `findWeakest(...)` -
    extreme picks with optional fromId / toId / minLevel /
    maxLevel filters.
  - `tick(dtMs)` - exponential decay toward baseline.
  - `removeBondType(id)` - drops the spec AND all bonds of that
    type.
  - `bondCount` / `bondTypeCount` / `clear` / `dispose`.
- Self-loops rejected (fromId === toId).
- `BondFilter`: `{ bondType?, minLevel?, maxLevel?, fromId?, toId? }`.
- All callbacks isolated.
- `RESOURCE_RELATIONSHIP_GRAPH` constant.

### Tests

2721 -> 2751 (30 new).

### Backwards compatibility

Pure addition. Pairs with PersonaTrait (1.3.0, individual character
traits), EmotionState (1.3.2 next, mood gauges), DialogTree (0.61,
often gated by relationship strength), NarrativeMemory (1.3.5
capstone, remembers what shifted bonds).

## 1.3.0 - 2026-05-09

**Wave 1.3 AI persona depth opens — PersonaTrait: NPC personality
trait ledger with weighted expression + decay.** The most
"uniquely Loom" wave: making NPCs feel like PEOPLE, not state
machines. PersonaTrait is the foundation - a weighted trait
vector per character (curiosity, courage, greed, suspicion, ...)
that biases their dialog, AI choices, and reactions. Traits can
decay over time, be reinforced by experiences, and be queried
for "is this NPC the type to ___?".

### Added

- `src/runtime/persona-trait.ts` - `PersonaTrait` class:
  - `create({ valueClamp?, onChange? })`. Default clamp `[-1, 1]`.
  - `defineTrait({ id, baseline?, decayHalfLifeMs?, data? })` -
    register a trait spec. Default baseline 0 / no decay.
  - `set(characterId, traitId, value)` - direct set; auto-defines
    spec on first use.
  - `adjust(characterId, traitId, delta)` - additive update;
    treats missing entry as 0.
  - `getValue(characterId, traitId)` - returns clamped value.
  - `getRawValue(characterId, traitId)` - un-clamped.
  - `has` / `remove` per (character, trait).
  - `forCharacter(characterId)` / `forTrait(traitId)` - bulk reads.
  - `findHighest(traitId, { minLevel?, maxLevel?, characterIds? })`
    / `findLowest(...)` - "which NPC is bravest / greediest".
  - `tick(dtMs)` - exponential decay toward baseline using
    `decayHalfLifeMs`.
  - `removeTraitSpec(id)` - drops the spec AND all entries for
    that trait.
  - `traitIds` / `traitSpecCount` / `entryCount` / `list` /
    `clear` / `dispose`.
- Decay model: `value(t+dt) = baseline + (value(t) - baseline) *
  0.5^(dt / halfLife)`. Exponential, baseline-anchored, smooth.
- `valueClamp` option lets consumers normalize differently
  (e.g. `[0, 100]` for stat-style traits).
- All callbacks isolated; throwing onChange cannot destabilize
  the ledger.
- `RESOURCE_PERSONA_TRAIT` constant.

### Tests

2690 -> 2721 (31 new).

### Backwards compatibility

Pure addition. Pairs with EmotionState (1.3.2 next, mood gauges -
shorter timescale than traits), RelationshipGraph (1.3.1 next,
per-pair bonds), DialogTree (0.61, often gated by trait
thresholds), BehaviorTree (1.1.2, uses traits in conditions).

## 1.2.5 - 2026-05-09

**🟩 Wave 1.2 milestone — LootTier: gear-quality tiered drop
pools.** LootTable (0.57) is a flat weighted pool: roll once, get
an item. LootTier is the diablo / borderlands / Path of Exile
pattern: items belong to tiers (common / uncommon / rare / epic /
legendary), and drops are TWO weighted rolls — first pick the
tier per-context, then pick an item within that tier. Plus tier
scaling so high-level zones drop rares more often.

### Added

- `src/runtime/loot-tier.ts` - `LootTier<T>` class
  (type-generic over the per-item payload):
  - `create<T>({ rng?, seed? })`. Default seeded mulberry32 PRNG.
  - **Tier management**:
    - `defineTier({ id, weight? })` - register a tier (default
      weight 1).
    - `removeTier(id)` - drops the tier and ALL items in it.
    - `hasTier` / `tierIds` / `tierCount`.
  - **Item management**:
    - `addItem({ id, tier, weight?, tags?, payload })` - rejects
      if tier not defined. Re-adding same id moves it between
      tiers.
    - `removeItem` / `hasItem` / `size` / `list` / `itemsByTier`.
  - **Tier scaling**:
    - `setTierScaleFn((tierId, ctx) => weightMultiplier)` - dynamic
      weights based on level / tags / arbitrary ctx. Throwing fn
      falls back to weight 1.
    - `effectiveTierWeights(ctx)` - resolved weights for diagnostics.
  - **Rolling**:
    - `rollTier(ctx?)` - returns tier id or null.
    - `rollItem(ctx?)` - tier roll then item roll; returns
      `DropResult { tier, id, payload, tags? }` or null.
    - `rollItems(count, ctx?)` - independent rolls (with
      replacement).
    - `rollItemsUnique(count, ctx?)` - without replacement; caps
      at pool size.
    - `ctx.tier` forces a specific tier; `ctx.tags` filters items
      with any-match overlap; `ctx.requireTagMatch: true`
      excludes untagged items when tags filter set.
  - `setRng(rng)` / `clear()` / `dispose()`.
- `RESOURCE_LOOT_TIER` constant.

### Tests

2665 -> 2690 (25 new).

### Backwards compatibility

Pure addition. Pairs with LootTable (0.57, flat pools),
MerchantStock (1.2.4), SpawnDirector (1.2.2), Entropy (0.17, RNG
seam).

### 🟩 Milestone — Wave 1.2 world / economy depth complete

**6 versions shipped (1.2.0 → 1.2.5)**: PathfindingCache (A*
memoization), RegionGraph (zone topology + traversal),
SpawnDirector (declarative spawn rules + caps), EncounterTable
(weighted encounter pools), MerchantStock (restocking shop
inventory + dynamic pricing), LootTier (tiered drop pools with
scaling).

Together these unlock: full world-graph navigation across zones,
declarative population control with budgets, content-driven
encounter design across phases, economy systems with faction-priced
shops, and Diablo-style item rarity tiers with level scaling.

Wave 1.3 (AI persona depth) opens next: PersonaTrait,
RelationshipGraph, EmotionState, DialogVoice, SchedulePlan,
NarrativeMemory (1.3 milestone).

## 1.2.4 - 2026-05-09

**MerchantStock — restocking shop inventory with caps + dynamic
pricing.** Every shopkeeper in every RPG: a counter of items, a
restock cadence (potions regenerate every 30 minutes, rare gear
once per week), buy / sell prices, and optional dynamic pricing
(faction discount, time-of-day surcharge, supply / demand).

### Added

- `src/runtime/merchant-stock.ts` - `MerchantStock<T>` class
  (type-generic over the per-item payload):
  - `create<T>({ priceFn?, sellbackPct?, data? })`. Default
    sellback 0.5.
  - `addItem({ id, currentStock?, maxStock?, restockAmount?, restockIntervalMs?, basePrice?, payload? })`.
  - `removeItem` / `hasItem` / `getItem` / `list` / `size`.
  - `buy(itemId, qty, ctx?)` returns `BuyResult`
    `{ ok, reason?, unitsSold, totalCost }`. Reasons:
    `'unknown_item' | 'out_of_stock' | 'invalid_qty'`. Buying
    more than available caps at `currentStock`.
  - `sell(itemId, qty, ctx?)` returns `SellResult`
    `{ ok, reason?, unitsBought, totalPaid }`. Reasons:
    `'unknown_item' | 'invalid_qty' | 'cap_hit'`. Pays
    `basePrice * sellbackPct * priceFn(...)` per unit.
  - `setStock(itemId, qty)` admin override.
  - `setRestock(itemId, amount, intervalMs)` updates restock
    policy.
  - `priceFor(itemId, ctx?)` resolved unit price.
  - `setPriceFn(fn)` swap modifier at runtime.
  - `tick(dtMs)` advances restock cadence; auto-caps at maxStock.
  - Stats: `totalSold` / `totalRevenue` / `totalBought` /
    `totalCost` / `resetStats`.
  - `clear()` / `dispose()`.
- `priceFn(basePrice, itemId, ctx) -> resolvedPrice` is the global
  modifier hook. Throwing priceFn falls back to basePrice.
- `restockIntervalMs: 0` disables auto-restock.
- `RESOURCE_MERCHANT_STOCK` constant.

### Tests

2639 -> 2665 (26 new).

### Backwards compatibility

Pure addition. Pairs with InventoryGrid (0.54, the player's bag),
LootTable (0.57), FactionReputation (0.86, often drives discounts).

## 1.2.3 - 2026-05-09

**EncounterTable — weighted encounter pools per zone / phase /
level / tags.** LootTable (0.57) drops items; EncounterTable
picks ENCOUNTERS the same way: "which mob pack spawns in this
zone at this time-of-day at this player difficulty level?"
Filters by zone, phase, level band, and tags - so a single
declarative table can drive encounters across an entire game.

### Added

- `src/runtime/encounter-table.ts` - `EncounterTable<T>` class
  (type-generic over the payload):
  - `create<T>({ rng? })` - default `Math.random`.
  - `add({ id, zones?, phases?, minLevel?, maxLevel?, tags?, weight?, payload })`
    - returns false on invalid id / payload.
  - `remove(id)` / `has(id)` / `size()` / `list()`.
  - `roll({ zone?, phase?, level?, tags? })` - weighted random
    pick from filtered entries; returns `null` if no match or
    total weight 0.
  - `filter(ctx)` - matching entries without rolling.
  - `totalWeightFor(ctx)` - sum of matching weights.
  - `setRng(rng)` - swap the RNG seam.
  - `clear()` / `dispose()`.
- Filter rules:
  - `zones` / `phases` use allow-list semantics (entry's list must
    contain ctx value; if omitted, no filtering).
  - `minLevel` / `maxLevel` are inclusive bounds on `ctx.level`.
  - `tags` use any-match: if entry specifies tags, ctx.tags must
    overlap.
- Throwing RNG falls back to `Math.random`.
- `RESOURCE_ENCOUNTER_TABLE` constant.

### Tests

2617 -> 2639 (22 new).

### Backwards compatibility

Pure addition. Pairs with LootTable (0.57, item drops),
SpawnDirector (1.2.2, the spawn-rate engine), Entropy (0.17,
deterministic RNG seam for replays).

## 1.2.2 - 2026-05-09

**SpawnDirector — declarative spawn rules with rate-limits + caps
+ budget tracking.** CrowdSpawner (0.87) handles bulk-spawn waves
("spawn N goblins in this arc"). SpawnDirector is the higher-level
rules engine: "every 30s, attempt to spawn a wolf if zone
wolfCount < 5," "spawn limit 12 mobs in this zone," "respect a
global mob budget so the simulation doesn't melt." Per-rule
cooldowns, per-zone caps, and a global concurrent-spawn budget.

### Added

- `src/runtime/spawn-director.ts` - `SpawnDirector` class:
  - `create({ globalBudget?, context?, onSpawned?, onRejected? })`.
  - `defineRule({ id, zone, intervalMs?, spawnFn, maxConcurrent?, maxPerZone?, gate?, data? })`.
    Default interval 5000ms, max ∞ / ∞.
  - `removeRule(id)` / `hasRule(id)` / `ruleIds()` / `ruleCount()`.
  - `notifySpawned(ruleId)` / `notifyDespawned(ruleId)` -
    consumer keeps cap accounting accurate.
  - `tryAttempt(ruleId)` - force a spawn check outside cooldown;
    returns `RejectReason | 'spawned'`.
  - `tick(dtMs)` - decrement cooldowns; attempt spawns when 0.
  - `setContext(ctx)` - update gate context.
  - `setGlobalBudget(n)` - update global cap.
  - `getSpawnedTotal()` / `getActiveCount(ruleId)` /
    `getZoneCount(zone, ruleId)`.
  - `clear()` / `dispose()`.
- `RejectReason`: `'cooldown' | 'gate' | 'maxConcurrent' |
  'maxPerZone' | 'globalBudget' | 'spawnFnFailed' | 'spawnFnThrew'`.
- spawnFn returning `false` is a soft-fail (e.g. no valid spawn
  point); the cooldown still resets so we don't hammer the spawn
  pool.
- All callbacks isolated.
- NaN / Infinity / negative dt no-op.
- `RESOURCE_SPAWN_DIRECTOR` constant.

### Tests

2595 -> 2617 (22 new).

### Backwards compatibility

Pure addition. Pairs with CrowdSpawner (0.87, the actual spawn
machinery), EncounterTable (1.2.3 next, weighted encounter pools),
FrameBudgetScheduler (0.36, defers heavy spawn callbacks across
frames).

## 1.2.1 - 2026-05-09

**RegionGraph — connected-zone topology + traversal.** Pathfinder
(0.55) handles tile-level A* within a single zone. RegionGraph
is the world-scale counterpart: zones are nodes, connections
(portals, doors, paths, ferry routes) are edges. "Find shortest
route Hamlet → Lastlight," "which zones are reachable with a
Mirror Shard?", "what zone do I land in if I cross this portal?".

### Added

- `src/runtime/region-graph.ts` - `RegionGraph` class:
  - `create({})`.
  - `addZone(id, data?)` / `removeZone(id)` / `hasZone(id)` /
    `getZone(id)` / `zones()` / `zoneCount()`.
  - `addConnection({ fromZone, toZone, weight?, kind?, gate?, data? })`
    - directed edge. Returns false on missing zones / self-loop.
  - `addBidirectional(fromZone, toZone, opts)` - both directions.
  - `removeConnection(from, to)` / `hasConnection(from, to)` /
    `getConnection(from, to)` / `edges()` / `edgeCount()`.
  - `neighbors(zone, ctx?)` - reachable next zones, gate-filtered.
  - `shortestPath(fromZone, toZone, ctx?)` - Dijkstra path or
    null. Returns single-element array for same-zone query.
  - `reachable(fromZone, ctx?)` - all zones reachable via BFS.
  - `isReachable(fromZone, toZone, ctx?)` - boolean.
  - `clear()` / `dispose()`.
- Edge `gate` is a predicate `(ctx) => boolean`. Throwing gates
  treated as closed.
- Edge `kind` is opaque to engine (consumer filter for "walk" /
  "teleport" / "boat" / etc).
- Edge `weight` defaults to 1; use any positive number for travel
  cost.
- `RESOURCE_REGION_GRAPH` constant.

### Tests

2568 -> 2595 (27 new).

### Backwards compatibility

Pure addition. Pairs with Pathfinder (0.55, intra-zone A*),
TileMap (0.56), FactionReputation (0.86, often gates region
access).

## 1.2.0 - 2026-05-09

**Wave 1.2 world depth opens — PathfindingCache: memoization
layer for A* path queries.** Pathfinder (0.55) does the actual A*
search. PathfindingCache is the layer above: 50 mobs all pathing
to the player every tick is 50 A* invocations per second. Most
share a goal (one player) or a start (mob group clumping).
Cache them.

### Added

- `src/runtime/pathfinding-cache.ts` - `PathfindingCache` class:
  - `create({ capacity?, ttlMs?, gridVersion? })`. Defaults 128 / 0 / 0.
  - `get(sx, sy, gx, gy)` - returns cached `CachedPathResult` or
    `undefined` on miss / stale.
  - `set(sx, sy, gx, gy, result)` - insert / replace. Evicts LRU
    on capacity overflow.
  - `getOrCompute(sx, sy, gx, gy, computeFn)` - hit cache, else
    invoke `computeFn`, cache, return. Throwing `computeFn`
    returns null and does not cache.
  - `bumpGridVersion()` - lazy invalidation; existing entries
    become stale on next get.
  - `invalidateAll()` / `invalidateAt(x, y)` (drop entries whose
    path crosses the cell) / `invalidateBySource(x, y)` /
    `invalidateByGoal(x, y)`.
  - `tick(dtMs)` - advance internal clock; expire entries past
    TTL if configured.
  - Stats: `size()` / `hits()` / `misses()` / `hitRate()` /
    `resetStats()`.
  - `getGridVersion()` / `dispose()`.
- Cache key is `(floor(sx), floor(sy)) -> (floor(gx), floor(gy))`.
- Cached `null` paths are preserved (don't keep retrying impossible
  searches).
- `RESOURCE_PATHFINDING_CACHE` constant.

### Tests

2545 -> 2568 (23 new).

### Backwards compatibility

Pure addition. Pairs with Pathfinder (0.55, the A* function),
Quadtree (0.81, spatial queries that often FEED pathfinding
goals), TileMap (0.56). The cache is opt-in - existing Pathfinder
consumers don't change.

## 1.1.5 - 2026-05-09

**🟦 Wave 1.1 milestone — GhostReplay: record + replay translucent
shadow runs.** Souls-likes show "this is how the player who left
the message died." Racers show your previous best lap as a ghost
car. Survivor-likes show your last run's path so you can learn
from it. GhostReplay is the engine-side machinery: record frames
of an entity (position + rotation + animation), serialize the
recording, then play it back as one or more concurrent ghost
playbacks.

### Added

- `src/runtime/ghost-replay.ts` - `GhostReplay` class:
  - `create({})`.
  - **Recording**:
    - `startRecording({ sampleRateMs?, maxFrames?, label? })`.
      Defaults 50ms / 1200 frames.
    - `recordSnapshot({ x, y, rotation?, animationId?, data? })` -
      drops snapshot if non-finite coordinates.
    - `stopRecording()` returns `Recording | null`.
    - `cancelRecording()` discards.
    - `isRecording()`.
  - **Playback** (multiple concurrent ghosts):
    - `play(recording, { id?, speed?, loop?, fadeInMs?, fadeOutMs?, onFinish? })`.
    - `stop(id)` / `stopAll()`.
    - `pause(id)` / `resume(id)` / `setSpeed(id, mult)`.
    - `getGhost(id)` returns interpolated `GhostSnapshot` or `null`.
    - `has(id)` / `list()` / `forEach(cb)` / `count()`.
    - `tick(dtMs)` advances all active ghosts.
  - **Serialization**:
    - `exportRecording(recording)` -> JSON string.
    - `importRecording(jsonString)` -> `Recording | null`.
  - `dispose()` locks ops.
- Snapshot interpolates position + rotation linearly between
  surrounding frames; uses prior frame's `animationId` and
  `data`.
- `loop: true` modulos elapsed; `loop: false` clamps to last
  frame and fires `onFinish` once.
- `fadeInMs` / `fadeOutMs` produce alpha ramps (0 -> 1 / 1 -> 0)
  at recording boundaries.
- maxFrames cap drops oldest + rebases atMs so first frame stays
  at 0.
- Engine ships zero render path - consumer reads the snapshot and
  draws the ghost in whatever style fits (translucent sprite,
  outline shader, breadcrumb trail).
- Throwing onFinish isolated.
- NaN / Infinity / negative dt no-op.
- `RESOURCE_GHOST_REPLAY` constant.

### Tests

2516 -> 2545 (29 new).

### Backwards compatibility

Pure addition. Pairs with ReplayRecorder (0.58, deterministic
GAMEPLAY EVENT recording) - GhostReplay records VISUAL STATE for
shadow rendering instead. Different layer; the two compose.

### 🟦 Milestone — Wave 1.1 combat depth complete

**6 versions shipped (1.1.0 -> 1.1.5)**: InputBuffer (input intent
queue), StatusEffectStack (buff/debuff stacking with DR + immunity),
BehaviorTree (pluggable AI decision tree), CameraDirector
(cinematic camera sequencer), CutsceneSequencer (timed event
timeline), GhostReplay (record + replay shadow runs).

Together these unlock: combo-input combat, multi-source debuff
mechanics, hierarchical NPC AI, scripted boss reveals, full
cutscene orchestration, and replay-based metagame loops (best lap,
death messages, dueling ghosts).

Wave 1.2 (world / economy depth) opens next: PathfindingCache,
RegionGraph, SpawnDirector, EncounterTable, MerchantStock,
LootTier (1.2 milestone).

## 1.1.4 - 2026-05-09

**CutsceneSequencer — generic timed-cue event timeline.**
CameraDirector (1.1.3) is camera-specific. CutsceneSequencer is
the broader orchestrator: schedule arbitrary events at specific
times in a scripted sequence. "At t=0 play voice line, at t=500
emit a particle effect, at t=1500 trigger dialog, at t=3500 emit
gameplay event, at t=4000 end." The consumer's `onCue` callback
dispatches each cue to the right subsystem.

### Added

- `src/runtime/cutscene-sequencer.ts` - `CutsceneSequencer` class:
  - `create({})`.
  - `play({ cues, totalMs?, speed?, onCue?, onFinish? })` returns
    true if accepted (false on empty / disposed).
  - `tick(dtMs)` advances; fires cues whose `atMs` is crossed.
  - `pause()` / `resume()` / `stop()` (stop does NOT fire onFinish).
  - `setSpeed(multiplier)` for slow-mo / fast-forward.
  - `jumpTo(ms)` scrubs forward (fires intervening cues) or
    backward (no replay); clamped to `[0, totalMs]`.
  - `getState()` returns
    `{ elapsedMs, totalMs, isPlaying, isPaused, progress, speed, firedCount }`.
  - `isPlaying()` / `isPaused()` / `dispose()`.
- Cues are sorted by `atMs` on play; consumer can pass them in
  any order.
- Multiple cues at the same `atMs` all fire in the order they
  appear.
- `totalMs` defaults to the last cue's `atMs`; pass an explicit
  larger `totalMs` to add tail time.
- Throwing onCue / onFinish isolated.
- NaN / Infinity / negative dt no-op.
- `RESOURCE_CUTSCENE_SEQUENCER` constant.

### Tests

2492 -> 2516 (24 new).

### Backwards compatibility

Pure addition. Pairs with CameraDirector (1.1.3, camera channel),
AudioCueQueue (0.94, audio channel), Coroutine (0.69, multi-frame
logic). Works with any consumer-defined event channel via the
`kind` string.

## 1.1.3 - 2026-05-09

**CameraDirector — cinematic camera sequencer.** CameraController
(0.41) is the runtime camera (player follow, smooth pan, manual
drag). CameraDirector is the cinematic counterpart: scripted
keyframed sequences for boss reveals, death cams, dialogue
close-ups, scripted cutscenes. Hand off control: when the director
plays, the consumer reads `getState()` and pushes the snapshot to
the runtime camera; when `isPlaying()` is false, control returns.

### Added

- `src/runtime/camera-director.ts` - `CameraDirector` class:
  - `create({ initial? })`. Default initial `{ x: 0, y: 0, zoom: 1, rotation: 0 }`.
  - `play({ keyframes, speed?, onFinish? })` returns true if
    accepted (false on empty / disposed).
  - `tick(dtMs)` advances elapsed; lerps between keyframes per
    easing; fires onFinish once at end.
  - `pause()` / `resume()` / `stop()`. `stop()` does NOT fire
    onFinish; snaps camera back to initial.
  - `setSpeed(multiplier)` for slow-mo / fast-forward.
  - `jumpTo(ms)` scrubs to a specific time, clamped to sequence
    length.
  - `getState()` returns
    `{ x, y, zoom, rotation, isPlaying, isPaused, progress, elapsedMs, speed }`.
  - `isPlaying()` / `isPaused()` / `dispose()`.
- Easings: `'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'step'`.
- Keyframes are sorted by `atMs` on play; consumer can pass them
  in any order.
- Engine ships zero render path - consumer wires the snapshot to
  whatever camera they have.
- Throwing onFinish isolated; faults do not destabilize the director.
- NaN / Infinity / negative dt no-op.
- `RESOURCE_CAMERA_DIRECTOR` constant.

### Tests

2468 -> 2492 (24 new).

### Backwards compatibility

Pure addition. Pairs with CameraController (0.41), Tween (0.32,
single-channel easing), CutsceneSequencer (1.1.4 next, broader
event timeline).

## 1.1.2 - 2026-05-09

**BehaviorTree — pluggable AI decision tree.** StateMachine (0.51)
handles "agent is in state X, transition on event Y" — great for
finite, hand-authored flows. BehaviorTree is the hierarchical /
composite pattern instead: build complex AI from small reusable
nodes (sequence, selector, condition, action, inverter, repeat,
cooldown, parallel). The standard model in modern game AI.

### Added

- `src/runtime/behavior-tree.ts` - `BehaviorTree` class:
  - `create({ root, blackboard?, onStatus? })`.
  - `tick(dtMs)` returns `BTStatus` (`'success' | 'failure' | 'running'`).
  - `reset()` clears all running-node state.
  - `setBlackboardEntry(key, value)` / `getBlackboardEntry(key)` /
    `getBlackboard()` (defensive copy).
  - `dispose()` locks ops.
- Node taxonomy:
  - `sequence` - run children in order; fail on first failure;
    success if all succeed; running while one is.
  - `selector` - try children in order; succeed on first success;
    fail if all fail.
  - `parallel` - run all children each tick; configurable
    `successThreshold` / `failureThreshold`.
  - `inverter` - flip success <-> failure; running passes through.
  - `repeat` - run child N times (or `count: -1` = forever).
  - `cooldown` - rate-limit child; configurable status during
    cooldown window.
  - `condition` - leaf; predicate -> success/failure.
  - `action` - leaf; runner -> success/failure/running.
- Sequence + selector preserve their child cursor across ticks
  while a child is running, so multi-frame actions work
  correctly.
- Parallel ticks every child every frame.
- Throwing predicate / action / onStatus isolated; faults map to
  `'failure'`.
- NaN / negative dt clamped to 0.
- `RESOURCE_BEHAVIOR_TREE` constant.

### Tests

2435 -> 2468 (33 new).

### Backwards compatibility

Pure addition. Pairs with StateMachine (0.51) for finite states;
AggroTable (0.78) for threat ledger; Coroutine (0.69) for
multi-frame action sequences.

## 1.1.1 - 2026-05-09

**StatusEffectStack — buff/debuff stacking with DR + immunity
windows.** BuffLifecycle (0.74) handles "this character has buff X
with timer Y" — a flat list. StatusEffectStack adds the rules
ARPGs / RPGs need on top: bleed stacks up to 5, multiple slow
sources don't stack (highest wins), stun has DR (each stun lasts
75% of prior), stun grants immunity for 1s after expiry.

### Added

- `src/runtime/status-effect-stack.ts` - `StatusEffectStack` class:
  - `create({ onApply?, onExpire? })`.
  - `defineEffect({ id, stacking?, maxStacks?, defaultDurationMs?, defaultMagnitude?, durationDR?, immunityAfterExpireMs?, data? })`
    - register an effect type. Returns false on invalid id.
  - `apply(targetId, effectId, { magnitude?, durationMs?, source?, data? })`
    - returns `ApplyResult`: `'applied' | 'stacked' | 'refreshed' |
    'replaced' | 'rejected_immune' | 'rejected_lower' |
    'rejected_unknown'`.
  - `removeEffect(targetId, effectId)` - manual removal; triggers
    immunity if configured.
  - `has` / `isImmune` / `get` / `getStacks`.
  - `listForTarget(targetId)` / `listByEffect(effectId)` / `forEach(cb)`.
  - `clearTarget(targetId)` / `count()` / `dispose()`.
  - `tick(dtMs)` ages all active effects + immunity windows.
- Stacking rules:
  - `'replace'` (default) - new fully replaces old.
  - `'refresh'` - duration refreshed; magnitude / source preserved.
  - `'stack'` - increment stackCount up to maxStacks; totalMagnitude
    = perStack * stackCount; durationDR shrinks new duration per
    existing stack.
  - `'highest'` - keep entry with higher magnitude.
  - `'longest'` - keep entry with longer remainingMs.
- `immunityAfterExpireMs > 0` keeps a 0-stack entry alive for the
  immunity window; apply during that window returns
  `'rejected_immune'`.
- All callbacks isolated; throwing onApply / onExpire cannot
  destabilize the stack.
- NaN / Infinity / negative dt no-op.
- `RESOURCE_STATUS_EFFECT_STACK` constant.

### Tests

2411 -> 2435 (24 new).

### Backwards compatibility

Pure addition. Pairs with BuffLifecycle (0.74) for the simple flat
case; AggroTable (0.78) for damage / threat conversion;
DamageFormula (0.66) for crit / mitigation.

## 1.1.0 - 2026-05-09

**Wave 1.1 combat depth opens — InputBuffer: input intent buffer
with windowed expiry.** Fighting games and ARPGs all face the same
UX problem: the player presses "attack" 80ms before the previous
animation finishes. Drop the input → janky combat. Hold it
forever → repeated taps stack into sloppy spam. InputBuffer is
the answer: stash recent inputs with per-input TTL, let the
gameplay layer consume the oldest matching input when ready, age
out anything stale.

### Added

- `src/runtime/input-buffer.ts` - `InputBuffer<T>` class
  (type-generic over the payload):
  - `create<T>({ defaultWindowMs?, capacity?, onBuffer?, onRemoved? })`.
    Defaults 200ms window, 16 cap.
  - `buffer(value, { windowMs? })` returns monotonic id.
  - `consume(predicate)` finds + removes oldest match.
  - `peek(predicate)` finds without removing.
  - `consumeOldest()` removes + returns the oldest input.
  - `removeById(id)` / `has(id)`.
  - `tick(dtMs)` ages inputs + expires those whose remainingMs
    reaches 0.
  - `forEach(cb)` / `list()` defensive snapshots (oldest-first).
  - `count()` / `capacity()` / `clear()` / `dispose()`.
- `windowMs: -1` makes an input sticky (never auto-expires).
- Capacity-bounded; over capacity drops oldest with reason
  `'evicted'`.
- All callbacks isolated; throwing predicate / onBuffer / onRemoved
  cannot destabilize the buffer.
- NaN / Infinity / negative dt are no-ops.
- `RESOURCE_INPUT_BUFFER` constant.

### Tests

2385 -> 2411 (26 new).

### Backwards compatibility

Pure addition. Pairs with InputActions (0.31, "single key triggers
an action"), InputChord (0.39, "patterns: combo / sequence /
doubleTap / hold"), HotKeyProfile (0.85). InputChord detects
PATTERNS in real-time; InputBuffer queues INTENTS for delayed
consumption.

Wave 1.1 combat-depth roadmap: InputBuffer (this) → StatusEffectStack
→ BehaviorTree → CameraDirector → CutsceneSequencer → GhostReplay
(1.1 milestone).

## 1.0.0 - 2026-05-09

**🟢 1.0.0 CAPSTONE — BenchmarkHarness: performance baseline tracker.**

Loom Engine ships 1.0.0. The capstone primitive is the one we
needed to ship 1.0 at all: a way to *measure ourselves*. Register
named benchmarks, run them across warmup + measurement iterations,
capture per-iteration timings, persist a baseline, detect
regressions on subsequent runs.

The engine ships zero benchmarks; consumers register what they
care about.

### Added

- `src/runtime/benchmark-harness.ts` - `BenchmarkHarness` class:
  - `create({ now?, defaultWarmup?, defaultIterations?, storage?, regressionThreshold? })`.
    Defaults: `performance.now` -> `Date.now` clock, 1 warmup, 10
    iterations, no storage, threshold ratio 1.2.
  - `register({ name, fn, warmup?, iterations?, beforeEach?, afterEach? })`
    - returns `false` on invalid spec.
  - `unregister(name)` / `has(name)` / `list()`.
  - `run(name)` - returns `BenchmarkResult` with
    `{ durations[], meanMs, medianMs, minMs, maxMs, p95Ms, totalMs, errorCount, recordedAt }`.
    Throws if `name` not registered.
  - `runAll()` - runs every registered spec in registration order.
  - `setBaseline(name, result | baseline)` / `getBaseline(name)` /
    `hasBaseline(name)` / `clearBaseline(name)`.
  - `saveBaselines()` / `loadBaselines()` - persist via
    consumer-supplied `BaselineStorage` adapter
    (`{ saveAll, loadAll }`). No-op without storage.
  - `detectRegression(result, threshold?)` - returns
    `RegressionReport { name, baseline, current, ratio, isRegression, threshold }`.
    `ratio = current.medianMs / baseline.medianMs`. With no
    baseline, `ratio = NaN` and `isRegression = false`.
  - `dispose()` clears + locks ops.
- Throwing `fn` is caught and recorded in `errorCount`; tries do
  not abort the iteration loop.
- `beforeEach` / `afterEach` run outside the timed window.
- All callbacks isolated.
- Sync-only at 1.0; async benchmark support to come in 1.x without
  breaking compat.
- `RESOURCE_BENCHMARK_HARNESS` constant.

### Tests

2354 -> 2385 (31 new). Determinism whitelist updated to admit
`runtime/benchmark-harness.ts` (`Date.now` fallback in the clock
seam).

### Backwards compatibility

Pure addition. Pairs with FrameBudgetScheduler (0.36, soft-deadline
queue), LogRingBuffer (0.50, structured logs), DebugHUD (0.24,
fps tracker). Those are the *runtime* diagnostic primitives;
BenchmarkHarness is the *test-time / dev-time* counterpart.

### 🟢 Milestone — engine 1.0.0

**30 versions shipped from 0.71 to 1.0.0** across the M9 wave
(0.71-0.90) and the M10 polish push (0.91-1.0): WeatherSystem,
DamageNumberPipeline, BuffLifecycle, Crafting, Achievements,
AggroTable, Reactivity, Leaderboard, TextScroll, HealthBar,
Quadtree, ThresholdTrigger, EventLog, AssetManifest, HotKeyProfile,
FactionReputation, CrowdSpawner, TutorialFlow, DialogChoiceHistory,
AssetVariant (M9 0.90 milestone), ScreenFader, ScreenShake,
DamageFlash, AudioCueQueue, MusicPlaylist, ComboCounter,
TooltipQueue, NumberFormatter, VignetteRenderState, and now
BenchmarkHarness.

Total this 1.0 push: **2385 tests, 0 breaking changes**. Every
release through the entire 1.0.0 line has been pure-additive;
0.10-era code compiles unmodified against 1.0.

What 1.0 means for the Loom Engine:
- The surface is wide enough to ship a real ARPG / MMORPG slice.
- Determinism is enforced by tripwire tests, not convention.
- Every primitive has a stable public surface, a resource key,
  isolation around throwing callbacks, and a `dispose()` lifecycle.
- The engine still ships **zero render path** - it's a runtime
  + ECS + render-graph contract, not a renderer. Consumers bring
  the pixels.

Next: 1.x is for async benchmark support, the V3 Director envelope
expansions, and the subprocess sandbox v2 for marketplace plugins.

GOGOGO.

## 0.99.0 - 2026-05-09

**VignetteRenderState — full-screen overlay tint primitive for
low-HP / danger / status states.** Low-HP red pulse, poison green
tint, berserker rage bloom, stunned grayscale, underwater blue -
every game wants a sustained colored full-screen overlay that
tracks one or more active "vignette sources" and renders the
dominant one per frame. VignetteRenderState owns that ledger.

### Added

- `src/runtime/vignette-render-state.ts` - `VignetteRenderState`
  class:
  - `create({ capacity?, minIntensity? })`. Defaults 16 / 0.001.
  - `upsert({ id, color, intensity, pulseHz?, pulseAmp?, data? })`
    add or update a source; keyed by id. Returns false on
    rejection (invalid id / color, capacity full for new id).
  - `setIntensity(id, value)` - quick intensity update; clamps
    to `[0, 1]`.
  - `remove(id)` / `has(id)`.
  - `tick(dtMs)` - advance pulse phases (sine wave).
  - `getState()` - composited render state. Highest effective
    intensity wins; returns `{ active, color, alpha, dominantId }`.
  - `forEach(cb)` / `list()` - defensive snapshots of every
    source.
  - `count()` / `capacity()` / `clear()` / `dispose()`.
- Per-source pulse: `pulseHz` cycles/sec, `pulseAmp` 0..1
  modulation. Effective intensity = `intensity * (1 + pulseAmp *
  sin(phase))`. Pulse phase preserved across intensity updates so
  the pulse continues smoothly.
- Engine ships zero render path - consumer reads
  `getState()` and draws the overlay in whatever style fits
  (CSS box-shadow, fragment shader, fullscreen quad).
- `RESOURCE_VIGNETTE_RENDER_STATE` constant.

### Tests

2331 -> 2354 (23 new).

### Backwards compatibility

Pure addition. Pairs with HealthBar (0.80) per-entity HP, DamageFlash
(0.93) per-entity hit tint, ScreenFader (0.91) one-shot full-screen
fade. This fills the sustained-colored-tint slot.

## 0.98.0 - 2026-05-09

**NumberFormatter — i18n number formatting helper.** HUD damage
numbers (10000 -> "10K"), gold totals (1234567 -> "1,234,567"),
XP, drop counts, currency ("$99.00"), percentages ("85%") - every
HUD number wants a per-locale formatter that renders raw numbers
as the user expects. NumberFormatter is the small Intl wrapper
that does it.

### Added

- `src/runtime/number-formatter.ts` - `NumberFormatter` class:
  - `create({ locale?, fallbackCompactSuffixes? })`. Default
    locale `'en-US'`.
  - `format(value, { minimumFractionDigits?, maximumFractionDigits?, useGrouping? })`
    locale-aware grouping. en-US "1,234,567" / fr-FR "1 234 567"
    / de-DE "1.234.567".
  - `compact(value, { maximumFractionDigits?, threshold? })` -
    "10K", "1.5M", "1.5B", "1.5T". Default 1 fraction digit,
    threshold 1000.
  - `percent(value, { minimumFractionDigits?, maximumFractionDigits? })` -
    `0.5 -> "50%"`. Input is the ratio (0..1), not a percentage
    value.
  - `currency(value, currencyCode, { minimumFractionDigits?, maximumFractionDigits? })` -
    `99, 'USD' -> "$99.00"` / `1500, 'JPY' -> "¥1,500"`.
  - `setLocale(locale)` / `getLocale()`.
- Backed by `Intl.NumberFormat` when available. Falls back to
  English-style grouping (`,` thousands, `.` decimal) and
  `K`/`M`/`B`/`T` compact suffixes when Intl is missing.
- `fallbackCompactSuffixes: { 3: 'K', 6: 'M', 9: 'B', 12: 'T' }` -
  override the fallback suffixes for non-Intl environments
  (e.g. ja: `{ 4: '万', 8: '億' }`).
- Non-finite inputs (NaN / Infinity / -Infinity) return the
  empty string.
- `RESOURCE_NUMBER_FORMATTER` constant.

### Tests

2302 -> 2331 (29 new).

### Backwards compatibility

Pure addition. Pairs with Localization (0.46) for string-side
i18n; this fills the number-side gap.

## 0.97.0 - 2026-05-09

**TooltipQueue — anchored tooltip primitive with fade-in/out lifecycle.**
Hover tooltips on equipped items, info popovers anchored to NPCs,
"Boss is vulnerable" hints pinned over entities - every anchored
UI hint wants the same shape: a content string keyed to an anchor
id, faded in over 150ms, held for a lifetime, then faded out over
200ms before removal. TooltipQueue owns that lifecycle so the
renderer just reads (anchorId, content, alpha) per frame.

### Added

- `src/runtime/tooltip-queue.ts` - `TooltipQueue` class:
  - `create({ capacity?, fadeInMs?, fadeOutMs?, defaultLifetimeMs?, replaceOnSameAnchor?, onShow?, onRemoved? })`.
    Defaults: capacity 32, fadeInMs 150, fadeOutMs 200,
    defaultLifetimeMs 4000, replaceOnSameAnchor true.
  - `show(anchorId, content, { lifetimeMs?, data? })` returns
    monotonic id; rejects empty / non-string anchor.
  - `hide(anchorId)` begins fade-out for every match; returns
    count affected.
  - `hideById(id)` begins fade-out for one tooltip.
  - `tick(dtMs)` advances ageMs / remainingMs / fadeOutAge,
    transitions state (fadeIn -> visible -> fadeOut), updates
    alpha, removes tips whose fade-out completed.
  - `forEach(cb)` / `list()` / `byAnchor(anchorId)` defensive
    snapshots for render consumers.
  - `count()` / `capacity()`.
  - `clear()` drops every tooltip; fires onRemoved with reason
    `'hidden'`.
  - `dispose()` clears + locks ops.
- `TooltipState` is `'fadeIn' | 'visible' | 'fadeOut'`. Alpha
  ramps 0 -> 1 over fadeInMs, holds 1 during visible, ramps
  1 -> 0 over fadeOutMs.
- `lifetimeMs: -1` makes a tooltip sticky (visible until manual
  hide / dispose / clear).
- `replaceOnSameAnchor: true` (default) begins fade-out on prior
  tooltips at the same anchor when show() is called. Set to false
  to stack multiple tooltips per anchor.
- Capacity-bounded with eviction that prefers an already-fading
  tooltip; falls back to oldest by post order.
- All callbacks isolated; throwing onShow / onRemoved cannot
  destabilize the queue.
- NaN / Infinity / negative dt are no-ops.
- `RESOURCE_TOOLTIP_QUEUE` constant.

### Tests

2275 -> 2300 (25 new).

### Backwards compatibility

Pure addition. Pairs with ToastQueue (0.65) for global feed,
TutorialFlow (0.88) for sequenced step gating, DialogTree (0.61)
for branching NPC dialog.

## 0.96.0 - 2026-05-09

**ComboCounter — chain hit counter with reset timer + thresholds.**
ARPGs / brawlers reward consecutive hits with combo callouts ("10
HIT!", "50 HIT!"), crit multipliers, and SFX. ComboCounter is the
per-character ledger: hit() bumps the count, tick(dt) advances the
reset timer, reaching a threshold fires a callback. Resets if no
hit lands within timeoutMs.

### Added

- `src/runtime/combo-counter.ts` - `ComboCounter` class:
  - `create({ timeoutMs?, thresholds?, onChain?, onReset? })`.
    Default timeout 2500ms.
  - `hit()` bumps + refreshes timer + fires thresholds + onChain;
    returns new count.
  - `reset()` manual reset; fires onReset with peak.
  - `tick(dtMs)` advances timer; auto-resets on expiry.
  - `getCount` / `getPeak` / `getRemainingMs` / `isActive`.
  - `setTimeoutMs` / `addThreshold` / `removeThreshold` runtime tuning.
  - `dispose()` clears + locks ops.
- Thresholds fire exactly once per chain; re-arm on reset.
- All callbacks isolated; NaN / negative dt no-op.
- `RESOURCE_COMBO_COUNTER` constant.

### Tests

2254 -> 2275 (21 new).

### Backwards compatibility

Pure addition.

## 0.95.0 - 2026-05-09

**MusicPlaylist — track sequencer for ambient music.** Zones /
scenes often want a queue of 2-5 ambient tracks that rotate over
time without any single track replaying back-to-back. MusicPlaylist
owns the order + playback cursor; MusicDirector / AudioBus consume
the current track URL each frame and crossfade between them.

### Added

- `src/runtime/music-playlist.ts` - `MusicPlaylist` class:
  - `create({ loopAtEnd?, shuffleOnLoop?, rng? })`.
  - `addTrack({ id, url, durationMs?, loop?, data? })` rejects
    duplicates / invalid.
  - `removeTrack(id)` drops + adjusts cursor.
  - `play` / `next` / `prev` / `stop` / `jumpTo(id)`.
  - `current` / `isPlaying` / `size` / `has` / `list` (defensive).
  - `setLoopAtEnd` / `setShuffleOnLoop` runtime tuning.
  - `shuffle()` Fisher-Yates via injected RNG.
  - `dispose()` clears + locks ops.
- Pairs with MusicDirector (Phase 17 audio Track B) for the
  crossfade + decode side.
- `RESOURCE_MUSIC_PLAYLIST` constant.

### Tests

2235 -> 2253 (18 new).

### Backwards compatibility

Pure addition.

## 0.94.0 - 2026-05-09

**AudioCueQueue — prioritized one-shot SFX queue.** Combat is
bursty: 5 hits land in 200ms, the renderer wants to play 5
hit-sounds, but mixer voices are limited. AudioCueQueue is the
prioritization layer between gameplay events and the audio
backend: enqueue cues with a priority, pull the highest-priority
cue when a voice frees up, drop low-priority cues when full.

### Added

- `src/runtime/audio-cue-queue.ts` - `AudioCueQueue` class:
  - `create({ capacity? })` (default 32).
  - `enqueue(cue)` — over-cap drops lowest-priority cue first.
  - `next()` pulls highest-priority (FIFO on ties).
  - `peek()` reads without consuming.
  - `removeById(id)` drops all matching; returns count.
  - `clear()` / `size()` / `capacity()` / `list()` / `dispose()`.
- `RESOURCE_AUDIO_CUE_QUEUE` constant.

### Tests

2217 -> 2235 (18 new).

### Backwards compatibility

Pure addition.

## 0.93.0 - 2026-05-09

**DamageFlash — per-entity tint reaction on hit.** The "white
flash" or "red flash" the player sees the instant their character
(or a boss) takes a hit. Standalone from HealthBar (0.80) which
renders the bar; this renders a per-frame TINT applied to the
entity's sprite.

### Added

- `src/runtime/damage-flash.ts` - `DamageFlash` class:
  - `create({ capacity?, defaultColor?, defaultDurationMs? })`.
    Defaults: 64 capacity, 0xffffff white, 150ms duration.
  - `flash({ entityId, color?, durationMs?, intensity? })`.
    Re-flashing an entity overwrites + resets age. Returns false
    on capacity full.
  - `remove(entityId)` / `clearAll()` / `has(id)` / `activeCount()`
    / `capacity()`.
  - `tick(dtMs)` advances ages; auto-removes expired entries.
  - `forEach(cb)` yields render state with linear alpha falloff.
    Throwing cb isolated.
  - `dispose()` clears + locks ops.
- Render state: `entityId`, `color`, `alpha` (post-falloff),
  `intensity`, `ageMs`, `durationMs`.
- Linear falloff: `alpha = intensity * (1 - ageMs / durationMs)`.
- `RESOURCE_DAMAGE_FLASH` constant.

### Tests

2196 -> 2217 (21 new).

### Backwards compatibility

Pure addition.

## 0.92.0 - 2026-05-09

**ScreenShake — camera trauma model.** Standard "trauma" approach
(Squirrel Eiserloh / Brackeys): a single scalar t in [0, 1]
represents shake state; per-frame offset is `(rng()*2-1) *
maxOffsetPx * trauma^2` for x/y and analogous for angle. Quadratic
dampening means low-trauma jitter is barely visible while
high-trauma feels punchy. Trauma decays linearly per second; on
hit events consumers `addTrauma(N)` and the camera settles
automatically.

### Added

- `src/runtime/screen-shake.ts` - `ScreenShake` class:
  - `create({ decayPerSecond?, maxOffsetPx?, maxAngleRad?, rng? })`.
    Defaults: 1.5/s decay, 16px offset, 0.05rad angle.
  - `addTrauma(amount)` clamps to [0, 1]; negative reduces.
  - `setTrauma(value)` direct + clamping.
  - `getTrauma()` / `isShaking()` reads.
  - `getOffset()` returns `{ x, y, angle }` with quadratic
    dampening; samples RNG 3x.
  - `tick(dtMs)` decays trauma linearly; floors at 0.
  - `setMaxOffset` / `setDecayPerSecond` / `setMaxAngleRad`
    runtime tuning.
  - `reset()` snaps trauma to 0; `dispose()` locks ops.
- Replay determinism via injected RNG seam (Math.random default).
- Defensive: NaN inputs rejected; negative max parameters rejected.
- `RESOURCE_SCREEN_SHAKE` constant.

### Tests

2174 -> 2195 (21 new in tests/screen-shake.test.ts).

### Backwards compatibility

Pure addition.

## 0.91.0 - 2026-05-09

**ScreenFader — render-state primitive for fade-to-color overlays.**
Scene transitions, hit reactions, dramatic narrative beats, and
tutorial blackouts all share the same shape: an alpha-animated
full-screen color overlay with a configurable color, duration, and
easing. The renderer reads `getColor()` + `getAlpha()` each frame
and draws a fullscreen rect; consumers fire `fadeTo()` / `fadeIn()`
/ `fadeOut()` from gameplay code without touching the renderer.

This is the first push beyond the M9 0.90 milestone toward the
1.0 capstone (visual + game-feel + capstone track: 0.91-0.99 +
1.0.0).

### Added

- `src/runtime/screen-fader.ts` - `ScreenFader` class:
  - `create({ initialColor?, initialAlpha?, onFadeComplete? })`.
  - `fadeTo({ color?, durationMs?, targetAlpha?, easing?, data? })`.
  - `fadeIn(opts?)` / `fadeOut(opts?)` convenience helpers.
  - `tick(dtMs)` advances the active ramp; fires onFadeComplete
    exactly once on completion.
  - `clear()` snaps to alpha 0; `fillOpaque()` snaps to alpha 1.
  - `getColor()` / `getAlpha()` / `isFading()` reads.
  - `setColor()` / `setAlpha()` direct overrides (no ramp).
  - `dispose()` locks ops.
- Custom easing: caller passes `easing: (t) => number` for ease-in
  / ease-out / cubic-bezier curves (pairs with engine 0.40 Easings).
- Color blends linearly between start + target (renderers wanting
  per-channel curves intercept getColor + their own time read).
- `data` block on fadeOptions threads through to the
  onFadeComplete callback so consumers can chain ("fade to black,
  swap scene, fade back in").
- durationMs == 0 -> instant snap; durationMs missing or negative
  falls back to default 500ms.
- Defensive: NaN / negative dt no-op; alpha clamped to [0, 1] on
  every input.
- `FadeDirection` type, `ScreenFaderFadeOptions`,
  `ScreenFaderOptions` exported.
- `RESOURCE_SCREEN_FADER` constant.

### Tests

2152 -> 2173 (21 new in tests/screen-fader.test.ts):
- RESOURCE_SCREEN_FADER stable string; defaults.
- initialColor / initialAlpha; clamping.
- fadeTo durationMs=0 instant snap + onFadeComplete fires.
- tick ramps alpha linearly to target; completes on/after durationMs.
- fadeIn / fadeOut helpers.
- color lerps during ramp.
- custom easing applied.
- clear / fillOpaque snap + stop ramp.
- NaN / negative dt no-op.
- setColor / setAlpha direct + clamping.
- throwing onFadeComplete isolated.
- data passthrough on completion.
- dispose locks ops.
- Realistic scene transition (out -> swap -> in).
- Negative durationMs falls back to default 500.

### Backwards compatibility

Pure addition. 0.10-era code compiles unmodified against 0.91.

## 0.90.0 - 2026-05-09

**AssetVariant + M9 0.90 milestone — per-locale / per-platform
asset selection.** AssetPreloader (0.34) + AssetManifest (0.84)
handle the WHAT and the WHERE-IN-THE-DEP-GRAPH; AssetVariant
handles the WHICH-COPY: localized audio, platform-specific
textures, accessibility variants. Each asset declares URLs per
variant key; resolve() picks the best match from a configurable
variant chain.

This is the M9 0.90 milestone - 5 versions shipped this batch
(0.86 → 0.90) on the world-feel + tutorial track:
FactionReputation (0.86), CrowdSpawner (0.87), TutorialFlow
(0.88), DialogChoiceHistory (0.89), AssetVariant (0.90).

### Added

- `src/runtime/asset-variant.ts` - `AssetVariant` class:
  - `create({ variants })` (variant chain).
  - `registerAsset({ id, variants })` (id + variantKey -> URL map).
  - `unregisterAsset` / `has` / `size` / `list` / `clear` / `dispose`.
  - `resolve(id)` - picks first variant in chain matching the asset.
  - `resolveWith(id, variants)` - explicit chain override.
  - `setVariants(chain)` / `getVariants()`.
  - `variantsOf(id)` - keys defined for an asset.
- `RESOURCE_ASSET_VARIANT` constant.

### Tests

2130 -> 2151 (21 new in tests/asset-variant.test.ts).

### Milestone — engine 0.90.0

5 versions shipped this M9 batch-3 wave (0.86 → 0.90) on the
world-feel + tutorial track. Total this M9 session: 20 versions
(0.71 → 0.90), 0 breaking changes, ~2150 tests.

The combined 0.71-0.90 surface covers:
- World ambient (Weather, Aggro, Faction, CrowdSpawner)
- Combat UX (DamageNumberPipeline, BuffLifecycle, HealthBar, AggroTable)
- HUD primitives (Reactivity, TextScroll, FloatingText pipeline)
- Game systems (Crafting, Achievements, Leaderboard, DialogChoiceHistory)
- Infra + tooling (Quadtree, ThresholdTrigger, EventLog,
  AssetManifest, AssetVariant, HotKeyProfile)
- Tutorialization (TutorialFlow with anchor + condition + persistence)

### Backwards compatibility

Pure addition. 0.10-era code compiles unmodified against 0.90.

## 0.89.0 - 2026-05-09

**DialogChoiceHistory — record + replay dialog choices.** DialogTree
(0.61) tracks current branch position; DialogChoiceHistory records
the ledger of every choice the player made over time. Use cases:
branching visualization, "I've already heard this pitch" detection,
replay verification, analytics, quest gating ("you spared him in
chapter 1, the bandits remember").

### Added

- `src/runtime/dialog-choice-history.ts` - `DialogChoiceHistory`:
  - `create({ capacity? })` (default 10000).
  - `record(nodeId, choiceIndex, choiceLabel?)` - assigns monotonic seq.
  - `byNode(nodeId)` / `lastChoice(nodeId)`.
  - `has(nodeId, choiceIndex)` / `count(nodeId, choiceIndex)`
    / `countByNode(nodeId)` / `totalCount()`.
  - `list()` / `clear()` / `capacity()`.
  - `toSnapshot()` / `fromSnapshot(records)` for save / load.
  - `dispose()` clears + locks ops.
- Capacity overflow evicts oldest. Pure addition.
- `RESOURCE_DIALOG_CHOICE_HISTORY` constant.

### Tests

2107 -> 2129 (22 new in tests/dialog-choice-history.test.ts).

### Backwards compatibility

Pure addition.

## 0.88.0 - 2026-05-09

**TutorialFlow — sequenced UI hints with anchor-target tracking.**
New-player tutorials are a sequence of hints that point at parts
of the UI. Each step has an anchor (a UI element id), a message,
and a condition that gates when the step should appear.
TutorialFlow owns the sequence + persistence (so first-time
tutorials don't replay every session).

### Added

- `src/runtime/tutorial-flow.ts` - `TutorialFlow` class:
  - `create({ steps, persist?, onStepChanged?, onFlowComplete? })`.
  - `currentStep()` - first incomplete step whose condition passes.
    Pumps onStepChanged + onShow on changes.
  - `advance()` - mark current complete; fire onComplete + advance.
  - `completeStep(id)` - mark a specific step complete (idempotent).
  - `skipAll()` / `restart()`.
  - `isComplete` / `isCompleted(id)` / `completedIds()`.
  - `saveLocal()` / `loadLocal()` via persist adapter.
  - `dispose()` clears + locks ops.
- Conditions throwing are treated as false (step skipped).
- All callbacks isolated.
- `RESOURCE_TUTORIAL_FLOW` constant.

### Tests

2086 -> 2106 (20 new in tests/tutorial-flow.test.ts).

### Backwards compatibility

Pure addition.

## 0.87.0 - 2026-05-09

**CrowdSpawner — N-mob spawn with budget cap.** Open zones, swarm
encounters, ambient village NPCs all want "spawn up to N goblins,
weighted random against a small zombie chance, never exceed 100
mobs total." CrowdSpawner is the budgeted dispenser: register
spawn defs with per-id max + weight, request one (random or by
id), get back a caller-constructed mob or null when full.

### Added

- `src/runtime/crowd-spawner.ts` - `CrowdSpawner<TMob>` class:
  - `create({ totalBudget?, rng? })` (default budget 100; rng
    defaults to Math.random).
  - `registerSpawn({ id, factory, max?, weight? })`.
  - `unregisterSpawn(id)` / `has(id)` / `size()` / `list()`.
  - `spawnOne(id)` returns mob or null on max/budget/unknown.
  - `spawnRandom()` weighted-random pick from spawns with capacity.
  - `notifyDespawn(id)` returns budget on death.
  - `activeCountOf(id)` / `getTotalActive()` / `totalBudget()`
    / `budgetRemaining()`.
  - `clear()` / `dispose()`.
- Factory throwing yields null without consuming budget.
- Pairs with SteeringBehaviors (0.64), Pathfinder (0.55).
- `RESOURCE_CROWD_SPAWNER` constant.

### Tests

2063 -> 2086 (23 new in tests/crowd-spawner.test.ts).

### Backwards compatibility

Pure addition.

## 0.86.0 - 2026-05-09

**FactionReputation — per-faction reputation track with tiered
status.** RPGs want "Kingdom of Eldoria likes you (Friendly),
Thieves Guild hates you (Hostile)." Reputation is a number per
faction; tiers are named bands (hostile / unfriendly / neutral /
friendly / honored by default). Tier flips fire onTierChanged.

This is the first M9 batch-3 (world-feel + tutorial) release.

### Added

- `src/runtime/faction-reputation.ts` - `FactionReputation` class:
  - `create({ onChanged?, onTierChanged? })`.
  - `registerFaction({ id, name, tiers?, initialReputation?, minReputation?, maxReputation?, data? })`.
  - `unregisterFaction` / `has` / `size` / `list`.
  - `getReputation` / `getTier` (1-based bands, null if no tiers).
  - `addReputation(id, delta)` / `setReputation(id, value)`. Both
    clamp to [min, max].
  - `toSnapshot` / `fromSnapshot` (id -> reputation map).
  - `dispose()` clears + locks ops.
- Default tiers: hostile (-1000), unfriendly (-250), neutral (-50),
  friendly (50), honored (250). Default min/max: -1000 / 1000.
- `onChanged` fires on every change; `onTierChanged` fires only on
  tier flips. Both isolated.
- Tiers sorted internally by `min` ascending.
- `RESOURCE_FACTION_REPUTATION` constant.

### Tests

2041 -> 2063 (22 new in tests/faction-reputation.test.ts).

### Backwards compatibility

Pure addition.

## 0.85.0 - 2026-05-09

**HotKeyProfileManager + M9 0.85 milestone — keybinding profile
manager.** Different from InputChord (0.39, combo / sequence
recognition): HotKeyProfile is name-binding storage. Players
switch between keybinding profiles ("default" / "wasd" /
"vim-style"); classes can override the default ("warrior" inherits
+ adds 'shout' on Q); the actual input-matching happens via
`resolveAction(action) -> key`.

This is the M9 0.85 milestone - 5 versions shipped this batch
(0.81 → 0.85) on the infra + tooling track:
Quadtree (0.81), ThresholdTrigger (0.82), EventLog (0.83),
AssetManifest (0.84), HotKeyProfileManager (0.85).

### Added

- `src/runtime/hotkey-profile.ts` - `HotKeyProfileManager` class:
  - `create({ initialProfiles?, active? })`.
  - `registerProfile(p)` / `unregisterProfile(id)` / `has(id)`
    / `get(id)` / `list()` / `size()`.
  - `setActive(id)` / `getActive()`.
  - `resolveAction(action)` - binding for action via active profile,
    walking inheritance on miss.
  - `resolveActionFor(profileId, action)` - explicit profile lookup.
  - `setBinding(profileId, action, key)` - add or replace.
  - `removeBinding(profileId, action)`.
  - `toSnapshot()` / `fromSnapshot(snap)`.
  - `dispose()` clears + locks ops.
- Inheritance chains supported (warrior inherits combat inherits global);
  cycles in inheritance handled via visited set (no infinite loop).
- Defensive copies in / out of getters.
- `RESOURCE_HOTKEY_PROFILE` constant.

### Tests

2020 -> 2042 (22 new in tests/hotkey-profile.test.ts).

### Backwards compatibility

Pure addition.

## 0.84.0 - 2026-05-09

**AssetManifest — declarative asset list + dependency graph.**
AssetPreloader (0.34) takes a flat list of URLs to load, but real
consumer apps have asset dependencies (animations depend on
spritesheets, which depend on shared atlases). AssetManifest owns
that graph: declare each asset with its dependencies, run
`resolve()` to get a topologically-sorted load order.

### Added

- `src/runtime/asset-manifest.ts` - `AssetManifest` class:
  - `create({ entries? })`.
  - `add(entry)` / `remove(id)` / `has(id)` / `get(id)` / `size()`
    / `list()` / `clear()`.
  - `resolve()` topologically sorts the entire manifest.
  - `resolveFor(id)` resolves the subgraph for a single id (and
    transitive deps).
  - `dispose()` clears + locks ops.
- `ResolveResult` is a discriminated union: `{ ok: true, order }`
  on success; `{ ok: false, reason, offenders }` for `cycle` /
  `missing_dep` / `unknown_id`.
- Topological sort is deterministic (alphabetical on ties).
- Self-loops detected as cycles.
- Defensive copy in / out of getters.
- `RESOURCE_ASSET_MANIFEST` constant.

### Tests

1998 -> 2020 (22 new in tests/asset-manifest.test.ts).

### Backwards compatibility

Pure addition.

## 0.83.0 - 2026-05-09

**EventLog — structured replay-friendly event log.** Different
shape from LogRingBuffer (0.50): typed payloads instead of
severity-filtered text. Used for recording game events (loot drop /
boss spawn / quest completion) so replays / analytics / network
sync can rebuild the timeline.

### Added

- `src/runtime/event-log.ts` - `EventLog<T>` class:
  - `create({ capacity? })` (default 10000).
  - `append(type, payload)` returns assigned monotonic seq.
  - `bySeq(seq)` / `byType(type)` / `filter(pred)` / `list()` /
    `forEach(cb)`.
  - `clear()` / `size()` / `capacity()` / `highWaterMark()`.
  - `toSnapshot()` / `fromSnapshot(records)` save / load / network.
    fromSnapshot continues numbering past restored max.
  - `dispose()` clears + locks ops.
- Capacity overflow evicts oldest entries.
- Predicates / forEach callbacks isolated.
- `RESOURCE_EVENT_LOG` constant.

### Tests

1976 -> 1998 (22 new in tests/event-log.test.ts).

### Backwards compatibility

Pure addition.

## 0.82.0 - 2026-05-09

**ThresholdTrigger — value-crossing event emitter.** "When HP drops
below 25%, emit low-health-warning." "When XP crosses level
threshold, level up." "When server queue exceeds N, throttle." All
share a shape: a value over time crosses a threshold in a specified
direction; emit once per crossing (with hysteresis so a value
hovering at the line doesn't spam).

### Added

- `src/runtime/threshold-trigger.ts` - `ThresholdTrigger` class:
  - `create()`.
  - `register({ id, threshold, direction, hysteresis?, onTrigger?, onRearm?, data? })`.
    direction is `'below'` or `'above'`.
  - `unregister(id)` / `has(id)` / `size()` / `list()` (defensive).
  - `update(id, value)` checks the threshold; fires callbacks on
    crossing / re-arm.
  - `reset(id)` force-arms (clears triggered flag).
  - `isArmed(id)` / `isTriggered(id)` / `lastValueOf(id)`.
  - `dispose()` clears + locks ops.
- Hysteresis: re-arm requires value past `threshold ± hysteresis`
  in the opposite direction.
- Both callbacks isolated. NaN values rejected.
- `RESOURCE_THRESHOLD_TRIGGER` constant.

### Tests

1954 -> 1976 (22 new in tests/threshold-trigger.test.ts).

### Backwards compatibility

Pure addition.

## 0.81.0 - 2026-05-09

**Quadtree — 2D broadphase spatial index.** SpatialHash (0.30) is
fast for evenly distributed entities at a known cell size, but
sparse / clustered worlds (huge open zones with packed cities,
scattered loot fields) chew memory or scan irrelevant cells.
Quadtree adapts: leaves subdivide only where entities concentrate,
queries skip large empty quadrants in O(log n) instead of O(cells).

### Added

- `src/runtime/quadtree.ts` - `Quadtree` class:
  - `create({ bounds, maxItemsPerNode?, maxDepth? })`. Defaults
    8 items per node, depth 6.
  - `insert(id, aabb)` / `remove(id)` / `update(id, aabb)`.
  - `has(id)` / `size()` / `clear()` / `dispose()`.
  - `query(aabb)` returns ids overlapping the AABB.
  - `queryPoint(x, y)` shortcut for point queries.
  - `queryRadius(cx, cy, r)` AABB candidates filtered by exact
    closest-point-on-AABB distance.
  - `rebuild()` re-inserts every item from scratch (cleanup after
    many updates).
- Items spanning subdivision boundaries stay at their parent node
  (correct results, same item appears once per query).
- Defensive: invalid AABB / empty id rejected; non-finite radius
  / coords return empty.
- `RESOURCE_QUADTREE` constant.

### Tests

1932 -> 1953 (21 new in tests/quadtree.test.ts).

### Backwards compatibility

Pure addition.

## 0.80.0 - 2026-05-09

**HealthBar + M9 0.80 milestone — render-state primitive for entity
HP bars.** Boss fights, mob health, party portraits, NPC interaction
targeting - all want a "what's this entity's HP and where's it
floating?" render state. HealthBar is the keyed-by-entity ledger
that holds position + hp/maxHp + a fade timer + a per-damage pulse.
The renderer pulls active bars via `forEach()` each frame and draws
them in whatever style fits.

This is the M9 0.80 milestone - 10 versions shipped this batch
(0.71 → 0.80) on the combat + UX track, ~1900+ tests.

### Added

- `src/runtime/health-bar.ts` - `HealthBar` class:
  - `create({ capacity?, fadeAfterMs?, fadeDurationMs?, pulseMs?, removeAfterMs? })`.
    Defaults: capacity 64, fadeAfterMs 4000, fadeDurationMs 1000,
    pulseMs 200, removeAfterMs = fadeAfterMs + fadeDurationMs.
  - `upsert(spawn)` - 1 = added, 0 = updated existing, -1 = full
    or invalid.
  - `setPosition(id, x, y)` - move without resetting fade timer.
  - `applyDelta(id, hpDelta)` - damage / heal; clamps hp to
    [0, maxHp]; resets fade timer; bumps pulse to 1.
  - `remove(id)` / `clearAll()` / `has(id)` / `activeCount()` /
    `capacity()`.
  - `tick(dtMs)` advances timers; entries past `removeAfterMs` are
    deleted.
  - `forEach(cb)` yields render state with computed pct (0..1),
    alpha (post-fade), pulse (0..1 post-damage flash). Throwing cb
    isolated.
  - `dispose()` clears + locks ops.
- Render state includes `msSinceLastDelta` so renderers can layer
  their own ramp curves on top.
- Defensive: NaN / negative dt no-op; non-finite hp clamped to 0;
  maxHp 0 yields pct 0.
- `RESOURCE_HEALTH_BAR` constant.

### Tests

1909 -> 1931 (22 new in tests/health-bar.test.ts).

### Milestone — engine 0.80.0

10 versions shipped this M9 batch-2 wave (0.71 → 0.80), 0 breaking
changes. The 0.71 - 0.80 wave focuses on the combat + UX surface
beyond the M8 baseline:

- WeatherSystem (0.71): outdoor ambient signal, pairs with TimeOfDay
- DamageNumberPipeline (0.72): pre-wired DamageFormula → FloatingText
- BuffLifecycle (0.73): duration-tracked StatStack mods
- Crafting (0.74): atomic recipe consume + produce on InventoryGrid
- Achievements (0.75): milestone tracker with progress + unlock
- AggroTable (0.76): multi-target threat ledger for boss AI
- Reactivity (0.77): Signal / Computed / Effect for HUD bindings
- Leaderboard (0.78): local + remote with top-N + around-me queries
- TextScroll (0.79): typewriter dialog reveal
- HealthBar (0.80): render-state for entity HP bars

Combined with 0.34 - 0.70's runtime / audio / input / persistence /
animation / game-systems infra, the engine surface is now broad
enough to scaffold Loom Survivor v1, the Lastlight world hub, the
Founders homepage AND any standard ARPG / hub-MMO consumer
end-to-end without engine forks.

### Backwards compatibility

Pure addition. 0.10-era code compiles unmodified against 0.80.

## 0.79.0 - 2026-05-09

**TextScroll — typewriter text reveal with skip-on-click.** Dialog
boxes / lore text / cinematic captions all benefit from a
typewriter-style reveal: characters appear one at a time, pauses
linger on punctuation, the player can skip to the full text on
click. TextScroll owns that state; consumers wire `visibleText()`
into their renderer each frame and pipe input clicks to `skip()`.

### Added

- `src/runtime/text-scroll.ts` - `TextScroll` class:
  - `create({ charsPerSecond?, punctPauseMs?, onChar?, onComplete? })`.
    Default 60 cps; default punct pauses for `. ! ? , ; :`.
  - `start(text)` / `append(text)` / `clear()`.
  - `tick(dtMs)` advances reveal; honors current punctuation pause.
  - `skip()` jumps to fully revealed; fires onComplete if not yet.
  - `pause()` / `resume()` / `isPaused()`.
  - `visibleText()` text revealed so far; `fullText()` source.
  - `isComplete()` / `revealedCount()` / `totalCount()`.
  - `setCharsPerSecond(rate)` runtime tuning.
  - `dispose()` clears + locks ops.
- Unicode-correct: text is split by codepoints (Array.from) so
  surrogate pairs and emoji reveal as single characters.
- Punctuation pauses fire AFTER the character is revealed
  (typewriter convention - pause comes after the period).
- onChar / onComplete callbacks; both isolated.
- append() after a complete scroll re-arms onComplete.
- Defensive: NaN / 0 / negative dt no-op; non-string text becomes
  empty.
- `RESOURCE_TEXT_SCROLL` constant.

### Tests

1886 -> 1908 (22 new in tests/text-scroll.test.ts).

### Backwards compatibility

Pure addition.

## 0.78.0 - 2026-05-09

**Leaderboard — local + remote leaderboard primitive.** Score
boards, time trials, "fastest clear" rankings - all share a
sorted-by-score map of player entries with top-N + around-me
queries. Leaderboard owns the data structure plus optional
adapter hooks for local persistence and remote sync.

### Added

- `src/runtime/leaderboard.ts` - `Leaderboard` class:
  - `create({ order?, capacity?, persist?, remote? })`. order is
    `'desc'` (higher = better, default) or `'asc'`. capacity default
    1000.
  - `submit({ id, name, score, data? })` - duplicate id keeps best
    (per order); worse-than-current submission returns false.
  - `remove(id)` / `clear()` / `size()`.
  - `byIdEntry(id)` returns entry with rank assigned (or null).
  - `rankOf(id)` 1-based rank; 0 if absent.
  - `top(n)` highest-rank N entries.
  - `around(id, before, after)` window across the player's rank.
  - `list()` full sorted defensive copy.
  - `saveLocal()` / `loadLocal()` via `persist` adapter.
  - `uploadRemote(id)` / `syncRemote()` async via `remote` adapter.
  - `setOrder(order)` / `getOrder()`.
  - `dispose()` clears + locks ops.
- Tied scores: earlier `submittedAt` (monotonic, replay-deterministic)
  ranks higher.
- `submittedAt` is a monotonic int (NOT Date.now); replay-safe.
- Capacity overflow evicts the worst-score entry.
- Missing `persist` / `remote` adapter calls are tolerated no-ops.
- `RESOURCE_LEADERBOARD` constant.

### Tests

1862 -> 1884 (22 new in tests/leaderboard.test.ts).

### Backwards compatibility

Pure addition.

## 0.77.0 - 2026-05-09

**Reactivity — small Signal / Computed / Effect primitive system.**
HUD bindings, derived stats, "live" inspector views,
autosave-on-dirty all share a need: read a value, derive something
from it, run a side effect when it changes. Reactivity owns the
dependency tracking automatically: reading a Signal / Computed
inside an Effect or Computed registers it as a dependency, and
writes propagate to all dependents.

### Added

- `src/runtime/reactivity.ts` - `Reactivity` class:
  - `create({ equals? })`. Default equals = `Object.is`.
  - `signal(initial)` returns `{ get, set, peek }`. `set` skips when
    the new value equals the old (per `equals`).
  - `computed(fn)` returns `{ get, peek, dispose }`. Re-runs when any
    dep changes; if the new value equals the old, downstream effects
    do NOT re-fire. Throwing body keeps prior value.
  - `effect(fn)` returns `{ dispose, isDisposed }`. Runs once on
    creation + every time any dep changes. Throwing body isolated.
  - `batch(fn)` coalesces nested writes into one re-run pass at the
    outermost batch close.
  - `untrack(fn)` reads inside don't subscribe.
  - `dispose()` tears down the entire graph.
- Dynamic dependency tracking: when an effect / computed body changes
  which signals it reads, the dep set updates on each rerun (deps
  cleared + retracked).
- Cycle / re-entrancy guard caps flush at 1000 iterations.
- `peek()` reads without subscribing (escape hatch).
- `RESOURCE_REACTIVITY` constant.

### Tests

1840 -> 1862 (22 new in tests/reactivity.test.ts).

### Backwards compatibility

Pure addition.

## 0.76.0 - 2026-05-09

**AggroTable — multi-target threat ledger for boss AI.** Bosses
with multiple attackers need to know "who is hurting me most right
now?" and "who hit me last?" to drive target-selection AI.
AggroTable is that ledger: keyed by target id, storing accumulated
threat plus a monotonic last-hit counter. Threat decays over time
so a player who stops attacking fades off the threat list, and
entries below a `minThreat` floor get auto-evicted to keep the
table compact.

### Added

- `src/runtime/aggro-table.ts` - `AggroTable` class:
  - `create({ decayPerSecond?, minThreat?, maxTargets? })`. Default
    decay 0 (persistent), minThreat 0.01, maxTargets 64.
  - `addThreat(target, amount)` accumulates; `setThreat(target, amount)`
    replaces. Negative addThreat reduces; clamps at 0 (entry removed).
    Empty target id / non-finite amount rejected.
  - `remove(target)` / `clear()` / `has(target)` / `getThreat(target)`
    / `size()`.
  - `topTarget()` returns highest-threat (ties broken by more recent
    `lastHitAt`). `lastHitTarget()` returns most recently incremented.
  - `list()` sorted by threat desc; defensive copy.
  - `tick(dtMs)` decays every entry by `1 - decayPerSecond * (dt/1000)`
    and removes entries dropping below `minThreat`. NaN / negative
    dt ignored.
  - `setDecayPerSecond(rate)` runtime tuning.
  - `dispose()` clears + locks ops.
- `lastHitAt` is a monotonic int (NOT Date.now); replay-deterministic.
- maxTargets overflow evicts lowest-threat entry (ties: oldest hit).
- `RESOURCE_AGGRO_TABLE` constant.

### Tests

1818 -> 1840 (22 new in tests/aggro-table.test.ts).

### Backwards compatibility

Pure addition.

## 0.75.0 - 2026-05-09

**Achievements — milestone tracker with progress + unlock
callbacks.** Achievements / trophies / titles all share the same
shape: a named goal with a target progress value, a counter that
the game advances as the player plays, and a flag that flips once
when the counter crosses the target. The engine just owns the
bookkeeping; consumers decide what counts as "progress" (kills,
hours played, items collected, quests completed) and wire add() /
set() at the appropriate sites.

This is the first M9 batch-2 release (combat + UX track).

### Added

- `src/runtime/achievements.ts` - `Achievements` class:
  - `create({ onUnlocked?, onProgress? })`.
  - `register({ id, target?, data? })` - target defaults to 1
    (binary one-shot); rejects duplicates / empty ids.
  - `unregister(id)` / `has(id)` / `isUnlocked(id)` /
    `getProgress(id)`.
  - `add(id, delta)` / `set(id, value)` - clamps progress to
    [0, target]; fires onProgress on every change; onUnlocked once
    when crossing target.
  - `reset(id)` zeros progress + unlocks; `resetAll()` does the
    whole registry.
  - `list()` defensive copy with `unlockedAt` (monotonic counter,
    NOT a wall clock - replay-safe).
  - `toSnapshot()` / `fromSnapshot(snap)` for save / load.
    fromSnapshot does NOT fire callbacks (silent restore).
  - `dispose()` clears + locks ops.
- Defensive: invalid target (<= 0 or NaN) falls back to 1; NaN /
  Infinity in add/set rejected; add of 0 is a no-op.
- onProgress / onUnlocked isolated.
- `RESOURCE_ACHIEVEMENTS` constant.

### Tests

1796 -> 1817 (21 new in tests/achievements.test.ts).

### Backwards compatibility

Pure addition.

## 0.74.0 - 2026-05-09

**Crafting — recipe matcher + ingredient consumption + output
production.** Recipes ("iron + handle = sword" with maybe an "anvil"
tool) are everywhere in survival / RPG / hub-MMO worlds. This
module is the recipe registry plus the atomic
consume-then-produce step on top of an InventoryGrid (0.58).

This is the fourth and final M9-opener release before asking Misha
for the next batch of candidates.

### Added

- `src/runtime/crafting.ts` - `Crafting` class:
  - `create({ inventory, onCrafted?, onFailed? })`. The `inventory`
    is structural - any object with `totalOf` / `has` / `add` /
    `remove` matching `IInventoryAdapter` works.
  - `registerRecipe(recipe)` adds; rejects duplicates and invalid
    recipes (empty id, empty outputs, non-positive counts, etc.).
  - `unregisterRecipe(id)`.
  - `hasRecipe(id)` / `getRecipe(id)` / `listRecipes()` (defensive
    copies).
  - `recipesByOutput(itemId)` finds every recipe whose outputs
    include `itemId`.
  - `canCraft(recipe | id)` true when ingredients + tools present.
  - `craft(recipe | id)` atomic consume-then-produce. On
    `output_overflow`, partial outputs are removed AND ingredients
    are re-added (full rollback) before returning the failure.
  - `dispose()` clears recipes + locks ops.
- `Recipe` shape: `{ id, ingredients[], outputs[], tools?, data? }`.
  Tools must be PRESENT but are NOT consumed.
- `CraftResult` is a discriminated union: `{ ok: true, recipe }`
  on success, `{ ok: false, reason, missing? }` on failure.
- `CraftFailureReason`: `unknown_recipe` / `missing_ingredients`
  / `missing_tool` / `output_overflow`.
- `onCrafted(recipe)` fires on success; `onFailed(recipe?, reason, missing?)`
  fires on every failure path. Both isolated.
- `RESOURCE_CRAFTING` constant.

### Tests

1774 -> 1796 (22 new in tests/crafting.test.ts):
- RESOURCE constant.
- registerRecipe accept / duplicate / invalid rejection.
- unregisterRecipe drops + clears output index.
- getRecipe / listRecipes defensive copies.
- recipesByOutput finds by output itemId.
- canCraft true / false on ingredients + tools.
- craft success path consumes + produces; tool not consumed;
  fires onCrafted.
- failure reasons: missing_ingredients / missing_tool /
  unknown_recipe / output_overflow.
- atomic - missing ingredients leaves inventory untouched;
  output_overflow rolls back partial outputs AND restores
  consumed ingredients.
- recipe object can be passed directly (no prior register required).
- Tools are not consumed across multiple crafts.
- dispose clears recipes + locks ops.
- Realistic forge example (3 sword crafts then exhaustion).
- Multi-output recipe (1 log -> 2 planks).
- Stackable outputs merge into existing stacks.

### Backwards compatibility

Pure addition.

## 0.73.0 - 2026-05-09

**BuffLifecycle — duration-tracked StatStack modifiers with
auto-expire.** Buffs and debuffs - "rage for 8 seconds", "burn for
5 seconds dealing damage every 0.5s", "speed boost from potion" -
share a common shape: a named effect that contributes some
StatStack modifiers, optionally fires a periodic tick, and either
runs out after a duration or sticks until manually removed.
BuffLifecycle owns that lifecycle: apply pushes modifiers, tick
expires them, remove cleans up.

This is the third M9 release. Pairs with StatStack (0.59) +
CooldownManager (0.52) for the standard ARPG / hub-MMO buff bar.

### Added

- `src/runtime/buff-lifecycle.ts` - `BuffLifecycle` class:
  - `create({ statStack?, sourcePrefix?, onApplied?, onExpired?, onRemoved?, onTick? })`.
  - `apply(buff)` pushes modifiers under
    `${sourcePrefix}${buff.id}` (default prefix `buff:`); refreshes
    in place if id already active (replaces modifiers + resets
    timer); fires `onApplied(buff, isRefresh)`.
  - `refresh(id)` resets duration without re-applying modifiers;
    returns false if not active.
  - `remove(id)` strips modifiers + fires `onRemoved`.
  - `removeAll()` clears all + per-buff `onRemoved`.
  - `tick(dtMs)` advances elapsed time; fires `onTick` at every
    `tickIntervalMs` boundary (multiple per dt allowed); fires
    `onExpired` on natural duration runout + strips modifiers.
  - `has(id)` / `remainingMs(id)` (-1 for permanent, 0 if inactive)
    / `list()` (defensive copy).
  - `dispose()` strips ALL pending StatStack modifiers + locks ops.
- `Buff` shape: `{ id, durationMs, modifiers?, tickIntervalMs?, data? }`.
- `ActiveBuff` shape: `{ buff, remainingMs, elapsedMs, ticksFired }`.
- Permanent buffs (durationMs <= 0) advance but never auto-expire.
- Ticks bounded by durationMs (no over-tick on expiry).
- All callbacks isolated (throwing handler doesn't break the engine).
- Defensive: NaN / negative dt ignored; empty / invalid buff ids
  rejected; modifiers undefined treated as no-op.
- StatStack receiver is OPTIONAL (use the lifecycle as a pure timer
  + tick orchestrator without modifier routing).
- `RESOURCE_BUFF_LIFECYCLE` constant.

### Tests

1752 -> 1774 (22 new in tests/buff-lifecycle.test.ts):
- RESOURCE constant.
- apply pushes modifiers under prefixed source; without StatStack is
  a no-op for routing.
- duplicate apply refreshes (isRefresh=true) + replaces modifiers.
- remove drops modifiers + fires onRemoved (not onExpired).
- tick advances elapsedMs; expires on duration runout; strips mods.
- permanent buff (durationMs <= 0) never expires; remainingMs = -1.
- tickIntervalMs cadence; large dt fires multiple ticks; boundary
  exact crossings; ticks bounded by durationMs.
- has + remainingMs reflect state.
- list defensive copy.
- removeAll clears + per-buff onRemoved.
- NaN / negative dt ignored.
- All four callbacks isolated when throwing.
- dispose strips all StatStack mods + locks ops.
- Multiple distinct buff ids stack independently.
- buff.modifiers undefined treated as no-op.
- refresh resets timer + tick counter; doesn't re-apply mods.
- Realistic DoT (3s burn ticking every 500ms with damage data).

### Backwards compatibility

Pure addition.

## 0.72.0 - 2026-05-09

**DamageNumberPipeline — bridge from DamageFormula (0.66) to
FloatingText (0.37).** Most action / RPG consumers wire
computeDamage + FloatingText.emit by hand at every attack site -
same boilerplate, same color/scale rules, every time. The pipeline
owns that wiring: pass attacker + defender + position, get back the
DamageResult AND a styled floating-text spawn dispatched
automatically.

This is the second M9 release, designed for "make combat readable
at a glance" - normal hits, crits, and blocked / heavily-mitigated
hits each render with a configurable color + scale, plus a crit
suffix on the text.

### Added

- `src/runtime/damage-number-pipeline.ts` - `DamageNumberPipeline` class:
  - `create({ floatingText, compute?, style?, formatText?, blockedAtOrBelow? })`.
  - `publish(attacker, defender, x, y, opts?)` runs compute + spawns
    a styled floating text; returns the DamageResult so consumers can
    also subtract HP / fire onKill / etc.
  - `publishResult(result, x, y)` skips compute and spawns from an
    already-computed result (e.g. server-authoritative damage).
  - `setStyle(style)` partial style update; `getStyle()` returns
    a defensive copy.
  - `dispose()` locks ops; subsequent publishes still compute but
    skip the spawn (or no-op for publishResult).
- Style: `normalColor` / `critColor` / `blockedColor` /
  `normalScale` / `critScale` / `lifetimeMs` / `critSuffix`.
  Defaults: white / warm-gold / grey / 1 / 1.4 / FloatingText
  default / "!".
- `blockedAtOrBelow` threshold (default 0): a hit with
  `result.final <= threshold` uses `blockedColor` and skips the
  crit branch.
- Default text format: `Math.round(result.final)` + critSuffix on
  crit. Custom `formatText` overrides the default and survives
  `setStyle`.
- Pool full (FloatingText.emit returns -1) does not throw; publish
  still returns the DamageResult.
- `RESOURCE_DAMAGE_NUMBER_PIPELINE` constant.

### Tests

1732 -> 1753 (21 new in tests/damage-number-pipeline.test.ts):
- RESOURCE constant.
- publish computes + emits; crit path uses critColor/scale/suffix;
  blocked path uses blockedColor.
- publishResult skips compute.
- custom compute / formatText overrides.
- setStyle propagates critSuffix to default formatter; does NOT
  clobber user-provided formatter.
- getStyle defensive copy.
- partial style overrides leave defaults in place for unspecified
  fields.
- pool full returns -1; publish still returns result.
- lifetime override propagated to spawn; absent leaves
  spawn.lifetimeMs absent.
- dispose locks publish / publishResult / setStyle.
- Default formatter rounds final to integer.
- Realistic normal / crit / block flow.

### Backwards compatibility

Pure addition.

## 0.71.0 - 2026-05-09

**WeatherSystem — discrete weather states with ramped intensity
transitions.** Outdoor zones often layer a weather signal on top
of TimeOfDay (0.70): a state machine that flips between named
conditions (clear / rain / storm / snow / fog / custom) plus a
continuous intensity that can ramp between values over a
configurable duration. Renderers, ambient audio, encounter pools,
and movement modifiers all read the current state + intensity each
frame. WeatherSystem owns the transition; consumers react through
onWeatherChanged + onIntensitySettled callbacks.

This is the M9 opener and pairs naturally with 0.70 TimeOfDay - a
zone with day/night and weather both running gets a richer ambient
signal without engine forks.

### Added

- `src/runtime/weather-system.ts` - `WeatherSystem` class:
  - `create({ states?, initial?, initialIntensity?, onWeatherChanged?, onIntensitySettled? })`.
  - `setWeather(name, { rampMs?, intensity? })` flips state and
    optionally ramps intensity over rampMs ms; instant when
    rampMs is 0/missing/negative. Returns false on unknown name.
  - Calling `setWeather` with the current state name re-targets
    intensity without firing `onWeatherChanged` (use to dim an
    active rain to a drizzle).
  - `tick(dtMs)` advances the active intensity ramp; fires
    `onIntensitySettled` exactly once when the ramp completes.
  - `registerState({ name, defaultIntensity? })` adds at runtime;
    returns false on duplicate or empty name.
  - `getWeather()` / `getIntensity()` / `isTransitioning()` /
    `hasState()` / `getStates()` (defensive copy in registration
    order).
  - `dispose()` locks ops.
- Defaults: missing `defaultIntensity` is treated as 0 (idle / no
  weather); `initialIntensity` overrides the initial state's
  default; an explicit `intensity` on setWeather always wins.
- Intensity clamps to [0, 1] on every input (state default,
  initial intensity, transition target).
- onWeatherChanged / onIntensitySettled isolated (throwing handler
  doesn't break the engine).
- Defensive: NaN / negative dt ignored; unknown initial state
  ignored; empty state names rejected at registration.
- `WeatherState`, `WeatherTransitionOptions`, `WeatherSystemOptions`
  types exported.
- `RESOURCE_WEATHER_SYSTEM` constant.

### Tests

1710 -> 1731 (21 new in tests/weather-system.test.ts):
- RESOURCE_WEATHER_SYSTEM stable string; empty config defaults.
- initial state respected; unknown initial ignored; explicit
  initialIntensity overrides state default.
- setWeather instant flip when no rampMs; unknown state returns
  false + skips callbacks.
- setWeather with rampMs interpolates intensity over time; ramp
  completes on/after rampMs; onIntensitySettled fires exactly once.
- setWeather to current state re-targets intensity without
  onWeatherChanged.
- explicit intensity overrides state default; intensity clamps
  to [0, 1].
- tick during ramp does not re-fire onWeatherChanged.
- registerState adds; rejects duplicates + empty names.
- getStates defensive-copy in registration order.
- throwing onWeatherChanged / onIntensitySettled isolated.
- NaN / negative dt ignored during ramp.
- tick with no ramp is a no-op.
- rampMs <= 0 falls back to instant flip.
- dispose locks ops.
- Realistic chained transitions over a tick loop.

### Backwards compatibility

Pure addition.

## 0.70.0 - 2026-05-09

**TimeOfDay + M8 0.70 milestone — day/night cycle with named
phase transitions.** Outdoor zones often have a day/night cycle
that drives lighting, encounter pools, NPC schedules, and audio
ambience. TimeOfDay tracks an in-game clock with a tick-driven
acceleration factor and emits onPhaseChanged callbacks when the
clock crosses configurable phase boundaries.

This is the M8 finale and lands the engine at version **0.70.0** —
36 versions shipped this session (0.34 → 0.70), zero breaking
changes, ~1700 tests.

### Added

- `src/runtime/time-of-day.ts` - `TimeOfDay` class:
  - `create({ dayLengthMs?, initialHour?, phases?, onPhaseChanged? })`.
  - `tick(dtMs)` advances clock by `(dt / dayLengthMs) * 24` hours;
    wraps past 24 + increments dayCount.
  - `getHour()` / `getDayCount()` / `getPhase()` / `getPhases()`
    (defensive copy).
  - `setHour(hour)` — wraps to [0, 24); fires onPhaseChanged on
    phase change.
  - `setDayLengthMs(ms)` / `getDayLengthMs()` runtime tuning.
  - `dispose()` locks ops.
- Phases sorted by startHour internally; pre-dawn hours wrap to
  the previous day's last phase (so phase coverage is total).
- `onPhaseChanged(next, prev)` fires only on actual phase change
  (no spurious fires on same-phase ticks). Throwing isolated.
- Defensive: NaN / negative dt ignored; initialHour > 24 wraps;
  dayLengthMs <= 0 keeps existing.
- `PhaseBoundary`, `TimeOfDayOptions` types exported.
- `RESOURCE_TIME_OF_DAY` constant.

### Tests

1689 -> 1710 (21 new in tests/time-of-day.test.ts):
- RESOURCE_TIME_OF_DAY stable string; defaults.
- initialHour respected + wraps past 24.
- tick advances proportional to dayLengthMs; wraps past 24 +
  increments dayCount; multi-day ticks accumulate.
- setHour updates + wraps + fires onPhaseChanged on phase flip.
- getPhase null when no phases; correct phase for hour;
  pre-dawn wraps to last (yesterday's) phase.
- onPhaseChanged fires across day boundary; not on same-phase
  tick; throwing isolated.
- setDayLengthMs updates acceleration.
- NaN / negative dt ignored.
- Phases sorted internally.
- dispose locks ops.
- Realistic full-day cycle.

### Backwards compatibility

Pure addition.

### Milestone — engine 0.70.0

36 versions shipped this M8 session (0.34 → 0.70), 0 breaking
changes, 1710 tests across 80+ test files. The pure-additive
policy held throughout: 0.10-era code compiles unmodified
against 0.70.

**0.61 - 0.70 game-systems wave:**
- DialogTree (0.61): branching dialog with conditions + actions
- LootTable (0.62): weighted random drops, seedable RNG
- QuestLog (0.63): state machine + objective tracking
- SteeringBehaviors (0.64): seek/flee/arrive/pursue/evade/
  separation/wander
- ToastQueue (0.65): severity-tiered notifications
- DamageFormula (0.66): atk/def/crit/mit/resist canonical math
- ActionHistory (0.67): undo / redo command stack
- Coroutine (0.68): generator-based multi-tick async
- Watchdog (0.69): heartbeat monitor with stale-detection
- TimeOfDay (0.70): day/night cycle with named phases

The 0.61 - 0.70 wave focuses on the gameplay surface a typical
ARPG / hub-MMO consumer wires together — quest content, loot
distribution, NPC behavior, combat math, undo/redo authoring
tooling, async cinematics, connection health, ambient time-of-day.
Combined with 0.34 - 0.60's runtime / audio / input / persistence
infra, the engine surface is now broad enough to scaffold
Loom Survivor v1, the Lastlight world hub, and the Founders
homepage's interactive surface end-to-end without engine forks.

## 0.69.0 - 2026-05-09

**Watchdog - heartbeat monitor with stale-detection callbacks.**
Long-running connections (SSE streams, plugin processes,
multiplayer peers, asset workers) need "did this thing crash?"
checks. Watchdog tracks named heartbeats, marks them stale when
too long passes between pings, and fires onStale / onAlive
callbacks on state flips.

### Added

- `src/runtime/watchdog.ts` - `Watchdog` class:
  - `register(name, opts?)` — begins watching; returns false on
    duplicate or empty name.
  - `unregister(name)` / `has(name)` / `count()`.
  - `heartbeat(name)` — resets age; revives stale entries (fires
    onAlive on flip).
  - `tick(dtMs)` — advances every entry's age; entries crossing
    timeoutMs flip alive→stale + fire onStale once.
  - `status(name)` / `isAlive(name)` / `list()` / `staleNames()`.
  - `setTimeout(name, ms)` — runtime threshold update.
  - `clear()` / `dispose()`.
- Per-entry `timeoutMs` override; `defaultTimeoutMs` falls back
  (default 5000ms).
- onStale / onAlive callbacks; throwing isolated.
- Defensive: NaN / negative dt ignored; missing entry returns
  false / null cleanly.
- `WatchdogEntryOptions`, `WatchdogStatus`, `WatchdogOptions`
  types exported.
- `RESOURCE_WATCHDOG` constant.

### Tests

1665 -> 1689 (24 new in tests/watchdog.test.ts):
- RESOURCE_WATCHDOG stable string; starts empty.
- register adds; duplicate returns false; empty name rejected.
- unregister / missing returns false.
- tick keeps alive within timeout; crosses timeout = stale.
- heartbeat resets age + revives stale.
- onStale fires once at flip; onAlive only on stale → alive.
- Throwing onStale / onAlive isolated.
- Per-entry timeoutMs override; setTimeout updates.
- setTimeout / heartbeat on missing return false.
- status returns full info; missing returns null.
- list / staleNames work.
- NaN / negative dt ignored.
- clear / dispose lock ops.
- Realistic multi-connection example.

### Backwards compatibility

Pure addition.

## 0.68.0 - 2026-05-09

**Coroutine - generator-based multi-tick async over EngineClock.**
Some game logic naturally spans multiple ticks: cinematic
scripting, AI scripts, scripted boss patterns, tutorial overlays,
NPC dialogue beats. Promises don't fit (microtask queue, not
engine clock). Coroutine wraps a JavaScript generator; the
generator yields wait values that tell the runtime when to resume.

### Added

- `src/runtime/coroutine.ts` - `Coroutine` class:
  - `start(genFn, opts?)` — returns the routine id; opts:
    `onDone`, `onError`.
  - `cancel(id)` — remove a running routine.
  - `cancelAll()` / `dispose()`.
  - `tick(dtMs)` — drives every active routine forward.
  - `activeCount()` / `isActive(id)`.
- Yieldable wait helpers (consumer imports):
  - `waitMs(ms)` — pause for ms of accumulated tick time.
  - `waitFrames(n)` — pause for N ticks (regardless of dt).
  - `waitUntil(predicate)` — poll the predicate every tick.
  - `yield;` (or `yield null;`) — cooperative one-tick yield.
- Defensive: throwing generator fires onError; throwing
  predicate is treated as not-yet; sync throw at start fires
  onError; large dt drains multiple stages in one tick.
- Optional `onCompleted(id)` global callback; throwing isolated.
- `WaitMs`, `WaitUntil`, `WaitFrames`, `Yieldable`,
  `CoroutineOptions`, `CoroutineStartOptions` types exported.
- `RESOURCE_COROUTINE` constant.

### Tests

1645 -> 1665 (20 new in tests/coroutine.test.ts):
- RESOURCE_COROUTINE stable string; starts empty.
- Instant routine completes immediately on tick.
- waitMs / waitFrames / waitUntil semantics.
- Chained yields advance through stages.
- cancel removes; cancel missing returns false.
- onDone fires; onCompleted fires per routine.
- Throwing generator fires onError; sync throw at start fires
  onError.
- cancelAll wipes everything.
- NaN / negative dt clamped (waits unchanged).
- yield without wait runs again next tick (cooperative).
- Large dt drains multi-stage routine in one tick.
- Throwing waitUntil predicate treated as not-yet.
- dispose locks ops.
- Realistic boss spawn cinematic.

### Backwards compatibility

Pure addition.

## 0.67.0 - 2026-05-09

**ActionHistory - undo / redo stack with command pattern.**
Map editors, level builders, dialog-authoring tools, in-game
"undo this" surfaces want undo/redo. ActionHistory is the
canonical command-stack machinery: each action knows how to
apply itself and how to undo itself.

### Added

- `src/runtime/action-history.ts` - `ActionHistory` class:
  - `push(action)` — applies the action, pushes to undo stack,
    clears redo stack (new branch). Capacity overflow drops oldest.
  - `undo()` / `redo()` — return true if successful.
  - `canUndo()` / `canRedo()`.
  - `peekUndo()` / `peekRedo()` — read topmost action (for menu
    labels like "Undo: place wall").
  - `undoSize()` / `redoSize()` introspection.
  - `clear()` empties both stacks; `dispose()` locks ops.
  - Optional capacity (default 100; 0 = unbounded).
  - Optional onApplied + onUndone callbacks; throwing isolated.
- Defensive: throwing apply doesn't push to stack; throwing undo
  re-pushes to undo stack; throwing redo re-pushes to redo stack;
  invalid action shape rejected silently.
- Action type exported as `HistoryAction` (avoids collision with
  the existing dialog-tree Action).
- `RESOURCE_ACTION_HISTORY` constant.

### Tests

1623 -> 1645 (22 new in tests/action-history.test.ts):
- RESOURCE_ACTION_HISTORY stable string; starts empty.
- push applies + enables undo.
- undo reverses; on empty returns false.
- redo re-applies; on empty returns false.
- New push clears redo (new branch).
- Capacity caps undo stack; capacity 0 = unbounded.
- peekUndo / peekRedo + null on empty.
- Throwing apply does not push; throwing undo re-pushes;
  throwing redo re-pushes to redo.
- clear empties both; invalid action rejected.
- onApplied / onUndone fire; throwing isolated.
- dispose locks ops.
- Realistic edit sequence example.

### Backwards compatibility

Pure addition.

## 0.66.0 - 2026-05-09

**DamageFormula - canonical RPG combat math.** Pure-math
combat damage: base attack power → critical roll → variance →
hyperbolic armor mitigation → optional type-resist → flat
reduction → minDamage floor.

The armor mitigation uses `armor / (armor + K)` (default K=100)
so armor never fully reduces damage to zero. K is configurable
per zone / level scaling.

### Added

- `src/runtime/damage-formula.ts`:
  - `computeDamage(attacker, defender, opts?)` returns
    `{ final, raw, mitigated, isCrit, mitigationPct, varianceRoll }`.
  - AttackerStats: attackPower, critChance (0-1), critMultiplier
    (default 1.5), variance fraction, armorPen, type.
  - DefenderStats: armor, flatReduction, resists (per-type
    fraction map).
  - Options: armorK (curve constant), minDamage (floor), rng
    (seedable; default Math.random).
- Pure: same RNG output → same result. Combine with seedable
  Entropy (0.17) or LootTable's mulberry32 for replay
  determinism.
- Defensive: NaN / negative attackPower clamped; critChance >1
  clamps; variance >1 clamps; armorPen exceeding armor clamps to 0.
- `AttackerStats`, `DefenderStats`, `DamageOptions`,
  `DamageResult` types exported.
- `RESOURCE_DAMAGE_FORMULA` constant.

### Tests

1602 -> 1623 (21 new in tests/damage-formula.test.ts):
- RESOURCE_DAMAGE_FORMULA stable string.
- Zero attack power = minimum damage.
- No crit chance / 100% crit / variance range / minDamage floor.
- Armor reduces hyperbolically; very high armor approaches but
  never reaches 100%.
- armorPen reduces effective armor; armorPen > armor caps at 0.
- Flat reduction applied AFTER mitigation.
- Type-resist matches; missing type is no-op.
- Full pipeline test (crit + armor + flat + resist).
- Deterministic with same RNG output.
- Out-of-range stats clamped (critChance, variance, attackPower).
- Result includes per-stage breakdown.
- Realistic crit fireball into mage.

### Backwards compatibility

Pure addition.

## 0.65.0 - 2026-05-09

**ToastQueue - severity-tiered notification queue with auto-dismiss.**
"+50 gold", "Boss spawned", "Connection lost", "Quest accepted" -
every game surface notification follows the same shape: severity,
message, optional payload, auto-dismiss timer, optional manual
dismiss. ToastQueue is that machinery.

### Added

- `src/runtime/toast-queue.ts` - `ToastQueue` class:
  - `post(severity, message, opts?)` returns id; severity helpers
    `info` / `success` / `warn` / `error` / `critical`.
  - `tick(dtMs)` ages active toasts; expired ones auto-remove.
  - `dismiss(id)` manual remove.
  - `clear()` empties queue.
  - `forEach(cb)` / `list()` (defensive copies) / `count()` /
    `capacity()`.
  - Default lifetimes per severity (info/success 3s, warn 5s,
    error 8s, critical sticky); `lifetimeMs: -1` makes any
    toast sticky.
  - Capacity-bounded (default 16); when full, `post` evicts the
    oldest lowest-severity toast.
  - `onPost(toast)` and
    `onRemoved(toast, 'expired' | 'dismissed' | 'evicted')`
    callbacks; throwing isolated.
  - `dispose()` locks ops.
- `ToastSeverity`, `Toast`, `PostOptions`, `ToastQueueOptions`
  types exported.
- `RESOURCE_TOAST_QUEUE` constant.

### Tests

1578 -> 1602 (24 new in tests/toast-queue.test.ts):
- RESOURCE_TOAST_QUEUE stable string; starts empty.
- post + severity helpers.
- tick decrements + expires; critical = sticky; explicit
  lifetimeMs override; lifetimeMs < 0 sticky.
- dismiss + missing id; clear fires onRemoved per toast.
- Capacity caps; eviction picks oldest lowest-severity.
- onPost / onRemoved fire; throwing isolated.
- forEach / list / data payload preserved; ageMs accumulates.
- Invalid severity rejected.
- NaN / negative dt ignored.
- dispose locks ops.
- Realistic mixed-severity flow.

### Backwards compatibility

Pure addition.

## 0.64.0 - 2026-05-09

**SteeringBehaviors - 2D NPC navigation primitives.** Mob nav, NPC
walk, projectile homing, crowd dispersion all share Reynolds-style
steering math. Each behaviour returns a steering force; consumers
sum/weight them and apply to a kinematic body.

Pure functions, all return fresh `{ x, y }` so they compose:
seek / flee / arrive (decelerating seek) / pursue (lead a moving
target) / evade (anti-pursue) / separation (push from neighbours)
/ wander (smoothed random heading).

### Added

- `src/runtime/steering-behaviors.ts`:
  - `seek(agent, target)` — desired-velocity delta, capped at
    `agent.maxForce` if set.
  - `flee(agent, target)` — inverse of seek.
  - `arrive(agent, target, slowRadius)` — seek + decelerate
    inside slowRadius for stop-on-target.
  - `pursue(agent, target)` — predict target's future position
    based on time-to-reach, seek that point.
  - `evade(agent, target)` — flee from predicted future position.
  - `separation(agent, neighbours, radius)` — sum of inverse-
    distance vectors from too-close neighbours.
  - `wander(agent, state, forwardDistance, jitter, rng?)` —
    state.angle drifts each call, returns seek-toward-heading.
    Custom RNG for replay determinism.
- `Agent` type: `{ x, y, vx, vy, maxSpeed, maxForce? }`.
- `WanderState` type: `{ angle }` consumer stores per-agent.
- All forces are pure functions; consumer integrates outside.
- `RESOURCE_STEERING_BEHAVIORS` constant.

### Tests

1558 -> 1578 (20 new in tests/steering-behaviors.test.ts):
- RESOURCE_STEERING_BEHAVIORS stable string.
- seek toward target / on-target zero / maxForce cap.
- flee invert / on-target zero.
- arrive matches seek when far / decelerates inside slow radius
  / counteracts velocity at target.
- pursue leads moving target / equals seek for stationary.
- evade flees from predicted future.
- separation: empty / outside-radius / single neighbour pushes /
  multi-neighbour sums / radius=0 zero.
- wander state.angle drifts; returns seek-toward-heading.
- Realistic pursue + separation combined.

### Backwards compatibility

Pure addition.

## 0.63.0 - 2026-05-09

**QuestLog - quest state machine + objective tracking.** Quests
follow a small state machine (offered → accepted → active →
complete | failed) with one or more objectives that progress
independently. QuestLog tracks every quest's state and per-
objective counts. Snapshot-friendly for save data.

The CATALOG (definitions) is consumer-side. QuestLog only stores
runtime state by quest id.

### Added

- `src/runtime/quest-log.ts` - `QuestLog` class:
  - `offer(questId, { objectives })` - registers in 'offered'.
  - `accept(questId)` - offered → accepted → active in one call.
  - `decline(questId)` - removes from log.
  - `addProgress(questId, objectiveId, n)` - updates progress;
    auto-marks done; auto-completes quest when all objectives
    done.
  - `fail(questId)` - active/accepted → failed.
  - `complete(questId)` - force-complete from active (bypasses
    objective checks; marks all objectives done).
  - `getState(questId)` / `get(questId)` (defensive copy) /
    `has(questId)`.
  - `listIds(filter?)` / `list(filter?)` / `count(filter?)`.
  - `toSnapshot()` / `fromSnapshot(snap)` for save data.
  - `dispose()` locks subsequent ops.
- Optional `onStateChanged(id, prev, next)` and
  `onObjectiveProgress(id, oid, p, r)` callbacks; throwing
  isolated.
- Defensive: empty id rejected, double-offer no-op, addProgress
  on non-active quest returns false, addProgress with 0/negative
  ignored, etc.
- Optional `now` clock seam for deterministic timestamps.
- `QuestState`, `QuestObjective`, `QuestEntry`,
  `OfferQuestOptions`, `QuestLogOptions` types exported.
- `RESOURCE_QUEST_LOG` constant.

### Tests

1531 -> 1558 (27 new in tests/quest-log.test.ts):
- RESOURCE_QUEST_LOG stable string; starts empty.
- offer adds in offered; idempotent; rejects empty id.
- accept transitions offered → active (offered → accepted →
  active onStateChanged emitted in pairs).
- decline removes; only on offered.
- addProgress: tracks, caps at required, auto-marks done,
  auto-completes quest when all objectives done.
- addProgress on non-active / missing objective / 0/neg /
  already-done returns false.
- onObjectiveProgress fires with current + required.
- fail / complete state guards.
- list / count filter by state.
- get returns defensive copy.
- snapshot + fromSnapshot roundtrip.
- dispose locks; throwing onStateChanged isolated.

### Backwards compatibility

Pure addition.

## 0.62.0 - 2026-05-09

**LootTable - weighted random drop tables with seedable RNG.**
Boss kills, chest opens, mob despawns, daily rewards share the
"pick a few items from a weighted pool" pattern. LootTable is
that primitive: register entries with a weight, optional
guaranteed drops, optional count or count range, and a seedable
RNG (mulberry32) so loot is replay-deterministic.

### Added

- `src/runtime/loot-table.ts` - `LootTable` class:
  - `create({ entries, rollCount?, guaranteed?, seed? })`.
  - `roll()` returns LootDrop[] (guaranteed first, then weighted
    picks).
  - `rollMultiple(times)` aggregates N rolls.
  - `probabilityOf(itemId)` returns weight / total for tooltips.
  - `reseed(seed?)` resets the RNG (or rebases to a new seed).
  - `poolSize()` / `totalWeightSum()` introspection.
  - `dispose()` locks subsequent ops.
- Defensive: invalid entries (no id / weight <= 0) silently
  filtered. Empty pool returns no weighted drops (guaranteed
  still appear).
- `LootEntry`, `LootDrop`, `LootTableOptions` types exported.
- `RESOURCE_LOOT_TABLE` constant.

### Tests

1510 -> 1531 (21 new in tests/loot-table.test.ts):
- RESOURCE_LOOT_TABLE stable string.
- Empty entries throws; invalid filter (no id / weight <= 0).
- Single roll; rollCount=N produces N drops.
- count + countRange resolve; flipped countRange handled.
- Deterministic with seed; different seeds differ.
- reseed resets; reseed with new seed changes output.
- Guaranteed drops always appear; use registered count;
  unregistered guaranteed defaults count=1.
- rollMultiple sums; 0/negative returns empty.
- probabilityOf returns weight / total; unknown returns 0.
- Empty pool returns empty drops.
- dispose locks ops.
- Distribution roughly matches weights at scale.

### Backwards compatibility

Pure addition.

## 0.61.0 - 2026-05-09

**DialogTree - branching dialog with conditions + actions.**
Most dialog systems are nodes with text + a list of choices, each
choice has an optional `if` predicate and optional `do` action,
and points to a next node. DialogTree is that machinery as a
generic state container - the engine doesn't know what your
predicates or actions do, only that they're functions you
registered by name.

### Added

- `src/runtime/dialog-tree.ts` - `DialogTree` class:
  - `create({ start, nodes, predicates?, actions?, onEnd? })`.
  - Nodes: `{ text, choices, onEnter? }`. Choices:
    `{ label, next, if?, do?, data? }`.
  - `start()` / `end()` / `isActive()` / `currentId()` / `current()`.
  - `visibleChoices()` filters by registered predicates; missing
    or throwing predicates hide their choice (defensive).
  - `choose(index)` — picks from visibleChoices; fires `do`
    action with optional `data`; transitions to `next`. Unknown
    `next` ends the dialog (fires onEnd).
  - `setPredicate(name, fn)` / `setAction(name, fn)` — register
    at runtime so the dialog catalog can load before quest /
    skill systems are wired.
  - Throwing actions don't block transitions; throwing onEnter
    isolated.
  - `dispose()` locks subsequent ops.
- `DialogChoice`, `DialogNode`, `DialogTreeOptions`,
  `DialogPredicate`, `DialogAction` types exported.
- `RESOURCE_DIALOG_TREE` constant.

### Tests

1492 -> 1510 (18 new in tests/dialog-tree.test.ts):
- RESOURCE_DIALOG_TREE stable string.
- create requires start + matching node.
- starts inactive; start() activates start node.
- visibleChoices: all when no predicates; predicates filter;
  missing/throwing predicate hides.
- choose advances; fires action with data; throwing action does
  not block; unknown next ends + fires onEnd; bad index returns
  false; before-start returns false.
- onEnter fires on node entry.
- setPredicate / setAction at runtime.
- end() terminates; double-end no-op.
- dispose locks ops.
- Realistic quest-offer scenario.

### Backwards compatibility

Pure addition.

## 0.60.0 - 2026-05-09

**ReplayRecorder + 0.60 milestone - deterministic input + tick
capture.** The engine had every ingredient for deterministic
replay: Entropy (0.17) for seeded RNG, EngineClock (0.25) for
tick-driven time, WorldSnapshot (0.26) for serialize/restore,
TimerScheduler (0.48) for tick-driven setTimeout, PersistentStorage
(0.38) + SaveSlots (0.45) for saving traces. ReplayRecorder is the
recorder that captures the per-tick dt + input event stream and
replays it later against the same initial seed + snapshot.

The recorder itself does NOT integrate with World - that's the
consumer's job. This keeps the primitive small and decoupled from
specific world implementations. Pairs with the existing replay
infra to give consumers full record-at-crash + replay-from-trace
for QA / bug repro / coop session sync.

### Added

- `src/runtime/replay-recorder.ts` - `ReplayRecorder` class:
  - `create({ initialSeed?, engineVersion?, maxSteps? })` /
    `fromTrace(trace)`.
  - `attachInitialSnapshot(snap)` - stamp the initial WorldSnapshot
    for restore-before-playback.
  - **Recording**: `startRecording()` / `recordEvent(type, key?,
    data?)` (buffers until next tick) / `recordTick(dtMs)` (flushes
    buffered events into a step) / `stopRecording()`.
  - **Playback**: `startPlayback()` / `nextStep()` / `hasNextStep()`
    / `rewind()` / `stopPlayback()`.
  - `toTrace()` produces a JSON-safe envelope with version,
    engineVersion, initialSeed, initialSnapshot, steps array.
  - `getMode()` / `stepCount()` / introspection.
- `maxSteps` option caps recording at the latest N steps (oldest
  drops on overflow). Useful for crash-report ringbuffers.
- `nextStep()` returns defensive copies; mutation does not affect
  recorder state.
- Mode-protected: cannot startRecording from playback; cannot
  startPlayback while recording.
- `ReplayEvent`, `ReplayStep`, `ReplayTrace`,
  `ReplayRecorderOptions`, `RecorderMode` types exported.
- `RESOURCE_REPLAY_RECORDER` constant.

### Tests

1466 -> 1492 (26 new in tests/replay-recorder.test.ts):
- RESOURCE_REPLAY_RECORDER stable string; starts idle.
- Stamps initial seed + engine version.
- startRecording transitions; cannot from playback mode.
- recordTick captures dt + advances count.
- recordEvent buffers; events without recordTick stay buffered.
- Empty type ignored; recordEvent before startRecording no-op;
  recordTick before startRecording returns null.
- maxSteps caps the recording at latest N.
- stopRecording transitions to finished.
- startPlayback resets cursor; nextStep yields steps in order;
  null at end + transitions to finished.
- hasNextStep reflects state; rewind resets cursor; rewind no-op
  outside playback.
- stopPlayback transitions to finished.
- Cannot startPlayback while recording.
- toTrace produces JSON-safe envelope; round-trip JSON preserves
  shape + nested data.
- fromTrace + nextStep reproduces recording.
- attachInitialSnapshot survives toTrace + fromTrace.
- nextStep returns defensive copies.
- Realistic record + replay session example.

### Backwards compatibility

Pure addition. Engine consumers opt in.

### Milestone — engine 0.60.0

26 versions shipped this M8 session (0.34 → 0.60). 1492 tests
across the engine. Pure-additive policy held: 0.10-era code
compiles unmodified against 0.60. The engine surface now also
includes:

**Game systems (0.51 - 0.60):**
- StateMachine (0.51): generic FSM
- CooldownManager (0.52): per-key cooldown tracker
- LRUCache (0.53): generic LRU
- AABB (0.54): axis-aligned bounding box queries + raycast
- Pathfinder (0.55): A* with grid-agnostic isWalkable
- SceneManager (0.56): named scenes with async enter/exit
- TileMap (0.57): Uint16Array-backed 2D tile grid
- InventoryGrid (0.58): slot-based inventory with stacks
- StatStack (0.59): derived stats from base + modifier stack
- ReplayRecorder (0.60): deterministic record + replay

The 0.51 - 0.60 wave focuses on game-system primitives a typical
ARPG / hub-MMO consumer wires together. Combined with the audio /
input / runtime infrastructure from 0.35 - 0.50, the engine now
covers the canonical surface needed to build the Loom Survivor
v1 onboarding spec end-to-end without engine forks.

## 0.59.0 - 2026-05-09

**StatStack - base + modifier stack producing derived stats.**
Stats (max-hp, attack-power, run-speed, crit-chance) come from
layered sources: base from class, equipment bonuses, buffs,
debuffs, aura effects. Each source can apply a flat addition, a
percentage-of-base, or a final multiplier. StatStack applies them
in the canonical RPG order:

1. baseValue
2. + sum of all 'flat' additions
3. * (1 + sum of all 'percentBase')
4. * product of all 'multiplier' (final scalar)

### Added

- `src/runtime/stat-stack.ts` - `StatStack` class:
  - `setBase(stat, value)` / `getBase(stat)`.
  - `addModifier({ source, stat, kind, value })` - replaces any
    existing modifier with the same (source, stat, kind).
  - `removeModifier(source, stat, kind?)` - kind optional.
  - `removeBySource(source)` - drops every modifier across all
    stats with that source. Useful for buff expiry / unequip.
  - `get(stat)` - lazy derived value with cached re-compute.
  - `getModifiers(stat)` - defensive copies.
  - `statNames()` / `clear()` / `dispose()`.
- Optional `onChanged(stat, newValue, prevValue)` callback fires
  only when the derived value actually changes; throwing isolated.
- Defensive: invalid input rejected; NaN / non-string / empty
  source/stat ignored.
- `Modifier`, `ModifierKind`, `StatStackOptions` types exported.
- `RESOURCE_STAT_STACK` constant.

### Tests

1441 -> 1466 (25 new in tests/stat-stack.test.ts):
- RESOURCE_STAT_STACK stable string.
- starts empty; setBase + get; setBase rejects invalid input.
- flat / percentBase / multiplier kinds; full ordering example;
  multiple flats sum, percents sum, multipliers multiply.
- Re-adding same (source, kind) replaces; same source different
  kinds both apply.
- addModifier rejects invalid input.
- removeModifier drops all kinds (no kind) or just one (with kind);
  missing returns false.
- removeBySource drops across stats.
- getModifiers returns fresh copies; missing stat returns [].
- statNames lists all defined.
- onChanged fires with new + prev; not on unchanged; throwing
  isolated.
- clear empties; dispose locks ops.
- Realistic hero buff stack scenario.

### Backwards compatibility

Pure addition.

## 0.58.0 - 2026-05-09

**InventoryGrid - slot-based inventory with stack support.**
Items, consumables, equipment, quest tokens - all share the slot-
grid pattern. InventoryGrid is a fixed-capacity array of slots;
each slot holds either nothing or `{ itemId, count }`. Stackable
items merge when added; non-stackable items consume one slot per
unit.

The inventory does NOT own item *definitions* - those live in a
consumer-side catalog. The inventory only deals with item ids and
stack semantics derived from per-id `maxStack` config.

### Added

- `src/runtime/inventory-grid.ts` - `InventoryGrid` class:
  - `add(itemId, count)` - returns `{ added, overflow }`. Top-up
    existing stacks first, then fills empty slots up to maxStack.
  - `remove(itemId, count)` - removes from highest-index slots
    first; returns actual count removed (may be < count).
  - `takeSlot(index)` - returns + clears the slot.
  - `move(from, to)` - empty target = wholesale transfer; same-
    item = stack merge up to maxStack; different items = swap.
  - `getSlot(index)` returns a defensive copy.
  - `has(itemId)` / `totalOf(itemId)` / `occupiedCount()` /
    `freeSlots()` / `capacity()`.
  - `clear()` / `dispose()`.
  - `toSnapshot()` / `fromSnapshot(snap)` for save data.
- Optional `itemInfo(itemId)` callback returning `{ maxStack? }`;
  default 1 (non-stackable). Throwing isolated -> defaults to 1.
- Optional `onChanged(slotIndex)` notification on slot mutation;
  throwing isolated.
- `InventorySlot`, `ItemInfo`, `InventoryGridOptions`,
  `AddResult` types exported.
- `RESOURCE_INVENTORY_GRID` constant.

### Tests

1411 -> 1441 (30 new in tests/inventory-grid.test.ts):
- RESOURCE_INVENTORY_GRID stable string.
- create rejects non-positive capacity; starts empty.
- add non-stackable; add returns added/overflow.
- add stackable merges + spills + overflows on full inventory.
- 0/negative count + empty itemId rejected.
- getSlot returns copy; out-of-bounds returns null.
- has + totalOf reflect contents.
- remove decrements + clears empty slots; over-remove returns
  actual.
- takeSlot returns + clears; empty/OOB returns null.
- move into empty / same-item merge / different-item swap;
  same-slot no-op; from-empty no-op.
- clear empties; snapshot+fromSnapshot roundtrip; rejects
  malformed; truncates+clears tail.
- onChanged fires; throwing isolated.
- dispose locks ops.
- Throwing itemInfo defaults to non-stackable.

### Backwards compatibility

Pure addition.

## 0.57.0 - 2026-05-09

**TileMap - 2D tile grid backed by Uint16Array.** ZoneCatalog
(Phase 8) defines per-zone tile palettes; the engine had no actual
tile-grid container until now. TileMap is a tiny rectangle of u16
tile ids stored row-major, with bounds-checked accessors, fill /
flood-fill helpers, range queries, and a base64 snapshot path for
save data.

Tile id 0 is conventional for "empty"; consumers assign meaning.
Multiple TileMaps can layer (background / terrain / decoration /
collision); the engine doesn't impose a layer model here.

### Added

- `src/runtime/tile-map.ts` - `TileMap` class:
  - `TileMap.create({ width, height, defaultTile?, data? })`.
  - `width()` / `height()` / `cellCount()` / `inBounds(x, y)`.
  - `get(x, y)` returns 0 for out-of-bounds (silent), tile id
    otherwise.
  - `set(x, y, tile)` is silent no-op on out-of-bounds; tile id
    clamped to `[0, 65535]`.
  - `fill(tile)` / `fillRect(x, y, w, h, tile)` (bounds-clipped).
  - `replaceAll(from, to)` returns count of cells changed.
  - `floodFill(sx, sy, replacement)` - 4-connected flood fill;
    no-op if start tile already equals replacement.
  - `forEach(cb)` - throwing isolated.
  - `findAll(predicate)` - returns matching cells.
  - `toSnapshot()` / `fromSnapshot(snap)` - base64 round-trip
    safe across PersistentStorage; rejects malformed input.
  - `raw()` - direct Uint16Array access for renderer fast paths.
- Float coordinates floor to integer cells.
- `TileMapOptions`, `TileMapSnapshot` types exported.
- `RESOURCE_TILE_MAP` constant.

### Tests

1385 -> 1411 (26 new in tests/tile-map.test.ts):
- RESOURCE_TILE_MAP stable string.
- create + size accessors; rejects non-positive size.
- Defaults to zeros; defaultTile fills initial state; data
  initializes; data length mismatch throws.
- get/set out-of-bounds (return 0 / silent no-op).
- set + get roundtrip; tile id clamps to Uint16.
- Float coordinates floor.
- inBounds reflects valid range.
- fill / fillRect (clipped); replaceAll.
- floodFill 4-connected; same-replacement no-op; out-of-bounds 0.
- forEach visits every cell; throwing isolated.
- findAll returns matching cells.
- snapshot + fromSnapshot roundtrip; rejects malformed input.
- raw() exposes underlying typed array (mutation visible).

### Backwards compatibility

Pure addition.

## 0.56.0 - 2026-05-09

**SceneManager - named scenes with async enter / exit + tick.**
Most games are organized as scenes: title -> game -> pause overlay
-> game-over -> credits. Each wants its own setup (load assets,
register systems, hook input) and teardown (release assets,
restore HUD). SceneManager factors that pattern into a small
registry with a single active scene at a time, async enter/exit
hooks (so loading screens compose), and an update tick.

Distinct from StateMachine (0.51): SceneManager assumes async
enter/exit, tracks load progress via the "transitioning" status,
and exposes hooks for HUD loaders. Use StateMachine for in-game
state (idle/walking/jumping); SceneManager for high-level scene
orchestration.

### Added

- `src/runtime/scene-manager.ts` - `SceneManager` class:
  - `register(name, scene)` / `unregister(name)` / `has(name)` /
    `sceneNames()`.
  - `transitionTo(name, params?)` - async, awaits onExit then
    onEnter; resolves with the scene name; rejects on unknown /
    failed onEnter / concurrent transition.
  - `current()` / `getStatus()` (`'idle' | 'entering' | 'active' |
    'exiting'`) / `isTransitioning()`.
  - `update(dtMs)` - calls active scene's onUpdate; no-op while
    transitioning / idle.
  - `leave()` - drop active scene back to idle.
  - `dispose()` - locks subsequent ops.
- Lifecycle callbacks (all isolated): `onSceneEntered`,
  `onSceneExited`, `onTransitionStart`, `onTransitionError`.
- `params` arg threaded through onEnter for scene-specific data
  (difficulty, save slot, etc.).
- Defensive: failed onEnter rolls back to idle; throwing onExit
  doesn't block the transition; same-scene transition is a no-op
  success; unregistering active scene returns to idle without
  firing onExit (consumer should leave() first if cleanup matters).
- `SceneConfig`, `SceneStatus`, `SceneManagerOptions` types
  exported.
- `RESOURCE_SCENE_MANAGER` constant.

### Tests

1361 -> 1385 (24 new in tests/scene-manager.test.ts):
- RESOURCE_SCENE_MANAGER stable string; starts idle.
- register + has + sceneNames; ignores empty name + falsy config.
- transitionTo activates scene; unknown rejects; same-scene no-op.
- onEnter receives params; async onEnter awaited (status =
  'entering' during).
- onExit fires on transition away.
- onSceneEntered / onSceneExited / onTransitionStart fire in order.
- failed onEnter rejects + fires onTransitionError + rolls to idle.
- Throwing onExit does not block transition.
- Concurrent transition rejects.
- update calls active onUpdate; no-op while not active; NaN /
  negative dt ignored.
- leave returns to idle + fires onExit; idle leave is no-op.
- unregister active scene returns to idle without firing onExit.
- dispose locks ops.
- Realistic title->game->over example.
- Re-registering replaces config; next exit uses new config.

### Backwards compatibility

Pure addition.

## 0.55.0 - 2026-05-09

**Pathfinder - A* on a grid.** Mob nav, NPC walk paths, room-to-
room hub routing, "click to walk" tap-to-walk landing distance, AI
approach behaviour - all share grid-based shortest-path search.
Pathfinder is grid-AGNOSTIC: the consumer supplies an
`isWalkable(x, y)` callback. The pathfinder doesn't know about
TileMap (0.57+) or any specific grid representation.

### Added

- `src/runtime/pathfinder.ts`:
  - `findPath(startX, startY, goalX, goalY, isWalkable, opts?)` -
    returns `{ path, cost, nodesExpanded } | null`. null on
    unreachable goal / blocked start / blocked goal / out-of-
    bounds / maxNodes exceeded.
  - `IsWalkableFn`, `CellCostFn`, `HeuristicFn`, `PathfinderOptions`,
    `PathPoint`, `PathResult` types.
  - Options:
    - `allowDiagonal` — 8-direction movement (default false).
    - `blockCornerCutting` — diagonals through wall corners
      forbidden (default false). Only meaningful with
      allowDiagonal.
    - `cost(x, y)` — per-cell cost (default 1).
    - `heuristic(dx, dy)` — default octile when diagonal,
      manhattan otherwise. Pass `() => 0` for uniform-cost
      Dijkstra.
    - `maxNodes` — node-expansion cap (default 8192).
- Float coordinates floor cleanly to grid cells.
- `nodesExpanded` in the result for diagnostics / debug HUD.
- Deterministic across runs with same inputs.
- `RESOURCE_PATHFINDER` constant.

### Tests

1341 -> 1361 (20 new in tests/pathfinder.test.ts):
- RESOURCE_PATHFINDER stable string.
- start === goal returns single-cell path.
- Blocked goal / blocked start returns null.
- Straight line in open field; 4-direction path length.
- allowDiagonal cuts the path; cost = 3 * sqrt(2) for 3-step
  diagonal.
- Routes around obstacle column; unreachable goal returns null;
  out-of-bounds goal returns null.
- blockCornerCutting prevents diagonal through wall corners;
  default allows.
- Cost callback shapes the path (avoids expensive cells).
- maxNodes cap returns null; nodesExpanded reflects search size.
- Custom heuristic = 0 produces uniform-cost (Dijkstra).
- Complex maze finds valid contiguous 4-directional path.
- Float coordinates floor to cells.
- Deterministic across runs.
- Realistic mob aggro pursuit scenario.

### Backwards compatibility

Pure addition.

## 0.54.0 - 2026-05-09

**AABB - 2D axis-aligned bounding box queries.** SpatialHash
(0.30.0) buckets points; util/math has rect helpers. AABB fills
the gap with min/max-corner shape, containment / intersection /
overlap tests, segment raycast (line-of-sight), range query, and
mutation helpers (expand, translate, fromPoints, union,
intersection).

Distinct from util/math's `Rect` (x/y/width/height) which is
better for camera viewports + culling. AABB is min/max corners
which integrates cleanly with downstream broadphase algorithms
(BVH, sweep-and-prune, pair generation).

### Added

- `src/runtime/aabb.ts`:
  - `AABB` type with `minX / minY / maxX / maxY`.
  - Constructors: `aabb`, `aabbFromRect`, `aabbFromPoints`.
  - Tests: `aabbContainsPoint`, `aabbContainsAabb`, `aabbOverlaps`.
  - Sizes: `aabbWidth`, `aabbHeight`, `aabbArea`, `aabbCenter` (out
    arg supported).
  - Mutation: `aabbExpand`, `aabbTranslate`.
  - Combiners: `aabbUnion`, `aabbIntersection` (returns null on no
    overlap).
  - Range query: `aabbRangeQuery(boxes, query, out?)` returns
    indexes of overlapping boxes; out array reused if provided.
  - Segment raycast: `aabbRaycastSegment(box, p0x, p0y, p1x, p1y)`
    returns t in [0, 1] of first entry, or null if miss. Slab
    method (Cyrus-Beck-style); handles axis-parallel degenerate
    cases.
- `aabb()` is order-tolerant: swaps inputs if the caller passes
  flipped corners.
- Edge-touching counts as overlap (consistent with intuitive
  "did the boxes meet" semantics).
- `RESOURCE_AABB` constant.

### Tests

1312 -> 1341 (29 new in tests/aabb.test.ts):
- RESOURCE_AABB stable string.
- Constructors: corners, flipped corners, fromRect, fromPoints
  (empty / single / multi).
- Containment: point inside / outside / boundary; aabb full /
  partial / disjoint / self.
- Overlaps: clear / edge-touching / disjoint / nested.
- Width / height / area / center (with + without out arg).
- Mutation: expand pos / neg; translate.
- Union / intersection (with overlap; null on miss).
- Range query: returns indexes; reuses out; resets stale data.
- Raycast: outside / crossing / inside-start / vertical /
  horizontal / parallel-outside-slab.
- Realistic mob aggro example.

### Backwards compatibility

Pure addition.

## 0.53.0 - 2026-05-09

**LRUCache - generic least-recently-used cache.** Decoded sprite
atlases, expensive computation memos, last-N tile chunks,
plugin-context lookups - all share the "keep up to N hot entries;
evict the one I haven't touched recently" pattern. The standard
JS Map is FIFO; LRUCache adds the access-order semantics.

### Added

- `src/runtime/lru-cache.ts` - generic `LRUCache<V>` class:
  - `set(k, v)` / `get(k)` / `peek(k)` / `has(k)` / `delete(k)`.
  - `set` returns the evicted entry on capacity overflow.
  - `get` marks the key most-recently-used; `peek` does not.
  - `clear()` empties without firing onEvict.
  - `setCapacity(n)` resizes; shrinking evicts oldest first.
  - `keys()` / `values()` in eviction order (oldest first).
  - `stats()` returns size / capacity / hits / misses / evictions.
  - `dispose()` locks subsequent ops.
- Optional `onEvict(key, value)` callback fires for capacity-driven
  eviction (NOT for explicit `delete` or `clear`). Throwing
  isolated.
- `LRUCacheOptions<V>` type exported.
- `RESOURCE_LRU_CACHE` constant.

### Tests

1286 -> 1312 (26 new in tests/lru-cache.test.ts):
- RESOURCE_LRU_CACHE stable string; default capacity 128.
- set + get; update in place.
- Capacity eviction; get promotes; set returns evicted entry.
- peek does not promote; peek missing returns undefined.
- delete + missing returns false; delete does NOT fire onEvict.
- onEvict fires on capacity eviction; throwing isolated.
- clear empties without firing onEvict.
- setCapacity smaller evicts; larger does not; <= 0 ignored.
- keys / values in eviction order; stats accurate.
- dispose makes ops no-op.
- Works with arbitrary value types.
- Realistic asset-cache cleanup example; deterministic eviction.

### Backwards compatibility

Pure addition.

## 0.52.0 - 2026-05-09

**CooldownManager - per-key cooldown tracking.** Skills, item-uses,
ability triggers, chat throttles, and reconnect attempts share the
same shape: "this thing was used at time T; refuse it again until
T + delay." Each subsystem rolls its own per-key Map. CooldownManager
factors that out into a tick-driven trackable resource.

### Added

- `src/runtime/cooldown-manager.ts` - `CooldownManager` class:
  - `start(key, durationMs)` — begins a cooldown; replaces any
    active cooldown on the same key.
  - `tick(dtMs)` — reduces every active cooldown by dtMs. Keys
    that cross zero are removed and `onReady` fires.
  - `isReady(key)` / `isOnCooldown(key)` / `remaining(key)` /
    `totalFor(key)` / `fractionElapsed(key)`.
  - `clear(key)` — force ready immediately (fires onReady).
  - `clearAll()` — clear every active cooldown.
  - `tryUse(key, durationMs)` — atomic ready-check + start;
    returns true if key was ready and the cooldown began.
  - `activeCount()` / `activeKeys()` introspection.
  - `dispose()` — locks subsequent ops.
- Optional `onReady(key)` callback fires once when each key
  crosses zero (or is cleared); throwing isolated.
- Defensive: empty key ignored; zero / negative duration treated
  as ready; NaN / negative dt ignored; tick(0) is a no-op.
- Replay-deterministic: identical dt sequences produce identical
  readiness sequences (test asserts).
- `CooldownManagerOptions` type exported.
- `RESOURCE_COOLDOWN_MANAGER` constant.

### Tests

1261 -> 1286 (25 new in tests/cooldown-manager.test.ts):
- RESOURCE_COOLDOWN_MANAGER stable string; starts ready; activeCount.
- start places key on cooldown; tick reduces remaining; crossing
  zero -> ready; restart replaces; zero/negative duration treated
  as ready; empty key ignored.
- tick(0) / NaN / negative dt no-ops.
- onReady fires on cross-zero; throwing isolated; once per cycle.
- clear forces ready + fires onReady; clear missing returns false.
- clearAll empties + fires onReady for each.
- activeCount / activeKeys reflect state.
- fractionElapsed: 0 at start, 1 when ready.
- tryUse: ready -> true + start; on cooldown -> false; after ready
  re-fires.
- totalFor reflects total or 0.
- dispose makes ops no-op.
- Realistic example: skill rotation tracking.
- Determinism: same dt sequence -> same readiness sequence.

### Backwards compatibility

Pure addition.

## 0.51.0 - 2026-05-09

**StateMachine - generic finite state machine.** Many engine
subsystems already track states implicitly: zone bridge connection
(idle / connecting / connected / reconnecting), boss lifecycle
(offline / spawning / alive / dying / dead), HUD modes (game /
menu / inventory / dialog), audio scenes. Each rolls its own enum
and transition guard. StateMachine factors that out: register
named states with onEnter / onExit / onUpdate callbacks plus
optional valid-transition map; the FSM enforces invariants.

### Added

- `src/runtime/state-machine.ts` - `StateMachine` class:
  - `StateMachine.create({ initial, states, transitions?,
    fireInitialEnter?, onTransition? })`.
  - `state()` / `is(name)` / `has(name)` / `stateNames()`.
  - `transition(name)` - returns true on success, false if state
    unknown / transition rejected / already there. Fires onExit
    -> onEnter -> onTransition in order.
  - `canTransition(name)` - dry-run check.
  - `forceState(name)` - bypass guards (restore-from-save case);
    no onEnter / onExit fire.
  - `update(dtMs)` - calls current state's onUpdate.
  - `dispose()` - locks subsequent ops.
- `transitions` map is optional + acts as deny list. States
  without an entry are unrestricted; states with `[]` are
  terminal (cannot transition out except via forceState).
- `fireInitialEnter: true` fires onEnter once at create time
  with `from: null`.
- Defensive: NaN / negative dt ignored; throwing onEnter / onExit
  / onUpdate / onTransition isolated; transitions to current
  state are no-ops.
- `StateConfig`, `StateMachineOptions` types exported.
- `RESOURCE_STATE_MACHINE` constant.

### Tests

1238 -> 1261 (23 new in tests/state-machine.test.ts):
- RESOURCE_STATE_MACHINE stable string.
- Requires initial state; initial must exist in states map.
- Starts in initial state; fireInitialEnter fires once with
  from=null; default does not fire.
- Transition fires onExit -> onEnter; unknown state returns false;
  same-state no-op.
- transitions map enforces allowed targets; missing entry
  unrestricted; no map at all unrestricted.
- onTransition fires after success; not on rejected.
- update fires onUpdate with dtMs; safe on state with no
  onUpdate; NaN / negative ignored.
- forceState bypasses transitions + onEnter/onExit; rejects
  unknown.
- Throwing callbacks isolated.
- stateNames lists all; dispose locks ops.
- Realistic example: boss lifecycle.

### Backwards compatibility

Pure addition. Engine consumers opt in.

## 0.50.0 - 2026-05-09

**LogRingBuffer - severity-filtered, fixed-capacity log.** The
engine has DebugHUD (0.24.0) for per-frame diagnostic overlay
text but no place for the historical entries every action game
wants: combat events, state transitions, network warnings,
plugin output, the last N lines of "what happened." Browser
console.log works at first but has no severity filter, no cap,
no programmatic readout for an in-game console.

LogRingBuffer is a tiny fixed-capacity ring with severity levels
(debug / info / warn / error / fatal), per-instance min severity
filter, optional structured payload per entry, monotonic id +
timestamp, and an optional sink callback (mirror to console for
dev / forward to Sentry for prod).

This is the M8 finale and lands the engine at version **0.50.0**
— the original "is this a real number?" question Misha asked at
the start of the session. The answer was yes; here we are.

### Added

- `src/runtime/log-ring-buffer.ts` - `LogRingBuffer` class:
  - Severity helpers: `debug() / info() / warn() / error() / fatal()`
    + generic `log(level, msg, extras?)`.
  - `extras: { channel?, data? }` — optional channel string +
    structured payload Record<string, unknown>.
  - `setMinLevel(level)` / `getMinLevel()` — runtime filter.
  - `count()` / `capacity()` / `droppedSinceStart()`.
  - `tail(n?)` — last n entries newest-first.
  - `all()` — every retained entry newest-first.
  - `filter({ minLevel?, since?, channel? })` — server-side query.
  - `clear()` — empty the ring; droppedSinceStart preserved.
  - `dispose()` — locks subsequent ops.
- Optional `sink` callback fires for every accepted (non-filtered)
  entry; throwing sink isolated.
- Defensive: filtered entries return id=0 (never break sequence),
  non-string messages coerced via `String()`, ring evicts oldest
  on overflow, monotonic ids preserved across eviction.
- Optional `now` clock seam for deterministic replays.
- `LogLevel`, `LogEntry`, `LogRingBufferOptions`, `LogFilter`
  types exported.
- `RESOURCE_LOG_RING_BUFFER` constant.

### Tests

1210 -> 1238 (28 new in tests/log-ring-buffer.test.ts):
- RESOURCE_LOG_RING_BUFFER stable string; starts empty; default
  capacity 1024 + minLevel debug.
- log + count + retrieve newest-first.
- Severity helpers map to correct level.
- Monotonic ids.
- minLevel filters entries below threshold; setMinLevel runtime.
- Ring evicts oldest when full; droppedSinceStart accumulates.
- tail(n) returns last n; tail(0) defaults to all; tail(>size)
  returns all.
- filter by minLevel / since / channel string / channel array.
- Structured payload preserved; sink fires per entry; throwing
  sink isolated; sink receives full entry shape; filtered entries
  do NOT fire sink.
- clear empties; droppedSinceStart preserved across clear.
- dispose makes log a no-op; filtered entry returns id=0.
- Non-string message coerced via String().
- Ring buffer wrap-around order; ids monotonic across eviction.
- filter with no opts uses buffer minLevel.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { LogRingBuffer } from '@sadhaka/loom-engine';

var log = LogRingBuffer.create({
  capacity: 500,
  minLevel: 'info',
  sink: function (e) {
    if (e.level === 'fatal') reportToSentry(e);
  },
});

log.info('zone entered', { channel: 'world', data: { zoneId: 1 } });
log.warn('packet drop', { channel: 'net', data: { seq: 42 } });
log.error('plugin crashed', { channel: 'plugin', data: { name: 'hud-probe' } });

// In-game console:
log.tail(20).forEach(function (e) { console.log(e.timestampMs, e.level, e.message); });

// Filtered query:
log.filter({ minLevel: 'warn', channel: ['net', 'plugin'] });
```

### Milestone — engine 0.50.0

Ten months of additive growth, no breaking changes. Every release
since 0.10.0 has been pure addition; consumer code from 0.10
still compiles against 0.50. The engine surface now spans:

- ECS core + render layers + iso projection
- Canvas2D + WebGL2 backends with sprite batching
- Particle pool + emitter system + render pipeline
- Combat / projectile / mob catalog
- Director protocol v1/v2/v3 (encounter, zone, ability streams)
- SSE multiplayer with peer pool + interpolation
- Audio: bus + spatial bus + cue catalog + music director +
  mixer + attenuation curves
- Input: manager + actions + chord recognizer + virtual dpad +
  tap-to-walk
- Plugin SDK (server + client) with sandboxing
- Determinism: seeded entropy + replay + fuzzer + tripwire
- Storage + snapshots + save slots
- Localization
- Tween + tween chain + cubic-bezier
- Spline path evaluators
- Frame budget scheduler + timer scheduler
- Floating text / damage numbers
- Layer manager
- Memory budget tracker
- Particle / spatial-audio curve utilities
- Log ring buffer

1238 tests across 60+ test files. Pure-additive policy continues
into the 1.0 timeline (when the API stability promise gets formal).

## 0.49.0 - 2026-05-09

**Spline - 2D path evaluators for camera paths and animations.**
The engine has Tween (single scalar) and TweenChain (sequenced
scalars). Splines fill the missing gap: smooth 2D path evaluation
for cinematic camera dollies, NPC walk paths, projectile arcs,
HUD reveals along curves.

Three evaluators, all pure functions taking `Vec2Like` { x, y }
control points and returning a fresh { x, y } for `t in [0, 1]`:

- `linearPath` — straight-line segments through control points.
- `catmullRomPath` — C^1-continuous curve passing through every
  control point. Default centripetal tension (0.5) for
  overshoot-free shapes on arbitrary point distributions.
- `hermitePath` — explicit per-point tangents for precise slope
  control (arc trajectories with target angles).

### Added

- `src/runtime/spline.ts`:
  - `linearPath(points, t)` — linear interpolation across N
    points; t spans the full path; segments share parameter
    range equally.
  - `catmullRomPath(points, t, opts?)` — Catmull-Rom with
    `tension` (default 0.5) + `closed` loop support. <2 points
    falls back to linear; phantom endpoints synthesized for open
    paths.
  - `hermitePath(keys, t)` — Hermite cubic with explicit `{ p, m }`
    keys (position + outgoing tangent vector).
  - All three: t outside [0, 1] clamps to endpoints; empty input
    returns origin; single point returns itself; returns fresh
    object each call (no shared mutation).
- `Vec2Like`, `HermiteKey`, `SplineOptions` types exported.
- `RESOURCE_SPLINE` constant.

### Tests

1185 -> 1210 (25 new in tests/spline.test.ts):
- RESOURCE_SPLINE stable string.
- linearPath: empty / single / 2-point / 3-point segment selection;
  endpoints; midpoint; out-of-range clamps; fresh object.
- catmullRomPath: degenerate cases (empty / single / 2-point);
  endpoints exact; passes through every interior control point;
  shape differs from linear at non-control t; closed loop wraps;
  out-of-range clamps.
- hermitePath: empty / single; endpoints; zero-tangent case
  (reduces to linear midpoint); strong outgoing tangent shapes
  curve; t outside [0, 1] clamps; 3-key segment selection;
  smooth motion (no discontinuous jumps); fresh object each call.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { catmullRomPath, hermitePath } from '@sadhaka/loom-engine';

// Cinematic camera dolly through 5 waypoints:
var waypoints = [
  { x: 0, y: 0 }, { x: 50, y: 30 }, { x: 100, y: 80 },
  { x: 150, y: 30 }, { x: 200, y: 0 },
];
function cameraAt(t) {
  return catmullRomPath(waypoints, t);
}

// Projectile arc with explicit launch + landing tangents:
var arc = [
  { p: { x: 0,   y: 0 }, m: { x: 50,  y: -100 } }, // launch up
  { p: { x: 100, y: 0 }, m: { x: 50,  y:  100 } }, // land down
];
function projectileAt(t) {
  return hermitePath(arc, t);
}
```

## 0.48.0 - 2026-05-09

**TimerScheduler - engine-clock-driven setTimeout / setInterval.**
Browser `setTimeout` / `setInterval` fire on the wall clock - they
don't respect the engine's frame pacing or 0.25.0 EngineClock pause
/ timeScale. Replays don't reproduce them either: a setTimeout at
500ms from a recorded session won't land at the same world-tick on
replay because the browser's scheduler is non-deterministic.

TimerScheduler is a setTimeout / setInterval analog driven by
`tick(dtMs)`. Time advances ONLY when the consumer ticks; every
scheduled callback fires at exactly the dt boundary that crosses
its threshold. Combined with EngineClock as the dt source, this
is replay-deterministic.

### Added

- `src/runtime/timer-scheduler.ts` - `TimerScheduler` class:
  - `setTimeout(fn, delayMs)` — one-shot. Fires once at the first
    tick where elapsed >= delayMs from schedule time.
  - `setInterval(fn, delayMs)` — repeating. Fires every delayMs of
    accumulated tick time. Catches up if a single tick crosses
    multiple thresholds (capped by `maxFiresPerTick`, default 64).
    `delayMs <= 0` is dropped to avoid an infinite loop.
  - `clearTimeout(handle | id)` / `clearInterval(handle | id)`.
  - `cancelAll()` — wipes every active timer.
  - `has(id)` / `pendingCount()` / `stats()` introspection.
  - `tick(dtMs)` — advance scheduled time. NaN / negative dt
    ignored. Newly-scheduled timers from inside a callback do NOT
    fire in the same tick (snapshot semantics).
  - `dispose()` — locks subsequent ops; returns no-op handles for
    new schedule calls.
- Defensive: throwing callback isolated; clearTimeout(null /
  undefined / unknown id) is a safe no-op.
- Replay-deterministic: identical dt sequences produce identical
  fire counts (test asserts).
- `TimerHandle`, `TimerSchedulerOptions` types exported.
- `RESOURCE_TIMER_SCHEDULER` constant.

### Tests

1155 -> 1185 (30 new in tests/timer-scheduler.test.ts):
- RESOURCE_TIMER_SCHEDULER stable string; starts empty.
- setTimeout: fires once after delay; once even on overshoot;
  cancellable via handle / id; clearTimeout on null safe; clear
  after fire safe; delayMs <= 0 fires next tick.
- setInterval: fires every delayMs; steady cadence under variable
  dt; maxFiresPerTick caps burst; maxFires=0 disables cap;
  clearInterval stops fires; delayMs=0 dropped.
- Multiple timers: independent firing.
- cancelAll cancels every active timer.
- Newly-scheduled timer from inside callback doesn't fire same tick.
- Throwing callback isolated.
- NaN / negative dt ignored.
- pendingCount / has / stats accurate.
- dispose makes scheduling no-op.
- Unique ids.
- handle.isActive reflects state.
- Determinism: same dt sequence -> same fire count.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { TimerScheduler } from '@sadhaka/loom-engine';

var timers = TimerScheduler.create();

// One-shot: respawn the boss in 30 seconds of game time.
timers.setTimeout(function () { spawnBoss(); }, 30000);

// Repeating: tick AI every 250ms of game time.
var aiHandle = timers.setInterval(function () { aiSystem.step(); }, 250);

// Per frame, drive from EngineClock-aware dt:
timers.tick(deltaTimeMs);

// Cancel later:
timers.clearInterval(aiHandle);
```

## 0.47.0 - 2026-05-09

**TweenChain - sequential composition of tweens, delays, and callbacks.**
Tween (0.29.0) animates a single scalar from A to B over T seconds.
TweenChain composes a sequence of those steps, plus delays and
instant callbacks, into a single timeline. Strictly sequential -
parallel animations are still done via two Tweens / two chains
running side-by-side, which keeps this primitive small.

Loop support: `start({ loop: true })` repeats forever;
`start({ loop: 3 })` repeats 3 additional times (4 total runs).

### Added

- `src/runtime/tween-chain.ts` - `TweenChain` class:
  - Fluent builder: `.to(from, to, durSec, onUpdate, easing?)`,
    `.delay(durSec)`, `.call(fn)`. Each returns the chain for
    chaining.
  - `start(opts?)` — opts: `onComplete` callback fired exactly
    once when the chain finishes (never on cancel; never on
    `loop: true`); `loop` boolean or positive integer.
  - `update(dtSeconds)` — advances; spans dt across multiple steps
    in a single call so a large dt finishes the chain cleanly.
  - `cancel()` / `isActive()` / `hasCompleted()`.
  - `totalDuration()` — sums tween + delay durations (callback = 0).
  - `stepCount()` — total step count.
  - Defensive: NaN / negative / zero dt ignored; throwing onUpdate
    or call-step callback isolated; re-start() resets cursor and
    `fired` state on call-steps; zero-duration tween snaps to end
    value; zero-duration delay skips instantly.
- `TweenChainStartOptions` type exported.
- `RESOURCE_TWEEN_CHAIN` constant.

### Tests

1130 -> 1155 (25 new in tests/tween-chain.test.ts):
- RESOURCE_TWEEN_CHAIN stable string.
- Update before start is no-op.
- Single tween animates 0 -> end across updates.
- Midpoint linear interpolation.
- Easing applied to sample value.
- Delay holds before next tween.
- Callback step fires once at correct cursor position.
- onComplete fires exactly once at finish.
- Cancel mid-chain stops execution; onComplete does NOT fire.
- Empty chain completes on first update.
- totalDuration sums durations; stepCount accurate.
- Zero-duration tween snaps; zero-duration delay skips.
- loop=true repeats indefinitely (no onComplete).
- loop=N repeats N additional times.
- Cancel + re-start works.
- Throwing onUpdate / callback isolated.
- Single update can span multiple steps.
- Fluent API returns the same instance.
- NaN / negative dt ignored.
- Re-start resets call-step fired state.
- Tween after delay starts at correct from value.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { TweenChain } from '@sadhaka/loom-engine';

var intro = TweenChain.create()
  .to(0, 1, 0.4, function (v) { logo.alpha = v; }, 'easeOutCubic')
  .delay(1.0)
  .call(function () { audio.play('logo-sting'); })
  .to(1, 0, 0.6, function (v) { logo.alpha = v; }, 'easeInQuad');

intro.start({ onComplete: function () { showMainMenu(); } });

// Per frame:
intro.update(deltaTimeSeconds);
```

## 0.46.0 - 2026-05-09

**Localization - string table + locale + parameter interpolation.**
Every game ships strings: HUD labels, dialog lines, error messages,
item names, ability tooltips. The engine ships ZERO of these (it's
a runtime, not a content system) but provides the primitive: lookup
by key in the active locale with parameter interpolation and full
pluralization via Intl.PluralRules.

Single small class. No build step, no JSON loader required. Tables
are plain JS objects consumers can split per-feature, ship from
JSON files, or generate from a CMS. The Loom project's EN/TH/RU
trio fits naturally; the engine itself is locale-agnostic.

### Added

- `src/runtime/localization.ts` - `Localization` class:
  - `register(locale, table)` — merges into existing table; safe
    to call once per file/feature.
  - `set(locale, table)` — replaces wholesale (no merge).
  - `setLocale(locale)` / `getLocale()` / `getDefaultLocale()` /
    `hasLocale(locale)` / `registeredLocales()`.
  - `t(key, params?)` — direct lookup with `{name}` parameter
    interpolation. Falls back active locale → default locale →
    key verbatim. Unmatched placeholders left as `{name}`.
  - `plural(key, count, params?)` — selects from `{ zero, one,
    two, few, many, other }` via `Intl.PluralRules` for the
    active locale (English fallback: count===1 → 'one' else
    'other'). `{count}` is auto-injected as a param. Custom
    `pluralRules` factory supported for testing / unusual locales.
  - `clear()` — wipes tables and resets active locale to default.
  - `dispose()` — locks subsequent ops.
- Plural-shaped value passed to `t()` falls back to `.other`
  (graceful degradation when consumers use a wrapper that doesn't
  know about plurals).
- Defensive: empty locale strings ignored on register / setLocale;
  null/undefined/non-object tables ignored on register; unknown
  keys return key verbatim (never throw / never crash boot).
- `LocalizationValue`, `LocalizationTable`, `LocalizationOptions`,
  `PluralForms` types exported.
- `RESOURCE_LOCALIZATION` constant.

### Tests

1101 -> 1130 (29 new in tests/localization.test.ts):
- RESOURCE_LOCALIZATION stable string; defaults to en locale.
- Direct register + lookup; missing key returns the key.
- Parameter interpolation: {name} substitution; numeric stringify;
  missing param leaves placeholder verbatim; multiple instances
  substitute everywhere.
- Locale switch via setLocale; missing key falls back to default
  locale.
- register merges; set replaces wholesale.
- hasLocale / registeredLocales; register ignores empty locale or
  falsy table; setLocale ignores empty.
- Plural: en one/other via Intl.PluralRules; missing form falls to
  .other; count auto-injected as {count}; explicit count override;
  non-plural value with plural() merges {count}; missing key returns
  key; zero/two/few/many forms via custom rule.
- t() on plural-shaped value falls to .other; locale fallback
  finds plural-shaped key in default.
- clear / dispose / empty key returns ''; defaultLocale option;
  initialLocale override.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { Localization } from '@sadhaka/loom-engine';

var loc = Localization.create({ defaultLocale: 'en' });

loc.register('en', {
  'hud.health': 'HP {value}/{max}',
  'enemy.kills': { one: '{count} enemy slain', other: '{count} enemies slain' },
});
loc.register('th', {
  'hud.health': 'พลัง {value}/{max}',
  'enemy.kills': { other: 'สังหาร {count} ศัตรู' },
});
loc.register('ru', {
  'hud.health': 'ХП {value}/{max}',
  'enemy.kills': {
    one: 'Повержен {count} враг',
    few: 'Повержено {count} врага',
    many: 'Повержено {count} врагов',
    other: 'Повержено {count} врагов',
  },
});

loc.setLocale('ru');
loc.t('hud.health', { value: 87, max: 100 });   // ХП 87/100
loc.plural('enemy.kills', 1);                    // Повержен 1 враг
loc.plural('enemy.kills', 3);                    // Повержено 3 врага
loc.plural('enemy.kills', 17);                   // Повержено 17 врагов
```

## 0.45.0 - 2026-05-09

**SaveSlots - multi-slot save manager on top of PersistentStorage +
WorldSnapshot.** PersistentStorage (0.38.0) provides JSON-safe
key/value; WorldSnapshot (0.26.0) produces a versioned envelope of
every persistable resource. Most games want one more layer: NAMED
slots ('autosave', 'quicksave', 'manual-1' ... 'manual-9') with
metadata (label, timestamp, engine version, optional thumbnail
data URL, optional play time, arbitrary user metadata) alongside
the snapshot itself.

The SaveSlots facade owns no persistence directly - it composes a
PersistentStorage instance and adds the slot semantics. Slots
serialize via the same JSON path PersistentStorage already uses,
so a curious dev can still read the raw key without an opaque
format.

### Added

- `src/runtime/save-slots.ts` - `SaveSlots` class:
  - `save(id, input, nowFn?)` -> SlotMetadata. `input` carries the
    snapshot, optional label, thumbnailDataUrl, playtimeSeconds,
    and arbitrary userMeta record.
  - `load(id)` -> `{ meta, snapshot } | null`. Returns null on
    missing OR malformed envelope (defensive against corrupted
    storage; will not throw on boot).
  - `loadMeta(id)` -> SlotMetadata-only convenience for save UIs.
  - `delete(id)` / `has(id)` / `listIds()`.
  - `listAll(sortBy?: 'recent' | 'name')` -> SlotMetadata[].
    Default 'recent' sorts savedAtMs descending.
  - `rename(id, newId)` / `duplicate(id, newId, nowFn?)` - both
    refuse to overwrite an existing destination; both return
    booleans.
  - `clearAll()` - removes every slot under this prefix; foreign
    keys outside the prefix are untouched.
  - `dispose()` - locks subsequent ops.
- Thumbnail cap (default 256kB) - over-cap thumbnails are silently
  dropped from the metadata (the slot itself still saves).
- Custom `prefix` (default `'slots/'`) lets multiple SaveSlots
  instances share one storage without collision.
- `SlotMetadata`, `SaveSlotsOptions`, `SaveSlotInput`, `LoadedSlot`
  types exported.
- `RESOURCE_SAVE_SLOTS` constant.

### Tests

1074 -> 1101 (27 new in tests/save-slots.test.ts):
- RESOURCE_SAVE_SLOTS stable string.
- save + load roundtrip preserves snapshot + metadata.
- save with empty id / no snapshot throws.
- load missing returns null; corrupted envelope returns null.
- has / delete; delete on missing returns false.
- listIds returns slots only (foreign keys excluded).
- listAll sorts by recency (default) or by name.
- rename moves slot; refuses overwrite; missing source returns
  false; same-id no-op.
- duplicate copies with fresh timestamp; refuses overwrite +
  missing + same-id.
- clearAll removes only slot keys (foreign survives).
- Thumbnail under cap preserved; over cap dropped silently.
- userMeta + playtimeSeconds preserved.
- loadMeta returns metadata-only.
- dispose locks ops.
- Custom prefix isolates two facades on the same storage.
- meta.engineVersion captured from snapshot.
- Rename preserves metadata + snapshot.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import {
  SaveSlots, PersistentStorage, LocalStorageBackend,
  serializeWorldSnapshot,
} from '@sadhaka/loom-engine';

var ps = PersistentStorage.create({
  backend: new LocalStorageBackend({ prefix: 'twt:' }),
});
var slots = SaveSlots.create({ storage: ps });

// Save:
var snap = serializeWorldSnapshot(world.resources, '0.45.0');
await slots.save('quicksave', {
  snapshot: snap,
  label: 'Plaza, Hero lvl 7',
  thumbnailDataUrl: canvas.toDataURL('image/jpeg', 0.6),
  playtimeSeconds: hud.playtime,
  userMeta: { zone: 'plaza', heroClass: 'lash' },
});

// List for save UI:
var all = await slots.listAll('recent');
all.forEach((m) => uiAddSlot(m.id, m.label, m.savedAtMs, m.thumbnailDataUrl));
```

## 0.44.0 - 2026-05-09

**SpatialAudioCurves - distance attenuation curve evaluation.**
SpatialAudioBus (0.15.0) already passes `distanceModel` into Web
Audio's PannerNode, but the engine has no way to EVALUATE these
curves outside the audio thread. Consumers need that for: cheap
mute-when-far cull predicates before allocating a PannerNode, HUD
falloff envelopes, AI proximity reasoning ("would this character
hear that?"), and custom non-Web-Audio attenuation (wall occlusion,
fog density modifiers).

This module ships pure-math implementations of the three Web Audio
distance models plus a registry for named custom curves. The
existing SpatialAudioBus / PositionalPlayOptions are unchanged.

### Added

- `linearAttenuation(d, opts?)` - Web Audio linear model. Drops
  linearly from 1 at refDistance to (1 - rolloffFactor) at
  maxDistance. Distances past max clamp to floor.
- `inverseAttenuation(d, opts?)` - Web Audio inverse model. Classic
  1/r curve at default rolloff=1. Clamped at maxDistance.
- `exponentialAttenuation(d, opts?)` - Web Audio exponential model.
  Power curve `(d/ref)^(-rolloff)`. rolloff=2 squares the falloff.
- `attenuationByModel(name, d, opts?)` - dispatch by model name.
- `AttenuationRegistry` class:
  - Pre-registers `linear` / `inverse` / `exponential`.
  - `register(name, fn)` for custom curves ("fog-occluded",
    "underwater", "indoor-wall").
  - `evaluate(name, d, opts?)` - falls back to inverse if name is
    unknown (matches Web Audio's PannerNode default).
  - Defensive clamps: NaN / Infinity / non-number / throwing
    custom curves all clamp to 0; out-of-range gain clamped to
    [0, 1].
- All evaluators tolerate negative / NaN distance (treated as 0,
  yields gain=1) and infinite distance (yields 0 or floor).
- `AttenuationOptions`, `AttenuationFn`, `DistanceModelName`
  types exported.
- `RESOURCE_ATTENUATION_REGISTRY` constant.

### Tests

1045 -> 1074 (29 new in tests/spatial-audio-curves.test.ts):
- linear: gain=1 inside refDistance; linear midpoint; gain=0 at
  max with default rolloff; clamped past max; partial residual at
  rolloff < 1.
- inverse: gain=1 inside ref; classic 1/r at rolloff=1; gain=1/4 at
  d=4; clamped at maxDistance.
- exponential: gain=1 inside ref; power curve at rolloff=1;
  rolloff=2 squares the falloff; rolloff=0 = no falloff.
- shared: negative distance treats as 0; NaN treats as 0; Infinity
  -> 0 / floor; max <= ref auto-corrects.
- attenuationByModel: dispatch by name.
- registry: pre-registers 3 standard models; register + evaluate;
  unregister; missing returns false; falls back to inverse for
  unknown name; throwing curve clamps to 0; NaN / Infinity from
  curve clamps; out-of-range gain clamped to [0, 1]; empty name
  ignored; register replaces.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import {
  inverseAttenuation, AttenuationRegistry,
} from '@sadhaka/loom-engine';

// Cheap mute-when-far cull before allocating a PannerNode:
function shouldPlay(distance) {
  return inverseAttenuation(distance, {
    refDistance: 1, maxDistance: 50, rolloffFactor: 1,
  }) > 0.05;
}

// Or register a custom "fog-occluded" curve:
var attenuators = new AttenuationRegistry();
attenuators.register('fog', function (d, opts) {
  var clear = inverseAttenuation(d, opts);
  return clear * Math.exp(-d / 30); // additional fog falloff
});
var gain = attenuators.evaluate('fog', heroDist);
```

## 0.43.0 - 2026-05-09

**ParticleCurves - emit-rate / color-over-life / size-over-life
utility curves.** ParticleEmitterPool / ParticleEmitterSystem
emit at a constant rate with constant per-particle color and
size. Modern engines shape these over time: emit rate ramps up at
boss-spawn then decays; particle color tints from white-hot to
ember-orange to smoke-grey; particle size grows fast at birth then
shrinks before death.

Rather than rewrite the emitter / pool layout (a breaking change
to per-particle SoA Float32Arrays), 0.43.0 ships a UTILITY module:
pure-math helpers consumers call from per-frame code. A future
emitter refactor can absorb these curves; today, the engine
surface stays additive.

### Added

Three primitives, all pure functions (tree-shake-friendly, no
class state):

- **Emit-rate curves**:
  - `emitRateAt(opts, t)` — given normalized time t in [0, 1],
    returns particles-per-second.
  - Shapes: `'constant'`, `'linearRamp'`, `'pulse'` (peaks at
    midpoint), `'sustainFade'` (ramp -> hold -> decay).
  - `particlesToEmit(opts, t0, t1, durationSeconds, accumulator)` —
    integrates rate * dt across a frame; accumulator carries
    fractional remainders so emission rates < 1/s emit cleanly
    over multiple frames.

- **Color over life**:
  - `colorAtAge(stops, age)` — linear-segment blend across an array
    of `{ t, color: ColorRGBA }` keyframe stops. Reuses 0.05
    `colorLerp`.
  - Out-of-range `age` clamps to first / last stop. Returns a fresh
    `ColorRGBA` each call; consumers can mutate without aliasing.

- **Size over life**:
  - `sizeAtAge(opts, t)` — multiplier on a particle's base size.
  - Shapes: `'constant'`, `'easeIn'`, `'easeOut'`, `'step'` (binary
    threshold), `'growThenShrink'` (peaks at `peakAt`, defaults
    0.5).

All shapes accept an optional `easing` (any 0.29.0 `EasingName` or
custom `EasingFn`) and reuse the 0.40.0 back / elastic / bounce
curves transparently.

- `EmitRateOptions`, `EmitRateShape`, `ColorStop`,
  `SizeOverLifeOptions`, `SizeShape` types exported.
- `RESOURCE_PARTICLE_CURVES` constant.

### Tests

1018 -> 1045 (27 new in tests/particle-curves.test.ts):
- RESOURCE_PARTICLE_CURVES stable string.
- emitRate: constant / linearRamp / pulse / sustainFade endpoints
  and midpoints; t outside [0, 1] clamps; peakRate < 0 clamps.
- particlesToEmit: integrates rate * dt across a frame; accumulator
  carries fractional particles; zero duration / zero dt returns 0.
- colorAtAge: empty stops returns white; single stop ignores age;
  two-stop midpoint blend; three-stop segment selection; below /
  above range clamps; returns fresh objects.
- sizeAtAge: constant / easeOut / easeIn endpoints; step threshold;
  growThenShrink peaks at peakAt (default 0.5); t outside [0, 1]
  clamps; default scales = 1; custom easing function.

### Backwards compatibility

Pure addition. No emitter / pool changes. Consumers wire from
their per-frame emitter code:

```ts
import {
  emitRateAt, particlesToEmit, colorAtAge, sizeAtAge,
  rgba,
} from '@sadhaka/loom-engine';

var emitOpts = {
  shape: 'sustainFade' as const,
  peakRate: 80, startRate: 0, sustainFraction: 0.4,
};
var fireballColors = [
  { t: 0,   color: rgba(1.0, 1.0, 1.0, 1) }, // white-hot birth
  { t: 0.3, color: rgba(1.0, 0.5, 0.0, 1) }, // orange flame
  { t: 0.7, color: rgba(0.5, 0.0, 0.0, 0.7) }, // dim red
  { t: 1,   color: rgba(0.2, 0.2, 0.2, 0) }, // smoke fade
];
var sizeOpts = {
  shape: 'growThenShrink' as const,
  startScale: 0.2, endScale: 1.5, peakAt: 0.3,
};

// Per frame for the emitter:
var spawnAcc = { value: 0 };
var n = particlesToEmit(emitOpts, t0, t1, lifetimeSec, spawnAcc);
for (var i = 0; i < n; i++) emitNewParticle(...);

// Per particle update:
particle.color = colorAtAge(fireballColors, particle.age);
particle.scale = particle.baseSize * sizeAtAge(sizeOpts, particle.age);
```

## 0.42.0 - 2026-05-09

**MemoryBudget - per-pool / per-resource memory size estimator.**
Component pools (TransformPool, SpritePool, ParticlePool, etc.)
own Float32Arrays that take real memory; ObjectPool (0.32.0) owns
plain objects. As scenes grow, knowing roughly where the memory
lives is useful for: a debug HUD line, a "are we leaking?" check,
mobile-budget warnings, comparing two builds.

MemoryBudget is a thin registry: register named sources that
implement `IMemorySource.estimateBytes()`, ask for `report()`, and
get back per-source bytes + total. The engine ships estimator
helpers for the common shapes (TypedArray, Map, Set, plain array,
plain object) so consumers don't write the same byte-counting
boilerplate.

The estimates are deliberately heuristic - JavaScript engines do
not expose object size; what we report is typed-array `byteLength`
plus rough constants for managed objects. Order-of-magnitude
correct, not MB-precision.

### Added

- `src/runtime/memory-budget.ts` - `MemoryBudget` class:
  - `register(name, source)` / `unregister(name)` / `has(name)`.
  - `getBytes(name)` / `totalBytes()` / `report()` /
    `sources_()` (the trailing underscore avoids the v8 hidden-
    class clash with `Object.prototype.sources` on some legacy
    setups).
  - `clear()` / `dispose()`.
  - Optional `onReport(rep)` callback fires synchronously after
    every `report()`. Throwing callbacks isolated.
- Estimator helpers (tree-shake-friendly free functions):
  - `estimateTypedArrayBytes(...arrs)` — exact via byteLength.
  - `estimateMapBytes(map, perEntryBytes=96)`.
  - `estimateSetBytes(set, perEntryBytes=64)`.
  - `estimateArrayBytes(arr, perElementBytes)`.
  - `estimateObjectBytes(obj, perPropertyBytes=32)`.
- Defensive: estimators returning NaN / negative / Infinity / non-
  number / throwing all clamp to 0 in the report. A misbehaving
  estimator can not poison the report.
- `IMemorySource`, `MemoryReport`, `MemoryBudgetOptions` types
  exported.
- `RESOURCE_MEMORY_BUDGET` constant.

### Tests

990 -> 1018 (28 new in tests/memory-budget.test.ts; engine crosses
the 1000-test mark):
- RESOURCE_MEMORY_BUDGET stable string.
- Estimator helpers: typed-array byteLength sum across multiple
  arrays + no-arg edge case; map default 96/entry + custom +
  null/undefined; set default 64/entry; array with custom per-
  element + null/undefined; object property count default + custom.
- Budget: starts empty; register adds source; register replaces
  in place + preserves insertion order; unregister drops; missing
  unregister returns false; getBytes missing returns 0.
- Report sums every source in registration order; onReport callback
  fires synchronously; throwing onReport callback isolated.
- Throwing estimator clamps to 0 in the report.
- NaN / negative / Infinity / non-number all clamp to 0.
- clear empties; dispose locks subsequent ops.
- Report is a fresh object each call.
- Live source: bytes update as the underlying data changes.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import {
  MemoryBudget, estimateTypedArrayBytes, estimateMapBytes,
} from '@sadhaka/loom-engine';

var mb = MemoryBudget.create({
  onReport: function (r) { hud.setMemoryLine(r.totalBytes); },
});

mb.register('transforms', {
  estimateBytes: function () {
    return estimateTypedArrayBytes(transformPool.x, transformPool.y);
  },
});
mb.register('mobs', {
  estimateBytes: function () { return estimateMapBytes(mobsById); },
});

// Each frame (or every N frames):
var rep = mb.report();
console.log('mem total:', rep.totalBytes, 'bytes', rep.bySource);
```

## 0.41.0 - 2026-05-09

**LayerManager - entity layer + intra-layer z-order management.**
0.23.0 RenderBatch ships coarse layer constants (BACKGROUND /
TERRAIN / ENTITIES / FX / HUD) and flushes one layer at a time.
LayerManager fills the gap *within* a layer: which entities render
in front of which. For an ARPG hub with mob / player / projectile
sprites all on `RENDER_LAYER_ENTITIES`, the renderer needs a
stable, intentional sort key.

The manager is a tiny registry: each entity has `(layer, z)` and
forEach yields entries in `(layer asc, z asc)` order with stable
tie-break by entityId. Insert / move / remove are O(1) on the map;
the sort cache rebuilds only on dirty cycles, so consecutive
forEach calls without mutation are O(n).

### Added

- `src/runtime/layer-manager.ts` - `LayerManager` class:
  - `add(entityId, layer, z?)` / `remove(entityId)` /
    `setZ(entityId, z)` / `setLayer(entityId, layer)`.
  - `has(entityId)` / `getLayer(entityId)` / `getZ(entityId)` /
    `count()` / `countOnLayer(layer)`.
  - `forEach(cb)` — yields entries in (layer asc, z asc, entityId
    asc) order. Throwing callbacks isolated per entry.
  - `forEachOnLayer(layer, cb)` — yields only entries on the named
    layer in z-asc order; relies on monotonic sort to skip past
    other layers in O(n).
  - `toArray()` — defensive snapshot for diagnostics; mutating the
    returned array does NOT affect the manager.
  - `clear()` / `dispose()`.
- `LayerEntry`, `LayerManagerOptions` types exported.
- `RESOURCE_LAYER_MANAGER` constant.

### Tests

965 -> 990 (25 new in tests/layer-manager.test.ts):
- RESOURCE_LAYER_MANAGER stable string.
- Starts empty.
- add tracks layer + z; default z=0; re-add updates idempotently.
- remove drops entity; remove on missing returns false.
- getLayer / getZ return null for unknown entity.
- setZ updates z; setLayer updates layer; both no-op on unknown.
- forEach yields (layer asc, z asc) order; ties break by entityId.
- forEachOnLayer filters by layer; empty layer is a no-op.
- countOnLayer reflects per-layer count.
- Changing z reorders within layer; changing layer moves between.
- forEach uses cached sort on repeated calls.
- clear empties; dispose makes mutations no-ops.
- forEach swallows callback errors per entry.
- toArray is a defensive snapshot.
- Negative z values sort below positive.
- Removing an entity invalidates the sort cache.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import {
  LayerManager, RENDER_LAYER_ENTITIES, RENDER_LAYER_HUD,
} from '@sadhaka/loom-engine';

var lm = LayerManager.create();
lm.add(playerEntityId, RENDER_LAYER_ENTITIES, 5);
lm.add(mobEntityId,    RENDER_LAYER_ENTITIES, 0);
lm.add(damageNumberId, RENDER_LAYER_HUD,      100);

// Per frame in your renderer:
lm.forEach(function (entry) {
  drawEntity(entry.entityId, entry.layer);
});

// Or filter to a single layer:
lm.forEachOnLayer(RENDER_LAYER_ENTITIES, function (entry) {
  drawEntitySprite(entry.entityId);
});
```

## 0.40.0 - 2026-05-09

**Easings - cubicBezier factory + back / elastic / bounce curves.**
Extends 0.29.0 Tween's `Easings` table with the curves every
animation library ships and adds a `cubicBezier(x1, y1, x2, y2)`
factory for CSS-style custom curves. The Newton-Raphson solver
inside cubicBezier converges to ~1e-6 accuracy in <8 iterations
for typical control points; bisection fallback guarantees
convergence on poorly-conditioned curves.

### Added

- `Easings.easeIn/Out/InOutBack` - overshoot curves (Robert Penner).
  `easeOutBack` rises past 1 then settles; `easeInBack` dips below 0
  before rising. Useful for menu pop-in / spring damp.
- `Easings.easeIn/Out/InOutElastic` - oscillating curves around the
  endpoint. Useful for "boing" effects on UI.
- `Easings.easeIn/Out/InOutBounce` - non-monotonic bouncing decay
  inside [0, 1]. Useful for drop-and-settle motion.
- `cubicBezier(x1, y1, x2, y2)` - returns an `EasingFn` matching the
  CSS `cubic-bezier()` semantics. y1 / y2 may exceed [0, 1] for
  overshoot. x1 / x2 are clamped to [0, 1] (curve undefined as a
  function-of-x outside that range).

### Tests

944 -> 965 (21 new in tests/bezier-easing.test.ts; the existing
`tween: Easings table has N named functions` assertion bumped from
13 -> 22):
- cubicBezier endpoints land at 0 and 1.
- Linear control points approximate y=x identity.
- ease-out front-loads progress; ease-in back-loads.
- Monotonic curves stay monotonic across samples.
- x outside [0, 1] is clamped; y can overshoot for spring effects.
- Integrates with Tween via custom EasingFn; output samples land
  exactly at end value.
- t outside [0, 1] clamps to 0 / 1.
- easeBack: easeOutBack overshoots past 1; easeInBack dips below 0;
  endpoints land at 0 / 1.
- easeElastic: endpoints clamp; easeOutElastic oscillates around end.
- easeBounce: hits exactly 1 at t=1; stays in [0, 1] (no overshoot);
  non-monotonic bouncing pattern; easeInBounce mirrors easeOutBounce;
  easeInOutBounce midpoint near 0.5.
- Tween resolves new easing names by string.
- Every new easing is callable and produces finite values across
  the [0, 1] sample range.

### Backwards compatibility

Pure addition. Existing easings unchanged. Engine consumers opt in:

```ts
import { Tween, cubicBezier, Easings } from '@sadhaka/loom-engine';

var tw = new Tween();

// Use a named back curve.
tw.to(0, 100, 0.5, function (v) { hud.scale = v / 100; }, {
  easing: 'easeOutBack',
});

// Build a custom CSS-style ease.
var quickStart = cubicBezier(0, 0.6, 0.4, 1);
tw.to(0, 1, 0.3, function (v) { menu.alpha = v; }, {
  easing: quickStart,
});

// CSS preset shorthand:
//   ease         = cubicBezier(0.25, 0.1, 0.25, 1.0)
//   easeIn       = cubicBezier(0.42, 0,    1.0,  1.0)
//   easeOut      = cubicBezier(0,    0,    0.58, 1.0)
//   easeInOut    = cubicBezier(0.42, 0,    0.58, 1.0)
```

## 0.39.0 - 2026-05-08

**InputChord - combo / sequence / doubleTap / hold pattern recognizer
on top of InputActions.** InputActions (0.31.0) covers the
"single-key triggers an action" case; InputChord adds the four
patterns InputActions can't express:

- **`combo`** — all keys held simultaneously (Ctrl+S, Shift+W).
  Order-agnostic. Re-arms after any key in the set comes up.
- **`sequence`** — keys pressed in order, each within `windowMs` of
  the prior. Fighting-game / cheat-code style.
- **`doubleTap`** — same key pressed twice within `windowMs`.
  Common dash trigger.
- **`hold`** — single key held continuously for `holdMs`. Charge
  attacks, contextual prompts, long-press menus.

Same driving model as InputActions: wire `handleKeyDown` /
`handleKeyUp` to whatever event source you have, call `tick(dtMs)`
once per frame, read `wasFired(name)` or subscribe via
`onFired(name, cb)`.

### Added

- `src/input/input-chord.ts` - `InputChord` class:
  - `define(name, def)` / `undefine(name)` / `has(name)` /
    `chordNames()` / `clear()`.
  - `handleKeyDown(key)` / `handleKeyUp(key)` / `releaseAll()`
    (wipes in-flight state on window blur).
  - `tick(dtMs)` advances hold clocks (firing on threshold) and
    ages sequence/doubleTap windows (resetting on timeout). Also
    clears `firedThisFrame` so `wasFired` is single-frame.
  - `wasFired(name)` polling + `onFired(name, cb)` callback API.
    Throwing callbacks isolated.
  - `stats()` introspection (chord count + watched key count).
  - Reverse-index from key -> chord names so handleKeyDown /
    handleKeyUp dispatch is O(chords-watching-this-key) not
    O(all-chords).
- `ChordDef`, `ChordKind` types exported.
- `RESOURCE_INPUT_CHORD` constant.

### Tests

914 -> 944 (30 new in tests/input-chord.test.ts):
- RESOURCE_INPUT_CHORD stable string.
- define + has + chordNames; undefine drops chord + reverse index;
  undefine missing returns false.
- combo: fires when all held; order-agnostic; once per
  satisfaction with re-arm on key-up; does not fire if a key comes
  up before completion; single-key combo fires on key-down.
- sequence: fires on in-order completion; wrong key resets;
  windowMs timeout resets; stays alive across multiple ticks;
  first-key recovery (wrong key that's the start key restarts).
- doubleTap: fires on second tap within window; window timeout
  blocks; ignores unrelated keys in between.
- hold: fires after threshold; cancels on early release; once per
  press cycle with re-arm on key-up.
- onFired: callback fires on match; unsubscribe works; throwing
  callback does not break dispatch.
- releaseAll wipes in-flight recognition state.
- tick clears firedThisFrame (single-frame); tick(0) clears flag
  without advancing clocks.
- redefining a chord resets state and drops callbacks.
- clear drops everything; stats reflects counts.
- Ignores key events for unwatched keys.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { InputChord } from '@sadhaka/loom-engine';

var ch = new InputChord();

// Save: Ctrl+S anywhere.
ch.define('save', { kind: 'combo', keys: ['Control', 'KeyS'] });

// Dash: double-tap a movement key.
ch.define('dash-left', { kind: 'doubleTap', keys: 'KeyA', windowMs: 250 });

// Charge attack: hold E for 600ms.
ch.define('charge', { kind: 'hold', keys: 'KeyE', holdMs: 600 });

// Hadoken: down, down-forward, forward, punch.
ch.define('hadoken', {
  kind: 'sequence',
  keys: ['ArrowDown', 'ArrowRight', 'KeyP'],
  windowMs: 400,
});

// Wire to your event source:
window.addEventListener('keydown', (e) => ch.handleKeyDown(e.code));
window.addEventListener('keyup', (e) => ch.handleKeyUp(e.code));
window.addEventListener('blur', () => ch.releaseAll());

// Each frame:
ch.tick(deltaTimeMs);
if (ch.wasFired('hadoken')) playHadoken();
```

## 0.38.0 - 2026-05-08

**PersistentStorage - browser/SSR-safe key/value adapter for engine state.**
0.26.0 WorldSnapshot produces an `IPersistableResource` envelope;
PersistentStorage gives consumers a place to put it. Three pieces:
a minimal async `IStorageBackend` contract, two concrete backends
(`MemoryStorageBackend` for tests / SSR / fallback and
`LocalStorageBackend` for browser `window.localStorage`), and the
`PersistentStorage` facade that adds JSON encoding, namespacing, and
typed `WorldSnapshot` helpers on top.

Async-only API so the same code runs against synchronous
localStorage today and asynchronous IndexedDB / network backends
tomorrow without consumers branching.

### Added

- `src/runtime/persistent-storage.ts`:
  - `IStorageBackend` interface: `get / set / remove / keys / clear`,
    all returning Promises.
  - `MemoryStorageBackend` - Map-backed, useful for tests + SSR.
  - `LocalStorageBackend` - wraps `window.localStorage` with optional
    per-instance `prefix` for safe sharing. Falls back to in-memory
    if no Storage is available (Node SSR boot path). `isLive()`
    surfaces which mode it's in.
  - `PersistentStorage` facade:
    - `save(key, data)` / `load(key)` - JSON-encoded read/write.
      Corrupted JSON returns null instead of throwing.
    - `hasKey(key)` / `remove(key)` / `listKeys()` / `clearAll()`.
    - `saveSnapshot(key, snap)` / `loadSnapshot(key)` - typed
      WorldSnapshot helpers; loadSnapshot validates the envelope
      shape and returns null on mismatch (defensive against
      corrupted localStorage).
    - `dispose()` - locks subsequent ops; the underlying backend is
      NOT disposed (consumer owns its lifetime).
  - Optional `namespace` on the facade, separate from the backend's
    `prefix`, so multiple subsystems can share one localStorage.
- `RESOURCE_PERSISTENT_STORAGE` constant.

### Tests

884 -> 914 (30 new in tests/persistent-storage.test.ts):
- RESOURCE_PERSISTENT_STORAGE stable string.
- MemoryStorageBackend: starts empty; set+get; overwrite; remove;
  keys; clear.
- LocalStorageBackend: provided Storage; prefix scoping; keys
  prefix-stripped; clear with prefix only clears scoped keys; falls
  back to in-memory; missing key returns null; remove on missing is
  no-op.
- PersistentStorage facade: save+load roundtrip; missing key null;
  corrupted JSON null; hasKey; remove; namespace isolation;
  listKeys namespace-stripped; clearAll within namespace; dispose
  no-op; circular reference rejects.
- WorldSnapshot helpers: roundtrip envelope; missing snapshot null;
  non-snapshot payload null; wrong field types null; works against
  LocalStorageBackend with prefix + namespace.
- IStorageBackend can be implemented externally (custom Counter
  backend example).

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import {
  PersistentStorage, LocalStorageBackend,
  serializeWorldSnapshot, deserializeWorldSnapshot,
} from '@sadhaka/loom-engine';

var ps = PersistentStorage.create({
  backend: new LocalStorageBackend({ prefix: 'twt:' }),
  namespace: 'snap:',
});

// Save on quit:
var snap = serializeWorldSnapshot(world.resources, '0.38.0');
await ps.saveSnapshot('autosave', snap);

// Load on boot:
var prior = await ps.loadSnapshot('autosave');
if (prior) deserializeWorldSnapshot(world.resources, prior);
```

## 0.37.0 - 2026-05-08

**FloatingText - HUD primitive for damage numbers / floating labels.**
A renderer-agnostic state container for the short-lived numeric /
text overlays every action game ships: damage numbers on hit, "+10
XP" reward popups, miss indicators, status confirmations. Pool-
backed (no per-spawn GC), kinematic integration with optional
gravity / drift, and an alpha curve that fades over the last
portion of lifetime. Engine ships ZERO render path - consumers wire
`forEach()` to whatever they have (Canvas2D fillText, WebGL2
SpriteBatcher with a font atlas, DOM-overlay element pool, etc.).

### Added

- `src/runtime/floating-text.ts` - `FloatingText` class:
  - `emit(spawn)` -> slot index >= 0, or -1 if pool full / disposed.
    Spawn shape carries position, text, optional vx/vy/ax/ay,
    lifetimeMs, color (0xRRGGBB), and scale. Missing fields fall
    back to system options, then library defaults.
  - `tick(dtMs)` - semi-implicit Euler integration of velocity +
    acceleration; auto-deactivates entries past their lifetimeMs.
    `tick(0)` is a no-op.
  - `forEach(cb)` - iterate active entries with their current
    render state (text, x, y, alpha, color, scale, ageMs,
    lifetimeMs). Throwing callbacks are isolated per-entry.
  - `clearAll()` - deactivate all entries immediately.
  - `activeCount()` / `capacity()` - introspection.
  - `dispose()` - locks subsequent ops.
- Alpha curve: linear fade-in over `fadeFractionStart` of lifetime,
  hold at 1 in the middle, linear fade-out over the final
  `fadeFractionEnd`. Defaults: 0% fade-in, 30% fade-out.
- Round-robin slot search keeps allocation O(capacity) without
  preferring head-of-array entries.
- `FloatingTextSpawn`, `FloatingTextRenderState`, `FloatingTextOptions`
  types exported.
- `RESOURCE_FLOATING_TEXT` constant.

### Tests

861 -> 884 (23 new in tests/floating-text.test.ts):
- RESOURCE_FLOATING_TEXT stable string.
- Default capacity 64.
- emit returns slot index >= 0 when pool has space.
- emit returns -1 when pool full.
- emit defaults pull from system options.
- emit explicit options override system defaults.
- tick integrates position from velocity over time.
- tick integrates velocity from acceleration (semi-implicit Euler).
- tick deactivates entries past lifetimeMs.
- alpha is 1 in the middle of lifetime.
- alpha fades linearly over the last fadeFractionEnd.
- alpha fade-in ramps up at start when fadeFractionStart > 0.
- forEach iterates only active entries.
- Deactivated slot is reusable on next emit.
- clearAll deactivates all texts immediately.
- dispose makes ops no-op.
- tick(0) is a no-op.
- forEach swallows callback errors per entry.
- ageMs and lifetimeMs surface to render state.
- emit text content preserved verbatim.
- Round-robin slot search reuses freed slots.
- lifetimeMs <= 0 falls back to default.
- Alpha never escapes [0, 1].

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { FloatingText } from '@sadhaka/loom-engine';

var fx = FloatingText.create({ capacity: 128 });

// On hit:
fx.emit({
  x: enemy.x, y: enemy.y - 20,
  text: '42',
  color: isCrit ? 0xffd700 : 0xffffff,
  scale: isCrit ? 1.5 : 1,
  vy: -80, ay: 100, lifetimeMs: 700,
});

// Each frame:
fx.tick(deltaTimeMs);

// Render (Canvas2D example):
fx.forEach(function (s) {
  ctx.globalAlpha = s.alpha;
  ctx.fillStyle = '#' + s.color.toString(16).padStart(6, '0');
  ctx.font = (14 * s.scale).toFixed(0) + 'px sans-serif';
  ctx.fillText(s.text, s.x, s.y);
});
ctx.globalAlpha = 1;
```

## 0.36.0 - 2026-05-08

**FrameBudgetScheduler - soft-deadline task queue for off-frame work.**
The engine routinely needs to run heavy work that does not fit in a
single 16ms frame: precomputing occlusion grids, baking nav-mesh
tiles, processing a long event queue, hydrating snapshot data,
JIT-loading sprite atlases. Doing it all on the main thread freezes
the frame and surfaces as a hitch in the browser.

FrameBudgetScheduler accepts step functions and runs as many as fit
in `budgetMs` per `tick()`. Each step returns true when done (drops
out of the queue), or false to keep itself queued for the next tick.
The currently-executing step is NEVER preempted - the scheduler
only stops queueing more after the budget is exhausted.

### Added

- `src/runtime/frame-budget-scheduler.ts` - `FrameBudgetScheduler` class:
  - `schedule(task)` -> taskId. Optional `id`, `priority`, `step`,
    `onComplete`, `onCancel`. Synthetic id `task#NNN` if none given.
  - `cancel(id)` -> boolean. Fires `onCancel` if the task existed.
  - `tick()` -> `FrameBudgetStats`. Drains tasks in priority desc /
    insert order (FIFO at ties) until `budgetMs` is reached.
  - `flush()` -> `FrameBudgetStats`. Drain everything ignoring budget
    (useful at shutdown / loading screens).
  - `setBudgetMs(ms)` / `getBudgetMs()` - runtime budget tuning.
  - `has(id)` / `pendingCount()` - introspection for debug HUD.
  - `dispose()` - cancels remaining tasks (firing `onCancel` for each)
    and makes subsequent operations no-ops.
- Throwing step is treated as "done" - the task is dropped without
  firing onComplete or onCancel, so a misbehaving step cannot stick
  in the queue forever.
- Custom `now: () => number` for deterministic replays (defaults to
  `performance.now()` with `Date.now()` fallback).
- `FrameBudgetTaskDef`, `FrameBudgetStats`, `FrameBudgetSchedulerOptions`
  types exported.
- `RESOURCE_FRAME_BUDGET_SCHEDULER` constant.

### Tests

837 -> 861 (24 new in tests/frame-budget-scheduler.test.ts):
- RESOURCE_FRAME_BUDGET_SCHEDULER stable string.
- Default budget 8ms.
- Empty queue tick returns zeroed stats.
- schedule + tick runs the step.
- Step returning false stays for next tick.
- Budget exceeded stops queueing more steps + overBudget flag.
- cancel removes pending task + fires onCancel.
- cancel unknown id returns false.
- onComplete fires once when step returns true.
- Priority - higher runs first.
- Same priority - FIFO ordering.
- schedule without id assigns synthetic monotonic id.
- Re-scheduling an existing id replaces the task.
- setBudgetMs updates the budget for the next tick.
- setBudgetMs ignores non-positive values.
- Stats.spentMs reflects wall time inside step calls.
- Throwing step drops the task without onComplete / onCancel.
- flush drains everything ignoring budget.
- dispose cancels remaining tasks and stops further work.
- Progressive task across multiple ticks completes.
- Stats.pendingCount reflects queue after the tick.
- Cancel during next-tick continuation removes step from queue.
- Completed task is not in byId map post-tick.
- pendingCount reflects count regardless of priority.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { FrameBudgetScheduler } from '@sadhaka/loom-engine';

var sched = FrameBudgetScheduler.create({ budgetMs: 4 });

// Bake a 32x32 nav-mesh chunk over many frames - one row per step.
var row = 0;
sched.schedule({
  id: 'navmesh-bake',
  priority: 5,
  step: function () {
    bakeRow(row);
    row++;
    return row >= 32;
  },
  onComplete: function () { console.log('nav-mesh ready'); },
});

// Each frame:
var stats = sched.tick();
if (stats.overBudget) {
  // Diagnostics: queue is backed up.
}
```

## 0.35.0 - 2026-05-08

**AudioMixer - engine-side fade / crossfade / snapshot / duck on top
of AudioBus.** AudioBus (Phase 5) already exposes master gain +
per-bus gain + mute + VE-budget priority floors, and MusicDirector
(Phase 17) does fade/crossfade for the music channel only. AudioMixer
fills the rest of the gap: animate any bus or master to a target
gain over time, snapshot/restore mix presets, and stack named ducks
with attack/release envelopes. Driven by `tick(dt)` (engine-side
animation, not Web Audio AudioParam ramps) so behavior is
deterministic against EngineClock and tests run against the same
FakeAudioContext mocks the rest of the audio module uses.

### Added

- `src/audio/audio-mixer.ts` - `AudioMixer` class:
  - `fadeBus(name, target, opts)` / `fadeMaster(target, opts)` -
    animate to a target gain over `durationMs` with optional easing
    (any 0.29.0 `EasingName` or custom `EasingFn`). `durationMs <= 0`
    applies immediately; `onComplete` fires once when the fade lands.
  - `crossfade(fromBus, toBus, toTarget, opts)` - simultaneous fades
    on the two buses; `onComplete` fires once at the end.
  - `snapshot(key)` / `restore(key, opts?)` / `hasSnapshot(key)` /
    `clearSnapshot(key)` - capture the current target gains under a
    name and replay them later (instant or faded).
  - `pushDuck(key, busName, opts)` / `releaseDuck(key)` /
    `hasDuck(key)` - apply a named multiplier (`scalar`, `attackMs`,
    `releaseMs`) to a target bus. Multiple ducks stack with
    lowest-scalar-wins. Useful for "duck music while voice plays"
    without coupling the systems.
  - `tick(dtMs)` - advances all in-flight fades + ducks, computes
    `target * lowestDuckMultiplier`, and pushes the result via
    `AudioBus.setBusGain` / `AudioBus.setMasterGain`. `tick(0)` is a
    no-op.
  - `isFading(name)` / `isMasterFading()` / `getBusTarget(name)` /
    `getMasterTarget()` - introspection for tests + debug HUD.
  - `dispose()` - clears all in-flight state. The underlying
    AudioBus is NOT disposed (mixer does not own it).
- `AudioBus.listBuses()` - tiny additive helper so the mixer can
  enumerate registered buses for snapshots without external tracking.
- `RESOURCE_AUDIO_MIXER` constant.

### Tests

804 -> 837 (33 new in tests/audio-mixer.test.ts):
- RESOURCE_AUDIO_MIXER stable string.
- Create seeds master + bus targets from live AudioBus state.
- fadeBus duration 0 applies immediately + fires onComplete.
- fadeBus animates linearly across ticks.
- fadeBus onComplete fires exactly once.
- Replacing in-flight fade re-targets from the current value.
- fadeBus on unknown bus is a no-op.
- fadeBus respects easeInOutQuad curve at quarter / half points.
- fadeBus accepts a custom easing function (sqrt example).
- fadeMaster animates / instant variant / onComplete behaviour.
- crossfade animates two buses simultaneously, single onComplete.
- snapshot + restore (instant) returns target gains.
- snapshot + restore (faded) animates back to snapshot targets.
- restore with unknown key is a no-op.
- clearSnapshot removes the entry.
- pushDuck attackMs=0 jumps multiplier immediately.
- pushDuck attack ramp 1 -> scalar over attackMs.
- releaseDuck releaseMs=0 removes the duck immediately.
- releaseDuck ramps multiplier scalar -> 1 then removes.
- Multiple ducks on same bus -> lowest scalar wins.
- Duck multiplies on top of a fading bus target.
- pushDuck on unknown bus is a no-op.
- Re-pushing an active duck replaces parameters.
- tick(0) is a no-op.
- dispose makes subsequent operations no-op.
- getBusTarget reflects animated value mid-fade.
- Easings module sanity check.
- fadeBus negative target clamps to 0.
- Snapshot captures a target that mutates after capture.
- Release after attack still ramps multiplier back to 1.
- AudioBus.listBuses returns the default 4 names.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { AudioBus, AudioMixer } from '@sadhaka/loom-engine';

var bus = AudioBus.create();
var mixer = AudioMixer.create({ bus });

// Fade music down to 30% over half a second when entering a menu.
mixer.fadeBus('music', 0.3, { durationMs: 500, easing: 'easeOutCubic' });

// Snapshot the in-game mix, switch to a cinematic preset, restore later.
mixer.snapshot('inGame');
mixer.fadeMaster(0.6, { durationMs: 200 });
// ... cinematic plays ...
mixer.restore('inGame', { durationMs: 400 });

// Duck music when voice plays.
mixer.pushDuck('voice-active', 'music', {
  scalar: 0.3, attackMs: 120, releaseMs: 400,
});
// ... voice line plays ...
mixer.releaseDuck('voice-active');

// Each frame:
mixer.tick(deltaTimeMs);
```

`AudioBus.listBuses()` is the only addition to existing surface; no
existing AudioBus consumers had it referenced.

## 0.34.0 - 2026-05-08

**AssetPreloader - declarative asset loading with progress events.**
The engine has individual asset helpers (asset-loader, audio-asset-
loader, sprite-sheet-loader); AssetPreloader bundles them into a
manifest the consumer hands over once + listens for events. Useful
for a loading screen.

### Added

- `src/runtime/asset-preloader.ts` - `AssetPreloader` class:
  - `add(id, loader)` - queue an asset; loader returns a Promise.
  - `on('progress' | 'asset' | 'error' | 'done', handler)` and the
    typed shortcuts onProgress / onAsset / onError / onDone.
  - `start()` -> Promise<AssetDoneEvent>. Idempotent; second call
    returns the existing done result.
  - `get(id)` - fetch successful result post-done.
  - `stats()` - introspection.
- Failed loaders don't halt the queue: every entry attempts; the
  'done' event reports succeeded + failed + errors[].
- Throwing event handler doesn't block siblings or queue progress.
- `AssetProgressEvent`, `AssetLoadedEvent`, `AssetErrorEvent`,
  `AssetDoneEvent` types exported.
- `RESOURCE_ASSET_PRELOADER` constant.

### Tests

788 -> 804 (16 new in tests/asset-preloader.test.ts):
- Empty queue -> done with zero counts.
- Single asset loads + done fires.
- Progress event per asset.
- Asset event per successful load.
- Failed loader fires error + done counts failed.
- Failed loader does NOT halt queue.
- add() after start() throws.
- Duplicate id / empty id / missing loader throw on add.
- get() returns null for failed; undefined for unknown.
- Stats reflect state at each phase.
- Throwing handler doesn't block siblings.
- Unsubscribe via returned function.
- Second start() returns same done result.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { AssetPreloader } from '@sadhaka/loom-engine';

var pre = new AssetPreloader();
pre.add('hero', () => fetch('/img/hero.png'));
pre.add('music', () => loadAudio('/snd/loom.ogg'));
pre.onProgress((ev) => updateBar(ev.fraction));
var done = await pre.start();
console.log('loaded', done.succeeded, 'failed', done.failed);
```

## 0.33.0 - 2026-05-08

**Color utility extensions.** The existing src/util/color.ts already
had ColorRGBA, hexToRgba (number), rgbaToHexString, colorLerp(out)
and the COLOR_KNOT palette. 0.33.0 adds string-parsing, blending,
HSL adjustment, and Uint32 pack/unpack without changing the
existing surface.

### Added

- `parseHex(str)` - parse a string hex color. Accepts 3 / 4 / 6 / 8
  hex digits with or without leading `#`. Returns null on invalid.
- `toHexString(c)` - format with auto 6 / 8 digits based on alpha.
- `colorBlend(over, under)` - alpha-composite two straight-alpha
  colors; output is straight-alpha. Returns a fresh object.
- `adjustHsl(c, dh, ds, dl)` - hue (degrees) + saturation + lightness
  deltas in HSL space; alpha preserved.
- `pack32(r, g, b, a)` -> Uint32 in 0xRRGGBBAA byte order. Useful
  for typed-array storage in particle pools.
- `unpack32(packed)` - inverse.
- `clamp01(v)` - clamp to [0, 1] with NaN / Infinity rejected.

### Backwards compatibility

Pure addition. Existing exports unchanged. The new helpers complement
rather than replace - e.g. parseHex(string) is the str-input
companion to the existing hexToRgba(number).

### Tests

769 -> 788 (19 new in tests/color.test.ts):
- rgba builds object; clamp01 edge cases.
- parseHex 3 / 4 / 6 / 8-digit forms; with / without # prefix;
  invalid input returns null.
- toHexString auto 6 / 8 digit formatting.
- parseHex -> toHexString round-trip.
- colorBlend opaque-over-opaque, transparent-over-opaque,
  transparent-over-transparent.
- adjustHsl shifts hue 120deg correctly; alpha preserved.
- pack32 + unpack32 round-trip.
- pack32 byte order is RRGGBBAA.
- pack32 clamps inputs.

## 0.32.0 - 2026-05-08

**ObjectPool - generic reusable object pool to cut GC pressure.**
Allocating short-lived objects every frame (damage numbers,
particles, projectiles, hit-flash overlays) creates GC pressure
that surfaces as frame-rate hitches. ObjectPool lets a system
pre-allocate N instances and reuse them.

### Added

- `src/runtime/object-pool.ts` - `ObjectPool<T>` class:
  - Constructor opts: `factory`, optional `reset(obj)`, optional
    `initialSize`, optional `maxSize` (cap).
  - `acquire()` - pops free instance OR allocates fresh OR returns
    null at cap.
  - `release(obj)` - calls `reset()` if configured, then returns
    object to free list.
  - `warm(count)` - pre-allocate more (capped by maxSize).
  - `clear()` - drop everything; subsequent acquire allocates fresh.
  - `freeCount()` / `inUseCount()` / `totalAllocated()` /
    `stats()` - introspection.
- Throwing `reset()` is caught + logged; release still adds to free.
- maxSize cap rejects acquire with null; counter tracks cap hits.

### Tests

756 -> 769 (13 new in tests/object-pool.test.ts):
- Factory required.
- acquire allocates from factory when free list empty.
- release returns object; subsequent acquire reuses.
- reset() called on release; no reset() means released state persists.
- initialSize pre-fills.
- maxSize caps total allocations; capRejects counter increments.
- warm() pre-allocates more (capped).
- clear() drops everything.
- Stats counters track acquires + releases + capRejects.
- Throwing reset is caught; release still adds to free.
- Large initial > maxSize is clamped.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { ObjectPool } from '@sadhaka/loom-engine';

var pool = new ObjectPool<DamageNumber>({
  factory: () => ({ x: 0, y: 0, life: 0 }),
  reset: (p) => { p.x = 0; p.y = 0; p.life = 0; },
  initialSize: 64,
});

// Hot path:
var p = pool.acquire();
if (p) { p.x = hitX; p.y = hitY; p.life = 1.0; }
// ... later
pool.release(p);
```

## 0.31.0 - 2026-05-08

**InputActions - declarative key/action bindings.** Existing
input-manager captures raw keydown/keyup; consumers wire game logic
to specific keys ("if SPACE is down, jump"). InputActions adds
indirection: declare an action ("jump") + the keys triggering it,
query by name. Foundation for a future settings-rebind UI.

### Added

- `src/input/input-actions.ts` - `InputActions` class:
  - `bind(action, keys)` / `unbind(action, keys?)` - manage bindings.
  - `handleKeyDown(key)` / `handleKeyUp(key)` - feed from window
    listeners or input-manager.
  - `releaseAll()` - drop all held keys (window blur).
  - `isActive(action)` / `wasJustPressed(action)` /
    `wasJustReleased(action)` - per-frame queries.
  - `update()` - call once per frame; clears just-pressed /
    just-released so they're single-frame events.
  - `keysFor(action)` / `actionNames()` - introspection.
  - `clear()` / `stats()`.
- Multi-key bindings: any of the bound keys triggers the action;
  action stays active while ANY bound key is held.
- Same key can drive multiple actions (e.g. Space -> 'jump' +
  'confirm-dialog').
- Duplicate keydown events on already-held key don't re-fire
  justPressed (matches DOM behaviour for held keys).
- Unbinding a held key forces re-evaluation of active state.
- `RESOURCE_INPUT_ACTIONS` constant.

### Tests

739 -> 756 (17 new in tests/input-actions.test.ts):
- bind + isActive single key.
- Bind to array - any triggers action.
- Multiple held keys keep action active until last released.
- wasJustPressed / wasJustReleased fire once per transition.
- Duplicate keydown does not re-fire justPressed.
- unbind drops keys; held key unbind re-evaluates.
- unbind() with no keys drops the whole action.
- releaseAll wipes held keys + fires justReleased.
- Same key shared across actions fires both.
- Stats track event counts.
- clear() drops everything.
- Empty key strings silently ignored; re-bind idempotent.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { InputActions } from '@sadhaka/loom-engine';

var ia = new InputActions();
ia.bind('jump', ['Space', 'Enter']);
window.addEventListener('keydown', e => ia.handleKeyDown(e.code));
window.addEventListener('keyup', e => ia.handleKeyUp(e.code));

// In game loop:
if (ia.wasJustPressed('jump')) player.jump();
ia.update();
```

## 0.30.0 - 2026-05-08

**SpatialHash - bucket entities by world cell for fast nearby
queries.** Boss target picking, AoE coverage, particle culling, peer
proximity - all the "entities NEAR a point" queries that ComponentSignature
+ QueryCache (0.22.0) don't accelerate. SpatialHash gives O(1) insert
+ O(K) query where K = entities in the queried cells.

### Added

- `src/runtime/spatial-hash.ts` - `SpatialHash` class:
  - `insert(entity, x, y)` - O(1) bucket assignment.
  - `update(entity, x, y)` - same-cell is no-op; cross-cell is
    swap-pop + reinsert.
  - `remove(entity)` - O(1) swap-pop; bucket auto-cleans when empty.
  - `queryRect(x0, y0, x1, y1)` - returns all entities in cells
    overlapping the rect. Caller filters by precise containment if
    needed.
  - `queryRadius(cx, cy, r)` - convenience over queryRect.
  - `size()`, `bucketCount()`, `clear()`, `stats()`.
- Cell size configurable at construction (default 32 world units).
  Invalid sizes (0, NaN, negative) clamp to 32.
- Negative coordinates handled (cell coord biased internally).
- Reversed query rect bounds normalized.
- `RESOURCE_SPATIAL_HASH` constant.

### Tests

726 -> 739 (13 new in tests/spatial-hash.test.ts):
- insert + queryRect / queryRadius narrows correctly.
- remove drops entity + cleans empty bucket; double-remove is false.
- update within same cell is a no-op.
- update across cells rebuckets; old cell empty + new cell has entity.
- insert on existing entity equivalent to update.
- queryRect with reversed bounds normalized.
- 100-entity stress: all retrievable from full bbox query.
- clear() drops everything.
- cellSize defaults to 32 on invalid input.
- Stats counters increment correctly.
- Negative coordinates work.
- Swap-pop maintains correct indexInBucket on remove (5-entity cell
  stress test).

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { SpatialHash } from '@sadhaka/loom-engine';

var sh = new SpatialHash(32);
// On entity transform update:
sh.update(entityId, transform.x, transform.y);
// Boss target search:
var nearby = sh.queryRadius(boss.x, boss.y, ATTACK_RANGE);
for (var i = 0; i < nearby.length; i++) {
  // exact-distance filter here
}
```

## 0.29.0 - 2026-05-08

**Tween system - animate scalar values over time with easings.**
Camera zoom, HUD fade, color transitions, particle alpha decay, audio
volume swells - any "value from A to B over T seconds with curve"
needs the same scheduler. Tween provides it.

### Added

- `src/runtime/tween.ts` - `Tween` class:
  - `to(from, to, durationSeconds, onUpdate, options?)` -> `TweenHandle`.
    Schedules an animation; calls `onUpdate(value)` each frame.
  - Options: `easing` (name string OR custom `(t) => number` fn) +
    `onComplete` callback.
  - `update(dtSeconds)` per-frame entry point.
  - `cancelAll()` and per-tween `handle.cancel()`.
  - `activeCount()` + `stats()` for diagnostics.
- `Easings` table with 13 standard curves: linear + easeIn / easeOut /
  easeInOut variants of quad / cubic / quart / sine. Custom curves
  accepted via callable `(t) => number`.
- Zero / negative duration snaps immediately to `to` and fires
  onComplete in the same call - useful for "toggle state with no
  transition".
- Throwing `onUpdate` / `onComplete` callbacks are caught + logged;
  one bad subscriber doesn't break the loop.
- Cancelled tweens do NOT fire `onComplete` - explicit "I aborted
  this" semantic.
- `RESOURCE_TWEEN` constant. `TweenHandle`, `TweenOptions`,
  `EasingFn`, `EasingName` types exported.

### Tests

711 -> 726 (15 new in tests/tween.test.ts):
- Linear interpolates from -> to over duration.
- Completes after duration; no further updates.
- onComplete fires once at the end.
- Zero duration snaps immediately + completes.
- Cancel stops further updates; onComplete does NOT fire.
- handle.isActive reflects status.
- Multiple tweens run in parallel.
- cancelAll cancels every running tween.
- Easing customizable via name AND callable.
- Unknown easing name falls back to linear.
- Invalid dt rejected (no NaN propagation).
- Throwing onUpdate is caught; tween still completes.
- Stats track active + completed + cancelled.
- Easings table has 13 named functions.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { Tween, Easings } from '@sadhaka/loom-engine';

var tw = new Tween();
tw.to(0, 100, 1.0, function (v) { hud.opacity = v; },
  { easing: 'easeOutCubic' });

// In render loop:
tw.update(dtSeconds);
```

## 0.28.0 - 2026-05-08

**EventBus - generic typed pub/sub for the engine.** Systems and
consumers need to talk without each side knowing the other's
identity. The engine already has specialized buses (zone events,
plugin dispatch, DOM CustomEvents); EventBus is the generic layer
for everything else.

### Added

- `src/runtime/event-bus.ts` - `EventBus` class:
  - `subscribe(topic, handler)` -> unsubscribe function. Idempotent
    unsubscribe.
  - `once(topic, handler)` - auto-removes after first delivery.
  - `publish(topic, data?)` - delivers to all current subscribers.
    Errors caught + logged; one bad handler doesn't block siblings
    or break the publisher.
  - `off(topic)` / `clear()` - bulk-drop subscribers.
  - `topics()` / `handlerCount(topic)` - introspection.
  - `stats()` - publishCount + deliveredCount + topicCount.
- Snapshot semantics: handlers added DURING a publish do NOT fire
  for that same publish (they're added to the next-publish list).
  This matches DOM EventTarget behavior.
- `RESOURCE_EVENT_BUS` constant.
- `EventHandler<T>` type.

### Tests

698 -> 711 (13 new in tests/event-bus.test.ts):
- subscribe + publish delivers data.
- Multiple subscribers all receive each publish.
- Unsubscribe stops delivery; idempotent.
- once fires exactly once + auto-removes.
- Handlers added during publish don't fire for same publish.
- Throwing handler doesn't block siblings or subsequent publishes.
- off() / clear() bulk-drops.
- topics() / handlerCount() / stats() round-trip.
- Publish with no subscribers is silent.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { EventBus } from '@sadhaka/loom-engine';

var bus = new EventBus();
var unsub = bus.subscribe('player.died', function (data) { ... });
bus.publish('player.died', { x: 10, y: 20 });
unsub();
```

## 0.27.0 - 2026-05-08

**CameraController - smooth follow / shake / bounds clamp / fit-rect.**
Higher-level camera behaviors on top of the existing CameraView. The
controller writes back into the same CameraView so render systems
see no API change.

### Added

- `src/renderer/camera-controller.ts` - `CameraController` class:
  - `followTarget(x, y, smoothing?)` - per-frame target update; the
    controller lerps toward it each tick using exponential smoothing.
  - `clearFollow()` - stop following.
  - `snapTo(x, y)` - immediate reposition; clears follow target.
  - `shake(amplitude, durationMs)` - additive screen shake; linear
    amplitude decay; replaces any active shake.
  - `getShakeOffset()` - read the current applied shake offset (for
    HUD elements that should also shake).
  - `setBounds(rect | null)` - clamp the visible rect inside the
    given world bounds. null disables. Tiny worlds (smaller than
    viewport) center on bounds midpoint.
  - `fit(rect, paddingPx?)` - one-shot zoom + center to show the
    rect with paddingPx pixels of slack. Picks the tighter axis.
  - `update(dtSeconds)` - apply pending follow + shake decay each
    frame.
- `CameraControllerOptions` (defaultSmoothing + randomFn injection
  seam for deterministic shake tests).
- `RESOURCE_CAMERA_CONTROLLER` constant.

### Tests

686 -> 698 (12 new in tests/camera-controller.test.ts):
- snapTo immediate reposition.
- followTarget lerps with smoothing factor; converges over time.
- clearFollow stops the lerp.
- shake decays to zero offset over duration.
- shake replaces an active shake; invalid duration cancels.
- setBounds clamps view center; setBounds(null) disables.
- fit centers + zooms; fit honors padding.
- Tiny world centers on bounds midpoint when bounds < viewport.
- Invalid dt rejected (no NaN propagation).

### Backwards compatibility

Pure addition. CameraView shape unchanged; render systems read it
the same way. Engine consumers opt in:

```ts
import { CameraController, createCamera } from '@sadhaka/loom-engine';

var view = createCamera(canvas.width, canvas.height);
var ctrl = new CameraController(view);

ctrl.followTarget(player.x, player.y);
// ... in render loop:
ctrl.update(dtSeconds);
device.setCamera(view);
```

## 0.26.0 - 2026-05-08

**WorldSnapshot - opt-in save/load via persistable resources.** Lets
a consumer serialize world state to JSON for persistence / replay /
trace export, and restore it later. Resources opt in by implementing
`IPersistableResource`; resources that don't are silently skipped.

### Why this scope (not full ECS serialization)

Component pools are SoA Float32Arrays - serializing them generally
requires schema versioning per pool + entity-id remapping on restore
(complex). What CAN be saved cheaply today is the registered resource
state: time, knot context, plugin storage snapshots, custom consumer
resources. WorldSnapshot delivers exactly that with a minimal
contract.

A future v2 can layer entity-pool serialization on top once a stable
component-schema discipline lands.

### Added

- `src/runtime/world-snapshot.ts` -
  - `IPersistableResource` interface: optional `persistKey?: string`
    + `serialize?(): unknown` + `deserialize?(data): void`. Both
    methods return / accept JSON-safe data.
  - `serializeWorldSnapshot(registry, engineVersion, nowFn?)` walks
    the registry, calls serialize() on persistable resources,
    returns a versioned envelope `{schemaVersion, engineVersion,
    capturedAtMs, resources}`. Errors in serialize() are logged +
    skipped; the rest of the envelope still ships.
  - `deserializeWorldSnapshot(registry, snapshot)` matches envelope
    keys to resources via `persistKey` (or registry key if absent),
    calls deserialize() on each, returns count restored. Malformed
    envelopes return 0; missing entries leave resources alone.
  - `SNAPSHOT_SCHEMA_VERSION = 1`. Bump when the envelope shape
    changes.
  - `RESOURCE_WORLD_SNAPSHOT` constant for an attached snapshot
    facility (e.g. an auto-save system).

### Tests

676 -> 686 (10 new in tests/world-snapshot.test.ts):
- serialize collects only persistable resources; non-persistable
  resources skipped silently.
- persistKey overrides registry key in the envelope.
- nowFn injection for deterministic capturedAtMs.
- serialize() that throws is logged + skipped.
- deserialize restores counter state.
- deserialize uses persistKey to match envelope -> resource.
- Missing persistKey in envelope leaves resource alone.
- deserialize that throws is caught + counted out.
- serialize -> deserialize round-trip preserves state.
- Malformed snapshot envelopes return 0 restored.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import {
  serializeWorldSnapshot,
  deserializeWorldSnapshot,
  type IPersistableResource,
} from '@sadhaka/loom-engine';

class SaveData implements IPersistableResource {
  persistKey = 'save-data';
  level = 1;
  serialize() { return { level: this.level }; }
  deserialize(data) { this.level = data.level; }
}

// At save time:
var snapshot = serializeWorldSnapshot(world.resources, LOOM_ENGINE_VERSION);
localStorage.setItem('save-1', JSON.stringify(snapshot));

// At load time:
var snap = JSON.parse(localStorage.getItem('save-1'));
var restored = deserializeWorldSnapshot(world.resources, snap);
```

## 0.25.0 - 2026-05-08

**EngineClock - pause / step / timeScale controls.** Self-contained
timing wrapper around the consumer's render loop -> world.update
chain. Lets a debug HUD pause the world, single-step frames, or run
slow-mo / fast-forward without touching world or system code.

### Added

- `src/runtime/engine-clock.ts` - `EngineClock` class. Surface:
  `pause()`, `resume()`, `isPaused()`, `setTimeScale(s)`,
  `timeScale()`, `tick(realDtMs)` -> simulated dt, `step(stepMs?)`
  for fixed-dt stepping while paused, `totalSimulatedMs()`,
  `totalRealMs()`, `totalSteps()`, `resetCounters()`.
- Pause + timeScale=0 both make tick() return 0; only step()
  bypasses the pause gate (the explicit "advance one frame while
  paused" affordance).
- `EngineClockOptions` (timeScale + defaultStepMs) for construction.
- `RESOURCE_ENGINE_CLOCK` constant for world-attached clock.

### Usage pattern

```ts
import { EngineClock } from '@sadhaka/loom-engine';
var clock = new EngineClock();

function frame(realDtMs) {
  var simDt = clock.tick(realDtMs);
  world.update(simDt);
}

// Debug stepping:
clock.pause();
function onStepButton() {
  var dt = clock.step();
  world.update(dt);
}
```

### Tests

665 -> 676 (11 new in tests/engine-clock.test.ts):
- tick passes through dt at scale=1.
- pause makes tick return 0; resume restores.
- timeScale multiplies sim dt; clamping rejects negative / NaN /
  Infinity to 0.
- timeScale=0 acts like pause (real ms still tracked).
- step() emits dt even while paused; bumps counters; ignores
  invalid stepMs.
- tick() rejects invalid realDtMs.
- defaultStepMs reflects constructor; invalid clamps to ~16.67.
- resetCounters wipes timing but preserves pause + scale.

### Backwards compatibility

Pure addition. World, systems, render loop untouched.

## 0.24.0 - 2026-05-08

**DebugHUD primitive.** Self-contained stats overlay any consumer
can drop in without rolling their own fps tracker / line layout.

### Added

- `src/debug/debug-hud.ts` - `DebugHUD` class. Tracks a rolling
  60-sample fps window via beginFrame() per render frame; exposes
  `fps()`, `fpsRange()`, `frameCount()`. Custom stat lines via
  `addLine(label, value | thunk)` - thunks re-evaluate every render
  so dynamic counters (entity count, plugin stats, batch entries)
  stay live without re-registration. `toText()` returns a string
  snapshot; `attachToDom(parent)` mounts a top-left absolute-
  positioned overlay div with sane default styling. `render()`
  refreshes the DOM + returns the snapshot.
- `nowFn` injection seam (defaults to `performance.now`) so tests
  can drive deterministic clocks.
- Static `RESOURCE_DEBUG_HUD` constant for world-attached HUDs.
- `DebugHUDOptions` type exported.

### Tests

654 -> 665 (11 new in tests/debug-hud.test.ts):
- fps starts at 0; beginFrame computes from clock delta.
- Rolling window averages mixed-rate frames.
- fpsRange reports min + max.
- frameCount monotonically increments.
- addLine + toText round-trip (static + thunk values).
- Dynamic thunk re-evaluates on each render.
- clearLines drops custom lines, keeps built-ins.
- Thunk that throws renders <error>.
- render() returns same text as toText().
- attachToDom requires a DOM (headless throws).

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { DebugHUD } from '@sadhaka/loom-engine';

const hud = new DebugHUD();
hud.addLine('entities', () => String(world.countEntities()));
hud.attachToDom(document.body);

// Inside render loop:
hud.beginFrame();
hud.render();
```

## 0.23.0 - 2026-05-08

**Render pipeline batching primitive: RenderBatch.** Lays foundation
for grouping sprite draws by (layer, atlas) without forcing existing
render systems to migrate. Opt-in: a system that wants to amortise
state changes calls batch.submit() instead of device.drawSprite()
directly, then flushTo() once at end-of-frame. Existing systems are
unmodified.

### Why this scope (not full pipeline rewrite)

Today's Canvas2D backend has no real GPU state machine - drawSprite
just calls drawImage. The benefits of batching are:
1. Foundation for the future WebGL2 backend where uniform/texture
   binding state changes per-call dominate.
2. Lets a HUD-rendering system explicitly express painter order
   without each system reaching into the device.
3. Per-frame batching enables future per-batch sort / dedupe /
   instancing transforms without touching consumer systems.

### Added

- `src/renderer/render-batch.ts` - `RenderBatch` class. Submission
  surface: `submit(layer, atlas, frame, x, y, z, tint?)`. Drainage:
  `flushTo(device, callback)` calls callback per (layer, atlas)
  group in layer-ascending order then submission order. Atlas
  grouping is by reference equality so non-adjacent same-atlas
  submissions land in separate groups (painter order preserved).
  `clear()` drops the queue without flushing. `stats()` for
  diagnostics.
- Layer constants: `RENDER_LAYER_BACKGROUND` (-100),
  `RENDER_LAYER_TERRAIN` (0), `RENDER_LAYER_ENTITIES` (100),
  `RENDER_LAYER_FX` (200), `RENDER_LAYER_HUD` (1000). Consumers
  can use any int; these are conventions for the demo's painter
  order.
- `RESOURCE_RENDER_BATCH` constant for world-attached batch.
- `BatchFlushCallback` type exported.

### Backwards compatibility

Pure additions. Existing pools, systems, render path unchanged.
Engine consumers opt in by:

```ts
import { RenderBatch, RENDER_LAYER_ENTITIES } from '@sadhaka/loom-engine';

const batch = new RenderBatch();
// In a system:
batch.submit(RENDER_LAYER_ENTITIES, atlasRef, frame, x, y, z);
// At end of frame:
batch.flushTo(device, (layer, atlas, entries) => {
  // Issue native draws for the group.
});
```

### Tests

645 -> 654 (9 new in tests/render-batch.test.ts):
- Empty flush is a no-op.
- Consecutive same-atlas submits merge into one group.
- Non-adjacent same-atlas submits land in separate groups (painter
  order).
- Layers iterate ascending regardless of submit order.
- Tint pass-through round-trips.
- Flush clears the queue.
- clear() drops queue without flushing.
- Stats track submits + groups + entries.
- Same-number layers coalesce into one bucket.

## 0.22.0 - 2026-05-08

**ECS query primitives: ComponentSignature + QueryCache.** Lays the
foundation for archetype-style queries without forcing a rewrite of
the existing structure-of-arrays component pools. Opt-in: existing
systems are unmodified; new systems can adopt the primitives where
the perf win matters.

### Why this scope (not full archetype storage)

A true archetype rewrite reshuffles entities so all entities sharing
a component combination live in a single packed table. The current
SoA pools (TransformPool, SpritePool, etc.) are already cache-
friendly within a pool; the cost they DON'T amortise is the
multi-component intersection a system asks for every frame ("entities
with both transform AND sprite"). ComponentSignature + QueryCache
solve exactly that without touching the pool layout.

A future v2 can layer archetype-based packing on top.

### Added

- `src/runtime/component-signature.ts` - `ComponentSignature` class.
  Per-entity Uint32 bitmask; up to 32 component bits. Surface:
  `setBit / clearBit / clearEntity / getMask / hasAll / hasAny /
  collectMatching / version / capacity`. Capacity grows pow-2 on
  demand. The version counter bumps on every actual mutation so a
  consumer can detect "any change" cheaply.
- `componentMask(...bits)` helper to build a bitmask from a list of
  bit indices. Throws on out-of-range bits in development.
- `RESOURCE_COMPONENT_SIGNATURE = 'loom.component_signature'`.
- `src/runtime/query-cache.ts` - `QueryCache` class. Memoizes
  signature queries by mask, invalidates on version bump. Surface:
  `query(mask) / clear() / stats()`. FIFO eviction at maxEntries
  (default 64) prevents long-running games from accumulating an
  unbounded cache.
- `RESOURCE_QUERY_CACHE = 'loom.query_cache'`.

### Backwards compatibility

Pure additions. Existing pools, systems, tests unchanged. Engine
consumers opt in by:

```ts
import { ComponentSignature, QueryCache, componentMask } from '@sadhaka/loom-engine';

const sig = new ComponentSignature();
const cache = new QueryCache(sig);

// Pool registers entity components on attach.
sig.setBit(entityIdx, COMPONENT_BIT_TRANSFORM);
sig.setBit(entityIdx, COMPONENT_BIT_SPRITE);

// System queries.
const matches = cache.query(componentMask(COMPONENT_BIT_TRANSFORM, COMPONENT_BIT_SPRITE));
for (let i = 0; i < matches.length; i++) {
  const idx = matches[i];
  // ...
}
```

### Tests

631 -> 645 (14 new in tests/component-signature.test.ts):
- setBit / clearBit / hasAll / hasAny / clearEntity round-trips.
- setBit out of range throws.
- Capacity grows pow-2 on demand; existing data preserved.
- Version bumps only on actual mutations (idempotent set/clear no-op).
- collectMatching returns sorted entity indices.
- QueryCache hit/miss + reference identity on hit.
- QueryCache invalidates on signature version bump.
- Multiple masks cached independently; FIFO eviction at maxEntries.
- clear() resets state.

## 0.21.0 - 2026-05-08

**IManagedResource lifecycle hooks.** Resources owning external state
(workers, listeners, network bridges, audio contexts, pools) can now
participate in attach / detach / dispose lifecycle without the engine
core needing to know about each resource type.

### Added

- `IManagedResource` interface with three optional methods:
  `onAttach(world)`, `onDetach(world)`, `dispose()`. All optional; a
  resource declares only the hooks it needs.
- `LifecycleWorld` structural type forward-declared to avoid the
  circular import resources.ts <-> world.ts. The concrete World is
  structurally compatible.
- `ResourceRegistry.bindWorld(world)` - one-time binding so the
  registry can pass the world to lifecycle hooks. World constructor
  calls this immediately after registry creation.
- `ResourceRegistry.attach(key, value)` - lifecycle-aware setter.
  Calls onAttach if present. If a row already exists at that key, it
  is detached + disposed first so hook ordering is well-defined.
- `ResourceRegistry.detach(key)` - lifecycle-aware remover. Calls
  onDetach + dispose (in that order) before deleting. Errors in any
  hook are logged but don't block subsequent hook calls or the row
  removal.
- `ResourceRegistry.disposeAll()` - iterates every registered resource
  and calls detach on each. Used by World.dispose() during shutdown.
- `World.dispose()` - graceful shutdown. Phase 1 calls every
  system's optional `onDispose(world)` so systems can release
  handles before resources go away. Phase 2 disposes all resources.
  Phase 3 clears the systems map and pools. Idempotent.

### Backwards compatibility

The legacy `set()` / `remove()` paths bypass the new hooks. Existing
resources that don't declare lifecycle methods see zero behaviour
change. Only opt-in callers using `attach()` / `detach()` /
`disposeAll()` trigger hooks. This keeps every existing 0.20.x test
passing without modification.

### Tests

617 -> 631 (14 new in tests/resource-lifecycle.test.ts):
- attach calls onAttach with bound world.
- detach calls onDetach + dispose then removes.
- detach on missing key returns false; no hooks called.
- Re-attach detaches prior value first (defined hook ordering).
- Legacy set/remove do NOT call hooks (back-compat).
- disposeAll iterates every resource.
- Resources without IManagedResource methods skip silently.
- Errors in onAttach / onDetach / dispose are logged but don't block.
- World.dispose disposes resources + notifies systems via onDispose.
- World.dispose is idempotent.
- Standalone ResourceRegistry without bindWorld skips hooks (still
  registers the row).

### Public surface

`IManagedResource` and `LifecycleWorld` types exported from
`@sadhaka/loom-engine`. `ResourceRegistry` already exported; gains
`bindWorld`, `attach`, `detach`, `disposeAll` methods.

## 0.20.1 - 2026-05-08

**SSEZoneBridge networking polish.** Mirrors the 0.20.0
director-bridge surface for the zone-event channel, scoped to what
makes sense for a bridge that does NOT own its EventSource (the
presence layer does). No backoff or snapshot-required handling -
those would be foreign concerns - just status state-machine + timing
stats parity.

### Added

- `arpg:zone-bridge-status` CustomEvent on every status transition
  with `{from, to, characterId}` detail. Default target is
  `globalThis.window`; `opts.statusEventTarget` can pin a custom
  target (or `null` to disable dispatch).
- `transitionTo(next)` private method routes every status change
  through one site so timing-stat bumps stay consistent. Idempotent
  (same-status calls no-op + don't double-bump counters).
- `ZoneEventBridgeStats` gains `lastConnectedAtMs`,
  `lastDisconnectedAtMs`, `totalConnectsCount`,
  `totalDisconnectsCount`. Reuses the underlying
  `EventSource.readyState` transitions as the trigger; the bridge
  doesn't own retry, so these track OBSERVED state changes from the
  presence layer.
- `nowFn` injection seam (defaults to `Date.now`) for deterministic
  timing in tests.
- `MockZoneBridge` updated to include the new stats fields so type
  callers don't fork.

### Tests

606 -> 617 (11 new). Coverage:
- Initial idle status; start with open/connecting/closed ES
  reflects correctly.
- `status()` reflects underlying readyState transitions even when
  ES changes after start.
- `stop()` transitions to closed.
- Connected transition bumps lastConnectedAtMs + totalConnectsCount.
- Connected -> closed bumps lastDisconnectedAtMs + totalDisconnectsCount.
- arpg:zone-bridge-status CustomEvent fires with full detail
  (`from / to / characterId`).
- All 0.20.1 fields present on `stats()` AND existing fields
  preserved.
- Out-of-order delivery still works (regression duplicate of the
  fuzzer contract from 0.20.0).
- Idempotent `transitionTo` - redundant `status()` polls don't
  double-bump `totalConnectsCount`.

### Why this scope (not the original 0.20.x plan)

The first attempt at this phase added gap-detection +
snapshot-required handling at the bridge layer. That broke the
fuzzer's "out-of-order events MUST still be queued" contract,
because gap detection lives downstream in `ZoneEventSystem` per the
existing comment at `tests/fuzzer/fuzzer.test.ts` line 113-116.
Reverting to the existing buffer-everything semantic + adding only
status / timing parity ships the surface improvements without
crossing the contract.

A future 0.21.x can layer system-level gap detection (with a
configurable `GAP_THRESHOLD` + snapshot-pull recovery) without
touching the bridge.

## 0.20.0 - 2026-05-08

**Networking polish for SSEDirectorBridge.** Eliminates the
fixed-delay reconnect anti-pattern and gives consumers + operators
visibility into bridge lifecycle. The director bridge is now the
canonical reference; SSEZoneBridge gets the same treatment in 0.20.1
once the gap-detection + snapshot-pull paths are validated against
the protocol fuzzer.

### Added

- **Exponential backoff with full jitter.** On `EventSource.onerror`,
  the bridge takes ownership of the retry loop and schedules a
  manual reconnect with `delay_n = min(MAX, BASE * 2^n) + uniform(0,
  BASE)`. Defaults `BASE=500ms` / `MAX=30000ms`, both configurable
  via constructor opts. Replaces the prior fixed-2000ms retry
  scheduled inside `EventSource`'s default reconnect path.
- **Last-Event-Id idempotent replay.** `lastEventId` appended to the
  reconnect URL as both `?last_event_id` (legacy) and `?since=`
  (canonical per LOOM-DIRECTOR-PROTOCOL-V2 sec.3) so the server-side
  replay route fills the gap and the bridge dedupes any envelopes
  with `id <= initialLastEventId`.
- **Status state machine.** Statuses: `idle / connecting / connected
  / reconnecting / snapshot-required / closed`. Every transition
  logs and dispatches `arpg:director-bridge-status` CustomEvent with
  `{from, to, characterId}` detail on `globalThis.window` (or
  `opts.statusEventTarget`). Consumers wire UI off this stream.
- **Stats counters expanded.** `DirectorBridgeStats` adds
  `lastConnectedAtMs`, `lastDisconnectedAtMs`, `totalConnectsCount`,
  `totalDisconnectsCount`, `currentReconnectAttempt`. Existing
  fields (`eventsReceived`, `reconnects`, `lastEventId`, etc.)
  preserved.
- **Injection seams** for deterministic tests:
  `setTimeoutFn`/`clearTimeoutFn`/`randomFn`/`nowFn`/`statusEventTarget`.
  Production code uses `globalThis` defaults.

### Tests

597 -> 606 (9 new networking tests). Coverage:

- Initial idle status; start -> connecting transition.
- onopen -> connected + lastConnected/totalConnects bumped.
- onerror -> reconnecting + scheduled reconnect with computed
  backoff (zero-jitter case asserts exact 500ms first retry).
- Backoff doubles per attempt; caps at maxBackoffMs (asserted by
  driving 5 successive errors with base=100/max=800: 100/200/400/
  800/800).
- Jitter adds 0..BASE: randomFn=0.5 with BASE=500 yields 750ms total.
- Successful onopen resets `currentReconnectAttempt` to 0; the next
  error re-starts at attempt 0's delay.
- arpg:director-bridge-status CustomEvents fire with `{from, to}`
  detail on every transition.
- onerror bumps `lastDisconnectedAtMs` + `totalDisconnectsCount`.
- Explicit `stop()` -> closed AND cancels any pending reconnect
  timeout (advancing the clock 10s after stop creates no new ES).

### Deferred to 0.20.1

- **SSEZoneBridge networking polish** with the same backoff +
  status state machine, plus a gap-detection + snapshot-pull
  recovery path. Initial implementation broke the protocol fuzzer's
  out-of-order delivery contract; ships in 0.20.1 once the gap-
  threshold semantics are reconciled with the existing reorder
  buffer.

### Changed

- `LOOM_ENGINE_VERSION` 0.19.1 -> 0.20.0. Smoke + webgl2 version
  pinning tests bumped accordingly.
- `tests/no-nondeterminism.test.ts` whitelist updated to allow the
  director bridge's `Math.random` for jitter (production seam) and
  `Date.now` for connection timestamps (out-of-tick metric, mirrors
  the plugin runtime entry).

## 0.19.1 - 2026-05-08

**Hot fix** for two bugs discovered when registering a sync hook in
production:

1. `safeCall` calls `hookFn.apply(...)` and assumed the return was a
   Promise. A hook returning `null` synchronously (mirrors the Python
   `Optional[EmittedEvents]` return shape) made `withTimeout` call
   `.then()` on `null` and throw "Cannot read properties of null
   (reading 'then')". Fixed by wrapping the return value in
   `Promise.resolve(...)` before passing to `withTimeout`.

2. `withTimeout` cleared the timeout via the inner promise's
   `.then()` callbacks. With a sync hook the inner promise had
   already resolved before the chain attached, so `clearTimeout`
   never ran and the timeout always fired at +budget regardless of
   the actual hook duration. Fixed via a `fired` boolean both the
   timeout callback and the resolve/reject path check first - the
   first to set it wins, the other becomes a no-op.

Two regression tests added: `sync hook returning null is safe + fast`
and `sync hook returning a value resolves correctly`. Run from a
fresh registry, neither bumps `hook_timeout_count` or
`hook_error_count`. 595 -> 597 tests, all green.

## 0.19.0 - 2026-05-08

**Client-side plugin SDK** (LOOM-DIRECTOR-PROTOCOL-V3 sec.3.1).
TypeScript companion of the Python `loom_ai_plugin_runtime`. Lets
Founders author client-side Loom plugins reacting to zone-events
without forking the engine. Same names + semantics as the Python
runtime where they apply on the client (no per-character v1 stream;
no asyncio - Promise + async/await throughout).

### Why

The Python plugin runtime in `api/loom_ai_plugin_runtime.py` is a
clean abstraction for server-side plugin authors but stops at the
HTTP boundary - a Founder writing a client-side HUD widget reacting
to `zone.boss.tick` had to monkey-patch the ARPG-loom IIFE. v3
sec.3.1 carved out the slot for a TS companion; this release fills
it. Authors moving between server-side (Python) and client-side
(TypeScript) plugins now share a vocabulary.

### Added

- `src/plugins/types.ts` - TypeScript Protocol equivalents:
  `IClientPlugin`, `PluginContext`, `PluginStorage`, `PluginLogger`,
  `PluginOpsStats`, `PluginDescribeRow`, `EmittedEvents`, `PeerInfo`,
  `PluginError`, `PluginEntropy`, scope constants. Mirrors
  `loom_ai_plugin_runtime.py` shape-for-shape.
- `src/plugins/client-registry.ts` - `ClientPluginRegistry` with the
  same surface as the Python `AIPluginRegistry`:
  - `register / unregister / reload / list / describe`,
  - per-plugin `MapPluginStorage` wrapped in a counting wrapper
    (storage cap + ops counters),
  - per-plugin tick budget enforced via `Promise.race` timeout,
  - per-plugin scope gates (`read_zones / read_characters /
    read_events`) gating `getZonePeers / getZoneState /
    getZoneEventsTail`,
  - `PluginError(retryable=true)` triggers ONE retry before drop,
  - error isolation: a hook throw drops only that plugin's
    contribution for that dispatch,
  - lifecycle hooks: `onZoneEvent`, `onPreTick / onPostTick`,
    narrow `onBossSpawn / onBossEnd / onLootDrop` conveniences,
    `dispose`,
  - DOM bridge auto-attaches to `arpg:zone-*` CustomEvents on
    `globalThis.window` so any host already dispatching the ARPG-loom
    custom events gets plugin routing for free,
  - `reload(name, moduleSpecifier)` re-imports the plugin module via
    dynamic import with a cache-bust query.
  - TTL storage helpers (`setWithTtl / getWithTtlCheck`) layered
    over any PluginStorage.
- `src/plugins/index.ts` - bare exports surface.
- `tests/plugins/client-registry.test.ts` - 18 tests covering
  register/replace, dispatch order, error isolation, retry,
  tick-budget timeout, scope gates, storage cap, ops counters,
  describe shape, dispose, DOM bridge, spatial helpers, entropy
  determinism, TTL helpers, scope set.
- `tests/plugins/example-hud-plugin.test.ts` - 3 tests demonstrating
  the canonical use case: a boss HUD plugin that mounts on
  `zone.boss.spawn`, updates on `zone.boss.tick`, unmounts on
  `zone.boss.end`, and flushes overlays in `dispose()`.

### Changed

- `src/index.ts` exports the new client-plugin surface
  (`ClientPluginRegistry`, `PluginError`, `PluginEntropy`,
  `IClientPlugin`, etc.).
- `LOOM_ENGINE_VERSION` -> `0.19.0`.
- `package.json` -> `0.19.0`.
- `tests/no-nondeterminism.test.ts` whitelists `plugins/types.ts`
  and `plugins/client-registry.ts` for `Date.now()` reads (plugin
  runtime is out-of-tick, mirror of `director/ai/plugin-context.ts`).

### Test count

574 -> 595 (21 new).

---

## 0.18.0 - 2026-05-08

**Replay determinism polish** (Phase E5, on top of E3 + E4). Closes
the loop opened by 0.17.0's seeded RNG: deterministic clock everywhere
in the tick path, ordering audit, snapshot fixture for regression
detection, and an end-to-end smoke that proves "two worlds, same
seed, same outcome".

### Why

0.17.0 routed Math.random through a seeded entropy resource. That
fixed RNG drift but left a second source of non-determinism: every
tick-driven system was reading `performance.now()` for damage / fade
/ cooldown timestamps. Two HeadlessTickers with the same seed but
different real-time elapsed since process start would diverge on the
first health.applyDamage / KnotContext.beginFade call. 0.18.0 routes
all in-tick clock reads through TimeResource.elapsed * 1000 so the
clock is part of the seeded contract.

### Changed

- `src/director/zone/zone-event-system.ts` - knot fade `nowMs` no
  longer adds `performance.now()` to TimeResource.elapsed * 1000.
  Audit also confirmed the system iterates `bridge.pollEvents()` in
  arrival order; no Set / Map.entries / Object.keys walks; no entropy
  reads.
- `src/director/director-system.ts` - same nowMs cleanup. Now in the
  same coordinate as ZoneEventSystem so beginFade / tickFade stay
  in sync across replays.
- `src/systems/attack-system.ts` - applyDamage timestamp from
  TimeResource.
- `src/systems/damage-system.ts` - kill timestamp from TimeResource.
- `src/systems/projectile-system.ts` - projectile-impact damage
  timestamp from TimeResource.
- `src/systems/pursue-system.ts` - contact-damage cooldown clock
  from TimeResource.
- `src/systems/ranged-attack-system.ts` - cooldown + projectile spawn
  timestamps from TimeResource.
- `src/systems/peer-presence-system.ts` - peer interpolation clock
  from TimeResource.
- `src/audio/cue-catalog.ts` - new `CueCatalogOptions.now` injection
  seam. CueCatalog.create({ now }) accepts a TimeResource-driven
  closure; the default fallback to performance.now() / Date.now()
  is unchanged so existing call sites keep working.

### Added

- `tests/zone-event-system-determinism.test.ts` - 7 tests. Two
  seeded tickers + same trace -> identical state snapshots; reverse
  trace -> divergent state (system is arrival-order sensitive);
  TPS 30 vs 120 keeps semantic state identical; entropy-blind
  tripwire (seed 1 vs seed 2 produce same zone state).
- `tests/no-nondeterminism.test.ts` - 8 tripwire tests. Greps the
  src/ tree and asserts: Math.random count = 0; Date.now in
  src/systems/ = 0; Date.now outside the documented whitelist
  (cue-catalog default fallback, plugin-context, multiplayer
  bridges) = 0; new Date().getTime = 0; performance.now in
  src/systems/ = 0; director-system + zone-event-system no longer
  call performance.now.
- `tests/fixtures/expected-final-state-seed-42.json` - hand-checked
  snapshot of the canonical trace replay with seed=42. Pinned in
  git; future PRs that change a system update the fixture or fail
  the test.
- `tests/fixtures/_regen-replay-snapshot.ts` - regen helper. Runs
  the same buildSnapshot routine as the test and writes the JSON.
- `tests/replay-snapshot.test.ts` - 4 tests. Live replay deep-equals
  the fixture; fixture metadata intact; eventsApplied = 20; live
  replay reproducible across two runs.
- `tests/determinism-smoke.test.ts` - 7 tests. Two HeadlessTickers
  with same seed run a 5-entity pursuit scenario for 200 ticks and
  produce byte-identical resource snapshots (TimeResource, entropy,
  transforms, health, DeathLog). Per-tick reproducibility verified
  at 20 sample-points. Different seeds produce same outcome
  (entropy-blind for these systems).

### Tests

574 / 574 pass (548 baseline + 26 new). Breakdown of new tests:
- 7 zone-event determinism
- 8 no-nondeterminism tripwire
- 4 replay-snapshot
- 7 determinism-smoke

### Open / deferred

- src/director/snapshot-recovery.ts still reads performance.now() in
  `applySnapshot`. That code is OUT of the per-tick loop (one-shot
  recovery boot path) so it does not affect replay determinism.
  Wired through the whitelist in tests/no-nondeterminism.test.ts.
- src/director/ai/plugin-context.ts uses Date.now as the default
  plugin clock. Plugins are async + opt-in + run on consumer
  timers, NOT the world tick. Whitelisted.
- The HMAC-signed fuzzer (Phase E4) is unchanged. Its protocol-level
  randomness comes from the seeded entropy resource introduced in
  0.17.0.

## 0.17.0 - 2026-05-08

**Deterministic ECS via seeded RNG** (Phase E3, test infrastructure
hardening). The engine no longer calls `Math.random()` from `src/` -
every random draw routes through a seeded PRNG resource so trace
replays, save-state restoration, and network-sync scenarios all
produce identical output for the same seed. Closes the determinism
gap that made the trace-replay harness (Phase E2) unable to assert
exact particle / VFX state across runs.

### Why

`Math.random()` is non-reproducible across runs and across V8 builds.
Any test that asserts on a value derived from RNG was either flaky
(if the assertion was tight) or trivially passing (if loosened to a
range). With the seeded resource, the same seed produces the same
stream byte-for-byte, so trace replay can diff exact world state.

### Added

- `src/runtime/entropy.ts` - `Entropy` class implementing `IEntropy`
  via inlined mulberry32 (200-byte public-domain PRNG, no deps).
  Surface: `random()` / `int(min,max)` / `pick(arr)` / `getState()` /
  `setState(s)` / `reseed(seed)`.
- `RESOURCE_ENTROPY` resource key (`'loom.entropy'`).
- `DEFAULT_ENTROPY_SEED = 0x9e3779b9` (golden-ratio fraction; stable
  default seed used by `Engine.create` when consumer omits it).
- `Engine.create({ entropySeed })` wires the resource on every fresh
  engine instance. Override the seed per-character or per-run for
  save-game replays.

### Changed

- `src/systems/particle-emitter-system.ts` - the only `src/` site
  that called `Math.random()` (cone direction sampling at line 58 +
  60, particle speed at line 142). All three now route through the
  world's `RESOURCE_ENTROPY` resource. A module-level fallback
  Entropy keeps bare-bones `World` instances (without `Engine.create`)
  working without throwing.
- `LOOM_ENGINE_VERSION` 0.16.0 -> 0.17.0. Smoke + webgl2 version
  pinning tests bumped accordingly.

### Tests

540 / 540 pass (525 baseline + 15 new entropy tests). Coverage:

- Same seed produces same sequence (1000-call equality across two
  fresh streams).
- Different seeds diverge within 4 calls.
- Output range: [0, 1) verified across 10000 draws.
- `getState()`/`setState()` round-trips - the next sample after
  restore matches the next sample before restore.
- `reseed()` resets the stream.
- `int()` honours inclusive bounds + integer contract; throws on
  inverted range; `int(n, n)` always returns n.
- `pick()` covers all elements of a 4-element array within 4000 draws
  (chi-squared sanity); throws on empty input.
- NaN seed coerces deterministically (no crash, two NaN-seeded
  streams agree); seed 0 produces a usable stream.
- `RESOURCE_ENTROPY` and `DEFAULT_ENTROPY_SEED` constants pinned -
  renaming or bumping is a breaking change for consumers.

### Open / deferred

- `crypto.getRandomValues` not used - mulberry32 is fast and
  reproducible but NOT cryptographic. Authoritative server-side dice
  rolls still use Python's `random.SystemRandom` on the backend.
- VFX systems other than the particle emitter currently have no RNG
  draws. If future systems add one (mob AI tie-breakers, projectile
  spread, audio-stinger jitter), they MUST go through `IEntropy`.
  The audit comment in `entropy.ts` is the tripwire.

## 0.16.0 - 2026-05-08

**Visual boss rendering primitives** (Phase 18.1, engine side). Engine
surface for the renderer-agnostic boss entity per
[LOOM-BOSS-RENDER-SPEC.md](LOOM-BOSS-RENDER-SPEC.md). Closes the loop
opened by Phase 16 (zone protocol fanout) and Phase 17 (zone audio
cues): renderers can now poll a typed boss entity each frame instead
of parsing SSE envelopes themselves. v1 supports at most one active
boss per zone (matches Phase 16 spec).

### Added

- `ZoneBossEntity` shape: `{boss_id, name, type, hp_max, hp_current,
  dmg, x, y, knot_flavor, spawned_at_ms, last_tick_ms, recent_hits}`.
  recent_hits is a bounded ring of `RECENT_HITS_RING_SIZE = 32`
  entries for floating-damage-number renderers.
- `ZoneBossEntityResource` (per-zone Map; null entry means no active
  boss). `RESOURCE_ZONE_BOSS_ENTITY` key + `createZoneBossEntityResource()`
  factory.
- `buildEntityFromSpawn(env)` helper supporting both `zone.boss.spawn`
  and `zone.snapshot` envelopes (the latter when `data.active_boss` is
  non-null).
- `applyTick(entity, env)` helper; mutates HP + position + appends
  recent_hits (capped at RECENT_HITS_RING_SIZE).
- `ZoneBossEntitySystem` (PHASE_LOGIC, runs after ZoneEventSystem)
  with per-zone `lastProcessedEventId` cursor strategy. Reads
  `ZoneEventLog`, applies new boss events to the entity resource.
  Tolerates missing log / entity resources (no-op).

### Tests

514 / 514 pass (487 baseline + 17 new resource tests + 12 new system
tests). Zero v1 / Phase 16 / Phase 17 regressions. Coverage:

- Resource: factory shape, byZone Map isolation per zone, null-spawn-
  null lifecycle, buildEntityFromSpawn maps all 12 fields, applyTick
  updates HP+pos+appends, applyTick caps recent_hits at ring size,
  buildEntityFromSpawn supports zone.snapshot's active_boss path.
- System: spawn populates entity in correct zone, tick updates HP+pos+
  appends hit, mismatched boss_id on tick is ignored, end clears entity
  to null when boss_id matches, end with mismatched boss_id leaves
  active boss intact, snapshot with active_boss replaces wholesale,
  snapshot with null active_boss clears entity, recent_hits ring caps
  at RECENT_HITS_RING_SIZE under hit-storm, multi-zone isolation,
  cursor advances per-zone preventing double-apply, cursor is per-zone
  not global, tolerates missing log / entity resources.

### Changed

- `LOOM_ENGINE_VERSION` 0.15.0 -> 0.16.0. Smoke + webgl2 version
  pinning tests bumped accordingly.

### Open / deferred

- Multi-boss per zone (v1 supports one). Deferred per spec §1.2.
- TWT-side renderer (Three.js mesh + DOM HUD): in flight on docker
  repo; ships separately to week-19-visual.

## 0.15.0 - 2026-05-08

**Audio engine: positional 3D + asset loader + cue catalog + music
director + zone-event integration shell** (Phase 17.1 + 17.2 + 17.3).
Engine surface for the audio subsystem locked at
[LOOM-AUDIO-SPEC.md](LOOM-AUDIO-SPEC.md). Phase 5 AudioBus mixer
remains untouched and locked; consumers who do not opt into the new
surfaces see identical behavior to 0.14.0.

### Why

Phase 16 made multiplayer Director events shared across peers in a
zone. Phase 17 makes those events audible: the boss spawns at (x, y),
every peer hears the spawn from the correct direction relative to
their listener pose, music crossfades to combat, and per-peer
footsteps sell the other player's presence. The Director is no
longer just visible - it's spatial and reactive.

### Added

- **Spatializer + AudioListener** (Track A, §3 of spec):
  - `SpatialAudioBus` composes the existing AudioBus, adds a `'spatial'`
    sub-bus (priority 'ambient', VE-budget gated), and routes per-source
    Web Audio `PannerNode`s into it.
  - `playPositional(buffer, opts)` returns a `SpatialSourceHandle` with
    `stop()`, `setPosition(x, y, z?)`, `fadeOut(durMs)`, `isPlaying()`.
    Reuses the PannerNode for `setPosition` (no realloc on movement).
  - `playPositionalTone(freq, durMs, opts)` for code-only demos.
  - `AudioListenerPose` / `AudioListenerResource` + `RESOURCE_AUDIO_LISTENER`
    + `createAudioListenerResource()` factory + default forward and up
    vectors.
  - `SpatialAudioSystem` (PHASE_RENDER, AFTER camera/transform sync)
    pushes the local character's transform into the listener pose each
    frame. Tolerates missing local character (no-op).
  - `spatialDistance(...)` pure helper for distance math.

- **Asset loader + cue catalog + music director** (Track B, §4):
  - `AudioAssetCache` - in-memory `Map<string, AudioBuffer>` with
    `get/has/set/drop/clear/list`. Re-loading the same name overwrites.
  - `AudioAssetLoader.create(audioBus, cache)` - `load(url, name?)` does
    fetch + `decodeAudioData` + cache write. Default name is URL
    basename without extension. `preload(manifest)` rejects on first
    failure. `inflightCount()` for "still loading" UI gates. Failure
    does NOT pollute cache.
  - `CueCatalog` - named cue events with predefined wiring.
    `register(name, def)`, `play(name, opts) -> SpatialSourceHandle | null`,
    `stopAll(name)`. Spatial cues route through `SpatialAudioBus`,
    non-spatial through `audioBus.playOneShot`. Cooldown enforced via
    per-cue last-play timestamp. Defaults merging.
  - `MusicDirector` - `playMusic(name, fadeInMs)`, `stopMusic(fadeOutMs)`,
    `crossfadeMusic(name, fadeMs)`, `currentMusic()`. Routes through
    `audioBus.input('music')`. `linearRampToValueAtTime` envelopes;
    `setTimeout` resolves the fade-out promise after the ramp completes.

- **Zone-event audio integration shell** (Track C engine side, §5):
  - `ZoneAudioSystem` (PHASE_RENDER, AFTER ZoneEventSystem) drains
    `ZoneEventLog.recent` for the local zone and dispatches each event
    to a registered mapping handler. `registerMapping(mapping)` /
    `unregisterMapping(eventType)`. Engine ships zero mappings;
    consumers (e.g. TWT) register their own (boss_spawn cue, knot
    music crossfade, etc.).
  - `ZoneAudioMapping` + `ZoneCuePlay` + `ZoneAudioContext` types.

### Changed

- `LOOM_ENGINE_VERSION` constant in `src/index.ts` now reads `'0.15.0'`
  (was stale at `'0.13.0'` since Phase 16 - smoke + webgl2 version
  pinning tests updated to match).
- `src/index.ts` re-export blocks expanded with three new audio
  sections: spatializer + listener (Track A), assets/cues/music
  (Track B), zone-event integration (Track C).

### Tests

487 / 487 pass (252 baseline + 57 zone + 62 plugin + 116 audio across
Tracks A/B + the ZoneAudioSystem suite). Zero regressions on Phase 5,
Phase 16, or anything earlier. Coverage:

- Spatializer: PannerNode wiring, positionXYZ assignment, connect chain,
  setPosition reuse (no realloc), fade-out promise resolution, handle
  idempotent stop, null on suspended context, null on budget mute,
  distance model + ref/max distance + rolloffFactor passthrough.
- Audio listener: factory shape, lastUpdateFrame tracking, default
  vectors, pose mutation.
- SpatialAudioSystem: phase ordering, pose pushed exactly once per
  tick, no-op on null local character, multi-tick lastUpdateFrame.
- Falloff math: zero distance, beyond max, NaN guards.
- Asset cache: get/has/set/drop/clear/list, name collision overwrite.
- Asset loader: load resolves with AudioBuffer (mock), preload reject
  on first failure, success path inserts all, inflightCount tracks,
  name override, failure no cache pollution.
- Cue catalog: register/unregister/has/list, spatial vs non-spatial
  routing, cooldown enforcement, defaults merging, missing-asset null,
  unregistered-cue null, register overwrite.
- Cue stopAll: handle invalidation per cue, isolation from other cues,
  no-op on empty.
- Music director: playMusic resets prior, stopMusic resolves after fade,
  crossfade transitions both gains, currentMusic getter, missing-asset
  no-op.
- ZoneAudioSystem: registerMapping wiring, dispatch on event drain,
  missing mapping silent skip, missing cue catalog silent skip,
  multiple mappings dispatch in registration order.

### Spec ambiguities resolved during implementation

- Spatial source `onended` now triggers handle cleanup so naturally-
  ended buffers don't leak nodes.
- `SPATIAL_BUS_NAME = 'spatial'` exported as a named constant so
  consumers don't depend on the literal string.
- `SpatialAudioSystem.setLocalCharacterEntity(entity)` (engine works
  in entity ids; consumer translates from character_id at the app
  layer - same pattern as `PeerPool.setLocalCharacterId`).
- `register()` mid-dispatch in CueCatalog: registry snapshot at
  dispatch start so newly-registered cues fire on the next dispatch.
- `dispose()` and logger errors isolated the same way hook errors are
  (carried over from Phase 16 plugin SPI pattern).
- Music `fadeIn=0` skips the ramp entirely (no zero-duration ramp).
- AudioAssetLoader name basename strips both query string and fragment.

### Open / deferred

- TWT consumer mappings + 9 synthesized demo cues + bundle integration
  (Track C TWT side): in flight on the docker repo; ships separately
  via week-19-visual.
- Stock CC0 audio replacing synthesized cues: deferred to Phase 17.5
  follow-up. The catalog API is asset-agnostic so the swap is mechanical.
- Streaming music tracks: deferred per spec §8.2. AudioBuffer-only v1.
- Custom JS spatialization: deferred per spec §8.3. PannerNode-only v1.
- Listener rotation: deferred per spec §8.4. Fixed forward+up v1.

## 0.14.0 - 2026-05-08

**Director Protocol v2: zone-scoped events + AI plugin SPI** (Phase
16.1 + 16.2). Engine surface for the v2 protocol locked at
[LOOM-DIRECTOR-PROTOCOL-V2.md](LOOM-DIRECTOR-PROTOCOL-V2.md). v1 (Phase
6) remains untouched and locked; consumers who do not opt into v2 see
identical behavior to 0.13.0.

### Why

v1 gave each Founder a private Loom-voice in their combat loop. v2
lets the Loom address an entire zone - when one player witnesses a
boss spawn, every player in that zone witnesses it together. The
Director is also no longer one hardcoded LLM flow: an AI plugin SPI
under the new `@sadhaka/loom-engine/server` entry point lets engine
consumers wire any backend (Anthropic, OpenAI, local model,
deterministic state machine) by implementing `IAIPlugin`. Browser
bundle stays LLM-free; plugins run server-side only.

### Added

- **Zone-scoped event surface** (Track A, §3 + §4 of spec):
  - `ZoneEventEnvelope<T>` + 7 typed events: `zone.boss.spawn`,
    `zone.boss.tick`, `zone.boss.end`, `zone.narrator`, `zone.knot`,
    `zone.state`, `zone.snapshot`. Per-zone monotonic event ids.
  - `IZoneEventBridge` abstraction; concrete `MockZoneBridge` (tests +
    offline) and `SSEZoneBridge` (multiplexes onto an existing
    presence EventSource per spec §2.1 - no second connection).
  - `ZoneEventSystem` runs PHASE_INPUT after `DirectorSystem` +
    `PeerPresenceSystem`. Local-zone filter: foreign-zone events are
    logged for observability but not applied (spec §4.3).
  - `ZoneEventLog` ring buffer + `DirectorZoneStateResource` (per-zone
    KV store, mutated by `zone.state` and `zone.snapshot`).

- **AI plugin SPI** under `@sadhaka/loom-engine/server` (Track B, §5):
  - `IAIPlugin` interface with 5 lifecycle hooks (`onTick`,
    `onPeerJoin`, `onPeerLeave`, `onZoneEnter`, `onPlayerAction`).
    Hooks return `EmittedEvents` ({ characterEvents?, zoneEvents? }).
  - `AIPluginRegistry` with priority-ordered dispatch and
    error-isolation guarantee: a plugin throwing in one hook drops
    only that plugin's contribution for that dispatch; other plugins
    continue, dispatch never throws to caller.
  - `MockAIPlugin` for deterministic synthetic events in tests +
    offline demo.
  - `MapPluginStorage` + `ConsolePluginLogger` reference impls of the
    storage / logger SPI surfaces.
  - New `package.json` exports field entry: `./server` -> the SPI
    bundle. Browser-bundle consumers (`@sadhaka/loom-engine`) never
    pull this in.

### Changed

- `src/director/index.ts` is now organized into a v1 block and a v2
  block, both exported at the package root for ergonomic single-import
  consumers. v1 names unchanged.
- `src/index.ts` re-exports the v2 zone surface alongside v1 so
  consumers wiring `ZoneEventSystem`, `MockZoneBridge`, etc. import
  from the package root just like v1 systems.

### Tests

371 / 371 pass (252 baseline + 57 new zone tests + 62 new AI plugin
tests). Zero v1 regressions. Coverage:

- Zone envelope round-trip for all 7 types; malformed-input rejection;
  priority class lookup; JSON parser nullability.
- Mock zone bridge: enqueue/poll, snapshot recovery, local-zone filter.
- Zone system: spawn/tick/end lifecycle, multi-zone fanout, PHASE_INPUT
  ordering vs v1 DirectorSystem, ring buffer caps, no-op tolerance
  when bridge absent, per-zone state isolation.
- AI plugin registry: register/unregister/list/get; dispatch order;
  merged EmittedEvents; snapshot-during-dispatch (newly-registered
  plugins fire on next dispatch).
- Error isolation: sync throw, async reject, partial-hook failure,
  all-fail, hostile logger fallback to console, dispose() throws,
  earlier-events preserved on later-plugin failure.
- Mock AI plugin: script determinism, multi-instance via name
  override, priority override, sparse-script gaps.
- Plugin context: storage round-trip, namespace isolation,
  clearPlugin, console logger tagging, circular-meta resilience.

### Spec ambiguities resolved during implementation

- Equal-priority plugins fire in registration order (insertion-sort
  preserves it).
- `register()` mid-dispatch: registry snapshot at dispatch start;
  newly-registered plugins fire on next dispatch.
- Empty-array `EmittedEvents` fields stay undefined in the merged
  result (no allocation churn).
- `dispose()` errors are isolated the same way hook errors are; an
  unregister never throws to the caller.
- Logger throwing while logging a hook failure falls back to console
  so dispatch never crashes.

### Open / deferred

- Browser-side plugins (small local models, WASM stubs) deferred per
  spec §8.4. Server-side only in v2.
- Cross-zone / world events deferred per spec §8.5.
- Zone event throughput perf-bench scenario: deferred. Existing
  scenario #4 (SSE event drain) in `tools/perf-suite.ts` covers
  Director-bridge throughput; a sibling MockZoneBridge scenario
  would be a near-duplicate. Will add if profiling reveals a
  different bottleneck on zone fanout.

## 0.13.0 - 2026-05-08

**Multiplayer presence layer** (Phase 15.1, client-side). Engine-side
primitives for showing other players in real time on the same world.
Pluggable transport (works with SSE / WebSocket / WebRTC), per-peer
linear interpolation between known positions, and a render system
that draws peers with name labels above each sprite. No CRDT;
position-only state. Shared state beyond position is deferred until
there's a concrete need.

### Why

The Loom-survivor + plaza experiences both want "see who else is
here" without the implementation cost of a fully concurrent shared
world. Position alone covers the social-presence feeling; the
server is authoritative on conflicts (last-write-wins). The wire
protocol mirrors Director's SSE shape so the same backend tooling
applies, and the bridge interface is small enough to swap to
WebSocket or WebRTC without engine changes.

### Added

- `IMultiplayerBridge` (`src/network/multiplayer-bridge.ts`) - five
  methods (`connect` / `disconnect` / `status` / `pollMessages` /
  `broadcastPosition` plus `stats`). All transports implement this.
- `SSEMultiplayerBridge` (`src/network/sse-multiplayer-bridge.ts`) -
  EventSource subscription paired with a fetch POST for outbound
  position frames. Browser-only; throws in Node.
- `MockMultiplayerBridge` (`src/network/mock-multiplayer-bridge.ts`) -
  in-process bridge for tests + offline demos. `enqueueIncoming()`
  simulates server pushes; `getSentBroadcasts()` captures local
  sends so tests can assert cadence.
- `PeerPool` (`src/network/peer-pool.ts`) - tracks known peers and
  their last two known positions. `forEachRendered(nowMs, frame, fn)`
  iterates with the per-peer interpolated position computed as
  `lerp(prev, current, clamp01((now - prevTs) / (curTs - prevTs)))`.
  Self-filter via `setLocalCharacterId()`.
- `PeerSpritePool` (`src/components/peer-sprite.ts`) - per-peer
  rendering hints (atlas, frame, tint) keyed by `character_id`.
  `setOverride()` for cosmetic / class differentiation; otherwise
  the default entry from the constructor is used.
- `PeerPresenceSystem` (`src/systems/peer-presence-system.ts`) -
  drains the bridge each tick (`PHASE_INPUT`) and routes `update` /
  `depart` / `snapshot` messages to the right `PeerPool` method.
- `PeerRenderSystem` (same file) - draws each peer at the
  interpolated position with an optional name label above
  (`PHASE_RENDER`).
- Wire protocol shared with the server-side Track B: SSE event
  types `presence.update` / `presence.depart` / `presence.snapshot`,
  client `POST /presence/move` rate-limited to 10 Hz
  (`BROADCAST_HZ`). Documented in the README's Multiplayer section.
- `demo/plaza-multiplayer/` - extends the plaza-mini demo with three
  synthetic peers driven by a `MockMultiplayerBridge`. Local player
  walks via WASD; peers wander randomly. Stats overlay shows bridge
  stats + peer count live.

### Tests

Adds `tests/multiplayer.test.ts` (23 cases): pool interpolation
(midpoint, saturate-above, clamp-below), prev/current slide on
update, out-of-order drop, self-filter, snapshot replaces roster,
mock bridge enqueue + drain + rate-limit (100 calls in 1 simulated
second admit at most `BROADCAST_HZ`), end-to-end snapshot / update /
depart through `PeerPresenceSystem`, render-system draw counts +
name-label gating + per-peer override. 252 tests total (229 + 23);
all green.

### Compat

Backwards-compatible: nothing in 0.12 changed. The new modules are
additive. Engine consumers who don't use the multiplayer surface
pay zero runtime cost (tree-shakes out).

## 0.12.0 - 2026-05-08

**WebGL2 instanced sprite batcher backend** (Phase 14.1). Lifts the
Canvas2D ~2k-sprite ceiling to thousands+ via instanced rendering
with atlas-grouped batching. Canvas2D remains the default and
unchanged.

### Why

Canvas2D's `drawImage` is one driver call per sprite. At a few
thousand sprites per frame the device-side cost dominates frame
time. WebGL2's `drawArraysInstanced` issues one driver call for an
entire atlas's worth of sprites, with per-instance data uploaded
once per flush in a single `bufferSubData`. The `IGraphicsDevice`
abstraction was already in place from Phase 1 (per the Babylon.js
ThinEngine split documented in `PRIOR-ART.md`); this release fills
in the second backend.

### Added

- `WebGL2Device` (`src/renderer/webgl2-device.ts`) implementing
  `IGraphicsDevice` against a WebGL2 context. Same call-site
  contract as `Canvas2DDevice`; consumers swap backends without
  touching draw code.
- `SpriteBatcher` (`src/renderer/sprite-batcher.ts`) - per-frame
  CPU-side accumulator. Groups submitted instances by
  `(atlas, blendMode)` key; flushes on key change and at end of
  frame. 12 floats per instance: origin, size, uv-rect, tint.
- `TextureAtlas` (`src/renderer/texture-atlas.ts`) - GL texture
  wrapper plus pre-computed UV rect + frame size lookup tables.
  Uses `UNPACK_FLIP_Y_WEBGL` so atlas frame coords map to UVs
  without extra math at draw time.
- Inlined GLSL ES 3.00 shader sources
  (`src/renderer/shaders/sprite-shader-source.ts`) for the
  instanced quad path. Vertex shader maps the static unit quad onto
  per-instance origin + size; fragment shader samples the atlas and
  multiplies by tint.
- Backend registry on `Engine`: `registerBackend(name, factory)` +
  `isBackendRegistered(name)`. Devices self-register at module
  load. `Engine.create({ backend: 'webgl2' })` looks up the
  factory; throws a diagnostic error if the device module was
  never imported.
- `EngineOptions.backend?: 'canvas2d' | 'webgl2'` (defaults to
  `'canvas2d'`). New `EngineOptions.device?: IGraphicsDevice`
  injection seam for shared-context scenarios and tree-shaking.
- 21 new tests in `tests/webgl2-device.test.ts` covering backend
  registration, atlas UV computation, batcher flush/grow,
  drawArraysInstanced batching, atlas-swap flush behavior,
  blend-mode swap, submission-order preservation, particle
  additive blend, context-loss no-op, and dispose teardown.

### Changed

- `LOOM_ENGINE_VERSION` constant: `0.11.0` -> `0.12.0`.
- `package.json` `version`: `0.11.0` -> `0.12.0`.
- `package.json` `test` script appends `tests/webgl2-device.test.ts`.
- `src/index.ts` re-exports `WebGL2Device`, `TextureAtlas`,
  `SpriteBatcher`, `FLOATS_PER_INSTANCE`, `BlendMode`,
  `FlushHandler`, `SPRITE_VERT_SRC`, `SPRITE_FRAG_SRC`,
  `UNIT_QUAD_VERTICES`, `registerBackend`, `isBackendRegistered`,
  and `DeviceFactory`.
- `engine.ts` does **not** statically import `WebGL2Device`. The
  default (Canvas2D-only) bundle stays the same size as 0.11.0;
  WebGL2 code only enters the graph when a consumer imports
  `WebGL2Device`.

### Backwards compatibility

Fully compatible. `Engine.create({ canvas })` produces the same
`Canvas2DDevice` instance it did in 0.11.0. The 208 baseline tests
all stay green. No existing call site needs to change.

### Known limits

- `drawText` is implemented via per-string baked textures with a
  bounded LRU cache (256 entries). Fine for typical UI labels;
  text-heavy scenes pay one texture upload per unique label.
  Phase 14.4 will revisit with a glyph atlas if needed.
- Particle disc texture is a single 64x64 RGBA upload; the
  Canvas2DDevice's per-color tinting hack is replaced by proper
  per-instance tint in the fragment shader (visually closer to
  Phase 4 spec).
- Performance numbers (synthetic 5k+ sprite bench, frame-time
  histograms vs Canvas2D) are deferred to Phase 14.3.

## 0.11.0 - 2026-05-08

**License pivot to BUSL 1.1** (Phase 12.4). The engine moves from MIT
to the [Business Source License 1.1](./LICENSE) starting with this
version. 0.10.0 (the only previously-published release) remains
permanently MIT for backwards compatibility; pinned consumers are
unaffected.

### License terms

- **Free** for use below USD $1,000,000 annual gross revenue from any
  product, game, or service that incorporates the engine.
- **Commercial license** required above the threshold. Standard 5%
  royalty on excess revenue; lump-sum and equity-for-license
  alternatives negotiable. See
  [COMMERCIAL_LICENSE_TERMS.md](./COMMERCIAL_LICENSE_TERMS.md).
- **Auto-converts to Apache 2.0** on **2030-05-08** (4-year window per
  BUSL spec).
- **Contact**: `licensor@theworldtable.ai`

### Why

The engine is novel work product (see PRIOR-ART.md for the patent
strategy scope). MIT was chosen for the 0.10.0 productization
milestone to minimize friction for early evaluators; 0.11.0 captures
commercial value as the engine matures toward broader adoption while
keeping the threshold high enough that hobbyists, students, indies,
and prototypes pay nothing.

### Changed

- `LICENSE` replaced with BUSL 1.1 (parameters block + standard
  terms).
- `package.json` `license` field: `MIT` -> `BUSL-1.1` (recognized
  SPDX identifier).
- `package.json` `version`: `0.10.1` -> `0.11.0`.
- `LOOM_ENGINE_VERSION` constant in `src/index.ts`: `0.10.1` ->
  `0.11.0`.
- `README.md` License section rewritten with revenue threshold,
  conversion date, and commercial-contact details.

### Added

- `COMMERCIAL_LICENSE_TERMS.md` outlining standard royalty terms,
  negotiable alternatives (lump-sum, equity-for-license, OSS waivers),
  and the 0.10.0 MIT grandfathering clause.

### Carried forward from 0.10.1 polish (12.3, never published to npm)

- `exports` map in `package.json` includes `./package.json` for tools
  that introspect via `require('@sadhaka/loom-engine/package.json')`.
- Publish workflow uses `npm publish --access public --provenance`
  for free supply-chain attestation.
- README documents the `withCredentials: true` default in
  `SSEDirectorBridge` + `fetchImpl` override hooks for cross-origin
  consumers.

## 0.10.1 - 2026-05-08 (NEVER PUBLISHED)

**Audit polish** (Phase 12.3) - patch release closing the five
0.10.1-scoped findings from the 12.2 supply-chain audit. Source is
otherwise unchanged from 0.10.0; no public-API surface change. See
[`SECURITY-AUDIT-0.10.0.md`](./SECURITY-AUDIT-0.10.0.md) for the full
audit report.

### Fixed

- **L-01.** `LOOM_ENGINE_VERSION` constant in
  [`src/index.ts`](./src/index.ts) now agrees with `package.json`.
  The 0.10.0 release shipped with the lingering `-perf-9-1` dev
  suffix on the constant; consumers running
  `engine.LOOM_ENGINE_VERSION`-based diagnostics saw the drift.
  Manual pre-bump checklist for now: when bumping `package.json`,
  bump the constant in the same commit (gen-version automation
  deferred to keep this patch small).
- **L-04.** [`package.json`](./package.json) `exports` map now
  exposes `./package.json`. Consumers can do
  `require('@sadhaka/loom-engine/package.json')` for build
  introspection / version checks; previously this errored with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

### Added

- **L-02.** `README.md` Configuration section documents the
  `withCredentials: true` / `credentials: 'include'` defaults on
  `SSEDirectorBridge` and `SnapshotRecoveryHelper`, with a worked
  example showing the `eventSourceFactory` / `fetchImpl` overrides
  for credential-free deployments. Override seams already existed;
  0.10.1 documents them.

### Changed

- **L-05.** [`.github/workflows/npm-publish.yml`](./.github/workflows/npm-publish.yml)
  publish step now passes `--provenance`. The `id-token: write`
  permission was already granted; only the flag was missing. From
  this release on, the npm package page shows a build-provenance
  attestation linking the tarball to the exact GitHub workflow run
  that produced it.
- **L-07.** Tag flow exercised. The historical 0.10.0 commit
  (`b497d6d`) is tagged `v0.10.0` retroactively (workflow detects
  same-version-already-published and skips publish - documented
  expected behaviour). 0.10.1 is the first version published via the
  CI tag-trigger path instead of a manual `npm publish`.

### Deferred to 0.11.0

L-03 (snapshot envelope validation), L-06 (npm trusted-publishing
migration to drop the long-lived `NPM_TOKEN`), and I-01 (`#private`
field migration) are minor-bump material per the audit and ship in
the next pre-1.0 hardening pass.

## 0.10.0 - 2026-05-08

**Productization milestone** (Phase 11B.3) - first public npm
release under MIT. Package is `@sadhaka/loom-engine`. Pre-alpha:
no semver stability guarantee until 1.0.

This entry also backfills the changelog gap between 0.5.0-phase5
and 0.10.0 — the work shipped in commits but did not get its own
versioned entries.

### Changed

- License switched from `UNLICENSED` (private) to **MIT**. Copyright
  Misha Mitiev 2026. See [LICENSE](./LICENSE).
- Package name renamed from `@theworldtable/loom-engine` (private,
  internal) to `@sadhaka/loom-engine` (public, scoped).
- `package.json`: dropped `private: true`, added `files`, `keywords`,
  `repository`, `homepage`, `bugs`, `prepublishOnly`. Version
  suffix `-perf-9-1` dropped — productization releases ship clean
  semver.
- `.npmignore` added; only `dist/`, `LICENSE`, `README.md`, and
  `package.json` ship in the tarball.
- `README.md`: Install + License + Publishing sections, updated
  status table, refreshed test coverage breakdown.

### Added (productization scaffolding)

- [`.github/workflows/npm-publish.yml`](./.github/workflows/npm-publish.yml)
  - tag-triggered publish (`v*` on `main`). Runs tests + build,
  then `npm publish --access public` with `NPM_TOKEN` secret.

### Added (backfill since 0.5.0-phase5)

The following landed between 0.5.0-phase5 and this release:

- **Phase 6** - Director-bridge: SSE event-stream subscription with
  `eventSourceFactory` hook for testability, scene-state derivation
  from event projections, `SnapshotRecoveryHelper` for reconnect
  resync.
- **Phase 7** - Survivor combat layer ported onto Loom Engine:
  projectile pool, hit resolution, damage application, knockback.
- **Phase 8** - 2.5D ARPG hub-and-spoke per LOOM-CLASS-SYSTEM-SPEC:
  plaza narrator support, knot-agnostic spawn, encounter scheduling.
- **Phase 8.4** - mobile + touch input: virtual D-pad, tap-to-walk,
  multi-touch arbitration, pointer-coalescing for canvas DPR math.
- **Phase 9.1** - perf pass: alloc-churn fixes across hot paths
  (transform iteration, particle simulation, sprite sort buffer),
  bench harness in `tools/`.
- **Phase 9.3** - TypeDoc public-API site at
  [loom-engine.pages.dev](https://loom-engine.pages.dev/),
  auto-deployed from `gh-pages` branch via the docs workflow.
- **Phase 11A.2** - docs hosting migrated from GitHub Pages
  (unavailable on free plan for private repos) to Cloudflare Pages.

### Tests

- 208 / 208 pass via `tsx --test` on Node 24. Twelve test files
  covering smoke, world, asset-loader, animation, vfx,
  audio-input, director, combat, projectile, arpg,
  snapshot-recovery, touch-input.

### Manual final-gate to publish

`npm login` (account `sadhaka`) → `npm publish --dry-run` to verify
tarball contents → `npm publish --access public`. The `--access public`
flag is required because npm scopes default to private. From this
release forward, push a `v0.10.0`-style tag on `main` and the
GitHub Actions workflow handles publish automatically.

## 0.5.0-phase5 - 2026-05-07

[Spec phase 5](../docker/LOOM-ENGINE-SPEC.md) - audio bus + input
system. Commit
[0322221](https://github.com/sadhaka/loom-engine/commit/0322221).

### Added

- `AudioBus` (`src/audio/audio-bus.ts`) - Web Audio mixer with
  master GainNode, four default sub-buses (sfx + voice =
  essential, music + ui = ambient), lazy unlock for browser
  autoplay-policy, `setAudioBudget(0..1)` priority-tier ducking,
  convenience `playOneShot(bus, buffer)` and `playTone(bus, freq,
  durationMs)` methods.
- `InputManager` (`src/input/input-manager.ts`) - unified DOM
  listener for keyboard / mouse / touch / wheel. Frame-coherent
  snapshot model: `keysPressedThisFrame` /
  `pointerPressedThisFrame` / `wheelDeltaThisFrame` accumulate
  between calls to `beginFrame()`; held / position / buttons stay
  continuous. Canvas DPR baked into pointer math.
  `injectKey*` / `injectPointer*` helpers for headless tests.
- `InputSystem` (`src/systems/input-system.ts`) - PHASE_INPUT
  promoter that calls `manager.beginFrame()` and writes
  `manager.snapshot()` into the world's `RESOURCE_INPUT` each tick.
- `VeilBudgetSystem` (`src/systems/veil-budget-system.ts`) -
  PHASE_INPUT propagator that pushes `audioBudget` to AudioBus and
  `particleBudget` to ParticlePool each tick. Closes the loop
  between Phase 4's particle budget and Phase 5's audio gating;
  Phase 6 Director-bridge mutates the budget directly.
- `VeilBudgetResource.audioBudget` field, default `1.0`.
- `Engine.audio` (nullable) and `Engine.input` properties on the
  facade. `Engine.create()` now also constructs InputManager
  (attached to canvas + window) and AudioBus (unless
  `opts.skipAudio=true` or `AudioContext` unavailable).
- Demo: arrow keys / WASD pan camera, click bursts 24 particles +
  plays a SFX chirp (also unlocks AudioContext on first click),
  hover reports the iso tile under the cursor.

### Tests

- 18 new assertions in `tests/audio-input.test.ts`. Total: 102 / 102
  pass.

## 0.4.0-phase4 - 2026-05-07

[Spec phase 4](../docker/LOOM-ENGINE-SPEC.md) - VFX framework.
Commit [fb7060c](https://github.com/sadhaka/loom-engine/commit/fb7060c).

### Added

- `ParticlePool` (`src/vfx/particle-pool.ts`) - 21 parallel
  Float32Arrays + Uint8 flags. Free-list slot recycling.
  Configurable `maxParticles` cap; `spawn()` returns -1 on budget
  exhaustion.
- `ParticleEmitterPool` (`src/components/particle-emitter.ts`) -
  per-entity emitter config (rate, particleLife, speed range, cone
  direction + half-angle, acceleration, start/end size + color,
  additive flag). `burst(e, n)` schedules a one-shot for the next
  tick.
- `ParticleEmitterSystem` (`src/systems/particle-emitter-system.ts`)
  - PHASE_LOGIC. Reads Transform + ParticleEmitter, samples a cone
  direction via two perpendicular cross products, pushes spawns
  into the shared ParticlePool.
- `ParticleSimulationSystem` (`src/systems/particle-simulation-system.ts`)
  - PHASE_PHYSICS. Walks live pool, decreases life by dt, integrates
  velocity + acceleration with semi-implicit Euler, kills expired
  particles.
- `ParticleRenderSystem` (`src/systems/particle-render-system.ts`)
  - PHASE_RENDER. Walks pool, interpolates color + size by
  life/maxLife, submits drawParticle calls.
- `IGraphicsDevice.drawParticle()` + Canvas2D impl - iso-projects
  world coords, paints a radial-gradient disc; additive=true uses
  globalCompositeOperation = 'lighter'.
- `VeilBudgetResource` (`src/resources.ts`) - particle / shader /
  event / audio budgets. Patent-defensible novelty hook from spec
  Section 3.

### Tests

- 19 new assertions in `tests/vfx.test.ts`. Total: 84 / 84 pass.

## 0.3.0-phase3 - 2026-05-07

[Spec phase 3](../docker/LOOM-ENGINE-SPEC.md) - animation system.
Commit [1331d98](https://github.com/sadhaka/loom-engine/commit/1331d98).

### Added

- `AnimationClip` type and helpers (`src/animation/animation-clip.ts`)
  - named slice of a sheet's frames with optional per-frame
  `durations_ms[]`, optional clip-fps, `loop: boolean`.
  Helpers: `synthesizeDefaultClip`, `clipDurationMs`,
  `frameInClipAt`, `manifestFrameIndex`.
- `AnimationStatePool` (`src/animation/animation-state-pool.ts`)
  - per-entity animation state. `play(e, manifest, clipName)`
  resets elapsed and starts the clip; `stop(e)` clears.
  ACTIVE / FINISHED bitflags.
- `AnimationSystem` (`src/systems/animation-system.ts`) -
  PHASE_ANIMATION. Iterates active states, advances elapsedMs by
  dt, looks up the named clip on each entity's manifest, writes
  resolved frame to SpritePool.
- `SpriteSheetManifest.clips: AnimationClip[]` field. Loader
  synthesizes a `'default'` clip for manifests that omit it
  (Phase 2 backward compat preserved).

### Changed

- Demo: deleted ad-hoc WalkCycleSystem, replaced with one
  `animations.play(knight, manifest, 'default')` + the formal
  AnimationSystem.

### Tests

- 16 new assertions in `tests/animation.test.ts`. Total: 65 / 65 pass.

## 0.2.0-phase2 - 2026-05-07

[Spec phase 2](../docker/LOOM-ENGINE-SPEC.md) - ECS World + Engine
facade. Commit
[81808fc](https://github.com/sadhaka/loom-engine/commit/81808fc).
Includes the asset-pipeline session merged in from a parallel
worktree.

### Added

- `World` class (`src/world.ts`) - ECS container. EntityAllocator +
  ResourceRegistry + per-phase system list. `addSystem(sys, phase)`
  preserves registration order within a phase. `update(dt)` walks
  phases in fixed order.
- `System` interface + 6 phase constants
  (INPUT, LOGIC, PHYSICS, ANIMATION, RENDER, POST_RENDER).
- `ResourceRegistry` + `TimeResource` + RESOURCE_TIME / _CAMERA /
  _DEVICE constants.
- `SpritePool` (`src/components/sprite.ts`) - per-entity sprite
  appearance with split rgba arrays, ACTIVE / TINTED bitflags.
- `SpriteRenderSystem` (`src/systems/sprite-render-system.ts`) -
  iterates Transform + Sprite, builds per-frame sort buffer keyed
  on iso depth (`(x+y)*1000+z`), insertion sort, submits
  `drawSprite` in back-to-front order.
- `Engine` class (`src/engine.ts`) - high-level facade.
  `Engine.create({canvas})` wires Canvas2DDevice + camera + time +
  default pools (transform, sprite, animation - the latter added
  in Phase 3). `engine.tick(now)` runs the canonical frame loop.
- Asset pipeline (parallel session merged into this commit):
  - `loadSpriteSheet(url, options)` - fetches PNG + JSON manifest,
    validates, returns `{manifest, image, atlas}` ready for
    `device.registerAtlas`
  - `computeFrameIndex(manifest, now, start)` - frame stepper
    honoring per-frame `duration_ms` with fps fallback
  - `SpriteSheetLoadError` with `kind` discriminator for fetch /
    parse / validate / decode failures
  - Placeholder asset: `assets/knight/walk.png` + `walk.json`
    (4-frame Veil-weaver knight walk cycle), `tools/gen-knight.py`
    Pillow generator

### Tests

- 14 new ECS / SpritePool / SpriteRenderSystem / Time assertions
  + 15 asset-loader assertions. Total: 49 / 49 pass.

## 0.1.0-phase1 - 2026-05-07

[Spec phase 1](../docker/LOOM-ENGINE-SPEC.md) - Canvas2D iso
renderer + ECS foundations. Commit
[e9dc58c](https://github.com/sadhaka/loom-engine/commit/e9dc58c).

### Added

- Math primitives (`src/util/math.ts`) - Vec2 / Vec3 / Rect plain
  objects, free-function helpers (clamp, lerp, smoothstep,
  approxEq, rect ops).
- Color helpers (`src/util/color.ts`) - ColorRGBA type, hex<->rgba
  conversions, knot palette constants per
  [LOOM-CLASS-SYSTEM-SPEC.md](../docker/LOOM-CLASS-SYSTEM-SPEC.md)
  Section 4.
- Typed-array utilities (`src/util/typed-arrays.ts`) - pow-2 grow
  helpers for Float32 / Int32 / Uint32 / Uint8 pools.
- `EntityAllocator` (`src/entity.ts`) - 32-bit handles
  (8-bit generation + 24-bit index), free-list recycling,
  generation-bump invalidates stale handles.
- `TransformPool` (`src/components/transform.ts`) - structure-of-
  arrays for hot data (x/y/z/rotation/scaleX/scaleY) and Int32 /
  Uint8 cold data (parent / flags). Inspired by Mike Acton CppCon
  2014 (see PRIOR-ART.md).
- `IGraphicsDevice` interface and `Canvas2DDevice` impl - iso
  projection inside the device, `drawSprite` / `drawTile` /
  `drawText` surface, atlas registration.
- `CameraView` + worldToScreen / screenToWorld / view-rect helpers.
- Standard 2:1 dimetric projection (`src/renderer/iso-projection.ts`)
  - tileToIso, worldToIso, isoToTile, isoDepthKey.
- Browser demo: 5x5 iso tile diamond + iron-red knight at world
  origin, slow Z-hover. Procedural canvases, zero asset deps.

### Tests

- 20 assertions across math, color, entity, transform, iso, camera.

## 0.0.0-spec - 2026-05-07

[Spec phase 0](../docker/LOOM-ENGINE-SPEC.md) - scaffolding. Commit
[6071518](https://github.com/sadhaka/loom-engine/commit/6071518).

### Added

- `package.json` with tsc as only dev dep, ES module exports.
- `tsconfig.json` - ES2022 target/module, strict +
  noUncheckedIndexedAccess + exactOptionalPropertyTypes,
  declaration + sourcemaps on.
- `PRIOR-ART.md` - cumulative inspirations log
  (PlayCanvas / Babylon / Pixi / three.js avoid / Cocos avoid /
  Frostbite FrameGraph / Bevy ECS / Mike Acton SoA).
- `src/index.ts` - LOOM_ENGINE_VERSION = '0.0.0-spec' stub.
- `.gitignore` - dist/, node_modules/, *.tsbuildinfo, editor cruft.

---

## Notes on coordination history

The asset-pipeline work in 0.2.0-phase2 came from a parallel session
running on a different worktree. That session shipped the
sprite-sheet loader + placeholder knight assets + 15 tests under
`tests/asset-loader.test.ts`. My 0.2.0-phase2 commit accidentally
swept up their files via `git add -A` while my own work was being
committed. A follow-up commit
[5b49e7b](https://github.com/sadhaka/loom-engine/commit/5b49e7b)
dropped a redundant test file I'd written (theirs was more
comprehensive); commit
[486cb38](https://github.com/sadhaka/loom-engine/commit/486cb38)
added the parallel session's hidden-tab tick fallback for the demo's
preview RAF throttling.

Going forward, parallel sessions should commit their own work before
mine runs `git add -A`, or each session should use explicit file
lists. This is captured in the project's coordination memory.
