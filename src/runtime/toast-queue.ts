// ToastQueue - notification queue with severity + auto-dismiss.
//
// 0.65.0 enabling primitive. "+ 50 gold", "Boss spawned in Plaza",
// "Connection lost", "Quest accepted: Slay the Dragon" - every game
// surface notification follows the same shape: severity, message,
// optional payload, auto-dismiss timer, optional manual dismiss.
//
// ToastQueue is that machinery: post() pushes a notification with a
// severity tier and lifetime, tick(dt) ages active toasts, and the
// consumer reads forEach() / list() to render. Capacity-bounded so a
// flood of notifications doesn't grow unbounded.
//
// Code style: var-only in browser source.

export type ToastSeverity = 'info' | 'success' | 'warn' | 'error' | 'critical';

const SEVERITY_RANK: Record<ToastSeverity, number> = {
  info: 0,
  success: 1,
  warn: 2,
  error: 3,
  critical: 4,
};

export interface Toast {
  // Monotonic id assigned by the queue.
  id: number;
  severity: ToastSeverity;
  message: string;
  // ms remaining before auto-dismiss. -1 = sticky (no auto-dismiss).
  remainingMs: number;
  // ms since post() was called.
  ageMs: number;
  // Optional payload (level number, quest id, item icon).
  data?: Record<string, unknown>;
}

export interface PostOptions {
  // ms until auto-dismiss. Defaults to per-severity defaults.
  // Pass -1 (or any negative) for sticky.
  lifetimeMs?: number;
  // Optional payload.
  data?: Record<string, unknown>;
}

export interface ToastQueueOptions {
  // Cap on the number of active toasts. When the cap is hit, the
  // OLDEST is dropped on the next post() (low-severity first if
  // possible). Default 16.
  capacity?: number;
  // Per-severity default lifetime (ms). Used when post() doesn't
  // supply lifetimeMs.
  defaultLifetimeMs?: Partial<Record<ToastSeverity, number>>;
  // Fired when a toast is added.
  onPost?: (toast: Toast) => void;
  // Fired when a toast is removed (auto-expire OR manual dismiss).
  onRemoved?: (toast: Toast, reason: 'expired' | 'dismissed' | 'evicted') => void;
}

const DEFAULT_CAPACITY = 16;
const DEFAULT_LIFETIMES: Record<ToastSeverity, number> = {
  info: 3000,
  success: 3000,
  warn: 5000,
  error: 8000,
  critical: -1,  // sticky
};

export class ToastQueue {
  private toasts: Toast[] = [];
  private nextId: number = 1;
  private capacityNum: number;
  private lifetimes: Record<ToastSeverity, number>;
  private onPost: ((t: Toast) => void) | null;
  private onRemoved: ((t: Toast, r: 'expired' | 'dismissed' | 'evicted') => void) | null;
  private disposed: boolean = false;

