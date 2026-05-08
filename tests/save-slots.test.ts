// Phase 0.45.0 - SaveSlots tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  SaveSlots,
  PersistentStorage,
  MemoryStorageBackend,
  RESOURCE_SAVE_SLOTS,
  type WorldSnapshot,
} from '../src/index.js';

function makeSnap(engineVersion: string = '0.45.0', resources: Record<string, unknown> = {}): WorldSnapshot {
  return {
    schemaVersion: 1,
    engineVersion: engineVersion,
    capturedAtMs: 1000,
    resources: resources,
  };
}

function makeStorage(): PersistentStorage {
  return PersistentStorage.create({ backend: new MemoryStorageBackend() });
}

test('save-slots: RESOURCE_SAVE_SLOTS is the stable string', () => {
  assert.equal(RESOURCE_SAVE_SLOTS, 'save_slots');
});

test('save-slots: save + load roundtrip preserves snapshot + metadata', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  const snap = makeSnap('0.45.0', { time: { elapsed: 42 } });
  const meta = await ss.save('autosave', { snapshot: snap, label: 'Auto' }, () => 12345);
  assert.equal(meta.id, 'autosave');
  assert.equal(meta.label, 'Auto');
  assert.equal(meta.savedAtMs, 12345);
  assert.equal(meta.engineVersion, '0.45.0');
  const loaded = await ss.load('autosave');
  assert.ok(loaded !== null);
  assert.equal(loaded!.meta.id, 'autosave');
  assert.equal(loaded!.meta.label, 'Auto');
  assert.equal(loaded!.snapshot.engineVersion, '0.45.0');
  assert.deepEqual(loaded!.snapshot.resources, { time: { elapsed: 42 } });
});

test('save-slots: save with empty id throws', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  await assert.rejects(() => ss.save('', { snapshot: makeSnap() }));
});

test('save-slots: save with no snapshot throws', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  // @ts-expect-error - testing the runtime check
  await assert.rejects(() => ss.save('id', { snapshot: undefined }));
});

test('save-slots: load missing slot returns null', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  const loaded = await ss.load('never-saved');
  assert.equal(loaded, null);
});

test('save-slots: load corrupted payload returns null', async () => {
  const storage = makeStorage();
  // Stash a malformed envelope directly.
  await storage.save('slots/bad', { meta: 'not-an-object' });
  const ss = SaveSlots.create({ storage });
  const loaded = await ss.load('bad');
  assert.equal(loaded, null);
});

test('save-slots: hasKey reflects existence', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  assert.equal(await ss.has('s1'), false);
  await ss.save('s1', { snapshot: makeSnap() });
  assert.equal(await ss.has('s1'), true);
});

test('save-slots: delete drops the slot', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  await ss.save('s1', { snapshot: makeSnap() });
  assert.equal(await ss.delete('s1'), true);
  assert.equal(await ss.has('s1'), false);
});

test('save-slots: delete on missing returns false', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  assert.equal(await ss.delete('never'), false);
});

test('save-slots: listIds returns slots only (not foreign keys)', async () => {
  const storage = makeStorage();
  // Foreign key outside the slots prefix.
  await storage.save('config/audio', { volume: 1 });
  const ss = SaveSlots.create({ storage });
  await ss.save('s1', { snapshot: makeSnap() });
  await ss.save('s2', { snapshot: makeSnap() });
  const ids = (await ss.listIds()).sort();
  assert.deepEqual(ids, ['s1', 's2']);
});

test('save-slots: listAll sorts by recency descending by default', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  await ss.save('a', { snapshot: makeSnap() }, () => 1000);
  await ss.save('b', { snapshot: makeSnap() }, () => 3000);
  await ss.save('c', { snapshot: makeSnap() }, () => 2000);
  const metas = await ss.listAll();
  assert.deepEqual(metas.map((m) => m.id), ['b', 'c', 'a']);
});

test('save-slots: listAll sorts by name when requested', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  await ss.save('charlie', { snapshot: makeSnap() }, () => 1000);
  await ss.save('alpha', { snapshot: makeSnap() }, () => 2000);
  await ss.save('bravo', { snapshot: makeSnap() }, () => 3000);
  const metas = await ss.listAll('name');
  assert.deepEqual(metas.map((m) => m.id), ['alpha', 'bravo', 'charlie']);
});

test('save-slots: rename moves the slot under the new id', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  await ss.save('old', { snapshot: makeSnap('0.45.0', { x: 1 }) });
  assert.equal(await ss.rename('old', 'new'), true);
  assert.equal(await ss.has('old'), false);
  const loaded = await ss.load('new');
  assert.ok(loaded !== null);
  assert.equal(loaded!.meta.id, 'new');
  assert.deepEqual(loaded!.snapshot.resources, { x: 1 });
});

test('save-slots: rename refuses to overwrite an existing destination', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  await ss.save('a', { snapshot: makeSnap() });
  await ss.save('b', { snapshot: makeSnap() });
  assert.equal(await ss.rename('a', 'b'), false);
  // Both still exist.
  assert.equal(await ss.has('a'), true);
  assert.equal(await ss.has('b'), true);
});

test('save-slots: rename on missing source returns false', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  assert.equal(await ss.rename('nothing', 'something'), false);
});

test('save-slots: rename to same id is a no-op success', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  await ss.save('a', { snapshot: makeSnap() });
  assert.equal(await ss.rename('a', 'a'), true);
  assert.equal(await ss.has('a'), true);
});

