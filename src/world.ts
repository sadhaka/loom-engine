// World - the ECS container for the Loom Engine.
//
// Holds:
//   - EntityAllocator: 32-bit handle allocator
//   - Component pools: registered by string key, opaque to the world
//   - Systems: ordered by phase, run in registration order within
//     a phase
//   - Resources: singleton state (Time, Camera, Device, Input, RNG)
//
// Systems read/write pools + resources directly. The world doesn't
// dispatch queries; systems are responsible for knowing which pools
// they need.
//
// Inspiration:
//   - PlayCanvas ECS shape (component-pool registration pattern)
//   - Bevy ECS scheduling (Resource pattern, phase ordering)
// See PRIOR-ART.md.

import { EntityAllocator, type EntityId } from './entity.js';
import { ResourceRegistry } from './resources.js';
import {
  type System,
  type SystemPhase,
  SYSTEM_PHASE_LOGIC,
  SYSTEM_PHASES_IN_ORDER,
} from './system.js';

export class World {
  readonly entities: EntityAllocator;
  readonly resources: ResourceRegistry;

  // Component pools registered by string key. Opaque - the world
  // never inspects them, just stores + hands back. Systems know what
  // type each pool is (TransformPool, SpritePool, etc.).
  private pools: Map<string, unknown> = new Map();

  // Systems indexed by phase. Within a phase, registration order is
  // preserved (Map iteration is insertion-ordered for string keys).
  private systemsByPhase: Map<SystemPhase, System[]> = new Map();

  constructor() {
    this.entities = new EntityAllocator();
    this.resources = new ResourceRegistry();
    for (const phase of SYSTEM_PHASES_IN_ORDER) {
      this.systemsByPhase.set(phase, []);
    }
  }

  // Component pool registration. The pool is whatever the caller
  // passes; the world is just a typed Map under the hood.
  registerPool<T>(key: string, pool: T): void {
    this.pools.set(key, pool);
  }

  getPool<T>(key: string): T | undefined {
    return this.pools.get(key) as T | undefined;
  }

  requirePool<T>(key: string): T {
    const v = this.pools.get(key);
    if (v === undefined) {
      throw new Error('World: required pool "' + key + '" not registered');
    }
    return v as T;
  }

  // System registration. Default phase is LOGIC; render systems
  // pass SYSTEM_PHASE_RENDER explicitly.
  addSystem(system: System, phase: SystemPhase = SYSTEM_PHASE_LOGIC): void {
    const list = this.systemsByPhase.get(phase);
    if (!list) {
      // Phase not in SYSTEM_PHASES_IN_ORDER - guard rail.
      throw new Error('World: unknown system phase ' + phase);
    }
    list.push(system);
  }

  // Run all systems in phase order. dt is seconds-since-last-tick.
  update(dt: number): void {
    for (const phase of SYSTEM_PHASES_IN_ORDER) {
      const list = this.systemsByPhase.get(phase);
      if (!list) continue;
      for (const sys of list) {
        sys.update(this, dt);
      }
    }
  }

  // Diagnostics.
  countEntities(): number {
    return this.entities.count();
  }

  countSystems(): number {
    let total = 0;
    for (const list of this.systemsByPhase.values()) {
      total += list.length;
    }
    return total;
  }

  countSystemsInPhase(phase: SystemPhase): number {
    return this.systemsByPhase.get(phase)?.length ?? 0;
  }

  // Convenience passthrough for the most common operation.
  createEntity(): EntityId {
    return this.entities.create();
  }

  destroyEntity(e: EntityId): boolean {
    return this.entities.destroy(e);
  }
}

// Conventional pool keys. Systems and components use these to find
// each other so a pool registered as POOL_TRANSFORM is discoverable
// by any system that needs transforms.
export const POOL_TRANSFORM = 'transform';
export const POOL_SPRITE = 'sprite';
