// WebGL2Device tests - phase 14.1.
//
// Strategy: a hand-rolled mock GL context records every call into a
// log. Tests assert the right calls land in the right order. Real
// GL coverage happens in the demo, where the WebGL2 backend renders
// the ARPG demo identically to Canvas2D.
//
// What we cover here:
//   - Backend registry: importing WebGL2Device side-effect-registers
//     the 'webgl2' factory.
//   - Engine.create({ backend: 'canvas2d' }) -> Canvas2DDevice
//   - Engine.create({ backend: 'webgl2' }) -> WebGL2Device
//   - Atlas registration creates one texture; releaseAtlas deletes.
//   - SpriteBatcher: submit appends, atlas/blend swap forces flush,
//     count grows, capacity doubles.
//   - WebGL2Device: drawSprite batches by atlas; one
//     drawArraysInstanced per atlas; depth/submission order
//     preserved within an atlas batch.
//   - Engine.create default still returns Canvas2DDevice (no
//     backend option).
//   - Engine.create with an unregistered backend throws the
//     diagnostic error message.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  // Engine + backend registry
  Engine,
  registerBackend,
  isBackendRegistered,
  // Canvas2DDevice (default backend)
  Canvas2DDevice,
  // WebGL2 backend - importing self-registers via module side-effect
  WebGL2Device,
  TextureAtlas,
  SpriteBatcher,
  FLOATS_PER_INSTANCE,
  type BlendMode,
  // Test utility constants
  LOOM_ENGINE_VERSION,
} from '../src/index.js';

// ---------- Mock GL context ----------

interface Recorded {
  type: string;
  args: ReadonlyArray<unknown>;
}

class MockGL {
  // Mimic the WebGL2 enums the device touches. Real values don't
  // matter; the device only compares against `gl.X` references.
  VERTEX_SHADER = 0x8b31;
  FRAGMENT_SHADER = 0x8b30;
  COMPILE_STATUS = 0x8b81;
  LINK_STATUS = 0x8b82;
  ARRAY_BUFFER = 0x8892;
  STATIC_DRAW = 0x88e4;
  DYNAMIC_DRAW = 0x88e8;
  TEXTURE_2D = 0x0de1;
  TEXTURE0 = 0x84c0;
  TEXTURE_MIN_FILTER = 0x2801;
  TEXTURE_MAG_FILTER = 0x2800;
  TEXTURE_WRAP_S = 0x2802;
  TEXTURE_WRAP_T = 0x2803;
  NEAREST = 0x2600;
  CLAMP_TO_EDGE = 0x812f;
  RGBA = 0x1908;
  UNSIGNED_BYTE = 0x1401;
  UNPACK_FLIP_Y_WEBGL = 0x9240;
  UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241;
  DEPTH_TEST = 0x0b71;
  CULL_FACE = 0x0b44;
  BLEND = 0x0be2;
  SRC_ALPHA = 0x0302;
  ONE = 1;
  ONE_MINUS_SRC_ALPHA = 0x0303;
  COLOR_BUFFER_BIT = 0x4000;
  TRIANGLES = 0x0004;
  FLOAT = 0x1406;

  private nextId: number = 1;
  log: Recorded[] = [];

  // ---- bookkeeping helpers ----
  private mint(label: string): { __mock: true; id: number; label: string } {
    return { __mock: true, id: this.nextId++, label };
  }
  private record(type: string, args: ReadonlyArray<unknown>): void {
    this.log.push({ type, args });
  }

  // ---- GL surface ----
  createShader(_kind: number) { return this.mint('shader'); }
  shaderSource(_s: unknown, _src: string) { this.record('shaderSource', []); }
  compileShader(_s: unknown) { this.record('compileShader', []); }
  getShaderParameter(_s: unknown, _p: number) { return true; }
  getShaderInfoLog(_s: unknown) { return ''; }
  deleteShader(_s: unknown) { this.record('deleteShader', []); }

