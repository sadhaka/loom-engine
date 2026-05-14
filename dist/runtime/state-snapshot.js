// Loom Engine - deterministic binary state snapshot.
//
// Serializes simulation state - the entity allocator, component-pool
// flags and typed-array slices, the RNG - into canonical little-endian
// bytes, and hashes those bytes. The same state hashed on the same
// tick from the same seed + trace must produce the same hash on every
// runtime (Node, Chrome, Firefox, x64, ARM64); a divergence is a
// determinism bug. This is the foundation the cross-runtime replay
// matrix compares against, and the snapshot/restore primitive a
// rewind buffer builds on.
//
// Distinct from runtime/world-snapshot.ts: that is the opt-in
// save-game serializer (resources -> JSON object). This is the
// determinism-verification serializer (simulation state -> canonical
// bytes -> hash) - the "separate phase" world-snapshot.ts's own header
// defers to.
//
// Design:
//   - SnapshotWriter / SnapshotReader: a growable byte buffer with
//     every scalar forced little-endian via DataView, so the bytes
//     are identical regardless of host endianness. The writer is
//     reusable - reset() keeps the buffer, so per-tick hashing is
//     zero-allocation once the buffer reaches steady-state size.
//   - ISnapshotable: a part of the world (the allocator, a pool, the
//     RNG) declares a stable snapshotKey and knows how to write and
//     read its own canonical bytes. Pools stay opaque to the World;
//     they opt in to snapshotting the same way resources opt in to
//     world-snapshot via IPersistableResource.
//   - StateSnapshot: registers parts in a fixed order, frames each
//     part with its key + a length prefix (so a corrupt or
//     version-skewed part throws inside its own window instead of
//     bleeding into the next), and hashes the whole frame.
//
// Not a security primitive. FNV-1a is a fast non-cryptographic
// checksum - it answers "did these two runs diverge", not "did
// someone tamper with this".
// "LSN1" as little-endian bytes (0x4C 0x53 0x4E 0x31).
const SNAPSHOT_MAGIC = 0x314e534c;
export const STATE_SNAPSHOT_VERSION = 1;
// FNV-1a 32-bit hash over a byte range. Canonical constants: the
// well-known 0x811c9dc5 offset basis and 0x01000193 prime. Returns an
// unsigned 32-bit integer. Math.imul keeps the multiply in 32 bits.
export function fnv1a32(bytes, offset = 0, length = bytes.length - offset) {
    let h = 0x811c9dc5;
    const end = offset + length;
    for (let i = offset; i < end; i++) {
        h ^= bytes[i] ?? 0;
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}
// Shared UTF-8 codec for writeString / readString. Module-level so
// per-tick string serialization does not allocate a fresh codec on
// every call. The decoder is fatal: malformed bytes throw rather
// than decoding to U+FFFD, matching SnapshotReader's "throw, never
// return silent garbage" contract.
const STRING_ENCODER = new TextEncoder();
const STRING_DECODER = new TextDecoder('utf-8', { fatal: true });
// Growable canonical-little-endian byte writer. Reusable: reset()
// keeps the backing buffer so steady-state per-tick serialization
// allocates nothing.
export class SnapshotWriter {
    buf;
    view;
    u8;
    len = 0;
    constructor(initialCapacity = 1024) {
        const cap = initialCapacity < 16 ? 16 : initialCapacity;
        this.buf = new ArrayBuffer(cap);
        this.view = new DataView(this.buf);
        this.u8 = new Uint8Array(this.buf);
    }
    get length() {
        return this.len;
    }
    // Discard written content, keep the buffer.
    reset() {
        this.len = 0;
    }
    ensure(extra) {
        const need = this.len + extra;
        if (need <= this.buf.byteLength)
            return;
        let cap = this.buf.byteLength;
        while (cap < need)
            cap *= 2;
        const next = new ArrayBuffer(cap);
        new Uint8Array(next).set(this.u8);
        this.buf = next;
        this.view = new DataView(next);
        this.u8 = new Uint8Array(next);
    }
    writeU8(v) {
        this.ensure(1);
        this.view.setUint8(this.len, v & 0xff);
        this.len += 1;
    }
    writeU16(v) {
        this.ensure(2);
        this.view.setUint16(this.len, v & 0xffff, true);
        this.len += 2;
    }
    writeU32(v) {
        this.ensure(4);
        this.view.setUint32(this.len, v >>> 0, true);
        this.len += 4;
    }
    writeI32(v) {
        this.ensure(4);
        this.view.setInt32(this.len, v | 0, true);
        this.len += 4;
    }
    writeF32(v) {
        this.ensure(4);
        this.view.setFloat32(this.len, v, true);
        this.len += 4;
    }
    writeF64(v) {
        this.ensure(8);
        this.view.setFloat64(this.len, v, true);
        this.len += 8;
    }
    // Self-describing slices: a u32 element count, then the elements.
    // `count` lets a caller serialize only the meaningful prefix of an
    // over-allocated pool array (e.g. [0, highWaterMark)). The matching
    // reader returns a fresh typed array of exactly `count` length.
    writeU8Slice(arr, count) {
        const n = count < 0 ? 0 : (count > arr.length ? arr.length : count);
        this.writeU32(n);
        this.ensure(n);
        this.u8.set(n === arr.length ? arr : arr.subarray(0, n), this.len);
        this.len += n;
    }
    writeU32Slice(arr, count) {
        const n = count < 0 ? 0 : (count > arr.length ? arr.length : count);
        this.writeU32(n);
        this.ensure(n * 4);
        for (let i = 0; i < n; i++) {
            this.view.setUint32(this.len, (arr[i] ?? 0) >>> 0, true);
            this.len += 4;
        }
    }
    writeI32Slice(arr, count) {
        const n = count < 0 ? 0 : (count > arr.length ? arr.length : count);
        this.writeU32(n);
        this.ensure(n * 4);
        for (let i = 0; i < n; i++) {
            this.view.setInt32(this.len, (arr[i] ?? 0) | 0, true);
            this.len += 4;
        }
    }
    writeF32Slice(arr, count) {
        const n = count < 0 ? 0 : (count > arr.length ? arr.length : count);
        this.writeU32(n);
        this.ensure(n * 4);
        for (let i = 0; i < n; i++) {
            this.view.setFloat32(this.len, arr[i] ?? 0, true);
            this.len += 4;
        }
    }
    // Length-prefixed ASCII key. snapshotKeys are engine-internal
    // identifiers (e.g. "loom.entity-allocator") - ASCII only, short.
    writeKey(s) {
        this.writeU16(s.length);
        for (let i = 0; i < s.length; i++) {
            this.writeU8(s.charCodeAt(i) & 0xff);
        }
    }
    // Length-prefixed UTF-8 string: a u32 byte count, then the UTF-8
    // bytes. Distinct from writeKey, which is ASCII-only for short
    // engine identifiers - writeString carries arbitrary user-facing
    // text (interactable prompts, animation clip names) and must
    // survive non-ASCII, since the engine ships Thai and Russian copy.
    // TextEncoder is WHATWG-standard UTF-8 on every target runtime, so
    // the bytes are byte-identical for cross-runtime determinism.
    writeString(s) {
        const bytes = STRING_ENCODER.encode(s);
        this.writeU32(bytes.length);
        this.ensure(bytes.length);
        this.u8.set(bytes, this.len);
        this.len += bytes.length;
    }
    // Reserve a u32 slot and return its offset; patchU32 backfills it
    // later. StateSnapshot uses this to write each part's blob length
    // once the part has finished writing.
    reserveU32() {
        const at = this.len;
        this.writeU32(0);
        return at;
    }
    patchU32(offset, v) {
        this.view.setUint32(offset, v >>> 0, true);
    }
    // A view of the written bytes. Valid only until the next write or
    // reset() - copy it if you need to retain it. hash() consumes it
    // immediately, which is the safe path.
    bytes() {
        return this.u8.subarray(0, this.len);
    }
}
// Reader symmetric to SnapshotWriter. Every read is bounds-checked -
// an over-read throws rather than returning silent garbage.
export class SnapshotReader {
    view;
    u8;
    off = 0;
    end;
    constructor(bytes) {
        this.u8 = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.end = bytes.byteLength;
    }
    get offset() {
        return this.off;
    }
    get remaining() {
        return this.end - this.off;
    }
    need(n) {
        if (this.off + n > this.end) {
            throw new Error('SnapshotReader: over-read - need ' + n + ' bytes at offset '
                + this.off + ', only ' + (this.end - this.off) + ' remain');
        }
    }
    readU8() {
        this.need(1);
        const v = this.view.getUint8(this.off);
        this.off += 1;
        return v;
    }
    readU16() {
        this.need(2);
        const v = this.view.getUint16(this.off, true);
        this.off += 2;
        return v;
    }
    readU32() {
        this.need(4);
        const v = this.view.getUint32(this.off, true);
        this.off += 4;
        return v;
    }
    readI32() {
        this.need(4);
        const v = this.view.getInt32(this.off, true);
        this.off += 4;
        return v;
    }
    readF32() {
        this.need(4);
        const v = this.view.getFloat32(this.off, true);
        this.off += 4;
        return v;
    }
    readF64() {
        this.need(8);
        const v = this.view.getFloat64(this.off, true);
        this.off += 8;
        return v;
    }
    // Returns a fresh Uint8Array that owns its bytes (a copy), so the
    // restored consumer is not aliased to the snapshot buffer.
    readU8Slice() {
        const n = this.readU32();
        this.need(n);
        const out = this.u8.slice(this.off, this.off + n);
        this.off += n;
        return out;
    }
    readU32Slice() {
        const n = this.readU32();
        this.need(n * 4);
        const out = new Uint32Array(n);
        for (let i = 0; i < n; i++) {
            out[i] = this.view.getUint32(this.off, true);
            this.off += 4;
        }
        return out;
    }
    readI32Slice() {
        const n = this.readU32();
        this.need(n * 4);
        const out = new Int32Array(n);
        for (let i = 0; i < n; i++) {
            out[i] = this.view.getInt32(this.off, true);
            this.off += 4;
        }
        return out;
    }
    readF32Slice() {
        const n = this.readU32();
        this.need(n * 4);
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            out[i] = this.view.getFloat32(this.off, true);
            this.off += 4;
        }
        return out;
    }
    readKey() {
        const len = this.readU16();
        this.need(len);
        let s = '';
        for (let i = 0; i < len; i++) {
            s += String.fromCharCode(this.view.getUint8(this.off + i));
        }
        this.off += len;
        return s;
    }
    // Symmetric to SnapshotWriter.writeString: a u32 byte count, then
    // that many UTF-8 bytes. The decoder is fatal - malformed bytes
    // throw rather than decoding to U+FFFD, the same fail-loud contract
    // as an over-read.
    readString() {
        const n = this.readU32();
        this.need(n);
        const s = STRING_DECODER.decode(this.u8.subarray(this.off, this.off + n));
        this.off += n;
        return s;
    }
    // Carve a bounded sub-view of the next `n` bytes and advance the
    // cursor past them. StateSnapshot wraps each part's blob in its own
    // SnapshotReader so a buggy restoreFrom throws inside its window.
    readBlob(n) {
        this.need(n);
        const out = this.u8.subarray(this.off, this.off + n);
        this.off += n;
        return out;
    }
}
// Duck-type guard for ISnapshotable. The World holds pools and
// resources as opaque values; this is how snapshotState() discovers
// which of them can take part in a snapshot.
export function isSnapshotable(x) {
    if (typeof x !== 'object' || x === null)
        return false;
    const s = x;
    return (typeof s.snapshotKey === 'string'
        && typeof s.snapshotInto === 'function'
        && typeof s.restoreFrom === 'function');
}
// Registers an ordered set of ISnapshotable parts and serializes them
// into a single canonical frame that can be hashed (per-tick
// determinism fingerprint) or restored (rewind / replay).
//
// Frame layout:
//   [magic u32][version u32][partCount u32]
//   per part: [keyLen u16][key bytes][blobLen u32][blob bytes]
export class StateSnapshot {
    parts = [];
    keys = new Set();
    writer;
    constructor(initialCapacity = 4096) {
        this.writer = new SnapshotWriter(initialCapacity);
    }
    get partCount() {
        return this.parts.length;
    }
    // Register a part. Registration order is the canonical part order
    // in the serialized frame - register the same parts in the same
    // order on every runtime being compared.
    register(part) {
        if (this.keys.has(part.snapshotKey)) {
            throw new Error('StateSnapshot: duplicate snapshotKey "' + part.snapshotKey + '"');
        }
        this.parts.push(part);
        this.keys.add(part.snapshotKey);
    }
    // Serialize every registered part into canonical bytes. Reuses the
    // internal writer buffer - the returned view is valid only until
    // the next serialize() / hash() call.
    serialize() {
        const w = this.writer;
        w.reset();
        w.writeU32(SNAPSHOT_MAGIC);
        w.writeU32(STATE_SNAPSHOT_VERSION);
        w.writeU32(this.parts.length);
        for (let i = 0; i < this.parts.length; i++) {
            const part = this.parts[i];
            w.writeKey(part.snapshotKey);
            const lenAt = w.reserveU32();
            const blobStart = w.length;
            part.snapshotInto(w);
            w.patchU32(lenAt, w.length - blobStart);
        }
        return w.bytes();
    }
    // FNV-1a fingerprint of the serialized frame. This is the per-tick
    // determinism check: identical state on any runtime hashes
    // identically; any divergence is a determinism bug.
    hash() {
        return fnv1a32(this.serialize());
    }
    // Restore every registered part from a frame produced by
    // serialize(). Strict: magic, version and partCount must match, the
    // parts must appear in the registered order, and each part must
    // consume exactly its blob. Anything else throws - this serializer
    // restores within one engine version (rewind / replay), so a
    // mismatch is a bug, not a migration.
    restore(bytes) {
        const r = new SnapshotReader(bytes);
        const magic = r.readU32();
        if (magic !== SNAPSHOT_MAGIC) {
            throw new Error('StateSnapshot.restore: bad magic 0x' + (magic >>> 0).toString(16));
        }
        const version = r.readU32();
        if (version !== STATE_SNAPSHOT_VERSION) {
            throw new Error('StateSnapshot.restore: version ' + version + ' != expected '
                + STATE_SNAPSHOT_VERSION);
        }
        const count = r.readU32();
        if (count !== this.parts.length) {
            throw new Error('StateSnapshot.restore: frame has ' + count + ' parts, '
                + this.parts.length + ' registered');
        }
        for (let i = 0; i < count; i++) {
            const part = this.parts[i];
            const key = r.readKey();
            if (key !== part.snapshotKey) {
                throw new Error('StateSnapshot.restore: part ' + i + ' key "' + key
                    + '" != registered "' + part.snapshotKey + '"');
            }
            const blobLen = r.readU32();
            const blob = r.readBlob(blobLen);
            const pr = new SnapshotReader(blob);
            part.restoreFrom(pr);
            if (pr.remaining !== 0) {
                throw new Error('StateSnapshot.restore: part "' + key + '" left ' + pr.remaining
                    + ' of ' + blobLen + ' bytes unconsumed');
            }
        }
    }
}
//# sourceMappingURL=state-snapshot.js.map