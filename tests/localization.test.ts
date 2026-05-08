// Phase 0.46.0 - Localization tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  Localization,
  RESOURCE_LOCALIZATION,
} from '../src/index.js';

test('localization: RESOURCE_LOCALIZATION is the stable string', () => {
  assert.equal(RESOURCE_LOCALIZATION, 'localization');
});

test('localization: defaults to en locale', () => {
  const loc = Localization.create();
  assert.equal(loc.getLocale(), 'en');
  assert.equal(loc.getDefaultLocale(), 'en');
});

test('localization: register + lookup direct string', () => {
  const loc = Localization.create();
  loc.register('en', { hello: 'Hello' });
  assert.equal(loc.t('hello'), 'Hello');
});

test('localization: missing key returns the key verbatim', () => {
  const loc = Localization.create();
  loc.register('en', { hello: 'Hello' });
  assert.equal(loc.t('missing'), 'missing');
});

test('localization: parameter interpolation substitutes {name}', () => {
  const loc = Localization.create();
  loc.register('en', { greet: 'Hello, {name}!' });
  assert.equal(loc.t('greet', { name: 'Misha' }), 'Hello, Misha!');
});

test('localization: numeric params stringify', () => {
  const loc = Localization.create();
  loc.register('en', { level: 'Level {n}' });
  assert.equal(loc.t('level', { n: 7 }), 'Level 7');
});

test('localization: missing param leaves placeholder verbatim', () => {
  const loc = Localization.create();
  loc.register('en', { greet: 'Hi {name}, you are {role}.' });
  assert.equal(loc.t('greet', { name: 'Misha' }), 'Hi Misha, you are {role}.');
});

test('localization: multiple instances of the same param substitute everywhere', () => {
  const loc = Localization.create();
  loc.register('en', { repeat: '{x} - {x} - {x}' });
  assert.equal(loc.t('repeat', { x: 'echo' }), 'echo - echo - echo');
});

test('localization: setLocale switches active locale', () => {
  const loc = Localization.create();
  loc.register('en', { hello: 'Hello' });
  loc.register('th', { hello: 'สวัสดี' });
  loc.setLocale('th');
  assert.equal(loc.getLocale(), 'th');
  assert.equal(loc.t('hello'), 'สวัสดี');
});

test('localization: missing key in active locale falls back to default locale', () => {
  const loc = Localization.create();
  loc.register('en', { hello: 'Hello', goodbye: 'Goodbye' });
  loc.register('th', { hello: 'สวัสดี' });  // no goodbye
  loc.setLocale('th');
  assert.equal(loc.t('hello'), 'สวัสดี');
  assert.equal(loc.t('goodbye'), 'Goodbye');  // fell back to en
});

test('localization: register merges into an existing table', () => {
  const loc = Localization.create();
  loc.register('en', { a: 'A', b: 'B' });
  loc.register('en', { b: 'B2', c: 'C' });  // overwrite b, add c
  assert.equal(loc.t('a'), 'A');
  assert.equal(loc.t('b'), 'B2');
  assert.equal(loc.t('c'), 'C');
});

test('localization: set replaces the table wholesale', () => {
  const loc = Localization.create();
  loc.register('en', { a: 'A', b: 'B' });
  loc.set('en', { c: 'C' });
  assert.equal(loc.t('a'), 'a');  // gone
  assert.equal(loc.t('c'), 'C');
});

test('localization: hasLocale + registeredLocales', () => {
  const loc = Localization.create();
  loc.register('en', {});
  loc.register('th', {});
  loc.register('ru', {});
  assert.equal(loc.hasLocale('en'), true);
  assert.equal(loc.hasLocale('zh'), false);
  assert.deepEqual(loc.registeredLocales().sort(), ['en', 'ru', 'th']);
});

test('localization: register ignores empty locale or falsy table', () => {
  const loc = Localization.create();
  loc.register('', { a: 'A' });
  // @ts-expect-error - testing runtime guard
  loc.register('en', null);
  assert.equal(loc.hasLocale(''), false);
  assert.equal(loc.hasLocale('en'), false);
});

test('localization: setLocale ignores empty string', () => {
  const loc = Localization.create({ initialLocale: 'en' });
  loc.setLocale('');
  assert.equal(loc.getLocale(), 'en');
});

// ---------- pluralization ----------

test('plural: en one / other forms via Intl.PluralRules', () => {
  const loc = Localization.create();
  loc.register('en', {
    apples: { one: '1 apple', other: '{count} apples' },
  });
  assert.equal(loc.plural('apples', 1), '1 apple');
  assert.equal(loc.plural('apples', 0), '0 apples');
  assert.equal(loc.plural('apples', 5), '5 apples');
});

