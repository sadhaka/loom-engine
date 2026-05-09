// RegionGraph - connected-zone topology + traversal.
//
// 1.2.1 enabling primitive (Wave 1.2 world depth). The Pathfinder
// (0.55) handles tile-level A* within a single zone. RegionGraph
// is the world-scale counterpart: zones are nodes, connections
// (portals, doors, paths, ferry routes) are edges. Used for
// "find the shortest route from Hamlet to Lastlight," "which zones
// are reachable with a Mirror Shard?", "what's the next zone if
// I cross this portal?".
//
//   var graph = RegionGraph.create();
//   graph.addZone('hamlet');
//   graph.addZone('forest');
//   graph.addZone('lastlight');
//   graph.addBidirectional('hamlet', 'forest', { weight: 1, kind: 'walk' });
//   graph.addConnection({
//     fromZone: 'forest', toZone: 'lastlight',
//     weight: 5, kind: 'boat',
//     gate: (ctx) => !!ctx.hasBoat,
//   });
//
//   // Find route. ctx is passed to gates.
//   var path = graph.shortestPath('hamlet', 'lastlight',
//                                 { hasBoat: true });
//   // -> ['hamlet', 'forest', 'lastlight']
//
// Edges are directed; addBidirectional adds both directions.
// Each edge has weight (travel cost), optional kind (walk /
// teleport / boat / etc), and optional gate predicate evaluated
// against a consumer-supplied context.
//
// Pairs with Pathfinder (0.55, intra-zone A*), TileMap (0.56),
// FactionReputation (0.86, often gates region access).
//
// Code style: var-only in browser source.

export type RegionGate = (ctx: Record<string, unknown>) => boolean;

export interface ZoneNode {
  id: string;
  data?: Record<string, unknown>;
}

export interface RegionEdge {
  fromZone: string;
  toZone: string;
  // Travel cost (any positive number). Default 1.
  weight?: number;
  // Optional traversal kind ('walk' / 'teleport' / 'boat' / etc).
  // Engine does not interpret; consumer can filter.
  kind?: string;
  // Optional gating predicate evaluated against a consumer-supplied
  // context. False = edge is blocked for this traversal.
  gate?: RegionGate;
  data?: Record<string, unknown>;
}

export interface BidirectionalOptions {
  weight?: number;
  kind?: string;
  gate?: RegionGate;
  data?: Record<string, unknown>;
}

export interface RegionGraphOptions {
  // Reserved for future hooks.
}

interface InternalEdge {
  fromZone: string;
  toZone: string;
  weight: number;
  kind: string | null;
  gate: RegionGate | null;
  data?: Record<string, unknown>;
}

interface InternalNode {
  id: string;
  outEdges: Map<string, InternalEdge>; // toZone -> edge
  inEdges: Set<string>; // fromZone set (for cleanup)
  data?: Record<string, unknown>;
}

export class RegionGraph {
  private nodes: Map<string, InternalNode> = new Map();
  private edgeCount_: number = 0;
  private disposed: boolean = false;

  private constructor(_opts: RegionGraphOptions) { /* reserved */ }

  static create(opts: RegionGraphOptions = {}): RegionGraph {
    return new RegionGraph(opts);
  }

  // ---------- nodes ----------

  addZone(id: string, data?: Record<string, unknown>): boolean {
    if (this.disposed) return false;
    if (typeof id !== 'string' || id.length === 0) return false;
    if (this.nodes.has(id)) return false;
    var node: InternalNode = {
      id: id,
      outEdges: new Map(),
      inEdges: new Set(),
    };
    if (data !== undefined) node.data = data;
    this.nodes.set(id, node);
    return true;
  }

  removeZone(id: string): boolean {
    if (this.disposed) return false;
    var node = this.nodes.get(id);
    if (!node) return false;
    // Drop incoming edges from other nodes.
    var inFroms: string[] = [];
    var inIter = node.inEdges.values();
    var iv = inIter.next();
    while (!iv.done) {
      inFroms.push(iv.value);
      iv = inIter.next();
    }
    for (var i = 0; i < inFroms.length; i++) {
      var fromNode = this.nodes.get(inFroms[i] as string);
      if (fromNode && fromNode.outEdges.delete(id)) this.edgeCount_--;
    }
    // Drop outgoing edges from this node (also clean up inEdges
    // sets on the targets).
    var outIter = node.outEdges.keys();
    var ok = outIter.next();
    while (!ok.done) {
      var toNode = this.nodes.get(ok.value);
      if (toNode) toNode.inEdges.delete(id);
      ok = outIter.next();
    }
    this.edgeCount_ -= node.outEdges.size;
    this.nodes.delete(id);
    return true;
  }

