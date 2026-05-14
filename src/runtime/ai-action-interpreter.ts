// AIActionInterpreter - parse untrusted LLM action output into a
// validated ring buffer of (npcId, actionId, targetId) records.
//
// An LLM (or SLM) producing NPC behaviour emits lines of text; this
// turns that text into integer action records the simulation can
// consume, rejecting anything malformed. The Trinity dossier's
// section 8.
//
// The Gemini sketch scanned a fixed 10-byte "ID:ACTION" stride - the
// Codex audit rejected it outright as hostile-input unsafe. Real LLM
// output has variable-length numbers, stray whitespace, CRLF, partial
// trailing lines, and outright garbage. This parser is line-delimited
// and strict: a valid line is exactly three comma-separated runs of
// ASCII digits - "npcId,actionId,targetId" - terminated by '\n'
// (a trailing '\r' is tolerated). Anything else is rejected and
// counted, never thrown: malformed input is the expected case for an
// LLM, not an exception.
//
// Storage is one flat Uint32Array ring of RECORD_STRIDE u32 per slot.
// It allocates nothing after the constructor, and parsing is
// allocation-free too (charCodeAt + indexOf scanning, no split, no
// substring, no per-line objects).
//
// The Codex gates, enforced:
//   1. maxQueueSize must be a power of two; usable capacity is
//      maxQueueSize - 1 (one slot separates "empty" from "full").
//   2. malformed rows, CRLF issues, partial final lines, and
//      negative / oversized IDs are all rejected and counted - parse
//      never throws on bad content.
//   3. npcId and targetId are bounds-checked against maxEntityId.
//   4. action IDs are kept as plain non-negative u32 integers - the
//      parser never trusts the LLM's text for anything beyond "is
//      this a digit run that fits u32"; semantic validity (is this a
//      real action?) is the consumer's job.
//   5. single owner - one AIActionInterpreter owns its ring; parse()
//      is the only writer, pop() the only reader, single-threaded.
//      An SAB + Atomics multi-thread variant is out of scope.
//   6. no SpatialGrid dependency - a pure text parser does not need
//      spatial adjacency; validating a parsed action against the
//      world is a separate consumer concern. The dossier's gate-6
//      "remove dependency" option, satisfied by construction.

// u32 per ring slot: [npcId, actionId, targetId].
const RECORD_STRIDE = 3;
// Sanity cap on the ring slot count.
const MAX_QUEUE_SIZE = 1 << 20;
// Largest representable u32 - the ceiling every parsed field is held
// under so digit accumulation never loses precision.
const U32_MAX = 0xffffffff;
// ASCII codes the scanner recognises.
const CHAR_0 = 48;
const CHAR_9 = 57;
const CHAR_NEWLINE = 10;
const CHAR_CR = 13;

// Parse input[start, end) as a non-negative decimal integer. Returns
// the value, or -1 if the range is empty, holds a non-digit, or
// overflows u32. Allocation-free.
function parseUintField(input: string, start: number, end: number): number {
  if (end <= start) return -1;
  let value = 0;
  for (let i = start; i < end; i++) {
    const code = input.charCodeAt(i);
    if (code < CHAR_0 || code > CHAR_9) return -1;
    value = value * 10 + (code - CHAR_0);
    if (value > U32_MAX) return -1;
  }
  return value;
}

export interface ParseStats {
  // Valid records pushed into the ring this call.
  accepted: number;
  // Lines rejected as malformed: wrong field count, a non-digit
  // field, an oversized or out-of-range id, or an unterminated
  // partial final line.
  rejected: number;
  // Valid records that could not be pushed because the ring was full
  // - bounded-queue backpressure, never an overwrite of a queued
  // record.
  dropped: number;
}

export class AIActionInterpreter {
  // Ring slot count - a power of two. Usable capacity is one less.
  readonly maxQueueSize: number;
  // Inclusive upper bound for npcId and targetId.
  readonly maxEntityId: number;

  // maxQueueSize * RECORD_STRIDE u32: [npcId, actionId, targetId]
  // per slot.
  private readonly ring: Uint32Array;
  // maxQueueSize - 1 - the wrap mask for head / tail.
  private readonly mask: number;
  // Read cursor (next pop) and write cursor (next push), in record
  // units. head === tail is empty; advancing tail into head is full.
  private head: number = 0;
  private tail: number = 0;

