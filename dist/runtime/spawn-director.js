// SpawnDirector - declarative spawn rules with rate-limits +
// per-zone caps + budget tracking.
//
// 1.2.2 enabling primitive (Wave 1.2 world depth). CrowdSpawner
// (0.87) handles bulk-spawn waves: "spawn N goblins in this
// arc." SpawnDirector is the higher-level rules engine: "every
// 30s, attempt to spawn a wolf if zone wolfCount < 5,"
// "spawn limit 12 mobs in this zone," "respect a global mob
// budget so the simulation doesn't melt." Per-rule cooldowns,
// per-zone caps, and a global concurrent-spawn budget.
//
//   var sd = SpawnDirector.create({ globalBudget: 100 });
//   sd.defineRule({
//     id: 'forest_wolf',
//     zone: 'forest',
//     intervalMs: 30000,
//     spawnFn: () => spawnEntity({ kind: 'wolf', x: ..., y: ... }),
//     maxPerZone: 5,
//     maxConcurrent: 20,
//   });
//   sd.notifySpawned('forest_wolf');     // call when entity spawns
//   sd.notifyDespawned('forest_wolf');   // call when entity dies
//   each frame: sd.tick(dtMs);
//
// Pairs with CrowdSpawner (0.87, the actual spawn machinery),
// EncounterTable (1.2.3 next, weighted encounter pools),
// FrameBudgetScheduler (0.36, defers heavy spawn callbacks
// across frames).
//
// Code style: var-only in browser source.
const DEFAULT_INTERVAL = 5000;
export class SpawnDirector {
    rules = new Map();
    // Per-zone active count for maxPerZone enforcement.
    // Key = zone + '|' + ruleId because counters track per-rule per-zone
    // (a rule applies to one zone, but we keep the structure flexible).
    zoneCounts = new Map();
    spawnedTotal = 0;
    globalBudget;
    context;
    onSpawned;
    onRejected;
    disposed = false;
    constructor(opts) {
        this.globalBudget = opts.globalBudget !== undefined
            && isFinite(opts.globalBudget) && opts.globalBudget > 0
            ? Math.floor(opts.globalBudget) : Infinity;
        this.context = opts.context ? { ...opts.context } : {};
        this.onSpawned = opts.onSpawned ?? null;
        this.onRejected = opts.onRejected ?? null;
    }
    static create(opts = {}) {
        return new SpawnDirector(opts);
    }
    defineRule(rule) {
        if (this.disposed)
            return false;
        if (!rule || typeof rule.id !== 'string' || rule.id.length === 0)
            return false;
        if (typeof rule.zone !== 'string' || rule.zone.length === 0)
            return false;
        if (typeof rule.spawnFn !== 'function')
            return false;
        var internal = {
            id: rule.id,
            zone: rule.zone,
            intervalMs: rule.intervalMs !== undefined && isFinite(rule.intervalMs)
                && rule.intervalMs >= 0
                ? Math.floor(rule.intervalMs) : DEFAULT_INTERVAL,
            spawnFn: rule.spawnFn,
            maxConcurrent: rule.maxConcurrent !== undefined && isFinite(rule.maxConcurrent)
                && rule.maxConcurrent > 0
                ? Math.floor(rule.maxConcurrent) : Infinity,
            maxPerZone: rule.maxPerZone !== undefined && isFinite(rule.maxPerZone)
                && rule.maxPerZone > 0
                ? Math.floor(rule.maxPerZone) : Infinity,
            cooldownRemainingMs: 0,
            spawnedActive: 0,
        };
        if (rule.gate !== undefined)
            internal.gate = rule.gate;
        if (rule.data !== undefined)
            internal.data = rule.data;
        this.rules.set(rule.id, internal);
        return true;
    }
    removeRule(id) {
        if (this.disposed)
            return false;
        return this.rules.delete(id);
    }
    hasRule(id) {
        return this.rules.has(id);
    }
    // Notify the director that a spawn from rule X happened. The
    // consumer is responsible for calling this so cap accounting
    // stays accurate (engine doesn't observe entity creation).
    notifySpawned(ruleId) {
        if (this.disposed)
            return false;
        var rule = this.rules.get(ruleId);
        if (!rule)
            return false;
        rule.spawnedActive++;
        var key = rule.zone + '|' + rule.id;
        this.zoneCounts.set(key, (this.zoneCounts.get(key) ?? 0) + 1);
        this.spawnedTotal++;
        return true;
    }
    notifyDespawned(ruleId) {
        if (this.disposed)
            return false;
        var rule = this.rules.get(ruleId);
        if (!rule)
            return false;
        if (rule.spawnedActive > 0)
            rule.spawnedActive--;
        var key = rule.zone + '|' + rule.id;
        var z = this.zoneCounts.get(key) ?? 0;
        if (z > 0)
            this.zoneCounts.set(key, z - 1);
        if (this.spawnedTotal > 0)
            this.spawnedTotal--;
        return true;
    }
    // Manual force-attempt outside the cooldown loop. Returns the
    // spawn outcome (or rejection reason).
    tryAttempt(ruleId) {
        if (this.disposed)
            return 'spawnFnFailed';
        var rule = this.rules.get(ruleId);
        if (!rule)
            return 'spawnFnFailed';
        return this.attempt(rule);
    }
    // Tick. Each rule whose cooldown has elapsed attempts a spawn.
    tick(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        var iter = this.rules.values();
        var v = iter.next();
        while (!v.done) {
            var rule = v.value;
            rule.cooldownRemainingMs -= dt;
            if (rule.cooldownRemainingMs <= 0) {
                this.attempt(rule);
                rule.cooldownRemainingMs = rule.intervalMs;
            }
            v = iter.next();
        }
    }
    setContext(ctx) {
        if (this.disposed)
            return;
        this.context = ctx ? { ...ctx } : {};
    }
    setGlobalBudget(budget) {
        if (this.disposed)
            return;
        if (!isFinite(budget) || budget <= 0)
            return;
        this.globalBudget = Math.floor(budget);
    }
    getSpawnedTotal() { return this.spawnedTotal; }
    getActiveCount(ruleId) {
        var rule = this.rules.get(ruleId);
        return rule ? rule.spawnedActive : 0;
    }
    getZoneCount(zone, ruleId) {
        return this.zoneCounts.get(zone + '|' + ruleId) ?? 0;
    }
    ruleCount() { return this.rules.size; }
    ruleIds() {
        var out = [];
        var keys = this.rules.keys();
        var k = keys.next();
        while (!k.done) {
            out.push(k.value);
            k = keys.next();
        }
        return out;
    }
    clear() {
        if (this.disposed)
            return;
        this.rules.clear();
        this.zoneCounts.clear();
        this.spawnedTotal = 0;
    }
    dispose() {
        this.rules.clear();
        this.zoneCounts.clear();
        this.spawnedTotal = 0;
        this.onSpawned = null;
        this.onRejected = null;
        this.disposed = true;
    }
    // ---------- private ----------
    attempt(rule) {
        if (this.spawnedTotal >= this.globalBudget) {
            this.fireRejected(rule.id, 'globalBudget');
            return 'globalBudget';
        }
        if (rule.maxConcurrent <= rule.spawnedActive) {
            this.fireRejected(rule.id, 'maxConcurrent');
            return 'maxConcurrent';
        }
        var key = rule.zone + '|' + rule.id;
        var zoneCount = this.zoneCounts.get(key) ?? 0;
        if (rule.maxPerZone <= zoneCount) {
            this.fireRejected(rule.id, 'maxPerZone');
            return 'maxPerZone';
        }
        if (rule.gate) {
            var allowed = false;
            try {
                allowed = !!rule.gate(this.context);
            }
            catch {
                allowed = false;
            }
            if (!allowed) {
                this.fireRejected(rule.id, 'gate');
                return 'gate';
            }
        }
        var spawned = false;
        try {
            spawned = !!rule.spawnFn();
        }
        catch {
            this.fireRejected(rule.id, 'spawnFnThrew');
            return 'spawnFnThrew';
        }
        if (!spawned) {
            this.fireRejected(rule.id, 'spawnFnFailed');
            return 'spawnFnFailed';
        }
        if (this.onSpawned) {
            try {
                this.onSpawned(rule.id);
            }
            catch { /* ignore */ }
        }
        return 'spawned';
    }
    fireRejected(id, reason) {
        if (!this.onRejected)
            return;
        try {
            this.onRejected(id, reason);
        }
        catch { /* ignore */ }
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_SPAWN_DIRECTOR = 'spawn_director';
//# sourceMappingURL=spawn-director.js.map