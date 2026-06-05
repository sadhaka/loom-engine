// world-frame.ts - the deterministic command-frame tick (v5 Phase 1).
//
// The real-time sibling of the Epoch world-tick (world-epoch.ts), and the
// SERVER-AUTHORITATIVE core of shared-world multiplayer. Each frame N, the server
// collects the players' commands, resolves them deterministically, and emits a
// FrameResolved event - byte-identical across TypeScript, Python, Rust, WASM,
// PyO3, and the C ABI. The server frame is the single source of truth; a client
// predicts locally with this SAME tick and reconciles to the authoritative result,
// so a client can never forge an outcome (the server re-resolves + HMAC-chains it).
//
// THE GUARANTEES (mirroring the Epoch tick, pinned by a golden vector):
//
//   1. DETERMINISTIC ORDER. Commands sort by (compareIds(playerId), seq) under a
//      STABLE sort, so the resolution order - and thus the PRNG draw order - is
//      byte-identical on every surface regardless of network arrival order.
//
//   2. PRNG ISOLATION. The frame PRNG is seeded from SHA-256(worldId<frame-domain>
//      || frameNumber), domain-separated from the offline Epoch seed so frame N and
//      epoch N never share a stream.
//
//   3. FAIL-CLOSED, ZERO-RNG-ON-REJECT. A command with an unknown player, malformed
//      / unknown / invalid action, or one over a rate cap is rejected with a fixed
//      reason code and consumes ZERO prng + ZERO state change. Reason codes are
//      assigned HERE, never parsed from exception text, so they are surface-stable.
//
//   4. BOUNDED. max_commands_per_player (anti-grief) + max_commands (per-frame cap)
//      are caller parameters; the generic engine hardcodes nothing.
//
// IP BOUNDARY. PUBLIC (this module): the frame tick, the command ordering, the
// FrameResolved framing. TWT-PRIVATE: the Director, matchmaking, the concrete caps,
// and the action ASTs (all passed in as data/parameters).
//
// Code style: var-only in browser source (matches world-epoch.ts).

import { deriveEpochPrng } from './world-epoch.js';
import type { Ruleset, WorldAction, SerializedMutation } from './world-epoch.js';
import type { Pcg32State } from './pcg32.js';
import { compareIds } from './ruleset.js';
import { evaluateAction, applyTriggeredMutations, validateCheck, validateTriggeredMutations } from './ruleset-ast.js';
import type { CheckNode, MutationNode, AppliedMutation, EvalContext } from './ruleset-ast.js';
import type { WorldState } from './world-state-snapshot.js';
import { assertCleanString } from './event-chain.js';

// Domain suffix that namespaces the real-time frame PRNG away from the offline
// Epoch PRNG, so a frame and an epoch with the same number never collide.
var FRAME_PRNG_DOMAIN = '|loom.frame/1';

// ---- types -----------------------------------------------------------------

// One player command for a frame. seq is a per-player monotonic counter used as
// the stable secondary sort key (so two commands from one player resolve in submit
// order, deterministically, on every surface).
export interface PlayerCommand {
  playerId: string;
  seq: number;
  actionId: string;
  targetId?: string;
}

// playerId -> the entity id the player controls (the command's actor). A command
// from a player not in this map is rejected (unknown_player).
export type PlayerEntityMap = Record<string, string>;

export interface SerializedFrameMutation extends SerializedMutation {}

// One processed command. SUCCESS carries the winning degree ('none' for a flat
// mutation action) + the applied mutations; REJECTION carries only a reason code.
export type FrameActionEntry =
  | { player_id: string; actor_id: string; action_id: string; degree: string; mutations_applied: SerializedMutation[] }
  | { player_id: string; action_id: string; reason: string };

export interface FrameResolvedEvent {
  event_type: 'FrameResolved';
  frame_number: number;
  commands_processed: FrameActionEntry[];
  pcg_steps_consumed: number;
}

// Fixed reason vocabulary (assigned by THIS code, never from exception text).
var REASON_UNKNOWN_PLAYER = 'unknown_player';     // playerId controls no entity
var REASON_MALFORMED_COMMAND = 'malformed_command'; // missing / empty actionId
var REASON_UNKNOWN_ACTION = 'unknown_action';     // actionId not in the ruleset
var REASON_INVALID_ACTION = 'invalid_action';     // bad kind / failed validation
var REASON_EVAL_ERROR = 'eval_error';             // threw during evaluation
var REASON_RATE_LIMITED = 'rate_limited';         // over max_commands_per_player

export interface TickFrameInput {
  worldId: string;
  state: WorldState;
  frameNumber: number;
  commands: PlayerCommand[];
  ruleset: Ruleset;
  playerEntities: PlayerEntityMap;
  // Per-player command cap (anti-grief). Default: no per-player cap.
  maxCommandsPerPlayer?: number | undefined;
  // Per-frame cap on total SUCCESSFUL resolutions. Default: no cap.
  maxCommands?: number | undefined;
}

