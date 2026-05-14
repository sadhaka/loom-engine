// OmniveilSKB - a semantic knowledge base: source-attributed "truth
// claims" stored as (subject, predicate, object) triples with a
// distinct-source consensus count.
//
// The Trinity dossier's section 4 (Gemini Volume I). The Gemini sketch
// was `addClaim(s,p,o) { const i = hash(s,p,o) % MAX; Atomics.add(
// claims, i+3, 1) }` - the Codex audit rejected it: "truth system is
// gameable and async persistence allocates." Two fatal flaws: it
// incremented the consensus counter at a HASHED slot with no check
// that the slot actually held that triple (a hash collision
// cross-contaminates two unrelated claims), and it had no notion of
// WHO claimed - so one source calling addClaim a thousand times faked
// a thousand-strong consensus.
//
// This is the corrected build. A claim is a triple of three opaque
// u32 ids (subject, predicate, object) - the caller maps them to
// entities / relations / values; the SKB never interprets them.
// Storage is an open-addressed hash table keyed by the FULL triple:
//   subject / predicate / object  Uint32  per slot - the triple
//   flags                         Uint8   per slot - ACTIVE / TOMBSTONE
//   consensus                     Uint32  per slot - distinct-source count
//   sourceBits  Uint32  maxClaims * sourceWords - per-claim source bitset
// FNV-1a hashes the triple to a start slot; linear probing resolves
// collisions; a retract that drops consensus to 0 tombstones the slot
// (tombstones are skipped by lookups and reused by inserts).
//
// CONSENSUS IS BY SOURCE, NOT BY CALL. Each claim slot carries a
// bitset of maxSources bits; assertClaim(source, ...) sets that
// source's bit, and consensus is the popcount. Re-asserting from a
// source whose bit is already set is idempotent - consensus counts
// distinct SOURCES. This is the structural anti-gaming property: a
// flooding source cannot inflate consensus.
//
// CONTRADICTION + POISONING. Contradictions are surfaced, never
// auto-resolved (the dossier: unverified claims are "inert data, never
// executable policy"): isContested(s,p) reports whether more than one
// object is claimed for a subject+predicate, and resolveBest(s,p)
// returns the highest-consensus object (deterministic lowest-id
// tie-break) - the caller applies policy. Poisoning is blocked two
// ways: the idempotent source bitset (above), plus a per-source
// maxClaimsPerSource cap so one source cannot flood the table with
// distinct garbage triples - assertClaim returns 0 when a source is
// at its cap.
//
// The 6 Codex gates for OmniveilSKB, enforced:
//   1. "active-slot metadata and bounds checks" - the flags byte
//      (ACTIVE / TOMBSTONE) is the occupancy signal; every source id,
//      every subject / predicate / object value, and every derived
//      index is bounds-checked.
//   2. "verify exact subject/predicate/object identity before
//      incrementing consensus" - the probe matches the FULL triple
//      before touching a slot's consensus. A hash collision lands on a
//      different triple and probing continues; the Gemini blind
//      increment is gone.
//   3. "track independent source identity" - the per-claim source
//      bitset; consensus is the distinct-source popcount, not a call
//      count.
//   4. "contradiction and poisoning rules" - isContested / resolveBest
//      surface contradictions without resolving them; the idempotent
//      bitset plus the per-source claim cap block poisoning.
//   5. "preallocate flush snapshots" - exportClaims(out) copies active
//      claims into a caller-PREALLOCATED Uint32Array as
//      [subject, predicate, object, consensus] quads, zero-allocation.
//      The async SQLite / vector persistence that consumes the
//      snapshot is the deferred integration layer.
//   6. "single-thread ownership for mutation and async result
//      application" - single-owner, single-thread; the Gemini
//      Atomics.add is gone, matching every shipped Trinity component.
//      The cross-worker / async-result path is deferred.
//
// Non-negotiable engine gates: no RNG, no wall clock (FNV-1a hashing,
// linear probing, and deterministic tie-breaks make a run replay
// bit-for-bit); every index bounds-checked; the table is fixed-
// capacity and throws when genuinely full. Storage is allocated once
// in the constructor - assert / retract / query allocate nothing.

