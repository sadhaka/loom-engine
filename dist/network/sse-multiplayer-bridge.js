// SSEMultiplayerBridge - real EventSource subscription to the
// backend's presence endpoint, paired with a fetch POST for outbound
// position broadcasts.
//
// Wire protocol (paired with Track B server-side):
//   GET <baseUrl>?character_id=...&zone=... opens an SSE stream that
//   emits three event types:
//     - 'presence.snapshot' { peers: [{ character_id, x, y, zone, ts_ms, name? }] }
//         emitted once on connect with the full current peer roster.
//     - 'presence.update'   { character_id, x, y, zone, ts_ms, name? }
//         emitted as peers move.
//     - 'presence.depart'   { character_id }
//         emitted when a peer disconnects.
//
//   POST <broadcastUrl> { character_id, x, y, zone, ts_ms }
//     called by broadcastPosition at most BROADCAST_HZ per second.
//     Engine-side rate limit; the bridge silently drops excess calls
//     and increments rateLimitedDrops.
//
// Reconnect strategy: EventSource handles transport-layer reconnect
// internally. We observe via onerror/onopen and surface 'reconnecting'
// to the consumer. On reconnect the server is expected to re-emit a
// fresh 'presence.snapshot', which the PeerPool consumes and treats
// as authoritative (any peer not in the snapshot is dropped).
//
// Browser-only. Constructor throws if EventSource is undefined (Node
// test environment). Tests use MockMultiplayerBridge instead.
import { BROADCAST_MIN_INTERVAL_MS, } from './multiplayer-bridge.js';
export class SSEMultiplayerBridge {
    baseUrl;
    broadcastUrl;
    characterId;
    zone;
    eventSourceFactory;
    fetchFn;
    es = null;
    queue = [];
    statusValue = 'idle';
    statsValue = {
        messagesReceived: 0,
        messagesSent: 0,
        rateLimitedDrops: 0,
        reconnects: 0,
    };
    lastBroadcastMs = -Infinity;
    constructor(opts) {
        this.baseUrl = opts.baseUrl;
        this.broadcastUrl = opts.broadcastUrl ?? defaultBroadcastUrl(opts.baseUrl);
        this.characterId = opts.characterId;
        this.zone = opts.zone;
        if (opts.eventSourceFactory) {
            this.eventSourceFactory = opts.eventSourceFactory;
        }
        else {
            if (typeof EventSource === 'undefined') {
                throw new Error('SSEMultiplayerBridge: EventSource is not available in this environment. Use MockMultiplayerBridge for tests.');
            }
            const ESCtor = EventSource;
            this.eventSourceFactory = (u) => new ESCtor(u, { withCredentials: true });
        }
        if (opts.fetchFn) {
            this.fetchFn = opts.fetchFn;
        }
        else {
            if (typeof fetch === 'undefined') {
                throw new Error('SSEMultiplayerBridge: fetch is not available in this environment.');
            }
            this.fetchFn = fetch.bind(globalThis);
        }
    }
    connect() {
        if (this.es)
            return;
        this.statusValue = 'connecting';
        this.openConnection();
    }
    disconnect() {
        this.statusValue = 'closed';
        this.closeConnection();
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
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (now - this.lastBroadcastMs < BROADCAST_MIN_INTERVAL_MS) {
            this.statsValue.rateLimitedDrops++;
            return;
        }
        this.lastBroadcastMs = now;
        this.statsValue.messagesSent++;
        // Fire-and-forget POST. Errors are surfaced via stats only - the
        // engine doesn't block on the network round trip. The body
        // matches the server contract from the phase 15.1 spec.
        const body = JSON.stringify({
            character_id: this.characterId,
            x,
            y,
            zone,
            ts_ms: tsMs,
        });
        void this.fetchFn(this.broadcastUrl, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body,
        }).catch(() => { });
    }
    stats() {
        return this.statsValue;
    }
    // ----- Internal -----
    buildUrl() {
        const sep = this.baseUrl.includes('?') ? '&' : '?';
        return (this.baseUrl +
            sep +
            'character_id=' + encodeURIComponent(this.characterId) +
            '&zone=' + encodeURIComponent(this.zone));
    }
    openConnection() {
        const url = this.buildUrl();
        let es;
        try {
            es = this.eventSourceFactory(url);
        }
        catch (err) {
            this.statusValue = 'closed';
            throw err;
        }
        this.es = es;
        es.onopen = () => {
            this.statusValue = 'connected';
        };
        es.onerror = () => {
            const closed = es.readyState === 2; // EventSource.CLOSED
            if (closed) {
                this.statusValue = 'closed';
                this.closeConnection();
                return;
            }
            this.statusValue = 'reconnecting';
            this.statsValue.reconnects++;
        };
        es.addEventListener('presence.update', (e) => {
            this.handleUpdate(e);
        });
        es.addEventListener('presence.depart', (e) => {
            this.handleDepart(e);
        });
        es.addEventListener('presence.snapshot', (e) => {
            this.handleSnapshot(e);
        });
    }
    closeConnection() {
        if (!this.es)
            return;
        try {
            this.es.close();
        }
        catch { /* ignore */ }
        this.es = null;
    }
    handleUpdate(e) {
        const data = parseJson(e.data);
        if (!data || typeof data !== 'object')
            return;
        const characterId = data.character_id;
        const x = data.x;
        const y = data.y;
        const zone = data.zone;
        const tsMs = data.ts_ms;
        if (typeof characterId !== 'string')
            return;
        if (typeof x !== 'number' || typeof y !== 'number')
            return;
        if (typeof zone !== 'string')
            return;
        if (typeof tsMs !== 'number')
            return;
        const name = data.name;
        this.statsValue.messagesReceived++;
        this.queue.push({
            kind: 'update',
            characterId,
            x,
            y,
            zone,
            tsMs,
            ...(typeof name === 'string' ? { name } : {}),
        });
    }
    handleDepart(e) {
        const data = parseJson(e.data);
        if (!data || typeof data !== 'object')
            return;
        const characterId = data.character_id;
        if (typeof characterId !== 'string')
            return;
        this.statsValue.messagesReceived++;
        this.queue.push({ kind: 'depart', characterId });
    }
    handleSnapshot(e) {
        const data = parseJson(e.data);
        if (!data || typeof data !== 'object')
            return;
        const peersRaw = data.peers;
        if (!Array.isArray(peersRaw))
            return;
        const peers = [];
        for (let i = 0; i < peersRaw.length; i++) {
            const p = peersRaw[i];
            if (!p || typeof p !== 'object')
                continue;
            const characterId = p.character_id;
            const x = p.x;
            const y = p.y;
            const zone = p.zone;
            const tsMs = p.ts_ms;
            if (typeof characterId !== 'string')
                continue;
            if (typeof x !== 'number' || typeof y !== 'number')
                continue;
            if (typeof zone !== 'string')
                continue;
            if (typeof tsMs !== 'number')
                continue;
            const name = p.name;
            peers.push({
                characterId,
                x,
                y,
                zone,
                tsMs,
                ...(typeof name === 'string' ? { name } : {}),
            });
        }
        this.statsValue.messagesReceived++;
        this.queue.push({ kind: 'snapshot', peers });
    }
}
function parseJson(raw) {
    if (typeof raw !== 'string')
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function defaultBroadcastUrl(baseUrl) {
    if (baseUrl.endsWith('/events')) {
        return baseUrl.slice(0, -'/events'.length) + '/move';
    }
    return baseUrl + '/move';
}
//# sourceMappingURL=sse-multiplayer-bridge.js.map