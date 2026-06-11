"""region_sync - the partial-sync CLIENT consumer of region-hash leaves (v6, Python).

Byte-identical to the TS region-sync.ts. region_hash gives the SERVER side of
partial sync: per-region leaf hashes plus a global Merkle root. This module is
the missing CLIENT half - the code that actually CONSUMES those leaves to sync
a persistent world cheaply:

  1. partition_regions()  - split one WorldState into world-shaped per-region
                            partitions (filter entities by their 'region:<id>'
                            tag), so both sides hash the same partition layout.
  2. diff_region_leaves() - compare the client's cached leaves against the
                            server's fresh leaves and report exactly which
                            regions changed / appeared / vanished.
  3. apply_partial_sync() - fail-closed assembly: verify every pulled region
                            against its server leaf, recombine pulled + cached
                            regions, recompute the leaves + root, and
                            constant-time compare to the server root - proving
                            the KEPT (not re-downloaded) regions are exactly
                            what the root commits to. Any mismatch raises.

The point: a client that holds yesterday's regions pulls ONLY the regions whose
leaves moved, yet ends with the same cryptographic assurance as a full download
- the recomputed root must equal the server root, and that root covers every
region, pulled or kept. Persistence + partial sync; the partitions are plain
world-shaped dicts.

PARTITION = CONTENT ADDRESS, NOT TIME ADDRESS. partition_regions pins each
partition's epoch field to 0 (the parent epoch lives in the full WorldState,
not in the partition): if the live epoch were folded into every partition,
every leaf would churn every epoch and partial sync would degenerate into a
full pull. A region's leaf moves only when its CONTENT (entities) moves.

REUSE, do not re-implement: hashing is region_leaves / global_region_hash /
verify_region (region_hash, golden-vector-pinned), the root compare is the
constant-time hmac.compare_digest, and id ordering is compare_ids (the
numeric-aware sort pinned across surfaces). Pinned by
test_vectors/v6_1_plaza_persistent.json.
"""

import copy as _copy
import functools as _functools
import hmac as _hmac

from .region_hash import global_region_hash, verify_region
from .ruleset import compare_ids

# The default tag prefix marking an entity's region: 'region:<regionId>'.
DEFAULT_REGION_TAG_PREFIX = "region:"

# Resource key for the world's resource registry.
RESOURCE_REGION_SYNC = "region_sync"

_ID_KEY = _functools.cmp_to_key(compare_ids)


def _clone_json(v):
    # Faithful structural clone (regions are integer/string/plain-object/array
    # only - the same canonical surface world_state_hash accepts).
    return _copy.deepcopy(v)


# ---- partition_regions ------------------------------------------------------

def partition_regions(state, prefix=None):
    """Split a WorldState into world-shaped per-region partitions. Pure: the
    input state is never mutated; every partition is an independent clone.
    Each entity must carry EXACTLY ONE region tag ('region:<id>' by default) -
    zero or several is ambiguous and raises fail-closed (an entity silently
    dropped from every partition would be invisible to the Merkle root).
    Region ids are emitted in compare_ids order; the hash does not depend on
    it (the canonical encoder sorts keys), but deterministic output keeps
    serialized partitions stable."""
    p = prefix if isinstance(prefix, str) and len(prefix) > 0 else DEFAULT_REGION_TAG_PREFIX
    entities = state.get("entities") or {}
    by_region = {}
    for entity_id in entities.keys():
        ent = entities[entity_id]
        if not ent:
            continue
        tags = ent.get("tags")
        if not isinstance(tags, list):
            tags = []
        region_id = ""
        matches = 0
        for tag in tags:
            if isinstance(tag, str) and len(tag) > len(p) and tag.startswith(p):
                region_id = tag[len(p):]
                matches = matches + 1
        if matches != 1:
            raise ValueError(
                'region-sync: entity "%s" must carry exactly one "%s<id>" tag (found %d)'
                % (entity_id, p, matches))
        bucket = by_region.get(region_id)
        if bucket is None:
            bucket = {}
            by_region[region_id] = bucket
        bucket[entity_id] = _clone_json(ent)
    out = {}
    for region_id in sorted(by_region.keys(), key=_ID_KEY):
        # epoch pinned to 0: a partition leaf is a CONTENT address (see header).
        out[region_id] = {"epoch": 0, "worldSeed": state["worldSeed"],
                          "entities": by_region[region_id]}
    return out


# ---- diff_region_leaves -----------------------------------------------------

def diff_region_leaves(cached_leaves, server_leaves):
    """Compare the client's cached leaves to the server's fresh leaves. Pure
    change DETECTION only - integrity is enforced later by apply_partial_sync
    (a hash here is just a fingerprint both sides already hold; no secret, no
    timing risk). Returns {"changed", "added", "removed"}, each sorted by
    compare_ids so the diff is deterministic."""
    changed = []
    added = []
    removed = []
    for sid in server_leaves.keys():
        if sid in cached_leaves:
            if cached_leaves[sid] != server_leaves[sid]:
                changed.append(sid)
        else:
            added.append(sid)
    for cid in cached_leaves.keys():
        if cid not in server_leaves:
            removed.append(cid)
    changed.sort(key=_ID_KEY)
    added.sort(key=_ID_KEY)
    removed.sort(key=_ID_KEY)
    return {"changed": changed, "added": added, "removed": removed}


# ---- apply_partial_sync -----------------------------------------------------

def apply_partial_sync(key, cached_regions, pulled_regions, server_leaves, server_root):
    """Fail-closed partial-sync assembly. Strict order:
      (1) every pulled region must be named by a server leaf;
      (2) every pulled region must verify against its leaf (constant-time);
      (3) recombine: for each server-listed region take the pulled version,
          else the cached version - a region in neither is a hard error;
      (4) recompute region_leaves + global_region_hash over the recombined set
          and constant-time compare to server_root. This is what makes KEEPING
          cached regions safe: the recomputed root covers them, so a stale or
          tampered cached region can never slip through on the cheap path.
    Any failure raises - the caller falls back to a full sync. Returns
    {"regions", "root", "pulled", "kept"}."""
    if not isinstance(server_root, str) or len(server_root) == 0:
        raise ValueError("region-sync: serverRoot must be a non-empty string")
    cached = cached_regions or {}
    pulled = pulled_regions or {}
    leaves = server_leaves or {}

    # (1) + (2) verify every pulled region against the server's leaf for it.
    pulled_ids = sorted(pulled.keys(), key=_ID_KEY)
    for pid in pulled_ids:
        if pid not in leaves:
            raise ValueError(
                'region-sync: pulled region "%s" has no server leaf' % pid)
        if not verify_region(key, pulled[pid], leaves[pid]):
            raise ValueError(
                'region-sync: pulled region "%s" failed leaf verification' % pid)

    # (3) recombine pulled + kept cached regions over the server's region list.
    server_ids = sorted(leaves.keys(), key=_ID_KEY)
    merged = {}
    kept_ids = []
    for sid in server_ids:
        if sid in pulled:
            merged[sid] = _clone_json(pulled[sid])
        elif sid in cached:
            merged[sid] = _clone_json(cached[sid])
            kept_ids.append(sid)
        else:
            raise ValueError(
                'region-sync: region "%s" is neither pulled nor cached' % sid)

    # (4) recompute + constant-time root compare (covers kept AND pulled).
    root = global_region_hash(key, merged)
    if not _hmac.compare_digest(root, server_root):
        raise ValueError(
            "region-sync: recombined region root does not match the server root"
            " (stale or tampered cache - fall back to a full sync)")
    return {"regions": merged, "root": root, "pulled": pulled_ids, "kept": kept_ids}
