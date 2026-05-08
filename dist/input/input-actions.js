// InputActions - declarative key/action bindings.
//
// 0.31.0 enabling primitive. The existing input-manager.ts captures
// raw keydown / keyup events; consumers wire game logic to specific
// keys ("if SPACE is down, jump"). InputActions adds a layer of
// indirection: a consumer declares an action ("jump") + the keys
// that trigger it (Space, Enter, gamepad button A), and queries the
// action by name. Lets a future settings UI rebind without touching
// game logic.
//
// Surface:
//   actions.bind('jump', ['Space', 'Enter']);
//   actions.unbind('jump', 'Enter');
//   actions.handleKeyDown('Space') / handleKeyUp(...) - wire to
//     window listeners or input-manager.
//   actions.isActive('jump') / wasJustPressed('jump') /
//     wasJustReleased('jump')
//   actions.update() - call once per frame so just-pressed /
//     just-released are accurate (they reset on the next update).
export class InputActions {
    actions = new Map();
    // Reverse index: keyName -> set of action names that bind it.
    keyToActions = new Map();
    // Diagnostic counters.
    keyDownCount = 0;
    keyUpCount = 0;
    // Bind one or more keys to an action. Idempotent: re-binding the
    // same key is a no-op. Creates the action if it doesn't exist.
    bind(action, keys) {
        var act = this.ensureAction(String(action));
        var keyList = Array.isArray(keys) ? keys : [keys];
        for (var i = 0; i < keyList.length; i++) {
            var k = String(keyList[i]);
            if (!k)
                continue;
            if (act.keys.indexOf(k) < 0)
                act.keys.push(k);
            var revs = this.keyToActions.get(k);
            if (!revs) {
                revs = new Set();
                this.keyToActions.set(k, revs);
            }
            revs.add(action);
        }
    }
    // Unbind one or more keys from an action. If `keys` is omitted,
    // unbinds everything from that action.
    unbind(action, keys) {
        var act = this.actions.get(String(action));
        if (!act)
            return;
        if (keys === undefined) {
            // Drop the whole action. Update reverse index.
            for (var i = 0; i < act.keys.length; i++) {
                var k = act.keys[i];
                if (!k)
                    continue;
                var revs = this.keyToActions.get(k);
                if (revs) {
                    revs.delete(action);
                    if (revs.size === 0)
                        this.keyToActions.delete(k);
                }
            }
            this.actions.delete(action);
            return;
        }
        var keyList = Array.isArray(keys) ? keys : [keys];
        for (var j = 0; j < keyList.length; j++) {
            var key = String(keyList[j]);
            var idx = act.keys.indexOf(key);
            if (idx >= 0) {
                act.keys.splice(idx, 1);
                var revsB = this.keyToActions.get(key);
                if (revsB) {
                    revsB.delete(action);
                    if (revsB.size === 0)
                        this.keyToActions.delete(key);
                }
                // Also drop from heldKeys so an in-flight key that gets
                // unbound doesn't keep the action active.
                act.heldKeys.delete(key);
            }
        }
        // Re-evaluate active state.
        act.active = act.heldKeys.size > 0;
    }
    // Wire to keydown events. Returns true iff at least one bound
    // action saw a state transition (idle -> active).
    handleKeyDown(key) {
        this.keyDownCount++;
        var revs = this.keyToActions.get(String(key));
        if (!revs)
            return false;
        var anyChanged = false;
        revs.forEach((actionName) => {
            var act = this.actions.get(actionName);
            if (!act)
                return;
            if (act.heldKeys.has(key))
                return; // duplicate event
            act.heldKeys.add(key);
            if (!act.active) {
                act.active = true;
                act.justPressed = true;
                anyChanged = true;
            }
        });
        return anyChanged;
    }
    // Wire to keyup events. Returns true iff at least one bound
    // action saw a state transition (active -> idle).
    handleKeyUp(key) {
        this.keyUpCount++;
        var revs = this.keyToActions.get(String(key));
        if (!revs)
            return false;
        var anyChanged = false;
        revs.forEach((actionName) => {
            var act = this.actions.get(actionName);
            if (!act)
                return;
            if (!act.heldKeys.has(key))
                return;
            act.heldKeys.delete(key);
            if (act.heldKeys.size === 0 && act.active) {
                act.active = false;
                act.justReleased = true;
                anyChanged = true;
            }
        });
        return anyChanged;
    }
    // Drop ALL held keys (e.g. window blur). Resets every action to
    // idle; fires justReleased on actions that were active.
    releaseAll() {
        this.actions.forEach((act) => {
            if (act.heldKeys.size > 0) {
                act.heldKeys.clear();
                if (act.active) {
                    act.active = false;
                    act.justReleased = true;
                }
            }
        });
    }
    // True if any bound key for `action` is currently held.
    isActive(action) {
        var act = this.actions.get(String(action));
        return act ? act.active : false;
    }
    // True if `action` transitioned idle -> active during the current
    // frame (cleared on next update()).
    wasJustPressed(action) {
        var act = this.actions.get(String(action));
        return act ? act.justPressed : false;
    }
    // True if `action` transitioned active -> idle during the current
    // frame (cleared on next update()).
    wasJustReleased(action) {
        var act = this.actions.get(String(action));
        return act ? act.justReleased : false;
    }
    // Per-frame tick. Clears justPressed / justReleased so they're
    // single-frame events. Call once at the END of the frame after
    // any wasJustPressed / wasJustReleased reads.
    update() {
        this.actions.forEach((act) => {
            act.justPressed = false;
            act.justReleased = false;
        });
    }
    // Currently bound keys for an action (or empty array).
    keysFor(action) {
        var act = this.actions.get(String(action));
        return act ? act.keys.slice() : [];
    }
    // List of all defined action names.
    actionNames() {
        var out = [];
        this.actions.forEach((_act, name) => out.push(name));
        return out;
    }
    // Drop everything.
    clear() {
        this.actions.clear();
        this.keyToActions.clear();
    }
    // Diagnostics.
    stats() {
        return {
            actions: this.actions.size,
            keysBound: this.keyToActions.size,
            keyDownEvents: this.keyDownCount,
            keyUpEvents: this.keyUpCount,
        };
    }
    // Internal: ensure an action exists; return its state.
    ensureAction(action) {
        var existing = this.actions.get(action);
        if (existing)
            return existing;
        var fresh = {
            keys: [],
            active: false,
            justPressed: false,
            justReleased: false,
            heldKeys: new Set(),
        };
        this.actions.set(action, fresh);
        return fresh;
    }
}
// Resource key for the world-attached input actions.
export const RESOURCE_INPUT_ACTIONS = 'loom.input_actions';
//# sourceMappingURL=input-actions.js.map