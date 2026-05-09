// AudioDuck - automatic music ducking when high-priority SFX fires.
//
// 1.4.1 enabling primitive (Wave 1.4 audio cinematic depth). The
// classic mixer trick: when a critical sound fires (boss roar,
// dialog line, story beat), the music + ambient bed automatically
// dip in volume so the SFX stands out, then smoothly restore.
// AudioDuck owns that timeline: trigger a duck event with target
// channels, attack / release / hold timing, and ducked volume.
// The mixer reads each channel's current multiplier per frame
// and applies it.
//
//   var duck = AudioDuck.create();
//   duck.registerChannel({ id: 'music',   baseVolume: 1.0 });
//   duck.registerChannel({ id: 'ambient', baseVolume: 0.7 });
//
//   on boss roar: duck.triggerDuck({
//     id: 'roar', durationMs: 2000, attackMs: 100, releaseMs: 800,
//     duckTo: 0.25, channels: ['music', 'ambient'],
//   });
//
//   each frame:
//     duck.tick(dtMs);
//     duck.forEach((ch) => audioBus.setBusVolume(ch.id, ch.volume));
//
// Pairs with AmbientLayerMixer (1.4.0, the layered ambient bed),
// MusicPlaylist (0.95, music tracks), AudioCueQueue (0.94, the
// SFX side that triggers ducks).
//
// Code style: var-only in browser source.

export interface DuckChannelSpec {
  id: string;
  // Target volume when no duck is active (0..1). Default 1.
  baseVolume?: number;
  data?: Record<string, unknown>;
}

export interface DuckChannelSnapshot {
  id: string;
  // Current volume after applying any active duck multiplier.
  volume: number;
  // The unducked target.
  baseVolume: number;
  // True if at least one active duck event affects this channel.
  isDucking: boolean;
  data?: Record<string, unknown>;
}

export interface DuckEventSpec {
  // Stable id for this duck event. Allows manual cancel later.
  id: string;
  // ms the duck event holds at the ducked level (after attack
  // ramp). 0 = manual cancel only.
  durationMs?: number;
  // ms to ramp from base -> duckTo. Default 100.
  attackMs?: number;
  // ms to ramp duckTo -> base after duration ends. Default 500.
  releaseMs?: number;
  // Multiplier applied to baseVolume during the duck (0..1).
  // Default 0.3 (down to 30%).
  duckTo?: number;
  // Channels to affect. Default all registered channels.
  channels?: string[];
}

export interface AudioDuckOptions {
  // Reserved for future hooks.
}

interface InternalChannel {
  id: string;
  baseVolume: number;
  data?: Record<string, unknown>;
}

interface InternalEvent {
  id: string;
  channels: Set<string>;
  duckTo: number;
  attackMs: number;
  durationMs: number;
  releaseMs: number;
  // Phase: 'attack' / 'hold' / 'release' / 'done'.
  phase: 'attack' | 'hold' | 'release' | 'done';
  phaseElapsed: number;
  manualCancel: boolean;
}

const DEFAULT_ATTACK_MS = 100;
const DEFAULT_RELEASE_MS = 500;
const DEFAULT_DUCK_TO = 0.3;

