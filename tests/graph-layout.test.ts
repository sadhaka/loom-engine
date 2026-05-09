// Phase 1.5.2 - GraphLayout tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  GraphLayout,
  RESOURCE_GRAPH_LAYOUT,
} from '../src/index.js';

test('gl: RESOURCE_GRAPH_LAYOUT is the stable string', () => {
  assert.equal(RESOURCE_GRAPH_LAYOUT, 'graph_layout');
});

test('gl: starts empty', () => {
  const g = GraphLayout.create();
  assert.equal(g.nodeCount(), 0);
  assert.equal(g.edgeCount(), 0);
});

test('gl: addNode + hasNode + getNode', () => {
  const g = GraphLayout.create();
  g.addNode({ id: 'a', x: 10, y: 20 });
  assert.equal(g.hasNode('a'), true);
  const n = g.getNode('a');
  assert.equal(n!.x, 10);
  assert.equal(n!.y, 20);
});

test('gl: addNode rejects empty id', () => {
  const g = GraphLayout.create();
  assert.equal(g.addNode({ id: '' }), false);
});

test('gl: addNode random initial position when not specified', () => {
  const g = GraphLayout.create({ seed: 42 });
  g.addNode({ id: 'a' });
  const n = g.getNode('a');
  assert.ok(n!.x !== 0 || n!.y !== 0);
});

test('gl: removeNode drops node + connected edges', () => {
  const g = GraphLayout.create();
  g.addNode({ id: 'a' });
  g.addNode({ id: 'b' });
  g.addNode({ id: 'c' });
  g.addEdge({ fromId: 'a', toId: 'b' });
  g.addEdge({ fromId: 'b', toId: 'c' });
  g.removeNode('b');
  assert.equal(g.hasNode('b'), false);
  // Both edges referenced b; both dropped.
  assert.equal(g.edgeCount(), 0);
});

test('gl: setPosition + setPinned', () => {
  const g = GraphLayout.create();
  g.addNode({ id: 'a' });
  g.setPosition('a', 100, 200);
  g.setPinned('a', true);
  const n = g.getNode('a');
  assert.equal(n!.x, 100);
  assert.equal(n!.y, 200);
  assert.equal(n!.pinned, true);
});

test('gl: addEdge + hasEdge + edgeCount', () => {
  const g = GraphLayout.create();
  g.addNode({ id: 'a' });
  g.addNode({ id: 'b' });
  g.addEdge({ fromId: 'a', toId: 'b' });
  assert.equal(g.hasEdge('a', 'b'), true);
  assert.equal(g.edgeCount(), 1);
});

test('gl: addEdge rejects unknown nodes / self-loops / duplicates', () => {
  const g = GraphLayout.create();
  g.addNode({ id: 'a' });
  assert.equal(g.addEdge({ fromId: 'a', toId: 'missing' }), false);
  assert.equal(g.addEdge({ fromId: 'a', toId: 'a' }), false);
  g.addNode({ id: 'b' });
  g.addEdge({ fromId: 'a', toId: 'b' });
  assert.equal(g.addEdge({ fromId: 'a', toId: 'b' }), false);
});

test('gl: removeEdge drops it', () => {
  const g = GraphLayout.create();
  g.addNode({ id: 'a' });
  g.addNode({ id: 'b' });
  g.addEdge({ fromId: 'a', toId: 'b' });
  assert.equal(g.removeEdge('a', 'b'), true);
  assert.equal(g.hasEdge('a', 'b'), false);
});

test('gl: tick moves non-pinned nodes', () => {
  const g = GraphLayout.create({ seed: 1 });
  g.addNode({ id: 'a', x: 0, y: 0 });
  g.addNode({ id: 'b', x: 5, y: 5 }); // very close, strong repulsion
  // Node positions should change after a few ticks.
  for (let i = 0; i < 5; i++) g.tick(16);
  const a = g.getNode('a');
  const b = g.getNode('b');
  // They should have moved apart.
  const dist = Math.sqrt((a!.x - b!.x) ** 2 + (a!.y - b!.y) ** 2);
  assert.ok(dist > 5);
});

test('gl: pinned nodes do not move', () => {
  const g = GraphLayout.create({ seed: 1 });
  g.addNode({ id: 'a', x: 0, y: 0, pinned: true });
  g.addNode({ id: 'b', x: 1, y: 1 }); // very close, strong repulsion
  for (let i = 0; i < 50; i++) g.tick(16);
  const a = g.getNode('a');
  assert.equal(a!.x, 0);
  assert.equal(a!.y, 0);
});

