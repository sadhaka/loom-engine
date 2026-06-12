// region-sync.ts - the partial-sync CLIENT consumer of region-hash leaves (v6).
//
// region-hash.ts gives the SERVER side of partial sync: per-region leaf hashes
// plus a global Merkle root. This module is the missing CLIENT half - the code
// that actually CONSUMES those leaves to sync a persistent world cheaply:
//
//   1. partitionRegions()  - split one WorldState into world-shaped per-region
//                            partitions (filter entities by their 'region:<id>'
//                            tag), so both sides hash the same partition layout.
//   2. diffRegionLeaves()  - compare the client's cached leaves against the
//                            server's fresh leaves and report exactly which
//                            regions changed / appeared / vanished.
//   3. applyPartialSync()  - fail-closed assembly: verify every pulled region
//                            against its server leaf, recombine pulled + cached
//                            regions, recompute the leaves + root, and
//                            constant-time compare to the server root - proving
//                            the KEPT (not re-downloaded) regions are exactly
//                            what the root commits to. Any mismatch throws.
//
// The point: a client that holds yesterday's regions pulls ONLY the regions
// whose leaves moved, yet ends with the same cryptographic assurance as a full
// download - the recomputed root must equal the server root, and that root
// covers every region, pulled or kept. Persistence + partial sync; the
// partitions are plain world-shaped values.
//
// PARTITION = CONTENT ADDRESS, NOT TIME ADDRESS. partitionRegions pins each
// partition's epoch field to 0 (the parent epoch lives in the full WorldState,
// not in the partition): if the live epoch were folded into every partition,
// every leaf would churn every epoch and partial sync would degenerate into a
// full pull. A region's leaf moves only when its CONTENT (entities) moves.
//
// REUSE, do not re-implement: hashing is regionLeaves / globalRegionHash /
// verifyRegion (region-hash.ts, golden-vector-pinned), the root compare is the
// constant-time timingSafeEqualHex, and id ordering is compareIds (the
// numeric-aware sort pinned across surfaces).
//
// Code style: var-only in browser source.

import { globalRegionHash, verifyRegion } from './region-hash.js';
import { timingSafeEqualHex } from './hmac-sha256.js';
import { compareIds } from './ruleset.js';
import type { WorldState, WorldEntity } from './world-state-snapshot.js';

// The default tag prefix marking an entity's region: 'region:<regionId>'.
export var DEFAULT_REGION_TAG_PREFIX = 'region:';

