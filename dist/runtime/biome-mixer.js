// BiomeMixer - climate + elevation -> biome classifier.
//
// 1.6.4 enabling primitive (Wave 1.6 procgen depth). Standard
// "Whittaker biome diagram" pattern: each biome is a rectangle
// in (elevation, moisture) space. Pass elevation [-1, 1] (or any
// range) + moisture [0, 1] (or any range) and the classifier
// returns the biome whose rectangle contains the sample. Used
// alongside NoiseField (1.6.1) to convert two scalar fields
// (elevation noise + moisture noise) into a labeled biome map.
//
//   var bm = BiomeMixer.create();
//   bm.defineBiome({ id: 'ocean',         minElev: -1,  maxElev: -0.2 });
//   bm.defineBiome({ id: 'beach',         minElev: -0.2, maxElev: 0.0 });
//   bm.defineBiome({ id: 'desert',        minElev:  0.0, maxElev: 0.4,
//                    minMoist: 0.0, maxMoist: 0.3 });
//   bm.defineBiome({ id: 'grassland',     minElev:  0.0, maxElev: 0.4,
//                    minMoist: 0.3, maxMoist: 0.7 });
//   bm.defineBiome({ id: 'forest',        minElev:  0.0, maxElev: 0.5,
//                    minMoist: 0.7, maxMoist: 1.0 });
//   bm.defineBiome({ id: 'mountain',      minElev:  0.5, maxElev: 0.8 });
//   bm.defineBiome({ id: 'snow',          minElev:  0.8, maxElev: 1.0 });
//
//   var biome = bm.classify(0.3, 0.65);   // -> 'grassland'
//
// Biomes are evaluated in INSERTION ORDER; the first matching
// biome wins. Use this to layer specific cases over general ones
// (define ocean first, then narrower exceptions later if needed).
//
// Pairs with NoiseField (1.6.1, the elevation/moisture source),
// VoronoiPartition (1.6.2, region overlay on top of biomes),
// WorldSeed (1.6.5 milestone, orchestrator).
//
// Code style: var-only in browser source.
export class BiomeMixer {
    biomes = [];
    byId = new Map();
    fallbackId = null;
    constructor() { }
    static create() {
        return new BiomeMixer();
    }
    // Add a biome rule. Returns false on bad input (empty id,
    // duplicate id, inverted ranges).
    defineBiome(spec) {
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0)
            return false;
        if (this.byId.has(spec.id))
            return false;
        var minE = (typeof spec.minElev === 'number' && isFinite(spec.minElev))
            ? spec.minElev : -Infinity;
        var maxE = (typeof spec.maxElev === 'number' && isFinite(spec.maxElev))
            ? spec.maxElev : Infinity;
        var minM = (typeof spec.minMoist === 'number' && isFinite(spec.minMoist))
            ? spec.minMoist : -Infinity;
        var maxM = (typeof spec.maxMoist === 'number' && isFinite(spec.maxMoist))
            ? spec.maxMoist : Infinity;
        if (maxE < minE || maxM < minM)
            return false;
        var b = {
            id: spec.id,
            minElev: minE, maxElev: maxE,
            minMoist: minM, maxMoist: maxM,
        };
        if (spec.data !== undefined)
            b.data = spec.data;
        this.biomes.push(b);
        this.byId.set(spec.id, b);
        return true;
    }
    removeBiome(id) {
        var b = this.byId.get(id);
        if (!b)
            return false;
        var idx = this.biomes.indexOf(b);
        if (idx >= 0)
            this.biomes.splice(idx, 1);
        this.byId.delete(id);
        if (this.fallbackId === id)
            this.fallbackId = null;
        return true;
    }
    // Set the biome id returned when no rule matches. Default null.
    setFallback(id) {
        if (id !== null && !this.byId.has(id))
            return;
        this.fallbackId = id;
    }
    // Returns the matching biome id (in insertion order; first match
    // wins) or the fallback id (or null) if no biome contains the
    // (elevation, moisture) sample.
    classify(elevation, moisture) {
        for (var i = 0; i < this.biomes.length; i++) {
            var b = this.biomes[i];
            if (elevation >= b.minElev && elevation <= b.maxElev &&
                moisture >= b.minMoist && moisture <= b.maxMoist) {
                return b.id;
            }
        }
        return this.fallbackId;
    }
    // Same as classify but returns the full payload + id, or null.
    classifyFull(elevation, moisture) {
        var id = this.classify(elevation, moisture);
        if (id === null)
            return null;
        var b = this.byId.get(id);
        if (!b)
            return null;
        var out = { id: b.id };
        if (b.data !== undefined)
            out.data = b.data;
        return out;
    }
    list() {
        var out = [];
        for (var i = 0; i < this.biomes.length; i++)
            out.push(this.biomes[i].id);
        return out;
    }
    count() { return this.biomes.length; }
    hasBiome(id) { return this.byId.has(id); }
    getFallback() { return this.fallbackId; }
    clear() {
        this.biomes = [];
        this.byId.clear();
        this.fallbackId = null;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_BIOME_MIXER = 'biome_mixer';
//# sourceMappingURL=biome-mixer.js.map