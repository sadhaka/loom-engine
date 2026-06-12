// srd5e-spell-slots tests - slot tables, spend/restore, rests, THE widen-merge,
// and the SRD upcast ladder. Pure-function purity (inputs never mutated) is
// asserted throughout.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  MAX_SLOT_LEVEL, PACT_KEY, casterKind, isCaster, spellAbilityForClass,
  spellSlotsFor, highestSlotLevel, slotAvailable, spendSlot,
  spendLowestAvailable, restoreSlot, slotsRemaining, longRest, shortRest,
  widenSlots, spellRequiresConcentration, spellBaseLevel, upcastEffect,
  totalDiceForCast, sanitizeSlotPool,
} from '../src/runtime/srd5e-spell-slots.js';
import type { SlotPool } from '../src/runtime/srd5e-spell-slots.js';

test('srd5e-spell-slots: Codex audit P2 - malformed pools are clamped', function () {
  // A corrupted entry { max: 1, used: -100 } must NOT report 101 available.
  var bad = { '1': { max: 1, used: -100 } } as unknown as SlotPool;
  assert.strictEqual(slotAvailable(bad, 1), 1, 'negative used clamps to 0, availability is max');
  assert.deepStrictEqual(slotsRemaining(bad), { 1: 1 }, 'slotsRemaining clamps too');
  // Spend cannot exceed the real max no matter how negative used was.
  var s1 = spendSlot(bad, 1);
  assert.strictEqual(s1.ok, true);
  assert.strictEqual(slotAvailable(s1.slots, 1), 0, 'one real slot, now spent');
  assert.strictEqual(spendSlot(s1.slots, 1).ok, false, 'no phantom slots remain');
  // used > max clamps down; non-integer max coerces to 0.
  assert.strictEqual(slotAvailable({ '2': { max: 2, used: 9 } } as unknown as SlotPool, 2), 0);
  assert.strictEqual(highestSlotLevel({ '3': { max: 2.5, used: 0 } } as unknown as SlotPool), 0, 'non-integer max is not a real tier');
  // sanitizeSlotPool returns a clamped clone; a valid pool is unchanged.
  var clean = spellSlotsFor('wizard', 5);
  assert.deepStrictEqual(sanitizeSlotPool(clean), clean, 'valid pool is byte-identical');
  assert.deepStrictEqual(sanitizeSlotPool(bad), { '1': { max: 1, used: 0 } }, 'malformed entry clamped');
});

test('srd5e-slots: caster taxonomy + spellcasting ability', function () {
  assert.strictEqual(MAX_SLOT_LEVEL, 9);
  assert.strictEqual(PACT_KEY, 'pact');
  assert.strictEqual(casterKind('wizard'), 'full');
  assert.strictEqual(casterKind('cleric'), 'full');
  assert.strictEqual(casterKind('paladin'), 'half');
  assert.strictEqual(casterKind('ranger'), 'half');
  assert.strictEqual(casterKind('warlock'), 'pact');
  assert.strictEqual(casterKind('fighter'), null);
  assert.strictEqual(casterKind('  Wizard  '), 'full', 'normalizes case + whitespace');
  assert.strictEqual(isCaster('druid'), true);
  assert.strictEqual(isCaster('rogue'), false);
  assert.strictEqual(spellAbilityForClass('wizard'), 'int');
  assert.strictEqual(spellAbilityForClass('cleric'), 'wis');
  assert.strictEqual(spellAbilityForClass('warlock'), 'cha');
  assert.strictEqual(spellAbilityForClass('paladin'), 'cha');
  assert.strictEqual(spellAbilityForClass('barbarian'), null);
});

