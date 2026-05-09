export interface BondTypeSpec {
    id: string;
    baseline?: number;
    decayHalfLifeMs?: number;
    data?: Record<string, unknown>;
}
export interface Bond {
    fromId: string;
    toId: string;
    bondType: string;
    value: number;
    rawValue: number;
    ageMs: number;
}
export interface BondFilter {
    bondType?: string;
    minLevel?: number;
    maxLevel?: number;
    fromId?: string;
    toId?: string;
}
export interface RelationshipGraphOptions {
    valueClamp?: (raw: number) => number;
    onChange?: (bond: Bond) => void;
}
export declare class RelationshipGraph {
    private specs;
    private bonds;
    private valueClamp;
    private onChange;
    private disposed;
    private constructor();
    static create(opts?: RelationshipGraphOptions): RelationshipGraph;
    defineBondType(spec: BondTypeSpec): boolean;
    hasBondType(id: string): boolean;
    bondTypes(): string[];
    removeBondType(id: string): boolean;
    setBond(fromId: string, toId: string, bondType: string, value: number): boolean;
    setMutual(aId: string, bId: string, bondType: string, value: number): boolean;
    adjustBond(fromId: string, toId: string, bondType: string, delta: number): number | null;
    removeBond(fromId: string, toId: string, bondType: string): boolean;
    hasBond(fromId: string, toId: string, bondType: string): boolean;
    getBond(fromId: string, toId: string, bondType: string): Bond | null;
    bondsFor(characterId: string, filter?: BondFilter): Bond[];
    bondsTo(characterId: string, filter?: BondFilter): Bond[];
    bondsBetween(aId: string, bId: string, filter?: BondFilter): Bond[];
    list(filter?: BondFilter): Bond[];
    bondCount(): number;
    bondTypeCount(): number;
    findStrongest(bondType: string, filter?: BondFilter): Bond | null;
    findWeakest(bondType: string, filter?: BondFilter): Bond | null;
    tick(dtMs: number): void;
    clear(): void;
    dispose(): void;
    private collect;
    private findExtreme;
    private fireChange;
    private snapshot;
}
export declare const RESOURCE_RELATIONSHIP_GRAPH = "relationship_graph";
//# sourceMappingURL=relationship-graph.d.ts.map