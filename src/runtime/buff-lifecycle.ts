// BuffLifecycle - duration-tracked StatStack modifiers with auto-expire.
//
// 0.73.0 enabling primitive. Buffs and debuffs - "rage for 8 seconds",
// "burn for 5 seconds dealing damage every 0.5s", "speed boost from
// potion (permanent until consumed)" - share a common shape: a named
// effect that contributes some StatStack modifiers, optionally fires a
// periodic tick, and either runs out after a duration or sticks until
// manually removed.
//
// BuffLifecycle owns that lifecycle. Apply a buff, the system pushes
// its modifiers into the StatStack (0.59) under a stable
// `${sourcePrefix}${buff.id}` source key. Each tick advances elapsed
// time. When the duration runs out, modifiers come off the StatStack
// and onExpired fires. Manual remove() is the same path with onRemoved
// instead.
//
//   var buffs = BuffLifecycle.create({
//     statStack: stats,
//     onExpired: (buff) => log('buff ended: ' + buff.id),
//     onTick: (buff, idx) => {
//       if (buff.id === 'burn') hp -= 5;
//     },
//   });
//   buffs.apply({
//     id: 'rage',
//     durationMs: 8000,
//     modifiers: [
//       { source: '', stat: 'attackPower', kind: 'flat', value: 20 },
//     ],
//   });
//   each frame: buffs.tick(dtMs);
//
// Notes:
//   - Buff.id is the stable replacement key. Re-applying a buff with
//     the same id refreshes the duration and updates modifiers - it
//     does NOT stack a second instance. To stack, use unique ids.
//   - Modifiers' `source` field is overwritten by the lifecycle to
//     ${sourcePrefix}${buff.id} so removeBySource cleans them up
//     atomically. Caller can leave source blank in the buff spec.
//   - tickIntervalMs >0 fires onTick (1-based index) every interval
//     ms. Multiple ticks land per dt when dt > tickIntervalMs.
//
// Pairs with StatStack (0.59) and CooldownManager (0.52).
//
// Code style: var-only in browser source.

import type { Modifier } from './stat-stack.js';

export interface Buff {
  id: string;
  // Total duration in ms. <=0 means permanent (won't auto-expire).
  durationMs: number;
  // Modifiers contributed to the StatStack. Optional. Each
  // modifier's `source` is overwritten by the lifecycle.
  modifiers?: Modifier[];
  // Periodic tick interval in ms. Set <=0 (or omit) to skip ticks.
  tickIntervalMs?: number;
  // Per-buff metadata callbacks can read (DoT damage amount, HoT
  // heal, visual style, etc.). Pass-through; engine doesn't
  // interpret.
  data?: Record<string, unknown>;
}

export interface ActiveBuff {
  buff: Buff;
  // Remaining ms, or < 0 for permanent buffs (never expires).
  remainingMs: number;
  // Time since apply (frozen at durationMs on natural expiry).
  elapsedMs: number;
  // Number of onTick invocations fired so far.
  ticksFired: number;
}

interface IStatStackLike {
  addModifier(m: Modifier): boolean;
  removeBySource(source: string): number;
}

export interface BuffLifecycleOptions {
  // StatStack receiver. Optional - leave undefined to use the
  // lifecycle as a pure timer / tick orchestrator without modifier
  // routing.
  statStack?: IStatStackLike;
  // Prefix for the StatStack modifier source (so consumers can
  // bulk-cleanup with removeBySource by prefix elsewhere). Default
  // 'buff:'. Final source = `${prefix}${buff.id}`.
  sourcePrefix?: string;
  onApplied?: (buff: Buff, isRefresh: boolean) => void;
  onExpired?: (buff: Buff) => void;
  onRemoved?: (buff: Buff) => void;
  onTick?: (buff: Buff, tickIndex: number) => void;
}

interface InternalEntry {
  buff: Buff;
  elapsedMs: number;
  ticksFired: number;
  permanent: boolean;
  // Cached source key passed to StatStack (so we don't recompute
  // on remove).
  modSource: string;
}

const DEFAULT_SOURCE_PREFIX = 'buff:';

export class BuffLifecycle {
  private active: Map<string, InternalEntry> = new Map();
  private statStack: IStatStackLike | null;
  private sourcePrefix: string;
  private onApplied: ((b: Buff, refresh: boolean) => void) | null;
  private onExpired: ((b: Buff) => void) | null;
  private onRemoved: ((b: Buff) => void) | null;
  private onTick: ((b: Buff, idx: number) => void) | null;
  private disposed: boolean = false;

  private constructor(opts: BuffLifecycleOptions) {
    this.statStack = opts.statStack ?? null;
    this.sourcePrefix = opts.sourcePrefix !== undefined ? opts.sourcePrefix : DEFAULT_SOURCE_PREFIX;
    this.onApplied = opts.onApplied ?? null;
    this.onExpired = opts.onExpired ?? null;
    this.onRemoved = opts.onRemoved ?? null;
    this.onTick = opts.onTick ?? null;
  }

  static create(opts: BuffLifecycleOptions = {}): BuffLifecycle {
    return new BuffLifecycle(opts);
  }

