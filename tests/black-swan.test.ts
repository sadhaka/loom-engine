// Loom Engine - BlackSwan (chaos engine) tests.
//
// Covers constructor validation, the windowed entropy monitor, the
// governed event-proposal state machine, and the 7 Codex gates:
//   gate 1 - entropy() is a normalized rate; tick() rolls the window.
//   gate 2 - propose() is the untrusted entry: bad input is a counted
//            rejection (EVENT_HANDLE_INVALID), never a throw.
//   gate 3 - propose() validates proposer / kind / scopeRadius / ttl.
//   gate 4 - propose() server-generates the handle.
//   gate 5 - provenance / ttl / scopeRadius are stored; revoke() kills
//            a live event; every transition lands in the audit ring.
//   gate 6 - the handle's generation is the epoch: a stale handle is a
//            no-op; repeated / illegal transitions are idempotent.
//   gate 7 - activate(handle, true) -> CANARY; promote() -> ACTIVE.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  BlackSwan,
  makeEventHandle,
  eventSlot,
  eventGeneration,
  EVENT_STATE_NONE,
  EVENT_STATE_PROPOSED,
  EVENT_STATE_APPROVED,
  EVENT_STATE_CANARY,
  EVENT_STATE_ACTIVE,
  EVENT_STATE_EXPIRED,
  EVENT_STATE_REJECTED,
  EVENT_STATE_REVOKED,
  EVENT_HANDLE_INVALID,
  AUDIT_RECORD_STRIDE,
  type BlackSwanConfig,
} from '../src/index.js';

// A default config with selective overrides.
function cfg(over: Partial<BlackSwanConfig> = {}): BlackSwanConfig {
  return {
    entropyWindow: 8,
    chaosThreshold: 2,
    maxEvents: 8,
    maxKinds: 4,
    maxProposers: 4,
    auditLogSize: 32,
    ...over,
  };
}

// Read audit record `i` into a plain object.
function audit(bs: BlackSwan, i: number): {
  slot: number; generation: number; kind: number; from: number; to: number; tick: number;
} {
  const o = new Uint32Array(AUDIT_RECORD_STRIDE);
  bs.readAuditRecord(i, o);
  const transition = o[3] ?? 0;
  return {
    slot: o[0] ?? 0,
    generation: o[1] ?? 0,
    kind: o[2] ?? 0,
    from: transition >> 8,
    to: transition & 0xff,
    tick: o[4] ?? 0,
  };
}

test('black swan: constructor validates the config', () => {
  const bs = new BlackSwan(cfg());
  assert.equal(bs.entropyWindow, 8);
  assert.equal(bs.chaosThreshold, 2);
  assert.equal(bs.maxEvents, 8);
  assert.equal(bs.maxKinds, 4);
  assert.equal(bs.maxProposers, 4);
  assert.equal(bs.auditLogSize, 32);
  assert.throws(() => new BlackSwan(cfg({ entropyWindow: 0 })), /entropyWindow/);
  assert.throws(() => new BlackSwan(cfg({ entropyWindow: 1.5 })), /entropyWindow/);
  assert.throws(() => new BlackSwan(cfg({ chaosThreshold: -1 })), /chaosThreshold/);
  assert.throws(() => new BlackSwan(cfg({ chaosThreshold: NaN })), /chaosThreshold/);
  assert.doesNotThrow(() => new BlackSwan(cfg({ chaosThreshold: 0 })), 'threshold 0 is valid');
  assert.doesNotThrow(() => new BlackSwan(cfg({ chaosThreshold: 0.25 })), 'a fractional threshold is valid');
  assert.throws(() => new BlackSwan(cfg({ maxEvents: 0 })), /maxEvents/);
  assert.throws(() => new BlackSwan(cfg({ maxEvents: (1 << 16) + 1 })), /maxEvents/);
  assert.throws(() => new BlackSwan(cfg({ maxKinds: 0 })), /maxKinds/);
  assert.throws(() => new BlackSwan(cfg({ maxProposers: 0 })), /maxProposers/);
  assert.throws(() => new BlackSwan(cfg({ auditLogSize: 0 })), /auditLogSize/);
});

