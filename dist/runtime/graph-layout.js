// GraphLayout - force-directed node graph layout.
//
// 1.5.2 enabling primitive (Wave 1.5 educational depth). Used for
// knowledge maps (concept relationships), NPC relationship
// diagrams, quest dependency graphs, skill trees, network topology
// displays. Nodes repel each other (Coulomb-like 1/r^2), edges
// pull connected nodes together (Hooke spring), optional center
// force keeps the graph from drifting away. Each tick integrates
// forces and updates positions; consumer reads positions for
// rendering.
//
//   var g = GraphLayout.create({});
//   g.addNode({ id: 'concept_a' });
//   g.addNode({ id: 'concept_b' });
//   g.addNode({ id: 'concept_c' });
//   g.addEdge({ fromId: 'concept_a', toId: 'concept_b' });
//   g.addEdge({ fromId: 'concept_b', toId: 'concept_c' });
//
//   // Run until stable.
//   g.stabilize();
//
//   // Or tick per frame for live animation.
//   each frame: g.tick(dtMs);
//
//   var snap = g.getSnapshot();
//   snap.nodes.forEach((n) => renderer.drawCircle(n.x, n.y));
//   snap.edges.forEach((e) => renderer.drawLine(e.from.x, e.from.y, e.to.x, e.to.y));
//
// Pairs with TimelineLedger (1.5.1, time-axis events),
// RegionGraph (1.2.1, world topology - feed it nodes + edges),
// RelationshipGraph (1.3.1, character bonds visualizable here).
//
// Code style: var-only in browser source.
const DEFAULT_REPULSION = 1000;
const DEFAULT_ATTRACTION = 0.05;
const DEFAULT_DAMPING = 0.85;
const DEFAULT_CENTER_FORCE = 0.01;
const DEFAULT_STABLE_THRESHOLD = 0.5;
const DEFAULT_REST_LENGTH = 50;
const DEFAULT_EDGE_STRENGTH = 0.1;
const DEFAULT_MAX_STABILIZE = 500;
function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        var t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
    };
}
export class GraphLayout {
    nodes = new Map();
    edges = [];
    rng;
    repulsion;
    attraction;
    damping;
    centerForce;
    stableThreshold;
    maxStabilizeIter;
    disposed = false;
    constructor(opts) {
        this.repulsion = opts.repulsion !== undefined && isFinite(opts.repulsion)
            ? opts.repulsion : DEFAULT_REPULSION;
        this.attraction = opts.attraction !== undefined && isFinite(opts.attraction)
            ? opts.attraction : DEFAULT_ATTRACTION;
        this.damping = opts.damping !== undefined && isFinite(opts.damping)
            && opts.damping >= 0 && opts.damping <= 1
            ? opts.damping : DEFAULT_DAMPING;
        this.centerForce = opts.centerForce !== undefined && isFinite(opts.centerForce)
            ? opts.centerForce : DEFAULT_CENTER_FORCE;
        this.stableThreshold = opts.stableThreshold !== undefined
            && isFinite(opts.stableThreshold) && opts.stableThreshold >= 0
            ? opts.stableThreshold : DEFAULT_STABLE_THRESHOLD;
        this.maxStabilizeIter = opts.maxStabilizeIterations !== undefined
            && isFinite(opts.maxStabilizeIterations) && opts.maxStabilizeIterations > 0
            ? Math.floor(opts.maxStabilizeIterations) : DEFAULT_MAX_STABILIZE;
        if (typeof opts.rng === 'function') {
            this.rng = opts.rng;
        }
        else {
            var seed = opts.seed !== undefined && isFinite(opts.seed) ? opts.seed : 1;
            this.rng = mulberry32(seed);
        }
    }
    static create(opts = {}) {
        return new GraphLayout(opts);
    }
    // ---------- node management ----------
    addNode(spec) {
        if (this.disposed)
            return false;
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0)
            return false;
        var node = {
            id: spec.id,
            x: spec.x !== undefined && isFinite(spec.x)
                ? spec.x : (this.safeRng() - 0.5) * 200,
            y: spec.y !== undefined && isFinite(spec.y)
                ? spec.y : (this.safeRng() - 0.5) * 200,
            vx: 0,
            vy: 0,
            mass: spec.mass !== undefined && isFinite(spec.mass) && spec.mass > 0
                ? spec.mass : 1,
            pinned: !!spec.pinned,
        };
        if (spec.data !== undefined)
            node.data = spec.data;
        this.nodes.set(spec.id, node);
        return true;
    }
    removeNode(id) {
        if (this.disposed)
            return false;
        if (!this.nodes.delete(id))
            return false;
        // Drop edges referencing this node.
        var keep = [];
        for (var i = 0; i < this.edges.length; i++) {
            var e = this.edges[i];
            if (e.fromId !== id && e.toId !== id)
                keep.push(e);
        }
        this.edges = keep;
        return true;
    }
    hasNode(id) {
        return this.nodes.has(id);
    }
    getNode(id) {
        var n = this.nodes.get(id);
        return n ? this.snapshotNode(n) : null;
    }
    setPosition(id, x, y) {
        if (this.disposed)
            return false;
        var n = this.nodes.get(id);
        if (!n)
            return false;
        if (!isFinite(x) || !isFinite(y))
            return false;
        n.x = x;
        n.y = y;
        n.vx = 0;
        n.vy = 0;
        return true;
    }
    setPinned(id, pinned) {
        if (this.disposed)
            return false;
        var n = this.nodes.get(id);
        if (!n)
            return false;
        n.pinned = !!pinned;
        if (n.pinned) {
            n.vx = 0;
            n.vy = 0;
        }
        return true;
    }
    nodeCount() { return this.nodes.size; }
    // ---------- edge management ----------
    addEdge(spec) {
        if (this.disposed)
            return false;
        if (!spec || typeof spec.fromId !== 'string'
            || typeof spec.toId !== 'string')
            return false;
        if (spec.fromId === spec.toId)
            return false;
        if (!this.nodes.has(spec.fromId) || !this.nodes.has(spec.toId))
            return false;
        if (this.edgeIndex(spec.fromId, spec.toId) >= 0)
            return false;
        this.edges.push({
            fromId: spec.fromId,
            toId: spec.toId,
            restLength: spec.restLength !== undefined && isFinite(spec.restLength)
                && spec.restLength > 0 ? spec.restLength : DEFAULT_REST_LENGTH,
            strength: spec.strength !== undefined && isFinite(spec.strength)
                && spec.strength >= 0 ? spec.strength : DEFAULT_EDGE_STRENGTH,
        });
        return true;
    }
    removeEdge(fromId, toId) {
        if (this.disposed)
            return false;
        var idx = this.edgeIndex(fromId, toId);
        if (idx < 0)
            return false;
        this.edges.splice(idx, 1);
        return true;
    }
    hasEdge(fromId, toId) {
        return this.edgeIndex(fromId, toId) >= 0;
    }
    edgeCount() { return this.edges.length; }
    // ---------- simulation ----------
    // One simulation step. dtMs is treated as a time scale (higher
    // = bigger step). Use ~16ms per call for 60fps animation.
    tick(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        // Convert ms to a normalized step (16ms = 1 unit).
        var step = dt / 16;
        this.simulateStep(step);
    }
    // Run multiple ticks until energy < threshold or maxIterations
    // reached. Returns the iteration count used.
    stabilize(maxIterations) {
        if (this.disposed)
            return 0;
        var max = maxIterations !== undefined && isFinite(maxIterations)
            && maxIterations > 0 ? Math.floor(maxIterations) : this.maxStabilizeIter;
        var i = 0;
        while (i < max) {
            this.simulateStep(1);
            if (this.computeEnergy() < this.stableThreshold)
                break;
            i++;
        }
        return i;
    }
    // ---------- read-out ----------
    positions() {
        var out = [];
        var iter = this.nodes.values();
        var v = iter.next();
        while (!v.done) {
            out.push(this.snapshotNode(v.value));
            v = iter.next();
        }
        return out;
    }
    getSnapshot() {
        var nodes = this.positions();
        var edges = [];
        for (var i = 0; i < this.edges.length; i++) {
            var e = this.edges[i];
            var from = this.nodes.get(e.fromId);
            var to = this.nodes.get(e.toId);
            if (!from || !to)
                continue;
            edges.push({
                fromId: e.fromId,
                toId: e.toId,
                fromX: from.x,
                fromY: from.y,
                toX: to.x,
                toY: to.y,
                restLength: e.restLength,
                strength: e.strength,
            });
        }
        var energy = this.computeEnergy();
        return {
            nodes: nodes,
            edges: edges,
            energy: energy,
            isStable: energy < this.stableThreshold,
        };
    }
    forEach(cb) {
        if (this.disposed)
            return;
        var iter = this.nodes.values();
        var v = iter.next();
        while (!v.done) {
            try {
                cb(this.snapshotNode(v.value));
            }
            catch { /* ignore */ }
            v = iter.next();
        }
    }
    clear() {
        if (this.disposed)
            return;
        this.nodes.clear();
        this.edges.length = 0;
    }
    dispose() {
        this.nodes.clear();
        this.edges.length = 0;
        this.disposed = true;
    }
    // ---------- private ----------
    edgeIndex(fromId, toId) {
        for (var i = 0; i < this.edges.length; i++) {
            var e = this.edges[i];
            if (e.fromId === fromId && e.toId === toId)
                return i;
        }
        return -1;
    }
    simulateStep(step) {
        var nodes = [];
        var iter = this.nodes.values();
        var v = iter.next();
        while (!v.done) {
            nodes.push(v.value);
            v = iter.next();
        }
        if (nodes.length === 0)
            return;
        // Accumulator for forces.
        var fx = new Array(nodes.length);
        var fy = new Array(nodes.length);
        for (var i = 0; i < nodes.length; i++) {
            fx[i] = 0;
            fy[i] = 0;
        }
        // Repulsion (all pairs).
        for (var i2 = 0; i2 < nodes.length; i2++) {
            for (var j = i2 + 1; j < nodes.length; j++) {
                var a = nodes[i2];
                var b = nodes[j];
                var dx = b.x - a.x;
                var dy = b.y - a.y;
                var dist2 = dx * dx + dy * dy;
                if (dist2 < 1)
                    dist2 = 1; // avoid singularity
                var invDist = 1 / Math.sqrt(dist2);
                var force = this.repulsion / dist2;
                var fxComp = force * dx * invDist;
                var fyComp = force * dy * invDist;
                fx[i2] = fx[i2] - fxComp;
                fy[i2] = fy[i2] - fyComp;
                fx[j] = fx[j] + fxComp;
                fy[j] = fy[j] + fyComp;
            }
        }
        // Attraction (springs).
        for (var k = 0; k < this.edges.length; k++) {
            var edge = this.edges[k];
            var fromIdx = -1;
            var toIdx = -1;
            for (var n = 0; n < nodes.length; n++) {
                if (nodes[n].id === edge.fromId)
                    fromIdx = n;
                if (nodes[n].id === edge.toId)
                    toIdx = n;
            }
            if (fromIdx < 0 || toIdx < 0)
                continue;
            var na = nodes[fromIdx];
            var nb = nodes[toIdx];
            var ex = nb.x - na.x;
            var ey = nb.y - na.y;
            var elen = Math.sqrt(ex * ex + ey * ey);
            if (elen < 0.01)
                continue;
            var displacement = elen - edge.restLength;
            var springForce = this.attraction * edge.strength * displacement;
            var sxComp = springForce * ex / elen;
            var syComp = springForce * ey / elen;
            fx[fromIdx] = fx[fromIdx] + sxComp;
            fy[fromIdx] = fy[fromIdx] + syComp;
            fx[toIdx] = fx[toIdx] - sxComp;
            fy[toIdx] = fy[toIdx] - syComp;
        }
        // Center force + integrate.
        for (var m = 0; m < nodes.length; m++) {
            var node = nodes[m];
            if (node.pinned) {
                node.vx = 0;
                node.vy = 0;
                continue;
            }
            var fxn = fx[m];
            var fyn = fy[m];
            // Center pull.
            fxn -= this.centerForce * node.x;
            fyn -= this.centerForce * node.y;
            // Integrate velocity.
            node.vx = (node.vx + (fxn / node.mass) * step) * this.damping;
            node.vy = (node.vy + (fyn / node.mass) * step) * this.damping;
            // Integrate position.
            node.x += node.vx * step;
            node.y += node.vy * step;
        }
    }
    computeEnergy() {
        var energy = 0;
        var iter = this.nodes.values();
        var v = iter.next();
        while (!v.done) {
            var n = v.value;
            if (!n.pinned) {
                energy += n.vx * n.vx + n.vy * n.vy;
            }
            v = iter.next();
        }
        return energy;
    }
    snapshotNode(n) {
        var out = {
            id: n.id,
            x: n.x,
            y: n.y,
            vx: n.vx,
            vy: n.vy,
            mass: n.mass,
            pinned: n.pinned,
        };
        if (n.data !== undefined)
            out.data = n.data;
        return out;
    }
    safeRng() {
        var r = 0;
        try {
            r = this.rng();
        }
        catch {
            r = 0.5;
        }
        if (!isFinite(r) || r < 0)
            r = 0;
        if (r >= 1)
            r = 0.9999;
        return r;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_GRAPH_LAYOUT = 'graph_layout';
//# sourceMappingURL=graph-layout.js.map