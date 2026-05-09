// WorldSeed - Wave 1.6 procgen MILESTONE.
//
// 1.6.5 CAPSTONE primitive (Wave 1.6 procgen depth milestone).
// THE orchestrator: a single seed string deterministically
// reproduces an entire world. Stitches all five Wave 1.6 enabling
// primitives + NameGenerator (1.6.0) + NoiseField (1.6.1) +
// VoronoiPartition (1.6.2) + DungeonGenerator (1.6.3) +
// BiomeMixer (1.6.4) + the corpus generators into one call:
//
//   var ws = WorldSeed.create({ seed: 'lastlight-omega' });
//   var world = ws.generateWorld({
//     width: 256, height: 256,
//     regionCount: 24,
//     dungeonCount: 5,
//   });
//   // world.worldName    -> 'Mireth'
//   // world.regions[i]   -> { id, name, centerX, centerY }
//   // world.dungeons[i]  -> { id, name, regionId, placement, layout }
//   // world.elevation    -> Float32Array of width*height samples
//   // world.moisture     -> Float32Array of width*height samples
//   // world.biomeId      -> Uint16Array; index into world.biomeNames
//   // world.regionId     -> Uint16Array; index into world.regions
//
// Same seed + same options => identical world, every byte. The
// deterministic chain: WorldSeed derives sub-seeds from the
// master seed via FNV-1a for each primitive's seed parameter, so
// each primitive is independently seeded but the whole world is
// reproducible. JSON-serializable result.
//
// Closes Wave 1.6 procgen. Pairs with TileMap (0.57, render the
// generated grid), RegionGraph (1.2.1, walk regions as a graph),
// AggroTable (0.78, place encounters per region). Could be threaded
// through SpawnDirector + EncounterTable for a fully procedural
// /arpg-loom Crypt or a brand-new procgen zone.
//
// Code style: var-only in browser source.

import { NameGenerator } from './name-generator.js';
import { NoiseField } from './noise-field.js';
import { VoronoiPartition } from './voronoi-partition.js';
import { DungeonGenerator } from './dungeon-generator.js';
import type { DungeonResult } from './dungeon-generator.js';
import { BiomeMixer } from './biome-mixer.js';

export interface WorldSeedOptions {
  // Master seed. All sub-seeds for sub-primitives derive from this.
  // Required and must be a non-empty string for deterministic
  // cross-platform behavior. Numeric seeds also accepted.
  seed: string | number;
  // Optional name corpus override. Default: 'mythic' baked-in list.
  nameCorpus?: string[];
}

export interface GenerateWorldOptions {
  // World dimensions in cells. Required.
  width: number;
  height: number;
  // Number of Voronoi regions. Default 16.
  regionCount?: number;
  // Number of dungeons (placed near region centers). Default 0.
  dungeonCount?: number;
  // Dungeon footprint (in cells). Default 32 x 24 each.
  dungeonWidth?: number;
  dungeonHeight?: number;
  // Optional biome overrides. Default: standard 7-biome Whittaker.
  biomes?: BiomeSpecLike[];
  // Elevation / moisture noise tuning.
  elevationScale?: number;
  moistureScale?: number;
  octaves?: number;
}

export interface BiomeSpecLike {
  id: string;
  minElev?: number; maxElev?: number;
  minMoist?: number; maxMoist?: number;
}

export interface WorldRegion {
  id: number;
  name: string;
  centerX: number;
  centerY: number;
}

export interface WorldDungeon {
  id: number;
  name: string;
  regionId: number;
  placement: { x: number; y: number; w: number; h: number };
  layout: DungeonResult;
}

export interface WorldSeedSnapshot {
  seed: string;
  worldName: string;
  width: number;
  height: number;
  // Per-cell scalar fields. Length = width * height.
  elevation: Float32Array;
  moisture: Float32Array;
  biomeId: Uint16Array;
  regionId: Uint16Array;
  // Biome lookup (id -> name).
  biomeNames: string[];
  regions: WorldRegion[];
  dungeons: WorldDungeon[];
}

// Default name corpus - mythic / fantasy flavored. Used to seed
// NameGenerator for world / region / dungeon names. Cleanly
// licensed (handcrafted; no copy from any IP).
const DEFAULT_CORPUS: string[] = [
  'Aelaria', 'Bryn', 'Caelum', 'Dorian', 'Elias',
  'Faelan', 'Gareth', 'Halwin', 'Ithil', 'Joren',
  'Kael', 'Liora', 'Mira', 'Naoise', 'Orin',
  'Perrin', 'Quill', 'Rowan', 'Soren', 'Talia',
  'Umara', 'Veska', 'Wren', 'Xanthe', 'Yorin', 'Zara',
  'Mireth', 'Solven', 'Tirel', 'Belash', 'Ondri',
  'Kaeren', 'Vellan', 'Auren', 'Lirath', 'Sennin',
  'Drevenir', 'Elowen', 'Halmar', 'Inthe', 'Joran',
];

