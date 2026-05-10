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
export function attachAuthorityHandoffToWs(opts) {
    var handoff = opts.handoff || AuthorityHandoff.create(opts.handoffOptions || {});
    var nowFn = opts.nowFn;
    var onChange = opts.onChange || function () { };
    var onError = opts.onError || function () { };
    var intervalMs = (typeof opts.tickIntervalMs === 'number' && opts.tickIntervalMs >= 0)
        ? opts.tickIntervalMs : 2000;
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
            case 'heartbeat':
                handoff.heartbeat(parsed.id, nowFromMsg(parsed));
                return 'heartbeat';
            case 'leave': {
                var change = handoff.removePeer(parsed.id, nowFromMsg(parsed));
                if (change)
                    onChange(change);
                return 'leave';
            }
            case 'set-host': {
                var change2 = handoff.setHost(parsed.id, nowFromMsg(parsed));
                onChange(change2);
                return 'set-host';
            }
            case 'tick': {
                var change3 = handoff.tick(nowFromMsg(parsed));
                if (change3)
                    onChange(change3);
                return 'tick';
            }
            default:
                return 'unknown';
        }
    }
    function manualTick(now) {
        var t = (typeof now === 'number' && isFinite(now)) ? now : nowFn();
        var change = handoff.tick(t);
        if (change)
            onChange(change);
        return change;
    }
    var timer = null;
    if (intervalMs > 0) {
        timer = setInterval(function () { manualTick(); }, intervalMs);
    }
    return {
        handoff: handoff,
        ingest: ingest,
        tick: manualTick,
        stop: function () { if (timer !== null) {
            clearInterval(timer);
            timer = null;
        } },
    };
}
//# sourceMappingURL=authority-handoff-ws.js.map