// Loom Engine - WebGPURenderer (WebGPU SoA bridge - safe core) tests.
//
// Covers constructor validation, the bind-group-layout readback, the
// double-buffered staging ring, and the 5 Codex gates:
//   gate 1 - bounded per-frame allocation: staging storage is built
//            once; captures / views are transient slices.
//   gate 2 - captureSnapshot validates activeCount, strideBytes, the
//            derived byteLength against byteCapacity and the source.
//   gate 3 - captureSnapshot copies (phase isolation) into a rotating
//            ring of >= 2 buffers (double-buffering).
//   gate 4 - explicit bind-group-layout descriptor + device-lost gate.
//   gate 5 - the deferred device-acquisition layer passes the real
//            maxStorageBufferBindingSize in; the constructor checks
//            byteCapacity against it.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  WebGPURenderer,
  SHADER_STAGE_VERTEX,
  SHADER_STAGE_FRAGMENT,
  SHADER_STAGE_COMPUTE,
  BUFFER_TYPE_UNIFORM,
  BUFFER_TYPE_STORAGE,
  BUFFER_TYPE_READ_ONLY_STORAGE,
  UPLOAD_NONE,
  type WebGPURendererConfig,
} from '../src/index.js';

// A default config with selective overrides.
function cfg(over: Partial<WebGPURendererConfig> = {}): WebGPURendererConfig {
  return {
    bufferCount: 3,
    byteCapacity: 64,
    maxStorageBufferBindingSize: 128,
    bindings: [{ binding: 0, visibility: SHADER_STAGE_VERTEX, bufferType: BUFFER_TYPE_READ_ONLY_STORAGE }],
    ...over,
  };
}

test('webgpu renderer: constructor validates the config', () => {
  const r = new WebGPURenderer(cfg());
  assert.equal(r.bufferCount, 3);
  assert.equal(r.byteCapacity, 64);
  assert.equal(r.maxStorageBufferBindingSize, 128);
  assert.equal(r.bindingCount, 1);
  // bufferCount must be an integer >= 2 (double-buffer minimum).
  assert.throws(() => new WebGPURenderer(cfg({ bufferCount: 1 })), /bufferCount/);
  assert.throws(() => new WebGPURenderer(cfg({ bufferCount: 2.5 })), /bufferCount/);
  assert.throws(() => new WebGPURenderer(cfg({ bufferCount: 99 })), /bufferCount/);
  // byteCapacity bounds.
  assert.throws(() => new WebGPURenderer(cfg({ byteCapacity: 0 })), /byteCapacity/);
  // maxStorageBufferBindingSize bounds.
  assert.throws(() => new WebGPURenderer(cfg({ maxStorageBufferBindingSize: 0 })), /maxStorageBufferBindingSize/);
  // byteCapacity must not exceed the device's storage-buffer limit (gate 2).
  assert.throws(
    () => new WebGPURenderer(cfg({ byteCapacity: 256, maxStorageBufferBindingSize: 128 })),
    /exceeds maxStorageBufferBindingSize/,
  );
  // bindings must be a non-empty array within the cap.
  assert.throws(() => new WebGPURenderer(cfg({ bindings: [] })), /bindings/);
});

test('webgpu renderer: constructor validates every binding entry (gate 4)', () => {
  // Bad binding number.
  assert.throws(
    () => new WebGPURenderer(cfg({ bindings: [{ binding: -1, visibility: SHADER_STAGE_VERTEX, bufferType: BUFFER_TYPE_STORAGE }] })),
    /binding/,
  );
  // visibility must be a non-zero bitmask of the stage bits.
  assert.throws(
    () => new WebGPURenderer(cfg({ bindings: [{ binding: 0, visibility: 0, bufferType: BUFFER_TYPE_STORAGE }] })),
    /visibility/,
  );
  assert.throws(
    () => new WebGPURenderer(cfg({ bindings: [{ binding: 0, visibility: 99, bufferType: BUFFER_TYPE_STORAGE }] })),
    /visibility/,
  );
  // bufferType must be a BUFFER_TYPE_* value.
  assert.throws(
    () => new WebGPURenderer(cfg({ bindings: [{ binding: 0, visibility: SHADER_STAGE_VERTEX, bufferType: 7 }] })),
    /bufferType/,
  );
  // Binding numbers must be unique.
  assert.throws(
    () => new WebGPURenderer(cfg({
      bindings: [
        { binding: 2, visibility: SHADER_STAGE_VERTEX, bufferType: BUFFER_TYPE_STORAGE },
        { binding: 2, visibility: SHADER_STAGE_FRAGMENT, bufferType: BUFFER_TYPE_UNIFORM },
      ],
    })),
    /duplicate binding number/,
  );
});

