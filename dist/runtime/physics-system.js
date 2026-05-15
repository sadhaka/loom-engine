// PhysicsSystem - a 2D AABB collision primitive over a SoA collider
// pool, with SpatialGrid broadphase and positional push-apart.
//
// The Trinity dossier's section 9 (Gemini Volume I). The §9 sketch was
//   class PhysicsSystem {
//     update(pool, grid) {
//       for each entity: query grid, resolveCollisions(...)
//     }
//   }
// and the Codex audit flagged it: "correctness bugs around cached
// positions and stale grid membership." This is the corrected build.
//
// SHAPE. Like the other Trinity components (SpatialGrid, LoomFlux,
// LoomDecay...), this is a standalone runtime primitive, not a wired
// ECS System - it owns its data and the caller drives it. It owns a
// SoA collider pool of 2D AABBs:
//   posX, posY     Float32  per slot - collider centre
//   halfW, halfH   Float32  per slot - half-extents (Gemini's w / h)
//   velX, velY     Float32  per slot - velocity, integrated by step()
//   flags          Uint8    per slot - bit 0 ACTIVE, bit 1 STATIC
//   generation     Uint8    per slot - bumped on recycle (handle guard)
// A ColliderHandle packs (generation, slot) the way an EntityId packs
// (generation, index), so a handle to a recycled slot fails validation.
//
// PIPELINE. Three composable phases, or step() for the canonical
// composition:
//   1. integrate(dt) - project next position: posX += velX * dt for
//      every active non-static collider.
//   2. syncGrid(grid) - rebuild the broadphase: clear() the grid and
//      re-insert every active collider at its current cell.
//   3. detect(grid)  - read-only broadphase + narrowphase sweep; fill
//      the contact buffer with overlapping (slotA, slotB) pairs.
//   4. resolve(iter) - drain the contact buffer; push overlapping
//      pairs apart along the minimum-translation axis.
// detect / resolve are split so the stale-state gates are satisfiable
// by construction (see below) - the same detect-then-commit idiom as
// LoomDecay's applyDecay / commit.
//
// GRID CONTRACT. SpatialGrid's intrusive list holds each entity in
// exactly one cell, so a collider is indexed by its centre cell.
// detect() therefore queries the 3x3 block around a collider's centre
// cell. That block is provably complete iff cellSize >= the largest
// collider's full extent: two AABBs overlap only when their centres
// are within (halfA + halfB) <= maxExtent <= cellSize on each axis, so
// the other centre is at most one cell away. syncGrid() enforces the
// contract against a monotonic high-water mark of the largest extent
// ever spawned, and that the grid can hold every collider slot.
//
// The 6 Codex gates for PhysicsSystem, enforced:
//   1. "Do not use stale ax/ay after moving entity A during pair
//      resolution." - resolve() re-reads posX/posY/halfW/halfH fresh
//      for both colliders at the top of every pair, every iteration.
//      No position is ever cached across a move.
//   2. "Sync moved entities or define broadphase validity for the
//      step." - broadphase validity is DEFINED and ENFORCED. syncGrid()
//      snapshots grid.epoch and clears a _positionsDirty flag; any
//      position write (spawn / setPosition / integrate / resolve /
//      recycle) sets _positionsDirty; detect() throws if positions
//      moved since the last syncGrid() or if the grid was written by
//      anyone else (epoch mismatch / different grid). The grid is a
//      step-start snapshot - after resolve() moves entities you must
//      syncGrid() again before the next detect().
//   3. "Avoid private grid field casts." - detect() uses only
//      SpatialGrid's public API (cellIndexOf, query, gridWidth,
//      gridHeight, epoch). It never reaches into head[] / next[].
//   4. "Add robust dense-collision benchmark expectations." - the test
//      suite asserts exact contact counts for dense clusters (K
//      coincident colliders -> K*(K-1)/2 contacts; an N x N lattice ->
//      the asserted neighbour-pair count).
//   5. "Use squared distance where possible and document sqrt cost." -
//      satisfied vacuously: AABB overlap and minimum-translation-vector
//      resolution are pure per-axis subtractions and comparisons. This
//      file computes NO Euclidean distance and calls Math.sqrt zero
//      times.
//   6. "Single thread ownership for physics buffers." - PhysicsSystem
//      owns its SoA collider pool and contact buffer outright. There is
//      no SharedArrayBuffer path, no Atomics, no second writer; the
//      columns are mutated only by PhysicsSystem's own methods.
//
// Non-negotiable engine gates: no RNG and no wall clock (dt is a
// parameter - the math is deterministic, and resolve()'s tie-breaks
// are fixed-direction, so a replay reproduces a step bit-for-bit);
// every handle / slot / index is bounds-checked; the contact buffer is
// fixed-capacity and throws on overflow rather than truncating.
//
// Storage is flat typed arrays sized once in the constructor, so the
// structure allocates nothing after construction - a step() does zero
// allocation.
// Collider flag bits, packed into the flags Uint8 column.
const COLLIDER_FLAG_ACTIVE = 1 << 0; // slot holds a live collider
const COLLIDER_FLAG_STATIC = 1 << 1; // immovable - never integrated or pushed
// ColliderHandle layout, mirroring EntityId / MaterialHandle: low 24
// bits slot, high 8 bits generation.
const COLLIDER_INDEX_MASK = 0x00ffffff;
const COLLIDER_GENERATION_SHIFT = 24;
const COLLIDER_GENERATION_MASK = 0xff;
// Sanity caps on the constructor-derived sizes. Not hard engine limits
// - just guards so a bad argument throws a clear error instead of
// attempting an absurd typed-array allocation. capacity matches the
// EntityAllocator's index space ceiling used elsewhere in the engine.
const MAX_CAPACITY = 1 << 18;
const MAX_CONTACTS = 1 << 22;
// Upper bound on resolve() relaxation passes over the fixed contact
// set, so a caller cannot spin the solver unboundedly.
const MAX_RESOLVE_ITERATIONS = 64;
export function makeColliderHandle(slot, generation) {
    return ((generation & COLLIDER_GENERATION_MASK) << COLLIDER_GENERATION_SHIFT)
        | (slot & COLLIDER_INDEX_MASK);
}
export function colliderSlot(handle) {
    return handle & COLLIDER_INDEX_MASK;
}
export function colliderGeneration(handle) {
    return (handle >>> COLLIDER_GENERATION_SHIFT) & COLLIDER_GENERATION_MASK;
}
export class PhysicsSystem {
    // Collider-slot count: slots are in [0, capacity).
    capacity;
    // Contact-buffer size: detect() throws if a pass finds more pairs.
    maxContacts;
    // Collider pool columns (gate 6 - owned outright), indexed by slot.
    posX;
    posY;
    halfW;
    halfH;
    velX;
    velY;
    flags;
    generation;
    // Contact buffer: detect() fills [0, contactCount) with overlapping
    // pairs, contactA[c] < contactB[c]. resolve() drains it; it survives
    // until the next detect() / clear() so a caller can inspect it.
    contactA;
    contactB;
    contactCount = 0;
    // Scratch for grid.query() - sized to capacity, the most colliders a
    // cell can ever hold, so a query result is never truncated.
    scratch;
    // Active (spawned, not recycled) collider count.
    activeCount = 0;
    // Monotonic high-water of the largest collider full extent ever
    // spawned. syncGrid() requires grid.cellSize >= this so the 3x3
    // broadphase block is complete (see GRID CONTRACT above).
    maxColliderExtent = 0;
    // Broadphase-validity tracking (gate 2). _positionsDirty is true
    // whenever a position has changed since the last syncGrid();
    // _lastSyncGrid / _lastSyncEpoch pin the grid syncGrid() last built.
    // detect() refuses to run unless both say the grid is current.
    positionsDirty = false;
    lastSyncGrid = null;
    lastSyncEpoch = 0;
    constructor(capacity, maxContacts) {
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
            throw new RangeError('PhysicsSystem: capacity must be an integer in [1, ' + MAX_CAPACITY + '], got ' + capacity);
        }
        if (!Number.isInteger(maxContacts) || maxContacts < 1 || maxContacts > MAX_CONTACTS) {
            throw new RangeError('PhysicsSystem: maxContacts must be an integer in [1, ' + MAX_CONTACTS + '], got ' + maxContacts);
        }
        this.capacity = capacity;
        this.maxContacts = maxContacts;
        this.posX = new Float32Array(capacity);
        this.posY = new Float32Array(capacity);
        this.halfW = new Float32Array(capacity);
        this.halfH = new Float32Array(capacity);
        this.velX = new Float32Array(capacity);
        this.velY = new Float32Array(capacity);
        this.flags = new Uint8Array(capacity);
        this.generation = new Uint8Array(capacity);
        this.contactA = new Int32Array(maxContacts);
        this.contactB = new Int32Array(maxContacts);
        this.scratch = new Int32Array(capacity);
    }
    // Active (spawned, not recycled) collider count.
    getActiveColliderCount() {
        return this.activeCount;
    }
    // Overlapping pairs currently in the contact buffer - set by the
    // last detect(), left intact by resolve().
    getContactCount() {
        return this.contactCount;
    }
    // Activate `slot` as a fresh collider. Throws if the slot is already
    // active - recycle it first. halfW / halfH are half-extents and must
    // be positive. `slot` is caller-assigned, typically the entity index
    // so it lines up with SpatialGrid entityIds. Returns a
    // generation-stamped handle.
    spawn(slot, x, y, halfW, halfH, vx = 0, vy = 0, isStatic = false) {
        if (!Number.isInteger(slot) || slot < 0 || slot >= this.capacity) {
            throw new RangeError('PhysicsSystem.spawn: slot ' + slot + ' out of [0, ' + this.capacity + ')');
        }
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new RangeError('PhysicsSystem.spawn: x / y must be finite, got ' + x + ', ' + y);
        }
        if (!Number.isFinite(halfW) || halfW <= 0 || !Number.isFinite(halfH) || halfH <= 0) {
            throw new RangeError('PhysicsSystem.spawn: halfW / halfH must be positive finite, got ' + halfW + ', ' + halfH);
        }
        if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
            throw new RangeError('PhysicsSystem.spawn: vx / vy must be finite, got ' + vx + ', ' + vy);
        }
        if (((this.flags[slot] ?? 0) & COLLIDER_FLAG_ACTIVE) !== 0) {
            throw new Error('PhysicsSystem.spawn: slot ' + slot + ' is already active - recycle it first');
        }
        this.posX[slot] = x;
        this.posY[slot] = y;
        this.halfW[slot] = halfW;
        this.halfH[slot] = halfH;
        this.velX[slot] = vx;
        this.velY[slot] = vy;
        this.flags[slot] = isStatic
            ? COLLIDER_FLAG_ACTIVE | COLLIDER_FLAG_STATIC
            : COLLIDER_FLAG_ACTIVE;
        this.activeCount++;
        // Monotonic high-water of the largest full extent - the grid-cell
        // contract syncGrid() enforces.
        const fullW = halfW * 2;
        const fullH = halfH * 2;
        if (fullW > this.maxColliderExtent)
            this.maxColliderExtent = fullW;
        if (fullH > this.maxColliderExtent)
            this.maxColliderExtent = fullH;
        // A freshly spawned collider is not yet in the grid.
        this.positionsDirty = true;
        return makeColliderHandle(slot, this.generation[slot] ?? 0);
    }
    // Recycle a collider: free its slot and bump the generation so
    // existing handles to it stop validating. Returns false if the
    // handle was already stale / dead.
    recycle(handle) {
        if (!this.isAlive(handle))
            return false;
        const slot = colliderSlot(handle);
        this.flags[slot] = (this.flags[slot] ?? 0) & ~COLLIDER_FLAG_ACTIVE;
        this.generation[slot] = ((this.generation[slot] ?? 0) + 1) & COLLIDER_GENERATION_MASK;
        this.posX[slot] = 0;
        this.posY[slot] = 0;
        this.halfW[slot] = 0;
        this.halfH[slot] = 0;
        this.velX[slot] = 0;
        this.velY[slot] = 0;
        this.activeCount--;
        // The recycled slot is still chained into the grid from the last
        // syncGrid(), so grid membership is now stale.
        this.positionsDirty = true;
        return true;
    }
    // True if `handle` still refers to a live collider - the slot is
    // active and its generation matches the handle.
    isAlive(handle) {
        const slot = colliderSlot(handle);
        if (slot >= this.capacity)
            return false;
        if (((this.flags[slot] ?? 0) & COLLIDER_FLAG_ACTIVE) === 0)
            return false;
        return (this.generation[slot] ?? 0) === colliderGeneration(handle);
    }
    // True if `handle` refers to a live STATIC collider - one that is
    // never integrated and never pushed by resolve().
    isStatic(handle) {
        if (!this.isAlive(handle))
            return false;
        return ((this.flags[colliderSlot(handle)] ?? 0) & COLLIDER_FLAG_STATIC) !== 0;
    }
    // Collider centre / half-extents / velocity reads. Return NaN if the
    // handle is stale / dead - NaN is unambiguously "no value" where a
    // coordinate of -1 or 0 would be a legitimate result.
    getX(handle) {
        if (!this.isAlive(handle))
            return NaN;
        return this.posX[colliderSlot(handle)] ?? NaN;
    }
    getY(handle) {
        if (!this.isAlive(handle))
            return NaN;
        return this.posY[colliderSlot(handle)] ?? NaN;
    }
    getHalfW(handle) {
        if (!this.isAlive(handle))
            return NaN;
        return this.halfW[colliderSlot(handle)] ?? NaN;
    }
    getHalfH(handle) {
        if (!this.isAlive(handle))
            return NaN;
        return this.halfH[colliderSlot(handle)] ?? NaN;
    }
    getVelX(handle) {
        if (!this.isAlive(handle))
            return NaN;
        return this.velX[colliderSlot(handle)] ?? NaN;
    }
    getVelY(handle) {
        if (!this.isAlive(handle))
            return NaN;
        return this.velY[colliderSlot(handle)] ?? NaN;
    }
    // Teleport a collider's centre. Returns false if the handle is stale
    // / dead. A position write makes grid membership stale (gate 2).
    setPosition(handle, x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new RangeError('PhysicsSystem.setPosition: x / y must be finite, got ' + x + ', ' + y);
        }
        if (!this.isAlive(handle))
            return false;
        const slot = colliderSlot(handle);
        this.posX[slot] = x;
        this.posY[slot] = y;
        this.positionsDirty = true;
        return true;
    }
    // Set a collider's velocity. Returns false if the handle is stale /
    // dead. Velocity does not affect grid membership, so this does not
    // dirty the broadphase.
    setVelocity(handle, vx, vy) {
        if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
            throw new RangeError('PhysicsSystem.setVelocity: vx / vy must be finite, got ' + vx + ', ' + vy);
        }
        if (!this.isAlive(handle))
            return false;
        const slot = colliderSlot(handle);
        this.velX[slot] = vx;
        this.velY[slot] = vy;
        return true;
    }
    // Project next position: posX += velX * dt for every active
    // non-static collider. STATIC colliders are never integrated. dt
    // must be a finite number >= 0 (dt 0 is a paused frame). Marks the
    // broadphase stale.
    integrate(dt) {
        if (!Number.isFinite(dt) || dt < 0) {
            throw new RangeError('PhysicsSystem.integrate: dt must be a finite number >= 0, got ' + dt);
        }
        for (let s = 0; s < this.capacity; s++) {
            const f = this.flags[s] ?? 0;
            if ((f & COLLIDER_FLAG_ACTIVE) === 0)
                continue;
            if ((f & COLLIDER_FLAG_STATIC) !== 0)
                continue;
            this.posX[s] = (this.posX[s] ?? 0) + (this.velX[s] ?? 0) * dt;
            this.posY[s] = (this.posY[s] ?? 0) + (this.velY[s] ?? 0) * dt;
        }
        this.positionsDirty = true;
    }
    // Rebuild the broadphase: clear `grid` and re-insert every active
    // collider at its current centre cell. The caller invokes this each
    // frame before detect() (gate 2 - PhysicsSystem owns the rebuild).
    // Throws if the grid cannot hold every collider slot, or if its
    // cellSize is smaller than the largest collider ever spawned (the
    // GRID CONTRACT - the 3x3 broadphase block would be incomplete).
    syncGrid(grid) {
        if (grid.maxEntities < this.capacity) {
            throw new RangeError('PhysicsSystem.syncGrid: grid.maxEntities ' + grid.maxEntities
                + ' < collider capacity ' + this.capacity
                + ' - the grid cannot hold every collider slot');
        }
        if (grid.cellSize < this.maxColliderExtent) {
            throw new RangeError('PhysicsSystem.syncGrid: grid.cellSize ' + grid.cellSize
                + ' < largest collider extent ' + this.maxColliderExtent
                + ' - broadphase needs cellSize >= the largest collider so the 3x3 block is complete');
        }
        grid.clear();
        for (let s = 0; s < this.capacity; s++) {
            if (((this.flags[s] ?? 0) & COLLIDER_FLAG_ACTIVE) === 0)
                continue;
            const cell = grid.cellIndexOf(this.posX[s] ?? 0, this.posY[s] ?? 0);
            grid.insert(s, cell);
        }
        // Pin the grid + its epoch: detect() verifies nothing else wrote
        // it (gate 2). positionsDirty clears - the grid is now current.
        this.lastSyncGrid = grid;
        this.lastSyncEpoch = grid.epoch;
        this.positionsDirty = false;
    }
    // Read-only broadphase + narrowphase sweep. For every active
    // collider, query the 3x3 cell block around its centre cell (the
    // GRID CONTRACT makes that complete), AABB-test each higher-id
    // candidate, and append overlapping (slotA, slotB) pairs to the
    // contact buffer (contactA < contactB - each pair is emitted once).
    // Resets the contact buffer at the start. Returns the contact count.
    //
    // Throws if positions changed since the last syncGrid() or if the
    // grid was modified / a different grid was passed (gate 2 - the
    // broadphase must be current). Uses only SpatialGrid's public API
    // (gate 3). Computes no Euclidean distance - pure axis comparisons
    // (gate 5).
    detect(grid) {
        if (this.positionsDirty) {
            throw new Error('PhysicsSystem.detect: collider positions changed since the last syncGrid() - '
                + 'call syncGrid(grid) before detect() so the broadphase grid is current');
        }
        if (grid !== this.lastSyncGrid || grid.epoch !== this.lastSyncEpoch) {
            throw new Error('PhysicsSystem.detect: the grid was modified since syncGrid() (or a different grid '
                + 'was passed) - detect() requires the grid syncGrid() last rebuilt, unmodified');
        }
        this.contactCount = 0;
        const gw = grid.gridWidth;
        const gh = grid.gridHeight;
        for (let i = 0; i < this.capacity; i++) {
            if (((this.flags[i] ?? 0) & COLLIDER_FLAG_ACTIVE) === 0)
                continue;
            const ix = this.posX[i] ?? 0;
            const iy = this.posY[i] ?? 0;
            const ihw = this.halfW[i] ?? 0;
            const ihh = this.halfH[i] ?? 0;
            const ci = grid.cellIndexOf(ix, iy);
            const col = ci % gw;
            const row = (ci - col) / gw;
            const cLo = col > 0 ? col - 1 : 0;
            const cHi = col < gw - 1 ? col + 1 : gw - 1;
            const rLo = row > 0 ? row - 1 : 0;
            const rHi = row < gh - 1 ? row + 1 : gh - 1;
            for (let r = rLo; r <= rHi; r++) {
                for (let c = cLo; c <= cHi; c++) {
                    const cellIdx = c + r * gw;
                    const n = grid.query(cellIdx, this.scratch);
                    for (let k = 0; k < n; k++) {
                        const j = this.scratch[k] ?? -1;
                        // j <= i skips self (j === i) and the mirror pair (j < i),
                        // so each overlapping pair is emitted exactly once.
                        if (j <= i)
                            continue;
                        if (((this.flags[j] ?? 0) & COLLIDER_FLAG_ACTIVE) === 0)
                            continue;
                        const dx = (this.posX[j] ?? 0) - ix;
                        const dy = (this.posY[j] ?? 0) - iy;
                        const adx = dx < 0 ? -dx : dx;
                        const ady = dy < 0 ? -dy : dy;
                        // AABB overlap (Gemini's formula): centres closer than the
                        // sum of half-extents on BOTH axes.
                        if (adx < ihw + (this.halfW[j] ?? 0) && ady < ihh + (this.halfH[j] ?? 0)) {
                            if (this.contactCount >= this.maxContacts) {
                                throw new Error('PhysicsSystem.detect: contact buffer full (maxContacts=' + this.maxContacts
                                    + ') - construct PhysicsSystem with a larger maxContacts');
                            }
                            this.contactA[this.contactCount] = i;
                            this.contactB[this.contactCount] = j;
                            this.contactCount++;
                        }
                    }
                }
            }
        }
        return this.contactCount;
    }
    // Drain the contact buffer: push every still-overlapping pair apart
    // along its minimum-translation axis. `iterations` relaxation passes
    // run over the SAME fixed contact set (it does NOT re-run broadphase
    // - new overlaps a push creates are caught by next step's detect()).
    // Returns the number of push-apart operations applied across all
    // iterations.
    //
    // Gate 1: every pair re-reads posX / posY / halfW / halfH FRESH, so
    // a push applied to an earlier pair is seen by a later pair sharing
    // a collider - no position is cached across a move. A pair that an
    // earlier push already separated is re-checked and skipped. A STATIC
    // collider is never moved; two dynamics split the correction; a
    // dynamic vs a static takes the whole correction.
    resolve(iterations = 1) {
        if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_RESOLVE_ITERATIONS) {
            throw new RangeError('PhysicsSystem.resolve: iterations must be an integer in [1, ' + MAX_RESOLVE_ITERATIONS
                + '], got ' + iterations);
        }
        let pushes = 0;
        for (let iter = 0; iter < iterations; iter++) {
            for (let cc = 0; cc < this.contactCount; cc++) {
                const a = this.contactA[cc] ?? 0;
                const b = this.contactB[cc] ?? 0;
                const fa = this.flags[a] ?? 0;
                const fb = this.flags[b] ?? 0;
                // A collider recycled since detect() is no longer resolvable.
                if ((fa & COLLIDER_FLAG_ACTIVE) === 0 || (fb & COLLIDER_FLAG_ACTIVE) === 0)
                    continue;
                // Gate 1: fresh reads, every pair, every iteration.
                const ax = this.posX[a] ?? 0;
                const ay = this.posY[a] ?? 0;
                const bx = this.posX[b] ?? 0;
                const by = this.posY[b] ?? 0;
                const dx = bx - ax;
                const dy = by - ay;
                const adx = dx < 0 ? -dx : dx;
                const ady = dy < 0 ? -dy : dy;
                const overlapX = ((this.halfW[a] ?? 0) + (this.halfW[b] ?? 0)) - adx;
                const overlapY = ((this.halfH[a] ?? 0) + (this.halfH[b] ?? 0)) - ady;
                // An earlier push this iteration may have already separated
                // this pair - re-check on the fresh positions.
                if (overlapX <= 0 || overlapY <= 0)
                    continue;
                const aStatic = (fa & COLLIDER_FLAG_STATIC) !== 0;
                const bStatic = (fb & COLLIDER_FLAG_STATIC) !== 0;
                // Two immovable colliders cannot be separated - leave them.
                if (aStatic && bStatic)
                    continue;
                // Push along the axis of least penetration (minimum
                // translation vector). A tie resolves on Y - deterministic.
                if (overlapX < overlapY) {
                    // dx >= 0: b is to the right of a (or coincident) - push b
                    // right, a left. The dx === 0 tie picks +x - deterministic.
                    const dir = dx >= 0 ? 1 : -1;
                    if (aStatic) {
                        this.posX[b] = bx + dir * overlapX;
                    }
                    else if (bStatic) {
                        this.posX[a] = ax - dir * overlapX;
                    }
                    else {
                        const half = overlapX * 0.5;
                        this.posX[a] = ax - dir * half;
                        this.posX[b] = bx + dir * half;
                    }
                }
                else {
                    const dir = dy >= 0 ? 1 : -1;
                    if (aStatic) {
                        this.posY[b] = by + dir * overlapY;
                    }
                    else if (bStatic) {
                        this.posY[a] = ay - dir * overlapY;
                    }
                    else {
                        const half = overlapY * 0.5;
                        this.posY[a] = ay - dir * half;
                        this.posY[b] = by + dir * half;
                    }
                }
                this.positionsDirty = true;
                pushes++;
            }
        }
        return pushes;
    }
    // The canonical per-frame pipeline, equivalent to
    //   integrate(dt); syncGrid(grid); detect(grid); resolve(iterations)
    // dt must be a finite number >= 0; iterations defaults to 1.
    step(dt, grid, iterations = 1) {
        if (!Number.isFinite(dt) || dt < 0) {
            throw new RangeError('PhysicsSystem.step: dt must be a finite number >= 0, got ' + dt);
        }
        this.integrate(dt);
        this.syncGrid(grid);
        const contacts = this.detect(grid);
        const resolved = this.resolve(iterations);
        return { contacts: contacts, resolved: resolved };
    }
    // The slot of contact `index`'s lower-id collider. Bounds-checked
    // against the live contact count.
    getContactA(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.contactCount) {
            throw new RangeError('PhysicsSystem.getContactA: index ' + index + ' out of [0, ' + this.contactCount + ')');
        }
        return this.contactA[index] ?? -1;
    }
    // The slot of contact `index`'s higher-id collider. Bounds-checked
    // against the live contact count.
    getContactB(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.contactCount) {
            throw new RangeError('PhysicsSystem.getContactB: index ' + index + ' out of [0, ' + this.contactCount + ')');
        }
        return this.contactB[index] ?? -1;
    }
    // Reset to the constructed-but-empty state.
    clear() {
        this.posX.fill(0);
        this.posY.fill(0);
        this.halfW.fill(0);
        this.halfH.fill(0);
        this.velX.fill(0);
        this.velY.fill(0);
        this.flags.fill(0);
        this.generation.fill(0);
        this.contactCount = 0;
        this.activeCount = 0;
        this.maxColliderExtent = 0;
        this.positionsDirty = false;
        this.lastSyncGrid = null;
        this.lastSyncEpoch = 0;
    }
}
//# sourceMappingURL=physics-system.js.map