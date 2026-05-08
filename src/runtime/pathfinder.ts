// Pathfinder - A* on a grid.
//
// 0.55.0 enabling primitive. Mob nav, NPC walk paths, room-to-room
// hub routing, "click to walk" tap-to-walk landing distance, AI
// approach behaviour - all share grid-based shortest-path search.
//
// Pathfinder is grid-AGNOSTIC: the consumer supplies an
// `isWalkable(x, y)` callback (and optional `cost(x, y)`). The
// pathfinder doesn't know about TileMap (0.57+) or any specific
// grid representation - it just calls the callback for cells it
// considers. Octile heuristic by default for 8-direction
// movement; manhattan available for 4-direction.
//
// Closed-list + open-list both implemented as arrays for the
// common < ~256-cell grids; for huge maps consumers should
// pre-cull via a coarser pass and call findPath on a sub-region.
//
// Code style: var-only in browser source.

export type IsWalkableFn = (x: number, y: number) => boolean;
export type CellCostFn = (x: number, y: number) => number;
export type HeuristicFn = (dx: number, dy: number) => number;

export interface PathfinderOptions {
  // Default false. Allow movement on the four diagonals.
  allowDiagonal?: boolean;
  // Default false. Block diagonal movement that "cuts a corner"
  // (passes through a non-walkable cell). Only meaningful when
  // allowDiagonal is true.
  blockCornerCutting?: boolean;
  // Cap on cells expanded before giving up. Default 8192. Returns
  // null if hit (use a sub-region search for huge maps).
  maxNodes?: number;
  // Per-cell cost callback. Default returns 1 for every cell.
  cost?: CellCostFn;
  // Heuristic. Default octile when allowDiagonal=true, manhattan
  // otherwise.
  heuristic?: HeuristicFn;
}

export interface PathPoint {
  x: number;
  y: number;
}

export interface PathResult {
  // The path as a sequence of cells from start to goal (inclusive).
  // Empty if start === goal; null is returned separately for failure.
  path: PathPoint[];
  // Total accumulated cost.
  cost: number;
  // Number of cells expanded during search; useful for diagnostics.
  nodesExpanded: number;
}

const DEFAULT_MAX_NODES = 8192;

const SQRT2 = Math.sqrt(2);

function manhattan(dx: number, dy: number): number {
  return Math.abs(dx) + Math.abs(dy);
}

function octile(dx: number, dy: number): number {
  var ax = Math.abs(dx);
  var ay = Math.abs(dy);
  // 1 * (max(dx, dy) - min(dx, dy)) + sqrt(2) * min(dx, dy)
  // = max + (sqrt(2) - 1) * min
  return Math.max(ax, ay) + (SQRT2 - 1) * Math.min(ax, ay);
}

interface OpenNode {
  x: number;
  y: number;
  g: number;     // cost so far
  f: number;     // g + heuristic
  parent: OpenNode | null;
}

// Find a shortest path on a grid from (startX, startY) to (goalX,
// goalY). Returns null if no path exists or maxNodes is exceeded.
export function findPath(
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
  isWalkable: IsWalkableFn,
  opts: PathfinderOptions = {},
): PathResult | null {
  startX = Math.floor(startX);
  startY = Math.floor(startY);
  goalX = Math.floor(goalX);
  goalY = Math.floor(goalY);
  if (startX === goalX && startY === goalY) {
    return { path: [{ x: startX, y: startY }], cost: 0, nodesExpanded: 0 };
  }
  if (!isWalkable(goalX, goalY)) return null;
  if (!isWalkable(startX, startY)) return null;

  var allowDiagonal = opts.allowDiagonal === true;
  var blockCornerCut = opts.blockCornerCutting === true;
  var maxNodes = opts.maxNodes !== undefined && opts.maxNodes > 0 ? opts.maxNodes : DEFAULT_MAX_NODES;
  var costFn = opts.cost ?? function () { return 1; };
  var heur = opts.heuristic ?? (allowDiagonal ? octile : manhattan);

  // Open list as plain array; lookup-by-key via Map for closed
  // list. For grids < ~256x256 this performs fine without a heap.
  var open: OpenNode[] = [];
  var closed: Set<string> = new Set();
  var openByKey: Map<string, OpenNode> = new Map();

  var startNode: OpenNode = {
    x: startX, y: startY,
    g: 0,
    f: heur(goalX - startX, goalY - startY),
    parent: null,
  };
  open.push(startNode);
  openByKey.set(keyOf(startX, startY), startNode);

  var dirs = allowDiagonal
    ? [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [1, 1], [1, -1], [-1, 1], [-1, -1],
      ]
    : [[1, 0], [-1, 0], [0, 1], [0, -1]];

  var nodesExpanded = 0;

  while (open.length > 0) {
    if (nodesExpanded >= maxNodes) return null;

    // Pop lowest-f node. Linear scan; OK for small grids.
    var bestIdx = 0;
    for (var i = 1; i < open.length; i++) {
      var oi = open[i];
      var ob = open[bestIdx];
      if (oi && ob && oi.f < ob.f) bestIdx = i;
    }
    var current = open[bestIdx] as OpenNode;
    open.splice(bestIdx, 1);
    var curKey = keyOf(current.x, current.y);
    openByKey.delete(curKey);
    closed.add(curKey);
    nodesExpanded++;

    if (current.x === goalX && current.y === goalY) {
      // Reconstruct path.
      var path: PathPoint[] = [];
      var n: OpenNode | null = current;
      while (n) {
        path.push({ x: n.x, y: n.y });
        n = n.parent;
      }
      path.reverse();
      return { path: path, cost: current.g, nodesExpanded: nodesExpanded };
    }

    for (var d = 0; d < dirs.length; d++) {
      var dir = dirs[d] as number[];
      var dx = dir[0] as number;
      var dy = dir[1] as number;
      var nx = current.x + dx;
      var ny = current.y + dy;
      var nKey = keyOf(nx, ny);
      if (closed.has(nKey)) continue;
      if (!isWalkable(nx, ny)) continue;
      // Block corner-cutting on diagonals if requested.
      if (allowDiagonal && blockCornerCut && dx !== 0 && dy !== 0) {
        if (!isWalkable(current.x + dx, current.y) || !isWalkable(current.x, current.y + dy)) {
          continue;
        }
      }
      var stepCost = (dx !== 0 && dy !== 0) ? SQRT2 : 1;
      stepCost *= costFn(nx, ny);
      var tentativeG = current.g + stepCost;
      var existing = openByKey.get(nKey);
      if (existing && tentativeG >= existing.g) continue;
      var neighbor: OpenNode;
      if (existing) {
        neighbor = existing;
        neighbor.g = tentativeG;
        neighbor.f = tentativeG + heur(goalX - nx, goalY - ny);
        neighbor.parent = current;
      } else {
        neighbor = {
          x: nx, y: ny,
          g: tentativeG,
          f: tentativeG + heur(goalX - nx, goalY - ny),
          parent: current,
        };
        open.push(neighbor);
        openByKey.set(nKey, neighbor);
      }
    }
  }
  return null;
}

function keyOf(x: number, y: number): string {
  return x + ',' + y;
}

// Resource key for the world's resource registry. Tag for any
// pathfinding system the consumer attaches.
export const RESOURCE_PATHFINDER = 'pathfinder';
