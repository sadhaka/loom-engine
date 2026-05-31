// hmacSha256 - dependency-free synchronous HMAC-SHA-256 (FIPS 180-4 + RFC 2104).
//
// 2.2.0 enabling primitive for EventChain. The engine's other crypto
// (sealed-asset.ts) uses ASYNC Web Crypto (crypto.subtle); EventChain needs
// a SYNCHRONOUS signer so append() / verify() stay sync like every other
// kernel (EventLog, Entropy). This is a small, self-contained SHA-256 + HMAC
// verified against the published NIST SHA-256 and RFC 4231 HMAC-SHA-256 test
// vectors (see tests/hmac-sha256.test.ts), so consumers do not have to pull a
// crypto dependency or thread Promises through their event tape.
//
// SCOPE: this is an INTEGRITY primitive (tamper-evidence), NOT a secrecy
// primitive. The HMAC key is supplied by the caller at runtime and is never
// stored or logged by the engine. Output is self-consistent within the engine
// (sign + verify here); it is NOT promised to be byte-compatible with other
// languages' JSON serialisation or HMAC framing.
//
//   var sig = hmacSha256Hex('runtime-secret', 'message');  // 64-char lowercase hex
//
// Isomorphic: depends only on TextEncoder (browser + Node 11+) and typed
// arrays. No Node 'crypto', no Web Crypto, no allocations beyond the working
// buffers.
//
// Code style: var-only in browser source (matches event-log.ts). Typed-array
// reads use `?? 0` to satisfy noUncheckedIndexedAccess (matches bestiary.ts).
// SHA-256 round constants (FIPS 180-4 sec 4.2.2): first 32 bits of the
// fractional parts of the cube roots of the first 64 primes.
const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
// Initial hash values (FIPS 180-4 sec 5.3.3): first 32 bits of the fractional
// parts of the square roots of the first 8 primes.
const SHA256_H0 = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);
const SHA256_BLOCK_BYTES = 64;
function rotr32(x, n) {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
}
// UTF-8 encode a string; pass typed arrays through untouched.
function toBytes(input) {
    if (typeof input === 'string')
        return new TextEncoder().encode(input);
    return input;
}
function toHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
        var b = bytes[i] ?? 0;
        hex += (b < 16 ? '0' : '') + b.toString(16);
    }
    return hex;
}
// Core SHA-256 over a byte array -> 32-byte digest.
export function sha256Bytes(msg) {
    var msgLen = msg.length;
    // Padded length: smallest multiple of 64 that fits msgLen + 0x80 + 8-byte
    // length field.
    var totalLen = (((msgLen + 8) >> 6) + 1) << 6;
    var buf = new Uint8Array(totalLen);
    buf.set(msg, 0);
    buf[msgLen] = 0x80;
    // 64-bit big-endian message length in BITS in the final 8 bytes.
    var bitLenHi = Math.floor(msgLen / 0x20000000); // (msgLen * 8) / 2^32
    var bitLenLo = (msgLen * 8) >>> 0;
    buf[totalLen - 8] = (bitLenHi >>> 24) & 0xff;
    buf[totalLen - 7] = (bitLenHi >>> 16) & 0xff;
    buf[totalLen - 6] = (bitLenHi >>> 8) & 0xff;
    buf[totalLen - 5] = bitLenHi & 0xff;
    buf[totalLen - 4] = (bitLenLo >>> 24) & 0xff;
    buf[totalLen - 3] = (bitLenLo >>> 16) & 0xff;
    buf[totalLen - 2] = (bitLenLo >>> 8) & 0xff;
    buf[totalLen - 1] = bitLenLo & 0xff;
    var H = new Uint32Array(SHA256_H0); // working copy of the initial state
    var W = new Uint32Array(64);
    for (var off = 0; off < totalLen; off += 64) {
        var t = 0;
        for (; t < 16; t++) {
            var j = off + t * 4;
            W[t] = (((buf[j] ?? 0) << 24) | ((buf[j + 1] ?? 0) << 16)
                | ((buf[j + 2] ?? 0) << 8) | (buf[j + 3] ?? 0)) >>> 0;
        }
        for (; t < 64; t++) {
            var w15 = W[t - 15] ?? 0;
            var s0 = (rotr32(w15, 7) ^ rotr32(w15, 18) ^ (w15 >>> 3)) >>> 0;
            var w2 = W[t - 2] ?? 0;
            var s1 = (rotr32(w2, 17) ^ rotr32(w2, 19) ^ (w2 >>> 10)) >>> 0;
            W[t] = ((W[t - 16] ?? 0) + s0 + (W[t - 7] ?? 0) + s1) >>> 0;
        }
        var a = H[0] ?? 0, b = H[1] ?? 0, c = H[2] ?? 0, d = H[3] ?? 0;
        var e = H[4] ?? 0, f = H[5] ?? 0, g = H[6] ?? 0, h = H[7] ?? 0;
        for (var i = 0; i < 64; i++) {
            var bigS1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
            var ch = ((e & f) ^ (~e & g)) >>> 0;
            var temp1 = (h + bigS1 + ch + (SHA256_K[i] ?? 0) + (W[i] ?? 0)) >>> 0;
            var bigS0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
            var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
            var temp2 = (bigS0 + maj) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }
        H[0] = ((H[0] ?? 0) + a) >>> 0;
        H[1] = ((H[1] ?? 0) + b) >>> 0;
        H[2] = ((H[2] ?? 0) + c) >>> 0;
        H[3] = ((H[3] ?? 0) + d) >>> 0;
        H[4] = ((H[4] ?? 0) + e) >>> 0;
        H[5] = ((H[5] ?? 0) + f) >>> 0;
        H[6] = ((H[6] ?? 0) + g) >>> 0;
        H[7] = ((H[7] ?? 0) + h) >>> 0;
    }
    var out = new Uint8Array(32);
    for (var k = 0; k < 8; k++) {
        var hv = H[k] ?? 0;
        out[k * 4] = (hv >>> 24) & 0xff;
        out[k * 4 + 1] = (hv >>> 16) & 0xff;
        out[k * 4 + 2] = (hv >>> 8) & 0xff;
        out[k * 4 + 3] = hv & 0xff;
    }
    return out;
}
// SHA-256 of a string (UTF-8) or byte array -> 64-char lowercase hex.
export function sha256Hex(input) {
    return toHex(sha256Bytes(toBytes(input)));
}
// HMAC-SHA-256 (RFC 2104) -> 32-byte digest.
export function hmacSha256Bytes(key, message) {
    var keyBytes = toBytes(key);
    // Keys longer than the block size are hashed down first (RFC 2104).
    if (keyBytes.length > SHA256_BLOCK_BYTES) {
        keyBytes = sha256Bytes(keyBytes);
    }
    var ipad = new Uint8Array(SHA256_BLOCK_BYTES);
    var opad = new Uint8Array(SHA256_BLOCK_BYTES);
    for (var i = 0; i < SHA256_BLOCK_BYTES; i++) {
        // Reads past keyBytes.length are undefined -> 0, which is exactly the
        // RFC zero-padding of the key up to the block size.
        var kb = keyBytes[i] ?? 0;
        ipad[i] = kb ^ 0x36;
        opad[i] = kb ^ 0x5c;
    }
    var msgBytes = toBytes(message);
    var inner = new Uint8Array(SHA256_BLOCK_BYTES + msgBytes.length);
    inner.set(ipad, 0);
    inner.set(msgBytes, SHA256_BLOCK_BYTES);
    var innerHash = sha256Bytes(inner);
    var outer = new Uint8Array(SHA256_BLOCK_BYTES + innerHash.length);
    outer.set(opad, 0);
    outer.set(innerHash, SHA256_BLOCK_BYTES);
    return sha256Bytes(outer);
}
// HMAC-SHA-256 -> 64-char lowercase hex. The canonical signer for EventChain.
export function hmacSha256Hex(key, message) {
    return toHex(hmacSha256Bytes(key, message));
}
// Constant-time equality for two hex strings (e.g. HMAC outputs). Avoids
// leaking how many leading characters matched via early-exit timing, which
// matters if verification ever runs in an online / oracle context. Length is
// not secret, so a length mismatch returns false immediately.
export function timingSafeEqualHex(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string')
        return false;
    if (a.length !== b.length)
        return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}
//# sourceMappingURL=hmac-sha256.js.map