test('srd5e-slots: SRD slot tables (full / half / pact)', function () {
  assert.deepStrictEqual(spellSlotsFor('wizard', 1), { '1': { max: 2, used: 0 } });
  assert.deepStrictEqual(spellSlotsFor('wizard', 5), {
    '1': { max: 4, used: 0 }, '2': { max: 3, used: 0 }, '3': { max: 2, used: 0 },
  });
  assert.deepStrictEqual(spellSlotsFor('wizard', 20), {
    '1': { max: 4, used: 0 }, '2': { max: 3, used: 0 }, '3': { max: 3, used: 0 },
    '4': { max: 3, used: 0 }, '5': { max: 3, used: 0 }, '6': { max: 2, used: 0 },
    '7': { max: 2, used: 0 }, '8': { max: 1, used: 0 }, '9': { max: 1, used: 0 },
  });
  // Half casters lag: nothing at 1, 2 first-level slots at 2.
  assert.deepStrictEqual(spellSlotsFor('paladin', 1), {});
  assert.deepStrictEqual(spellSlotsFor('paladin', 2), { '1': { max: 2, used: 0 } });
  assert.deepStrictEqual(spellSlotsFor('ranger', 20), {
    '1': { max: 4, used: 0 }, '2': { max: 3, used: 0 }, '3': { max: 3, used: 0 },
    '4': { max: 3, used: 0 }, '5': { max: 2, used: 0 },
  });
  // Pact ladder: level/count milestones.
  assert.deepStrictEqual(spellSlotsFor('warlock', 1), { pact: { slot_level: 1, max: 1, used: 0 } });
  assert.deepStrictEqual(spellSlotsFor('warlock', 2), { pact: { slot_level: 1, max: 2, used: 0 } });
  assert.deepStrictEqual(spellSlotsFor('warlock', 5), { pact: { slot_level: 3, max: 2, used: 0 } });
  assert.deepStrictEqual(spellSlotsFor('warlock', 9), { pact: { slot_level: 5, max: 2, used: 0 } });
  assert.deepStrictEqual(spellSlotsFor('warlock', 11), { pact: { slot_level: 5, max: 3, used: 0 } });
  assert.deepStrictEqual(spellSlotsFor('warlock', 17), { pact: { slot_level: 5, max: 4, used: 0 } });
  // Non-caster: empty. Level clamps into 1..20.
  assert.deepStrictEqual(spellSlotsFor('fighter', 10), {});
  assert.deepStrictEqual(spellSlotsFor('wizard', 0), spellSlotsFor('wizard', 1));
  assert.deepStrictEqual(spellSlotsFor('wizard', 25), spellSlotsFor('wizard', 20));
});

test('srd5e-slots: highestSlotLevel + slotAvailable (pact included)', function () {
  assert.strictEqual(highestSlotLevel(spellSlotsFor('wizard', 5)), 3);
  assert.strictEqual(highestSlotLevel(spellSlotsFor('warlock', 9)), 5);
  assert.strictEqual(highestSlotLevel({} as SlotPool), 0);
  var pool: SlotPool = { '3': { max: 2, used: 1 }, pact: { slot_level: 3, max: 2, used: 0 } } as SlotPool;
  assert.strictEqual(slotAvailable(pool, 3), 3, 'numeric remainder + matching pact remainder sum');
  assert.strictEqual(slotAvailable(pool, 2), 0);
});

test('srd5e-slots: spendSlot is pure, exact-level, numeric before pact', function () {
  var pool = spellSlotsFor('wizard', 5);
  var pre = JSON.stringify(pool);
  var r = spendSlot(pool, 3);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'ok');
  assert.strictEqual(r.slot_level, 3);
  assert.strictEqual((r.slots['3'] as { used: number }).used, 1);
  assert.strictEqual(JSON.stringify(pool), pre, 'input pool never mutated');
  // Exact level only - a dry tier does NOT walk up.
  var dry: SlotPool = { '1': { max: 2, used: 2 }, '2': { max: 3, used: 0 } } as SlotPool;
  var r2 = spendSlot(dry, 1);
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.reason, 'no_slot');
  assert.strictEqual(r2.slot_level, null);
  assert.deepStrictEqual(r2.slots, dry, 'failed spend returns the pool unchanged');
  // Numeric tier spends before a matching pact tier.
  var mixed: SlotPool = { '3': { max: 1, used: 0 }, pact: { slot_level: 3, max: 2, used: 0 } } as SlotPool;
  var r3 = spendSlot(mixed, 3);
  assert.strictEqual((r3.slots['3'] as { used: number }).used, 1);
  assert.strictEqual((r3.slots.pact as { used: number }).used, 0);
  // Reason taxonomy.
  assert.strictEqual(spendSlot(pool, 0).reason, 'not_a_slot');
  assert.strictEqual(spendSlot(pool, 10).reason, 'bad_slot_level');
  assert.strictEqual(spendSlot(pool, 2.5).reason, 'bad_slot_level');
  assert.strictEqual(spendSlot(pool, -1).reason, 'bad_slot_level');
});

