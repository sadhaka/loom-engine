"""world_epoch - the deterministic between-session Epoch world-tick (Python port).

Byte-identical to the TS world-epoch.ts (and the Rust port). 3.0 Phase 3
(Living Persistent World): while a player is offline, the world keeps moving -
factions act, regions shift - WITHOUT the player's session PRNG and WITHOUT any
non-determinism, so the browser client and the authoritative server arrive at the
BYTE-IDENTICAL world-state hash for the same epoch.

THE THREE GUARANTEES (all cross-language byte-parity, pinned by
test_vectors/v3_3_epoch_tick.json):

  1. PRNG ISOLATION. The Epoch PRNG is seeded from SHA-256(UTF8(world_id) ||
     LE64(epoch_number)) - a fresh, PUBLIC derivation that NEVER touches the
     session/combat PRNG. Bytes 0-7 of the digest (LE) are the PCG state, bytes
     8-15 (LE, forced odd) are the increment; Pcg32.from_raw builds it with no
     seeding steps.

  2. DETERMINISTIC ORDER + FAIL-CLOSED RESOLUTION. Offline actors are the
     entities tagged with an actor tag; they resolve in compare_ids order. A
     proposal that names an unknown action, or whose AST fails validation, or
     that errors mid-eval is REJECTED and consumes ZERO prng + ZERO state change
     (prng snapshot/restore + the AST's clone-not-mutate contract). Reason codes
     are assigned by THIS code at fixed decision points - never parsed from
     exception text - so they are identical on every surface.

  3. BOUNDED COST. tick_epoch caps SUCCESSFUL resolutions at max_actions;
     catch_up_epochs caps the number of epochs replayed at max_catchup. Both
     limits are PARAMETERS, never hardcoded.
"""

import hashlib as _hashlib

from .pcg32 import Pcg32
from .ruleset import compare_ids
from .ruleset_ast import (
    evaluate_action, apply_triggered_mutations,
    validate_check, validate_triggered_mutations,
    _assert_clean_string,
)

_MASK64 = (1 << 64) - 1

# The default tag marking an entity that acts while the owner is offline. Generic;
# a caller passes its own set via tick_epoch(..., actor_tags=...).
DEFAULT_ACTOR_TAG = "acts_offline"

# Number.MAX_SAFE_INTEGER (2^53 - 1) - the JS-safe-integer guard.
_MAX_SAFE_INT = 9007199254740991

# The fixed reason vocabulary. Assigned by THIS code (never from exception text),
# so every surface emits the same string for the same input.
REASON_UNKNOWN_ACTION = "unknown_action"
REASON_INVALID_ACTION = "invalid_action"
REASON_EVAL_ERROR = "eval_error"

# Resource key for the world's resource registry.
RESOURCE_WORLD_EPOCH = "world_epoch"


# ---- Epoch PRNG derivation -------------------------------------------------

def _le64_signed(n):
    """Serialize an i64 as exactly 8 little-endian bytes (two's complement for
    negatives). Matches TS le64Signed / Rust i64::to_le_bytes."""
    u = n & _MASK64  # two's-complement wrap into the unsigned 64-bit range
    return bytes((u >> (8 * i)) & 0xFF for i in range(8))


def _read_le_u64(b, off):
    """Read 8 little-endian bytes at off as an unsigned 64-bit int."""
    v = 0
    for i in range(7, -1, -1):
        v = (v << 8) | b[off + i]
    return v


def _is_safe_integer(n):
    return isinstance(n, int) and not isinstance(n, bool) and abs(n) <= _MAX_SAFE_INT


def derive_epoch_prng(world_id, epoch_number):
    """Derive the Epoch PRNG for (world_id, epoch_number). PUBLIC + deterministic:
    any surface computes the same PRNG from these two inputs."""
    _assert_clean_string(world_id)
    if not _is_safe_integer(epoch_number):
        raise ValueError("world-epoch: epoch_number must be a JS-safe integer")
    msg = world_id.encode("utf-8") + _le64_signed(epoch_number)
    digest = _hashlib.sha256(msg).digest()
    state = _read_le_u64(digest, 0)
    inc = _read_le_u64(digest, 8) | 1
    return Pcg32.from_raw(state, inc)


# ---- Helpers ---------------------------------------------------------------

def _serialize_mutations(applied):
    """Record each AppliedMutation as a canonical object - only the PRESENT fields
    among {op, target, property, tag, previous, next}. Mirrors the AST's
    field-presence so canonical_world_state encodes the same key set everywhere."""
    out = []
    for m in applied:
        o = {"op": m["op"], "target": m["target"]}
        if m.get("property") is not None:
            o["property"] = m["property"]
        if m.get("tag") is not None:
            o["tag"] = m["tag"]
        if m.get("previous") is not None:
            o["previous"] = m["previous"]
        if m.get("next") is not None:
            o["next"] = m["next"]
        out.append(o)
    return out


def _with_epoch(state, epoch_number):
    """Shallow top-level clone of a world state with epoch replaced. Entities/
    regions references are shared but never mutated here, so the returned state is
    safe to hash and independent of the caller's `epoch` field."""
    out = {}
    for k in state.keys():
        out[k] = state[k]
    out["epoch"] = epoch_number
    return out


