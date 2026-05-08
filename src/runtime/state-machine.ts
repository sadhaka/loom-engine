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

export interface StateConfig {
  // Optional callback fired when entering this state from another.
  // Receives the previous state name (or null on initial activation).
  onEnter?: (from: string | null) => void;
  // Optional callback fired when leaving this state.
  onExit?: (to: string) => void;
  // Optional per-tick callback. Receives dtMs.
  onUpdate?: (dtMs: number) => void;
}

export interface StateMachineOptions {
  // The state name the FSM lands in immediately (no onEnter fires
  // for the initial state by default; pass `fireInitialEnter: true`
  // to fire it once at create()). Required.
  initial: string;
  states: Record<string, StateConfig>;
  // Optional per-state list of allowed target states. If a state has
  // no entry in this map, ALL transitions from it are allowed (the
  // map is purely a deny list when populated).
  transitions?: Record<string, string[]>;
  // Fire the initial state's onEnter at create time. Default false.
  fireInitialEnter?: boolean;
  // Optional callback fired on every successful transition. Useful
  // for analytics / debug HUD.
  onTransition?: (from: string, to: string) => void;
}

export class StateMachine {
  private states: Map<string, StateConfig> = new Map();
  private transitions: Map<string, Set<string>> | null;
  private current: string;
  private onTransition: ((from: string, to: string) => void) | null;
  private disposed: boolean = false;

  private constructor(opts: StateMachineOptions) {
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
      var k = keys[i] as string;
      this.states.set(k, opts.states[k] as StateConfig);
    }
    if (opts.transitions) {
      this.transitions = new Map();
      var tk = Object.keys(opts.transitions);
      for (var j = 0; j < tk.length; j++) {
        var name = tk[j] as string;
        var arr = opts.transitions[name] || [];
        this.transitions.set(name, new Set(arr));
      }
    } else {
      this.transitions = null;
    }
    this.current = opts.initial;
    this.onTransition = opts.onTransition ?? null;
    if (opts.fireInitialEnter) {
      this.fireEnter(this.current, null);
    }
  }

  static create(opts: StateMachineOptions): StateMachine {
    return new StateMachine(opts);
  }

  // The currently-active state name.
  state(): string {
    return this.current;
  }

  // True if the FSM is in `name`.
  is(name: string): boolean {
    return this.current === name;
  }

  // True if `name` is a defined state.
  has(name: string): boolean {
    return this.states.has(name);
  }

  // True if a transition from current -> `name` is allowed.
  canTransition(name: string): boolean {
    if (this.disposed) return false;
    if (!this.states.has(name)) return false;
    if (this.current === name) return false;  // already there
    if (!this.transitions) return true;
    var allowed = this.transitions.get(this.current);
    if (!allowed) return true;  // no entry = open
    return allowed.has(name);
  }

  // Attempt the transition. Returns true on success, false if the
  // state is unknown OR the transition is not allowed by the
  // transitions map (or already in `name`). Fires onExit -> onEnter
  // -> onTransition in that order on success.
  transition(name: string): boolean {
    if (this.disposed) return false;
    if (!this.canTransition(name)) return false;
    var prev = this.current;
    var prevCfg = this.states.get(prev);
    if (prevCfg && prevCfg.onExit) {
      try { prevCfg.onExit(name); } catch {
        // Best-effort; never let a misbehaving callback take down
        // the FSM.
      }
    }
    this.current = name;
    this.fireEnter(name, prev);
    if (this.onTransition) {
      try { this.onTransition(prev, name); } catch { /* ignore */ }
    }
    return true;
  }

  // Per-frame tick. Calls the current state's onUpdate (if any).
  update(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt < 0) return;
    var cfg = this.states.get(this.current);
    if (cfg && cfg.onUpdate) {
      try { cfg.onUpdate(dt); } catch { /* ignore */ }
    }
  }

  // Force the current state to a value WITHOUT firing onExit / onEnter.
  // Useful at restore-from-save time.
  forceState(name: string): boolean {
    if (this.disposed) return false;
    if (!this.states.has(name)) return false;
    this.current = name;
    return true;
  }

  // List every defined state name.
  stateNames(): string[] {
    var out: string[] = [];
    this.states.forEach((_v, name) => out.push(name));
    return out;
  }

  dispose(): void {
    this.states.clear();
    this.transitions = null;
    this.onTransition = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private fireEnter(name: string, from: string | null): void {
    var cfg = this.states.get(name);
    if (cfg && cfg.onEnter) {
      try { cfg.onEnter(from); } catch { /* ignore */ }
    }
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_STATE_MACHINE = 'state_machine';
