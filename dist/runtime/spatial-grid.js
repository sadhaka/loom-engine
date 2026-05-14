// SpatialGrid - dense, bounded, zero-allocation uniform grid.
//
// Storage is two flat Int32Arrays forming an intrusive linked list:
//   head[cellIdx]  -> first entityId chained into that cell, or EMPTY
//   next[entityId] -> next entityId in the same cell, or EMPTY
// An entity is "in" a cell iff that cell's chain reaches it. There is
// no per-entity object and no Map - just two typed arrays sized once
// at construction, so the structure allocates nothing after the
// constructor and a query writes only into a caller-owned buffer.
//
// This is the dense/bounded counterpart to SpatialHash, not a
// replacement. SpatialHash is a sparse, Map-keyed structure for
// unbounded worlds with cheap incremental update(); SpatialGrid is a
// fixed grid for a bounded arena, rebuilt wholesale each frame
// (clear() + re-insert). An intrusive list has no cheap single-entity
// removal - unlinking would need an O(chain) walk - so the ownership
// contract is: one writer rebuilds the whole grid in its phase,
// readers query it in a later phase. It is a derived acceleration
// structure recomputed from the TransformPool every frame, so it is
// deliberately NOT ISnapshotable - the determinism snapshot captures
// the source positions, and this index is rebuilt from them.
//
// Gemini Trinity blueprint section 2; the Codex gates enforced here:
//   1. single-writer ownership - the rebuild model, a documented
//      contract (insert/clear are the only writers; query/traversal
//      are read-only).
//   2. no mutate-while-read - query() copies into the caller's buffer
//      so a returned result is never a live view of next[]; the epoch
//      counter makes an interleaved write observable to a manual walk.
//   3. validate cellSize / dimensions / maxEntities / numCells in the
//      constructor before allocating anything.
//   4. corruption checks - every public read is bounds-checked, and
//      query()'s traversal is hard-capped at maxEntities so a corrupt
//      next[] (a cycle) throws instead of hanging.
//   5. result-buffer query, never a callback.
//   6. a formal traversal API (firstInCell / nextOf) so consumers walk
//      a cell through public methods, never by casting to head/next.
// Empty-slot / end-of-chain sentinel for both head[] and next[].
const EMPTY = -1;
// Sanity caps on the constructor-derived sizes. Not hard engine
// limits - just a guard so a bad argument throws a clear error
// instead of attempting an absurd typed-array allocation. The entity
// cap matches the EntityAllocator's 24-bit index space: entity
// indices never exceed 0x00ffffff, so maxEntities never needs to
// exceed 0x01000000.
const MAX_CELL_COUNT = 1 << 24;
const MAX_ENTITY_COUNT = 1 << 24;
function requirePositiveFinite(value, name) {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError('SpatialGrid: ' + name + ' must be a positive finite number, got ' + value);
    }
}
function requirePositiveInt(value, name) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new RangeError('SpatialGrid: ' + name + ' must be a positive integer, got ' + value);
    }
}
export class SpatialGrid {
    // Cell extent in world units. A position maps to column
    // floor(x / cellSize), row floor(y / cellSize).
    cellSize;
    // Grid dimensions in cells.
    gridWidth;
    gridHeight;
    // gridWidth * gridHeight - the length of head[].
    numCells;
    // Highest entityId + 1 the grid can hold - the length of next[].
    maxEntities;
    // head[cellIdx] -> first entityId chained into that cell, or EMPTY.
    head;
    // next[entityId] -> next entityId in the same cell, or EMPTY.
    next;
    // Bumped by every write (clear / insert). A manual traversal via
    // firstInCell / nextOf can capture this and compare to detect an
    // interleaved write - the single-writer contract made observable
    // (gate 2). query() does not need it: it runs to completion in one
    // call, so nothing can mutate the grid mid-query.
    _epoch = 0;
    constructor(cellSize, gridWidth, gridHeight, maxEntities) {
        // Gate 3: validate every constructor argument before allocating.
        requirePositiveFinite(cellSize, 'cellSize');
        requirePositiveInt(gridWidth, 'gridWidth');
        requirePositiveInt(gridHeight, 'gridHeight');
        requirePositiveInt(maxEntities, 'maxEntities');
        // gridWidth and gridHeight are validated integers and JS numbers
        // are exact integers up to 2^53, so this product never silently
        // overflows - the cap check sees the true value.
        const numCells = gridWidth * gridHeight;
        if (numCells > MAX_CELL_COUNT) {
            throw new RangeError('SpatialGrid: numCells ' + numCells + ' exceeds the cap ' + MAX_CELL_COUNT);
        }
        if (maxEntities > MAX_ENTITY_COUNT) {
            throw new RangeError('SpatialGrid: maxEntities ' + maxEntities
                + ' exceeds the cap ' + MAX_ENTITY_COUNT);
        }
        this.cellSize = cellSize;
        this.gridWidth = gridWidth;
        this.gridHeight = gridHeight;
        this.numCells = numCells;
        this.maxEntities = maxEntities;
        this.head = new Int32Array(numCells).fill(EMPTY);
        this.next = new Int32Array(maxEntities).fill(EMPTY);
    }
    // Bumped by every write; see _epoch.
    get epoch() {
        return this._epoch;
    }
    // Map a world position to its cell index. Positions outside the
    // grid clamp to the nearest edge cell, so an entity that walks off
    // the arena still lands in a valid, deterministic cell rather than
    // throwing or going un-indexed. Math.floor over the IEEE-754
    // division is identical on every runtime, so the mapping is
    // deterministic.
    cellIndexOf(x, y) {
        let col = Math.floor(x / this.cellSize);
        let row = Math.floor(y / this.cellSize);
        if (col < 0)
            col = 0;
        else if (col >= this.gridWidth)
            col = this.gridWidth - 1;
        if (row < 0)
            row = 0;
        else if (row >= this.gridHeight)
            row = this.gridHeight - 1;
        return col + row * this.gridWidth;
    }
    // Reset every cell to empty - the first half of the rebuild model:
    // a frame does clear() then re-insert()s every live entity.
    // head.fill is the load-bearing reset; next.fill is not required
    // for correctness (insert overwrites next[entityId] before it is
    // ever read) but it keeps a cleared grid fully consistent, so a
    // stale-link bug terminates at EMPTY instead of walking last
    // frame's chain (gate 4).
    clear() {
        this.head.fill(EMPTY);
        this.next.fill(EMPTY);
        this._epoch++;
    }
    // Chain entityId into cellIdx (prepend, O(1)) - a single-writer
    // write op (gate 1). Both arguments are bounds-checked (gate 4): an
    // out-of-range entityId or cellIdx throws rather than corrupting a
    // typed array. There is no single-entity remove by design - the
    // grid is rebuilt wholesale via clear() each frame.
    insert(entityId, cellIdx) {
        if (!Number.isInteger(entityId) || entityId < 0 || entityId >= this.maxEntities) {
            throw new RangeError('SpatialGrid.insert: entityId ' + entityId
                + ' out of range [0, ' + this.maxEntities + ')');
        }
        if (!Number.isInteger(cellIdx) || cellIdx < 0 || cellIdx >= this.numCells) {
            throw new RangeError('SpatialGrid.insert: cellIdx ' + cellIdx
                + ' out of range [0, ' + this.numCells + ')');
        }
        this.next[entityId] = this.head[cellIdx] ?? EMPTY;
        this.head[cellIdx] = entityId;
        this._epoch++;
    }
    // Copy the entityIds chained into cellIdx into `out`, returning the
    // count written. Gate 5: a result buffer, never a callback. Gate 2:
    // the caller receives a copy, never a live view of next[], so a
    // later insert/clear cannot mutate a result already returned. Gate
    // 4: the walk is hard-capped at maxEntities iterations, so a
    // corrupt next[] (e.g. a cycle) throws instead of hanging. If `out`
    // is shorter than the cell's population the result is truncated to
    // out.length - size the buffer to maxEntities to be safe.
    query(cellIdx, out) {
        if (!Number.isInteger(cellIdx) || cellIdx < 0 || cellIdx >= this.numCells) {
            throw new RangeError('SpatialGrid.query: cellIdx ' + cellIdx
                + ' out of range [0, ' + this.numCells + ')');
        }
        const cap = out.length;
        let count = 0;
        let curr = this.head[cellIdx] ?? EMPTY;
        let guard = 0;
        while (curr !== EMPTY && count < cap) {
            out[count++] = curr;
            curr = this.next[curr] ?? EMPTY;
            if (++guard > this.maxEntities) {
                throw new Error('SpatialGrid.query: traversal of cell ' + cellIdx
                    + ' exceeded maxEntities - next[] is corrupt (cycle?)');
            }
        }
        return count;
    }
    // Formal traversal API (gate 6): firstInCell + nextOf let a
    // hot-path consumer walk a cell in place - no result-buffer copy,
    // no reaching into the private head[] / next[] arrays. The walk is
    //   for (let e = grid.firstInCell(c); e !== -1; e = grid.nextOf(e))
    // Both return EMPTY (-1) for "no more". The single-writer contract
    // still holds: do not insert()/clear() mid-walk. Capture grid.epoch
    // before the loop and re-check it to assert that, or use query()
    // (which is interruption-proof) when you cannot guarantee it.
    firstInCell(cellIdx) {
        if (!Number.isInteger(cellIdx) || cellIdx < 0 || cellIdx >= this.numCells) {
            throw new RangeError('SpatialGrid.firstInCell: cellIdx ' + cellIdx
                + ' out of range [0, ' + this.numCells + ')');
        }
        return this.head[cellIdx] ?? EMPTY;
    }
    nextOf(entityId) {
        if (!Number.isInteger(entityId) || entityId < 0 || entityId >= this.maxEntities) {
            throw new RangeError('SpatialGrid.nextOf: entityId ' + entityId
                + ' out of range [0, ' + this.maxEntities + ')');
        }
        return this.next[entityId] ?? EMPTY;
    }
}
//# sourceMappingURL=spatial-grid.js.map