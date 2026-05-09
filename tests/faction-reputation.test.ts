// Phase 0.86.0 - FactionReputation tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  FactionReputation,
  RESOURCE_FACTION_REPUTATION,
} from '../src/index.js';

test('faction-reputation: RESOURCE constant', () => {
  assert.equal(RESOURCE_FACTION_REPUTATION, 'faction_reputation');
});

test('faction-reputation: register + has + size', () => {
  const r = FactionReputation.create();
  assert.ok(r.registerFaction({ id: 'eldoria', name: 'Eldoria' }));
  assert.ok(r.has('eldoria'));
  assert.equal(r.size(), 1);
});

test('faction-reputation: register rejects invalid + duplicates', () => {
  const r = FactionReputation.create();
  assert.equal(r.registerFaction({ id: '', name: 'x' }), false);
  r.registerFaction({ id: 'a', name: 'A' });
  assert.equal(r.registerFaction({ id: 'a', name: 'B' }), false);
});

test('faction-reputation: default starting reputation is 0 -> neutral', () => {
  const r = FactionReputation.create();
  r.registerFaction({ id: 'a', name: 'A' });
  assert.equal(r.getReputation('a'), 0);
  assert.equal(r.getTier('a'), 'neutral');
});

test('faction-reputation: initialReputation respected and clamped', () => {
  const r = FactionReputation.create();
  r.registerFaction({ id: 'a', name: 'A', initialReputation: 100 });
  assert.equal(r.getReputation('a'), 100);
  assert.equal(r.getTier('a'), 'friendly');
  r.registerFaction({ id: 'over', name: 'Over', initialReputation: 99999 });
  assert.equal(r.getReputation('over'), 1000); // clamped to default max
});

test('faction-reputation: addReputation moves value + clamps', () => {
  const r = FactionReputation.create();
  r.registerFaction({ id: 'a', name: 'A' });
  r.addReputation('a', 100);
  assert.equal(r.getReputation('a'), 100);
  r.addReputation('a', 5000);
  assert.equal(r.getReputation('a'), 1000);
});

test('faction-reputation: addReputation rejects invalid', () => {
  const r = FactionReputation.create();
  r.registerFaction({ id: 'a', name: 'A' });
  assert.equal(r.addReputation('ghost', 50), false);
  assert.equal(r.addReputation('a', NaN), false);
  assert.equal(r.addReputation('a', 0), false);
});

test('faction-reputation: setReputation replaces + clamps', () => {
  const r = FactionReputation.create();
  r.registerFaction({ id: 'a', name: 'A' });
  r.setReputation('a', -100); // -250..-50 = unfriendly band
  assert.equal(r.getReputation('a'), -100);
  assert.equal(r.getTier('a'), 'unfriendly');
  r.setReputation('a', -2000);
  assert.equal(r.getReputation('a'), -1000); // clamped
});

test('faction-reputation: tier flips fire onTierChanged', () => {
  const flips: Array<{ id: string; next: string | null; prev: string | null }> = [];
  const r = FactionReputation.create({
    onTierChanged: (id, next, prev) => flips.push({ id, next, prev }),
  });
  r.registerFaction({ id: 'a', name: 'A' });
  r.addReputation('a', 75); // -> friendly (50+)
  r.addReputation('a', 200); // -> honored (250+)
  assert.equal(flips.length, 2);
  assert.equal(flips[0]!.next, 'friendly');
  assert.equal(flips[0]!.prev, 'neutral');
  assert.equal(flips[1]!.next, 'honored');
  assert.equal(flips[1]!.prev, 'friendly');
});

test('faction-reputation: same-tier change does not fire onTierChanged', () => {
  let tierFlips = 0;
  let changes = 0;
  const r = FactionReputation.create({
    onChanged: () => { changes++; },
    onTierChanged: () => { tierFlips++; },
  });
  r.registerFaction({ id: 'a', name: 'A' });
  r.addReputation('a', 5); // 0 -> 5; still neutral
  r.addReputation('a', 10); // -> 15; still neutral
  assert.equal(tierFlips, 0);
  assert.equal(changes, 2);
});

test('faction-reputation: custom tiers honored', () => {
  const r = FactionReputation.create();
  r.registerFaction({
    id: 'a', name: 'A',
    tiers: [
      { name: 'enemy', min: -100 },
      { name: 'neutral', min: 0 },
      { name: 'ally', min: 100 },
    ],
  });
  assert.equal(r.getTier('a'), 'neutral');
  r.addReputation('a', 100);
  assert.equal(r.getTier('a'), 'ally');
});

