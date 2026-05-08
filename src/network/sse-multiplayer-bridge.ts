// SSEMultiplayerBridge - real EventSource subscription to the
// backend's presence endpoint, paired with a fetch POST for outbound
// position broadcasts.
//
// Wire protocol (paired with Track B server-side):
//   GET <baseUrl>?character_id=...&zone=... opens an SSE stream that
//   emits three event types:
//     - 'presence.snapshot' { peers: [{ character_id, x, y, zone, ts_ms, name? }] }
//         emitted once on connect with the full current peer roster.
//     - 'presence.update'   { character_id, x, y, zone, ts_ms, name? }
//         emitted as peers move.
//     - 'presence.depart'   { character_id }
//         emitted when a peer disconnects.
//
//   POST <broadcastUrl> { character_id, x, y, zone, ts_ms }
//     called by broadcastPosition at most BROADCAST_HZ per second.
//     Engine-side rate limit; the bridge silently drops excess calls
//     and increments rateLimitedDrops.
//
// Reconnect strategy: EventSource handles transport-layer reconnect
// internally. We observe via onerror/onopen and surface 'reconnecting'
// to the consumer. On reconnect the server is expected to re-emit a
// fresh 'presence.snapshot', which the PeerPool consumes and treats
// as authoritative (any peer not in the snapshot is dropped).
//
// Browser-only. Constructor throws if EventSource is undefined (Node
// test environment). Tests use MockMultiplayerBridge instead.

import {
  type IMultiplayerBridge,
  type MultiplayerBridgeStatus,
  type MultiplayerBridgeStats,
  type PresenceMessage,
  BROADCAST_MIN_INTERVAL_MS,
} from './multiplayer-bridge.js';

export interface SSEMultiplayerBridgeOptions {
  // Full URL to the SSE endpoint, e.g.
  // 'https://theworldtable.ai/api/v1/loom/presence/events'. The
  // bridge appends ?character_id=... + zone=... query params.
  baseUrl: string;
  // URL the bridge POSTs outbound position frames to, e.g.
  // 'https://theworldtable.ai/api/v1/loom/presence/move'. Defaults
  // to baseUrl with /events replaced by /move if not provided; if
  // baseUrl doesn't end in /events the default is baseUrl + '/move'.
  broadcastUrl?: string;
  // Required: which character is the local player. Sent on the SSE
  // query string and on every broadcast POST. Also used for
  // self-filtering in PeerPresenceSystem.
  characterId: string;
  // Zone scope. Server filters peer events to those in the same zone.
  zone: string;
  // Optional injection points for headless tests of the bridge itself.
  // Production code never sets these.
  eventSourceFactory?: (url: string) => EventSource;
  fetchFn?: typeof fetch;
}

export class SSEMultiplayerBridge implements IMultiplayerBridge {
  private readonly baseUrl: string;
  private readonly broadcastUrl: string;
  private readonly characterId: string;
  private readonly zone: string;
  private readonly eventSourceFactory: (url: string) => EventSource;
  private readonly fetchFn: typeof fetch;

  private es: EventSource | null = null;
  private queue: PresenceMessage[] = [];
  private statusValue: MultiplayerBridgeStatus = 'idle';
  private statsValue: MultiplayerBridgeStats = {
    messagesReceived: 0,
    messagesSent: 0,
    rateLimitedDrops: 0,
    reconnects: 0,
  };

  private lastBroadcastMs: number = -Infinity;

  constructor(opts: SSEMultiplayerBridgeOptions) {
    this.baseUrl = opts.baseUrl;
    this.broadcastUrl = opts.broadcastUrl ?? defaultBroadcastUrl(opts.baseUrl);
    this.characterId = opts.characterId;
    this.zone = opts.zone;
    if (opts.eventSourceFactory) {
      this.eventSourceFactory = opts.eventSourceFactory;
    } else {
      if (typeof EventSource === 'undefined') {
        throw new Error('SSEMultiplayerBridge: EventSource is not available in this environment. Use MockMultiplayerBridge for tests.');
      }
      const ESCtor = EventSource;
      this.eventSourceFactory = (u: string) => new ESCtor(u, { withCredentials: true });
    }
    if (opts.fetchFn) {
      this.fetchFn = opts.fetchFn;
    } else {
      if (typeof fetch === 'undefined') {
        throw new Error('SSEMultiplayerBridge: fetch is not available in this environment.');
      }
      this.fetchFn = fetch.bind(globalThis);
    }
  }

  connect(): void {
    if (this.es) return;
    this.statusValue = 'connecting';
    this.openConnection();
  }

  disconnect(): void {
    this.statusValue = 'closed';
    this.closeConnection();
  }

  status(): MultiplayerBridgeStatus {
    return this.statusValue;
  }

