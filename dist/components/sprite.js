// SpritePool - per-entity sprite appearance data.
//
// Companion to TransformPool: an entity that has both Transform
// (position) and Sprite (atlas + frame + tint) gets rendered by
// the SpriteRenderSystem.
//
// Stored as parallel arrays indexed by entity index, mirroring
// TransformPool's structure-of-arrays layout. Atlas + frame are
// tightly packed. Tint is split into rgba arrays so iteration
// stays cache-friendly.
import { growF32, growI32, growU8, nextPow2 } from '../util/typed-arrays.js';
import { entityIndex } from '../entity.js';
export const SPRITE_FLAG_ACTIVE = 1 << 0;
export const SPRITE_FLAG_TINTED = 1 << 1;
export class SpritePool {
    // Hot data
    atlas; // -1 = no sprite assigned (pair with flags ACTIVE bit)
    frame;
    tintR;
    tintG;
    tintB;
    tintA;
    // Cold data
    flags;
    highWaterMark = 0;
    capacity = 0;
    constructor(initialCapacity = 64) {
        this.capacity = nextPow2(initialCapacity);
        this.atlas = new Int32Array(this.capacity).fill(-1);
        this.frame = new Int32Array(this.capacity);
        this.tintR = new Float32Array(this.capacity);
        this.tintG = new Float32Array(this.capacity);
        this.tintB = new Float32Array(this.capacity);
        this.tintA = new Float32Array(this.capacity);
        this.flags = new Uint8Array(this.capacity);
    }
    ensureCapacity(neededIndex) {
        if (neededIndex < this.capacity)
            return;
        const next = nextPow2(neededIndex + 1);
        const newAtlas = new Int32Array(next).fill(-1);
        newAtlas.set(this.atlas);
        this.atlas = newAtlas;
        this.frame = growI32(this.frame, next);
        this.tintR = growF32(this.tintR, next);
        this.tintG = growF32(this.tintG, next);
        this.tintB = growF32(this.tintB, next);
        this.tintA = growF32(this.tintA, next);
        this.flags = growU8(this.flags, next);
        this.capacity = next;
    }
    attach(e, atlas, frame = 0, tint) {
        const i = entityIndex(e);
        this.ensureCapacity(i);
        this.atlas[i] = atlas;
        this.frame[i] = frame;
        if (tint) {
            this.tintR[i] = tint.r;
            this.tintG[i] = tint.g;
            this.tintB[i] = tint.b;
            this.tintA[i] = tint.a;
            this.flags[i] = SPRITE_FLAG_ACTIVE | SPRITE_FLAG_TINTED;
        }
        else {
            this.tintR[i] = 1;
            this.tintG[i] = 1;
            this.tintB[i] = 1;
            this.tintA[i] = 1;
            this.flags[i] = SPRITE_FLAG_ACTIVE;
        }
        if (i >= this.highWaterMark)
            this.highWaterMark = i + 1;
    }
    detach(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return;
        this.atlas[i] = -1;
        this.flags[i] = 0;
    }
    setFrame(e, frame) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return;
        this.frame[i] = frame;
    }
    setTint(e, tint) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return;
        this.tintR[i] = tint.r;
        this.tintG[i] = tint.g;
        this.tintB[i] = tint.b;
        this.tintA[i] = tint.a;
        const f = this.flags[i] ?? 0;
        this.flags[i] = f | SPRITE_FLAG_TINTED;
    }
    clearTint(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return;
        this.tintR[i] = 1;
        this.tintG[i] = 1;
        this.tintB[i] = 1;
        this.tintA[i] = 1;
        const f = this.flags[i] ?? 0;
        this.flags[i] = f & ~SPRITE_FLAG_TINTED;
    }
    isActive(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return false;
        return ((this.flags[i] ?? 0) & SPRITE_FLAG_ACTIVE) !== 0;
    }
    getHighWaterMark() {
        return this.highWaterMark;
    }
    getCapacity() {
        return this.capacity;
    }
}
//# sourceMappingURL=sprite.js.map