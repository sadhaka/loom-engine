export interface TextScrollOptions {
    charsPerSecond?: number;
    punctPauseMs?: Record<string, number>;
    onChar?: (char: string, index: number) => void;
    onComplete?: () => void;
}
export declare class TextScroll {
    private text;
    private chars;
    private revealed;
    private msPerChar;
    private accumulatorMs;
    private pauseRemainingMs;
    private punct;
    private onChar;
    private onComplete;
    private completedFired;
    private paused;
    private disposed;
    private constructor();
    static create(opts?: TextScrollOptions): TextScroll;
    start(text: string): void;
    append(text: string): void;
    skip(): void;
    pause(): void;
    resume(): void;
    clear(): void;
    tick(dtMs: number): void;
    visibleText(): string;
    fullText(): string;
    isComplete(): boolean;
    isPaused(): boolean;
    revealedCount(): number;
    totalCount(): number;
    setCharsPerSecond(rate: number): void;
    dispose(): void;
    private fireCompleteIfDone;
}
export declare const RESOURCE_TEXT_SCROLL = "text_scroll";
//# sourceMappingURL=text-scroll.d.ts.map