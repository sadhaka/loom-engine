// TooltipQueue - anchored tooltip primitive with fade-in/out lifecycle.
//
// 0.97.0 enabling primitive. Hover tooltips on equipped items,
// info popovers anchored to NPCs, "Boss is vulnerable" hints
// pinned over entities - every anchored UI hint wants the same
// shape: a content string keyed to an anchor id, faded in over
// 150ms, held for a lifetime, then faded out over 200ms before
// removal. TooltipQueue owns that lifecycle.
//
// Pairs with ToastQueue (0.65, global notifications), TutorialFlow
// (0.88, sequenced step gating), DialogTree (0.61, branching NPC
// dialog). ToastQueue is the global-feed counterpart; TooltipQueue
// is the anchored-bubble counterpart.
//
//   var tips = TooltipQueue.create({
//     fadeInMs: 150,
//     fadeOutMs: 200,
//     defaultLifetimeMs: 4000,
//   });
//   on hover-enter: tips.show('npc_42', 'Talk to Sunisa');
//   on hover-leave: tips.hide('npc_42');
//   each frame:    tips.tick(dtMs);
//   render:        tips.forEach((t) => drawBubble(t));
//
// Code style: var-only in browser source.

export type TooltipState = 'fadeIn' | 'visible' | 'fadeOut';

export interface Tooltip {
  // Monotonic id assigned by the queue.
  id: number;
  // Anchor id - opaque string; consumer maps to entity / element.
  anchorId: string;
  // Display content (consumer chooses richness).
  content: string;
  // Lifecycle phase, derived from age + remainingMs.
  state: TooltipState;
  // 0..1 render alpha; computed each tick from state + age.
  alpha: number;
  // ms since show() was called.
  ageMs: number;
  // ms until fade-out begins. -1 = sticky (no auto fade-out).
  // Counted only while state === 'visible'.
  remainingMs: number;
  // Optional payload.
  data?: Record<string, unknown>;
}

export interface ShowOptions {
  // ms the tooltip stays fully visible before auto fade-out.
  // -1 = sticky (must be hidden manually). Defaults to
  // TooltipQueueOptions.defaultLifetimeMs.
  lifetimeMs?: number;
  // Optional payload.
  data?: Record<string, unknown>;
}

export interface TooltipQueueOptions {
  // Cap on concurrent active tooltips. Default 32. When the cap
  // is hit, evict prefers an already-fading tooltip; else drops
  // the oldest by post order.
  capacity?: number;
  // ms fade-in window (alpha 0 -> 1). Default 150. Pass 0 to
  // start fully visible.
  fadeInMs?: number;
  // ms fade-out window (alpha 1 -> 0). Default 200. Pass 0 to
  // remove instantly on hide / expire.
  fadeOutMs?: number;
  // Default visible lifetime in ms. Default 4000. -1 = sticky.
  defaultLifetimeMs?: number;
  // If true (default), show() with an existing anchorId begins
  // fade-out on prior tooltips at that anchor. If false, multiple
  // tooltips per anchor stack.
  replaceOnSameAnchor?: boolean;
  // Fired when a tooltip is added.
  onShow?: (t: Tooltip) => void;
  // Fired when a tooltip is removed (auto-expire, manual hide,
  // eviction, or clear).
  onRemoved?: (t: Tooltip, reason: 'expired' | 'hidden' | 'evicted') => void;
}

const DEFAULT_CAPACITY = 32;
const DEFAULT_FADE_IN_MS = 150;
const DEFAULT_FADE_OUT_MS = 200;
const DEFAULT_LIFETIME_MS = 4000;

interface InternalTooltip extends Tooltip {
  fadeInMs: number;
  fadeOutMs: number;
  // 0 if not in fade-out, else accumulated fade-out time.
  fadeOutAge: number;
}

export class TooltipQueue {
  private tips: InternalTooltip[] = [];
  private nextId: number = 1;
  private capacityNum: number;
  private fadeInDefault: number;
  private fadeOutDefault: number;
  private defaultLifetime: number;
  private replaceOnSameAnchor: boolean;
  private onShow: ((t: Tooltip) => void) | null;
  private onRemoved: ((t: Tooltip, r: 'expired' | 'hidden' | 'evicted') => void) | null;
  private disposed: boolean = false;

