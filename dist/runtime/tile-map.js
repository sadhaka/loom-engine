// TileMap - 2D tile grid backed by a Uint16Array.
//
// 0.57.0 enabling primitive. ZoneCatalog (Phase 8) defines per-
// zone tile palettes; the engine has no actual tile-grid
// container. TileMap is a tiny rectangle of u16 tile ids stored
// in row-major order (row 0 first), with bounds-checked accessors,
// fill / flood-fill helpers, range queries, and a serialization
// path for save snapshots.
//
// Tile id 0 is conventional for "empty"; consumers can assign any
// meaning. Multiple TileMaps can be layered (background, terrain,
// decoration, collision) by the consumer - the engine doesn't
// impose a layer model here.
//
// Code style: var-only in browser source.
export class TileMap {
    widthN;
    heightN;
    tiles;
    constructor(opts) {
        if (!isFinite(opts.width) || opts.width <= 0
            || !isFinite(opts.height) || opts.height <= 0) {
            throw new Error('TileMap: width / height must be positive');
        }
        this.widthN = Math.floor(opts.width);
        this.heightN = Math.floor(opts.height);
        var total = this.widthN * this.heightN;
        this.tiles = new Uint16Array(total);
        if (opts.data) {
            if (opts.data.length !== total) {
                throw new Error('TileMap: data length ' + opts.data.length
                    + ' does not match width*height ' + total);
            }
            this.tiles.set(opts.data);
        }
        else if (opts.defaultTile !== undefined && opts.defaultTile !== 0) {
            this.tiles.fill(opts.defaultTile);
        }
    }
    static create(opts) {
        return new TileMap(opts);
    }
    width() { return this.widthN; }
    height() { return this.heightN; }
    cellCount() { return this.widthN * this.heightN; }
    inBounds(x, y) {
        return x >= 0 && x < this.widthN && y >= 0 && y < this.heightN;
    }
    // Read a tile id. Returns 0 for out-of-bounds (a sensible
    // default; consumers needing distinct out-of-bounds detection
    // call inBounds first).
    get(x, y) {
        var ix = Math.floor(x);
        var iy = Math.floor(y);
        if (!this.inBounds(ix, iy))
            return 0;
        return this.tiles[iy * this.widthN + ix];
    }
    // Write a tile id. Out-of-bounds writes are silent no-ops.
    // Tile id is clamped to [0, 65535] (Uint16 range).
    set(x, y, tile) {
        var ix = Math.floor(x);
        var iy = Math.floor(y);
        if (!this.inBounds(ix, iy))
            return;
        var t = Math.floor(tile);
        if (t < 0)
            t = 0;
        if (t > 65535)
            t = 65535;
        this.tiles[iy * this.widthN + ix] = t;
    }
    // Fill every cell with `tile`.
    fill(tile) {
        var t = Math.floor(tile);
        if (t < 0)
            t = 0;
        if (t > 65535)
            t = 65535;
        this.tiles.fill(t);
    }
    // Fill a rectangular region. Clipped to bounds.
    fillRect(x, y, w, h, tile) {
        var t = Math.floor(tile);
        if (t < 0)
            t = 0;
        if (t > 65535)
            t = 65535;
        var x0 = Math.max(0, Math.floor(x));
        var y0 = Math.max(0, Math.floor(y));
        var x1 = Math.min(this.widthN, Math.floor(x + w));
        var y1 = Math.min(this.heightN, Math.floor(y + h));
        for (var yy = y0; yy < y1; yy++) {
            var base = yy * this.widthN;
            for (var xx = x0; xx < x1; xx++) {
                this.tiles[base + xx] = t;
            }
        }
    }
    // Replace every cell whose current value === `from` with `to`.
    // Returns the number of cells changed.
    replaceAll(from, to) {
        var f = Math.floor(from);
        var t = Math.floor(to);
        if (t < 0)
            t = 0;
        if (t > 65535)
            t = 65535;
        var changed = 0;
        for (var i = 0; i < this.tiles.length; i++) {
            if (this.tiles[i] === f) {
                this.tiles[i] = t;
                changed++;
            }
        }
        return changed;
    }
    // 4-connected flood fill starting at (sx, sy). Replaces every
    // contiguous cell of the same source value with `replacement`.
    // Returns the number of cells changed; 0 if start tile already
    // equals replacement or start is out-of-bounds.
    floodFill(sx, sy, replacement) {
        var ix = Math.floor(sx);
        var iy = Math.floor(sy);
        if (!this.inBounds(ix, iy))
            return 0;
        var sourceIdx = iy * this.widthN + ix;
        var source = this.tiles[sourceIdx];
        var rep = Math.floor(replacement);
        if (rep < 0)
            rep = 0;
        if (rep > 65535)
            rep = 65535;
        if (source === rep)
            return 0;
        var stack = [[ix, iy]];
        var changed = 0;
        while (stack.length > 0) {
            var pop = stack.pop();
            var x = pop[0];
            var y = pop[1];
            if (!this.inBounds(x, y))
                continue;
            var idx = y * this.widthN + x;
            if (this.tiles[idx] !== source)
                continue;
            this.tiles[idx] = rep;
            changed++;
            stack.push([x + 1, y]);
            stack.push([x - 1, y]);
            stack.push([x, y + 1]);
            stack.push([x, y - 1]);
        }
        return changed;
    }
    // Iterate every cell. Callback receives (x, y, tile). Throwing
    // is isolated; iteration continues.
    forEach(cb) {
        for (var y = 0; y < this.heightN; y++) {
            var base = y * this.widthN;
            for (var x = 0; x < this.widthN; x++) {
                try {
                    cb(x, y, this.tiles[base + x]);
                }
                catch { /* ignore */ }
            }
        }
    }
    // Return all cells matching a predicate. Useful for "find every
    // 'spawner' tile" lookups.
    findAll(predicate) {
        var out = [];
        for (var y = 0; y < this.heightN; y++) {
            var base = y * this.widthN;
            for (var x = 0; x < this.widthN; x++) {
                var t = this.tiles[base + x];
                if (predicate(t))
                    out.push({ x: x, y: y, tile: t });
            }
        }
        return out;
    }
    // Snapshot for save / load. Encodes tile data as base64 for
    // JSON-safe storage; pairs with the 0.38 PersistentStorage
    // facade.
    toSnapshot() {
        return {
            width: this.widthN,
            height: this.heightN,
            data: encodeBase64(new Uint8Array(this.tiles.buffer, this.tiles.byteOffset, this.tiles.byteLength)),
        };
    }
    // Restore from a snapshot. Returns null if shape mismatches.
    static fromSnapshot(snap) {
        if (!snap || typeof snap !== 'object')
            return null;
        if (typeof snap.width !== 'number' || typeof snap.height !== 'number')
            return null;
        if (typeof snap.data !== 'string')
            return null;
        var bytes = decodeBase64(snap.data);
        if (!bytes)
            return null;
        var expectedBytes = snap.width * snap.height * 2;
        if (bytes.length !== expectedBytes)
            return null;
        var u16 = new Uint16Array(bytes.buffer, bytes.byteOffset, snap.width * snap.height);
        return TileMap.create({
            width: snap.width,
            height: snap.height,
            data: u16,
        });
    }
    // Direct access to the typed array for renderer fast paths.
    // Modifying the returned array changes the map's state.
    raw() {
        return this.tiles;
    }
}
function getBuffer() {
    var g = globalThis;
    return g.Buffer ?? null;
}
function encodeBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    if (typeof btoa === 'function')
        return btoa(binary);
    // Node fallback.
    var BufferCtor = getBuffer();
    if (BufferCtor) {
        return BufferCtor.from(binary, 'binary').toString('base64');
    }
    // No encoder available - return empty string (snapshot will fail
    // round-trip; consumer should detect via fromSnapshot returning
    // null).
    return '';
}
function decodeBase64(s) {
    try {
        if (typeof atob === 'function') {
            var binary = atob(s);
            var out = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) {
                out[i] = binary.charCodeAt(i);
            }
            return out;
        }
        var BufferCtor = getBuffer();
        if (BufferCtor) {
            var buf = BufferCtor.from(s, 'base64');
            return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        }
    }
    catch {
        return null;
    }
    return null;
}
// Resource key for the world's resource registry.
export const RESOURCE_TILE_MAP = 'tile_map';
//# sourceMappingURL=tile-map.js.map