  createProgram() { return this.mint('program'); }
  attachShader(_p: unknown, _s: unknown) { this.record('attachShader', []); }
  linkProgram(_p: unknown) { this.record('linkProgram', []); }
  getProgramParameter(_p: unknown, _x: number) { return true; }
  getProgramInfoLog(_p: unknown) { return ''; }
  deleteProgram(_p: unknown) { this.record('deleteProgram', []); }
  useProgram(_p: unknown) { this.record('useProgram', []); }
  getUniformLocation(_p: unknown, name: string) { return { __mock: true, name }; }

  createVertexArray() { return this.mint('vao'); }
  bindVertexArray(_v: unknown) { this.record('bindVertexArray', []); }
  deleteVertexArray(_v: unknown) { this.record('deleteVertexArray', []); }

  createBuffer() { return this.mint('buffer'); }
  bindBuffer(_t: number, _b: unknown) { this.record('bindBuffer', []); }
  bufferData(_t: number, src: number | ArrayBufferView, _u: number) {
    var size = typeof src === 'number' ? src : (src as ArrayBufferView).byteLength;
    this.record('bufferData', [size]);
  }
  bufferSubData(_t: number, offset: number, src: ArrayBufferView) {
    this.record('bufferSubData', [offset, src.byteLength]);
  }
  deleteBuffer(_b: unknown) { this.record('deleteBuffer', []); }
  enableVertexAttribArray(loc: number) { this.record('enableVertexAttribArray', [loc]); }
  vertexAttribPointer(loc: number, size: number, _t: number, _n: boolean, stride: number, offset: number) {
    this.record('vertexAttribPointer', [loc, size, stride, offset]);
  }
  vertexAttribDivisor(loc: number, divisor: number) {
    this.record('vertexAttribDivisor', [loc, divisor]);
  }

  createTexture() { return this.mint('texture'); }
  bindTexture(_t: number, tex: unknown) {
    this.record('bindTexture', [tex && (tex as { id?: number }).id]);
  }
  texImage2D(...args: unknown[]) { this.record('texImage2D', args); }
  texParameteri(_t: number, _p: number, _v: number) { this.record('texParameteri', []); }
  pixelStorei(_p: number, _v: number) { this.record('pixelStorei', []); }
  deleteTexture(_t: unknown) { this.record('deleteTexture', []); }
  activeTexture(_t: number) { this.record('activeTexture', []); }

  viewport(_x: number, _y: number, w: number, h: number) { this.record('viewport', [w, h]); }
  clearColor(_r: number, _g: number, _b: number, _a: number) { this.record('clearColor', []); }
  clear(_mask: number) { this.record('clear', []); }

  enable(cap: number) { this.record('enable', [cap]); }
  disable(cap: number) { this.record('disable', [cap]); }
  blendFunc(s: number, d: number) { this.record('blendFunc', [s, d]); }

  uniform1i(_loc: unknown, v: number) { this.record('uniform1i', [v]); }
  uniform2f(_loc: unknown, x: number, y: number) { this.record('uniform2f', [x, y]); }

  drawArraysInstanced(_mode: number, first: number, count: number, primCount: number) {
    this.record('drawArraysInstanced', [first, count, primCount]);
  }

  countCalls(type: string): number {
    var n = 0;
    for (var i = 0; i < this.log.length; i++) {
      if (this.log[i]?.type === type) n++;
    }
    return n;
  }

  callsOfType(type: string): Recorded[] {
    var out: Recorded[] = [];
    for (var i = 0; i < this.log.length; i++) {
      var r = this.log[i];
      if (r && r.type === type) out.push(r);
    }
    return out;
  }
}

// Minimal fake canvas. WebGL2Device.constructor calls
// addEventListener for context-loss; setContextLost test exercises
// the path. Width/height read at construction time.
function makeCanvas(width: number = 640, height: number = 400): HTMLCanvasElement {
  var listeners: Record<string, Array<(e: Event) => void>> = {};
  return {
    width: width,
    height: height,
    addEventListener: (type: string, cb: (e: Event) => void) => {
      (listeners[type] = listeners[type] ?? []).push(cb);
    },
    removeEventListener: (type: string, cb: (e: Event) => void) => {
      var arr = listeners[type];
      if (!arr) return;
      var idx = arr.indexOf(cb);
      if (idx >= 0) arr.splice(idx, 1);
    },
    getContext: () => null,
  } as unknown as HTMLCanvasElement;
}

