// Loom Engine - SSEZoneBridge protocol fuzzer.
//
// Generates malformed / out-of-order / cross-zone / oversized envelopes
// and feeds them at the SSEZoneBridge through a fake EventSource. The
// bridge MUST NOT crash, MUST NOT leak state, and the internal queue
// MUST stay bounded under any sequence of inputs.
//
// Why: in production the SSE channel is multiplexed onto a presence
// stream that's reachable by any peer with a valid auth header. A
// malicious peer cannot directly inject (server fanout is the only
// emit path), but transient corruption from network or a buggy router
// CAN deliver malformed frames. The bridge's parser tolerance is the
// last line of defence before the system layer reads it.
//
// Patterns covered (fuzz seeds rotate across):
//   1. Invalid JSON
//   2. JSON but not an object (number / string / array / null)
//   3. Object missing required fields (id, ts, type, zone_id, data)
//   4. Wrong types (zone_id: number, id: string, ts: NaN, etc.)
//   5. Unknown event type
//   6. Out-of-order ids (id going backwards)
//   7. Future-dated ts (ts > now + 1 year)
//   8. Cross-zone leakage (zone_id differs from local)
//   9. Extra unexpected fields
//  10. Oversized payload (data string > 1 MB)
//  11. Recursive / circular shapes (best-effort - JSON disallows)
//  12. Negative id / id === 0
//  13. emitter_id wrong type
//  14. priority wrong value
//  15. data is array / string / null

import {
  SSEZoneBridge,
  type SSEZoneBridgeEventSource,
  type IEntropy,
} from '../../src/index.js';

// Minimal EventSource fake. Browser SSE sends events as
// { data: string }; we mirror that. addEventListener registers a fn
// and dispatch() invokes the registered listener for the matching
// event name.
export class FakeEventSource implements SSEZoneBridgeEventSource {
  readyState: number = 1; // OPEN
  private listeners: Map<string, Array<(event: { data?: unknown }) => void>> =
    new Map();

  addEventListener(
    type: string,
    listener: (event: { data?: unknown }) => void,
  ): void {
    let arr = this.listeners.get(type);
    if (!arr) {
      arr = [];
      this.listeners.set(type, arr);
    }
    arr.push(listener);
  }

  removeEventListener(
    type: string,
    listener: (event: { data?: unknown }) => void,
  ): void {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(listener);
    if (i >= 0) arr.splice(i, 1);
  }

  // Dispatch a server-pushed frame. The bridge's listener reads
  // event.data per the SSE contract.
  dispatch(type: string, data: unknown): void {
    const arr = this.listeners.get(type);
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) {
      arr[i]!({ data });
    }
  }

  close(): void {
    this.readyState = 2; // CLOSED
    this.listeners.clear();
  }
}

// Pattern catalog - each fn takes an entropy and returns a candidate
// `data` string to send to the bridge. The bridge expects valid JSON
// of a ZoneEventEnvelope shape; we intentionally diverge.
//
// The patterns are stateless - they read entropy each call so the
// runner can iterate any number of times deterministically.
type Pattern = (e: IEntropy, iteration: number) => string;

const VALID_TYPES = [
  'zone.boss.spawn',
  'zone.boss.tick',
  'zone.boss.end',
  'zone.narrator',
  'zone.knot',
  'zone.state',
  'zone.snapshot',
];

const KNOWN_ZONES = ['iron_reach', 'saltsprig', 'glasshollow'];

function randInt(e: IEntropy, lo: number, hi: number): number {
  return e.int(lo, hi);
}

function randString(e: IEntropy, minLen: number, maxLen: number): string {
  const len = randInt(e, minLen, maxLen);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += String.fromCharCode(33 + e.int(0, 90));
  }
  return out;
}

// 1. Invalid JSON syntax.
const patternInvalidJson: Pattern = (e) => {
  const choices = [
    '{',
    '}',
    '[]{',
    'not json',
    '{"id":1,',
    '{"id":1,"ts":2}\nrandom',
    'undefined',
    '{,}',
    'NaN',
    '{"key":invalid}',
  ];
  return choices[e.int(0, choices.length - 1)]!;
};

// 2. JSON but not an object.
const patternJsonNonObject: Pattern = (e) => {
  const choices = ['null', '5', 'true', '"a string"', '[1,2,3]', '0', '-1', '1.5'];
  return choices[e.int(0, choices.length - 1)]!;
};

