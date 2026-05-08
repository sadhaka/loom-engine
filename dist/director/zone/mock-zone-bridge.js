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
import { parseZoneEnvelopeJson } from './zone-event-envelope.js';
export class MockZoneBridge {
    queue = [];
    statusValue = 'idle';
    lastEventIdByZone = new Map();
    statsValue = {
        eventsReceived: 0,
        reconnects: 0,
        outOfOrderEvents: 0,
        serverDropsP1: 0,
        serverDropsP2: 0,
    };
    start() {
        this.statusValue = 'connected';
    }
    stop() {
        this.statusValue = 'closed';
    }
    status() {
        return this.statusValue;
    }
    isConnected() {
        return this.statusValue === 'connected';
    }
    getLastEventId(zone) {
        return this.lastEventIdByZone.get(zone) ?? 0;
    }
    pollEvents() {
        if (this.queue.length === 0)
            return [];
        const out = this.queue;
        this.queue = [];
        return out;
    }
    stats() {
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
    enqueueIncoming(event) {
        this.queue.push(event);
        this.statsValue.eventsReceived++;
        const prev = this.lastEventIdByZone.get(event.zone_id) ?? 0;
        if (event.id > prev) {
            this.lastEventIdByZone.set(event.zone_id, event.id);
        }
        else {
            this.statsValue.outOfOrderEvents++;
        }
    }
    // Convenience: enqueue from a JSON string. Silently drops malformed
    // payloads, matching the SSE bridge's parse-error behaviour.
    enqueueIncomingJson(json) {
        const ev = parseZoneEnvelopeJson(json);
        if (!ev)
            return false;
        this.enqueueIncoming(ev);
        return true;
    }
    // Convenience: bulk enqueue.
    enqueueAll(events) {
        for (let i = 0; i < events.length; i++) {
            const e = events[i];
            if (e)
                this.enqueueIncoming(e);
        }
    }
    // Mock-only: simulate the server crediting a reconnect.
    bumpReconnect() {
        this.statsValue.reconnects++;
    }
    // Mock-only: simulate server-side drop counters from a heartbeat.
    setServerDrops(p1, p2) {
        this.statsValue.serverDropsP1 = p1;
        this.statsValue.serverDropsP2 = p2;
    }
    // Inspect-only: how many events are buffered waiting for a poll.
    pending() {
        return this.queue.length;
    }
}
//# sourceMappingURL=mock-zone-bridge.js.map