import { InputManager } from './input-manager.js';
export type DpadDirection = 'up' | 'down' | 'left' | 'right';
export interface VirtualDpadOptions {
    inputManager: InputManager;
    parent?: HTMLElement;
    document?: Document;
    visible?: boolean;
    onPress?: (dir: DpadDirection) => void;
}
export declare class VirtualDpad {
    private opts;
    private root;
    private buttons;
    private mounted;
    private visible;
    constructor(opts: VirtualDpadOptions);
    static detectTouchSupport(win?: Window): boolean;
    isMounted(): boolean;
    isVisible(): boolean;
    mount(): void;
    unmount(): void;
    pressDirection(dir: DpadDirection, touchId?: number): void;
    releaseDirection(dir: DpadDirection, touchId?: number): void;
    pressedTouchCount(dir: DpadDirection): number;
    private requireButton;
    private buildButton;
    private spacer;
    private deadzone;
    private styleRoot;
    private styleGrid;
    private styleButton;
    private attachListeners;
}
//# sourceMappingURL=virtual-dpad.d.ts.map