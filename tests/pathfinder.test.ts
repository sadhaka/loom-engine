// Phase 0.55.0 - Pathfinder tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  findPath,
  RESOURCE_PATHFINDER,
} from '../src/index.js';

// Helper: build a grid from a string layout where '.' is walkable
// and '#' is blocked. Origin (0, 0) is top-left; y grows downward.
function gridFromAscii(rows: string[]): (x: number, y: number) => boolean {
  return (x: number, y: number) => {
    if (y < 0 || y >= rows.length) return false;
    var row = rows[y] as string;
    if (x < 0 || x >= row.length) return false;
    return row.charAt(x) === '.';
  };
}

test('pathfinder: RESOURCE_PATHFINDER is the stable string', () => {
  assert.equal(RESOURCE_PATHFINDER, 'pathfinder');
});

test('pathfinder: start === goal returns single-cell path', () => {
  const walk = () => true;
  const r = findPath(5, 5, 5, 5, walk);
  assert.ok(r !== null);
  assert.deepEqual(r!.path, [{ x: 5, y: 5 }]);
  assert.equal(r!.cost, 0);
});

test('pathfinder: blocked goal returns null', () => {
  const walk = (x: number, _y: number) => x !== 5;
  const r = findPath(0, 0, 5, 0, walk);
  assert.equal(r, null);
});

test('pathfinder: blocked start returns null', () => {
  const walk = (x: number, _y: number) => x !== 0;
  const r = findPath(0, 0, 5, 0, walk);
  assert.equal(r, null);
});

test('pathfinder: straight line in open field', () => {
  const walk = () => true;
  const r = findPath(0, 0, 5, 0, walk);
  assert.ok(r !== null);
  assert.equal(r!.path[0]!.x, 0);
  assert.equal(r!.path[r!.path.length - 1]!.x, 5);
  assert.equal(r!.cost, 5);  // 5 unit-cost steps
});

test('pathfinder: 4-direction default forbids diagonals', () => {
  const walk = () => true;
  const r = findPath(0, 0, 3, 3, walk);
  assert.ok(r !== null);
  // 4-directional path is 6 steps (3 right + 3 down), cost 6.
  assert.equal(r!.cost, 6);
  assert.equal(r!.path.length, 7);  // 6 moves -> 7 cells
});

test('pathfinder: allowDiagonal cuts the path', () => {
  const walk = () => true;
  const r = findPath(0, 0, 3, 3, walk, { allowDiagonal: true });
  assert.ok(r !== null);
  // 3 diagonal moves -> cost = 3 * sqrt(2).
  assert.ok(Math.abs(r!.cost - 3 * Math.SQRT2) < 1e-9);
  assert.equal(r!.path.length, 4);
});

test('pathfinder: routes around an obstacle', () => {
  const grid = gridFromAscii([
    '......',
    '...#..',
    '...#..',
    '...#..',
    '......',
  ]);
  const r = findPath(0, 2, 5, 2, grid);
  assert.ok(r !== null);
  // Path may cross x=3 at y=0 or y=4 (those cells are walkable);
  // it must NOT cross x=3 at y=1, 2, or 3 (blocked).
  for (var i = 0; i < r!.path.length; i++) {
    var p = r!.path[i] as { x: number; y: number };
    if (p.x === 3 && (p.y === 1 || p.y === 2 || p.y === 3)) {
      assert.fail('path should not pass through blocked cells at x=3, y=' + p.y);
    }
  }
  // Path length must exceed direct distance (5) since it detoured.
  assert.ok(r!.path.length > 6);
});

test('pathfinder: unreachable goal returns null', () => {
  const grid = gridFromAscii([
    '...#..',
    '...#..',
    '...#..',
    '...#..',
    '...#..',
  ]);
  const r = findPath(0, 0, 5, 0, grid);
  assert.equal(r, null);
});

test('pathfinder: out-of-bounds goal returns null', () => {
  const grid = gridFromAscii([
    '......',
    '......',
  ]);
  // y=10 is out of grid bounds.
  const r = findPath(0, 0, 0, 10, grid);
  assert.equal(r, null);
});

test('pathfinder: blockCornerCutting prevents diagonal through wall corners', () => {
  // Diagonal blocked because both orthogonal neighbors of the
  // corner are walls.
  //   .#
  //   #.
  const grid = gridFromAscii([
    '.#',
    '#.',
  ]);
  const r = findPath(0, 0, 1, 1, grid, {
    allowDiagonal: true,
    blockCornerCutting: true,
  });
  assert.equal(r, null);
});

