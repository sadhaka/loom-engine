// VoronoiPartition - 2D Voronoi region partitioning.
//
// 1.6.2 enabling primitive (Wave 1.6 procgen depth). Pick N seed
// points in a rectangle; for any (x, y) in that rectangle, the
// "site" is whichever seed is nearest. Result is a tiling of the
// rectangle into N polygonal regions. Standard pattern for region
// boundaries, biome borders, district maps, fault lines, anything
// that needs "the world is divided into N areas around these
// points."
//
//   var v = VoronoiPartition.create({
//     seed: 'world-42',
//     width: 1024, height: 768,
//     count: 32,             // 32 sites
//     distance: 'euclidean',  // 'euclidean' | 'manhattan' | 'chebyshev'
//   });
//   var siteId = v.nearestSite(450, 380);  // -> 12 (or whichever)
//   var sites  = v.sites();                 // -> 32 { id, x, y } records
//
// Brute-force nearest-site lookup. O(N) per query - fine for the
// 32-128 site range typical for region maps; if N grows past ~500
// add a kd-tree elsewhere.
//
// Pairs with NameGenerator (1.6.0, name each region), NoiseField
// (1.6.1, blend region with terrain), DungeonGenerator (1.6.3 next),
// BiomeMixer (1.6.4), WorldSeed (1.6.5 milestone).
//
// Code style: var-only in browser source.

export type DistanceFn = 'euclidean' | 'manhattan' | 'chebyshev';

export interface VoronoiSite {
  id: number;
  x: number;
  y: number;
}

export interface VoronoiOptions {
  // Seed for the deterministic site placement. Default 'voronoi-seed'.
  seed?: number | string;
  // Bounding box. Required.
  width: number;
  height: number;
  // Number of sites. Required, > 0.
  count: number;
  // Distance metric. Default 'euclidean'.
  distance?: DistanceFn;
  // Optional explicit site list (overrides random placement).
  sites?: ReadonlyArray<{ x: number; y: number }>;
}

function fnv1a(s: string): number {
  var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  var t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    var x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveSeed(seed: number | string | undefined): number {
  if (typeof seed === 'number' && isFinite(seed)) return seed >>> 0;
  if (typeof seed === 'string' && seed.length > 0) return fnv1a(seed);
  return fnv1a('voronoi-seed');
}

export class VoronoiPartition {
  private width: number;
  private height: number;
  private siteList: VoronoiSite[];
  private distance: DistanceFn;

  private constructor(opts: VoronoiOptions) {
    if (!(opts.width > 0)) throw new Error('VoronoiPartition: width must be > 0');
    if (!(opts.height > 0)) throw new Error('VoronoiPartition: height must be > 0');
    if (!(opts.count > 0) && !opts.sites) throw new Error('VoronoiPartition: count or sites must be provided');
    this.width = opts.width;
    this.height = opts.height;
    this.distance = opts.distance || 'euclidean';

    this.siteList = [];
    if (opts.sites && opts.sites.length > 0) {
      for (var i = 0; i < opts.sites.length; i++) {
        var s = opts.sites[i];
        if (!s) continue;
        this.siteList.push({ id: i, x: s.x, y: s.y });
      }
    } else {
      var rng = mulberry32(resolveSeed(opts.seed));
      var n = opts.count | 0;
      for (var j = 0; j < n; j++) {
        this.siteList.push({
          id: j,
          x: rng() * this.width,
          y: rng() * this.height
        });
      }
    }
  }

  static create(opts: VoronoiOptions): VoronoiPartition {
    return new VoronoiPartition(opts);
  }

  // ---------- queries ----------

  // Returns the id of the site nearest to (x, y) under the configured
  // distance metric. Returns -1 if there are no sites.
  nearestSite(x: number, y: number): number {
    if (this.siteList.length === 0) return -1;
    var bestId = -1;
    var bestDist = Infinity;
    for (var i = 0; i < this.siteList.length; i++) {
      var s = this.siteList[i] as VoronoiSite;
      var d = this.dist(x, y, s.x, s.y);
      if (d < bestDist) {
        bestDist = d;
        bestId = s.id;
      }
    }
    return bestId;
  }

  // Returns the two nearest sites + their squared distances. Useful
  // for boundary detection (when the two nearest are close, the
  // sample is on a region edge).
  twoNearest(x: number, y: number): { firstId: number; secondId: number;
                                         firstDist: number; secondDist: number } {
    var firstId = -1, secondId = -1;
    var firstDist = Infinity, secondDist = Infinity;
    for (var i = 0; i < this.siteList.length; i++) {
      var s = this.siteList[i] as VoronoiSite;
      var d = this.dist(x, y, s.x, s.y);
      if (d < firstDist) {
        secondDist = firstDist;
        secondId = firstId;
        firstDist = d;
        firstId = s.id;
      } else if (d < secondDist) {
        secondDist = d;
        secondId = s.id;
      }
    }
    return { firstId: firstId, secondId: secondId,
             firstDist: firstDist, secondDist: secondDist };
  }

  // True iff the two nearest sites at (x, y) are within `epsilon` of
  // equidistant - i.e. the sample is on or near a Voronoi edge.
  // Useful for drawing boundaries.
  onBoundary(x: number, y: number, epsilon: number): boolean {
    if (this.siteList.length < 2) return false;
    var p = this.twoNearest(x, y);
    return Math.abs(p.firstDist - p.secondDist) < epsilon;
  }

  sites(): ReadonlyArray<VoronoiSite> {
    return this.siteList.slice();
  }

  count(): number { return this.siteList.length; }

  getWidth(): number { return this.width; }
  getHeight(): number { return this.height; }
  getDistance(): DistanceFn { return this.distance; }

  // ---------- private ----------

  private dist(ax: number, ay: number, bx: number, by: number): number {
    var dx = ax - bx;
    var dy = ay - by;
    if (this.distance === 'manhattan') {
      return Math.abs(dx) + Math.abs(dy);
    }
    if (this.distance === 'chebyshev') {
      return Math.max(Math.abs(dx), Math.abs(dy));
    }
    // euclidean (squared - we don't need the sqrt for comparisons)
    return dx * dx + dy * dy;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_VORONOI_PARTITION = 'voronoi_partition';
