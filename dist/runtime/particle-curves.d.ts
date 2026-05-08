import type { ColorRGBA } from '../util/color.js';
import { type EasingFn, type EasingName } from './tween.js';
export type EmitRateShape = 'constant' | 'linearRamp' | 'pulse' | 'sustainFade';
export interface EmitRateOptions {
    shape: EmitRateShape;
    peakRate: number;
    startRate?: number;
    easing?: EasingFn | EasingName;
    sustainFraction?: number;
}
export declare function emitRateAt(opts: EmitRateOptions, t: number): number;
export declare function particlesToEmit(opts: EmitRateOptions, t0: number, t1: number, durationSeconds: number, accumulator: {
    value: number;
}): number;
export interface ColorStop {
    t: number;
    color: ColorRGBA;
}
export declare function colorAtAge(stops: ReadonlyArray<ColorStop>, age: number): ColorRGBA;
export type SizeShape = 'constant' | 'growThenShrink' | 'easeOut' | 'easeIn' | 'step';
export interface SizeOverLifeOptions {
    shape: SizeShape;
    startScale?: number;
    endScale?: number;
    peakAt?: number;
    stepAt?: number;
    easing?: EasingFn | EasingName;
}
export declare function sizeAtAge(opts: SizeOverLifeOptions, t: number): number;
export declare const RESOURCE_PARTICLE_CURVES = "particle_curves";
//# sourceMappingURL=particle-curves.d.ts.map