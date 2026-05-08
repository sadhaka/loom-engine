export interface StateConfig {
    onEnter?: (from: string | null) => void;
    onExit?: (to: string) => void;
    onUpdate?: (dtMs: number) => void;
}
export interface StateMachineOptions {
    initial: string;
    states: Record<string, StateConfig>;
    transitions?: Record<string, string[]>;
    fireInitialEnter?: boolean;
    onTransition?: (from: string, to: string) => void;
}
export declare class StateMachine {
    private states;
    private transitions;
    private current;
    private onTransition;
    private disposed;
    private constructor();
    static create(opts: StateMachineOptions): StateMachine;
    state(): string;
    is(name: string): boolean;
    has(name: string): boolean;
    canTransition(name: string): boolean;
    transition(name: string): boolean;
    update(dtMs: number): void;
    forceState(name: string): boolean;
    stateNames(): string[];
    dispose(): void;
    private fireEnter;
}
export declare const RESOURCE_STATE_MACHINE = "state_machine";
//# sourceMappingURL=state-machine.d.ts.map