test('webgpu renderer: the bind group layout reads back as configured (gate 4)', () => {
  const r = new WebGPURenderer(cfg({
    bindings: [
      { binding: 0, visibility: SHADER_STAGE_VERTEX | SHADER_STAGE_FRAGMENT, bufferType: BUFFER_TYPE_READ_ONLY_STORAGE },
      { binding: 3, visibility: SHADER_STAGE_COMPUTE, bufferType: BUFFER_TYPE_STORAGE },
    ],
  }));
  assert.equal(r.bindingCount, 2);
  assert.equal(r.getBindingNumber(0), 0);
  assert.equal(r.getBindingVisibility(0), SHADER_STAGE_VERTEX | SHADER_STAGE_FRAGMENT);
  assert.equal(r.getBindingBufferType(0), BUFFER_TYPE_READ_ONLY_STORAGE);
  assert.equal(r.getBindingNumber(1), 3);
  assert.equal(r.getBindingVisibility(1), SHADER_STAGE_COMPUTE);
  assert.equal(r.getBindingBufferType(1), BUFFER_TYPE_STORAGE);
  // Out-of-range entry index throws.
  assert.throws(() => r.getBindingNumber(2), /binding index/);
  assert.throws(() => r.getBindingNumber(-1), /binding index/);
});

test('webgpu renderer: captureSnapshot copies the source into a staging buffer', () => {
  const r = new WebGPURenderer(cfg());
  const source = new Uint8Array([10, 20, 30, 40, 50, 60]);
  const idx = r.captureSnapshot(source, 6, 1);
  assert.equal(idx, 0, 'first capture lands in staging buffer 0');
  assert.equal(r.getUploadByteLength(0), 6);
  assert.deepEqual(Array.from(r.getUploadView(0)), [10, 20, 30, 40, 50, 60]);
  assert.equal(r.getCaptureCount(), 1);
  // A never-captured buffer reads back empty.
  assert.equal(r.getUploadByteLength(1), 0);
  assert.equal(r.getUploadView(1).length, 0);
});

test('webgpu renderer: captureSnapshot rotates through the staging ring (gate 3)', () => {
  const r = new WebGPURenderer(cfg({ bufferCount: 3 }));
  const a = new Uint8Array([1, 1]);
  const b = new Uint8Array([2, 2]);
  const c = new Uint8Array([3, 3]);
  const d = new Uint8Array([4, 4]);
  assert.equal(r.captureSnapshot(a, 2, 1), 0);
  assert.equal(r.captureSnapshot(b, 2, 1), 1);
  assert.equal(r.captureSnapshot(c, 2, 1), 2);
  assert.equal(r.captureSnapshot(d, 2, 1), 0, 'the ring wraps back to buffer 0');
  // Buffers 1 and 2 still hold their own independent snapshots.
  assert.deepEqual(Array.from(r.getUploadView(1)), [2, 2]);
  assert.deepEqual(Array.from(r.getUploadView(2)), [3, 3]);
  assert.deepEqual(Array.from(r.getUploadView(0)), [4, 4], 'buffer 0 was overwritten by the wrap');
});

test('webgpu renderer: captureSnapshot is a copy - the GPU reads a stable snapshot (gate 3)', () => {
  const r = new WebGPURenderer(cfg());
  const source = new Uint8Array([1, 2, 3, 4]);
  const idx0 = r.captureSnapshot(source, 4, 1);
  // Mutate the source AFTER capture, then capture again into a different buffer.
  source[0] = 99;
  const idx1 = r.captureSnapshot(source, 4, 1);
  // Buffer 0 holds the pre-mutation snapshot; buffer 1 the post-mutation one.
  assert.deepEqual(Array.from(r.getUploadView(idx0)), [1, 2, 3, 4], 'staging buffer 0 is isolated from later source writes');
  assert.deepEqual(Array.from(r.getUploadView(idx1)), [99, 2, 3, 4]);
});

