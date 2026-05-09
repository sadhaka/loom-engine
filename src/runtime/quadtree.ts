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

export interface AABBLite {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface QuadtreeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QuadtreeOptions {
  bounds: QuadtreeBounds;
  // Max items per node before subdividing. Default 8.
  maxItemsPerNode?: number;
  // Max subdivision depth. Default 6.
  maxDepth?: number;
}

interface Item {
  id: string;
  aabb: AABBLite;
}

interface QNode {
  bounds: QuadtreeBounds;
  depth: number;
  items: Item[];
  // Children: NW, NE, SW, SE (or null when leaf).
  children: QNode[] | null;
}

const DEFAULT_MAX_ITEMS = 8;
const DEFAULT_MAX_DEPTH = 6;

export class Quadtree {
  private root: QNode;
  private byId: Map<string, AABBLite> = new Map();
  private maxItems: number;
  private maxDepth: number;
  private disposed: boolean = false;

  private constructor(opts: QuadtreeOptions) {
    this.maxItems = opts.maxItemsPerNode !== undefined && isFinite(opts.maxItemsPerNode) && opts.maxItemsPerNode > 0
      ? Math.floor(opts.maxItemsPerNode) : DEFAULT_MAX_ITEMS;
    this.maxDepth = opts.maxDepth !== undefined && isFinite(opts.maxDepth) && opts.maxDepth >= 0
      ? Math.floor(opts.maxDepth) : DEFAULT_MAX_DEPTH;
    this.root = makeNode(opts.bounds, 0);
  }

  static create(opts: QuadtreeOptions): Quadtree {
    return new Quadtree(opts);
  }

  insert(id: string, aabb: AABBLite): boolean {
    if (this.disposed) return false;
    if (typeof id !== 'string' || id.length === 0) return false;
    if (!isValidAABB(aabb)) return false;
    if (this.byId.has(id)) return false;
    var copy: AABBLite = { minX: aabb.minX, minY: aabb.minY, maxX: aabb.maxX, maxY: aabb.maxY };
    this.byId.set(id, copy);
    insertInto(this.root, { id: id, aabb: copy }, this.maxItems, this.maxDepth);
    return true;
  }

  remove(id: string): boolean {
    if (this.disposed) return false;
    if (!this.byId.has(id)) return false;
    this.byId.delete(id);
    removeFromTree(this.root, id);
    return true;
  }

