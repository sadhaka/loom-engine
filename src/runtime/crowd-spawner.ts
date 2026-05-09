// CrowdSpawner - N-mob spawn with budget cap.
//
// 0.87.0 enabling primitive. Open zones, swarm encounters, ambient
// village NPCs all want "spawn up to N goblins, weighted random
// against a small zombie chance, never exceed 100 mobs total."
// CrowdSpawner is the budgeted dispenser: register spawn defs with
// per-id max + weight, request one (random or by id), get back a
// caller-constructed mob or null when the budget is full.
//
//   var spawner = CrowdSpawner.create({ totalBudget: 50 });
//   spawner.registerSpawn({
//     id: 'goblin', factory: () => mobCatalog.spawn('goblin'),
//     max: 30, weight: 4,
//   });
//   spawner.registerSpawn({
//     id: 'zombie', factory: () => mobCatalog.spawn('zombie'),
//     max: 10, weight: 1,
//   });
//   var mob = spawner.spawnRandom();
//   on death: spawner.notifyDespawn('goblin');
//
// Pairs with SteeringBehaviors (0.64) and Pathfinder (0.55) for
// behaviour, plus MobCatalog for the mob factory itself.
//
// Code style: var-only in browser source.

export interface SpawnDef<TMob = unknown> {
  id: string;
  factory: () => TMob;
  // Max simultaneously alive of this spawn id. Default 1.
  max?: number;
  // Relative weight for weighted-random spawn. Default 1.
  weight?: number;
}

export interface CrowdSpawnerOptions {
  // Max total simultaneous mobs across all spawn ids. Default 100.
  totalBudget?: number;
  // RNG callable returning [0, 1). Default Math.random; consumers
  // pass an entropy-bound RNG for replay determinism.
  rng?: () => number;
}

interface InternalDef<TMob> {
  def: SpawnDef<TMob>;
  max: number;
  weight: number;
  active: number;
}

const DEFAULT_BUDGET = 100;

export class CrowdSpawner<TMob = unknown> {
  private spawns: Map<string, InternalDef<TMob>> = new Map();
  private totalActive: number = 0;
  private budget: number;
  private rng: () => number;
  private disposed: boolean = false;

  private constructor(opts: CrowdSpawnerOptions) {
    this.budget = opts.totalBudget !== undefined && isFinite(opts.totalBudget) && opts.totalBudget > 0
      ? Math.floor(opts.totalBudget) : DEFAULT_BUDGET;
    this.rng = opts.rng ?? Math.random;
  }

  static create<TMob = unknown>(opts: CrowdSpawnerOptions = {}): CrowdSpawner<TMob> {
    return new CrowdSpawner<TMob>(opts);
  }

  registerSpawn(def: SpawnDef<TMob>): boolean {
    if (this.disposed) return false;
    if (!def || typeof def.id !== 'string' || def.id.length === 0) return false;
    if (typeof def.factory !== 'function') return false;
    if (this.spawns.has(def.id)) return false;
    var max = def.max !== undefined && isFinite(def.max) && def.max > 0 ? Math.floor(def.max) : 1;
    var weight = def.weight !== undefined && isFinite(def.weight) && def.weight > 0 ? def.weight : 1;
    var copy: SpawnDef<TMob> = { id: def.id, factory: def.factory };
    if (def.max !== undefined) copy.max = max;
    if (def.weight !== undefined) copy.weight = weight;
    this.spawns.set(def.id, { def: copy, max: max, weight: weight, active: 0 });
    return true;
  }

  unregisterSpawn(id: string): boolean {
    if (this.disposed) return false;
    var entry = this.spawns.get(id);
    if (!entry) return false;
    this.totalActive -= entry.active;
    this.spawns.delete(id);
    return true;
  }

  has(id: string): boolean { return this.spawns.has(id); }

  // Spawn a specific id. Returns the mob (caller-constructed via
  // the factory) or null if budget full / spawn id maxed / unknown.
  spawnOne(id: string): TMob | null {
    if (this.disposed) return null;
    var entry = this.spawns.get(id);
    if (!entry) return null;
    if (this.totalActive >= this.budget) return null;
    if (entry.active >= entry.max) return null;
    var mob: TMob;
    try { mob = entry.def.factory(); } catch { return null; }
    entry.active += 1;
    this.totalActive += 1;
    return mob;
  }

  // Spawn one weighted-random across registered spawns whose
  // current active count is below their max AND total budget allows.
  // Returns the mob or null if every spawn id is full.
  spawnRandom(): TMob | null {
    if (this.disposed) return null;
    if (this.totalActive >= this.budget) return null;
    var available: InternalDef<TMob>[] = [];
    var totalWeight = 0;
    this.spawns.forEach((e) => {
      if (e.active < e.max) {
        available.push(e);
        totalWeight += e.weight;
      }
    });
    if (available.length === 0 || totalWeight <= 0) return null;
    var roll = this.rng() * totalWeight;
    if (!isFinite(roll) || roll < 0) roll = 0;
    var acc = 0;
    var pick: InternalDef<TMob> | null = null;
    for (var i = 0; i < available.length; i++) {
      var av = available[i] as InternalDef<TMob>;
      acc += av.weight;
      if (roll < acc) { pick = av; break; }
    }
    if (!pick) pick = available[available.length - 1] as InternalDef<TMob>;
    var mob: TMob;
    try { mob = pick.def.factory(); } catch { return null; }
    pick.active += 1;
    this.totalActive += 1;
    return mob;
  }

  // Notify that a mob from `id` despawned (death / removal).
  // Returns false if id unknown or active count was 0.
  notifyDespawn(id: string): boolean {
    if (this.disposed) return false;
    var entry = this.spawns.get(id);
    if (!entry) return false;
    if (entry.active <= 0) return false;
    entry.active -= 1;
    this.totalActive -= 1;
    return true;
  }

  activeCountOf(id: string): number {
    var e = this.spawns.get(id);
    return e ? e.active : 0;
  }

  getTotalActive(): number { return this.totalActive; }
  totalBudget(): number { return this.budget; }
  budgetRemaining(): number { return Math.max(0, this.budget - this.totalActive); }

  size(): number { return this.spawns.size; }

  list(): SpawnDef<TMob>[] {
    var out: SpawnDef<TMob>[] = [];
    this.spawns.forEach((e) => {
      var copy: SpawnDef<TMob> = { id: e.def.id, factory: e.def.factory };
      if (e.def.max !== undefined) copy.max = e.def.max;
      if (e.def.weight !== undefined) copy.weight = e.def.weight;
      out.push(copy);
    });
    return out;
  }

  clear(): void {
    if (this.disposed) return;
    this.spawns.clear();
    this.totalActive = 0;
  }

  dispose(): void {
    this.spawns.clear();
    this.totalActive = 0;
    this.disposed = true;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_CROWD_SPAWNER = 'crowd_spawner';
