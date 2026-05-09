// NumberFormatter - i18n number formatting helper.
//
// 0.98.0 enabling primitive. Damage numbers (10000), gold totals
// (1234567), XP (50000), drop counts, currency, percentages - every
// HUD number wants the same shape: a per-locale formatter that
// renders raw numbers as the user expects to read them.
//
//   var fmt = NumberFormatter.create({ locale: 'en-US' });
//   fmt.compact(10000)     -> "10K"
//   fmt.compact(1500000)   -> "1.5M"
//   fmt.format(1234567)    -> "1,234,567"     (fr-FR -> "1 234 567",
//                                              de-DE -> "1.234.567")
//   fmt.percent(0.5)       -> "50%"
//   fmt.currency(99, 'USD')-> "$99.00"
//   fmt.setLocale('fr-FR');
//   fmt.format(1234567)    -> "1 234 567"
//
// Backed by Intl.NumberFormat when available. Falls back to a
// simple English-style formatter (',' grouping, '.' decimal,
// 'K'/'M'/'B'/'T' compact suffixes) when Intl is missing.
//
// Pure function module: zero state besides the active locale
// configured via setLocale / getLocale.
//
// Code style: var-only in browser source.

export interface NumberFormatterOptions {
  // Active locale tag, e.g. 'en-US', 'fr-FR', 'de-DE', 'ja-JP'.
  // Defaults to 'en-US'.
  locale?: string;
  // Default compact short suffixes when Intl is unavailable.
  // Indexed by exponent of 10: 3 -> 'K', 6 -> 'M', 9 -> 'B',
  // 12 -> 'T'. You can override per-locale (e.g. ja: '万' / '億').
  fallbackCompactSuffixes?: { [exp: number]: string };
}

export interface FormatOptions {
  // Min / max fraction digits for the default formatter.
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  // Disable grouping (no commas / spaces / dots).
  useGrouping?: boolean;
}

export interface CompactOptions {
  // Default 1. The "1.5K" form uses 1 decimal; pass 0 for "2K"
  // style or 2 for "1.50K".
  maximumFractionDigits?: number;
  // Below this threshold, the value is formatted without a suffix.
  // Default 1000.
  threshold?: number;
}

export interface CurrencyOptions {
  // Default 2 (e.g. USD cents). For JPY pass 0.
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

export interface PercentOptions {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_COMPACT_SUFFIXES: { [exp: number]: string } = {
  3: 'K',
  6: 'M',
  9: 'B',
  12: 'T',
};
// Returned for non-finite inputs (NaN, Infinity, -Infinity).
const FALLBACK_STRING = '';

function hasIntl(): boolean {
  return typeof Intl !== 'undefined' && typeof Intl.NumberFormat === 'function';
}

export class NumberFormatter {
  private locale: string;
  private compactSuffixes: { [exp: number]: string };

  private constructor(opts: NumberFormatterOptions) {
    this.locale = typeof opts.locale === 'string' && opts.locale.length > 0
      ? opts.locale : DEFAULT_LOCALE;
    this.compactSuffixes = opts.fallbackCompactSuffixes
      ? { ...DEFAULT_COMPACT_SUFFIXES, ...opts.fallbackCompactSuffixes }
      : DEFAULT_COMPACT_SUFFIXES;
  }

  static create(opts: NumberFormatterOptions = {}): NumberFormatter {
    return new NumberFormatter(opts);
  }

  setLocale(locale: string): void {
    if (typeof locale === 'string' && locale.length > 0) {
      this.locale = locale;
    }
  }

  getLocale(): string { return this.locale; }

  // Format a number with locale-aware grouping.
  // 1234567 (en-US) -> "1,234,567"
  // 1234567 (fr-FR) -> "1 234 567"
  // 1234567 (de-DE) -> "1.234.567"
  format(value: number, opts: FormatOptions = {}): string {
    if (!isFinite(value)) return FALLBACK_STRING;
    if (hasIntl()) {
      try {
        var intlOpts: Intl.NumberFormatOptions = {};
        if (opts.minimumFractionDigits !== undefined) {
          intlOpts.minimumFractionDigits = opts.minimumFractionDigits;
        }
        if (opts.maximumFractionDigits !== undefined) {
          intlOpts.maximumFractionDigits = opts.maximumFractionDigits;
        }
        if (opts.useGrouping !== undefined) {
          intlOpts.useGrouping = opts.useGrouping;
        }
        return new Intl.NumberFormat(this.locale, intlOpts).format(value);
      } catch {
        // Fall through to fallback.
      }
    }
    return this.formatFallback(value, opts);
  }

  // Compact / abbreviated form. 10000 -> "10K", 1500000 -> "1.5M".
  compact(value: number, opts: CompactOptions = {}): string {
    if (!isFinite(value)) return FALLBACK_STRING;
    var maxFrac = opts.maximumFractionDigits !== undefined
      ? opts.maximumFractionDigits : 1;
    var threshold = opts.threshold !== undefined ? opts.threshold : 1000;
    if (Math.abs(value) < threshold) {
      return this.format(value, { maximumFractionDigits: maxFrac });
    }
    if (hasIntl()) {
      try {
        return new Intl.NumberFormat(this.locale, {
          notation: 'compact',
          maximumFractionDigits: maxFrac,
        }).format(value);
      } catch {
        // Fall through.
      }
    }
    return this.compactFallback(value, maxFrac);
  }

