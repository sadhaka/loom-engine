// Command-frame tick tests - v5 Phase 1 (real-time shared-world multiplayer core).
//
// Pins the golden vector (numeric-aware command order, per-player rate cap,
// unknown-player rejection, the check-action path) AND covers the behavioral
// guarantees directly: input purity, zero-prng-on-reject, and frame advance.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tickFrame } from '../src/runtime/world-frame.js';
import { worldStateHash, type WorldState } from '../src/runtime/world-state-snapshot.js';
import { type Ruleset, type WorldAction } from '../src/runtime/world-epoch.js';

var here = dirname(fileURLToPath(import.meta.url));
var vec = JSON.parse(readFileSync(join(here, '..', 'test_vectors', 'v5_1_command_frame.json'), 'utf8'));

var MOVE: WorldAction = { kind: 'mutations', mutations: [{ type: 'add_prop', target: 'self', property: 'x', value: { type: 'dice', equation: '1d4' } }] };
var RULESET: Ruleset = { move: MOVE };

test('golden vector: every frame case reproduces the pinned hashes', function () {
  assert.ok(vec.cases.length >= 4, 'expected >= 4 frame cases');
  for (var i = 0; i < vec.cases.length; i++) {
    var c = vec.cases[i];
    var r = tickFrame({ worldId: c.worldId, state: c.state, frameNumber: c.frameNumber, commands: c.commands, ruleset: c.ruleset, playerEntities: c.playerEntities, maxCommandsPerPlayer: c.maxCommandsPerPlayer, maxCommands: c.maxCommands });
    assert.strictEqual(worldStateHash(c.key, r.state), c.expect.state_hash, c.label + ' state_hash');
    assert.strictEqual(worldStateHash(c.key, [r.event]), c.expect.event_hash, c.label + ' event_hash');
    assert.strictEqual(r.resolved, c.expect.resolved, c.label + ' resolved');
    assert.strictEqual(r.rejected, c.expect.rejected, c.label + ' rejected');
    assert.strictEqual(r.event.pcg_steps_consumed, c.expect.pcg_steps_consumed, c.label + ' steps');
  }
});

test('input purity: tickFrame mutates neither the state nor the commands array', function () {
  var state: WorldState = { frame: 0, epoch: 0, worldSeed: 0, entities: { e1: { properties: { x: 5 }, tags: [] } } } as WorldState;
  var commands = [{ playerId: 'p2', seq: 1, actionId: 'move' }, { playerId: 'p1', seq: 1, actionId: 'move' }];
  var beforeState = worldStateHash('k', state);
  var beforeCmds = JSON.stringify(commands);
  tickFrame({ worldId: 'w', state: state, frameNumber: 1, commands: commands, ruleset: RULESET, playerEntities: { p1: 'e1', p2: 'e1' } });
  assert.strictEqual(worldStateHash('k', state), beforeState, 'caller state unchanged');
  assert.strictEqual(JSON.stringify(commands), beforeCmds, 'caller commands order unchanged');
});

test('fail-closed: an unknown-player command consumes zero prng (others unshifted)', function () {
  var mk = function () { return { frame: 0, epoch: 0, worldSeed: 0, entities: { e1: { properties: { x: 0 }, tags: [] } } } as WorldState; };
  var withGhost = tickFrame({ worldId: 'w', state: mk(), frameNumber: 1, commands: [{ playerId: 'ghost', seq: 1, actionId: 'move' }, { playerId: 'p1', seq: 1, actionId: 'move' }], ruleset: RULESET, playerEntities: { p1: 'e1' } });
  var noGhost = tickFrame({ worldId: 'w', state: mk(), frameNumber: 1, commands: [{ playerId: 'p1', seq: 1, actionId: 'move' }], ruleset: RULESET, playerEntities: { p1: 'e1' } });
  assert.strictEqual(withGhost.state.entities.e1.properties.x, noGhost.state.entities.e1.properties.x, 'p1 roll unshifted by the rejected ghost');
  assert.strictEqual(withGhost.resolved, 1);
  assert.strictEqual(withGhost.rejected, 1);
  assert.strictEqual(withGhost.event.pcg_steps_consumed, 1, 'rejection drew zero prng');
});

test('rate cap: a per-player cap rejects the over-limit command', function () {
  var state: WorldState = { frame: 0, epoch: 0, worldSeed: 0, entities: { e1: { properties: { x: 0 }, tags: [] } } } as WorldState;
  var r = tickFrame({ worldId: 'w', state: state, frameNumber: 1,
    commands: [{ playerId: 'p1', seq: 1, actionId: 'move' }, { playerId: 'p1', seq: 2, actionId: 'move' }],
    ruleset: RULESET, playerEntities: { p1: 'e1' }, maxCommandsPerPlayer: 1 });
  assert.strictEqual(r.resolved, 1, 'one resolved');
  assert.strictEqual(r.rejected, 1, 'one rate-limited');
  assert.strictEqual(r.state.frame, 1, 'frame advanced');
});
