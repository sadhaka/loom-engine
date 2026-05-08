export declare const COMPONENT_SIGNATURE_MAX_BIT: number;
export declare function componentMask(...bits: number[]): number;
export declare class ComponentSignature {
    private masks;
    private cap;
    private versionValue;
    constructor(initialCapacity?: number);
    ensureCapacity(idx: number): void;
    setBit(entityIdx: number, bit: number): void;
    clearBit(entityIdx: number, bit: number): void;
    clearEntity(entityIdx: number): void;
    getMask(entityIdx: number): number;
    hasAll(entityIdx: number, mask: number): boolean;
    hasAny(entityIdx: number, mask: number): boolean;
    version(): number;
    collectMatching(mask: number): Int32Array;
    capacity(): number;
}
export declare const RESOURCE_COMPONENT_SIGNATURE = "loom.component_signature";
//# sourceMappingURL=component-signature.d.ts.map