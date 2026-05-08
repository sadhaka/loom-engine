// Spline - 2D path evaluators for camera paths and animations.
//
// 0.49.0 enabling primitive. The engine has Tween (single scalar)
// and TweenChain (sequenced scalars). What's missing: smooth 2D
// path evaluation - cinematic camera dollies, NPC walk paths,
// projectile arcs. Splines fill that gap.
//
// Three evaluators ship:
//
//   1. Linear (`linearPath`): straight-line segments through control
//      points. Useful when you want crisp connection without
//      smoothing.
//
//   2. Catmull-Rom (`catmullRomPath`): C^1-continuous curve passing
//      through every control point. The default choice for most
//      paths - good shape with no manual tangents.
//
//   3. Cubic Hermite (`hermitePath`): explicit per-point tangents.
//      Use when you need precise control over the slope at each
//      keyframe (e.g. arc trajectories with a target angle).
//
// All three accept `Vec2`-like { x, y } points and return a fresh
// { x, y } object. They share a common `t in [0, 1]` parameter
// across the whole path; segment selection is internal.
//
// Closed paths (loops) are handled by setting `closed: true` in
// the options. The first and last control points must be the same
// for closed Catmull-Rom; the evaluator does not auto-close.
//
// Code style: var-only in browser source.
function clampUnit(t) {
    if (!isFinite(t))
        return 0;
    if (t < 0)
        return 0;
    if (t > 1)
        return 1;
    return t;
}
function lerp(a, b, t) {
    return a + (b - a) * t;
}
// Linear path evaluator. Straight segments between consecutive
// control points. t in [0, 1] spans the full path; with N points,
// each segment occupies 1/(N-1) of the parameter range.
export function linearPath(points, t) {
    if (!points || points.length === 0)
        return { x: 0, y: 0 };
    if (points.length === 1) {
        var only = points[0];
        return { x: only.x, y: only.y };
    }
    var ct = clampUnit(t);
    var n = points.length;
    if (ct >= 1) {
        var last = points[n - 1];
        return { x: last.x, y: last.y };
    }
    var segCount = n - 1;
    var scaled = ct * segCount;
    var idx = Math.floor(scaled);
    if (idx >= segCount)
        idx = segCount - 1;
    var local = scaled - idx;
    var p0 = points[idx];
    var p1 = points[idx + 1];
    return { x: lerp(p0.x, p1.x, local), y: lerp(p0.y, p1.y, local) };
}
// Catmull-Rom path evaluator. C^1-continuous; the curve passes
// through every control point. Needs at least 2 points; with 2 it
// degenerates to linear (Catmull-Rom needs phantom endpoints, which
// the evaluator synthesizes by mirroring the boundary segment).
//
// Closed loop: pass `closed: true` AND ensure first === last point;
// the evaluator wraps neighbors across the join.
export function catmullRomPath(points, t, opts = {}) {
    if (!points || points.length === 0)
        return { x: 0, y: 0 };
    if (points.length === 1) {
        var only = points[0];
        return { x: only.x, y: only.y };
    }
    if (points.length === 2) {
        return linearPath(points, t);
    }
    var ct = clampUnit(t);
    var n = points.length;
    var closed = opts.closed === true;
    var segCount = closed ? n : n - 1;
    if (ct >= 1) {
        if (!closed) {
            var lastPoint = points[n - 1];
            return { x: lastPoint.x, y: lastPoint.y };
        }
        ct = 0; // wrap closed loops to start
    }
    var scaled = ct * segCount;
    var idx = Math.floor(scaled);
    if (idx >= segCount)
        idx = segCount - 1;
    var local = scaled - idx;
    var p0 = pickPoint(points, idx - 1, closed);
    var p1 = pickPoint(points, idx, closed);
    var p2 = pickPoint(points, idx + 1, closed);
    var p3 = pickPoint(points, idx + 2, closed);
    // Standard Catmull-Rom basis (uniform tension=0.5 collapses to
    // the canonical form for symmetric points; tension parameter is
    // exposed for consumers who want non-uniform).
    var tau = opts.tension !== undefined ? opts.tension : 0.5;
    var t2 = local * local;
    var t3 = t2 * local;
    // Cardinal-spline coefficients with tension tau.
    var s = (1 - tau);
    return {
        x: 0.5 * (2 * p1.x
            + (-p0.x + p2.x) * (s * 2 + (1 - 1)) * local
            + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
            + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y
            + (-p0.y + p2.y) * (s * 2 + (1 - 1)) * local
            + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
            + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    };
}
function pickPoint(points, idx, closed) {
    var n = points.length;
    if (closed) {
        var wrapped = ((idx % n) + n) % n;
        return points[wrapped];
    }
    if (idx < 0) {
        // Mirror the boundary segment: phantom = 2*p0 - p1.
        var p0 = points[0];
        var p1 = points[1];
        return { x: 2 * p0.x - p1.x, y: 2 * p0.y - p1.y };
    }
    if (idx >= n) {
        var pn1 = points[n - 1];
        var pn2 = points[n - 2];
        return { x: 2 * pn1.x - pn2.x, y: 2 * pn1.y - pn2.y };
    }
    return points[idx];
}
export function hermitePath(keys, t) {
    if (!keys || keys.length === 0)
        return { x: 0, y: 0 };
    if (keys.length === 1) {
        var only = keys[0];
        return { x: only.p.x, y: only.p.y };
    }
    var ct = clampUnit(t);
    var n = keys.length;
    if (ct >= 1) {
        var last = keys[n - 1];
        return { x: last.p.x, y: last.p.y };
    }
    var segCount = n - 1;
    var scaled = ct * segCount;
    var idx = Math.floor(scaled);
    if (idx >= segCount)
        idx = segCount - 1;
    var local = scaled - idx;
    var k0 = keys[idx];
    var k1 = keys[idx + 1];
    var tt = local * local;
    var ttt = tt * local;
    // Hermite basis functions:
    var h00 = 2 * ttt - 3 * tt + 1;
    var h10 = ttt - 2 * tt + local;
    var h01 = -2 * ttt + 3 * tt;
    var h11 = ttt - tt;
    return {
        x: h00 * k0.p.x + h10 * k0.m.x + h01 * k1.p.x + h11 * k1.m.x,
        y: h00 * k0.p.y + h10 * k0.m.y + h01 * k1.p.y + h11 * k1.m.y,
    };
}
// Resource key for the world's resource registry.
export const RESOURCE_SPLINE = 'spline';
//# sourceMappingURL=spline.js.map