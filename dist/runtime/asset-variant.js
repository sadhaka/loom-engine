// AssetVariant - per-locale / per-platform asset selection.
//
// 0.90.0 enabling primitive (M9 0.90 milestone). AssetPreloader
// (0.34) + AssetManifest (0.84) handle the WHAT and the WHERE-IN-
// THE-DEP-GRAPH; AssetVariant handles the WHICH-COPY: localized
// audio (en-US, th-TH, ru-RU), platform-specific textures
// (desktop @4K vs mobile @1K), accessibility variants. Each asset
// declares URLs per variant key; resolve() picks the best match
// from a configurable variant chain ('en-US/desktop' → 'en-US' →
// 'fallback').
//
//   var variant = AssetVariant.create({
//     variants: ['en-US/desktop', 'en-US', 'fallback'],
//   });
//   variant.registerAsset({
//     id: 'audio:welcome',
//     variants: {
//       'en-US': '/audio/en/welcome.mp3',
//       'th-TH': '/audio/th/welcome.mp3',
//       'fallback': '/audio/welcome.mp3',
//     },
//   });
//   var url = variant.resolve('audio:welcome'); // -> /audio/en/welcome.mp3
//
// Pairs with AssetPreloader (0.34), AssetManifest (0.84), and
// Localization (0.46) (the variant chain typically tracks the
// localization state).
//
// Code style: var-only in browser source.
export class AssetVariant {
    byId = new Map();
    chain;
    disposed = false;
    constructor(opts) {
        this.chain = (opts.variants || []).slice();
    }
    static create(opts) {
        return new AssetVariant(opts);
    }
    registerAsset(spec) {
        if (this.disposed)
            return false;
        if (!isValidSpec(spec))
            return false;
        if (this.byId.has(spec.id))
            return false;
        this.byId.set(spec.id, cloneSpec(spec));
        return true;
    }
    unregisterAsset(id) {
        if (this.disposed)
            return false;
        return this.byId.delete(id);
    }
    has(id) { return this.byId.has(id); }
    size() { return this.byId.size; }
    // Resolve via the current variant chain. Returns null if no
    // variant key matches.
    resolve(id) {
        if (this.disposed)
            return null;
        var spec = this.byId.get(id);
        if (!spec)
            return null;
        for (var i = 0; i < this.chain.length; i++) {
            var key = this.chain[i];
            if (Object.prototype.hasOwnProperty.call(spec.variants, key)) {
                var url = spec.variants[key];
                if (typeof url === 'string' && url.length > 0)
                    return url;
            }
        }
        return null;
    }
    // Resolve with explicit variant chain (overrides current).
    resolveWith(id, variants) {
        if (this.disposed)
            return null;
        var spec = this.byId.get(id);
        if (!spec)
            return null;
        for (var i = 0; i < variants.length; i++) {
            var key = variants[i];
            if (Object.prototype.hasOwnProperty.call(spec.variants, key)) {
                var url = spec.variants[key];
                if (typeof url === 'string' && url.length > 0)
                    return url;
            }
        }
        return null;
    }
    setVariants(variants) {
        if (this.disposed)
            return;
        if (!Array.isArray(variants))
            return;
        this.chain = variants.slice();
    }
    getVariants() {
        return this.chain.slice();
    }
    // List all asset specs.
    list() {
        var out = [];
        this.byId.forEach((s) => out.push(cloneSpec(s)));
        return out;
    }
    // List variant keys defined by a specific asset.
    variantsOf(id) {
        var spec = this.byId.get(id);
        if (!spec)
            return [];
        return Object.keys(spec.variants);
    }
    clear() {
        if (this.disposed)
            return;
        this.byId.clear();
    }
    dispose() {
        this.byId.clear();
        this.chain = [];
        this.disposed = true;
    }
}
function isValidSpec(s) {
    if (!s || typeof s.id !== 'string' || s.id.length === 0)
        return false;
    if (!s.variants || typeof s.variants !== 'object')
        return false;
    var keys = Object.keys(s.variants);
    if (keys.length === 0)
        return false;
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = s.variants[k];
        if (typeof v !== 'string' || v.length === 0)
            return false;
    }
    return true;
}
function cloneSpec(s) {
    var variants = {};
    var keys = Object.keys(s.variants);
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        variants[k] = s.variants[k];
    }
    return { id: s.id, variants: variants };
}
// Resource key for the world's resource registry.
export const RESOURCE_ASSET_VARIANT = 'asset_variant';
//# sourceMappingURL=asset-variant.js.map