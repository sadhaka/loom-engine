// LoomForgeBridge - Trinity §29 WASM-SIMD physics bridge tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  LoomForgeBridge,
  FORGE_POS_STRIDE,
  FORGE_VEL_STRIDE,
  FORGE_SCRATCH_STRIDE,
  FORGE_POS_OFFSET,
  WASM_PAGE_BYTES,
  FORGE_STATE_UNINITIALIZED,
  FORGE_STATE_READY,
  FORGE_REASON_NONE,
  FORGE_REASON_NOT_INITIALIZED,
  FORGE_REASON_BAD_DT,
  FORGE_REASON_BAD_COUNT,
  FORGE_REASON_BAD_CONTRACT,
  FORGE_REASON_NO_CALLBACK,
  FORGE_MAX_DT_FP,
  type LoomForgeBuildContract,
} from '../src/runtime/loom-forge-bridge.js';

function validContract(minPages: number = 16): LoomForgeBuildContract {
  return {
    importedSharedMemory: true,
    minPages,
    maxPages: minPages * 4,
    simdEnabled: true,
  };
}

test('LoomForgeBridge: constructor rejects invalid maxEntities', () => {
  assert.throws(() => new LoomForgeBridge({ maxEntities: 0, contract: validContract() }), RangeError);
  assert.throws(() => new LoomForgeBridge({ maxEntities: 1 << 24, contract: validContract() }), RangeError);
});

test('LoomForgeBridge: constructor rejects invalid contract pages', () => {
  assert.throws(() => new LoomForgeBridge({
    maxEntities: 100,
    contract: { ...validContract(), minPages: 0 },
  }), RangeError);
  assert.throws(() => new LoomForgeBridge({
    maxEntities: 100,
    contract: { ...validContract(), maxPages: 1 },     // < minPages
  }), RangeError);
});

test('LoomForgeBridge: contract requires importedSharedMemory + simdEnabled (gate 1)', () => {
  const b1 = new LoomForgeBridge({
    maxEntities: 100,
    contract: { ...validContract(), importedSharedMemory: false },
  });
  assert.equal(b1.isContractValid(), false);
  const b2 = new LoomForgeBridge({
    maxEntities: 100,
    contract: { ...validContract(), simdEnabled: false },
  });
  assert.equal(b2.isContractValid(), false);
  const b3 = new LoomForgeBridge({ maxEntities: 100, contract: validContract() });
  assert.equal(b3.isContractValid(), true);
});

test('LoomForgeBridge: contract requires minPages >= layout pages (gate 1, 4)', () => {
  // 100k entities * (16 + 16 + 16 + 16) = 6.4MB > 1 page (64KB).
  const b = new LoomForgeBridge({
    maxEntities: 100000,
    contract: { ...validContract(1), minPages: 1, maxPages: 16 },
  });
  // minPages=1 is too small; contractValid should be false.
  assert.equal(b.isContractValid(), false);
});

test('LoomForgeBridge: memory layout offsets are deterministic (gate 4)', () => {
  const b = new LoomForgeBridge({ maxEntities: 100, contract: validContract() });
  assert.equal(b.posOffset, FORGE_POS_OFFSET);
  assert.equal(b.velOffset, 100 * FORGE_POS_STRIDE);
  assert.equal(b.scratchOffset, 100 * FORGE_POS_STRIDE + 100 * FORGE_VEL_STRIDE);
  assert.equal(b.posBackOffset, b.scratchOffset + 100 * FORGE_SCRATCH_STRIDE);
  assert.equal(b.totalBytes, b.posBackOffset + 100 * FORGE_POS_STRIDE);
  assert.equal(b.totalPages, Math.ceil(b.totalBytes / WASM_PAGE_BYTES));
});

test('LoomForgeBridge: state starts UNINITIALIZED; step rejects pre-init (gate 3)', () => {
  const b = new LoomForgeBridge({ maxEntities: 100, contract: validContract() });
  assert.equal(b.getState(), FORGE_STATE_UNINITIALIZED);
  assert.equal(b.isInitialized(), false);
  assert.equal(b.step(100, 50), FORGE_REASON_NOT_INITIALIZED);
});

test('LoomForgeBridge: completeInit transitions to READY (gate 3)', () => {
  const b = new LoomForgeBridge({ maxEntities: 100, contract: validContract() });
  let stepCalled = 0;
  assert.equal(b.completeInit(() => { stepCalled++; }), FORGE_REASON_NONE);
  assert.equal(b.getState(), FORGE_STATE_READY);
  assert.equal(b.isInitialized(), true);
});

