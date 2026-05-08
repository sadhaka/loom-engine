export type ChordKind = 'combo' | 'sequence' | 'doubleTap' | 'hold';
export interface ChordDef {
    kind: ChordKind;
    keys: string | string[];
    windowMs?: number;
    holdMs?: number;
}
export declare class InputChord {
    private chords;
    private keyToChords;
    define(name: string, def: ChordDef): void;
    undefine(name: string): boolean;
    has(name: string): boolean;
    onFired(name: string, cb: () => void): () => void;
    handleKeyDown(key: string): void;
    handleKeyUp(key: string): void;
    releaseAll(): void;
    tick(dtMs: number): void;
    wasFired(name: string): boolean;
    chordNames(): string[];
    clear(): void;
    stats(): {
        chords: number;
        keysWatched: number;
    };
    private fire;
}
export declare const RESOURCE_INPUT_CHORD = "loom.input_chord";
//# sourceMappingURL=input-chord.d.ts.map