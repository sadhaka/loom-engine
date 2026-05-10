import { AuthorityHandoff } from '../authority-handoff.js';
import type { AuthorityOptions, AuthorityChange } from '../authority-handoff.js';
export interface AuthorityWsAdapterOptions {
    handoff?: AuthorityHandoff;
    handoffOptions?: AuthorityOptions;
    onChange?: (change: AuthorityChange) => void;
    onError?: (err: Error, raw: string) => void;
    tickIntervalMs?: number;
    nowFn: () => number;
}
export interface AuthorityWsHandle {
    handoff: AuthorityHandoff;
    ingest(raw: string): string;
    tick(now?: number): AuthorityChange | null;
    stop(): void;
}
export declare function attachAuthorityHandoffToWs(opts: AuthorityWsAdapterOptions): AuthorityWsHandle;
//# sourceMappingURL=authority-handoff-ws.d.ts.map