test('pathfinder: corner-cutting allowed by default with allowDiagonal', () => {
  const grid = gridFromAscii([
    '.#',
    '#.',
  ]);
  const r = findPath(0, 0, 1, 1, grid, { allowDiagonal: true });
  // Without blockCornerCutting the diagonal is allowed.
  assert.ok(r !== null);
});

test('pathfinder: cost callback shapes the path', () => {
  const grid = gridFromAscii([
    '......',
    '......',
    '......',
  ]);
  // Make middle row very expensive.
  const cost = (_x: number, y: number) => y === 1 ? 10 : 1;
  const r = findPath(0, 0, 5, 2, grid, { cost });
  assert.ok(r !== null);
  // Compare against a path that goes through the expensive row.
  // The pathfinder should prefer the longer cheap route.
  // Either 0,0 -> 5,0 -> 5,2 (cheap row + cost) or any combo
  // avoiding y=1. The exact path is heuristic-dependent; just
  // verify the cost is less than going straight diagonally (which
  // would cross y=1 at cost 10).
  var crossedExpensive = 0;
  for (var i = 0; i < r!.path.length; i++) {
    var p = r!.path[i] as { x: number; y: number };
    if (p.y === 1) crossedExpensive++;
  }
  assert.ok(crossedExpensive <= 2, `should minimize y=1 cells; crossed ${crossedExpensive}`);
});

test('pathfinder: maxNodes cap returns null on huge unsolvable searches', () => {
  // Open grid; goal far away so search expands many nodes.
  const walk = () => true;
  const r = findPath(0, 0, 100, 100, walk, { maxNodes: 50 });
  assert.equal(r, null);
});

test('pathfinder: nodesExpanded reflects search size', () => {
  const walk = () => true;
  const r1 = findPath(0, 0, 1, 1, walk);
  const r2 = findPath(0, 0, 10, 10, walk);
  assert.ok(r1 !== null && r2 !== null);
  assert.ok(r2!.nodesExpanded >= r1!.nodesExpanded);
});

test('pathfinder: custom heuristic - zero produces uniform-cost (Dijkstra)', () => {
  const walk = () => true;
  const r = findPath(0, 0, 3, 3, walk, {
    heuristic: () => 0,
  });
  assert.ok(r !== null);
  assert.equal(r!.cost, 6); // 4-directional, 6 steps
});

test('pathfinder: complex maze finds a valid path', () => {
  const grid = gridFromAscii([
    '.#......',
    '.#.####.',
    '.#.#....',
    '.#.#.##.',
    '.....#..',
    '######..',
    '........',
  ]);
  const r = findPath(0, 0, 7, 0, grid);
  assert.ok(r !== null);
  // Verify every cell on path is walkable.
  for (var i = 0; i < r!.path.length; i++) {
    var p = r!.path[i] as { x: number; y: number };
    assert.ok(grid(p.x, p.y), `path crosses blocked cell at ${p.x},${p.y}`);
  }
  // Verify path is contiguous (each step is 4-directional).
  for (var j = 1; j < r!.path.length; j++) {
    var a = r!.path[j - 1] as { x: number; y: number };
    var b = r!.path[j] as { x: number; y: number };
    var dx = Math.abs(a.x - b.x);
    var dy = Math.abs(a.y - b.y);
    assert.equal(dx + dy, 1, 'each step should be 4-directional');
  }
});

test('pathfinder: float coordinates floor to grid cells', () => {
  const walk = () => true;
  const r = findPath(0.7, 0.3, 5.9, 0.1, walk);
  assert.ok(r !== null);
  assert.equal(r!.path[0]!.x, 0);
  assert.equal(r!.path[0]!.y, 0);
  assert.equal(r!.path[r!.path.length - 1]!.x, 5);
});

test('pathfinder: deterministic across runs with same inputs', () => {
  const grid = gridFromAscii([
    '......',
    '..##..',
    '..##..',
    '......',
  ]);
  const r1 = findPath(0, 0, 5, 3, grid);
  const r2 = findPath(0, 0, 5, 3, grid);
  assert.deepEqual(r1!.path, r2!.path);
  assert.equal(r1!.cost, r2!.cost);
});

test('pathfinder: realistic example - mob aggro pursuit', () => {
  // Mob at (0, 0) tries to reach hero at (8, 8) through a room.
  const grid = gridFromAscii([
    '.........',
    '...###...',
    '...#.....',
    '.....###.',
    '.........',
    '.###.....',
    '.....##..',
    '..####...',
    '.........',
  ]);
  const r = findPath(0, 0, 8, 8, grid, { allowDiagonal: true });
  assert.ok(r !== null);
  assert.ok(r!.path.length >= 9);
  assert.ok(r!.cost > 0);
});
