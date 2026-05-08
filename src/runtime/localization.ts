// Localization - string table + locale + parameter interpolation.
//
// 0.46.0 enabling primitive. Every game ships strings: HUD labels,
// dialog lines, error messages, item names, ability tooltips. The
// engine ships ZERO of these (it's a runtime, not a content
// system) but it does need a primitive consumers can use to look
// up the right string for the current locale, with parameter
// interpolation (level numbers, character names) and pluralization.
//
// Localization is a tiny, framework-agnostic table:
//
//   - register(locale, table) - load a JSON-shaped string table.
//   - setLocale(locale) / getLocale() - the active locale.
//   - t(key, params?) - lookup by key in the active locale, fall
//     back to defaultLocale, fall back to the key itself.
//   - {param} interpolation; arbitrary number of params; missing
//     params leave their {placeholder} verbatim.
//   - Pluralization: t.plural(key, count, params?) selects from
//     {key}.zero / {key}.one / {key}.few / {key}.many / {key}.other
//     using Intl.PluralRules where available (defaults to a simple
//     en-style "one / other" rule otherwise).
//
// Code style: var-only in browser source.

// A leaf string OR a plural-form record.
export type LocalizationValue = string | PluralForms;

export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export interface LocalizationTable {
  // Flat key -> value map. Keys may use any naming scheme; dots
  // are NOT special (unlike i18next). Use 'hud.health.label' as a
  // single literal key if you want.
  [key: string]: LocalizationValue;
}

export interface LocalizationOptions {
  // The default locale to fall back to when a key is missing in
  // the active locale. Default 'en'.
  defaultLocale?: string;
  // Initial locale. Defaults to defaultLocale.
  initialLocale?: string;
  // Intl.PluralRules support: if you want a specific
  // localization-rule mode, pass it here. Defaults to
  // Intl.PluralRules when available, otherwise the simple
  // English fallback (count === 1 -> 'one' else 'other').
  pluralRules?: (locale: string) => (count: number) => string;
}

function defaultPluralRules(locale: string): (count: number) => string {
  if (typeof Intl !== 'undefined' && typeof Intl.PluralRules === 'function') {
    try {
      var pr = new Intl.PluralRules(locale);
      return function (count: number): string {
        return pr.select(count);
      };
    } catch {
      // fallthrough
    }
  }
  // English fallback.
  return function (count: number): string {
    return count === 1 ? 'one' : 'other';
  };
}

function isPluralForms(v: LocalizationValue): v is PluralForms {
  return typeof v === 'object' && v !== null && typeof (v as PluralForms).other === 'string';
}

export class Localization {
  private tables: Map<string, LocalizationTable> = new Map();
  private locale: string;
  private defaultLocale: string;
  private pluralRulesFactory: (locale: string) => (count: number) => string;
  private pluralRulesCache: Map<string, (count: number) => string> = new Map();
  private disposed: boolean = false;

  private constructor(opts: LocalizationOptions) {
    this.defaultLocale = opts.defaultLocale ?? 'en';
    this.locale = opts.initialLocale ?? this.defaultLocale;
    this.pluralRulesFactory = opts.pluralRules ?? defaultPluralRules;
  }

  static create(opts: LocalizationOptions = {}): Localization {
    return new Localization(opts);
  }

  // Register or replace a locale's table. Re-registering merges
  // with the previous table (last write wins per key), so consumers
  // can split tables by feature (hud, dialog, ability) and call
  // register() once per file.
  register(locale: string, table: LocalizationTable): void {
    if (this.disposed) return;
    if (typeof locale !== 'string' || locale.length === 0) return;
    if (!table || typeof table !== 'object') return;
    var existing = this.tables.get(locale);
    if (!existing) {
      this.tables.set(locale, { ...table });
    } else {
      for (var k in table) {
        if (Object.prototype.hasOwnProperty.call(table, k)) {
          existing[k] = table[k] as LocalizationValue;
        }
      }
    }
  }

