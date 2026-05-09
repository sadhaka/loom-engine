// HotKeyProfileManager - keybinding profile manager.
//
// 0.85.0 enabling primitive (and the M9 0.85 milestone). Different
// from InputChord (0.39, combo / sequence recognition): HotKeyProfile
// is name-binding storage. Players want to switch between
// keybinding profiles ("default" / "wasd" / "vim-style"), classes
// can override the default ("warrior" inherits from default + adds
// 'shout' on Q), and the actual input matching happens via
// resolveAction(action) -> key.
//
//   var hk = HotKeyProfileManager.create();
//   hk.registerProfile({
//     id: 'default', name: 'Default',
//     bindings: [
//       { action: 'move-up',    key: 'KeyW' },
//       { action: 'move-down',  key: 'KeyS' },
//       { action: 'attack',     key: 'Space' },
//     ],
//   });
//   hk.registerProfile({
//     id: 'warrior', name: 'Warrior', inherits: 'default',
//     bindings: [{ action: 'shout', key: 'KeyQ' }],
//   });
//   hk.setActive('warrior');
//   var key = hk.resolveAction('shout');    // -> 'KeyQ'
//   var moveUp = hk.resolveAction('move-up'); // -> 'KeyW' (inherited)
//
// Pairs with InputManager / InputChord (0.39).
//
// Code style: var-only in browser source.
export class HotKeyProfileManager {
    profiles = new Map();
    activeId = null;
    disposed = false;
    constructor(opts) {
        if (opts.initialProfiles) {
            for (var i = 0; i < opts.initialProfiles.length; i++) {
                var p = opts.initialProfiles[i];
                if (isValidProfile(p) && !this.profiles.has(p.id)) {
                    this.profiles.set(p.id, cloneProfile(p));
                }
            }
        }
        if (opts.active && this.profiles.has(opts.active)) {
            this.activeId = opts.active;
        }
    }
    static create(opts = {}) {
        return new HotKeyProfileManager(opts);
    }
    registerProfile(profile) {
        if (this.disposed)
            return false;
        if (!isValidProfile(profile))
            return false;
        if (this.profiles.has(profile.id))
            return false;
        this.profiles.set(profile.id, cloneProfile(profile));
        return true;
    }
    unregisterProfile(id) {
        if (this.disposed)
            return false;
        if (!this.profiles.has(id))
            return false;
        this.profiles.delete(id);
        if (this.activeId === id)
            this.activeId = null;
        return true;
    }
    has(id) { return this.profiles.has(id); }
    get(id) {
        var p = this.profiles.get(id);
        return p ? cloneProfile(p) : null;
    }
    list() {
        var out = [];
        this.profiles.forEach((p) => out.push(cloneProfile(p)));
        return out;
    }
    setActive(id) {
        if (this.disposed)
            return false;
        if (!this.profiles.has(id))
            return false;
        this.activeId = id;
        return true;
    }
    getActive() { return this.activeId; }
    // Resolve action -> key via the active profile, walking the
    // inheritance chain on miss. Returns null if no binding found
    // (or no active profile).
    resolveAction(action) {
        if (this.activeId === null)
            return null;
        return this.resolveActionFor(this.activeId, action);
    }
    // Same as resolveAction but for a specific profile.
    resolveActionFor(profileId, action) {
        var visited = new Set();
        var current = profileId;
        while (current && !visited.has(current)) {
            visited.add(current);
            var p = this.profiles.get(current);
            if (!p)
                return null;
            for (var i = 0; i < p.bindings.length; i++) {
                var b = p.bindings[i];
                if (b.action === action)
                    return b.key;
            }
            current = p.inherits;
        }
        return null;
    }
    // Set a binding in a specific profile. Creates the entry if
    // absent; replaces if the action exists.
    setBinding(profileId, action, key) {
        if (this.disposed)
            return false;
        var p = this.profiles.get(profileId);
        if (!p)
            return false;
        if (typeof action !== 'string' || action.length === 0)
            return false;
        if (typeof key !== 'string' || key.length === 0)
            return false;
        for (var i = 0; i < p.bindings.length; i++) {
            var b = p.bindings[i];
            if (b.action === action) {
                b.key = key;
                return true;
            }
        }
        p.bindings.push({ action: action, key: key });
        return true;
    }
    removeBinding(profileId, action) {
        if (this.disposed)
            return false;
        var p = this.profiles.get(profileId);
        if (!p)
            return false;
        for (var i = p.bindings.length - 1; i >= 0; i--) {
            if (p.bindings[i].action === action) {
                p.bindings.splice(i, 1);
                return true;
            }
        }
        return false;
    }
    toSnapshot() {
        return {
            activeId: this.activeId,
            profiles: this.list(),
        };
    }
    fromSnapshot(snap) {
        if (this.disposed)
            return;
        if (!snap || !Array.isArray(snap.profiles))
            return;
        this.profiles.clear();
        for (var i = 0; i < snap.profiles.length; i++) {
            var p = snap.profiles[i];
            if (isValidProfile(p) && !this.profiles.has(p.id)) {
                this.profiles.set(p.id, cloneProfile(p));
            }
        }
        this.activeId = (snap.activeId !== undefined && snap.activeId !== null
            && this.profiles.has(snap.activeId)) ? snap.activeId : null;
    }
    size() { return this.profiles.size; }
    dispose() {
        this.profiles.clear();
        this.activeId = null;
        this.disposed = true;
    }
}
function isValidProfile(p) {
    if (!p || typeof p.id !== 'string' || p.id.length === 0)
        return false;
    if (typeof p.name !== 'string')
        return false;
    if (!Array.isArray(p.bindings))
        return false;
    for (var i = 0; i < p.bindings.length; i++) {
        var b = p.bindings[i];
        if (!b || typeof b.action !== 'string' || b.action.length === 0)
            return false;
        if (typeof b.key !== 'string' || b.key.length === 0)
            return false;
    }
    return true;
}
function cloneProfile(p) {
    var copy = {
        id: p.id,
        name: p.name,
        bindings: p.bindings.map((b) => ({ action: b.action, key: b.key })),
    };
    if (p.inherits !== undefined)
        copy.inherits = p.inherits;
    return copy;
}
// Resource key for the world's resource registry.
export const RESOURCE_HOTKEY_PROFILE = 'hotkey_profile';
//# sourceMappingURL=hotkey-profile.js.map