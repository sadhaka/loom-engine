import type { Vec2 } from '../util/math.js';
export interface Agent {
    x: number;
    y: number;
    vx: number;
    vy: number;
    maxSpeed: number;
    maxForce?: number;
}
export declare function seek(agent: Agent, target: Vec2): Vec2;
export declare function flee(agent: Agent, target: Vec2): Vec2;
export declare function arrive(agent: Agent, target: Vec2, slowRadius: number): Vec2;
export declare function pursue(agent: Agent, target: Agent): Vec2;
export declare function evade(agent: Agent, target: Agent): Vec2;
export declare function separation(agent: Agent, neighbours: ReadonlyArray<Vec2>, radius: number): Vec2;
export interface WanderState {
    angle: number;
}
export declare function wander(agent: Agent, state: WanderState, forwardDistance: number, jitter: number, rng?: () => number): Vec2;
export declare const RESOURCE_STEERING_BEHAVIORS = "steering_behaviors";
//# sourceMappingURL=steering-behaviors.d.ts.map