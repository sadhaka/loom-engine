// LoomDecay - procedural material entropy: a chunked, time-sliced
// material-fatigue pool that decays materials toward phase changes
// (Wood -> RottenWood -> ...) and eventual recycling.
//
// The Trinity dossier's section 22 (Gemini Volume II). The §22 sketch
// was a 10-line stub: applyDecay() decremented a counter with
// Math.random() and a meaningless Atomics call. Math.random() is a
// hard determinism-gate violation (the engine ships a no-nondeterminism
// tripwire that scans src/), so this takes a seeded IEntropy instead -
// the same PRNG the rest of the simulation runs on, so a decay run is
// bit-identical from a given seed.
//
// LoomDecay owns its material pool. Storage is flat typed arrays:
//   matType       Uint16  per slot - the material type (caller-defined)
//   matFatigue    Uint16  per slot - decay progress, clamped to MAX
//   matFlags      Uint8   per slot - bit 0 = ACTIVE
//   matGeneration Uint8   per slot - bumped on recycle (handle guard)
// A MaterialHandle packs (generation, slot) the way an EntityId packs
// (generation, index), so a handle to a recycled slot fails validation.
//
// The 7 Codex gates, enforced:
//   1. typed-array material storage (above); weather is not read here -
//      the caller passes environmentalFactor, derived from whatever
//      weather model it has.
//   2. active-bit + generation validation - every handle-based read
//      (isAlive / getType / getFatigue) checks the ACTIVE bit and the
//      handle's generation against the slot.
//   3. simulation-owner command buffer for phase changes - applyDecay
//      advances the fatigue counter directly but NEVER changes a
//      material's type in place: a threshold crossing emits a
//      phase-change command; commit() drains the buffer.
//   4. transition table with reaction priority - the constructor takes
//      (fromType, fatigueThreshold, toType, priority, recycle) rules,
//      stored as typed-array columns; the highest-priority matching
//      rule wins.
//   5. clamp fatigue overflow + hibernated elapsed time - fatigue
//      clamps at MAX_FATIGUE; a chunk that was not decayed for several
//      ticks catches up, its (currentTick - lastDecayTick) >>> 0 frame
//      delta driving up to MAX_CATCHUP decay rolls (wrap-safe).
//   6. recycling is transactional + idempotent - a recycle command is
//      generation-validated on commit, so a stale command for a slot
//      that has since been recycled-and-reused is rejected; recycling
//      bumps the generation, which makes a re-applied recycle a no-op.
//   7. budget decay by chunks - applyDecay processes exactly one chunk;
//      the caller decides how many chunks to spend per frame.
const MATERIAL_FLAG_ACTIVE = 1 << 0;
// MaterialHandle layout, mirroring EntityId: low 24 bits slot, high 8
// bits generation.
const MATERIAL_INDEX_MASK = 0x00ffffff;
const MATERIAL_GENERATION_SHIFT = 24;
const MATERIAL_GENERATION_MASK = 0xff;
// Sanity caps on the constructor-derived sizes.
const MAX_CAPACITY = 1 << 18;
const MAX_RULES = 256;
// Uint16 ceiling - fatigue saturates here instead of wrapping.
const MAX_FATIGUE = 0xffff;
// Upper bound on hibernation catch-up decay rolls per material, so a
// long-hibernated chunk waking up cannot spike unboundedly.
const MAX_CATCHUP = 64;
const U32_MAX = 0xffffffff;
export function makeMaterialHandle(slot, generation) {
    return ((generation & MATERIAL_GENERATION_MASK) << MATERIAL_GENERATION_SHIFT)
        | (slot & MATERIAL_INDEX_MASK);
}
export function materialSlot(handle) {
    return handle & MATERIAL_INDEX_MASK;
}
export function materialGeneration(handle) {
    return (handle >>> MATERIAL_GENERATION_SHIFT) & MATERIAL_GENERATION_MASK;
}
export class LoomDecay {
    chunkCount;
    chunkSize;
    // chunkCount * chunkSize - the material-slot count.
    capacity;
    ruleCount;
    // Material pool columns (gate 1), indexed by slot.
    matType;
    matFatigue;
    matFlags;
    matGeneration;
    // Transition table columns (gate 4), indexed by rule.
    ruleFromType;
    ruleThreshold;
    ruleToType;
    rulePriority;
    ruleRecycle;
    // Phase-change command buffer (gate 3), indexed by command. Each
    // command captures the slot's generation at emit time so commit()
    // can reject a stale one (gate 6).
    cmdSlot;
    cmdGeneration;
    cmdToType;
    cmdRecycle;
    cmdCount = 0;
    // Per-chunk hibernation tracking (gate 5).
    lastDecayTick;
    chunkEverDecayed;
    activeCount = 0;
    constructor(chunkCount, chunkSize, transitionRules) {
        if (!Number.isInteger(chunkCount) || chunkCount < 1) {
            throw new RangeError('LoomDecay: chunkCount must be a positive integer, got ' + chunkCount);
        }
        if (!Number.isInteger(chunkSize) || chunkSize < 1) {
            throw new RangeError('LoomDecay: chunkSize must be a positive integer, got ' + chunkSize);
        }
        const capacity = chunkCount * chunkSize;
        if (capacity > MAX_CAPACITY) {
            throw new RangeError('LoomDecay: chunkCount * chunkSize = ' + capacity + ' exceeds the cap ' + MAX_CAPACITY);
        }
        if (!Array.isArray(transitionRules) || transitionRules.length > MAX_RULES) {
            throw new RangeError('LoomDecay: transitionRules must be an array of at most ' + MAX_RULES + ' rules');
        }
        this.chunkCount = chunkCount;
        this.chunkSize = chunkSize;
        this.capacity = capacity;
        this.ruleCount = transitionRules.length;
        this.matType = new Uint16Array(capacity);
        this.matFatigue = new Uint16Array(capacity);
        this.matFlags = new Uint8Array(capacity);
        this.matGeneration = new Uint8Array(capacity);
        this.ruleFromType = new Uint16Array(this.ruleCount);
        this.ruleThreshold = new Uint16Array(this.ruleCount);
        this.ruleToType = new Uint16Array(this.ruleCount);
        this.rulePriority = new Int32Array(this.ruleCount);
        this.ruleRecycle = new Uint8Array(this.ruleCount);
        for (let r = 0; r < this.ruleCount; r++) {
            const rule = transitionRules[r];
            if (rule === undefined
                || !Number.isInteger(rule.fromType) || rule.fromType < 0 || rule.fromType > 0xffff
                || !Number.isInteger(rule.fatigueThreshold) || rule.fatigueThreshold < 0 || rule.fatigueThreshold > MAX_FATIGUE
                || !Number.isInteger(rule.toType) || rule.toType < 0 || rule.toType > 0xffff
                || !Number.isInteger(rule.priority) || rule.priority < -0x80000000 || rule.priority > 0x7fffffff
                || typeof rule.recycle !== 'boolean') {
                throw new RangeError('LoomDecay: transitionRules[' + r + '] is malformed');
            }
            this.ruleFromType[r] = rule.fromType;
            this.ruleThreshold[r] = rule.fatigueThreshold;
            this.ruleToType[r] = rule.toType;
            this.rulePriority[r] = rule.priority;
            this.ruleRecycle[r] = rule.recycle ? 1 : 0;
        }
        this.cmdSlot = new Int32Array(capacity);
        this.cmdGeneration = new Uint8Array(capacity);
        this.cmdToType = new Uint16Array(capacity);
        this.cmdRecycle = new Uint8Array(capacity);
        this.lastDecayTick = new Uint32Array(chunkCount);
        this.chunkEverDecayed = new Uint8Array(chunkCount);
    }
    // Phase-change commands queued but not yet applied by commit().
    getCommandCount() {
        return this.cmdCount;
    }
    // Currently-active (spawned, not recycled) material count.
    getActiveMaterialCount() {
        return this.activeCount;
    }
    // Activate `slot` as a fresh material of `type` (fatigue 0). Throws
    // if the slot is already active - recycle it first. Returns a
    // generation-stamped handle.
    spawn(slot, type) {
        if (!Number.isInteger(slot) || slot < 0 || slot >= this.capacity) {
            throw new RangeError('LoomDecay.spawn: slot ' + slot + ' out of [0, ' + this.capacity + ')');
        }
        if (!Number.isInteger(type) || type < 0 || type > 0xffff) {
            throw new RangeError('LoomDecay.spawn: type ' + type + ' must be a u16 integer');
        }
        if (((this.matFlags[slot] ?? 0) & MATERIAL_FLAG_ACTIVE) !== 0) {
            throw new Error('LoomDecay.spawn: slot ' + slot + ' is already active - recycle it first');
        }
        this.matType[slot] = type;
        this.matFatigue[slot] = 0;
        this.matFlags[slot] = (this.matFlags[slot] ?? 0) | MATERIAL_FLAG_ACTIVE;
        this.activeCount++;
        return makeMaterialHandle(slot, this.matGeneration[slot] ?? 0);
    }
    // True if `handle` still refers to a live material - the slot is
    // active and its generation matches the handle (gate 2).
    isAlive(handle) {
        const slot = materialSlot(handle);
        if (slot >= this.capacity)
            return false;
        if (((this.matFlags[slot] ?? 0) & MATERIAL_FLAG_ACTIVE) === 0)
            return false;
        return (this.matGeneration[slot] ?? 0) === materialGeneration(handle);
    }
    // The material's type, or -1 if the handle is stale / dead.
    getType(handle) {
        if (!this.isAlive(handle))
            return -1;
        return this.matType[materialSlot(handle)] ?? -1;
    }
    // The material's fatigue, or -1 if the handle is stale / dead.
    getFatigue(handle) {
        if (!this.isAlive(handle))
            return -1;
        return this.matFatigue[materialSlot(handle)] ?? -1;
    }
    // Immediately recycle a material: free its slot and bump the
    // generation so existing handles to it stop validating. The
    // caller-initiated counterpart to spawn(); decay-driven recycling
    // goes through the command buffer instead. Returns false if the
    // handle was already stale / dead.
    recycle(handle) {
        if (!this.isAlive(handle))
            return false;
        const slot = materialSlot(handle);
        this.freeSlot(slot);
        return true;
    }
    // Decay one chunk. environmentalFactor is the per-frame decay
    // probability (clamped to [0, 1]); currentTick drives the
    // hibernation catch-up; entropy is the simulation's seeded PRNG -
    // never Math.random(). Fatigue is advanced in place; a material
    // that crosses a transition threshold has a phase-change command
    // queued (apply it with commit()). Throws if the command buffer
    // fills - commit() between decay cycles.
    applyDecay(chunkId, environmentalFactor, currentTick, entropy) {
        if (!Number.isInteger(chunkId) || chunkId < 0 || chunkId >= this.chunkCount) {
            throw new RangeError('LoomDecay.applyDecay: chunkId ' + chunkId + ' out of [0, ' + this.chunkCount + ')');
        }
        if (!Number.isFinite(environmentalFactor)) {
            throw new RangeError('LoomDecay.applyDecay: environmentalFactor must be finite, got ' + environmentalFactor);
        }
        if (!Number.isInteger(currentTick) || currentTick < 0 || currentTick > U32_MAX) {
            throw new RangeError('LoomDecay.applyDecay: currentTick must be an integer in [0, ' + U32_MAX + ']');
        }
        let factor = environmentalFactor;
        if (factor < 0)
            factor = 0;
        else if (factor > 1)
            factor = 1;
        // Hibernation catch-up: a chunk not decayed for several ticks
        // catches up, its wrap-safe frame delta driving extra decay rolls.
        let elapsed;
        if ((this.chunkEverDecayed[chunkId] ?? 0) === 0) {
            elapsed = 1;
            this.chunkEverDecayed[chunkId] = 1;
        }
        else {
            elapsed = (currentTick - (this.lastDecayTick[chunkId] ?? 0)) >>> 0;
        }
        this.lastDecayTick[chunkId] = currentTick;
        const catchup = elapsed > MAX_CATCHUP ? MAX_CATCHUP : elapsed;
        let decayed = 0;
        let transitioned = 0;
        const base = chunkId * this.chunkSize;
        for (let i = 0; i < this.chunkSize; i++) {
            const slot = base + i;
            if (((this.matFlags[slot] ?? 0) & MATERIAL_FLAG_ACTIVE) === 0)
                continue;
            let decaySteps = 0;
            for (let step = 0; step < catchup; step++) {
                if (entropy.random() < factor)
                    decaySteps++;
            }
            if (decaySteps === 0)
                continue;
            decayed++;
            let nextFatigue = (this.matFatigue[slot] ?? 0) + decaySteps;
            if (nextFatigue > MAX_FATIGUE)
                nextFatigue = MAX_FATIGUE;
            this.matFatigue[slot] = nextFatigue;
            const ruleIdx = this.findTransition(this.matType[slot] ?? 0, nextFatigue);
            if (ruleIdx >= 0) {
                this.emitCommand(slot, this.matGeneration[slot] ?? 0, this.ruleToType[ruleIdx] ?? 0, (this.ruleRecycle[ruleIdx] ?? 0) === 1);
                transitioned++;
            }
        }
        return { decayed, transitioned };
    }
    // Apply every queued phase-change command, then clear the buffer.
    // Each command is generation-validated against its slot (gate 6):
    // a stale command - the slot was recycled and reused since the
    // command was emitted - is rejected. A transition resets fatigue
    // and changes the type; a recycle frees the slot and bumps its
    // generation.
    commit() {
        let applied = 0;
        let rejected = 0;
        for (let c = 0; c < this.cmdCount; c++) {
            const slot = this.cmdSlot[c] ?? 0;
            const gen = this.cmdGeneration[c] ?? 0;
            if ((this.matGeneration[slot] ?? 0) !== gen
                || ((this.matFlags[slot] ?? 0) & MATERIAL_FLAG_ACTIVE) === 0) {
                rejected++;
                continue;
            }
            if ((this.cmdRecycle[c] ?? 0) === 1) {
                this.freeSlot(slot);
            }
            else {
                this.matType[slot] = this.cmdToType[c] ?? 0;
                this.matFatigue[slot] = 0;
            }
            applied++;
        }
        this.cmdCount = 0;
        return { applied, rejected };
    }
    // Reset to the constructed-but-empty state.
    clear() {
        this.matType.fill(0);
        this.matFatigue.fill(0);
        this.matFlags.fill(0);
        this.matGeneration.fill(0);
        this.lastDecayTick.fill(0);
        this.chunkEverDecayed.fill(0);
        this.cmdCount = 0;
        this.activeCount = 0;
    }
    // --- private ---
    // Free a slot: clear ACTIVE, bump the generation so old handles
    // stop validating, and reset the columns. Used by both recycle()
    // and a committed recycle command.
    freeSlot(slot) {
        this.matFlags[slot] = (this.matFlags[slot] ?? 0) & ~MATERIAL_FLAG_ACTIVE;
        this.matGeneration[slot] = ((this.matGeneration[slot] ?? 0) + 1) & MATERIAL_GENERATION_MASK;
        this.matType[slot] = 0;
        this.matFatigue[slot] = 0;
        this.activeCount--;
    }
    // The highest-priority transition rule that fires for a material of
    // `type` at `fatigue`, or -1 if none.
    findTransition(type, fatigue) {
        let best = -1;
        let bestPriority = 0;
        for (let r = 0; r < this.ruleCount; r++) {
            if ((this.ruleFromType[r] ?? 0) !== type)
                continue;
            if (fatigue < (this.ruleThreshold[r] ?? 0))
                continue;
            const priority = this.rulePriority[r] ?? 0;
            if (best === -1 || priority > bestPriority) {
                best = r;
                bestPriority = priority;
            }
        }
        return best;
    }
    // Queue a phase-change command. Throws if the buffer is full - the
    // caller must commit() between decay cycles.
    emitCommand(slot, generation, toType, recycle) {
        if (this.cmdCount >= this.capacity) {
            throw new Error('LoomDecay: phase-change command buffer full - call commit() between decay cycles');
        }
        this.cmdSlot[this.cmdCount] = slot;
        this.cmdGeneration[this.cmdCount] = generation;
        this.cmdToType[this.cmdCount] = toType;
        this.cmdRecycle[this.cmdCount] = recycle ? 1 : 0;
        this.cmdCount++;
    }
}
//# sourceMappingURL=loom-decay.js.map