// ParticleEmitterSystem - reads ECS entities that have BOTH a
// Transform AND a ParticleEmitter, computes how many particles to
// spawn this tick (continuous rate + pending burst), and pushes
// each spawn into the shared ParticlePool.
//
// Runs in PHASE_LOGIC. Simulation happens in PHASE_PHYSICS afterward,
// so a particle spawned this tick gets its first physics step in the
// same frame.
//
// Spawn math:
//   - Continuous: emitter.rate * dt + emitter.spawnCarry, floor that
//     for the count this tick, save the fractional part as new carry
//   - Burst: emit min(burstRemaining, available-budget) all at once
//   - Direction: sample a random direction inside the cone defined
//     by (dirX, dirY, dirZ) and coneRadians half-angle
//   - Speed: uniform random in [speedMin, speedMax]
//
// The pool's maxParticles cap is enforced inside ParticlePool.spawn;
// when it returns -1 we stop emitting from this entity for this tick
// and the missed spawns are NOT carried over (a budget under-fire is
// a render-budget signal, not a debt).

import type { System } from '../system.js';
import type { World } from '../world.js';
import { POOL_TRANSFORM } from '../world.js';
import { TransformPool } from '../components/transform.js';
import { ParticleEmitterPool, EMITTER_FLAG_ACTIVE } from '../components/particle-emitter.js';
import { ParticlePool } from '../vfx/particle-pool.js';
import { POOL_PARTICLE } from './particle-simulation-system.js';
import {
  type IEntropy,
  RESOURCE_ENTROPY,
  createEntropy,
} from '../runtime/entropy.js';

export const POOL_EMITTER = 'emitter';

// Fallback entropy for worlds that did not register one. The engine's
// own Engine.create always seeds RESOURCE_ENTROPY, but bare-bones
// World instances in tests / mini-demos may skip it. We never call
// Math.random() in src/ - that would break the seeded-replay
// contract.
const FALLBACK_ENTROPY: IEntropy = createEntropy(0xC0FFEE);

// Sample a random unit direction inside a cone of half-angle
// `coneHalf` around the axis (ax, ay, az). For coneHalf = 0 the
// returned vector equals the axis. For coneHalf = PI it's a random
// direction on the full sphere.
//
// Algorithm: pick a random angle phi in [0, coneHalf], a random
// azimuth theta in [0, 2*PI], and rotate that into the axis-aligned
// frame. We use a small-angle approximation that's exact for our
// 2.5D usage (the axis is mostly axis-aligned in iso space).
function sampleConeDirection(
  ax: number,
  ay: number,
  az: number,
  coneHalf: number,
  out: { x: number; y: number; z: number },
  entropy: IEntropy,
): void {
  if (coneHalf <= 0) {
    out.x = ax;
    out.y = ay;
    out.z = az;
    return;
  }
  // Random angle from axis (cosine-weighted for uniform sphere
  // coverage as cone widens). Routed through the seeded entropy
  // resource so a replay produces the same particle directions.
  const cosLimit = Math.cos(coneHalf);
  const cosAngle = cosLimit + (1 - cosLimit) * entropy.random();
  const sinAngle = Math.sqrt(Math.max(0, 1 - cosAngle * cosAngle));
  const azimuth = entropy.random() * Math.PI * 2;

  // Build a local frame around the axis.
  const len = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
  const aux = ax / len;
  const auy = ay / len;
  const auz = az / len;

  // Find a perpendicular to (aux, auy, auz). Use the smaller axis
  // as the helper to avoid degenerate cross products.
  let hx: number, hy: number, hz: number;
  if (Math.abs(aux) < 0.9) {
    hx = 1; hy = 0; hz = 0;
  } else {
    hx = 0; hy = 1; hz = 0;
  }
  // First perpendicular = axis x helper
  let p1x = auy * hz - auz * hy;
  let p1y = auz * hx - aux * hz;
  let p1z = aux * hy - auy * hx;
  const p1Len = Math.sqrt(p1x * p1x + p1y * p1y + p1z * p1z) || 1;
  p1x /= p1Len; p1y /= p1Len; p1z /= p1Len;
  // Second perpendicular = axis x p1
  const p2x = auy * p1z - auz * p1y;
  const p2y = auz * p1x - aux * p1z;
  const p2z = aux * p1y - auy * p1x;

  const cosA = Math.cos(azimuth);
  const sinA = Math.sin(azimuth);
  // Combine: result = cosAngle*axis + sinAngle*(cosA*p1 + sinA*p2)
  out.x = cosAngle * aux + sinAngle * (cosA * p1x + sinA * p2x);
  out.y = cosAngle * auy + sinAngle * (cosA * p1y + sinA * p2y);
  out.z = cosAngle * auz + sinAngle * (cosA * p1z + sinA * p2z);
}

