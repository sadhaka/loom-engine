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
