// MusicDirector - high-level music playback with fade + crossfade.
//
// Per LOOM-AUDIO-SPEC §4.3. Wraps AudioBufferSourceNode + GainNode
// chains and routes them through audioBus.input('music'). The 'music'
// bus is an AudioBus default (priority 'ambient'), so VE-budget gating
// already mutes it under load - the director does not duplicate that.
//
// State machine (single track at a time, except mid-crossfade):
//   idle: nothing playing
//   playing(track): one source -> one gain -> music bus
//   crossfading(from -> to): two sources, two gains, both ramping
//
// playMusic(name, fadeIn): stops prior immediately (no fade), creates a
// new source+gain at gain=0, ramps to 1 over fadeInMs (default 500).
// Loops by default. No-op if asset not in cache.
//
// stopMusic(fadeOut): ramps current gain to 0 over fadeOutMs (default
// 800), stops source after fade. Resolves when fade completes. Safe
// when nothing playing.
//
// crossfadeMusic(name, fade): starts new track gain=0, ramps prior to 0
// + new to 1 simultaneously over fadeMs (default 1000), stops prior
// after fade. If nothing was playing, equivalent to playMusic with the
// same fade in.

import type { AudioBus } from './audio-bus.js';
import type { AudioAssetCache } from './audio-asset-cache.js';

const DEFAULT_FADE_IN_MS = 500;
const DEFAULT_FADE_OUT_MS = 800;
const DEFAULT_CROSSFADE_MS = 1000;

interface ActiveTrack {
  name: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class MusicDirector {
  private audioBus: AudioBus;
  private cache: AudioAssetCache;
  private current: ActiveTrack | null = null;

  private constructor(audioBus: AudioBus, cache: AudioAssetCache) {
    this.audioBus = audioBus;
    this.cache = cache;
  }

  static create(audioBus: AudioBus, cache: AudioAssetCache): MusicDirector {
    return new MusicDirector(audioBus, cache);
  }

  // Start a music track. If music is already playing, stops it
  // immediately (no fade). Use crossfadeMusic for smooth transitions.
  // No-op if asset not in cache.
  playMusic(name: string, fadeInMs?: number): void {
    var buffer = this.cache.get(name);
    if (!buffer) return;

    // Stop prior immediately - no fade.
    if (this.current) {
      this.hardStop(this.current);
      this.current = null;
    }

    var fade = fadeInMs !== undefined ? fadeInMs : DEFAULT_FADE_IN_MS;
    this.current = this.startTrack(name, buffer, fade);
  }

  // Stop the current track with a fade-out. Resolves when fade
  // completes. Safe to call when no music is playing.
  stopMusic(fadeOutMs?: number): Promise<void> {
    var track = this.current;
    if (!track) return Promise.resolve();

    var fade = fadeOutMs !== undefined ? fadeOutMs : DEFAULT_FADE_OUT_MS;
    this.current = null;
    return this.fadeOutAndStop(track, fade);
  }

  // Smoothly transition to a different track. If no track is playing,
  // equivalent to playMusic with fadeMs as the fade-in. Same name as
  // current is treated as a fresh play (the new buffer plays, prior
  // fades; useful when the buffer was reloaded with a new variant).
  crossfadeMusic(name: string, fadeMs?: number): void {
    var buffer = this.cache.get(name);
    if (!buffer) return;

    var fade = fadeMs !== undefined ? fadeMs : DEFAULT_CROSSFADE_MS;

    var prior = this.current;
    var next = this.startTrack(name, buffer, fade);
    this.current = next;

    if (prior) {
      // Fade prior out; clean up after fade. We do not await - crossfade
      // is fire-and-forget. If a NEW playMusic / crossfadeMusic call
      // arrives mid-fade, hardStop on the prior (which is no longer
      // referenced as `current`) is safe; the in-flight setTimeout
      // closure will then call stop() on an already-stopped source,
      // which the standard tolerates.
      this.fadeOutAndStop(prior, fade);
    }
  }

  // Currently-playing track name; null if silent. Mid-crossfade returns
  // the NEW (incoming) track name - the prior is fading out and is no
  // longer the canonical "current".
  currentMusic(): string | null {
    return this.current ? this.current.name : null;
  }

  // ---------- private ----------

  private startTrack(name: string, buffer: AudioBuffer, fadeInMs: number): ActiveTrack {
    var ctx = this.audioBus.ctx;
    var source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    var gain = ctx.createGain();
    var now = ctx.currentTime;
    var fadeSec = Math.max(0, fadeInMs) / 1000;
    if (fadeSec <= 0) {
      gain.gain.value = 1;
    } else {
      // setValueAtTime + linearRampToValueAtTime is the canonical
      // Web Audio fade pattern. Browsers schedule the ramp on the
      // audio thread; no JS timer needed for the audio side.
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + fadeSec);
    }

    source.connect(gain).connect(this.audioBus.input('music'));
    source.start();
    return { name: name, source: source, gain: gain };
  }

  private fadeOutAndStop(track: ActiveTrack, fadeOutMs: number): Promise<void> {
    var ctx = this.audioBus.ctx;
    var now = ctx.currentTime;
    var fadeSec = Math.max(0, fadeOutMs) / 1000;
    if (fadeSec <= 0) {
      // Immediate stop.
      this.hardStop(track);
      return Promise.resolve();
    }
    // Cancel any prior ramps on this gain (e.g. an in-progress fade-in)
    // so the fade-out starts from the actual current value rather than
    // a stale ramp target. cancelScheduledValues + setValueAtTime at
    // the live gain.value is the standard pattern.
    try {
      track.gain.gain.cancelScheduledValues(now);
    } catch {
      // some implementations / mocks may lack cancelScheduledValues;
      // best-effort
    }
    var startVal = track.gain.gain.value;
    track.gain.gain.setValueAtTime(startVal, now);
    track.gain.gain.linearRampToValueAtTime(0, now + fadeSec);

    return new Promise<void>((resolve) => {
      // Timer in JS-land mirrors the audio-thread ramp duration. After
      // the fade window, hardStop disconnects the nodes and stops the
      // source. setTimeout in tests runs against fake timers if the
      // test installs them, but in production the duration matches the
      // ramp.
      setTimeout(() => {
        this.hardStop(track);
        resolve();
      }, fadeOutMs);
    });
  }

  private hardStop(track: ActiveTrack): void {
    try {
      track.source.stop();
    } catch {
      // source.stop() throws if already-stopped on some implementations
      // or if start() was never called - we don't treat that as an
      // error.
    }
    try {
      track.source.disconnect();
    } catch {
      // ignore
    }
    try {
      track.gain.disconnect();
    } catch {
      // ignore
    }
  }
}

// Resource key for the world's resource registry. Engine consumers
// register a MusicDirector instance under this key alongside the audio
// bus + asset cache.
export const RESOURCE_MUSIC_DIRECTOR = 'music_director';
