// region-hash.ts - partitioned world-state hashing for interest management (v5).
//
// In a sharded shared world a client only syncs the region(s) it occupies, so it
// cannot compute a GLOBAL world hash to detect a misprediction. The fix (Gemini's
// netcode blueprint) is a 2-level Merkle tree: each region hashes independently, and
// the global hash is the HMAC over the canonical map of per-region hashes. Changing
// one region changes ONLY its leaf and the root - never another region's leaf - so a
// partial-sync client verifies its own region's leaf plus the root, with no access to
// the rest of the world.
//
// REUSE, do not re-implement: every hash is worldStateHash() (the audited,
// golden-vector-pinned, byte-parity HMAC-SHA-256 over canonicalJson). A region is
// just a world-state-shaped partition; the leaf map is a plain { regionId: hashHex }
// object whose keys canonicalJson sorts, so the root is order-independent. Inherits
// cross-language byte-parity (TS / Python / Rust / WASM / PyO3 / C-ABI) for free.
//
// Code style: var-only in browser source.
import { worldStateHash, verifyWorldSnapshot } from './world-state-snapshot.js';
// The content hash of ONE region (a region is a world-state-shaped partition).
export function regionHash(key, regionState) {
    return worldStateHash(key, regionState);
}
// The per-region leaf hashes: { regionId: regionHash }. The server sends these so a
// partial-sync client can verify its own region without holding the full world.
export function regionLeaves(key, regions) {
    var leaves = {};
    var ids = Object.keys(regions);
    for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        leaves[id] = worldStateHash(key, regions[id]);
    }
    return leaves;
}
// The GLOBAL hash: HMAC over the canonical map of region leaf hashes (the Merkle
// root). canonicalJson sorts the region ids, so the root is deterministic regardless
// of insertion order; mutating one region changes only its leaf + this root.
export function globalRegionHash(key, regions) {
    return worldStateHash(key, regionLeaves(key, regions));
}
// Verify ONE region against an expected leaf hash (constant-time, so it is safe as an
// integrity gate on an untrusted partial sync).
export function verifyRegion(key, regionState, expectedHash) {
    return verifyWorldSnapshot(key, regionState, expectedHash);
}
// Resource key for the world's resource registry.
export var RESOURCE_REGION_HASH = 'region_hash';
//# sourceMappingURL=region-hash.js.map