// MockDirectorBridge - in-memory event source for tests + offline demos.
//
// Tests inject envelopes via enqueue() and let DirectorSystem drain
// them. The demo can also use this when running without a backend
// connection (e.g. open file:// or no auth). pollEvents() drains the
// queue in FIFO order.
//
// Tracks lastEventId so the bridge contract is satisfied (gap detection
// in DirectorSystem reads lastEventId after each poll). Does not
// reconnect, does not validate envelopes - that's parseEnvelope's job
// upstream of enqueue().
export class MockDirectorBridge {
    queue = [];
    statusValue = 'idle';
    statsValue = {
        eventsReceived: 0,
        reconnects: 0,
        lastEventId: 0,
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
    getLastEventId() {
        return this.statsValue.lastEventId;
    }
    pollEvents() {
        if (this.queue.length === 0)
            return [];
        const out = this.queue;
        this.queue = [];
        return out;
    }
    stats() {
        return this.statsValue;
    }
    // ----- Mock-only injection helpers -----
    // Enqueue an envelope as if it came from the server. Out-of-order
    // injection is allowed; the consumer's gap detection logic should
    // handle it.
    enqueue(event) {
        this.queue.push(event);
        this.statsValue.eventsReceived++;
        if (event.id > this.statsValue.lastEventId) {
            this.statsValue.lastEventId = event.id;
        }
        else {
            this.statsValue.outOfOrderEvents++;
        }
    }
    // Convenience: enqueue a batch in order.
    enqueueAll(events) {
        for (let i = 0; i < events.length; i++) {
            const e = events[i];
            if (e)
                this.enqueue(e);
        }
    }
    // Inspect-only: how many events are buffered waiting for a poll.
    pending() {
        return this.queue.length;
    }
}
//# sourceMappingURL=mock-director-bridge.js.map