// SpatialAudioBus - positional 3D audio for the Loom Engine.
//
// Composes the existing AudioBus (Phase 5 lock) and adds a 'spatial'
// sub-bus whose sources route through Web Audio PannerNodes. The
// existing 'sfx' / 'music' / 'voice' / 'ui' buses are untouched.
//
// Architecture per LOOM-AUDIO-SPEC.md Section 3.1:
//
//   AudioContext.destination
//     <- AudioBus.master (existing, Phase 5)
//          <- 'sfx', 'music', 'voice', 'ui' (existing AudioBus sub-buses)
//          <- 'spatial' (NEW: ambient priority, VE-budget gated)
//                 <- per-source PannerNode
//                       <- per-source GainNode
//                             <- AudioBufferSourceNode | OscillatorNode
//
// Each call to playPositional / playPositionalTone allocates ONE
// PannerNode + ONE GainNode + ONE source node. The PannerNode is reused
// when handle.setPosition is called - no realloc per frame for moving
// sources. fadeOut animates the gain to 0 over the requested duration
// then disconnects.
//
// VE-budget integration: SpatialAudioBus.create adds a 'spatial' bus on
// the underlying AudioBus with priority 'ambient'. Under VE-budget
// pressure (audioBudget < AUDIO_BUDGET_AMBIENT_FLOOR per audio-bus.ts)
// the entire spatial bus mutes; we surface that as null returns from
// playPositional so callers don't waste cycles building handles for
// inaudible sounds.
//
// Listener pose: setListener writes to AudioContext.listener
// (positionX/Y/Z + forwardX/Y/Z + upX/Y/Z). Per spec §8.4 the listener
// orientation is fixed in v1 to forward=(0,0,-1), up=(0,1,0); only
// position is meaningful. Modern AudioParam-style API is preferred;
// we fall back to the deprecated setPosition/setOrientation if the
// runtime exposes those instead (some test mocks).
//
// Inspirations (per PRIOR-ART.md):
//   Web Audio PannerNode HRTF spec - W3C public technique
//   Distance falloff models (linear / inverse / exponential) - Web
//     Audio canonical, also FMOD / Wwise standard
//   No patented techniques used.

import type { AudioBus } from './audio-bus.js';

// World-space source position for a positional play call. The listener
// pose is queried internally via the AudioListener resource each play.
export interface PositionalPlayOptions {
  // World-space source position. The listener pose is queried from the
  // AudioListener resource each play.
  x: number;
  y: number;
  // Optional z (height); defaults to 0 for 2D-engine use.
  z?: number;
  // Distance falloff model. 'linear' attenuates linearly between
  // refDistance and maxDistance. 'inverse' uses Web Audio inverse
  // distance model (1 / (1 + rolloff * (d - ref))). 'exponential'
  // uses Web Audio exponential model. Default: 'inverse'.
  distanceModel?: 'linear' | 'inverse' | 'exponential';
  refDistance?: number;   // distance at which gain = 1.0; default 1
  maxDistance?: number;   // distance at which gain = 0 (linear) or floor; default 32
  rolloffFactor?: number; // sharper falloff = larger rolloff; default 1
  // Pre-spatial gain (still subject to VE budget on 'spatial' bus).
  gain?: number;          // default 1.0
  // Playback rate (pitch); default 1.
  rate?: number;
  // Loop the buffer; default false. Loops are stoppable via the handle.
  loop?: boolean;
}

// Listener pose. For a top-down 2D engine the orientation is fixed at
// the AudioContext.listener; only position is mutated each frame.
export interface AudioListenerPose {
  x: number;
  y: number;
  z?: number;
  // Forward vector (where the listener faces). Default (0, 0, -1).
  forward?: { x: number; y: number; z: number };
  // Up vector. Default (0, 1, 0).
  up?: { x: number; y: number; z: number };
}

// Handle returned from playPositional/playPositionalTone. Lets callers
// stop, reposition, fade out, and query liveness without holding the
// AudioBufferSourceNode directly.
export interface SpatialSourceHandle {
  // Stop and disconnect. Idempotent - safe to call after the source
  // already ended naturally.
  stop(): void;
  // Update the source position (e.g. moving boss). Cheap; reuses the
  // PannerNode, no new allocation.
  setPosition(x: number, y: number, z?: number): void;
  // Fade gain to 0 then stop. Returns when fade completes.
  fadeOut(durationMs: number): Promise<void>;
  // True until stop() called or buffer ended.
  isPlaying(): boolean;
}

