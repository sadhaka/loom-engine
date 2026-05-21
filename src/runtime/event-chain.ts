// EventChain - tamper-evident, HMAC-chained event log.
//
// 2.2.0 enabling primitive. The integrity-bearing sibling of EventLog
// (0.83.0): every appended record is signed with HMAC-SHA-256, and each
// signature folds in the PREVIOUS record's signature, so the whole log is a
// hash chain. verify() recomputes every signature AND checks the chain
// linkage, catching three distinct tamper classes a plain log cannot:
//
//   - field tampering   - a payload / type / seq was edited at rest
//   - record deletion   - a middle record was removed
//   - record reordering - records were shuffled
//
// Use it for audit trails, anti-cheat event tapes, economy / ledger logs, or
// any "prove this sequence was not altered" requirement. Ported from the
// server-authoritative event tape proven in TheWorldTable's LoomMaster
// backend (the same chain that guards its combat + currency ledger).
//
//   var chain = EventChain.create({ key: runtimeSecret });
//   chain.append('combat.hit', { target: 'goblin', dmg: 7 });
//   chain.append('xp.award',  { amount: 500 });
//   var result = chain.verify();   // { ok: true, total: 2, mismatches: [] }
//
// SCOPE: integrity, not secrecy. Payloads are stored in the clear; the
// signature proves they were not altered. The HMAC key is a runtime
// parameter, never persisted or logged by the engine. Output is
// self-consistent within the engine (sign + verify here) - it is NOT promised
// byte-compatible with other languages' JSON / HMAC framing.
//
// Pairs with EventLog (0.83.0), ReplayRecorder (0.60), hmacSha256 (2.2.0).
//
// Code style: var-only in browser source (matches event-log.ts).

import { hmacSha256Hex } from './hmac-sha256.js';

export interface ChainedRecord<T = unknown> {
  // Monotonic 1-based sequence number assigned at append time.
  seq: number;
  type: string;
  payload: T;
  // Signature of the previous record ('' or the genesis anchor for the first).
  prevSig: string;
  // HMAC-SHA-256 hex of this record; folds prevSig so the chain is linked.
  sig: string;
}

export interface EventChainOptions {
  // HMAC secret. REQUIRED, runtime-supplied. Never persisted or logged.
  key: string | Uint8Array;
  // Root prevSig for the very first record. Lets a consumer bind a chain to a
  // context (e.g. a world seed) so two chains with different roots never share
  // a prefix. Default ''.
  genesis?: string;
}

export interface ChainMismatch {
  seq: number;
  type: string;
  reason: 'sig_mismatch' | 'broken_chain_link';
}

export interface ChainVerifyResult {
  ok: boolean;
  total: number;
  mismatches: ChainMismatch[];
}

// Deterministic JSON: object keys sorted recursively so the signed message is
// stable regardless of insertion order. undefined / functions / symbols
// collapse to null (same as the structure JSON.stringify would drop).
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  var t = typeof value;
  if (t === 'number') return isFinite(value as number) ? String(value) : 'null';
  if (t === 'boolean') return (value as boolean) ? 'true' : 'false';
  if (t === 'string') return JSON.stringify(value);
  if (t !== 'object') return 'null'; // function / symbol / bigint
  if (Array.isArray(value)) {
    var items: string[] = [];
    for (var i = 0; i < value.length; i++) items.push(canonicalJson(value[i]));
    return '[' + items.join(',') + ']';
  }
  var obj = value as Record<string, unknown>;
  var keys = Object.keys(obj).sort();
  var pairs: string[] = [];
  for (var key of keys) {
    pairs.push(JSON.stringify(key) + ':' + canonicalJson(obj[key]));
  }
  return '{' + pairs.join(',') + '}';
}

// The exact byte string fed to HMAC for one record. prevSig is always folded
// in (prefixed 'prev:') so deletion / reordering changes every downstream sig.
function canonicalMessage(seq: number, type: string, payload: unknown, prevSig: string): string {
  return String(seq) + '|' + type + '|' + canonicalJson(payload) + '|prev:' + prevSig;
}

function cloneRecord<T>(r: ChainedRecord<T>): ChainedRecord<T> {
  return { seq: r.seq, type: r.type, payload: r.payload, prevSig: r.prevSig, sig: r.sig };
}

export class EventChain<T = unknown> {
  private records: Array<ChainedRecord<T>> = [];
  private key: string | Uint8Array;
  private genesis: string;
  private headSig: string;
  private nextSeq: number = 1;
  private disposed: boolean = false;

  private constructor(opts: EventChainOptions) {
    this.key = opts.key;
    this.genesis = typeof opts.genesis === 'string' ? opts.genesis : '';
    this.headSig = this.genesis;
  }

  static create<T = unknown>(opts: EventChainOptions): EventChain<T> {
    if (!opts || (typeof opts.key !== 'string' && !(opts.key instanceof Uint8Array))) {
      throw new Error('EventChain.create: opts.key (HMAC secret) is required');
    }
    if (typeof opts.key === 'string' && opts.key.length === 0) {
      throw new Error('EventChain.create: opts.key must not be empty');
    }
    return new EventChain<T>(opts);
  }

