// Loom Engine - sprite-sheet loader.
//
// Loads a PNG + JSON manifest pair from a URL and returns the
// {image, frames} shape that IGraphicsDevice.registerAtlas accepts
// directly. The engine never decides where assets come from; the
// caller passes a manifest URL and the loader fetches both halves.
//
// Manifest schema (see assets/knight/walk.json for an example):
//   {
//     "name": "knight-walk",
//     "image": "walk.png",         // sibling-relative URL of the PNG
//     "frames": [
//       { "x":0, "y":0, "w":16, "h":32, "name":"walk_pass_a", "duration_ms":140 },
//       ...
//     ],
//     "anchor": { "x": 8, "y": 32 },
//     "fps": 8
//   }
//
// PRIOR-ART.md cites the Aseprite "JSON-Array" export and the
// TexturePacker "JSON-array" format as inspiration for the shape.
// We do not parse either format directly; we use a small superset
// (per-frame name + duration_ms + sheet anchor + fps) tailored to
// the engine's animation needs.

import type {
  AtlasDescriptor,
} from '../renderer/graphics-device.js';
import type { AnimationClip } from '../animation/animation-clip.js';

// Single frame within a sheet. Pixel-space rect inside the source
// image. Optional name (for debugging + later animation lookup) and
// duration_ms (for time-driven frame stepping).
export interface SpriteFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  name?: string;
  duration_ms?: number;
}

// Anchor in pixel-space within a single frame. The renderer uses
// (frame.w / 2, frame.h) (bottom-center) by default; the manifest's
// anchor is informational - higher-level systems can read it to
// override per-asset.
export interface SpriteAnchor {
  x: number;
  y: number;
}

// Parsed manifest, validated.
export interface SpriteSheetManifest {
  name: string;
  image: string;
  frames: ReadonlyArray<SpriteFrame>;
  anchor: SpriteAnchor;
  fps: number;
  // Optional named clips. If absent, the loader synthesizes a
  // 'default' clip covering all frames in order. Phase 3 added this
  // field; pre-Phase-3 manifests parse without modification.
  clips: ReadonlyArray<AnimationClip>;
}

// Loaded sheet ready to feed registerAtlas. The `image` is a real
// HTMLImageElement (DOM-only); pass the {image, frames, name} object
// straight into device.registerAtlas. The full manifest is also
// returned so callers can read anchor + fps + per-frame metadata.
export interface LoadedSpriteSheet {
  manifest: SpriteSheetManifest;
  image: HTMLImageElement;
  // Convenience: AtlasDescriptor-shaped object ready for registerAtlas.
  // The frames array is a fresh shallow copy with only the fields
  // the device cares about (x, y, w, h).
  atlas: AtlasDescriptor;
}

// Errors thrown by the loader. All carry a `kind` so callers can
// branch on the failure mode without parsing message strings.
export class SpriteSheetLoadError extends Error {
  readonly kind:
    | 'fetch-manifest'
    | 'parse-manifest'
    | 'invalid-manifest'
    | 'fetch-image'
    | 'decode-image';
  readonly url: string;
  constructor(
    kind: SpriteSheetLoadError['kind'],
    url: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`SpriteSheetLoadError[${kind}] ${url}: ${message}`, options);
    this.name = 'SpriteSheetLoadError';
    this.kind = kind;
    this.url = url;
  }
}

// Inject points for testing. Production callers leave both at
// defaults; tests pass mocks.
export interface LoaderOptions {
  fetchImpl?: typeof fetch;
  // Image decode hook. Test environments without DOM pass a stub
  // that returns whatever shape the test wants. The loader does not
  // touch the returned object except to pass it through.
  decodeImage?: (bytes: ArrayBuffer, url: string) => Promise<HTMLImageElement>;
}

