// Loom Engine - SnapshotRecoveryHelper tests.
//
// Pairs the just-deployed Phase 6.5 backend
// (GET /api/v1/loom/director/state). Validates fetch path with a
// mock fetch implementation, applySnapshot resource mutation, and
// the SSEDirectorBridge.initialLastEventId dedupe path.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  SnapshotRecoveryHelper,
  SnapshotFetchError,
  SSEDirectorBridge,
  KnotContextResource,
  RESOURCE_KNOT_CONTEXT,
  RESOURCE_VEIL_BUDGET,
  RESOURCE_DIRECTOR_LOG,
  RESOURCE_ZONE_STATE,
  createDirectorEventLog,
  createVeilBudgetResource,
  createZoneState,
  approxEq,
  type SnapshotResponse,
  type DirectorEvent,
  type DirectorBridgeStatus,
} from '../src/index.js';

// ----- Helpers -----

function buildFetch(payload: unknown, status: number = 200): typeof fetch {
  return (async () => {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return new Response(body, {
      status,
      statusText: status === 200 ? 'OK' : 'ERR',
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function buildSnapshot(overrides: Partial<SnapshotResponse> = {}): SnapshotResponse {
  return {
    ok: true,
    character_id: 'c_test',
    tail_id: 42,
    snapshot: {
      knot_context: {
        id: 1, ts: 1717000000.0, type: 'knot.context',
        character_id: 'c_test', encounter_id: null,
        data: {
          knot: 'int',
          palette: { primary: '#9b5de5', secondary: '#603b91', accent: '#ffd86a' },
          mood: 'tense',
          fade_ms: 600,
        },
      },
      ve_budget: {
        id: 2, ts: 1717000001.0, type: 've.budget.update',
        character_id: 'c_test', encounter_id: null,
        data: {
          ve_remaining_month: 8000,
          ve_ceiling_month: 10000,
          tier: 'amber',
          tier_prev: 'green',
          encounter_budget_ve: 60,
          encounter_budget_usd: 0.6,
        },
      },
      scene: null,
      active_encounter: null,
    },
    ts: 1717000010.0,
    ...overrides,
  };
}

// ----- fetchSnapshot -----

test('snapshot recovery: fetchSnapshot success path', async () => {
  const expected = buildSnapshot();
  const helper = new SnapshotRecoveryHelper({
    baseUrl: 'https://example.test/api/v1/loom/director/state',
    characterId: 'c_test',
    fetchImpl: buildFetch(expected),
  });
  const got = await helper.fetchSnapshot();
  assert.equal(got.tail_id, 42);
  assert.equal(got.snapshot.knot_context?.data.knot, 'int');
  assert.equal(got.snapshot.ve_budget?.data.tier, 'amber');
});

test('snapshot recovery: HTTP 401 surfaces as fetch error', async () => {
  const helper = new SnapshotRecoveryHelper({
    baseUrl: 'https://example.test/api/v1/loom/director/state',
    characterId: 'c_test',
    fetchImpl: buildFetch({ ok: false, error: 'auth_required' }, 401),
  });
  await assert.rejects(
    () => helper.fetchSnapshot(),
    (err: unknown) => err instanceof SnapshotFetchError && err.kind === 'http' && err.status === 401,
  );
});

test('snapshot recovery: HTTP 403 (wrong character) surfaces', async () => {
  const helper = new SnapshotRecoveryHelper({
    baseUrl: 'https://example.test/api/v1/loom/director/state',
    characterId: 'c_test',
    fetchImpl: buildFetch({ ok: false, error: 'forbidden' }, 403),
  });
  await assert.rejects(
    () => helper.fetchSnapshot(),
    (err: unknown) => err instanceof SnapshotFetchError && err.status === 403,
  );
});

test('snapshot recovery: invalid response shape surfaces', async () => {
  const helper = new SnapshotRecoveryHelper({
    baseUrl: 'https://example.test/api/v1/loom/director/state',
    characterId: 'c_test',
    fetchImpl: buildFetch({ ok: true, character_id: 'c_test' }),   // missing tail_id, snapshot
  });
  await assert.rejects(
    () => helper.fetchSnapshot(),
    (err: unknown) => err instanceof SnapshotFetchError && err.kind === 'invalid',
  );
});

test('snapshot recovery: ok=false response treated as invalid', async () => {
  const helper = new SnapshotRecoveryHelper({
    baseUrl: 'https://example.test/api/v1/loom/director/state',
    characterId: 'c_test',
    fetchImpl: buildFetch({ ok: false, character_id: 'c_test', tail_id: 0, snapshot: {}, ts: 0 }),
  });
  await assert.rejects(
    () => helper.fetchSnapshot(),
    (err: unknown) => err instanceof SnapshotFetchError && err.kind === 'invalid',
  );
});

// ----- applySnapshot -----

test('snapshot recovery: applySnapshot mutates KnotContextResource', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const knotCtx = new KnotContextResource();
  w.resources.set(RESOURCE_KNOT_CONTEXT, knotCtx);
  w.resources.set(RESOURCE_DIRECTOR_LOG, createDirectorEventLog());

  const helper = new SnapshotRecoveryHelper({
    baseUrl: 'x',
    characterId: 'c',
    fetchImpl: buildFetch({}),
  });
  helper.applySnapshot(w, buildSnapshot());

  assert.equal(knotCtx.knot, 'int');
  assert.equal(knotCtx.mood, 'tense');
  assert.ok(knotCtx.isFading());
});

test('snapshot recovery: applySnapshot mutates VeilBudgetResource per tier scalars', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const knotCtx = new KnotContextResource();
  const budget = createVeilBudgetResource();
  w.resources.set(RESOURCE_KNOT_CONTEXT, knotCtx);
  w.resources.set(RESOURCE_VEIL_BUDGET, budget);
  w.resources.set(RESOURCE_DIRECTOR_LOG, createDirectorEventLog());

  const helper = new SnapshotRecoveryHelper({
    baseUrl: 'x', characterId: 'c', fetchImpl: buildFetch({}),
  });
  helper.applySnapshot(w, buildSnapshot());   // tier=amber

  assert.equal(budget.particleBudget, 2048);   // 4096 * 0.5
  assert.ok(approxEq(budget.audioBudget, 0.7));
});

test('snapshot recovery: applySnapshot tolerates missing resources (no-op)', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  // No resources registered.
  const helper = new SnapshotRecoveryHelper({
    baseUrl: 'x', characterId: 'c', fetchImpl: buildFetch({}),
  });
  helper.applySnapshot(w, buildSnapshot());
  // Just verify no throw.
});

test('snapshot recovery: applySnapshot writes lastKnot + lastTier to DirectorEventLog', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const knotCtx = new KnotContextResource();
  const budget = createVeilBudgetResource();
  const log = createDirectorEventLog();
  w.resources.set(RESOURCE_KNOT_CONTEXT, knotCtx);
  w.resources.set(RESOURCE_VEIL_BUDGET, budget);
  w.resources.set(RESOURCE_DIRECTOR_LOG, log);

  const helper = new SnapshotRecoveryHelper({
    baseUrl: 'x', characterId: 'c', fetchImpl: buildFetch({}),
  });
  helper.applySnapshot(w, buildSnapshot());

  assert.equal(log.lastKnot, 'int');
  assert.equal(log.lastTier, 'amber');
});

test('snapshot recovery: active_encounter sets activeEncounterId on log', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  w.resources.set(RESOURCE_KNOT_CONTEXT, new KnotContextResource());
  w.resources.set(RESOURCE_DIRECTOR_LOG, createDirectorEventLog());

  const helper = new SnapshotRecoveryHelper({
    baseUrl: 'x', characterId: 'c', fetchImpl: buildFetch({}),
  });
  const snap = buildSnapshot({
    snapshot: {
      knot_context: null,
      ve_budget: null,
      scene: null,
      active_encounter: {
        id: 5, ts: 1, type: 'encounter.spawn',
        character_id: 'c_test', encounter_id: 'enc_99',
        data: {
          encounter_id: 'enc_99', zone_id: 'iron_reach', level: 5, knot: 'str',
          mobs: [], boss: null,
          narrator_line: 'You walk into iron and smoke.',
          difficulty_score: 1.0,
        },
      },
    },
  });
  helper.applySnapshot(w, snap);
  const log = w.resources.require<ReturnType<typeof createDirectorEventLog>>(RESOURCE_DIRECTOR_LOG);
  assert.equal(log.activeEncounterId, 'enc_99');
  assert.equal(log.lastNarratorLine, 'You walk into iron and smoke.');
});

