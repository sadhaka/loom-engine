// EventLog - structured replay-friendly event log.
//
// 0.83.0 enabling primitive. Different shape from LogRingBuffer
// (0.50): typed payloads instead of severity-filtered text. Used
// for recording game events (loot drop / boss spawn / quest
// completion) so replays / analytics / network sync can rebuild
// the timeline. Each append assigns a monotonic seq for
// replay-deterministic ordering; lookup by seq, by type, or via a
// predicate is O(n) over the log (caller indexes if needed).
//
//   var log = EventLog.create<MyEvent>({ capacity: 10000 });
//   log.append('loot.drop', { itemId: 'sword', x: 50, y: 30 });
//   var lootEvents = log.byType('loot.drop');
//
// Capacity-bounded: the oldest entries get evicted past capacity.
//
// Pairs with ReplayRecorder (0.60), DirectorEventLog, and
// EventBus (0.28).
//
// Code style: var-only in browser source.

export interface EventRecord<T = unknown> {
  // Monotonic 1-based sequence number assigned at append time.
  seq: number;
  type: string;
  payload: T;
}

export interface EventLogOptions {
  // Max entries kept. Older entries evicted past this. Default 10000.
  capacity?: number;
}

const DEFAULT_CAPACITY = 10000;

export class EventLog<T = unknown> {
  private records: Array<EventRecord<T>> = [];
  private capacityNum: number;
  private nextSeq: number = 1;
  private disposed: boolean = false;

  private constructor(opts: EventLogOptions) {
    this.capacityNum = opts.capacity !== undefined && isFinite(opts.capacity) && opts.capacity > 0
      ? Math.floor(opts.capacity) : DEFAULT_CAPACITY;
  }

  static create<T = unknown>(opts: EventLogOptions = {}): EventLog<T> {
    return new EventLog<T>(opts);
  }

  // Append a new record. Returns the assigned seq, or 0 on rejection.
  append(type: string, payload: T): number {
    if (this.disposed) return 0;
    if (typeof type !== 'string' || type.length === 0) return 0;
    var seq = this.nextSeq++;
    this.records.push({ seq: seq, type: type, payload: payload });
    if (this.records.length > this.capacityNum) {
      this.records.shift();
    }
    return seq;
  }

  bySeq(seq: number): EventRecord<T> | null {
    if (!isFinite(seq) || seq <= 0) return null;
    // Linear scan; consumers needing O(1) seq lookup should index
    // externally (records are immutable after append).
    for (var i = 0; i < this.records.length; i++) {
      var r = this.records[i] as EventRecord<T>;
      if (r.seq === seq) return cloneRecord(r);
    }
    return null;
  }

  byType(type: string): EventRecord<T>[] {
    var out: EventRecord<T>[] = [];
    for (var i = 0; i < this.records.length; i++) {
      var r = this.records[i] as EventRecord<T>;
      if (r.type === type) out.push(cloneRecord(r));
    }
    return out;
  }

  filter(pred: (rec: EventRecord<T>) => boolean): EventRecord<T>[] {
    var out: EventRecord<T>[] = [];
    for (var i = 0; i < this.records.length; i++) {
      var r = this.records[i] as EventRecord<T>;
      try {
        if (pred(r)) out.push(cloneRecord(r));
      } catch { /* ignore predicate errors */ }
    }
    return out;
  }

  list(): EventRecord<T>[] {
    var out: EventRecord<T>[] = [];
    for (var i = 0; i < this.records.length; i++) {
      out.push(cloneRecord(this.records[i] as EventRecord<T>));
    }
    return out;
  }

  forEach(cb: (rec: EventRecord<T>) => void): void {
    for (var i = 0; i < this.records.length; i++) {
      try { cb(this.records[i] as EventRecord<T>); } catch { /* ignore */ }
    }
  }

  clear(): void {
    if (this.disposed) return;
    this.records = [];
  }

  size(): number { return this.records.length; }

  capacity(): number { return this.capacityNum; }

  // Highest seq assigned so far (0 if log is empty + nothing
  // appended).
  highWaterMark(): number { return this.nextSeq - 1; }

  // Snapshot for save / load / network sync.
  toSnapshot(): EventRecord<T>[] {
    return this.list();
  }

  fromSnapshot(records: EventRecord<T>[]): void {
    if (this.disposed) return;
    if (!Array.isArray(records)) return;
    this.records = [];
    var maxSeq = 0;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (!r || typeof r !== 'object') continue;
      if (typeof r.seq !== 'number' || !isFinite(r.seq) || r.seq <= 0) continue;
      if (typeof r.type !== 'string' || r.type.length === 0) continue;
      this.records.push({ seq: r.seq, type: r.type, payload: r.payload });
      if (r.seq > maxSeq) maxSeq = r.seq;
    }
    // Continue numbering after the highest seen.
    this.nextSeq = maxSeq + 1;
    while (this.records.length > this.capacityNum) this.records.shift();
  }

  dispose(): void {
    this.records = [];
    this.disposed = true;
  }
}

function cloneRecord<T>(r: EventRecord<T>): EventRecord<T> {
  return { seq: r.seq, type: r.type, payload: r.payload };
}

// Resource key for the world's resource registry.
export const RESOURCE_EVENT_LOG = 'event_log';
