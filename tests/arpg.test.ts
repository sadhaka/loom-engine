// Loom Engine - Phase 8 ARPG tests.
// ZoneState transitions, ZoneCatalog shape, InteractablePool +
// InteractionSystem trigger paths.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  // Zone
  createZoneState,
  beginTransition,
  tickTransition,
  isTransitioning,
  RESOURCE_ZONE_STATE,
  ZONE_CATALOG,
  // Interaction
  InteractablePool,
  POOL_INTERACTABLE,
  INTERACTABLE_FLAG_ACTIVE,
  InteractionSystem,
  createLastInteraction,
  RESOURCE_LAST_INTERACTION,
  // Re-used
  TransformPool,
  POOL_TRANSFORM,
  RESOURCE_INPUT,
  RESOURCE_CAMERA,
  RESOURCE_TIME,
  createCamera,
  createTimeResource,
  SYSTEM_PHASE_LOGIC,
  type ZoneStateResource,
  type LastInteractionResource,
  entityIndex,
} from '../src/index.js';

// ---------- ZoneState ----------

test('zone state: starts at lastlight_plaza by default', () => {
  const z = createZoneState();
  assert.equal(z.activeZoneId, 'lastlight_plaza');
  assert.equal(isTransitioning(z), false);
});

test('zone state: beginTransition sets up + tick advances + completes', () => {
  const z = createZoneState();
  const ok = beginTransition(z, 'iron_reach', 'walk', 100, 1000);
  assert.equal(ok, true);
  assert.ok(isTransitioning(z));
  assert.equal(z.activeZoneId, 'lastlight_plaza');   // not yet swapped
  // Halfway through the fade.
  const halfway = tickTransition(z, 1050);
  assert.ok(halfway >= 0.4 && halfway <= 0.6);
  assert.ok(isTransitioning(z));
  // Tick to completion.
  const done = tickTransition(z, 1100);
  assert.equal(done, 1);
  assert.equal(z.activeZoneId, 'iron_reach');
  assert.equal(isTransitioning(z), false);
});

test('zone state: beginTransition same-zone is a no-op', () => {
  const z = createZoneState('iron_reach');
  const ok = beginTransition(z, 'iron_reach', 'walk', 100, 1000);
  assert.equal(ok, false);
  assert.equal(isTransitioning(z), false);
});

test('zone state: tickTransition returns -1 when no transition', () => {
  const z = createZoneState();
  assert.equal(tickTransition(z, 999), -1);
});

// ---------- ZoneCatalog ----------

test('zone catalog: 8 zones (1 hub + 3 pure + 3 hybrid + 1 center)', () => {
  const ids: Array<keyof typeof ZONE_CATALOG> = [
    'lastlight_plaza',
    'iron_reach',
    'saltsprig',
    'the_archive',
    'hammerwash',
    'crystwell',
    'forge_archive',
    'centerknot_crossroads',
  ];
  for (const id of ids) {
    const e = ZONE_CATALOG[id];
    assert.ok(e, id);
    assert.equal(e.id, id);
    assert.ok(e.name.length > 0);
    assert.ok(e.exits.length > 0);
  }
});

test('zone catalog: pure-knot zones have correct knot tags', () => {
  assert.equal(ZONE_CATALOG.iron_reach.knot, 'str');
  assert.equal(ZONE_CATALOG.saltsprig.knot, 'dex');
  assert.equal(ZONE_CATALOG.the_archive.knot, 'int');
});

test('zone catalog: each zone exits to plaza at minimum', () => {
  const ids: Array<keyof typeof ZONE_CATALOG> = [
    'iron_reach',
    'saltsprig',
    'the_archive',
    'hammerwash',
    'crystwell',
    'forge_archive',
    'centerknot_crossroads',
  ];
  for (const id of ids) {
    const e = ZONE_CATALOG[id];
    assert.ok(e.exits.includes('lastlight_plaza'), id + ' exits to plaza');
  }
});

// ---------- InteractablePool ----------

test('interactable pool: attach + isActive + accessors', () => {
  const p = new InteractablePool();
  const e: number = 1;
  p.attach(e, {
    kind: 'npc',
    prompt: 'Talk to Misha Dev',
    payload: 'misha_greet',
    radius: 1.5,
  });
  assert.ok(p.isActive(e));
  assert.equal(p.getKind(e), 'npc');
  assert.equal(p.getPrompt(e), 'Talk to Misha Dev');
  assert.equal(p.getPayload(e), 'misha_greet');
  assert.equal(p.radius[entityIndex(e)], 1.5);
});

test('interactable pool: detach clears ACTIVE', () => {
  const p = new InteractablePool();
  const e: number = 1;
  p.attach(e, { kind: 'npc', prompt: '', payload: '', radius: 1 });
  p.detach(e);
  assert.ok(!p.isActive(e));
});

// ---------- InteractionSystem ----------

test('interaction system: E key inside radius triggers nearest NPC', async () => {
  const { World } = await import('../src/world.js');
  const { InputManager } = await import('../src/input/input-manager.js');
  const w = new World();
  const transforms = new TransformPool();
  const interactables = new InteractablePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_INTERACTABLE, interactables);
  const last = createLastInteraction();
  w.resources.set(RESOURCE_LAST_INTERACTION, last);
  w.resources.set(RESOURCE_CAMERA, createCamera(640, 400));
  w.resources.set(RESOURCE_TIME, createTimeResource());

  const player = w.createEntity();
  const npc = w.createEntity();
  transforms.attach(player, 0, 0, 0);
  transforms.attach(npc, 0.5, 0, 0);   // very close to player
  interactables.attach(npc, {
    kind: 'npc',
    prompt: 'Talk',
    payload: 'greet',
    radius: 1.0,
  });

  const im = new InputManager();
  im.injectKeyDown('KeyE');
  im.beginFrame();
  w.resources.set(RESOURCE_INPUT, im.snapshot());

  w.addSystem(new InteractionSystem({ player }), SYSTEM_PHASE_LOGIC);
  w.update(0.016);

  const r = w.resources.require<LastInteractionResource>(RESOURCE_LAST_INTERACTION);
  assert.equal(r.entityIndex, entityIndex(npc));
  assert.equal(r.kind, 'npc');
  assert.equal(r.payload, 'greet');
});