  // Apply a buff. If a buff with the same id is already active, the
  // existing one is refreshed: its duration resets, its modifiers
  // are replaced (off then on), and onApplied fires with isRefresh=true.
  // Returns false if disposed or buff is invalid.
  apply(buff: Buff): boolean {
    if (this.disposed) return false;
    if (!buff || typeof buff.id !== 'string' || buff.id.length === 0) return false;
    var existing = this.active.get(buff.id);
    var isRefresh = existing !== undefined;
    var modSource = this.sourcePrefix + buff.id;
    // Remove any prior modifiers under this id (refresh path).
    if (existing && this.statStack) {
      this.statStack.removeBySource(modSource);
    }
    var entry: InternalEntry = {
      buff: buff,
      elapsedMs: 0,
      ticksFired: 0,
      permanent: !(buff.durationMs > 0),
      modSource: modSource,
    };
    if (this.statStack && buff.modifiers) {
      for (var i = 0; i < buff.modifiers.length; i++) {
        var m = buff.modifiers[i] as Modifier;
        this.statStack.addModifier({
          source: modSource,
          stat: m.stat,
          kind: m.kind,
          value: m.value,
        });
      }
    }
    this.active.set(buff.id, entry);
    if (this.onApplied) {
      try { this.onApplied(buff, isRefresh); } catch { /* ignore */ }
    }
    return true;
  }

  // Reset the duration timer for an active buff (without re-applying
  // modifiers). Returns false if no buff with that id is active.
  refresh(id: string): boolean {
    if (this.disposed) return false;
    var entry = this.active.get(id);
    if (!entry) return false;
    entry.elapsedMs = 0;
    entry.ticksFired = 0;
    if (this.onApplied) {
      try { this.onApplied(entry.buff, true); } catch { /* ignore */ }
    }
    return true;
  }

  // Remove a buff manually. Strips its modifiers from the StatStack
  // and fires onRemoved (NOT onExpired). Returns false if not active.
  remove(id: string): boolean {
    if (this.disposed) return false;
    var entry = this.active.get(id);
    if (!entry) return false;
    this.cleanup(entry);
    this.active.delete(id);
    if (this.onRemoved) {
      try { this.onRemoved(entry.buff); } catch { /* ignore */ }
    }
    return true;
  }

  // Remove every active buff. Returns the number removed.
  removeAll(): number {
    if (this.disposed) return 0;
    var ids: string[] = [];
    this.active.forEach((_e, k) => ids.push(k));
    for (var i = 0; i < ids.length; i++) this.remove(ids[i] as string);
    return ids.length;
  }

  has(id: string): boolean {
    return this.active.has(id);
  }

  // Remaining ms; <0 for permanent buffs; 0 if not active.
  remainingMs(id: string): number {
    var entry = this.active.get(id);
    if (!entry) return 0;
    if (entry.permanent) return -1;
    var rem = entry.buff.durationMs - entry.elapsedMs;
    return rem > 0 ? rem : 0;
  }

  // List of active buffs (defensive copy of the surface info).
  list(): ActiveBuff[] {
    var out: ActiveBuff[] = [];
    this.active.forEach((entry) => {
      out.push({
        buff: entry.buff,
        remainingMs: entry.permanent ? -1 : Math.max(0, entry.buff.durationMs - entry.elapsedMs),
        elapsedMs: entry.elapsedMs,
        ticksFired: entry.ticksFired,
      });
    });
    return out;
  }

  // Advance every active buff by dtMs. Fires onTick at every
  // tickIntervalMs boundary; fires onExpired when duration runs out
  // and removes modifiers. Permanent buffs (durationMs <= 0) advance
  // but never expire (their elapsedMs grows monotonically).
  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var expiredIds: string[] = [];
    this.active.forEach((entry, id) => {
      var prev = entry.elapsedMs;
      entry.elapsedMs = prev + dt;
      // Tick events.
      var interval = entry.buff.tickIntervalMs;
      if (this.onTick && interval !== undefined && interval > 0) {
        // Number of full tick boundaries crossed during this dt.
        var dueCount = Math.floor(entry.elapsedMs / interval) - Math.floor(prev / interval);
        // For non-permanent buffs, cap ticks to NOT cross past the
        // expiry boundary (caller asked for tick-on-expire? we treat
        // expiry independently).
        if (!entry.permanent && entry.elapsedMs > entry.buff.durationMs) {
          var cappedElapsed = entry.buff.durationMs;
          dueCount = Math.floor(cappedElapsed / interval) - Math.floor(prev / interval);
          if (dueCount < 0) dueCount = 0;
        }
        for (var k = 0; k < dueCount; k++) {
          entry.ticksFired += 1;
          try { this.onTick(entry.buff, entry.ticksFired); } catch { /* ignore */ }
        }
      }
      if (!entry.permanent && entry.elapsedMs >= entry.buff.durationMs) {
        expiredIds.push(id);
      }
    });
    for (var i = 0; i < expiredIds.length; i++) {
      var id2 = expiredIds[i] as string;
      var entry2 = this.active.get(id2);
      if (!entry2) continue;
      this.cleanup(entry2);
      this.active.delete(id2);
      if (this.onExpired) {
        try { this.onExpired(entry2.buff); } catch { /* ignore */ }
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    // Strip all StatStack modifiers we added.
    if (this.statStack) {
      this.active.forEach((entry) => {
        (this.statStack as IStatStackLike).removeBySource(entry.modSource);
      });
    }
    this.active.clear();
    this.statStack = null;
    this.onApplied = null;
    this.onExpired = null;
    this.onRemoved = null;
    this.onTick = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private cleanup(entry: InternalEntry): void {
    if (this.statStack) {
      this.statStack.removeBySource(entry.modSource);
    }
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_BUFF_LIFECYCLE = 'buff_lifecycle';
