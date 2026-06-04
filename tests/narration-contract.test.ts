// v2.3.0 - Narration Contract (no-invented-number guarantee) tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  parseNumberWord,
  extractCandidateNumbers,
  findInventedNumber,
  isNarrationGrounded,
  RESOURCE_NARRATION_CONTRACT,
} from '../src/index.js';

test('narration-contract: RESOURCE key stable', () => {
  assert.equal(RESOURCE_NARRATION_CONTRACT, 'narrationContract');
});

test('narration-contract: parseNumberWord', () => {
  assert.equal(parseNumberWord('seven'), 7);
  assert.equal(parseNumberWord('twenty'), 20);
  assert.equal(parseNumberWord('twenty-one'), 21);
  assert.equal(parseNumberWord('twenty one'), 21);
  assert.equal(parseNumberWord('ninety-nine'), 99);
  assert.equal(parseNumberWord('banana'), null);
  assert.equal(parseNumberWord(''), null);
});

test('narration-contract: extractCandidateNumbers - numerals + number-words', () => {
  assert.deepEqual(extractCandidateNumbers('you roll 18 and take 7 damage'), [18, 7]);
  assert.deepEqual(extractCandidateNumbers('seven damage, a total of twenty-one'), [7, 21]);
  assert.deepEqual(extractCandidateNumbers('twenty one slashes'), [21]); // folded once
  assert.deepEqual(extractCandidateNumbers('1,024 gold pieces'), [1024]);
  assert.deepEqual(extractCandidateNumbers('no numbers here'), []);
});

// ---------- the guarantee: prose may only state engine numbers ----------

test('narration-contract: grounded prose (numeral matches engine) -> no invention', () => {
  assert.equal(findInventedNumber('Your blade bites for 7 damage.', [7]), null);
  assert.equal(isNarrationGrounded('Your blade bites for 7 damage.', [7]), true);
});

test('narration-contract: invented numeral is caught', () => {
  assert.equal(findInventedNumber('Your blade bites for 9 damage.', [7]), 9);
  assert.equal(isNarrationGrounded('Your blade bites for 9 damage.', [7]), false);
});

test('narration-contract: number-WORDS are checked too (no smuggling)', () => {
  assert.equal(findInventedNumber('You take seven damage.', [7]), null);     // grounded
  assert.equal(findInventedNumber('You take eight damage.', [7]), 8);        // invented
});

test('narration-contract: a full attested exchange passes; one stray invented number fails', () => {
  const attested = [18, 15, 7]; // roll 18 vs DC 15, 7 damage
  assert.equal(isNarrationGrounded('You roll 18 against DC 15 and deal 7 damage.', attested), true);
  assert.equal(findInventedNumber('You roll 18 against DC 15 and deal twenty-one damage.', attested), 21);
});

test('narration-contract: small flavor counts are ignored by default, scrutinized when floor=0', () => {
  assert.equal(findInventedNumber('Two guards block the door.', []), null);        // 2 <= floor 2
  assert.equal(findInventedNumber('Two guards block the door.', [], { ignoreAtOrBelow: 0 }), 2);
  assert.equal(findInventedNumber('A dozen torches; 3 of them lit.', [3]), null);  // 3 attested
});