test('srd5e-slots: spendLowestAvailable walks up (auto-upcast) and reports no_higher_slot', function () {
  var pool: SlotPool = { '1': { max: 2, used: 2 }, '2': { max: 3, used: 3 }, '3': { max: 2, used: 0 } } as SlotPool;
  var r = spendLowestAvailable(pool, 1);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.slot_level, 3, 'walks past two dry tiers');
  var allDry: SlotPool = { '1': { max: 2, used: 2 } } as SlotPool;
  var r2 = spendLowestAvailable(allDry, 1);
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.reason, 'no_higher_slot');
  // Pact tiers join the walk.
  var pact = spellSlotsFor('warlock', 5);
  var r3 = spendLowestAvailable(pact, 1);
  assert.strictEqual(r3.slot_level, 3);
  assert.strictEqual((r3.slots.pact as { used: number }).used, 1);
  assert.strictEqual(spendLowestAvailable(pool, 0).reason, 'not_a_slot');
  assert.strictEqual(spendLowestAvailable(pool, 11).reason, 'bad_slot_level');
});

test('srd5e-slots: restoreSlot floors at 0; slotsRemaining merges pact', function () {
  var pool: SlotPool = { '2': { max: 3, used: 2 } } as SlotPool;
  assert.deepStrictEqual(restoreSlot(pool, 2), { '2': { max: 3, used: 1 } });
  assert.deepStrictEqual(restoreSlot(pool, 2, 5), { '2': { max: 3, used: 0 } });
  assert.deepStrictEqual(restoreSlot(pool, 7), pool, 'unknown level is a no-op');
  var pact: SlotPool = { pact: { slot_level: 3, max: 2, used: 2 } } as SlotPool;
  assert.deepStrictEqual(restoreSlot(pact, 3), { pact: { slot_level: 3, max: 2, used: 1 } });
  var mixed: SlotPool = { '1': { max: 4, used: 1 }, '3': { max: 1, used: 0 }, pact: { slot_level: 3, max: 2, used: 1 } } as SlotPool;
  assert.deepStrictEqual(slotsRemaining(mixed), { 1: 3, 3: 2 }, 'pact remainder merges into its slot level');
});

test('srd5e-slots: rests - long refreshes all, short refreshes pact only', function () {
  assert.deepStrictEqual(longRest('wizard', 4), spellSlotsFor('wizard', 4));
  var wiz: SlotPool = { '1': { max: 4, used: 3 } } as SlotPool;
  assert.deepStrictEqual(shortRest('wizard', 5, wiz), wiz, 'wizard short rest is a no-op');
  var lock: SlotPool = { pact: { slot_level: 3, max: 2, used: 2 } } as SlotPool;
  assert.deepStrictEqual(shortRest('warlock', 5, lock), { pact: { slot_level: 3, max: 2, used: 0 } });
  var pre = JSON.stringify(lock);
  shortRest('warlock', 5, lock);
  assert.strictEqual(JSON.stringify(lock), pre, 'input never mutated');
});