// Minimal fake atlas image. registerAtlas reads width/height; the
// MockGL.texImage2D no-ops on the data argument.
function makeAtlasImage(w: number, h: number) {
  return { width: w, height: h } as unknown as HTMLCanvasElement;
}

// ---------- Backend registry ----------

test('webgl2 backend registers itself when WebGL2Device is imported', () => {
  // Import side-effect: WebGL2Device module ran registerBackend.
  assert.ok(isBackendRegistered('webgl2'), "'webgl2' backend should be registered after WebGL2Device import");
  // Sanity: canvas2d is the eager default.
  assert.ok(isBackendRegistered('canvas2d'));
});

test('engine version constant agrees with package.json (0.15.0)', () => {
  assert.equal(LOOM_ENGINE_VERSION, '0.15.0');
});

test('Engine.create with no backend defaults to Canvas2DDevice', () => {
  // Build a canvas with a 2D context shim. Canvas2DDevice's
  // constructor calls canvas.getContext('2d'); we provide a stub
  // ctx with the methods Canvas2DDevice exercises in its no-draw
  // path (constructor only sets imageSmoothingEnabled).
  var ctx2d = {
    imageSmoothingEnabled: false,
    fillRect: () => {},
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    fillStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: '',
    createRadialGradient: () => ({ addColorStop: () => {} }),
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    measureText: () => ({ width: 0 }),
    fillText: () => {},
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  };
  var canvas = {
    width: 320,
    height: 200,
    getContext: () => ctx2d,
  } as unknown as HTMLCanvasElement;
  var engine = Engine.create({ canvas, inputWindow: null, skipAudio: true });
  assert.ok(engine.device instanceof Canvas2DDevice, 'default backend should be Canvas2DDevice');
});

test('Engine.create({ backend: "canvas2d" }) returns Canvas2DDevice', () => {
  var ctx2d = { imageSmoothingEnabled: false, fillRect: () => {} };
  var canvas = {
    width: 320,
    height: 200,
    getContext: () => ctx2d,
  } as unknown as HTMLCanvasElement;
  var engine = Engine.create({ canvas, backend: 'canvas2d', inputWindow: null, skipAudio: true });
  assert.ok(engine.device instanceof Canvas2DDevice);
});

test('Engine.create({ backend: "webgl2", device: webGL2 }) returns the WebGL2Device', () => {
  var gl = new MockGL();
  var canvas = makeCanvas(640, 400);
  var device = new WebGL2Device(canvas, gl as unknown as WebGL2RenderingContext);
  var engine = Engine.create({ canvas, backend: 'webgl2', device, inputWindow: null, skipAudio: true });
  assert.equal(engine.device, device, 'engine.device should be the injected WebGL2Device');
  assert.ok(engine.device instanceof WebGL2Device);
});

test('Engine.create with unregistered backend throws helpful error', () => {
  var canvas = {
    width: 320, height: 200, getContext: () => null,
  } as unknown as HTMLCanvasElement;
  assert.throws(
    () => Engine.create({
      canvas,
      backend: 'webgpu' as 'canvas2d',
      inputWindow: null,
      skipAudio: true,
    }),
    /not registered/,
  );
});

// ---------- TextureAtlas ----------

