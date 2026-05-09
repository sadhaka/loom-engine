// Phase 0.64.0 - SteeringBehaviors tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  seek,
  flee,
  arrive,
  pursue,
  evade,
  separation,
  wander,
  RESOURCE_STEERING_BEHAVIORS,
  type Agent,
  type WanderState,
} from '../src/index.js';

test('steering: RESOURCE_STEERING_BEHAVIORS is the stable string', () => {
  assert.equal(RESOURCE_STEERING_BEHAVIORS, 'steering_behaviors');
});

test('steering: seek returns force toward target', () => {
  const a: Agent = { x: 0, y: 0, vx: 0, vy: 0, maxSpeed: 100 };
  const f = seek(a, { x: 10, y: 0 });
  // Desired velocity points +x at maxSpeed=100; current vel = 0;
  // force = (100, 0) - (0, 0) = (100, 0).
  assert.ok(Math.abs(f.x - 100) < 1e-9);
  assert.ok(Math.abs(f.y) < 1e-9);
});

test('steering: seek on agent at target returns zero', () => {
  const a: Agent = { x: 0, y: 0, vx: 5, vy: 5, maxSpeed: 100 };
  const f = seek(a, { x: 0, y: 0 });
  assert.equal(f.x, 0);
  assert.equal(f.y, 0);
});

test('steering: seek caps at maxForce when supplied', () => {
  const a: Agent = { x: 0, y: 0, vx: 0, vy: 0, maxSpeed: 100, maxForce: 30 };
  const f = seek(a, { x: 1, y: 0 });
  // Without cap force = (100, 0); with maxForce=30 -> (30, 0).
  assert.ok(Math.abs(f.x - 30) < 1e-9);
});

test('steering: flee inverts seek direction', () => {
  const a: Agent = { x: 0, y: 0, vx: 0, vy: 0, maxSpeed: 100 };
  const f = flee(a, { x: 10, y: 0 });
  // Desired velocity points -x at maxSpeed=100.
  assert.ok(Math.abs(f.x + 100) < 1e-9);
});

test('steering: flee at target returns zero', () => {
  const a: Agent = { x: 5, y: 5, vx: 0, vy: 0, maxSpeed: 100 };
  const f = flee(a, { x: 5, y: 5 });
  assert.equal(f.x, 0);
  assert.equal(f.y, 0);
});

test('steering: arrive matches seek when far from target', () => {
  const a: Agent = { x: 0, y: 0, vx: 0, vy: 0, maxSpeed: 100 };
  const slowRadius = 5;
  // Target at distance 100; far outside slowRadius, should equal seek.
  const seekForce = seek(a, { x: 100, y: 0 });
  const arriveForce = arrive(a, { x: 100, y: 0 }, slowRadius);
  assert.ok(Math.abs(seekForce.x - arriveForce.x) < 1e-9);
  assert.ok(Math.abs(seekForce.y - arriveForce.y) < 1e-9);
});

test('steering: arrive decelerates inside slow radius', () => {
  const a: Agent = { x: 0, y: 0, vx: 0, vy: 0, maxSpeed: 100 };
  // Target at distance 5; slowRadius 10 -> speed = 100 * 0.5 = 50.
  const f = arrive(a, { x: 5, y: 0 }, 10);
  assert.ok(Math.abs(f.x - 50) < 1e-9);
});

test('steering: arrive at target slows to a stop', () => {
  const a: Agent = { x: 0, y: 0, vx: 50, vy: 0, maxSpeed: 100 };
  const f = arrive(a, { x: 0, y: 0 }, 10);
  // Force should counteract current velocity (-50, 0).
  assert.ok(Math.abs(f.x + 50) < 1e-9);
});

test('steering: pursue leads a moving target', () => {
  const agent: Agent = { x: 0, y: 0, vx: 0, vy: 0, maxSpeed: 10 };
  // Target moving in +y direction; pursue should aim ahead of it.
  const target: Agent = { x: 50, y: 0, vx: 0, vy: 5, maxSpeed: 10 };
  const seekToCurrent = seek(agent, { x: 50, y: 0 });
  const pursueForce = pursue(agent, target);
  // Pursue's y component should be positive (anticipating target's
  // future +y position); seek-to-current has y=0.
  assert.ok(Math.abs(seekToCurrent.y) < 1e-9);
  assert.ok(pursueForce.y > 0);
});

