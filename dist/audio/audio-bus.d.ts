export type BusPriority = 'essential' | 'ambient';
export interface BusOptions {
    initialGain?: number;
    priority?: BusPriority;
}
export declare const AUDIO_BUDGET_AMBIENT_FLOOR = 0.25;
export declare const AUDIO_BUDGET_ESSENTIAL_FLOOR = 0.05;
export declare class AudioBus {
    readonly ctx: AudioContext;
    private master;
    private buses;
    private masterGain;
    private currentBudget;
    private suspended;
    private constructor();
    static create(ctx?: AudioContext): AudioBus;
    unlock(): Promise<void>;
    isUnlocked(): boolean;
    input(name: string): AudioNode;
    hasBus(name: string): boolean;
    addBus(name: string, opts?: BusOptions): void;
    removeBus(name: string): void;
    setMasterGain(gain: number): void;
    getMasterGain(): number;
    setBusGain(name: string, gain: number): void;
    getBusGain(name: string): number;
    setBusMuted(name: string, muted: boolean): void;
    isBusMuted(name: string): boolean;
    setAudioBudget(budget: number): void;
    getAudioBudget(): number;
    private applyBudgetToBus;
    playOneShot(busName: string, buffer: AudioBuffer, options?: {
        rate?: number;
        gain?: number;
    }): AudioBufferSourceNode | null;
    playTone(busName: string, freq: number, durationMs: number, options?: {
        gain?: number;
        type?: OscillatorType;
    }): void;
    dispose(): void;
}
export declare const RESOURCE_AUDIO_BUS = "audio_bus";
//# sourceMappingURL=audio-bus.d.ts.map