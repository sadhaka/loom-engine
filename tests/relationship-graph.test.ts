// Phase 1.3.1 - RelationshipGraph tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  RelationshipGraph,
  RESOURCE_RELATIONSHIP_GRAPH,
  type Bond,
} from '../src/index.js';

test('rg: RESOURCE_RELATIONSHIP_GRAPH is the stable string', () => {
  assert.equal(RESOURCE_RELATIONSHIP_GRAPH, 'relationship_graph');
});

test('rg: starts empty', () => {
  const g = RelationshipGraph.create();
  assert.equal(g.bondCount(), 0);
  assert.equal(g.bondTypeCount(), 0);
});

test('rg: defineBondType + hasBondType + bondTypes', () => {
  const g = RelationshipGraph.create();
  g.defineBondType({ id: 'trust' });
  g.defineBondType({ id: 'rival', decayHalfLifeMs: 30000 });
  assert.equal(g.hasBondType('trust'), true);
  assert.deepEqual(g.bondTypes().sort(), ['rival', 'trust']);
});

test('rg: defineBondType rejects empty id', () => {
  const g = RelationshipGraph.create();
  assert.equal(g.defineBondType({ id: '' }), false);
});

test('rg: setBond + getBond', () => {
  const g = RelationshipGraph.create();
  g.setBond('mira', 'thane', 'trust', 0.8);
  const bond = g.getBond('mira', 'thane', 'trust');
  assert.ok(bond);
  assert.equal(bond!.fromId, 'mira');
  assert.equal(bond!.toId, 'thane');
  assert.ok(Math.abs(bond!.value - 0.8) < 1e-6);
});

test('rg: setBond auto-defines bond type spec', () => {
  const g = RelationshipGraph.create();
  g.setBond('mira', 'thane', 'newbond', 0.5);
  assert.equal(g.hasBondType('newbond'), true);
});

test('rg: setBond rejects self-loop', () => {
  const g = RelationshipGraph.create();
  assert.equal(g.setBond('mira', 'mira', 'trust', 0.5), false);
});

test('rg: setBond rejects empty / NaN args', () => {
  const g = RelationshipGraph.create();
  assert.equal(g.setBond('', 'thane', 'trust', 0.5), false);
  assert.equal(g.setBond('mira', '', 'trust', 0.5), false);
  assert.equal(g.setBond('mira', 'thane', '', 0.5), false);
  assert.equal(g.setBond('mira', 'thane', 'trust', NaN), false);
});

test('rg: bonds are asymmetric (a->b separate from b->a)', () => {
  const g = RelationshipGraph.create();
  g.setBond('mira', 'thane', 'romantic', 0.7);
  // No reciprocal.
  assert.equal(g.getBond('thane', 'mira', 'romantic'), null);
});

test('rg: setMutual sets both directions', () => {
  const g = RelationshipGraph.create();
  g.setMutual('mira', 'thane', 'trust', 0.8);
  assert.ok(Math.abs(g.getBond('mira', 'thane', 'trust')!.value - 0.8) < 1e-6);
  assert.ok(Math.abs(g.getBond('thane', 'mira', 'trust')!.value - 0.8) < 1e-6);
});

test('rg: adjustBond adds delta', () => {
  const g = RelationshipGraph.create();
  g.setBond('mira', 'thane', 'trust', 0.5);
  g.adjustBond('mira', 'thane', 'trust', -0.3);
  assert.ok(Math.abs(g.getBond('mira', 'thane', 'trust')!.value - 0.2) < 1e-6);
});

test('rg: adjustBond on missing treats current as 0', () => {
  const g = RelationshipGraph.create();
  const v = g.adjustBond('mira', 'thane', 'rival', 0.4);
  assert.ok(Math.abs((v as number) - 0.4) < 1e-6);
});

