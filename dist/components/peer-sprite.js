// PeerSpritePool - per-peer rendering hints (atlas, frame, tint,
// optional name label) keyed by character_id rather than by EntityId.
//
// Peers don't get a stable EntityId because they appear and disappear
// based on network presence, not gameplay state. The PeerPresenceSystem
// resolves a peer's interpolated (x, y) from PeerPool each frame and
// draws via this pool's per-peer atlas/frame.
//
// Default style: unspecified peers render with a fallback atlas/frame
// supplied at pool construction. That keeps single-line setup simple
// for the demo while still allowing per-peer customization (cosmetic
// shards, visible class, etc.) once the dev wants to differentiate.
export class PeerSpritePool {
    defaultEntry;
    overrides = new Map();
    constructor(opts) {
        this.defaultEntry = {
            atlas: opts.defaultAtlas,
            frame: opts.defaultFrame ?? 0,
            tint: opts.defaultTint ?? null,
        };
    }
    // Per-peer override. Apply once on join (e.g. after a server-emitted
    // class hint) and forget; the pool keeps it until clear() / removed
    // explicitly.
    setOverride(characterId, entry) {
        this.overrides.set(characterId, entry);
    }
    removeOverride(characterId) {
        this.overrides.delete(characterId);
    }
    // Resolve the rendering entry for a peer. Returns the override if
    // one exists, otherwise the default. Never null for a known peer.
    resolve(characterId) {
        return this.overrides.get(characterId) ?? this.defaultEntry;
    }
    getDefault() {
        return this.defaultEntry;
    }
    hasOverride(characterId) {
        return this.overrides.has(characterId);
    }
    clear() {
        this.overrides.clear();
    }
}
export const POOL_PEER_SPRITE = 'peer_sprite';
//# sourceMappingURL=peer-sprite.js.map