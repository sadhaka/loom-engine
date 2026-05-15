// SealedAssetRegistry - Trinity §28 delayed-key disclosure tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  SealedAssetRegistry,
  SEALED_STATE_SEALED,
  SEALED_STATE_KEY_DISCLOSED,
  SEALED_STATE_DECRYPTING,
  SEALED_STATE_READY,
  SEALED_STATE_FAILED,
  SEALED_STATE_REVOKED,
  SEALED_REASON_NONE,
  SEALED_REASON_BAD_STATE,
  SEALED_REASON_STALE_GENERATION,
  SEALED_REASON_DUPLICATE,
  SEALED_REASON_BAD_ENVELOPE,
  SEALED_HANDLE_INVALID,
  ENVELOPE_IV_BYTES,
  ENVELOPE_TAG_BYTES,
  ENVELOPE_MIN_BYTES,
  AAD_BYTES,
  AAD_HASH_BYTES,
} from '../src/runtime/sealed-asset.js';

function defaultConfig() {
  return { maxAssets: 32, maxEvents: 16 };
}

function hashBytes(seed: number): Uint8Array {
  const out = new Uint8Array(AAD_HASH_BYTES);
  for (let i = 0; i < AAD_HASH_BYTES; i++) out[i] = (seed + i) & 0xff;
  return out;
}

test('SealedAsset: constructor rejects out-of-range capacities', () => {
  assert.throws(() => new SealedAssetRegistry({ ...defaultConfig(), maxAssets: 0 }), RangeError);
  assert.throws(() => new SealedAssetRegistry({ ...defaultConfig(), maxEvents: 0 }), RangeError);
});

test('SealedAsset: validateEnvelope checks min length (gate 1)', () => {
  assert.equal(SealedAssetRegistry.validateEnvelope(new Uint8Array(0)), SEALED_REASON_BAD_ENVELOPE);
  assert.equal(SealedAssetRegistry.validateEnvelope(new Uint8Array(28)), SEALED_REASON_BAD_ENVELOPE);
  assert.equal(SealedAssetRegistry.validateEnvelope(new Uint8Array(ENVELOPE_MIN_BYTES)), SEALED_REASON_NONE);
});

test('SealedAsset: readIV / readCipherAndTag slice the envelope correctly (gate 1)', () => {
  const envelope = new Uint8Array(50);
  for (let i = 0; i < envelope.length; i++) envelope[i] = i;
  const iv = SealedAssetRegistry.readIV(envelope);
  assert.ok(iv !== null);
  assert.equal(iv!.length, ENVELOPE_IV_BYTES);
  assert.equal(iv![0], 0);
  assert.equal(iv![11], 11);
  const ct = SealedAssetRegistry.readCipherAndTag(envelope);
  assert.ok(ct !== null);
  assert.equal(ct!.length, 50 - ENVELOPE_IV_BYTES);
  assert.equal(ct![0], ENVELOPE_IV_BYTES);
});

test('SealedAsset: buildAAD packs (event/asset/version/hash) into AAD_BYTES (gate 2)', () => {
  const hash = hashBytes(0);
  const aad = SealedAssetRegistry.buildAAD(0xdeadbeef, 0xcafebabe, 7, hash);
  assert.ok(aad !== null);
  assert.equal(aad!.length, AAD_BYTES);
  // LE u32 readback.
  const view = new DataView(aad!.buffer);
  assert.equal(view.getUint32(0, true), 0xdeadbeef);
  assert.equal(view.getUint32(4, true), 0xcafebabe);
  assert.equal(view.getUint32(8, true), 7);
  for (let i = 0; i < AAD_HASH_BYTES; i++) assert.equal(aad![12 + i], hash[i] ?? 0);
});

test('SealedAsset: buildAAD rejects bad hash length (gate 2)', () => {
  assert.equal(SealedAssetRegistry.buildAAD(0, 0, 0, new Uint8Array(10)), null);
});

test('SealedAsset: registerAsset places asset in SEALED state (gates 4, 5)', () => {
  const r = new SealedAssetRegistry(defaultConfig());
  const h = r.registerAsset(0, 1, 0xabcdef00, 0x1, 0x2, hashBytes(0));
  assert.notEqual(h, SEALED_HANDLE_INVALID);
  assert.equal(r.getAssetState(h), SEALED_STATE_SEALED);
});

test('SealedAsset: registerAsset dedupes on cdnHash (gate 5)', () => {
  const r = new SealedAssetRegistry(defaultConfig());
  const h1 = r.registerAsset(0, 1, 0xabcdef00, 0x1, 0x2, hashBytes(0));
  const h2 = r.registerAsset(0, 1, 0xabcdef00, 0x1, 0x2, hashBytes(0));
  assert.notEqual(h1, SEALED_HANDLE_INVALID);
  assert.equal(h2, SEALED_HANDLE_INVALID);
});

test('SealedAsset: findByCdnHash locates the slot', () => {
  const r = new SealedAssetRegistry(defaultConfig());
  const h = r.registerAsset(0, 1, 0xabcdef00, 0, 0, hashBytes(0));
  assert.equal(r.findByCdnHash(0xabcdef00), h);
  assert.equal(r.findByCdnHash(0xdeadbeef), SEALED_HANDLE_INVALID);
});

test('SealedAsset: discloseEventKey moves all SEALED assets to KEY_DISCLOSED (gate 4)', () => {
  const r = new SealedAssetRegistry(defaultConfig());
  const h1 = r.registerAsset(0, 1, 0x1, 0, 0, hashBytes(0));
  const h2 = r.registerAsset(0, 1, 0x2, 0, 0, hashBytes(1));
  assert.equal(r.discloseEventKey(0, 0, 0), SEALED_REASON_NONE);
  assert.equal(r.getAssetState(h1), SEALED_STATE_KEY_DISCLOSED);
  assert.equal(r.getAssetState(h2), SEALED_STATE_KEY_DISCLOSED);
  assert.equal(r.getSecrecyEndedFlag(0), true);
});

