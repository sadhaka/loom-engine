// Phase 0.34.0 - AssetPreloader tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { AssetPreloader } from '../src/runtime/asset-preloader.js';


test('asset-preloader: empty queue -> done fires with zero counts', async function () {
  var pre = new AssetPreloader();
  var done = await pre.start();
  assert.equal(done.total, 0);
  assert.equal(done.succeeded, 0);
  assert.equal(done.failed, 0);
});

test('asset-preloader: single asset loads + done fires', async function () {
  var pre = new AssetPreloader();
  pre.add('a', function () { return Promise.resolve('hello'); });
  var doneEv: { total: number; succeeded: number; failed: number } | null = null;
  pre.on('done', function (ev) { doneEv = ev; });
  var done = await pre.start();
  assert.equal(done.total, 1);
  assert.equal(done.succeeded, 1);
  assert.equal(done.failed, 0);
  assert.equal(doneEv!.succeeded, 1);
  assert.equal(pre.get('a'), 'hello');
});

test('asset-preloader: progress event fires per asset', async function () {
  var pre = new AssetPreloader();
  pre.add('a', function () { return Promise.resolve(1); });
  pre.add('b', function () { return Promise.resolve(2); });
  pre.add('c', function () { return Promise.resolve(3); });
  var progressFractions: number[] = [];
  pre.on('progress', function (ev) { progressFractions.push(ev.fraction); });
  await pre.start();
  // Should see 3 progress events with rising fractions.
  assert.equal(progressFractions.length, 3);
  assert.ok(progressFractions[2]! - 1 < 0.001);
});

test('asset-preloader: asset event fires per successful load', async function () {
  var pre = new AssetPreloader();
  pre.add('a', function () { return Promise.resolve('x'); });
  pre.add('b', function () { return Promise.resolve('y'); });
  var ids: string[] = [];
  pre.on('asset', function (ev) { ids.push(ev.id); });
  await pre.start();
  assert.equal(ids.length, 2);
  assert.ok(ids.indexOf('a') >= 0);
  assert.ok(ids.indexOf('b') >= 0);
});

test('asset-preloader: failed loader fires error + done counts failed', async function () {
  var pre = new AssetPreloader();
  pre.add('a', function () { return Promise.resolve(1); });
  pre.add('b', function () { return Promise.reject(new Error('oops')); });
  var errors: { id: string }[] = [];
  pre.on('error', function (ev) { errors.push(ev); });
  var done = await pre.start();
  assert.equal(done.succeeded, 1);
  assert.equal(done.failed, 1);
  assert.equal(done.errors.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.id, 'b');
});

test('asset-preloader: failed loader does NOT halt queue', async function () {
  var pre = new AssetPreloader();
  pre.add('a', function () { return Promise.resolve(1); });
  pre.add('b', function () { return Promise.reject(new Error('boom')); });
  pre.add('c', function () { return Promise.resolve(3); });
  var done = await pre.start();
  assert.equal(done.total, 3);
  assert.equal(done.succeeded, 2);
  assert.equal(done.failed, 1);
});

test('asset-preloader: add() after start() throws', async function () {
  var pre = new AssetPreloader();
  pre.add('a', function () { return Promise.resolve(1); });
  pre.start();
  assert.throws(function () {
    pre.add('b', function () { return Promise.resolve(2); });
  }, /cannot add after start/);
});

test('asset-preloader: duplicate id throws on add', function () {
  var pre = new AssetPreloader();
  pre.add('a', function () { return Promise.resolve(1); });
  assert.throws(function () {
    pre.add('a', function () { return Promise.resolve(2); });
  }, /duplicate id/);
});

test('asset-preloader: empty / non-string id throws', function () {
  var pre = new AssetPreloader();
  assert.throws(function () {
    pre.add('', function () { return Promise.resolve(1); });
  }, /non-empty string/);
});

test('asset-preloader: missing loader throws', function () {
  var pre = new AssetPreloader();
  assert.throws(function () {
    // @ts-expect-error - testing runtime check
    pre.add('a', null);
  }, /must be a function/);
});

test('asset-preloader: get() returns undefined for unknown id', function () {
  var pre = new AssetPreloader();
  assert.equal(pre.get('unknown'), undefined);
});

test('asset-preloader: get() returns null for failed asset', async function () {
  var pre = new AssetPreloader();
  pre.add('a', function () { return Promise.reject(new Error('x')); });
  await pre.start();
  // Failed assets have null result.
  assert.equal(pre.get('a'), null);
});

test('asset-preloader: stats reflect state at each phase', async function () {
  var pre = new AssetPreloader();
  pre.add('a', function () { return Promise.resolve(1); });
  pre.add('b', function () { return Promise.reject(new Error('x')); });
  // Pre-start.
  var s1 = pre.stats();
  assert.equal(s1.total, 2);
  assert.equal(s1.completed, 0);
  assert.equal(s1.started, false);
  await pre.start();
  var s2 = pre.stats();
  assert.equal(s2.completed, 2);
  assert.equal(s2.succeeded, 1);
  assert.equal(s2.failed, 1);
  assert.equal(s2.started, true);
});

test('asset-preloader: throwing handler does NOT block other handlers', async function () {
  var pre = new AssetPreloader();
  pre.add('a', function () { return Promise.resolve(1); });
  var bSeen = false;
  pre.on('asset', function () { throw new Error('handler boom'); });
  pre.on('asset', function () { bSeen = true; });
  await pre.start();
  assert.equal(bSeen, true);
});

test('asset-preloader: unsubscribe via returned function', async function () {
  var pre = new AssetPreloader();
  pre.add('a', function () { return Promise.resolve(1); });
  var calls = 0;
  var unsub = pre.on('asset', function () { calls++; });
  unsub();
  await pre.start();
  assert.equal(calls, 0);
});

test('asset-preloader: second start() returns same done result', async function () {
  var pre = new AssetPreloader();
  pre.add('a', function () { return Promise.resolve(1); });
  await pre.start();
  var done2 = await pre.start();
  assert.equal(done2.total, 1);
  assert.equal(done2.succeeded, 1);
});