// Default Whittaker biome rules - 7 biomes covering elevation
// [-1, 1] x moisture [0, 1] without gaps.
const DEFAULT_BIOMES: BiomeSpecLike[] = [
  { id: 'ocean',     minElev: -1,    maxElev: -0.2 },
  { id: 'beach',     minElev: -0.2,  maxElev: 0 },
  { id: 'desert',    minElev:  0,    maxElev: 0.5,
    minMoist: 0,     maxMoist: 0.3 },
  { id: 'grassland', minElev:  0,    maxElev: 0.5,
    minMoist: 0.3,   maxMoist: 0.7 },
  { id: 'forest',    minElev:  0,    maxElev: 0.6,
    minMoist: 0.7,   maxMoist: 1 },
  { id: 'mountain',  minElev:  0.5,  maxElev: 0.85 },
  { id: 'snow',      minElev:  0.85, maxElev: 1 },
];

function fnv1a(s: string): number {
  var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function deriveSeed(masterSeed: string, salt: string): string {
  return masterSeed + ':' + salt;
}

function masterToString(seed: string | number): string {
  if (typeof seed === 'number') return 'n:' + (seed >>> 0).toString(16);
  if (typeof seed === 'string' && seed.length > 0) return seed;
  return 'world-seed-default';
}

export class WorldSeed {
  private masterSeed: string;
  private corpus: string[];

  private constructor(opts: WorldSeedOptions) {
    this.masterSeed = masterToString(opts.seed);
    this.corpus = (opts.nameCorpus && opts.nameCorpus.length > 0)
      ? opts.nameCorpus.slice()
      : DEFAULT_CORPUS.slice();
  }

  static create(opts: WorldSeedOptions): WorldSeed {
    return new WorldSeed(opts);
  }

  generateWorld(opts: GenerateWorldOptions): WorldSeedSnapshot {
    if (!(opts.width > 0)) throw new Error('WorldSeed: width must be > 0');
    if (!(opts.height > 0)) throw new Error('WorldSeed: height must be > 0');

    var width = opts.width | 0;
    var height = opts.height | 0;
    var regionCount = (typeof opts.regionCount === 'number' && opts.regionCount > 0)
      ? (opts.regionCount | 0) : 16;
    var dungeonCount = (typeof opts.dungeonCount === 'number' && opts.dungeonCount >= 0)
      ? (opts.dungeonCount | 0) : 0;
    var dungeonW = (typeof opts.dungeonWidth === 'number' && opts.dungeonWidth >= 8)
      ? (opts.dungeonWidth | 0) : 32;
    var dungeonH = (typeof opts.dungeonHeight === 'number' && opts.dungeonHeight >= 8)
      ? (opts.dungeonHeight | 0) : 24;
    var elevationScale = (typeof opts.elevationScale === 'number' && opts.elevationScale > 0)
      ? opts.elevationScale : 0.04;
    var moistureScale = (typeof opts.moistureScale === 'number' && opts.moistureScale > 0)
      ? opts.moistureScale : 0.06;
    var octaves = (typeof opts.octaves === 'number' && opts.octaves > 0)
      ? (opts.octaves | 0) : 4;
    var biomeSpecs = (opts.biomes && opts.biomes.length > 0)
      ? opts.biomes : DEFAULT_BIOMES;

    // ---- 1. Name generator (world + regions + dungeons) ----
    var ng = NameGenerator.create({
      seed: deriveSeed(this.masterSeed, 'name'),
      order: 2,
    });
    ng.train(this.corpus);
    var worldName = ng.generate({ minLen: 4, maxLen: 9 }) || 'Unnamed';

    // ---- 2. Voronoi region partition ----
    var voronoi = VoronoiPartition.create({
      seed: deriveSeed(this.masterSeed, 'voronoi'),
      width: width, height: height,
      count: regionCount,
    });

    // ---- 3. Elevation + moisture noise fields ----
    var elev = NoiseField.create({
      seed: deriveSeed(this.masterSeed, 'elevation'),
      octaves: octaves,
      scale: elevationScale,
    });
    var moist = NoiseField.create({
      seed: deriveSeed(this.masterSeed, 'moisture'),
      octaves: octaves,
      scale: moistureScale,
    });

    // ---- 4. Biome classifier ----
    var bm = BiomeMixer.create();
    var biomeNames: string[] = [];
    for (var i = 0; i < biomeSpecs.length; i++) {
      var b = biomeSpecs[i] as BiomeSpecLike;
      // Build the BiomeSpec without undefined keys (exactOptionalPropertyTypes
      // disallows passing undefined for optional fields).
      var spec: { id: string; minElev?: number; maxElev?: number;
                  minMoist?: number; maxMoist?: number } = { id: b.id };
      if (b.minElev !== undefined)  spec.minElev = b.minElev;
      if (b.maxElev !== undefined)  spec.maxElev = b.maxElev;
      if (b.minMoist !== undefined) spec.minMoist = b.minMoist;
      if (b.maxMoist !== undefined) spec.maxMoist = b.maxMoist;
      bm.defineBiome(spec);
      biomeNames.push(b.id);
    }
    var fallback = biomeNames.length > 0 ? biomeNames[0] : null;
    if (fallback) bm.setFallback(fallback);

    // ---- 5. Walk every cell, fill scalar fields + biome + region ----
    var elevArr = new Float32Array(width * height);
    var moistArr = new Float32Array(width * height);
    var biomeIdArr = new Uint16Array(width * height);
    var regionIdArr = new Uint16Array(width * height);

    var biomeIndexById: Record<string, number> = {};
    for (var k = 0; k < biomeNames.length; k++) {
      biomeIndexById[biomeNames[k] as string] = k;
    }

    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var idx = y * width + x;
        var e = elev.sample(x, y);
        var m = moist.sample01(x, y);
        elevArr[idx] = e;
        moistArr[idx] = m;
        var biomeId = bm.classify(e, m) || fallback || '';
        var biomeIdx = biomeIndexById[biomeId];
        biomeIdArr[idx] = (biomeIdx !== undefined) ? biomeIdx : 0;
        var rid = voronoi.nearestSite(x, y);
        regionIdArr[idx] = rid >= 0 ? rid : 0;
      }
    }

    // ---- 6. Region records (named) ----
    var sites = voronoi.sites();
    var regions: WorldRegion[] = [];
    for (var ri = 0; ri < sites.length; ri++) {
      var site = sites[ri];
      if (!site) continue;
      regions.push({
        id: site.id,
        name: ng.generate({ minLen: 4, maxLen: 9 }) || ('Region-' + site.id),
        centerX: site.x,
        centerY: site.y,
      });
    }

    // ---- 7. Dungeons (placed near random region centers) ----
    var dungeons: WorldDungeon[] = [];
    if (dungeonCount > 0 && regions.length > 0) {
      // Deterministic dungeon-region picks via a tiny RNG seeded from master.
      var dungRng = mulberry32FromString(deriveSeed(this.masterSeed, 'dungeon-pick'));
      for (var di = 0; di < dungeonCount; di++) {
        var pickIdx = Math.floor(dungRng() * regions.length);
        var region = regions[pickIdx] as WorldRegion;
        var dgPlace = {
          x: Math.max(0, Math.min(width - dungeonW,  Math.floor(region.centerX - dungeonW / 2))),
          y: Math.max(0, Math.min(height - dungeonH, Math.floor(region.centerY - dungeonH / 2))),
          w: dungeonW, h: dungeonH,
        };
        var dg = DungeonGenerator.create({
          seed: deriveSeed(this.masterSeed, 'dungeon-' + di),
          width: dungeonW, height: dungeonH,
        });
        var layout = dg.generate();
        dungeons.push({
          id: di,
          name: ng.generate({ minLen: 4, maxLen: 9 }) || ('Dungeon-' + di),
          regionId: region.id,
          placement: dgPlace,
          layout: layout,
        });
      }
    }

    return {
      seed: this.masterSeed,
      worldName: worldName,
      width: width,
      height: height,
      elevation: elevArr,
      moisture: moistArr,
      biomeId: biomeIdArr,
      regionId: regionIdArr,
      biomeNames: biomeNames,
      regions: regions,
      dungeons: dungeons,
    };
  }

  // Read-only diagnostics.
  getMasterSeed(): string { return this.masterSeed; }
  getCorpusSize(): number { return this.corpus.length; }
}

function mulberry32FromString(seed: string): () => number {
  var t = fnv1a(seed) >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    var x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Resource key for the world's resource registry.
export const RESOURCE_WORLD_SEED = 'world_seed';
