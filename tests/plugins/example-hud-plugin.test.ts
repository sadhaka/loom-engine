// Loom Engine - Phase 0.19 client-side plugin SDK example.
//
// Sample HUD plugin demonstrating the canonical use case: listen
// for zone.boss.spawn -> mount an HP-bar overlay, update on every
// zone.boss.tick, unmount on zone.boss.end. The plugin runs against
// a minimal DOM seam (a recorder object emulating the document
// surface the real plugin would touch) so the test stays
// dep-free - jsdom is NOT pulled in. A production embedder would
// inject document directly via opts.
//
// What this proves end-to-end:
//   1. The registry routes spawn -> tick -> end correctly via the
//      catch-all + narrow hooks.
//   2. A plugin can mount + update + unmount DOM via dispose().
//   3. Storage round-trips per dispatch (the plugin caches the
//      element reference between hooks via ctx.storage).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  ClientPluginRegistry,
  type IClientPlugin,
  type ClientPluginContext,
  type ZoneEventEnvelope,
  type ZoneBossSpec,
} from '../../src/index.js';

// ----- Minimal DOM seam -----
//
// The real plugin would call document.createElement / appendChild /
// remove(). Here we expose the same shape as a recording adapter
// so we can assert what would have been mounted without spinning up
// jsdom. The plugin author would replace this with a `document`
// reference (or accept it via constructor options).
interface DOMSeam {
  mounted: Map<string, { hp: number; hpMax: number; bossName: string }>;
  ops: string[];
}

function newSeam(): DOMSeam {
  return { mounted: new Map(), ops: [] };
}

function makeBossHudPlugin(seam: DOMSeam): IClientPlugin {
  return {
    name: 'boss-hud',
    version: '0.1.0',
    priority: 50,
    description: 'Renders a boss HP bar on zone.boss.spawn / tick / end',
    tags: ['hud', 'demo'],
    requiresProtocol: 'loom-director-v3',
    requiredScopes: ['read_zones', 'read_events'],
    tickBudgetMs: 100,
    storageMaxBytes: 4096,

    async onBossSpawn(ctx: ClientPluginContext, zoneId: string, boss: ZoneBossSpec): Promise<void> {
      var key = String(zoneId) + ':' + String(boss.boss_id);
      seam.mounted.set(key, { hp: boss.hp_current, hpMax: boss.hp_max, bossName: boss.name });
      seam.ops.push('mount:' + key);
      // Stash the key in plugin storage so subsequent ticks can
      // look it up without re-deriving. The real plugin uses this
      // for the actual DOM element handle.
      try {
        await ctx.storage.set('mount:' + key, true);
      } catch {
        // storage cap exceeded - we'd swallow but this test fits.
      }
    },

    async onZoneEvent(ctx: ClientPluginContext, env: ZoneEventEnvelope): Promise<void> {
      if (env.type !== 'zone.boss.tick') return;
      var d = env.data as { boss_id: string; hp_current: number };
      var key = String(env.zone_id) + ':' + String(d.boss_id);
      var state = seam.mounted.get(key);
      if (!state) return;
      // Verify storage round-trip across hook calls.
      var marker = await ctx.storage.get('mount:' + key);
      if (marker !== true) return;
      state.hp = d.hp_current;
      seam.ops.push('update:' + key + ':' + String(d.hp_current));
    },

    async onBossEnd(ctx: ClientPluginContext, zoneId: string, bossId: string): Promise<void> {
      var key = String(zoneId) + ':' + String(bossId);
      if (seam.mounted.delete(key)) seam.ops.push('unmount:' + key);
      try {
        await ctx.storage.delete('mount:' + key);
      } catch {
        // ignore
      }
    },

    async dispose(): Promise<void> {
      // Flush every still-mounted overlay on plugin teardown so a
      // hot-reload does not leak DOM nodes. Mirror of the Python
      // dispose(): clean up upstream connections + ephemeral state.
      var keys: string[] = [];
      var iter = seam.mounted.keys();
      var next = iter.next();
      while (!next.done) {
        keys.push(next.value);
        next = iter.next();
      }
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (!k) continue;
        seam.mounted.delete(k);
        seam.ops.push('dispose-unmount:' + k);
      }
    },
  };
}

