// VeilBudgetSystem - reads the VeilBudgetResource each tick and
// propagates its values into the engine subsystems that gate on it.
//
// Phase 5 wiring:
//   audioBudget    -> AudioBus.setAudioBudget(budget)
//   particleBudget -> ParticlePool.setMaxParticles(budget)
//
// This is the cheap-but-explicit propagation step. Subsystems could
// subscribe to budget changes directly, but a polling system is
// simpler and runs in O(1) since the bus / pool ignore set-same.
//
// Runs in PHASE_INPUT immediately after InputSystem, so by the time
// gameplay logic / particle emit / audio play* calls happen later in
// the tick, gates are current.
//
// The Director-bridge in Phase 6 mutates budget values directly on
// the resource; this system is what makes those mutations visible to
// audio + VFX.

import type { System } from '../system.js';
import type { World } from '../world.js';
import {
  RESOURCE_VEIL_BUDGET,
  type VeilBudgetResource,
} from '../resources.js';
import { AudioBus, RESOURCE_AUDIO_BUS } from '../audio/audio-bus.js';
import { ParticlePool } from '../vfx/particle-pool.js';
import { POOL_PARTICLE } from './particle-simulation-system.js';

export class VeilBudgetSystem implements System {
  readonly name: string = 'veil-budget';

  update(world: World, _dt: number): void {
    const budget = world.resources.get<VeilBudgetResource>(RESOURCE_VEIL_BUDGET);
    if (!budget) return;

    const audio = world.resources.get<AudioBus>(RESOURCE_AUDIO_BUS);
    if (audio) audio.setAudioBudget(budget.audioBudget);

    const particles = world.getPool<ParticlePool>(POOL_PARTICLE);
    if (particles && particles.getMaxParticles() !== budget.particleBudget) {
      particles.setMaxParticles(budget.particleBudget);
    }
  }
}