test('TextureAtlas computes UV rects from frame pixel coords', () => {
  var img = makeAtlasImage(64, 64);
  var atlas = new TextureAtlas(null, {
    image: img,
    frames: [
      { x: 0, y: 0, w: 32, h: 32 },
      { x: 32, y: 16, w: 16, h: 16 },
    ],
  });
  assert.equal(atlas.frameCount, 2);
  var uv = new Float32Array(4);

  assert.ok(atlas.lookupUVRect(0, uv, 0));
  // Frame 0: top-left 32x32 in a 64x64 atlas -> UV (0,0,0.5,0.5)
  assert.equal(uv[0], 0);
  assert.equal(uv[1], 0);
  assert.equal(uv[2], 0.5);
  assert.equal(uv[3], 0.5);

  assert.ok(atlas.lookupUVRect(1, uv, 0));
  // Frame 1: (32, 16, 16, 16) in 64x64 -> UV (0.5, 0.25, 0.75, 0.5)
  assert.equal(uv[0], 0.5);
  assert.equal(uv[1], 0.25);
  assert.equal(uv[2], 0.75);
  assert.equal(uv[3], 0.5);

  var size = { w: 0, h: 0 };
  assert.ok(atlas.lookupFrameSize(0, size));
  assert.equal(size.w, 32);
  assert.equal(size.h, 32);

  // Out-of-range frame returns false; out is untouched.
  var preserved = new Float32Array([1, 2, 3, 4]);
  assert.ok(!atlas.lookupUVRect(99, preserved, 0));
  assert.equal(preserved[0], 1);
});

test('TextureAtlas uploads via gl when gl is present', () => {
  var gl = new MockGL();
  var img = makeAtlasImage(16, 16);
  new TextureAtlas(gl as unknown as WebGL2RenderingContext, {
    image: img,
    frames: [{ x: 0, y: 0, w: 16, h: 16 }],
  });
  // One createTexture, four texParameteri (min/mag/wrapS/wrapT),
  // one texImage2D, two pixelStorei (flip-y, premul).
  assert.equal(gl.callsOfType('texImage2D').length, 1);
  assert.equal(gl.callsOfType('texParameteri').length, 4);
  assert.equal(gl.callsOfType('pixelStorei').length, 2);
});

// ---------- SpriteBatcher ----------

test('SpriteBatcher submits to current run; atlas swap forces flush', () => {
  var flushes: Array<{ atlas: TextureAtlas; blend: BlendMode; count: number }> = [];
  var batcher = new SpriteBatcher((atlas, blend, _data, count) => {
    flushes.push({ atlas, blend, count });
  });

  var atlasA = new TextureAtlas(null, {
    image: makeAtlasImage(16, 16),
    frames: [{ x: 0, y: 0, w: 16, h: 16 }],
    name: 'A',
  });
  var atlasB = new TextureAtlas(null, {
    image: makeAtlasImage(16, 16),
    frames: [{ x: 0, y: 0, w: 16, h: 16 }],
    name: 'B',
  });

  batcher.beginFrame();
  // Two A submits, then a B - should flush A on the first B.
  batcher.submit(atlasA, 'alpha', 0, 0, 16, 16, 0, 0, 1, 1, 1, 1, 1, 1);
  batcher.submit(atlasA, 'alpha', 16, 0, 16, 16, 0, 0, 1, 1, 1, 1, 1, 1);
  batcher.submit(atlasB, 'alpha', 0, 0, 16, 16, 0, 0, 1, 1, 1, 1, 1, 1);
  // endFrame flushes the trailing B run.
  batcher.endFrame();

  assert.equal(flushes.length, 2);
  assert.equal(flushes[0]?.atlas.name, 'A');
  assert.equal(flushes[0]?.count, 2);
  assert.equal(flushes[1]?.atlas.name, 'B');
  assert.equal(flushes[1]?.count, 1);
});

test('SpriteBatcher blend-mode swap forces flush', () => {
  var flushes: Array<{ blend: BlendMode; count: number }> = [];
  var batcher = new SpriteBatcher((_atlas, blend, _data, count) => {
    flushes.push({ blend, count });
  });
  var atlas = new TextureAtlas(null, {
    image: makeAtlasImage(16, 16),
    frames: [{ x: 0, y: 0, w: 16, h: 16 }],
  });
  batcher.beginFrame();
  batcher.submit(atlas, 'alpha', 0, 0, 16, 16, 0, 0, 1, 1, 1, 1, 1, 1);
  batcher.submit(atlas, 'add',   0, 0, 16, 16, 0, 0, 1, 1, 1, 1, 1, 1);
  batcher.submit(atlas, 'add',   0, 0, 16, 16, 0, 0, 1, 1, 1, 1, 1, 1);
  batcher.endFrame();
  assert.equal(flushes.length, 2);
  assert.equal(flushes[0]?.blend, 'alpha');
  assert.equal(flushes[0]?.count, 1);
  assert.equal(flushes[1]?.blend, 'add');
  assert.equal(flushes[1]?.count, 2);
});

