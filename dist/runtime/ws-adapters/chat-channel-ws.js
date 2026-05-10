// ChatChannel WebSocket adapter (1.7.5 milestone reference adapter).
//
// Wires ChatChannelRegistry to a WebSocket so consumers don't have
// to hand-write the chat protocol. Multi-channel via channelId field
// on every message.
//
// Inbound (parsed JSON):
//   { type: 'join',  channelId, userId, now? }
//   { type: 'leave', channelId, userId }
//   { type: 'send',  channelId, userId, body, now?, meta? }
//
// Outbound (callbacks):
//   onMessage(channelId, msg)  - fires when a send produces a message
//                                that survived rate-limit + filters
//   onReject(channelId, userId, body, reason) - send rejected
//
// Code style: var-only in browser source.
import { ChatChannelRegistry } from '../chat-channel.js';
export function attachChatChannelToWs(opts) {
    var registry = opts.registry || ChatChannelRegistry.create();
    var nowFn = opts.nowFn;
    var onMessage = opts.onMessage || function () { };
    var onReject = opts.onReject || function () { };
    var onError = opts.onError || function () { };
    function chOrNull(channelId) {
        return registry.get(channelId);
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
            case 'join': {
                var ch = chOrNull(parsed.channelId);
                if (!ch)
                    return 'unknown-channel';
                var t = (typeof parsed.now === 'number' && isFinite(parsed.now)) ? parsed.now : nowFn();
                ch.join(parsed.userId, t);
                return 'join';
            }
            case 'leave': {
                var ch2 = chOrNull(parsed.channelId);
                if (!ch2)
                    return 'unknown-channel';
                ch2.leave(parsed.userId);
                return 'leave';
            }
            case 'send': {
                var ch3 = chOrNull(parsed.channelId);
                if (!ch3) {
                    onReject(parsed.channelId, parsed.userId, parsed.body, 'unknown-channel');
                    return 'unknown-channel';
                }
                var t2 = (typeof parsed.now === 'number' && isFinite(parsed.now)) ? parsed.now : nowFn();
                var result = ch3.send(parsed.userId, parsed.body, t2, parsed.meta);
                if (result.ok && result.message) {
                    onMessage(parsed.channelId, result.message);
                }
                else {
                    onReject(parsed.channelId, parsed.userId, parsed.body, result.reason || 'unknown');
                }
                return 'send';
            }
            default:
                return 'unknown';
        }
    }
    return { registry: registry, ingest: ingest };
}
//# sourceMappingURL=chat-channel-ws.js.map