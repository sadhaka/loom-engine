// MusicPlaylist - track sequencer for ambient music.
//
// 0.95.0 enabling primitive. Zones / scenes often want a queue of
// 2-5 ambient tracks that rotate over time without any single
// track replaying back-to-back. MusicPlaylist owns the order +
// playback cursor; MusicDirector / AudioBus consume the
// current track URL each frame and crossfade between them.
//
//   var playlist = MusicPlaylist.create({
//     loopAtEnd:     true,
//     shuffleOnLoop: true,
//   });
//   playlist.addTrack({ id: 'plaza_dusk_a', url: '/audio/plaza_a.mp3' });
//   playlist.addTrack({ id: 'plaza_dusk_b', url: '/audio/plaza_b.mp3' });
//   var first = playlist.play();
//   ...track ends...
//   var next = playlist.next();
//
// Pairs with MusicDirector (Phase 17 audio Track B) for the
// crossfade + decode side; MusicPlaylist just sequences which
// track is "current."
//
// Code style: var-only in browser source.

export interface MusicTrack {
  id: string;
  url: string;
  durationMs?: number;
  loop?: boolean;
  data?: Record<string, unknown>;
}

export interface MusicPlaylistOptions {
  // Restart from track 0 after last. Default false.
  loopAtEnd?: boolean;
  // Re-shuffle the track order on each loop cycle. Default false.
  shuffleOnLoop?: boolean;
  // RNG callable for shuffle. Default Math.random.
  rng?: () => number;
}

export class MusicPlaylist {
  private tracks: MusicTrack[] = [];
  private order: number[] = [];
  private cursor: number = -1;
  private playing: boolean = false;
  private loopAtEnd: boolean;
  private shuffleOnLoop: boolean;
  private rng: () => number;
  private disposed: boolean = false;

  private constructor(opts: MusicPlaylistOptions) {
    this.loopAtEnd = opts.loopAtEnd === true;
    this.shuffleOnLoop = opts.shuffleOnLoop === true;
    this.rng = opts.rng ?? Math.random;
  }

  static create(opts: MusicPlaylistOptions = {}): MusicPlaylist {
    return new MusicPlaylist(opts);
  }

  addTrack(track: MusicTrack): boolean {
    if (this.disposed) return false;
    if (!track || typeof track.id !== 'string' || track.id.length === 0) {
      return false;
    }
    if (typeof track.url !== 'string' || track.url.length === 0) {
      return false;
    }
    for (var i = 0; i < this.tracks.length; i++) {
      if ((this.tracks[i] as MusicTrack).id === track.id) return false;
    }
    var copy: MusicTrack = { id: track.id, url: track.url };
    if (track.durationMs !== undefined) copy.durationMs = track.durationMs;
    if (track.loop !== undefined) copy.loop = track.loop;
    if (track.data) copy.data = track.data;
    this.tracks.push(copy);
    this.order.push(this.tracks.length - 1);
    return true;
  }

  removeTrack(id: string): boolean {
    if (this.disposed) return false;
    var idx = -1;
    for (var i = 0; i < this.tracks.length; i++) {
      if ((this.tracks[i] as MusicTrack).id === id) { idx = i; break; }
    }
    if (idx < 0) return false;
    // Capture which TRACK index the cursor pointed to so we can
    // re-anchor after rebuild.
    var currentTrackIdx = (this.cursor >= 0 && this.cursor < this.order.length)
      ? (this.order[this.cursor] as number) : -1;
    this.tracks.splice(idx, 1);
    var newOrder: number[] = [];
    for (var j = 0; j < this.order.length; j++) {
      var v = this.order[j] as number;
      if (v === idx) continue;
      if (v > idx) newOrder.push(v - 1);
      else newOrder.push(v);
    }
    this.order = newOrder;
    if (currentTrackIdx === idx) {
      // The track being played was the one removed - stop.
      this.cursor = -1;
      this.playing = false;
    } else if (currentTrackIdx >= 0) {
      var newCur = currentTrackIdx > idx
        ? currentTrackIdx - 1 : currentTrackIdx;
      var found = -1;
      for (var k = 0; k < newOrder.length; k++) {
        if (newOrder[k] === newCur) { found = k; break; }
      }
      this.cursor = found;
      if (this.cursor === -1) this.playing = false;
    }
    return true;
  }

