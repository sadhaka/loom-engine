import type { ZoneEvent, ZoneEventEnvelope, ZoneBossSpec, ZoneBossOutcome } from '../director/zone/zone-event-envelope.js';
export type { ZoneEvent, ZoneEventEnvelope, ZoneBossSpec, ZoneBossOutcome };
export declare class PluginError extends Error {
    readonly code: string;
    readonly retryable: boolean;
    pluginName: string;
    readonly original: unknown;
    constructor(code: string, retryable?: boolean, pluginName?: string, original?: unknown);
}
export interface IPluginEntropy {
    random(): number;
    pick<T>(items: ReadonlyArray<T>): T | null;
    intRange(low: number, highInclusive: number): number;
}
export declare class PluginEntropy implements IPluginEntropy {
    private state;
    constructor(seed?: number | null);
    random(): number;
    pick<T>(items: ReadonlyArray<T>): T | null;
    intRange(low: number, highInclusive: number): number;
}
export interface PeerInfo {
    characterId: string;
    userId: string;
    zone: string;
    x: number;
    y: number;
    name: string | null;
}
export interface EmittedEvents {
    zoneEvents?: ZoneEvent[];
}
export interface PluginStorage {
    get(key: string): Promise<unknown | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
}
export interface PluginLogger {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
}
export interface PluginContext {
    getZonePeers(zoneId: string): ReadonlyArray<PeerInfo>;
    getZoneState(zoneId: string): ReadonlyMap<string, unknown>;
    getZoneEventsTail(zoneId: string, n: number): ReadonlyArray<ZoneEvent>;
    storage: PluginStorage;
    logger: PluginLogger;
    now(): number;
    peersInRadius(zoneId: string, x: number, y: number, radius: number): ReadonlyArray<PeerInfo>;
    nearestPeer(zoneId: string, x: number, y: number): {
        peer: PeerInfo;
        distance: number;
    } | null;
    entropy(seed?: number | null): IPluginEntropy;
}
export declare const ALL_SCOPES: readonly ["read_zones", "read_characters", "read_events"];
export type PluginScope = typeof ALL_SCOPES[number];
export declare const DEFAULT_PLUGIN_STORAGE_MAX_BYTES: number;
export declare const DEFAULT_PLUGIN_TICK_BUDGET_MS: number;
export interface IClientPlugin {
    readonly name: string;
    readonly version: string;
    readonly priority: number;
    readonly requiresProtocol?: string;
    readonly supersedesPlugins?: ReadonlyArray<string>;
    readonly tags?: ReadonlyArray<string>;
    readonly description?: string;
    readonly tickBudgetMs?: number;
    readonly storageMaxBytes?: number;
    readonly requiredScopes?: ReadonlyArray<PluginScope>;
    onZoneEvent?(ctx: PluginContext, envelope: ZoneEventEnvelope): Promise<EmittedEvents | void>;
    onPreTick?(ctx: PluginContext): Promise<EmittedEvents | void>;
    onPostTick?(ctx: PluginContext): Promise<EmittedEvents | void>;
    onBossSpawn?(ctx: PluginContext, zoneId: string, boss: ZoneBossSpec): Promise<EmittedEvents | void>;
    onBossEnd?(ctx: PluginContext, zoneId: string, bossId: string, outcome: ZoneBossOutcome): Promise<EmittedEvents | void>;
    onLootDrop?(ctx: PluginContext, zoneId: string, bossId: string, items: ReadonlyArray<unknown>): Promise<EmittedEvents | void>;
    dispose?(): Promise<void> | void;
}
export interface PluginOpsStats {
    storage_set_count: number;
    storage_get_count: number;
    storage_delete_count: number;
    storage_bytes_used: number;
    storage_caps_rejected: number;
    hook_call_count: number;
    hook_timeout_count: number;
    hook_error_count: number;
    hook_retry_count: number;
}
export interface PluginDescribeRow {
    name: string;
    version: string;
    priority: number;
    requires_protocol: string;
    supersedes_plugins: string[];
    tags: string[];
    description: string;
    hooks: string[];
    tick_budget_ms: number;
    storage_max_bytes: number;
    scopes: string[];
    stats: PluginOpsStats;
}
//# sourceMappingURL=types.d.ts.map