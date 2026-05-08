import type { IAIPlugin, EmittedEvents, PluginContext, PeerInfo, PlayerAction } from './plugin.js';
export declare class AIPluginDuplicateError extends Error {
    readonly pluginName: string;
    constructor(pluginName: string);
}
export declare class AIPluginRegistry {
    private plugins;
    register(plugin: IAIPlugin): void;
    unregister(name: string): Promise<boolean>;
    list(): ReadonlyArray<IAIPlugin>;
    get(name: string): IAIPlugin | undefined;
    dispatchTick(ctx: PluginContext): Promise<EmittedEvents>;
    dispatchPeerJoin(ctx: PluginContext, peer: PeerInfo): Promise<EmittedEvents>;
    dispatchPeerLeave(ctx: PluginContext, peer: PeerInfo): Promise<EmittedEvents>;
    dispatchZoneEnter(ctx: PluginContext, peer: PeerInfo, fromZone: string | null): Promise<EmittedEvents>;
    dispatchPlayerAction(ctx: PluginContext, peer: PeerInfo, action: PlayerAction): Promise<EmittedEvents>;
    private dispatch;
    private errorMeta;
}
//# sourceMappingURL=ai-plugin-registry.d.ts.map