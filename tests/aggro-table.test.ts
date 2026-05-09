// Phase 0.76.0 - AggroTable tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AggroTable,
  RESOURCE_AGGRO_TABLE,
} from '../src/index.js';

test('aggro-table: RESOURCE_AGGRO_TABLE is the stable string', () => {
  assert.equal(RESOURCE_AGGRO_TABLE, 'aggro_table');
});

test('aggro-table: addThreat creates entry + accumulates', () => {
  const a = AggroTable.create();
  a.addThreat('p1', 10);
  a.addThreat('p1', 5);
  assert.equal(a.getThreat('p1'), 15);
});

test('aggro-table: setThreat replaces + 0 removes', () => {
  const a = AggroTable.create();
  a.setThreat('p1', 100);
  assert.equal(a.getThreat('p1'), 100);
  a.setThreat('p1', 50);
  assert.equal(a.getThreat('p1'), 50);
  a.setThreat('p1', 0);
  assert.equal(a.has('p1'), false);
});

test('aggro-table: remove drops + clear empties', () => {
  const a = AggroTable.create();
  a.addThreat('p1', 10);
  a.addThreat('p2', 20);
  assert.ok(a.remove('p1'));
  assert.equal(a.has('p1'), false);
  assert.ok(a.has('p2'));
  a.clear();
  assert.equal(a.size(), 0);
});

test('aggro-table: getThreat returns 0 for unknown target', () => {
  const a = AggroTable.create();
  assert.equal(a.getThreat('nobody'), 0);
});

test('aggro-table: topTarget returns the highest', () => {
  const a = AggroTable.create();
  a.addThreat('p1', 10);
  a.addThreat('p2', 50);
  a.addThreat('p3', 30);
  assert.equal(a.topTarget(), 'p2');
});

test('aggro-table: topTarget tiebreak by more recent lastHitAt', () => {
  const a = AggroTable.create();
  a.addThreat('p1', 10);
  a.addThreat('p2', 10);
  // Both at threat 10; p2 hit later -> winner.
  assert.equal(a.topTarget(), 'p2');
});

test('aggro-table: lastHitTarget tracks the last addThreat', () => {
  const a = AggroTable.create();
  a.addThreat('p1', 100);
  a.addThreat('p2', 1);
  a.addThreat('p1', 1);
  assert.equal(a.lastHitTarget(), 'p1');
});

test('aggro-table: tick decays threat by decayPerSecond', () => {
  const a = AggroTable.create({ decayPerSecond: 0.5 }); // -50%/sec
  a.setThreat('p1', 100);
  a.tick(1000); // -50% in 1s
  assert.ok(Math.abs(a.getThreat('p1') - 50) < 1e-6);
  a.tick(2000); // -100% over 2s would clip to 0; factor=1-1=0 here
  assert.equal(a.has('p1'), false);
});

test('aggro-table: tick removes entries below minThreat', () => {
  const a = AggroTable.create({ decayPerSecond: 0.99, minThreat: 1 });
  a.setThreat('p1', 0.5);
  a.tick(1); // tiny decay; threat ~ 0.5 * 0.99... still < minThreat 1.0
  assert.equal(a.has('p1'), false);
});

test('aggro-table: decayPerSecond=0 leaves threat untouched', () => {
  const a = AggroTable.create({ decayPerSecond: 0 });
  a.setThreat('p1', 100);
  a.tick(10000);
  assert.equal(a.getThreat('p1'), 100);
});

test('aggro-table: maxTargets evicts lowest-threat entry on overflow', () => {
  const a = AggroTable.create({ maxTargets: 3 });
  a.addThreat('p1', 50);
  a.addThreat('p2', 100);
  a.addThreat('p3', 25);
  a.addThreat('p4', 999); // forces eviction of lowest (p3)
  assert.equal(a.has('p3'), false);
  assert.equal(a.has('p1'), true);
  assert.equal(a.has('p2'), true);
  assert.equal(a.has('p4'), true);
});