test('rg: removeBond drops it', () => {
  const g = RelationshipGraph.create();
  g.setBond('mira', 'thane', 'trust', 0.5);
  g.removeBond('mira', 'thane', 'trust');
  assert.equal(g.hasBond('mira', 'thane', 'trust'), false);
});

test('rg: bondsFor returns outgoing bonds', () => {
  const g = RelationshipGraph.create();
  g.setBond('mira', 'thane', 'trust', 0.8);
  g.setBond('mira', 'noi', 'trust', 0.3);
  g.setBond('thane', 'mira', 'trust', 0.5);
  const out = g.bondsFor('mira');
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((b) => b.toId).sort(), ['noi', 'thane']);
});

test('rg: bondsTo returns incoming bonds', () => {
  const g = RelationshipGraph.create();
  g.setBond('mira', 'thane', 'rival', 0.9);
  g.setBond('noi', 'thane', 'rival', 0.7);
  const inb = g.bondsTo('thane');
  assert.equal(inb.length, 2);
  assert.deepEqual(inb.map((b) => b.fromId).sort(), ['mira', 'noi']);
});

test('rg: bondsBetween returns both directions', () => {
  const g = RelationshipGraph.create();
  g.setBond('mira', 'thane', 'trust', 0.8);
  g.setBond('thane', 'mira', 'trust', 0.5);
  g.setBond('mira', 'noi', 'trust', 0.3);
  const between = g.bondsBetween('mira', 'thane');
  assert.equal(between.length, 2);
});

test('rg: bond filter by bondType', () => {
  const g = RelationshipGraph.create();
  g.setBond('mira', 'thane', 'trust', 0.8);
  g.setBond('mira', 'thane', 'rival', 0.4);
  const out = g.bondsFor('mira', { bondType: 'trust' });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.bondType, 'trust');
});

test('rg: bond filter by minLevel / maxLevel', () => {
  const g = RelationshipGraph.create();
  g.setBond('mira', 'thane', 'trust', 0.8);
  g.setBond('mira', 'noi', 'trust', 0.2);
  const strong = g.bondsFor('mira', { minLevel: 0.5 });
  assert.equal(strong.length, 1);
  assert.equal(strong[0]!.toId, 'thane');
});

test('rg: findStrongest picks highest-value bond', () => {
  const g = RelationshipGraph.create();
  g.setBond('mira', 'thane', 'trust', 0.7);
  g.setBond('noi', 'thane', 'trust', 0.9);
  g.setBond('mira', 'noi', 'trust', 0.4);
  const best = g.findStrongest('trust');
  assert.equal(best!.fromId, 'noi');
  assert.equal(best!.toId, 'thane');
});

test('rg: findStrongest with toId filter', () => {
  const g = RelationshipGraph.create();
  g.setBond('mira', 'thane', 'rival', 0.9);
  g.setBond('mira', 'noi', 'rival', 0.5);
  const best = g.findStrongest('rival', { fromId: 'mira', toId: 'noi' });
  assert.equal(best!.toId, 'noi');
});

test('rg: findWeakest picks lowest', () => {
  const g = RelationshipGraph.create();
  g.setBond('mira', 'thane', 'trust', 0.7);
  g.setBond('noi', 'thane', 'trust', 0.1);
  const lowest = g.findWeakest('trust');
  assert.equal(lowest!.fromId, 'noi');
});

test('rg: tick decays bond toward baseline', () => {
  const g = RelationshipGraph.create();
  g.defineBondType({ id: 'trust', baseline: 0, decayHalfLifeMs: 1000 });
  g.setBond('mira', 'thane', 'trust', 0.8);
  g.tick(1000);
  const b = g.getBond('mira', 'thane', 'trust');
  assert.ok(Math.abs(b!.value - 0.4) < 0.01);
});