test('black swan: entropy is a normalized windowed rate (gate 1)', () => {
  const bs = new BlackSwan(cfg({ entropyWindow: 4, chaosThreshold: 2.5 }));
  assert.equal(bs.entropy(), 0);
  assert.equal(bs.entropyExceedsThreshold(), false);
  // 8 units in the window of 4 -> rate 2.
  bs.addEntropy(8);
  assert.equal(bs.getEntropySum(), 8);
  assert.equal(bs.entropy(), 2);
  assert.equal(bs.entropyExceedsThreshold(), false, '2 is not > 2.5');
  // Another tick's worth lifts the rate above the threshold.
  bs.tick(1);
  bs.addEntropy(4);
  assert.equal(bs.entropy(), 3, '(8 + 4) / 4');
  assert.equal(bs.entropyExceedsThreshold(), true, '3 > 2.5');
  // The tick-0 bucket falls out of the window exactly 4 ticks later.
  bs.tick(2);
  bs.tick(3);
  assert.equal(bs.entropy(), 3, 'tick-0 entropy still in the window');
  bs.tick(4);
  assert.equal(bs.entropy(), 1, 'tick-0 entropy (8) aged out -> (4) / 4');
});

test('black swan: addEntropy validates and saturates', () => {
  const bs = new BlackSwan(cfg({ entropyWindow: 2 }));
  assert.throws(() => bs.addEntropy(-1), /amount/);
  assert.throws(() => bs.addEntropy(1.5), /amount/);
  assert.throws(() => bs.addEntropy(NaN), /amount/);
  // The per-tick bucket saturates at U32_MAX rather than wrapping.
  bs.addEntropy(0xffffffff);
  bs.addEntropy(0xffffffff);
  assert.equal(bs.getEntropySum(), 0xffffffff, 'bucket saturated, did not wrap');
});

test('black swan: propose enters PROPOSED with a server-generated handle (gates 3, 4)', () => {
  const bs = new BlackSwan(cfg());
  const h = bs.propose(2, 1, 50, 10);
  assert.notEqual(h, EVENT_HANDLE_INVALID);
  assert.equal(bs.getState(h), EVENT_STATE_PROPOSED);
  assert.equal(bs.getProposer(h), 2);
  assert.equal(bs.getKind(h), 1);
  assert.equal(bs.getScopeRadius(h), 50);
  assert.equal(bs.getTtl(h), 10);
  assert.equal(bs.isLive(h), true);
  assert.equal(bs.isActive(h), false);
  assert.equal(bs.getLiveEventCount(), 1);
  // The handle is server-generated: slot in range, generation 0 on first use.
  assert.ok(eventSlot(h) >= 0 && eventSlot(h) < bs.maxEvents);
  assert.equal(eventGeneration(h), 0);
});

test('black swan: propose treats all input as untrusted - rejects, never throws (gates 2, 3)', () => {
  const bs = new BlackSwan(cfg({ maxKinds: 4, maxProposers: 4 }));
  // Every malformed proposal is a counted rejection returning the
  // invalid sentinel - propose() must not throw on bad input.
  assert.equal(bs.propose(99, 0, 0, 1), EVENT_HANDLE_INVALID, 'proposer out of range');
  assert.equal(bs.propose(0, 99, 0, 1), EVENT_HANDLE_INVALID, 'kind out of range');
  assert.equal(bs.propose(0, 0, -1, 1), EVENT_HANDLE_INVALID, 'negative scopeRadius');
  assert.equal(bs.propose(0, 0, 0, 0), EVENT_HANDLE_INVALID, 'ttl 0');
  assert.equal(bs.propose(0, 0, 0, -5), EVENT_HANDLE_INVALID, 'negative ttl');
  assert.equal(bs.propose(1.5, 0, 0, 1), EVENT_HANDLE_INVALID, 'non-integer proposer');
  assert.equal(bs.getRejectedProposalCount(), 6);
  assert.equal(bs.getLiveEventCount(), 0, 'no rejected proposal occupied a slot');
});

