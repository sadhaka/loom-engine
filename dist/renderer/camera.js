// Camera for the Loom Engine.
//
// 2D camera with optional zoom + rotation. Iso projection happens
// in iso-projection.ts; this camera produces the screen-space view
// rect that systems use for frustum culling.
export function createCamera(viewportWidth, viewportHeight) {
    return {
        centerX: 0,
        centerY: 0,
        zoom: 1,
        rotation: 0,
        viewportWidth,
        viewportHeight,
    };
}
// World-space rect that the camera currently sees. Used for frustum
// culling. Rotation is ignored in v1 (engine ships axis-aligned).
export function getCameraViewRect(cam, out) {
    const halfW = cam.viewportWidth / cam.zoom / 2;
    const halfH = cam.viewportHeight / cam.zoom / 2;
    out.x = cam.centerX - halfW;
    out.y = cam.centerY - halfH;
    out.width = halfW * 2;
    out.height = halfH * 2;
    return out;
}
// World-space coords -> screen-space coords. Iso transform happens
// before this; this is the pure camera transform.
export function worldToScreen(cam, worldX, worldY, out) {
    out.x = (worldX - cam.centerX) * cam.zoom + cam.viewportWidth / 2;
    out.y = (worldY - cam.centerY) * cam.zoom + cam.viewportHeight / 2;
    return out;
}
export function screenToWorld(cam, screenX, screenY, out) {
    out.x = (screenX - cam.viewportWidth / 2) / cam.zoom + cam.centerX;
    out.y = (screenY - cam.viewportHeight / 2) / cam.zoom + cam.centerY;
    return out;
}
//# sourceMappingURL=camera.js.map