test('rg: tick with decayHalfLifeMs=0 no decay', () => {
  const g = RelationshipGraph.create();
  g.defineBondType({ id: 'trust', baseline: 0, decayHalfLifeMs: 0 });
  g.setBond('mira', 'thane', 'trust', 0.8);
  g.tick(60000);
  assert.equal(g.getBond('mira', 'thane', 'trust')!.value, 0.8);
});

test('rg: removeBondType drops all bonds of that type', () => {
  const g = RelationshipGraph.create();
  g.setBond('mira', 'thane', 'rival', 0.7);
  g.setBond('noi', 'thane', 'rival', 0.5);
  g.setBond('mira', 'thane', 'trust', 0.8);
  g.removeBondType('rival');
  assert.equal(g.hasBond('mira', 'thane', 'rival'), false);
  assert.equal(g.hasBond('noi', 'thane', 'rival'), false);
  assert.equal(g.hasBond('mira', 'thane', 'trust'), true);
});

test('rg: onChange fires on set / adjust', () => {
  const events: string[] = [];
  const g = RelationshipGraph.create({
    onChange: (b) => events.push(b.fromId + '->' + b.toId + ':' + b.bondType),
  });
  g.setBond('mira', 'thane', 'trust', 0.5);
  g.adjustBond('mira', 'thane', 'trust', 0.2);
  assert.equal(events.length, 2);
});

test('rg: throwing onChange isolated', () => {
  const g = RelationshipGraph.create({
    onChange: () => { throw new Error('boom'); },
  });
  g.setBond('mira', 'thane', 'trust', 0.5); // should not throw
  assert.equal(g.hasBond('mira', 'thane', 'trust'), true);
});

test('rg: NaN / negative dt no-op', () => {
  const g = RelationshipGraph.create();
  g.defineBondType({ id: 'trust', baseline: 0, decayHalfLifeMs: 1000 });
  g.setBond('mira', 'thane', 'trust', 0.8);
  g.tick(NaN);
  g.tick(-50);
  g.tick(Infinity);
  assert.equal(g.getBond('mira', 'thane', 'trust')!.value, 0.8);
});

test('rg: clear empties everything', () => {
  const g = RelationshipGraph.create();
  g.defineBondType({ id: 'trust' });
  g.setBond('mira', 'thane', 'trust', 0.5);
  g.clear();
  assert.equal(g.bondCount(), 0);
  assert.equal(g.bondTypeCount(), 0);
});

test('rg: dispose locks ops', () => {
  const g = RelationshipGraph.create();
  g.setBond('mira', 'thane', 'trust', 0.5);
  g.dispose();
  assert.equal(g.setBond('a', 'b', 'trust', 0.5), false);
  assert.equal(g.bondCount(), 0);
});

test('rg: realistic example - betrayal flips trust to rival', () => {
  const g = RelationshipGraph.create();
  g.defineBondType({ id: 'trust', baseline: 0, decayHalfLifeMs: 0 });
  g.defineBondType({ id: 'rival', baseline: 0, decayHalfLifeMs: 0 });

  // Mira and Thane are friends.
  g.setMutual('mira', 'thane', 'trust', 0.8);
  // Mira is also one-sided in love with Thane.
  g.setBond('mira', 'thane', 'romantic', 0.7);

  // Thane betrays Mira: huge trust drop, romantic flips to rival.
  g.adjustBond('mira', 'thane', 'trust', -1.5);
  g.removeBond('mira', 'thane', 'romantic');
  g.setBond('mira', 'thane', 'rival', 0.9);

  // Thane's view of Mira hasn't changed.
  assert.ok(Math.abs(g.getBond('thane', 'mira', 'trust')!.value - 0.8) < 1e-6);
  // Mira no longer trusts Thane (0.8 - 1.5 = -0.7).
  assert.ok(Math.abs(g.getBond('mira', 'thane', 'trust')!.value - (-0.7)) < 1e-6);
  // She sees him as rival now.
  assert.ok(g.getBond('mira', 'thane', 'rival')!.value > 0.5);
});