test('black swan: a full table is backpressure, not an exception (gate 2)', () => {
  const bs = new BlackSwan(cfg({ maxEvents: 2 }));
  assert.notEqual(bs.propose(0, 0, 0, 5), EVENT_HANDLE_INVALID);
  assert.notEqual(bs.propose(0, 0, 0, 5), EVENT_HANDLE_INVALID);
  // Third proposal has nowhere to go - rejected, counted, not thrown.
  assert.equal(bs.propose(0, 0, 0, 5), EVENT_HANDLE_INVALID);
  assert.equal(bs.getRejectedProposalCount(), 1);
});

test('black swan: lifecycle PROPOSED -> APPROVED -> ACTIVE -> EXPIRED', () => {
  const bs = new BlackSwan(cfg());
  bs.tick(100);
  const h = bs.propose(0, 0, 0, 3);   // ttl 3
  assert.equal(bs.approve(h), true);
  assert.equal(bs.getState(h), EVENT_STATE_APPROVED);
  assert.equal(bs.activate(h, false), true);
  assert.equal(bs.getState(h), EVENT_STATE_ACTIVE);
  assert.equal(bs.isActive(h), true);
  // Activated at tick 100, ttl 3 -> expiry tick 103.
  assert.equal(bs.getActivationTick(h), 100);
  assert.equal(bs.getExpiryTick(h), 103);
  bs.tick(101);
  bs.tick(102);
  assert.equal(bs.getState(h), EVENT_STATE_ACTIVE, 'still live before expiry');
  const expired = bs.tick(103);
  assert.equal(expired, 1, 'tick 103 expires the event');
  assert.equal(bs.getState(h), EVENT_STATE_EXPIRED);
  assert.equal(bs.isLive(h), false);
  assert.equal(bs.getLiveEventCount(), 0);
});

test('black swan: reject ends a proposal terminally', () => {
  const bs = new BlackSwan(cfg());
  const h = bs.propose(0, 0, 0, 5);
  assert.equal(bs.reject(h), true);
  assert.equal(bs.getState(h), EVENT_STATE_REJECTED);
  assert.equal(bs.getLiveEventCount(), 0);
  // A rejected event cannot be approved or activated.
  assert.equal(bs.approve(h), false);
  assert.equal(bs.activate(h, false), false);
});

test('black swan: canary rollout - activate as CANARY, then promote (gate 7)', () => {
  const bs = new BlackSwan(cfg());
  const h = bs.propose(0, 0, 0, 50);
  bs.approve(h);
  assert.equal(bs.activate(h, true), true, 'activate as canary');
  assert.equal(bs.getState(h), EVENT_STATE_CANARY);
  assert.equal(bs.isCanary(h), true);
  assert.equal(bs.isActive(h), false);
  assert.equal(bs.isLive(h), true);
  // promote rolls the dry-run to full effect.
  assert.equal(bs.promote(h), true);
  assert.equal(bs.getState(h), EVENT_STATE_ACTIVE);
  assert.equal(bs.isActive(h), true);
  assert.equal(bs.isCanary(h), false);
  // promote only works on a CANARY event.
  assert.equal(bs.promote(h), false, 'cannot promote an already-ACTIVE event');
});

test('black swan: revoke kills a live event from APPROVED / CANARY / ACTIVE (gate 5)', () => {
  // From APPROVED.
  const a = new BlackSwan(cfg());
  const ha = a.propose(0, 0, 0, 5);
  a.approve(ha);
  assert.equal(a.revoke(ha), true);
  assert.equal(a.getState(ha), EVENT_STATE_REVOKED);
  // From CANARY.
  const c = new BlackSwan(cfg());
  const hc = c.propose(0, 0, 0, 5);
  c.approve(hc);
  c.activate(hc, true);
  assert.equal(c.revoke(hc), true);
  assert.equal(c.getState(hc), EVENT_STATE_REVOKED);
  // From ACTIVE.
  const v = new BlackSwan(cfg());
  const hv = v.propose(0, 0, 0, 5);
  v.approve(hv);
  v.activate(hv, false);
  assert.equal(v.revoke(hv), true);
  assert.equal(v.getState(hv), EVENT_STATE_REVOKED);
  assert.equal(v.getLiveEventCount(), 0);
  // revoke does not apply to a PROPOSED event (that is reject's job).
  const p = new BlackSwan(cfg());
  const hp = p.propose(0, 0, 0, 5);
  assert.equal(p.revoke(hp), false);
  assert.equal(p.getState(hp), EVENT_STATE_PROPOSED);
});

