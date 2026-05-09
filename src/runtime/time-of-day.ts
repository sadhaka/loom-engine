// TimeOfDay - day/night cycle with named phase transitions.
//
// 0.70.0 enabling primitive. Outdoor zones often have a day/night
// cycle that drives lighting, encounter pools, NPC schedules, and
// audio ambience. TimeOfDay tracks an in-game clock with a tick-
// driven scaling factor (one wall-clock minute = N in-game hours)
// and emits onPhaseChanged callbacks when the clock crosses
// configurable phase boundaries (dawn, day, dusk, night).
//
//   var tod = TimeOfDay.create({
//     dayLengthMs: 60 * 60 * 1000, // 1h real = 1 game day
//     phases: [
//       { name: 'dawn',  startHour: 5  },
//       { name: 'day',   startHour: 7  },
//       { name: 'dusk',  startHour: 18 },
//       { name: 'night', startHour: 20 },
//     ],
//     onPhaseChanged: (next, prev) => audio.crossfade(next),
//   });
//   each frame: tod.tick(dtMs);
//
// Code style: var-only in browser source.

export interface PhaseBoundary {
  name: string;
  // 24-hour clock; phase starts when the in-game clock crosses
  // this hour (0-24, fractional allowed).
  startHour: number;
}

export interface TimeOfDayOptions {
  // Real-time ms that maps to one in-game day (24 in-game hours).
  // Default 24*60*60*1000 = 1 real day (no acceleration).
  dayLengthMs?: number;
  // Initial in-game hour [0, 24). Default 8 (morning).
  initialHour?: number;
  // Sorted-by-startHour phase boundaries. Default empty (no
  // phases / no callbacks).
  phases?: PhaseBoundary[];
  // Fired when the clock crosses into a new phase.
  onPhaseChanged?: (next: string, prev: string | null) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class TimeOfDay {
  private dayLengthMs: number;
  private phases: PhaseBoundary[];
  private onPhaseChanged: ((n: string, p: string | null) => void) | null;
  // Fractional hour [0, 24).
  private hour: number;
  private currentPhaseName: string | null = null;
  private dayCount: number = 0;
  private disposed: boolean = false;

  private constructor(opts: TimeOfDayOptions) {
    this.dayLengthMs = opts.dayLengthMs !== undefined && opts.dayLengthMs > 0
      ? opts.dayLengthMs : DAY_MS;
    this.hour = opts.initialHour !== undefined ? wrapHour(opts.initialHour) : 8;
    this.phases = opts.phases ? this.normalizePhases(opts.phases) : [];
    this.onPhaseChanged = opts.onPhaseChanged ?? null;
    // Compute initial phase without firing the callback - that's
    // the caller's responsibility to seed via getPhase() if they
    // want.
    this.currentPhaseName = this.findPhaseForHour(this.hour);
  }

  static create(opts: TimeOfDayOptions = {}): TimeOfDay {
    return new TimeOfDay(opts);
  }

  // Advance by dtMs of real time. Updates the in-game hour;
  // wraps past 24 (and increments dayCount).
  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var hourDelta = (dt / this.dayLengthMs) * 24;
    var newHour = this.hour + hourDelta;
    while (newHour >= 24) {
      newHour -= 24;
      this.dayCount++;
    }
    this.hour = newHour;
    this.checkPhase();
  }

  // Current in-game hour (0-24, fractional).
  getHour(): number { return this.hour; }

  // Number of full days that have elapsed since construction.
  getDayCount(): number { return this.dayCount; }

  // The phase the clock is currently within (null if no phases or
  // hour falls outside any defined phase).
  getPhase(): string | null { return this.currentPhaseName; }

  // List configured phase boundaries (defensive copy).
  getPhases(): PhaseBoundary[] {
    return this.phases.map((p) => ({ name: p.name, startHour: p.startHour }));
  }

  // Manually set the in-game hour. Wraps to [0, 24). Fires
  // onPhaseChanged if the new hour falls in a different phase.
  setHour(hour: number): void {
    if (this.disposed) return;
    this.hour = wrapHour(hour);
    this.checkPhase();
  }

  // Update the day-length (acceleration factor). Default is real-
  // time (1 day = 24 hours of wall clock).
  setDayLengthMs(ms: number): void {
    if (this.disposed) return;
    if (ms > 0) this.dayLengthMs = ms;
  }

  getDayLengthMs(): number { return this.dayLengthMs; }

  dispose(): void {
    this.phases = [];
    this.onPhaseChanged = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private normalizePhases(phases: PhaseBoundary[]): PhaseBoundary[] {
    var copy = phases.map((p) => ({
      name: p.name,
      startHour: wrapHour(p.startHour),
    }));
    copy.sort(function (a, b) { return a.startHour - b.startHour; });
    return copy;
  }

  private findPhaseForHour(hour: number): string | null {
    if (this.phases.length === 0) return null;
    // Walk from latest startHour <= hour. Phases wrap modulo 24:
    // if no phase has startHour <= hour, the LAST phase (highest
    // startHour) is the one we're in (we wrapped past midnight
    // from yesterday's last phase).
    var current: string | null = null;
    for (var i = 0; i < this.phases.length; i++) {
      var p = this.phases[i] as PhaseBoundary;
      if (p.startHour <= hour) current = p.name;
    }
    if (current === null) {
      // No phase started yet today; we're still in yesterday's
      // last phase.
      var last = this.phases[this.phases.length - 1] as PhaseBoundary;
      current = last.name;
    }
    return current;
  }

  private checkPhase(): void {
    var next = this.findPhaseForHour(this.hour);
    if (next !== this.currentPhaseName) {
      var prev = this.currentPhaseName;
      this.currentPhaseName = next;
      if (this.onPhaseChanged && next !== null) {
        try { this.onPhaseChanged(next, prev); } catch { /* ignore */ }
      }
    }
  }
}

function wrapHour(h: number): number {
  if (!isFinite(h)) return 0;
  var hh = h % 24;
  if (hh < 0) hh += 24;
  return hh;
}

// Resource key for the world's resource registry.
export const RESOURCE_TIME_OF_DAY = 'time_of_day';
