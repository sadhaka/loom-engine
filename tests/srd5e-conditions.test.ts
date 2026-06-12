// srd5e-conditions tests - the 5e RAW condition-to-advantage mapping, STR/DEX
// save auto-fail, and reaction denial. This module computes the MODE only -
// the adv/dis second d20 is host-side (AST v2 has no max/min op).

import { test } from 'node:test';
import assert from 'node:assert';
import {
  ADV_AGAINST_TARGET, DISADV_ON_ATTACKER, AUTO_FAIL_STR_DEX,
  INCAPACITATED_NO_REACTION, coerceConditions, attackAdvantageMode,
  conditionRollNote, autoFailSaveCondition, reactionDeniedByConditions,
} from '../src/runtime/srd5e-conditions.js';

test('srd5e-conditions: the SRD tables', function () {
  assert.deepStrictEqual(ADV_AGAINST_TARGET, ['restrained', 'stunned', 'paralyzed', 'unconscious', 'blinded', 'petrified']);
  assert.deepStrictEqual(DISADV_ON_ATTACKER, ['poisoned', 'frightened', 'restrained', 'prone', 'blinded']);
  assert.deepStrictEqual(AUTO_FAIL_STR_DEX, ['paralyzed', 'stunned', 'unconscious', 'petrified']);
  assert.deepStrictEqual(INCAPACITATED_NO_REACTION, ['paralyzed', 'stunned', 'unconscious', 'incapacitated', 'petrified']);
});

test('srd5e-conditions: Codex audit P1 - blinded / petrified / invisible RAW', function () {
  // Blinded: attacks against a blinded target have advantage; a blinded
  // attacker has disadvantage.
  assert.strictEqual(attackAdvantageMode([], ['blinded'], true).mode, 'adv', 'blinded target grants advantage');
  assert.strictEqual(attackAdvantageMode(['blinded'], [], true).mode, 'dis', 'blinded attacker has disadvantage');
  // Petrified: attacks against it have advantage AND it auto-fails STR/DEX saves.
  assert.strictEqual(attackAdvantageMode([], ['petrified'], true).mode, 'adv', 'petrified target grants advantage');
  assert.strictEqual(autoFailSaveCondition('dex', ['petrified']), 'petrified', 'petrified auto-fails DEX saves');
  assert.strictEqual(autoFailSaveCondition('str', ['petrified']), 'petrified', 'petrified auto-fails STR saves');
  assert.strictEqual(autoFailSaveCondition('wis', ['petrified']), null, 'petrified does NOT auto-fail WIS saves');
  // Invisible: an invisible attacker gains advantage; attacks against an
  // invisible target have disadvantage; mutual invisibility cancels.
  assert.strictEqual(attackAdvantageMode(['invisible'], [], true).mode, 'adv', 'invisible attacker has advantage');
  assert.strictEqual(attackAdvantageMode([], ['invisible'], true).mode, 'dis', 'attacks against an invisible target have disadvantage');
  var mutual = attackAdvantageMode(['invisible'], ['invisible'], true);
  assert.strictEqual(mutual.mode, null, 'mutual invisibility cancels');
  assert.strictEqual(mutual.detail.cancelled, true);
});

test('srd5e-conditions: coerceConditions is fail-soft and normalizing', function () {
  assert.deepStrictEqual(coerceConditions(['Prone', ' STUNNED ', 'prone']), ['prone', 'stunned'], 'lowercase, trim, dedupe (first-seen order)');
  assert.deepStrictEqual(coerceConditions('poisoned, frightened'), ['poisoned', 'frightened'], 'comma-separated string accepted');
  assert.deepStrictEqual(coerceConditions(['ok', 7, null, '', 'fine']), ['ok', 'fine'], 'non-strings and empties drop');
  assert.deepStrictEqual(coerceConditions(42), []);
  assert.deepStrictEqual(coerceConditions(null), []);
  assert.deepStrictEqual(coerceConditions(undefined), []);
  assert.deepStrictEqual(coerceConditions({}), []);
});

test('srd5e-conditions: attackAdvantageMode - adv / dis / cancel', function () {
  var adv = attackAdvantageMode([], ['restrained'], true);
  assert.strictEqual(adv.mode, 'adv');
  assert.deepStrictEqual(adv.detail, { adv_from: ['restrained'], dis_from: [], cancelled: false, prone_skipped: false });

  var dis = attackAdvantageMode(['poisoned'], [], true);
  assert.strictEqual(dis.mode, 'dis');
  assert.deepStrictEqual(dis.detail.dis_from, ['poisoned']);

  // Both sides present: 5e RAW cancel to a straight roll (never stack).
  var cancel = attackAdvantageMode(['frightened'], ['stunned', 'paralyzed'], true);
  assert.strictEqual(cancel.mode, null);
  assert.strictEqual(cancel.detail.cancelled, true);
  assert.deepStrictEqual(cancel.detail.adv_from, ['stunned', 'paralyzed']);
  assert.deepStrictEqual(cancel.detail.dis_from, ['frightened']);

  // No conditions at all.
  var none = attackAdvantageMode([], [], null);
  assert.strictEqual(none.mode, null);
  assert.strictEqual(none.detail.cancelled, false);

  // A restrained ATTACKER has disadvantage; a restrained TARGET grants advantage.
  assert.strictEqual(attackAdvantageMode(['restrained'], [], true).mode, 'dis');
  assert.strictEqual(attackAdvantageMode([], ['restrained'], null).mode, 'adv');
});

