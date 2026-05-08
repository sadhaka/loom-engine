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
    [key: string]: LocalizationValue;
}
export interface LocalizationOptions {
    defaultLocale?: string;
    initialLocale?: string;
    pluralRules?: (locale: string) => (count: number) => string;
}
export declare class Localization {
    private tables;
    private locale;
    private defaultLocale;
    private pluralRulesFactory;
    private pluralRulesCache;
    private disposed;
    private constructor();
    static create(opts?: LocalizationOptions): Localization;
    register(locale: string, table: LocalizationTable): void;
    set(locale: string, table: LocalizationTable): void;
    setLocale(locale: string): void;
    getLocale(): string;
    getDefaultLocale(): string;
    hasLocale(locale: string): boolean;
    registeredLocales(): string[];
    t(key: string, params?: Record<string, string | number>): string;
    plural(key: string, count: number, params?: Record<string, string | number>): string;
    clear(): void;
    dispose(): void;
    private lookup;
    private interpolate;
    private getPluralRule;
    private mergeCount;
}
export declare const RESOURCE_LOCALIZATION = "localization";
//# sourceMappingURL=localization.d.ts.map