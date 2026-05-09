export type SeriesKind = 'line' | 'bar' | 'scatter';
export type ChartPoint = [number, number] | {
    x: number;
    y: number;
};
export interface SeriesSpec {
    id: string;
    kind?: SeriesKind;
    points: ChartPoint[];
    color?: string;
    label?: string;
    data?: Record<string, unknown>;
}
export interface AxisRange {
    min: number;
    max: number;
}
export interface ChartPadding {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
}
export interface ChartRendererOptions {
    width: number;
    height: number;
    padding?: ChartPadding;
    autoFitY?: boolean;
    autoFitX?: boolean;
}
export interface RenderedPoint {
    px: number;
    py: number;
    x: number;
    y: number;
}
export interface RenderedSeries {
    id: string;
    kind: SeriesKind;
    color: string | null;
    label: string | null;
    points: RenderedPoint[];
    data?: Record<string, unknown>;
}
export interface ChartSnapshot {
    width: number;
    height: number;
    plotArea: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    axisX: AxisRange;
    axisY: AxisRange;
    series: RenderedSeries[];
}
export declare class ChartRenderer {
    private widthVal;
    private heightVal;
    private padding;
    private series;
    private axisX;
    private axisY;
    private autoFitX;
    private autoFitY;
    private xExplicit;
    private yExplicit;
    private disposed;
    private constructor();
    static create(opts: ChartRendererOptions): ChartRenderer;
    addSeries(spec: SeriesSpec): boolean;
    updatePoints(seriesId: string, points: ChartPoint[]): boolean;
    removeSeries(id: string): boolean;
    hasSeries(id: string): boolean;
    seriesCount(): number;
    setAxisRange(axis: 'x' | 'y', min: number, max: number): boolean;
    resetAxis(axis: 'x' | 'y'): void;
    getAxisRange(axis: 'x' | 'y'): AxisRange;
    setSize(width: number, height: number): boolean;
    getSnapshot(): ChartSnapshot;
    forEach(cb: (series: RenderedSeries) => void): void;
    list(): RenderedSeries[];
    toScreen(x: number, y: number): {
        px: number;
        py: number;
    };
    clear(): void;
    dispose(): void;
    private recomputeAutoFit;
    private renderSeries;
    private dataToScreen;
}
export declare const RESOURCE_CHART_RENDERER = "chart_renderer";
//# sourceMappingURL=chart-renderer.d.ts.map