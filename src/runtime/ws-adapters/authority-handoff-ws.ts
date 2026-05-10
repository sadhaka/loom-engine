// AuthorityHandoff WebSocket adapter (1.7.3 reference adapter).
//
// Wires AuthorityHandoff to a WebSocket so consumers don't have to
// hand-write the protocol. Authoritative side (the handoff state
// machine) lives wherever this adapter runs; broadcasts handoff
// events to peers via opts.onChange.
//
// Inbound messages (parsed from raw JSON):
//   { type: 'heartbeat', id, now? }
//   { type: 'leave',     id, now? }
//   { type: 'set-host',  id|null, now? }
//   { type: 'tick',      now? }
//
// Outbound (via opts.onChange callback):
//   AuthorityChange { kind, oldHostId, newHostId, at }
//
// Code style: var-only in browser source.

import { AuthorityHandoff } from '../authority-handoff.js';
import type { AuthorityOptions, AuthorityChange } from '../authority-handoff.js';

export interface AuthorityWsAdapterOptions {
  // Existing handoff to bind. If omitted, fresh one created with handoffOptions.
  handoff?: AuthorityHandoff;
  handoffOptions?: AuthorityOptions;
  // Called when host changes (handoff/host-leave/no-host/reclaim).
  onChange?: (change: AuthorityChange) => void;
  // Called on malformed/unknown message.
  onError?: (err: Error, raw: string) => void;
  // Auto-tick interval ms. 0 = disabled. Default 2000.
  tickIntervalMs?: number;
  // REQUIRED clock source (engine determinism policy).
  nowFn: () => number;
}

export interface AuthorityWsHandle {
  handoff: AuthorityHandoff;
  ingest(raw: string): string;
  tick(now?: number): AuthorityChange | null;
  stop(): void;
}

interface InboundHeartbeat { type: 'heartbeat'; id: string; now?: number; }
interface InboundLeave     { type: 'leave';     id: string; now?: number; }
interface InboundSetHost   { type: 'set-host';  id: string | null; now?: number; }
interface InboundTick      { type: 'tick';      now?: number; }
type InboundMessage = InboundHeartbeat | InboundLeave | InboundSetHost | InboundTick;

export function attachAuthorityHandoffToWs(
  opts: AuthorityWsAdapterOptions,
): AuthorityWsHandle {
  var handoff = opts.handoff || AuthorityHandoff.create(opts.handoffOptions || {});
  var nowFn = opts.nowFn;
  var onChange = opts.onChange || function () {};
  var onError = opts.onError || function () {};
  var intervalMs = (typeof opts.tickIntervalMs === 'number' && opts.tickIntervalMs >= 0)
    ? opts.tickIntervalMs : 2000;

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
      case 'heartbeat':
        handoff.heartbeat(parsed.id, nowFromMsg(parsed));
        return 'heartbeat';
      case 'leave': {
        var change = handoff.removePeer(parsed.id, nowFromMsg(parsed));
        if (change) onChange(change);
        return 'leave';
      }
      case 'set-host': {
        var change2 = handoff.setHost(parsed.id, nowFromMsg(parsed));
        onChange(change2);
        return 'set-host';
      }
      case 'tick': {
        var change3 = handoff.tick(nowFromMsg(parsed));
        if (change3) onChange(change3);
        return 'tick';
      }
      default:
        return 'unknown';
    }
  }

  function manualTick(now?: number): AuthorityChange | null {
    var t = (typeof now === 'number' && isFinite(now)) ? now : nowFn();
    var change = handoff.tick(t);
    if (change) onChange(change);
    return change;
  }

  var timer: ReturnType<typeof setInterval> | null = null;
  if (intervalMs > 0) {
    timer = setInterval(function () { manualTick(); }, intervalMs);
  }

  return {
    handoff: handoff,
    ingest: ingest,
    tick: manualTick,
    stop: function () { if (timer !== null) { clearInterval(timer); timer = null; } },
  };
}
