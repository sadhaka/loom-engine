export interface WeatherState {
    name: string;
    defaultIntensity?: number;
}
export interface WeatherTransitionOptions {
    rampMs?: number;
    intensity?: number;
}
export interface WeatherSystemOptions {
    states?: WeatherState[];
    initial?: string;
    initialIntensity?: number;
    onWeatherChanged?: (next: string, prev: string | null) => void;
    onIntensitySettled?: (state: string, intensity: number) => void;
}
export declare class WeatherSystem {
    private states;
    private order;
    private currentName;
    private intensity;
    private ramp;
    private onWeatherChanged;
    private onIntensitySettled;
    private disposed;
    private constructor();
    static create(opts?: WeatherSystemOptions): WeatherSystem;
    setWeather(name: string, opts?: WeatherTransitionOptions): boolean;
    tick(dtMs: number): void;
    registerState(state: WeatherState): boolean;
    hasState(name: string): boolean;
    getWeather(): string | null;
    getIntensity(): number;
    isTransitioning(): boolean;
    getStates(): WeatherState[];
    dispose(): void;
    private addStateInternal;
}
export declare const RESOURCE_WEATHER_SYSTEM = "weather_system";
//# sourceMappingURL=weather-system.d.ts.map