export interface TickFrameResult {
  state: WorldState;
  event: FrameResolvedEvent;
  resolved: number;
  rejected: number;
}

// ---- helpers (mirror world-epoch.ts) ---------------------------------------

function serializeMutations(applied: AppliedMutation[]): SerializedMutation[] {
  var out: SerializedMutation[] = [];
  for (var i = 0; i < applied.length; i++) {
    var m = applied[i] as AppliedMutation;
    var o: SerializedMutation = { op: m.op, target: m.target };
    if (m.property !== undefined) o.property = m.property;
    if (m.tag !== undefined) o.tag = m.tag;
    if (m.previous !== undefined) o.previous = m.previous;
    if (m.next !== undefined) o.next = m.next;
    out.push(o);
  }
  return out;
}

function withFrame(state: WorldState, frameNumber: number): WorldState {
  var out: Record<string, unknown> = {};
  var keys = Object.keys(state);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i] as string;
    out[k] = (state as unknown as Record<string, unknown>)[k];
  }
  out['frame'] = frameNumber;
  return out as unknown as WorldState;
}

// Stable, cross-language-identical command order: numeric-aware playerId, then seq.
// (compareIds is the pinned comparator; ties fall to the stable sort = input order.)
function compareCommands(a: PlayerCommand, b: PlayerCommand): number {
  var c = compareIds(a.playerId, b.playerId);
  if (c !== 0) return c;
  if (a.seq !== b.seq) return a.seq < b.seq ? -1 : 1;
  return 0;
}

// ---- tickFrame -------------------------------------------------------------

// Resolve one server frame. Pure: does not mutate input.state. Returns the new
// state (frame advanced) + the canonical FrameResolved event.
export function tickFrame(input: TickFrameInput): TickFrameResult {
  assertCleanString(input.worldId);
  if (!Number.isSafeInteger(input.frameNumber)) {
    throw new Error('world-frame: frameNumber must be a JS-safe integer');
  }
  if (input.maxCommandsPerPlayer !== undefined
    && (!Number.isSafeInteger(input.maxCommandsPerPlayer) || input.maxCommandsPerPlayer < 0)) {
    throw new Error('world-frame: maxCommandsPerPlayer must be a non-negative JS-safe integer');
  }
  if (input.maxCommands !== undefined
    && (!Number.isSafeInteger(input.maxCommands) || input.maxCommands < 0)) {
    throw new Error('world-frame: maxCommands must be a non-negative JS-safe integer');
  }
  var maxPerPlayer = input.maxCommandsPerPlayer === undefined ? Number.MAX_SAFE_INTEGER : input.maxCommandsPerPlayer;
  var maxCommands = input.maxCommands === undefined ? Number.MAX_SAFE_INTEGER : input.maxCommands;

  var prng = deriveEpochPrng(input.worldId + FRAME_PRNG_DOMAIN, input.frameNumber);

  // Sort a COPY (do not mutate the caller's array). Stable sort -> deterministic.
  var ordered = (input.commands || []).slice();
  ordered.sort(compareCommands);

  var work = input.state;
  var entries: FrameActionEntry[] = [];
  var resolved = 0;
  var rejected = 0;
  var perPlayerCount: Record<string, number> = Object.create(null);

  for (var ci = 0; ci < ordered.length; ci++) {
    if (resolved >= maxCommands) break; // per-frame cap
    var cmd = ordered[ci] as PlayerCommand;
    var playerId = cmd.playerId;

    // (0) the player must control an entity (the command's actor).
    var actorId = (typeof playerId === 'string') ? input.playerEntities[playerId] : undefined;
    if (typeof actorId !== 'string' || actorId.length === 0) {
      entries.push({ player_id: typeof playerId === 'string' ? playerId : '', action_id: '', reason: REASON_UNKNOWN_PLAYER });
      rejected = rejected + 1;
      continue;
    }

    // (1) per-player rate cap (anti-grief).
    var used = perPlayerCount[playerId] || 0;
    if (used >= maxPerPlayer) {
      entries.push({ player_id: playerId, action_id: typeof cmd.actionId === 'string' ? cmd.actionId : '', reason: REASON_RATE_LIMITED });
      rejected = rejected + 1;
      continue;
    }

    // (2) malformed command (missing / non-string / empty actionId).
    var actionId = cmd.actionId;
    if (typeof actionId !== 'string' || actionId.length === 0) {
      entries.push({ player_id: playerId, action_id: '', reason: REASON_MALFORMED_COMMAND });
      rejected = rejected + 1;
      perPlayerCount[playerId] = used + 1;
      continue;
    }

    var action = input.ruleset[actionId];
    if (!action) {
      entries.push({ player_id: playerId, action_id: actionId, reason: REASON_UNKNOWN_ACTION });
      rejected = rejected + 1;
      perPlayerCount[playerId] = used + 1;
      continue;
    }

    // (3) unknown kind -> invalid_action (only 'check' / 'mutations' execute).
    if (action.kind !== 'check' && action.kind !== 'mutations') {
      entries.push({ player_id: playerId, action_id: actionId, reason: REASON_INVALID_ACTION });
      rejected = rejected + 1;
      perPlayerCount[playerId] = used + 1;
      continue;
    }

    // (4) fail-closed validation BEFORE any prng draw.
    try {
      if (action.kind === 'check') validateCheck((action as { check: CheckNode }).check);
      else validateTriggeredMutations((action as { mutations: MutationNode[] }).mutations);
    } catch (eValidate) {
      entries.push({ player_id: playerId, action_id: actionId, reason: REASON_INVALID_ACTION });
      rejected = rejected + 1;
      perPlayerCount[playerId] = used + 1;
      continue;
    }

    // (5) resolve. Snapshot prng; on ANY throw, roll back to zero draws.
    var snap: Pcg32State = prng.snapshot();
    try {
      var ctx: EvalContext = { state: work, actorId: actorId, targetId: cmd.targetId, rng: prng, naturalRoll: null };
      var degree = 'none';
      var applied: AppliedMutation[];
      if ((action as WorldAction).kind === 'check') {
        var res = evaluateAction(work, (action as { check: CheckNode }).check, ctx);
        work = res.state;
        degree = res.degree;
        applied = res.mutations;
      } else {
        var res2 = applyTriggeredMutations(work, (action as { mutations: MutationNode[] }).mutations, ctx);
        work = res2.state;
        applied = res2.mutations;
      }
      entries.push({ player_id: playerId, actor_id: actorId, action_id: actionId, degree: degree, mutations_applied: serializeMutations(applied) });
      resolved = resolved + 1;
      perPlayerCount[playerId] = used + 1;
    } catch (eEval) {
      prng.restore(snap); // zero prng consumed for a rejected command
      entries.push({ player_id: playerId, action_id: actionId, reason: REASON_EVAL_ERROR });
      rejected = rejected + 1;
      perPlayerCount[playerId] = used + 1;
    }
  }

  var outState = withFrame(work, input.frameNumber);
  var event: FrameResolvedEvent = {
    event_type: 'FrameResolved',
    frame_number: input.frameNumber,
    commands_processed: entries,
    pcg_steps_consumed: prng.getDraws(),
  };
  return { state: outState, event: event, resolved: resolved, rejected: rejected };
}

