// Quadtree - 2D broadphase spatial index.
//
// 0.81.0 enabling primitive. SpatialHash (0.30) is fast for evenly
// distributed entities at a known cell size, but sparse / clustered
// worlds (huge open zones with packed cities, scattered loot fields)
// chew memory or scan irrelevant cells. Quadtree adapts: leaves
// subdivide only where entities concentrate, queries skip large
// empty quadrants in O(log n) instead of O(cells).
//
//   var qt = Quadtree.create({
//     bounds: { x: 0, y: 0, width: 4096, height: 4096 },
//     maxItemsPerNode: 8,
//     maxDepth: 6,
//   });
//   qt.insert('mob42', { minX: 100, minY: 100, maxX: 116, maxY: 116 });
//   var hits = qt.query({ minX: 90, minY: 90, maxX: 130, maxY: 130 });
//
// Keyed by string id for stable references. Items can have any
// AABB (point or rect); the tree stores AABBs verbatim and tests
// overlap on query.
//
// Pairs with SpatialHash (0.30) - consumers pick whichever fits
// their distribution shape - and AABB (0.54) for shared geometry.
//
// Code style: var-only in browser source.
const DEFAULT_MAX_ITEMS = 8;
const DEFAULT_MAX_DEPTH = 6;
export class Quadtree {
    root;
    byId = new Map();
    maxItems;
    maxDepth;
    disposed = false;
    constructor(opts) {
        this.maxItems = opts.maxItemsPerNode !== undefined && isFinite(opts.maxItemsPerNode) && opts.maxItemsPerNode > 0
            ? Math.floor(opts.maxItemsPerNode) : DEFAULT_MAX_ITEMS;
        this.maxDepth = opts.maxDepth !== undefined && isFinite(opts.maxDepth) && opts.maxDepth >= 0
            ? Math.floor(opts.maxDepth) : DEFAULT_MAX_DEPTH;
        this.root = makeNode(opts.bounds, 0);
    }
    static create(opts) {
        return new Quadtree(opts);
    }
    insert(id, aabb) {
        if (this.disposed)
            return false;
        if (typeof id !== 'string' || id.length === 0)
            return false;
        if (!isValidAABB(aabb))
            return false;
        if (this.byId.has(id))
            return false;
        var copy = { minX: aabb.minX, minY: aabb.minY, maxX: aabb.maxX, maxY: aabb.maxY };
        this.byId.set(id, copy);
        insertInto(this.root, { id: id, aabb: copy }, this.maxItems, this.maxDepth);
        return true;
    }
    remove(id) {
        if (this.disposed)
            return false;
        if (!this.byId.has(id))
            return false;
        this.byId.delete(id);
        removeFromTree(this.root, id);
        return true;
    }
    // Convenience: remove + insert. Returns true if updated.
    update(id, aabb) {
        if (this.disposed)
            return false;
        if (!isValidAABB(aabb))
            return false;
        if (!this.byId.has(id))
            return this.insert(id, aabb);
        this.remove(id);
        return this.insert(id, aabb);
    }
    has(id) {
        return this.byId.has(id);
    }
    size() {
        return this.byId.size;
    }
    query(aabb) {
        if (this.disposed || !isValidAABB(aabb))
            return [];
        var out = [];
        var seen = new Set();
        queryNode(this.root, aabb, out, seen);
        return out;
    }
    queryPoint(x, y) {
        return this.query({ minX: x, minY: y, maxX: x, maxY: y });
    }
    queryRadius(cx, cy, radius) {
        if (!isFinite(cx) || !isFinite(cy) || !isFinite(radius) || radius < 0)
            return [];
        var bbox = {
            minX: cx - radius, minY: cy - radius,
            maxX: cx + radius, maxY: cy + radius,
        };
        var candidates = this.query(bbox);
        if (radius === 0)
            return candidates.filter((id) => {
                var a = this.byId.get(id);
                return a.minX <= cx && cx <= a.maxX && a.minY <= cy && cy <= a.maxY;
            });
        var r2 = radius * radius;
        var out = [];
        for (var i = 0; i < candidates.length; i++) {
            var id = candidates[i];
            var a = this.byId.get(id);
            // Closest point on AABB to circle center.
            var nx = cx < a.minX ? a.minX : (cx > a.maxX ? a.maxX : cx);
            var ny = cy < a.minY ? a.minY : (cy > a.maxY ? a.maxY : cy);
            var dx = nx - cx;
            var dy = ny - cy;
            if (dx * dx + dy * dy <= r2)
                out.push(id);
        }
        return out;
    }
    clear() {
        if (this.disposed)
            return;
        this.byId.clear();
        var b = this.root.bounds;
        this.root = makeNode(b, 0);
    }
    // Re-insert every item from scratch. Useful after many updates
    // that left nodes over- or under-subdivided.
    rebuild() {
        if (this.disposed)
            return;
        var snapshot = [];
        this.byId.forEach((aabb, id) => snapshot.push({ id: id, aabb: aabb }));
        var b = this.root.bounds;
        this.root = makeNode(b, 0);
        for (var i = 0; i < snapshot.length; i++) {
            var item = snapshot[i];
            insertInto(this.root, item, this.maxItems, this.maxDepth);
        }
    }
    dispose() {
        if (this.disposed)
            return;
        this.byId.clear();
        this.root = makeNode({ x: 0, y: 0, width: 0, height: 0 }, 0);
        this.disposed = true;
    }
}
// ---------- helpers ----------
function makeNode(bounds, depth) {
    return {
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        depth: depth,
        items: [],
        children: null,
    };
}
function isValidAABB(a) {
    if (!a)
        return false;
    if (typeof a.minX !== 'number' || typeof a.minY !== 'number'
        || typeof a.maxX !== 'number' || typeof a.maxY !== 'number')
        return false;
    if (!isFinite(a.minX) || !isFinite(a.minY) || !isFinite(a.maxX) || !isFinite(a.maxY))
        return false;
    if (a.maxX < a.minX || a.maxY < a.minY)
        return false;
    return true;
}
function nodeContainsAabb(node, aabb) {
    var b = node.bounds;
    return aabb.minX >= b.x && aabb.maxX <= b.x + b.width
        && aabb.minY >= b.y && aabb.maxY <= b.y + b.height;
}
function nodeOverlapsAabb(node, aabb) {
    var b = node.bounds;
    if (aabb.maxX < b.x)
        return false;
    if (aabb.minX > b.x + b.width)
        return false;
    if (aabb.maxY < b.y)
        return false;
    if (aabb.minY > b.y + b.height)
        return false;
    return true;
}
function subdivide(node) {
    var b = node.bounds;
    var halfW = b.width / 2;
    var halfH = b.height / 2;
    var children = [
        makeNode({ x: b.x, y: b.y, width: halfW, height: halfH }, node.depth + 1), // NW
        makeNode({ x: b.x + halfW, y: b.y, width: halfW, height: halfH }, node.depth + 1), // NE
        makeNode({ x: b.x, y: b.y + halfH, width: halfW, height: halfH }, node.depth + 1), // SW
        makeNode({ x: b.x + halfW, y: b.y + halfH, width: halfW, height: halfH }, node.depth + 1), // SE
    ];
    node.children = children;
    return children;
}
function insertInto(node, item, maxItems, maxDepth) {
    // If we already have children, descend into the children that
    // fully contain the AABB (or stay here if it spans).
    if (node.children) {
        var fits = null;
        for (var i = 0; i < 4; i++) {
            var ch = node.children[i];
            if (nodeContainsAabb(ch, item.aabb)) {
                fits = ch;
                break;
            }
        }
        if (fits) {
            insertInto(fits, item, maxItems, maxDepth);
            return;
        }
        // Spans children - keep at this level.
        node.items.push(item);
        return;
    }
    node.items.push(item);
    // Subdivide if over capacity AND below depth cap.
    if (node.items.length > maxItems && node.depth < maxDepth) {
        var children = subdivide(node);
        var keep = [];
        for (var k = 0; k < node.items.length; k++) {
            var it = node.items[k];
            var placed = false;
            for (var c = 0; c < 4; c++) {
                var child = children[c];
                if (nodeContainsAabb(child, it.aabb)) {
                    insertInto(child, it, maxItems, maxDepth);
                    placed = true;
                    break;
                }
            }
            if (!placed)
                keep.push(it);
        }
        node.items = keep;
    }
}
function removeFromTree(node, id) {
    for (var i = node.items.length - 1; i >= 0; i--) {
        if (node.items[i].id === id) {
            node.items.splice(i, 1);
            return true;
        }
    }
    if (node.children) {
        for (var c = 0; c < 4; c++) {
            if (removeFromTree(node.children[c], id))
                return true;
        }
    }
    return false;
}
function aabbsOverlap(a, b) {
    if (a.maxX < b.minX)
        return false;
    if (a.minX > b.maxX)
        return false;
    if (a.maxY < b.minY)
        return false;
    if (a.minY > b.maxY)
        return false;
    return true;
}
function queryNode(node, aabb, out, seen) {
    if (!nodeOverlapsAabb(node, aabb))
        return;
    for (var i = 0; i < node.items.length; i++) {
        var it = node.items[i];
        if (!seen.has(it.id) && aabbsOverlap(aabb, it.aabb)) {
            seen.add(it.id);
            out.push(it.id);
        }
    }
    if (node.children) {
        for (var c = 0; c < 4; c++) {
            queryNode(node.children[c], aabb, out, seen);
        }
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_QUADTREE = 'quadtree';
//# sourceMappingURL=quadtree.js.map