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

import type { AtlasHandle } from '../renderer/graphics-device.js';
import type { ColorRGBA } from '../util/color.js';

export interface PeerSpriteEntry {
  atlas: AtlasHandle;
  frame: number;
  tint: Readonly<ColorRGBA> | null;
}

export interface PeerSpritePoolOptions {
  // Fallback atlas+frame used when a peer has no explicit override.
  defaultAtlas: AtlasHandle;
  defaultFrame?: number;
  defaultTint?: Readonly<ColorRGBA>;
}

export class PeerSpritePool {
  private readonly defaultEntry: PeerSpriteEntry;
  private overrides: Map<string, PeerSpriteEntry> = new Map();

  constructor(opts: PeerSpritePoolOptions) {
    this.defaultEntry = {
      atlas: opts.defaultAtlas,
      frame: opts.defaultFrame ?? 0,
      tint: opts.defaultTint ?? null,
    };
  }

  // Per-peer override. Apply once on join (e.g. after a server-emitted
  // class hint) and forget; the pool keeps it until clear() / removed
  // explicitly.
  setOverride(characterId: string, entry: PeerSpriteEntry): void {
    this.overrides.set(characterId, entry);
  }

  removeOverride(characterId: string): void {
    this.overrides.delete(characterId);
  }

  // Resolve the rendering entry for a peer. Returns the override if
  // one exists, otherwise the default. Never null for a known peer.
  resolve(characterId: string): Readonly<PeerSpriteEntry> {
    return this.overrides.get(characterId) ?? this.defaultEntry;
  }

  getDefault(): Readonly<PeerSpriteEntry> {
    return this.defaultEntry;
  }

  hasOverride(characterId: string): boolean {
    return this.overrides.has(characterId);
  }

  clear(): void {
    this.overrides.clear();
  }
}

export const POOL_PEER_SPRITE = 'peer_sprite';