  // Replace the entire table for a locale (no merge).
  set(locale: string, table: LocalizationTable): void {
    if (this.disposed) return;
    if (typeof locale !== 'string' || locale.length === 0) return;
    if (!table || typeof table !== 'object') return;
    this.tables.set(locale, { ...table });
  }

  setLocale(locale: string): void {
    if (this.disposed) return;
    if (typeof locale === 'string' && locale.length > 0) {
      this.locale = locale;
    }
  }

  getLocale(): string {
    return this.locale;
  }

  getDefaultLocale(): string {
    return this.defaultLocale;
  }

  hasLocale(locale: string): boolean {
    return this.tables.has(locale);
  }

  registeredLocales(): string[] {
    var out: string[] = [];
    this.tables.forEach((_t, name) => out.push(name));
    return out;
  }

  // Look up a key in the active locale; fall back to defaultLocale;
  // finally fall back to the key itself. Parameters substitute
  // {name} placeholders. Unmatched placeholders are left verbatim.
  t(key: string, params?: Record<string, string | number>): string {
    if (this.disposed) return key;
    if (typeof key !== 'string') return '';
    var raw = this.lookup(key);
    if (raw === null) return key;
    if (isPluralForms(raw)) {
      // Calling t() on a plural-shaped value falls back to .other.
      return this.interpolate(raw.other, params);
    }
    return this.interpolate(raw, params);
  }

  // Pluralized lookup. Selects from .zero / .one / .two / .few /
  // .many / .other using Intl.PluralRules for the active locale.
  // The numeric count is automatically available as {count} in the
  // returned string.
  plural(key: string, count: number, params?: Record<string, string | number>): string {
    if (this.disposed) return key;
    if (typeof key !== 'string') return '';
    var raw = this.lookup(key);
    if (raw === null) return key;
    if (!isPluralForms(raw)) {
      // Non-plural value: behave like t() with {count} param.
      return this.interpolate(raw, this.mergeCount(params, count));
    }
    var rule = this.getPluralRule(this.locale);
    var category = rule(count);
    var template = (raw as unknown as Record<string, string | undefined>)[category]
      ?? raw.other;
    return this.interpolate(template, this.mergeCount(params, count));
  }

  // Drop every registered locale and reset the active locale to
  // defaultLocale.
  clear(): void {
    if (this.disposed) return;
    this.tables.clear();
    this.locale = this.defaultLocale;
    this.pluralRulesCache.clear();
  }

  dispose(): void {
    this.tables.clear();
    this.pluralRulesCache.clear();
    this.disposed = true;
  }

  // ---------- private ----------

  private lookup(key: string): LocalizationValue | null {
    var active = this.tables.get(this.locale);
    if (active && Object.prototype.hasOwnProperty.call(active, key)) {
      return active[key] as LocalizationValue;
    }
    if (this.locale !== this.defaultLocale) {
      var def = this.tables.get(this.defaultLocale);
      if (def && Object.prototype.hasOwnProperty.call(def, key)) {
        return def[key] as LocalizationValue;
      }
    }
    return null;
  }

  private interpolate(template: string, params?: Record<string, string | number>): string {
    if (!params) return template;
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, function (match, name) {
      if (Object.prototype.hasOwnProperty.call(params, name)) {
        var v = params[name];
        return v === undefined ? match : String(v);
      }
      return match;
    });
  }

  private getPluralRule(locale: string): (count: number) => string {
    var cached = this.pluralRulesCache.get(locale);
    if (cached) return cached;
    var fresh = this.pluralRulesFactory(locale);
    this.pluralRulesCache.set(locale, fresh);
    return fresh;
  }

  private mergeCount(
    params: Record<string, string | number> | undefined,
    count: number,
  ): Record<string, string | number> {
    if (!params) return { count: count };
    if (Object.prototype.hasOwnProperty.call(params, 'count')) return params;
    var merged: Record<string, string | number> = { count: count };
    for (var k in params) {
      if (Object.prototype.hasOwnProperty.call(params, k)) {
        var v = params[k];
        if (v !== undefined) merged[k] = v;
      }
    }
    return merged;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_LOCALIZATION = 'localization';