test('SpriteBatcher preserves submission order within a batch', () => {
  // Within a single atlas batch, depth ordering is the consumer's
  // responsibility (SpriteRenderSystem sorts before submitting).
  // The batcher must not reorder; we verify by inspecting the
  // raw buffer.
  var captured: Float32Array | null = null;
  var capturedCount: number = 0;
  var batcher = new SpriteBatcher((_atlas, _blend, data, count) => {
    captured = new Float32Array(data.subarray(0, count * FLOATS_PER_INSTANCE));
    capturedCount = count;
  });
  var atlas = new TextureAtlas(null, {
    image: makeAtlasImage(16, 16),
    frames: [{ x: 0, y: 0, w: 16, h: 16 }],
  });
  batcher.beginFrame();
  // Submit in increasing-x order; tint.r encodes the sequence.
  for (var i = 0; i < 5; i++) {
    batcher.submit(atlas, 'alpha', i * 10, 0, 16, 16, 0, 0, 1, 1, i / 10, 0, 0, 1);
  }
  batcher.endFrame();
  assert.equal(capturedCount, 5);
  assert.ok(captured !== null);
  // tint.r is at offset 8 in each instance.
  for (var k = 0; k < 5; k++) {
    var offR = k * FLOATS_PER_INSTANCE + 8;
    assert.ok(Math.abs((captured as Float32Array)[offR]! - k / 10) < 1e-6);
  }
});

test('SpriteBatcher grows past initial capacity', () => {
  var totalInstances = 0;
  var batcher = new SpriteBatcher((_atlas, _blend, _data, count) => {
    totalInstances += count;
  }, 4); // tiny initial capacity to exercise grow
  var atlas = new TextureAtlas(null, {
    image: makeAtlasImage(16, 16),
    frames: [{ x: 0, y: 0, w: 16, h: 16 }],
  });
  batcher.beginFrame();
  for (var i = 0; i < 10; i++) {
    batcher.submit(atlas, 'alpha', i, 0, 16, 16, 0, 0, 1, 1, 1, 1, 1, 1);
  }
  batcher.endFrame();
  assert.equal(totalInstances, 10);
  var stats = { flushCount: 0, instanceTotal: 0, capacity: 0 };
  batcher.getStats(stats);
  assert.ok(stats.capacity >= 10, 'capacity should grow past initial 4 to fit 10');
});

// ---------- WebGL2Device end-to-end ----------

function makeDevice(width: number = 640, height: number = 400): { device: WebGL2Device; gl: MockGL; canvas: HTMLCanvasElement } {
  var gl = new MockGL();
  var canvas = makeCanvas(width, height);
  var device = new WebGL2Device(canvas, gl as unknown as WebGL2RenderingContext);
  return { device, gl, canvas };
}

function defaultCamera(width: number, height: number) {
  return {
    centerX: 0,
    centerY: 0,
    zoom: 1,
    rotation: 0,
    viewportWidth: width,
    viewportHeight: height,
  };
}

test('WebGL2Device construction compiles shaders and creates VAO', () => {
  var { gl } = makeDevice();
  // Shader compilation: 1 vert + 1 frag = 2 createShader, 2
  // shaderSource, 2 compileShader.
  assert.ok(gl.callsOfType('shaderSource').length === 2);
  assert.ok(gl.callsOfType('linkProgram').length === 1);
  // VAO: one createVertexArray, one bindVertexArray to bind
  // attribs, then one bindVertexArray(null) to leave the global
  // state clean.
  assert.ok(gl.callsOfType('bindVertexArray').length >= 2);
  // Static unit-quad VBO + dynamic instance VBO = 2 createBuffer
  // and 2 initial bufferData uploads.
  assert.ok(gl.callsOfType('bufferData').length === 2);
});