test('steering: pursue with stationary target = seek to position', () => {
  const agent: Agent = { x: 0, y: 0, vx: 0, vy: 0, maxSpeed: 10 };
  const target: Agent = { x: 50, y: 0, vx: 0, vy: 0, maxSpeed: 10 };
  const p = pursue(agent, target);
  const s = seek(agent, { x: 50, y: 0 });
  assert.ok(Math.abs(p.x - s.x) < 1e-9);
  assert.ok(Math.abs(p.y - s.y) < 1e-9);
});

test('steering: evade flees from predicted future position', () => {
  const agent: Agent = { x: 50, y: 0, vx: 0, vy: 0, maxSpeed: 10 };
  // Predator chasing in +x.
  const target: Agent = { x: 0, y: 0, vx: 5, vy: 0, maxSpeed: 10 };
  const f = evade(agent, target);
  // Should accelerate +x (away from predicted predator position).
  assert.ok(f.x > 0);
});

test('steering: separation - no neighbours returns zero', () => {
  const a: Agent = { x: 0, y: 0, vx: 0, vy: 0, maxSpeed: 100 };
  const f = separation(a, [], 10);
  assert.equal(f.x, 0);
  assert.equal(f.y, 0);
});

test('steering: separation - neighbour outside radius is ignored', () => {
  const a: Agent = { x: 0, y: 0, vx: 0, vy: 0, maxSpeed: 100 };
  const f = separation(a, [{ x: 100, y: 0 }], 10);
  assert.equal(f.x, 0);
  assert.equal(f.y, 0);
});

test('steering: separation - close neighbour pushes away', () => {
  const a: Agent = { x: 0, y: 0, vx: 0, vy: 0, maxSpeed: 100 };
  // Neighbour to the right, agent should push left.
  const f = separation(a, [{ x: 5, y: 0 }], 10);
  assert.ok(f.x < 0);
});

test('steering: separation - multiple neighbours sum', () => {
  const a: Agent = { x: 0, y: 0, vx: 0, vy: 0, maxSpeed: 100 };
  // Two close neighbours: one to the right, one above.
  const f = separation(a, [{ x: 1, y: 0 }, { x: 0, y: 1 }], 5);
  // Force should point down-left (negative x and y).
  assert.ok(f.x < 0);
  assert.ok(f.y < 0);
});

test('steering: separation with radius=0 returns zero', () => {
  const a: Agent = { x: 0, y: 0, vx: 0, vy: 0, maxSpeed: 100 };
  const f = separation(a, [{ x: 1, y: 0 }], 0);
  assert.equal(f.x, 0);
  assert.equal(f.y, 0);
});

test('steering: wander state.angle drifts with jitter', () => {
  const a: Agent = { x: 0, y: 0, vx: 0, vy: 0, maxSpeed: 10 };
  const state: WanderState = { angle: 0 };
  // Jitter of 0.5 radians per call.
  const seq = [0.3, -0.2, 0.4, -0.1];
  let i = 0;
  const rng = () => seq[i++ % seq.length] as number;
  wander(a, state, 5, 0.5, rng);
  // angle was 0; jitter += (0.3*2-1)*0.5 = -0.2.
  assert.ok(Math.abs(state.angle - (-0.2)) < 1e-9);
});

test('steering: wander returns a seek-toward-heading force', () => {
  const a: Agent = { x: 0, y: 0, vx: 0, vy: 0, maxSpeed: 10 };
  const state: WanderState = { angle: 0 }; // facing +x
  const rng = () => 0.5;  // No jitter (since 0.5*2-1 = 0).
  const f = wander(a, state, 5, 1, rng);
  // Heading 0 = +x; agent at origin; target at (5, 0); seek -> (10, 0).
  assert.ok(Math.abs(f.x - 10) < 1e-9);
  assert.ok(Math.abs(f.y) < 1e-9);
});

test('steering: realistic example - pursue + separation combined', () => {
  const hunter: Agent = { x: 0, y: 0, vx: 0, vy: 0, maxSpeed: 10, maxForce: 5 };
  const prey: Agent = { x: 50, y: 0, vx: 0, vy: 5, maxSpeed: 10 };
  const otherHunters = [{ x: 2, y: 0 }];
  const pursueF = pursue(hunter, prey);
  const sepF = separation(hunter, otherHunters, 5);
  // Caller would sum the two with weights:
  const totalX = pursueF.x + sepF.x * 0.5;
  const totalY = pursueF.y + sepF.y * 0.5;
  // Pursue dominates in x; separation pushes left a bit.
  assert.ok(totalX > 0);
});
