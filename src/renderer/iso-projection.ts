// Isometric projection for the Loom Engine.
//
// Standard 2:1 dimetric projection. Tile width:height = 2:1. World
// coords use (x, y) on the tile grid; iso transform produces screen
// (sx, sy) where sx = (x - y) * (TILE_W/2), sy = (x + y) * (TILE_H/2).
//
// This is a public-domain technique - 1980s arcade games (Q*bert),
// 1990s ARPGs (Diablo, Baldur's Gate). See PRIOR-ART.md for the
// citation. We add a Z component to each entity (world height for
// flying / floating sprites + iso-grid depth sort) but Z does not
// affect the screen Y projection beyond a fixed offset.

import type { Vec2, Vec3 } from '../util/math.js';

// Iso tile dimensions in pixels at zoom = 1. Pure 2:1 dimetric.
// These are engine constants for v1; future zoom levels scale them
// uniformly.
export const ISO_TILE_WIDTH: number = 64;
export const ISO_TILE_HEIGHT: number = 32;
export const ISO_HALF_W: number = ISO_TILE_WIDTH / 2;
export const ISO_HALF_H: number = ISO_TILE_HEIGHT / 2;
// Z (height above ground) -> screen-space Y offset. 1 world unit of
// height = ISO_Z_SCALE pixels of vertical lift.
export const ISO_Z_SCALE: number = 16;

// World tile coords -> iso screen-space (before camera transform).
// y increases southward in world space; iso shifts that to lower-
// right in screen space.
export function tileToIso(tileX: number, tileY: number, out: Vec2): Vec2 {
  out.x = (tileX - tileY) * ISO_HALF_W;
  out.y = (tileX + tileY) * ISO_HALF_H;
  return out;
}

// Continuous world-space coords (sub-tile precision) -> iso screen-
// space. Same formula, no rounding.
export function worldToIso(world: Vec3, out: Vec2): Vec2 {
  out.x = (world.x - world.y) * ISO_HALF_W;
  out.y = (world.x + world.y) * ISO_HALF_H - world.z * ISO_Z_SCALE;
  return out;
}

// Iso screen-space -> world tile coords (inverse projection). Used
// for cursor-to-tile picking.
export function isoToTile(isoX: number, isoY: number, out: Vec2): Vec2 {
  // Solve the 2x2 system:
  //   isoX = (x - y) * HALF_W
  //   isoY = (x + y) * HALF_H
  // -> x = isoX/(2*HALF_W) + isoY/(2*HALF_H)
  // -> y = isoY/(2*HALF_H) - isoX/(2*HALF_W)
  const a = isoX / (2 * ISO_HALF_W);
  const b = isoY / (2 * ISO_HALF_H);
  out.x = a + b;
  out.y = b - a;
  return out;
}

// Depth-sort key for iso rendering. Lower = drawn first (back).
// Uses world (x + y) as the diagonal sort axis. Z (height) breaks
// ties so taller objects of the same diagonal draw later (front).
//
// Inspired by standard iso-game depth sorting; see PRIOR-ART.md.
export function isoDepthKey(world: Vec3): number {
  return (world.x + world.y) * 1000 + world.z;
}