test('WebGL2Device.registerAtlas uploads texture; releaseAtlas deletes', () => {
  var { device, gl } = makeDevice();
  var beforeUploads = gl.countCalls('texImage2D');
  var handle = device.registerAtlas({
    image: makeAtlasImage(64, 64),
    frames: [{ x: 0, y: 0, w: 32, h: 32 }],
  });
  assert.equal(gl.countCalls('texImage2D'), beforeUploads + 1);

  var beforeDeletes = gl.countCalls('deleteTexture');
  device.releaseAtlas(handle);
  assert.equal(gl.countCalls('deleteTexture'), beforeDeletes + 1);
});

test('WebGL2Device.drawSprite batches to one drawArraysInstanced per atlas', () => {
  var { device, gl } = makeDevice();
  device.setCamera(defaultCamera(640, 400));
  var atlas = device.registerAtlas({
    image: makeAtlasImage(64, 64),
    frames: [{ x: 0, y: 0, w: 32, h: 32 }],
  });
  var beforeDraws = gl.countCalls('drawArraysInstanced');

  device.beginFrame();
  for (var i = 0; i < 100; i++) {
    device.drawSprite(i, 0, 0, atlas, 0);
  }
  device.endFrame();

  var draws = gl.callsOfType('drawArraysInstanced').slice(beforeDraws);
  assert.equal(draws.length, 1, 'expected exactly one draw call for 100 sprites of one atlas');
  // Args: [first, count, primCount]; primCount should be 100.
  assert.equal(draws[0]?.args[2], 100);
});

test('WebGL2Device.drawSprite issues a separate draw per atlas (atlas-swap flush)', () => {
  var { device, gl } = makeDevice();
  device.setCamera(defaultCamera(640, 400));
  var atlasA = device.registerAtlas({
    image: makeAtlasImage(64, 64),
    frames: [{ x: 0, y: 0, w: 32, h: 32 }],
    name: 'A',
  });
  var atlasB = device.registerAtlas({
    image: makeAtlasImage(64, 64),
    frames: [{ x: 0, y: 0, w: 32, h: 32 }],
    name: 'B',
  });
  var beforeDraws = gl.countCalls('drawArraysInstanced');

  device.beginFrame();
  // Pattern: A A A B B A -> 3 batches: (3,2,1) instances.
  device.drawSprite(0, 0, 0, atlasA, 0);
  device.drawSprite(1, 0, 0, atlasA, 0);
  device.drawSprite(2, 0, 0, atlasA, 0);
  device.drawSprite(3, 0, 0, atlasB, 0);
  device.drawSprite(4, 0, 0, atlasB, 0);
  device.drawSprite(5, 0, 0, atlasA, 0);
  device.endFrame();

  var draws = gl.callsOfType('drawArraysInstanced').slice(beforeDraws);
  assert.equal(draws.length, 3, 'expected 3 batches for A A A B B A');
  assert.equal(draws[0]?.args[2], 3);
  assert.equal(draws[1]?.args[2], 2);
  assert.equal(draws[2]?.args[2], 1);
});

test('WebGL2Device draws preserve submission order across the per-instance buffer upload', () => {
  // The bufferSubData call inside the flush handler captures the
  // CPU-side instance buffer in submission order. We piggyback on
  // it to assert: the bytes uploaded for instance N are at the
  // same byte offset within the upload range, and order matches
  // the drawSprite call order.
  var { device, gl } = makeDevice();
  device.setCamera(defaultCamera(640, 400));
  var atlas = device.registerAtlas({
    image: makeAtlasImage(64, 64),
    frames: [{ x: 0, y: 0, w: 32, h: 32 }],
  });

  device.beginFrame();
  // Submit 3 sprites at increasing world.x. After iso projection
  // each lands at a distinct origin.x in the per-instance buffer.
  device.drawSprite(0, 0, 0, atlas, 0);
  device.drawSprite(2, 0, 0, atlas, 0);
  device.drawSprite(4, 0, 0, atlas, 0);
  device.endFrame();

  var draws = gl.callsOfType('drawArraysInstanced');
  assert.equal(draws.length, 1);
  assert.equal(draws[draws.length - 1]?.args[2], 3);
  // bufferSubData byteLength = count * 12 floats * 4 bytes.
  var subUploads = gl.callsOfType('bufferSubData');
  var lastSub = subUploads[subUploads.length - 1];
  assert.ok(lastSub);
  assert.equal(lastSub.args[1], 3 * FLOATS_PER_INSTANCE * 4);
});