  hasZone(id: string): boolean {
    return this.nodes.has(id);
  }

  zones(): string[] {
    var out: string[] = [];
    var keys = this.nodes.keys();
    var k = keys.next();
    while (!k.done) {
      out.push(k.value);
      k = keys.next();
    }
    return out;
  }

  zoneCount(): number { return this.nodes.size; }

  getZone(id: string): ZoneNode | null {
    var n = this.nodes.get(id);
    if (!n) return null;
    var copy: ZoneNode = { id: n.id };
    if (n.data !== undefined) copy.data = n.data;
    return copy;
  }

  // ---------- edges ----------

  addConnection(edge: RegionEdge): boolean {
    if (this.disposed) return false;
    if (!edge || typeof edge.fromZone !== 'string'
        || typeof edge.toZone !== 'string') return false;
    if (edge.fromZone === edge.toZone) return false;
    var from = this.nodes.get(edge.fromZone);
    var to = this.nodes.get(edge.toZone);
    if (!from || !to) return false;
    var weight = edge.weight !== undefined && isFinite(edge.weight)
        && edge.weight >= 0 ? edge.weight : 1;
    var internal: InternalEdge = {
      fromZone: edge.fromZone,
      toZone: edge.toZone,
      weight: weight,
      kind: typeof edge.kind === 'string' ? edge.kind : null,
      gate: typeof edge.gate === 'function' ? edge.gate : null,
    };
    if (edge.data !== undefined) internal.data = edge.data;
    var existed = from.outEdges.has(edge.toZone);
    from.outEdges.set(edge.toZone, internal);
    to.inEdges.add(edge.fromZone);
    if (!existed) this.edgeCount_++;
    return true;
  }

  addBidirectional(fromZone: string, toZone: string,
                   opts: BidirectionalOptions = {}): boolean {
    if (this.disposed) return false;
    var a: RegionEdge = { fromZone: fromZone, toZone: toZone };
    if (opts.weight !== undefined) a.weight = opts.weight;
    if (opts.kind !== undefined) a.kind = opts.kind;
    if (opts.gate !== undefined) a.gate = opts.gate;
    if (opts.data !== undefined) a.data = opts.data;
    var b: RegionEdge = { fromZone: toZone, toZone: fromZone };
    if (opts.weight !== undefined) b.weight = opts.weight;
    if (opts.kind !== undefined) b.kind = opts.kind;
    if (opts.gate !== undefined) b.gate = opts.gate;
    if (opts.data !== undefined) b.data = opts.data;
    var ok1 = this.addConnection(a);
    var ok2 = this.addConnection(b);
    return ok1 && ok2;
  }

  removeConnection(fromZone: string, toZone: string): boolean {
    if (this.disposed) return false;
    var from = this.nodes.get(fromZone);
    var to = this.nodes.get(toZone);
    if (!from || !to) return false;
    var deleted = from.outEdges.delete(toZone);
    if (deleted) {
      to.inEdges.delete(fromZone);
      this.edgeCount_--;
    }
    return deleted;
  }

  hasConnection(fromZone: string, toZone: string): boolean {
    var from = this.nodes.get(fromZone);
    return !!from && from.outEdges.has(toZone);
  }

  getConnection(fromZone: string, toZone: string): RegionEdge | null {
    var from = this.nodes.get(fromZone);
    if (!from) return null;
    var e = from.outEdges.get(toZone);
    return e ? this.toPublicEdge(e) : null;
  }

  edges(): RegionEdge[] {
    var out: RegionEdge[] = [];
    var nIter = this.nodes.values();
    var n = nIter.next();
    while (!n.done) {
      var node = n.value;
      var eIter = node.outEdges.values();
      var ev = eIter.next();
      while (!ev.done) {
        out.push(this.toPublicEdge(ev.value));
        ev = eIter.next();
      }
      n = nIter.next();
    }
    return out;
  }

  edgeCount(): number { return this.edgeCount_; }

  // ---------- traversal ----------

