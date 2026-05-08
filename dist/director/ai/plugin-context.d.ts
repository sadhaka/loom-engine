import type { PluginContext, PluginLogger, PluginStorage, PeerInfo, CharacterState } from './plugin.js';
export declare class MapPluginStorage {
    private readonly store;
    forPlugin(pluginName: string): PluginStorage;
    clearPlugin(pluginName: string): void;
    size(): number;
    private composeKey;
}
export declare class ConsolePluginLogger implements PluginLogger {
    private readonly pluginName;
    constructor(pluginName: string);
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
    private write;
}
export interface BuildPluginContextOptions {
    pluginName: string;
    storage: MapPluginStorage;
    logger?: PluginLogger;
    getZonePeers?: (zoneId: string) => ReadonlyArray<PeerInfo>;
    getCharacterState?: (characterId: string) => Readonly<CharacterState>;
    getZoneState?: (zoneId: string) => ReadonlyMap<string, unknown>;
    now?: () => number;
}
export declare function buildPluginContext(opts: BuildPluginContextOptions): PluginContext;
//# sourceMappingURL=plugin-context.d.ts.map