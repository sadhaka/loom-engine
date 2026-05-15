// LoomFSR - Trinity §27 temporal upscaler tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  LoomFSR,
  FSR_FP_ONE,
  FSR_FP_HALF,
  FSR_CHANNEL_COLOR,
  FSR_CHANNEL_DEPTH,
  FSR_CHANNEL_NORMAL,
  TEX_FORMAT_RGBA16_FLOAT,
  TEX_FORMAT_R32_FLOAT,
  TEX_FORMAT_RG16_SNORM,
  TEX_USAGE_TEXTURE_BINDING,
  TEX_USAGE_STORAGE_BINDING,
  REACTIVE_BIT_REACTIVE,
  FSR_REASON_NONE,
  FSR_REASON_BAD_FORMAT,
  FSR_REASON_BAD_USAGE,
  FSR_REASON_BAD_ALIGNMENT,
} from '../src/runtime/loom-fsr.js';

function defaultConfig() {
  return {
    lowResWidth: 640,
    lowResHeight: 360,
    highResWidth: 1280,
    highResHeight: 720,
    jitterSamples: 16,
    historyDepthThresholdFp: Math.floor(0.1 * FSR_FP_ONE),
    historyNormalThresholdFp: Math.floor(0.5 * FSR_FP_ONE),
    sharpenStrengthFp: Math.floor(0.3 * FSR_FP_ONE),
  };
}

test('LoomFSR: constructor rejects invalid res / threshold / sharpen', () => {
  assert.throws(() => new LoomFSR({ ...defaultConfig(), lowResWidth: 0 }), RangeError);
  assert.throws(() => new LoomFSR({ ...defaultConfig(), highResWidth: 100 }), RangeError);    // < lowRes
  assert.throws(() => new LoomFSR({ ...defaultConfig(), jitterSamples: 0 }), RangeError);
  assert.throws(() => new LoomFSR({ ...defaultConfig(), sharpenStrengthFp: -1 }), RangeError);
  assert.throws(() => new LoomFSR({ ...defaultConfig(), historyNormalThresholdFp: 99999 }), RangeError);
});

test('LoomFSR: jitter table is Halton(2,3) over [-FP_HALF, +FP_HALF] (gate 2)', () => {
  const f = new LoomFSR(defaultConfig());
  const out = new Int32Array(2);
  for (let i = 0; i < 16; i++) {
    f.advanceJitter();
    f.getCurrentJitter(out);
    assert.ok((out[0] ?? 0) >= -FSR_FP_HALF && (out[0] ?? 0) <= FSR_FP_HALF);
    assert.ok((out[1] ?? 0) >= -FSR_FP_HALF && (out[1] ?? 0) <= FSR_FP_HALF);
  }
});

test('LoomFSR: advanceJitter wraps modulo jitterSamples', () => {
  const f = new LoomFSR({ ...defaultConfig(), jitterSamples: 4 });
  for (let i = 0; i < 4; i++) f.advanceJitter();
  assert.equal(f.getJitterIndex(), 0);
});

test('LoomFSR: computeHistoryCoord = current - motion - jitter (gate 2)', () => {
  const f = new LoomFSR(defaultConfig());
  // First, capture the jitter at the current index.
  const jitter = new Int32Array(2);
  f.getCurrentJitter(jitter);
  const out = new Int32Array(2);
  f.computeHistoryCoord(1000, 2000, 50, 60, out);
  assert.equal(out[0], 1000 - 50 - (jitter[0] ?? 0));
  assert.equal(out[1], 2000 - 60 - (jitter[1] ?? 0));
});

test('LoomFSR: shouldRejectHistory rejects on depth + normal mismatches (gate 4)', () => {
  const f = new LoomFSR(defaultConfig());
  // Depth delta below threshold + normal aligned -> NOT rejected.
  assert.equal(f.shouldRejectHistory(1000, 1010, FSR_FP_ONE), false);
  // Depth delta above threshold -> rejected.
  assert.equal(f.shouldRejectHistory(1000, 100000, FSR_FP_ONE), true);
  // Normal dot below threshold (0.5) -> rejected.
  assert.equal(f.shouldRejectHistory(1000, 1010, Math.floor(0.3 * FSR_FP_ONE)), true);
});