test('snapshot recovery: missing active_encounter clears activeEncounterId', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  w.resources.set(RESOURCE_KNOT_CONTEXT, new KnotContextResource());
  const log = createDirectorEventLog();
  log.activeEncounterId = 'enc_OLD';
  w.resources.set(RESOURCE_DIRECTOR_LOG, log);

  const helper = new SnapshotRecoveryHelper({
    baseUrl: 'x', characterId: 'c', fetchImpl: buildFetch({}),
  });
  helper.applySnapshot(w, buildSnapshot());   // active_encounter is null
  assert.equal(log.activeEncounterId, null);
});

test('snapshot recovery: scene snapshot triggers ZoneStateResource transition', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  w.resources.set(RESOURCE_KNOT_CONTEXT, new KnotContextResource());
  w.resources.set(RESOURCE_DIRECTOR_LOG, createDirectorEventLog());
  const zone = createZoneState('lastlight_plaza');
  w.resources.set(RESOURCE_ZONE_STATE, zone);

  const helper = new SnapshotRecoveryHelper({
    baseUrl: 'x', characterId: 'c', fetchImpl: buildFetch({}),
  });
  const snap = buildSnapshot({
    snapshot: {
      knot_context: null, ve_budget: null, active_encounter: null,
      scene: {
        id: 7, ts: 1, type: 'scene.transition',
        character_id: 'c_test', encounter_id: null,
        data: {
          from_zone: 'lastlight_plaza',
          to_zone: 'iron_reach',
          transition_kind: 'instant',
          duration_ms: 1,
        },
      },
    },
  });
  helper.applySnapshot(w, snap);
  // beginTransition was called with target 'iron_reach'.
  assert.ok(zone.transition);
  assert.equal(zone.transition?.toZoneId, 'iron_reach');
});

