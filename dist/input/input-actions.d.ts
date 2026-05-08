export declare class InputActions {
    private actions;
    private keyToActions;
    private keyDownCount;
    private keyUpCount;
    bind(action: string, keys: string | string[]): void;
    unbind(action: string, keys?: string | string[]): void;
    handleKeyDown(key: string): boolean;
    handleKeyUp(key: string): boolean;
    releaseAll(): void;
    isActive(action: string): boolean;
    wasJustPressed(action: string): boolean;
    wasJustReleased(action: string): boolean;
    update(): void;
    keysFor(action: string): string[];
    actionNames(): string[];
    clear(): void;
    stats(): {
        actions: number;
        keysBound: number;
        keyDownEvents: number;
        keyUpEvents: number;
    };
    private ensureAction;
}
export declare const RESOURCE_INPUT_ACTIONS = "loom.input_actions";
//# sourceMappingURL=input-actions.d.ts.map