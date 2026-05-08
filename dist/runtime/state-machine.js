// StateMachine - generic finite state machine.
//
// 0.51.0 enabling primitive. Many engine subsystems already track
// states implicitly: zone bridge connection (idle / connecting /
// connected / reconnecting), boss lifecycle (offline / spawning /
// alive / dying / dead), HUD modes (game / menu / inventory /
// dialog), audio mixer scenes, etc. Each rolls its own enum +
// transition guard. StateMachine factors that out: register named
// states with onEnter / onExit / onUpdate callbacks + valid
// transitions, and the FSM enforces the invariants.
//
//   var fsm = StateMachine.create({
//     initial: 'idle',
//     states: {
//       idle:        { onEnter: () => audio.cue('idle'), onUpdate: tickIdle },
//       walking:     { onEnter: () => animator.play('walk'), onExit: stopWalk },
//       jumping:     { onEnter: () => bus.fire('jump') },
//     },
//     transitions: {
//       idle:    ['walking', 'jumping'],
//       walking: ['idle', 'jumping'],
//       jumping: ['idle', 'walking'],
//     },
//   });
//   fsm.transition('walking');         // fires idle.onExit + walking.onEnter
//   fsm.update(dtMs);                   // fires walking.onUpdate
//
// Code style: var-only in browser source.
export class StateMachine {
    states = new Map();
    transitions;
    current;
    onTransition;
    disposed = false;
    constructor(opts) {
        if (typeof opts.initial !== 'string' || opts.initial.length === 0) {
            throw new Error('StateMachine: initial state required');
        }
        if (!opts.states || typeof opts.states !== 'object') {
            throw new Error('StateMachine: states map required');
        }
        if (!Object.prototype.hasOwnProperty.call(opts.states, opts.initial)) {
            throw new Error('StateMachine: initial state "' + opts.initial + '" not in states map');
        }
        var keys = Object.keys(opts.states);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            this.states.set(k, opts.states[k]);
        }
        if (opts.transitions) {
            this.transitions = new Map();
            var tk = Object.keys(opts.transitions);
            for (var j = 0; j < tk.length; j++) {
                var name = tk[j];
                var arr = opts.transitions[name] || [];
                this.transitions.set(name, new Set(arr));
            }
        }
        else {
            this.transitions = null;
        }
        this.current = opts.initial;
        this.onTransition = opts.onTransition ?? null;
        if (opts.fireInitialEnter) {
            this.fireEnter(this.current, null);
        }
    }
    static create(opts) {
        return new StateMachine(opts);
    }
    // The currently-active state name.
    state() {
        return this.current;
    }
    // True if the FSM is in `name`.
    is(name) {
        return this.current === name;
    }
    // True if `name` is a defined state.
    has(name) {
        return this.states.has(name);
    }
    // True if a transition from current -> `name` is allowed.
    canTransition(name) {
        if (this.disposed)
            return false;
        if (!this.states.has(name))
            return false;
        if (this.current === name)
            return false; // already there
        if (!this.transitions)
            return true;
        var allowed = this.transitions.get(this.current);
        if (!allowed)
            return true; // no entry = open
        return allowed.has(name);
    }
    // Attempt the transition. Returns true on success, false if the
    // state is unknown OR the transition is not allowed by the
    // transitions map (or already in `name`). Fires onExit -> onEnter
    // -> onTransition in that order on success.
    transition(name) {
        if (this.disposed)
            return false;
        if (!this.canTransition(name))
            return false;
        var prev = this.current;
        var prevCfg = this.states.get(prev);
        if (prevCfg && prevCfg.onExit) {
            try {
                prevCfg.onExit(name);
            }
            catch {
                // Best-effort; never let a misbehaving callback take down
                // the FSM.
            }
        }
        this.current = name;
        this.fireEnter(name, prev);
        if (this.onTransition) {
            try {
                this.onTransition(prev, name);
            }
            catch { /* ignore */ }
        }
        return true;
    }
    // Per-frame tick. Calls the current state's onUpdate (if any).
    update(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt < 0)
            return;
        var cfg = this.states.get(this.current);
        if (cfg && cfg.onUpdate) {
            try {
                cfg.onUpdate(dt);
            }
            catch { /* ignore */ }
        }
    }
    // Force the current state to a value WITHOUT firing onExit / onEnter.
    // Useful at restore-from-save time.
    forceState(name) {
        if (this.disposed)
            return false;
        if (!this.states.has(name))
            return false;
        this.current = name;
        return true;
    }
    // List every defined state name.
    stateNames() {
        var out = [];
        this.states.forEach((_v, name) => out.push(name));
        return out;
    }
    dispose() {
        this.states.clear();
        this.transitions = null;
        this.onTransition = null;
        this.disposed = true;
    }
    // ---------- private ----------
    fireEnter(name, from) {
        var cfg = this.states.get(name);
        if (cfg && cfg.onEnter) {
            try {
                cfg.onEnter(from);
            }
            catch { /* ignore */ }
        }
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_STATE_MACHINE = 'state_machine';
//# sourceMappingURL=state-machine.js.map