// Phase 0.85.0 - HotKeyProfileManager tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  HotKeyProfileManager,
  RESOURCE_HOTKEY_PROFILE,
  type HotKeyProfile,
} from '../src/index.js';

test('hotkey-profile: RESOURCE constant', () => {
  assert.equal(RESOURCE_HOTKEY_PROFILE, 'hotkey_profile');
});

test('hotkey-profile: register + has + size', () => {
  const hk = HotKeyProfileManager.create();
  assert.ok(hk.registerProfile({
    id: 'default', name: 'Default',
    bindings: [{ action: 'move-up', key: 'KeyW' }],
  }));
  assert.ok(hk.has('default'));
  assert.equal(hk.size(), 1);
});

test('hotkey-profile: register rejects invalid + duplicates', () => {
  const hk = HotKeyProfileManager.create();
  assert.equal(hk.registerProfile({ id: '', name: 'x', bindings: [] }), false);
  assert.equal(hk.registerProfile({
    id: 'x', name: 'x', bindings: [{ action: '', key: 'KeyW' }],
  }), false);
  hk.registerProfile({ id: 'x', name: 'X', bindings: [] });
  assert.equal(hk.registerProfile({ id: 'x', name: 'Other', bindings: [] }), false);
});

test('hotkey-profile: setActive + getActive', () => {
  const hk = HotKeyProfileManager.create();
  hk.registerProfile({ id: 'a', name: 'A', bindings: [] });
  assert.ok(hk.setActive('a'));
  assert.equal(hk.getActive(), 'a');
  assert.equal(hk.setActive('ghost'), false);
});

test('hotkey-profile: resolveAction without active returns null', () => {
  const hk = HotKeyProfileManager.create();
  hk.registerProfile({
    id: 'a', name: 'A', bindings: [{ action: 'move-up', key: 'KeyW' }],
  });
  assert.equal(hk.resolveAction('move-up'), null);
});

test('hotkey-profile: resolveAction returns binding from active profile', () => {
  const hk = HotKeyProfileManager.create();
  hk.registerProfile({
    id: 'a', name: 'A', bindings: [{ action: 'move-up', key: 'KeyW' }],
  });
  hk.setActive('a');
  assert.equal(hk.resolveAction('move-up'), 'KeyW');
});

test('hotkey-profile: resolveAction returns null for unknown action', () => {
  const hk = HotKeyProfileManager.create();
  hk.registerProfile({ id: 'a', name: 'A', bindings: [] });
  hk.setActive('a');
  assert.equal(hk.resolveAction('nope'), null);
});

test('hotkey-profile: inheritance walks parent on miss', () => {
  const hk = HotKeyProfileManager.create();
  hk.registerProfile({
    id: 'default', name: 'Default',
    bindings: [
      { action: 'move-up', key: 'KeyW' },
      { action: 'attack', key: 'Space' },
    ],
  });
  hk.registerProfile({
    id: 'warrior', name: 'Warrior', inherits: 'default',
    bindings: [{ action: 'shout', key: 'KeyQ' }],
  });
  hk.setActive('warrior');
  assert.equal(hk.resolveAction('shout'), 'KeyQ');
  assert.equal(hk.resolveAction('move-up'), 'KeyW');
  assert.equal(hk.resolveAction('attack'), 'Space');
});

test('hotkey-profile: child overrides parent binding', () => {
  const hk = HotKeyProfileManager.create();
  hk.registerProfile({
    id: 'default', name: 'Default',
    bindings: [{ action: 'attack', key: 'Space' }],
  });
  hk.registerProfile({
    id: 'wasd', name: 'WASD', inherits: 'default',
    bindings: [{ action: 'attack', key: 'KeyJ' }],
  });
  hk.setActive('wasd');
  assert.equal(hk.resolveAction('attack'), 'KeyJ');
});

test('hotkey-profile: inheritance cycle handled (visited tracking)', () => {
  const hk = HotKeyProfileManager.create();
  hk.registerProfile({ id: 'a', name: 'A', inherits: 'b', bindings: [{ action: 'x', key: 'KeyA' }] });
  hk.registerProfile({ id: 'b', name: 'B', inherits: 'a', bindings: [{ action: 'y', key: 'KeyB' }] });
  hk.setActive('a');
  // Should not infinite-loop. Resolves x via a.
  assert.equal(hk.resolveAction('x'), 'KeyA');
  // y is in b; reachable through inheritance.
  assert.equal(hk.resolveAction('y'), 'KeyB');
  // Unknown: doesn't loop.
  assert.equal(hk.resolveAction('z'), null);
});

test('hotkey-profile: setBinding adds new', () => {
  const hk = HotKeyProfileManager.create();
  hk.registerProfile({ id: 'a', name: 'A', bindings: [] });
  assert.ok(hk.setBinding('a', 'attack', 'Space'));
  hk.setActive('a');
  assert.equal(hk.resolveAction('attack'), 'Space');
});

