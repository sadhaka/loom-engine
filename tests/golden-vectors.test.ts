// Cross-language golden-vector runner (TypeScript side).
//
// Loads the SHARED ../test_vectors/*.json - the same files the Python (and
// future Rust) harnesses load - and asserts the TS implementation produces the
// canonical outputs. TS + Python both passing the same vectors == proven
// byte-identical. This is the parity gate.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  bandFromDistanceFt,
  bandWithin,
  findInventedNumber,
  initiativeOrder,
  compareIds,
  createReactionLedger,
  canReact,
  spendReaction,
  advanceReactionRound,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(join(here, '..', 'test_vectors', 'v2_3_0_primitives.json'), 'utf8'),
);

test('golden: range_bands.band_from_distance_ft', () => {
  for (const c of vectors['range_bands.band_from_distance_ft']) {
    assert.equal(bandFromDistanceFt(c.args[0]), c.expect, JSON.stringify(c));
  }
});

test('golden: range_bands.band_within', () => {
  for (const c of vectors['range_bands.band_within']) {
    assert.equal(bandWithin(c.args[0], c.args[1]), c.expect, JSON.stringify(c));
  }
});

test('golden: narration.find_invented_number', () => {
  for (const c of vectors['narration.find_invented_number']) {
    const got = findInventedNumber(c.args[0], c.args[1]);
    // JSON null <-> JS null (the fn returns null, not undefined).
    assert.equal(got, c.expect === null ? null : c.expect, JSON.stringify(c));
  }
});

test('golden: ruleset.initiative_order_ids', () => {
  for (const c of vectors['ruleset.initiative_order_ids']) {
    const ids = initiativeOrder(c.entries).map((e: { id: string }) => e.id);
    assert.deepEqual(ids, c.expect);
  }
});

test('golden: ruleset.compare_ids', () => {
  for (const c of vectors['ruleset.compare_ids']) {
    const sorted = (c.input as string[]).slice().sort(compareIds);
    assert.deepEqual(sorted, c.expect_asc, JSON.stringify(c.input));
  }
});

test('golden: reaction.scripted', () => {
  for (const c of vectors['reaction.scripted']) {
    const ledger = createReactionLedger();
    const out: Array<boolean | number> = [];
    for (const op of c.ops) {
      if (op[0] === 'spend') out.push(spendReaction(ledger, op[1]));
      else if (op[0] === 'can_react') out.push(canReact(ledger, op[1]));
      else if (op[0] === 'advance') out.push(advanceReactionRound(ledger));
    }
    assert.deepEqual(out, c.expect);
  }
});
