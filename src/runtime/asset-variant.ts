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

export interface AssetVariantSpec {
  id: string;
  // Map of variant key -> URL.
  variants: Record<string, string>;
}

export interface AssetVariantOptions {
  // Variant selection chain. First match wins. May be updated at
  // runtime via setVariants().
  variants: string[];
}

export class AssetVariant {
  private byId: Map<string, AssetVariantSpec> = new Map();
  private chain: string[];
  private disposed: boolean = false;

  private constructor(opts: AssetVariantOptions) {
    this.chain = (opts.variants || []).slice();
  }

  static create(opts: AssetVariantOptions): AssetVariant {
    return new AssetVariant(opts);
  }

  registerAsset(spec: AssetVariantSpec): boolean {
    if (this.disposed) return false;
    if (!isValidSpec(spec)) return false;
    if (this.byId.has(spec.id)) return false;
    this.byId.set(spec.id, cloneSpec(spec));
    return true;
  }

  unregisterAsset(id: string): boolean {
    if (this.disposed) return false;
    return this.byId.delete(id);
  }

  has(id: string): boolean { return this.byId.has(id); }

  size(): number { return this.byId.size; }

  // Resolve via the current variant chain. Returns null if no
  // variant key matches.
  resolve(id: string): string | null {
    if (this.disposed) return null;
    var spec = this.byId.get(id);
    if (!spec) return null;
    for (var i = 0; i < this.chain.length; i++) {
      var key = this.chain[i] as string;
      if (Object.prototype.hasOwnProperty.call(spec.variants, key)) {
        var url = spec.variants[key];
        if (typeof url === 'string' && url.length > 0) return url;
      }
    }
    return null;
  }

  // Resolve with explicit variant chain (overrides current).
  resolveWith(id: string, variants: string[]): string | null {
    if (this.disposed) return null;
    var spec = this.byId.get(id);
    if (!spec) return null;
    for (var i = 0; i < variants.length; i++) {
      var key = variants[i] as string;
      if (Object.prototype.hasOwnProperty.call(spec.variants, key)) {
        var url = spec.variants[key];
        if (typeof url === 'string' && url.length > 0) return url;
      }
    }
    return null;
  }

  setVariants(variants: string[]): void {
    if (this.disposed) return;
    if (!Array.isArray(variants)) return;
    this.chain = variants.slice();
  }

  getVariants(): string[] {
    return this.chain.slice();
  }

  // List all asset specs.
  list(): AssetVariantSpec[] {
    var out: AssetVariantSpec[] = [];
    this.byId.forEach((s) => out.push(cloneSpec(s)));
    return out;
  }

  // List variant keys defined by a specific asset.
  variantsOf(id: string): string[] {
    var spec = this.byId.get(id);
    if (!spec) return [];
    return Object.keys(spec.variants);
  }

  clear(): void {
    if (this.disposed) return;
    this.byId.clear();
  }

  dispose(): void {
    this.byId.clear();
    this.chain = [];
    this.disposed = true;
  }
}

function isValidSpec(s: AssetVariantSpec): boolean {
  if (!s || typeof s.id !== 'string' || s.id.length === 0) return false;
  if (!s.variants || typeof s.variants !== 'object') return false;
  var keys = Object.keys(s.variants);
  if (keys.length === 0) return false;
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i] as string;
    var v = s.variants[k];
    if (typeof v !== 'string' || v.length === 0) return false;
  }
  return true;
}

function cloneSpec(s: AssetVariantSpec): AssetVariantSpec {
  var variants: Record<string, string> = {};
  var keys = Object.keys(s.variants);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i] as string;
    variants[k] = s.variants[k] as string;
  }
  return { id: s.id, variants: variants };
}

// Resource key for the world's resource registry.
export const RESOURCE_ASSET_VARIANT = 'asset_variant';