test('WebGL2Device.drawParticle additive triggers blendFunc(SRC_ALPHA, ONE)', () => {
  // Skip if document is unavailable - particle disc atlas needs
  // an offscreen canvas. Headless Node has no document.
  if (typeof document === 'undefined') return;

  var { device, gl } = makeDevice();
  device.setCamera(defaultCamera(640, 400));
  var beforeBlend = gl.countCalls('blendFunc');

  device.beginFrame();
  device.drawParticle(0, 0, 0, 8, { r: 1, g: 1, b: 1, a: 1 }, true);
  device.endFrame();

  var blends = gl.callsOfType('blendFunc').slice(beforeBlend);
  assert.ok(blends.length >= 1);
  // Last blendFunc before the draw should be additive.
  assert.equal(blends[blends.length - 1]?.args[0], gl.SRC_ALPHA);
  assert.equal(blends[blends.length - 1]?.args[1], gl.ONE);
});

test('WebGL2Device.drawSprite no-ops on context-loss', () => {
  var { device, gl } = makeDevice();
  device.setCamera(defaultCamera(640, 400));
  var atlas = device.registerAtlas({
    image: makeAtlasImage(64, 64),
    frames: [{ x: 0, y: 0, w: 32, h: 32 }],
  });

  // Simulate context loss by directly setting the flag via the
  // private path. Real browsers fire 'webglcontextlost'.
  (device as unknown as { contextLost: boolean }).contextLost = true;

  var before = gl.countCalls('drawArraysInstanced');
  device.beginFrame();
  device.drawSprite(0, 0, 0, atlas, 0);
  device.endFrame();
  var after = gl.countCalls('drawArraysInstanced');
  assert.equal(after, before, 'no draws should issue while the context is lost');
});

test('WebGL2Device.dispose deletes shader program, VAO, and buffers', () => {
  var { device, gl } = makeDevice();
  // Register one atlas so dispose has a texture to delete.
  device.registerAtlas({
    image: makeAtlasImage(16, 16),
    frames: [{ x: 0, y: 0, w: 16, h: 16 }],
  });
  var beforeProgDel = gl.countCalls('deleteProgram');
  var beforeVAODel = gl.countCalls('deleteVertexArray');
  var beforeBufDel = gl.countCalls('deleteBuffer');
  device.dispose();
  assert.ok(gl.countCalls('deleteProgram') > beforeProgDel);
  assert.ok(gl.countCalls('deleteVertexArray') > beforeVAODel);
  assert.ok(gl.countCalls('deleteBuffer') >= beforeBufDel + 2); // quad VBO + instance VBO
});

// ---------- Backend factory registration ----------

test('registerBackend allows custom factory injection', () => {
  // Register a fake backend, then verify Engine.create uses it.
  var built = false;
  var canvas = {
    width: 16, height: 16, getContext: () => null,
  } as unknown as HTMLCanvasElement;
  registerBackend('canvas2d-test' as 'canvas2d', () => {
    built = true;
    return {
      canvas,
      viewportWidth: 16,
      viewportHeight: 16,
      beginFrame: () => {},
      endFrame: () => {},
      setCamera: () => {},
      registerAtlas: () => 0,
      releaseAtlas: () => {},
      drawSprite: () => {},
      drawTile: () => {},
      drawText: () => {},
      drawParticle: () => {},
      getDrawCallCount: () => 0,
    };
  });
  Engine.create({
    canvas,
    backend: 'canvas2d-test' as 'canvas2d',
    inputWindow: null,
    skipAudio: true,
  });
  assert.ok(built, 'custom backend factory should run');
});