  // 0.5 -> "50%". Input is the ratio (0..1 typical), not a
  // percentage value.
  percent(value: number, opts: PercentOptions = {}): string {
    if (!isFinite(value)) return FALLBACK_STRING;
    if (hasIntl()) {
      try {
        var intlOpts: Intl.NumberFormatOptions = { style: 'percent' };
        if (opts.minimumFractionDigits !== undefined) {
          intlOpts.minimumFractionDigits = opts.minimumFractionDigits;
        }
        if (opts.maximumFractionDigits !== undefined) {
          intlOpts.maximumFractionDigits = opts.maximumFractionDigits;
        }
        return new Intl.NumberFormat(this.locale, intlOpts).format(value);
      } catch {
        // Fall through.
      }
    }
    var pct = value * 100;
    var maxFrac = opts.maximumFractionDigits !== undefined
      ? opts.maximumFractionDigits : 0;
    return this.formatFallback(pct, { maximumFractionDigits: maxFrac }) + '%';
  }

  // 99 -> "$99.00" (USD). 1500 -> "¥1,500" (JPY, 0 decimals).
  currency(value: number, currencyCode: string, opts: CurrencyOptions = {}): string {
    if (!isFinite(value)) return FALLBACK_STRING;
    if (typeof currencyCode !== 'string' || currencyCode.length === 0) {
      return this.format(value, opts);
    }
    if (hasIntl()) {
      try {
        var intlOpts: Intl.NumberFormatOptions = {
          style: 'currency',
          currency: currencyCode,
        };
        if (opts.minimumFractionDigits !== undefined) {
          intlOpts.minimumFractionDigits = opts.minimumFractionDigits;
        }
        if (opts.maximumFractionDigits !== undefined) {
          intlOpts.maximumFractionDigits = opts.maximumFractionDigits;
        }
        return new Intl.NumberFormat(this.locale, intlOpts).format(value);
      } catch {
        // Fall through.
      }
    }
    var minFrac = opts.minimumFractionDigits !== undefined
      ? opts.minimumFractionDigits : 2;
    var maxFrac = opts.maximumFractionDigits !== undefined
      ? opts.maximumFractionDigits : 2;
    return currencyCode + ' ' + this.formatFallback(value, {
      minimumFractionDigits: minFrac,
      maximumFractionDigits: maxFrac,
    });
  }

  // ---------- private (fallbacks for environments without Intl) ----------

  private formatFallback(value: number, opts: FormatOptions): string {
    var minFrac = opts.minimumFractionDigits !== undefined
      ? Math.max(0, Math.floor(opts.minimumFractionDigits)) : 0;
    var maxFrac = opts.maximumFractionDigits !== undefined
      ? Math.max(minFrac, Math.floor(opts.maximumFractionDigits)) : Math.max(minFrac, 0);
    var useGrouping = opts.useGrouping !== false;
    var negative = value < 0;
    var abs = Math.abs(value);
    var fixed = maxFrac > 0 ? abs.toFixed(maxFrac) : String(Math.round(abs));
    var dot = fixed.indexOf('.');
    var intPart = dot >= 0 ? fixed.substring(0, dot) : fixed;
    var fracPart = dot >= 0 ? fixed.substring(dot + 1) : '';
    // Trim trailing zeros down to minFrac.
    while (fracPart.length > minFrac && fracPart.charAt(fracPart.length - 1) === '0') {
      fracPart = fracPart.substring(0, fracPart.length - 1);
    }
    if (useGrouping && intPart.length > 3) {
      var grouped = '';
      var i = intPart.length;
      while (i > 3) {
        grouped = ',' + intPart.substring(i - 3, i) + grouped;
        i -= 3;
      }
      grouped = intPart.substring(0, i) + grouped;
      intPart = grouped;
    }
    var out = fracPart.length > 0 ? intPart + '.' + fracPart : intPart;
    return negative ? '-' + out : out;
  }

  private compactFallback(value: number, maxFrac: number): string {
    var negative = value < 0;
    var abs = Math.abs(value);
    var exp = 0;
    var suffix = '';
    var keys = [12, 9, 6, 3];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i] as number;
      if (abs >= Math.pow(10, k)) {
        exp = k;
        suffix = this.compactSuffixes[k] ?? '';
        break;
      }
    }
    var scaled = exp > 0 ? abs / Math.pow(10, exp) : abs;
    var rendered = this.formatFallback(scaled, {
      maximumFractionDigits: maxFrac,
      useGrouping: false,
    });
    var out = rendered + suffix;
    return negative ? '-' + out : out;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_NUMBER_FORMATTER = 'number_formatter';
