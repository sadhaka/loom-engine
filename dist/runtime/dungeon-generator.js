// DungeonGenerator - BSP rooms-and-corridors dungeon layout.
//
// 1.6.3 enabling primitive (Wave 1.6 procgen depth). Produces a
// 2D tile map: 0 = wall, 1 = floor. Uses Binary Space Partitioning
// to recursively split the map into shrinking rectangles, places
// one room inside each leaf rectangle, then connects sibling
// rooms via L-shaped corridors. Standard roguelike pattern.
//
//   var dg = DungeonGenerator.create({
//     seed: 'world-42',
//     width: 64, height: 48,
//     minRoomSize: 5, maxRoomSize: 12,
//     minLeafSize: 8,
//   });
//   var dungeon = dg.generate();
//   // dungeon.tiles is Uint8Array(width * height); 0 wall, 1 floor.
//   // dungeon.rooms is an array of { x, y, w, h }
//   // dungeon.corridors is an array of { x1, y1, x2, y2 }
//
// Pairs with NameGenerator (1.6.0, dungeon names),
// VoronoiPartition (1.6.2, dungeons placed per region),
// BiomeMixer (1.6.4 next), WorldSeed (1.6.5 milestone).
//
// Code style: var-only in browser source.
function fnv1a(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}
function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
        t = (t + 0x6D2B79F5) >>> 0;
        var x = t;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}
