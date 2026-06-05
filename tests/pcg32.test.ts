// PCG32 + floorDiv cross-language parity - v3.0.
//
// Asserts the TS PCG32 + floorDiv reproduce the authoritative Rust loom_math
// reference (test_vectors/v3_pcg32.json), bit-for-bit. The Python port asserts
// the same vector. If TS, Rust, and Python all reproduce it, dice + AST math are
// deterministic across every surface.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Pcg32 } from '../src/runtime/pcg32.js';
import { floorDiv, floorMod } from '../src/runtime/integer-math.js';

var here = dirname(fileURLToPath(import.meta.url));
var vec = JSON.parse(readFileSync(join(here, '..', 'test_vectors', 'v3_pcg32.json'), 'utf8'));

test('PCG32 reproduces the Rust reference: seed 42, next 8', function () {
  var r = Pcg32.seeded(42n);
  var got: number[] = [];
  for (var i = 0; i < 8; i++) got.push(r.nextU32());
  assert.deepStrictEqual(got, vec.pcg32.seed42_next8);
});

test('PCG32 reproduces the Rust reference: seed 1, next 4', function () {
  var r = Pcg32.seeded(1n);
  var got: number[] = [];
  for (var i = 0; i < 4; i++) got.push(r.nextU32());
  assert.deepStrictEqual(got, vec.pcg32.seed1_next4);
});

test('PCG32 dice match Rust: roll_dice(3,6) + roll_die(20) x5, seed 7', function () {
  assert.strictEqual(Pcg32.seeded(7n).rollDice(3, 6), vec.pcg32.seed7_roll3d6);
  var r = Pcg32.seeded(7n);
  var dies: number[] = [];
  for (var i = 0; i < 5; i++) dies.push(r.rollDie(20));
  assert.deepStrictEqual(dies, vec.pcg32.seed7_die20x5);
});

test('PCG32 is replayable (same seed -> same sequence over 200 draws)', function () {
  var a = Pcg32.seeded(123456789n);
  var b = Pcg32.seeded(123456789n);
  for (var i = 0; i < 200; i++) assert.strictEqual(a.nextU32(), b.nextU32());
});

test('rollDie stays in 1..=sides; d0 -> 0', function () {
  var r = Pcg32.seeded(99n);
  for (var i = 0; i < 5000; i++) {
    var d = r.rollDie(20);
    assert.ok(d >= 1 && d <= 20, 'd20 out of range: ' + d);
  }
  assert.strictEqual(Pcg32.seeded(1n).rollDie(0), 0);
});

test('floorDiv matches the Rust floor_div golden cases', function () {
  for (var i = 0; i < vec.floor_div.length; i++) {
    var c = vec.floor_div[i];
    assert.strictEqual(floorDiv(c.a, c.b), c.q, c.a + '/' + c.b + ' expected ' + c.q);
  }
});

test('floorDiv * b + floorMod == a (identity, incl negatives)', function () {
  var pairs = [[7, 3], [-7, 3], [7, -3], [-7, -3], [10, 4], [-9, -1], [9, -1]];
  for (var i = 0; i < pairs.length; i++) {
    var a = pairs[i][0] as number;
    var b = pairs[i][1] as number;
    assert.strictEqual(floorDiv(a, b) * b + floorMod(a, b), a, a + ',' + b);
  }
});

test('floorDiv is exact near 2^53 (where float division mis-rounds)', function () {
  // 2^53-1 divided by small primes: BigInt-exact, float-truncation would risk off-by-one.
  assert.strictEqual(floorDiv(9007199254740991, 3), 3002399751580330);
  assert.strictEqual(floorDiv(9007199254740991, 7), 1286742750677284);
  assert.strictEqual(floorDiv(-9007199254740991, 7), -1286742750677285);
});
