export interface ChatMessage<TMeta = Record<string, unknown>> {
    id: number;
    sender: string;
    body: string;
    sentAt: number;
    meta?: TMeta;
}
export interface ChatMember {
    id: string;
    joinedAt: number;
    recentSendsAt: number[];
}
export interface SendResult<TMeta = Record<string, unknown>> {
    ok: boolean;
    message: ChatMessage<TMeta> | null;
    reason?: string;
}
export type ChatFilter<TMeta = Record<string, unknown>> = (msg: ChatMessage<TMeta>) => ChatMessage<TMeta> | null;
export interface ChatChannelOptions {
    id: string;
    historySize?: number;
    rateLimitMessages?: number;
    rateLimitWindowMs?: number;
    maxBodyLen?: number;
}
export declare class ChatChannel<TMeta = Record<string, unknown>> {
    private channelId;
    private members;
    private history;
    private filters;
    private historySize;
    private rateLimitMessages;
    private rateLimitWindowMs;
    private maxBodyLen;
    private nextMessageId;
    private constructor();
    static create<TMeta = Record<string, unknown>>(opts: ChatChannelOptions): ChatChannel<TMeta>;
    getId(): string;
    join(id: string, now: number): boolean;
    leave(id: string): boolean;
    hasMember(id: string): boolean;
    memberCount(): number;
    members$(): ChatMember[];
    installFilter(fn: ChatFilter<TMeta>): void;
    uninstallFilter(fn: ChatFilter<TMeta>): boolean;
    filterCount(): number;
    send(senderId: string, body: string, now: number, meta?: TMeta): SendResult<TMeta>;
    recent(limit?: number): ChatMessage<TMeta>[];
    historyLength(): number;
    clearHistory(): void;
    getRateLimitMessages(): number;
    getRateLimitWindowMs(): number;
    getHistorySize(): number;
    getMaxBodyLen(): number;
    sendsInWindow(senderId: string, now: number): number;
}
export declare class ChatChannelRegistry<TMeta = Record<string, unknown>> {
    private channels;
    static create<TMeta = Record<string, unknown>>(): ChatChannelRegistry<TMeta>;
    create(opts: ChatChannelOptions): ChatChannel<TMeta>;
    get(id: string): ChatChannel<TMeta> | null;
    has(id: string): boolean;
    remove(id: string): boolean;
    count(): number;
    ids(): string[];
    clear(): void;
}
export declare const RESOURCE_CHAT_CHANNEL = "chat_channel";
export declare const RESOURCE_CHAT_CHANNEL_REGISTRY = "chat_channel_registry";
//# sourceMappingURL=chat-channel.d.ts.map