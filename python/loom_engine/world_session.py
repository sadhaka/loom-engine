"""world_session - the WorldSession suspend/resume lifecycle (Python port).

Byte-identical to the TS world-session.ts (v3.0 Phase 4): ties the deterministic
primitives - the HMAC event chain (event_chain), the world-state snapshot
(world_snapshot), and the Epoch world-tick (world_epoch) - into ONE fail-closed
suspend/resume flow. A world is packed into a verifiable bundle on suspend; on
resume the engine verifies the snapshot, verifies + replays the event-chain
tail, then fast-forwards offline epochs - and the resumed world hash is
byte-identical across TypeScript, Python, Rust, and WASM (pinned by
test_vectors/v3_4_world_session.json + v3_5_session_soak.json).

THE DESIGN:

  * EVENT-SOURCED from the latest snapshot. The snapshot caps replay cost; the
    chain tail (events written after the snapshot but before suspend/crash) is
    replayed to recover the true head. The chain - not the snapshot - is the
    tamper-evident source of truth.

  * THE REDUCER REPLAYS RECORDED MUTATIONS, IT DOES NOT RE-RUN THE AST. An
    EpochResolved event carries the exact mutations_applied it produced. Replay
    applies THOSE (prop -> set to the recorded `next`; tags -> the SAME
    normalize_tags/filter the AST used). Re-running tick_epoch would diverge if
    the ruleset was re-balanced after the event was written - the chain records
    what HAPPENED, not what the current rules would do.

  * FAIL-CLOSED, STRICT ORDER. (1) snapshot hash; (2) load; (3) tail chain
    HMAC; (4) reduce; (5) bound catch-up (reject time-travel); (6) tick. Any
    integrity failure raises before the world is trusted.

KNOWN LIMIT (documented negative space, pinned by the S4 soak case): the
WorldBundle carries no ChainSeal, so resume() cannot detect tail-END truncation
- verify_records without a seal cannot see dropped trailing records. The fix
is a seal field on the cross-language WorldBundle schema (engine change +
Rust/WASM/PyO3 parity); until then the soak test is the regression net.

The bundle is a plain dict in the cross-language wire shape:
    {"worldId": str,
     "snapshot": {"eventIndex": int, "stateHash": str, "state": {...}},
     "chainTail": [chained records],
     "tailGenesis": str}
"""

import json as _json

from .event_chain import verify_records
from .world_epoch import catch_up_epochs
from .world_snapshot import world_state_hash, verify_world_snapshot, normalize_tags

# Number.MAX_SAFE_INTEGER (2^53 - 1).
_MAX_SAFE_INT = 9007199254740991

# Resource key for the world's resource registry.
RESOURCE_WORLD_SESSION = "world_session"


def _is_safe_integer(n):
    return isinstance(n, int) and not isinstance(n, bool) and abs(n) <= _MAX_SAFE_INT


def _is_number(v):
    # typeof v === 'number' (bool excluded - Python bool is an int subclass).
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _clone_state(state):
    # Faithful structural clone - mirrors the TS JSON.parse(JSON.stringify(state))
    # (state is integer/string/plain-object/array only).
    return _json.loads(_json.dumps(state))


# ---- the reducer: replay a recorded EpochResolved event --------------------

def _ensure_ent(state, entity_id):
    ent = state["entities"].get(entity_id)
    if not ent:
        ent = {"properties": {}, "tags": []}
        state["entities"][entity_id] = ent
    return ent


def _apply_serialized_mutation(state, m):
    # Apply ONE recorded mutation. Mirrors the AST's apply path EXACTLY: a prop
    # op stores the recorded `next` (the AST already computed prev +/- value); a
    # tag op uses the SAME normalize_tags(concat) / filter the AST used, so the
    # resulting tags array (whose ORDER the hash depends on) is reproduced
    # byte-for-byte.
    ent = _ensure_ent(state, m["target"])
    op = m.get("op")
    if op == "add_tag":
        if isinstance(m.get("tag"), str):
            ent["tags"] = normalize_tags(ent["tags"] + [m["tag"]])
    elif op == "remove_tag":
        tag = m.get("tag")
        ent["tags"] = [t for t in ent["tags"] if t != tag]
    elif isinstance(m.get("property"), str) and _is_number(m.get("next")):
        # set_prop / add_prop / sub_prop - the recorded `next` IS the post-value.
        ent["properties"][m["property"]] = m["next"]


