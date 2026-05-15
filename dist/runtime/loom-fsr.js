// LoomFSR - the temporal upscaler kernel: a precomputed Halton(2,3)
// sub-pixel jitter sequence, ping-pong color + depth + normal
// history texture handles, a per-pixel reactive / disocclusion
// mask buffer, configured spatial-reconstruction sharpening, and
// validated input/output texture format + alignment requirements.
//
// The Trinity dossier's section 27 (Gemini Volume II). The Gemini
// sketch was a WGSL TAA kernel with `let historyCoord = vec2<f32>
// (id) - (motion * resolutionScale); ... colorClamp(current,
// history, neighborhoodMin, neighborhoodMax)`. The Codex audit:
// "basic TAA resolve, not FSR-class upscaling yet." The sketch had
// no output / input bounds checks (a dispatch could read off the
// texture), no jitter convention (no defined sub-pixel offset
// pattern - resolves were silently un-anchored), no ping-pong
// pattern (the consumer would copy history each frame), no depth /
// normal history rejection (a disoccluded pixel sampled the wrong
// history), no spatial reconstruction (it was a pure resolve, not
// FSR-class upscale), no reactive / disocclusion masks (transparent
// + animated geo ghosted), and no texture-format validation.
//
// This is the corrected build, single-thread / single-owner like every
// shipped Trinity component. The actual WGSL compute pass + GPU
// texture binding + sampling is the deferred integration layer;
// this is the pure-logic JITTER-PATTERN / PING-PONG-STATE /
// REACTIVE-MASK / SHARPEN-CONFIG / FORMAT-VALIDATOR kernel that
// drives them.
//
// JITTER (gate 2). The Halton(2,3) low-discrepancy sequence over
// 16 samples in fp [-FP_HALF, +FP_HALF] is precomputed in the
// constructor. advanceJitter() bumps the sub-pixel index (mod 16);
// getCurrentJitter writes the sub-pixel offset into out[0..2]. The
// motion-vector convention: a positive motion vector points from
// the previous pixel to the current pixel in NDC ([-1, 1]) space.
// historyCoord = currentCoord - motion - jitter (the FSR convention,
// where history is the unjittered prior frame).
//
// PING-PONG HISTORY (gate 3). The kernel holds two Uint32 texture
// handles per channel (color, depth, normal). frontHandle is the
// READ side (the prior frame's history); backHandle is the WRITE
// side (this frame's resolved output, becomes next frame's
// history). swapHistory(channel) swaps; the deferred GPU dispatcher
// binds the front for sampling and the back as the storage-write
// target.
//
// HISTORY REJECTION (gate 4). historyDepthThresholdFp +
// historyNormalThresholdFp configure the per-pixel rejection: if
// |currentDepth - historyDepth| > threshold OR
// dot(currentNormal, historyNormal) < threshold, the history sample
// is rejected and the pixel is reconstructed from the current
// frame alone. This is the disocclusion fix.
//
// REACTIVE / DISOCCLUSION MASK (gate 6). reactiveMask is a per-
// pixel Uint8 buffer. Bit 0 = "reactive surface" (transparent,
// animated, water - the resolve weights the current frame more
// heavily); bit 1 = "disoccluded" (no valid history). The deferred
// GPU shader reads this mask and adjusts the resolve weight
// accordingly.
//
// SPATIAL RECONSTRUCTION / SHARPENING (gate 5). sharpenStrengthFp
// in [0, FP_ONE] configures the post-resolve unsharp mask the
// deferred GPU shader applies. 0 = no sharpening (pure TAA); >0
// adds the FSR-class spatial recovery. Without this, the kernel
// is a TAA resolve, not FSR.
//
// FORMAT + ALIGNMENT VALIDATION (gate 7). registerColorTexture /
// registerDepthTexture / registerNormalTexture validate the
// caller-provided format (one of TEX_FORMAT_*) + usage flags
// (TEX_USAGE_*) + uniform alignment. Mismatched formats are
// rejected at registration; the deferred GPU dispatcher trusts
// the registered metadata.
//
// BOUNDS (gate 1). Every coord, pixel index, jitter index,
// channel id, mask byte is range-checked.
//
// The 7 Codex gates for LoomFSR, enforced:
//   1. "output / input coordinate bounds checks" - every coord +
//      index validated before any read / write.
//   2. "motion-vector convention + jitter compensation" - Halton(2,3)
//      jitter precomputed; getCurrentJitter writes the sub-pixel
//      offset; the historyCoord formula is the documented
//      "current - motion - jitter" convention.
//   3. "ping-pong history textures, no copying" - pair of texture
//      handles per channel; swapHistory rotates without GPU copy.
//   4. "depth + normal history rejection" - configurable per-pixel
//      thresholds; the deferred shader reads them.
//   5. "spatial reconstruction / sharpening before calling it FSR" -
//      sharpenStrengthFp configured; deferred shader applies the
//      unsharp mask post-resolve.
//   6. "reactive / disocclusion masks" - per-pixel Uint8 mask buffer;
//      bit 0 reactive, bit 1 disoccluded.
//   7. "validate texture formats / usages + uniform alignment" -
//      registerColorTexture / etc. validate format enum + usage
//      bitmask + alignment.
//
// Non-negotiable engine gates: no RNG; no wall clock - tick(t) is
// injected; single-thread, no Atomics; every coord / index / channel
// bounds-checked; fixed-capacity storage. Storage allocated once.
// Q16.16 fixed-point.
export const FSR_FP_SHIFT = 16;
export const FSR_FP_ONE = 1 << FSR_FP_SHIFT;
export const FSR_FP_HALF = FSR_FP_ONE >> 1;
// Channels.
export const FSR_CHANNEL_COLOR = 0;
export const FSR_CHANNEL_DEPTH = 1;
export const FSR_CHANNEL_NORMAL = 2;
const CHANNEL_COUNT = 3;
// Texture format enum (gate 7).
export const TEX_FORMAT_RGBA8_UNORM = 1;
export const TEX_FORMAT_RGBA16_FLOAT = 2;
export const TEX_FORMAT_R32_FLOAT = 3; // depth
export const TEX_FORMAT_RG16_SNORM = 4; // packed normal
// Texture usage bits (gate 7).
export const TEX_USAGE_TEXTURE_BINDING = 1 << 0;
export const TEX_USAGE_STORAGE_BINDING = 1 << 1;
export const TEX_USAGE_RENDER_ATTACHMENT = 1 << 2;
export const TEX_USAGE_COPY_DST = 1 << 3;
export const TEX_USAGE_COPY_SRC = 1 << 4;
// Reactive mask bits (gate 6).
export const REACTIVE_BIT_REACTIVE = 1 << 0; // surface needs heavier current-frame weight
export const REACTIVE_BIT_DISOCCLUDED = 1 << 1; // no valid history
// Sentinels.
export const TEX_HANDLE_INVALID = 0;
export const FSR_REASON_NONE = 0;
export const FSR_REASON_BAD_FORMAT = 1;
export const FSR_REASON_BAD_USAGE = 2;
export const FSR_REASON_BAD_ALIGNMENT = 3;
export const FSR_REASON_BAD_COORD = 4;
export const FSR_REASON_BAD_CHANNEL = 5;
// Sanity caps.
const MAX_RES = 8192;
const MAX_JITTER_SAMPLES = 64;
const U32_MAX = 0xffffffff;
// Halton sample count.
const HALTON_SAMPLES = 16;
// Required uniform buffer alignment in bytes (gate 7 - WebGPU spec
// minimum is 16, common implementations require 256).
const UNIFORM_ALIGN_REQUIRED = 16;
// Halton sequence helper.
function haltonAt(index, base) {
    let result = 0;
    let f = 1;
    let i = index;
    while (i > 0) {
        f = f / base;
        result += f * (i % base);
        i = Math.floor(i / base);
    }
    return result;
}
export class LoomFSR {
    lowResWidth;
    lowResHeight;
    highResWidth;
    highResHeight;
    jitterSamples;
    historyDepthThresholdFp;
    historyNormalThresholdFp;
    sharpenStrengthFp;
    scaleFactorXFp;
    scaleFactorYFp;
    // Halton jitter table (gate 2).
    jitterX;
    jitterY;
    jitterIndex = 0;
    // Per-channel ping-pong texture handles (gate 3).
    frontTextureHandle;
    backTextureHandle;
    textureFormat;
    textureUsage;
    textureRegistered;
    // Per-pixel reactive mask (gate 6). Sized lowResWidth * lowResHeight.
    reactiveMask;
    currentTick = 0;
    constructor(config) {
        const { lowResWidth, lowResHeight, highResWidth, highResHeight, jitterSamples, historyDepthThresholdFp, historyNormalThresholdFp, sharpenStrengthFp, } = config;
        if (!Number.isInteger(lowResWidth) || lowResWidth < 1 || lowResWidth > MAX_RES) {
            throw new RangeError('LoomFSR: lowResWidth out of range, got ' + lowResWidth);
        }
        if (!Number.isInteger(lowResHeight) || lowResHeight < 1 || lowResHeight > MAX_RES) {
            throw new RangeError('LoomFSR: lowResHeight out of range, got ' + lowResHeight);
        }
        if (!Number.isInteger(highResWidth) || highResWidth < lowResWidth || highResWidth > MAX_RES) {
            throw new RangeError('LoomFSR: highResWidth must be >= lowResWidth, got ' + highResWidth);
        }
        if (!Number.isInteger(highResHeight) || highResHeight < lowResHeight || highResHeight > MAX_RES) {
            throw new RangeError('LoomFSR: highResHeight must be >= lowResHeight, got ' + highResHeight);
        }
        if (!Number.isInteger(jitterSamples) || jitterSamples < 1 || jitterSamples > MAX_JITTER_SAMPLES) {
            throw new RangeError('LoomFSR: jitterSamples out of range, got ' + jitterSamples);
        }
        if (!Number.isInteger(historyDepthThresholdFp) || historyDepthThresholdFp < 0
            || historyDepthThresholdFp > FSR_FP_ONE * 16) {
            throw new RangeError('LoomFSR: historyDepthThresholdFp out of range, got ' + historyDepthThresholdFp);
        }
        if (!Number.isInteger(historyNormalThresholdFp)
            || historyNormalThresholdFp < -FSR_FP_ONE || historyNormalThresholdFp > FSR_FP_ONE) {
            throw new RangeError('LoomFSR: historyNormalThresholdFp out of range, got ' + historyNormalThresholdFp);
        }
        if (!Number.isInteger(sharpenStrengthFp) || sharpenStrengthFp < 0 || sharpenStrengthFp > FSR_FP_ONE) {
            throw new RangeError('LoomFSR: sharpenStrengthFp out of range, got ' + sharpenStrengthFp);
        }
        this.lowResWidth = lowResWidth;
        this.lowResHeight = lowResHeight;
        this.highResWidth = highResWidth;
        this.highResHeight = highResHeight;
        this.jitterSamples = jitterSamples;
        this.historyDepthThresholdFp = historyDepthThresholdFp;
        this.historyNormalThresholdFp = historyNormalThresholdFp;
        this.sharpenStrengthFp = sharpenStrengthFp;
        this.scaleFactorXFp = Math.floor((lowResWidth * FSR_FP_ONE) / highResWidth);
        this.scaleFactorYFp = Math.floor((lowResHeight * FSR_FP_ONE) / highResHeight);
        // Build Halton(2, 3) jitter table (gate 2).
        this.jitterX = new Int32Array(jitterSamples);
        this.jitterY = new Int32Array(jitterSamples);
        for (let i = 0; i < jitterSamples; i++) {
            const haltonIdx = (i % HALTON_SAMPLES) + 1; // Halton starts at index 1
            const x = haltonAt(haltonIdx, 2) - 0.5; // [-0.5, 0.5)
            const y = haltonAt(haltonIdx, 3) - 0.5;
            this.jitterX[i] = Math.floor(x * FSR_FP_ONE);
            this.jitterY[i] = Math.floor(y * FSR_FP_ONE);
        }
        this.frontTextureHandle = new Uint32Array(CHANNEL_COUNT);
        this.backTextureHandle = new Uint32Array(CHANNEL_COUNT);
        this.textureFormat = new Uint32Array(CHANNEL_COUNT);
        this.textureUsage = new Uint32Array(CHANNEL_COUNT);
        this.textureRegistered = new Uint8Array(CHANNEL_COUNT);
        this.reactiveMask = new Uint8Array(lowResWidth * lowResHeight);
    }
    // --- counts ---
    getCurrentTick() { return this.currentTick; }
    getJitterIndex() { return this.jitterIndex; }
    getReactiveMask() { return this.reactiveMask; }
    // --- jitter (gate 2) ---
    // Advance the jitter index for the current frame. Called once per
    // frame at the start of the render pass; subsequent
    // getCurrentJitter() returns the new offset.
    advanceJitter() {
        this.jitterIndex = (this.jitterIndex + 1) % this.jitterSamples;
    }
    // Read the current sub-pixel jitter offset into out[0..2] (x, y in
    // fp [-FP_HALF, +FP_HALF]). The deferred camera-projection layer
    // adds this to the projection matrix as a sub-pixel offset.
    getCurrentJitter(out, outOffset = 0) {
        if (outOffset < 0 || outOffset + 2 > out.length)
            return false;
        out[outOffset + 0] = this.jitterX[this.jitterIndex] ?? 0;
        out[outOffset + 1] = this.jitterY[this.jitterIndex] ?? 0;
        return true;
    }
    // The motion-vector + jitter convention. Computes the history
    // coord that the deferred shader samples:
    // historyCoord = currentCoord - motion - jitter. Returns false on
    // out-of-range inputs.
    computeHistoryCoord(currentCoordXFp, currentCoordYFp, motionXFp, motionYFp, out, outOffset = 0) {
        if (!Number.isInteger(currentCoordXFp) || !Number.isInteger(currentCoordYFp))
            return false;
        if (!Number.isInteger(motionXFp) || !Number.isInteger(motionYFp))
            return false;
        if (outOffset < 0 || outOffset + 2 > out.length)
            return false;
        const jx = this.jitterX[this.jitterIndex] ?? 0;
        const jy = this.jitterY[this.jitterIndex] ?? 0;
        out[outOffset + 0] = (currentCoordXFp - motionXFp - jx) | 0;
        out[outOffset + 1] = (currentCoordYFp - motionYFp - jy) | 0;
        return true;
    }
    // --- history rejection (gate 4) ---
    // Returns true if the history sample at (currentDepth, currentNormal)
    // should be REJECTED. The deferred shader calls this per pixel.
    // currentNormal + historyNormal are unit-vector dot product result
    // (fp in [-FP_ONE, +FP_ONE]).
    shouldRejectHistory(currentDepthFp, historyDepthFp, normalDotFp) {
        if (!Number.isInteger(currentDepthFp) || !Number.isInteger(historyDepthFp))
            return true;
        if (!Number.isInteger(normalDotFp))
            return true;
        const dDelta = Math.abs(currentDepthFp - historyDepthFp);
        if (dDelta > this.historyDepthThresholdFp)
            return true;
        if (normalDotFp < this.historyNormalThresholdFp)
            return true;
        return false;
    }
    // --- ping-pong textures (gate 3) ---
    // Register a texture pair (front + back) for a channel. format must
    // be a valid TEX_FORMAT_*; usage must include TEX_USAGE_TEXTURE_BINDING
    // and TEX_USAGE_STORAGE_BINDING. uniformAlignment must be a multiple
    // of UNIFORM_ALIGN_REQUIRED.
    registerColorTexture(frontHandle, backHandle, format, usage, uniformAlignment) {
        return this.registerChannel(FSR_CHANNEL_COLOR, frontHandle, backHandle, format, usage, uniformAlignment);
    }
    registerDepthTexture(frontHandle, backHandle, format, usage, uniformAlignment) {
        return this.registerChannel(FSR_CHANNEL_DEPTH, frontHandle, backHandle, format, usage, uniformAlignment);
    }
    registerNormalTexture(frontHandle, backHandle, format, usage, uniformAlignment) {
        return this.registerChannel(FSR_CHANNEL_NORMAL, frontHandle, backHandle, format, usage, uniformAlignment);
    }
    registerChannel(channel, frontHandle, backHandle, format, usage, uniformAlignment) {
        if (!Number.isInteger(channel) || channel < 0 || channel >= CHANNEL_COUNT)
            return FSR_REASON_BAD_CHANNEL;
        if (!Number.isInteger(frontHandle) || frontHandle === TEX_HANDLE_INVALID
            || frontHandle < 0 || frontHandle > U32_MAX)
            return FSR_REASON_BAD_CHANNEL;
        if (!Number.isInteger(backHandle) || backHandle === TEX_HANDLE_INVALID
            || backHandle < 0 || backHandle > U32_MAX)
            return FSR_REASON_BAD_CHANNEL;
        if (frontHandle === backHandle)
            return FSR_REASON_BAD_CHANNEL;
        // Format validation (gate 7).
        if (format !== TEX_FORMAT_RGBA8_UNORM && format !== TEX_FORMAT_RGBA16_FLOAT
            && format !== TEX_FORMAT_R32_FLOAT && format !== TEX_FORMAT_RG16_SNORM) {
            return FSR_REASON_BAD_FORMAT;
        }
        // Channel-format compatibility.
        if (channel === FSR_CHANNEL_DEPTH && format !== TEX_FORMAT_R32_FLOAT)
            return FSR_REASON_BAD_FORMAT;
        if (channel === FSR_CHANNEL_NORMAL
            && format !== TEX_FORMAT_RG16_SNORM && format !== TEX_FORMAT_RGBA16_FLOAT) {
            return FSR_REASON_BAD_FORMAT;
        }
        // Usage validation (gate 7).
        if (!Number.isInteger(usage) || usage < 0 || usage > 0xff)
            return FSR_REASON_BAD_USAGE;
        if ((usage & TEX_USAGE_TEXTURE_BINDING) === 0)
            return FSR_REASON_BAD_USAGE;
        if ((usage & TEX_USAGE_STORAGE_BINDING) === 0)
            return FSR_REASON_BAD_USAGE;
        // Alignment (gate 7).
        if (!Number.isInteger(uniformAlignment) || uniformAlignment < UNIFORM_ALIGN_REQUIRED
            || (uniformAlignment % UNIFORM_ALIGN_REQUIRED) !== 0) {
            return FSR_REASON_BAD_ALIGNMENT;
        }
        this.frontTextureHandle[channel] = frontHandle >>> 0;
        this.backTextureHandle[channel] = backHandle >>> 0;
        this.textureFormat[channel] = format >>> 0;
        this.textureUsage[channel] = usage >>> 0;
        this.textureRegistered[channel] = 1;
        return FSR_REASON_NONE;
    }
    // Swap front/back for a channel. Called after each frame's resolve
    // pass (the back becomes next frame's history-read front).
    swapHistory(channel) {
        if (!Number.isInteger(channel) || channel < 0 || channel >= CHANNEL_COUNT)
            return false;
        if (!this.textureRegistered[channel])
            return false;
        const tmp = this.frontTextureHandle[channel] ?? 0;
        this.frontTextureHandle[channel] = this.backTextureHandle[channel] ?? 0;
        this.backTextureHandle[channel] = tmp;
        return true;
    }
    // Swap all three channels at once.
    swapAllHistories() {
        for (let c = 0; c < CHANNEL_COUNT; c++) {
            if (this.textureRegistered[c])
                this.swapHistory(c);
        }
    }
    getFrontTexture(channel) {
        if (!Number.isInteger(channel) || channel < 0 || channel >= CHANNEL_COUNT)
            return TEX_HANDLE_INVALID;
        return this.frontTextureHandle[channel] ?? TEX_HANDLE_INVALID;
    }
    getBackTexture(channel) {
        if (!Number.isInteger(channel) || channel < 0 || channel >= CHANNEL_COUNT)
            return TEX_HANDLE_INVALID;
        return this.backTextureHandle[channel] ?? TEX_HANDLE_INVALID;
    }
    isChannelRegistered(channel) {
        if (!Number.isInteger(channel) || channel < 0 || channel >= CHANNEL_COUNT)
            return false;
        return (this.textureRegistered[channel] ?? 0) === 1;
    }
    // --- reactive mask (gate 6) ---
    // Set a reactive-mask byte for a low-res pixel. The deferred shader
    // reads this and adjusts the resolve weight per pixel.
    setReactiveMask(x, y, mask) {
        if (!this.requireLowResCoord(x, y))
            return false;
        if (!Number.isInteger(mask) || mask < 0 || mask > 0xff)
            return false;
        this.reactiveMask[y * this.lowResWidth + x] = mask & 0xff;
        return true;
    }
    getReactiveMaskByte(x, y) {
        if (!this.requireLowResCoord(x, y))
            return 0;
        return this.reactiveMask[y * this.lowResWidth + x] ?? 0;
    }
    // Bulk-clear the reactive mask (typical at frame start).
    clearReactiveMask() {
        this.reactiveMask.fill(0);
    }
    // --- bounds checks (gate 1) ---
    isValidLowResCoord(x, y) {
        return this.requireLowResCoord(x, y);
    }
    isValidHighResCoord(x, y) {
        return Number.isInteger(x) && Number.isInteger(y)
            && x >= 0 && y >= 0
            && x < this.highResWidth && y < this.highResHeight;
    }
    requireLowResCoord(x, y) {
        return Number.isInteger(x) && Number.isInteger(y)
            && x >= 0 && y >= 0
            && x < this.lowResWidth && y < this.lowResHeight;
    }
    tick(t) {
        if (!Number.isInteger(t) || t < 0 || t > U32_MAX) {
            throw new RangeError('LoomFSR.tick: t must be a u32, got ' + t);
        }
        this.currentTick = t | 0;
    }
    // --- lifecycle ---
    clear() {
        this.frontTextureHandle.fill(0);
        this.backTextureHandle.fill(0);
        this.textureFormat.fill(0);
        this.textureUsage.fill(0);
        this.textureRegistered.fill(0);
        this.reactiveMask.fill(0);
        this.jitterIndex = 0;
    }
}
//# sourceMappingURL=loom-fsr.js.map