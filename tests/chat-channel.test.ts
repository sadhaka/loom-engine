// Phase 1.7.5 MILESTONE - ChatChannel + ChatChannelRegistry tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  ChatChannel,
  ChatChannelRegistry,
  RESOURCE_CHAT_CHANNEL,
  RESOURCE_CHAT_CHANNEL_REGISTRY,
} from '../src/index.js';

test('cc: RESOURCE_CHAT_CHANNEL is the stable string', () => {
  assert.equal(RESOURCE_CHAT_CHANNEL, 'chat_channel');
});

test('cc: RESOURCE_CHAT_CHANNEL_REGISTRY is the stable string', () => {
  assert.equal(RESOURCE_CHAT_CHANNEL_REGISTRY, 'chat_channel_registry');
});

test('cc: create requires an id', () => {
  // @ts-expect-error
  assert.throws(() => ChatChannel.create({}));
  assert.throws(() => ChatChannel.create({ id: '' }));
});

test('cc: starts empty', () => {
  const ch = ChatChannel.create({ id: 'global' });
  assert.equal(ch.getId(), 'global');
  assert.equal(ch.memberCount(), 0);
  assert.equal(ch.historyLength(), 0);
  assert.deepEqual(ch.recent(), []);
});

test('cc: join + leave roster', () => {
  const ch = ChatChannel.create({ id: 'g' });
  assert.equal(ch.join('alice', 1000), true);
  assert.equal(ch.join('alice', 1000), false);  // already member
  assert.equal(ch.join('bob', 1000), true);
  assert.equal(ch.memberCount(), 2);
  assert.equal(ch.leave('alice'), true);
  assert.equal(ch.leave('alice'), false);
  assert.equal(ch.memberCount(), 1);
});

test('cc: join rejects empty id / non-finite now', () => {
  const ch = ChatChannel.create({ id: 'g' });
  assert.equal(ch.join('', 1000), false);
  assert.equal(ch.join('a', NaN), false);
});

test('cc: send by member appends to history', () => {
  const ch = ChatChannel.create({ id: 'g' });
  ch.join('alice', 1000);
  const r = ch.send('alice', 'hello', 1100);
  assert.equal(r.ok, true);
  assert.ok(r.message);
  assert.equal(r.message!.sender, 'alice');
  assert.equal(r.message!.body, 'hello');
  assert.equal(r.message!.sentAt, 1100);
  assert.equal(r.message!.id, 1);
  assert.equal(ch.historyLength(), 1);
});

test('cc: send by non-member rejected', () => {
  const ch = ChatChannel.create({ id: 'g' });
  const r = ch.send('outsider', 'hi', 1000);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-member');
});

test('cc: send empty body rejected', () => {
  const ch = ChatChannel.create({ id: 'g' });
  ch.join('alice', 1000);
  assert.equal(ch.send('alice', '', 1100).reason, 'empty');
  assert.equal(ch.send('alice', '   ', 1100).reason, 'empty');
});

test('cc: send too-long body rejected', () => {
  const ch = ChatChannel.create({ id: 'g', maxBodyLen: 5 });
  ch.join('alice', 1000);
  assert.equal(ch.send('alice', 'short', 1100).ok, true);
  assert.equal(ch.send('alice', 'too-long', 1200).reason, 'too-long');
});

test('cc: send body trims whitespace', () => {
  const ch = ChatChannel.create({ id: 'g' });
  ch.join('alice', 1000);
  const r = ch.send('alice', '  hi  ', 1100);
  assert.equal(r.message!.body, 'hi');
});

test('cc: rate limit drops messages over threshold', () => {
  const ch = ChatChannel.create({
    id: 'g',
    rateLimitMessages: 3,
    rateLimitWindowMs: 1000,
  });
  ch.join('alice', 0);
  // 3 sends in window - all OK
  assert.equal(ch.send('alice', 'a', 100).ok, true);
  assert.equal(ch.send('alice', 'b', 200).ok, true);
  assert.equal(ch.send('alice', 'c', 300).ok, true);
  // 4th within window - rate-limited
  assert.equal(ch.send('alice', 'd', 400).reason, 'rate-limit');
  // After window expires, send works again
  assert.equal(ch.send('alice', 'e', 1500).ok, true);
});

test('cc: rate limit per-sender independent', () => {
  const ch = ChatChannel.create({ id: 'g', rateLimitMessages: 2 });
  ch.join('alice', 0);
  ch.join('bob', 0);
  ch.send('alice', '1', 100);
  ch.send('alice', '2', 200);
  // Alice rate limited
  assert.equal(ch.send('alice', '3', 300).reason, 'rate-limit');
  // Bob unaffected
  assert.equal(ch.send('bob', '1', 400).ok, true);
});

test('cc: sendsInWindow reports current usage', () => {
  const ch = ChatChannel.create({ id: 'g', rateLimitWindowMs: 1000 });
  ch.join('alice', 0);
  ch.send('alice', '1', 100);
  ch.send('alice', '2', 500);
  ch.send('alice', '3', 900);
  assert.equal(ch.sendsInWindow('alice', 950), 3);
  // After window: 0
  assert.equal(ch.sendsInWindow('alice', 2000), 0);
});

test('cc: filter passes message unchanged', () => {
  const ch = ChatChannel.create({ id: 'g' });
  ch.join('alice', 0);
  let calls = 0;
  ch.installFilter((msg) => {
    calls++;
    return msg;
  });
  ch.send('alice', 'hi', 100);
  assert.equal(calls, 1);
  assert.equal(ch.historyLength(), 1);
});

