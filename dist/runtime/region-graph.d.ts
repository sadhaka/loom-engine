export type RegionGate = (ctx: Record<string, unknown>) => boolean;
export interface ZoneNode {
    id: string;
    data?: Record<string, unknown>;
}
export interface RegionEdge {
    fromZone: string;
    toZone: string;
    weight?: number;
    kind?: string;
    gate?: RegionGate;
    data?: Record<string, unknown>;
}
export interface BidirectionalOptions {
    weight?: number;
    kind?: string;
    gate?: RegionGate;
    data?: Record<string, unknown>;
}
export interface RegionGraphOptions {
}
export declare class RegionGraph {
    private nodes;
    private edgeCount_;
    private disposed;
    private constructor();
    static create(opts?: RegionGraphOptions): RegionGraph;
    addZone(id: string, data?: Record<string, unknown>): boolean;
    removeZone(id: string): boolean;
    hasZone(id: string): boolean;
    zones(): string[];
    zoneCount(): number;
    getZone(id: string): ZoneNode | null;
    addConnection(edge: RegionEdge): boolean;
    addBidirectional(fromZone: string, toZone: string, opts?: BidirectionalOptions): boolean;
    removeConnection(fromZone: string, toZone: string): boolean;
    hasConnection(fromZone: string, toZone: string): boolean;
    getConnection(fromZone: string, toZone: string): RegionEdge | null;
    edges(): RegionEdge[];
    edgeCount(): number;
    neighbors(zone: string, ctx?: Record<string, unknown>): string[];
    shortestPath(fromZone: string, toZone: string, ctx?: Record<string, unknown>): string[] | null;
    reachable(fromZone: string, ctx?: Record<string, unknown>): string[];
    isReachable(fromZone: string, toZone: string, ctx?: Record<string, unknown>): boolean;
    clear(): void;
    dispose(): void;
    private gateOpen;
    private toPublicEdge;
}
export declare const RESOURCE_REGION_GRAPH = "region_graph";
//# sourceMappingURL=region-graph.d.ts.map