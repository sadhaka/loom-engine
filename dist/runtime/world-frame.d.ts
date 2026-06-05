import type { Ruleset, SerializedMutation } from './world-epoch.js';
import { Pcg32 } from './pcg32.js';
import type { WorldState } from './world-state-snapshot.js';
export declare function deriveFramePrng(worldId: string, frameNumber: number): Pcg32;
export interface PlayerCommand {
    playerId: string;
    seq: number;
    actionId: string;
    targetId?: string;
}
export type PlayerEntityMap = Record<string, string>;
export interface SerializedFrameMutation extends SerializedMutation {
}
export type FrameActionEntry = {
    player_id: string;
    actor_id: string;
    action_id: string;
    degree: string;
    mutations_applied: SerializedMutation[];
} | {
    player_id: string;
    action_id: string;
    reason: string;
};
export interface FrameResolvedEvent {
    event_type: 'FrameResolved';
    frame_number: number;
    commands_processed: FrameActionEntry[];
    pcg_steps_consumed: number;
}
export interface TickFrameInput {
    worldId: string;
    state: WorldState;
    frameNumber: number;
    commands: PlayerCommand[];
    ruleset: Ruleset;
    playerEntities: PlayerEntityMap;
    maxCommandsPerPlayer?: number | undefined;
    maxCommands?: number | undefined;
}
export interface TickFrameResult {
    state: WorldState;
    event: FrameResolvedEvent;
    resolved: number;
    rejected: number;
}
export declare function tickFrame(input: TickFrameInput): TickFrameResult;
export interface FrameReconcileInput {
    worldId: string;
    correctedState: WorldState;
    commandsByFrame: Record<string, PlayerCommand[]>;
    toFrame: number;
    ruleset: Ruleset;
    playerEntities: PlayerEntityMap;
    maxCommandsPerPlayer?: number | undefined;
    maxCommands?: number | undefined;
}
export interface FrameReconcileResult {
    state: WorldState;
    events: FrameResolvedEvent[];
    framesReplayed: number;
}
export declare function reconcileFrames(input: FrameReconcileInput): FrameReconcileResult;
export declare var RESOURCE_WORLD_FRAME: string;
//# sourceMappingURL=world-frame.d.ts.map