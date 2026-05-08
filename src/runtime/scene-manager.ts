// SceneManager - named scenes with enter / exit / update lifecycle.
//
// 0.56.0 enabling primitive. Most games are organized as scenes:
// title -> game -> pause overlay -> game-over -> credits. Each
// scene wants its own setup (load assets, register systems, hook
// input) and teardown (release assets, unregister, restore HUD).
// SceneManager factors that pattern into a small registry with
// a single active scene at a time, async enter/exit hooks (so
// loading screens compose naturally), and an update tick.
//
// Distinct from StateMachine (0.51): SceneManager assumes async
// enter/exit (loading), tracks load progress, and exposes a
// "transitioning" intermediate state so HUD can render a loader.
// Use StateMachine for fast in-game state (idle/walking/jumping);
// SceneManager for high-level scene orchestration.
//
// Code style: var-only in browser source.

export interface SceneConfig {
  // Optional async setup. Called on enter; the scene becomes
  // "active" only after this resolves. Loaders / asset preload
  // happen here. Throwing rejects the transition.
  onEnter?: (params?: unknown) => void | Promise<void>;
  // Optional teardown. Called on exit; the scene becomes "left"
  // after this resolves. Throwing is logged but the transition
  // proceeds (the next scene's onEnter still fires).
  onExit?: () => void | Promise<void>;
  // Optional per-tick callback (synchronous). Receives dtMs.
  onUpdate?: (dtMs: number) => void;
}

export type SceneStatus = 'idle' | 'entering' | 'active' | 'exiting';

export interface SceneManagerOptions {
  // Optional callback fired when an active scene becomes active.
  // Useful for HUD swap / analytics.
  onSceneEntered?: (name: string) => void;
  // Fired when a scene fully exits (after its onExit resolves).
  onSceneExited?: (name: string) => void;
  // Fired when a transition starts (after the new scene's
  // onEnter is called but before it resolves). Useful for the
  // loading screen.
  onTransitionStart?: (from: string | null, to: string) => void;
  // Fired when a transition fails (onEnter rejected). If it
  // returns or no handler is set, the manager rolls back to the
  // previous scene's "active" state.
  onTransitionError?: (to: string, error: unknown) => void;
}

export class SceneManager {
  private scenes: Map<string, SceneConfig> = new Map();
  private currentName: string | null = null;
  private status: SceneStatus = 'idle';
  private opts: SceneManagerOptions;
  private disposed: boolean = false;

  private constructor(opts: SceneManagerOptions) {
    this.opts = opts;
  }

  static create(opts: SceneManagerOptions = {}): SceneManager {
    return new SceneManager(opts);
  }

  // Register or replace a named scene. Re-registering the active
  // scene is allowed; the new config takes effect on the next
  // transition (no in-flight swap).
  register(name: string, scene: SceneConfig): void {
    if (this.disposed) return;
    if (typeof name !== 'string' || name.length === 0) return;
    if (!scene || typeof scene !== 'object') return;
    this.scenes.set(name, scene);
  }

  // Unregister a scene. If it's currently active, the manager
  // returns to idle WITHOUT firing onExit (the consumer should
  // explicitly transition out before unregistering for cleanup).
  unregister(name: string): boolean {
    if (this.disposed) return false;
    var existed = this.scenes.delete(name);
    if (existed && this.currentName === name) {
      this.currentName = null;
      this.status = 'idle';
    }
    return existed;
  }

  has(name: string): boolean {
    return this.scenes.has(name);
  }

  current(): string | null {
    return this.currentName;
  }

  getStatus(): SceneStatus {
    return this.status;
  }

  isTransitioning(): boolean {
    return this.status === 'entering' || this.status === 'exiting';
  }

  sceneNames(): string[] {
    var out: string[] = [];
    this.scenes.forEach((_v, name) => out.push(name));
    return out;
  }

  // Transition to a new scene. Resolves with the scene name once
  // it's active, or rejects if onEnter throws / scene is unknown.
  // Concurrent calls during a transition reject (the manager only
  // handles one transition at a time).
  async transitionTo(name: string, params?: unknown): Promise<string> {
    if (this.disposed) {
      throw new Error('SceneManager disposed');
    }
    if (this.status === 'entering' || this.status === 'exiting') {
      throw new Error('SceneManager: transition in flight (status=' + this.status + ')');
    }
    if (!this.scenes.has(name)) {
      throw new Error('SceneManager: unknown scene "' + name + '"');
    }
    if (this.currentName === name && this.status === 'active') {
      return name;  // already there
    }

    var fromName = this.currentName;
    var fromScene = fromName ? this.scenes.get(fromName) : null;
    var toScene = this.scenes.get(name) as SceneConfig;

    // Fire onExit on outgoing scene, if any.
    if (fromScene) {
      this.status = 'exiting';
      if (fromScene.onExit) {
        try {
          await fromScene.onExit();
        } catch {
          // Best-effort: log + proceed. The outgoing scene is
          // gone either way.
        }
      }
      if (this.opts.onSceneExited && fromName) {
        try { this.opts.onSceneExited(fromName); } catch { /* ignore */ }
      }
    }

    // Begin enter.
    this.status = 'entering';
    if (this.opts.onTransitionStart) {
      try { this.opts.onTransitionStart(fromName, name); } catch { /* ignore */ }
    }
    try {
      if (toScene.onEnter) {
        await toScene.onEnter(params);
      }
    } catch (err) {
      // onEnter rejected. Roll back to idle (we already exited
      // the previous scene; we cannot un-exit cleanly).
      this.currentName = null;
      this.status = 'idle';
      if (this.opts.onTransitionError) {
        try { this.opts.onTransitionError(name, err); } catch { /* ignore */ }
      }
      throw err;
    }
    this.currentName = name;
    this.status = 'active';
    if (this.opts.onSceneEntered) {
      try { this.opts.onSceneEntered(name); } catch { /* ignore */ }
    }
    return name;
  }

  // Tick the active scene. No-op while transitioning, idle, or
  // disposed.
  update(dtMs: number): void {
    if (this.disposed) return;
    if (this.status !== 'active') return;
    if (!this.currentName) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt < 0) return;
    var scene = this.scenes.get(this.currentName);
    if (scene && scene.onUpdate) {
      try { scene.onUpdate(dt); } catch {
        // Best-effort.
      }
    }
  }

  // Drop the active scene without entering a new one. Awaits the
  // current scene's onExit if any. After this, current() === null
  // and status === 'idle'.
  async leave(): Promise<void> {
    if (this.disposed) return;
    if (this.status === 'entering' || this.status === 'exiting') {
      throw new Error('SceneManager.leave: transition in flight');
    }
    if (!this.currentName) return;
    var prev = this.currentName;
    var scene = this.scenes.get(prev);
    if (scene && scene.onExit) {
      this.status = 'exiting';
      try {
        await scene.onExit();
      } catch { /* ignore */ }
    }
    this.currentName = null;
    this.status = 'idle';
    if (this.opts.onSceneExited) {
      try { this.opts.onSceneExited(prev); } catch { /* ignore */ }
    }
  }

  dispose(): void {
    this.scenes.clear();
    this.currentName = null;
    this.status = 'idle';
    this.disposed = true;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_SCENE_MANAGER = 'scene_manager';
