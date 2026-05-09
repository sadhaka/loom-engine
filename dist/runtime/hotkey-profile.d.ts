export interface KeyBinding {
    action: string;
    key: string;
}
export interface HotKeyProfile {
    id: string;
    name: string;
    bindings: KeyBinding[];
    inherits?: string;
}
export interface HotKeyProfileManagerOptions {
    initialProfiles?: HotKeyProfile[];
    active?: string;
}
export interface HotKeyProfileSnapshot {
    activeId: string | null;
    profiles: HotKeyProfile[];
}
export declare class HotKeyProfileManager {
    private profiles;
    private activeId;
    private disposed;
    private constructor();
    static create(opts?: HotKeyProfileManagerOptions): HotKeyProfileManager;
    registerProfile(profile: HotKeyProfile): boolean;
    unregisterProfile(id: string): boolean;
    has(id: string): boolean;
    get(id: string): HotKeyProfile | null;
    list(): HotKeyProfile[];
    setActive(id: string): boolean;
    getActive(): string | null;
    resolveAction(action: string): string | null;
    resolveActionFor(profileId: string, action: string): string | null;
    setBinding(profileId: string, action: string, key: string): boolean;
    removeBinding(profileId: string, action: string): boolean;
    toSnapshot(): HotKeyProfileSnapshot;
    fromSnapshot(snap: HotKeyProfileSnapshot): void;
    size(): number;
    dispose(): void;
}
export declare const RESOURCE_HOTKEY_PROFILE = "hotkey_profile";
//# sourceMappingURL=hotkey-profile.d.ts.map