function resolveSeed(seed) {
    if (typeof seed === 'number' && isFinite(seed))
        return seed >>> 0;
    if (typeof seed === 'string' && seed.length > 0)
        return fnv1a(seed);
    return fnv1a('dungeon-seed');
}
export class DungeonGenerator {
    width;
    height;
    minLeafSize;
    minRoomSize;
    maxRoomSize;
    maxDepth;
    rng;
    constructor(opts) {
        if (!(opts.width > 0))
            throw new Error('DungeonGenerator: width must be > 0');
        if (!(opts.height > 0))
            throw new Error('DungeonGenerator: height must be > 0');
        this.width = opts.width | 0;
        this.height = opts.height | 0;
        this.minLeafSize = (typeof opts.minLeafSize === 'number' && opts.minLeafSize >= 4)
            ? (opts.minLeafSize | 0) : 8;
        this.minRoomSize = (typeof opts.minRoomSize === 'number' && opts.minRoomSize >= 2)
            ? (opts.minRoomSize | 0) : 4;
        this.maxRoomSize = (typeof opts.maxRoomSize === 'number' && opts.maxRoomSize >= this.minRoomSize)
            ? (opts.maxRoomSize | 0) : 10;
        this.maxDepth = (typeof opts.maxDepth === 'number' && opts.maxDepth > 0)
            ? (opts.maxDepth | 0) : 6;
        this.rng = mulberry32(resolveSeed(opts.seed));
    }
    static create(opts) {
        return new DungeonGenerator(opts);
    }
    generate() {
        var root = {
            x: 0, y: 0, w: this.width, h: this.height,
            left: null, right: null, room: null, depth: 0,
        };
        this.split(root);
        var rooms = [];
        this.placeRooms(root, rooms);
        var corridors = [];
        this.connect(root, corridors);
        var tiles = new Uint8Array(this.width * this.height);
        this.carveRooms(rooms, tiles);
        this.carveCorridors(corridors, tiles);
        return {
            width: this.width,
            height: this.height,
            tiles: tiles,
            rooms: rooms,
            corridors: corridors,
        };
    }
    // ---------- private ----------
    split(node) {
        if (node.depth >= this.maxDepth)
            return;
        var min = this.minLeafSize;
        if (node.w <= min * 2 && node.h <= min * 2)
            return;
        // Prefer splitting along the longer axis; otherwise random.
        var splitH;
        if (node.w / node.h > 1.25)
            splitH = false;
        else if (node.h / node.w > 1.25)
            splitH = true;
        else
            splitH = this.rng() < 0.5;
        if (splitH) {
            var maxY = node.h - min;
            if (maxY < min)
                return;
            var splitY = min + Math.floor(this.rng() * (maxY - min + 1));
            node.left = { x: node.x, y: node.y, w: node.w, h: splitY,
                left: null, right: null, room: null, depth: node.depth + 1 };
            node.right = { x: node.x, y: node.y + splitY, w: node.w, h: node.h - splitY,
                left: null, right: null, room: null, depth: node.depth + 1 };
        }
        else {
            var maxX = node.w - min;
            if (maxX < min)
                return;
            var splitX = min + Math.floor(this.rng() * (maxX - min + 1));
            node.left = { x: node.x, y: node.y, w: splitX, h: node.h,
                left: null, right: null, room: null, depth: node.depth + 1 };
            node.right = { x: node.x + splitX, y: node.y, w: node.w - splitX, h: node.h,
                left: null, right: null, room: null, depth: node.depth + 1 };
        }
        this.split(node.left);
        this.split(node.right);
    }
    placeRooms(node, out) {
        if (node.left || node.right) {
            if (node.left)
                this.placeRooms(node.left, out);
            if (node.right)
                this.placeRooms(node.right, out);
            return;
        }
        // Leaf: place a room inside the node's bounds.
        var maxRoomW = Math.min(this.maxRoomSize, Math.max(this.minRoomSize, node.w - 2));
        var maxRoomH = Math.min(this.maxRoomSize, Math.max(this.minRoomSize, node.h - 2));
        if (maxRoomW < this.minRoomSize || maxRoomH < this.minRoomSize)
            return;
        var rw = this.minRoomSize + Math.floor(this.rng() * (maxRoomW - this.minRoomSize + 1));
        var rh = this.minRoomSize + Math.floor(this.rng() * (maxRoomH - this.minRoomSize + 1));
        var rx = node.x + 1 + Math.floor(this.rng() * Math.max(1, node.w - rw - 1));
        var ry = node.y + 1 + Math.floor(this.rng() * Math.max(1, node.h - rh - 1));
        var room = { x: rx, y: ry, w: rw, h: rh };
        node.room = room;
        out.push(room);
    }
    connect(node, out) {
        if (!node.left && !node.right)
            return;
        if (node.left)
            this.connect(node.left, out);
        if (node.right)
            this.connect(node.right, out);
        // Connect a representative room from left subtree to one from right.
        if (node.left && node.right) {
            var a = this.pickRoom(node.left);
            var b = this.pickRoom(node.right);
            if (a && b) {
                var ax = Math.floor(a.x + a.w / 2);
                var ay = Math.floor(a.y + a.h / 2);
                var bx = Math.floor(b.x + b.w / 2);
                var by = Math.floor(b.y + b.h / 2);
                // Two L-corridor segments
                if (this.rng() < 0.5) {
                    out.push({ x1: ax, y1: ay, x2: bx, y2: ay });
                    out.push({ x1: bx, y1: ay, x2: bx, y2: by });
                }
                else {
                    out.push({ x1: ax, y1: ay, x2: ax, y2: by });
                    out.push({ x1: ax, y1: by, x2: bx, y2: by });
                }
            }
        }
    }
    pickRoom(node) {
        if (node.room)
            return node.room;
        var leftRoom = node.left ? this.pickRoom(node.left) : null;
        if (leftRoom)
            return leftRoom;
        var rightRoom = node.right ? this.pickRoom(node.right) : null;
        return rightRoom;
    }
    carveRooms(rooms, tiles) {
        for (var i = 0; i < rooms.length; i++) {
            var r = rooms[i];
            for (var y = r.y; y < r.y + r.h; y++) {
                for (var x = r.x; x < r.x + r.w; x++) {
                    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
                        tiles[y * this.width + x] = 1;
                    }
                }
            }
        }
    }
    carveCorridors(corridors, tiles) {
        for (var i = 0; i < corridors.length; i++) {
            var c = corridors[i];
            var x1 = c.x1, y1 = c.y1, x2 = c.x2, y2 = c.y2;
            if (x1 === x2) {
                var ya = Math.min(y1, y2), yb = Math.max(y1, y2);
                for (var y = ya; y <= yb; y++) {
                    if (x1 >= 0 && x1 < this.width && y >= 0 && y < this.height) {
                        tiles[y * this.width + x1] = 1;
                    }
                }
            }
            else if (y1 === y2) {
                var xa = Math.min(x1, x2), xb = Math.max(x1, x2);
                for (var x = xa; x <= xb; x++) {
                    if (x >= 0 && x < this.width && y1 >= 0 && y1 < this.height) {
                        tiles[y1 * this.width + x] = 1;
                    }
                }
            }
        }
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_DUNGEON_GENERATOR = 'dungeon_generator';
//# sourceMappingURL=dungeon-generator.js.map