// Faithful structural clone (regions are integer/string/plain-object/array
// only - the same canonical surface worldStateHash accepts).
function cloneJson<V>(v: V): V {
  return JSON.parse(JSON.stringify(v)) as V;
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// ---- partitionRegions -------------------------------------------------------

// Split a WorldState into world-shaped per-region partitions. Pure: the input
// state is never mutated; every partition is an independent clone. Each entity
// must carry EXACTLY ONE region tag ('region:<id>' by default) - zero or
// several is ambiguous and throws fail-closed (an entity silently dropped from
// every partition would be invisible to the Merkle root). Region ids are
// emitted in compareIds order; the hash does not depend on it (canonicalJson
// sorts keys), but deterministic output keeps serialized partitions stable.
export function partitionRegions(state: WorldState, prefix?: string): Record<string, WorldState> {
  var p = (typeof prefix === 'string' && prefix.length > 0) ? prefix : DEFAULT_REGION_TAG_PREFIX;
  var entities = state.entities || {};
  var entityIds = Object.keys(entities);
  // Prototype-pollution safe: regionId/entityId keys derive from entity tags
  // (untrusted), so a "__proto__"/"constructor" key must set an OWN property,
  // never reach Object.prototype. Null-proto maps make every keyed write below
  // safe; Object.keys + the hasOwn helper (hasOwnProperty.call) are unchanged,
  // so canonical hashing stays byte-identical. (CodeQL js/prototype-polluting-
  // assignment.)
  var byRegion: Record<string, Record<string, WorldEntity>> = Object.create(null);
  for (var i = 0; i < entityIds.length; i++) {
    var entityId = entityIds[i] as string;
    var ent = entities[entityId];
    if (!ent) continue;
    var tags = Array.isArray(ent.tags) ? ent.tags : [];
    var regionId = '';
    var matches = 0;
    for (var t = 0; t < tags.length; t++) {
      var tag = tags[t] as string;
      if (typeof tag === 'string' && tag.length > p.length && tag.indexOf(p) === 0) {
        regionId = tag.slice(p.length);
        matches = matches + 1;
      }
    }
    if (matches !== 1) {
      throw new Error('region-sync: entity "' + entityId + '" must carry exactly one "'
        + p + '<id>" tag (found ' + matches + ')');
    }
    var bucket = byRegion[regionId];
    if (!bucket) { bucket = Object.create(null) as Record<string, WorldEntity>; byRegion[regionId] = bucket; }
    bucket[entityId] = cloneJson(ent);
  }
  var regionIds = Object.keys(byRegion).sort(compareIds);
  var out: Record<string, WorldState> = Object.create(null);
  for (var r = 0; r < regionIds.length; r++) {
    var id = regionIds[r] as string;
    // epoch pinned to 0: a partition leaf is a CONTENT address (see header).
    out[id] = { epoch: 0, worldSeed: state.worldSeed, entities: byRegion[id] as Record<string, WorldEntity> };
  }
  return out;
}

// ---- diffRegionLeaves -------------------------------------------------------

export interface RegionLeafDiff {
  // Regions present on both sides whose leaf hash moved - pull these.
  changed: string[];
  // Regions the server has but the client cache lacks - pull these too.
  added: string[];
  // Regions the client cache has but the server no longer lists.
  removed: string[];
}

// Compare the client's cached leaves to the server's fresh leaves. Pure change
// DETECTION only - integrity is enforced later by applyPartialSync (a hash here
// is just a fingerprint both sides already hold; no secret, no timing risk).
// All three lists are sorted by compareIds so the diff is deterministic.
export function diffRegionLeaves(
  cachedLeaves: Record<string, string>,
  serverLeaves: Record<string, string>,
): RegionLeafDiff {
  var changed: string[] = [];
  var added: string[] = [];
  var removed: string[] = [];
  var serverIds = Object.keys(serverLeaves);
  for (var i = 0; i < serverIds.length; i++) {
    var sid = serverIds[i] as string;
    if (hasOwn(cachedLeaves, sid)) {
      if (cachedLeaves[sid] !== serverLeaves[sid]) changed.push(sid);
    } else {
      added.push(sid);
    }
  }
  var cachedIds = Object.keys(cachedLeaves);
  for (var j = 0; j < cachedIds.length; j++) {
    var cid = cachedIds[j] as string;
    if (!hasOwn(serverLeaves, cid)) removed.push(cid);
  }
  changed.sort(compareIds);
  added.sort(compareIds);
  removed.sort(compareIds);
  return { changed: changed, added: added, removed: removed };
}

// ---- applyPartialSync -------------------------------------------------------

export interface PartialSyncInput {
  // HMAC secret. Runtime-supplied; never persisted or logged.
  key: string | Uint8Array;
  // The client's cached regions (its last verified sync).
  cachedRegions: Record<string, unknown>;
  // The regions the client pulled from the server this round (the diff set).
  pulledRegions: Record<string, unknown>;
  // The server's per-region leaf hashes for the CURRENT world.
  serverLeaves: Record<string, string>;
  // The server's global region root for the CURRENT world.
  serverRoot: string;
}

export interface PartialSyncResult {
  // The verified, recombined region set (pulled regions over kept cached ones).
  regions: Record<string, unknown>;
  // The recomputed global root (constant-time-equal to serverRoot, proven).
  root: string;
  // Region ids that were pulled + leaf-verified this sync (compareIds order).
  pulled: string[];
  // Region ids reused from the cache, proven current by the root (same order).
  kept: string[];
}

// Fail-closed partial-sync assembly. Strict order:
//   (1) every pulled region must be named by a server leaf;
//   (2) every pulled region must verify against its leaf (constant-time);
//   (3) recombine: for each server-listed region take the pulled version,
//       else the cached version - a region in neither is a hard error;
//   (4) recompute regionLeaves + globalRegionHash over the recombined set and
//       constant-time compare to serverRoot. This is what makes KEEPING cached
//       regions safe: the recomputed root covers them, so a stale or tampered
//       cached region can never slip through on the cheap path.
// Any failure throws - the caller falls back to a full sync.
export function applyPartialSync(input: PartialSyncInput): PartialSyncResult {
  if (!input || typeof input !== 'object') {
    throw new Error('region-sync: applyPartialSync requires an input object');
  }
  if (typeof input.serverRoot !== 'string' || input.serverRoot.length === 0) {
    throw new Error('region-sync: serverRoot must be a non-empty string');
  }
  var cached = input.cachedRegions || {};
  var pulled = input.pulledRegions || {};
  var leaves = input.serverLeaves || {};

  // (1) + (2) verify every pulled region against the server's leaf for it.
  var pulledIds = Object.keys(pulled).sort(compareIds);
  for (var i = 0; i < pulledIds.length; i++) {
    var pid = pulledIds[i] as string;
    if (!hasOwn(leaves, pid)) {
      throw new Error('region-sync: pulled region "' + pid + '" has no server leaf');
    }
    if (!verifyRegion(input.key, pulled[pid], leaves[pid] as string)) {
      throw new Error('region-sync: pulled region "' + pid + '" failed leaf verification');
    }
  }

  // (3) recombine pulled + kept cached regions over the server's region list.
  var serverIds = Object.keys(leaves).sort(compareIds);
  // Null-proto: serverIds keys derive from entity tags (untrusted) - same
  // prototype-pollution guard as partitionWorldIntoRegionLeaves above.
  var merged: Record<string, unknown> = Object.create(null);
  var keptIds: string[] = [];
  for (var s = 0; s < serverIds.length; s++) {
    var sid = serverIds[s] as string;
    if (hasOwn(pulled, sid)) {
      merged[sid] = cloneJson(pulled[sid]);
    } else if (hasOwn(cached, sid)) {
      merged[sid] = cloneJson(cached[sid]);
      keptIds.push(sid);
    } else {
      throw new Error('region-sync: region "' + sid + '" is neither pulled nor cached');
    }
  }

  // (4) recompute + constant-time root compare (covers kept AND pulled).
  var root = globalRegionHash(input.key, merged);
  if (!timingSafeEqualHex(root, input.serverRoot)) {
    throw new Error('region-sync: recombined region root does not match the server root (stale or tampered cache - fall back to a full sync)');
  }
  return { regions: merged, root: root, pulled: pulledIds, kept: keptIds };
}

// Resource key for the world's resource registry.
export var RESOURCE_REGION_SYNC = 'region_sync';
