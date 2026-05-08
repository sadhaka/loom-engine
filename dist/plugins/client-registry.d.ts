import { type IClientPlugin, type PluginStorage, type PluginLogger, type PluginOpsStats, type PluginDescribeRow, type PeerInfo, type EmittedEvents } from './types.js';
import type { ZoneEvent, ZoneEventEnvelope, ZoneBossSpec, ZoneBossOutcome } from '../director/zone/zone-event-envelope.js';
export declare class MapPluginStorage implements PluginStorage {
    private data;
    get(key: string): Promise<unknown | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    resetForTest(): void;
    size(): number;
}
export declare class ConsolePluginLogger implements PluginLogger {
    private readonly pluginName;
    constructor(pluginName: string);
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
    private write;
}
export declare function setWithTtl(storage: PluginStorage, key: string, value: unknown, ttlMs: number, nowFn?: () => number): Promise<void>;
export declare function getWithTtlCheck(storage: PluginStorage, key: string, nowFn?: () => number): Promise<unknown | undefined>;
export interface ClientPluginRegistryOptions {
    now?: () => number;
    getZonePeers?: (zoneId: string) => ReadonlyArray<PeerInfo>;
    getZoneState?: (zoneId: string) => ReadonlyMap<string, unknown>;
    getZoneEventsTail?: (zoneId: string, n: number) => ReadonlyArray<ZoneEvent>;
    eventTarget?: EventTarget | null;
    eventPrefixes?: ReadonlyArray<string>;
}
export declare class ClientPluginRegistry {
    private plugins;
    private storageByName;
    private loggersByName;
    private statsByName;
    private readonly opts;
    private bridgedHandlers;
    constructor(options?: ClientPluginRegistryOptions);
    private attachBridge;
    private detachBridge;
    register(plugin: IClientPlugin): void;
    unregister(name: string): Promise<boolean>;
    reload(name: string, moduleSpecifier?: string, exportName?: string): Promise<PluginDescribeRow | null>;
    list(): ReadonlyArray<IClientPlugin>;
    get(name: string): IClientPlugin | undefined;
    resetForTest(): Promise<void>;
    describe(): PluginDescribeRow[];
    private makeCtx;
    private safeCall;
    private withTimeout;
    private normalizeEmitted;
    private dispatch;
    dispatchZoneEvent(envelope: ZoneEventEnvelope): Promise<EmittedEvents>;
    dispatchPreTick(): Promise<EmittedEvents>;
    dispatchPostTick(): Promise<EmittedEvents>;
    dispatchBossSpawn(zoneId: string, boss: ZoneBossSpec): Promise<EmittedEvents>;
    dispatchBossEnd(zoneId: string, bossId: string, outcome: ZoneBossOutcome): Promise<EmittedEvents>;
    dispatchLootDrop(zoneId: string, bossId: string, items: ReadonlyArray<unknown>): Promise<EmittedEvents>;
    dispose(): Promise<void>;
    private errorMeta;
    statsFor(name: string): PluginOpsStats | undefined;
}
//# sourceMappingURL=client-registry.d.ts.map