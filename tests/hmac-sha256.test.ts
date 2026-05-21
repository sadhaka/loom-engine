import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { sha256Hex, hmacSha256Hex, timingSafeEqualHex } from '../src/index.js';

// Repeat a byte N times -> Uint8Array (for the RFC 4231 binary-key vectors).
function rep(byte: number, n: number): Uint8Array {
  const a = new Uint8Array(n);
  a.fill(byte);
  return a;
}

// --- SHA-256 known-answer vectors (NIST FIPS 180-4 examples) ---------------

test('sha256: empty-string vector', () => {
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('sha256: "abc" vector', () => {
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('sha256: 56-char multi-block vector', () => {
  assert.equal(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

// --- HMAC-SHA-256 known-answer vectors (RFC 4231) --------------------------

test('hmac-sha256: RFC 4231 TC1 (20-byte key)', () => {
  assert.equal(
    hmacSha256Hex(rep(0x0b, 20), 'Hi There'),
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
});

test('hmac-sha256: RFC 4231 TC2 (string key "Jefe")', () => {
  assert.equal(
    hmacSha256Hex('Jefe', 'what do ya want for nothing?'),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
});

test('hmac-sha256: RFC 4231 TC3 (50-byte data)', () => {
  assert.equal(
    hmacSha256Hex(rep(0xaa, 20), rep(0xdd, 50)),
    '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe');
});

test('hmac-sha256: RFC 4231 TC6 (key larger than block size)', () => {
  assert.equal(
    hmacSha256Hex(rep(0xaa, 131), 'Test Using Larger Than Block-Size Key - Hash Key First'),
    '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
});

test('hmac-sha256: RFC 4231 TC7 (key + data larger than block size)', () => {
  assert.equal(
    hmacSha256Hex(
      rep(0xaa, 131),
      'This is a test using a larger than block-size key and a larger than '
        + 'block-size data. The key needs to be hashed before being used by the '
        + 'HMAC algorithm.'),
    '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2');
});

// --- shape + sensitivity ---------------------------------------------------

test('hmac-sha256: output is 64 lowercase hex chars', () => {
  const sig = hmacSha256Hex('k', 'm');
  assert.equal(sig.length, 64);
  assert.match(sig, /^[0-9a-f]{64}$/);
});

test('hmac-sha256: different key -> different signature', () => {
  assert.notEqual(hmacSha256Hex('k1', 'msg'), hmacSha256Hex('k2', 'msg'));
});

test('hmac-sha256: single-bit message change -> different signature', () => {
  assert.notEqual(hmacSha256Hex('key', 'message'), hmacSha256Hex('key', 'messagf'));
});

// --- constant-time compare (2.2.1) -----------------------------------------

test('timingSafeEqualHex: equal strings -> true', () => {
  const sig = hmacSha256Hex('k', 'm');
  assert.equal(timingSafeEqualHex(sig, sig), true);
});

test('timingSafeEqualHex: different same-length strings -> false', () => {
  const a = hmacSha256Hex('k', 'm1');
  const b = hmacSha256Hex('k', 'm2');
  assert.equal(timingSafeEqualHex(a, b), false);
});

test('timingSafeEqualHex: length mismatch -> false', () => {
  assert.equal(timingSafeEqualHex('abcd', 'abc'), false);
  assert.equal(timingSafeEqualHex('', 'a'), false);
});
