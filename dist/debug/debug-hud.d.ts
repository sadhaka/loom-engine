export interface DebugHUDOptions {
    rootClass?: string;
    lineClass?: string;
    nowFn?: () => number;
}
export declare class DebugHUD {
    private lines;
    private samples;
    private samplesFilled;
    private samplesIndex;
    private lastFrameMs;
    private frameCountValue;
    private rootEl;
    private readonly nowFn;
    private readonly rootClass;
    private readonly lineClass;
    constructor(opts?: DebugHUDOptions);
    beginFrame(): void;
    fps(): number;
    fpsRange(): {
        min: number;
        max: number;
    };
    frameCount(): number;
    addLine(label: string, value: string | (() => string)): void;
    clearLines(): void;
    lineCount(): number;
    toText(): string;
    attachToDom(parent: HTMLElement): HTMLElement;
    detachFromDom(): void;
    render(): string;
}
export declare const RESOURCE_DEBUG_HUD = "loom.debug_hud";
//# sourceMappingURL=debug-hud.d.ts.map