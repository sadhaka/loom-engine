// MockMultiplayerBridge - in-memory presence transport for tests +
// offline demos.
//
// Tests inject incoming presence frames via enqueueIncoming() and let
// PeerPresenceSystem drain them. broadcastPosition() captures local
// sends in a getSentBroadcasts() buffer so tests can assert on them.
// pollMessages() drains the inbound queue in FIFO order.
//
// Rate-limiting: shared with the SSE bridge via BROADCAST_MIN_INTERVAL_MS.
// A nowMs() injection point lets tests fast-forward time without
// touching the real clock.
import { BROADCAST_MIN_INTERVAL_MS, } from './multiplayer-bridge.js';
export class MockMultiplayerBridge {
    queue = [];
    statusValue = 'idle';
    statsValue = {
        messagesReceived: 0,
        messagesSent: 0,
        rateLimitedDrops: 0,
        reconnects: 0,
    };
    nowMs;
    lastBroadcastMs = -Infinity;
    sentBroadcasts = [];
    constructor(opts = {}) {
        this.nowMs = opts.nowMs ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    }
    connect() {
        if (this.statusValue === 'connected')
            return;
        this.statusValue = 'connected';
    }
    disconnect() {
        this.statusValue = 'closed';
    }
    status() {
        return this.statusValue;
    }
    pollMessages() {
        if (this.queue.length === 0)
            return [];
        const out = this.queue;
        this.queue = [];
        return out;
    }
    broadcastPosition(x, y, zone, tsMs) {
        const now = this.nowMs();
        if (now - this.lastBroadcastMs < BROADCAST_MIN_INTERVAL_MS) {
            this.statsValue.rateLimitedDrops++;
            return;
        }
        this.lastBroadcastMs = now;
        this.sentBroadcasts.push({ x, y, zone, tsMs, sentAtMs: now });
        this.statsValue.messagesSent++;
    }
    stats() {
        return this.statsValue;
    }
    // ----- Mock-only injection helpers -----
    // Enqueue an inbound presence message as if it came from the server.
    enqueueIncoming(msg) {
        this.queue.push(msg);
        this.statsValue.messagesReceived++;
    }
    enqueueIncomingAll(msgs) {
        for (let i = 0; i < msgs.length; i++) {
            const m = msgs[i];
            if (m)
                this.enqueueIncoming(m);
        }
    }
    // Tests inspect what broadcastPosition let through. Returns the
    // backing array; the caller may copy if they need a snapshot.
    getSentBroadcasts() {
        return this.sentBroadcasts;
    }
    // Convenience: how many inbound messages are waiting for a poll.
    pendingIncoming() {
        return this.queue.length;
    }
    // Reset rate-limiter state. Useful in tests that simulate a
    // reconnect or want a clean slate.
    resetRateLimit() {
        this.lastBroadcastMs = -Infinity;
    }
    // Inspect-only: when did broadcastPosition last send (in nowMs() units).
    getLastBroadcastMs() {
        return this.lastBroadcastMs;
    }
}
//# sourceMappingURL=mock-multiplayer-bridge.js.map