test('save-slots: duplicate copies the slot under a new id with fresh timestamp', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  await ss.save('quicksave', { snapshot: makeSnap('0.45.0', { hp: 99 }), label: 'Quick' }, () => 1000);
  assert.equal(await ss.duplicate('quicksave', 'manual-1', () => 5000), true);
  const loaded = await ss.load('manual-1');
  assert.ok(loaded !== null);
  assert.equal(loaded!.meta.id, 'manual-1');
  assert.equal(loaded!.meta.label, 'Quick');
  assert.equal(loaded!.meta.savedAtMs, 5000);
  assert.deepEqual(loaded!.snapshot.resources, { hp: 99 });
  // Original slot still exists.
  assert.equal(await ss.has('quicksave'), true);
});

test('save-slots: duplicate refuses to overwrite + missing source', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  await ss.save('a', { snapshot: makeSnap() });
  await ss.save('b', { snapshot: makeSnap() });
  assert.equal(await ss.duplicate('a', 'b'), false);
  assert.equal(await ss.duplicate('missing', 'c'), false);
  assert.equal(await ss.duplicate('a', 'a'), false);
});

test('save-slots: clearAll removes every slot', async () => {
  const storage = makeStorage();
  // Foreign key.
  await storage.save('config/x', { y: 1 });
  const ss = SaveSlots.create({ storage });
  await ss.save('s1', { snapshot: makeSnap() });
  await ss.save('s2', { snapshot: makeSnap() });
  await ss.clearAll();
  const ids = await ss.listIds();
  assert.deepEqual(ids, []);
  // Foreign key untouched.
  assert.equal(await storage.hasKey('config/x'), true);
});

test('save-slots: thumbnail under cap is preserved', async () => {
  const ss = SaveSlots.create({ storage: makeStorage(), maxThumbnailBytes: 1000 });
  const thumb = 'data:image/png;base64,' + 'A'.repeat(500);
  await ss.save('s1', { snapshot: makeSnap(), thumbnailDataUrl: thumb });
  const loaded = await ss.load('s1');
  assert.equal(loaded!.meta.thumbnailDataUrl, thumb);
});

test('save-slots: thumbnail over cap is silently dropped', async () => {
  const ss = SaveSlots.create({ storage: makeStorage(), maxThumbnailBytes: 100 });
  const thumb = 'data:image/png;base64,' + 'A'.repeat(500);
  const meta = await ss.save('s1', { snapshot: makeSnap(), thumbnailDataUrl: thumb });
  assert.equal(meta.thumbnailDataUrl, undefined);
  const loaded = await ss.load('s1');
  assert.equal(loaded!.meta.thumbnailDataUrl, undefined);
});

test('save-slots: userMeta + playtimeSeconds preserved', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  await ss.save('s1', {
    snapshot: makeSnap(),
    playtimeSeconds: 3600,
    userMeta: { hero: 'Misha', zone: 'plaza' },
  });
  const loaded = await ss.load('s1');
  assert.equal(loaded!.meta.playtimeSeconds, 3600);
  assert.deepEqual(loaded!.meta.userMeta, { hero: 'Misha', zone: 'plaza' });
});

test('save-slots: loadMeta returns metadata without full snapshot decoding overhead', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  await ss.save('s1', { snapshot: makeSnap('0.45.0', { x: 1 }), label: 'Saved' });
  const meta = await ss.loadMeta('s1');
  assert.ok(meta !== null);
  assert.equal(meta!.id, 's1');
  assert.equal(meta!.label, 'Saved');
});

test('save-slots: dispose makes ops no-op', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  await ss.save('s1', { snapshot: makeSnap() });
  ss.dispose();
  assert.equal(await ss.has('s1'), false); // disposed -> false
  await assert.rejects(() => ss.save('s2', { snapshot: makeSnap() }));
});

test('save-slots: custom prefix isolates slot keys', async () => {
  const storage = makeStorage();
  const a = SaveSlots.create({ storage, prefix: 'p1/' });
  const b = SaveSlots.create({ storage, prefix: 'p2/' });
  await a.save('hero', { snapshot: makeSnap() });
  await b.save('hero', { snapshot: makeSnap() });
  // Both slots exist independently.
  assert.equal(await a.has('hero'), true);
  assert.equal(await b.has('hero'), true);
  await a.delete('hero');
  // Deleting from a does not affect b.
  assert.equal(await b.has('hero'), true);
});

test('save-slots: meta.engineVersion captured from snapshot', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  await ss.save('s1', { snapshot: makeSnap('0.99.0') });
  const meta = await ss.loadMeta('s1');
  assert.equal(meta!.engineVersion, '0.99.0');
});

test('save-slots: rename preserves metadata + snapshot', async () => {
  const ss = SaveSlots.create({ storage: makeStorage() });
  await ss.save('a', {
    snapshot: makeSnap('0.45.0', { hp: 100 }),
    label: 'My Save',
    playtimeSeconds: 999,
  }, () => 12345);
  await ss.rename('a', 'b');
  const loaded = await ss.load('b');
  assert.equal(loaded!.meta.label, 'My Save');
  assert.equal(loaded!.meta.playtimeSeconds, 999);
  assert.equal(loaded!.meta.savedAtMs, 12345); // preserved
  assert.deepEqual(loaded!.snapshot.resources, { hp: 100 });
});
