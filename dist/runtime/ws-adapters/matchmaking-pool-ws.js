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
export function attachMatchmakingPoolToWs(opts) {
    var pool = opts.pool || MatchmakingPool.create(opts.poolOptions || {});
    var nowFn = opts.nowFn;
    var onMatch = opts.onMatch || function () { };
    var onError = opts.onError || function () { };
    var intervalMs = (typeof opts.tickIntervalMs === 'number' && opts.tickIntervalMs >= 0)
        ? opts.tickIntervalMs : 1000;
    function nowFromMsg(msg) {
        if (typeof msg.now === 'number' && isFinite(msg.now))
            return msg.now;
        return nowFn();
    }
    function ingest(raw) {
        var parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch (e) {
            onError(e instanceof Error ? e : new Error(String(e)), raw);
            return 'unknown';
        }
        if (!parsed || typeof parsed !== 'object')
            return 'unknown';
        switch (parsed.type) {
            case 'queue': {
                var qOpts = {};
                if (typeof parsed.partySize === 'number')
                    qOpts.partySize = parsed.partySize;
                if (parsed.data !== undefined)
                    qOpts.data = parsed.data;
                pool.queue(parsed.id, parsed.skill, nowFromMsg(parsed), qOpts);
                return 'queue';
            }
            case 'cancel': {
                pool.cancel(parsed.id);
                return 'cancel';
            }
            case 'tick': {
                var matches = pool.tick(nowFromMsg(parsed));
                if (matches.length > 0)
                    onMatch(matches);
                return 'tick';
            }
            default:
                return 'unknown';
        }
    }
    function manualTick(now) {
        var t = (typeof now === 'number' && isFinite(now)) ? now : nowFn();
        var matches = pool.tick(t);
        if (matches.length > 0)
            onMatch(matches);
        return matches;
    }
    // Auto-tick interval (server-side driver). setInterval is browser +
    // Node compatible; consumer can disable with tickIntervalMs: 0.
    var timer = null;
    if (intervalMs > 0) {
        timer = setInterval(function () { manualTick(); }, intervalMs);
    }
    return {
        pool: pool,
        ingest: ingest,
        tick: manualTick,
        stop: function () { if (timer !== null) {
            clearInterval(timer);
            timer = null;
        } },
    };
}
//# sourceMappingURL=matchmaking-pool-ws.js.map