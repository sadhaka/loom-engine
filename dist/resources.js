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
export class ResourceRegistry {
    resources = new Map();
    world = null;
    // 0.21.0 - bind a world reference so attach/detach/disposeAll can
    // pass it to IManagedResource hooks. The World constructor calls
    // this immediately after creating the registry. Mid-flight rebinds
    // are not supported (no use case yet).
    bindWorld(world) {
        this.world = world;
    }
    set(key, value) {
        this.resources.set(key, value);
    }
    get(key) {
        return this.resources.get(key);
    }
    // Throws if missing. Useful for resources that must always exist
    // (Time, Camera) so the call site stays terse.
    require(key) {
        const v = this.resources.get(key);
        if (v === undefined) {
            throw new Error('ResourceRegistry: required resource "' + key + '" not registered');
        }
        return v;
    }
    has(key) {
        return this.resources.has(key);
    }
    remove(key) {
        return this.resources.delete(key);
    }
    keys() {
        return this.resources.keys();
    }
    // -- Phase 0.21.0 lifecycle ----------------------------------------
    // Lifecycle-aware setter. If `value` implements IManagedResource,
    // calls onAttach(world). Replaces an existing key idempotently;
    // the displaced value's onDetach + dispose run before the new
    // value's onAttach so callers can rely on hook ordering.
    attach(key, value) {
        if (this.resources.has(key)) {
            this.detach(key);
        }
        this.resources.set(key, value);
        if (!this.world)
            return;
        const r = value;
        if (r && typeof r.onAttach === 'function') {
            try {
                r.onAttach(this.world);
            }
            catch (e) {
                try {
                    console.error('[ResourceRegistry] onAttach for "' + key + '" threw:', e);
                }
                catch { /* ignore */ }
            }
        }
    }
    // Lifecycle-aware remover. Calls onDetach + dispose (in that order)
    // before deleting. Returns true iff a row was actually removed.
    // Errors in hooks are logged but do not block the removal.
    detach(key) {
        const value = this.resources.get(key);
        if (value === undefined)
            return false;
        const r = value;
        if (this.world && typeof r?.onDetach === 'function') {
            try {
                r.onDetach(this.world);
            }
            catch (e) {
                try {
                    console.error('[ResourceRegistry] onDetach for "' + key + '" threw:', e);
                }
                catch { /* ignore */ }
            }
        }
        if (typeof r?.dispose === 'function') {
            try {
                r.dispose();
            }
            catch (e) {
                try {
                    console.error('[ResourceRegistry] dispose for "' + key + '" threw:', e);
                }
                catch { /* ignore */ }
            }
        }
        return this.resources.delete(key);
    }
    // Detach and dispose every registered resource. Used by
    // World.dispose() during graceful shutdown. Iteration order is
    // insertion order; resources are responsible for handling the
    // case where a sibling resource has already disposed.
    disposeAll() {
        // Snapshot keys so detach() can safely mutate the map mid-loop.
        const snapshot = [];
        for (const k of this.resources.keys())
            snapshot.push(k);
        for (const k of snapshot) {
            this.detach(k);
        }
    }
}
export function createTimeResource() {
    return { elapsed: 0, delta: 0, frame: 0 };
}
export const RESOURCE_TIME = 'time';
export const RESOURCE_CAMERA = 'camera';
export const RESOURCE_DEVICE = 'device';
export function createVeilBudgetResource() {
    return {
        particleBudget: 4096,
        shaderBudget: 8,
        eventBudget: 256,
        audioBudget: 1.0,
        lastUpdatedFrame: -1,
    };
}
export const RESOURCE_VEIL_BUDGET = 'veil_budget';
//# sourceMappingURL=resources.js.map