// Phase 0.95.0 - MusicPlaylist tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  MusicPlaylist,
  RESOURCE_MUSIC_PLAYLIST,
} from '../src/index.js';

test('music-playlist: RESOURCE constant', () => {
  assert.equal(RESOURCE_MUSIC_PLAYLIST, 'music_playlist');
});

test('music-playlist: defaults empty', () => {
  const p = MusicPlaylist.create();
  assert.equal(p.size(), 0);
  assert.equal(p.current(), null);
  assert.equal(p.play(), null);
  assert.equal(p.isPlaying(), false);
});

test('music-playlist: addTrack + has + size', () => {
  const p = MusicPlaylist.create();
  assert.ok(p.addTrack({ id: 'a', url: '/a.mp3' }));
  assert.ok(p.has('a'));
  assert.equal(p.size(), 1);
});

test('music-playlist: addTrack rejects duplicates + invalid', () => {
  const p = MusicPlaylist.create();
  p.addTrack({ id: 'a', url: '/a.mp3' });
  assert.equal(p.addTrack({ id: 'a', url: '/a2.mp3' }), false);
  assert.equal(p.addTrack({ id: '', url: '/b.mp3' }), false);
  assert.equal(p.addTrack({ id: 'b', url: '' }), false);
});

test('music-playlist: play returns first track', () => {
  const p = MusicPlaylist.create();
  p.addTrack({ id: 'a', url: '/a.mp3' });
  p.addTrack({ id: 'b', url: '/b.mp3' });
  const t = p.play();
  assert.equal(t!.id, 'a');
  assert.ok(p.isPlaying());
  assert.equal(p.current()!.id, 'a');
});

test('music-playlist: next advances to next track', () => {
  const p = MusicPlaylist.create();
  p.addTrack({ id: 'a', url: '/a.mp3' });
  p.addTrack({ id: 'b', url: '/b.mp3' });
  p.play();
  assert.equal(p.next()!.id, 'b');
});

test('music-playlist: next at end without loopAtEnd stops', () => {
  const p = MusicPlaylist.create({ loopAtEnd: false });
  p.addTrack({ id: 'a', url: '/a' });
  p.addTrack({ id: 'b', url: '/b' });
  p.play();
  p.next();
  // Past last track.
  assert.equal(p.next(), null);
  assert.equal(p.isPlaying(), false);
});

test('music-playlist: next at end with loopAtEnd wraps', () => {
  const p = MusicPlaylist.create({ loopAtEnd: true });
  p.addTrack({ id: 'a', url: '/a' });
  p.addTrack({ id: 'b', url: '/b' });
  p.play();
  p.next();
  // Wraps back to a.
  assert.equal(p.next()!.id, 'a');
});

test('music-playlist: prev steps back; respects loopAtEnd', () => {
  const p = MusicPlaylist.create({ loopAtEnd: true });
  p.addTrack({ id: 'a', url: '/a' });
  p.addTrack({ id: 'b', url: '/b' });
  p.play();
  p.next(); // at b
  assert.equal(p.prev()!.id, 'a');
  // prev at start with loopAtEnd: wraps to last.
  assert.equal(p.prev()!.id, 'b');
});

test('music-playlist: prev at start without loop stops', () => {
  const p = MusicPlaylist.create({ loopAtEnd: false });
  p.addTrack({ id: 'a', url: '/a' });
  p.play();
  // At index 0; prev steps to -1 = stop.
  assert.equal(p.prev(), null);
  assert.equal(p.isPlaying(), false);
});

test('music-playlist: jumpTo unknown id returns null', () => {
  const p = MusicPlaylist.create();
  p.addTrack({ id: 'a', url: '/a' });
  assert.equal(p.jumpTo('ghost'), null);
});

test('music-playlist: jumpTo to specific track', () => {
  const p = MusicPlaylist.create();
  p.addTrack({ id: 'a', url: '/a' });
  p.addTrack({ id: 'b', url: '/b' });
  p.addTrack({ id: 'c', url: '/c' });
  const t = p.jumpTo('c');
  assert.equal(t!.id, 'c');
  assert.equal(p.current()!.id, 'c');
});

test('music-playlist: stop clears state', () => {
  const p = MusicPlaylist.create();
  p.addTrack({ id: 'a', url: '/a' });
  p.play();
  p.stop();
  assert.equal(p.current(), null);
  assert.equal(p.isPlaying(), false);
});

test('music-playlist: removeTrack drops + adjusts cursor', () => {
  const p = MusicPlaylist.create();
  p.addTrack({ id: 'a', url: '/a' });
  p.addTrack({ id: 'b', url: '/b' });
  p.addTrack({ id: 'c', url: '/c' });
  p.play();
  p.next(); // at b
  // Remove a; cursor was 1 (b), now b is at index 0.
  p.removeTrack('a');
  assert.equal(p.current()!.id, 'b');
});

test('music-playlist: removeTrack of current may stop playback', () => {
  const p = MusicPlaylist.create();
  p.addTrack({ id: 'a', url: '/a' });
  p.play();
  p.removeTrack('a');
  assert.equal(p.size(), 0);
  assert.equal(p.current(), null);
  assert.equal(p.isPlaying(), false);
});

test('music-playlist: list returns defensive copy', () => {
  const p = MusicPlaylist.create();
  p.addTrack({ id: 'a', url: '/a', data: { mood: 'calm' } });
  const arr = p.list();
  arr[0]!.url = '/mutated';
  assert.equal(p.list()[0]!.url, '/a');
});

test('music-playlist: shuffle reorders + stops playback', () => {
  let seed = 0;
  const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const p = MusicPlaylist.create({ rng });
  for (let i = 0; i < 5; i++) p.addTrack({ id: 't' + i, url: '/t' + i });
  p.play();
  p.shuffle();
  // After shuffle, must call play() again. Track order may differ.
  const first = p.play();
  assert.notEqual(first, null);
});

test('music-playlist: dispose locks ops', () => {
  const p = MusicPlaylist.create();
  p.addTrack({ id: 'a', url: '/a' });
  p.dispose();
  assert.equal(p.addTrack({ id: 'b', url: '/b' }), false);
  assert.equal(p.play(), null);
  assert.equal(p.size(), 0);
});

test('music-playlist: realistic ambient rotation', () => {
  const p = MusicPlaylist.create({ loopAtEnd: true });
  p.addTrack({ id: 'plaza_a', url: '/plaza_a.mp3' });
  p.addTrack({ id: 'plaza_b', url: '/plaza_b.mp3' });
  p.addTrack({ id: 'plaza_c', url: '/plaza_c.mp3' });
  p.play();
  // Simulate 7 track-end events (more than the playlist length).
  const seen: string[] = [p.current()!.id];
  for (let i = 0; i < 6; i++) {
    seen.push(p.next()!.id);
  }
  // Should cycle through and wrap.
  assert.equal(seen.length, 7);
  assert.equal(seen[3], 'plaza_a'); // wrapped at index 3
});