test('black swan: illegal and repeated transitions are idempotent no-ops (gate 6)', () => {
  const bs = new BlackSwan(cfg());
  const h = bs.propose(0, 0, 0, 5);
  // Cannot activate or promote a PROPOSED event.
  assert.equal(bs.activate(h, false), false);
  assert.equal(bs.promote(h), false);
  assert.equal(bs.getState(h), EVENT_STATE_PROPOSED, 'illegal transitions left the state alone');
  // approve once succeeds; a second approve is a no-op.
  assert.equal(bs.approve(h), true);
  assert.equal(bs.approve(h), false, 'repeated approve is idempotent');
  assert.equal(bs.getState(h), EVENT_STATE_APPROVED);
  // Commands on the invalid sentinel handle are safe no-ops.
  assert.equal(bs.approve(EVENT_HANDLE_INVALID), false);
  assert.equal(bs.getState(EVENT_HANDLE_INVALID), EVENT_STATE_NONE);
});

test('black swan: a stale handle (reused slot) fails validation - the generation is the epoch (gate 6)', () => {
  const bs = new BlackSwan(cfg({ maxEvents: 1 }));   // one slot - forces reuse
  const first = bs.propose(0, 0, 0, 5);
  assert.equal(eventGeneration(first), 0);
  bs.reject(first);   // terminal - the slot becomes reusable
  const second = bs.propose(1, 1, 0, 5);
  assert.equal(eventSlot(second), eventSlot(first), 'same slot reused');
  assert.equal(eventGeneration(second), 1, 'generation bumped on reuse');
  assert.notEqual(second, first);
  // The stale first handle no longer resolves.
  assert.equal(bs.getState(first), EVENT_STATE_NONE);
  assert.equal(bs.approve(first), false, 'a command on a stale handle is a no-op');
  assert.equal(bs.getKind(first), -1);
  // The fresh handle works.
  assert.equal(bs.getState(second), EVENT_STATE_PROPOSED);
  assert.equal(bs.approve(second), true);
});

test('black swan: exportEventsByState surfaces the per-state review queues', () => {
  const bs = new BlackSwan(cfg({ maxEvents: 8 }));
  const a = bs.propose(0, 0, 0, 5);
  const b = bs.propose(0, 1, 0, 5);
  const c = bs.propose(0, 2, 0, 5);
  bs.approve(a);
  bs.reject(b);
  // c is left PROPOSED.
  const out = new Int32Array(8);
  assert.equal(bs.exportEventsByState(EVENT_STATE_PROPOSED, out), 1);
  assert.equal(out[0], c);
  assert.equal(bs.exportEventsByState(EVENT_STATE_APPROVED, out), 1);
  assert.equal(out[0], a);
  assert.equal(bs.exportEventsByState(EVENT_STATE_REJECTED, out), 1);
  assert.equal(out[0], b);
  // A short buffer truncates.
  assert.equal(bs.exportEventsByState(EVENT_STATE_PROPOSED, new Int32Array(0)), 0);
  // A non-lifecycle state argument throws (caller bug, not untrusted input).
  assert.throws(() => bs.exportEventsByState(EVENT_STATE_NONE, out), /state/);
  assert.throws(() => bs.exportEventsByState(99, out), /state/);
});

test('black swan: every transition lands in the audit ring (gate 5)', () => {
  const bs = new BlackSwan(cfg({ auditLogSize: 32 }));
  bs.tick(7);
  const h = bs.propose(3, 2, 0, 5);   // proposer 3, kind 2
  bs.approve(h);
  bs.activate(h, false);
  bs.revoke(h);
  assert.equal(bs.getAuditCount(), 4);
  assert.equal(bs.getAuditSize(), 4);
  const slot = eventSlot(h);
  // The recorded transition chain.
  assert.deepEqual(audit(bs, 0), { slot, generation: 0, kind: 2, from: EVENT_STATE_NONE, to: EVENT_STATE_PROPOSED, tick: 7 });
  assert.deepEqual(audit(bs, 1), { slot, generation: 0, kind: 2, from: EVENT_STATE_PROPOSED, to: EVENT_STATE_APPROVED, tick: 7 });
  assert.deepEqual(audit(bs, 2), { slot, generation: 0, kind: 2, from: EVENT_STATE_APPROVED, to: EVENT_STATE_ACTIVE, tick: 7 });
  assert.deepEqual(audit(bs, 3), { slot, generation: 0, kind: 2, from: EVENT_STATE_ACTIVE, to: EVENT_STATE_REVOKED, tick: 7 });
  assert.throws(() => audit(bs, 4), /index/);
});

