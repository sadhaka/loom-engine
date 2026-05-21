import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { EventChain, RESOURCE_EVENT_CHAIN } from '../src/index.js';

const KEY = 'test-runtime-secret';

test('event-chain: RESOURCE_EVENT_CHAIN is the stable string', () => {
  assert.equal(RESOURCE_EVENT_CHAIN, 'event_chain');
});

test('event-chain: create requires a non-empty key', () => {
  assert.throws(() => EventChain.create({ key: '' }));
  // @ts-expect-error - intentionally missing key
  assert.throws(() => EventChain.create({}));
});

test('event-chain: append assigns monotonic seq + a 64-hex signature', () => {
  const chain = EventChain.create({ key: KEY });
  const r1 = chain.append('combat.hit', { dmg: 7 });
  const r2 = chain.append('xp.award', { amount: 500 });
  assert.ok(r1 && r2);
  assert.equal(r1!.seq, 1);
  assert.equal(r2!.seq, 2);
  assert.match(r1!.sig, /^[0-9a-f]{64}$/);
  assert.equal(chain.size(), 2);
});

test('event-chain: first prevSig is genesis, each record links to the prior sig', () => {
  const chain = EventChain.create({ key: KEY });
  const r1 = chain.append('a', { x: 1 })!;
  const r2 = chain.append('b', { x: 2 })!;
  assert.equal(r1.prevSig, '');
  assert.equal(r2.prevSig, r1.sig);
  assert.equal(chain.head(), r2.sig);
});

test('event-chain: a clean chain verifies', () => {
  const chain = EventChain.create({ key: KEY });
  chain.append('a', { x: 1 });
  chain.append('b', { y: 2 });
  chain.append('c', { z: 3 });
  const res = chain.verify();
  assert.equal(res.ok, true);
  assert.equal(res.total, 3);
  assert.equal(res.mismatches.length, 0);
});

test('event-chain: field tamper is caught (sig_mismatch)', () => {
  const chain = EventChain.create({ key: KEY });
  chain.append('a', { x: 1 });
  chain.append('b', { y: 2 });
  const snap = chain.toSnapshot();
  (snap[1]!.payload as { y: number }).y = 999;
  const res = EventChain.verifyRecords(KEY, snap);
  assert.equal(res.ok, false);
  assert.ok(res.mismatches.some((m) => m.reason === 'sig_mismatch'));
});

test('event-chain: deleting a middle record is caught (broken_chain_link)', () => {
  const chain = EventChain.create({ key: KEY });
  chain.append('a', { x: 1 });
  chain.append('b', { x: 2 });
  chain.append('c', { x: 3 });
  const snap = chain.toSnapshot();
  snap.splice(1, 1);
  const res = EventChain.verifyRecords(KEY, snap);
  assert.equal(res.ok, false);
  assert.ok(res.mismatches.some((m) => m.reason === 'broken_chain_link'));
});

test('event-chain: reordering is caught', () => {
  const chain = EventChain.create({ key: KEY });
  chain.append('a', { x: 1 });
  chain.append('b', { x: 2 });
  chain.append('c', { x: 3 });
  const snap = chain.toSnapshot();
  const tmp = snap[1]!;
  snap[1] = snap[2]!;
  snap[2] = tmp;
  const res = EventChain.verifyRecords(KEY, snap);
  assert.equal(res.ok, false);
});

test('event-chain: verification fails under the wrong key', () => {
  const chain = EventChain.create({ key: KEY });
  chain.append('a', { x: 1 });
  const res = EventChain.verifyRecords('wrong-key', chain.toSnapshot());
  assert.equal(res.ok, false);
});

test('event-chain: deterministic - canonical JSON sorts keys', () => {
  const c1 = EventChain.create({ key: KEY });
  const c2 = EventChain.create({ key: KEY });
  const a1 = c1.append('e', { a: 1, b: 2 })!;
  const a2 = c2.append('e', { b: 2, a: 1 })!;
  assert.equal(a1.sig, a2.sig);
});

