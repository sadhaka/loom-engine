// Phase 1.5.0 - ChartRenderer tests (Wave 1.5 educational depth opens).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  ChartRenderer,
  RESOURCE_CHART_RENDERER,
} from '../src/index.js';

test('chart: RESOURCE_CHART_RENDERER is the stable string', () => {
  assert.equal(RESOURCE_CHART_RENDERER, 'chart_renderer');
});

test('chart: starts empty', () => {
  const c = ChartRenderer.create({ width: 400, height: 200 });
  assert.equal(c.seriesCount(), 0);
});

test('chart: addSeries + hasSeries + seriesCount', () => {
  const c = ChartRenderer.create({ width: 400, height: 200 });
  assert.equal(c.addSeries({ id: 'a', points: [[0, 0], [1, 1]] }), true);
  assert.equal(c.hasSeries('a'), true);
  assert.equal(c.seriesCount(), 1);
});

test('chart: addSeries rejects empty / invalid', () => {
  const c = ChartRenderer.create({ width: 400, height: 200 });
  assert.equal(c.addSeries({ id: '', points: [] }), false);
  // @ts-expect-error
  assert.equal(c.addSeries({ id: 'a', points: null }), false);
});

test('chart: tuple and object point formats both accepted', () => {
  const c = ChartRenderer.create({ width: 400, height: 200 });
  c.addSeries({
    id: 'a',
    points: [[0, 0], { x: 1, y: 1 }, [2, 4]],
  });
  const snap = c.getSnapshot();
  assert.equal(snap.series[0]!.points.length, 3);
});

test('chart: non-finite points filtered', () => {
  const c = ChartRenderer.create({ width: 400, height: 200 });
  c.addSeries({
    id: 'a',
    points: [[0, 0], [NaN, 1], [2, Infinity], [3, 3]],
  });
  const snap = c.getSnapshot();
  // Only [0,0] and [3,3] survive.
  assert.equal(snap.series[0]!.points.length, 2);
});

test('chart: autoFit sets axis range from data', () => {
  const c = ChartRenderer.create({ width: 400, height: 200 });
  c.addSeries({ id: 'a', points: [[0, 10], [10, 20], [20, 30]] });
  const x = c.getAxisRange('x');
  const y = c.getAxisRange('y');
  assert.equal(x.min, 0);
  assert.equal(x.max, 20);
  assert.equal(y.min, 10);
  assert.equal(y.max, 30);
});

test('chart: setAxisRange overrides autoFit', () => {
  const c = ChartRenderer.create({ width: 400, height: 200 });
  c.addSeries({ id: 'a', points: [[0, 10], [10, 20]] });
  c.setAxisRange('y', 0, 100);
  // Even with new data, y axis stays.
  c.updatePoints('a', [[0, 50], [10, 60]]);
  const y = c.getAxisRange('y');
  assert.equal(y.min, 0);
  assert.equal(y.max, 100);
});

test('chart: resetAxis re-enables autoFit', () => {
  const c = ChartRenderer.create({ width: 400, height: 200 });
  c.addSeries({ id: 'a', points: [[0, 10], [10, 20]] });
  c.setAxisRange('y', 0, 100);
  c.resetAxis('y');
  // Now autoFit again.
  const y = c.getAxisRange('y');
  assert.equal(y.min, 10);
  assert.equal(y.max, 20);
});

test('chart: setAxisRange rejects min === max', () => {
  const c = ChartRenderer.create({ width: 400, height: 200 });
  assert.equal(c.setAxisRange('x', 5, 5), false);
});

test('chart: setAxisRange swaps inverted args', () => {
  const c = ChartRenderer.create({ width: 400, height: 200 });
  c.setAxisRange('x', 100, 0);
  const x = c.getAxisRange('x');
  assert.equal(x.min, 0);
  assert.equal(x.max, 100);
});

