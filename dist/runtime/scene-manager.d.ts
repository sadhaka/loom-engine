export interface SceneConfig {
    onEnter?: (params?: unknown) => void | Promise<void>;
    onExit?: () => void | Promise<void>;
    onUpdate?: (dtMs: number) => void;
}
export type SceneStatus = 'idle' | 'entering' | 'active' | 'exiting';
export interface SceneManagerOptions {
    onSceneEntered?: (name: string) => void;
    onSceneExited?: (name: string) => void;
    onTransitionStart?: (from: string | null, to: string) => void;
    onTransitionError?: (to: string, error: unknown) => void;
}
export declare class SceneManager {
    private scenes;
    private currentName;
    private status;
    private opts;
    private disposed;
    private constructor();
    static create(opts?: SceneManagerOptions): SceneManager;
    register(name: string, scene: SceneConfig): void;
    unregister(name: string): boolean;
    has(name: string): boolean;
    current(): string | null;
    getStatus(): SceneStatus;
    isTransitioning(): boolean;
    sceneNames(): string[];
    transitionTo(name: string, params?: unknown): Promise<string>;
    update(dtMs: number): void;
    leave(): Promise<void>;
    dispose(): void;
}
export declare const RESOURCE_SCENE_MANAGER = "scene_manager";
//# sourceMappingURL=scene-manager.d.ts.map