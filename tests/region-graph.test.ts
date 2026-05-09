// Phase 1.2.1 - RegionGraph tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  RegionGraph,
  RESOURCE_REGION_GRAPH,
} from '../src/index.js';

test('rgn: RESOURCE_REGION_GRAPH is the stable string', () => {
  assert.equal(RESOURCE_REGION_GRAPH, 'region_graph');
});

test('rgn: starts empty', () => {
  const g = RegionGraph.create();
  assert.equal(g.zoneCount(), 0);
  assert.equal(g.edgeCount(), 0);
});

test('rgn: addZone + hasZone + zones', () => {
  const g = RegionGraph.create();
  assert.equal(g.addZone('a'), true);
  assert.equal(g.addZone('b'), true);
  assert.equal(g.hasZone('a'), true);
  assert.deepEqual(g.zones().sort(), ['a', 'b']);
});

test('rgn: addZone duplicate returns false', () => {
  const g = RegionGraph.create();
  g.addZone('a');
  assert.equal(g.addZone('a'), false);
  assert.equal(g.zoneCount(), 1);
});

test('rgn: addZone empty / non-string id rejected', () => {
  const g = RegionGraph.create();
  assert.equal(g.addZone(''), false);
  // @ts-expect-error - testing runtime guard
  assert.equal(g.addZone(null), false);
});

test('rgn: removeZone removes + drops connected edges', () => {
  const g = RegionGraph.create();
  g.addZone('a'); g.addZone('b'); g.addZone('c');
  g.addBidirectional('a', 'b');
  g.addConnection({ fromZone: 'b', toZone: 'c' });
  assert.equal(g.edgeCount(), 3);
  assert.equal(g.removeZone('b'), true);
  assert.equal(g.edgeCount(), 0);
  assert.equal(g.zoneCount(), 2);
});

test('rgn: addConnection adds directed edge', () => {
  const g = RegionGraph.create();
  g.addZone('a'); g.addZone('b');
  assert.equal(g.addConnection({ fromZone: 'a', toZone: 'b' }), true);
  assert.equal(g.hasConnection('a', 'b'), true);
  assert.equal(g.hasConnection('b', 'a'), false);
});

test('rgn: addConnection with unknown zone returns false', () => {
  const g = RegionGraph.create();
  g.addZone('a');
  assert.equal(g.addConnection({ fromZone: 'a', toZone: 'missing' }), false);
});

test('rgn: addConnection self-loop rejected', () => {
  const g = RegionGraph.create();
  g.addZone('a');
  assert.equal(g.addConnection({ fromZone: 'a', toZone: 'a' }), false);
});

test('rgn: addBidirectional adds both directions', () => {
  const g = RegionGraph.create();
  g.addZone('a'); g.addZone('b');
  assert.equal(g.addBidirectional('a', 'b', { weight: 5 }), true);
  assert.equal(g.hasConnection('a', 'b'), true);
  assert.equal(g.hasConnection('b', 'a'), true);
  assert.equal(g.edgeCount(), 2);
});

test('rgn: removeConnection drops one direction only', () => {
  const g = RegionGraph.create();
  g.addZone('a'); g.addZone('b');
  g.addBidirectional('a', 'b');
  g.removeConnection('a', 'b');
  assert.equal(g.hasConnection('a', 'b'), false);
  assert.equal(g.hasConnection('b', 'a'), true);
});

test('rgn: getConnection returns the edge', () => {
  const g = RegionGraph.create();
  g.addZone('a'); g.addZone('b');
  g.addConnection({ fromZone: 'a', toZone: 'b', weight: 7, kind: 'boat' });
  const e = g.getConnection('a', 'b');
  assert.ok(e);
  assert.equal(e!.weight, 7);
  assert.equal(e!.kind, 'boat');
});

test('rgn: neighbors returns reachable next zones', () => {
  const g = RegionGraph.create();
  g.addZone('a'); g.addZone('b'); g.addZone('c');
  g.addConnection({ fromZone: 'a', toZone: 'b' });
  g.addConnection({ fromZone: 'a', toZone: 'c' });
  assert.deepEqual(g.neighbors('a').sort(), ['b', 'c']);
});

test('rgn: neighbors filters by gate predicate', () => {
  const g = RegionGraph.create();
  g.addZone('a'); g.addZone('b'); g.addZone('c');
  g.addConnection({ fromZone: 'a', toZone: 'b' });
  g.addConnection({
    fromZone: 'a', toZone: 'c',
    gate: (ctx) => !!ctx.hasKey,
  });
  assert.deepEqual(g.neighbors('a').sort(), ['b']);
  assert.deepEqual(g.neighbors('a', { hasKey: true }).sort(), ['b', 'c']);
});

test('rgn: shortestPath one-step', () => {
  const g = RegionGraph.create();
  g.addZone('a'); g.addZone('b');
  g.addConnection({ fromZone: 'a', toZone: 'b' });
  assert.deepEqual(g.shortestPath('a', 'b'), ['a', 'b']);
});

test('rgn: shortestPath multi-hop', () => {
  const g = RegionGraph.create();
  g.addZone('a'); g.addZone('b'); g.addZone('c'); g.addZone('d');
  g.addConnection({ fromZone: 'a', toZone: 'b' });
  g.addConnection({ fromZone: 'b', toZone: 'c' });
  g.addConnection({ fromZone: 'c', toZone: 'd' });
  assert.deepEqual(g.shortestPath('a', 'd'), ['a', 'b', 'c', 'd']);
});

