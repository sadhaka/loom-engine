export type LobbyStatus = 'waiting' | 'started' | 'ended';
export interface LobbyMember<T = Record<string, unknown>> {
    id: string;
    ready: boolean;
    joinedAt: number;
    data?: T;
}
export interface LobbyOptions {
    id: string;
    minSize?: number;
    maxSize?: number;
    hostId?: string;
    memberTimeoutMs?: number;
}
export declare class LobbyState<T = Record<string, unknown>> {
    private id_;
    private minSize;
    private maxSize;
    private hostId;
    private status;
    private members;
    private memberTimeoutMs;
    private startedAt;
    private constructor();
    static create<T = Record<string, unknown>>(opts: LobbyOptions): LobbyState<T>;
    join(id: string, data?: T, now?: number): boolean;
    leave(id: string): boolean;
    kick(id: string): boolean;
    markReady(id: string, ready: boolean): boolean;
    touch(id: string, now: number): boolean;
    tick(now: number): string[];
    canStart(): boolean;
    start(now?: number): boolean;
    end(): boolean;
    hasMember(id: string): boolean;
    getMember(id: string): LobbyMember<T> | null;
    members$(): LobbyMember<T>[];
    list(): LobbyMember<T>[];
    count(): number;
    isFull(): boolean;
    getId(): string;
    getStatus(): LobbyStatus;
    getHostId(): string | null;
    getMinSize(): number;
    getMaxSize(): number;
    getStartedAt(): number;
    setHost(newHostId: string): boolean;
    private snapshot;
    private findOldestId;
}
export declare const RESOURCE_LOBBY_STATE = "lobby_state";
//# sourceMappingURL=lobby-state.d.ts.map