// Default browser-side image decoder. Creates an <img>, sets src to
// a blob: URL, and resolves on load. Throws SpriteSheetLoadError
// with kind='decode-image' on failure.
function defaultDecodeImage(bytes: ArrayBuffer, url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes], { type: 'image/png' });
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(
        new SpriteSheetLoadError(
          'decode-image',
          url,
          'Image element failed to decode the PNG bytes',
          { cause: err },
        ),
      );
    };
    img.src = objectUrl;
  });
}

// Resolve a sibling-relative image path against the manifest URL.
// "walk.png" alongside ".../knight/walk.json" -> ".../knight/walk.png".
// Absolute URLs and "/abs/path" pass through unchanged.
function resolveImageUrl(manifestUrl: string, imagePath: string): string {
  // URL constructor handles both absolute and relative inputs as long
  // as we have a base. In Node (no DOM, no document) the manifestUrl
  // must be absolute (file://, http(s)://); in the browser the
  // Document base does the work.
  try {
    return new URL(imagePath, manifestUrl).toString();
  } catch {
    // Fallback: simple sibling-replace. Strip the manifest filename
    // and append the image filename. This handles bare relative paths
    // when no URL constructor base is reachable.
    const slash = manifestUrl.lastIndexOf('/');
    if (slash < 0) return imagePath;
    return manifestUrl.slice(0, slash + 1) + imagePath;
  }
}