// Slot flag bits, packed into the flags Uint8 column.
const CLAIM_FLAG_ACTIVE = 1 << 0;      // slot holds a live claim
const CLAIM_FLAG_TOMBSTONE = 1 << 1;   // slot was a claim, retracted to 0 - skip on lookup, reuse on insert

// FNV-1a constants - a fast non-cryptographic hash. Hash quality only
// affects probe length, never correctness (gate 2 verifies identity).
const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

// Sanity caps on the constructor-derived sizes. Not hard engine limits
// - guards so a bad argument throws a clear error instead of
// attempting an absurd typed-array allocation.
const MAX_CLAIMS = 1 << 20;   // hash-table slots (a power of two)
const MAX_SOURCES = 256;      // distinct claim sources -> up to 8 u32 bitset words per claim
const U32_MAX = 0xffffffff;

// exportClaims writes fixed-width records of this many u32:
// [subject, predicate, object, consensus].
export const CLAIM_QUAD_STRIDE = 4;

export class OmniveilSKB {
  // Hash-table slot count - a power of two.
  readonly maxClaims: number;
  // Distinct claim sources: a source id is in [0, maxSources).
  readonly maxSources: number;
  // Per-source cap on distinct triples asserted - the poisoning rule.
  readonly maxClaimsPerSource: number;

  // maxClaims - 1: the wrap mask for hashing and linear probing.
  private readonly mask: number;
  // ceil(maxSources / 32): u32 words in each claim's source bitset.
  private readonly sourceWords: number;

  // Triple columns, indexed by slot.
  private readonly subject: Uint32Array;
  private readonly predicate: Uint32Array;
  private readonly object: Uint32Array;
  // Occupancy metadata (gate 1), indexed by slot.
  private readonly flags: Uint8Array;
  // Cached distinct-source count (popcount of the slot's source
  // bitset), indexed by slot - keeps consensusOf O(1).
  private readonly consensus: Uint32Array;
  // Per-claim source bitset (gate 3): claim `slot`, source `src` ->
  // bit (src & 31) of word sourceBits[slot * sourceWords + (src >>> 5)].
  private readonly sourceBits: Uint32Array;
  // Distinct triples each source currently asserts - drives the
  // per-source poisoning cap and getSourceClaimCount.
  private readonly sourceClaimCount: Uint32Array;

  // Live (ACTIVE, non-tombstone) claim count.
  private activeCount: number = 0;

  constructor(maxClaims: number, maxSources: number, maxClaimsPerSource: number) {
    if (!Number.isInteger(maxClaims) || maxClaims < 2 || maxClaims > MAX_CLAIMS
      || (maxClaims & (maxClaims - 1)) !== 0) {
      throw new RangeError(
        'OmniveilSKB: maxClaims must be a power of two in [2, ' + MAX_CLAIMS + '], got ' + maxClaims,
      );
    }
    if (!Number.isInteger(maxSources) || maxSources < 1 || maxSources > MAX_SOURCES) {
      throw new RangeError(
        'OmniveilSKB: maxSources must be an integer in [1, ' + MAX_SOURCES + '], got ' + maxSources,
      );
    }
    if (!Number.isInteger(maxClaimsPerSource) || maxClaimsPerSource < 1 || maxClaimsPerSource > maxClaims) {
      throw new RangeError(
        'OmniveilSKB: maxClaimsPerSource must be an integer in [1, maxClaims=' + maxClaims + '], got '
        + maxClaimsPerSource,
      );
    }
    this.maxClaims = maxClaims;
    this.maxSources = maxSources;
    this.maxClaimsPerSource = maxClaimsPerSource;
    this.mask = maxClaims - 1;
    this.sourceWords = (maxSources + 31) >>> 5;   // ceil(maxSources / 32)
    this.subject = new Uint32Array(maxClaims);
    this.predicate = new Uint32Array(maxClaims);
    this.object = new Uint32Array(maxClaims);
    this.flags = new Uint8Array(maxClaims);
    this.consensus = new Uint32Array(maxClaims);
    this.sourceBits = new Uint32Array(maxClaims * this.sourceWords);
    this.sourceClaimCount = new Uint32Array(maxSources);
  }

  // Live claim count - triples with at least one asserting source.
  getClaimCount(): number {
    return this.activeCount;
  }