test('webgpu renderer: captureSnapshot validates activeCount, strideBytes, and byteLength (gate 2)', () => {
  const r = new WebGPURenderer(cfg({ byteCapacity: 16 }));
  const source = new Uint8Array(16);
  assert.throws(() => r.captureSnapshot(source, -1, 1), /activeCount/);
  assert.throws(() => r.captureSnapshot(source, 1.5, 1), /activeCount/);
  assert.throws(() => r.captureSnapshot(source, 1, 0), /strideBytes/);
  assert.throws(() => r.captureSnapshot(source, 1, -2), /strideBytes/);
  // byteLength (activeCount * strideBytes) must fit byteCapacity.
  assert.throws(() => r.captureSnapshot(source, 9, 2), /byteCapacity/);
  // ...and must not exceed what the source actually holds.
  const small = new Uint8Array(4);
  assert.throws(() => r.captureSnapshot(small, 8, 1), /source\.byteLength/);
  // activeCount 0 is valid - an empty snapshot still rotates the ring.
  assert.equal(r.captureSnapshot(source, 0, 4), 0);
  assert.equal(r.getUploadByteLength(0), 0);
  assert.equal(r.getCaptureCount(), 1);
});

test('webgpu renderer: device-lost gates captureSnapshot to a clean no-op (gate 4)', () => {
  const r = new WebGPURenderer(cfg({ bufferCount: 3 }));
  const source = new Uint8Array([5, 5, 5, 5]);
  assert.equal(r.captureSnapshot(source, 4, 1), 0);
  // Device lost: captures skip cleanly, do not rotate, do not count.
  r.markDeviceLost();
  assert.equal(r.isDeviceLost(), true);
  assert.equal(r.captureSnapshot(source, 4, 1), UPLOAD_NONE);
  assert.equal(r.captureSnapshot(source, 4, 1), UPLOAD_NONE);
  assert.equal(r.getCaptureCount(), 1, 'lost-frame captures are not counted as captures');
  assert.equal(r.getDroppedCount(), 2);
  // Restored: the ring resumes from where it was - the lost frames
  // burned no staging slot.
  r.markDeviceRestored();
  assert.equal(r.isDeviceLost(), false);
  assert.equal(r.captureSnapshot(source, 4, 1), 1, 'resumes at buffer 1, not 0');
  assert.equal(r.getCaptureCount(), 2);
});

test('webgpu renderer: getUploadView / getUploadByteLength are bounds-checked', () => {
  const r = new WebGPURenderer(cfg({ bufferCount: 2 }));
  assert.doesNotThrow(() => r.getUploadView(0));
  assert.doesNotThrow(() => r.getUploadView(1));
  assert.throws(() => r.getUploadView(2), /buffer index/);
  assert.throws(() => r.getUploadView(-1), /buffer index/);
  assert.throws(() => r.getUploadByteLength(2), /buffer index/);
  assert.throws(() => r.getUploadByteLength(1.5), /buffer index/);
});

test('webgpu renderer: clear rewinds the ring but keeps the bind group layout', () => {
  const r = new WebGPURenderer(cfg({ bufferCount: 3 }));
  const source = new Uint8Array([7, 7, 7]);
  r.captureSnapshot(source, 3, 1);
  r.captureSnapshot(source, 3, 1);
  r.markDeviceLost();
  r.captureSnapshot(source, 3, 1);
  assert.ok(r.getCaptureCount() > 0 && r.getDroppedCount() > 0);
  r.clear();
  assert.equal(r.getCaptureCount(), 0);
  assert.equal(r.getDroppedCount(), 0);
  assert.equal(r.isDeviceLost(), false, 'clear releases the device-lost gate');
  assert.equal(r.getUploadByteLength(0), 0);
  // The bind group layout (immutable config) survives clear().
  assert.equal(r.bindingCount, 1);
  assert.equal(r.getBindingNumber(0), 0);
  // Reusable: the ring rewinds to buffer 0.
  assert.equal(r.captureSnapshot(source, 3, 1), 0);
});

test('webgpu renderer: the staging ring is deterministic - identical runs match', () => {
  function run(): number[] {
    const r = new WebGPURenderer(cfg({ bufferCount: 4, byteCapacity: 32 }));
    const out: number[] = [];
    for (let frame = 0; frame < 10; frame++) {
      const source = new Uint8Array(8);
      for (let i = 0; i < 8; i++) source[i] = (frame * 8 + i) & 0xff;
      if (frame === 4) r.markDeviceLost();
      if (frame === 6) r.markDeviceRestored();
      out.push(r.captureSnapshot(source, 8, 1));
    }
    out.push(r.getCaptureCount(), r.getDroppedCount());
    for (let b = 0; b < 4; b++) {
      out.push(r.getUploadByteLength(b));
      const view = r.getUploadView(b);
      for (let i = 0; i < view.length; i++) out.push(view[i] ?? 0);
    }
    return out;
  }
  assert.deepEqual(run(), run(), 'no RNG, no clock - the staging ring is fully reproducible');
});