  pollMessages(): PresenceMessage[] {
    if (this.queue.length === 0) return [];
    const out = this.queue;
    this.queue = [];
    return out;
  }

  broadcastPosition(x: number, y: number, zone: string, tsMs: number): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastBroadcastMs < BROADCAST_MIN_INTERVAL_MS) {
      this.statsValue.rateLimitedDrops++;
      return;
    }
    this.lastBroadcastMs = now;
    this.statsValue.messagesSent++;
    // Fire-and-forget POST. Errors are surfaced via stats only - the
    // engine doesn't block on the network round trip. The body
    // matches the server contract from the phase 15.1 spec.
    const body = JSON.stringify({
      character_id: this.characterId,
      x,
      y,
      zone,
      ts_ms: tsMs,
    });
    void this.fetchFn(this.broadcastUrl, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => { /* fire-and-forget */ });
  }

  stats(): Readonly<MultiplayerBridgeStats> {
    return this.statsValue;
  }

  // ----- Internal -----

  private buildUrl(): string {
    const sep = this.baseUrl.includes('?') ? '&' : '?';
    return (
      this.baseUrl +
      sep +
      'character_id=' + encodeURIComponent(this.characterId) +
      '&zone=' + encodeURIComponent(this.zone)
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
      const closed = es.readyState === 2;   // EventSource.CLOSED
      if (closed) {
        this.statusValue = 'closed';
        this.closeConnection();
        return;
      }
      this.statusValue = 'reconnecting';
      this.statsValue.reconnects++;
    };

    es.addEventListener('presence.update', (e: Event) => {
      this.handleUpdate(e as MessageEvent);
    });
    es.addEventListener('presence.depart', (e: Event) => {
      this.handleDepart(e as MessageEvent);
    });
    es.addEventListener('presence.snapshot', (e: Event) => {
      this.handleSnapshot(e as MessageEvent);
    });
  }

  private closeConnection(): void {
    if (!this.es) return;
    try { this.es.close(); } catch { /* ignore */ }
    this.es = null;
  }

  private handleUpdate(e: MessageEvent): void {
    const data = parseJson(e.data);
    if (!data || typeof data !== 'object') return;
    const characterId = (data as { character_id?: unknown }).character_id;
    const x = (data as { x?: unknown }).x;
    const y = (data as { y?: unknown }).y;
    const zone = (data as { zone?: unknown }).zone;
    const tsMs = (data as { ts_ms?: unknown }).ts_ms;
    if (typeof characterId !== 'string') return;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (typeof zone !== 'string') return;
    if (typeof tsMs !== 'number') return;
    const name = (data as { name?: unknown }).name;
    this.statsValue.messagesReceived++;
    this.queue.push({
      kind: 'update',
      characterId,
      x,
      y,
      zone,
      tsMs,
      ...(typeof name === 'string' ? { name } : {}),
    });
  }

  private handleDepart(e: MessageEvent): void {
    const data = parseJson(e.data);
    if (!data || typeof data !== 'object') return;
    const characterId = (data as { character_id?: unknown }).character_id;
    if (typeof characterId !== 'string') return;
    this.statsValue.messagesReceived++;
    this.queue.push({ kind: 'depart', characterId });
  }

  private handleSnapshot(e: MessageEvent): void {
    const data = parseJson(e.data);
    if (!data || typeof data !== 'object') return;
    const peersRaw = (data as { peers?: unknown }).peers;
    if (!Array.isArray(peersRaw)) return;
    const peers: Array<{
      characterId: string;
      x: number;
      y: number;
      zone: string;
      tsMs: number;
      name?: string;
    }> = [];
    for (let i = 0; i < peersRaw.length; i++) {
      const p = peersRaw[i];
      if (!p || typeof p !== 'object') continue;
      const characterId = (p as { character_id?: unknown }).character_id;
      const x = (p as { x?: unknown }).x;
      const y = (p as { y?: unknown }).y;
      const zone = (p as { zone?: unknown }).zone;
      const tsMs = (p as { ts_ms?: unknown }).ts_ms;
      if (typeof characterId !== 'string') continue;
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      if (typeof zone !== 'string') continue;
      if (typeof tsMs !== 'number') continue;
      const name = (p as { name?: unknown }).name;
      peers.push({
        characterId,
        x,
        y,
        zone,
        tsMs,
        ...(typeof name === 'string' ? { name } : {}),
      });
    }
    this.statsValue.messagesReceived++;
    this.queue.push({ kind: 'snapshot', peers });
  }
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function defaultBroadcastUrl(baseUrl: string): string {
  if (baseUrl.endsWith('/events')) {
    return baseUrl.slice(0, -'/events'.length) + '/move';
  }
  return baseUrl + '/move';
}
