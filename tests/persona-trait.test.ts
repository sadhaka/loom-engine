// Phase 1.3.0 - PersonaTrait tests (Wave 1.3 AI persona depth opens).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  PersonaTrait,
  RESOURCE_PERSONA_TRAIT,
  type CharacterTraitValue,
} from '../src/index.js';

test('pt: RESOURCE_PERSONA_TRAIT is the stable string', () => {
  assert.equal(RESOURCE_PERSONA_TRAIT, 'persona_trait');
});

test('pt: starts empty', () => {
  const pt = PersonaTrait.create();
  assert.equal(pt.entryCount(), 0);
  assert.equal(pt.traitSpecCount(), 0);
});

test('pt: defineTrait + hasTraitSpec + traitIds', () => {
  const pt = PersonaTrait.create();
  pt.defineTrait({ id: 'courage', baseline: 0, decayHalfLifeMs: 60000 });
  pt.defineTrait({ id: 'curiosity' });
  assert.equal(pt.hasTraitSpec('courage'), true);
  assert.deepEqual(pt.traitIds().sort(), ['courage', 'curiosity']);
});

test('pt: defineTrait rejects empty id', () => {
  const pt = PersonaTrait.create();
  assert.equal(pt.defineTrait({ id: '' }), false);
});

test('pt: getTraitSpec returns clone', () => {
  const pt = PersonaTrait.create();
  pt.defineTrait({ id: 'greed', baseline: 0.5 });
  const spec = pt.getTraitSpec('greed');
  assert.ok(spec);
  assert.equal(spec!.baseline, 0.5);
});

test('pt: set + getValue', () => {
  const pt = PersonaTrait.create();
  pt.set('mira', 'courage', 0.7);
  assert.ok(Math.abs(pt.getValue('mira', 'courage') - 0.7) < 1e-6);
});

test('pt: set auto-defines trait spec', () => {
  const pt = PersonaTrait.create();
  pt.set('mira', 'newtrait', 0.5);
  assert.equal(pt.hasTraitSpec('newtrait'), true);
});

test('pt: set rejects empty / invalid args', () => {
  const pt = PersonaTrait.create();
  assert.equal(pt.set('', 'courage', 0.5), false);
  assert.equal(pt.set('mira', '', 0.5), false);
  assert.equal(pt.set('mira', 'courage', NaN), false);
});

test('pt: getValue clamps to [-1, 1]', () => {
  const pt = PersonaTrait.create();
  pt.set('mira', 'courage', 5);
  assert.equal(pt.getValue('mira', 'courage'), 1);
  pt.set('mira', 'courage', -10);
  assert.equal(pt.getValue('mira', 'courage'), -1);
});

test('pt: getRawValue returns un-clamped', () => {
  const pt = PersonaTrait.create();
  pt.set('mira', 'courage', 5);
  assert.equal(pt.getRawValue('mira', 'courage'), 5);
});

test('pt: adjust adds delta', () => {
  const pt = PersonaTrait.create();
  pt.set('mira', 'courage', 0.5);
  pt.adjust('mira', 'courage', -0.2);
  assert.ok(Math.abs(pt.getValue('mira', 'courage') - 0.3) < 1e-6);
});

test('pt: adjust on non-existent entry treats current as 0', () => {
  const pt = PersonaTrait.create();
  const v = pt.adjust('mira', 'fear', 0.4);
  assert.ok(Math.abs((v as number) - 0.4) < 1e-6);
});

test('pt: has + remove', () => {
  const pt = PersonaTrait.create();
  pt.set('mira', 'courage', 0.5);
  assert.equal(pt.has('mira', 'courage'), true);
  pt.remove('mira', 'courage');
  assert.equal(pt.has('mira', 'courage'), false);
});

test('pt: forCharacter returns all traits for one character', () => {
  const pt = PersonaTrait.create();
  pt.set('mira', 'courage', 0.7);
  pt.set('mira', 'greed', 0.1);
  pt.set('thane', 'courage', 0.3);
  const list = pt.forCharacter('mira');
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((e) => e.traitId).sort(), ['courage', 'greed']);
});

test('pt: forTrait returns all characters with that trait', () => {
  const pt = PersonaTrait.create();
  pt.set('mira', 'courage', 0.7);
  pt.set('thane', 'courage', 0.3);
  pt.set('mira', 'greed', 0.1);
  const list = pt.forTrait('courage');
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((e) => e.characterId).sort(), ['mira', 'thane']);
});

test('pt: findHighest picks highest value', () => {
  const pt = PersonaTrait.create();
  pt.set('mira', 'courage', 0.7);
  pt.set('thane', 'courage', 0.9);
  pt.set('noi', 'courage', 0.4);
  const best = pt.findHighest('courage');
  assert.ok(best);
  assert.equal(best!.characterId, 'thane');
});

test('pt: findHighest with minLevel filters', () => {
  const pt = PersonaTrait.create();
  pt.set('mira', 'courage', 0.7);
  pt.set('thane', 'courage', 0.4);
  const best = pt.findHighest('courage', { minLevel: 0.5 });
  assert.equal(best!.characterId, 'mira');
  // Higher threshold excludes everyone.
  assert.equal(pt.findHighest('courage', { minLevel: 0.9 }), null);
});

test('pt: findHighest with characterIds whitelist', () => {
  const pt = PersonaTrait.create();
  pt.set('mira', 'courage', 0.7);
  pt.set('thane', 'courage', 0.9);
  const best = pt.findHighest('courage', { characterIds: ['mira', 'noi'] });
  assert.equal(best!.characterId, 'mira');
});

