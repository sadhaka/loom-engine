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
const DEFAULT_MAX_NODES = 8192;
const SQRT2 = Math.sqrt(2);
function manhattan(dx, dy) {
    return Math.abs(dx) + Math.abs(dy);
}
function octile(dx, dy) {
    var ax = Math.abs(dx);
    var ay = Math.abs(dy);
    // 1 * (max(dx, dy) - min(dx, dy)) + sqrt(2) * min(dx, dy)
    // = max + (sqrt(2) - 1) * min
    return Math.max(ax, ay) + (SQRT2 - 1) * Math.min(ax, ay);
}
// Find a shortest path on a grid from (startX, startY) to (goalX,
// goalY). Returns null if no path exists or maxNodes is exceeded.
export function findPath(startX, startY, goalX, goalY, isWalkable, opts = {}) {
    startX = Math.floor(startX);
    startY = Math.floor(startY);
    goalX = Math.floor(goalX);
    goalY = Math.floor(goalY);
    if (startX === goalX && startY === goalY) {
        return { path: [{ x: startX, y: startY }], cost: 0, nodesExpanded: 0 };
    }
    if (!isWalkable(goalX, goalY))
        return null;
    if (!isWalkable(startX, startY))
        return null;
    var allowDiagonal = opts.allowDiagonal === true;
    var blockCornerCut = opts.blockCornerCutting === true;
    var maxNodes = opts.maxNodes !== undefined && opts.maxNodes > 0 ? opts.maxNodes : DEFAULT_MAX_NODES;
    var costFn = opts.cost ?? function () { return 1; };
    var heur = opts.heuristic ?? (allowDiagonal ? octile : manhattan);
    // Open list as plain array; lookup-by-key via Map for closed
    // list. For grids < ~256x256 this performs fine without a heap.
    var open = [];
    var closed = new Set();
    var openByKey = new Map();
    var startNode = {
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
        if (nodesExpanded >= maxNodes)
            return null;
        // Pop lowest-f node. Linear scan; OK for small grids.
        var bestIdx = 0;
        for (var i = 1; i < open.length; i++) {
            var oi = open[i];
            var ob = open[bestIdx];
            if (oi && ob && oi.f < ob.f)
                bestIdx = i;
        }
        var current = open[bestIdx];
        open.splice(bestIdx, 1);
        var curKey = keyOf(current.x, current.y);
        openByKey.delete(curKey);
        closed.add(curKey);
        nodesExpanded++;
        if (current.x === goalX && current.y === goalY) {
            // Reconstruct path.
            var path = [];
            var n = current;
            while (n) {
                path.push({ x: n.x, y: n.y });
                n = n.parent;
            }
            path.reverse();
            return { path: path, cost: current.g, nodesExpanded: nodesExpanded };
        }
        for (var d = 0; d < dirs.length; d++) {
            var dir = dirs[d];
            var dx = dir[0];
            var dy = dir[1];
            var nx = current.x + dx;
            var ny = current.y + dy;
            var nKey = keyOf(nx, ny);
            if (closed.has(nKey))
                continue;
            if (!isWalkable(nx, ny))
                continue;
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
            if (existing && tentativeG >= existing.g)
                continue;
            var neighbor;
            if (existing) {
                neighbor = existing;
                neighbor.g = tentativeG;
                neighbor.f = tentativeG + heur(goalX - nx, goalY - ny);
                neighbor.parent = current;
            }
            else {
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
function keyOf(x, y) {
    return x + ',' + y;
}
// Resource key for the world's resource registry. Tag for any
// pathfinding system the consumer attaches.
export const RESOURCE_PATHFINDER = 'pathfinder';
//# sourceMappingURL=pathfinder.js.map