// Validate a parsed JSON object against the manifest schema. Returns
// the typed manifest or throws SpriteSheetLoadError. We do not pull
// in a schema library; the engine ships zero runtime deps.
function validateManifest(raw: unknown, url: string): SpriteSheetManifest {
  if (!raw || typeof raw !== 'object') {
    throw new SpriteSheetLoadError('invalid-manifest', url, 'manifest is not an object');
  }
  const m = raw as Record<string, unknown>;

  if (typeof m['name'] !== 'string' || m['name'].length === 0) {
    throw new SpriteSheetLoadError('invalid-manifest', url, 'name must be a non-empty string');
  }
  if (typeof m['image'] !== 'string' || m['image'].length === 0) {
    throw new SpriteSheetLoadError('invalid-manifest', url, 'image must be a non-empty string');
  }
  if (!Array.isArray(m['frames']) || m['frames'].length === 0) {
    throw new SpriteSheetLoadError(
      'invalid-manifest',
      url,
      'frames must be a non-empty array',
    );
  }

  const frames: SpriteFrame[] = [];
  for (let i = 0; i < m['frames'].length; i++) {
    const fRaw = m['frames'][i];
    if (!fRaw || typeof fRaw !== 'object') {
      throw new SpriteSheetLoadError(
        'invalid-manifest',
        url,
        `frame[${i}] is not an object`,
      );
    }
    const f = fRaw as Record<string, unknown>;
    const x = f['x'];
    const y = f['y'];
    const w = f['w'];
    const h = f['h'];
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof w !== 'number' ||
      typeof h !== 'number'
    ) {
      throw new SpriteSheetLoadError(
        'invalid-manifest',
        url,
        `frame[${i}] must have numeric x, y, w, h`,
      );
    }
    if (w <= 0 || h <= 0) {
      throw new SpriteSheetLoadError(
        'invalid-manifest',
        url,
        `frame[${i}] w and h must be positive`,
      );
    }
    const frame: SpriteFrame = { x, y, w, h };
    if (typeof f['name'] === 'string') frame.name = f['name'];
    if (typeof f['duration_ms'] === 'number') frame.duration_ms = f['duration_ms'];
    frames.push(frame);
  }

  // Anchor defaults to bottom-center of the first frame if not given.
  let anchor: SpriteAnchor;
  const aRaw = m['anchor'];
  if (aRaw && typeof aRaw === 'object') {
    const a = aRaw as Record<string, unknown>;
    if (typeof a['x'] !== 'number' || typeof a['y'] !== 'number') {
      throw new SpriteSheetLoadError(
        'invalid-manifest',
        url,
        'anchor.x and anchor.y must be numeric when anchor is present',
      );
    }
    anchor = { x: a['x'], y: a['y'] };
  } else {
    const f0 = frames[0]!;
    anchor = { x: f0.w / 2, y: f0.h };
  }

  // fps optional, defaults to 8 (matches the v1 walk-cycle cadence).
  let fps = 8;
  if (m['fps'] !== undefined) {
    if (typeof m['fps'] !== 'number' || m['fps'] <= 0) {
      throw new SpriteSheetLoadError('invalid-manifest', url, 'fps must be a positive number');
    }
    fps = m['fps'];
  }

  // Clips optional. When absent, synthesize a 'default' clip that
  // walks all frames in order, looping. When present, validate that
  // each clip has a non-empty frames[] of integer indices in range
  // and a boolean loop flag.
  let clips: AnimationClip[];
  if (m['clips'] === undefined) {
    const defaultFrames: number[] = [];
    for (let i = 0; i < frames.length; i++) defaultFrames.push(i);
    clips = [{ name: 'default', frames: defaultFrames, loop: true }];
  } else {
    if (!Array.isArray(m['clips'])) {
      throw new SpriteSheetLoadError('invalid-manifest', url, 'clips must be an array when present');
    }
    clips = [];
    for (let ci = 0; ci < m['clips'].length; ci++) {
      const cRaw = m['clips'][ci];
      if (!cRaw || typeof cRaw !== 'object') {
        throw new SpriteSheetLoadError('invalid-manifest', url, `clips[${ci}] is not an object`);
      }
      const c = cRaw as Record<string, unknown>;
      if (typeof c['name'] !== 'string' || c['name'].length === 0) {
        throw new SpriteSheetLoadError('invalid-manifest', url, `clips[${ci}].name must be a non-empty string`);
      }
      if (!Array.isArray(c['frames']) || c['frames'].length === 0) {
        throw new SpriteSheetLoadError('invalid-manifest', url, `clips[${ci}].frames must be a non-empty array`);
      }
      const clipFrames: number[] = [];
      for (let fi = 0; fi < c['frames'].length; fi++) {
        const v = c['frames'][fi];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= frames.length) {
          throw new SpriteSheetLoadError(
            'invalid-manifest',
            url,
            `clips[${ci}].frames[${fi}] must be an integer in [0, ${frames.length})`,
          );
        }
        clipFrames.push(v);
      }
      if (typeof c['loop'] !== 'boolean') {
        throw new SpriteSheetLoadError('invalid-manifest', url, `clips[${ci}].loop must be boolean`);
      }
      const clip: AnimationClip = { name: c['name'], frames: clipFrames, loop: c['loop'] };
      if (c['fps'] !== undefined) {
        if (typeof c['fps'] !== 'number' || c['fps'] <= 0) {
          throw new SpriteSheetLoadError('invalid-manifest', url, `clips[${ci}].fps must be a positive number when present`);
        }
        clip.fps = c['fps'];
      }
      if (c['durations_ms'] !== undefined) {
        if (!Array.isArray(c['durations_ms']) || c['durations_ms'].length !== clipFrames.length) {
          throw new SpriteSheetLoadError(
            'invalid-manifest',
            url,
            `clips[${ci}].durations_ms must be an array of length ${clipFrames.length} when present`,
          );
        }
        const durs: number[] = [];
        for (let di = 0; di < c['durations_ms'].length; di++) {
          const d = c['durations_ms'][di];
          if (typeof d !== 'number' || d <= 0) {
            throw new SpriteSheetLoadError(
              'invalid-manifest',
              url,
              `clips[${ci}].durations_ms[${di}] must be a positive number`,
            );
          }
          durs.push(d);
        }
        clip.durations_ms = durs;
      }
      clips.push(clip);
    }
    if (clips.length === 0) {
      throw new SpriteSheetLoadError('invalid-manifest', url, 'clips must be non-empty when present');
    }
  }

  return {
    name: m['name'],
    image: m['image'],
    frames,
    anchor,
    fps,
    clips,
  };
}