  // Convenience: remove + insert. Returns true if updated.
  update(id: string, aabb: AABBLite): boolean {
    if (this.disposed) return false;
    if (!isValidAABB(aabb)) return false;
    if (!this.byId.has(id)) return this.insert(id, aabb);
    this.remove(id);
    return this.insert(id, aabb);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  size(): number {
    return this.byId.size;
  }

  query(aabb: AABBLite): string[] {
    if (this.disposed || !isValidAABB(aabb)) return [];
    var out: string[] = [];
    var seen = new Set<string>();
    queryNode(this.root, aabb, out, seen);
    return out;
  }

  queryPoint(x: number, y: number): string[] {
    return this.query({ minX: x, minY: y, maxX: x, maxY: y });
  }

  queryRadius(cx: number, cy: number, radius: number): string[] {
    if (!isFinite(cx) || !isFinite(cy) || !isFinite(radius) || radius < 0) return [];
    var bbox: AABBLite = {
      minX: cx - radius, minY: cy - radius,
      maxX: cx + radius, maxY: cy + radius,
    };
    var candidates = this.query(bbox);
    if (radius === 0) return candidates.filter((id) => {
      var a = this.byId.get(id) as AABBLite;
      return a.minX <= cx && cx <= a.maxX && a.minY <= cy && cy <= a.maxY;
    });
    var r2 = radius * radius;
    var out: string[] = [];
    for (var i = 0; i < candidates.length; i++) {
      var id = candidates[i] as string;
      var a = this.byId.get(id) as AABBLite;
      // Closest point on AABB to circle center.
      var nx = cx < a.minX ? a.minX : (cx > a.maxX ? a.maxX : cx);
      var ny = cy < a.minY ? a.minY : (cy > a.maxY ? a.maxY : cy);
      var dx = nx - cx;
      var dy = ny - cy;
      if (dx * dx + dy * dy <= r2) out.push(id);
    }
    return out;
  }

  clear(): void {
    if (this.disposed) return;
    this.byId.clear();
    var b = this.root.bounds;
    this.root = makeNode(b, 0);
  }

  // Re-insert every item from scratch. Useful after many updates
  // that left nodes over- or under-subdivided.
  rebuild(): void {
    if (this.disposed) return;
    var snapshot: Item[] = [];
    this.byId.forEach((aabb, id) => snapshot.push({ id: id, aabb: aabb }));
    var b = this.root.bounds;
    this.root = makeNode(b, 0);
    for (var i = 0; i < snapshot.length; i++) {
      var item = snapshot[i] as Item;
      insertInto(this.root, item, this.maxItems, this.maxDepth);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.byId.clear();
    this.root = makeNode({ x: 0, y: 0, width: 0, height: 0 }, 0);
    this.disposed = true;
  }
}

// ---------- helpers ----------

function makeNode(bounds: QuadtreeBounds, depth: number): QNode {
  return {
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    depth: depth,
    items: [],
    children: null,
  };
}

function isValidAABB(a: AABBLite): boolean {
  if (!a) return false;
  if (typeof a.minX !== 'number' || typeof a.minY !== 'number'
      || typeof a.maxX !== 'number' || typeof a.maxY !== 'number') return false;
  if (!isFinite(a.minX) || !isFinite(a.minY) || !isFinite(a.maxX) || !isFinite(a.maxY)) return false;
  if (a.maxX < a.minX || a.maxY < a.minY) return false;
  return true;
}

function nodeContainsAabb(node: QNode, aabb: AABBLite): boolean {
  var b = node.bounds;
  return aabb.minX >= b.x && aabb.maxX <= b.x + b.width
      && aabb.minY >= b.y && aabb.maxY <= b.y + b.height;
}

function nodeOverlapsAabb(node: QNode, aabb: AABBLite): boolean {
  var b = node.bounds;
  if (aabb.maxX < b.x) return false;
  if (aabb.minX > b.x + b.width) return false;
  if (aabb.maxY < b.y) return false;
  if (aabb.minY > b.y + b.height) return false;
  return true;
}

function subdivide(node: QNode): QNode[] {
  var b = node.bounds;
  var halfW = b.width / 2;
  var halfH = b.height / 2;
  var children: QNode[] = [
    makeNode({ x: b.x, y: b.y, width: halfW, height: halfH }, node.depth + 1),                 // NW
    makeNode({ x: b.x + halfW, y: b.y, width: halfW, height: halfH }, node.depth + 1),         // NE
    makeNode({ x: b.x, y: b.y + halfH, width: halfW, height: halfH }, node.depth + 1),         // SW
    makeNode({ x: b.x + halfW, y: b.y + halfH, width: halfW, height: halfH }, node.depth + 1), // SE
  ];
  node.children = children;
  return children;
}

function insertInto(node: QNode, item: Item, maxItems: number, maxDepth: number): void {
  // If we already have children, descend into the children that
  // fully contain the AABB (or stay here if it spans).
  if (node.children) {
    var fits: QNode | null = null;
    for (var i = 0; i < 4; i++) {
      var ch = node.children[i] as QNode;
      if (nodeContainsAabb(ch, item.aabb)) { fits = ch; break; }
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
    var keep: Item[] = [];
    for (var k = 0; k < node.items.length; k++) {
      var it = node.items[k] as Item;
      var placed = false;
      for (var c = 0; c < 4; c++) {
        var child = children[c] as QNode;
        if (nodeContainsAabb(child, it.aabb)) {
          insertInto(child, it, maxItems, maxDepth);
          placed = true;
          break;
        }
      }
      if (!placed) keep.push(it);
    }
    node.items = keep;
  }
}

function removeFromTree(node: QNode, id: string): boolean {
  for (var i = node.items.length - 1; i >= 0; i--) {
    if ((node.items[i] as Item).id === id) {
      node.items.splice(i, 1);
      return true;
    }
  }
  if (node.children) {
    for (var c = 0; c < 4; c++) {
      if (removeFromTree(node.children[c] as QNode, id)) return true;
    }
  }
  return false;
}

function aabbsOverlap(a: AABBLite, b: AABBLite): boolean {
  if (a.maxX < b.minX) return false;
  if (a.minX > b.maxX) return false;
  if (a.maxY < b.minY) return false;
  if (a.minY > b.maxY) return false;
  return true;
}

function queryNode(node: QNode, aabb: AABBLite, out: string[], seen: Set<string>): void {
  if (!nodeOverlapsAabb(node, aabb)) return;
  for (var i = 0; i < node.items.length; i++) {
    var it = node.items[i] as Item;
    if (!seen.has(it.id) && aabbsOverlap(aabb, it.aabb)) {
      seen.add(it.id);
      out.push(it.id);
    }
  }
  if (node.children) {
    for (var c = 0; c < 4; c++) {
      queryNode(node.children[c] as QNode, aabb, out, seen);
    }
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_QUADTREE = 'quadtree';