  private constructor(opts: TooltipQueueOptions) {
    this.capacityNum = opts.capacity !== undefined && opts.capacity > 0
      ? Math.floor(opts.capacity) : DEFAULT_CAPACITY;
    this.fadeInDefault = opts.fadeInMs !== undefined && isFinite(opts.fadeInMs)
        && opts.fadeInMs >= 0
      ? opts.fadeInMs : DEFAULT_FADE_IN_MS;
    this.fadeOutDefault = opts.fadeOutMs !== undefined && isFinite(opts.fadeOutMs)
        && opts.fadeOutMs >= 0
      ? opts.fadeOutMs : DEFAULT_FADE_OUT_MS;
    if (opts.defaultLifetimeMs !== undefined) {
      this.defaultLifetime = opts.defaultLifetimeMs < 0
        ? -1 : Math.floor(opts.defaultLifetimeMs);
    } else {
      this.defaultLifetime = DEFAULT_LIFETIME_MS;
    }
    this.replaceOnSameAnchor = opts.replaceOnSameAnchor !== false;
    this.onShow = opts.onShow ?? null;
    this.onRemoved = opts.onRemoved ?? null;
  }

  static create(opts: TooltipQueueOptions = {}): TooltipQueue {
    return new TooltipQueue(opts);
  }

  // Show a tooltip anchored to anchorId. Returns the tooltip id,
  // or 0 if rejected (disposed or invalid anchor).
  show(anchorId: string, content: string, opts: ShowOptions = {}): number {
    if (this.disposed) return 0;
    if (typeof anchorId !== 'string' || anchorId.length === 0) return 0;
    var lifetime: number;
    if (opts.lifetimeMs !== undefined) {
      lifetime = opts.lifetimeMs < 0 ? -1 : Math.floor(opts.lifetimeMs);
    } else {
      lifetime = this.defaultLifetime;
    }
    if (this.replaceOnSameAnchor) {
      for (var i = 0; i < this.tips.length; i++) {
        var existing = this.tips[i] as InternalTooltip;
        if (existing.anchorId === anchorId && existing.state !== 'fadeOut') {
          this.beginFadeOut(existing);
        }
      }
    }
    if (this.tips.length >= this.capacityNum) {
      this.evictOne();
    }
    var id = this.nextId++;
    var initialState: TooltipState = this.fadeInDefault > 0 ? 'fadeIn' : 'visible';
    var initialAlpha = this.fadeInDefault > 0 ? 0 : 1;
    var t: InternalTooltip = {
      id: id,
      anchorId: anchorId,
      content: typeof content === 'string' ? content : String(content),
      state: initialState,
      alpha: initialAlpha,
      ageMs: 0,
      remainingMs: lifetime,
      fadeInMs: this.fadeInDefault,
      fadeOutMs: this.fadeOutDefault,
      fadeOutAge: 0,
    };
    if (opts.data !== undefined) t.data = opts.data;
    this.tips.push(t);
    if (this.onShow) {
      try { this.onShow(this.publicView(t)); } catch { /* ignore */ }
    }
    return id;
  }

  // Begin fade-out for every tooltip at this anchor. Returns the
  // count of tooltips that started fading (0 if none matched or
  // all were already fading).
  hide(anchorId: string): number {
    if (this.disposed) return 0;
    if (typeof anchorId !== 'string') return 0;
    var n = 0;
    for (var i = 0; i < this.tips.length; i++) {
      var t = this.tips[i] as InternalTooltip;
      if (t.anchorId === anchorId && t.state !== 'fadeOut') {
        this.beginFadeOut(t);
        n++;
      }
    }
    return n;
  }

  // Begin fade-out for a single tooltip by id. Returns true if
  // the id was found and not already fading.
  hideById(id: number): boolean {
    if (this.disposed) return false;
    for (var i = 0; i < this.tips.length; i++) {
      var t = this.tips[i] as InternalTooltip;
      if (t.id === id && t.state !== 'fadeOut') {
        this.beginFadeOut(t);
        return true;
      }
    }
    return false;
  }