// ---- reconcile (client-side rollback + replay) -----------------------------
//
// The deterministic half of client-side prediction (Gemini's netcode blueprint).
// When the server's authoritative FrameResolved for frame M disagrees with the
// client's prediction, the client overwrites its state at M with the server's, then
// REPLAYS its own still-unconfirmed commands for frames M+1..N to re-derive the
// present. Because every frame re-seeds its PRNG from (worldId, frameNumber), the
// replay is byte-identical to a fresh prediction - the rollback leaves no trace.

export interface FrameReconcileInput {
  worldId: string;
  // The server-authoritative state at frame M (its `frame` field is M).
  correctedState: WorldState;
  // The client's unconfirmed local commands, keyed by String(frameNumber).
  commandsByFrame: Record<string, PlayerCommand[]>;
  // Replay up to AND INCLUDING this frame (the client's present frame N).
  toFrame: number;
  ruleset: Ruleset;
  playerEntities: PlayerEntityMap;
  maxCommandsPerPlayer?: number | undefined;
  maxCommands?: number | undefined;
}

export interface FrameReconcileResult {
  state: WorldState;
  events: FrameResolvedEvent[];
  framesReplayed: number;
}

// Replay frames (correctedState.frame + 1) .. toFrame over the corrected state,
// applying each frame's local commands. Pure: does not mutate the input.
export function reconcileFrames(input: FrameReconcileInput): FrameReconcileResult {
  if (!Number.isSafeInteger(input.toFrame)) {
    throw new Error('world-frame: toFrame must be a JS-safe integer');
  }
  var startRaw = (input.correctedState as unknown as { frame?: number }).frame;
  var fromFrame = (typeof startRaw === 'number' && Number.isSafeInteger(startRaw)) ? startRaw : 0;
  var work = input.correctedState;
  var events: FrameResolvedEvent[] = [];
  var replayed = 0;
  for (var f = fromFrame + 1; f <= input.toFrame; f++) {
    var cmds = input.commandsByFrame[String(f)] || [];
    var r = tickFrame({
      worldId: input.worldId,
      state: work,
      frameNumber: f,
      commands: cmds,
      ruleset: input.ruleset,
      playerEntities: input.playerEntities,
      maxCommandsPerPlayer: input.maxCommandsPerPlayer,
      maxCommands: input.maxCommands,
    });
    work = r.state;
    events.push(r.event);
    replayed = replayed + 1;
  }
  return { state: work, events: events, framesReplayed: replayed };
}

// Resource key for the world's resource registry.
export var RESOURCE_WORLD_FRAME = 'world_frame';
