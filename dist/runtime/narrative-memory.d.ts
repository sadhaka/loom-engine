export interface MemoryKindSpec {
    id: string;
    decayHalfLifeMs?: number;
    autoPurgeBelow?: number;
    data?: Record<string, unknown>;
}
export interface MemoryFact<T = Record<string, unknown>> {
    id: string;
    characterId: string;
    subjectId: string;
    kind: string;
    content: string;
    recordedAt: number;
    salience: number;
    tags?: string[];
    data?: T;
}
export interface RecallContext {
    tags?: string[];
    kind?: string;
    minSalience?: number;
    limit?: number;
    now?: number;
    recencyHalfLifeMs?: number;
    salienceWeight?: number;
    recencyWeight?: number;
}
export interface RecallResult<T = Record<string, unknown>> extends MemoryFact<T> {
    recencyScore: number;
    rankScore: number;
}
export interface NarrativeMemoryOptions<T = Record<string, unknown>> {
    defaultKind?: {
        decayHalfLifeMs?: number;
        autoPurgeBelow?: number;
    };
    now?: () => number;
    onRemember?: (fact: MemoryFact<T>) => void;
    onForget?: (fact: MemoryFact<T>, reason: 'manual' | 'purge' | 'cleared') => void;
}
export declare class NarrativeMemory<T = Record<string, unknown>> {
    private kinds;
    private facts;
    private defaultDecayMs;
    private defaultPurgeBelow;
    private internalElapsedMs;
    private onRemember;
    private onForget;
    private disposed;
    private constructor();
    static create<T = Record<string, unknown>>(opts?: NarrativeMemoryOptions<T>): NarrativeMemory<T>;
    defineKind(spec: MemoryKindSpec): boolean;
    hasKind(id: string): boolean;
    kindIds(): string[];
    remember(fact: MemoryFact<T>): boolean;
    forget(factId: string): boolean;
    forgetAbout(characterId: string, subjectId: string): number;
    has(factId: string): boolean;
    get(factId: string): MemoryFact<T> | null;
    adjustSalience(factId: string, delta: number): number | null;
    factsAbout(characterId: string, subjectId: string): MemoryFact<T>[];
    factsBy(characterId: string): MemoryFact<T>[];
    factsAboutSubject(subjectId: string): MemoryFact<T>[];
    recall(characterId: string, subjectId: string, ctx?: RecallContext): RecallResult<T>[];
    topMemory(characterId: string, subjectId: string, ctx?: RecallContext): RecallResult<T> | null;
    size(): number;
    list(): MemoryFact<T>[];
    tick(dtMs: number): void;
    exportSession(characterId?: string): string;
    importSession(data: string): boolean;
    clear(): void;
    dispose(): void;
    private clamp01;
    private publicFact;
}
export declare const RESOURCE_NARRATIVE_MEMORY = "narrative_memory";
//# sourceMappingURL=narrative-memory.d.ts.map