test('rgn: shortestPath picks lower-weight route', () => {
  const g = RegionGraph.create();
  g.addZone('a'); g.addZone('b'); g.addZone('c'); g.addZone('d');
  // Direct route weight 10.
  g.addConnection({ fromZone: 'a', toZone: 'd', weight: 10 });
  // Detour route a-b-c-d weight 1+1+1=3.
  g.addConnection({ fromZone: 'a', toZone: 'b', weight: 1 });
  g.addConnection({ fromZone: 'b', toZone: 'c', weight: 1 });
  g.addConnection({ fromZone: 'c', toZone: 'd', weight: 1 });
  assert.deepEqual(g.shortestPath('a', 'd'), ['a', 'b', 'c', 'd']);
});

test('rgn: shortestPath unreachable returns null', () => {
  const g = RegionGraph.create();
  g.addZone('a'); g.addZone('b');
  assert.equal(g.shortestPath('a', 'b'), null);
});

test('rgn: shortestPath gate blocks', () => {
  const g = RegionGraph.create();
  g.addZone('a'); g.addZone('b'); g.addZone('c');
  g.addConnection({ fromZone: 'a', toZone: 'b' });
  g.addConnection({
    fromZone: 'b', toZone: 'c',
    gate: (ctx) => !!ctx.hasShard,
  });
  assert.equal(g.shortestPath('a', 'c'), null);
  assert.deepEqual(g.shortestPath('a', 'c', { hasShard: true }),
    ['a', 'b', 'c']);
});

test('rgn: shortestPath same zone returns single-element', () => {
  const g = RegionGraph.create();
  g.addZone('a');
  assert.deepEqual(g.shortestPath('a', 'a'), ['a']);
});

test('rgn: reachable returns set of all reachable zones', () => {
  const g = RegionGraph.create();
  g.addZone('a'); g.addZone('b'); g.addZone('c'); g.addZone('d');
  g.addConnection({ fromZone: 'a', toZone: 'b' });
  g.addConnection({ fromZone: 'b', toZone: 'c' });
  // d is isolated.
  const reach = g.reachable('a');
  assert.deepEqual(reach.sort(), ['a', 'b', 'c']);
});

test('rgn: reachable respects gates', () => {
  const g = RegionGraph.create();
  g.addZone('a'); g.addZone('b'); g.addZone('c');
  g.addConnection({ fromZone: 'a', toZone: 'b' });
  g.addConnection({
    fromZone: 'b', toZone: 'c',
    gate: (ctx) => !!ctx.hasShard,
  });
  assert.deepEqual(g.reachable('a').sort(), ['a', 'b']);
  assert.deepEqual(g.reachable('a', { hasShard: true }).sort(), ['a', 'b', 'c']);
});

test('rgn: isReachable boolean', () => {
  const g = RegionGraph.create();
  g.addZone('a'); g.addZone('b'); g.addZone('c');
  g.addConnection({ fromZone: 'a', toZone: 'b' });
  assert.equal(g.isReachable('a', 'b'), true);
  assert.equal(g.isReachable('a', 'c'), false);
  assert.equal(g.isReachable('a', 'a'), true);
});

test('rgn: throwing gate treated as blocked', () => {
  const g = RegionGraph.create();
  g.addZone('a'); g.addZone('b');
  g.addConnection({
    fromZone: 'a', toZone: 'b',
    gate: () => { throw new Error('boom'); },
  });
  assert.deepEqual(g.neighbors('a'), []);
});

test('rgn: clear empties graph', () => {
  const g = RegionGraph.create();
  g.addZone('a'); g.addZone('b');
  g.addConnection({ fromZone: 'a', toZone: 'b' });
  g.clear();
  assert.equal(g.zoneCount(), 0);
  assert.equal(g.edgeCount(), 0);
});

test('rgn: dispose locks ops', () => {
  const g = RegionGraph.create();
  g.addZone('a');
  g.dispose();
  assert.equal(g.addZone('b'), false);
  assert.equal(g.zoneCount(), 0);
});

test('rgn: realistic example - multi-zone world with gating', () => {
  const g = RegionGraph.create();
  ['hamlet', 'forest', 'mountain', 'lastlight', 'temple'].forEach((z) => g.addZone(z));
  g.addBidirectional('hamlet', 'forest', { weight: 1, kind: 'walk' });
  g.addBidirectional('forest', 'mountain', { weight: 3, kind: 'walk' });
  g.addBidirectional('mountain', 'lastlight', { weight: 2, kind: 'walk' });
  g.addBidirectional('forest', 'temple', {
    weight: 5, kind: 'boat',
    gate: (ctx) => !!ctx.hasBoat,
  });
  // Without boat: temple unreachable.
  assert.deepEqual(g.reachable('hamlet').sort(), ['forest', 'hamlet', 'lastlight', 'mountain']);
  // With boat: full world.
  assert.deepEqual(g.reachable('hamlet', { hasBoat: true }).sort(),
    ['forest', 'hamlet', 'lastlight', 'mountain', 'temple']);
  // Path to temple via forest.
  assert.deepEqual(g.shortestPath('hamlet', 'temple', { hasBoat: true }),
    ['hamlet', 'forest', 'temple']);
});
