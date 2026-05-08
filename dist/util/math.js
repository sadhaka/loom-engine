// Math primitives for the Loom Engine.
//
// Plain object Vec2/Vec3 types - no class hierarchy, no methods on
// instances. Free functions operate on them. Cheap to allocate, cheap
// to pool, no prototype chain.
export function vec2(x, y) {
    return { x, y };
}
export function vec3(x, y, z) {
    return { x, y, z };
}
export function rect(x, y, width, height) {
    return { x, y, width, height };
}
export function clamp(v, lo, hi) {
    if (v < lo)
        return lo;
    if (v > hi)
        return hi;
    return v;
}
export function lerp(a, b, t) {
    return a + (b - a) * t;
}
export function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}
export function approxEq(a, b, epsilon = 1e-6) {
    return Math.abs(a - b) <= epsilon;
}
export function rectContains(r, x, y) {
    return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}
export function rectIntersects(a, b) {
    return !(a.x + a.width < b.x ||
        b.x + b.width < a.x ||
        a.y + a.height < b.y ||
        b.y + b.height < a.y);
}
// Frustum cull helper - returns true if the world-space rect overlaps
// the camera-space view rect. Used by render systems to skip offscreen
// entities before they hit the device layer.
export function visibleInView(worldRect, viewRect) {
    return rectIntersects(worldRect, viewRect);
}
//# sourceMappingURL=math.js.map