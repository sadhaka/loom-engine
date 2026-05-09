export interface PhaseBoundary {
    name: string;
    startHour: number;
}
export interface TimeOfDayOptions {
    dayLengthMs?: number;
    initialHour?: number;
    phases?: PhaseBoundary[];
    onPhaseChanged?: (next: string, prev: string | null) => void;
}
export declare class TimeOfDay {
    private dayLengthMs;
    private phases;
    private onPhaseChanged;
    private hour;
    private currentPhaseName;
    private dayCount;
    private disposed;
    private constructor();
    static create(opts?: TimeOfDayOptions): TimeOfDay;
    tick(dtMs: number): void;
    getHour(): number;
    getDayCount(): number;
    getPhase(): string | null;
    getPhases(): PhaseBoundary[];
    setHour(hour: number): void;
    setDayLengthMs(ms: number): void;
    getDayLengthMs(): number;
    dispose(): void;
    private normalizePhases;
    private findPhaseForHour;
    private checkPhase;
}
export declare const RESOURCE_TIME_OF_DAY = "time_of_day";
//# sourceMappingURL=time-of-day.d.ts.map