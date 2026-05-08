// SpatialHash - bucket entities by world cell for fast nearby queries.
//
// 0.30.0 enabling primitive. The 0.22.0 ComponentSignature/QueryCache
// pair gives us "entities WITH components", but downstream code
// usually wants "entities NEAR a point" - boss target picking,
// AoE spell coverage, particle culling. A naive O(N) scan of the
// transform pool works at <500 entities; past that the per-frame
// cost shows up in the HUD. SpatialHash gives O(1)-ish per-entity
// insert + O(K) query where K = entities in the queried cells.
//
// Storage: Map<bucketKey, EntityList>. Each entity is in exactly
// one bucket at a time (the cell its center occupies). Re-bucket on
// position update via update(entity, x, y).
//
// Cell size is the major tuning knob. Default 32 world units; for a
// world where most entities sit within a 5x5 unit radius of each
// other, a smaller cell (e.g. 8) cuts the per-cell list length
// dramatically. For a sparse world with kilometer-scale gaps,
// larger cells (256) save memory.
//
// Code style: var-only in browser source.
// Pack two int32s into one int53 key. Negative ints handled by
// a + 2^15 bias; cell coords beyond +-32k overflow but no real
// game world reaches that.
function bucketKey(cx, cy) {
    // Bias by 2^15 so cell coords -32768..32767 fit unsigned 16-bit.
    var bx = (cx | 0) + 32768;
    var by = (cy | 0) + 32768;
    // 17 bits each; max 2^34 - well within safe int range (2^53).
    return bx * 0x20000 + by;
}
export class SpatialHash {
    cellSize;
    buckets = new Map();
    entityIndex = new Map();
    // Counters for tests.
    inserts = 0;
    removes = 0;
    updates = 0;
    queries = 0;
    constructor(cellSize = 32) {
        var s = +cellSize;
        if (!isFinite(s) || s <= 0)
            s = 32;
        this.cellSize = s;
    }
    // World coord -> cell coord.
    toCellX(x) {
        return Math.floor(x / this.cellSize);
    }
    toCellY(y) {
        return Math.floor(y / this.cellSize);
    }
    // Insert entity at (x, y). If the entity already exists, this is
    // equivalent to update(entity, x, y).
    insert(entity, x, y) {
        if (this.entityIndex.has(entity)) {
            this.update(entity, x, y);
            return;
        }
        var cx = this.toCellX(x);
        var cy = this.toCellY(y);
        var key = bucketKey(cx, cy);
        var cell = this.buckets.get(key);
        if (!cell) {
            cell = { entities: [] };
            this.buckets.set(key, cell);
        }
        var idx = cell.entities.length;
        cell.entities.push(entity);
        this.entityIndex.set(entity, { bucket: key, indexInBucket: idx });
        this.inserts++;
    }
    // Remove entity. Returns true iff the entity was present.
    remove(entity) {
        var rec = this.entityIndex.get(entity);
        if (!rec)
            return false;
        var cell = this.buckets.get(rec.bucket);
        if (cell) {
            // Swap-pop with the last entry to keep removal O(1).
            var lastIdx = cell.entities.length - 1;
            if (rec.indexInBucket !== lastIdx) {
                var movedEntity = cell.entities[lastIdx];
                cell.entities[rec.indexInBucket] = movedEntity;
                var movedRec = this.entityIndex.get(movedEntity);
                if (movedRec)
                    movedRec.indexInBucket = rec.indexInBucket;
            }
            cell.entities.pop();
            if (cell.entities.length === 0) {
                this.buckets.delete(rec.bucket);
            }
        }
        this.entityIndex.delete(entity);
        this.removes++;
        return true;
    }
    // Update an entity's position. If the new position is in the same
    // bucket, this is a no-op on the bucket lists. If it crossed a cell
    // boundary, remove + reinsert.
    update(entity, x, y) {
        var rec = this.entityIndex.get(entity);
        if (!rec) {
            // Treat as insert.
            this.insert(entity, x, y);
            return;
        }
        var cx = this.toCellX(x);
        var cy = this.toCellY(y);
        var newKey = bucketKey(cx, cy);
        if (newKey === rec.bucket) {
            this.updates++;
            return;
        }
        // Cross-cell: remove from old bucket, insert in new.
        var oldCell = this.buckets.get(rec.bucket);
        if (oldCell) {
            var lastIdx = oldCell.entities.length - 1;
            if (rec.indexInBucket !== lastIdx) {
                var movedEntity = oldCell.entities[lastIdx];
                oldCell.entities[rec.indexInBucket] = movedEntity;
                var movedRec = this.entityIndex.get(movedEntity);
                if (movedRec)
                    movedRec.indexInBucket = rec.indexInBucket;
            }
            oldCell.entities.pop();
            if (oldCell.entities.length === 0) {
                this.buckets.delete(rec.bucket);
            }
        }
        var newCell = this.buckets.get(newKey);
        if (!newCell) {
            newCell = { entities: [] };
            this.buckets.set(newKey, newCell);
        }
        var newIdx = newCell.entities.length;
        newCell.entities.push(entity);
        rec.bucket = newKey;
        rec.indexInBucket = newIdx;
        this.updates++;
    }
    // Return entities in cells overlapping the rect (x0,y0)..(x1,y1).
    // Some returned entities will be inside the rect; some will be in
    // the cells overlapping it but outside the rect itself. Caller
    // applies the precise containment test if needed.
    queryRect(x0, y0, x1, y1) {
        this.queries++;
        var minX = Math.min(x0, x1);
        var maxX = Math.max(x0, x1);
        var minY = Math.min(y0, y1);
        var maxY = Math.max(y0, y1);
        var cMinX = this.toCellX(minX);
        var cMaxX = this.toCellX(maxX);
        var cMinY = this.toCellY(minY);
        var cMaxY = this.toCellY(maxY);
        var out = [];
        for (var cx = cMinX; cx <= cMaxX; cx++) {
            for (var cy = cMinY; cy <= cMaxY; cy++) {
                var cell = this.buckets.get(bucketKey(cx, cy));
                if (!cell)
                    continue;
                for (var i = 0; i < cell.entities.length; i++) {
                    var e = cell.entities[i];
                    if (e !== undefined)
                        out.push(e);
                }
            }
        }
        return out;
    }
    // Return entities in cells overlapping a circle at (cx, cy) with
    // `radius`. Caller filters by exact distance if precise membership
    // matters; the hash only narrows by bucket.
    queryRadius(cx, cy, radius) {
        return this.queryRect(cx - radius, cy - radius, cx + radius, cy + radius);
    }
    // Total entities tracked.
    size() { return this.entityIndex.size; }
    // Number of non-empty buckets.
    bucketCount() { return this.buckets.size; }
    // Drop everything.
    clear() {
        this.buckets.clear();
        this.entityIndex.clear();
    }
    // Diagnostic counters.
    stats() {
        return {
            cellSize: this.cellSize,
            entities: this.entityIndex.size,
            buckets: this.buckets.size,
            inserts: this.inserts,
            removes: this.removes,
            updates: this.updates,
            queries: this.queries,
        };
    }
}
// Resource key for the world-attached spatial hash.
export const RESOURCE_SPATIAL_HASH = 'loom.spatial_hash';
//# sourceMappingURL=spatial-hash.js.map