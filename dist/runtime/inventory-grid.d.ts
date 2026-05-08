export interface InventorySlot {
    itemId: string;
    count: number;
}
export interface ItemInfo {
    maxStack?: number;
}
export interface InventoryGridOptions {
    capacity: number;
    itemInfo?: (itemId: string) => ItemInfo;
    onChanged?: (slotIndex: number) => void;
}
export interface AddResult {
    added: number;
    overflow: number;
}
export declare class InventoryGrid {
    private slots;
    private capacityNum;
    private itemInfoFn;
    private onChanged;
    private disposed;
    private constructor();
    static create(opts: InventoryGridOptions): InventoryGrid;
    capacity(): number;
    occupiedCount(): number;
    freeSlots(): number;
    getSlot(index: number): InventorySlot | null;
    has(itemId: string): boolean;
    totalOf(itemId: string): number;
    add(itemId: string, count?: number): AddResult;
    remove(itemId: string, count?: number): number;
    takeSlot(index: number): InventorySlot | null;
    move(from: number, to: number): boolean;
    clear(): void;
    toSnapshot(): Array<InventorySlot | null>;
    fromSnapshot(snap: ReadonlyArray<InventorySlot | null>): void;
    dispose(): void;
    private maxStackOf;
    private fireChanged;
}
export declare const RESOURCE_INVENTORY_GRID = "inventory_grid";
//# sourceMappingURL=inventory-grid.d.ts.map