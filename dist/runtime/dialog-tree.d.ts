export interface DialogChoice {
    label: string;
    next: string;
    if?: string;
    do?: string;
    data?: Record<string, unknown>;
}
export interface DialogNode {
    text: string;
    choices: DialogChoice[];
    onEnter?: string;
}
export type Predicate = (data?: Record<string, unknown>) => boolean;
export type Action = (data?: Record<string, unknown>) => void;
export interface DialogTreeOptions {
    start: string;
    nodes: Record<string, DialogNode>;
    predicates?: Record<string, Predicate>;
    actions?: Record<string, Action>;
    onEnd?: () => void;
}
export declare class DialogTree {
    private nodes;
    private predicates;
    private actions;
    private startNode;
    private currentNode;
    private onEnd;
    private disposed;
    private constructor();
    static create(opts: DialogTreeOptions): DialogTree;
    start(): void;
    currentId(): string | null;
    current(): DialogNode | null;
    isActive(): boolean;
    visibleChoices(): DialogChoice[];
    choose(index: number): boolean;
    end(): void;
    setPredicate(name: string, fn: Predicate): void;
    setAction(name: string, fn: Action): void;
    dispose(): void;
    private fireOnEnter;
}
export declare const RESOURCE_DIALOG_TREE = "dialog_tree";
//# sourceMappingURL=dialog-tree.d.ts.map