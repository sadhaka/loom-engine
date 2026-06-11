"""region_hash - partitioned world-state hashing for interest management (v5, Python).

Byte-identical to the TS region-hash.ts. In a sharded shared world a client only
syncs the region(s) it occupies, so it cannot compute a GLOBAL world hash to
detect a misprediction. The fix (Gemini's netcode blueprint) is a 2-level Merkle
tree: each region hashes independently, and the global hash is the HMAC over the
canonical map of per-region hashes. Changing one region changes ONLY its leaf
and the root - never another region's leaf - so a partial-sync client verifies
its own region's leaf plus the root, with no access to the rest of the world.

REUSE, do not re-implement: every hash is world_state_hash (the audited,
golden-vector-pinned, byte-parity HMAC-SHA-256 over the canonical encoder). A
region is just a world-state-shaped partition; the leaf map is a plain
{region_id: hash_hex} dict whose keys the canonical encoder sorts, so the root
is order-independent. Inherits cross-language byte-parity (TS / Python / Rust /
WASM / PyO3 / C-ABI) for free. Pinned by test_vectors/v5_3_region_hash.json.
"""

from .world_snapshot import world_state_hash, verify_world_snapshot

# Resource key for the world's resource registry.
RESOURCE_REGION_HASH = "region_hash"


def region_hash(key, region_state):
    """The content hash of ONE region (a region is a world-state-shaped partition)."""
    return world_state_hash(key, region_state)


def region_leaves(key, regions):
    """The per-region leaf hashes: {region_id: region_hash}. The server sends
    these so a partial-sync client can verify its own region without holding
    the full world."""
    leaves = {}
    for region_id in regions.keys():
        leaves[region_id] = world_state_hash(key, regions[region_id])
    return leaves


def global_region_hash(key, regions):
    """The GLOBAL hash: HMAC over the canonical map of region leaf hashes (the
    Merkle root). The canonical encoder sorts the region ids, so the root is
    deterministic regardless of insertion order; mutating one region changes
    only its leaf + this root."""
    return world_state_hash(key, region_leaves(key, regions))


def verify_region(key, region_state, expected_hash):
    """Verify ONE region against an expected leaf hash (constant-time, so it is
    safe as an integrity gate on an untrusted partial sync)."""
    return verify_world_snapshot(key, region_state, expected_hash)