function clamp01(v: number): number {
  if (!isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export class AudioDuck {
  private channels: Map<string, InternalChannel> = new Map();
  private events: Map<string, InternalEvent> = new Map();
  private disposed: boolean = false;

  private constructor(_opts: AudioDuckOptions) { /* reserved */ }

  static create(opts: AudioDuckOptions = {}): AudioDuck {
    return new AudioDuck(opts);
  }

  registerChannel(spec: DuckChannelSpec): boolean {
    if (this.disposed) return false;
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) return false;
    var ch: InternalChannel = {
      id: spec.id,
      baseVolume: spec.baseVolume !== undefined && isFinite(spec.baseVolume)
        ? clamp01(spec.baseVolume) : 1,
    };
    if (spec.data !== undefined) ch.data = spec.data;
    this.channels.set(spec.id, ch);
    return true;
  }

  setBaseVolume(id: string, volume: number): boolean {
    if (this.disposed) return false;
    var ch = this.channels.get(id);
    if (!ch) return false;
    if (!isFinite(volume)) return false;
    ch.baseVolume = clamp01(volume);
    return true;
  }

  removeChannel(id: string): boolean {
    if (this.disposed) return false;
    return this.channels.delete(id);
  }

  hasChannel(id: string): boolean {
    return this.channels.has(id);
  }

  channelCount(): number { return this.channels.size; }

  // Trigger a duck event. Returns true if accepted (event id not
  // already in use; channels exist).
  triggerDuck(spec: DuckEventSpec): boolean {
    if (this.disposed) return false;
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) return false;
    if (this.events.has(spec.id)) return false;
    var channels: Set<string> = new Set();
    if (Array.isArray(spec.channels) && spec.channels.length > 0) {
      for (var i = 0; i < spec.channels.length; i++) {
        var cid = spec.channels[i] as string;
        if (this.channels.has(cid)) channels.add(cid);
      }
    } else {
      var allKeys = this.channels.keys();
      var k = allKeys.next();
      while (!k.done) {
        channels.add(k.value);
        k = allKeys.next();
      }
    }
    if (channels.size === 0) return false;
    var attackMs = spec.attackMs !== undefined && isFinite(spec.attackMs)
        && spec.attackMs >= 0 ? spec.attackMs : DEFAULT_ATTACK_MS;
    var releaseMs = spec.releaseMs !== undefined && isFinite(spec.releaseMs)
        && spec.releaseMs >= 0 ? spec.releaseMs : DEFAULT_RELEASE_MS;
    var durationMs = spec.durationMs !== undefined && isFinite(spec.durationMs)
        && spec.durationMs >= 0 ? spec.durationMs : 0;
    var event: InternalEvent = {
      id: spec.id,
      channels: channels,
      duckTo: spec.duckTo !== undefined && isFinite(spec.duckTo)
        ? clamp01(spec.duckTo) : DEFAULT_DUCK_TO,
      attackMs: attackMs,
      durationMs: durationMs,
      releaseMs: releaseMs,
      phase: 'attack',
      phaseElapsed: 0,
      manualCancel: false,
    };
    this.events.set(spec.id, event);
    return true;
  }

  // Manually cancel a duck event; transitions it to release phase.
  cancelDuck(eventId: string): boolean {
    if (this.disposed) return false;
    var ev = this.events.get(eventId);
    if (!ev) return false;
    if (ev.phase === 'done') return false;
    ev.manualCancel = true;
    if (ev.phase === 'attack' || ev.phase === 'hold') {
      ev.phase = 'release';
      ev.phaseElapsed = 0;
    }
    return true;
  }

  hasEvent(eventId: string): boolean {
    return this.events.has(eventId);
  }

  eventCount(): number { return this.events.size; }

  // Per-channel volume multiplier from active duck events.
  // Combines multiple duck events on the same channel by taking
  // the MINIMUM (deepest duck wins).
  getChannelMultiplier(channelId: string): number {
    var minMult = 1;
    var any = false;
    var iter = this.events.values();
    var v = iter.next();
    while (!v.done) {
      var ev = v.value;
      if (ev.phase === 'done') { v = iter.next(); continue; }
      if (!ev.channels.has(channelId)) { v = iter.next(); continue; }
      var contribution = this.eventMultiplier(ev);
      if (contribution < minMult) minMult = contribution;
      any = true;
      v = iter.next();
    }
    if (!any) return 1;
    return clamp01(minMult);
  }

  // Final volume = baseVolume * minimum-active-duck-multiplier.
  getChannel(channelId: string): DuckChannelSnapshot | null {
    var ch = this.channels.get(channelId);
    if (!ch) return null;
    var mult = this.getChannelMultiplier(channelId);
    var snap: DuckChannelSnapshot = {
      id: ch.id,
      volume: clamp01(ch.baseVolume * mult),
      baseVolume: ch.baseVolume,
      isDucking: mult < 1,
    };
    if (ch.data !== undefined) snap.data = ch.data;
    return snap;
  }

  forEach(cb: (ch: DuckChannelSnapshot) => void): void {
    if (this.disposed) return;
    var iter = this.channels.values();
    var v = iter.next();
    while (!v.done) {
      var snap = this.getChannel(v.value.id);
      if (snap) {
        try { cb(snap); } catch { /* ignore */ }
      }
      v = iter.next();
    }
  }

  list(): DuckChannelSnapshot[] {
    var out: DuckChannelSnapshot[] = [];
    var iter = this.channels.values();
    var v = iter.next();
    while (!v.done) {
      var snap = this.getChannel(v.value.id);
      if (snap) out.push(snap);
      v = iter.next();
    }
    return out;
  }

  // Tick advances duck events through their phases.
  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var toRemove: string[] = [];
    var iter = this.events.values();
    var v = iter.next();
    while (!v.done) {
      var ev = v.value;
      if (ev.phase === 'done') { toRemove.push(ev.id); v = iter.next(); continue; }
      ev.phaseElapsed += dt;
      if (ev.phase === 'attack') {
        if (ev.phaseElapsed >= ev.attackMs) {
          var leftover = ev.phaseElapsed - ev.attackMs;
          // Always transition to hold. durationMs > 0 = auto-release;
          // durationMs === 0 = hold forever until cancelDuck.
          ev.phase = 'hold';
          ev.phaseElapsed = leftover;
        }
      }
      if (ev.phase === 'hold') {
        if (ev.durationMs > 0 && ev.phaseElapsed >= ev.durationMs) {
          var leftover2 = ev.phaseElapsed - ev.durationMs;
          ev.phase = 'release';
          ev.phaseElapsed = leftover2;
        }
        // durationMs === 0 means "until manually cancelled".
      }
      if (ev.phase === 'release') {
        if (ev.releaseMs <= 0 || ev.phaseElapsed >= ev.releaseMs) {
          ev.phase = 'done';
          toRemove.push(ev.id);
        }
      }
      v = iter.next();
    }
    for (var i = 0; i < toRemove.length; i++) {
      this.events.delete(toRemove[i] as string);
    }
  }

  clear(): void {
    if (this.disposed) return;
    this.channels.clear();
    this.events.clear();
  }

  dispose(): void {
    this.channels.clear();
    this.events.clear();
    this.disposed = true;
  }

  // ---------- private ----------

  // Per-event multiplier based on phase:
  //   attack:  lerps 1 -> duckTo
  //   hold:    duckTo
  //   release: lerps duckTo -> 1
  //   done:    1
  private eventMultiplier(ev: InternalEvent): number {
    if (ev.phase === 'done') return 1;
    if (ev.phase === 'hold') return ev.duckTo;
    if (ev.phase === 'attack') {
      if (ev.attackMs <= 0) return ev.duckTo;
      var t = Math.min(1, ev.phaseElapsed / ev.attackMs);
      return 1 + (ev.duckTo - 1) * t;
    }
    // release
    if (ev.releaseMs <= 0) return 1;
    var rt = Math.min(1, ev.phaseElapsed / ev.releaseMs);
    return ev.duckTo + (1 - ev.duckTo) * rt;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_AUDIO_DUCK = 'audio_duck';
