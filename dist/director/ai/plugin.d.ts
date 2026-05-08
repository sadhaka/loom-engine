import type { DirectorEvent } from '../event-envelope.js';
import type { ZoneEvent } from '../zone/zone-event-envelope.js';
export type { ZoneEvent };
export interface EmittedEvents {
    characterEvents?: DirectorEvent[];
    zoneEvents?: ZoneEvent[];
}
export interface PeerInfo {
    characterId: string;
    userId: string;
    zone: string;
    x: number;
    y: number;
    name: string | null;
}
export interface PlayerAction {
    kind: 'damage' | 'interact' | 'speak' | 'use_item' | (string & {});
    payload: Record<string, unknown>;
}
export interface CharacterState {
    characterId: string;
    zone: string;
    x: number;
    y: number;
    hp_current: number;
    hp_max: number;
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
    getCharacterState(characterId: string): Readonly<CharacterState>;
    getZoneState(zoneId: string): ReadonlyMap<string, unknown>;
    storage: PluginStorage;
    logger: PluginLogger;
    now: () => number;
}
export interface IAIPlugin {
    readonly name: string;
    readonly version: string;
    readonly priority: number;
    onTick?(ctx: PluginContext): Promise<EmittedEvents>;
    onPeerJoin?(ctx: PluginContext, peer: PeerInfo): Promise<EmittedEvents>;
    onPeerLeave?(ctx: PluginContext, peer: PeerInfo): Promise<EmittedEvents>;
    onZoneEnter?(ctx: PluginContext, peer: PeerInfo, fromZone: string | null): Promise<EmittedEvents>;
    onPlayerAction?(ctx: PluginContext, peer: PeerInfo, action: PlayerAction): Promise<EmittedEvents>;
    dispose?(): Promise<void>;
}
//# sourceMappingURL=plugin.d.ts.map