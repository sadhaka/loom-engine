// Resource registry for the Loom Engine ECS.
//
// Resources are singleton state injected into systems by string key.
// Time, Input, Camera, RNG, etc. all live here. The registry is just
// a typed Map.
//
// Inspired by Bevy's Resource pattern (see PRIOR-ART.md). Bevy uses
// type-as-key via Rust's TypeId; in TS we use string keys with a
// generic accessor.

export class ResourceRegistry {
  private resources: Map<string, unknown> = new Map();

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