test('cc: filter dropping returns reason filtered', () => {
  const ch = ChatChannel.create({ id: 'g' });
  ch.join('alice', 0);
  ch.installFilter(() => null);  // drops everything
  const r = ch.send('alice', 'hi', 100);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'filtered');
  assert.equal(ch.historyLength(), 0);
});

test('cc: filter transforming the message', () => {
  const ch = ChatChannel.create({ id: 'g' });
  ch.join('alice', 0);
  ch.installFilter((msg) => ({ ...msg, body: msg.body.toUpperCase() }));
  const r = ch.send('alice', 'hello', 100);
  assert.equal(r.message!.body, 'HELLO');
});

test('cc: filter chain - all must pass', () => {
  const ch = ChatChannel.create({ id: 'g' });
  ch.join('alice', 0);
  ch.installFilter((msg) => ({ ...msg, body: msg.body + ' [v1]' }));
  ch.installFilter((msg) => ({ ...msg, body: msg.body + ' [v2]' }));
  const r = ch.send('alice', 'hi', 100);
  assert.equal(r.message!.body, 'hi [v1] [v2]');
});

test('cc: filter throwing is treated as drop', () => {
  const ch = ChatChannel.create({ id: 'g' });
  ch.join('alice', 0);
  ch.installFilter(() => { throw new Error('boom'); });
  const r = ch.send('alice', 'hi', 100);
  assert.equal(r.reason, 'filtered');
});

test('cc: uninstallFilter removes a filter', () => {
  const ch = ChatChannel.create({ id: 'g' });
  ch.join('alice', 0);
  const drop = () => null;
  ch.installFilter(drop);
  assert.equal(ch.send('alice', 'hi', 100).reason, 'filtered');
  assert.equal(ch.uninstallFilter(drop), true);
  assert.equal(ch.uninstallFilter(drop), false);
  assert.equal(ch.send('alice', 'hi', 200).ok, true);
});

test('cc: history evicts oldest at historySize cap', () => {
  const ch = ChatChannel.create({ id: 'g', historySize: 3, rateLimitMessages: 100 });
  ch.join('alice', 0);
  for (let i = 0; i < 5; i++) {
    ch.send('alice', 'm' + i, 100 + i * 10);
  }
  assert.equal(ch.historyLength(), 3);
  const recent = ch.recent();
  assert.deepEqual(recent.map(m => m.body), ['m2', 'm3', 'm4']);
});

test('cc: recent(n) returns last n messages', () => {
  const ch = ChatChannel.create({ id: 'g', rateLimitMessages: 100 });
  ch.join('alice', 0);
  for (let i = 0; i < 5; i++) ch.send('alice', 'm' + i, 100 + i * 10);
  assert.deepEqual(ch.recent(2).map(m => m.body), ['m3', 'm4']);
});

test('cc: filter drop does NOT count toward rate limit', () => {
  const ch = ChatChannel.create({
    id: 'g', rateLimitMessages: 2, rateLimitWindowMs: 1000,
  });
  ch.join('alice', 0);
  ch.installFilter((msg) => msg.body === 'no' ? null : msg);
  ch.send('alice', 'no', 100);  // filtered, not counted
  ch.send('alice', 'no', 200);  // filtered, not counted
  ch.send('alice', 'yes', 300); // first counted
  ch.send('alice', 'yes', 400); // second counted
  assert.equal(ch.send('alice', 'yes', 500).reason, 'rate-limit');
});

test('cc: meta preserved through pipeline', () => {
  const ch = ChatChannel.create<{ color: string }>({ id: 'g' });
  ch.join('alice', 0);
  const r = ch.send('alice', 'hi', 100, { color: 'red' });
  assert.equal(r.message!.meta!.color, 'red');
});

test('cc: monotonic message ids', () => {
  const ch = ChatChannel.create({ id: 'g', rateLimitMessages: 100 });
  ch.join('alice', 0);
  const r1 = ch.send('alice', '1', 100);
  const r2 = ch.send('alice', '2', 200);
  const r3 = ch.send('alice', '3', 300);
  assert.equal(r1.message!.id, 1);
  assert.equal(r2.message!.id, 2);
  assert.equal(r3.message!.id, 3);
});

// ---- Registry tests ----

test('reg: starts empty', () => {
  const reg = ChatChannelRegistry.create();
  assert.equal(reg.count(), 0);
  assert.deepEqual(reg.ids(), []);
});

test('reg: create + get + has + remove', () => {
  const reg = ChatChannelRegistry.create();
  const ch = reg.create({ id: 'global' });
  assert.equal(reg.count(), 1);
  assert.equal(reg.has('global'), true);
  assert.equal(reg.get('global'), ch);
  assert.equal(reg.remove('global'), true);
  assert.equal(reg.has('global'), false);
});

test('reg: create rejects duplicate id', () => {
  const reg = ChatChannelRegistry.create();
  reg.create({ id: 'global' });
  assert.throws(() => reg.create({ id: 'global' }));
});

test('reg: ids returns all channel ids', () => {
  const reg = ChatChannelRegistry.create();
  reg.create({ id: 'global' });
  reg.create({ id: 'guild' });
  reg.create({ id: 'party' });
  assert.deepEqual(reg.ids().sort(), ['global', 'guild', 'party']);
});

test('reg: clear empties all channels', () => {
  const reg = ChatChannelRegistry.create();
  reg.create({ id: 'a' });
  reg.create({ id: 'b' });
  reg.clear();
  assert.equal(reg.count(), 0);
});
