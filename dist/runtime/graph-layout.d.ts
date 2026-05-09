export interface GraphNodeSpec<T = Record<string, unknown>> {
    id: string;
    x?: number;
    y?: number;
    mass?: number;
    pinned?: boolean;
    data?: T;
}
export interface GraphEdgeSpec {
    fromId: string;
    toId: string;
    restLength?: number;
    strength?: number;
}
export interface NodePosition<T = Record<string, unknown>> {
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    mass: number;
    pinned: boolean;
    data?: T;
}
export interface RenderedEdge {
    fromId: string;
    toId: string;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    restLength: number;
    strength: number;
}
export interface GraphSnapshot<T = Record<string, unknown>> {
    nodes: NodePosition<T>[];
    edges: RenderedEdge[];
    energy: number;
    isStable: boolean;
}
export type RngFn = () => number;
export interface GraphLayoutOptions {
    repulsion?: number;
    attraction?: number;
    damping?: number;
    centerForce?: number;
    stableThreshold?: number;
    rng?: RngFn;
    seed?: number;
    maxStabilizeIterations?: number;
}
export declare class GraphLayout<T = Record<string, unknown>> {
    private nodes;
    private edges;
    private rng;
    private repulsion;
    private attraction;
    private damping;
    private centerForce;
    private stableThreshold;
    private maxStabilizeIter;
    private disposed;
    private constructor();
    static create<T = Record<string, unknown>>(opts?: GraphLayoutOptions): GraphLayout<T>;
    addNode(spec: GraphNodeSpec<T>): boolean;
    removeNode(id: string): boolean;
    hasNode(id: string): boolean;
    getNode(id: string): NodePosition<T> | null;
    setPosition(id: string, x: number, y: number): boolean;
    setPinned(id: string, pinned: boolean): boolean;
    nodeCount(): number;
    addEdge(spec: GraphEdgeSpec): boolean;
    removeEdge(fromId: string, toId: string): boolean;
    hasEdge(fromId: string, toId: string): boolean;
    edgeCount(): number;
    tick(dtMs: number): void;
    stabilize(maxIterations?: number): number;
    positions(): NodePosition<T>[];
    getSnapshot(): GraphSnapshot<T>;
    forEach(cb: (n: NodePosition<T>) => void): void;
    clear(): void;
    dispose(): void;
    private edgeIndex;
    private simulateStep;
    private computeEnergy;
    private snapshotNode;
    private safeRng;
}
export declare const RESOURCE_GRAPH_LAYOUT = "graph_layout";
//# sourceMappingURL=graph-layout.d.ts.map