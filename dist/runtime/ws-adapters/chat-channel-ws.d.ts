import { ChatChannelRegistry } from '../chat-channel.js';
import type { ChatMessage } from '../chat-channel.js';
export interface ChatWsAdapterOptions<TMeta = Record<string, unknown>> {
    registry?: ChatChannelRegistry<TMeta>;
    onMessage?: (channelId: string, msg: ChatMessage<TMeta>) => void;
    onReject?: (channelId: string, userId: string, body: string, reason: string) => void;
    onError?: (err: Error, raw: string) => void;
    nowFn: () => number;
}
export interface ChatWsHandle<TMeta = Record<string, unknown>> {
    registry: ChatChannelRegistry<TMeta>;
    ingest(raw: string): string;
}
export declare function attachChatChannelToWs<TMeta = Record<string, unknown>>(opts: ChatWsAdapterOptions<TMeta>): ChatWsHandle<TMeta>;
//# sourceMappingURL=chat-channel-ws.d.ts.map