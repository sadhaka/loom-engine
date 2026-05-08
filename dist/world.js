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
import { EntityAllocator } from './entity.js';
import { ResourceRegistry } from './resources.js';
import { SYSTEM_PHASE_LOGIC, SYSTEM_PHASES_IN_ORDER, } from './system.js';
export class World {
    entities;
    resources;
    // Component pools registered by string key. Opaque - the world
    // never inspects them, just stores + hands back. Systems know what
    // type each pool is (TransformPool, SpritePool, etc.).
    pools = new Map();
    // Systems indexed by phase. Within a phase, registration order is
    // preserved (Map iteration is insertion-ordered for string keys).
    systemsByPhase = new Map();
    constructor() {
        this.entities = new EntityAllocator();
        this.resources = new ResourceRegistry();
        // 0.21.0 - bind world reference so resource lifecycle hooks
        // (onAttach / onDetach) receive the world that owns them.
        this.resources.bindWorld(this);
        for (const phase of SYSTEM_PHASES_IN_ORDER) {
            this.systemsByPhase.set(phase, []);
        }
    }
    // Component pool registration. The pool is whatever the caller
    // passes; the world is just a typed Map under the hood.
    registerPool(key, pool) {
        this.pools.set(key, pool);
    }
    getPool(key) {
        return this.pools.get(key);
    }
    requirePool(key) {
        const v = this.pools.get(key);
        if (v === undefined) {
            throw new Error('World: required pool "' + key + '" not registered');
        }
        return v;
    }
    // System registration. Default phase is LOGIC; render systems
    // pass SYSTEM_PHASE_RENDER explicitly.
    addSystem(system, phase = SYSTEM_PHASE_LOGIC) {
        const list = this.systemsByPhase.get(phase);
        if (!list) {
            // Phase not in SYSTEM_PHASES_IN_ORDER - guard rail.
            throw new Error('World: unknown system phase ' + phase);
        }
        list.push(system);
    }
    // Run all systems in phase order. dt is seconds-since-last-tick.
    update(dt) {
        for (const phase of SYSTEM_PHASES_IN_ORDER) {
            const list = this.systemsByPhase.get(phase);
            if (!list)
                continue;
            for (const sys of list) {
                sys.update(this, dt);
            }
        }
    }
    // Diagnostics.
    countEntities() {
        return this.entities.count();
    }
    countSystems() {
        let total = 0;
        for (const list of this.systemsByPhase.values()) {
            total += list.length;
        }
        return total;
    }
    countSystemsInPhase(phase) {
        return this.systemsByPhase.get(phase)?.length ?? 0;
    }
    // Convenience passthrough for the most common operation.
    createEntity() {
        return this.entities.create();
    }
    destroyEntity(e) {
        return this.entities.destroy(e);
    }
    // 0.21.0 - graceful shutdown. Disposes every IManagedResource
    // (calling onDetach + dispose in registration order), then clears
    // the system phase map and the entity allocator. Idempotent: a
    // second dispose() is a no-op since the registry is already empty.
    // Systems can implement an `onDispose(world)` method that we call
    // before shutting down resources, mirroring the resource lifecycle
    // for symmetric cleanup.
    dispose() {
        // Phase 1: notify systems first so they can release any handles
        // they hold to resources before the resources go away.
        for (const phase of SYSTEM_PHASES_IN_ORDER) {
            const list = this.systemsByPhase.get(phase);
            if (!list)
                continue;
            for (const sys of list) {
                const s = sys;
                if (typeof s.onDispose === 'function') {
                    try {
                        s.onDispose(this);
                    }
                    catch (e) {
                        try {
                            console.error('[World] system onDispose threw:', e);
                        }
                        catch { /* ignore */ }
                    }
                }
            }
            list.length = 0;
        }
        // Phase 2: dispose resources in registration order.
        this.resources.disposeAll();
        // Phase 3: clear pools (no lifecycle for pools yet; just drop).
        this.pools.clear();
    }
}
// Conventional pool keys. Systems and components use these to find
// each other so a pool registered as POOL_TRANSFORM is discoverable
// by any system that needs transforms.
export const POOL_TRANSFORM = 'transform';
export const POOL_SPRITE = 'sprite';
//# sourceMappingURL=world.js.map