def _entity_has_actor_tag(tags, actor_tags):
    if not isinstance(tags, list):
        return False
    for t in tags:
        for at in actor_tags:
            if t == at:
                return True
    return False


# ---- tick_epoch ------------------------------------------------------------

def tick_epoch(world_id, state, epoch_number, proposals, ruleset,
               actor_tags=None, max_actions=None):
    """Resolve one offline epoch. Pure: does not mutate `state`. Returns a dict
    {state, event, resolved, rejected}: the new state (epoch advanced) + the
    canonical EpochResolved event for the chain."""
    _assert_clean_string(world_id)
    if not _is_safe_integer(epoch_number):
        raise ValueError("world-epoch: epoch_number must be a JS-safe integer")
    if actor_tags and len(actor_tags) > 0:
        tags_set = actor_tags
    else:
        tags_set = [DEFAULT_ACTOR_TAG]
    if isinstance(max_actions, int) and not isinstance(max_actions, bool) and max_actions >= 0:
        cap = max_actions
    else:
        cap = _MAX_SAFE_INT

    prng = derive_epoch_prng(world_id, epoch_number)

    # Identify offline actors, then sort by the numeric-aware id comparator so the
    # resolution order (and thus the PRNG draw order) is byte-identical everywhere.
    entities = state.get("entities") or {}
    actors = []
    for eid in entities.keys():
        ent = entities[eid]
        if ent and _entity_has_actor_tag(ent.get("tags"), tags_set):
            actors.append(eid)
    import functools
    actors.sort(key=functools.cmp_to_key(compare_ids))

    work = state
    entries = []
    resolved = 0
    rejected = 0

    for actor_id in actors:
        if resolved >= cap:
            break  # Veil-Ceiling guard - stop after the cap
        proposal = proposals.get(actor_id)
        if not proposal:
            continue  # no proposal -> the actor idles (not counted, not listed)

        action_id = proposal["actionId"]
        action = ruleset.get(action_id)

        # (1) unknown action - no prng, no state change.
        if not action:
            entries.append({"action_id": action_id, "actor_id": actor_id, "reason": REASON_UNKNOWN_ACTION})
            rejected += 1
            continue

        # (2) fail-closed validation BEFORE any prng draw. Reason assigned here.
        try:
            if action.get("kind") == "check":
                validate_check(action.get("check"))
            else:
                validate_triggered_mutations(action.get("mutations"))
        except Exception:
            entries.append({"action_id": action_id, "actor_id": actor_id, "reason": REASON_INVALID_ACTION})
            rejected += 1
            continue

        # (3) resolve. Snapshot the prng first; on ANY throw, roll it back to zero
        # draws (the AST clones state, so a failed resolve never mutated `work`).
        snap = prng.snapshot()
        try:
            ctx = {"state": work, "actor": actor_id, "target": proposal.get("targetId"),
                   "rng": prng, "natural": None}
            degree = "none"
            if action.get("kind") == "check":
                res = evaluate_action(work, action["check"], ctx)
                work = res["state"]
                degree = res["degree"]
                applied = res["mutations"]
            else:
                res2 = apply_triggered_mutations(work, action["mutations"], ctx)
                work = res2["state"]
                applied = res2["mutations"]
            entries.append({"action_id": action_id, "actor_id": actor_id,
                            "degree": degree, "mutations_applied": _serialize_mutations(applied)})
            resolved += 1
        except Exception:
            prng.restore(snap)  # zero prng consumed for a rejected proposal
            entries.append({"action_id": action_id, "actor_id": actor_id, "reason": REASON_EVAL_ERROR})
            rejected += 1

    out_state = _with_epoch(work, epoch_number)
    event = {
        "event_type": "EpochResolved",
        "epoch_number": epoch_number,
        "actions_processed": entries,
        "pcg_steps_consumed": prng.get_draws(),
    }
    return {"state": out_state, "event": event, "resolved": resolved, "rejected": rejected}


# ---- catch_up_epochs -------------------------------------------------------

def catch_up_epochs(world_id, state, current_epoch, max_catchup, ruleset,
                    proposals_by_epoch=None, actor_tags=None, max_actions=None):
    """Deterministically replay offline epochs from state.epoch up to
    current_epoch, capped at max_catchup. Returns a dict {state, events,
    epochs_resolved, epochs_voided}."""
    if not _is_safe_integer(current_epoch):
        raise ValueError("world-epoch: current_epoch must be a JS-safe integer")
    if not _is_safe_integer(max_catchup) or max_catchup < 0:
        raise ValueError("world-epoch: max_catchup must be a non-negative JS-safe integer")
    client_epoch = state["epoch"]
    target = current_epoch - client_epoch
    if target <= 0:
        return {"state": state, "events": [], "epochs_resolved": 0, "epochs_voided": 0}
    capped = max_catchup if target > max_catchup else target

    work = state
    events = []
    for i in range(1, capped + 1):
        epoch_n = client_epoch + i
        proposals = {}
        if proposals_by_epoch:
            proposals = proposals_by_epoch.get(str(epoch_n)) or {}
        r = tick_epoch(world_id, work, epoch_n, proposals, ruleset,
                       actor_tags=actor_tags, max_actions=max_actions)
        work = r["state"]
        events.append(r["event"])

    return {"state": work, "events": events,
            "epochs_resolved": capped, "epochs_voided": target - capped}
