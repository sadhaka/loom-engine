// ParticleSimulationSystem - advances every live particle's state
// each tick. Position, velocity, life. Particles whose life drops
// below zero are killed and their slots returned to the free list.
//
// Runs in PHASE_PHYSICS, after the emitter system has spawned this
// frame's new particles (emitter runs in PHASE_LOGIC).
//
// Hot loop: walks [0, highWaterMark) of the pool, branchless on the
// alive flag (skip via continue), in-place mutation. No allocations
// per particle.
import { PARTICLE_FLAG_ALIVE } from '../vfx/particle-pool.js';
export const POOL_PARTICLE = 'particle';
export class ParticleSimulationSystem {
    name = 'particle-simulation';
    update(world, dt) {
        const pool = world.getPool(POOL_PARTICLE);
        if (!pool)
            return;
        const hwm = pool.getHighWaterMark();
        if (hwm === 0)
            return;
        for (let i = 0; i < hwm; i++) {
            const f = pool.flags[i] ?? 0;
            if ((f & PARTICLE_FLAG_ALIVE) === 0)
                continue;
            const remaining = (pool.life[i] ?? 0) - dt;
            if (remaining <= 0) {
                pool.kill(i);
                continue;
            }
            pool.life[i] = remaining;
            // Velocity integration with constant acceleration.
            const vx = (pool.vx[i] ?? 0) + (pool.ax[i] ?? 0) * dt;
            const vy = (pool.vy[i] ?? 0) + (pool.ay[i] ?? 0) * dt;
            const vz = (pool.vz[i] ?? 0) + (pool.az[i] ?? 0) * dt;
            pool.vx[i] = vx;
            pool.vy[i] = vy;
            pool.vz[i] = vz;
            pool.x[i] = (pool.x[i] ?? 0) + vx * dt;
            pool.y[i] = (pool.y[i] ?? 0) + vy * dt;
            pool.z[i] = (pool.z[i] ?? 0) + vz * dt;
        }
    }
}
//# sourceMappingURL=particle-simulation-system.js.map