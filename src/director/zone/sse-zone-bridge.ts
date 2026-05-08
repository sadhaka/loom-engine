// SSEZoneBridge - multiplexes v2 zone-event frames onto an EXISTING
// presence EventSource (per LOOM-DIRECTOR-PROTOCOL-V2 §2 + §4.2).
//
// CRITICAL: this bridge does NOT open its own EventSource. The
// presence transport (15.x SSEMultiplayerBridge) already has a live
// connection per peer; we just attach a listener for SSE frames whose
// `event:` line is `zone.event`. Per spec §1.1: "Transport reuses
// presence SSE. Same channel as 15.x presence updates, multiplexed by
// event topic. No second EventSource per peer."
//
// Wire shape per frame:
//   event: zone.event
//   data: <ZoneEventEnvelope JSON>
//
// Local-zone filter: the system layer (ZoneEventSystem) is the
// authoritative filter on "is this event for the local player's
// zone". The bridge buffers ALL zone events it receives so the system
// can log other-zone events for diagnostics if it chooses, then drop
// them before applying. The currentZone() callback is provided so the
// bridge can additionally short-circuit obvious-other-zone events at
// receive time when stats matter (e.g. a high-volume foreign zone).
// The default behaviour is to keep everything and let the system
// decide.
//
// Browser-only (constructor accepts EventSource which is a DOM API).
// In Node tests we exercise this via an injected fake EventSource
// (pattern parallel to SSEDirectorBridge.eventSourceFactory).

import type { ZoneEvent } from './zone-event-envelope.js';
import { parseZoneEnvelopeJson } from './zone-event-envelope.js';
import {
  type IZoneEventBridge,
  type ZoneEventBridgeStatus,
  type ZoneEventBridgeStats,
} from './zone-event-bridge.js';

// Minimal subset of EventSource we depend on. Declared narrowly so
// tests can pass a stub without pulling DOM lib types into Node tests.
export interface SSEZoneBridgeEventSource {
  readonly readyState: number;
  addEventListener(
    type: string,
    listener: (event: { data?: unknown }) => void,
  ): void;
  removeEventListener?(
    type: string,
    listener: (event: { data?: unknown }) => void,
  ): void;
  // Note: we do NOT call close() - the presence layer owns the
  // EventSource lifecycle.
}

export interface SSEZoneBridgeOptions {
  // The live presence EventSource. Acquired from the consumer's
  // presence transport (typically SSEMultiplayerBridge); the bridge
  // attaches a 'zone.event' listener but never closes it.
  eventSource: SSEZoneBridgeEventSource;
  // Local character id - used for diagnostics and (eventually) to
  // filter emitter_id-based UI cues. The local-zone filter itself is
  // applied by ZoneEventSystem against currentZone().
  characterId: string;
  // Returns the local player's current zone. Called per-frame inside
  // the system; the bridge does NOT re-call this on every frame, but
  // exposes it via the constructor so a future drop-foreign-zones-at-
  // receive optimization can be wired in here without changing the
  // system.
  currentZone: () => string;
  // SSE event name to listen for. Defaults to 'zone.event' per spec.
  // Override only for migration tests.
  eventName?: string;
  // If true, the bridge drops events for zones other than the one
  // returned by currentZone() at the moment the frame arrives. Saves
  // memory for foreign-zone events. Defaults to false (system filters).
  filterAtReceive?: boolean;
}

// SSE EventSource readyState constants. Mirrored locally to avoid
// pulling DOM types into the engine's strict Node test config.
const ES_OPEN = 1;
const ES_CLOSED = 2;

export class SSEZoneBridge implements IZoneEventBridge {
  private readonly es: SSEZoneBridgeEventSource;
  private readonly characterId: string;
  private readonly currentZone: () => string;
  private readonly eventName: string;
  private readonly filterAtReceive: boolean;

  private listener: ((event: { data?: unknown }) => void) | null = null;
  private queue: ZoneEvent[] = [];
  private statusValue: ZoneEventBridgeStatus = 'idle';
  private readonly lastEventIdByZone: Map<string, number> = new Map();
  private readonly statsValue: {
    eventsReceived: number;
    reconnects: number;
    outOfOrderEvents: number;
    serverDropsP1: number;
    serverDropsP2: number;
  } = {
    eventsReceived: 0,
    reconnects: 0,
    outOfOrderEvents: 0,
    serverDropsP1: 0,
    serverDropsP2: 0,
  };

