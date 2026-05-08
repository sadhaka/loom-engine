# Dialogue Mini

A turn-based branching dialogue tree. No combat, no movement; the engine
is used purely as a state container + render-loop driver. This proves
the same ECS / resource / system model that runs the action demos also
fits visual-novel, in-conversation menu, and story-driven prologue
flows.

## Run it

```sh
# from the repo root
npm run build:all
python -m http.server 8765
# browse http://localhost:8765/demo/dialogue-mini/
```

Click a choice or press `1`, `2`, or `3` to advance.

## Engine concepts demonstrated

- **Custom Resource** - `RESOURCE_DIALOGUE` is registered into the
  shared `ResourceRegistry` exactly like the engine's own `RESOURCE_TIME`
  or `RESOURCE_INPUT`. `DialogueState` is plain user data; the engine
  doesn't care what shape it has.
- **Input snapshot for non-action input** - `InputSnapshot.keysPressedThisFrame`
  is the same field the action demos read. Number keys `1..3` map to
  the current node's choices; the system path is identical to
  combat-demo input handling.
- **DOM as the primary UI** - choices are rendered as buttons. The
  canvas is reused only for an ambient avatar that swaps color with
  the active speaker. The boundary between engine state and DOM
  rendering lives entirely inside the system's `render()` method.

## Where to read next

- `src/input/input-manager.ts` - how `InputSnapshot` exposes keyboard,
  mouse, and touch events as one frame-coherent read-only object.
- `src/resources.ts` - the registry shape and how user code adds its
  own resource keys without touching engine code.
- `src/system.ts` - the `System` interface every demo extends.