test('srd5e-slots: THE P0 widen-merge - shape derives fresh, used carries capped', function () {
  // Level-up: a new tier appears; spent slots stay spent.
  var stored: SlotPool = { '1': { max: 4, used: 4 }, '2': { max: 3, used: 1 } } as SlotPool;
  assert.deepStrictEqual(widenSlots(stored, 'wizard', 5), {
    '1': { max: 4, used: 4 }, '2': { max: 3, used: 1 }, '3': { max: 2, used: 0 },
  });
  // Carried used caps at the NEW max (corrupt / downleveled stores self-heal).
  assert.deepStrictEqual(widenSlots({ '1': { max: 2, used: 7 } } as SlotPool, 'wizard', 1),
    { '1': { max: 2, used: 2 } });
  // Stored tiers absent from the fresh shape are dropped.
  assert.deepStrictEqual(widenSlots({ '9': { max: 1, used: 1 } } as SlotPool, 'wizard', 1),
    { '1': { max: 2, used: 0 } });
  // Non-caster / unknown class: stored returns untouched (value-identical).
  var nc: SlotPool = { '1': { max: 4, used: 2 } } as SlotPool;
  assert.deepStrictEqual(widenSlots(nc, 'fighter', 5), nc);
  // Null / empty stored: fresh pool.
  assert.deepStrictEqual(widenSlots(null, 'wizard', 3), spellSlotsFor('wizard', 3));
  assert.deepStrictEqual(widenSlots(undefined, 'wizard', 3), spellSlotsFor('wizard', 3));
  assert.deepStrictEqual(widenSlots({} as SlotPool, 'wizard', 3), spellSlotsFor('wizard', 3));
  // Pact shape re-derives; pact used carries.
  assert.deepStrictEqual(widenSlots({ pact: { slot_level: 1, max: 2, used: 1 } } as SlotPool, 'warlock', 5),
    { pact: { slot_level: 3, max: 2, used: 1 } });
  // Class-shape switch: a stored numeric pool widened as a warlock yields the
  // pure pact shape (stored numeric tiers drop - shape is the CURRENT class).
  assert.deepStrictEqual(widenSlots({ '1': { max: 2, used: 1 } } as SlotPool, 'warlock', 5),
    { pact: { slot_level: 3, max: 2, used: 0 } });
  // Purity: stored is never mutated.
  var pre = JSON.stringify(stored);
  widenSlots(stored, 'wizard', 9);
  assert.strictEqual(JSON.stringify(stored), pre);
});

test('srd5e-slots: SRD upcast ladder + totalDiceForCast', function () {
  assert.strictEqual(spellBaseLevel('fireball'), 3);
  assert.strictEqual(spellBaseLevel('nonsense'), null);
  assert.strictEqual(spellRequiresConcentration('witch_bolt'), true);
  assert.strictEqual(spellRequiresConcentration('hold_person'), true);
  assert.strictEqual(spellRequiresConcentration('fireball'), false);
  assert.strictEqual(spellRequiresConcentration('nonsense'), false);
  // Clamping: under base casts at base; over 9 clamps to 9.
  var low = upcastEffect('fireball', 1);
  assert.ok(low);
  assert.strictEqual(low.cast_level, 3);
  assert.strictEqual(low.levels_above, 0);
  assert.strictEqual(low.added_dice, '');
  var high = upcastEffect('fireball', 12);
  assert.ok(high);
  assert.strictEqual(high.cast_level, 9);
  assert.strictEqual(high.added_dice, '6d6');
  // Per-TWO-levels step (spiritual_weapon): odd levels do not step.
  var sw3 = upcastEffect('spiritual_weapon', 3);
  assert.ok(sw3);
  assert.strictEqual(sw3.added_dice, '', 'slot 3 is below the first even step');
  var sw4 = upcastEffect('spiritual_weapon', 4);
  assert.ok(sw4);
  assert.strictEqual(sw4.added_dice, '1d8');
  // Instance scaling (darts / rays / targets).
  var mm = upcastEffect('magic_missile', 5);
  assert.ok(mm);
  assert.strictEqual(mm.extra_instances, 4);
  var sr = upcastEffect('scorching_ray', 4);
  assert.ok(sr);
  assert.strictEqual(sr.extra_instances, 2);
  // The no-document entries still carry ladder data.
  var bless = upcastEffect('bless', 3);
  assert.ok(bless);
  assert.strictEqual(bless.extra_instances, 2);
  assert.strictEqual(bless.concentration, true);
  var sleep = upcastEffect('sleep', 2);
  assert.ok(sleep);
  assert.strictEqual(sleep.added_dice, '2d8');
  // totalDiceForCast merges same-sided dice and preserves a flat mod once.
  assert.strictEqual(totalDiceForCast('8d6', 'fireball', 5), '10d6');
  assert.strictEqual(totalDiceForCast('8d6', 'fireball', 3), '8d6');
  assert.strictEqual(totalDiceForCast('1d12', 'witch_bolt', 4), '4d12');
  assert.strictEqual(totalDiceForCast('1d8', 'spiritual_weapon', 6), '3d8');
  assert.strictEqual(totalDiceForCast('2d10+3', 'hellish_rebuke', 2), '3d10+3', 'flat modifier preserved once');
  assert.strictEqual(totalDiceForCast('1d4', 'magic_missile', 9), '1d4', 'instance upcasts never touch dice');
  assert.strictEqual(totalDiceForCast('3d8', 'nonsense', 5), '3d8', 'unknown spell passes base through');
});
