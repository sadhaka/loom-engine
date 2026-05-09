export interface TraitSpec {
    id: string;
    baseline?: number;
    decayHalfLifeMs?: number;
    data?: Record<string, unknown>;
}
export interface CharacterTraitValue {
    characterId: string;
    traitId: string;
    value: number;
    rawValue: number;
    ageMs: number;
}
export interface FindOptions {
    minLevel?: number;
    maxLevel?: number;
    characterIds?: string[];
}
export interface PersonaTraitOptions {
    valueClamp?: (raw: number) => number;
    onChange?: (entry: CharacterTraitValue) => void;
}
export declare class PersonaTrait {
    private specs;
    private entries;
    private valueClamp;
    private onChange;
    private disposed;
    private constructor();
    static create(opts?: PersonaTraitOptions): PersonaTrait;
    defineTrait(spec: TraitSpec): boolean;
    hasTraitSpec(id: string): boolean;
    getTraitSpec(id: string): TraitSpec | null;
    removeTraitSpec(id: string): boolean;
    traitIds(): string[];
    set(characterId: string, traitId: string, value: number): boolean;
    adjust(characterId: string, traitId: string, delta: number): number | null;
    getValue(characterId: string, traitId: string): number;
    getRawValue(characterId: string, traitId: string): number | null;
    has(characterId: string, traitId: string): boolean;
    remove(characterId: string, traitId: string): boolean;
    forCharacter(characterId: string): CharacterTraitValue[];
    forTrait(traitId: string): CharacterTraitValue[];
    findHighest(traitId: string, opts?: FindOptions): CharacterTraitValue | null;
    findLowest(traitId: string, opts?: FindOptions): CharacterTraitValue | null;
    entryCount(): number;
    traitSpecCount(): number;
    list(): CharacterTraitValue[];
    tick(dtMs: number): void;
    clear(): void;
    dispose(): void;
    private find;
    private fireChange;
    private snapshot;
}
export declare const RESOURCE_PERSONA_TRAIT = "persona_trait";
//# sourceMappingURL=persona-trait.d.ts.map