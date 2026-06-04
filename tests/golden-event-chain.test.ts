// Cross-language parity guard for the HMAC event chain (TS side).
//
// The vectors in test_vectors/event_chain_v1.json were GENERATED from this same
// EventChain (tools/gen-event-vectors.ts), and the Rust harness
// (rust/loom_events/tests/golden_event_chain.rs) reproduces them. This test
// re-derives them in TS so a later change to the canonical-message format is
// caught HERE (vectors stale -> regenerate + re-verify Rust) instead of silently
// desyncing the two languages.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { EventChain, hmacSha256Hex } from '../src/index.js';
import type { ChainedRecord } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(join(here, '..', 'test_vectors', 'event_chain_v1.json'), 'utf8'),
);

test('golden event-chain: raw HMAC primitive', () => {
  for (const c of vectors.hmac) {
    assert.equal(hmacSha256Hex(c.key, c.message), c.expect, JSON.stringify(c.message));
  }
});

test('golden event-chain: per-record sig + head + seal', () => {
  for (const spec of vectors.chains) {
    const chain = EventChain.create({ key: spec.key, genesis: spec.genesis });
    for (let i = 0; i < spec.records.length; i++) {
      const r = spec.records[i];
      const rec = chain.append(r.type, r.payload) as ChainedRecord | null;
      assert.ok(rec !== null, spec.label + ' record ' + i + ' rejected');
      assert.equal((rec as ChainedRecord).sig, spec.expect_sigs[i], spec.label + ' sig ' + i);
    }
    assert.equal(chain.head(), spec.expect_head, spec.label + ' head');
    const seal = chain.seal();
    assert.equal(seal.count, spec.seal.count, spec.label + ' seal.count');
    assert.equal(seal.head, spec.seal.head, spec.label + ' seal.head');
    assert.equal(seal.sig, spec.seal.sig, spec.label + ' seal.sig');
    assert.ok(chain.verify().ok, spec.label + ' verify');
  }
});
