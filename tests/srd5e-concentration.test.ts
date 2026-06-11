// srd5e-concentration tests - the 5e concentration state machine. RNG-free by
// design: the caller rolls the CON save and passes the TOTAL in.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  CONCENTRATION_MIN_DC, maintainSaveDc, isConcentrating, startConcentration,
  dropConcentration, maintainSave,
} from '../src/runtime/srd5e-concentration.js';
import type { ConcentrationState } from '../src/runtime/srd5e-concentration.js';

test('srd5e-concentration: maintainSaveDc = max(10, floor(damage/2))', function () {
  assert.strictEqual(CONCENTRATION_MIN_DC, 10);
  assert.strictEqual(maintainSaveDc(0), 10);
  assert.strictEqual(maintainSaveDc(1), 10);
  assert.strictEqual(maintainSaveDc(19), 10);
  assert.strictEqual(maintainSaveDc(20), 10);
  assert.strictEqual(maintainSaveDc(21), 10, 'floor(21/2) = 10, still the floor');
  assert.strictEqual(maintainSaveDc(22), 11);
  assert.strictEqual(maintainSaveDc(23), 11, 'round DOWN, never up');
  assert.strictEqual(maintainSaveDc(36), 18);
  assert.strictEqual(maintainSaveDc(100), 50);
});

test('srd5e-concentration: isConcentrating', function () {
  assert.strictEqual(isConcentrating(null), false);
  assert.strictEqual(isConcentrating(undefined), false);
  assert.strictEqual(isConcentrating({ spell_id: '', spell_name: '' }), false);
  assert.strictEqual(isConcentrating({ spell_id: 'web', spell_name: 'Web' }), true);
});

test('srd5e-concentration: start drops the previous spell (one at a time)', function () {
  var first = startConcentration(null, 'bless', 'Bless', 1);
  assert.deepStrictEqual(first, {
    concentration: { spell_id: 'bless', spell_name: 'Bless', slot_level: 1 },
    dropped: null,
  });
  var second = startConcentration(first.concentration, 'witch_bolt', 'Witch Bolt', 2);
  assert.deepStrictEqual(second.concentration, { spell_id: 'witch_bolt', spell_name: 'Witch Bolt', slot_level: 2 });
  assert.deepStrictEqual(second.dropped, { spell_id: 'bless', spell_name: 'Bless', slot_level: 1 });
  // spell_name defaults to the id; slot_level only appears when supplied.
  var bare = startConcentration(null, 'hex');
  assert.deepStrictEqual(bare.concentration, { spell_id: 'hex', spell_name: 'hex' });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(bare.concentration, 'slot_level'), false);
});

test('srd5e-concentration: drop', function () {
  assert.deepStrictEqual(dropConcentration(null), { concentration: null, dropped: null });
  var c: ConcentrationState = { spell_id: 'web', spell_name: 'Web', slot_level: 2 };
  var r = dropConcentration(c);
  assert.strictEqual(r.concentration, null);
  assert.deepStrictEqual(r.dropped, c);
  assert.notStrictEqual(r.dropped, c, 'dropped is a clone, not the caller object');
});

test('srd5e-concentration: maintainSave boundaries (keep iff total >= dc)', function () {
  var c: ConcentrationState = { spell_id: 'hold_person', spell_name: 'Hold Person', slot_level: 2 };
  var pre = JSON.stringify(c);
  // Exactly the DC keeps.
  var keep = maintainSave(c, 22, 11);
  assert.deepStrictEqual(keep, {
    needed: true, dc: 11, total: 11, success: true,
    concentration: { spell_id: 'hold_person', spell_name: 'Hold Person', slot_level: 2 },
    dropped: null,
  });
  // One under drops.
  var fail = maintainSave(c, 22, 10);
  assert.strictEqual(fail.success, false);
  assert.strictEqual(fail.concentration, null);
  assert.deepStrictEqual(fail.dropped, c);
  // Small damage still floors the DC at 10.
  var floor = maintainSave(c, 3, 9);
  assert.strictEqual(floor.dc, 10);
  assert.strictEqual(floor.success, false);
  // Not concentrating: nothing needed, nothing drops, success true.
  var idle = maintainSave(null, 30, 1);
  assert.deepStrictEqual(idle, { needed: false, dc: 15, total: 1, success: true, concentration: null, dropped: null });
  // Purity: the caller's state object is never mutated.
  assert.strictEqual(JSON.stringify(c), pre);
});
