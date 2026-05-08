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
    resources = new Map();
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