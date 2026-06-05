// gen-snapshot-vectors.ts - generate the v3.0 world-state snapshot golden vector.
//
// Runs the REAL TS WorldStateSnapshot implementation to compute the reference
// canonical encoding + state_hash for each case, and writes
// test_vectors/v3_0_snapshot_canonical.json. Rust + Python must reproduce these
// byte-for-byte. Re-run with:  npx tsx tools/gen-snapshot-vectors.ts
//
// All non-ASCII characters use \u escapes (pure-ASCII source) so no editor /
// filesystem can corrupt them - a real risk on the Windows mount.
//
// The cases pin the cross-language traps the Pantheon flagged:
//   - integer edges (max safe int, negatives, zero)
//   - id key ordering (UTF-16 lexicographic: '10' before '2')
//   - THE astral trap, strict form: an astral char (U+1F40D) vs a high-BMP char
//     (U+F8FF) whose UTF-16 and UTF-8 sort orders INVERT:
//       UTF-16 units: 'a'=0x61  <  ASTRAL lead 0xD83D  <  BMP 0xF8FF
//       UTF-8  bytes: 'a'=0x61  <  BMP lead 0xEF       <  ASTRAL lead 0xF0
//     We sort by UTF-16 everywhere, so expected order is a, ASTRAL, BMP. A
//     surface that lazily used native UTF-8/byte ordering for keys OR tags
//     produces a, BMP, ASTRAL -> different bytes -> different hash -> caught.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  canonicalWorldState,
  worldStateHash,
  normalizeTags,
} from '../src/runtime/world-state-snapshot.js';

var KEY = 'v3-snapshot-golden-key';

// U+1F40D (astral; UTF-16 surrogate pair D83D DC0D; UTF-8 F0 9F 90 8D)
var ASTRAL = '🐍';
// U+F8FF (BMP private-use; UTF-16 unit F8FF; UTF-8 EF A3 BF)
var BMP = '';

var CASES: Array<{ label: string; state: unknown }> = [
  {
    label: 'empty world',
    state: { epoch: 0, worldSeed: 0, entities: {} },
  },
  {
    label: 'integer edges (max safe int, negative, zero)',
    state: {
      epoch: 1,
      worldSeed: 12345,
      entities: {
        hero: {
          properties: { hp: 30, str: -3, max: 9007199254740991, min: -9007199254740991, zero: 0 },
          tags: normalizeTags(['pc', 'alive']),
        },
      },
    },
  },
  {
    label: 'id keys sort UTF-16 lexicographic (10 before 2 before alpha)',
    state: {
      epoch: 7,
      worldSeed: 99,
      entities: {
        '2': { properties: { n: 2 }, tags: [] },
        '10': { properties: { n: 10 }, tags: [] },
        alpha: { properties: { n: 1 }, tags: [] },
      },
    },
  },
  {
    label: 'ASTRAL TRAP: UTF-16 vs UTF-8 invert (expected UTF-16: a, astral, bmp)',
    state: {
      epoch: 3,
      worldSeed: 42,
      entities: {
        // entity-map keys, one entity's property keys, and its tags all carry
        // the three discriminating chars in scrambled input order.
        [ASTRAL]: {
          properties: { a: 1, [ASTRAL]: 2, [BMP]: 3 },
          tags: normalizeTags([BMP, ASTRAL, 'a']),
        },
        [BMP]: { properties: { hp: 5 }, tags: [] },
        a: { properties: { hp: 1 }, tags: [] },
      },
    },
  },
  {
    label: 'nested regions',
    state: {
      epoch: 12,
      worldSeed: 7,
      rulesetRef: 'dnd5e@1',
      entities: { hero: { properties: { hp: 22 }, tags: ['pc'] } },
      regions: {
        north: { danger: 5, factions: { wolves: 2, crows: 1 } },
        south: { danger: 1, factions: {} },
      },
    },
  },
];

var out = {
  meta: {
    engine_version: '2.3.0',
    vector: 'v3.0 world-state snapshot',
    domain: 'loom.snapshot/1',
    key: KEY,
    note: 'state_hash = HMAC-SHA-256(key, field(domain) + field(canonicalJson(state))). One sort rule: UTF-16 code units, keys AND tags.',
  },
  cases: CASES.map(function (c) {
    return {
      label: c.label,
      key: KEY,
      input: c.state,
      expect_canonical: canonicalWorldState(c.state),
      expect_hash: worldStateHash(KEY, c.state),
    };
  }),
};

var here = dirname(fileURLToPath(import.meta.url));
var dest = join(here, '..', 'test_vectors', 'v3_0_snapshot_canonical.json');
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('wrote ' + dest + ' (' + out.cases.length + ' cases)');
for (var i = 0; i < out.cases.length; i++) {
  console.log('  ' + out.cases[i].label + ' -> ' + out.cases[i].expect_hash.slice(0, 16) + '...');
}