  // Reachable next zones from `zone`, filtered by gate predicates.
  neighbors(zone: string, ctx: Record<string, unknown> = {}): string[] {
    var node = this.nodes.get(zone);
    if (!node) return [];
    var out: string[] = [];
    var iter = node.outEdges.values();
    var v = iter.next();
    while (!v.done) {
      var e = v.value;
      if (this.gateOpen(e, ctx)) out.push(e.toZone);
      v = iter.next();
    }
    return out;
  }

  // Shortest path between two zones via Dijkstra. Returns the
  // ordered list of zones (start..goal inclusive) or null if no
  // path exists. Gates are evaluated against ctx; blocked edges
  // are skipped.
  shortestPath(fromZone: string, toZone: string,
               ctx: Record<string, unknown> = {}): string[] | null {
    if (!this.nodes.has(fromZone) || !this.nodes.has(toZone)) return null;
    if (fromZone === toZone) return [fromZone];
    var dist: Map<string, number> = new Map();
    var prev: Map<string, string> = new Map();
    dist.set(fromZone, 0);
    var open: string[] = [fromZone];
    while (open.length > 0) {
      // Pick lowest-dist node from open.
      var bestIdx = 0;
      var bestDist = dist.get(open[0] as string);
      for (var i = 1; i < open.length; i++) {
        var d = dist.get(open[i] as string);
        if (d !== undefined && (bestDist === undefined || d < bestDist)) {
          bestDist = d;
          bestIdx = i;
        }
      }
      var current = open.splice(bestIdx, 1)[0] as string;
      if (current === toZone) {
        // Reconstruct path.
        var pathRev: string[] = [toZone];
        var step = toZone;
        while (prev.has(step)) {
          step = prev.get(step) as string;
          pathRev.push(step);
        }
        return pathRev.reverse();
      }
      var node = this.nodes.get(current);
      if (!node) continue;
      var iter = node.outEdges.values();
      var v = iter.next();
      while (!v.done) {
        var e = v.value;
        if (!this.gateOpen(e, ctx)) { v = iter.next(); continue; }
        var alt = (dist.get(current) as number) + e.weight;
        var existing = dist.get(e.toZone);
        if (existing === undefined || alt < existing) {
          dist.set(e.toZone, alt);
          prev.set(e.toZone, current);
          if (open.indexOf(e.toZone) < 0) open.push(e.toZone);
        }
        v = iter.next();
      }
    }
    return null;
  }

  // Set of all zones reachable from `fromZone` (BFS, gate-filtered).
  reachable(fromZone: string, ctx: Record<string, unknown> = {}): string[] {
    if (!this.nodes.has(fromZone)) return [];
    var visited: Set<string> = new Set();
    visited.add(fromZone);
    var queue: string[] = [fromZone];
    while (queue.length > 0) {
      var current = queue.shift() as string;
      var node = this.nodes.get(current);
      if (!node) continue;
      var iter = node.outEdges.values();
      var v = iter.next();
      while (!v.done) {
        var e = v.value;
        if (this.gateOpen(e, ctx) && !visited.has(e.toZone)) {
          visited.add(e.toZone);
          queue.push(e.toZone);
        }
        v = iter.next();
      }
    }
    var out: string[] = [];
    var ks = visited.values();
    var k = ks.next();
    while (!k.done) {
      out.push(k.value);
      k = ks.next();
    }
    return out;
  }

  isReachable(fromZone: string, toZone: string,
              ctx: Record<string, unknown> = {}): boolean {
    if (fromZone === toZone) return this.nodes.has(fromZone);
    return this.shortestPath(fromZone, toZone, ctx) !== null;
  }

  // ---------- lifecycle ----------

  clear(): void {
    if (this.disposed) return;
    this.nodes.clear();
    this.edgeCount_ = 0;
  }

  dispose(): void {
    this.nodes.clear();
    this.edgeCount_ = 0;
    this.disposed = true;
  }

  // ---------- private ----------

  private gateOpen(e: InternalEdge, ctx: Record<string, unknown>): boolean {
    if (!e.gate) return true;
    try { return !!e.gate(ctx); } catch { return false; }
  }

  private toPublicEdge(e: InternalEdge): RegionEdge {
    var out: RegionEdge = {
      fromZone: e.fromZone,
      toZone: e.toZone,
      weight: e.weight,
    };
    if (e.kind !== null) out.kind = e.kind;
    if (e.gate !== null) out.gate = e.gate;
    if (e.data !== undefined) out.data = e.data;
    return out;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_REGION_GRAPH = 'region_graph';
