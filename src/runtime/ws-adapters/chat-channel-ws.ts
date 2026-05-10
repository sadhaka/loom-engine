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
import type { ChatMessage, ChatChannel } from '../chat-channel.js';

export interface ChatWsAdapterOptions<TMeta = Record<string, unknown>> {
  // Existing registry to bind. If omitted, a fresh registry is created.
  registry?: ChatChannelRegistry<TMeta>;
  // Called for successful sends. Consumer broadcasts to channel members.
  onMessage?: (channelId: string, msg: ChatMessage<TMeta>) => void;
  // Called when send is rejected (rate-limit, filtered, etc).
  onReject?: (channelId: string, userId: string, body: string, reason: string) => void;
  // Called for malformed inbound messages.
  onError?: (err: Error, raw: string) => void;
  // REQUIRED nowFn (engine determinism policy). Used for inbound
  // messages that omit a `now` value.
  nowFn: () => number;
}

export interface ChatWsHandle<TMeta = Record<string, unknown>> {
  registry: ChatChannelRegistry<TMeta>;
  ingest(raw: string): string;
}

interface InboundJoin  { type: 'join';  channelId: string; userId: string; now?: number; }
interface InboundLeave { type: 'leave'; channelId: string; userId: string; }
interface InboundSend<TMeta> {
  type: 'send'; channelId: string; userId: string; body: string;
  now?: number; meta?: TMeta;
}

export function attachChatChannelToWs<TMeta = Record<string, unknown>>(
  opts: ChatWsAdapterOptions<TMeta>,
): ChatWsHandle<TMeta> {
  var registry = opts.registry || ChatChannelRegistry.create<TMeta>();
  var nowFn = opts.nowFn;
  var onMessage = opts.onMessage || function () {};
  var onReject = opts.onReject || function () {};
  var onError = opts.onError || function () {};

  function chOrNull(channelId: string): ChatChannel<TMeta> | null {
    return registry.get(channelId);
  }

  function ingest(raw: string): string {
    var parsed: InboundJoin | InboundLeave | InboundSend<TMeta> | null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)), raw);
      return 'unknown';
    }
    if (!parsed || typeof parsed !== 'object') return 'unknown';
    switch (parsed.type) {
      case 'join': {
        var ch = chOrNull(parsed.channelId);
        if (!ch) return 'unknown-channel';
        var t = (typeof parsed.now === 'number' && isFinite(parsed.now)) ? parsed.now : nowFn();
        ch.join(parsed.userId, t);
        return 'join';
      }
      case 'leave': {
        var ch2 = chOrNull(parsed.channelId);
        if (!ch2) return 'unknown-channel';
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
        } else {
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
