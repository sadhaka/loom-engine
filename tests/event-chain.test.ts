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

// --- 2.2.2 hardening: strict canonicalization + verify-before-mutate --------

test('event-chain: lone surrogate is rejected on append (no seq advance)', () => {
  const chain = EventChain.create({ key: KEY });
  assert.equal(chain.append('\uD800', { x: 1 }), null);   // lone high surrogate in type
  assert.equal(chain.append('ok', { s: '\uDC00' }), null); // lone low surrogate in payload
  assert.equal(chain.size(), 0);
  assert.equal(chain.append('ok', { s: 'fine' })!.seq, 1); // seq not burned by rejects
});

test('event-chain: surrogate collision cannot pass verify', () => {
  const chain = EventChain.create({ key: KEY });
  chain.append('rec', { s: '�' });
  const snap = chain.toSnapshot();
  (snap[0]!.payload as { s: string }).s = '\uD800'; // distinct string, lossy under TextEncoder
  assert.equal(EventChain.verifyRecords(KEY, snap).ok, false);
});

test('event-chain: non-JSON payload values are rejected (no null collapse)', () => {
  const chain = EventChain.create({ key: KEY });
  assert.equal(chain.append('a', { x: NaN }), null);
  assert.equal(chain.append('a', { x: Infinity }), null);
  assert.equal(chain.append('a', { x: undefined }), null);
  assert.equal(chain.append('a', { d: new Date() }), null);
  assert.equal(chain.append('a', { m: new Map() }), null);
  assert.equal(chain.append('a', { s: new Set() }), null);
  assert.equal(chain.size(), 0);
  assert.equal(chain.append('a', { x: null })!.seq, 1); // null is valid JSON
});

test('event-chain: {x:null} and {x:NaN} no longer collide', () => {
  const chain = EventChain.create({ key: KEY });
  const r = chain.append('a', { x: null })!;
  const snap = chain.toSnapshot();
  (snap[0]!.payload as { x: unknown }).x = NaN; // would have collapsed to null pre-2.2.2
  assert.equal(EventChain.verifyRecords(KEY, snap).ok, false);
  assert.ok(r.sig.length === 64);
});

test('event-chain: fromVerifiedSnapshot does not mutate on a tampered snapshot', () => {
  const src = EventChain.create({ key: KEY });
  src.append('a', { x: 1 });
  src.append('b', { x: 2 });
  const snap = src.toSnapshot();
  (snap[1]!.payload as { x: number }).x = 999; // tamper

  const dst = EventChain.create({ key: KEY });
  const res = dst.fromVerifiedSnapshot(snap);
  assert.equal(res.ok, false);
  assert.equal(dst.size(), 0);            // instance untouched
  assert.equal(dst.head(), '');           // genesis unchanged

  // a clean snapshot loads fine. (toSnapshot deep-clones payloads as of 2.2.3,
  // so the tamper above did NOT dirty `src`; we build a fresh chain anyway for a
  // self-evidently clean snapshot.)
  const clean = EventChain.create({ key: KEY });
  clean.append('a', { x: 1 });
  clean.append('b', { x: 2 });
  const ok = dst.fromVerifiedSnapshot(clean.toSnapshot());
  assert.equal(ok.ok, true);
  assert.equal(dst.size(), 2);
});

// --- 2.2.3 hardening: round-2 audit (canonical injectivity + clone isolation) -

test('event-chain: negative zero is rejected on append (no seq advance)', () => {
  const chain = EventChain.create({ key: KEY });
  assert.equal(chain.append('a', { v: -0 }), null);
  assert.equal(chain.size(), 0);
  assert.equal(chain.append('a', { v: 0 })!.seq, 1); // +0 is valid; seq not burned
});

test('event-chain: 0 -> -0 tamper cannot pass verify', () => {
  const chain = EventChain.create({ key: KEY });
  chain.append('a', { v: 0 });
  const snap = chain.toSnapshot();
  (snap[0]!.payload as { v: number }).v = -0; // String(-0) === "0" but distinct value
  assert.equal(EventChain.verifyRecords(KEY, snap).ok, false);
});

test('event-chain: JSON-erased object metadata is rejected on append', () => {
  const chain = EventChain.create({ key: KEY });
  // symbol key
  const sym = Symbol('s');
  assert.equal(chain.append('a', { [sym]: 1 }), null);
  // non-enumerable own prop
  const nonEnum: Record<string, unknown> = {};
  Object.defineProperty(nonEnum, 'hidden', { value: 1, enumerable: false, configurable: true });
  assert.equal(chain.append('a', nonEnum), null);
  // accessor (getter) prop
  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, 'g', { get() { return 1; }, enumerable: true, configurable: true });
  assert.equal(chain.append('a', accessor), null);
  assert.equal(chain.size(), 0);
  assert.equal(chain.append('a', { plain: 1 })!.seq, 1); // seq not burned by rejects
});

test('event-chain: extra/symbol array properties are rejected on append', () => {
  const chain = EventChain.create({ key: KEY });
  const withExtra = [1, 2];
  (withExtra as unknown as Record<string, number>).extra = 9;
  assert.equal(chain.append('a', { arr: withExtra }), null);
  const withSym = [1];
  (withSym as unknown as Record<symbol, number>)[Symbol('x')] = 9;
  assert.equal(chain.append('a', { arr: withSym }), null);
  assert.equal(chain.size(), 0);
  assert.equal(chain.append('a', { arr: [1, 2] })!.seq, 1); // a plain array is fine
});