  has(id: string): boolean {
    for (var i = 0; i < this.tracks.length; i++) {
      if ((this.tracks[i] as MusicTrack).id === id) return true;
    }
    return false;
  }

  size(): number { return this.tracks.length; }

  list(): MusicTrack[] {
    return this.tracks.map(cloneTrack);
  }

  // Start playback at the first track in the order. Returns the
  // track or null if playlist is empty.
  play(): MusicTrack | null {
    if (this.disposed) return null;
    if (this.tracks.length === 0) return null;
    this.cursor = 0;
    this.playing = true;
    return this.currentInternal();
  }

  // Advance to the next track. Returns the new current or null if
  // we've passed the end (and loopAtEnd is false).
  next(): MusicTrack | null {
    if (this.disposed) return null;
    if (this.tracks.length === 0) return null;
    if (!this.playing && this.cursor === -1) {
      // Same as play(): kick off at track 0.
      this.cursor = 0;
      this.playing = true;
      return this.currentInternal();
    }
    var nextCursor = this.cursor + 1;
    if (nextCursor >= this.order.length) {
      if (!this.loopAtEnd) {
        this.cursor = -1;
        this.playing = false;
        return null;
      }
      if (this.shuffleOnLoop) this.shuffleOrder();
      nextCursor = 0;
    }
    this.cursor = nextCursor;
    this.playing = true;
    return this.currentInternal();
  }

  // Step back one track. Returns new current or null when before
  // the start (and loopAtEnd is false).
  prev(): MusicTrack | null {
    if (this.disposed) return null;
    if (this.tracks.length === 0) return null;
    var prevCursor = this.cursor - 1;
    if (prevCursor < 0) {
      if (!this.loopAtEnd) {
        this.cursor = -1;
        this.playing = false;
        return null;
      }
      prevCursor = this.order.length - 1;
    }
    this.cursor = prevCursor;
    this.playing = true;
    return this.currentInternal();
  }

  stop(): void {
    if (this.disposed) return;
    this.cursor = -1;
    this.playing = false;
  }

  // Jump directly to a specific track id. Returns the track or
  // null if the id is not registered.
  jumpTo(id: string): MusicTrack | null {
    if (this.disposed) return null;
    for (var i = 0; i < this.order.length; i++) {
      var idx = this.order[i] as number;
      if ((this.tracks[idx] as MusicTrack).id === id) {
        this.cursor = i;
        this.playing = true;
        return this.currentInternal();
      }
    }
    return null;
  }

  current(): MusicTrack | null {
    if (this.disposed) return null;
    return this.currentInternal();
  }

  isPlaying(): boolean { return this.playing; }

  setLoopAtEnd(loop: boolean): void {
    if (this.disposed) return;
    this.loopAtEnd = !!loop;
  }

  setShuffleOnLoop(shuffle: boolean): void {
    if (this.disposed) return;
    this.shuffleOnLoop = !!shuffle;
  }

  // Force a shuffle of the order (independent from loop boundary).
  shuffle(): void {
    if (this.disposed) return;
    this.shuffleOrder();
    this.cursor = -1;
    this.playing = false;
  }

  dispose(): void {
    this.tracks = [];
    this.order = [];
    this.cursor = -1;
    this.playing = false;
    this.disposed = true;
  }

  // ---------- private ----------

  private currentInternal(): MusicTrack | null {
    if (this.cursor < 0 || this.cursor >= this.order.length) return null;
    var idx = this.order[this.cursor] as number;
    var t = this.tracks[idx];
    return t ? cloneTrack(t) : null;
  }

  private shuffleOrder(): void {
    // Fisher-Yates using the injected RNG.
    var n = this.order.length;
    for (var i = n - 1; i > 0; i--) {
      var j = Math.floor(this.rng() * (i + 1));
      if (j < 0) j = 0;
      if (j > i) j = i;
      var tmp = this.order[i] as number;
      this.order[i] = this.order[j] as number;
      this.order[j] = tmp;
    }
  }
}

function cloneTrack(t: MusicTrack): MusicTrack {
  var copy: MusicTrack = { id: t.id, url: t.url };
  if (t.durationMs !== undefined) copy.durationMs = t.durationMs;
  if (t.loop !== undefined) copy.loop = t.loop;
  if (t.data) copy.data = t.data;
  return copy;
}

// Resource key for the world's resource registry.
export const RESOURCE_MUSIC_PLAYLIST = 'music_playlist';
