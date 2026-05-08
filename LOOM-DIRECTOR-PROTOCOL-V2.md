# LOOM-DIRECTOR-PROTOCOL-V2

Zone-scoped event-stream protocol + AI Plugin SPI for the Loom Engine.
Phase 16 of the Loom Engine roadmap. Builds on top of v1 (Phase 6) which
remains locked and untouched.

Status: **v2 DRAFT 2026-05-08** - frozen contract for parallel
implementation across Tracks A (engine zone events), B (engine AI
plugin SPI), C (TWT integration). Lock anticipated after the boss-spawn
demo proves the e2e contract.

References (read-only, do not edit):
- `D:/Thailand Family/docker/LOOM-DIRECTOR-PROTOCOL.md` - v1 spec, locked 2026-05-07
- `src/director/event-envelope.ts` - v1 envelope + 11 typed events
- `src/director/director-system.ts` - v1 DirectorSystem (PHASE_INPUT)
- `src/network/multiplayer-bridge.ts` - 15.x presence transport (zone-aware)
- `src/network/peer-pool.ts` - interpolated peer state by zone

This spec extends v1 with two orthogonal additions:

1. **Zone-scoped events** - the Director emits to a zone, the server fans
   out to every peer currently in that zone.
2. **AI Plugin SPI** - server-side plugin interface; LLM choice becomes
   consumer-pluggable. TWT's hardcoded Anthropic Director becomes plugin
   #1 (a `TWTLoomPlugin` wrapper).

The v1 character-scoped stream is untouched. Existing 0.13.0 consumers
who do not opt into v2 see identical behavior to 0.13.0.

---

## Section 1 - Vision

### 1.1 Zone events

The Loom is everything. v1 gave each Founder a private Loom-voice in
their combat loop. v2 lets the Loom address an entire zone - when one
Founder witnesses a boss spawn, every Founder in that zone witnesses it
together.

Three load-bearing properties (mirroring v1):

1. **Zone is the authoritative scope.** A zone-scoped event applies to
   every peer currently in that zone. Server is the source of truth on
   "who is in zone X right now"; clients trust the fanout list.
2. **Replayable per zone.** Each zone has its own append-only log; new
   peers entering the zone receive a snapshot + tail.
3. **Transport reuses presence SSE.** Same channel as 15.x presence
   updates, multiplexed by event topic. No second EventSource per peer.

### 1.2 AI Plugin SPI

The Director is no longer one hardcoded Anthropic flow. v2 defines an
`IAIPlugin` interface; the runtime registers any number of plugins and
dispatches lifecycle hooks. Each plugin's hook returns a list of
events to emit (per-character v1 events, zone v2 events, or both).

This is what makes the engine portable:

- TWT's existing flow becomes `TWTLoomPlugin` (Anthropic + Loom prompt scaffolding).
- A different engine consumer wires OpenAI, a local model, a deterministic state machine.
- Same SPI, different plugins, identical engine.

Browser stays LLM-free. All plugins run server-side, exported under a
separate engine entry point (`@sadhaka/loom-engine/server`).

---

## Section 2 - Transport

v2 reuses the 15.x presence SSE channel. No new endpoint per peer.

### 2.1 Channel multiplex

The presence SSE stream now carries 4 message kinds:

| Kind | Source | Purpose |
|---|---|---|
| `presence.update`   | 15.x | Peer position update |
| `presence.depart`   | 15.x | Peer disconnected |
| `presence.snapshot` | 15.x | Bulk peer state on cold-connect |
| `zone.event`        | 16.x (NEW) | Director-emitted zone-scoped event |

Server-side Track C addition: when an `IAIPlugin` returns a `ZoneEvent`,
the Director's emit path:

1. Append the event to that zone's append-only log
2. Resolve current peers in that zone via the presence registry
3. Emit a `zone.event` SSE frame to each peer's already-open presence connection

### 2.2 Per-character v1 stream stays separate

The v1 endpoint `/api/v1/loom/director/events?character_id=X` is
unchanged. It carries the 11 v1 event types only. v1 clients keep
working without modification.

### 2.3 Auth

Presence channel auth (15.x) extends to zone events - same Bearer +
X-User-Id headers, same character_id query. Server-side Track C
ensures zone events fan out only to peers whose auth is current.

---

## Section 3 - Zone-event envelope

```typescript
export interface ZoneEventEnvelope<T extends ZoneEventType = ZoneEventType> {
  id: number;            // monotonic per zone (NOT global)
  ts: number;            // server emit timestamp (ms since epoch)
  type: T;
  zone_id: string;       // authoritative scope
  emitter_id: string | null;  // character_id that triggered (if any), else null (Loom-initiated)
  data: ZoneEventDataMap[T];
}

export type ZoneEvent = {
  [K in ZoneEventType]: ZoneEventEnvelope<K>;
}[ZoneEventType];
```