test('srd5e-conditions: prone target splits by range; unknown range SKIPS prone', function () {
  // Melee vs prone: advantage.
  var melee = attackAdvantageMode([], ['prone'], true);
  assert.strictEqual(melee.mode, 'adv');
  assert.deepStrictEqual(melee.detail.adv_from, ['prone']);
  // Ranged vs prone: disadvantage.
  var ranged = attackAdvantageMode([], ['prone'], false);
  assert.strictEqual(ranged.mode, 'dis');
  assert.deepStrictEqual(ranged.detail.dis_from, ['prone']);
  // Unknown range: prone is skipped, flagged, and decides NOTHING.
  var unknown = attackAdvantageMode([], ['prone'], null);
  assert.strictEqual(unknown.mode, null);
  assert.strictEqual(unknown.detail.prone_skipped, true);
  assert.deepStrictEqual(unknown.detail.adv_from, []);
  assert.deepStrictEqual(unknown.detail.dis_from, []);
  // Skipped prone does not block other sources.
  var mixed = attackAdvantageMode([], ['prone', 'stunned'], null);
  assert.strictEqual(mixed.mode, 'adv');
  assert.strictEqual(mixed.detail.prone_skipped, true);
  // A prone ATTACKER is unconditional disadvantage (own-prone, not target-prone).
  var ownProne = attackAdvantageMode(['prone'], [], null);
  assert.strictEqual(ownProne.mode, 'dis');
  assert.strictEqual(ownProne.detail.prone_skipped, false);
});

test('srd5e-conditions: conditionRollNote strings', function () {
  var adv = attackAdvantageMode([], ['restrained', 'stunned'], true);
  assert.strictEqual(conditionRollNote(adv.mode, adv.detail, 17, '17/9'),
    'advantage (restrained, stunned): rolled 17/9, kept 17');
  assert.strictEqual(conditionRollNote(adv.mode, adv.detail, null, null),
    'advantage (restrained, stunned)', 'kept/pair are optional');
  var dis = attackAdvantageMode(['poisoned'], [], true);
  assert.strictEqual(conditionRollNote(dis.mode, dis.detail, 4, '4/12'),
    'disadvantage (poisoned): rolled 4/12, kept 4');
  var cancel = attackAdvantageMode(['frightened'], ['stunned'], true);
  assert.strictEqual(conditionRollNote(cancel.mode, cancel.detail, null, null),
    'advantage (stunned) and disadvantage (frightened) cancel: straight roll');
  var skipped = attackAdvantageMode([], ['prone'], null);
  assert.strictEqual(conditionRollNote(skipped.mode, skipped.detail, null, null),
    '[prone ignored: melee/ranged unknown]');
  var plain = attackAdvantageMode([], [], true);
  assert.strictEqual(conditionRollNote(plain.mode, plain.detail, null, null), '');
});

test('srd5e-conditions: autoFailSaveCondition only fires on STR/DEX', function () {
  assert.strictEqual(autoFailSaveCondition('dex', ['paralyzed']), 'paralyzed');
  assert.strictEqual(autoFailSaveCondition('str', ['unconscious']), 'unconscious');
  assert.strictEqual(autoFailSaveCondition('strength', ['stunned']), 'stunned', 'full ability names accepted');
  assert.strictEqual(autoFailSaveCondition('dexterity', ['stunned']), 'stunned');
  // Table order decides which condition is named first.
  assert.strictEqual(autoFailSaveCondition('dex', ['unconscious', 'paralyzed']), 'paralyzed');
  // WIS/CON/CHA/INT saves never auto-fail.
  assert.strictEqual(autoFailSaveCondition('wis', ['paralyzed']), null);
  assert.strictEqual(autoFailSaveCondition('con', ['stunned', 'unconscious']), null);
  assert.strictEqual(autoFailSaveCondition('cha', ['paralyzed']), null);
  // Non-auto-fail conditions return null even on DEX.
  assert.strictEqual(autoFailSaveCondition('dex', ['restrained', 'prone']), null);
  assert.strictEqual(autoFailSaveCondition('dex', []), null);
  assert.strictEqual(autoFailSaveCondition('', ['paralyzed']), null);
});

test('srd5e-conditions: reactionDeniedByConditions (the incapacitated family)', function () {
  assert.strictEqual(reactionDeniedByConditions(['stunned']), 'stunned');
  assert.strictEqual(reactionDeniedByConditions(['petrified']), 'petrified');
  assert.strictEqual(reactionDeniedByConditions(['incapacitated']), 'incapacitated');
  assert.strictEqual(reactionDeniedByConditions(['paralyzed', 'stunned']), 'paralyzed', 'table order decides');
  assert.strictEqual(reactionDeniedByConditions(['prone', 'restrained', 'poisoned']), null);
  assert.strictEqual(reactionDeniedByConditions([]), null);
  assert.strictEqual(reactionDeniedByConditions('Stunned'), 'stunned', 'string input coerces');
});
