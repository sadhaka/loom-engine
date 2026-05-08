import type { IGraphicsDevice, DeviceBackend } from './renderer/graphics-device.js';
import { type CameraView } from './renderer/camera.js';
import { World } from './world.js';
import { AudioBus } from './audio/audio-bus.js';
import { InputManager } from './input/input-manager.js';
export interface EngineOptions {
    canvas: HTMLCanvasElement;
    inputWindow?: Window | null;
    skipAudio?: boolean;
    backend?: DeviceBackend;
    device?: IGraphicsDevice;
}
export type DeviceFactory = (canvas: HTMLCanvasElement) => IGraphicsDevice;
export declare function registerBackend(name: DeviceBackend, factory: DeviceFactory): void;
export declare function isBackendRegistered(name: DeviceBackend): boolean;
export declare class Engine {
    readonly device: IGraphicsDevice;
    readonly world: World;
    readonly camera: CameraView;
    readonly input: InputManager;
    readonly audio: AudioBus | null;
    private time;
    private prevTimeMs;
    private constructor();
    static create(opts: EngineOptions): Engine;
    tick(nowMs: number): void;
    resetTime(): void;
    dispose(): void;
}
//# sourceMappingURL=engine.d.ts.map