  // How many distinct triples `source` currently asserts (against its
  // maxClaimsPerSource cap).
  getSourceClaimCount(source: number): number {
    this.requireSource(source, 'getSourceClaimCount');
    return this.sourceClaimCount[source] ?? 0;
  }

  // Assert that `source` claims the triple (subject, predicate,
  // object). Returns the triple's new distinct-source consensus
  // (>= 1), or 0 if the assert was rejected because `source` is at its
  // maxClaimsPerSource cap. Re-asserting a triple the source already
  // claims is idempotent and returns the current consensus. Throws if
  // the claim table is genuinely full.
  assertClaim(source: number, subject: number, predicate: number, object: number): number {
    this.requireSource(source, 'assertClaim');
    this.requireU32(subject, 'assertClaim', 'subject');
    this.requireU32(predicate, 'assertClaim', 'predicate');
    this.requireU32(object, 'assertClaim', 'object');
    const mask = this.mask;
    const start = this.hashTriple(subject, predicate, object) & mask;
    let firstTombstone = -1;
    let insertSlot = -1;
    for (let probe = 0; probe < this.maxClaims; probe++) {
      const slot = (start + probe) & mask;
      const f = this.flags[slot] ?? 0;
      if ((f & CLAIM_FLAG_ACTIVE) !== 0) {
        // Gate 2: match the FULL triple before touching consensus.
        if ((this.subject[slot] ?? 0) === subject
          && (this.predicate[slot] ?? 0) === predicate
          && (this.object[slot] ?? 0) === object) {
          return this.addSource(slot, source);
        }
        // A different triple collided here - keep probing.
      } else if ((f & CLAIM_FLAG_TOMBSTONE) !== 0) {
        if (firstTombstone < 0) firstTombstone = slot;
        // The triple may still be live further down the chain - keep probing.
      } else {
        // An EMPTY slot ends the chain: the triple is not in the table.
        insertSlot = firstTombstone >= 0 ? firstTombstone : slot;
        break;
      }
    }
    // No EMPTY was reached; a tombstone is still a valid insert target.
    if (insertSlot < 0) insertSlot = firstTombstone;
    if (insertSlot < 0) {
      throw new Error('OmniveilSKB.assertClaim: claim table full (maxClaims=' + this.maxClaims + ')');
    }
    // A brand-new triple is a new distinct claim for `source` - the
    // per-source poisoning cap (gate 4). Checked BEFORE occupying so a
    // rejected assert leaves no phantom slot.
    if ((this.sourceClaimCount[source] ?? 0) >= this.maxClaimsPerSource) {
      return 0;
    }
    this.subject[insertSlot] = subject;
    this.predicate[insertSlot] = predicate;
    this.object[insertSlot] = object;
    this.flags[insertSlot] = CLAIM_FLAG_ACTIVE;
    const rowStart = insertSlot * this.sourceWords;
    for (let w = 0; w < this.sourceWords; w++) this.sourceBits[rowStart + w] = 0;
    this.sourceBits[rowStart + (source >>> 5)] = 1 << (source & 31);
    this.consensus[insertSlot] = 1;
    this.sourceClaimCount[source] = (this.sourceClaimCount[source] ?? 0) + 1;
    this.activeCount++;
    return 1;
  }

  // Withdraw `source`'s assertion of the triple. Returns true if the
  // source was in fact asserting it (and is now removed); false if the
  // triple is unknown or the source never claimed it. When the last
  // source retracts, the claim's consensus hits 0 and its slot is
  // tombstoned (reusable by a later assert).
  retractClaim(source: number, subject: number, predicate: number, object: number): boolean {
    this.requireSource(source, 'retractClaim');
    this.requireU32(subject, 'retractClaim', 'subject');
    this.requireU32(predicate, 'retractClaim', 'predicate');
    this.requireU32(object, 'retractClaim', 'object');
    const slot = this.findSlot(subject, predicate, object);
    if (slot < 0) return false;
    const wordIdx = slot * this.sourceWords + (source >>> 5);
    const bit = 1 << (source & 31);
    const word = this.sourceBits[wordIdx] ?? 0;
    if ((word & bit) === 0) return false;   // this source was not asserting it
    this.sourceBits[wordIdx] = word & ~bit;
    this.sourceClaimCount[source] = (this.sourceClaimCount[source] ?? 0) - 1;
    const c = (this.consensus[slot] ?? 0) - 1;
    this.consensus[slot] = c;
    if (c === 0) {
      // No sources left - tombstone the slot so probe chains stay
      // intact while the slot becomes reusable.
      this.flags[slot] = CLAIM_FLAG_TOMBSTONE;
      this.activeCount--;
    }
    return true;
  }