test('chart: snapshot maps data to screen coords', () => {
  const c = ChartRenderer.create({
    width: 400, height: 200,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  c.addSeries({ id: 'a', points: [[0, 0], [10, 10]] });
  c.setAxisRange('x', 0, 10);
  c.setAxisRange('y', 0, 10);
  const snap = c.getSnapshot();
  // First point: x=0, y=0 → screen (0, 200).
  // Second point: x=10, y=10 → screen (400, 0). y is inverted.
  assert.equal(snap.series[0]!.points[0]!.px, 0);
  assert.equal(snap.series[0]!.points[0]!.py, 200);
  assert.equal(snap.series[0]!.points[1]!.px, 400);
  assert.equal(snap.series[0]!.points[1]!.py, 0);
});

test('chart: padding offsets plot area', () => {
  const c = ChartRenderer.create({
    width: 400, height: 200,
    padding: { top: 20, right: 10, bottom: 30, left: 50 },
  });
  c.addSeries({ id: 'a', points: [[0, 0]] });
  const snap = c.getSnapshot();
  assert.equal(snap.plotArea.x, 50);
  assert.equal(snap.plotArea.y, 20);
  assert.equal(snap.plotArea.width, 340);
  assert.equal(snap.plotArea.height, 150);
});

test('chart: kind defaults to line', () => {
  const c = ChartRenderer.create({ width: 400, height: 200 });
  c.addSeries({ id: 'a', points: [[0, 0]] });
  assert.equal(c.list()[0]!.kind, 'line');
});

test('chart: kind accepts line / bar / scatter', () => {
  const c = ChartRenderer.create({ width: 400, height: 200 });
  c.addSeries({ id: 'a', kind: 'bar', points: [[0, 0]] });
  c.addSeries({ id: 'b', kind: 'scatter', points: [[1, 1]] });
  const list = c.list();
  assert.equal(list[0]!.kind, 'bar');
  assert.equal(list[1]!.kind, 'scatter');
});

test('chart: removeSeries drops it', () => {
  const c = ChartRenderer.create({ width: 400, height: 200 });
  c.addSeries({ id: 'a', points: [[0, 0]] });
  assert.equal(c.removeSeries('a'), true);
  assert.equal(c.seriesCount(), 0);
});

test('chart: updatePoints replaces data', () => {
  const c = ChartRenderer.create({ width: 400, height: 200 });
  c.addSeries({ id: 'a', points: [[0, 0]] });
  c.updatePoints('a', [[5, 5], [10, 10]]);
  assert.equal(c.list()[0]!.points.length, 2);
});

test('chart: setSize updates dimensions', () => {
  const c = ChartRenderer.create({ width: 400, height: 200 });
  c.setSize(800, 400);
  const snap = c.getSnapshot();
  assert.equal(snap.width, 800);
  assert.equal(snap.height, 400);
});

test('chart: toScreen converts data point to pixel coords', () => {
  const c = ChartRenderer.create({
    width: 400, height: 200,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  c.setAxisRange('x', 0, 10);
  c.setAxisRange('y', 0, 10);
  const screen = c.toScreen(5, 5);
  assert.equal(screen.px, 200);
  assert.equal(screen.py, 100);
});

test('chart: throwing forEach callback isolated', () => {
  const c = ChartRenderer.create({ width: 400, height: 200 });
  c.addSeries({ id: 'a', points: [[0, 0]] });
  c.forEach(() => { throw new Error('boom'); });
  assert.equal(c.seriesCount(), 1);
});

test('chart: clear empties + dispose locks', () => {
  const c = ChartRenderer.create({ width: 400, height: 200 });
  c.addSeries({ id: 'a', points: [[0, 0]] });
  c.clear();
  assert.equal(c.seriesCount(), 0);
  c.dispose();
  assert.equal(c.addSeries({ id: 'b', points: [[0, 0]] }), false);
});

test('chart: realistic example - HP over time chart for end-of-run summary', () => {
  const c = ChartRenderer.create({
    width: 600, height: 300,
    padding: { top: 20, right: 20, bottom: 40, left: 50 },
  });
  c.addSeries({
    id: 'hp', kind: 'line', color: 'red',
    points: [[0, 100], [10, 80], [20, 60], [30, 75], [40, 50]],
  });
  c.addSeries({
    id: 'damage_per_sec', kind: 'bar',
    points: [[5, 20], [15, 30], [25, 15], [35, 25]],
  });
  const snap = c.getSnapshot();
  assert.equal(snap.series.length, 2);
  // HP line autofits; min y from both series is 15 (damage_per_sec @ 25).
  assert.equal(c.getAxisRange('y').min, 15);
});