test('pt: findLowest picks lowest', () => {
  const pt = PersonaTrait.create();
  pt.set('mira', 'greed', 0.7);
  pt.set('thane', 'greed', 0.1);
  const lowest = pt.findLowest('greed');
  assert.equal(lowest!.characterId, 'thane');
});

test('pt: tick decays value toward baseline', () => {
  const pt = PersonaTrait.create();
  pt.defineTrait({ id: 'fear', baseline: 0, decayHalfLifeMs: 1000 });
  pt.set('mira', 'fear', 0.8);
  pt.tick(1000); // exactly one half-life
  // Value should be ~0.4 (halfway from 0.8 toward baseline 0).
  const v = pt.getValue('mira', 'fear');
  assert.ok(Math.abs(v - 0.4) < 0.01);
});

test('pt: tick with decayHalfLifeMs=0 no decay', () => {
  const pt = PersonaTrait.create();
  pt.defineTrait({ id: 'courage', baseline: 0, decayHalfLifeMs: 0 });
  pt.set('mira', 'courage', 0.8);
  pt.tick(60000);
  assert.equal(pt.getValue('mira', 'courage'), 0.8);
});

test('pt: tick decays toward non-zero baseline', () => {
  const pt = PersonaTrait.create();
  pt.defineTrait({ id: 'mood', baseline: 0.5, decayHalfLifeMs: 1000 });
  pt.set('mira', 'mood', 1);
  pt.tick(1000);
  // Halfway from 1 toward 0.5 = 0.75.
  const v = pt.getValue('mira', 'mood');
  assert.ok(Math.abs(v - 0.75) < 0.01);
});

test('pt: removeTraitSpec drops all entries for that trait', () => {
  const pt = PersonaTrait.create();
  pt.set('mira', 'courage', 0.5);
  pt.set('thane', 'courage', 0.7);
  pt.set('mira', 'greed', 0.1);
  pt.removeTraitSpec('courage');
  assert.equal(pt.has('mira', 'courage'), false);
  assert.equal(pt.has('thane', 'courage'), false);
  assert.equal(pt.has('mira', 'greed'), true);
});

test('pt: onChange fires on set / adjust', () => {
  const events: string[] = [];
  const pt = PersonaTrait.create({
    onChange: (e) => events.push(e.characterId + ':' + e.traitId),
  });
  pt.set('mira', 'courage', 0.5);
  pt.adjust('mira', 'courage', 0.2);
  assert.equal(events.length, 2);
});

test('pt: throwing onChange isolated', () => {
  const pt = PersonaTrait.create({
    onChange: () => { throw new Error('boom'); },
  });
  pt.set('mira', 'courage', 0.5); // should not throw
  assert.equal(pt.has('mira', 'courage'), true);
});

test('pt: NaN / negative dt no-op', () => {
  const pt = PersonaTrait.create();
  pt.defineTrait({ id: 'fear', baseline: 0, decayHalfLifeMs: 1000 });
  pt.set('mira', 'fear', 0.8);
  pt.tick(NaN);
  pt.tick(-50);
  pt.tick(Infinity);
  assert.equal(pt.getValue('mira', 'fear'), 0.8);
});

test('pt: custom valueClamp', () => {
  const pt = PersonaTrait.create({
    valueClamp: (raw) => Math.max(0, Math.min(100, raw)),
  });
  pt.set('mira', 'level', 150);
  assert.equal(pt.getValue('mira', 'level'), 100);
  pt.set('mira', 'level', -50);
  assert.equal(pt.getValue('mira', 'level'), 0);
});

test('pt: list returns all entries', () => {
  const pt = PersonaTrait.create();
  pt.set('mira', 'courage', 0.5);
  pt.set('thane', 'greed', 0.7);
  assert.equal(pt.list().length, 2);
});

test('pt: clear empties everything', () => {
  const pt = PersonaTrait.create();
  pt.defineTrait({ id: 'courage' });
  pt.set('mira', 'courage', 0.5);
  pt.clear();
  assert.equal(pt.entryCount(), 0);
  assert.equal(pt.traitSpecCount(), 0);
});

test('pt: dispose locks ops', () => {
  const pt = PersonaTrait.create();
  pt.set('mira', 'courage', 0.5);
  pt.dispose();
  assert.equal(pt.set('thane', 'greed', 0.5), false);
  assert.equal(pt.adjust('mira', 'courage', 0.1), null);
  assert.equal(pt.entryCount(), 0);
});

test('pt: realistic example - bravest NPC volunteers, courage decays after fear event', () => {
  const pt = PersonaTrait.create();
  pt.defineTrait({ id: 'courage', baseline: 0, decayHalfLifeMs: 30000 });
  pt.set('mira', 'courage', 0.7);
  pt.set('thane', 'courage', 0.9);
  pt.set('noi', 'courage', 0.3);
  // Quest: who volunteers?
  const volunteer = pt.findHighest('courage', { minLevel: 0.5 });
  assert.equal(volunteer!.characterId, 'thane');
  // Thane witnesses death; courage drops 0.3.
  pt.adjust('thane', 'courage', -0.3);
  assert.ok(pt.getValue('thane', 'courage') < 0.7);
  // Mira now bravest.
  const newVolunteer = pt.findHighest('courage', { minLevel: 0.5 });
  assert.equal(newVolunteer!.characterId, 'mira');
});
