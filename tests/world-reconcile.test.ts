// Reconciliation tests - v5 Phase 2 (client prediction + rollback replay).
//
// Pins the golden vector (predict 101-102, server corrects 101, reconcileFrames replays
// 102) AND proves the rollback machinery is consistent: replaying over an
// uncorrected state reproduces the original prediction exactly.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tickFrame, reconcileFrames } from '../src/runtime/world-frame.js';
import { worldStateHash } from '../src/runtime/world-state-snapshot.js';

var here = dirname(fileURLToPath(import.meta.url));
var vec = JSON.parse(readFileSync(join(here, '..', 'test_vectors', 'v5_2_reconciliation.json'), 'utf8'));

test('golden vector: prediction + rollback reconciliation reproduces the pinned hashes', function () {
  var i = vec.inputs;
  var p101 = tickFrame({ worldId: i.worldId, state: i.initial_state, frameNumber: 101, commands: i.prediction_commands['101'], ruleset: i.ruleset, playerEntities: i.playerEntities });
  assert.strictEqual(worldStateHash(i.key, p101.state), vec.expect.predicted_101_hash, 'predicted 101 hash');
  var p102 = tickFrame({ worldId: i.worldId, state: p101.state, frameNumber: 102, commands: i.prediction_commands['102'], ruleset: i.ruleset, playerEntities: i.playerEntities });
  assert.strictEqual(worldStateHash(i.key, p102.state), vec.expect.predicted_102_hash, 'predicted 102 hash');

  var r = reconcileFrames({ worldId: i.worldId, correctedState: i.server_corrected_state, commandsByFrame: i.reconcile_commands_by_frame, toFrame: i.to_frame, ruleset: i.ruleset, playerEntities: i.playerEntities });
  assert.strictEqual(r.framesReplayed, vec.expect.frames_replayed, 'frames replayed');
  assert.strictEqual(r.state.entities.e1.properties.x, vec.expect.reconciled_102_x, 'reconciled x = 6');
  assert.strictEqual(worldStateHash(i.key, r.state), vec.expect.reconciled_102_hash, 'reconciled 102 hash');
  assert.strictEqual(worldStateHash(i.key, r.events), vec.expect.reconcile_events_hash, 'reconcileFrames events hash');
});

test('reconcileFrames: replaying over an UNCORRECTED state reproduces the original prediction', function () {
  var i = vec.inputs;
  var p101 = tickFrame({ worldId: i.worldId, state: i.initial_state, frameNumber: 101, commands: i.prediction_commands['101'], ruleset: i.ruleset, playerEntities: i.playerEntities });
  var r = reconcileFrames({ worldId: i.worldId, correctedState: p101.state, commandsByFrame: { '102': i.prediction_commands['102'] }, toFrame: 102, ruleset: i.ruleset, playerEntities: i.playerEntities });
  assert.strictEqual(worldStateHash(i.key, r.state), vec.expect.predicted_102_hash, 'replay == prediction when there is no correction');
  assert.strictEqual(r.framesReplayed, 1);
});