  // Tick the queue. Advances ageMs / remainingMs / fadeOutAge,
  // updates state + alpha, removes tips whose fade-out completed.
  // dt is tracked per-phase so cross-phase transitions (e.g.
  // visible -> fadeOut on the same tick) only consume the leftover
  // time in the new phase.
  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var removed: InternalTooltip[] = [];
    var keep: InternalTooltip[] = [];
    for (var i = 0; i < this.tips.length; i++) {
      var t = this.tips[i] as InternalTooltip;
      t.ageMs += dt;
      var dtRem = dt;
      // Phase 1: fade-in. ageMs is the master clock for this phase;
      // if it crossed fadeInMs, the leftover dt rolls into 'visible'.
      if (t.state === 'fadeIn') {
        if (t.fadeInMs <= 0 || t.ageMs >= t.fadeInMs) {
          t.state = 'visible';
          t.alpha = 1;
          dtRem = Math.max(0, t.ageMs - t.fadeInMs);
        } else {
          t.alpha = Math.max(0, Math.min(1, t.ageMs / t.fadeInMs));
          dtRem = 0;
        }
      }
      // Phase 2: visible. Consume up to remainingMs of dt; leftover
      // rolls into fade-out if the lifetime hits zero.
      if (t.state === 'visible' && dtRem > 0 && t.remainingMs >= 0) {
        var consumed = Math.min(dtRem, t.remainingMs);
        t.remainingMs -= consumed;
        dtRem -= consumed;
        if (t.remainingMs <= 0) {
          this.beginFadeOut(t);
        }
      }
      // Phase 3: fade-out. Only apply leftover dt (after fade-in /
      // visible consumed their share).
      if (t.state === 'fadeOut') {
        if (dtRem > 0) {
          t.fadeOutAge += dtRem;
        }
        if (t.fadeOutMs <= 0 || t.fadeOutAge >= t.fadeOutMs) {
          t.alpha = 0;
          removed.push(t);
          continue;
        }
        t.alpha = Math.max(0, 1 - t.fadeOutAge / t.fadeOutMs);
      }
      keep.push(t);
    }
    this.tips = keep;
    if (this.onRemoved) {
      var cb = this.onRemoved;
      for (var j = 0; j < removed.length; j++) {
        try { cb(this.publicView(removed[j] as InternalTooltip), 'expired'); } catch { /* ignore */ }
      }
    }
  }

  forEach(cb: (t: Tooltip) => void): void {
    if (this.disposed) return;
    for (var i = 0; i < this.tips.length; i++) {
      try { cb(this.publicView(this.tips[i] as InternalTooltip)); } catch { /* ignore */ }
    }
  }

  list(): Tooltip[] {
    var out: Tooltip[] = [];
    for (var i = 0; i < this.tips.length; i++) {
      out.push(this.publicView(this.tips[i] as InternalTooltip));
    }
    return out;
  }

  // Defensive snapshot of every tooltip on a given anchor, in
  // post order.
  byAnchor(anchorId: string): Tooltip[] {
    var out: Tooltip[] = [];
    if (typeof anchorId !== 'string') return out;
    for (var i = 0; i < this.tips.length; i++) {
      var t = this.tips[i] as InternalTooltip;
      if (t.anchorId === anchorId) {
        out.push(this.publicView(t));
      }
    }
    return out;
  }

  count(): number { return this.tips.length; }

  capacity(): number { return this.capacityNum; }

  // Drop every tooltip immediately (no fade-out). Fires onRemoved
  // with reason 'hidden' for each.
  clear(): void {
    if (this.disposed) return;
    var toRemove = this.tips.slice();
    this.tips.length = 0;
    if (this.onRemoved) {
      var cb = this.onRemoved;
      for (var i = 0; i < toRemove.length; i++) {
        try { cb(this.publicView(toRemove[i] as InternalTooltip), 'hidden'); } catch { /* ignore */ }
      }
    }
  }

  dispose(): void {
    this.tips.length = 0;
    this.onShow = null;
    this.onRemoved = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private beginFadeOut(t: InternalTooltip): void {
    if (t.state === 'fadeOut') return;
    t.state = 'fadeOut';
    t.fadeOutAge = 0;
  }

  private evictOne(): void {
    if (this.tips.length === 0) return;
    var bestIdx = 0;
    var best = this.tips[0] as InternalTooltip;
    for (var i = 1; i < this.tips.length; i++) {
      var cand = this.tips[i] as InternalTooltip;
      if (cand.state === 'fadeOut' && best.state !== 'fadeOut') {
        best = cand;
        bestIdx = i;
      }
    }
    this.tips.splice(bestIdx, 1);
    if (this.onRemoved) {
      try { this.onRemoved(this.publicView(best), 'evicted'); } catch { /* ignore */ }
    }
  }

  private publicView(t: InternalTooltip): Tooltip {
    var copy: Tooltip = {
      id: t.id,
      anchorId: t.anchorId,
      content: t.content,
      state: t.state,
      alpha: t.alpha,
      ageMs: t.ageMs,
      remainingMs: t.remainingMs,
    };
    if (t.data !== undefined) copy.data = t.data;
    return copy;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_TOOLTIP_QUEUE = 'tooltip_queue';
