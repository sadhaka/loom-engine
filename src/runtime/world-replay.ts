// WorldReplay - deterministic world reconstruction from a snapshot + events.
//
// 3.0 Phase 1 primitive (Living Persistent World). The replay half of the
// persistence anchor: a world is reconstructed by loading the latest VERIFIED
// snapshot (see world-state-snapshot.ts) and re-applying only the events that
// occurred after it - far cheaper than replaying from genesis, and provably
// equivalent because the resulting state_hash must match.
//
// The REDUCER is consumer-supplied: it is the game-specific logic that turns one
// event into a state change (in TheWorldTable this becomes the Phase-2 ruleset
// AST interpreter). The engine guarantees the three things that make replay
// trustworthy regardless of the reducer:
//   1. ORDER + ABSOLUTE INDEX - events are folded in strict array order, and the
//      reducer's `index` is the event's ABSOLUTE position in the full history,
//      NOT its position within the replayed slice. This is what keeps
//      snapshot+replay equivalent to full replay even for a reducer that uses
//      the index (e.g. to derive a per-event sub-seed). A tail replay therefore
//      starts numbering at `snapshotIndex`, never at 0. (Audit P1: an earlier
//      cut passed the slice-local loop index and broke equivalence for any
//      index-using reducer.)
//   2. EQUIVALENCE - snapshot+replay yields the same head as full replay
//      (verifyReplayEquivalence below proves it for a concrete history).
//   3. A FAIL-CLOSED HASH GATE - worldStateHash() throws on any non-integer /
//      non-canonical state, so a reducer that produces junk cannot silently
//      publish a state hash.
// The reducer's OWN determinism (no wall-clock, no Math.random, no float, no
// unordered iteration) is the consumer's contract.
//
//   var head = replayEvents(genesis, events, reducer);           // from index 0
//   // resume cheaply from a snapshot taken after `k` events:
//   var r = replayFromSnapshot(key, snapshotAtK, k, events.slice(k), reducer);
//   // r.headHash must equal worldStateHash(key, head)
//
// Code style: var-only in browser source (matches world-state-snapshot.ts).

import type { WorldState } from './world-state-snapshot.js';
import { worldStateHash } from './world-state-snapshot.js';

// A reducer applies ONE event to the world, returning the NEW state. Must be
// pure + deterministic. `index` is the event's ABSOLUTE 0-based position in the
// full event history (NOT its position in the replayed slice), so a reducer may
// use it to derive a stable per-event sub-seed.
export type WorldEventReducer<E = unknown> =
  (state: WorldState, event: E, index: number) => WorldState;

export interface ReplayResult {
  // The reconstructed head world.
  headState: WorldState;
  // worldStateHash of the head (the value a caller commits / compares).
  headHash: string;
}

// Fold a sequence of events onto a base state, in array order. Pure given a pure
// reducer. `startIndex` is the ABSOLUTE index of `events[0]` in the full history
// (0 for a replay from genesis, `snapshotIndex` for a replay of a tail after a
// snapshot), so the reducer always sees the same absolute index for a given
// event regardless of where replay started. This is the single deterministic
// application point - every replay path goes through it.
export function replayEvents<E>(
  base: WorldState, events: E[], reducer: WorldEventReducer<E>,
  startIndex: number = 0): WorldState {
  if (typeof reducer !== 'function') {
    throw new Error('WorldReplay: reducer must be a function');
  }
  if (!Number.isInteger(startIndex) || startIndex < 0) {
    throw new Error('WorldReplay: startIndex must be a non-negative integer');
  }
  var state = base;
  for (var i = 0; i < events.length; i++) {
    state = reducer(state, events[i] as E, startIndex + i);
  }
  return state;
}

// Reconstruct the head world from a snapshot taken after `snapshotIndex` events,
// by replaying ONLY the events after it. The tail is numbered from
// `snapshotIndex` so reducers see absolute indexes. The caller is expected to
// have already VERIFIED the snapshotState against the chain (verifyWorldSnapshot)
// before trusting it as the replay base.
export function replayFromSnapshot<E>(
  key: string | Uint8Array, snapshotState: WorldState, snapshotIndex: number,
  eventsAfter: E[], reducer: WorldEventReducer<E>): ReplayResult {
  var headState = replayEvents(snapshotState, eventsAfter, reducer, snapshotIndex);
  return { headState: headState, headHash: worldStateHash(key, headState) };
}

// EXECUTABLE proof of the snapshot+replay-equivalence property (the question
// from the audit pre-brief): does reconstructing from a mid-history snapshot at
// `snapshotIndex` produce the SAME head hash as replaying the entire history
// from genesis? Returns true iff equivalent.
//
// It holds for ANY pure reducer by fold associativity:
//   fold(genesis, [e0..eN], 0) === fold(fold(genesis, [e0..ek], 0), [ek..eN], k)
// so a `false` here means the reducer is NOT pure (it depends on something
// outside (state, event, absoluteIndex)) - exactly the bug class this catches.
export function verifyReplayEquivalence<E>(
  key: string | Uint8Array, genesisState: WorldState, allEvents: E[],
  snapshotIndex: number, reducer: WorldEventReducer<E>): boolean {
  if (!Number.isInteger(snapshotIndex) || snapshotIndex < 0 || snapshotIndex > allEvents.length) {
    throw new Error('WorldReplay: snapshotIndex out of range [0, allEvents.length]');
  }
  var fullHead = replayEvents(genesisState, allEvents, reducer, 0);
  var snapAt = replayEvents(genesisState, allEvents.slice(0, snapshotIndex), reducer, 0);
  // tail numbered from snapshotIndex - the absolute-index fix.
  var fromSnap = replayEvents(snapAt, allEvents.slice(snapshotIndex), reducer, snapshotIndex);
  return worldStateHash(key, fullHead) === worldStateHash(key, fromSnap);
}
