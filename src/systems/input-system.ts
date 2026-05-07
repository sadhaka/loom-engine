// InputSystem - bridges DOM input accumulator into a frame-coherent
// resource. Runs as the FIRST registered system in PHASE_INPUT, so
// every subsequent phase reads the same snapshot.
//
// The system does two things each tick:
//   1. Calls inputManager.beginFrame() so per-frame transient state
//      (pressed-this-frame / released-this-frame / wheel delta /
//      touchesStarted / touchesEnded) snapshots from the accumulator
//   2. Writes the resulting InputSnapshot into the world's resource
//      registry under RESOURCE_INPUT
//
// Other systems (camera pan, click-to-spawn, etc.) read from
// world.resources.get<InputSnapshot>(RESOURCE_INPUT). The snapshot is
// replaced each tick so consumers should not hold a reference across
// frames.

import type { System } from '../system.js';
import type { World } from '../world.js';
import {
  InputManager,
  RESOURCE_INPUT_MANAGER,
  RESOURCE_INPUT,
} from '../input/input-manager.js';

export class InputSystem implements System {
  readonly name: string = 'input';

  update(world: World, _dt: number): void {
    const manager = world.resources.get<InputManager>(RESOURCE_INPUT_MANAGER);
    if (!manager) return;
    manager.beginFrame();
    world.resources.set(RESOURCE_INPUT, manager.snapshot());
  }
}