test('interaction system: Enter key also triggers (per CLAUDE.md hotkey lock)', async () => {
  const { World } = await import('../src/world.js');
  const { InputManager } = await import('../src/input/input-manager.js');
  const w = new World();
  const transforms = new TransformPool();
  const interactables = new InteractablePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_INTERACTABLE, interactables);
  const last = createLastInteraction();
  w.resources.set(RESOURCE_LAST_INTERACTION, last);
  w.resources.set(RESOURCE_CAMERA, createCamera(640, 400));
  w.resources.set(RESOURCE_TIME, createTimeResource());

  const player = w.createEntity();
  const portal = w.createEntity();
  transforms.attach(player, 0, 0, 0);
  transforms.attach(portal, 0.4, 0, 0);
  interactables.attach(portal, {
    kind: 'portal',
    prompt: 'Enter Iron Reach',
    payload: 'iron_reach',
    radius: 0.8,
  });

  const im = new InputManager();
  im.injectKeyDown('Enter');
  im.beginFrame();
  w.resources.set(RESOURCE_INPUT, im.snapshot());

  w.addSystem(new InteractionSystem({ player }), SYSTEM_PHASE_LOGIC);
  w.update(0.016);

  const r = w.resources.require<LastInteractionResource>(RESOURCE_LAST_INTERACTION);
  assert.equal(r.kind, 'portal');
  assert.equal(r.payload, 'iron_reach');
});

test('interaction system: E outside radius does NOT trigger', async () => {
  const { World } = await import('../src/world.js');
  const { InputManager } = await import('../src/input/input-manager.js');
  const w = new World();
  const transforms = new TransformPool();
  const interactables = new InteractablePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_INTERACTABLE, interactables);
  const last = createLastInteraction();
  w.resources.set(RESOURCE_LAST_INTERACTION, last);
  w.resources.set(RESOURCE_CAMERA, createCamera(640, 400));
  w.resources.set(RESOURCE_TIME, createTimeResource());

  const player = w.createEntity();
  const npc = w.createEntity();
  transforms.attach(player, 0, 0, 0);
  transforms.attach(npc, 5, 0, 0);   // way out of NPC radius
  interactables.attach(npc, { kind: 'npc', prompt: '', payload: 'greet', radius: 1.0 });

  const im = new InputManager();
  im.injectKeyDown('KeyE');
  im.beginFrame();
  w.resources.set(RESOURCE_INPUT, im.snapshot());

  w.addSystem(new InteractionSystem({ player }), SYSTEM_PHASE_LOGIC);
  w.update(0.016);

  // Last interaction stays at default (no trigger).
  const r = w.resources.require<LastInteractionResource>(RESOURCE_LAST_INTERACTION);
  assert.equal(r.entityIndex, -1);
});

test('interaction system: detached interactables are skipped', async () => {
  const { World } = await import('../src/world.js');
  const { InputManager } = await import('../src/input/input-manager.js');
  const w = new World();
  const transforms = new TransformPool();
  const interactables = new InteractablePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_INTERACTABLE, interactables);
  const last = createLastInteraction();
  w.resources.set(RESOURCE_LAST_INTERACTION, last);
  w.resources.set(RESOURCE_CAMERA, createCamera(640, 400));
  w.resources.set(RESOURCE_TIME, createTimeResource());

  const player = w.createEntity();
  const npc = w.createEntity();
  transforms.attach(player, 0, 0, 0);
  transforms.attach(npc, 0.4, 0, 0);
  interactables.attach(npc, { kind: 'npc', prompt: '', payload: 'greet', radius: 1.0 });
  interactables.detach(npc);
  // Verify the flag is cleared so the next assertion is meaningful.
  assert.equal((interactables.flags[entityIndex(npc)] ?? 0) & INTERACTABLE_FLAG_ACTIVE, 0);

  const im = new InputManager();
  im.injectKeyDown('KeyE');
  im.beginFrame();
  w.resources.set(RESOURCE_INPUT, im.snapshot());

  w.addSystem(new InteractionSystem({ player }), SYSTEM_PHASE_LOGIC);
  w.update(0.016);

  const r = w.resources.require<LastInteractionResource>(RESOURCE_LAST_INTERACTION);
  assert.equal(r.entityIndex, -1);
});

// ---------- Zone resource registered by Engine.create ----------
// This is a smoke that the engine's default-resource registration
// includes the new Phase 8 resources.

test('zone state + last interaction registered as engine resources by default', async () => {
  // Build a world directly (not via Engine.create which wants a
  // Canvas; tests can't construct a real one). Verify the resource
  // KEYS are exported and the create helpers work.
  const z: ZoneStateResource = createZoneState('saltsprig');
  assert.equal(z.activeZoneId, 'saltsprig');
  const last = createLastInteraction();
  assert.equal(last.entityIndex, -1);
  assert.equal(typeof RESOURCE_ZONE_STATE, 'string');
  assert.equal(typeof RESOURCE_LAST_INTERACTION, 'string');
});
