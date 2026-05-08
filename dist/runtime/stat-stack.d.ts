export type ModifierKind = 'flat' | 'percentBase' | 'multiplier';
export interface Modifier {
    source: string;
    stat: string;
    kind: ModifierKind;
    value: number;
}
export interface StatStackOptions {
    onChanged?: (statName: string, newValue: number, prevValue: number) => void;
}
export declare class StatStack {
    private stats;
    private onChanged;
    private disposed;
    private constructor();
    static create(opts?: StatStackOptions): StatStack;
    setBase(statName: string, value: number): void;
    getBase(statName: string): number;
    addModifier(mod: Modifier): boolean;
    removeBySource(source: string): number;
    removeModifier(source: string, stat: string, kind?: ModifierKind): boolean;
    get(statName: string): number;
    getModifiers(statName: string): Modifier[];
    statNames(): string[];
    clear(): void;
    dispose(): void;
    private computeDerived;
    private maybeFire;
}
export declare const RESOURCE_STAT_STACK = "stat_stack";
//# sourceMappingURL=stat-stack.d.ts.map