test('gl: edges pull connected nodes together', () => {
  const g = GraphLayout.create({
    seed: 1, repulsion: 0, centerForce: 0, attraction: 0.5,
  });
  g.addNode({ id: 'a', x: -200, y: 0 });
  g.addNode({ id: 'b', x: 200, y: 0 });
  g.addEdge({ fromId: 'a', toId: 'b', restLength: 50 });
  // Run ticks; nodes should move closer.
  const initialDist = 400;
  for (let i = 0; i < 50; i++) g.tick(16);
  const a = g.getNode('a');
  const b = g.getNode('b');
  const dist = Math.sqrt((a!.x - b!.x) ** 2 + (a!.y - b!.y) ** 2);
  assert.ok(dist < initialDist);
});

test('gl: stabilize runs until energy threshold or maxIter', () => {
  const g = GraphLayout.create({ seed: 1 });
  g.addNode({ id: 'a' });
  g.addNode({ id: 'b' });
  g.addNode({ id: 'c' });
  g.addEdge({ fromId: 'a', toId: 'b' });
  g.addEdge({ fromId: 'b', toId: 'c' });
  const iter = g.stabilize();
  // Should stabilize reasonably fast.
  assert.ok(iter < 500);
  assert.equal(g.getSnapshot().isStable, true);
});

test('gl: snapshot includes nodes + edges + energy + isStable', () => {
  const g = GraphLayout.create({ seed: 1 });
  g.addNode({ id: 'a' });
  g.addNode({ id: 'b' });
  g.addEdge({ fromId: 'a', toId: 'b' });
  const snap = g.getSnapshot();
  assert.equal(snap.nodes.length, 2);
  assert.equal(snap.edges.length, 1);
  assert.ok(typeof snap.energy === 'number');
  assert.ok(typeof snap.isStable === 'boolean');
});

test('gl: snapshot edge has from/to coords', () => {
  const g = GraphLayout.create({ seed: 1 });
  g.addNode({ id: 'a', x: 0, y: 0, pinned: true });
  g.addNode({ id: 'b', x: 100, y: 50, pinned: true });
  g.addEdge({ fromId: 'a', toId: 'b' });
  const snap = g.getSnapshot();
  assert.equal(snap.edges[0]!.fromX, 0);
  assert.equal(snap.edges[0]!.fromY, 0);
  assert.equal(snap.edges[0]!.toX, 100);
  assert.equal(snap.edges[0]!.toY, 50);
});

test('gl: positions returns all nodes', () => {
  const g = GraphLayout.create();
  g.addNode({ id: 'a' });
  g.addNode({ id: 'b' });
  assert.equal(g.positions().length, 2);
});

test('gl: forEach iterates nodes', () => {
  const g = GraphLayout.create();
  g.addNode({ id: 'a' });
  g.addNode({ id: 'b' });
  const ids: string[] = [];
  g.forEach((n) => ids.push(n.id));
  assert.deepEqual(ids.sort(), ['a', 'b']);
});

test('gl: NaN / negative dt no-op', () => {
  const g = GraphLayout.create();
  g.addNode({ id: 'a', x: 0, y: 0 });
  g.addNode({ id: 'b', x: 5, y: 5 });
  const before = g.getNode('a');
  g.tick(NaN);
  g.tick(-50);
  g.tick(Infinity);
  const after = g.getNode('a');
  assert.equal(after!.x, before!.x);
  assert.equal(after!.y, before!.y);
});

test('gl: throwing forEach callback isolated', () => {
  const g = GraphLayout.create();
  g.addNode({ id: 'a' });
  g.forEach(() => { throw new Error('boom'); });
  assert.equal(g.nodeCount(), 1);
});

test('gl: clear empties + dispose locks', () => {
  const g = GraphLayout.create();
  g.addNode({ id: 'a' });
  g.clear();
  assert.equal(g.nodeCount(), 0);
  g.dispose();
  assert.equal(g.addNode({ id: 'b' }), false);
});

test('gl: realistic example - chain of 4 connected nodes stabilizes', () => {
  const g = GraphLayout.create({ seed: 7 });
  // Seed initial positions so b/c start between the pinned nodes;
  // random init can let them flip to the other side under repulsion.
  g.addNode({ id: 'a', pinned: true, x: 0, y: 0 });
  g.addNode({ id: 'b', x: 60, y: 10 });
  g.addNode({ id: 'c', x: 130, y: -10 });
  g.addNode({ id: 'd', pinned: true, x: 200, y: 0 });
  g.addEdge({ fromId: 'a', toId: 'b' });
  g.addEdge({ fromId: 'b', toId: 'c' });
  g.addEdge({ fromId: 'c', toId: 'd' });
  g.stabilize();
  const snap = g.getSnapshot();
  // Pinned nodes never moved.
  const a = snap.nodes.find((n) => n.id === 'a')!;
  const d = snap.nodes.find((n) => n.id === 'd')!;
  assert.equal(a.x, 0);
  assert.equal(d.x, 200);
  // Energy is low post-stabilization (system relaxed).
  assert.ok(snap.energy < 50);
});