// 3. Object missing required fields.
const patternMissingFields: Pattern = (e) => {
  const all: Record<string, unknown> = {
    id: e.int(1, 1000),
    ts: Date.now(),
    type: 'zone.narrator',
    zone_id: 'iron_reach',
    emitter_id: null,
    data: { line: 'hello', voice: 'ambient', ttl_ms: 1000 },
  };
  const keys = Object.keys(all);
  // Drop one key.
  const dropIdx = e.int(0, keys.length - 1);
  delete all[keys[dropIdx]!];
  return JSON.stringify(all);
};

// 4. Wrong types in required fields.
const patternWrongTypes: Pattern = (e) => {
  const choices: Array<Record<string, unknown>> = [
    { id: 'one', ts: 1, type: 'zone.narrator', zone_id: 'a', emitter_id: null, data: {} },
    { id: 1, ts: 'now', type: 'zone.narrator', zone_id: 'a', emitter_id: null, data: {} },
    { id: 1, ts: 1, type: 5, zone_id: 'a', emitter_id: null, data: {} },
    { id: 1, ts: 1, type: 'zone.narrator', zone_id: 1234, emitter_id: null, data: {} },
    { id: 1, ts: 1, type: 'zone.narrator', zone_id: 'a', emitter_id: 99, data: {} },
    { id: 1.5, ts: NaN, type: 'zone.narrator', zone_id: 'a', emitter_id: null, data: {} },
  ];
  return JSON.stringify(choices[e.int(0, choices.length - 1)]!);
};

// 5. Unknown event type.
const patternUnknownType: Pattern = (e) => {
  const fakeTypes = ['zone.boss.eat', 'zone.unknown', 'foo.bar', 'zone.', '', 'ZONE.NARRATOR'];
  return JSON.stringify({
    id: e.int(1, 1000),
    ts: Date.now(),
    type: fakeTypes[e.int(0, fakeTypes.length - 1)]!,
    zone_id: 'iron_reach',
    emitter_id: null,
    data: {},
  });
};

// 6. Out-of-order ids.
const patternOutOfOrder: Pattern = (e, iteration) => {
  // Half the time send a small id; half the time a stale id. Either
  // way the bridge tracks via outOfOrderEvents counter.
  const id = iteration % 2 === 0 ? 1 : Math.max(1, iteration - e.int(1, 100));
  return JSON.stringify({
    id,
    ts: Date.now(),
    type: 'zone.narrator',
    zone_id: KNOWN_ZONES[e.int(0, KNOWN_ZONES.length - 1)]!,
    emitter_id: null,
    data: { line: 'L' + id, voice: 'ambient', ttl_ms: 1000 },
  });
};

// 7. Future-dated ts.
const patternFutureTs: Pattern = (e, iteration) => {
  const oneYear = 365 * 24 * 60 * 60 * 1000;
  return JSON.stringify({
    id: iteration + 1,
    ts: Date.now() + oneYear * (1 + e.int(1, 100)),
    type: 'zone.narrator',
    zone_id: 'iron_reach',
    emitter_id: null,
    data: { line: 'future', voice: 'ambient', ttl_ms: 1000 },
  });
};

// 8. Cross-zone leakage (random zone_id, system filter must catch).
const patternCrossZone: Pattern = (e, iteration) => {
  const z = e.int(0, 1) === 0
    ? KNOWN_ZONES[e.int(0, KNOWN_ZONES.length - 1)]!
    : randString(e, 5, 24);
  return JSON.stringify({
    id: iteration + 1,
    ts: Date.now(),
    type: VALID_TYPES[e.int(0, VALID_TYPES.length - 1)]!,
    zone_id: z,
    emitter_id: null,
    data: makeMinimalDataFor(VALID_TYPES[e.int(0, VALID_TYPES.length - 1)]!, e),
  });
};

function makeMinimalDataFor(type: string, e: IEntropy): unknown {
  switch (type) {
    case 'zone.narrator':
      return { line: randString(e, 1, 40), voice: 'ambient', ttl_ms: 1000 };
    case 'zone.knot':
      return { knot: 'str', palette: { primary: '#000000', secondary: '#000000', accent: '#000000' }, mood: 'ambient', fade_ms: 0 };
    case 'zone.state':
      return { changes: [{ key: 'k', value: 1 }] };
    case 'zone.boss.tick':
      return { boss_id: 'b', hp_current: 100, x: 0, y: 0, recent_hits: [] };
    case 'zone.boss.end':
      return { boss_id: 'b', outcome: 'killed', killer_character_id: null, loot: [], duration_ms: 1000 };
    case 'zone.snapshot':
      return { active_boss: null, knot: null, state: [], last_event_id: 0 };
    default:
      return { boss: { boss_id: 'b', type: 't', name: 'n', hp_max: 1, hp_current: 1, dmg: 1, x: 0, y: 0, knot_flavor: 'str' }, narrator_line: null };
  }
}

