// SSEDirectorBridge - real EventSource subscription to the backend's
// /api/v1/loom/director/events endpoint.
//
// Per LOOM-DIRECTOR-PROTOCOL.md Section 2: SSE primary, native
// EventSource auto-reconnect with Last-Event-ID, JSON payload per
// frame. The renderer never decides palette or VE tier (Section 5.1,
// 6.5); it just receives events and feeds them to DirectorSystem.
//
// Reconnect strategy (Section 4):
//   - EventSource handles transport-layer reconnect on its own with
//     exponential backoff. We just observe via onerror/onopen.
//   - On a clean reconnect with Last-Event-ID set automatically by
//     the browser, server replays the gap and emits
//     system.replay.complete.
//   - On a hard gap (system.snapshot.required), bridge stops; the
//     consumer is responsible for fetching /state and constructing
//     a fresh bridge with the new tail id.
//
// Browser-only. Constructor throws if EventSource is undefined (Node
// test environment). Tests use MockDirectorBridge instead.

import type { DirectorEvent } from './event-envelope.js';
import { parseEnvelopeJson } from './event-envelope.js';
import {
  type IDirectorBridge,
  type DirectorBridgeStatus,
  type DirectorBridgeStats,
} from './director-bridge.js';

export interface SSEDirectorBridgeOptions {
  // Full URL to the SSE endpoint, e.g.
  // 'https://theworldtable.ai/api/v1/loom/director/events'. The
  // bridge appends ?character_id=... + reconnect-friendly query
  // params per spec Section 7.1.
  baseUrl: string;
  // Required: which character to subscribe to.
  characterId: string;
  // Optional renderer fps hint (Section 7.1). Default 60.
  fps?: number;
  // Optional drop-P2 authorization (Section 7.1). Default true.
  dropP2?: boolean;
  // Optional injection point for headless tests of the bridge itself.
  // Production code never sets this.
  eventSourceFactory?: (url: string) => EventSource;
  // Optional starting Last-Event-ID. Set by the application after a
  // snapshot recovery flow so that any events <= initialLastEventId
  // arriving on the new SSE connection are silently deduped (treated
  // as past replays). Without this, post-snapshot reconnects would
  // re-apply state already covered by the snapshot.
  // Per LOOM-DIRECTOR-PROTOCOL.md §3.11 / Phase 6.5 contract.
  initialLastEventId?: number;
}

export class SSEDirectorBridge implements IDirectorBridge {
  private readonly baseUrl: string;
  private readonly characterId: string;
  private readonly fps: number;
  private readonly dropP2: boolean;
  private readonly eventSourceFactory: (url: string) => EventSource;

  private es: EventSource | null = null;
  private queue: DirectorEvent[] = [];
  private statusValue: DirectorBridgeStatus = 'idle';
  private statsValue: DirectorBridgeStats = {
    eventsReceived: 0,
    reconnects: 0,
    lastEventId: 0,
    outOfOrderEvents: 0,
    serverDropsP1: 0,
    serverDropsP2: 0,
  };

  // Reorder buffer (Section 4.2). Max 32 entries; drained when the
  // missing id arrives or after a 500ms timeout that triggers reconnect.
  private reorderBuffer: Map<number, DirectorEvent> = new Map();
  private reorderTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private static readonly REORDER_BUFFER_MAX = 32;
  private static readonly REORDER_TIMEOUT_MS = 500;

  constructor(opts: SSEDirectorBridgeOptions) {
    this.baseUrl = opts.baseUrl;
    this.characterId = opts.characterId;
    this.fps = opts.fps ?? 60;
    this.dropP2 = opts.dropP2 ?? true;
    if (typeof opts.initialLastEventId === 'number' && opts.initialLastEventId > 0) {
      this.statsValue.lastEventId = opts.initialLastEventId;
    }
    if (opts.eventSourceFactory) {
      this.eventSourceFactory = opts.eventSourceFactory;
    } else {
      if (typeof EventSource === 'undefined') {
        throw new Error('SSEDirectorBridge: EventSource is not available in this environment. Use MockDirectorBridge for tests.');
      }
      const ESCtor = EventSource;
      this.eventSourceFactory = (u: string) => new ESCtor(u, { withCredentials: true });
    }
  }

  start(): void {
    if (this.es) return;
    this.statusValue = 'connecting';
    this.openConnection();
  }

  stop(): void {
    this.statusValue = 'closed';
    this.closeConnection();
    this.clearReorderBuffer();
  }

  status(): DirectorBridgeStatus {
    return this.statusValue;
  }

  isConnected(): boolean {
    return this.statusValue === 'connected';
  }

  getLastEventId(): number {
    return this.statsValue.lastEventId;
  }

  pollEvents(): DirectorEvent[] {
    if (this.queue.length === 0) return [];
    const out = this.queue;
    this.queue = [];
    return out;
  }

  stats(): Readonly<DirectorBridgeStats> {
    return this.statsValue;
  }

  // ----- Internal -----

  private buildUrl(): string {
    const sep = this.baseUrl.includes('?') ? '&' : '?';
    return (
      this.baseUrl +
      sep +
      'character_id=' + encodeURIComponent(this.characterId) +
      '&fps=' + this.fps +
      '&drop_p2=' + (this.dropP2 ? 'true' : 'false')
    );
  }

