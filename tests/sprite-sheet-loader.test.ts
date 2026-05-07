// Sprite-sheet loader smoke test.
//
// Exercises the manifest validator, the URL resolver behavior, and
// computeFrameIndex pure logic. The loadSpriteSheet path uses
// injected fetch + decode hooks so the test runs headless.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  loadSpriteSheet,
  computeFrameIndex,
  SpriteSheetLoadError,
  type SpriteSheetManifest,
  type LoaderOptions,
} from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const KNIGHT_MANIFEST = resolve(REPO_ROOT, 'assets/knight/walk.json');
const KNIGHT_MANIFEST_URL = pathToFileURL(KNIGHT_MANIFEST).toString();

// Inject a fetch impl that reads from disk - the manifest is real,
// the PNG decode is stubbed since Node has no <img>.
function fakeFetchFromDisk(): LoaderOptions['fetchImpl'] {
  return async (input: string | URL | Request): Promise<Response> => {
    const u = typeof input === 'string' ? input : input.toString();
    const path = fileURLToPath(u);
    const buf = await readFile(path);
    return new Response(buf, { status: 200, statusText: 'OK' });
  };
}

function fakeDecode(): LoaderOptions['decodeImage'] {
  return async (bytes: ArrayBuffer, _url: string) => {
    // Return an opaque shape - the loader does not inspect it.
    return { byteLength: bytes.byteLength, fake: true } as unknown as HTMLImageElement;
  };
}

test('loader: validates and parses the bundled knight manifest', async () => {
  const sheet = await loadSpriteSheet(KNIGHT_MANIFEST_URL, {
    fetchImpl: fakeFetchFromDisk(),
    decodeImage: fakeDecode(),
  });
  assert.equal(sheet.manifest.name, 'knight-walk');
  assert.equal(sheet.manifest.image, 'walk.png');
  assert.ok(sheet.manifest.frames.length >= 2, 'manifest declares multiple frames');
  for (const f of sheet.manifest.frames) {
    assert.ok(f.w > 0 && f.h > 0, 'frame dimensions positive');
    assert.ok(typeof f.x === 'number' && typeof f.y === 'number');
  }
  assert.ok(sheet.manifest.fps > 0);
  assert.ok(sheet.manifest.anchor.x >= 0 && sheet.manifest.anchor.y >= 0);
  // atlas shape lines up with IGraphicsDevice.registerAtlas
  assert.equal(sheet.atlas.frames.length, sheet.manifest.frames.length);
  assert.ok(sheet.atlas.image);
});

test('loader: rejects non-object manifest', async () => {
  const fetchImpl: LoaderOptions['fetchImpl'] = async () =>
    new Response('"hello"', { status: 200, statusText: 'OK' });
  await assert.rejects(
    () => loadSpriteSheet('file:///fake.json', { fetchImpl, decodeImage: fakeDecode() }),
    (err: unknown) => err instanceof SpriteSheetLoadError && err.kind === 'invalid-manifest',
  );
});

test('loader: rejects manifest without frames array', async () => {
  const fetchImpl: LoaderOptions['fetchImpl'] = async () =>
    new Response(JSON.stringify({ name: 'x', image: 'x.png', frames: [] }), {
      status: 200,
      statusText: 'OK',
    });
  await assert.rejects(
    () => loadSpriteSheet('file:///fake.json', { fetchImpl, decodeImage: fakeDecode() }),
    (err: unknown) => err instanceof SpriteSheetLoadError && err.kind === 'invalid-manifest',
  );
});

test('loader: surfaces HTTP failure as fetch-manifest error', async () => {
  const fetchImpl: LoaderOptions['fetchImpl'] = async () =>
    new Response('not found', { status: 404, statusText: 'Not Found' });
  await assert.rejects(
    () => loadSpriteSheet('file:///fake.json', { fetchImpl, decodeImage: fakeDecode() }),
    (err: unknown) => err instanceof SpriteSheetLoadError && err.kind === 'fetch-manifest',
  );
});

test('loader: rejects frame with non-numeric coords', async () => {
  const bad = { name: 'x', image: 'x.png', frames: [{ x: 'a', y: 0, w: 10, h: 10 }] };
  const fetchImpl: LoaderOptions['fetchImpl'] = async () =>
    new Response(JSON.stringify(bad), { status: 200, statusText: 'OK' });
  await assert.rejects(
    () => loadSpriteSheet('file:///fake.json', { fetchImpl, decodeImage: fakeDecode() }),
    (err: unknown) => err instanceof SpriteSheetLoadError && err.kind === 'invalid-manifest',
  );
});

test('computeFrameIndex: uniform fps wraps around', () => {
  const m: SpriteSheetManifest = {
    name: 'x',
    image: 'x.png',
    frames: [
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0, y: 0, w: 1, h: 1 },
    ],
    anchor: { x: 0, y: 0 },
    fps: 10,  // 100ms per frame
  };
  // start at 0; at 50ms we're in frame 0; at 150ms frame 1; at 410ms wraps to frame 0
  assert.equal(computeFrameIndex(m, 50, 0), 0);
  assert.equal(computeFrameIndex(m, 150, 0), 1);
  assert.equal(computeFrameIndex(m, 250, 0), 2);
  assert.equal(computeFrameIndex(m, 350, 0), 3);
  assert.equal(computeFrameIndex(m, 410, 0), 0);  // wrapped
});

test('computeFrameIndex: per-frame duration_ms takes precedence over fps', () => {
  const m: SpriteSheetManifest = {
    name: 'x',
    image: 'x.png',
    frames: [
      { x: 0, y: 0, w: 1, h: 1, duration_ms: 100 },
      { x: 0, y: 0, w: 1, h: 1, duration_ms: 500 },
      { x: 0, y: 0, w: 1, h: 1, duration_ms: 100 },
    ],
    anchor: { x: 0, y: 0 },
    fps: 1000,  // ignored when all frames have duration_ms
  };
  assert.equal(computeFrameIndex(m, 50, 0), 0);
  assert.equal(computeFrameIndex(m, 150, 0), 1);   // 100..600 is frame 1
  assert.equal(computeFrameIndex(m, 599, 0), 1);
  assert.equal(computeFrameIndex(m, 601, 0), 2);   // frame 2 starts at 600
  // Total cycle is 700ms. After 700ms wrap to frame 0.
  assert.equal(computeFrameIndex(m, 750, 0), 0);
});

test('computeFrameIndex: single-frame manifests pin to frame 0', () => {
  const m: SpriteSheetManifest = {
    name: 'x',
    image: 'x.png',
    frames: [{ x: 0, y: 0, w: 1, h: 1 }],
    anchor: { x: 0, y: 0 },
    fps: 60,
  };
  assert.equal(computeFrameIndex(m, 1000, 0), 0);
  assert.equal(computeFrameIndex(m, 999999, 0), 0);
});

test('computeFrameIndex: clamps negative elapsed to 0', () => {
  const m: SpriteSheetManifest = {
    name: 'x',
    image: 'x.png',
    frames: [
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0, y: 0, w: 1, h: 1 },
    ],
    anchor: { x: 0, y: 0 },
    fps: 10,
  };
  assert.equal(computeFrameIndex(m, 0, 100), 0);
  assert.equal(computeFrameIndex(m, 50, 100), 0);
});