Differences from v1 envelope:
- `character_id` -> `zone_id` (authoritative scope changes from per-character to per-zone)
- `encounter_id` removed (zone events are not encounter-scoped; they are zone-state-scoped)
- New `emitter_id` (which character caused this, if any; null when Loom-initiated)
- `priority` field carries the same semantics as v1 §7.2

### 3.1 Type registry (v2 launch set)

| Type | Priority | Description |
|---|---|---|
| `zone.boss.spawn`  | P0 | Director spawns a boss visible to all zone peers |
| `zone.boss.tick`   | P2 | Boss state delta (HP, position) - high-frequency |
| `zone.boss.end`    | P0 | Boss death/despawn; all peers see |
| `zone.narrator`    | P1 | Director narrator line addressed to whole zone |
| `zone.knot`        | P1 | Zone-wide knot palette pulse |
| `zone.state`       | P0 | Generic zone state delta (door open, fire lit, etc.) |
| `zone.snapshot`    | P0 | Bulk state on cold-connect (analog of presence.snapshot) |

Priority drop semantics from v1 §7.2 carry over: under load, server
drops P2 first, then P1; P0 always delivered.

### 3.2 Per-event data shapes

```typescript
export interface ZoneBossSpec {
  boss_id: string;
  type: string;
  name: string;
  hp_max: number;
  hp_current: number;
  dmg: number;
  x: number;
  y: number;
  knot_flavor: string;
}

export interface ZoneBossSpawnData {
  boss: ZoneBossSpec;
  narrator_line: string | null;
}

export interface ZoneBossTickData {
  boss_id: string;
  hp_current: number;
  x: number;
  y: number;
  // Damage events since last tick - empty array if no hits.
  recent_hits: ReadonlyArray<{ from_character_id: string; amount: number; ts_ms: number }>;
}

export interface ZoneBossEndData {
  boss_id: string;
  outcome: 'killed' | 'despawned' | 'fled';
  killer_character_id: string | null;
  loot: ReadonlyArray<DropSpec>;  // reuse v1 DropSpec
  duration_ms: number;
}

export interface ZoneNarratorData {
  line: string;
  voice: NarratorVoice;  // reuse v1 NarratorVoice
  ttl_ms: number;
}

export interface ZoneKnotData {
  knot: string;
  palette: KnotPaletteHex;  // reuse v1 KnotPaletteHex
  mood: KnotMood;           // reuse v1 KnotMood
  fade_ms: number;
}

export interface ZoneStateData {
  // Free-form key/value mutation for zone state. Renderer reads
  // ZoneStateResource; gameplay systems decide what each key means.
  // The Director and the consumer agree on key naming offline.
  changes: ReadonlyArray<{ key: string; value: unknown }>;
}

export interface ZoneSnapshotData {
  // Full state of the zone at this moment. Sent to peers entering
  // the zone or recovering from a hard gap.
  active_boss: ZoneBossSpec | null;
  knot: ZoneKnotData | null;
  state: ReadonlyArray<{ key: string; value: unknown }>;
  last_event_id: number;
}
```

---

## Section 4 - Engine surface (Track A scope)

### 4.1 IZoneEventBridge

```typescript
export interface IZoneEventBridge {
  start(): void;
  stop(): void;
  status(): ZoneEventBridgeStatus;
  isConnected(): boolean;
  // Last seen id for this zone, or 0 if no events seen.
  getLastEventId(zone: string): number;
  // Drain and return all queued events since last poll.
  pollEvents(): ZoneEvent[];
  stats(): Readonly<ZoneEventBridgeStats>;
}

export type ZoneEventBridgeStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'snapshot-required'
  | 'closed';

export interface ZoneEventBridgeStats {
  eventsReceived: number;
  reconnects: number;
  outOfOrderEvents: number;
  serverDropsP1: number;
  serverDropsP2: number;
  // Per-zone last-id map snapshot (allocations cost; called rarely).
  lastEventIdByZone: ReadonlyMap<string, number>;
}
```

### 4.2 Concrete bridges

`MockZoneBridge` - in-process. `enqueueIncoming(event)` simulates
server pushes for tests + offline demo.

`SSEZoneBridge` - multiplexes onto the existing presence EventSource.
The bridge does NOT open its own EventSource. Constructor accepts a
reference to the live `EventSource` from `SSEMultiplayerBridge` (or
equivalent), and registers a listener for frames whose `event:` line
is `zone.event`. If the consumer prefers a separate connection, they
implement `IZoneEventBridge` themselves.

