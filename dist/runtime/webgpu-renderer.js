// WebGPURenderer - the SAFE CORE of the WebGPU SoA bridge: a
// double-buffered staging ring, upload validation, an explicit
// bind-group-layout descriptor, and device-lost state.
//
// The Trinity dossier's section 7 (Gemini Volume I). The Gemini sketch
// was `initWebGPURenderer(device, sab) { const buf = device.create-
// Buffer({ size: sab.byteLength, ... }); device.queue.writeBuffer(buf,
// 0, sab) }`. The Codex audit: "useful bridge but not zero-allocation
// and needs device safety." It uploaded the live SharedArrayBuffer
// straight to the GPU (a torn read if the sim is still writing it), it
// claimed zero-allocation falsely, it had no bind group layout, no
// validation against the device's limits, and no device-lost path.
//
// This is the corrected build, shaped the way every prior Trinity
// component is: the self-contained, fully unit-testable core ships;
// the external layer is deferred. Here the external layer is the
// WebGPU API itself - GPUDevice acquisition, GPUBuffer creation,
// queue.writeBuffer, the render pass - which cannot run under the
// determinism test harness anyway. So WebGPURenderer has NO dependency
// on the WebGPU API (no @webgpu/types): it is the pure-logic bridge a
// future webgpu-device.ts consumes.
//
// WHAT IT DOES. Each frame the caller hands captureSnapshot() a byte
// view of its SoA data. The bridge COPIES those bytes into one of its
// staging buffers (phase isolation - the GPU later reads a stable
// snapshot, never the live SoA) and ROTATES to the next staging
// buffer (double-buffering - a buffer is not reused for bufferCount
// frames, so an async GPU upload of frame N is not overwritten by
// frame N+1's capture). captureSnapshot() returns the staging index
// just written; the integration layer reads getUploadView(index) and
// hands it to device.queue.writeBuffer against GPU buffer `index`.
//
// The 5 Codex gates for WebGPURenderer, enforced:
//   1. "change claim to bounded per-frame WebGPU command allocation" -
//      the staging storage is allocated ONCE in the constructor;
//      captureSnapshot and getUploadView each produce one transient
//      view per call. The honest claim is bounded per-frame
//      allocation, not the Gemini "zero-allocation".
//   2. "validate activeCount, array lengths, max storage buffer size"
//      - captureSnapshot validates activeCount and strideBytes; the
//      derived byteLength is checked against byteCapacity AND the
//      source's byteLength; byteCapacity is checked against
//      maxStorageBufferBindingSize at construction, so every upload is
//      within the device's binding limit.
//   3. "use double-buffered or phase-isolated SoA snapshots before GPU
//      upload" - captureSnapshot COPIES (phase isolation) into a ring
//      of bufferCount >= 2 staging buffers (double-buffering).
//   4. "add explicit bind group layout and device-lost handling" - the
//      bind group layout is explicit, validated config: (binding,
//      visibility, bufferType) entries stored at construction and read
//      back via getBinding*. markDeviceLost() gates captureSnapshot to
//      a clean no-op (returns UPLOAD_NONE) until markDeviceRestored().
//   5. "do not rely on high-performance adapter selecting a specific
//      GPU" - guidance for the deferred device-acquisition layer: it
//      must not assume powerPreference picks a particular GPU, and it
//      must pass the device's real limits.maxStorageBufferBindingSize
//      into this bridge's config rather than assuming a value.
//
// Non-negotiable engine gates: no RNG, no wall clock (capture and
// rotation are deterministic - a run replays bit-for-bit); single-
// thread, single-owner; every index / count / length bounds-checked;
// fixed-capacity staging storage.
// Shader-stage bits for a binding's `visibility` bitmask. The values
// mirror WebGPU's GPUShaderStage so the deferred integration layer can
// pass them straight through.
export const SHADER_STAGE_VERTEX = 1;
export const SHADER_STAGE_FRAGMENT = 2;
export const SHADER_STAGE_COMPUTE = 4;
// A binding's buffer binding type.
export const BUFFER_TYPE_UNIFORM = 0;
export const BUFFER_TYPE_STORAGE = 1;
export const BUFFER_TYPE_READ_ONLY_STORAGE = 2;
// captureSnapshot returns this when the capture was skipped because
// the device is lost - a clean no-op frame, not an error.
export const UPLOAD_NONE = -1;
// Sanity caps on the config-derived sizes. Not hard engine limits -
// guards so a bad argument throws a clear error.
const MAX_BUFFER_COUNT = 8; // staging ring depth
const MAX_BYTE_CAPACITY = 1 << 28; // 256 MB per staging buffer
const MAX_BINDINGS = 16; // bind group layout entries
const MAX_BINDING_NUMBER = 1 << 16; // the @binding(N) value
// A visibility bitmask is a non-zero combination of the 3 stage bits.
const VISIBILITY_MASK = SHADER_STAGE_VERTEX | SHADER_STAGE_FRAGMENT | SHADER_STAGE_COMPUTE;
export class WebGPURenderer {
    // Staging ring depth.
    bufferCount;
    // Bytes per staging buffer.
    byteCapacity;
    // The device storage-buffer binding limit byteCapacity was checked
    // against.
    maxStorageBufferBindingSize;
    // Bind group layout entry count.
    bindingCount;
    // Staging storage: one backing Uint8Array of bufferCount *
    // byteCapacity, partitioned into bufferCount equal slices. Allocated
    // once (gate 1).
    backing;
    // Bytes captured into each staging buffer.
    validBytes;
    // The staging buffer captureSnapshot() writes next; rotates each
    // capture (gate 3 - double-buffering).
    writeCursor = 0;
    // Bind group layout columns (gate 4), indexed by entry.
    bindingNumber;
    bindingVisibility;
    bindingBufferType;
    // Device-lost gate (gate 4). While set, captureSnapshot is a no-op.
    deviceLost = false;
    // Successful captures and device-lost-skipped captures, monotonic.
    captureCount = 0;
    droppedCount = 0;
    constructor(config) {
        const { bufferCount, byteCapacity, maxStorageBufferBindingSize, bindings } = config;
        if (!Number.isInteger(bufferCount) || bufferCount < 2 || bufferCount > MAX_BUFFER_COUNT) {
            throw new RangeError('WebGPURenderer: bufferCount must be an integer in [2, ' + MAX_BUFFER_COUNT + '], got ' + bufferCount);
        }
        if (!Number.isInteger(byteCapacity) || byteCapacity < 1 || byteCapacity > MAX_BYTE_CAPACITY) {
            throw new RangeError('WebGPURenderer: byteCapacity must be an integer in [1, ' + MAX_BYTE_CAPACITY + '], got ' + byteCapacity);
        }
        if (!Number.isInteger(maxStorageBufferBindingSize)
            || maxStorageBufferBindingSize < 1 || maxStorageBufferBindingSize > MAX_BYTE_CAPACITY) {
            throw new RangeError('WebGPURenderer: maxStorageBufferBindingSize must be an integer in [1, ' + MAX_BYTE_CAPACITY + '], got '
                + maxStorageBufferBindingSize);
        }
        if (byteCapacity > maxStorageBufferBindingSize) {
            throw new RangeError('WebGPURenderer: byteCapacity ' + byteCapacity + ' exceeds maxStorageBufferBindingSize '
                + maxStorageBufferBindingSize + ' - a staging buffer would not be bindable');
        }
        if (!Array.isArray(bindings) || bindings.length < 1 || bindings.length > MAX_BINDINGS) {
            throw new RangeError('WebGPURenderer: bindings must be an array of 1 to ' + MAX_BINDINGS + ' entries, got '
                + (Array.isArray(bindings) ? bindings.length : typeof bindings));
        }
        this.bufferCount = bufferCount;
        this.byteCapacity = byteCapacity;
        this.maxStorageBufferBindingSize = maxStorageBufferBindingSize;
        this.bindingCount = bindings.length;
        this.backing = new Uint8Array(bufferCount * byteCapacity);
        this.validBytes = new Uint32Array(bufferCount);
        this.bindingNumber = new Uint32Array(this.bindingCount);
        this.bindingVisibility = new Uint8Array(this.bindingCount);
        this.bindingBufferType = new Uint8Array(this.bindingCount);
        for (let i = 0; i < this.bindingCount; i++) {
            const entry = bindings[i];
            if (entry === undefined
                || !Number.isInteger(entry.binding) || entry.binding < 0 || entry.binding > MAX_BINDING_NUMBER) {
                throw new RangeError('WebGPURenderer: bindings[' + i + '].binding must be an integer in [0, '
                    + MAX_BINDING_NUMBER + ']');
            }
            if (!Number.isInteger(entry.visibility) || entry.visibility < 1
                || (entry.visibility & ~VISIBILITY_MASK) !== 0) {
                throw new RangeError('WebGPURenderer: bindings[' + i
                    + '].visibility must be a non-zero bitmask of SHADER_STAGE_* (1..' + VISIBILITY_MASK + ')');
            }
            if (!Number.isInteger(entry.bufferType)
                || entry.bufferType < BUFFER_TYPE_UNIFORM || entry.bufferType > BUFFER_TYPE_READ_ONLY_STORAGE) {
                throw new RangeError('WebGPURenderer: bindings[' + i + '].bufferType must be a BUFFER_TYPE_* value');
            }
            // Binding numbers must be unique - no duplicate @binding(N).
            for (let j = 0; j < i; j++) {
                if ((this.bindingNumber[j] ?? 0) === entry.binding) {
                    throw new RangeError('WebGPURenderer: duplicate binding number ' + entry.binding);
                }
            }
            this.bindingNumber[i] = entry.binding;
            this.bindingVisibility[i] = entry.visibility;
            this.bindingBufferType[i] = entry.bufferType;
        }
    }
    // --- bind group layout readback (gate 4) ---
    // The @binding(N) index of layout entry `i`.
    getBindingNumber(i) {
        this.requireBindingIndex(i, 'getBindingNumber');
        return this.bindingNumber[i] ?? 0;
    }
    // The visibility bitmask (SHADER_STAGE_*) of layout entry `i`.
    getBindingVisibility(i) {
        this.requireBindingIndex(i, 'getBindingVisibility');
        return this.bindingVisibility[i] ?? 0;
    }
    // The buffer binding type (BUFFER_TYPE_*) of layout entry `i`.
    getBindingBufferType(i) {
        this.requireBindingIndex(i, 'getBindingBufferType');
        return this.bindingBufferType[i] ?? 0;
    }
    // --- device-lost handling (gate 4) ---
    // True while the GPU device is lost - captureSnapshot is a no-op.
    isDeviceLost() {
        return this.deviceLost;
    }
    // Mark the device lost: the integration layer calls this when WebGPU
    // signals device loss. captureSnapshot then no-ops cleanly until
    // markDeviceRestored().
    markDeviceLost() {
        this.deviceLost = true;
    }
    // Mark the device restored: the integration layer calls this once it
    // has re-acquired a device and re-created its GPU buffers. The
    // staging ring resumes from where it was - the next capture
    // overwrites a staging buffer regardless.
    markDeviceRestored() {
        this.deviceLost = false;
    }
    // --- the per-frame snapshot (gates 2, 3) ---
    // Copy `activeCount * strideBytes` bytes from `source` into the next
    // staging buffer and rotate. Returns the staging index just written
    // - the buffer the integration layer should upload, and the GPU
    // buffer slot it targets. Returns UPLOAD_NONE if the device is lost
    // (a clean skipped frame). Throws on a schema failure: a bad
    // activeCount / strideBytes, or a byteLength that exceeds byteCapacity
    // or the source.
    captureSnapshot(source, activeCount, strideBytes) {
        if (!Number.isInteger(activeCount) || activeCount < 0) {
            throw new RangeError('WebGPURenderer.captureSnapshot: activeCount must be a non-negative integer, got ' + activeCount);
        }
        if (!Number.isInteger(strideBytes) || strideBytes < 1) {
            throw new RangeError('WebGPURenderer.captureSnapshot: strideBytes must be a positive integer, got ' + strideBytes);
        }
        const byteLength = activeCount * strideBytes;
        if (byteLength > this.byteCapacity) {
            throw new RangeError('WebGPURenderer.captureSnapshot: activeCount * strideBytes = ' + byteLength
                + ' exceeds byteCapacity ' + this.byteCapacity);
        }
        if (byteLength > source.byteLength) {
            throw new RangeError('WebGPURenderer.captureSnapshot: activeCount * strideBytes = ' + byteLength
                + ' exceeds source.byteLength ' + source.byteLength);
        }
        // Device-lost: skip the frame cleanly (gate 4).
        if (this.deviceLost) {
            this.droppedCount++;
            return UPLOAD_NONE;
        }
        const idx = this.writeCursor;
        const base = idx * this.byteCapacity;
        // Phase isolation (gate 3): copy the caller's bytes into staging,
        // so the GPU later reads this stable snapshot, not the live SoA.
        if (byteLength > 0) {
            this.backing.set(source.subarray(0, byteLength), base);
        }
        this.validBytes[idx] = byteLength;
        // Double-buffering (gate 3): rotate so this buffer is not reused
        // for bufferCount frames.
        this.writeCursor = (idx + 1) % this.bufferCount;
        this.captureCount++;
        return idx;
    }
    // A view of staging buffer `index`'s captured bytes - exactly
    // getUploadByteLength(index) long. The integration layer hands this
    // to device.queue.writeBuffer. The returned view is a transient
    // slice (gate 1 - bounded per-frame allocation); do not retain it
    // past the frame.
    getUploadView(index) {
        this.requireBufferIndex(index, 'getUploadView');
        const base = index * this.byteCapacity;
        return this.backing.subarray(base, base + (this.validBytes[index] ?? 0));
    }
    // How many bytes were captured into staging buffer `index` (0 if it
    // has not been captured into since construction / clear).
    getUploadByteLength(index) {
        this.requireBufferIndex(index, 'getUploadByteLength');
        return this.validBytes[index] ?? 0;
    }
    // Successful captures since construction / clear, monotonic.
    getCaptureCount() {
        return this.captureCount;
    }
    // Captures skipped because the device was lost, monotonic.
    getDroppedCount() {
        return this.droppedCount;
    }
    // Reset to the constructed-but-empty state: the staging ring is
    // zeroed and rewound, device-lost is cleared, counters reset. The
    // bind group layout (immutable config) is kept.
    clear() {
        this.backing.fill(0);
        this.validBytes.fill(0);
        this.writeCursor = 0;
        this.deviceLost = false;
        this.captureCount = 0;
        this.droppedCount = 0;
    }
    // --- private ---
    requireBindingIndex(i, op) {
        if (!Number.isInteger(i) || i < 0 || i >= this.bindingCount) {
            throw new RangeError('WebGPURenderer.' + op + ': binding index ' + i + ' out of [0, ' + this.bindingCount + ')');
        }
    }
    requireBufferIndex(index, op) {
        if (!Number.isInteger(index) || index < 0 || index >= this.bufferCount) {
            throw new RangeError('WebGPURenderer.' + op + ': buffer index ' + index + ' out of [0, ' + this.bufferCount + ')');
        }
    }
}
//# sourceMappingURL=webgpu-renderer.js.map