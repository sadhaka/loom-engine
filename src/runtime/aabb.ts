// AABB - 2D axis-aligned bounding box queries.
//
// 0.54.0 enabling primitive. SpatialHash (0.30.0) buckets points
// for O(K) nearby queries; util/math has rect() + rectIntersects()
// + rectContains() for basic primitives. AABB fills the gap with:
//
//   - Mutable AABB shape with min/max corners (preferred over rect
//     which is x/y/width/height) for combat hitboxes / camera
//     view frustums / mob aggro radii.
//   - Containment / intersection / overlap tests + segment
//     intersection (line-of-sight raycasts).
//   - Range query: from a list of AABBs, return the indexes of
//     those overlapping a query box. O(N), so for big sets use
//     SpatialHash; for small sets (< ~50 boxes) the brute force is
//     faster than building a hash.
//   - Mutation helpers: expand, translate, fromPoints, union.
//
// Distinct from util/math's `Rect` which is x/y/width/height; AABB
// is min/max corners and integrates cleanly with broadphase
// algorithms downstream (BVH, sweep-and-prune, broadphase pair
// generation).
//
// Code style: var-only in browser source.

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Vec2Pt {
  x: number;
  y: number;
}

// Construct a fresh AABB. Order-tolerant - swaps mins / maxes if
// caller passes them flipped.
export function aabb(minX: number, minY: number, maxX: number, maxY: number): AABB {
  var mnx = Math.min(minX, maxX);
  var mny = Math.min(minY, maxY);
  var mxx = Math.max(minX, maxX);
  var mxy = Math.max(minY, maxY);
  return { minX: mnx, minY: mny, maxX: mxx, maxY: mxy };
}

// Build from x/y/width/height (the existing Rect shape).
export function aabbFromRect(x: number, y: number, width: number, height: number): AABB {
  return aabb(x, y, x + width, y + height);
}

// Build a tight AABB enclosing every point in the array. Empty
// input returns a degenerate AABB at the origin.
export function aabbFromPoints(points: ReadonlyArray<Vec2Pt>): AABB {
  if (!points || points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  var first = points[0] as Vec2Pt;
  var minX = first.x;
  var minY = first.y;
  var maxX = first.x;
  var maxY = first.y;
  for (var i = 1; i < points.length; i++) {
    var p = points[i] as Vec2Pt;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
}

// True iff (px, py) is inside the box (boundary inclusive).
export function aabbContainsPoint(box: AABB, px: number, py: number): boolean {
  return px >= box.minX && px <= box.maxX && py >= box.minY && py <= box.maxY;
}

// True iff `inner` is fully contained by `outer` (boundary inclusive).
export function aabbContainsAabb(outer: AABB, inner: AABB): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX
       && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

// True iff `a` and `b` overlap. Sharing a boundary edge counts as
// overlap.
export function aabbOverlaps(a: AABB, b: AABB): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

// Width / height / area helpers.
export function aabbWidth(box: AABB): number {
  return box.maxX - box.minX;
}

export function aabbHeight(box: AABB): number {
  return box.maxY - box.minY;
}

export function aabbArea(box: AABB): number {
  return aabbWidth(box) * aabbHeight(box);
}

// Center of the box.
export function aabbCenter(box: AABB, out?: Vec2Pt): Vec2Pt {
  var cx = (box.minX + box.maxX) * 0.5;
  var cy = (box.minY + box.maxY) * 0.5;
  if (out) {
    out.x = cx;
    out.y = cy;
    return out;
  }
  return { x: cx, y: cy };
}

// Mutate `box` to expand by `margin` on each side. Margin can be
// negative to shrink (the box may invert if margin > half the
// shorter side; clamp at the caller).
export function aabbExpand(box: AABB, margin: number): AABB {
  box.minX -= margin;
  box.minY -= margin;
  box.maxX += margin;
  box.maxY += margin;
  return box;
}

// Mutate `box` by translating both corners by (dx, dy).
export function aabbTranslate(box: AABB, dx: number, dy: number): AABB {
  box.minX += dx;
  box.minY += dy;
  box.maxX += dx;
  box.maxY += dy;
  return box;
}

// Build a fresh AABB enclosing both `a` and `b`.
export function aabbUnion(a: AABB, b: AABB): AABB {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

// Build a fresh AABB representing the intersection of `a` and `b`.
// Returns null if they don't overlap.
export function aabbIntersection(a: AABB, b: AABB): AABB | null {
  if (!aabbOverlaps(a, b)) return null;
  return {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  };
}

// Range query: given an array of AABBs, return the indexes of
// every box overlapping `query`. O(N) on the input. For large sets
// pair this with SpatialHash for an O(K) candidate list.
export function aabbRangeQuery(
  boxes: ReadonlyArray<AABB>,
  query: AABB,
  out?: number[],
): number[] {
  var result = out ? out : [];
  if (out) result.length = 0;
  for (var i = 0; i < boxes.length; i++) {
    var b = boxes[i];
    if (b && aabbOverlaps(b, query)) result.push(i);
  }
  return result;
}

// Segment-vs-AABB raycast. Returns the t value in [0, 1] where the
// segment p0 -> p1 first enters the box, or null if the segment
// misses. Uses the slab method (Cyrus-Beck-style).
export function aabbRaycastSegment(
  box: AABB,
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
): number | null {
  var dx = p1x - p0x;
  var dy = p1y - p0y;
  var tMin = 0;
  var tMax = 1;

  // X slab.
  if (dx === 0) {
    if (p0x < box.minX || p0x > box.maxX) return null;
  } else {
    var inv = 1 / dx;
    var t1 = (box.minX - p0x) * inv;
    var t2 = (box.maxX - p0x) * inv;
    var lo = Math.min(t1, t2);
    var hi = Math.max(t1, t2);
    if (lo > tMin) tMin = lo;
    if (hi < tMax) tMax = hi;
    if (tMin > tMax) return null;
  }

  // Y slab.
  if (dy === 0) {
    if (p0y < box.minY || p0y > box.maxY) return null;
  } else {
    var invY = 1 / dy;
    var ty1 = (box.minY - p0y) * invY;
    var ty2 = (box.maxY - p0y) * invY;
    var loY = Math.min(ty1, ty2);
    var hiY = Math.max(ty1, ty2);
    if (loY > tMin) tMin = loY;
    if (hiY < tMax) tMax = hiY;
    if (tMin > tMax) return null;
  }

  // tMin is the entry t; if it's negative the start is inside.
  return tMin >= 0 ? tMin : 0;
}

// Resource key for the world's resource registry. Tag for any
// AABB-tracking system the consumer attaches.
export const RESOURCE_AABB = 'aabb';
