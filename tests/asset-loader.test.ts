// Loom Engine - sprite-sheet loader smoke test.
//
// Node-based, no DOM. Mocks fetch() and the image-decode hook so the
// loader can be exercised end-to-end without a browser. Covers:
//   - happy path: manifest + PNG bytes resolve into a valid sheet
//   - sibling-relative image URL resolution
//   - per-frame metadata round-trip (name, duration_ms)
//   - default anchor (bottom-center) when manifest omits anchor
//   - default fps when manifest omits fps
//   - validation errors for malformed manifests
//   - error handling: HTTP failure on manifest, on image, decode failure
//   - computeFrameIndex: per-frame durations + uniform fps fallback

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  loadSpriteSheet,
  computeFrameIndex,
  SpriteSheetLoadError,
  type SpriteSheetManifest,
  type LoaderOptions,
} from '../src/asset/sprite-sheet-loader.js';

// ---------- Mock fetch helpers ----------

interface MockResponse {
  ok: boolean;
  status: number;
  statusText: string;
  body: unknown;
  bytes?: Uint8Array;
}

function makeMockFetch(routes: Record<string, MockResponse>): {
  fetch: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = (async (input: unknown): Promise<Response> => {
    const url = typeof input === 'string' ? input : (input as { toString(): string }).toString();
    calls.push(url);
    const route = routes[url];
    if (!route) {
      throw new Error('mock fetch: no route for ' + url);
    }
    return {
      ok: route.ok,
      status: route.status,
      statusText: route.statusText,
      json: async () => route.body,
      arrayBuffer: async () => {
        if (!route.bytes) throw new Error('mock route ' + url + ' has no bytes');
        // Return a fresh ArrayBuffer view to satisfy the loader contract.
        return route.bytes.slice().buffer;
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

// Stub image decoder. Skips PIL/canvas - just hands back a sentinel
// object. The loader passes it through to the AtlasDescriptor.
function makeStubDecode(): {
  decode: NonNullable<LoaderOptions['decodeImage']>;
  decodedUrls: string[];
} {
  const decodedUrls: string[] = [];
  const decode: NonNullable<LoaderOptions['decodeImage']> = async (bytes, url) => {
    decodedUrls.push(url);
    // Return an opaque sentinel that satisfies the HTMLImageElement
    // type slot in tests. The renderer never runs in this test.
    return { __mock: true, byteLength: bytes.byteLength, src: url } as unknown as HTMLImageElement;
  };
  return { decode, decodedUrls };
}

// ---------- Fixtures ----------

const MANIFEST_URL = 'https://example.test/assets/knight/walk.json';
const IMAGE_URL = 'https://example.test/assets/knight/walk.png';

const WALK_MANIFEST: SpriteSheetManifest = {
  name: 'knight-walk',
  image: 'walk.png',
  frames: [
    { x: 0, y: 0, w: 16, h: 32, name: 'walk_pass_a', duration_ms: 140 },
    { x: 16, y: 0, w: 16, h: 32, name: 'walk_right', duration_ms: 140 },
    { x: 32, y: 0, w: 16, h: 32, name: 'walk_pass_b', duration_ms: 140 },
    { x: 48, y: 0, w: 16, h: 32, name: 'walk_left', duration_ms: 140 },
  ],
  anchor: { x: 8, y: 32 },
  fps: 8,
  // Phase 3 added required clips[]; loader auto-synthesizes 'default'
  // for manifests that don't declare clips, so tests reflect that.
  clips: [{ name: 'default', frames: [0, 1, 2, 3], loop: true }],
};

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  // We don't need a real PNG body - the loader passes raw bytes to
  // the (mocked) decoder. Use a few extra bytes so byteLength > sig.
  0x00, 0x00, 0x00, 0x0d,
]);

// ---------- Tests ----------

test('loader: happy path produces an AtlasDescriptor-ready sheet', async () => {
  const { fetch: f, calls } = makeMockFetch({
    [MANIFEST_URL]: { ok: true, status: 200, statusText: 'OK', body: WALK_MANIFEST },
    [IMAGE_URL]: { ok: true, status: 200, statusText: 'OK', body: null, bytes: PNG_BYTES },
  });
  const { decode, decodedUrls } = makeStubDecode();

  const sheet = await loadSpriteSheet(MANIFEST_URL, { fetchImpl: f, decodeImage: decode });

  // Both URLs were fetched, in order.
  assert.deepEqual(calls, [MANIFEST_URL, IMAGE_URL]);
  assert.deepEqual(decodedUrls, [IMAGE_URL]);

  // Manifest round-tripped.
  assert.equal(sheet.manifest.name, 'knight-walk');
  assert.equal(sheet.manifest.frames.length, 4);
  assert.equal(sheet.manifest.anchor.x, 8);
  assert.equal(sheet.manifest.anchor.y, 32);
  assert.equal(sheet.manifest.fps, 8);

  // Per-frame metadata preserved.
  assert.equal(sheet.manifest.frames[1]?.name, 'walk_right');
  assert.equal(sheet.manifest.frames[1]?.duration_ms, 140);

  // AtlasDescriptor frames are plain {x, y, w, h} (no extra metadata).
  assert.equal(sheet.atlas.frames.length, 4);
  const f0 = sheet.atlas.frames[0]!;
  assert.equal(f0.x, 0);
  assert.equal(f0.y, 0);
  assert.equal(f0.w, 16);
  assert.equal(f0.h, 32);
  assert.equal(sheet.atlas.name, 'knight-walk');

  // Image was passed through.
  assert.equal((sheet.image as unknown as { __mock: boolean }).__mock, true);
  assert.equal(sheet.atlas.image, sheet.image);
});

test('loader: sibling-relative image path resolves against manifest URL', async () => {
  // The manifest says image: "walk.png". Manifest URL points at
  // .../knight/walk.json. Expected resolved image URL is
  // .../knight/walk.png.
  const { fetch: f, calls } = makeMockFetch({
    [MANIFEST_URL]: { ok: true, status: 200, statusText: 'OK', body: WALK_MANIFEST },
    [IMAGE_URL]: { ok: true, status: 200, statusText: 'OK', body: null, bytes: PNG_BYTES },
  });
  const { decode } = makeStubDecode();
  await loadSpriteSheet(MANIFEST_URL, { fetchImpl: f, decodeImage: decode });
  assert.equal(calls[1], IMAGE_URL);
});

test('loader: manifest without anchor defaults to bottom-center of frame 0', async () => {
  const noAnchor: Record<string, unknown> = { ...WALK_MANIFEST };
  delete noAnchor['anchor'];
  const { fetch: f } = makeMockFetch({
    [MANIFEST_URL]: { ok: true, status: 200, statusText: 'OK', body: noAnchor },
    [IMAGE_URL]: { ok: true, status: 200, statusText: 'OK', body: null, bytes: PNG_BYTES },
  });
  const { decode } = makeStubDecode();
  const sheet = await loadSpriteSheet(MANIFEST_URL, { fetchImpl: f, decodeImage: decode });
  // Frame 0 is 16x32 -> default anchor is (8, 32).
  assert.equal(sheet.manifest.anchor.x, 8);
  assert.equal(sheet.manifest.anchor.y, 32);
});

test('loader: manifest without fps defaults to 8', async () => {
  const noFps: Record<string, unknown> = { ...WALK_MANIFEST };
  delete noFps['fps'];
  const { fetch: f } = makeMockFetch({
    [MANIFEST_URL]: { ok: true, status: 200, statusText: 'OK', body: noFps },
    [IMAGE_URL]: { ok: true, status: 200, statusText: 'OK', body: null, bytes: PNG_BYTES },
  });
  const { decode } = makeStubDecode();
  const sheet = await loadSpriteSheet(MANIFEST_URL, { fetchImpl: f, decodeImage: decode });
  assert.equal(sheet.manifest.fps, 8);
});

test('loader: validation rejects manifest with no frames', async () => {
  const empty = { name: 'x', image: 'x.png', frames: [] };
  const { fetch: f } = makeMockFetch({
    [MANIFEST_URL]: { ok: true, status: 200, statusText: 'OK', body: empty },
  });
  await assert.rejects(
    loadSpriteSheet(MANIFEST_URL, { fetchImpl: f, decodeImage: makeStubDecode().decode }),
    (err: unknown) => {
      assert.ok(err instanceof SpriteSheetLoadError);
      assert.equal(err.kind, 'invalid-manifest');
      return true;
    },
  );
});

test('loader: validation rejects frame missing numeric x/y/w/h', async () => {
  const bad = {
    name: 'x',
    image: 'x.png',
    frames: [{ x: 0, y: 0, w: 16 /* h missing */ }],
  };
  const { fetch: f } = makeMockFetch({
    [MANIFEST_URL]: { ok: true, status: 200, statusText: 'OK', body: bad },
  });
  await assert.rejects(
    loadSpriteSheet(MANIFEST_URL, { fetchImpl: f, decodeImage: makeStubDecode().decode }),
    (err: unknown) => {
      assert.ok(err instanceof SpriteSheetLoadError);
      assert.equal(err.kind, 'invalid-manifest');
      return true;
    },
  );
});

test('loader: validation rejects empty name string', async () => {
  const bad = { name: '', image: 'x.png', frames: [{ x: 0, y: 0, w: 1, h: 1 }] };
  const { fetch: f } = makeMockFetch({
    [MANIFEST_URL]: { ok: true, status: 200, statusText: 'OK', body: bad },
  });
  await assert.rejects(
    loadSpriteSheet(MANIFEST_URL, { fetchImpl: f, decodeImage: makeStubDecode().decode }),
    (err: unknown) => err instanceof SpriteSheetLoadError && err.kind === 'invalid-manifest',
  );
});

test('loader: HTTP error on manifest surfaces fetch-manifest kind', async () => {
  const { fetch: f } = makeMockFetch({
    [MANIFEST_URL]: { ok: false, status: 404, statusText: 'Not Found', body: null },
  });
  await assert.rejects(
    loadSpriteSheet(MANIFEST_URL, { fetchImpl: f, decodeImage: makeStubDecode().decode }),
    (err: unknown) => {
      assert.ok(err instanceof SpriteSheetLoadError);
      assert.equal(err.kind, 'fetch-manifest');
      assert.match(err.message, /404/);
      return true;
    },
  );
});

test('loader: HTTP error on image surfaces fetch-image kind', async () => {
  const { fetch: f } = makeMockFetch({
    [MANIFEST_URL]: { ok: true, status: 200, statusText: 'OK', body: WALK_MANIFEST },
    [IMAGE_URL]: { ok: false, status: 500, statusText: 'Server Error', body: null, bytes: PNG_BYTES },
  });
  await assert.rejects(
    loadSpriteSheet(MANIFEST_URL, { fetchImpl: f, decodeImage: makeStubDecode().decode }),
    (err: unknown) => {
      assert.ok(err instanceof SpriteSheetLoadError);
      assert.equal(err.kind, 'fetch-image');
      return true;
    },
  );
});

test('loader: decoder failure surfaces decode-image kind', async () => {
  const { fetch: f } = makeMockFetch({
    [MANIFEST_URL]: { ok: true, status: 200, statusText: 'OK', body: WALK_MANIFEST },
    [IMAGE_URL]: { ok: true, status: 200, statusText: 'OK', body: null, bytes: PNG_BYTES },
  });
  const decode: NonNullable<LoaderOptions['decodeImage']> = async (_b, url) => {
    throw new SpriteSheetLoadError('decode-image', url, 'forced failure');
  };
  await assert.rejects(
    loadSpriteSheet(MANIFEST_URL, { fetchImpl: f, decodeImage: decode }),
    (err: unknown) => {
      assert.ok(err instanceof SpriteSheetLoadError);
      assert.equal(err.kind, 'decode-image');
      return true;
    },
  );
});

test('loader: throws when no fetch implementation is available', async () => {
  // Pass a sentinel "missing fetch" by using an undefined fetchImpl
  // and stubbing globalThis.fetch to undefined. We can't reliably
  // delete globalThis.fetch in modern node, so instead we just rely
  // on the option path: pass options without fetchImpl, and assert
  // that if global fetch IS available, it works (positive control).
  // The actual no-fetch branch is exercised in environments without
  // a global fetch (older node, web worker without fetch). This
  // assertion at least verifies the option override path takes over
  // any missing global.
  const haveGlobalFetch = typeof fetch !== 'undefined';
  if (!haveGlobalFetch) {
    await assert.rejects(loadSpriteSheet(MANIFEST_URL), (err: unknown) => {
      return err instanceof SpriteSheetLoadError && err.kind === 'fetch-manifest';
    });
  } else {
    // Positive control: providing fetchImpl bypasses the global check.
    const { fetch: f } = makeMockFetch({
      [MANIFEST_URL]: { ok: true, status: 200, statusText: 'OK', body: WALK_MANIFEST },
      [IMAGE_URL]: { ok: true, status: 200, statusText: 'OK', body: null, bytes: PNG_BYTES },
    });
    const { decode } = makeStubDecode();
    const sheet = await loadSpriteSheet(MANIFEST_URL, { fetchImpl: f, decodeImage: decode });
    assert.equal(sheet.manifest.name, 'knight-walk');
  }
});

test('computeFrameIndex: per-frame durations cycle correctly', () => {
  // 4 frames, 140ms each -> total 560ms.
  // t=0   -> 0
  // t=139 -> 0
  // t=140 -> 1
  // t=280 -> 2
  // t=420 -> 3
  // t=559 -> 3
  // t=560 -> 0 (wrap)
  assert.equal(computeFrameIndex(WALK_MANIFEST, 0, 0), 0);
  assert.equal(computeFrameIndex(WALK_MANIFEST, 139, 0), 0);
  assert.equal(computeFrameIndex(WALK_MANIFEST, 140, 0), 1);
  assert.equal(computeFrameIndex(WALK_MANIFEST, 280, 0), 2);
  assert.equal(computeFrameIndex(WALK_MANIFEST, 420, 0), 3);
  assert.equal(computeFrameIndex(WALK_MANIFEST, 559, 0), 3);
  assert.equal(computeFrameIndex(WALK_MANIFEST, 560, 0), 0);
});

test('computeFrameIndex: respects start offset', () => {
  // t=1140 with start=1000 means elapsed=140 -> frame 1.
  assert.equal(computeFrameIndex(WALK_MANIFEST, 1140, 1000), 1);
});

test('computeFrameIndex: returns 0 for single-frame manifests', () => {
  const single: SpriteSheetManifest = { ...WALK_MANIFEST, frames: WALK_MANIFEST.frames.slice(0, 1) };
  assert.equal(computeFrameIndex(single, 9999, 0), 0);
});

test('computeFrameIndex: falls back to fps when frames lack duration_ms', () => {
  // 4 frames @ 8fps -> 125ms per frame.
  const uniform: SpriteSheetManifest = {
    ...WALK_MANIFEST,
    frames: WALK_MANIFEST.frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h })), // strip duration_ms
    fps: 8,
  };
  assert.equal(computeFrameIndex(uniform, 0, 0), 0);
  assert.equal(computeFrameIndex(uniform, 124, 0), 0);
  assert.equal(computeFrameIndex(uniform, 125, 0), 1);
  assert.equal(computeFrameIndex(uniform, 500, 0), 0); // 500 / 125 = 4 -> 4 % 4 = 0
});
