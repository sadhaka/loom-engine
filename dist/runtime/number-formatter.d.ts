export interface NumberFormatterOptions {
    locale?: string;
    fallbackCompactSuffixes?: {
        [exp: number]: string;
    };
}
export interface FormatOptions {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
    useGrouping?: boolean;
}
export interface CompactOptions {
    maximumFractionDigits?: number;
    threshold?: number;
}
export interface CurrencyOptions {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
}
export interface PercentOptions {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
}
export declare class NumberFormatter {
    private locale;
    private compactSuffixes;
    private constructor();
    static create(opts?: NumberFormatterOptions): NumberFormatter;
    setLocale(locale: string): void;
    getLocale(): string;
    format(value: number, opts?: FormatOptions): string;
    compact(value: number, opts?: CompactOptions): string;
    percent(value: number, opts?: PercentOptions): string;
    currency(value: number, currencyCode: string, opts?: CurrencyOptions): string;
    private formatFallback;
    private compactFallback;
}
export declare const RESOURCE_NUMBER_FORMATTER = "number_formatter";
//# sourceMappingURL=number-formatter.d.ts.map