def replay_epoch_event(state, event):
    """Replay one EpochResolved event onto a state (the reducer). Pure: returns
    a new state. Sets epoch = the event's epoch_number."""
    work = _clone_state(state)
    entries = event.get("actions_processed") if event else None
    if not entries:
        entries = []
    for entry in entries:
        muts = entry.get("mutations_applied")
        if isinstance(muts, list):
            for m in muts:
                _apply_serialized_mutation(work, m)
    work["epoch"] = event["epoch_number"]
    return work


# ---- suspend ---------------------------------------------------------------

def suspend(key, world_id, snapshot_state, snapshot_event_index, chain):
    """Pack a world into a verifiable bundle. The tail is every chain record
    after the snapshot index; tailGenesis is the head signature at that index
    (so the tail links cleanly under verify_records on resume)."""
    records = chain.list()
    tail = [rec for rec in records if rec and rec["seq"] > snapshot_event_index]
    tail_genesis = tail[0]["prevSig"] if len(tail) > 0 else chain.head()
    return {
        "worldId": world_id,
        "snapshot": {
            "eventIndex": snapshot_event_index,
            "stateHash": world_state_hash(key, snapshot_state),
            "state": snapshot_state,
        },
        "chainTail": tail,
        "tailGenesis": tail_genesis,
    }


# ---- resume ----------------------------------------------------------------

def resume(key, bundle, current_epoch, ruleset, max_catchup,
           proposals_by_epoch=None, actor_tags=None, max_actions=None):
    """Reconstruct + verify + fast-forward a world from a bundle. Fail-closed at
    every integrity gate. Deterministic: given the same (bundle, current_epoch,
    proposals_by_epoch), the result is byte-identical on every surface.

    Returns {"world_id", "state", "new_events", "epochs_resolved",
    "epochs_voided"} - new_events are the EpochResolved events generated during
    catch-up, ready for the caller to append to the chain + persist."""
    b = bundle

    # (1) snapshot integrity - constant-time hash compare.
    if not verify_world_snapshot(key, b["snapshot"]["state"], b["snapshot"]["stateHash"]):
        raise ValueError("world-session: corrupted snapshot (state hash mismatch)")

    # (2) load the verified snapshot into the working state.
    work = _clone_state(b["snapshot"]["state"])

    # (3) tail chain integrity - verify HMAC signatures + linkage vs the anchor.
    tail = b.get("chainTail") or []
    if len(tail) > 0:
        res = verify_records(key, tail, b["tailGenesis"])
        if not res["ok"]:
            raise ValueError("world-session: chain tamper detected in tail")

    # (4) reducer - replay the recorded events (NOT the AST) to recover the head.
    for rec in tail:
        if rec:
            work = replay_epoch_event(work, rec["payload"])

    # (5) catch-up bounding - reject time travel (a clock behind the world state).
    if not _is_safe_integer(current_epoch):
        raise ValueError("world-session: currentEpoch must be a JS-safe integer")
    if current_epoch < work["epoch"]:
        raise ValueError(
            "world-session: time travel detected (currentEpoch < state.epoch)")

    # (6) deterministic offline catch-up (bounded by max_catchup; excess voided).
    caught = catch_up_epochs(
        b["worldId"], work, current_epoch, max_catchup, ruleset,
        proposals_by_epoch=proposals_by_epoch, actor_tags=actor_tags,
        max_actions=max_actions,
    )

    return {
        "world_id": b["worldId"],
        "state": caught["state"],
        "new_events": caught["events"],
        "epochs_resolved": caught["epochs_resolved"],
        "epochs_voided": caught["epochs_voided"],
    }
