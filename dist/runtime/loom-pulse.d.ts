export declare const PULSE_FP_SHIFT = 16;
export declare const PULSE_FP_ONE: number;
export declare const VIBE_INVALID = -1;
export declare const AUDIT_RECORD_STRIDE = 2;
export interface LoomPulseConfig {
    maxVibes: number;
    smoothing: number;
    valueDecayPerTick: number;
    confidenceDecayPerTick: number;
    confidenceGainPerSignal: number;
    activationThreshold: number;
    deactivationThreshold: number;
    maxAtmosphereImpact: number;
    auditRingSize: number;
}
export declare class LoomPulse {
    readonly maxVibes: number;
    readonly smoothing: number;
    readonly valueDecayPerTick: number;
    readonly confidenceDecayPerTick: number;
    readonly confidenceGainPerSignal: number;
    readonly activationThreshold: number;
    readonly deactivationThreshold: number;
    readonly maxAtmosphereImpact: number;
    readonly auditRingSize: number;
    private readonly frontVibeValue;
    private readonly frontVibeConfidence;
    private readonly frontActiveFlag;
    private readonly backVibeValue;
    private readonly backVibeConfidence;
    private readonly backActiveFlag;
    private readonly corroborationScore;
    private readonly sampleCount;
    private readonly auditRing;
    private readonly auditHead;
    private readonly auditCount;
    private currentTick;
    private playerConsent;
    private pendingConsentClear;
    constructor(config: LoomPulseConfig);
    setPlayerConsent(enabled: boolean): void;
    isPlayerConsentEnabled(): boolean;
    injectSignal(vibeId: number, intensity: number): boolean;
    corroborateWithGameplay(vibeId: number, score: number): boolean;
    getEffectiveVibe(vibeId: number): number;
    getActiveFlag(vibeId: number): boolean;
    getCorroboratedVibe(vibeId: number, minCorroboration: number): number;
    clampAtmosphereImpact(value: number): number;
    getSampleCount(vibeId: number): number;
    getAuditRingCount(vibeId: number): number;
    readAuditSample(vibeId: number, i: number, out: Int32Array, outOffset?: number): boolean;
    tick(t: number): void;
    private requireVibeId;
    getCurrentTick(): number;
    clear(): void;
}
//# sourceMappingURL=loom-pulse.d.ts.map