  // The distinct-source consensus for a triple, or 0 if no source
  // currently asserts it.
  consensusOf(subject: number, predicate: number, object: number): number {
    this.requireU32(subject, 'consensusOf', 'subject');
    this.requireU32(predicate, 'consensusOf', 'predicate');
    this.requireU32(object, 'consensusOf', 'object');
    const slot = this.findSlot(subject, predicate, object);
    return slot < 0 ? 0 : (this.consensus[slot] ?? 0);
  }

  // True if at least one source asserts the triple.
  hasClaim(subject: number, predicate: number, object: number): boolean {
    return this.consensusOf(subject, predicate, object) > 0;
  }

  // True if `source` specifically asserts the triple.
  hasSourceClaimed(source: number, subject: number, predicate: number, object: number): boolean {
    this.requireSource(source, 'hasSourceClaimed');
    this.requireU32(subject, 'hasSourceClaimed', 'subject');
    this.requireU32(predicate, 'hasSourceClaimed', 'predicate');
    this.requireU32(object, 'hasSourceClaimed', 'object');
    const slot = this.findSlot(subject, predicate, object);
    if (slot < 0) return false;
    const word = this.sourceBits[slot * this.sourceWords + (source >>> 5)] ?? 0;
    return (word & (1 << (source & 31))) !== 0;
  }

  // True if more than one distinct object is currently claimed for
  // this subject+predicate - a contradiction. The SKB surfaces it; the
  // caller decides what to do (gate 4 - never auto-resolved).
  isContested(subject: number, predicate: number): boolean {
    this.requireU32(subject, 'isContested', 'subject');
    this.requireU32(predicate, 'isContested', 'predicate');
    let firstObject = 0;
    let haveFirst = false;
    for (let slot = 0; slot < this.maxClaims; slot++) {
      if (((this.flags[slot] ?? 0) & CLAIM_FLAG_ACTIVE) === 0) continue;
      if ((this.subject[slot] ?? 0) !== subject || (this.predicate[slot] ?? 0) !== predicate) continue;
      const obj = this.object[slot] ?? 0;
      if (!haveFirst) {
        firstObject = obj;
        haveFirst = true;
      } else if (obj !== firstObject) {
        return true;
      }
    }
    return false;
  }

  // The object with the highest distinct-source consensus for this
  // subject+predicate - the SKB's "current best truth". Ties resolve
  // to the lowest object id (deterministic). Returns -1 if no source
  // claims anything for this subject+predicate. Pair with isContested
  // to know whether the result was contested.
  resolveBest(subject: number, predicate: number): number {
    this.requireU32(subject, 'resolveBest', 'subject');
    this.requireU32(predicate, 'resolveBest', 'predicate');
    let bestObject = -1;
    let bestConsensus = 0;
    for (let slot = 0; slot < this.maxClaims; slot++) {
      if (((this.flags[slot] ?? 0) & CLAIM_FLAG_ACTIVE) === 0) continue;
      if ((this.subject[slot] ?? 0) !== subject || (this.predicate[slot] ?? 0) !== predicate) continue;
      const obj = this.object[slot] ?? 0;
      const c = this.consensus[slot] ?? 0;
      if (c > bestConsensus || (c === bestConsensus && bestObject >= 0 && obj < bestObject)) {
        bestObject = obj;
        bestConsensus = c;
      }
    }
    return bestObject;
  }