  constructor(maxQueueSize: number, maxEntityId: number) {
    if (!Number.isInteger(maxQueueSize) || maxQueueSize < 2 || maxQueueSize > MAX_QUEUE_SIZE
        || (maxQueueSize & (maxQueueSize - 1)) !== 0) {
      throw new RangeError(
        'AIActionInterpreter: maxQueueSize must be a power of two in [2, '
        + MAX_QUEUE_SIZE + '], got ' + maxQueueSize,
      );
    }
    if (!Number.isInteger(maxEntityId) || maxEntityId < 0 || maxEntityId > U32_MAX) {
      throw new RangeError(
        'AIActionInterpreter: maxEntityId must be an integer in [0, ' + U32_MAX + '], got ' + maxEntityId,
      );
    }
    this.maxQueueSize = maxQueueSize;
    this.maxEntityId = maxEntityId;
    this.mask = maxQueueSize - 1;
    this.ring = new Uint32Array(maxQueueSize * RECORD_STRIDE);
  }

  // Usable record capacity: one slot is always kept free so head ===
  // tail unambiguously means empty.
  get capacity(): number {
    return this.maxQueueSize - 1;
  }

  count(): number {
    return (this.tail - this.head) & this.mask;
  }

  isEmpty(): boolean {
    return this.head === this.tail;
  }

  isFull(): boolean {
    return ((this.tail + 1) & this.mask) === this.head;
  }

  // Drop every queued record. The ring memory is left as-is; pushes
  // overwrite it.
  clear(): void {
    this.head = 0;
    this.tail = 0;
  }

  // Pop the oldest record into `out` as [npcId, actionId, targetId] -
  // a direct SoA write, no allocation. Returns false (and leaves
  // `out` untouched) when the ring is empty.
  pop(out: Uint32Array): boolean {
    if (out.length < RECORD_STRIDE) {
      throw new RangeError(
        'AIActionInterpreter.pop: out must hold at least ' + RECORD_STRIDE + ' u32, got ' + out.length,
      );
    }
    if (this.head === this.tail) return false;
    const base = this.head * RECORD_STRIDE;
    out[0] = this.ring[base] ?? 0;
    out[1] = this.ring[base + 1] ?? 0;
    out[2] = this.ring[base + 2] ?? 0;
    this.head = (this.head + 1) & this.mask;
    return true;
  }

  // Push a validated record. Returns false if the ring is full
  // (bounded-queue backpressure - the record is dropped, never
  // overwriting a queued one).
  private pushRecord(npcId: number, actionId: number, targetId: number): boolean {
    if (((this.tail + 1) & this.mask) === this.head) return false;
    const base = this.tail * RECORD_STRIDE;
    this.ring[base] = npcId;
    this.ring[base + 1] = actionId;
    this.ring[base + 2] = targetId;
    this.tail = (this.tail + 1) & this.mask;
    return true;
  }

  // Parse line-delimited LLM output and push every valid record into
  // the ring. A valid line is exactly "npcId,actionId,targetId" -
  // three comma-separated runs of ASCII digits - terminated by '\n'
  // (a trailing '\r' is tolerated). Returns the accepted / rejected /
  // dropped counts. Never throws on bad content (gate 2) - treating
  // LLM output as untrusted is the whole point.
  parse(input: string): ParseStats {
    let accepted = 0;
    let rejected = 0;
    let dropped = 0;
    let lineStart = 0;
    const len = input.length;

    for (let i = 0; i < len; i++) {
      if (input.charCodeAt(i) !== CHAR_NEWLINE) continue;
      // A complete, '\n'-terminated line is [start, end); end strips
      // a trailing '\r' so CRLF is tolerated.
      const start = lineStart;
      let end = i;
      if (end > start && input.charCodeAt(end - 1) === CHAR_CR) end--;
      lineStart = i + 1;
      if (end <= start) continue;   // blank line - not a row, skip silently

      // indexOf scans the whole rest of the string, so a comma found
      // at or past `end` belongs to a later line - reject this one.
      const c1 = input.indexOf(',', start);
      if (c1 < 0 || c1 >= end) { rejected++; continue; }
      const c2 = input.indexOf(',', c1 + 1);
      if (c2 < 0 || c2 >= end) { rejected++; continue; }
      const c3 = input.indexOf(',', c2 + 1);
      if (c3 >= 0 && c3 < end) { rejected++; continue; }   // a fourth field

      const npcId = parseUintField(input, start, c1);
      const actionId = parseUintField(input, c1 + 1, c2);
      const targetId = parseUintField(input, c2 + 1, end);
      if (npcId < 0 || actionId < 0 || targetId < 0) { rejected++; continue; }
      if (npcId > this.maxEntityId || targetId > this.maxEntityId) { rejected++; continue; }

      if (this.pushRecord(npcId, actionId, targetId)) accepted++;
      else dropped++;
    }

    // Trailing content with no terminating '\n' is a partial final
    // line - it may be truncated, so it is rejected (gate 2).
    let tailEnd = len;
    if (tailEnd > lineStart && input.charCodeAt(tailEnd - 1) === CHAR_CR) tailEnd--;
    if (tailEnd > lineStart) rejected++;

    return { accepted, rejected, dropped };
  }
}