test('black swan: the audit ring wraps, retaining the most recent records', () => {
  const bs = new BlackSwan(cfg({ auditLogSize: 4, maxEvents: 4 }));
  const a = bs.propose(0, 0, 0, 5);   // t1: NONE->PROPOSED
  bs.approve(a);                      // t2: PROPOSED->APPROVED
  bs.activate(a, false);              // t3: APPROVED->ACTIVE
  const b = bs.propose(0, 0, 0, 5);   // t4: NONE->PROPOSED
  bs.approve(b);                      // t5: PROPOSED->APPROVED  (overwrites t1)
  assert.equal(bs.getAuditCount(), 5, 'count is monotonic');
  assert.equal(bs.getAuditSize(), 4, 'only auditLogSize records are retained');
  // Oldest retained is t2 (t1 was overwritten); newest is t5.
  assert.equal(audit(bs, 0).from, EVENT_STATE_PROPOSED);
  assert.equal(audit(bs, 0).to, EVENT_STATE_APPROVED);
  assert.equal(audit(bs, 3).to, EVENT_STATE_APPROVED);
  assert.equal(audit(bs, 3).slot, eventSlot(b));
});

test('black swan: clear resets entropy, events, and the audit log', () => {
  const bs = new BlackSwan(cfg());
  bs.tick(5);
  bs.addEntropy(20);
  const h = bs.propose(0, 0, 0, 5);
  bs.approve(h);
  assert.ok(bs.getEntropySum() > 0 && bs.getLiveEventCount() > 0 && bs.getAuditCount() > 0);
  bs.clear();
  assert.equal(bs.getEntropySum(), 0);
  assert.equal(bs.getLiveEventCount(), 0);
  assert.equal(bs.getRejectedProposalCount(), 0);
  assert.equal(bs.getAuditCount(), 0);
  assert.equal(bs.getCurrentTick(), 0);
  assert.equal(bs.getState(h), EVENT_STATE_NONE, 'old handles are void after clear');
  // Reusable after clear.
  const h2 = bs.propose(1, 1, 0, 5);
  assert.notEqual(h2, EVENT_HANDLE_INVALID);
  assert.equal(bs.getState(h2), EVENT_STATE_PROPOSED);
});

test('black swan: the full pipeline is deterministic - identical runs match (no RNG, no clock)', () => {
  function run(): number[] {
    const bs = new BlackSwan(cfg({ entropyWindow: 8, chaosThreshold: 3, maxEvents: 16, auditLogSize: 64, maxKinds: 8, maxProposers: 8 }));
    const handles: number[] = [];
    for (let t = 0; t < 14; t++) {
      bs.addEntropy(t % 5);
      if (t % 3 === 0) handles.push(bs.propose(t % 8, t % 8, t * 2, 5));
      for (const h of handles) {
        const s = bs.getState(h);
        if (s === EVENT_STATE_PROPOSED) bs.approve(h);
        else if (s === EVENT_STATE_APPROVED) bs.activate(h, t % 2 === 0);
        else if (s === EVENT_STATE_CANARY) bs.promote(h);
      }
      bs.tick(t);
    }
    const out: number[] = [
      bs.getEntropySum(), bs.getAuditCount(), bs.getLiveEventCount(), bs.getRejectedProposalCount(),
    ];
    for (const h of handles) out.push(bs.getState(h));
    const rec = new Uint32Array(AUDIT_RECORD_STRIDE);
    for (let i = 0; i < bs.getAuditSize(); i++) {
      bs.readAuditRecord(i, rec);
      out.push(rec[0] ?? 0, rec[1] ?? 0, rec[2] ?? 0, rec[3] ?? 0, rec[4] ?? 0);
    }
    return out;
  }
  assert.deepEqual(run(), run(), 'no RNG, no wall clock - the chaos engine is fully reproducible');
});