test('faction-reputation: custom min/max clamp', () => {
  const r = FactionReputation.create();
  r.registerFaction({
    id: 'a', name: 'A',
    minReputation: -50, maxReputation: 50,
  });
  r.addReputation('a', 1000);
  assert.equal(r.getReputation('a'), 50);
  r.addReputation('a', -1000);
  assert.equal(r.getReputation('a'), -50);
});

test('faction-reputation: max < min coerced equal to min', () => {
  const r = FactionReputation.create();
  r.registerFaction({
    id: 'a', name: 'A',
    minReputation: 100, maxReputation: 50,
    initialReputation: 75,
  });
  // max corrected to min (100); init 75 < 100 -> clamped to 100.
  assert.equal(r.getReputation('a'), 100);
});

test('faction-reputation: unregister drops', () => {
  const r = FactionReputation.create();
  r.registerFaction({ id: 'a', name: 'A' });
  assert.ok(r.unregisterFaction('a'));
  assert.equal(r.has('a'), false);
});

test('faction-reputation: getReputation / getTier defaults for unknown', () => {
  const r = FactionReputation.create();
  assert.equal(r.getReputation('ghost'), 0);
  assert.equal(r.getTier('ghost'), null);
});

test('faction-reputation: list returns all factions', () => {
  const r = FactionReputation.create();
  r.registerFaction({ id: 'a', name: 'A', initialReputation: 100 });
  r.registerFaction({ id: 'b', name: 'B', initialReputation: -100 });
  const arr = r.list();
  assert.equal(arr.length, 2);
});

test('faction-reputation: toSnapshot + fromSnapshot roundtrip', () => {
  const r = FactionReputation.create();
  r.registerFaction({ id: 'a', name: 'A' });
  r.registerFaction({ id: 'b', name: 'B' });
  r.addReputation('a', 250);
  r.addReputation('b', -100);
  const snap = r.toSnapshot();
  const r2 = FactionReputation.create();
  r2.registerFaction({ id: 'a', name: 'A' });
  r2.registerFaction({ id: 'b', name: 'B' });
  r2.fromSnapshot(snap);
  assert.equal(r2.getReputation('a'), 250);
  assert.equal(r2.getReputation('b'), -100);
});

test('faction-reputation: fromSnapshot ignores unknown factions', () => {
  const r = FactionReputation.create();
  r.registerFaction({ id: 'a', name: 'A' });
  r.fromSnapshot({ a: 100, ghost: 999 });
  assert.equal(r.getReputation('a'), 100);
  assert.equal(r.has('ghost'), false);
});

test('faction-reputation: throwing callbacks isolated', () => {
  const r = FactionReputation.create({
    onChanged: () => { throw new Error('boom'); },
    onTierChanged: () => { throw new Error('boom'); },
  });
  r.registerFaction({ id: 'a', name: 'A' });
  // Should not throw.
  r.addReputation('a', 100);
  assert.equal(r.getTier('a'), 'friendly');
});

test('faction-reputation: dispose locks ops', () => {
  const r = FactionReputation.create();
  r.registerFaction({ id: 'a', name: 'A' });
  r.dispose();
  assert.equal(r.registerFaction({ id: 'b', name: 'B' }), false);
  assert.equal(r.addReputation('a', 50), false);
  assert.equal(r.has('a'), false);
});

test('faction-reputation: realistic two-faction conflict', () => {
  const r = FactionReputation.create();
  r.registerFaction({ id: 'kingdom', name: 'Kingdom' });
  r.registerFaction({ id: 'thieves', name: 'Thieves Guild' });
  // Help thieves: rep up for thieves, down for kingdom.
  r.addReputation('thieves', 100);
  r.addReputation('kingdom', -100);
  assert.equal(r.getTier('thieves'), 'friendly');
  assert.equal(r.getTier('kingdom'), 'unfriendly');
});

test('faction-reputation: tiers sorted internally', () => {
  const r = FactionReputation.create();
  r.registerFaction({
    id: 'a', name: 'A',
    tiers: [
      { name: 'high', min: 100 },
      { name: 'low', min: -100 },
      { name: 'mid', min: 0 },
    ],
  });
  // 0 -> 'mid' (sorted internally so 'high' is checked correctly).
  assert.equal(r.getTier('a'), 'mid');
  r.addReputation('a', 200);
  assert.equal(r.getTier('a'), 'high');
});
