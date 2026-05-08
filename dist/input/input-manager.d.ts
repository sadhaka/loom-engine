export interface PointerSnapshot {
    x: number;
    y: number;
    buttons: number;
    inside: boolean;
}
export interface TouchPoint {
    id: number;
    x: number;
    y: number;
}
export interface InputSnapshot {
    keysHeld: ReadonlySet<string>;
    keysPressedThisFrame: ReadonlySet<string>;
    keysReleasedThisFrame: ReadonlySet<string>;
    pointer: Readonly<PointerSnapshot>;
    pointerPressedThisFrame: number;
    pointerReleasedThisFrame: number;
    wheelDeltaThisFrame: number;
    touches: ReadonlyArray<TouchPoint>;
    touchesStartedThisFrame: ReadonlyArray<TouchPoint>;
    touchesEndedThisFrame: ReadonlyArray<TouchPoint>;
}
export declare class InputManager {
    private keysHeld;
    private keysPressedAccum;
    private keysReleasedAccum;
    private pointer;
    private pointerPressedAccum;
    private pointerReleasedAccum;
    private wheelDeltaAccum;
    private activeTouches;
    private touchesStartedAccum;
    private touchesEndedAccum;
    private currentKeysPressed;
    private currentKeysReleased;
    private currentPointerPressed;
    private currentPointerReleased;
    private currentWheelDelta;
    private currentTouchesStarted;
    private currentTouchesEnded;
    private cachedTouchesArray;
    private cachedSnapshot;
    private boundKeyDown;
    private boundKeyUp;
    private boundPointerMove;
    private boundPointerDown;
    private boundPointerUp;
    private boundPointerEnter;
    private boundPointerLeave;
    private boundWheel;
    private boundTouchStart;
    private boundTouchMove;
    private boundTouchEnd;
    private boundTouchCancel;
    private boundContextMenu;
    private canvas;
    private targetWindow;
    private attached;
    constructor();
    attach(canvas: HTMLCanvasElement, win?: Window): void;
    detach(): void;
    beginFrame(): void;
    snapshot(): InputSnapshot;
    injectKeyDown(code: string): void;
    injectKeyUp(code: string): void;
    injectPointerMove(x: number, y: number, buttons: number, inside?: boolean): void;
    injectPointerDown(buttonsBit: number): void;
    injectPointerUp(buttonsBit: number): void;
    injectTouchStart(id: number, x: number, y: number): void;
    injectTouchMove(id: number, x: number, y: number): void;
    injectTouchEnd(id: number, x: number, y: number): void;
    private onKeyDown;
    private onKeyUp;
    private updatePointerFromEvent;
    private onPointerMove;
    private onPointerDown;
    private onPointerUp;
    private onPointerEnter;
    private onPointerLeave;
    private onWheel;
    private updateTouchPoint;
    private onTouchStart;
    private onTouchMove;
    private onTouchEnd;
    private onTouchCancel;
    private onContextMenu;
}
export declare const RESOURCE_INPUT_MANAGER = "input_manager";
export declare const RESOURCE_INPUT = "input";
//# sourceMappingURL=input-manager.d.ts.map