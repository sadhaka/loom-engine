import type { AttackerStats, DefenderStats, DamageOptions, DamageResult } from './damage-formula.js';
import type { FloatingTextSpawn } from './floating-text.js';
export interface DamageNumberStyle {
    normalColor?: number;
    critColor?: number;
    blockedColor?: number;
    normalScale?: number;
    critScale?: number;
    lifetimeMs?: number;
    critSuffix?: string;
}
export interface FloatingTextEmitter {
    emit(spawn: FloatingTextSpawn): number;
}
export interface DamageNumberPipelineOptions {
    floatingText: FloatingTextEmitter;
    compute?: (a: AttackerStats, d: DefenderStats, o?: DamageOptions) => DamageResult;
    style?: DamageNumberStyle;
    formatText?: (r: DamageResult) => string;
    blockedAtOrBelow?: number;
}
export declare class DamageNumberPipeline {
    private floatingText;
    private compute;
    private style;
    private formatText;
    private blockedAtOrBelow;
    private userProvidedFormat;
    private disposed;
    private constructor();
    static create(opts: DamageNumberPipelineOptions): DamageNumberPipeline;
    publish(attacker: AttackerStats, defender: DefenderStats, x: number, y: number, opts?: DamageOptions): DamageResult;
    publishResult(result: DamageResult, x: number, y: number): void;
    setStyle(style: DamageNumberStyle): void;
    getStyle(): DamageNumberStyle;
    dispose(): void;
    private spawn;
}
export declare const RESOURCE_DAMAGE_NUMBER_PIPELINE = "damage_number_pipeline";
//# sourceMappingURL=damage-number-pipeline.d.ts.map