// 9. Extra unexpected fields.
const patternExtraFields: Pattern = (e, iteration) => {
  const env: Record<string, unknown> = {
    id: iteration + 1,
    ts: Date.now(),
    type: 'zone.narrator',
    zone_id: 'iron_reach',
    emitter_id: null,
    data: { line: 'x', voice: 'ambient', ttl_ms: 1000 },
  };
  // Sprinkle 0-5 extra fields.
  const extraCount = e.int(0, 5);
  for (let i = 0; i < extraCount; i++) {
    env['__extra_' + i] = randString(e, 1, 24);
  }
  return JSON.stringify(env);
};

// 10. Oversized payload. Cap at 1.5 MB; the bridge should still not
// crash but the queue should not balloon.
const patternOversized: Pattern = (e, iteration) => {
  const huge = 'x'.repeat(1024 * 1024 * 1.5 | 0);
  return JSON.stringify({
    id: iteration + 1,
    ts: Date.now(),
    type: 'zone.narrator',
    zone_id: 'iron_reach',
    emitter_id: null,
    data: { line: huge, voice: 'ambient', ttl_ms: 1000 },
  });
};

// 12. Negative id / id === 0.
const patternNegativeOrZeroId: Pattern = (e, iteration) => {
  const choices = [-1, 0, -1000, -iteration];
  return JSON.stringify({
    id: choices[e.int(0, choices.length - 1)]!,
    ts: Date.now(),
    type: 'zone.narrator',
    zone_id: 'iron_reach',
    emitter_id: null,
    data: { line: 'x', voice: 'ambient', ttl_ms: 1000 },
  });
};

// 13. emitter_id wrong type.
const patternBadEmitter: Pattern = (e, iteration) => {
  const choices: unknown[] = [99, [], {}, true];
  return JSON.stringify({
    id: iteration + 1,
    ts: Date.now(),
    type: 'zone.narrator',
    zone_id: 'iron_reach',
    emitter_id: choices[e.int(0, choices.length - 1)],
    data: { line: 'x', voice: 'ambient', ttl_ms: 1000 },
  });
};

// 14. priority wrong value.
const patternBadPriority: Pattern = (e, iteration) => {
  const choices: unknown[] = ['P3', 'PA', 99, true, [], null];
  return JSON.stringify({
    id: iteration + 1,
    ts: Date.now(),
    type: 'zone.narrator',
    zone_id: 'iron_reach',
    emitter_id: null,
    priority: choices[e.int(0, choices.length - 1)],
    data: { line: 'x', voice: 'ambient', ttl_ms: 1000 },
  });
};

// 15. data is array / string / null.
const patternBadData: Pattern = (e, iteration) => {
  const choices: unknown[] = [null, [1, 2], 'str', 5, true];
  return JSON.stringify({
    id: iteration + 1,
    ts: Date.now(),
    type: 'zone.narrator',
    zone_id: 'iron_reach',
    emitter_id: null,
    data: choices[e.int(0, choices.length - 1)],
  });
};

// 16. Mixed-type data: occasionally a *valid* event slips through so
// the queue and stats actually get exercised. Keeps the fuzzer from
// being entirely a parser-rejection test.
const patternValidMixed: Pattern = (e, iteration) => {
  return JSON.stringify({
    id: iteration + 1,
    ts: Date.now(),
    type: 'zone.narrator',
    zone_id: 'iron_reach',
    emitter_id: null,
    data: { line: 'L' + iteration, voice: 'ambient', ttl_ms: 1000 },
  });
};

// 17. Non-string data fed to the bridge listener (the bridge expects
// e.data: string from SSE, but we exercise its non-string branch).
const patternNonStringData: Pattern = () => {
  return ''; // returned, but the runner replaces with non-string
};

