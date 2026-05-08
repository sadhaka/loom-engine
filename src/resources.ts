// Resource registry for the Loom Engine ECS.
//
// Resources are singleton state injected into systems by string key.
// Time, Input, Camera, RNG, etc. all live here. The registry is just
// a typed Map.
//
// Inspired by Bevy's Resource pattern (see PRIOR-ART.md). Bevy uses
// type-as-key via Rust's TypeId; in TS we use string keys with a
// generic accessor.
//
// 0.21.0 - lifecycle hooks. Resources MAY implement IManagedResource
// to participate in attach / detach / dispose. Existing resources are
// untouched (backwards-compatible); new resources that own external
// state (workers, listeners, network bridges, audio contexts, pools)
// can declare hooks the registry calls at the right moments.

// Forward-declared minimal world interface for lifecycle hooks. The
// concrete World class in world.ts is structurally compatible. Using
// a structural type here avoids the circular import that would arise
// from `import type { World } from './world.js'`.
export interface LifecycleWorld {
  resources: ResourceRegistry;
}

// Optional lifecycle hooks for managed resources.
//
// onAttach: called once when the resource is registered via
//           ResourceRegistry.attach(). Use to spawn workers, register
//           DOM listeners, allocate pools, open network bridges.
// onDetach: called by detach() / disposeAll() before removal. Pair
//           of onAttach.
// dispose:  called after onDetach. Final cleanup; the resource is
//           about to be unreferenced.
//
// All three are optional. A resource that cares about only one (e.g.
// just dispose) can declare just that method. The legacy set() /
// remove() path bypasses these hooks; only attach / detach trigger
// them. This keeps existing code paths intact while opting in.
export interface IManagedResource {
  onAttach?(world: LifecycleWorld): void;
  onDetach?(world: LifecycleWorld): void;
  dispose?(): void;
}

export class ResourceRegistry {
  private resources: Map<string, unknown> = new Map();
  private world: LifecycleWorld | null = null;

  // 0.21.0 - bind a world reference so attach/detach/disposeAll can
  // pass it to IManagedResource hooks. The World constructor calls
  // this immediately after creating the registry. Mid-flight rebinds
  // are not supported (no use case yet).
  bindWorld(world: LifecycleWorld): void {
    this.world = world;
  }

  set<T>(key: string, value: T): void {
    this.resources.set(key, value);
  }

  get<T>(key: string): T | undefined {
    return this.resources.get(key) as T | undefined;
  }

  // Throws if missing. Useful for resources that must always exist
  // (Time, Camera) so the call site stays terse.
  require<T>(key: string): T {
    const v = this.resources.get(key);
    if (v === undefined) {
      throw new Error('ResourceRegistry: required resource "' + key + '" not registered');
    }
    return v as T;
  }

  has(key: string): boolean {
    return this.resources.has(key);
  }

  remove(key: string): boolean {
    return this.resources.delete(key);
  }

  keys(): IterableIterator<string> {
    return this.resources.keys();
  }

  // -- Phase 0.21.0 lifecycle ----------------------------------------

  // Lifecycle-aware setter. If `value` implements IManagedResource,
  // calls onAttach(world). Replaces an existing key idempotently;
  // the displaced value's onDetach + dispose run before the new
  // value's onAttach so callers can rely on hook ordering.
  attach<T>(key: string, value: T): void {
    if (this.resources.has(key)) {
      this.detach(key);
    }
    this.resources.set(key, value);
    if (!this.world) return;
    const r = value as unknown as IManagedResource;
    if (r && typeof r.onAttach === 'function') {
      try {
        r.onAttach(this.world);
      } catch (e) {
        try { console.error('[ResourceRegistry] onAttach for "' + key + '" threw:', e); }
        catch { /* ignore */ }
      }
    }
  }

  // Lifecycle-aware remover. Calls onDetach + dispose (in that order)
  // before deleting. Returns true iff a row was actually removed.
  // Errors in hooks are logged but do not block the removal.
  detach(key: string): boolean {
    const value = this.resources.get(key);
    if (value === undefined) return false;
    const r = value as IManagedResource;
    if (this.world && typeof r?.onDetach === 'function') {
      try {
        r.onDetach(this.world);
      } catch (e) {
        try { console.error('[ResourceRegistry] onDetach for "' + key + '" threw:', e); }
        catch { /* ignore */ }
      }
    }
    if (typeof r?.dispose === 'function') {
      try {
        r.dispose();
      } catch (e) {
        try { console.error('[ResourceRegistry] dispose for "' + key + '" threw:', e); }
        catch { /* ignore */ }
      }
    }
    return this.resources.delete(key);
  }

  // Detach and dispose every registered resource. Used by
  // World.dispose() during graceful shutdown. Iteration order is
  // insertion order; resources are responsible for handling the
  // case where a sibling resource has already disposed.
  disposeAll(): void {
    // Snapshot keys so detach() can safely mutate the map mid-loop.
    const snapshot: string[] = [];
    for (const k of this.resources.keys()) snapshot.push(k);
    for (const k of snapshot) {
      this.detach(k);
    }
  }
}

// Built-in Time resource - elapsed seconds since engine start, last
// frame delta, frame counter. Engine.tick advances it.
export interface TimeResource {
  // Total elapsed time in seconds since engine start.
  elapsed: number;
  // Delta time of the last tick in seconds. Clamped to a max of
  // 1/30s to avoid spiral-of-death after a long pause.
  delta: number;
  // Frame counter, increments on each tick.
  frame: number;
}

export function createTimeResource(): TimeResource {
  return { elapsed: 0, delta: 0, frame: 0 };
}

export const RESOURCE_TIME = 'time';
export const RESOURCE_CAMERA = 'camera';
export const RESOURCE_DEVICE = 'device';

// VeilBudget - the novelty hook tying renderer cost to the user's
// monthly Veil Essence economy (per LOOM-ENGINE-SPEC.md Section 3
// patent claim). The Director-bridge updates this each tick from
// backend state (per-character monthly cap, current spend rate,
// minute-of-hour throttle). Render systems READ it before issuing
// expensive work:
//   - Particle systems clamp maxParticles to budget.particleBudget
//   - VFX shader effects gate post-passes on budget.shaderBudget
//   - Director-driven encounter density scales to budget.eventBudget
//
// The default budget allows generous defaults so the engine works
// standalone without a Director attached. The Director-bridge in
// Phase 6 will overwrite these with real values.
export interface VeilBudgetResource {
  // Max simultaneous live particles. ParticleSimulationSystem
  // doesn't reference this directly; ParticlePool.setMaxParticles
  // does, called by an external coordinator (in v1, the demo /
  // ARPG; in v2+, the Director-bridge).
  particleBudget: number;
  // Reserved for Phase 4+: max post-process passes per frame.
  shaderBudget: number;
  // Reserved for Phase 6: encounter event ingest rate (events/sec).
  eventBudget: number;
  // Phase 5: audio level in [0, 1]. AudioBus reads this each tick
  // and ducks ambient buses below 0.25, mutes everything below 0.05.
  // 1 = full audio; 0 = silent. The Director-bridge sets this from
  // server-side load + per-character VE drain.
  audioBudget: number;
  // Diagnostic: last frame the Director updated this budget. -1 if
  // never updated (engine standalone or demo).
  lastUpdatedFrame: number;
}

export function createVeilBudgetResource(): VeilBudgetResource {
  return {
    particleBudget: 4096,
    shaderBudget: 8,
    eventBudget: 256,
    audioBudget: 1.0,
    lastUpdatedFrame: -1,
  };
}

export const RESOURCE_VEIL_BUDGET = 'veil_budget';
