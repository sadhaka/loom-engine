export type RangeBand = 'engaged' | 'near' | 'far';
export declare const RANGE_BAND_ENGAGED: RangeBand;
export declare const RANGE_BAND_NEAR: RangeBand;
export declare const RANGE_BAND_FAR: RangeBand;
export declare const ENGAGED_MAX_FT = 5;
export declare const NEAR_MAX_FT = 30;
export declare function bandFromDistanceFt(feet: number): RangeBand;
export declare function normalizeBand(band: string): RangeBand | null;
export declare function bandWithin(band: RangeBand, maxBand: RangeBand): boolean;
export declare function compareBands(a: RangeBand, b: RangeBand): number;
export interface RangeBandField {
    bands: Map<string, RangeBand>;
}
export declare function createRangeBandField(): RangeBandField;
export interface SetPairOptions {
    band?: RangeBand;
    distanceFeet?: number;
    symmetric?: boolean;
}
export declare function rangeBandSet(field: RangeBandField, a: string, b: string, opts?: SetPairOptions): RangeBand;
export declare function rangeBandGet(field: RangeBandField, source: string, target: string): RangeBand | null;
export declare function rangeBandIsEngaged(field: RangeBandField, a: string, b: string): boolean;
export declare function rangeBandTargetsWithin(field: RangeBandField, source: string, maxBand: RangeBand): string[];
export declare function rangeBandEngagedWith(field: RangeBandField, source: string): string[];
export declare function rangeBandClear(field: RangeBandField): void;
export declare function rangeBandSnapshot(field: RangeBandField): Array<{
    source: string;
    target: string;
    band: RangeBand;
}>;
export declare const RESOURCE_RANGE_BANDS = "rangeBands";
//# sourceMappingURL=range-bands.d.ts.map