export interface AnimationClip {
    name: string;
    frames: ReadonlyArray<number>;
    durations_ms?: ReadonlyArray<number>;
    loop: boolean;
    fps?: number;
}
export declare function synthesizeDefaultClip(frameCount: number): AnimationClip;
export declare function clipDurationMs(clip: AnimationClip, manifestFps: number): number;
export declare function frameInClipAt(clip: AnimationClip, elapsedMs: number, manifestFps: number): number;
export declare function manifestFrameIndex(clip: AnimationClip, frameInClip: number): number;
//# sourceMappingURL=animation-clip.d.ts.map