test('plural: missing form falls back to .other', () => {
  const loc = Localization.create();
  loc.register('en', { items: { other: '{count} items' } });
  // 1 -> 'one' rule but no 'one' key -> falls to other
  assert.equal(loc.plural('items', 1), '1 items');
});

test('plural: count auto-injected as {count} param', () => {
  const loc = Localization.create();
  loc.register('en', {
    coins: { one: 'You have 1 coin', other: 'You have {count} coins' },
  });
  assert.equal(loc.plural('coins', 1), 'You have 1 coin');
  assert.equal(loc.plural('coins', 42), 'You have 42 coins');
});

test('plural: explicit count param overrides auto-inject', () => {
  const loc = Localization.create();
  loc.register('en', { stat: '{count} of {max}' });
  // Non-plural value with plural() — params merge with auto-count.
  assert.equal(loc.plural('stat', 5, { count: 99, max: 100 }), '99 of 100');
});

test('plural: non-plural value behaves like t() with {count} merged', () => {
  const loc = Localization.create();
  loc.register('en', { msg: 'You picked {count} items' });
  assert.equal(loc.plural('msg', 3), 'You picked 3 items');
});

test('plural: missing key returns the key', () => {
  const loc = Localization.create();
  assert.equal(loc.plural('missing', 1), 'missing');
});

test('plural: zero / two / few / many forms work when locale specifies', () => {
  // Custom rule for testing — return a fixed category.
  const loc = Localization.create({
    pluralRules: () => (count) => {
      if (count === 0) return 'zero';
      if (count === 2) return 'two';
      if (count >= 3 && count <= 5) return 'few';
      if (count >= 6) return 'many';
      return 'one';
    },
  });
  loc.register('en', {
    items: {
      zero: 'no items',
      one: '1 item',
      two: '2 items (pair)',
      few: 'a few items ({count})',
      many: 'many items ({count})',
      other: '{count} items',
    },
  });
  assert.equal(loc.plural('items', 0), 'no items');
  assert.equal(loc.plural('items', 1), '1 item');
  assert.equal(loc.plural('items', 2), '2 items (pair)');
  assert.equal(loc.plural('items', 4), 'a few items (4)');
  assert.equal(loc.plural('items', 7), 'many items (7)');
});

// ---------- mixed shape handling ----------

test('localization: t() on a plural-shaped value falls back to .other', () => {
  const loc = Localization.create();
  loc.register('en', { items: { one: '1 item', other: '{count} items' } });
  // t() doesn't know about plurals - returns .other with no count.
  assert.equal(loc.t('items'), '{count} items');
});

test('localization: locale fallback finds plural-shaped key in default', () => {
  const loc = Localization.create({ defaultLocale: 'en' });
  loc.register('en', { items: { one: '1 item', other: '{count} items' } });
  loc.register('th', { hello: 'สวัสดี' });
  loc.setLocale('th');
  // 'items' missing in th -> falls back to en plural form.
  assert.equal(loc.plural('items', 5), '5 items');
});

// ---------- lifecycle ----------

test('localization: clear empties all tables and resets locale to default', () => {
  const loc = Localization.create();
  loc.register('en', { hello: 'Hello' });
  loc.register('th', { hello: 'สวัสดี' });
  loc.setLocale('th');
  loc.clear();
  assert.equal(loc.getLocale(), 'en');
  assert.equal(loc.t('hello'), 'hello');
  assert.deepEqual(loc.registeredLocales(), []);
});

test('localization: dispose locks subsequent ops', () => {
  const loc = Localization.create();
  loc.register('en', { hello: 'Hello' });
  loc.dispose();
  loc.register('en', { hi: 'Hi' });  // no-op
  assert.equal(loc.t('hello'), 'hello');  // returns key after dispose
});

test('localization: empty key returns empty string', () => {
  const loc = Localization.create();
  // @ts-expect-error - testing runtime guard
  assert.equal(loc.t(undefined), '');
  // @ts-expect-error - testing runtime guard
  assert.equal(loc.plural(null, 1), '');
});

test('localization: defaultLocale option respected on init', () => {
  const loc = Localization.create({ defaultLocale: 'th' });
  assert.equal(loc.getDefaultLocale(), 'th');
  assert.equal(loc.getLocale(), 'th');
});

test('localization: initialLocale overrides defaultLocale at construction', () => {
  const loc = Localization.create({ defaultLocale: 'en', initialLocale: 'ru' });
  assert.equal(loc.getDefaultLocale(), 'en');
  assert.equal(loc.getLocale(), 'ru');
});