test('SealedAsset: discloseEventKey rejects double disclosure (gate 4 idempotency)', () => {
  const r = new SealedAssetRegistry(defaultConfig());
  r.registerAsset(0, 1, 0x1, 0, 0, hashBytes(0));
  assert.equal(r.discloseEventKey(0, 0, 0), SEALED_REASON_NONE);
  assert.equal(r.discloseEventKey(0, 0, 0), SEALED_REASON_DUPLICATE);
});

test('SealedAsset: isClientEntitledToEvent enforces entitlement + region masks (gate 3)', () => {
  const r = new SealedAssetRegistry(defaultConfig());
  r.registerAsset(0, 1, 0x1, 0xff, 0xf, hashBytes(0));
  // Pre-disclosure: not entitled.
  assert.equal(r.isClientEntitledToEvent(0, 0xff, 0xf), false);
  // Disclose with required masks.
  r.discloseEventKey(0, 0xf0, 0x1);
  assert.equal(r.isClientEntitledToEvent(0, 0xf0, 0x1), true);
  // Wrong entitlement.
  assert.equal(r.isClientEntitledToEvent(0, 0x0f, 0x1), false);
  // Wrong region.
  assert.equal(r.isClientEntitledToEvent(0, 0xf0, 0x2), false);
});

test('SealedAsset: beginDecrypt + completeDecrypt round-trips through READY (gates 4, 6)', () => {
  const r = new SealedAssetRegistry(defaultConfig());
  const h = r.registerAsset(0, 1, 0x1, 0, 0, hashBytes(0));
  r.discloseEventKey(0, 0, 0);
  assert.equal(r.beginDecrypt(h), SEALED_REASON_NONE);
  assert.equal(r.getAssetState(h), SEALED_STATE_DECRYPTING);
  const gen = r.getAssetGeneration(h);
  assert.equal(r.completeDecrypt(h, gen, 1024, true), SEALED_REASON_NONE);
  assert.equal(r.getAssetState(h), SEALED_STATE_READY);
  assert.equal(r.getSuccessesTotal(), 1);
});

test('SealedAsset: completeDecrypt rejects stale generation (gate 4)', () => {
  const r = new SealedAssetRegistry(defaultConfig());
  const h = r.registerAsset(0, 1, 0x1, 0, 0, hashBytes(0));
  r.discloseEventKey(0, 0, 0);
  r.beginDecrypt(h);
  // Bump generation by failing - then a stale completeDecrypt with old gen should reject.
  const stale = r.getAssetGeneration(h) - 1;
  assert.equal(r.completeDecrypt(h, stale & 0xff, 100, true), SEALED_REASON_STALE_GENERATION);
});

test('SealedAsset: failDecrypt moves to FAILED + counts (gate 4)', () => {
  const r = new SealedAssetRegistry(defaultConfig());
  const h = r.registerAsset(0, 1, 0x1, 0, 0, hashBytes(0));
  r.discloseEventKey(0, 0, 0);
  r.beginDecrypt(h);
  const gen = r.getAssetGeneration(h);
  assert.equal(r.failDecrypt(h, gen), SEALED_REASON_NONE);
  assert.equal(r.getAssetState(h), SEALED_STATE_FAILED);
  assert.equal(r.getFailuresTotal(), 1);
});

test('SealedAsset: revokeAsset works at any non-NONE state', () => {
  const r = new SealedAssetRegistry(defaultConfig());
  const h = r.registerAsset(0, 1, 0x1, 0, 0, hashBytes(0));
  assert.equal(r.revokeAsset(h), SEALED_REASON_NONE);
  assert.equal(r.getAssetState(h), SEALED_STATE_REVOKED);
});

test('SealedAsset: beginDecrypt rejects from non-KEY_DISCLOSED state', () => {
  const r = new SealedAssetRegistry(defaultConfig());
  const h = r.registerAsset(0, 1, 0x1, 0, 0, hashBytes(0));
  // Still SEALED - beginDecrypt rejects.
  assert.equal(r.beginDecrypt(h), SEALED_REASON_BAD_STATE);
});

test('SealedAsset: readContentHash returns the registered hash', () => {
  const r = new SealedAssetRegistry(defaultConfig());
  const hash = hashBytes(42);
  const h = r.registerAsset(0, 1, 0x1, 0, 0, hash);
  const out = new Uint8Array(AAD_HASH_BYTES);
  assert.equal(r.readContentHash(h, out), true);
  for (let i = 0; i < AAD_HASH_BYTES; i++) assert.equal(out[i], hash[i]);
});

test('SealedAsset: deterministic across two independent runs', () => {
  function run(): number[] {
    const r = new SealedAssetRegistry(defaultConfig());
    const out: number[] = [];
    for (let i = 0; i < 5; i++) {
      out.push(r.registerAsset(0, 1, 100 + i, 0xff, 0xf, hashBytes(i)));
    }
    return out;
  }
  assert.deepEqual(run(), run());
});

test('SealedAsset: clear() resets every table', () => {
  const r = new SealedAssetRegistry(defaultConfig());
  r.registerAsset(0, 1, 0x1, 0, 0, hashBytes(0));
  r.discloseEventKey(0, 0, 0);
  r.clear();
  assert.equal(r.getSecrecyEndedFlag(0), false);
  assert.equal(r.findByCdnHash(0x1), SEALED_HANDLE_INVALID);
});