test('event-chain: a JSON-parsed __proto__ data key is rejected on append', () => {
  const chain = EventChain.create({ key: KEY });
  const polluted = JSON.parse('{"__proto__":{"x":1}}'); // own "__proto__" data key
  assert.equal(chain.append('a', polluted), null);
  assert.equal(chain.size(), 0);
  assert.equal(chain.append('a', { ok: 1 })!.seq, 1); // seq not burned
});

test('event-chain: verifySeal returns false (no throw) on a lone-surrogate head', () => {
  const chain = EventChain.create({ key: KEY });
  chain.append('a', { x: 1 });
  const seal = chain.seal();
  const bad = { ...seal, head: '\uD800' }; // tampered head with a lone high surrogate
  assert.equal(EventChain.verifySeal(KEY, bad), false);
  assert.equal(EventChain.verifyRecords(KEY, chain.toSnapshot(), '', bad).ok, false);
});

test('event-chain: toSnapshot payload is a deep copy - mutating it cannot reach chain state', () => {
  const chain = EventChain.create({ key: KEY });
  chain.append('a', { x: 1 });
  const snap = chain.toSnapshot();
  (snap[0]!.payload as { x: number }).x = 999;
  assert.equal(chain.verify().ok, true);                          // live chain intact
  assert.equal((chain.bySeq(1)!.payload as { x: number }).x, 1);  // stored value unchanged
});

test('event-chain: fromSnapshot deep-copies - mutating the source after load is inert', () => {
  const src = EventChain.create({ key: KEY });
  src.append('a', { x: 1 });
  const snap = src.toSnapshot();
  const dst = EventChain.create({ key: KEY });
  dst.fromSnapshot(snap);
  (snap[0]!.payload as { x: number }).x = 999;                    // mutate source AFTER load
  assert.equal(dst.verify().ok, true);
  assert.equal((dst.bySeq(1)!.payload as { x: number }).x, 1);
});

test('event-chain: append deep-copies - mutating the caller object after append is inert', () => {
  const chain = EventChain.create({ key: KEY });
  const input = { x: 1 };
  chain.append('a', input);
  input.x = 999;                                                  // mutate caller object AFTER append
  assert.equal(chain.verify().ok, true);
  assert.equal((chain.bySeq(1)!.payload as { x: number }).x, 1);
});

// --- 2.2.5 hardening: bounded recursion depth (DoS guard) -------------------

function nestObject(n: number): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let cur = root;
  for (let i = 0; i < n; i++) {
    const next: Record<string, unknown> = {};
    cur.n = next;
    cur = next;
  }
  return root;
}

test('event-chain: payload nested past the depth cap is rejected on append (no seq burn)', () => {
  const chain = EventChain.create({ key: KEY });
  assert.equal(chain.append('a', nestObject(5000)), null); // too deep -> rejected early
  assert.equal(chain.size(), 0);
  assert.equal(chain.append('a', nestObject(50))!.seq, 1); // reasonable nesting is fine
});

test('event-chain: a pathologically deep tampered snapshot fails verify (no throw)', () => {
  const chain = EventChain.create({ key: KEY });
  chain.append('a', { x: 1 });
  const snap = chain.toSnapshot();
  (snap[0] as { payload: unknown }).payload = nestObject(5000); // tamper with a deep object
  const res = EventChain.verifyRecords(KEY, snap);
  assert.equal(res.ok, false); // fails closed via sig_mismatch, does not throw
});

test('event-chain: depth-cap boundary - 256 deep signs, 257 deep rejects', () => {
  const chain = EventChain.create({ key: KEY });
  assert.ok(chain.append('a', nestObject(256)));            // exactly at the cap - allowed
  assert.equal(chain.append('b', nestObject(257)), null);   // one past the cap - rejected
  assert.equal(chain.size(), 1);                            // only the in-bounds one landed
});

test('event-chain: equivalent nested payloads sign identically across instances', () => {
  const a = EventChain.create({ key: KEY }).append('e', nestObject(10))!;
  const b = EventChain.create({ key: KEY }).append('e', nestObject(10))!;
  assert.equal(a.sig, b.sig); // depth is not part of the signed message
});

test('event-chain: raw fromSnapshot is transactional - a too-deep row leaves the instance intact', () => {
  const src = EventChain.create({ key: KEY });
  src.append('a', { x: 1 });
  src.append('b', { x: 2 });
  const dst = EventChain.create({ key: KEY });
  dst.fromSnapshot(src.toSnapshot());
  assert.equal(dst.size(), 2);
  const headBefore = dst.head();

  // Hostile snapshot: one row's payload is past the depth cap.
  const hostile = src.toSnapshot();
  (hostile[1] as { payload: unknown }).payload = nestObject(5000);
  assert.doesNotThrow(() => { dst.fromSnapshot(hostile); }); // 2.2.5 MED: no throw
  assert.equal(dst.size(), 2);            // prior records intact
  assert.equal(dst.head(), headBefore);   // headSig not desynced
});
