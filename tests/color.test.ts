// Phase 0.33.0 - Color utility tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  rgba,
  clamp01,
  parseHex,
  toHexString,
  colorBlend,
  adjustHsl,
  pack32,
  unpack32,
} from '../src/util/color.js';


test('color: rgba builds object', function () {
  var c = rgba(0.5, 0.6, 0.7, 0.8);
  assert.equal(c.r, 0.5);
  assert.equal(c.a, 0.8);
});

test('color: clamp01 rejects NaN to 0', function () {
  assert.equal(clamp01(NaN), 0);
  assert.equal(clamp01(Infinity), 0);
  assert.equal(clamp01(-Infinity), 0);
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(0.5), 0.5);
});

test('color: parseHex 6-digit', function () {
  var c = parseHex('#ff8000');
  assert.ok(c);
  assert.ok(Math.abs(c!.r - 1) < 0.001);
  assert.ok(Math.abs(c!.g - 0.5019) < 0.005);
  assert.equal(c!.b, 0);
  assert.equal(c!.a, 1);
});

test('color: parseHex 8-digit with alpha', function () {
  var c = parseHex('#ff800080');
  assert.ok(c);
  assert.ok(Math.abs(c!.a - 0.502) < 0.005);
});

test('color: parseHex 3-digit shorthand', function () {
  var c = parseHex('#f80');
  assert.ok(c);
  assert.equal(c!.r, 1);
  assert.ok(Math.abs(c!.g - 0.533) < 0.01);
  assert.equal(c!.b, 0);
});

test('color: parseHex 4-digit shorthand with alpha', function () {
  var c = parseHex('#f808');
  assert.ok(c);
  assert.equal(c!.r, 1);
  assert.equal(c!.b, 0);
  // 8 -> 88 -> 0.533.
  assert.ok(Math.abs(c!.a - 0.533) < 0.01);
});

test('color: parseHex without # prefix', function () {
  var c = parseHex('ff8000');
  assert.ok(c);
  assert.equal(c!.r, 1);
});

test('color: parseHex returns null for invalid', function () {
  assert.equal(parseHex('xyz'), null);
  assert.equal(parseHex('#xyzxyz'), null);
  assert.equal(parseHex('#12345'), null);  // odd length
});

test('color: toHexString round-trips with alpha=1 -> 6 digits', function () {
  var c = rgba(1, 0.5, 0, 1);
  assert.equal(toHexString(c), '#ff8000');
});

test('color: toHexString with alpha < 1 -> 8 digits', function () {
  var c = rgba(1, 0.5, 0, 0.5);
  // 0.5 * 255 = 127.5 -> rounds to 128 = 0x80.
  assert.equal(toHexString(c), '#ff800080');
});

test('color: parseHex -> toHexString round-trip', function () {
  var c = parseHex('#aabbccdd');
  assert.ok(c);
  assert.equal(toHexString(c!), '#aabbccdd');
});

test('color: colorBlend - opaque over opaque returns over', function () {
  var over = rgba(1, 0, 0, 1);
  var under = rgba(0, 1, 0, 1);
  var out = colorBlend(over, under);
  assert.equal(out.r, 1);
  assert.equal(out.g, 0);
  assert.equal(out.a, 1);
});

test('color: colorBlend - transparent over opaque returns under', function () {
  var over = rgba(1, 0, 0, 0);
  var under = rgba(0, 1, 0, 1);
  var out = colorBlend(over, under);
  assert.ok(Math.abs(out.g - 1) < 0.001);
  assert.equal(out.a, 1);
});

test('color: colorBlend - transparent over transparent is fully transparent black', function () {
  var over = rgba(1, 0, 0, 0);
  var under = rgba(0, 1, 0, 0);
  var out = colorBlend(over, under);
  assert.equal(out.a, 0);
  assert.equal(out.r, 0);
});

test('color: adjustHsl shifts hue by 120deg', function () {
  var red = rgba(1, 0, 0, 1);
  var shifted = adjustHsl(red, 120, 0, 0);
  assert.ok(shifted.g > 0.9);
  assert.ok(shifted.r < 0.1);
  assert.ok(shifted.b < 0.1);
});

test('color: adjustHsl preserves alpha', function () {
  var c = rgba(0.5, 0.5, 0.5, 0.7);
  var out = adjustHsl(c, 0, 0, 0.2);
  assert.equal(out.a, 0.7);
});

test('color: pack32 + unpack32 round-trip', function () {
  var packed = pack32(1, 0.5, 0, 1);
  var c = unpack32(packed);
  assert.ok(Math.abs(c.r - 1) < 0.005);
  assert.ok(Math.abs(c.g - 0.502) < 0.005);
  assert.equal(c.b, 0);
  assert.equal(c.a, 1);
});

test('color: pack32 byte order is RRGGBBAA', function () {
  var packed = pack32(1, 0, 0, 1);
  // 0xff_00_00_ff
  assert.equal(packed, 0xff0000ff);
});

test('color: pack32 clamps inputs', function () {
  var packed = pack32(2, -1, 0.5, 1.5);
  var c = unpack32(packed);
  assert.equal(c.r, 1);
  assert.equal(c.g, 0);
  assert.ok(Math.abs(c.b - 0.502) < 0.005);
  assert.equal(c.a, 1);
});
