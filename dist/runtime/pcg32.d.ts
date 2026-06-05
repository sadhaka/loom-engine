export interface Pcg32State {
    state: bigint;
    inc: bigint;
    draws: number;
}
export declare class Pcg32 {
    static MULT: bigint;
    static DEFAULT_STREAM: bigint;
    private state;
    private inc;
    private draws;
    constructor(seed: bigint, seq: bigint);
    static seeded(seed: bigint): Pcg32;
    static fromRaw(rawState: bigint, rawInc: bigint): Pcg32;
    getDraws(): number;
    snapshot(): Pcg32State;
    restore(s: Pcg32State): void;
    nextU32(): number;
    boundedU32(bound: number): number;
    rollDie(sides: number): number;
    rollDice(count: number, sides: number): number;
}
//# sourceMappingURL=pcg32.d.ts.map