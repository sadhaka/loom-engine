import type { Vec2, Vec3 } from '../util/math.js';
export declare const ISO_TILE_WIDTH: number;
export declare const ISO_TILE_HEIGHT: number;
export declare const ISO_HALF_W: number;
export declare const ISO_HALF_H: number;
export declare const ISO_Z_SCALE: number;
export declare function tileToIso(tileX: number, tileY: number, out: Vec2): Vec2;
export declare function worldToIso(world: Vec3, out: Vec2): Vec2;
export declare function isoToTile(isoX: number, isoY: number, out: Vec2): Vec2;
export declare function isoDepthKey(world: Vec3): number;
//# sourceMappingURL=iso-projection.d.ts.map