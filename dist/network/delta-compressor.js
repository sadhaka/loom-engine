// DeltaCompressor (Loom-Wire) - compact binary delta for one record
// of up to 32 u32 columns.
//
// A "record" is a fixed-width row of u32 columns - one entity's
// networked properties, a peer's packed transform, etc. encode()
// diffs a `curr` record against a `prev` baseline and emits only the
// columns that changed, identified by a one-u32 bitmask; decode()
// applies that frame back onto a baseline to reconstruct `curr`. An
// unchanged record costs just the 24-byte header.
//
// This is the per-record primitive from the Trinity dossier's
// section 3. A whole-batch protocol (implicit entity IDs, RLE skip
// runs over an entity array) can layer on top of this later; the
// per-record codec is the self-contained, fully gate-checked core.
//
// Built on SnapshotWriter / SnapshotReader so the engine's canonical
// little-endian byte format and its capacity / bounds guarantees
// carry straight through - the Codex "capacity checks before writes"
// and "strict decoder bounds checks" gates are those primitives.
//
// The Codex gates, enforced:
//   1. frame header - magic, version, record width, tick, baseline
//      tick, change mask, payload length.
//   2. transport explicit - the codec is pure binary; deltaFrameTo/
//      FromBase64 are the only text boundary, for the SSE channel.
//   3. capacity checks - SnapshotWriter grows on demand, so a write
//      is never out of bounds.
//   4. strict decoder - bad magic, version skew, an out-of-range
//      record width, a mask bit beyond that width, a payload length
//      that disagrees with the mask, or a truncated stream all throw
//      rather than reconstructing garbage.
//   5. SAB safety - encode / decode only READ their input arrays and
//      run synchronously; the caller must invoke them in a phase
//      where prev / curr are not being written by another thread.
//   6. reusable output - encode writes into a caller-owned, reused
//      SnapshotWriter and decode fills a caller-owned `out` array;
//      neither allocates per call.
// "LWD1" as little-endian bytes (0x4C 0x57 0x44 0x31).
export const DELTA_WIRE_MAGIC = 0x3144574c;
// Protocol version. Bumped on any frame-layout change; the decoder
// rejects a mismatch rather than guessing.
export const DELTA_WIRE_VERSION = 1;
// A record is at most 32 u32 columns - the change mask is one u32,
// so bit i tracks column i and 32 is the hard ceiling.
export const DELTA_MAX_COLUMNS = 32;
function requireU32(value, name) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        throw new RangeError('DeltaCompressor: ' + name + ' must be a u32 integer in [0, 4294967295], got ' + value);
    }
}
export class DeltaCompressor {
    // Encode the per-column delta of `curr` against `prev` into
    // `writer`. prev and curr must be the same length, 1..32 columns.
    // `tick` is curr's tick, `baselineTick` is prev's. Returns the
    // number of changed columns (the mask popcount) for the caller's
    // bandwidth telemetry.
    //
    // `writer` is caller-owned and meant to be reused across frames
    // (writer.reset() between frames) - the zero-per-call-allocation
    // contract. SnapshotWriter grows its buffer on demand, so writes
    // are always in bounds.
    static encode(prev, curr, tick, baselineTick, writer) {
        const columnCount = prev.length;
        if (columnCount < 1 || columnCount > DELTA_MAX_COLUMNS) {
            throw new RangeError('DeltaCompressor.encode: record width ' + columnCount
                + ' out of [1, ' + DELTA_MAX_COLUMNS + ']');
        }
        if (curr.length !== columnCount) {
            throw new RangeError('DeltaCompressor.encode: curr width ' + curr.length
                + ' != prev width ' + columnCount);
        }
        requireU32(tick, 'tick');
        requireU32(baselineTick, 'baselineTick');
        // One pass: build the changed-column mask and count the changes.
        let mask = 0;
        let changed = 0;
        for (let i = 0; i < columnCount; i++) {
            if ((curr[i] ?? 0) !== (prev[i] ?? 0)) {
                mask |= 1 << i;
                changed++;
            }
        }
        writer.writeU32(DELTA_WIRE_MAGIC);
        writer.writeU16(DELTA_WIRE_VERSION);
        writer.writeU16(columnCount);
        writer.writeU32(tick);
        writer.writeU32(baselineTick);
        writer.writeU32(mask >>> 0);
        writer.writeU32(changed * 4);
        for (let i = 0; i < columnCount; i++) {
            if ((mask & (1 << i)) !== 0) {
                writer.writeU32(curr[i] ?? 0);
            }
        }
        return changed;
    }
    // Decode a frame from `reader`, apply it to `prev`, and write the
    // reconstructed record into `out`. prev and out must both match the
    // frame's record width. Returns the frame's tick + baselineTick so
    // the caller can confirm it decoded against the right baseline.
    //
    // Throws on a bad magic, a version mismatch, a record width outside
    // [1, 32] or disagreeing with prev / out, a mask bit set beyond the
    // record width, a payload length that disagrees with the mask, or a
    // truncated stream (SnapshotReader bounds-checks every read). A
    // malformed frame fails loud rather than reconstructing garbage.
    static decode(prev, reader, out) {
        const magic = reader.readU32();
        if (magic !== DELTA_WIRE_MAGIC) {
            throw new Error('DeltaCompressor.decode: bad magic 0x' + (magic >>> 0).toString(16));
        }
        const version = reader.readU16();
        if (version !== DELTA_WIRE_VERSION) {
            throw new Error('DeltaCompressor.decode: version ' + version
                + ' != expected ' + DELTA_WIRE_VERSION);
        }
        const columnCount = reader.readU16();
        if (columnCount < 1 || columnCount > DELTA_MAX_COLUMNS) {
            throw new RangeError('DeltaCompressor.decode: record width ' + columnCount
                + ' out of [1, ' + DELTA_MAX_COLUMNS + ']');
        }
        if (prev.length !== columnCount) {
            throw new RangeError('DeltaCompressor.decode: prev width ' + prev.length
                + ' != frame width ' + columnCount);
        }
        if (out.length !== columnCount) {
            throw new RangeError('DeltaCompressor.decode: out width ' + out.length
                + ' != frame width ' + columnCount);
        }
        const tick = reader.readU32();
        const baselineTick = reader.readU32();
        const mask = reader.readU32();
        // Unknown-mask-bit rejection: no bit at or above columnCount may
        // be set. A 32-column record uses the whole mask, so the check
        // only applies below that width.
        if (columnCount < 32) {
            const validMask = ((1 << columnCount) - 1) >>> 0;
            if ((mask & ~validMask) !== 0) {
                throw new Error('DeltaCompressor.decode: mask 0x' + (mask >>> 0).toString(16)
                    + ' sets a bit beyond record width ' + columnCount);
            }
        }
        let changed = 0;
        for (let i = 0; i < columnCount; i++) {
            if ((mask & (1 << i)) !== 0)
                changed++;
        }
        const payloadLength = reader.readU32();
        if (payloadLength !== changed * 4) {
            throw new Error('DeltaCompressor.decode: payloadLength ' + payloadLength
                + ' disagrees with mask popcount ' + changed
                + ' (expected ' + (changed * 4) + ')');
        }
        // Rebuild: a changed column comes from the stream, an unchanged
        // column carries over from the baseline.
        for (let i = 0; i < columnCount; i++) {
            if ((mask & (1 << i)) !== 0) {
                out[i] = reader.readU32();
            }
            else {
                out[i] = prev[i] ?? 0;
            }
        }
        return { tick, baselineTick };
    }
}
// --- SSE transport boundary ---
//
// A delta frame is raw binary; SSE is a UTF-8 text channel, so a
// frame must be Base64-wrapped to ride it. The codec above stays
// pure binary - these two functions are the only place the wire
// format meets text. btoa / atob are standard in every runtime the
// engine targets (Node 16+, modern browsers).
export function deltaFrameToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i] ?? 0);
    }
    return btoa(binary);
}
export function deltaFrameFromBase64(text) {
    // atob throws on malformed Base64 - the same fail-loud contract as
    // the binary decoder rejecting a bad frame.
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        out[i] = binary.charCodeAt(i);
    }
    return out;
}
//# sourceMappingURL=delta-compressor.js.map