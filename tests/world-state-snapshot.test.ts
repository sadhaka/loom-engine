// WorldStateSnapshot tests - v3.0 Phase 1.
//
// Pins the cross-language golden vector (test_vectors/v3_0_snapshot_canonical.json)
// against the real TS implementation, plus unit coverage of the sort rule, the
// integrity verify, fail-closed canonicalization, and the eventIndex-is-metadata
// property. The Rust + Python ports must reproduce the same vector byte-for-byte.
//
// Astral chars are built from codepoints (String.fromCodePoint / fromCharCode)
// so the test source stays pure-ASCII and cannot be corrupted by an editor /
// filesystem on the Windows mount.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  canonicalWorldState,
  worldStateHash,
  snapshotWorldState,
  verifyWorldSnapshot,
  normalizeTags,
} from '../src/runtime/world-state-snapshot.js';

var here = dirname(fileURLToPath(import.meta.url));
var vectorPath = join(here, '..', 'test_vectors', 'v3_0_snapshot_canonical.json');
var vector = JSON.parse(readFileSync(vectorPath, 'utf8'));

test('golden vector: canonical encoding + state hash match for every case', function () {
  assert.ok(vector.cases.length >= 5, 'expected >= 5 golden cases');
  for (var i = 0; i < vector.cases.length; i++) {
    var c = vector.cases[i];
    assert.strictEqual(
      canonicalWorldState(c.input), c.expect_canonical, 'canonical mismatch: ' + c.label);
    assert.strictEqual(
      worldStateHash(c.key, c.input), c.expect_hash, 'hash mismatch: ' + c.label);
  }
});

test('normalizeTags: dedupe + UTF-16 order (astral before high-BMP)', function () {
  var astral = String.fromCodePoint(0x1F40D); // UTF-16 lead 0xD83D
  var bmp = String.fromCharCode(0xF8FF);       // BMP 0xF8FF
  // UTF-16 code-unit order: 'a' (0x61) < astral (0xD83D) < bmp (0xF8FF).
  // A UTF-8 / byte sort would give 'a', bmp, astral - this asserts UTF-16.
  assert.deepStrictEqual(
    normalizeTags([bmp, astral, 'a', 'a', astral]), ['a', astral, bmp]);
  assert.deepStrictEqual(normalizeTags([]), []);
  assert.throws(function () { normalizeTags(['ok', 5 as unknown as string]); });
});

test('verifyWorldSnapshot: true on match, false on any tamper (constant-time)', function () {
  var key = 'runtime-secret';
  var state = { epoch: 1, worldSeed: 2, entities: { hero: { properties: { hp: 10 }, tags: [] } } };
  var h = worldStateHash(key, state);
  assert.strictEqual(verifyWorldSnapshot(key, state, h), true);
  // any field change flips the hash
  var tampered = { epoch: 1, worldSeed: 3, entities: { hero: { properties: { hp: 10 }, tags: [] } } };
  assert.strictEqual(verifyWorldSnapshot(key, tampered, h), false);
  // wrong key fails
  assert.strictEqual(verifyWorldSnapshot('other-key', state, h), false);
});

test('snapshotWorldState: returns {eventIndex, stateHash}; validates index fail-closed', function () {
  var snap = snapshotWorldState({
    key: 'k', state: { epoch: 0, worldSeed: 0, entities: {} }, eventIndex: 42 });
  assert.strictEqual(snap.eventIndex, 42);
  assert.match(snap.stateHash, /^[0-9a-f]{64}$/);
  assert.throws(function () {
    snapshotWorldState({ key: 'k', state: { entities: {} }, eventIndex: -1 }); }, /eventIndex/);
  assert.throws(function () {
    snapshotWorldState({ key: 'k', state: { entities: {} }, eventIndex: 1.5 }); }, /eventIndex/);
});

test('fail-closed: non-canonical state throws before any hash is produced', function () {
  assert.throws(function () { worldStateHash('k', { x: 1.5 }); }, /safe integer/);          // float
  assert.throws(function () { worldStateHash('k', { x: -0 }); }, /negative zero/);           // -0
  assert.throws(function () { worldStateHash('k', { x: 9007199254740993 }); }, /safe integer/); // unsafe int
  assert.throws(function () { worldStateHash('k', { d: new Date() }); }, /plain objects/);   // non-plain
  assert.throws(function () { worldStateHash('k', { n: NaN }); }, /non-finite/);             // NaN
});

test('eventIndex is metadata: identical state hashes identically regardless of index', function () {
  var state = { epoch: 5, worldSeed: 9, entities: { a: { properties: { hp: 1 }, tags: [] } } };
  var s1 = snapshotWorldState({ key: 'k', state: state, eventIndex: 10 });
  var s2 = snapshotWorldState({ key: 'k', state: state, eventIndex: 999 });
  assert.strictEqual(s1.stateHash, s2.stateHash);
  assert.notStrictEqual(s1.eventIndex, s2.eventIndex);
});

test('insertion order does not affect the hash (keys are sorted)', function () {
  var a = { epoch: 1, worldSeed: 1, entities: { x: { properties: { b: 2, a: 1 }, tags: [] } } };
  var b = { epoch: 1, worldSeed: 1, entities: { x: { properties: { a: 1, b: 2 }, tags: [] } } };
  assert.strictEqual(worldStateHash('k', a), worldStateHash('k', b));
});
