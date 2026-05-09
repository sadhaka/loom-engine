// Phase 1.4.0 - AmbientLayerMixer tests (Wave 1.4 audio cinematic depth opens).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AmbientLayerMixer,
  RESOURCE_AMBIENT_LAYER_MIXER,
} from '../src/index.js';

test('alm: RESOURCE_AMBIENT_LAYER_MIXER is the stable string', () => {
  assert.equal(RESOURCE_AMBIENT_LAYER_MIXER, 'ambient_layer_mixer');
});

test('alm: starts empty', () => {
  const m = AmbientLayerMixer.create();
  assert.equal(m.layerCount(), 0);
});

test('alm: registerLayer + hasLayer + layerIds', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'rain', volume: 0.5 });
  m.registerLayer({ id: 'wind' });
  assert.equal(m.hasLayer('rain'), true);
  assert.deepEqual(m.layerIds().sort(), ['rain', 'wind']);
});

test('alm: registerLayer rejects empty id', () => {
  const m = AmbientLayerMixer.create();
  assert.equal(m.registerLayer({ id: '' }), false);
});

test('alm: registerLayer clamps volume to [0, 1]', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'a', volume: 5 });
  m.registerLayer({ id: 'b', volume: -1 });
  assert.equal(m.getLayer('a')!.volume, 1);
  assert.equal(m.getLayer('b')!.volume, 0);
});

test('alm: setTarget lerps over fadeMs', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'rain', volume: 0 });
  m.setTarget('rain', 1, { fadeMs: 1000 });
  m.tick(500); // halfway
  assert.ok(Math.abs(m.getLayer('rain')!.volume - 0.5) < 0.01);
  m.tick(500); // done
  assert.equal(m.getLayer('rain')!.volume, 1);
});

test('alm: setTarget with fadeMs=0 snaps immediately', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'rain', volume: 0 });
  m.setTarget('rain', 1, { fadeMs: 0 });
  assert.equal(m.getLayer('rain')!.volume, 1);
});

test('alm: setTarget uses defaultFadeMs when fadeMs omitted', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'rain', volume: 0, defaultFadeMs: 200 });
  m.setTarget('rain', 1);
  m.tick(100); // halfway through 200ms default
  assert.ok(Math.abs(m.getLayer('rain')!.volume - 0.5) < 0.01);
});

test('alm: setTarget clamps target', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'rain', volume: 0 });
  m.setTarget('rain', 5, { fadeMs: 0 });
  assert.equal(m.getLayer('rain')!.volume, 1);
});

test('alm: setTarget unknown layer returns false', () => {
  const m = AmbientLayerMixer.create();
  assert.equal(m.setTarget('missing', 0.5), false);
});

test('alm: setTargets batch updates', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'rain' });
  m.registerLayer({ id: 'wind' });
  m.registerLayer({ id: 'crickets' });
  m.setTargets({ rain: 0.3, wind: 0.7, crickets: 0.2 }, { fadeMs: 0 });
  assert.equal(m.getLayer('rain')!.volume, 0.3);
  assert.equal(m.getLayer('wind')!.volume, 0.7);
  assert.equal(m.getLayer('crickets')!.volume, 0.2);
});

test('alm: snap is shorthand for setTarget fadeMs=0', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'rain', volume: 0 });
  m.snap('rain', 0.8);
  assert.equal(m.getLayer('rain')!.volume, 0.8);
});

test('alm: silenceAll snaps all to 0', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'rain', volume: 0.8 });
  m.registerLayer({ id: 'wind', volume: 0.5 });
  m.silenceAll();
  assert.equal(m.getLayer('rain')!.volume, 0);
  assert.equal(m.getLayer('wind')!.volume, 0);
});

test('alm: fade up then fade down', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'rain', volume: 0 });
  m.setTarget('rain', 1, { fadeMs: 100 });
  m.tick(100);
  assert.equal(m.getLayer('rain')!.volume, 1);
  m.setTarget('rain', 0, { fadeMs: 100 });
  m.tick(50);
  assert.ok(Math.abs(m.getLayer('rain')!.volume - 0.5) < 0.01);
  m.tick(50);
  assert.equal(m.getLayer('rain')!.volume, 0);
});

test('alm: setTarget mid-fade restarts from current volume', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'rain', volume: 0 });
  m.setTarget('rain', 1, { fadeMs: 1000 });
  m.tick(500); // volume 0.5
  m.setTarget('rain', 0, { fadeMs: 500 });
  m.tick(250); // halfway through new fade: 0.5 -> 0, halfway = 0.25
  assert.ok(Math.abs(m.getLayer('rain')!.volume - 0.25) < 0.01);
});

test('alm: removeLayer drops it', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'rain' });
  assert.equal(m.removeLayer('rain'), true);
  assert.equal(m.hasLayer('rain'), false);
});

test('alm: forEach iterates all layers', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'a', volume: 0.1 });
  m.registerLayer({ id: 'b', volume: 0.2 });
  const seen: string[] = [];
  m.forEach((l) => seen.push(l.id));
  assert.deepEqual(seen.sort(), ['a', 'b']);
});

test('alm: list returns snapshots', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'a', volume: 0.5 });
  const list = m.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]!.volume, 0.5);
});

test('alm: NaN / negative dt no-op', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'rain', volume: 0 });
  m.setTarget('rain', 1, { fadeMs: 1000 });
  m.tick(NaN);
  m.tick(-50);
  m.tick(Infinity);
  assert.equal(m.getLayer('rain')!.volume, 0);
});

test('alm: throwing forEach callback isolated', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'a', volume: 0.5 });
  m.forEach(() => { throw new Error('boom'); }); // should not throw
  assert.equal(m.layerCount(), 1);
});

test('alm: clear empties + dispose locks', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'a' });
  m.clear();
  assert.equal(m.layerCount(), 0);
  m.dispose();
  assert.equal(m.registerLayer({ id: 'b' }), false);
});

test('alm: realistic example - zone transition forest -> rain', () => {
  const m = AmbientLayerMixer.create();
  m.registerLayer({ id: 'rain', volume: 0, defaultFadeMs: 2000 });
  m.registerLayer({ id: 'wind', volume: 0.3, defaultFadeMs: 2000 });
  m.registerLayer({ id: 'crickets', volume: 0.6, defaultFadeMs: 2000 });
  // Storm rolls in.
  m.setTargets({ rain: 0.8, crickets: 0, wind: 0.6 });
  m.tick(2000); // fade complete
  assert.ok(Math.abs(m.getLayer('rain')!.volume - 0.8) < 0.01);
  assert.equal(m.getLayer('crickets')!.volume, 0);
  assert.ok(Math.abs(m.getLayer('wind')!.volume - 0.6) < 0.01);
});
