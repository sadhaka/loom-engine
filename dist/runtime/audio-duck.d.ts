export interface DuckChannelSpec {
    id: string;
    baseVolume?: number;
    data?: Record<string, unknown>;
}
export interface DuckChannelSnapshot {
    id: string;
    volume: number;
    baseVolume: number;
    isDucking: boolean;
    data?: Record<string, unknown>;
}
export interface DuckEventSpec {
    id: string;
    durationMs?: number;
    attackMs?: number;
    releaseMs?: number;
    duckTo?: number;
    channels?: string[];
}
export interface AudioDuckOptions {
}
export declare class AudioDuck {
    private channels;
    private events;
    private disposed;
    private constructor();
    static create(opts?: AudioDuckOptions): AudioDuck;
    registerChannel(spec: DuckChannelSpec): boolean;
    setBaseVolume(id: string, volume: number): boolean;
    removeChannel(id: string): boolean;
    hasChannel(id: string): boolean;
    channelCount(): number;
    triggerDuck(spec: DuckEventSpec): boolean;
    cancelDuck(eventId: string): boolean;
    hasEvent(eventId: string): boolean;
    eventCount(): number;
    getChannelMultiplier(channelId: string): number;
    getChannel(channelId: string): DuckChannelSnapshot | null;
    forEach(cb: (ch: DuckChannelSnapshot) => void): void;
    list(): DuckChannelSnapshot[];
    tick(dtMs: number): void;
    clear(): void;
    dispose(): void;
    private eventMultiplier;
}
export declare const RESOURCE_AUDIO_DUCK = "audio_duck";
//# sourceMappingURL=audio-duck.d.ts.map