const PATTERNS: Pattern[] = [
  patternInvalidJson,
  patternJsonNonObject,
  patternMissingFields,
  patternWrongTypes,
  patternUnknownType,
  patternOutOfOrder,
  patternFutureTs,
  patternCrossZone,
  patternExtraFields,
  patternOversized,
  patternNegativeOrZeroId,
  patternBadEmitter,
  patternBadPriority,
  patternBadData,
  patternValidMixed,
  patternNonStringData,
];

export interface FuzzResult {
  iterations: number;
  errors: number;
  exceptionsCaught: number;
  validApplied: number;
  finalQueueDepth: number;
  finalEventsReceived: number;
}

// Run `iterations` fuzz cycles against a freshly-built SSEZoneBridge.
// Returns aggregate stats so the caller can assert "no crash, no
// runaway queue, parser rejected the bad frames".
//
// The bridge maintains an internal queue; we drain it every
// `drainEvery` iterations to mimic a system polling. Without this,
// an oversized-payload pattern would let the queue grow unbounded
// (which is itself a leak to assert against).
export function fuzzZoneBridge(
  iterations: number,
  entropy: IEntropy,
  drainEvery: number = 25,
): FuzzResult {
  const fakeEs = new FakeEventSource();
  const bridge = new SSEZoneBridge({
    eventSource: fakeEs,
    characterId: 'c_fuzz',
    currentZone: () => 'iron_reach',
  });
  bridge.start();

  let exceptionsCaught = 0;
  let errors = 0;
  let validApplied = 0;

  for (let i = 0; i < iterations; i++) {
    const patIdx = entropy.int(0, PATTERNS.length - 1);
    const pat = PATTERNS[patIdx]!;
    let payload: unknown;
    try {
      payload = pat(entropy, i);
    } catch (e) {
      // A pattern itself misbehaved - count and continue.
      errors++;
      continue;
    }
    // Pattern 17: feed a non-string at the bridge listener.
    if (pat === patternNonStringData) {
      const choices: unknown[] = [null, undefined, 5, [], {}, true];
      payload = choices[entropy.int(0, choices.length - 1)];
    }

    try {
      fakeEs.dispatch('zone.event', payload);
    } catch (e) {
      // The bridge MUST NOT throw on bad input. If it does, count and
      // keep going so the test can report aggregate.
      exceptionsCaught++;
    }

    // Periodically drain so the queue does not pin the heap when we
    // hit oversized-payload patterns.
    if ((i + 1) % drainEvery === 0) {
      const drained = bridge.pollEvents();
      validApplied += drained.length;
    }
  }

  // Final drain.
  const finalDrained = bridge.pollEvents();
  validApplied += finalDrained.length;

  const stats = bridge.stats();
  return {
    iterations,
    errors,
    exceptionsCaught,
    validApplied,
    finalQueueDepth: 0, // queue drained
    finalEventsReceived: stats.eventsReceived,
  };
}

// Same harness, but does NOT drain. Used by the bounded-queue test to
// assert the queue cannot grow unbounded across N fuzz iterations.
// Exposes the queue depth via pollEvents at the end.
export function fuzzZoneBridgeNoDrain(
  iterations: number,
  entropy: IEntropy,
): FuzzResult {
  const fakeEs = new FakeEventSource();
  const bridge = new SSEZoneBridge({
    eventSource: fakeEs,
    characterId: 'c_fuzz',
    currentZone: () => 'iron_reach',
  });
  bridge.start();

  let exceptionsCaught = 0;
  let errors = 0;

  for (let i = 0; i < iterations; i++) {
    // Skip the 1 MB pattern - that one *would* legitimately balloon
    // memory. The bounded test exercises pure-parser patterns.
    let pat: Pattern;
    do {
      pat = PATTERNS[entropy.int(0, PATTERNS.length - 1)]!;
    } while (pat === patternOversized);
    let payload: unknown;
    try {
      payload = pat(entropy, i);
    } catch {
      errors++;
      continue;
    }
    if (pat === patternNonStringData) {
      const choices: unknown[] = [null, undefined, 5, [], {}, true];
      payload = choices[entropy.int(0, choices.length - 1)];
    }
    try {
      fakeEs.dispatch('zone.event', payload);
    } catch {
      exceptionsCaught++;
    }
  }

  // Read queue depth without draining via stats - then drain.
  const drained = bridge.pollEvents();
  const stats = bridge.stats();
  return {
    iterations,
    errors,
    exceptionsCaught,
    validApplied: drained.length,
    finalQueueDepth: drained.length,
    finalEventsReceived: stats.eventsReceived,
  };
}
