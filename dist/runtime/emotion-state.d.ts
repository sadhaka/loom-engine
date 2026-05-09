export interface EmotionThreshold {
    id?: string;
    level: number;
    onCross?: () => void;
}
export interface EmotionSpec {
    id: string;
    baseline?: number;
    decayHalfLifeMs?: number;
    thresholds?: EmotionThreshold[];
    data?: Record<string, unknown>;
}
export interface EmotionEntry {
    characterId: string;
    emotionId: string;
    value: number;
    rawValue: number;
    ageMs: number;
    peakValue: number;
}
export type DominantEmotion = EmotionEntry;
export interface EmotionStateOptions {
    valueClamp?: (raw: number) => number;
    onChange?: (entry: EmotionEntry) => void;
}
export declare class EmotionState {
    private specs;
    private entries;
    private valueClamp;
    private onChange;
    private disposed;
    private constructor();
    static create(opts?: EmotionStateOptions): EmotionState;
    defineEmotion(spec: EmotionSpec): boolean;
    hasEmotion(id: string): boolean;
    emotionIds(): string[];
    removeEmotion(id: string): boolean;
    pulse(characterId: string, emotionId: string, delta: number): number | null;
    set(characterId: string, emotionId: string, value: number): boolean;
    getValue(characterId: string, emotionId: string): number;
    get(characterId: string, emotionId: string): EmotionEntry | null;
    has(characterId: string, emotionId: string): boolean;
    remove(characterId: string, emotionId: string): boolean;
    isAbove(characterId: string, emotionId: string, threshold: number): boolean;
    isBelow(characterId: string, emotionId: string, threshold: number): boolean;
    forCharacter(characterId: string): EmotionEntry[];
    dominant(characterId: string): DominantEmotion | null;
    list(): EmotionEntry[];
    entryCount(): number;
    emotionCount(): number;
    resetPeaks(characterId?: string): void;
    tick(dtMs: number): void;
    clear(): void;
    dispose(): void;
    private makeEntry;
    private checkThresholds;
    private fireChange;
    private snapshot;
}
export declare const RESOURCE_EMOTION_STATE = "emotion_state";
//# sourceMappingURL=emotion-state.d.ts.map