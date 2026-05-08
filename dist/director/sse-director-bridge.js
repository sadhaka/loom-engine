// SSEDirectorBridge - real EventSource subscription to the backend's
// /api/v1/loom/director/events endpoint.
//
// Per LOOM-DIRECTOR-PROTOCOL.md Section 2: SSE primary, Last-Event-ID
// replay, JSON payload per frame. The renderer never decides palette
// or VE tier (Section 5.1, 6.5); it just receives events and feeds
// them to DirectorSystem.
//
// Reconnect strategy (0.20.0):
//   - On EventSource onerror, the bridge takes ownership of the retry
//     loop. The connection is closed and a manual reconnect is
//     scheduled with exponential backoff + full jitter:
//       delay_n = min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2^n)
//                 + uniform jitter in [0, BASE_BACKOFF_MS).
//   - The attempt counter resets on a successful onopen.
//   - The bridge sends the last-seen event id as a query parameter
//     (?last_event_id=N) on every (re)connect URL so the server can
//     replay the gap. Native EventSource also forwards Last-Event-ID
//     as an HTTP header during its built-in retry (which we no longer
//     rely on), so the query param is the canonical replay path.
//   - The canonical server-side replay endpoint is documented at
//     LOOM-DIRECTOR-PROTOCOL-V2 sec.3 (per-zone) - the equivalent v1
//     route is /api/v1/loom/director/events?since=N. The bridge sends
//     both ?last_event_id and ?since for forward compatibility.
//
// Status state machine (0.20.0):
//   idle -> connecting -> connected
//   connected -> reconnecting -> connecting -> connected
//   any -> closed (terminal until start())
//   any -> snapshot-required (terminal; consumer must rebuild)
//
// Browser-only. Constructor throws if EventSource is undefined (Node
// test environment) UNLESS eventSourceFactory is provided. Tests use
// MockDirectorBridge or inject a fake factory.
import { parseEnvelopeJson } from './event-envelope.js';
// ----- Backoff defaults (0.20.0) -----
// Configurable via constructor opts. Defaults chosen for SSE polling:
// 500ms first try is short enough to feel responsive; 30s cap matches
// most CDN edge keep-alive windows.
var DEFAULT_BASE_BACKOFF_MS = 500;
var DEFAULT_MAX_BACKOFF_MS = 30000;
// CustomEvent type emitted on globalThis (typically window) at every
// status transition. Consumers wire UI off this.
var STATUS_EVENT_TYPE = 'arpg:director-bridge-status';
export class SSEDirectorBridge {
    baseUrl;
    characterId;
    fps;
    dropP2;
    eventSourceFactory;
    baseBackoffMs;
    maxBackoffMs;
    setTimeoutFn;
    clearTimeoutFn;
    randomFn;
    nowFn;
    statusEventTarget;
    es = null;
    queue = [];
    statusValue = 'idle';
    statsValue = {
        eventsReceived: 0,
        reconnects: 0,
        lastEventId: 0,
        outOfOrderEvents: 0,
        serverDropsP1: 0,
        serverDropsP2: 0,
        lastConnectedAtMs: 0,
        lastDisconnectedAtMs: 0,
        totalConnectsCount: 0,
        totalDisconnectsCount: 0,
        currentReconnectAttempt: 0,
    };
    // Reorder buffer (Section 4.2). Max 32 entries; drained when the
    // missing id arrives or after a 500ms timeout that triggers reconnect.
    reorderBuffer = new Map();
    reorderTimeoutHandle = null;
    static REORDER_BUFFER_MAX = 32;
    static REORDER_TIMEOUT_MS = 500;
    // Reconnect scheduling state (0.20.0).
    reconnectAttempt = 0;
    reconnectTimeoutHandle = null;
    // True from start() until stop() is called. Guards the reconnect
    // loop so a stopped bridge stays stopped.
    running = false;
    constructor(opts) {
        this.baseUrl = opts.baseUrl;
        this.characterId = opts.characterId;
        this.fps = opts.fps !== undefined ? opts.fps : 60;
        this.dropP2 = opts.dropP2 !== undefined ? opts.dropP2 : true;
        this.baseBackoffMs = opts.baseBackoffMs !== undefined ? opts.baseBackoffMs : DEFAULT_BASE_BACKOFF_MS;
        this.maxBackoffMs = opts.maxBackoffMs !== undefined ? opts.maxBackoffMs : DEFAULT_MAX_BACKOFF_MS;
        this.setTimeoutFn = opts.setTimeoutFn || function (fn, ms) { return setTimeout(fn, ms); };
        this.clearTimeoutFn = opts.clearTimeoutFn || function (h) { clearTimeout(h); };
        this.randomFn = opts.randomFn || Math.random;
        this.nowFn = opts.nowFn || function () { return Date.now(); };
        if (opts.statusEventTarget === null) {
            this.statusEventTarget = null;
        }
        else if (opts.statusEventTarget !== undefined) {
            this.statusEventTarget = opts.statusEventTarget;
        }
        else {
            var defaultTarget = null;
            try {
                defaultTarget = (typeof globalThis !== 'undefined' && globalThis.window)
                    ? globalThis.window
                    : null;
            }
            catch {
                defaultTarget = null;
            }
            this.statusEventTarget = defaultTarget;
        }
        if (typeof opts.initialLastEventId === 'number' && opts.initialLastEventId > 0) {
            this.statsValue.lastEventId = opts.initialLastEventId;
        }
        if (opts.eventSourceFactory) {
            this.eventSourceFactory = opts.eventSourceFactory;
        }
        else {
            if (typeof EventSource === 'undefined') {
                throw new Error('SSEDirectorBridge: EventSource is not available in this environment. Use MockDirectorBridge for tests.');
            }
            var ESCtor = EventSource;
            this.eventSourceFactory = function (u) { return new ESCtor(u, { withCredentials: true }); };
        }
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        this.transitionTo('connecting');
        this.openConnection();
    }
    stop() {
        this.running = false;
        this.cancelReconnect();
        this.closeConnection();
        this.clearReorderBuffer();
        this.transitionTo('closed');
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
        var out = this.queue;
        this.queue = [];
        return out;
    }
    stats() {
        return this.statsValue;
    }
    // ----- Internal -----
    buildUrl() {
        var sep = this.baseUrl.indexOf('?') >= 0 ? '&' : '?';
        var url = this.baseUrl
            + sep
            + 'character_id=' + encodeURIComponent(this.characterId)
            + '&fps=' + this.fps
            + '&drop_p2=' + (this.dropP2 ? 'true' : 'false');
        // Last-Event-Id idempotent replay (0.20.0). EventSource forwards
        // Last-Event-ID as an HTTP header during native auto-reconnect,
        // but we now manage retries ourselves so the query param is the
        // canonical replay path. We send BOTH ?last_event_id (legacy
        // route param) and ?since= (canonical per LOOM-DIRECTOR-PROTOCOL
        // V2 sec.3) for forward compat.
        if (this.statsValue.lastEventId > 0) {
            url += '&last_event_id=' + this.statsValue.lastEventId;
            url += '&since=' + this.statsValue.lastEventId;
        }
        return url;
    }
    openConnection() {
        var url = this.buildUrl();
        var es;
        try {
            es = this.eventSourceFactory(url);
        }
        catch (err) {
            this.running = false;
            this.transitionTo('closed');
            throw err;
        }
        this.es = es;
        var self = this;
        es.onopen = function () {
            // Reset attempt counter on a successful (re)open. Total connect
            // count bumps; lastConnectedAtMs latches the timestamp.
            self.reconnectAttempt = 0;
            self.statsValue.currentReconnectAttempt = 0;
            self.statsValue.totalConnectsCount++;
            self.statsValue.lastConnectedAtMs = self.nowFn();
            self.transitionTo('connected');
        };
        es.onerror = function () {
            // EventSource has hit an error. We take ownership of the retry:
            // close the EventSource and schedule a manual reconnect with
            // exponential backoff + jitter.
            var closed = es.readyState === 2; // EventSource.CLOSED
            // Track the disconnect even on the first error.
            self.statsValue.totalDisconnectsCount++;
            self.statsValue.lastDisconnectedAtMs = self.nowFn();
            if (!self.running) {
                // Stopped while the connection was open - just close out.
                self.closeConnection();
                self.transitionTo('closed');
                return;
            }
            if (closed) {
                // Server explicitly closed (or auth rejection). We still try
                // to reconnect with backoff per spec - the consumer should
                // call stop() if they want to abort.
                self.closeConnection();
            }
            else {
                // Connection in transient-error state. Close it ourselves so
                // the native auto-retry doesn't fire alongside our scheduled
                // reconnect.
                self.closeConnection();
            }
            self.statsValue.reconnects++;
            self.transitionTo('reconnecting');
            self.scheduleReconnect();
        };
        // The default 'message' event captures frames with no event: line.
        // The backend uses event: <type> for everything per spec, so we
        // route on the 'event' name. Subscribing to a few key types
        // explicitly keeps EventSource from coalescing them under 'message'.
        es.onmessage = function (e) {
            self.handleRaw(e);
        };
        // Subscribe to all known event types so EventSource fires the
        // type-specific listener, not just onmessage. This makes the SSE
        // 'event:' line meaningful.
        var knownTypes = [
            'encounter.spawn',
            'encounter.tick',
            'encounter.end',
            'encounter.loot',
            'knot.context',
            've.budget.update',
            'scene.transition',
            'narrator.line',
            'system.heartbeat',
            'system.replay.complete',
            'system.snapshot.required',
        ];
        for (var i = 0; i < knownTypes.length; i++) {
            var t = knownTypes[i];
            if (!t)
                continue;
            es.addEventListener(t, function (e) {
                self.handleRaw(e);
            });
        }
    }
    // Compute the next reconnect delay and schedule openConnection().
    // Public-by-name only to make it visible in the type hierarchy when
    // a future subclass wants to peek; consumers should not call this.
    scheduleReconnect() {
        if (!this.running)
            return;
        if (this.reconnectTimeoutHandle !== null)
            return;
        var attempt = this.reconnectAttempt;
        // delay_n = min(MAX, BASE * 2^n) + jitter(0, BASE)
        var exp = this.baseBackoffMs * Math.pow(2, attempt);
        var capped = exp > this.maxBackoffMs ? this.maxBackoffMs : exp;
        var jitter = this.randomFn() * this.baseBackoffMs;
        var delay = Math.floor(capped + jitter);
        this.reconnectAttempt = attempt + 1;
        this.statsValue.currentReconnectAttempt = this.reconnectAttempt;
        try {
            // Diagnostic log - expected to be rare, fine to write to console
            // even in production. The bridge is silent on the happy path.
            // eslint-disable-next-line no-console
            console.log('[SSEDirectorBridge] reconnect attempt #' + this.reconnectAttempt + ' in ' + delay + 'ms');
        }
        catch { /* ignore */ }
        var self = this;
        this.reconnectTimeoutHandle = this.setTimeoutFn(function () {
            self.reconnectTimeoutHandle = null;
            if (!self.running)
                return;
            self.transitionTo('connecting');
            self.openConnection();
        }, delay);
    }
    cancelReconnect() {
        if (this.reconnectTimeoutHandle !== null) {
            try {
                this.clearTimeoutFn(this.reconnectTimeoutHandle);
            }
            catch { /* ignore */ }
            this.reconnectTimeoutHandle = null;
        }
        this.reconnectAttempt = 0;
        this.statsValue.currentReconnectAttempt = 0;
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
    handleRaw(e) {
        var dataStr = typeof e.data === 'string' ? e.data : '';
        var ev = parseEnvelopeJson(dataStr);
        if (!ev) {
            // Malformed envelope - log + drop. EventSource will keep flowing.
            // In v1 we don't kill the stream on a single bad payload.
            return;
        }
        this.statsValue.eventsReceived++;
        // System events drive bridge behaviour even if the consumer
        // hasn't drained yet.
        if (ev.type === 'system.heartbeat') {
            this.statsValue.serverDropsP1 = ev.data.drops_p1;
            this.statsValue.serverDropsP2 = ev.data.drops_p2;
            // Heartbeats are still surfaced to the consumer (it may want to
            // log / display drop counters) but they don't gate the gap-
            // detection logic - just stash and pass through.
        }
        if (ev.type === 'system.snapshot.required') {
            this.running = false;
            this.cancelReconnect();
            this.transitionTo('snapshot-required');
            // Surface to the consumer + close. The application layer must
            // fetch /state and build a fresh bridge.
            this.queue.push(ev);
            this.closeConnection();
            return;
        }
        var expected = this.statsValue.lastEventId + 1;
        if (ev.id === expected) {
            // In-order. Push + drain any reorder buffer entries that now
            // contiguously follow.
            this.statsValue.lastEventId = ev.id;
            this.queue.push(ev);
            this.drainReorderBuffer();
        }
        else if (ev.id > expected) {
            // Future event - hold in reorder buffer up to REORDER_BUFFER_MAX.
            // Reset the timeout so the buffer fires eventually.
            this.statsValue.outOfOrderEvents++;
            if (this.reorderBuffer.size < SSEDirectorBridge.REORDER_BUFFER_MAX) {
                this.reorderBuffer.set(ev.id, ev);
                this.armReorderTimeout();
            }
            else {
                // Buffer full - hard gap. Force-flush the buffer in id order
                // and accept the gap. Consumer's gap detection should treat
                // this like a missed range.
                this.flushReorderBufferAsIs();
                this.statsValue.lastEventId = ev.id;
                this.queue.push(ev);
            }
        }
        else {
            // Past event (lastEventId already advanced beyond this). Likely
            // a duplicate from EventSource's at-least-once delivery during
            // reconnect; drop silently.
        }
    }
    armReorderTimeout() {
        if (this.reorderTimeoutHandle !== null)
            return;
        var self = this;
        this.reorderTimeoutHandle = this.setTimeoutFn(function () {
            self.reorderTimeoutHandle = null;
            // Timeout: flush whatever's in the buffer in id order. The
            // missing ids are skipped; consumer's lastEventId advances.
            self.flushReorderBufferAsIs();
        }, SSEDirectorBridge.REORDER_TIMEOUT_MS);
    }
    drainReorderBuffer() {
        while (true) {
            var next = this.statsValue.lastEventId + 1;
            var ev = this.reorderBuffer.get(next);
            if (!ev)
                break;
            this.reorderBuffer.delete(next);
            this.statsValue.lastEventId = next;
            this.queue.push(ev);
        }
        if (this.reorderBuffer.size === 0 && this.reorderTimeoutHandle !== null) {
            try {
                this.clearTimeoutFn(this.reorderTimeoutHandle);
            }
            catch { /* ignore */ }
            this.reorderTimeoutHandle = null;
        }
    }
    flushReorderBufferAsIs() {
        if (this.reorderBuffer.size === 0)
            return;
        var ids = Array.from(this.reorderBuffer.keys()).sort(function (a, b) { return a - b; });
        for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            if (id === undefined)
                continue;
            var ev = this.reorderBuffer.get(id);
            if (!ev)
                continue;
            this.queue.push(ev);
            if (id > this.statsValue.lastEventId)
                this.statsValue.lastEventId = id;
        }
        this.reorderBuffer.clear();
        if (this.reorderTimeoutHandle !== null) {
            try {
                this.clearTimeoutFn(this.reorderTimeoutHandle);
            }
            catch { /* ignore */ }
            this.reorderTimeoutHandle = null;
        }
    }
    clearReorderBuffer() {
        this.reorderBuffer.clear();
        if (this.reorderTimeoutHandle !== null) {
            try {
                this.clearTimeoutFn(this.reorderTimeoutHandle);
            }
            catch { /* ignore */ }
            this.reorderTimeoutHandle = null;
        }
    }
    // 0.20.0: status state machine. Centralizes:
    //   - status field write
    //   - log line (diagnostic)
    //   - CustomEvent dispatch on the configured target
    // Idempotent: re-entering the same status is a no-op.
    transitionTo(next) {
        if (this.statusValue === next)
            return;
        var prev = this.statusValue;
        this.statusValue = next;
        try {
            // eslint-disable-next-line no-console
            console.log('[SSEDirectorBridge] status ' + prev + ' -> ' + next);
        }
        catch { /* ignore */ }
        var target = this.statusEventTarget;
        if (!target)
            return;
        try {
            var ce = new CustomEvent(STATUS_EVENT_TYPE, { detail: { from: prev, to: next, characterId: this.characterId } });
            target.dispatchEvent(ce);
        }
        catch { /* ignore - some headless targets reject CustomEvent */ }
    }
}
//# sourceMappingURL=sse-director-bridge.js.map