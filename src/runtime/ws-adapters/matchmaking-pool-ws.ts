// MatchmakingPool WebSocket adapter (1.7.2 reference adapter).
//
// Wires a MatchmakingPool to a WebSocket so consumers don't have to
// hand-write the message protocol. Pure transport glue - opinionated
// JSON message shape, but no other assumptions about server logic.
//
// Server -> client messages:
//   { type: 'queue', id, skill, partySize?, data?, now? }
//   { type: 'cancel', id }
//   { type: 'tick', now }                  (server requests tick)
// Client -> server emissions (via opts.onMatch):
//   { type: 'match', ids, skillSpread, matchedAt }
//
// Designed for a server-authoritative pool: server sends queue/cancel
// from authenticated clients + drives tick on a timer; client receives
// match events to navigate party members into a lobby (LobbyState 1.7.1).
//
// Mirror configuration on the client side: the same message schema lets
// the client SHOW a queue UI ('your wait', 'currently matching').
//
// Code style: var-only in browser source.

import { MatchmakingPool } from '../matchmaking-pool.js';
import type { Match, MatchmakingOptions, QueueOptions } from '../matchmaking-pool.js';

export interface MatchmakingWsAdapterOptions<T = Record<string, unknown>> {
  // Existing pool to bind to. If omitted, a fresh pool is created with
  // poolOptions.
  pool?: MatchmakingPool<T>;
  // Used only if pool is not provided.
  poolOptions?: MatchmakingOptions;
  // Called after every tick that produces matches. Adapter-side hook
  // for the consumer to broadcast match assignments to clients.
  onMatch?: (matches: Match<T>[]) => void;
  // Called when a malformed/unknown message arrives. Default: silent.
  onError?: (err: Error, raw: string) => void;
  // Auto-tick interval in ms. 0 = disabled (consumer drives tick via
  // 'tick' message). Default 1000 (1 sec).
  tickIntervalMs?: number;
  // REQUIRED clock source. Engine policy: no Date.now() / performance.now()
  // inside src/ outside the documented determinism whitelist. Consumer
  // passes a function returning the current ms (Date.now, performance.now,
  // a deterministic test clock, etc).
  nowFn: () => number;
}

export interface MatchmakingWsHandle<T = Record<string, unknown>> {
  pool: MatchmakingPool<T>;
  // Feed a raw inbound message (the WebSocket 'message' event data).
  // Returns the parsed message kind ('queue'/'cancel'/'tick'/'unknown').
  ingest(raw: string): string;
  // Drive a tick (also called by auto-tick if enabled). Returns matches
  // produced so consumer can broadcast them out-of-band if onMatch is
  // not configured.
  tick(now?: number): Match<T>[];
  // Stop the auto-tick interval. Pool itself is not destroyed.
  stop(): void;
}

interface InboundQueueMessage {
  type: 'queue';
  id: string;
  skill: number;
  partySize?: number;
  data?: unknown;
  now?: number;
}
interface InboundCancelMessage {
  type: 'cancel';
  id: string;
}
interface InboundTickMessage {
  type: 'tick';
  now?: number;
}
type InboundMessage = InboundQueueMessage | InboundCancelMessage | InboundTickMessage;

export function attachMatchmakingPoolToWs<T = Record<string, unknown>>(
  opts: MatchmakingWsAdapterOptions<T>,
): MatchmakingWsHandle<T> {
  var pool = opts.pool || MatchmakingPool.create<T>(opts.poolOptions || {});
  var nowFn = opts.nowFn;
  var onMatch = opts.onMatch || function () {};
  var onError = opts.onError || function () {};
  var intervalMs = (typeof opts.tickIntervalMs === 'number' && opts.tickIntervalMs >= 0)
    ? opts.tickIntervalMs : 1000;

  function nowFromMsg(msg: { now?: number }): number {
    if (typeof msg.now === 'number' && isFinite(msg.now)) return msg.now;
    return nowFn();
  }

  function ingest(raw: string): string {
    var parsed: InboundMessage | null;
    try {
      parsed = JSON.parse(raw) as InboundMessage;
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)), raw);
      return 'unknown';
    }
    if (!parsed || typeof parsed !== 'object') return 'unknown';
    switch (parsed.type) {
      case 'queue': {
        var qOpts: QueueOptions<T> = {};
        if (typeof parsed.partySize === 'number') qOpts.partySize = parsed.partySize;
        if (parsed.data !== undefined) qOpts.data = parsed.data as T;
        pool.queue(parsed.id, parsed.skill, nowFromMsg(parsed), qOpts);
        return 'queue';
      }
      case 'cancel': {
        pool.cancel(parsed.id);
        return 'cancel';
      }
      case 'tick': {
        var matches = pool.tick(nowFromMsg(parsed));
        if (matches.length > 0) onMatch(matches);
        return 'tick';
      }
      default:
        return 'unknown';
    }
  }

  function manualTick(now?: number): Match<T>[] {
    var t = (typeof now === 'number' && isFinite(now)) ? now : nowFn();
    var matches = pool.tick(t);
    if (matches.length > 0) onMatch(matches);
    return matches;
  }

  // Auto-tick interval (server-side driver). setInterval is browser +
  // Node compatible; consumer can disable with tickIntervalMs: 0.
  var timer: ReturnType<typeof setInterval> | null = null;
  if (intervalMs > 0) {
    timer = setInterval(function () { manualTick(); }, intervalMs);
  }

  return {
    pool: pool,
    ingest: ingest,
    tick: manualTick,
    stop: function () { if (timer !== null) { clearInterval(timer); timer = null; } },
  };
}
