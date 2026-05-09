export interface DamageFlashSpawn {
    entityId: string;
    color?: number;
    durationMs?: number;
    intensity?: number;
}
export interface DamageFlashRenderState {
    entityId: string;
    color: number;
    alpha: number;
    intensity: number;
    ageMs: number;
    durationMs: number;
}
export interface DamageFlashOptions {
    capacity?: number;
    defaultColor?: number;
    defaultDurationMs?: number;
}
export declare class DamageFlash {
    private byId;
    private capacityNum;
    private defaultColor;
    private defaultDurationMs;
    private disposed;
    private constructor();
    static create(opts?: DamageFlashOptions): DamageFlash;
    flash(spawn: DamageFlashSpawn): boolean;
    remove(entityId: string): boolean;
    has(entityId: string): boolean;
    activeCount(): number;
    capacity(): number;
    tick(dtMs: number): void;
    forEach(cb: (state: DamageFlashRenderState) => void): void;
    clearAll(): void;
    dispose(): void;
    private computeAlpha;
}
export declare const RESOURCE_DAMAGE_FLASH = "damage_flash";
//# sourceMappingURL=damage-flash.d.ts.map