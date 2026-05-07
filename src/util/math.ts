// Math primitives for the Loom Engine.
//
// Plain object Vec2/Vec3 types - no class hierarchy, no methods on
// instances. Free functions operate on them. Cheap to allocate, cheap
// to pool, no prototype chain.

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

export function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function approxEq(a: number, b: number, epsilon: number = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon;
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

export function rectIntersects(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

// Frustum cull helper - returns true if the world-space rect overlaps
// the camera-space view rect. Used by render systems to skip offscreen
// entities before they hit the device layer.
export function visibleInView(worldRect: Rect, viewRect: Rect): boolean {
  return rectIntersects(worldRect, viewRect);
}
