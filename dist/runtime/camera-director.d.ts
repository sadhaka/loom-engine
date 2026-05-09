export type EasingName = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'step';
export interface CameraKeyframe {
    atMs: number;
    x: number;
    y: number;
    zoom: number;
    rotation?: number;
    easing?: EasingName;
    data?: Record<string, unknown>;
}
export interface CameraSnapshot {
    x: number;
    y: number;
    zoom: number;
    rotation: number;
    isPlaying: boolean;
    isPaused: boolean;
    progress: number;
    elapsedMs: number;
    speed: number;
}
export interface PlayOptions {
    keyframes: CameraKeyframe[];
    speed?: number;
    onFinish?: () => void;
}
export interface CameraDirectorOptions {
    initial?: {
        x?: number;
        y?: number;
        zoom?: number;
        rotation?: number;
    };
}
export declare class CameraDirector {
    private current;
    private initial;
    private keyframes;
    private elapsed;
    private speed;
    private playing;
    private paused;
    private onFinish;
    private disposed;
    private constructor();
    static create(opts?: CameraDirectorOptions): CameraDirector;
    play(opts: PlayOptions): boolean;
    tick(dtMs: number): void;
    jumpTo(ms: number): void;
    pause(): void;
    resume(): void;
    stop(): void;
    setSpeed(multiplier: number): void;
    isPlaying(): boolean;
    isPaused(): boolean;
    getState(): CameraSnapshot;
    dispose(): void;
    private applyAtTime;
    private setCurrent;
}
export declare const RESOURCE_CAMERA_DIRECTOR = "camera_director";
//# sourceMappingURL=camera-director.d.ts.map