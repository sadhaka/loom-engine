// MockZoneBridge - in-memory v2 zone-event source for tests + offline
// demos.
//
// Tests inject envelopes via enqueueIncoming() and let ZoneEventSystem
// drain them. The demo path can also use this when running without a
// backend connection. pollEvents() drains the queue in FIFO order.
//
// Tracks per-zone lastEventId so the IZoneEventBridge contract is
// satisfied. Does not reconnect, does not validate envelopes when fed
// objects directly - that's parseZoneEnvelope's job upstream of
// enqueueIncoming(). enqueueIncomingJson() is a convenience that runs
// the parser first and silently drops malformed payloads (mirrors how
// SSEZoneBridge would handle a bad frame).

import type { ZoneEvent } from './zone-event-envelope.js';
import { parseZoneEnvelopeJson } from './zone-event-envelope.js';
import {
  type IZoneEventBridge,
  type ZoneEventBridgeStatus,
  type ZoneEventBridgeStats,
} from './zone-event-bridge.js';

export class MockZoneBridge implements IZoneEventBridge {
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

  start(): void {
    this.statusValue = 'connected';
  }

  stop(): void {
    this.statusValue = 'closed';
  }

  status(): ZoneEventBridgeStatus {
    return this.statusValue;
  }

  isConnected(): boolean {
    return this.statusValue === 'connected';
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
    // Allocate the read-only view fresh each call so mutations after
    // the call don't leak through. lastEventIdByZone is wrapped in a
    // shallow clone; spec calls this rare so cost is fine.
    return {
      eventsReceived: this.statsValue.eventsReceived,
      reconnects: this.statsValue.reconnects,
      outOfOrderEvents: this.statsValue.outOfOrderEvents,
      serverDropsP1: this.statsValue.serverDropsP1,
      serverDropsP2: this.statsValue.serverDropsP2,
      lastEventIdByZone: new Map(this.lastEventIdByZone),
    };
  }

  // ----- Mock-only injection helpers -----

  // Enqueue a parsed envelope as if the server pushed it. Out-of-order
  // injection is allowed; the consumer's per-zone gap detection should
  // handle it.
  enqueueIncoming(event: ZoneEvent): void {
    this.queue.push(event);
    this.statsValue.eventsReceived++;
    const prev = this.lastEventIdByZone.get(event.zone_id) ?? 0;
    if (event.id > prev) {
      this.lastEventIdByZone.set(event.zone_id, event.id);
    } else {
      this.statsValue.outOfOrderEvents++;
    }
  }

  // Convenience: enqueue from a JSON string. Silently drops malformed
  // payloads, matching the SSE bridge's parse-error behaviour.
  enqueueIncomingJson(json: string): boolean {
    const ev = parseZoneEnvelopeJson(json);
    if (!ev) return false;
    this.enqueueIncoming(ev);
    return true;
  }

  // Convenience: bulk enqueue.
  enqueueAll(events: ReadonlyArray<ZoneEvent>): void {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e) this.enqueueIncoming(e);
    }
  }

  // Mock-only: simulate the server crediting a reconnect.
  bumpReconnect(): void {
    this.statsValue.reconnects++;
  }

  // Mock-only: simulate server-side drop counters from a heartbeat.
  setServerDrops(p1: number, p2: number): void {
    this.statsValue.serverDropsP1 = p1;
    this.statsValue.serverDropsP2 = p2;
  }

  // Inspect-only: how many events are buffered waiting for a poll.
  pending(): number {
    return this.queue.length;
  }
}
