// Loom Engine - zone-event trace replay.
//
// Feeds a recorded list of LOOM-DIRECTOR-PROTOCOL-V2 zone-event
// envelopes into a HeadlessTicker so a test (or a bug-repro session)
// can re-run the exact same sequence the live game observed.
//
// Trace shape (JSON file):
//   {
//     "schema": "loom.zone-trace.v1",
//     "envelopes": [
//       { "id": 1, "ts": ..., "type": "zone.boss.spawn", ... },
//       ...
//     ],
//     "ticksBetween": 1            (optional, default 1)
//   }
//
// Each envelope is enqueued onto a MockZoneBridge, then `ticksBetween`
// frames are pumped through the ticker so ZoneEventSystem drains it
// at the bridge's natural cadence. The MockZoneBridge does not require
// monotonic ids, so out-of-order traces are honoured for debugging
// reorder bugs (it tracks them as outOfOrderEvents stat).
//
// Surface:
//   const replayer = new TraceReplayer(traceJson);
//   await replayer.replayInto(ticker);
//
// The replayer assumes the ticker has already had a ZoneEventSystem
// + MockZoneBridge wired in via the resources / addSystem APIs the
// caller controls. This keeps the replayer agnostic to which other
// systems are also in the world (a Survivor port might want
// ZoneBossEntitySystem too; an isolated test might not).

import type { HeadlessTicker } from '../headless-tick-harness.js';
import {
  MockZoneBridge,
  RESOURCE_ZONE_EVENT_BRIDGE,
  type ZoneEvent,
} from '../../src/index.js';

export interface ZoneTraceFile {
  schema?: string;
  envelopes: ZoneEvent[];
  // Frames to pump after each envelope is enqueued. Default 1 - the
  // system polls + applies on the very next tick. Set higher to
  // simulate a slow consumer.
  ticksBetween?: number;
}

export class TraceReplayer {
  private readonly trace: ZoneTraceFile;

  constructor(trace: ZoneTraceFile | string) {
    if (typeof trace === 'string') {
      const parsed = JSON.parse(trace) as ZoneTraceFile;
      this.trace = parsed;
    } else {
      this.trace = trace;
    }
    if (!Array.isArray(this.trace.envelopes)) {
      throw new Error('TraceReplayer: trace.envelopes must be an array');
    }
  }

  // Read-only inspection.
  envelopeCount(): number {
    return this.trace.envelopes.length;
  }

  // Replay into the supplied ticker. Caller is responsible for having
  // already registered ZoneEventSystem and a MockZoneBridge (this is
  // the bridge we will enqueue into). Returns when every envelope has
  // been processed and the trailing `ticksBetween` frames have run.
  //
  // The promise interface is reserved for future asynchronous traces
  // (frame-paced playback, real-time replay). v1 is fully synchronous
  // but returns a Promise so callers can adopt without changes later.
  async replayInto(ticker: HeadlessTicker): Promise<void> {
    const bridge = ticker
      .getWorld()
      .resources.get<MockZoneBridge>(RESOURCE_ZONE_EVENT_BRIDGE);
    if (!bridge) {
      throw new Error(
        'TraceReplayer.replayInto: world has no RESOURCE_ZONE_EVENT_BRIDGE - '
        + 'register a MockZoneBridge before calling replayInto.',
      );
    }
    if (typeof (bridge as unknown as { enqueueIncoming?: unknown }).enqueueIncoming !== 'function') {
      throw new Error(
        'TraceReplayer.replayInto: bridge does not expose enqueueIncoming() - '
        + 'pass a MockZoneBridge, not a real SSE bridge.',
      );
    }

    const ticksBetween = typeof this.trace.ticksBetween === 'number'
      && Number.isFinite(this.trace.ticksBetween)
      && this.trace.ticksBetween >= 1
      ? Math.floor(this.trace.ticksBetween)
      : 1;

    for (let i = 0; i < this.trace.envelopes.length; i++) {
      const env = this.trace.envelopes[i]!;
      bridge.enqueueIncoming(env);
      ticker.tick(ticksBetween);
    }
  }
}