  // Copy every live claim into `out` as [subject, predicate, object,
  // consensus] quads (CLAIM_QUAD_STRIDE wide), returning the number of
  // claims written. Zero-allocation: `out` is caller-preallocated. If
  // `out` cannot hold every claim the result is truncated - size it to
  // getClaimCount() * CLAIM_QUAD_STRIDE to capture all of them.
  exportClaims(out: Uint32Array): number {
    const maxQuads = Math.floor(out.length / CLAIM_QUAD_STRIDE);
    let count = 0;
    for (let slot = 0; slot < this.maxClaims && count < maxQuads; slot++) {
      if (((this.flags[slot] ?? 0) & CLAIM_FLAG_ACTIVE) === 0) continue;
      const base = count * CLAIM_QUAD_STRIDE;
      out[base] = this.subject[slot] ?? 0;
      out[base + 1] = this.predicate[slot] ?? 0;
      out[base + 2] = this.object[slot] ?? 0;
      out[base + 3] = this.consensus[slot] ?? 0;
      count++;
    }
    return count;
  }

  // Reset to the constructed-but-empty state.
  clear(): void {
    this.subject.fill(0);
    this.predicate.fill(0);
    this.object.fill(0);
    this.flags.fill(0);
    this.consensus.fill(0);
    this.sourceBits.fill(0);
    this.sourceClaimCount.fill(0);
    this.activeCount = 0;
  }

  // --- private ---

  // FNV-1a over the three triple words. Non-cryptographic - it only
  // needs to spread triples across the table; gate 2's identity check
  // makes collisions a probe-length cost, never a correctness one.
  private hashTriple(subject: number, predicate: number, object: number): number {
    let h = FNV_OFFSET;
    h ^= subject;
    h = Math.imul(h, FNV_PRIME);
    h ^= predicate;
    h = Math.imul(h, FNV_PRIME);
    h ^= object;
    h = Math.imul(h, FNV_PRIME);
    return h >>> 0;
  }

  // Linear-probe for the ACTIVE slot holding exactly this triple.
  // Returns the slot, or -1 if the triple is not live in the table.
  // Tombstones are probed past; an EMPTY slot ends the chain.
  private findSlot(subject: number, predicate: number, object: number): number {
    const mask = this.mask;
    const start = this.hashTriple(subject, predicate, object) & mask;
    for (let probe = 0; probe < this.maxClaims; probe++) {
      const slot = (start + probe) & mask;
      const f = this.flags[slot] ?? 0;
      if ((f & CLAIM_FLAG_ACTIVE) !== 0) {
        if ((this.subject[slot] ?? 0) === subject
          && (this.predicate[slot] ?? 0) === predicate
          && (this.object[slot] ?? 0) === object) {
          return slot;
        }
      } else if ((f & CLAIM_FLAG_TOMBSTONE) !== 0) {
        // Probe past - the triple may be further down the chain.
      } else {
        return -1;   // EMPTY ends the chain
      }
    }
    return -1;
  }

  // Set `source`'s bit on the claim at `slot`. Returns the slot's new
  // consensus, or the current consensus if the bit was already set
  // (idempotent re-claim), or 0 if `source` is at its maxClaimsPerSource
  // cap (a new bit would exceed it).
  private addSource(slot: number, source: number): number {
    const wordIdx = slot * this.sourceWords + (source >>> 5);
    const bit = 1 << (source & 31);
    const word = this.sourceBits[wordIdx] ?? 0;
    if ((word & bit) !== 0) {
      return this.consensus[slot] ?? 0;   // already asserting it - idempotent
    }
    if ((this.sourceClaimCount[source] ?? 0) >= this.maxClaimsPerSource) {
      return 0;   // poisoning cap - this source asserts too many distinct triples
    }
    this.sourceBits[wordIdx] = word | bit;
    this.sourceClaimCount[source] = (this.sourceClaimCount[source] ?? 0) + 1;
    const c = (this.consensus[slot] ?? 0) + 1;
    this.consensus[slot] = c;
    return c;
  }

  private requireSource(source: number, op: string): void {
    if (!Number.isInteger(source) || source < 0 || source >= this.maxSources) {
      throw new RangeError(
        'OmniveilSKB.' + op + ': source ' + source + ' out of [0, ' + this.maxSources + ')',
      );
    }
  }

  private requireU32(value: number, op: string, name: string): void {
    if (!Number.isInteger(value) || value < 0 || value > U32_MAX) {
      throw new RangeError(
        'OmniveilSKB.' + op + ': ' + name + ' ' + value + ' must be a u32 integer in [0, ' + U32_MAX + ']',
      );
    }
  }
}