const SCRATCH_DIR = { x: 0, y: 0, z: 0 };

export class ParticleEmitterSystem implements System {
  readonly name: string = 'particle-emitter';

  update(world: World, dt: number): void {
    const transforms = world.getPool<TransformPool>(POOL_TRANSFORM);
    const emitters = world.getPool<ParticleEmitterPool>(POOL_EMITTER);
    const particles = world.getPool<ParticlePool>(POOL_PARTICLE);
    if (!transforms || !emitters || !particles) return;
    // Resolve entropy once per tick. Engine.create always registers
    // one, but bare World instances may skip it - the fallback is a
    // module-level deterministic stream so tests that exercise the
    // emitter without wiring entropy still get reproducible output
    // (just from a different seed).
    const entropy = world.resources.get<IEntropy>(RESOURCE_ENTROPY) ?? FALLBACK_ENTROPY;

    const hwm = Math.min(transforms.getHighWaterMark(), emitters.getHighWaterMark());

    for (let i = 1; i < hwm; i++) {  // index 0 is NULL_ENTITY
      const flags = emitters.flags[i] ?? 0;
      if ((flags & EMITTER_FLAG_ACTIVE) === 0) continue;

      const x = transforms.x[i] ?? 0;
      const y = transforms.y[i] ?? 0;
      const z = transforms.z[i] ?? 0;

      // Total spawns this tick = continuous fractional accumulator
      // + pending burst.
      const carry = (emitters.spawnCarry[i] ?? 0) + (emitters.rate[i] ?? 0) * dt;
      const continuousCount = Math.floor(carry);
      emitters.spawnCarry[i] = carry - continuousCount;
      const burstCount = emitters.burstRemaining[i] ?? 0;
      const total = continuousCount + burstCount;
      if (total === 0) continue;

      let spawnedFromBurst = 0;
      const additive = (flags & 0x02) !== 0;
      const dirX = emitters.dirX[i] ?? 0;
      const dirY = emitters.dirY[i] ?? -1;
      const dirZ = emitters.dirZ[i] ?? 0;
      const coneHalf = emitters.coneRadians[i] ?? 0;
      const speedMin = emitters.speedMin[i] ?? 0;
      const speedMax = emitters.speedMax[i] ?? speedMin;
      const ax = emitters.ax[i] ?? 0;
      const ay = emitters.ay[i] ?? 0;
      const az = emitters.az[i] ?? 0;
      const life = emitters.particleLife[i] ?? 1;
      const startSize = emitters.startSize[i] ?? 4;
      const endSize = emitters.endSize[i] ?? startSize;
      // Color is constant per emitter - read once here, not per
      // particle inside the spawn loop.
      const sr = emitters.startR[i] ?? 1;
      const sg = emitters.startG[i] ?? 1;
      const sb = emitters.startB[i] ?? 1;
      const sa = emitters.startA[i] ?? 1;
      const er = emitters.endR[i] ?? 1;
      const eg = emitters.endG[i] ?? 1;
      const eb = emitters.endB[i] ?? 1;
      const ea = emitters.endA[i] ?? 0;

      for (let k = 0; k < total; k++) {
        sampleConeDirection(dirX, dirY, dirZ, coneHalf, SCRATCH_DIR, entropy);
        const speed = speedMin + entropy.random() * (speedMax - speedMin);
        // spawnRaw - no per-particle spawn object or color allocation.
        const slot = particles.spawnRaw(
          x, y, z,
          SCRATCH_DIR.x * speed, SCRATCH_DIR.y * speed, SCRATCH_DIR.z * speed,
          ax, ay, az,
          life,
          startSize, endSize,
          sr, sg, sb, sa,
          er, eg, eb, ea,
          additive,
        );
        if (slot < 0) break;   // budget hit
        if (k < burstCount) spawnedFromBurst++;
      }

      // Reduce burstRemaining only by what we actually spawned.
      emitters.burstRemaining[i] = burstCount - spawnedFromBurst;
    }
  }
}
