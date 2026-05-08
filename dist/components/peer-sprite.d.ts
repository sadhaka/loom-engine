import type { AtlasHandle } from '../renderer/graphics-device.js';
import type { ColorRGBA } from '../util/color.js';
export interface PeerSpriteEntry {
    atlas: AtlasHandle;
    frame: number;
    tint: Readonly<ColorRGBA> | null;
}
export interface PeerSpritePoolOptions {
    defaultAtlas: AtlasHandle;
    defaultFrame?: number;
    defaultTint?: Readonly<ColorRGBA>;
}
export declare class PeerSpritePool {
    private readonly defaultEntry;
    private overrides;
    constructor(opts: PeerSpritePoolOptions);
    setOverride(characterId: string, entry: PeerSpriteEntry): void;
    removeOverride(characterId: string): void;
    resolve(characterId: string): Readonly<PeerSpriteEntry>;
    getDefault(): Readonly<PeerSpriteEntry>;
    hasOverride(characterId: string): boolean;
    clear(): void;
}
export declare const POOL_PEER_SPRITE = "peer_sprite";
//# sourceMappingURL=peer-sprite.d.ts.map