test('LoomFSR: registerColorTexture validates format + usage + alignment (gate 7)', () => {
  const f = new LoomFSR(defaultConfig());
  // Valid registration.
  assert.equal(f.registerColorTexture(
    1, 2, TEX_FORMAT_RGBA16_FLOAT,
    TEX_USAGE_TEXTURE_BINDING | TEX_USAGE_STORAGE_BINDING,
    16,
  ), FSR_REASON_NONE);
  // Bad format.
  assert.equal(f.registerColorTexture(3, 4, 999, TEX_USAGE_TEXTURE_BINDING | TEX_USAGE_STORAGE_BINDING, 16),
    FSR_REASON_BAD_FORMAT);
  // Missing usage bit.
  assert.equal(f.registerColorTexture(3, 4, TEX_FORMAT_RGBA16_FLOAT, TEX_USAGE_TEXTURE_BINDING, 16),
    FSR_REASON_BAD_USAGE);
  // Bad alignment.
  assert.equal(f.registerColorTexture(3, 4, TEX_FORMAT_RGBA16_FLOAT,
    TEX_USAGE_TEXTURE_BINDING | TEX_USAGE_STORAGE_BINDING, 7),
    FSR_REASON_BAD_ALIGNMENT);
});

test('LoomFSR: registerDepthTexture requires R32_FLOAT format (gate 7 channel-format compat)', () => {
  const f = new LoomFSR(defaultConfig());
  assert.equal(f.registerDepthTexture(1, 2, TEX_FORMAT_RGBA16_FLOAT,
    TEX_USAGE_TEXTURE_BINDING | TEX_USAGE_STORAGE_BINDING, 16), FSR_REASON_BAD_FORMAT);
  assert.equal(f.registerDepthTexture(1, 2, TEX_FORMAT_R32_FLOAT,
    TEX_USAGE_TEXTURE_BINDING | TEX_USAGE_STORAGE_BINDING, 16), FSR_REASON_NONE);
});

test('LoomFSR: registerNormalTexture accepts RG16_SNORM or RGBA16_FLOAT (gate 7)', () => {
  const f = new LoomFSR(defaultConfig());
  assert.equal(f.registerNormalTexture(1, 2, TEX_FORMAT_RG16_SNORM,
    TEX_USAGE_TEXTURE_BINDING | TEX_USAGE_STORAGE_BINDING, 16), FSR_REASON_NONE);
  const f2 = new LoomFSR(defaultConfig());
  assert.equal(f2.registerNormalTexture(1, 2, TEX_FORMAT_RGBA16_FLOAT,
    TEX_USAGE_TEXTURE_BINDING | TEX_USAGE_STORAGE_BINDING, 16), FSR_REASON_NONE);
});

test('LoomFSR: front + back swap rotates without GPU copy (gate 3)', () => {
  const f = new LoomFSR(defaultConfig());
  f.registerColorTexture(100, 200, TEX_FORMAT_RGBA16_FLOAT,
    TEX_USAGE_TEXTURE_BINDING | TEX_USAGE_STORAGE_BINDING, 16);
  assert.equal(f.getFrontTexture(FSR_CHANNEL_COLOR), 100);
  assert.equal(f.getBackTexture(FSR_CHANNEL_COLOR), 200);
  f.swapHistory(FSR_CHANNEL_COLOR);
  assert.equal(f.getFrontTexture(FSR_CHANNEL_COLOR), 200);
  assert.equal(f.getBackTexture(FSR_CHANNEL_COLOR), 100);
});