test('hotkey-profile: setBinding replaces existing', () => {
  const hk = HotKeyProfileManager.create();
  hk.registerProfile({
    id: 'a', name: 'A', bindings: [{ action: 'attack', key: 'Space' }],
  });
  hk.setBinding('a', 'attack', 'KeyJ');
  hk.setActive('a');
  assert.equal(hk.resolveAction('attack'), 'KeyJ');
});

test('hotkey-profile: setBinding rejects invalid', () => {
  const hk = HotKeyProfileManager.create();
  hk.registerProfile({ id: 'a', name: 'A', bindings: [] });
  assert.equal(hk.setBinding('a', '', 'KeyW'), false);
  assert.equal(hk.setBinding('a', 'x', ''), false);
  assert.equal(hk.setBinding('ghost', 'x', 'KeyW'), false);
});

test('hotkey-profile: removeBinding drops', () => {
  const hk = HotKeyProfileManager.create();
  hk.registerProfile({
    id: 'a', name: 'A', bindings: [{ action: 'attack', key: 'Space' }],
  });
  assert.ok(hk.removeBinding('a', 'attack'));
  hk.setActive('a');
  assert.equal(hk.resolveAction('attack'), null);
  assert.equal(hk.removeBinding('a', 'attack'), false);
});

test('hotkey-profile: unregister + active cleared', () => {
  const hk = HotKeyProfileManager.create();
  hk.registerProfile({ id: 'a', name: 'A', bindings: [] });
  hk.setActive('a');
  assert.ok(hk.unregisterProfile('a'));
  assert.equal(hk.getActive(), null);
});

test('hotkey-profile: get + list defensive copies', () => {
  const hk = HotKeyProfileManager.create();
  hk.registerProfile({
    id: 'a', name: 'A', bindings: [{ action: 'attack', key: 'Space' }],
  });
  const got = hk.get('a');
  got!.bindings.push({ action: 'x', key: 'KeyX' });
  const fresh = hk.get('a');
  assert.equal(fresh!.bindings.length, 1);
  const arr = hk.list();
  arr.length = 0;
  assert.equal(hk.list().length, 1);
});

test('hotkey-profile: toSnapshot + fromSnapshot roundtrip', () => {
  const hk = HotKeyProfileManager.create();
  hk.registerProfile({
    id: 'a', name: 'A', bindings: [{ action: 'attack', key: 'Space' }],
  });
  hk.setActive('a');
  const snap = hk.toSnapshot();
  const hk2 = HotKeyProfileManager.create();
  hk2.fromSnapshot(snap);
  assert.equal(hk2.getActive(), 'a');
  assert.equal(hk2.resolveAction('attack'), 'Space');
});

test('hotkey-profile: fromSnapshot tolerates missing/invalid', () => {
  const hk = HotKeyProfileManager.create();
  hk.fromSnapshot({
    activeId: 'ghost',
    profiles: [
      { id: 'a', name: 'A', bindings: [] },
      null as never,
      { id: '', name: 'bad', bindings: [] }, // invalid id
    ],
  });
  assert.equal(hk.size(), 1);
  // activeId references unknown id 'ghost' -> null.
  assert.equal(hk.getActive(), null);
});

test('hotkey-profile: dispose locks ops', () => {
  const hk = HotKeyProfileManager.create();
  hk.registerProfile({ id: 'a', name: 'A', bindings: [] });
  hk.dispose();
  assert.equal(hk.registerProfile({ id: 'b', name: 'B', bindings: [] }), false);
  assert.equal(hk.has('a'), false);
  assert.equal(hk.resolveAction('attack'), null);
});

test('hotkey-profile: realistic class profile chain', () => {
  const hk = HotKeyProfileManager.create();
  hk.registerProfile({
    id: 'global', name: 'Global',
    bindings: [
      { action: 'move-up', key: 'KeyW' },
      { action: 'menu', key: 'Escape' },
    ],
  });
  hk.registerProfile({
    id: 'combat', name: 'Combat', inherits: 'global',
    bindings: [{ action: 'attack', key: 'Space' }],
  });
  hk.registerProfile({
    id: 'mage', name: 'Mage', inherits: 'combat',
    bindings: [{ action: 'cast', key: 'KeyQ' }],
  });
  hk.setActive('mage');
  assert.equal(hk.resolveAction('cast'), 'KeyQ');
  assert.equal(hk.resolveAction('attack'), 'Space');
  assert.equal(hk.resolveAction('move-up'), 'KeyW');
  assert.equal(hk.resolveAction('menu'), 'Escape');
});

test('hotkey-profile: resolveActionFor explicit profile lookup', () => {
  const hk = HotKeyProfileManager.create();
  hk.registerProfile({
    id: 'a', name: 'A', bindings: [{ action: 'x', key: 'KeyA' }],
  });
  hk.registerProfile({
    id: 'b', name: 'B', bindings: [{ action: 'x', key: 'KeyB' }],
  });
  assert.equal(hk.resolveActionFor('a', 'x'), 'KeyA');
  assert.equal(hk.resolveActionFor('b', 'x'), 'KeyB');
  assert.equal(hk.resolveActionFor('ghost', 'x'), null);
});
