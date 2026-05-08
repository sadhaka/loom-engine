export interface PeerEntry {
    characterId: string;
    zone: string;
    name: string | null;
    prevX: number;
    prevY: number;
    prevTsMs: number;
    currentX: number;
    currentY: number;
    currentTsMs: number;
    lastRenderedFrame: number;
}
export interface RenderedPeerView {
    characterId: string;
    x: number;
    y: number;
    zone: string;
    name: string | null;
}
export declare class PeerPool {
    private peers;
    private localCharacterId;
    private scratchView;
    setLocalCharacterId(id: string | null): void;
    getLocalCharacterId(): string | null;
    upsert(characterId: string, x: number, y: number, zone: string, tsMs: number, name?: string): void;
    applySnapshot(peers: ReadonlyArray<{
        characterId: string;
        x: number;
        y: number;
        zone: string;
        tsMs: number;
        name?: string;
    }>): void;
    remove(characterId: string): boolean;
    has(characterId: string): boolean;
    size(): number;
    get(characterId: string): Readonly<PeerEntry> | undefined;
    forEachRendered(nowMs: number, frame: number, fn: (view: Readonly<RenderedPeerView>) => void): void;
    getRenderedPosition(characterId: string, nowMs: number): {
        x: number;
        y: number;
    } | null;
    clear(): void;
}
//# sourceMappingURL=peer-pool.d.ts.map