// ----- recover convenience -----

test('snapshot recovery: recover returns tail_id', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  w.resources.set(RESOURCE_KNOT_CONTEXT, new KnotContextResource());
  w.resources.set(RESOURCE_DIRECTOR_LOG, createDirectorEventLog());

  const helper = new SnapshotRecoveryHelper({
    baseUrl: 'x',
    characterId: 'c',
    fetchImpl: buildFetch(buildSnapshot({ tail_id: 99 })),
  });
  const tailId = await helper.recover(w);
  assert.equal(tailId, 99);
});

// ----- SSEDirectorBridge.initialLastEventId dedupe -----

test('sse bridge: initialLastEventId primes lastEventId stat', () => {
  // We can't run the real EventSource path in Node, so just assert
  // the constructor accepted the option and seeded the stat.
  // FakeES is never started.
  class FakeES extends EventTarget {
    readyState = 0;
    close(): void {}
  }
  // We need to keep the bridge from actually opening - don't call start().
  const bridge = new SSEDirectorBridge({
    baseUrl: 'https://example.test/sse',
    characterId: 'c',
    initialLastEventId: 100,
    eventSourceFactory: ((_url: string) => new FakeES() as unknown as EventSource),
  });
  assert.equal(bridge.getLastEventId(), 100);
});

test('sse bridge: events with id <= initialLastEventId are silently deduped', async () => {
  // Bridge subscribes via addEventListener('<type>', ...) for each
  // known event type. Dispatch synthetic events with the matching
  // SSE event-type name so the listener fires (raw EventTarget
  // doesn't intercept .onmessage assignments the way real
  // EventSource does).
  class FakeES extends EventTarget {
    readyState = 1;
    onopen: ((e: Event) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    close(): void { this.readyState = 2; }
  }
  let captured: FakeES | null = null;
  const bridge = new SSEDirectorBridge({
    baseUrl: 'https://example.test/sse',
    characterId: 'c',
    initialLastEventId: 50,
    eventSourceFactory: ((_url: string) => {
      captured = new FakeES();
      return captured as unknown as EventSource;
    }),
  });
  bridge.start();
  assert.ok(captured);

  function emit(env: DirectorEvent) {
    const ev = new MessageEvent(env.type, { data: JSON.stringify(env) });
    if (captured) (captured as unknown as { dispatchEvent: (e: Event) => void }).dispatchEvent(ev);
  }

  const old: DirectorEvent = {
    id: 30, ts: 1, type: 'system.heartbeat',
    character_id: 'c', encounter_id: null,
    data: { tail_id: 30, drops_p1: 0, drops_p2: 0 },
  };
  emit(old);
  const fresh: DirectorEvent = {
    id: 51, ts: 2, type: 'system.heartbeat',
    character_id: 'c', encounter_id: null,
    data: { tail_id: 51, drops_p1: 0, drops_p2: 0 },
  };
  emit(fresh);

  const drained = bridge.pollEvents();
  assert.equal(drained.length, 1);
  assert.equal(drained[0]?.id, 51);
  assert.equal(bridge.getLastEventId(), 51);
});

// ----- Status surface -----

test('sse bridge: snapshot.required surfaces the event + closes (regression)', async () => {
  // Confirms the bridge's existing snapshot.required path still
  // works alongside the new initialLastEventId option. Signal +
  // status flip + connection close.
  class FakeES extends EventTarget {
    readyState = 1;
    onopen: ((e: Event) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    close(): void { this.readyState = 2; }
  }
  let captured: FakeES | null = null;
  const bridge = new SSEDirectorBridge({
    baseUrl: 'x',
    characterId: 'c',
    eventSourceFactory: ((_url: string) => {
      captured = new FakeES();
      return captured as unknown as EventSource;
    }),
  });
  bridge.start();
  assert.ok(captured);

  const required: DirectorEvent = {
    id: 1, ts: 1, type: 'system.snapshot.required',
    character_id: 'c', encounter_id: null,
    data: { last_known_id: 0, current_tail_id: 999999, retention_window: 300 },
  };
  // Dispatch with the matching SSE event-type so the bridge's
  // addEventListener for this type fires.
  const ev = new MessageEvent('system.snapshot.required', { data: JSON.stringify(required) });
  (captured as unknown as { dispatchEvent: (e: Event) => void }).dispatchEvent(ev);

  const drained = bridge.pollEvents();
  assert.equal(drained.length, 1);
  assert.equal(drained[0]?.type, 'system.snapshot.required');
  const status: DirectorBridgeStatus = bridge.status();
  assert.equal(status, 'snapshot-required');
});