  private constructor(opts: ToastQueueOptions) {
    this.capacityNum = opts.capacity !== undefined && opts.capacity > 0
      ? Math.floor(opts.capacity) : DEFAULT_CAPACITY;
    this.lifetimes = { ...DEFAULT_LIFETIMES };
    if (opts.defaultLifetimeMs) {
      var keys = Object.keys(opts.defaultLifetimeMs) as ToastSeverity[];
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i] as ToastSeverity;
        var v = opts.defaultLifetimeMs[k];
        if (v !== undefined) this.lifetimes[k] = v;
      }
    }
    this.onPost = opts.onPost ?? null;
    this.onRemoved = opts.onRemoved ?? null;
  }

  static create(opts: ToastQueueOptions = {}): ToastQueue {
    return new ToastQueue(opts);
  }

  // Post a notification. Returns the toast id.
  post(severity: ToastSeverity, message: string, opts: PostOptions = {}): number {
    if (this.disposed) return 0;
    if (typeof severity !== 'string' || !(severity in SEVERITY_RANK)) return 0;
    var lifetime: number;
    if (opts.lifetimeMs !== undefined) {
      lifetime = opts.lifetimeMs < 0 ? -1 : Math.floor(opts.lifetimeMs);
    } else {
      lifetime = this.lifetimes[severity];
    }
    var id = this.nextId++;
    var t: Toast = {
      id: id,
      severity: severity,
      message: typeof message === 'string' ? message : String(message),
      remainingMs: lifetime,
      ageMs: 0,
    };
    if (opts.data !== undefined) t.data = opts.data;
    // Capacity check: evict lowest-severity oldest if over.
    if (this.toasts.length >= this.capacityNum) {
      this.evictOne();
    }
    this.toasts.push(t);
    if (this.onPost) {
      try { this.onPost(t); } catch { /* ignore */ }
    }
    return id;
  }

  // Severity helpers.
  info(msg: string, opts?: PostOptions): number { return this.post('info', msg, opts); }
  success(msg: string, opts?: PostOptions): number { return this.post('success', msg, opts); }
  warn(msg: string, opts?: PostOptions): number { return this.post('warn', msg, opts); }
  error(msg: string, opts?: PostOptions): number { return this.post('error', msg, opts); }
  critical(msg: string, opts?: PostOptions): number { return this.post('critical', msg, opts); }

  // Tick the queue. Each toast has remainingMs decremented; those
  // reaching <= 0 are auto-removed and onRemoved('expired') fires.
  // Sticky (remainingMs === -1) toasts only update ageMs.
  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var expired: Toast[] = [];
    var keep: Toast[] = [];
    for (var i = 0; i < this.toasts.length; i++) {
      var t = this.toasts[i] as Toast;
      t.ageMs += dt;
      if (t.remainingMs >= 0) {
        t.remainingMs -= dt;
        if (t.remainingMs <= 0) {
          expired.push(t);
          continue;
        }
      }
      keep.push(t);
    }
    this.toasts = keep;
    if (this.onRemoved) {
      var cb = this.onRemoved;
      for (var j = 0; j < expired.length; j++) {
        try { cb(expired[j] as Toast, 'expired'); } catch { /* ignore */ }
      }
    }
  }

  // Manually remove a toast. Returns true if found.
  dismiss(id: number): boolean {
    if (this.disposed) return false;
    for (var i = 0; i < this.toasts.length; i++) {
      var t = this.toasts[i] as Toast;
      if (t.id === id) {
        this.toasts.splice(i, 1);
        if (this.onRemoved) {
          try { this.onRemoved(t, 'dismissed'); } catch { /* ignore */ }
        }
        return true;
      }
    }
    return false;
  }

  // Drop every toast.
  clear(): void {
    if (this.disposed) return;
    var toRemove = this.toasts.slice();
    this.toasts.length = 0;
    if (this.onRemoved) {
      var cb = this.onRemoved;
      for (var i = 0; i < toRemove.length; i++) {
        try { cb(toRemove[i] as Toast, 'dismissed'); } catch { /* ignore */ }
      }
    }
  }

  // Iterate every active toast in post order (oldest first).
  forEach(cb: (t: Toast) => void): void {
    if (this.disposed) return;
    for (var i = 0; i < this.toasts.length; i++) {
      try { cb(this.toasts[i] as Toast); } catch { /* ignore */ }
    }
  }

  // Defensive copy of the queue.
  list(): Toast[] {
    var out: Toast[] = [];
    for (var i = 0; i < this.toasts.length; i++) {
      var t = this.toasts[i] as Toast;
      var copy: Toast = {
        id: t.id,
        severity: t.severity,
        message: t.message,
        remainingMs: t.remainingMs,
        ageMs: t.ageMs,
      };
      if (t.data !== undefined) copy.data = t.data;
      out.push(copy);
    }
    return out;
  }

  count(): number { return this.toasts.length; }

  capacity(): number { return this.capacityNum; }

  dispose(): void {
    this.toasts.length = 0;
    this.onPost = null;
    this.onRemoved = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private evictOne(): void {
    if (this.toasts.length === 0) return;
    // Find the oldest lowest-severity toast.
    var bestIdx = 0;
    var best = this.toasts[0] as Toast;
    for (var i = 1; i < this.toasts.length; i++) {
      var cand = this.toasts[i] as Toast;
      if (SEVERITY_RANK[cand.severity] < SEVERITY_RANK[best.severity]) {
        best = cand;
        bestIdx = i;
      }
    }
    this.toasts.splice(bestIdx, 1);
    if (this.onRemoved) {
      try { this.onRemoved(best, 'evicted'); } catch { /* ignore */ }
    }
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_TOAST_QUEUE = 'toast_queue';
