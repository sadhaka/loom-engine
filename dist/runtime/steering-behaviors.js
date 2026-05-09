// SteeringBehaviors - 2D NPC navigation primitives.
//
// 0.64.0 enabling primitive. Mob nav, NPC walk, projectile homing,
// crowd dispersion all share the same steering math. Each
// behaviour returns a desired velocity (or steering force, in
// classic Reynolds terms); consumers sum / weight them and apply
// to a kinematic body.
//
// Pure functions, all return fresh { x, y } so they compose:
//
//   - seek: steer toward a target.
//   - flee: steer away from a target.
//   - arrive: seek with deceleration inside a slow-down radius
//     (so the agent doesn't overshoot).
//   - pursue: lead a moving target.
//   - evade: anti-pursue (run away from predicted future position).
//   - separation: push away from too-close neighbours.
//   - wander: smoothed random direction with circular bias.
//
// All speeds / radii in consumer-defined units. Caller integrates
// (apply velocity * dt to position) outside this module.
//
// Code style: var-only in browser source.
function len(x, y) {
    return Math.sqrt(x * x + y * y);
}
function vec(x, y) {
    return { x: x, y: y };
}
function clampMag(x, y, max) {
    var l = len(x, y);
    if (l <= max || l === 0)
        return vec(x, y);
    var s = max / l;
    return vec(x * s, y * s);
}
// Steer toward a fixed target. Returns the desired-velocity delta:
// (desired - current) capped at maxForce.
export function seek(agent, target) {
    var dx = target.x - agent.x;
    var dy = target.y - agent.y;
    var l = len(dx, dy);
    if (l === 0)
        return vec(0, 0);
    var s = agent.maxSpeed / l;
    var desX = dx * s;
    var desY = dy * s;
    var fx = desX - agent.vx;
    var fy = desY - agent.vy;
    if (agent.maxForce !== undefined)
        return clampMag(fx, fy, agent.maxForce);
    return vec(fx, fy);
}
// Steer away from a target. Inverse of seek.
export function flee(agent, target) {
    var dx = agent.x - target.x;
    var dy = agent.y - target.y;
    var l = len(dx, dy);
    if (l === 0)
        return vec(0, 0);
    var s = agent.maxSpeed / l;
    var desX = dx * s;
    var desY = dy * s;
    var fx = desX - agent.vx;
    var fy = desY - agent.vy;
    if (agent.maxForce !== undefined)
        return clampMag(fx, fy, agent.maxForce);
    return vec(fx, fy);
}
// Seek with deceleration inside `slowRadius` so the agent stops
// at the target instead of overshooting.
export function arrive(agent, target, slowRadius) {
    var dx = target.x - agent.x;
    var dy = target.y - agent.y;
    var l = len(dx, dy);
    if (l === 0)
        return vec(-agent.vx, -agent.vy);
    var speed = agent.maxSpeed;
    if (l < slowRadius && slowRadius > 0) {
        speed = agent.maxSpeed * (l / slowRadius);
    }
    var s = speed / l;
    var desX = dx * s;
    var desY = dy * s;
    var fx = desX - agent.vx;
    var fy = desY - agent.vy;
    if (agent.maxForce !== undefined)
        return clampMag(fx, fy, agent.maxForce);
    return vec(fx, fy);
}
// Pursue a moving target. Predicts target's future position based
// on the time it would take to reach it at maxSpeed, then seeks
// that point.
export function pursue(agent, target) {
    var dx = target.x - agent.x;
    var dy = target.y - agent.y;
    var distance = len(dx, dy);
    if (distance === 0 || agent.maxSpeed === 0)
        return seek(agent, vec(target.x, target.y));
    var t = distance / agent.maxSpeed;
    var futureX = target.x + target.vx * t;
    var futureY = target.y + target.vy * t;
    return seek(agent, vec(futureX, futureY));
}
// Evade: anti-pursue. Predict target's future position and flee.
export function evade(agent, target) {
    var dx = target.x - agent.x;
    var dy = target.y - agent.y;
    var distance = len(dx, dy);
    if (distance === 0)
        return vec(0, 0);
    var safeMaxSpeed = agent.maxSpeed > 0 ? agent.maxSpeed : 1;
    var t = distance / safeMaxSpeed;
    var futureX = target.x + target.vx * t;
    var futureY = target.y + target.vy * t;
    return flee(agent, vec(futureX, futureY));
}
// Separation: push away from neighbours within `radius`. Sum of
// inverse-distance vectors from each neighbour.
export function separation(agent, neighbours, radius) {
    if (radius <= 0 || neighbours.length === 0)
        return vec(0, 0);
    var fx = 0;
    var fy = 0;
    var count = 0;
    for (var i = 0; i < neighbours.length; i++) {
        var n = neighbours[i];
        var dx = agent.x - n.x;
        var dy = agent.y - n.y;
        var d = len(dx, dy);
        if (d > 0 && d < radius) {
            // Inverse-distance scale: closer neighbours push harder.
            fx += (dx / d) / d;
            fy += (dy / d) / d;
            count++;
        }
    }
    if (count === 0)
        return vec(0, 0);
    // Convert to a steering force toward maxSpeed at the average
    // direction.
    var l = len(fx, fy);
    if (l === 0)
        return vec(0, 0);
    var s = agent.maxSpeed / l;
    var desX = fx * s;
    var desY = fy * s;
    var sx = desX - agent.vx;
    var sy = desY - agent.vy;
    if (agent.maxForce !== undefined)
        return clampMag(sx, sy, agent.maxForce);
    return vec(sx, sy);
}
// Wander: smoothed random direction. The state.angle drifts each
// call by up to `jitter` radians, producing a smoothly-changing
// heading. Returns a steering force toward (current heading,
// projected `forwardDistance` ahead). `rng` for replay
// determinism (default Math.random).
export function wander(agent, state, forwardDistance, jitter, rng = Math.random) {
    // Drift the heading.
    state.angle += (rng() * 2 - 1) * jitter;
    var dx = Math.cos(state.angle) * forwardDistance;
    var dy = Math.sin(state.angle) * forwardDistance;
    // Target = agent position + heading vector.
    var target = vec(agent.x + dx, agent.y + dy);
    return seek(agent, target);
}
// Resource key for the world's resource registry.
export const RESOURCE_STEERING_BEHAVIORS = 'steering_behaviors';
//# sourceMappingURL=steering-behaviors.js.map