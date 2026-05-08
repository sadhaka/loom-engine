import type { ZoneId } from './zone-state.js';
import type { ColorRGBA } from '../util/color.js';
export interface ZoneTilePalette {
    fill: Readonly<ColorRGBA>;
    stroke: Readonly<ColorRGBA>;
    highlight: Readonly<ColorRGBA>;
}
export interface ZoneCatalogEntry {
    id: ZoneId;
    name: string;
    knot: 'str' | 'dex' | 'int' | 'mixed' | 'center';
    palette: ZoneTilePalette;
    musicLevel: number;
    exits: ReadonlyArray<ZoneId>;
}
export declare const ZONE_CATALOG: Record<ZoneId, ZoneCatalogEntry>;
//# sourceMappingURL=zone-catalog.d.ts.map