test('aggro-table: NaN / negative dt ignored', () => {
  const a = AggroTable.create({ decayPerSecond: 0.5 });
  a.setThreat('p1', 100);
  a.tick(NaN);
  a.tick(-50);
  assert.equal(a.getThreat('p1'), 100);
});

test('aggro-table: setDecayPerSecond updates rate; rejects invalid', () => {
  const a = AggroTable.create({ decayPerSecond: 0 });
  a.setThreat('p1', 100);
  a.tick(1000);
  assert.equal(a.getThreat('p1'), 100); // no decay
  a.setDecayPerSecond(0.5);
  a.tick(1000);
  assert.ok(Math.abs(a.getThreat('p1') - 50) < 1e-6);
  // Invalid (negative / NaN) ignored.
  a.setDecayPerSecond(-1);
  a.setDecayPerSecond(NaN);
  a.tick(1000);
  assert.ok(Math.abs(a.getThreat('p1') - 25) < 1e-6); // still 0.5/s decay
});

test('aggro-table: list sorted by threat desc; defensive copy', () => {
  const a = AggroTable.create();
  a.addThreat('p1', 10);
  a.addThreat('p2', 50);
  a.addThreat('p3', 30);
  const arr = a.list();
  assert.deepEqual(arr.map((e) => e.target), ['p2', 'p3', 'p1']);
  // Mutating result doesn't affect table.
  arr[0]!.threat = 999;
  assert.equal(a.getThreat('p2'), 50);
});

test('aggro-table: empty target id / NaN amount rejected', () => {
  const a = AggroTable.create();
  a.addThreat('', 100);
  a.addThreat('p1', NaN);
  a.setThreat('', 100);
  a.setThreat('p2', NaN);
  assert.equal(a.size(), 0);
});

test('aggro-table: addThreat with 0 is no-op', () => {
  const a = AggroTable.create();
  a.addThreat('p1', 0);
  assert.equal(a.has('p1'), false);
});

test('aggro-table: negative addThreat reduces; clamped at 0', () => {
  const a = AggroTable.create();
  a.setThreat('p1', 100);
  a.addThreat('p1', -30);
  assert.equal(a.getThreat('p1'), 70);
  a.addThreat('p1', -200);
  // Threat clamped at 0 -> entry removed.
  assert.equal(a.has('p1'), false);
});

test('aggro-table: tick with no entries is a no-op', () => {
  const a = AggroTable.create({ decayPerSecond: 0.5 });
  a.tick(1000);
  assert.equal(a.size(), 0);
});

test('aggro-table: dispose locks ops', () => {
  const a = AggroTable.create();
  a.addThreat('p1', 100);
  a.dispose();
  a.addThreat('p1', 50);
  a.tick(1000);
  assert.equal(a.topTarget(), null);
  assert.equal(a.lastHitTarget(), null);
});

test('aggro-table: realistic 3-attacker boss fight', () => {
  const a = AggroTable.create({ decayPerSecond: 0.1, minThreat: 1 });
  // Tank takes hits. DPS does big damage. Healer occasional small.
  a.addThreat('tank', 30); // initial taunt
  a.addThreat('dps', 80);
  a.addThreat('healer', 5);
  // After tick decay (0.1/s for 1s = 10% off):
  a.tick(1000);
  assert.ok(Math.abs(a.getThreat('tank') - 27) < 1e-6);
  assert.ok(Math.abs(a.getThreat('dps') - 72) < 1e-6);
  // DPS still on top.
  assert.equal(a.topTarget(), 'dps');
  // Tank smacks taunt button, gains threat.
  a.addThreat('tank', 100);
  assert.equal(a.topTarget(), 'tank');
});

test('aggro-table: setThreat rejects NaN; negative becomes 0/removed', () => {
  const a = AggroTable.create();
  a.setThreat('p1', 100);
  a.setThreat('p1', NaN);
  assert.equal(a.getThreat('p1'), 100); // unchanged
  a.setThreat('p1', -10);
  assert.equal(a.has('p1'), false);
});
