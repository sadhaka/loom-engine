// AnimationClip - a named slice of a sprite sheet's frames[].
//
// One clip = one named animation (idle, walk, attack, etc.) on one
// sheet. The sheet manifest carries an optional clips[] field; if
// absent, the loader synthesizes a single 'default' clip covering
// all frames in order with the manifest's fps.
//
// Per-frame duration_ms takes precedence over the clip's fps which
// takes precedence over the manifest's fps. This mirrors Aseprite's
// tag + per-frame-duration pattern (see PRIOR-ART.md).

export interface AnimationClip {
  // Stable identifier within the parent manifest. Lowercase + ASCII
  // letters / digits / underscores. Systems look up clips by name.
  name: string;

  // Frame indices into the parent manifest's frames[] array. Clip
  // plays through these in order. 1-element arrays are valid (still
  // pin entity to one frame).
  frames: ReadonlyArray<number>;

  // Per-frame duration in milliseconds. If present, indexes parallel
  // to frames. Overrides per-manifest-frame duration_ms and clip fps.
  // Optional; clips can rely on the parent manifest's fps.
  durations_ms?: ReadonlyArray<number>;

  // Loop mode:
  //   true  -> restart at frames[0] after the last frame, forever
  //   false -> hold on the last frame after the cycle ends; the
  //            AnimationStatePool's FINISHED flag is set so a system
  //            can transition to a new clip
  loop: boolean;

  // Per-clip fps override. If absent, the parent manifest's fps is
  // used. Per-frame durations_ms still trump this.
  fps?: number;
}

// Synthesizes a 'default' clip covering all frames of a manifest.
// Used when a manifest doesn't declare its own clips[] - keeps
// backward compat with the asset-pipeline session's original schema.
export function synthesizeDefaultClip(frameCount: number): AnimationClip {
  const frames: number[] = [];
  for (let i = 0; i < frameCount; i++) frames.push(i);
  return {
    name: 'default',
    frames,
    loop: true,
  };
}

// Total cycle duration of a clip in milliseconds. Honors precedence:
//   per-frame durations_ms[] > clip.fps > manifestFps
// All clips with at least one frame have a positive duration.
export function clipDurationMs(clip: AnimationClip, manifestFps: number): number {
  if (clip.durations_ms && clip.durations_ms.length === clip.frames.length) {
    let total = 0;
    for (let i = 0; i < clip.durations_ms.length; i++) {
      total += clip.durations_ms[i] ?? 0;
    }
    return total;
  }
  const fps = clip.fps ?? manifestFps;
  if (fps <= 0 || clip.frames.length === 0) return 0;
  return (clip.frames.length * 1000) / fps;
}

// Resolve which frame within a clip should display at a given
// elapsed time. Returns the index INTO clip.frames (not into the
// parent manifest). A non-looping clip held past its duration
// returns the last frame.
export function frameInClipAt(
  clip: AnimationClip,
  elapsedMs: number,
  manifestFps: number,
): number {
  const n = clip.frames.length;
  if (n === 0) return 0;
  if (n === 1) return 0;
  const total = clipDurationMs(clip, manifestFps);
  if (total <= 0) return 0;

  let t = elapsedMs;
  if (clip.loop) {
    t = ((t % total) + total) % total;
  } else if (t >= total) {
    return n - 1;
  } else if (t < 0) {
    return 0;
  }

  // Per-frame durations: walk the array.
  if (clip.durations_ms && clip.durations_ms.length === n) {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += clip.durations_ms[i] ?? 0;
      if (t < acc) return i;
    }
    return n - 1;
  }

  // Uniform per-frame duration.
  const fps = clip.fps ?? manifestFps;
  const frameMs = 1000 / fps;
  const idx = Math.floor(t / frameMs);
  return idx >= n ? n - 1 : idx;
}

// Resolve clip.frames[i] to its parent manifest frame index. Bounds-
// safe: out-of-range returns 0 (rendering a black frame is preferable
// to throwing in the render loop).
export function manifestFrameIndex(clip: AnimationClip, frameInClip: number): number {
  return clip.frames[frameInClip] ?? 0;
}
