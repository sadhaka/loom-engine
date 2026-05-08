import type { CameraView } from './camera.js';
import type { Rect } from '../util/math.js';
export interface CameraControllerOptions {
    defaultSmoothing?: number;
    randomFn?: () => number;
}
export declare class CameraController {
    private readonly view;
    private readonly defaultSmoothing;
    private readonly randomFn;
    private targetX;
    private targetY;
    private smoothing;
    private shakeState;
    private shakeOffsetX;
    private shakeOffsetY;
    private bounds;
    constructor(view: CameraView, opts?: CameraControllerOptions);
    followTarget(x: number, y: number, smoothing?: number): void;
    clearFollow(): void;
    snapTo(x: number, y: number): void;
    shake(amplitude: number, durationMs: number): void;
    getShakeOffset(): {
        x: number;
        y: number;
    };
    setBounds(bounds: Rect | null): void;
    fit(rect: Rect, paddingPx?: number): void;
    update(dtSeconds: number): void;
    private applyBounds;
}
export declare const RESOURCE_CAMERA_CONTROLLER = "loom.camera_controller";
//# sourceMappingURL=camera-controller.d.ts.map