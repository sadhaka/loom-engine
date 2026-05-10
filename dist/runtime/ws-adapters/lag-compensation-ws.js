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
export function attachLagCompensationToWs(opts) {
    var lag = opts.lag || LagCompensation.create(opts.lagOptions || {});
    var onResync = opts.onResync || function () { };
    var onRewindRequest = opts.onRewindRequest || function () { };
    var onError = opts.onError || function () { };
    // nowFn intentionally consumed for parity with other adapters even
    // if unused on every code path.
    void opts.nowFn;
    function ingest(raw) {
        var parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch (e) {
            onError(e instanceof Error ? e : new Error(String(e)), raw);
            return 'unknown';
        }
        if (!parsed || typeof parsed !== 'object')
            return 'unknown';
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
//# sourceMappingURL=lag-compensation-ws.js.map