test('event-chain: snapshot round-trip verifies + continues the chain', () => {
  const chain = EventChain.create({ key: KEY });
  chain.append('a', { x: 1 });
  chain.append('b', { x: 2 });
  const snap = chain.toSnapshot();

  const restored = EventChain.create({ key: KEY });
  restored.fromSnapshot(snap);
  assert.equal(restored.size(), 2);
  assert.equal(restored.verify().ok, true);
  assert.equal(restored.head(), chain.head());

  const r3 = restored.append('c', { x: 3 })!;
  assert.equal(r3.seq, 3);
  assert.equal(r3.prevSig, snap[1]!.sig);
  assert.equal(restored.verify().ok, true);
});

test('event-chain: genesis anchor changes signatures + binds verification', () => {
  const c1 = EventChain.create({ key: KEY });
  const c2 = EventChain.create({ key: KEY, genesis: 'world-seed-42' });
  const s1 = c1.append('a', { x: 1 })!;
  const s2 = c2.append('a', { x: 1 })!;
  assert.notEqual(s1.sig, s2.sig);
  assert.equal(EventChain.verifyRecords(KEY, c2.toSnapshot(), 'world-seed-42').ok, true);
  assert.equal(EventChain.verifyRecords(KEY, c2.toSnapshot()).ok, false);
});

test('event-chain: byType + bySeq lookups', () => {
  const chain = EventChain.create({ key: KEY });
  chain.append('hit', { x: 1 });
  chain.append('miss', { x: 2 });
  chain.append('hit', { x: 3 });
  assert.equal(chain.byType('hit').length, 2);
  assert.equal(chain.bySeq(2)!.type, 'miss');
  assert.equal(chain.bySeq(99), null);
});

test('event-chain: dispose stops further appends', () => {
  const chain = EventChain.create({ key: KEY });
  chain.append('a', { x: 1 });
  chain.dispose();
  assert.equal(chain.append('b', { x: 2 }), null);
});

test('event-chain: empty / invalid type is rejected', () => {
  const chain = EventChain.create({ key: KEY });
  assert.equal(chain.append('', { x: 1 }), null);
  assert.equal(chain.size(), 0);
});

// --- 2.2.1 hardening: injective encoding ----------------------------------

test('event-chain: delimiter-laden type/payload still verify (injective encoding)', () => {
  const chain = EventChain.create({ key: KEY });
  chain.append('a|b:c', { 'k|prev:': '99:zzz', nested: { '|': '::' } });
  chain.append('plain', { x: 1 });
  assert.equal(chain.verify().ok, true);
});

test('event-chain: boundary-shift forgery does not collide', () => {
  // Under a raw "|"-join these two could alias; length-prefixing prevents it.
  const a = EventChain.create({ key: KEY }).append('x', { v: 'a|b' })!;
  const b = EventChain.create({ key: KEY }).append('x|b', { v: 'a' })!;
  assert.notEqual(a.sig, b.sig);
});

// --- 2.2.1 hardening: seal / tail-truncation ------------------------------

test('event-chain: seal + verifySeal round-trip', () => {
  const chain = EventChain.create({ key: KEY });
  chain.append('a', { x: 1 });
  chain.append('b', { x: 2 });
  const seal = chain.seal();
  assert.equal(seal.count, 2);
  assert.equal(seal.head, chain.head());
  assert.equal(EventChain.verifySeal(KEY, seal), true);
  assert.equal(EventChain.verifySeal('wrong-key', seal), false);
  assert.equal(EventChain.verifySeal(KEY, { ...seal, count: 3 }), false);
});

test('event-chain: tail truncation is caught only with a seal', () => {
  const chain = EventChain.create({ key: KEY });
  chain.append('a', { x: 1 });
  chain.append('b', { x: 2 });
  chain.append('c', { x: 3 });
  const seal = chain.seal();
  const snap = chain.toSnapshot();
  snap.pop(); // drop the last record off the END

  // Without the seal, a bare hash chain CANNOT see tail truncation:
  assert.equal(EventChain.verifyRecords(KEY, snap).ok, true);
  // With the seal, it is detected:
  const res = EventChain.verifyRecords(KEY, snap, '', seal);
  assert.equal(res.ok, false);
  assert.ok(res.mismatches.some((m) => m.reason === 'seal_mismatch'));
});

test('event-chain: intact chain verifies against its own seal', () => {
  const chain = EventChain.create({ key: KEY });
  chain.append('a', { x: 1 });
  chain.append('b', { x: 2 });
  const seal = chain.seal();
  assert.equal(chain.verify(seal).ok, true);
});