  private openConnection(): void {
    const url = this.buildUrl();
    let es: EventSource;
    try {
      es = this.eventSourceFactory(url);
    } catch (err) {
      this.statusValue = 'closed';
      throw err;
    }
    this.es = es;
    es.onopen = () => {
      this.statusValue = 'connected';
    };
    es.onerror = () => {
      // EventSource handles its own retry. We just track the state
      // change so consumers can render a 'reconnecting' indicator.
      // If readyState is CLOSED, we're done; otherwise reconnect is
      // in progress.
      const closed = es.readyState === 2;   // EventSource.CLOSED
      if (closed) {
        this.statusValue = 'closed';
        this.closeConnection();
        return;
      }
      this.statusValue = 'reconnecting';
      this.statsValue.reconnects++;
    };
    // The default 'message' event captures frames with no event: line.
    // The backend uses event: <type> for everything per spec, so we
    // route on the 'event' name. Subscribing to a few key types
    // explicitly keeps EventSource from coalescing them under 'message'.
    es.onmessage = (e: MessageEvent) => {
      this.handleRaw(e);
    };

    // Subscribe to all known event types so EventSource fires the
    // type-specific listener, not just onmessage. This makes the SSE
    // 'event:' line meaningful.
    const knownTypes: string[] = [
      'encounter.spawn',
      'encounter.tick',
      'encounter.end',
      'encounter.loot',
      'knot.context',
      've.budget.update',
      'scene.transition',
      'narrator.line',
      'system.heartbeat',
      'system.replay.complete',
      'system.snapshot.required',
    ];
    for (let i = 0; i < knownTypes.length; i++) {
      const t = knownTypes[i];
      if (!t) continue;
      es.addEventListener(t, (e: Event) => {
        this.handleRaw(e as MessageEvent);
      });
    }
  }

  private closeConnection(): void {
    if (!this.es) return;
    try { this.es.close(); } catch { /* ignore */ }
    this.es = null;
  }

  private handleRaw(e: MessageEvent): void {
    const dataStr = typeof e.data === 'string' ? e.data : '';
    const ev = parseEnvelopeJson(dataStr);
    if (!ev) {
      // Malformed envelope - log + drop. EventSource will keep flowing.
      // In v1 we don't kill the stream on a single bad payload.
      return;
    }
    this.statsValue.eventsReceived++;

    // System events drive bridge behaviour even if the consumer
    // hasn't drained yet.
    if (ev.type === 'system.heartbeat') {
      this.statsValue.serverDropsP1 = ev.data.drops_p1;
      this.statsValue.serverDropsP2 = ev.data.drops_p2;
      // Heartbeats are still surfaced to the consumer (it may want to
      // log / display drop counters) but they don't gate the gap-
      // detection logic - just stash and pass through.
    }
    if (ev.type === 'system.snapshot.required') {
      this.statusValue = 'snapshot-required';
      // Surface to the consumer + close. The application layer must
      // fetch /state and build a fresh bridge.
      this.queue.push(ev);
      this.closeConnection();
      return;
    }

    const expected = this.statsValue.lastEventId + 1;
    if (ev.id === expected) {
      // In-order. Push + drain any reorder buffer entries that now
      // contiguously follow.
      this.statsValue.lastEventId = ev.id;
      this.queue.push(ev);
      this.drainReorderBuffer();
    } else if (ev.id > expected) {
      // Future event - hold in reorder buffer up to REORDER_BUFFER_MAX.
      // Reset the timeout so the buffer fires eventually.
      this.statsValue.outOfOrderEvents++;
      if (this.reorderBuffer.size < SSEDirectorBridge.REORDER_BUFFER_MAX) {
        this.reorderBuffer.set(ev.id, ev);
        this.armReorderTimeout();
      } else {
        // Buffer full - hard gap. Force-flush the buffer in id order
        // and accept the gap. Consumer's gap detection should treat
        // this like a missed range.
        this.flushReorderBufferAsIs();
        this.statsValue.lastEventId = ev.id;
        this.queue.push(ev);
      }
    } else {
      // Past event (lastEventId already advanced beyond this). Likely
      // a duplicate from EventSource's at-least-once delivery during
      // reconnect; drop silently.
    }
  }

  private armReorderTimeout(): void {
    if (this.reorderTimeoutHandle !== null) return;
    this.reorderTimeoutHandle = setTimeout(() => {
      this.reorderTimeoutHandle = null;
      // Timeout: flush whatever's in the buffer in id order. The
      // missing ids are skipped; consumer's lastEventId advances.
      this.flushReorderBufferAsIs();
    }, SSEDirectorBridge.REORDER_TIMEOUT_MS);
  }

  private drainReorderBuffer(): void {
    while (true) {
      const next = this.statsValue.lastEventId + 1;
      const ev = this.reorderBuffer.get(next);
      if (!ev) break;
      this.reorderBuffer.delete(next);
      this.statsValue.lastEventId = next;
      this.queue.push(ev);
    }
    if (this.reorderBuffer.size === 0 && this.reorderTimeoutHandle !== null) {
      clearTimeout(this.reorderTimeoutHandle);
      this.reorderTimeoutHandle = null;
    }
  }

  private flushReorderBufferAsIs(): void {
    if (this.reorderBuffer.size === 0) return;
    const ids = Array.from(this.reorderBuffer.keys()).sort((a, b) => a - b);
    for (const id of ids) {
      const ev = this.reorderBuffer.get(id);
      if (!ev) continue;
      this.queue.push(ev);
      if (id > this.statsValue.lastEventId) this.statsValue.lastEventId = id;
    }
    this.reorderBuffer.clear();
    if (this.reorderTimeoutHandle !== null) {
      clearTimeout(this.reorderTimeoutHandle);
      this.reorderTimeoutHandle = null;
    }
  }

  private clearReorderBuffer(): void {
    this.reorderBuffer.clear();
    if (this.reorderTimeoutHandle !== null) {
      clearTimeout(this.reorderTimeoutHandle);
      this.reorderTimeoutHandle = null;
    }
  }
}
