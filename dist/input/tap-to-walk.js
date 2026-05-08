// TapToWalkSystem - converts a single quick canvas tap into a
// world-tile target the game can walk to.
//
// Touch lifecycle:
//   - Multi-touch is ignored entirely. A second active touch cancels
//     the in-flight tap candidate so two-finger gestures (zoom, pan)
//     don't accidentally drop a walk target.
//   - A "tap" is a single touch whose start/end happen within
//     `maxFrames` frames AND whose end position is within
//     `moveThresholdPx` of its start position.
//   - On a confirmed tap, the system computes the world-tile target
//     by inverting the iso projection: canvas pixel -> camera/iso
//     space via screenToWorld, then iso -> tile via isoToTile.
//
// Cancellation:
//   - Any held WASD or Arrow key clears the target on the same frame
//     it appears in keysHeld. This is how a manual D-pad press
//     ("press up to keep walking") cancels an old tap-to-walk goal.
//
// The target is published to RESOURCE_TAP_WALK as a small mutable
// resource: { x, y, active, frameSet }. Consumers (the player-move
// system) read it each tick. The system never owns the player entity
// or the movement logic - it just publishes the target.
import { RESOURCE_INPUT } from './input-manager.js';
import { RESOURCE_TIME, RESOURCE_CAMERA } from '../resources.js';
import { screenToWorld } from '../renderer/camera.js';
import { isoToTile } from '../renderer/iso-projection.js';
export const RESOURCE_TAP_WALK = 'tap_walk';
export function createTapWalkTarget() {
    return { x: 0, y: 0, active: false, frameSet: -1 };
}
const CANCEL_KEYS = [
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
];
export class TapToWalkSystem {
    name = 'tap-to-walk';
    inFlight = null;
    moveThresholdSq;
    maxFrames;
    // Scratch vectors so per-frame iso math doesn't allocate.
    scratchA = { x: 0, y: 0 };
    scratchB = { x: 0, y: 0 };
    constructor(opts = {}) {
        const px = opts.moveThresholdPx ?? 12;
        this.moveThresholdSq = px * px;
        this.maxFrames = opts.maxFrames ?? 30;
    }
    update(world, _dt) {
        const input = world.resources.get(RESOURCE_INPUT);
        if (!input)
            return;
        const time = world.resources.require(RESOURCE_TIME);
        const target = world.resources.get(RESOURCE_TAP_WALK);
        if (!target)
            return;
        // Manual movement (keyboard or D-pad-injected WASD) cancels any
        // pending walk target.
        for (const code of CANCEL_KEYS) {
            if (input.keysHeld.has(code)) {
                target.active = false;
                this.inFlight = null;
                return;
            }
        }
        // Multi-touch -> abort tap candidacy. Two-finger gestures should
        // never resolve to a walk command.
        if (input.touches.length > 1) {
            this.inFlight = null;
            return;
        }
        // Track the first touchstart of an idle frame.
        if (this.inFlight === null && input.touchesStartedThisFrame.length > 0) {
            const t = input.touchesStartedThisFrame[0];
            this.inFlight = {
                id: t.id,
                startX: t.x,
                startY: t.y,
                startFrame: time.frame,
            };
        }
        // Resolve on touchend matching the in-flight id.
        if (this.inFlight !== null) {
            for (const ended of input.touchesEndedThisFrame) {
                if (ended.id !== this.inFlight.id)
                    continue;
                const dx = ended.x - this.inFlight.startX;
                const dy = ended.y - this.inFlight.startY;
                const distSq = dx * dx + dy * dy;
                const frames = time.frame - this.inFlight.startFrame;
                if (distSq <= this.moveThresholdSq && frames <= this.maxFrames) {
                    this.publishTarget(world, target, ended.x, ended.y, time.frame);
                }
                this.inFlight = null;
                break;
            }
        }
    }
    publishTarget(world, target, canvasPxX, canvasPxY, frame) {
        const camera = world.resources.get(RESOURCE_CAMERA);
        if (!camera)
            return;
        // Canvas pixel -> iso (camera) space.
        screenToWorld(camera, canvasPxX, canvasPxY, this.scratchA);
        // Iso -> world tile.
        isoToTile(this.scratchA.x, this.scratchA.y, this.scratchB);
        target.x = this.scratchB.x;
        target.y = this.scratchB.y;
        target.active = true;
        target.frameSet = frame;
    }
    // Test helper: clear any in-flight tap candidate. Mostly used by
    // tests that want to drive the system through state transitions.
    resetInFlight() {
        this.inFlight = null;
    }
}
//# sourceMappingURL=tap-to-walk.js.map