  // Sign one record's canonical message with the chain key.
  private sign(seq: number, type: string, payload: T, prevSig: string): string {
    return hmacSha256Hex(this.key, canonicalMessage(seq, type, payload, prevSig));
  }

  // Append + sign a record. Returns a clone of the stored record, or null on
  // rejection (disposed / bad type).
  append(type: string, payload: T): ChainedRecord<T> | null {
    if (this.disposed) return null;
    if (typeof type !== 'string' || type.length === 0) return null;
    var seq = this.nextSeq++;
    var prevSig = this.headSig;
    var sig = this.sign(seq, type, payload, prevSig);
    var rec: ChainedRecord<T> = { seq: seq, type: type, payload: payload, prevSig: prevSig, sig: sig };
    this.records.push(rec);
    this.headSig = sig;
    return cloneRecord(rec);
  }

  // Recompute every signature AND verify chain linkage. Pure over the records;
  // detects field tamper (sig_mismatch), deletion + reordering (broken_chain_link).
  verify(): ChainVerifyResult {
    return EventChain.verifyRecords<T>(this.key, this.records, this.genesis);
  }

  // Verify an EXTERNAL snapshot without an instance (e.g. records loaded from
  // disk or the network). Same key + genesis the chain was built with.
  static verifyRecords<T = unknown>(
    key: string | Uint8Array,
    records: ReadonlyArray<ChainedRecord<T>>,
    genesis: string = '',
  ): ChainVerifyResult {
    var mismatches: ChainMismatch[] = [];
    var prevActual = genesis;
    for (var i = 0; i < records.length; i++) {
      var rec = records[i] as ChainedRecord<T>;
      var expected = hmacSha256Hex(key, canonicalMessage(rec.seq, rec.type, rec.payload, rec.prevSig));
      if (expected !== rec.sig) {
        mismatches.push({ seq: rec.seq, type: rec.type, reason: 'sig_mismatch' });
      }
      // Link continuity: a deleted / reordered record makes the stored prevSig
      // disagree with the real predecessor's signature.
      if (rec.prevSig !== prevActual) {
        mismatches.push({ seq: rec.seq, type: rec.type, reason: 'broken_chain_link' });
      }
      prevActual = rec.sig;
    }
    return { ok: mismatches.length === 0, total: records.length, mismatches: mismatches };
  }

  bySeq(seq: number): ChainedRecord<T> | null {
    if (!isFinite(seq) || seq <= 0) return null;
    for (var i = 0; i < this.records.length; i++) {
      var r = this.records[i] as ChainedRecord<T>;
      if (r.seq === seq) return cloneRecord(r);
    }
    return null;
  }

  byType(type: string): ChainedRecord<T>[] {
    var out: ChainedRecord<T>[] = [];
    for (var i = 0; i < this.records.length; i++) {
      var r = this.records[i] as ChainedRecord<T>;
      if (r.type === type) out.push(cloneRecord(r));
    }
    return out;
  }

  list(): ChainedRecord<T>[] {
    var out: ChainedRecord<T>[] = [];
    for (var i = 0; i < this.records.length; i++) {
      out.push(cloneRecord(this.records[i] as ChainedRecord<T>));
    }
    return out;
  }

  // Current head signature - the value the NEXT append will fold in. Equals
  // the genesis anchor when the chain is empty.
  head(): string { return this.headSig; }

  size(): number { return this.records.length; }

  highWaterMark(): number { return this.nextSeq - 1; }

  // Snapshot for save / load / network sync. Records carry their own sigs so a
  // loaded snapshot is independently verifiable via EventChain.verifyRecords.
  toSnapshot(): ChainedRecord<T>[] {
    return this.list();
  }

  // Restore from a snapshot. Does NOT re-sign (sigs travel with the records);
  // call verify() afterward to confirm integrity. Rejects malformed rows.
  fromSnapshot(records: ChainedRecord<T>[]): void {
    if (this.disposed) return;
    if (!Array.isArray(records)) return;
    this.records = [];
    var maxSeq = 0;
    var lastSig = this.genesis;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (!r || typeof r !== 'object') continue;
      if (typeof r.seq !== 'number' || !isFinite(r.seq) || r.seq <= 0) continue;
      if (typeof r.type !== 'string' || r.type.length === 0) continue;
      if (typeof r.sig !== 'string' || typeof r.prevSig !== 'string') continue;
      this.records.push({ seq: r.seq, type: r.type, payload: r.payload, prevSig: r.prevSig, sig: r.sig });
      if (r.seq > maxSeq) maxSeq = r.seq;
      lastSig = r.sig;
    }
    this.nextSeq = maxSeq + 1;
    this.headSig = lastSig;
  }

  dispose(): void {
    this.records = [];
    this.headSig = '';
    // Drop the key reference so it is not retained after disposal.
    this.key = '';
    this.disposed = true;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_EVENT_CHAIN = 'event_chain';