  constructor(opts: SSEZoneBridgeOptions) {
    this.es = opts.eventSource;
    this.characterId = opts.characterId;
    this.currentZone = opts.currentZone;
    this.eventName = opts.eventName ?? 'zone.event';
    this.filterAtReceive = opts.filterAtReceive ?? false;
    // characterId is currently used for diagnostics only - reserved
    // for future emitter_id-based UX hooks (e.g. local-cause cues).
    void this.characterId;
  }

  start(): void {
    if (this.listener) return;
    this.listener = (e: { data?: unknown }) => { this.handleRaw(e); };
    this.es.addEventListener(this.eventName, this.listener);
    // The presence EventSource owns connect lifecycle. We mirror its
    // current readyState so consumers can reason about isConnected().
    if (this.es.readyState === ES_OPEN) {
      this.statusValue = 'connected';
    } else if (this.es.readyState === ES_CLOSED) {
      this.statusValue = 'closed';
    } else {
      this.statusValue = 'connecting';
    }
  }

  stop(): void {
    this.statusValue = 'closed';
    if (this.listener && this.es.removeEventListener) {
      this.es.removeEventListener(this.eventName, this.listener);
    }
    this.listener = null;
  }

  status(): ZoneEventBridgeStatus {
    // Refresh from the underlying ES if we're attached - the presence
    // layer handles reconnects, so our cached status can lag.
    if (this.listener) {
      if (this.es.readyState === ES_OPEN) {
        if (this.statusValue === 'connecting' || this.statusValue === 'reconnecting') {
          this.statusValue = 'connected';
        }
      } else if (this.es.readyState === ES_CLOSED) {
        this.statusValue = 'closed';
      }
    }
    return this.statusValue;
  }

  isConnected(): boolean {
    return this.status() === 'connected';
  }

  getLastEventId(zone: string): number {
    return this.lastEventIdByZone.get(zone) ?? 0;
  }

  pollEvents(): ZoneEvent[] {
    if (this.queue.length === 0) return [];
    const out = this.queue;
    this.queue = [];
    return out;
  }

  stats(): Readonly<ZoneEventBridgeStats> {
    return {
      eventsReceived: this.statsValue.eventsReceived,
      reconnects: this.statsValue.reconnects,
      outOfOrderEvents: this.statsValue.outOfOrderEvents,
      serverDropsP1: this.statsValue.serverDropsP1,
      serverDropsP2: this.statsValue.serverDropsP2,
      lastEventIdByZone: new Map(this.lastEventIdByZone),
    };
  }

  // ----- Internal -----

  private handleRaw(e: { data?: unknown }): void {
    const dataStr = typeof e.data === 'string' ? e.data : '';
    const ev = parseZoneEnvelopeJson(dataStr);
    if (!ev) {
      // Malformed envelope - drop. The presence layer's EventSource
      // keeps flowing; one bad frame doesn't kill the channel.
      return;
    }
    if (this.filterAtReceive) {
      // Optional optimization: drop foreign-zone events before they
      // hit the queue. The system would have done it anyway.
      const localZone = safeCurrentZone(this.currentZone);
      if (localZone && ev.zone_id !== localZone) {
        // Still track the highest id for that foreign zone so the
        // bridge's per-zone last-id map is honest about what arrived.
        const prev = this.lastEventIdByZone.get(ev.zone_id) ?? 0;
        if (ev.id > prev) this.lastEventIdByZone.set(ev.zone_id, ev.id);
        return;
      }
    }
    this.statsValue.eventsReceived++;
    const prev = this.lastEventIdByZone.get(ev.zone_id) ?? 0;
    if (ev.id > prev) {
      this.lastEventIdByZone.set(ev.zone_id, ev.id);
    } else {
      this.statsValue.outOfOrderEvents++;
    }
    this.queue.push(ev);
  }
}

function safeCurrentZone(fn: () => string): string | null {
  try {
    const z = fn();
    return typeof z === 'string' && z.length > 0 ? z : null;
  } catch {
    return null;
  }
}
