// MockMultiplayerBridge - in-memory presence transport for tests +
// offline demos.
//
// Tests inject incoming presence frames via enqueueIncoming() and let
// PeerPresenceSystem drain them. broadcastPosition() captures local
// sends in a getSentBroadcasts() buffer so tests can assert on them.
// pollMessages() drains the inbound queue in FIFO order.
//
// Rate-limiting: shared with the SSE bridge via BROADCAST_MIN_INTERVAL_MS.
// A nowMs() injection point lets tests fast-forward time without
// touching the real clock.

import {
  type IMultiplayerBridge,
  type MultiplayerBridgeStatus,
  type MultiplayerBridgeStats,
  type PresenceMessage,
  BROADCAST_MIN_INTERVAL_MS,
} from './multiplayer-bridge.js';

export interface MockMultiplayerBridgeOptions {
  // Inject a clock for the rate limiter. Production reads
  // performance.now / Date.now; tests pass an advancing counter.
  // Must return milliseconds since some fixed epoch (only deltas matter).
  nowMs?: () => number;
}

interface SentBroadcast {
  x: number;
  y: number;
  zone: string;
  tsMs: number;
  // Wall-clock millisecond at which the send was admitted by the rate
  // limiter (the value of nowMs() at that moment). Useful for
  // asserting cadence in tests.
  sentAtMs: number;
}

export class MockMultiplayerBridge implements IMultiplayerBridge {
  private queue: PresenceMessage[] = [];
  private statusValue: MultiplayerBridgeStatus = 'idle';
  private statsValue: MultiplayerBridgeStats = {
    messagesReceived: 0,
    messagesSent: 0,
    rateLimitedDrops: 0,
    reconnects: 0,
  };
  private readonly nowMs: () => number;
  private lastBroadcastMs: number = -Infinity;
  private sentBroadcasts: SentBroadcast[] = [];

  constructor(opts: MockMultiplayerBridgeOptions = {}) {
    this.nowMs = opts.nowMs ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  connect(): void {
    if (this.statusValue === 'connected') return;
    this.statusValue = 'connected';
  }

  disconnect(): void {
    this.statusValue = 'closed';
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
    const now = this.nowMs();
    if (now - this.lastBroadcastMs < BROADCAST_MIN_INTERVAL_MS) {
      this.statsValue.rateLimitedDrops++;
      return;
    }
    this.lastBroadcastMs = now;
    this.sentBroadcasts.push({ x, y, zone, tsMs, sentAtMs: now });
    this.statsValue.messagesSent++;
  }

  stats(): Readonly<MultiplayerBridgeStats> {
    return this.statsValue;
  }

  // ----- Mock-only injection helpers -----

  // Enqueue an inbound presence message as if it came from the server.
  enqueueIncoming(msg: PresenceMessage): void {
    this.queue.push(msg);
    this.statsValue.messagesReceived++;
  }

  enqueueIncomingAll(msgs: ReadonlyArray<PresenceMessage>): void {
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m) this.enqueueIncoming(m);
    }
  }

  // Tests inspect what broadcastPosition let through. Returns the
  // backing array; the caller may copy if they need a snapshot.
  getSentBroadcasts(): ReadonlyArray<Readonly<SentBroadcast>> {
    return this.sentBroadcasts;
  }

  // Convenience: how many inbound messages are waiting for a poll.
  pendingIncoming(): number {
    return this.queue.length;
  }

  // Reset rate-limiter state. Useful in tests that simulate a
  // reconnect or want a clean slate.
  resetRateLimit(): void {
    this.lastBroadcastMs = -Infinity;
  }

  // Inspect-only: when did broadcastPosition last send (in nowMs() units).
  getLastBroadcastMs(): number {
    return this.lastBroadcastMs;
  }
}
