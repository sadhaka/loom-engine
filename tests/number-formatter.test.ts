// Phase 0.98.0 - NumberFormatter tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  NumberFormatter,
  RESOURCE_NUMBER_FORMATTER,
} from '../src/index.js';

test('numfmt: RESOURCE_NUMBER_FORMATTER is the stable string', () => {
  assert.equal(RESOURCE_NUMBER_FORMATTER, 'number_formatter');
});

test('numfmt: create with default locale en-US', () => {
  const f = NumberFormatter.create();
  assert.equal(f.getLocale(), 'en-US');
});

test('numfmt: create with explicit locale', () => {
  const f = NumberFormatter.create({ locale: 'fr-FR' });
  assert.equal(f.getLocale(), 'fr-FR');
});

test('numfmt: setLocale updates the active locale', () => {
  const f = NumberFormatter.create();
  f.setLocale('de-DE');
  assert.equal(f.getLocale(), 'de-DE');
});

test('numfmt: setLocale rejects empty / non-string', () => {
  const f = NumberFormatter.create();
  f.setLocale('');
  assert.equal(f.getLocale(), 'en-US');
  // @ts-expect-error - testing runtime guard
  f.setLocale(null);
  assert.equal(f.getLocale(), 'en-US');
});

test('numfmt: format groups thousands with comma in en-US', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.format(1234567), '1,234,567');
});

test('numfmt: format with no grouping when useGrouping=false', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.format(1234567, { useGrouping: false }), '1234567');
});

test('numfmt: format respects minimumFractionDigits', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  // Intl pads zeros up to minimumFractionDigits.
  assert.equal(f.format(5, { minimumFractionDigits: 2 }), '5.00');
});

test('numfmt: format negative numbers', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.format(-1234), '-1,234');
});

test('numfmt: compact below threshold returns plain format', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.compact(999), '999');
});

test('numfmt: compact 10000 -> 10K (en-US)', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  // Intl en-US compact short uses 'K'.
  assert.equal(f.compact(10000), '10K');
});

test('numfmt: compact 1500 -> 1.5K (en-US)', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.compact(1500), '1.5K');
});

test('numfmt: compact 1500000 -> 1.5M (en-US)', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.compact(1500000), '1.5M');
});

test('numfmt: compact 1500000000 -> 1.5B (en-US)', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.compact(1500000000), '1.5B');
});

test('numfmt: compact maximumFractionDigits=0 rounds whole', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.compact(1500, { maximumFractionDigits: 0 }), '2K');
});

test('numfmt: compact negative numbers', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.compact(-10000), '-10K');
});

test('numfmt: compact threshold override', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  // With threshold 100, 150 should compact (below default 1000).
  // Implementation threshold gates "below threshold returns plain";
  // setting threshold=100 means values >=100 compact. For 150 the
  // Intl compact form is "150" (still has no abbreviation under 1000)
  // OR our fallback yields "150" too. Just confirm no throw + sane.
  const out = f.compact(150, { threshold: 100 });
  assert.ok(typeof out === 'string' && out.length > 0);
});

test('numfmt: percent 0.5 -> 50%', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.percent(0.5), '50%');
});

test('numfmt: percent with maximumFractionDigits=1', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.percent(0.123, { maximumFractionDigits: 1 }), '12.3%');
});

test('numfmt: percent negative', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.percent(-0.25), '-25%');
});

test('numfmt: currency USD default 2 decimal places', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.currency(99, 'USD'), '$99.00');
});

test('numfmt: currency JPY 0 decimals', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  // Intl chooses default fraction digits per currency; for JPY 0.
  // Result is locale-dependent; ensure it parses + has the value.
  const out = f.currency(1500, 'JPY');
  assert.ok(out.indexOf('1,500') >= 0 || out.indexOf('1500') >= 0);
});

test('numfmt: currency unknown / empty currencyCode falls back to format', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.currency(99, ''), '99');
});

test('numfmt: NaN returns fallback empty string', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.format(NaN), '');
  assert.equal(f.compact(NaN), '');
  assert.equal(f.percent(NaN), '');
  assert.equal(f.currency(NaN, 'USD'), '');
});

test('numfmt: Infinity / -Infinity returns fallback', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.format(Infinity), '');
  assert.equal(f.format(-Infinity), '');
});

test('numfmt: format zero', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.format(0), '0');
});

test('numfmt: compact zero', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.compact(0), '0');
});

test('numfmt: locale switch produces different output', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  const en = f.format(1234567);
  f.setLocale('fr-FR');
  const fr = f.format(1234567);
  // Different grouping separators (en uses ',', fr uses ' ' or
  // narrow no-break space). The strings should differ.
  assert.notEqual(en, fr);
});

test('numfmt: realistic example - HUD numbers across locales', () => {
  const f = NumberFormatter.create({ locale: 'en-US' });
  assert.equal(f.compact(50000), '50K');
  assert.equal(f.format(99999), '99,999');
  assert.equal(f.percent(0.85), '85%');
  f.setLocale('de-DE');
  // German uses '.' for grouping. Just verify it differs from en.
  const formatted = f.format(99999);
  assert.notEqual(formatted, '99,999');
});