### 4.3 ZoneEventSystem

Runs PHASE_INPUT, AFTER `DirectorSystem` and `PeerPresenceSystem`.
Drains `IZoneEventBridge` once per tick. For each event:

| Event | Effect |
|---|---|
| `zone.boss.spawn` | Spawn boss entity in current zone (filtered: applies only if local zone matches) |
| `zone.boss.tick`  | Update boss entity HP/position |
| `zone.boss.end`   | Despawn boss entity; surface loot via ZoneEventLog |
| `zone.narrator`   | Append to NarratorEvent queue (parallel to v1's NarratorLineData) |
| `zone.knot`       | Call `KnotContextResource.beginFade` (parallel to v1's KnotContextData) |
| `zone.state`      | Mutate `ZoneStateResource` for this zone (new resource) |
| `zone.snapshot`   | Replace local ZoneStateResource for this zone wholesale |

**Local-zone filter:** the system applies events ONLY for the local
character's current zone. Events for other zones are logged but not
applied. Zone changes (player walks through portal) trigger the bridge
to resubscribe and pull a fresh `zone.snapshot`.

### 4.4 ZoneEventLog resource

Parallel to v1's `DirectorEventLog`. Per-zone ring buffer; recent events
indexable by zone id. Renderer reads from this for UI surfaces (boss HP
bar, recent loot toast, narrator banner).

```typescript
export interface ZoneEventLog {
  byZone: Map<string, {
    recent: ZoneEvent[];           // newest first, RING_SIZE = 32
    activeBossId: string | null;
    lastNarratorLine: string | null;
    lastNarratorTtlMs: number;
    eventsApplied: number;
  }>;
}
```

### 4.5 ZoneStateResource

```typescript
export interface ZoneStateResource {
  // Generic key-value store per zone. Mutated by zone.state events
  // and replaced wholesale by zone.snapshot.
  byZone: Map<string, Map<string, unknown>>;
}
```

---

## Section 5 - AI Plugin SPI (Track B scope)

### 5.1 Module location

`src/director/ai/` - all-new files. NOT browser-shipped; the engine's
default browser bundle excludes this module via the `package.json`
exports field. A separate entry point `@sadhaka/loom-engine/server`
exports the SPI for Node runtimes.

### 5.2 IAIPlugin interface

```typescript
export interface IAIPlugin {
  readonly name: string;        // unique stable id (used as registry key)
  readonly version: string;     // semver
  readonly priority: number;    // dispatch order; LOWER runs first

  // Lifecycle hooks. All return EmittedEvents. All async. Hooks
  // not needed by a plugin can be omitted (registry checks before calling).
  onTick?(ctx: PluginContext): Promise<EmittedEvents>;
  onPeerJoin?(ctx: PluginContext, peer: PeerInfo): Promise<EmittedEvents>;
  onPeerLeave?(ctx: PluginContext, peer: PeerInfo): Promise<EmittedEvents>;
  onZoneEnter?(ctx: PluginContext, peer: PeerInfo, fromZone: string | null): Promise<EmittedEvents>;
  onPlayerAction?(ctx: PluginContext, peer: PeerInfo, action: PlayerAction): Promise<EmittedEvents>;

  // Optional dispose for cleanup on shutdown.
  dispose?(): Promise<void>;
}

export interface EmittedEvents {
  // Events to append to the per-character v1 stream.
  characterEvents?: DirectorEvent[];
  // Events to append to the v2 zone stream and fan out to zone peers.
  zoneEvents?: ZoneEvent[];
}

export interface PeerInfo {
  characterId: string;
  userId: string;
  zone: string;
  x: number;
  y: number;
  name: string | null;
}

export interface PlayerAction {
  kind: 'damage' | 'interact' | 'speak' | 'use_item' | string;
  payload: Record<string, unknown>;
}

export interface PluginContext {
  // World state read-only views (server-side, drawn from game state).
  getZonePeers(zoneId: string): ReadonlyArray<PeerInfo>;
  getCharacterState(characterId: string): Readonly<CharacterState>;
  getZoneState(zoneId: string): ReadonlyMap<string, unknown>;

  // Plugin-private storage (KV per (plugin.name, key)). Survives across
  // ticks; cleared on plugin unregister.
  storage: PluginStorage;

  // Logger scoped to this plugin (logs are tagged with plugin.name).
  logger: PluginLogger;

  // Wall clock; plugins should use this for determinism in tests.
  now: () => number;
}

export interface PluginStorage {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PluginLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface CharacterState {
  // Minimal shape; engine consumers extend at their layer. Track A
  // does not require a richer shape than this.
  characterId: string;
  zone: string;
  x: number;
  y: number;
  hp_current: number;
  hp_max: number;
}
```

### 5.3 AIPluginRegistry

```typescript
export class AIPluginRegistry {
  register(plugin: IAIPlugin): void;
  unregister(name: string): void;
  list(): ReadonlyArray<IAIPlugin>;
  get(name: string): IAIPlugin | undefined;

  // Dispatchers run plugins in priority order (lower first).
  // Collect emitted events. Return MERGED EmittedEvents.
  dispatchTick(ctx: PluginContext): Promise<EmittedEvents>;
  dispatchPeerJoin(ctx: PluginContext, peer: PeerInfo): Promise<EmittedEvents>;
  dispatchPeerLeave(ctx: PluginContext, peer: PeerInfo): Promise<EmittedEvents>;
  dispatchZoneEnter(ctx: PluginContext, peer: PeerInfo, fromZone: string | null): Promise<EmittedEvents>;
  dispatchPlayerAction(ctx: PluginContext, peer: PeerInfo, action: PlayerAction): Promise<EmittedEvents>;
}
```

**Error isolation guarantee:** if a plugin's hook throws or rejects,
the registry logs the error and DROPS that plugin's contribution for
this dispatch. Other plugins continue. The dispatch never throws to
the caller. Plugin authors are responsible for catch-all in their hooks.

### 5.4 Reference plugin: MockAIPlugin

Deterministic synthetic events. Constructor takes a script:

```typescript
export class MockAIPlugin implements IAIPlugin {
  readonly name = 'mock';
  readonly version = '0.0.1';
  readonly priority = 999;

  constructor(opts: {
    name?: string;  // override default 'mock' name to allow multiple
    script: ReadonlyArray<{
      atTick: number;
      characterEvents?: DirectorEvent[];
      zoneEvents?: ZoneEvent[];
    }>;
  });

  async onTick(ctx: PluginContext): Promise<EmittedEvents>;
}
```

Used by:
- Engine tests (replace registry-internal real LLM dispatch with mock)
- Offline demo mode (engine consumer can run the engine standalone with mock events for showcase)

### 5.5 Server entry point

Add to `package.json`:

```json
"exports": {
  ".": {
    "import": "./dist/index.js",
    "types": "./dist/index.d.ts"
  },
  "./server": {
    "import": "./dist/server/index.js",
    "types": "./dist/server/index.d.ts"
  },
  "./package.json": "./package.json"
}
```

`src/server/index.ts` re-exports the AI Plugin SPI surface only:
- `IAIPlugin`, `EmittedEvents`, `PluginContext`, `PeerInfo`,
  `PlayerAction`, `PluginStorage`, `PluginLogger`
- `AIPluginRegistry`
- `MockAIPlugin`

Browser bundle continues to import `@sadhaka/loom-engine` (no `/server`
suffix) and gets none of this.

---

## Section 6 - Backwards compatibility

- v1 `EventEnvelope`, all 11 v1 types, `IDirectorBridge`, `DirectorSystem`, all locked. Untouched.
- v1 stream `/api/v1/loom/director/events?character_id=X` unchanged.
- v2 introduces NEW types in NEW files. No edits to v1 type definitions, no new fields on v1 envelope.
- An engine consumer that ignores v2 (no `IZoneEventBridge` registered, no AI plugins) sees IDENTICAL behavior to 0.13.0.

---

## Section 7 - Track contract surface

### Track A - engine zone events

**New files:**
- `src/director/zone/zone-event-envelope.ts` (types + parser)
- `src/director/zone/zone-event-bridge.ts` (IZoneEventBridge interface)
- `src/director/zone/mock-zone-bridge.ts`
- `src/director/zone/sse-zone-bridge.ts`
- `src/director/zone/zone-event-system.ts`
- `src/director/zone/zone-event-log.ts`
- `src/director/zone/zone-state-resource.ts`

**Edits (additive only):**
- `src/director/index.ts` - re-export zone types alongside v1 types
- `src/index.ts` - re-export ZoneEventSystem
- `package.json` - bump to 0.14.0
- `CHANGELOG.md` - add 0.14.0 section

**Tests:**
- `tests/zone-event-envelope.test.ts` (parser, all 7 type round-trips)
- `tests/mock-zone-bridge.test.ts` (enqueue/poll, snapshot recovery)
- `tests/zone-event-system.test.ts` (full tick: spawn -> tick -> end)
- `tests/zone-state-resource.test.ts` (state mutation + snapshot replace)

**Bench (extends `tools/perf-bench/`):**
- New scenario: zone event throughput at 10 / 50 / 100 events per tick

**Deliverable:** PR on `loom-engine`, branch `claude/phase-16-1-director-v2-zone-events` -> merge to main -> npm publish 0.14.0

### Track B - engine AI plugin SPI

**New files:**
- `src/director/ai/plugin.ts` (IAIPlugin interface + supporting types)
- `src/director/ai/plugin-context.ts` (PluginContext + PluginStorage + PluginLogger impls)
- `src/director/ai/ai-plugin-registry.ts`
- `src/director/ai/mock-ai-plugin.ts`
- `src/server/index.ts` (re-export AI SPI for `/server` entry)

**Edits (additive only):**
- `package.json` - add `./server` to exports field
- `tsconfig.json` - ensure `src/server/` compiles
- `src/director/index.ts` - re-export types ALSO available via `/server` (types only, not impls, so browser bundle stays small)

**Tests:**
- `tests/ai-plugin-registry.test.ts` (register/unregister/dispatch order)
- `tests/ai-plugin-error-isolation.test.ts` (one plugin throws, others continue)
- `tests/mock-ai-plugin.test.ts` (script execution determinism)
- `tests/plugin-context.test.ts` (storage round-trip, logger tagging)

**No version bump on its own** - ships in same 0.14.0 as Track A.

**Deliverable:** PR on `loom-engine`, branch `claude/phase-16-2-ai-plugin-spi` -> merge to main BEFORE Track A's npm publish so 0.14.0 ships both.

### Track C - TWT integration + e2e demo

**Backend (Python, `docker/api/`):**
- New: `loom_zone_events.py` (zone event log table, append + read API, fanout helper)
- New: `loom_ai_plugin_runtime.py` (Python implementation of AIPluginRegistry; sibling spec to Track B's TS version)
- New: `twt_loom_plugin.py` (TWTLoomPlugin: wraps existing Anthropic flow as IAIPlugin)
- Edit: `loom_director.py` - replace direct Director calls with registry dispatch
- Edit: `app.py` - register TWTLoomPlugin on startup
- Edit: SSE presence handler - emit `zone.event` frames in the multiplexed channel
- New endpoint: `POST /api/v1/loom/zone/<zone_id>/boss` - manual boss spawn for demo
- Smoke test: `smoke_loom_zone_events.py` (per CLAUDE.md backend ritual)

**Frontend (`docker/web/html/arpg/`):**
- Edit `arpg-bundle.js` (mirroring source modules):
  - Add `arpg-zone-bridge.js` section that wires `SSEZoneBridge` against the existing presence EventSource
  - Add `arpg-zone-system.js` section that runs `ZoneEventSystem` after `PeerPresenceSystem`
  - Render shared boss entity from `zone.boss.*` events
- Cache-bust ritual: bump `?v=...` query strings + `CACHE_VERSION` in sw.js per CLAUDE.md

**Demo bar (locked 2026-05-08):**
2 windows, player A triggers `POST /api/v1/loom/zone/<zone>/boss`, both
windows render the same boss at the same position with the same HP,
both can damage it via existing combat hits, both see the death event,
both see the loot drop. Latency bench: zone event p50 < 300ms,
p99 < 800ms over CF Tunnel.

**Deliverable:** PR on `the-world-table`, branch `claude/phase-16-3-twt-zone-integration` -> merge to `week-19-visual` (per memory). User pulls + restarts on TWT-PROD per project_deploy_flow.md.

---

## Section 8 - Open questions (resolve at lock)

### 8.1 Per-zone vs global event ids
**Resolution: per-zone.** Each zone has its own monotonic id sequence
starting at 1. Easier replay; zones are independent failure domains.
Cost: client must track per-zone last-id, accepted.

### 8.2 Plugin state mutation
**Resolution: events only.** Plugins are pure - given context, return
events. State mutation is the engine's job. Better testability +
isolation. No plugin-direct state mutation API.

### 8.3 Plugin failure mode
**Resolution: drop that plugin's contribution for that tick.** Log
error. Other plugins continue. No crash to caller. Plugin authors
write catch-all in their hooks (the registry's safety net is the
last line, not the first).

### 8.4 Browser-side plugins (deferred)
v2 ships server-side only per Misha 2026-05-08. Browser plugins (small
local models, WASM stubs, deterministic fallback) deferred to post-v2.

### 8.5 Cross-zone events (deferred)
Some Director events span zones (e.g. world-state events that all zones
should see). Out of scope for v2. v3 may add a `world.event` topic.

---

End of v2 spec.
