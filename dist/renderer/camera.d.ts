import type { Rect } from '../util/math.js';
export interface CameraView {
    centerX: number;
    centerY: number;
    zoom: number;
    rotation: number;
    viewportWidth: number;
    viewportHeight: number;
}
export declare function createCamera(viewportWidth: number, viewportHeight: number): CameraView;
export declare function getCameraViewRect(cam: CameraView, out: Rect): Rect;
export declare function worldToScreen(cam: CameraView, worldX: number, worldY: number, out: {
    x: number;
    y: number;
}): {
    x: number;
    y: number;
};
export declare function screenToWorld(cam: CameraView, screenX: number, screenY: number, out: {
    x: number;
    y: number;
}): {
    x: number;
    y: number;
};
//# sourceMappingURL=camera.d.ts.map