test('LoomFSR: swapAllHistories swaps every registered channel', () => {
  const f = new LoomFSR(defaultConfig());
  f.registerColorTexture(1, 2, TEX_FORMAT_RGBA16_FLOAT,
    TEX_USAGE_TEXTURE_BINDING | TEX_USAGE_STORAGE_BINDING, 16);
  f.registerDepthTexture(3, 4, TEX_FORMAT_R32_FLOAT,
    TEX_USAGE_TEXTURE_BINDING | TEX_USAGE_STORAGE_BINDING, 16);
  f.swapAllHistories();
  assert.equal(f.getFrontTexture(FSR_CHANNEL_COLOR), 2);
  assert.equal(f.getFrontTexture(FSR_CHANNEL_DEPTH), 4);
  // Unregistered channel - no-op.
  assert.equal(f.getFrontTexture(FSR_CHANNEL_NORMAL), 0);
});

test('LoomFSR: setReactiveMask + getReactiveMaskByte round-trip (gate 6)', () => {
  const f = new LoomFSR(defaultConfig());
  assert.equal(f.setReactiveMask(10, 20, REACTIVE_BIT_REACTIVE), true);
  assert.equal(f.getReactiveMaskByte(10, 20), REACTIVE_BIT_REACTIVE);
  assert.equal(f.setReactiveMask(-1, 0, 0), false);
  assert.equal(f.setReactiveMask(0, 9999, 0), false);
});

test('LoomFSR: clearReactiveMask zeroes the buffer', () => {
  const f = new LoomFSR(defaultConfig());
  f.setReactiveMask(0, 0, 3);
  f.clearReactiveMask();
  assert.equal(f.getReactiveMaskByte(0, 0), 0);
});

test('LoomFSR: bounds checks (gate 1)', () => {
  const f = new LoomFSR(defaultConfig());
  assert.equal(f.isValidLowResCoord(0, 0), true);
  assert.equal(f.isValidLowResCoord(639, 359), true);
  assert.equal(f.isValidLowResCoord(640, 0), false);
  assert.equal(f.isValidHighResCoord(1279, 719), true);
  assert.equal(f.isValidHighResCoord(1280, 0), false);
});

test('LoomFSR: deterministic across two independent runs', () => {
  function run(): number[] {
    const f = new LoomFSR(defaultConfig());
    const out = new Int32Array(2);
    const seq: number[] = [];
    for (let i = 0; i < 16; i++) {
      f.advanceJitter();
      f.getCurrentJitter(out);
      seq.push(out[0] ?? 0, out[1] ?? 0);
    }
    return seq;
  }
  assert.deepEqual(run(), run());
});

test('LoomFSR: clear() resets registry + mask + jitter index', () => {
  const f = new LoomFSR(defaultConfig());
  f.registerColorTexture(1, 2, TEX_FORMAT_RGBA16_FLOAT,
    TEX_USAGE_TEXTURE_BINDING | TEX_USAGE_STORAGE_BINDING, 16);
  f.advanceJitter();
  f.setReactiveMask(0, 0, 1);
  f.clear();
  assert.equal(f.isChannelRegistered(FSR_CHANNEL_COLOR), false);
  assert.equal(f.getReactiveMaskByte(0, 0), 0);
  assert.equal(f.getJitterIndex(), 0);
});

test('LoomFSR: tick rejects out-of-range t', () => {
  const f = new LoomFSR(defaultConfig());
  assert.throws(() => f.tick(-1), RangeError);
  assert.throws(() => f.tick(1.5), RangeError);
});

test('LoomFSR: scaleFactor encodes lowRes/highRes in fp', () => {
  const f = new LoomFSR(defaultConfig());
  // 640/1280 = 0.5 = FP_HALF.
  assert.equal(f.scaleFactorXFp, Math.floor(0.5 * FSR_FP_ONE));
  assert.equal(f.scaleFactorYFp, Math.floor(0.5 * FSR_FP_ONE));
});

test('LoomFSR: registerColorTexture rejects same front/back handle', () => {
  const f = new LoomFSR(defaultConfig());
  assert.notEqual(f.registerColorTexture(5, 5, TEX_FORMAT_RGBA16_FLOAT,
    TEX_USAGE_TEXTURE_BINDING | TEX_USAGE_STORAGE_BINDING, 16), FSR_REASON_NONE);
});