// ----- Tests -----

test('example HUD plugin: spawn -> tick -> end produces mount / update / unmount', async function () {
  var seam = newSeam();
  var bus = new EventTarget();
  var r = new ClientPluginRegistry({ eventTarget: bus });
  r.register(makeBossHudPlugin(seam));

  // Spawn.
  bus.dispatchEvent(new CustomEvent('arpg:zone-boss-spawn', {
    detail: {
      id: 1, ts: 1000, type: 'zone.boss.spawn', zone_id: 'lastlight', emitter_id: null,
      data: {
        boss: { boss_id: 'b1', type: 'shadow_warden', name: 'Shadow Warden',
                hp_max: 1000, hp_current: 1000, dmg: 25, x: 0, y: 0, knot_flavor: 'shadow' },
        narrator_line: null,
      },
    },
  }));
  await new Promise(function (r2) { setTimeout(r2, 5); });

  // Tick.
  bus.dispatchEvent(new CustomEvent('arpg:zone-boss-tick', {
    detail: {
      id: 2, ts: 1500, type: 'zone.boss.tick', zone_id: 'lastlight', emitter_id: null,
      data: { boss_id: 'b1', hp_current: 600, x: 1, y: 1, recent_hits: [] },
    },
  }));
  await new Promise(function (r2) { setTimeout(r2, 5); });

  // End.
  bus.dispatchEvent(new CustomEvent('arpg:zone-boss-end', {
    detail: {
      id: 3, ts: 2000, type: 'zone.boss.end', zone_id: 'lastlight', emitter_id: null,
      data: {
        boss_id: 'b1', outcome: 'killed', killer_character_id: 'c1',
        loot: [], duration_ms: 30000,
      },
    },
  }));
  await new Promise(function (r2) { setTimeout(r2, 5); });

  assert.deepEqual(seam.ops, [
    'mount:lastlight:b1',
    'update:lastlight:b1:600',
    'unmount:lastlight:b1',
  ]);
  assert.equal(seam.mounted.size, 0);
  await r.dispose();
});

test('example HUD plugin: dispose flushes every mounted overlay', async function () {
  var seam = newSeam();
  var r = new ClientPluginRegistry({ eventTarget: null });
  r.register(makeBossHudPlugin(seam));
  // Spawn but never end - simulates a hot-reload mid-fight.
  await r.dispatchZoneEvent({
    id: 1, ts: 1000, type: 'zone.boss.spawn', zone_id: 'z', emitter_id: null,
    data: {
      boss: { boss_id: 'b1', type: 'x', name: 'X', hp_max: 100, hp_current: 100,
              dmg: 1, x: 0, y: 0, knot_flavor: 'shadow' },
      narrator_line: null,
    },
  });
  assert.equal(seam.mounted.size, 1);
  await r.unregister('boss-hud');
  // dispose() must have flushed it.
  assert.equal(seam.mounted.size, 0);
  assert.ok(seam.ops.indexOf('dispose-unmount:z:b1') >= 0);
});

test('example HUD plugin: describe row exposes metadata for inspection', function () {
  var seam = newSeam();
  var r = new ClientPluginRegistry({ eventTarget: null });
  r.register(makeBossHudPlugin(seam));
  var rows = r.describe();
  var row = rows[0];
  if (!row) throw new Error('no describe row');
  assert.equal(row.name, 'boss-hud');
  assert.equal(row.requires_protocol, 'loom-director-v3');
  assert.deepEqual(row.tags.slice().sort(), ['demo', 'hud']);
  assert.deepEqual(row.scopes.slice().sort(), ['read_events', 'read_zones']);
  assert.ok(row.hooks.indexOf('onBossSpawn') >= 0);
  assert.ok(row.hooks.indexOf('onZoneEvent') >= 0);
  assert.ok(row.hooks.indexOf('onBossEnd') >= 0);
  assert.ok(row.hooks.indexOf('dispose') >= 0);
});
