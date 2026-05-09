export type StackingRule = 'replace' | 'refresh' | 'stack' | 'highest' | 'longest';
export interface EffectSpec {
    id: string;
    stacking?: StackingRule;
    maxStacks?: number;
    defaultDurationMs?: number;
    defaultMagnitude?: number;
    durationDR?: number;
    immunityAfterExpireMs?: number;
    data?: Record<string, unknown>;
}
export interface ActiveEffect {
    targetId: string;
    effectId: string;
    source: string | null;
    magnitude: number;
    totalMagnitude: number;
    stackCount: number;
    remainingMs: number;
    ageMs: number;
    immunityRemainingMs: number;
    data?: Record<string, unknown>;
}
export type ApplyResult = 'applied' | 'stacked' | 'refreshed' | 'replaced' | 'rejected_immune' | 'rejected_lower' | 'rejected_unknown';
export interface ApplyOptions {
    magnitude?: number;
    durationMs?: number;
    source?: string;
    data?: Record<string, unknown>;
}
export interface StatusEffectStackOptions {
    onApply?: (e: ActiveEffect, result: ApplyResult) => void;
    onExpire?: (e: ActiveEffect, reason: 'expired' | 'removed' | 'cleared') => void;
}
export declare class StatusEffectStack {
    private specs;
    private entries;
    private onApply;
    private onExpire;
    private disposed;
    private constructor();
    static create(opts?: StatusEffectStackOptions): StatusEffectStack;
    defineEffect(spec: EffectSpec): boolean;
    hasEffectSpec(effectId: string): boolean;
    apply(targetId: string, effectId: string, opts?: ApplyOptions): ApplyResult;
    removeEffect(targetId: string, effectId: string): boolean;
    has(targetId: string, effectId: string): boolean;
    isImmune(targetId: string, effectId: string): boolean;
    get(targetId: string, effectId: string): ActiveEffect | null;
    getStacks(targetId: string, effectId: string): number;
    listForTarget(targetId: string): ActiveEffect[];
    listByEffect(effectId: string): ActiveEffect[];
    forEach(cb: (e: ActiveEffect) => void): void;
    count(): number;
    clearTarget(targetId: string): number;
    tick(dtMs: number): void;
    dispose(): void;
    private find;
    private findIndex;
    private fireApply;
    private fireExpire;
    private snapshot;
}
export declare const RESOURCE_STATUS_EFFECT_STACK = "status_effect_stack";
//# sourceMappingURL=status-effect-stack.d.ts.map