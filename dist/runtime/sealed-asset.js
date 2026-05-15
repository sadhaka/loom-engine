// SealedAssetRegistry - the delayed-key-disclosure manifest: per-
// asset state machine (SEALED -> KEY_DISCLOSED -> DECRYPTING ->
// READY / FAILED), AES-GCM envelope packing convention, AAD
// construction binding (eventId, assetId, version, contentHash),
// entitlement + region scoped key disclosure, FAILED state +
// generation counters for stale callbacks, opaque CDN-name
// indirection.
//
// The Trinity dossier's section 28 (Gemini Volume II). The Gemini
// sketch was `decryptAsset(envelope, key)` - a single function
// that called `crypto.subtle.decrypt({iv, tagLength: 128}, key,
// data)`. The Codex audit: "good delayed-key design, not post-
// release secrecy." The sketch had no envelope packing convention
// (the IV / tag layout was implicit), no AAD binding (a captured
// key + a swapped envelope decrypted), no entitlement / region
// scoping (any client receiving the SSE got the key), no FAILED
// state (a decrypt error left the asset in limbo), no generation
// counters (a stale completeDecrypt mutated a different asset),
// no opaque CDN names (the asset filename WAS the asset id), and
// no transferable-buffer path (decrypted bytes were copied across
// the worker boundary).
//
// This is the corrected build, single-thread / single-owner like every
// shipped Trinity component. The actual WebCrypto AES-GCM call,
// the SSE delivery channel, and the CDN fetch are the deferred
// integration layer; this is the pure-logic STATE-MACHINE / AAD-
// PACKER / ENTITLEMENT-GATE / GENERATION-CHECK / OPAQUE-NAME kernel
// that drives them.
//
// SECRECY MODEL (gate 7). The kernel implements PRE-release
// secrecy: until the server discloses the AES key for an event,
// the encrypted envelope on the CDN is opaque to anyone (including
// the client that already downloaded it). After key release,
// secrecy ENDS - any client that captures the key + envelope can
// decrypt at any time. This is documented; the kernel does not
// (and cannot) enforce post-release secrecy. The deferred SSE
// transport must use TLS for the key delivery itself.
//
// ENVELOPE LAYOUT (gate 1). The canonical packing:
//   [IV: 12 bytes][Ciphertext: N bytes][Tag: 16 bytes]
// validateEnvelope checks total length >= 12 + 1 + 16 = 29, and
// that the (offset, length) view is in-range; the deferred
// crypto.subtle.decrypt is bound to this exact layout.
//
// AAD CONSTRUCTION (gate 2). buildAAD packs (eventId, assetId,
// version, contentHash) into a fixed-stride 32-byte Uint8Array:
//   bytes 0..3   : eventId u32 LE
//   bytes 4..7   : assetId u32 LE
//   bytes 8..11  : version u32 LE
//   bytes 12..31 : contentHash 20 bytes (typical SHA-1 / truncated
//                  SHA-256 - the consumer chooses)
// AES-GCM binds the decrypt to this AAD; a swapped envelope under
// the same key fails decryption.
//
// ENTITLEMENT + REGION GATE (gate 3). disclosureMatches(eventId,
// clientEntitlementMask, clientRegionMask) validates that the
// client's entitlement bitmask intersects the asset's required
// entitlement AND the client's region bitmask intersects the
// asset's region scope. Only matching clients receive the key.
//
// STATE MACHINE (gate 4):
//   SEALED       (registered; envelope on CDN; no key yet)
//   KEY_DISCLOSED (server has released the key for this event)
//   DECRYPTING   (the decrypt call is in flight)
//   READY        (decrypted bytes available; transferred)
//   FAILED       (decrypt failed - bad envelope, bad key, AAD
//                 mismatch); generation bumps so any in-flight
//                 stale callback is rejected.
//   REVOKED      (manually invalidated by the consumer)
// Every transition writes the current generation; completeDecrypt
// rejects a stale (generation-mismatched) callback.
//
// OPAQUE CDN NAMES (gate 5). cdnHash is a u32 the consumer maps
// to the actual CDN URL via an external (encrypted-manifest) table.
// The asset id never leaks the asset's purpose; the manifest
// itself is encrypted with a separately-issued key.
//
// TRANSFERABLE BUFFERS (gate 6). markReady(handle, byteLength,
// transferred=true) records that the decrypted bytes were
// "transferred" via postMessage's transferable-objects path -
// the consumer commits to not re-using them on the worker side.
// The kernel exposes a getDecryptedByteLength so the main thread
// knows the size; the actual bytes live on the main thread.
//
// The 7 Codex gates for SealedAssetRegistry, enforced:
//   1. "pack assets as [IV][Ciphertext][Tag]" - envelope layout
//      constants exposed; validateEnvelope checks the structure.
//   2. "AES-GCM AAD binding event/asset/version/hash" - buildAAD
//      packs all four into a 32-byte buffer the deferred crypto
//      decrypt MUST use as additionalData.
//   3. "scope key disclosure by entitlement / region" -
//      disclosureMatches gates the SSE delivery; the consumer's
//      transport layer calls this before sending the key.
//   4. "FAILED state + generation counters" - asset state machine
//      includes FAILED; per-asset generation u8 bumps on every
//      transition; completeDecrypt rejects stale generations.
//   5. "opaque CDN names + encrypted manifests" - cdnHash u32 is
//      the only on-disk identifier; the consumer maintains the
//      external encrypted manifest mapping cdnHash -> URL.
//   6. "transferable worker buffers to reduce copies" - markReady
//      records the transferred flag; the kernel does not store
//      the bytes (they live on the main thread post-transfer).
//   7. "document that secrecy ends at key release" - kernel
//      header comment + getSecrecyEndedFlag(eventId) reports
//      whether a key has been disclosed (post-release the gate
//      is academic; new clients fetching the envelope can decrypt
//      with the cached key).
//
// Non-negotiable engine gates: no RNG; no wall clock - tick(t) is
// injected; single-thread, no Atomics; every assetId / eventId /
// generation / mask bounds-checked; fixed-capacity storage. The
// AES-GCM call, SSE transport, and CDN fetch are deferred.
// Asset states.
export const SEALED_STATE_NONE = 0; // empty slot
export const SEALED_STATE_SEALED = 1;
export const SEALED_STATE_KEY_DISCLOSED = 2;
export const SEALED_STATE_DECRYPTING = 3;
export const SEALED_STATE_READY = 4;
export const SEALED_STATE_FAILED = 5;
export const SEALED_STATE_REVOKED = 6;
// Reason codes.
export const SEALED_REASON_NONE = 0;
export const SEALED_REASON_BAD_ASSET = 1;
export const SEALED_REASON_BAD_EVENT = 2;
export const SEALED_REASON_BAD_HANDLE = 3;
export const SEALED_REASON_BAD_STATE = 4;
export const SEALED_REASON_BAD_ENVELOPE = 5;
export const SEALED_REASON_NOT_ENTITLED = 6;
export const SEALED_REASON_BAD_REGION = 7;
export const SEALED_REASON_STALE_GENERATION = 8;
export const SEALED_REASON_DUPLICATE = 9;
// Envelope layout constants (gate 1). AES-GCM canonical:
// [IV(12)][Ciphertext(N)][Tag(16)].
export const ENVELOPE_IV_BYTES = 12;
export const ENVELOPE_TAG_BYTES = 16;
export const ENVELOPE_MIN_BYTES = ENVELOPE_IV_BYTES + 1 + ENVELOPE_TAG_BYTES; // 29
// AAD layout (gate 2). 32 bytes, fixed:
//   0..3   eventId u32 LE
//   4..7   assetId u32 LE
//   8..11  version u32 LE
//   12..31 contentHash 20 bytes
export const AAD_BYTES = 32;
export const AAD_HASH_BYTES = 20;
// Sentinels.
export const SEALED_HANDLE_INVALID = -1;
// Sanity caps.
const MAX_ASSETS = 1 << 16;
const MAX_EVENTS = 1 << 14;
const U32_MAX = 0xffffffff;
// Asset record stride for readAsset:
// [state, generation, eventId, version, cdnHash, entitlementMask,
//  regionMask, decryptedByteLength].
export const SEALED_ASSET_RECORD_STRIDE = 8;
export class SealedAssetRegistry {
    maxAssets;
    maxEvents;
    // Per-asset state.
    assetState;
    assetGeneration;
    assetEventId;
    assetVersion;
    assetCdnHash;
    assetEntitlementMask;
    assetRegionMask;
    assetContentHash; // sized maxAssets * AAD_HASH_BYTES
    assetDecryptedByteLength;
    assetTransferred;
    nextAssetSlot = 0;
    // Per-event state.
    eventKeyDisclosed;
    eventEntitlementMask;
    eventRegionMask;
    // Per-cdnHash dedup table - so a client doesn't register the same
    // asset twice. Open-addressed; key 0 means EMPTY.
    cdnDedupKey;
    cdnDedupSlot;
    cdnDedupMask;
    currentTick = 0;
    failuresTotal = 0;
    successesTotal = 0;
    constructor(config) {
        const { maxAssets, maxEvents } = config;
        if (!Number.isInteger(maxAssets) || maxAssets < 1 || maxAssets > MAX_ASSETS) {
            throw new RangeError('SealedAsset: maxAssets out of range, got ' + maxAssets);
        }
        if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > MAX_EVENTS) {
            throw new RangeError('SealedAsset: maxEvents out of range, got ' + maxEvents);
        }
        this.maxAssets = maxAssets;
        this.maxEvents = maxEvents;
        this.assetState = new Uint8Array(maxAssets);
        this.assetGeneration = new Uint8Array(maxAssets);
        this.assetEventId = new Uint32Array(maxAssets);
        this.assetVersion = new Uint32Array(maxAssets);
        this.assetCdnHash = new Uint32Array(maxAssets);
        this.assetEntitlementMask = new Uint32Array(maxAssets);
        this.assetRegionMask = new Uint32Array(maxAssets);
        this.assetContentHash = new Uint8Array(maxAssets * AAD_HASH_BYTES);
        this.assetDecryptedByteLength = new Uint32Array(maxAssets);
        this.assetTransferred = new Uint8Array(maxAssets);
        this.eventKeyDisclosed = new Uint8Array(maxEvents);
        this.eventEntitlementMask = new Uint32Array(maxEvents);
        this.eventRegionMask = new Uint32Array(maxEvents);
        let dedupSize = 1;
        while (dedupSize < maxAssets * 2)
            dedupSize <<= 1;
        this.cdnDedupKey = new Uint32Array(dedupSize);
        this.cdnDedupSlot = new Int32Array(dedupSize).fill(-1);
        this.cdnDedupMask = dedupSize - 1;
    }
    // --- counts ---
    getCurrentTick() { return this.currentTick; }
    getFailuresTotal() { return this.failuresTotal; }
    getSuccessesTotal() { return this.successesTotal; }
    // --- envelope validation (gate 1) ---
    // Returns FLOW_REASON_NONE on a valid envelope buffer; else a
    // reason code. The deferred crypto layer reads
    // (envelope[0..12], envelope[12..-16], envelope[-16..]).
    static validateEnvelope(envelope) {
        if (!envelope || envelope.length < ENVELOPE_MIN_BYTES)
            return SEALED_REASON_BAD_ENVELOPE;
        return SEALED_REASON_NONE;
    }
    // Read the IV out of an envelope (the first ENVELOPE_IV_BYTES).
    static readIV(envelope) {
        if (SealedAssetRegistry.validateEnvelope(envelope) !== SEALED_REASON_NONE)
            return null;
        return envelope.subarray(0, ENVELOPE_IV_BYTES);
    }
    // Read the ciphertext+tag (the bytes the deferred crypto.subtle
    // decrypt consumes). Returns the slice after the IV.
    static readCipherAndTag(envelope) {
        if (SealedAssetRegistry.validateEnvelope(envelope) !== SEALED_REASON_NONE)
            return null;
        return envelope.subarray(ENVELOPE_IV_BYTES);
    }
    // --- AAD construction (gate 2) ---
    // Build the AAD buffer for AES-GCM. The contentHash MUST be exactly
    // AAD_HASH_BYTES long. Returns null on invalid input.
    static buildAAD(eventId, assetId, version, contentHash) {
        if (!Number.isInteger(eventId) || eventId < 0 || eventId > U32_MAX)
            return null;
        if (!Number.isInteger(assetId) || assetId < 0 || assetId > U32_MAX)
            return null;
        if (!Number.isInteger(version) || version < 0 || version > U32_MAX)
            return null;
        if (!contentHash || contentHash.length !== AAD_HASH_BYTES)
            return null;
        const aad = new Uint8Array(AAD_BYTES);
        const view = new DataView(aad.buffer);
        view.setUint32(0, eventId >>> 0, true);
        view.setUint32(4, assetId >>> 0, true);
        view.setUint32(8, version >>> 0, true);
        aad.set(contentHash, 12);
        return aad;
    }
    // --- asset registration (gates 1, 4, 5) ---
    // Register a sealed asset. The eventId must be in range; cdnHash
    // is the opaque CDN identifier; entitlementMask + regionMask
    // restrict who can receive the key. contentHash is bound into
    // the AAD. Returns the asset slot (= handle), or
    // SEALED_HANDLE_INVALID on rejection.
    registerAsset(eventId, version, cdnHash, entitlementMask, regionMask, contentHash) {
        if (!this.requireEvent(eventId))
            return SEALED_HANDLE_INVALID;
        if (!Number.isInteger(version) || version < 0 || version > U32_MAX)
            return SEALED_HANDLE_INVALID;
        if (!Number.isInteger(cdnHash) || cdnHash <= 0 || cdnHash > U32_MAX)
            return SEALED_HANDLE_INVALID;
        if (!Number.isInteger(entitlementMask) || entitlementMask < 0 || entitlementMask > U32_MAX)
            return SEALED_HANDLE_INVALID;
        if (!Number.isInteger(regionMask) || regionMask < 0 || regionMask > U32_MAX)
            return SEALED_HANDLE_INVALID;
        if (!contentHash || contentHash.length !== AAD_HASH_BYTES)
            return SEALED_HANDLE_INVALID;
        // Dedup on cdnHash.
        const existing = this.findCdnSlot(cdnHash);
        if (existing >= 0)
            return SEALED_HANDLE_INVALID; // already registered
        const slot = this.allocAssetSlot();
        if (slot < 0)
            return SEALED_HANDLE_INVALID;
        this.assetState[slot] = SEALED_STATE_SEALED;
        this.assetGeneration[slot] = (((this.assetGeneration[slot] ?? 0) + 1) & 0xff);
        this.assetEventId[slot] = eventId >>> 0;
        this.assetVersion[slot] = version >>> 0;
        this.assetCdnHash[slot] = cdnHash >>> 0;
        this.assetEntitlementMask[slot] = entitlementMask >>> 0;
        this.assetRegionMask[slot] = regionMask >>> 0;
        this.assetContentHash.set(contentHash, slot * AAD_HASH_BYTES);
        this.assetDecryptedByteLength[slot] = 0;
        this.assetTransferred[slot] = 0;
        this.cdnDedupInsert(cdnHash, slot);
        return slot;
    }
    // Find an asset by cdnHash (the lookup the deferred CDN-fetch
    // layer uses to associate a downloaded envelope with its slot).
    findByCdnHash(cdnHash) {
        if (!Number.isInteger(cdnHash) || cdnHash <= 0)
            return SEALED_HANDLE_INVALID;
        return this.findCdnSlot(cdnHash);
    }
    // --- key disclosure (gates 3, 7) ---
    // Disclose the key for an event - the SSE bridge calls this when
    // the server-side trigger fires. Records that the key has been
    // released for this event; the consumer's gate is the disclosure
    // matcher below. Returns FLOW_REASON_NONE on success.
    discloseEventKey(eventId, requiredEntitlementMask, requiredRegionMask) {
        if (!this.requireEvent(eventId))
            return SEALED_REASON_BAD_EVENT;
        if (!Number.isInteger(requiredEntitlementMask) || requiredEntitlementMask < 0
            || requiredEntitlementMask > U32_MAX)
            return SEALED_REASON_BAD_EVENT;
        if (!Number.isInteger(requiredRegionMask) || requiredRegionMask < 0
            || requiredRegionMask > U32_MAX)
            return SEALED_REASON_BAD_EVENT;
        if ((this.eventKeyDisclosed[eventId] ?? 0) === 1)
            return SEALED_REASON_DUPLICATE;
        this.eventKeyDisclosed[eventId] = 1;
        this.eventEntitlementMask[eventId] = requiredEntitlementMask >>> 0;
        this.eventRegionMask[eventId] = requiredRegionMask >>> 0;
        // Move every asset bound to this event from SEALED -> KEY_DISCLOSED.
        for (let s = 0; s < this.maxAssets; s++) {
            if (this.assetState[s] === SEALED_STATE_SEALED && this.assetEventId[s] === (eventId >>> 0)) {
                this.assetState[s] = SEALED_STATE_KEY_DISCLOSED;
                this.assetGeneration[s] = (((this.assetGeneration[s] ?? 0) + 1) & 0xff);
            }
        }
        return SEALED_REASON_NONE;
    }
    // Check whether a client with the given (entitlement, region) masks
    // is allowed to receive the key for the given event. Returns true
    // iff: the event has been disclosed AND the client masks intersect
    // BOTH the event's required masks AND the asset's required masks.
    // The deferred SSE transport calls this before delivering the key.
    isClientEntitledToEvent(eventId, clientEntitlementMask, clientRegionMask) {
        if (!this.requireEvent(eventId))
            return false;
        if ((this.eventKeyDisclosed[eventId] ?? 0) !== 1)
            return false;
        if (!Number.isInteger(clientEntitlementMask) || clientEntitlementMask < 0)
            return false;
        if (!Number.isInteger(clientRegionMask) || clientRegionMask < 0)
            return false;
        const entReq = this.eventEntitlementMask[eventId] ?? 0;
        const regReq = this.eventRegionMask[eventId] ?? 0;
        if ((entReq >>> 0) !== 0 && (((clientEntitlementMask >>> 0) & entReq) === 0))
            return false;
        if ((regReq >>> 0) !== 0 && (((clientRegionMask >>> 0) & regReq) === 0))
            return false;
        return true;
    }
    // Returns true if the key for `eventId` has been disclosed (and
    // therefore secrecy has ENDED for assets bound to this event).
    // Documented gate-7 acknowledgement.
    getSecrecyEndedFlag(eventId) {
        if (!this.requireEvent(eventId))
            return false;
        return (this.eventKeyDisclosed[eventId] ?? 0) === 1;
    }
    // --- decrypt lifecycle (gate 4) ---
    // Begin a decrypt. Transitions KEY_DISCLOSED -> DECRYPTING; bumps
    // the generation. Returns FLOW_REASON_NONE on accept. The
    // deferred WebCrypto call is the integration layer.
    beginDecrypt(handle) {
        if (!this.requireAssetSlot(handle))
            return SEALED_REASON_BAD_HANDLE;
        if (this.assetState[handle] !== SEALED_STATE_KEY_DISCLOSED)
            return SEALED_REASON_BAD_STATE;
        this.assetState[handle] = SEALED_STATE_DECRYPTING;
        this.assetGeneration[handle] = (((this.assetGeneration[handle] ?? 0) + 1) & 0xff);
        return SEALED_REASON_NONE;
    }
    // Complete a decrypt successfully. Generation must match (the
    // caller captured it from beginDecrypt). transferred = true
    // means the consumer used postMessage transferable-objects path
    // (gate 6); the kernel records the byte count + transferred flag.
    // The actual bytes live in the consumer's main-thread arena.
    completeDecrypt(handle, generation, decryptedByteLength, transferred) {
        if (!this.requireAssetSlot(handle))
            return SEALED_REASON_BAD_HANDLE;
        if ((this.assetGeneration[handle] ?? 0) !== (generation & 0xff))
            return SEALED_REASON_STALE_GENERATION;
        if (this.assetState[handle] !== SEALED_STATE_DECRYPTING)
            return SEALED_REASON_BAD_STATE;
        if (!Number.isInteger(decryptedByteLength) || decryptedByteLength < 0
            || decryptedByteLength > U32_MAX)
            return SEALED_REASON_BAD_ENVELOPE;
        this.assetState[handle] = SEALED_STATE_READY;
        this.assetGeneration[handle] = (((this.assetGeneration[handle] ?? 0) + 1) & 0xff);
        this.assetDecryptedByteLength[handle] = decryptedByteLength >>> 0;
        this.assetTransferred[handle] = transferred ? 1 : 0;
        this.successesTotal++;
        return SEALED_REASON_NONE;
    }
    // Mark a decrypt as failed (bad envelope, bad key, AAD mismatch).
    // Bumps generation and moves to FAILED. Generation check enforces
    // freshness. The consumer can re-fetch the envelope and try again
    // (registering a new asset slot).
    failDecrypt(handle, generation) {
        if (!this.requireAssetSlot(handle))
            return SEALED_REASON_BAD_HANDLE;
        if ((this.assetGeneration[handle] ?? 0) !== (generation & 0xff))
            return SEALED_REASON_STALE_GENERATION;
        if (this.assetState[handle] !== SEALED_STATE_DECRYPTING)
            return SEALED_REASON_BAD_STATE;
        this.assetState[handle] = SEALED_STATE_FAILED;
        this.assetGeneration[handle] = (((this.assetGeneration[handle] ?? 0) + 1) & 0xff);
        this.failuresTotal++;
        return SEALED_REASON_NONE;
    }
    // Manually revoke an asset (e.g. content removed by moderation).
    revokeAsset(handle) {
        if (!this.requireAssetSlot(handle))
            return SEALED_REASON_BAD_HANDLE;
        const state = this.assetState[handle] ?? 0;
        if (state === SEALED_STATE_NONE)
            return SEALED_REASON_BAD_STATE;
        this.assetState[handle] = SEALED_STATE_REVOKED;
        this.assetGeneration[handle] = (((this.assetGeneration[handle] ?? 0) + 1) & 0xff);
        return SEALED_REASON_NONE;
    }
    // --- read ---
    // Read an asset record into out[0..8].
    readAsset(handle, out, outOffset = 0) {
        if (!this.requireAssetSlot(handle))
            return false;
        if (outOffset < 0 || outOffset + SEALED_ASSET_RECORD_STRIDE > out.length)
            return false;
        out[outOffset + 0] = this.assetState[handle] ?? 0;
        out[outOffset + 1] = this.assetGeneration[handle] ?? 0;
        out[outOffset + 2] = this.assetEventId[handle] ?? 0;
        out[outOffset + 3] = this.assetVersion[handle] ?? 0;
        out[outOffset + 4] = this.assetCdnHash[handle] ?? 0;
        out[outOffset + 5] = this.assetEntitlementMask[handle] ?? 0;
        out[outOffset + 6] = this.assetRegionMask[handle] ?? 0;
        out[outOffset + 7] = this.assetDecryptedByteLength[handle] ?? 0;
        return true;
    }
    // Read an asset's contentHash into out[0..AAD_HASH_BYTES].
    readContentHash(handle, out) {
        if (!this.requireAssetSlot(handle))
            return false;
        if (out.length < AAD_HASH_BYTES)
            return false;
        const base = handle * AAD_HASH_BYTES;
        for (let i = 0; i < AAD_HASH_BYTES; i++)
            out[i] = this.assetContentHash[base + i] ?? 0;
        return true;
    }
    getAssetState(handle) {
        if (!this.requireAssetSlot(handle))
            return SEALED_STATE_NONE;
        return this.assetState[handle] ?? SEALED_STATE_NONE;
    }
    getAssetGeneration(handle) {
        if (!this.requireAssetSlot(handle))
            return 0;
        return this.assetGeneration[handle] ?? 0;
    }
    // --- helpers ---
    requireEvent(e) {
        return Number.isInteger(e) && e >= 0 && e < this.maxEvents;
    }
    requireAssetSlot(s) {
        return Number.isInteger(s) && s >= 0 && s < this.maxAssets;
    }
    allocAssetSlot() {
        const start = this.nextAssetSlot;
        for (let probe = 0; probe < this.maxAssets; probe++) {
            const slot = (start + probe) % this.maxAssets;
            const state = this.assetState[slot] ?? 0;
            // Reuse FREE / REVOKED slots; FAILED stays so the consumer
            // can read its diagnostic state until they explicitly revoke.
            if (state === SEALED_STATE_NONE || state === SEALED_STATE_REVOKED) {
                this.nextAssetSlot = (slot + 1) % this.maxAssets;
                return slot;
            }
        }
        return -1;
    }
    findCdnSlot(cdnHash) {
        let h = cdnHash >>> 0;
        h ^= h >>> 16;
        h = Math.imul(h, 0x85ebca6b);
        h ^= h >>> 13;
        h = Math.imul(h, 0xc2b2ae35);
        h ^= h >>> 16;
        h = h >>> 0;
        for (let probe = 0; probe < this.cdnDedupKey.length; probe++) {
            const slot = (h + probe) & this.cdnDedupMask;
            const k = this.cdnDedupKey[slot] ?? 0;
            if (k === 0)
                return -1;
            if (k === (cdnHash >>> 0))
                return this.cdnDedupSlot[slot] ?? -1;
        }
        return -1;
    }
    cdnDedupInsert(cdnHash, slot) {
        let h = cdnHash >>> 0;
        h ^= h >>> 16;
        h = Math.imul(h, 0x85ebca6b);
        h ^= h >>> 13;
        h = Math.imul(h, 0xc2b2ae35);
        h ^= h >>> 16;
        h = h >>> 0;
        for (let probe = 0; probe < this.cdnDedupKey.length; probe++) {
            const s = (h + probe) & this.cdnDedupMask;
            if ((this.cdnDedupKey[s] ?? 0) === 0) {
                this.cdnDedupKey[s] = cdnHash >>> 0;
                this.cdnDedupSlot[s] = slot | 0;
                return;
            }
        }
    }
    tick(t) {
        if (!Number.isInteger(t) || t < 0 || t > U32_MAX) {
            throw new RangeError('SealedAsset.tick: t must be a u32, got ' + t);
        }
        this.currentTick = t | 0;
    }
    // --- lifecycle ---
    clear() {
        this.assetState.fill(0);
        this.assetGeneration.fill(0);
        this.assetEventId.fill(0);
        this.assetVersion.fill(0);
        this.assetCdnHash.fill(0);
        this.assetEntitlementMask.fill(0);
        this.assetRegionMask.fill(0);
        this.assetContentHash.fill(0);
        this.assetDecryptedByteLength.fill(0);
        this.assetTransferred.fill(0);
        this.eventKeyDisclosed.fill(0);
        this.eventEntitlementMask.fill(0);
        this.eventRegionMask.fill(0);
        this.cdnDedupKey.fill(0);
        this.cdnDedupSlot.fill(-1);
        this.failuresTotal = 0;
        this.successesTotal = 0;
        this.nextAssetSlot = 0;
    }
}
//# sourceMappingURL=sealed-asset.js.map