test('LoomForgeBridge: completeInit rejects invalid contract (gate 1)', () => {
  const b = new LoomForgeBridge({
    maxEntities: 100,
    contract: { ...validContract(), simdEnabled: false },
  });
  assert.equal(b.completeInit(() => {}), FORGE_REASON_BAD_CONTRACT);
});

test('LoomForgeBridge: completeInit rejects non-function callback', () => {
  const b = new LoomForgeBridge({ maxEntities: 100, contract: validContract() });
  assert.equal(b.completeInit(null as unknown as () => void), FORGE_REASON_NO_CALLBACK);
});

test('LoomForgeBridge: step validates dt (gate 2)', () => {
  const b = new LoomForgeBridge({ maxEntities: 100, contract: validContract() });
  b.completeInit(() => {});
  assert.equal(b.step(0, 50), FORGE_REASON_BAD_DT);
  assert.equal(b.step(-100, 50), FORGE_REASON_BAD_DT);
  assert.equal(b.step(FORGE_MAX_DT_FP + 1, 50), FORGE_REASON_BAD_DT);
  assert.equal(b.step(1.5, 50), FORGE_REASON_BAD_DT);
});

test('LoomForgeBridge: step validates activeCount (gate 2)', () => {
  const b = new LoomForgeBridge({ maxEntities: 100, contract: validContract() });
  b.completeInit(() => {});
  assert.equal(b.step(100, -1), FORGE_REASON_BAD_COUNT);
  assert.equal(b.step(100, 999), FORGE_REASON_BAD_COUNT);
  assert.equal(b.step(100, 1.5), FORGE_REASON_BAD_COUNT);
  assert.equal(b.step(100, 50), FORGE_REASON_NONE);
});

test('LoomForgeBridge: step invokes callback with validated args (gate 6)', () => {
  const b = new LoomForgeBridge({ maxEntities: 100, contract: validContract() });
  let lastDt = -1, lastCount = -1;
  b.completeInit((dt, n) => { lastDt = dt; lastCount = n; });
  b.step(123, 42);
  assert.equal(lastDt, 123);
  assert.equal(lastCount, 42);
  assert.equal(b.getStepsTotal(), 1);
});

test('LoomForgeBridge: step swaps phase barrier (front/back swap each step - gate 5)', () => {
  const b = new LoomForgeBridge({ maxEntities: 100, contract: validContract() });
  b.completeInit(() => {});
  const front0 = b.getFrontPosOffset();
  const back0 = b.getBackPosOffset();
  b.step(100, 50);
  const front1 = b.getFrontPosOffset();
  const back1 = b.getBackPosOffset();
  assert.equal(front1, back0);
  assert.equal(back1, front0);
});

test('LoomForgeBridge: pre-init reads return 0 (gate 3)', () => {
  const b = new LoomForgeBridge({ maxEntities: 100, contract: validContract() });
  assert.equal(b.getFrontPosOffset(), 0);
  assert.equal(b.getBackPosOffset(), 0);
});

test('LoomForgeBridge: invalidStepsTotal counts rejections (gate 2)', () => {
  const b = new LoomForgeBridge({ maxEntities: 100, contract: validContract() });
  b.completeInit(() => {});
  b.step(0, 50);                    // BAD_DT
  b.step(100, -1);                  // BAD_COUNT
  b.step(100, 50);                  // OK
  assert.equal(b.getInvalidStepsTotal(), 2);
  assert.equal(b.getStepsTotal(), 1);
});

test('LoomForgeBridge: clear() resets state', () => {
  const b = new LoomForgeBridge({ maxEntities: 100, contract: validContract() });
  b.completeInit(() => {});
  b.step(100, 50);
  b.clear();
  assert.equal(b.isInitialized(), false);
  assert.equal(b.getStepsTotal(), 0);
});

test('LoomForgeBridge: tick rejects out-of-range t', () => {
  const b = new LoomForgeBridge({ maxEntities: 100, contract: validContract() });
  assert.throws(() => b.tick(-1), RangeError);
  assert.throws(() => b.tick(1.5), RangeError);
});

test('LoomForgeBridge: deterministic across two independent runs', () => {
  function run(): number[] {
    const b = new LoomForgeBridge({ maxEntities: 50, contract: validContract() });
    let acc = 0;
    b.completeInit((dt, n) => { acc = (acc * 31 + dt + n) | 0; });
    for (let i = 0; i < 5; i++) b.step(100 + i, i * 7);
    return [acc, b.getStepsTotal()];
  }
  assert.deepEqual(run(), run());
});
