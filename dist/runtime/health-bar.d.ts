export interface HealthBarSpawn {
    entityId: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
}
export interface HealthBarRenderState {
    entityId: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    pct: number;
    alpha: number;
    pulse: number;
    msSinceLastDelta: number;
}
export interface HealthBarOptions {
    capacity?: number;
    fadeAfterMs?: number;
    fadeDurationMs?: number;
    pulseMs?: number;
    removeAfterMs?: number;
}
export declare class HealthBar {
    private byId;
    private capacityNum;
    private fadeAfterMs;
    private fadeDurationMs;
    private pulseMs;
    private removeAfterMs;
    private disposed;
    private constructor();
    static create(opts?: HealthBarOptions): HealthBar;
    upsert(spawn: HealthBarSpawn): number;
    setPosition(entityId: string, x: number, y: number): boolean;
    applyDelta(entityId: string, hpDelta: number): boolean;
    remove(entityId: string): boolean;
    clearAll(): void;
    has(entityId: string): boolean;
    activeCount(): number;
    capacity(): number;
    tick(dtMs: number): void;
    forEach(cb: (state: HealthBarRenderState) => void): void;
    dispose(): void;
    private makeRenderState;
}
export declare const RESOURCE_HEALTH_BAR = "health_bar";
//# sourceMappingURL=health-bar.d.ts.map