// Name of the new sub-bus this class adds to the underlying AudioBus.
// Exported so consumers can adjust gain/mute via audioBus.setBusGain
// without depending on the literal.
export const SPATIAL_BUS_NAME = 'spatial';

// Distance helper shared with tests. Returns the Euclidean distance
// from the listener pose to a source. Treats undefined z as 0 and
// guards against NaN inputs (returns Infinity for any NaN coordinate
// so a defensive caller can skip muted sources cleanly).
export function spatialDistance(
  listener: { x: number; y: number; z?: number },
  source: { x: number; y: number; z?: number },
): number {
  if (
    Number.isNaN(listener.x) || Number.isNaN(listener.y) ||
    Number.isNaN(source.x) || Number.isNaN(source.y) ||
    (listener.z !== undefined && Number.isNaN(listener.z)) ||
    (source.z !== undefined && Number.isNaN(source.z))
  ) {
    return Number.POSITIVE_INFINITY;
  }
  const dx = source.x - listener.x;
  const dy = source.y - listener.y;
  const lz = listener.z ?? 0;
  const sz = source.z ?? 0;
  const dz = sz - lz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Internal record per active source. Kept in a Set so stopAll-style
// debug helpers and dispose() can sweep them.
interface ActiveSource {
  panner: PannerNode;
  gain: GainNode;
  source: AudioBufferSourceNode | OscillatorNode;
  isOscillator: boolean;
  stopped: boolean;
}

export class SpatialAudioBus {
  // The composed AudioBus. We don't alter its master/sub-buses; we
  // just add a 'spatial' sub-bus on it via addBus.
  private readonly audioBus: AudioBus;

  // The AudioContext from the underlying bus. Cached for cheap access.
  private readonly ctx: AudioContext;

  // Tracks live sources so dispose() / debug introspection can sweep.
  private active: Set<ActiveSource> = new Set();

  // Latest listener pose; remembered so handlers can read it without
  // re-traversing the AudioContext.
  private lastPose: AudioListenerPose = {
    x: 0,
    y: 0,
    z: 0,
    forward: { x: 0, y: 0, z: -1 },
    up: { x: 0, y: 1, z: 0 },
  };

  private constructor(audioBus: AudioBus) {
    this.audioBus = audioBus;
    this.ctx = audioBus.ctx;
    // Idempotent: if a 'spatial' bus already exists (engine consumer
    // wired one early), AudioBus.addBus is a no-op and we reuse it.
    if (!audioBus.hasBus(SPATIAL_BUS_NAME)) {
      audioBus.addBus(SPATIAL_BUS_NAME, {
        initialGain: 1.0,
        priority: 'ambient',
      });
    }
  }

  // Construct on top of an existing AudioBus. The AudioBus owns the
  // AudioContext lifecycle (unlock, dispose). v1 does not own a second
  // master gain; the spatial bus IS the master path through AudioBus.
  static create(audioBus: AudioBus): SpatialAudioBus {
    return new SpatialAudioBus(audioBus);
  }

  // Read-only accessor for the underlying AudioBus, useful for tests
  // and consumers that want to tweak the spatial sub-bus gain.
  getAudioBus(): AudioBus {
    return this.audioBus;
  }

  // Read-only accessor for the cached listener pose.
  getListenerPose(): AudioListenerPose {
    return this.lastPose;
  }

  // Update the listener pose. Renderer pushes this each frame from the
  // local character's transform via SpatialAudioSystem. Pose is global
  // to the AudioContext - one listener per context.
  setListener(pose: AudioListenerPose): void {
    this.lastPose = pose;
    var listener = (this.ctx as { listener?: AudioListener }).listener;
    if (!listener) return;
    var z = pose.z ?? 0;
    var fwd = pose.forward ?? { x: 0, y: 0, z: -1 };
    var up = pose.up ?? { x: 0, y: 1, z: 0 };
    // Modern AudioParam API (Chrome 64+, Firefox 58+, Safari 14+).
    if (
      (listener as unknown as { positionX?: AudioParam }).positionX !== undefined &&
      typeof (listener as unknown as { positionX: AudioParam }).positionX.setValueAtTime === 'function'
    ) {
      var asParam = listener as unknown as {
        positionX: AudioParam; positionY: AudioParam; positionZ: AudioParam;
        forwardX: AudioParam; forwardY: AudioParam; forwardZ: AudioParam;
        upX: AudioParam; upY: AudioParam; upZ: AudioParam;
      };
      var now = this.ctx.currentTime;
      asParam.positionX.setValueAtTime(pose.x, now);
      asParam.positionY.setValueAtTime(pose.y, now);
      asParam.positionZ.setValueAtTime(z, now);
      asParam.forwardX.setValueAtTime(fwd.x, now);
      asParam.forwardY.setValueAtTime(fwd.y, now);
      asParam.forwardZ.setValueAtTime(fwd.z, now);
      asParam.upX.setValueAtTime(up.x, now);
      asParam.upY.setValueAtTime(up.y, now);
      asParam.upZ.setValueAtTime(up.z, now);
      return;
    }
    // Deprecated fallback (older Safari, some test mocks).
    var legacy = listener as unknown as {
      setPosition?: (x: number, y: number, z: number) => void;
      setOrientation?: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void;
    };
    if (typeof legacy.setPosition === 'function') {
      legacy.setPosition(pose.x, pose.y, z);
    }
    if (typeof legacy.setOrientation === 'function') {
      legacy.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  // Play a one-shot positional sound. Returns null if the AudioContext
  // is suspended (AudioBus.unlock not yet called) or if the 'spatial'
  // bus is muted by VE-budget pressure.
  playPositional(
    buffer: AudioBuffer,
    options: PositionalPlayOptions,
  ): SpatialSourceHandle | null {
    if (!this.canPlay()) return null;
    var src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = options.rate ?? 1;
    src.loop = options.loop ?? false;
    return this.startSource(src, false, options);
  }

  // Convenience: play a positional tone (no asset needed). Useful for
  // tests and code-only demos. Honours options.type for the oscillator
  // waveform; envelope is left to the consumer (or the natural source
  // duration).
  playPositionalTone(
    freq: number,
    durationMs: number,
    options: PositionalPlayOptions & { type?: OscillatorType },
  ): SpatialSourceHandle | null {
    if (!this.canPlay()) return null;
    var osc = this.ctx.createOscillator();
    osc.type = options.type ?? 'sine';
    osc.frequency.value = freq;
    var handle = this.startSource(osc, true, options);
    if (handle) {
      // Schedule a stop at the end of the requested duration so the
      // tone doesn't run forever. Tiny tail keeps the click low.
      var stopAt = this.ctx.currentTime + Math.max(0.01, durationMs / 1000) + 0.05;
      try { osc.stop(stopAt); } catch { /* runtime may not support timestamped stop */ }
    }
    return handle;
  }

  // Stop every live spatial source and disconnect their nodes. Called
  // by dispose() and useful for "scene change, kill everything" flows.
  stopAll(): void {
    // Snapshot to a list because handle.stop mutates the set.
    var sources: ActiveSource[] = [];
    this.active.forEach(function (s) { sources.push(s); });
    for (var i = 0; i < sources.length; i++) {
      this.releaseSource(sources[i]!);
    }
    this.active.clear();
  }

  // Tear down. Useful in tests; production demo lives the lifetime of
  // the page. Does NOT dispose the underlying AudioBus - the consumer
  // may still want sfx/music/etc.
  dispose(): void {
    this.stopAll();
  }

  // -------- private --------

  // Returns true iff a play call would have a chance of producing
  // audible output: context unlocked AND spatial bus not muted by
  // VE-budget. We do NOT introspect AudioBus's internal state directly;
  // we mirror the public contract:
  //   - audioBus.isUnlocked() must be true
  //   - audioBus.isBusMuted('spatial') must be false (explicit mute)
  //   - audioBus.getBusGain('spatial') must be > 0 after budget gating
  //     (the bus's input GainNode reflects this; we check the live gain)
  private canPlay(): boolean {
    if (!this.audioBus.isUnlocked()) return false;
    if (this.audioBus.isBusMuted(SPATIAL_BUS_NAME)) return false;
    // Live gain after budget gating - if VE budget knocked it to 0,
    // there's no point creating a source we can't hear.
    var input = this.audioBus.input(SPATIAL_BUS_NAME) as unknown as { gain?: { value: number } };
    if (input && input.gain && input.gain.value === 0) return false;
    return true;
  }

  // Wires a fresh source -> gain -> panner -> spatial bus input,
  // applies position + falloff fields, registers the active source,
  // and returns a handle. Caller is responsible for src.start() in the
  // BufferSource case (we do it here so paths converge).
  private startSource(
    source: AudioBufferSourceNode | OscillatorNode,
    isOscillator: boolean,
    options: PositionalPlayOptions,
  ): SpatialSourceHandle {
    var panner = this.ctx.createPanner();
    var gain = this.ctx.createGain();
    gain.gain.value = options.gain ?? 1.0;

    // Falloff fields. PannerNode defaults are ref=1, max=10000,
    // rolloff=1, model='inverse'. Our defaults are documented in
    // PositionalPlayOptions.
    panner.distanceModel = options.distanceModel ?? 'inverse';
    panner.refDistance = options.refDistance ?? 1;
    panner.maxDistance = options.maxDistance ?? 32;
    panner.rolloffFactor = options.rolloffFactor ?? 1;
    panner.panningModel = 'HRTF';

    var z = options.z ?? 0;
    this.applyPositionTo(panner, options.x, options.y, z);

    // Wire: source -> gain -> panner -> spatial-bus input.
    source.connect(gain);
    gain.connect(panner);
    var spatialInput = this.audioBus.input(SPATIAL_BUS_NAME);
    panner.connect(spatialInput);

    // Track for cleanup BEFORE start() so an immediate end-of-buffer
    // event still finds us in the active set.
    var record: ActiveSource = {
      panner: panner,
      gain: gain,
      source: source,
      isOscillator: isOscillator,
      stopped: false,
    };
    this.active.add(record);

    // BufferSourceNode.onended fires when the buffer plays out OR
    // stop() is called. Use it to auto-cleanup so we don't leak nodes.
    var self = this;
    (source as { onended: ((this: AudioScheduledSourceNode, ev: Event) => unknown) | null }).onended = function () {
      self.releaseSource(record);
    };

    try {
      source.start();
    } catch {
      // Some runtimes throw if start() called twice; harmless here.
    }

    var handle: SpatialSourceHandle = {
      stop: function () {
        if (record.stopped) return;
        try { source.stop(); } catch { /* already stopped */ }
        self.releaseSource(record);
      },
      setPosition: function (nx: number, ny: number, nz?: number) {
        if (record.stopped) return;
        self.applyPositionTo(record.panner, nx, ny, nz ?? 0);
      },
      fadeOut: function (durationMs: number) {
        if (record.stopped) return Promise.resolve();
        var dur = Math.max(0, durationMs) / 1000;
        var now = self.ctx.currentTime;
        try {
          // setValueAtTime to current then ramp to 0 - prevents the
          // ramp from interpolating from whatever the previous
          // setValueAtTime scheduled (could be a jump).
          record.gain.gain.setValueAtTime(record.gain.gain.value, now);
          record.gain.gain.linearRampToValueAtTime(0, now + dur);
        } catch { /* fake AudioParam may not support */ }
        return new Promise<void>(function (resolve) {
          var ms = Math.max(0, durationMs);
          // setTimeout in test environments without a real audio clock.
          setTimeout(function () {
            handle.stop();
            resolve();
          }, ms);
        });
      },
      isPlaying: function () {
        return !record.stopped;
      },
    };
    return handle;
  }

  // Apply x/y/z to a PannerNode. Prefers AudioParam.setValueAtTime when
  // available (modern API); falls back to the deprecated direct
  // assignment via setPosition for older runtimes / mocks.
  private applyPositionTo(panner: PannerNode, x: number, y: number, z: number): void {
    var asParam = panner as unknown as {
      positionX?: AudioParam;
      positionY?: AudioParam;
      positionZ?: AudioParam;
    };
    if (
      asParam.positionX && typeof asParam.positionX.setValueAtTime === 'function'
    ) {
      var now = this.ctx.currentTime;
      asParam.positionX.setValueAtTime(x, now);
      asParam.positionY!.setValueAtTime(y, now);
      asParam.positionZ!.setValueAtTime(z, now);
      return;
    }
    var legacy = panner as unknown as { setPosition?: (x: number, y: number, z: number) => void };
    if (typeof legacy.setPosition === 'function') {
      legacy.setPosition(x, y, z);
    }
  }

  // Disconnect + drop one active source. Idempotent.
  private releaseSource(record: ActiveSource): void {
    if (record.stopped) return;
    record.stopped = true;
    this.active.delete(record);
    try { record.source.disconnect(); } catch { /* ignore */ }
    try { record.gain.disconnect(); } catch { /* ignore */ }
    try { record.panner.disconnect(); } catch { /* ignore */ }
  }
}
