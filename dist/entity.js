// Entity allocator for the Loom Engine ECS.
//
// An entity is a 32-bit handle: high 8 bits = generation, low 24
// bits = index. The generation guards against use-after-free: when
// an entity is destroyed and its index is recycled, the generation
// bumps so old handles fail validation.
//
// Inspired by the standard ECS sparse-set pattern (see PRIOR-ART.md
// EnTT entry). Re-implemented from scratch.
export const NULL_ENTITY = 0;
const INDEX_MASK = 0x00ffffff;
const GENERATION_SHIFT = 24;
const GENERATION_MASK = 0xff;
export function entityIndex(e) {
    return e & INDEX_MASK;
}
export function entityGeneration(e) {
    return (e >>> GENERATION_SHIFT) & GENERATION_MASK;
}
export function makeEntity(index, generation) {
    return ((generation & GENERATION_MASK) << GENERATION_SHIFT) | (index & INDEX_MASK);
}
export class EntityAllocator {
    // Generation array indexed by entity index. Index 0 is reserved
    // for NULL_ENTITY so live indices start at 1.
    generations = new Uint8Array(64);
    freeList = [];
    // Next never-used index. Always >= 1.
    nextFresh = 1;
    liveCount = 0;
    create() {
        let index;
        const recycled = this.freeList.pop();
        if (recycled !== undefined) {
            index = recycled;
        }
        else {
            index = this.nextFresh++;
            if (index >= this.generations.length) {
                const next = new Uint8Array(index * 2);
                next.set(this.generations);
                this.generations = next;
            }
        }
        this.liveCount++;
        const gen = this.generations[index] ?? 0;
        return makeEntity(index, gen);
    }
    destroy(e) {
        const index = entityIndex(e);
        const gen = entityGeneration(e);
        if (index === 0 || index >= this.nextFresh)
            return false;
        const currentGen = this.generations[index] ?? 0;
        if (currentGen !== gen)
            return false; // stale handle
        this.generations[index] = (currentGen + 1) & GENERATION_MASK;
        this.freeList.push(index);
        this.liveCount--;
        return true;
    }
    isAlive(e) {
        const index = entityIndex(e);
        if (index === 0 || index >= this.nextFresh)
            return false;
        return (this.generations[index] ?? 0) === entityGeneration(e);
    }
    count() {
        return this.liveCount;
    }
    // Highest live entity index + 1. Used by component pools to size
    // their backing arrays.
    capacity() {
        return this.nextFresh;
    }
}
//# sourceMappingURL=entity.js.map