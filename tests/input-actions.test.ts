// Phase 0.31.0 - InputActions tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { InputActions } from '../src/input/input-actions.js';


test('input-actions: bind + isActive', function () {
  var ia = new InputActions();
  ia.bind('jump', 'Space');
  assert.equal(ia.isActive('jump'), false);
  ia.handleKeyDown('Space');
  assert.equal(ia.isActive('jump'), true);
  ia.handleKeyUp('Space');
  assert.equal(ia.isActive('jump'), false);
});

test('input-actions: bind to array of keys (any triggers)', function () {
  var ia = new InputActions();
  ia.bind('jump', ['Space', 'Enter']);
  ia.handleKeyDown('Enter');
  assert.equal(ia.isActive('jump'), true);
  ia.handleKeyUp('Enter');
  assert.equal(ia.isActive('jump'), false);
});

test('input-actions: multiple held keys keep action active', function () {
  var ia = new InputActions();
  ia.bind('jump', ['Space', 'Enter']);
  ia.handleKeyDown('Space');
  ia.handleKeyDown('Enter');
  assert.equal(ia.isActive('jump'), true);
  // Release ONE key - still held by the other.
  ia.handleKeyUp('Space');
  assert.equal(ia.isActive('jump'), true);
  ia.handleKeyUp('Enter');
  assert.equal(ia.isActive('jump'), false);
});

test('input-actions: wasJustPressed fires once per press', function () {
  var ia = new InputActions();
  ia.bind('jump', 'Space');
  ia.handleKeyDown('Space');
  assert.equal(ia.wasJustPressed('jump'), true);
  // Still true within the same frame.
  assert.equal(ia.wasJustPressed('jump'), true);
  ia.update();
  // After update, just-pressed clears (still active though).
  assert.equal(ia.wasJustPressed('jump'), false);
  assert.equal(ia.isActive('jump'), true);
});

test('input-actions: wasJustReleased fires once per release', function () {
  var ia = new InputActions();
  ia.bind('jump', 'Space');
  ia.handleKeyDown('Space');
  ia.update();
  ia.handleKeyUp('Space');
  assert.equal(ia.wasJustReleased('jump'), true);
  ia.update();
  assert.equal(ia.wasJustReleased('jump'), false);
});

test('input-actions: duplicate keydown does not re-fire justPressed', function () {
  var ia = new InputActions();
  ia.bind('jump', 'Space');
  ia.handleKeyDown('Space');
  ia.update();
  // Second keydown on already-held key: should NOT re-fire justPressed.
  ia.handleKeyDown('Space');
  assert.equal(ia.wasJustPressed('jump'), false);
});

test('input-actions: unbind drops a key from action', function () {
  var ia = new InputActions();
  ia.bind('jump', ['Space', 'Enter']);
  ia.unbind('jump', 'Enter');
  ia.handleKeyDown('Enter');
  assert.equal(ia.isActive('jump'), false);
  ia.handleKeyDown('Space');
  assert.equal(ia.isActive('jump'), true);
});

test('input-actions: unbind held key forces re-evaluation', function () {
  var ia = new InputActions();
  ia.bind('jump', ['Space', 'Enter']);
  ia.handleKeyDown('Space');
  assert.equal(ia.isActive('jump'), true);
  ia.unbind('jump', 'Space');
  assert.equal(ia.isActive('jump'), false);
});

test('input-actions: unbind() with no keys drops the whole action', function () {
  var ia = new InputActions();
  ia.bind('jump', ['Space', 'Enter']);
  ia.unbind('jump');
  assert.deepEqual(ia.actionNames(), []);
});

test('input-actions: releaseAll wipes held keys + fires justReleased', function () {
  var ia = new InputActions();
  ia.bind('a', 'KeyA');
  ia.bind('b', 'KeyB');
  ia.handleKeyDown('KeyA');
  ia.handleKeyDown('KeyB');
  ia.update();
  ia.releaseAll();
  assert.equal(ia.isActive('a'), false);
  assert.equal(ia.isActive('b'), false);
  assert.equal(ia.wasJustReleased('a'), true);
  assert.equal(ia.wasJustReleased('b'), true);
});

test('input-actions: keysFor lists bound keys', function () {
  var ia = new InputActions();
  ia.bind('jump', ['Space', 'Enter']);
  var keys = ia.keysFor('jump').sort();
  assert.deepEqual(keys, ['Enter', 'Space']);
});

test('input-actions: stats track event counts', function () {
  var ia = new InputActions();
  ia.bind('jump', 'Space');
  ia.handleKeyDown('Space');
  ia.handleKeyUp('Space');
  ia.handleKeyDown('Space');
  var s = ia.stats();
  assert.equal(s.keyDownEvents, 2);
  assert.equal(s.keyUpEvents, 1);
  assert.equal(s.actions, 1);
});

test('input-actions: clear() drops everything', function () {
  var ia = new InputActions();
  ia.bind('a', 'KeyA');
  ia.bind('b', 'KeyB');
  ia.clear();
  assert.deepEqual(ia.actionNames(), []);
});

test('input-actions: handleKeyDown for unbound key returns false', function () {
  var ia = new InputActions();
  ia.bind('jump', 'Space');
  var changed = ia.handleKeyDown('KeyZ');
  assert.equal(changed, false);
});

test('input-actions: same key shared across actions fires both', function () {
  var ia = new InputActions();
  ia.bind('a', 'Space');
  ia.bind('b', 'Space');
  ia.handleKeyDown('Space');
  assert.equal(ia.isActive('a'), true);
  assert.equal(ia.isActive('b'), true);
});

test('input-actions: bind with empty key string is silently ignored', function () {
  var ia = new InputActions();
  ia.bind('jump', '');
  assert.deepEqual(ia.keysFor('jump'), []);
});

test('input-actions: idempotent re-bind does not duplicate keys', function () {
  var ia = new InputActions();
  ia.bind('jump', 'Space');
  ia.bind('jump', 'Space');
  ia.bind('jump', ['Space', 'Space']);
  assert.deepEqual(ia.keysFor('jump'), ['Space']);
});
