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
// Synthesizes a 'default' clip covering all frames of a manifest.
// Used when a manifest doesn't declare its own clips[] - keeps
// backward compat with the asset-pipeline session's original schema.
export function synthesizeDefaultClip(frameCount) {
    const frames = [];
    for (let i = 0; i < frameCount; i++)
        frames.push(i);
    return {
        name: 'default',
        frames,
        loop: true,
    };
}
// Total cycle duration of a clip in milliseconds. Honors precedence:
//   per-frame durations_ms[] > clip.fps > manifestFps
// All clips with at least one frame have a positive duration.
export function clipDurationMs(clip, manifestFps) {
    if (clip.durations_ms && clip.durations_ms.length === clip.frames.length) {
        let total = 0;
        for (let i = 0; i < clip.durations_ms.length; i++) {
            total += clip.durations_ms[i] ?? 0;
        }
        return total;
    }
    const fps = clip.fps ?? manifestFps;
    if (fps <= 0 || clip.frames.length === 0)
        return 0;
    return (clip.frames.length * 1000) / fps;
}
// Resolve which frame within a clip should display at a given
// elapsed time. Returns the index INTO clip.frames (not into the
// parent manifest). A non-looping clip held past its duration
// returns the last frame.
export function frameInClipAt(clip, elapsedMs, manifestFps) {
    const n = clip.frames.length;
    if (n === 0)
        return 0;
    if (n === 1)
        return 0;
    const total = clipDurationMs(clip, manifestFps);
    if (total <= 0)
        return 0;
    let t = elapsedMs;
    if (clip.loop) {
        t = ((t % total) + total) % total;
    }
    else if (t >= total) {
        return n - 1;
    }
    else if (t < 0) {
        return 0;
    }
    // Per-frame durations: walk the array.
    if (clip.durations_ms && clip.durations_ms.length === n) {
        let acc = 0;
        for (let i = 0; i < n; i++) {
            acc += clip.durations_ms[i] ?? 0;
            if (t < acc)
                return i;
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
export function manifestFrameIndex(clip, frameInClip) {
    return clip.frames[frameInClip] ?? 0;
}
//# sourceMappingURL=animation-clip.js.map