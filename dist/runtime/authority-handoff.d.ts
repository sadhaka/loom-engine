export interface AuthorityPeer {
    id: string;
    firstSeenAt: number;
    lastSeenAt: number;
}
export type ElectionStrategy = 'oldest' | 'lowest-id' | ((peers: AuthorityPeer[]) => string | null);
export interface AuthorityChange {
    kind: 'handoff' | 'host-leave' | 'no-host' | 'reclaim';
    oldHostId: string | null;
    newHostId: string | null;
    at: number;
}
export interface AuthorityOptions {
    hostId?: string;
    timeoutMs?: number;
    electionStrategy?: ElectionStrategy;
}
export declare class AuthorityHandoff {
    private peers;
    private hostId;
    private timeoutMs;
    private strategy;
    private constructor();
    static create(opts?: AuthorityOptions): AuthorityHandoff;
    heartbeat(id: string, now: number): void;
    setHost(newHost: string | null, now: number): AuthorityChange;
    removePeer(id: string, now: number): AuthorityChange | null;
    tick(now: number): AuthorityChange | null;
    elect(): string | null;
    getHostId(): string | null;
    hasPeer(id: string): boolean;
    peerCount(): number;
    list(): AuthorityPeer[];
    getTimeoutMs(): number;
    setTimeoutMs(ms: number): void;
    clear(): void;
}
export declare const RESOURCE_AUTHORITY_HANDOFF = "authority_handoff";
//# sourceMappingURL=authority-handoff.d.ts.map