// Load a sprite sheet from a manifest URL. Fetches the JSON, then
// the PNG referenced by the manifest's "image" field (resolved
// sibling-relative to the manifest URL), then decodes the image and
// returns a LoadedSpriteSheet.
//
// The returned `atlas` is shaped exactly for IGraphicsDevice.registerAtlas:
//   const sheet = await loadSpriteSheet('/assets/knight/walk.json');
//   const handle = device.registerAtlas(sheet.atlas);
export async function loadSpriteSheet(
  manifestUrl: string,
  options: LoaderOptions = {},
): Promise<LoadedSpriteSheet> {
  const fetchImpl = options.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!fetchImpl) {
    throw new SpriteSheetLoadError(
      'fetch-manifest',
      manifestUrl,
      'no fetch implementation available; pass options.fetchImpl',
    );
  }
  const decodeImage = options.decodeImage ?? defaultDecodeImage;

  // 1. Fetch + parse manifest.
  let manifestResp: Response;
  try {
    manifestResp = await fetchImpl(manifestUrl);
  } catch (err) {
    throw new SpriteSheetLoadError('fetch-manifest', manifestUrl, 'network error', { cause: err });
  }
  if (!manifestResp.ok) {
    throw new SpriteSheetLoadError(
      'fetch-manifest',
      manifestUrl,
      `HTTP ${manifestResp.status} ${manifestResp.statusText}`,
    );
  }

  let raw: unknown;
  try {
    raw = await manifestResp.json();
  } catch (err) {
    throw new SpriteSheetLoadError(
      'parse-manifest',
      manifestUrl,
      'response is not valid JSON',
      { cause: err },
    );
  }

  const manifest = validateManifest(raw, manifestUrl);

  // 2. Fetch + decode image.
  const imageUrl = resolveImageUrl(manifestUrl, manifest.image);
  let imageResp: Response;
  try {
    imageResp = await fetchImpl(imageUrl);
  } catch (err) {
    throw new SpriteSheetLoadError('fetch-image', imageUrl, 'network error', { cause: err });
  }
  if (!imageResp.ok) {
    throw new SpriteSheetLoadError(
      'fetch-image',
      imageUrl,
      `HTTP ${imageResp.status} ${imageResp.statusText}`,
    );
  }

  const bytes = await imageResp.arrayBuffer();
  const image = await decodeImage(bytes, imageUrl);

  // 3. Compose AtlasDescriptor (only fields the device reads).
  const atlas: AtlasDescriptor = {
    image,
    frames: manifest.frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h })),
    name: manifest.name,
  };

  return { manifest, image, atlas };
}

// Compute the active frame index for a time-driven walk cycle. Use
// per-frame duration_ms if every frame has it, otherwise fall back
// to manifest.fps. Returns an integer in [0, frames.length).
//
// `now` is a monotonic millisecond clock (typically performance.now()
// in the browser or process.hrtime() bigint -> ms in Node). `start`
// is the t0 the caller stored when the animation began.
export function computeFrameIndex(
  manifest: SpriteSheetManifest,
  now: number,
  start: number,
): number {
  const n = manifest.frames.length;
  if (n <= 1) return 0;

  // Sum per-frame durations if available. Mixed manifests (some
  // frames with duration_ms, some without) fall back to fps.
  let totalDuration = 0;
  let allHaveDuration = true;
  for (let i = 0; i < n; i++) {
    const d = manifest.frames[i]?.duration_ms;
    if (typeof d === 'number' && d > 0) {
      totalDuration += d;
    } else {
      allHaveDuration = false;
      break;
    }
  }

  const elapsed = Math.max(0, now - start);

  if (allHaveDuration) {
    const t = elapsed % totalDuration;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += manifest.frames[i]!.duration_ms!;
      if (t < acc) return i;
    }
    return n - 1; // safety
  }

  // Uniform-fps fallback.
  const frameMs = 1000 / manifest.fps;
  return Math.floor(elapsed / frameMs) % n;
}
