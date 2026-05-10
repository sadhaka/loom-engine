// LagCompensation WebSocket adapter (1.7.4 reference adapter).
//
// Wires LagCompensation to a WebSocket so consumers don't have to
// hand-write the protocol. Bidirectional:
//   - Inbound 'input' messages are recordInput'd (other clients'
//     inputs feeding into local rollback simulation).
//   - Inbound 'auth-state' messages trigger resync() and the adapter
//     calls onResync(rewindResult) so consumer can re-simulate.
//
// Inbound (parsed JSON):
//   { type: 'input',      tick, input }
//   { type: 'state',      tick, state }
//   { type: 'auth-state', tick, state }
//   { type: 'rewind',     tick }   (request a rewind hint)
//
// Outbound (callbacks):
//   onResync(result: RewindResult)  - fired on 'auth-state' ingest
//   onRewindRequest(result | null)  - fired on 'rewind' ingest
//
// Code style: var-only in browser source.

import { LagCompensation } from '../lag-compensation.js';
import type { LagCompensationOptions, RewindResult, InputEntry } from '../lag-compensation.js';

export interface LagCompensationWsAdapterOptions<TState = unknown, TInput = unknown> {
  // Existing instance to bind. If omitted, fresh one created with options.
  lag?: LagCompensation<TState, TInput>;
  lagOptions?: LagCompensationOptions<TState>;
  // Called when authoritative state arrives + resync runs. Returns
  // the inputs that survived (need re-application by consumer's
  // simulation loop).
  onResync?: (tick: number, state: TState, surviving: InputEntry<TInput>[]) => void;
  // Called when a rewind request arrives (peer asking 'what did you
  // see at tick X?'). Returns the rewind result for the consumer to
  // emit upstream.
  onRewindRequest?: (tick: number, result: RewindResult<TState, TInput> | null) => void;
  onError?: (err: Error, raw: string) => void;
  // REQUIRED nowFn (engine determinism policy). Used only for default
  // messages that omit a tick value (rare).
  nowFn: () => number;
}

export interface LagCompensationWsHandle<TState = unknown, TInput = unknown> {
  lag: LagCompensation<TState, TInput>;
  ingest(raw: string): string;
}

interface InboundInput<TInput>  { type: 'input';      tick: number; input: TInput; }
interface InboundState<TState>  { type: 'state';      tick: number; state: TState; }
interface InboundAuth<TState>   { type: 'auth-state'; tick: number; state: TState; }
interface InboundRewind         { type: 'rewind';     tick: number; }

export function attachLagCompensationToWs<TState = unknown, TInput = unknown>(
  opts: LagCompensationWsAdapterOptions<TState, TInput>,
): LagCompensationWsHandle<TState, TInput> {
  var lag = opts.lag || LagCompensation.create<TState, TInput>(opts.lagOptions || {});
  var onResync = opts.onResync || function () {};
  var onRewindRequest = opts.onRewindRequest || function () {};
  var onError = opts.onError || function () {};
  // nowFn intentionally consumed for parity with other adapters even
  // if unused on every code path.
  void opts.nowFn;

  function ingest(raw: string): string {
    var parsed: InboundInput<TInput> | InboundState<TState> | InboundAuth<TState> | InboundRewind | null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)), raw);
      return 'unknown';
    }
    if (!parsed || typeof parsed !== 'object') return 'unknown';
    switch (parsed.type) {
      case 'input':
        lag.recordInput(parsed.tick, parsed.input);
        return 'input';
      case 'state':
        lag.recordState(parsed.tick, parsed.state);
        return 'state';
      case 'auth-state': {
        var surviving = lag.resync(parsed.tick, parsed.state);
        onResync(parsed.tick, parsed.state, surviving);
        return 'auth-state';
      }
      case 'rewind': {
        var result = lag.rewind(parsed.tick);
        onRewindRequest(parsed.tick, result);
        return 'rewind';
      }
      default:
        return 'unknown';
    }
  }

  return { lag: lag, ingest: ingest };
}
