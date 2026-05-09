// AssetManifest - declarative asset list + dependency graph.
//
// 0.84.0 enabling primitive. AssetPreloader (0.34) takes a flat
// list of URLs to load, but real consumer apps have asset
// dependencies: "the boss spawn animation depends on the boss
// spritesheet, which depends on the shared atlas." AssetManifest
// owns that graph: declare each asset with its dependencies, run
// resolve() to get a topologically-sorted load order, then feed
// that to AssetPreloader.
//
//   var manifest = AssetManifest.create({
//     entries: [
//       { id: 'atlas:main', type: 'image', url: '/assets/atlas.png' },
//       { id: 'sheet:hydra', type: 'image', url: '/assets/hydra.png',
//         deps: ['atlas:main'] },
//       { id: 'anim:hydra-spawn', type: 'json', url: '/anims/hydra-spawn.json',
//         deps: ['sheet:hydra'] },
//     ],
//   });
//   var resolved = manifest.resolve();
//   if (resolved.ok) preloader.load(resolved.order.map((id) => manifest.get(id)!));
//
// Pairs with AssetPreloader (0.34).
//
// Code style: var-only in browser source.
export class AssetManifest {
    byId = new Map();
    disposed = false;
    constructor(opts) {
        if (opts.entries) {
            for (var i = 0; i < opts.entries.length; i++) {
                var e = opts.entries[i];
                if (isValid(e) && !this.byId.has(e.id)) {
                    this.byId.set(e.id, cloneEntry(e));
                }
            }
        }
    }
    static create(opts = {}) {
        return new AssetManifest(opts);
    }
    add(entry) {
        if (this.disposed)
            return false;
        if (!isValid(entry))
            return false;
        if (this.byId.has(entry.id))
            return false;
        this.byId.set(entry.id, cloneEntry(entry));
        return true;
    }
    remove(id) {
        if (this.disposed)
            return false;
        return this.byId.delete(id);
    }
    has(id) { return this.byId.has(id); }
    get(id) {
        var e = this.byId.get(id);
        return e ? cloneEntry(e) : null;
    }
    size() { return this.byId.size; }
    list() {
        var out = [];
        this.byId.forEach((e) => out.push(cloneEntry(e)));
        return out;
    }
    clear() {
        if (this.disposed)
            return;
        this.byId.clear();
    }
    // Resolve a topological load order over the entire manifest.
    resolve() {
        if (this.disposed)
            return { ok: false, reason: 'cycle', offenders: [] };
        var ids = [];
        this.byId.forEach((_e, id) => ids.push(id));
        return this.topoSort(ids);
    }
    // Resolve the load order for a single id (and all transitive
    // dependencies). Returns 'unknown_id' if the id isn't registered.
    resolveFor(id) {
        if (this.disposed)
            return { ok: false, reason: 'unknown_id', offenders: [id] };
        if (!this.byId.has(id))
            return { ok: false, reason: 'unknown_id', offenders: [id] };
        // BFS to collect transitive deps.
        var collected = new Set();
        var queue = [id];
        var missing = [];
        while (queue.length > 0) {
            var cur = queue.shift();
            if (collected.has(cur))
                continue;
            collected.add(cur);
            var entry = this.byId.get(cur);
            if (!entry) {
                if (missing.indexOf(cur) < 0)
                    missing.push(cur);
                continue;
            }
            if (entry.deps) {
                for (var i = 0; i < entry.deps.length; i++) {
                    var dep = entry.deps[i];
                    if (!this.byId.has(dep)) {
                        if (missing.indexOf(dep) < 0)
                            missing.push(dep);
                    }
                    else if (!collected.has(dep)) {
                        queue.push(dep);
                    }
                }
            }
        }
        if (missing.length > 0) {
            return { ok: false, reason: 'missing_dep', offenders: missing };
        }
        var ids = [];
        collected.forEach((c) => ids.push(c));
        return this.topoSort(ids);
    }
    dispose() {
        this.byId.clear();
        this.disposed = true;
    }
    // ---------- private ----------
    // Kahn's algorithm topological sort over the given ids.
    topoSort(ids) {
        var inDegree = new Map();
        var dependents = new Map();
        var idsSet = new Set(ids);
        var missing = [];
        for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            var entry = this.byId.get(id);
            if (!entry)
                continue;
            inDegree.set(id, 0);
        }
        for (var j = 0; j < ids.length; j++) {
            var idj = ids[j];
            var ej = this.byId.get(idj);
            if (!ej)
                continue;
            if (!ej.deps)
                continue;
            for (var k = 0; k < ej.deps.length; k++) {
                var dep = ej.deps[k];
                if (!this.byId.has(dep)) {
                    if (missing.indexOf(dep) < 0)
                        missing.push(dep);
                    continue;
                }
                if (!idsSet.has(dep)) {
                    // Dep is in manifest but not in the requested subset.
                    // Pull it in.
                    idsSet.add(dep);
                    inDegree.set(dep, 0);
                }
                inDegree.set(idj, (inDegree.get(idj) || 0) + 1);
                var arr = dependents.get(dep);
                if (!arr) {
                    arr = [];
                    dependents.set(dep, arr);
                }
                arr.push(idj);
            }
        }
        if (missing.length > 0) {
            return { ok: false, reason: 'missing_dep', offenders: missing };
        }
        var queue = [];
        inDegree.forEach((deg, id) => {
            if (deg === 0)
                queue.push(id);
        });
        queue.sort(); // deterministic ordering for ties
        var order = [];
        while (queue.length > 0) {
            var cur = queue.shift();
            order.push(cur);
            var deps = dependents.get(cur);
            if (deps) {
                deps.sort();
                for (var d = 0; d < deps.length; d++) {
                    var dn = deps[d];
                    var nd = (inDegree.get(dn) || 0) - 1;
                    inDegree.set(dn, nd);
                    if (nd === 0)
                        queue.push(dn);
                }
            }
        }
        if (order.length !== inDegree.size) {
            var cycleOffenders = [];
            inDegree.forEach((deg, id) => { if (deg > 0)
                cycleOffenders.push(id); });
            return { ok: false, reason: 'cycle', offenders: cycleOffenders };
        }
        return { ok: true, order: order };
    }
}
function isValid(e) {
    if (!e)
        return false;
    if (typeof e.id !== 'string' || e.id.length === 0)
        return false;
    if (typeof e.type !== 'string' || e.type.length === 0)
        return false;
    if (typeof e.url !== 'string' || e.url.length === 0)
        return false;
    if (e.deps !== undefined) {
        if (!Array.isArray(e.deps))
            return false;
        for (var i = 0; i < e.deps.length; i++) {
            var d = e.deps[i];
            if (typeof d !== 'string' || d.length === 0)
                return false;
        }
    }
    return true;
}
function cloneEntry(e) {
    var copy = { id: e.id, type: e.type, url: e.url };
    if (e.deps)
        copy.deps = e.deps.slice();
    if (e.data)
        copy.data = e.data;
    return copy;
}
// Resource key for the world's resource registry.
export const RESOURCE_ASSET_MANIFEST = 'asset_manifest';
//# sourceMappingURL=asset-manifest.js.map