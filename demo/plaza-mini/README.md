# Plaza Mini

Walkable iso plaza with one NPC and a Director-driven narrator overlay.
The mock bridge drops a synthetic `narrator.line` event every five
seconds; the engine routes it through `DirectorSystem` into the
`DirectorEventLog` resource, and a tiny custom system mirrors the line
into a DOM overlay that fades after its TTL.

## Run it

```sh
# from the repo root
npm run build:all
python -m http.server 8765
# browse http://localhost:8765/demo/plaza-mini/
```

## Engine concepts demonstrated

- **Iso projection** - `device.drawTile(tx, ty, atlas, frame)` projects
  tile coordinates onto the canvas via the engine's iso-projection
  helpers (`ISO_TILE_WIDTH`, `ISO_TILE_HEIGHT`).
- **Input snapshot** - `InputSystem` publishes a frame-coherent
  `InputSnapshot` resource each tick. The custom `WalkSystem` reads
  `keysHeld` to translate the player Transform.
- **MockDirectorBridge** - in-memory event source that satisfies the
  `IDirectorBridge` contract. Production code swaps it for
  `new SSEDirectorBridge({ baseUrl, characterId })` with no other
  changes downstream.
- **DirectorSystem + DirectorEventLog** - `DirectorSystem` drains the
  bridge each tick and writes the latest `narrator.line` into a
  shared `DirectorEventLog` resource. `NarratorOverlaySystem` reads
  that resource and updates the DOM, demonstrating the boundary
  between engine state and renderer-host UI.

## Where to read next

- `src/director/event-envelope.ts` - the eleven Director event types
  and their data shapes.
- `src/director/mock-director-bridge.ts` - drop-in implementation that
  lets demos and tests run without a backend.
- `src/director/director-system.ts` - the per-tick drain + event-log
  state machine that the overlay reads from.
