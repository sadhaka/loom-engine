// SpatialAudioSystem - pushes the local character's transform into
// the AudioListener resource and the SpatialAudioBus each frame.
//
// Phasing rationale (matches PeerRenderSystem / animation-system):
//   PHASE_RENDER, AFTER any camera/transform sync systems, BEFORE
//   the renderer submits draw calls. The listener pose for THIS frame
//   reflects the THIS-FRAME world transform of the player - so a
//   positional sound triggered by a render-phase system (e.g. cue
//   reactions to zone events drained earlier in PHASE_LOGIC) hears
//   the world from the up-to-date listener pose.
//
// Per LOOM-AUDIO-SPEC.md §3.3 the work is one-line: read the local
// character's TransformPool entry by entity id, write its (x, y, z)
// into the AudioListenerResource.pose, stamp lastUpdateFrame, and
// hand the pose to SpatialAudioBus.setListener.
//
// Identity binding: the engine doesn't know which entity is the local
// character - that's a consumer concern (TWT wires it after server
// auth completes). Consumers call setLocalCharacterEntity(entity) on
// the system. setLocalCharacterEntity(null) puts the system back into
// no-op mode (e.g. between zones during a teleport).
//
// Tolerates:
//   - missing AudioListenerResource (silent no-op; engine probably
//     not yet fully wired)
//   - missing SpatialAudioBus (silent no-op; consumer might have
//     opted out of spatial audio entirely - the system still keeps
//     the resource fresh for debug/HUD readers)
//   - missing TransformPool (silent no-op; engine without ECS
//     transforms is unusual but valid in headless server tests)
//   - local character set but transform not attached yet (no-op)
//
// What this system does NOT do (deferred to future phases):
//   - rotate the listener with the player's facing (spec §8.4 fixes
//     forward = (0, 0, -1))
//   - apply velocity-based Doppler (PannerNode.setVelocity is
//     deprecated; v1 ships flat doppler-off audio)
//   - any per-source position update (handle.setPosition owns that)

import type { System } from '../system.js';
import type { World } from '../world.js';
import type { EntityId } from '../entity.js';
import { entityIndex } from '../entity.js';
import { POOL_TRANSFORM } from '../world.js';
import type { TransformPool } from '../components/transform.js';
import {
  RESOURCE_TIME,
  type TimeResource,
} from '../resources.js';
import {
  RESOURCE_AUDIO_LISTENER,
  type AudioListenerResource,
} from './audio-listener-resource.js';
import type { SpatialAudioBus } from './spatial-audio-bus.js';

export class SpatialAudioSystem implements System {
  readonly name: string = 'spatial-audio';

  private localCharacter: EntityId | null = null;
  private spatialBus: SpatialAudioBus | null = null;

  // Optional spatial bus reference. The system can also work without
  // a bus (resource-only mode) - useful for tests and for consumers
  // who do not want positional audio but still want a tracked listener
  // pose (e.g. for visual SFX triggered relative to the player).
  constructor(opts: { spatialBus?: SpatialAudioBus } = {}) {
    this.spatialBus = opts.spatialBus ?? null;
  }

  // Wire (or rewire) the spatial bus. Useful when the AudioBus is
  // created lazily after first user gesture - the system can be
  // registered upfront and the bus attached later.
  setSpatialBus(bus: SpatialAudioBus | null): void {
    this.spatialBus = bus;
  }

  // Bind the local character entity. null means "no local character"
  // (e.g. mid-teleport, character not yet allocated, headless mode).
  // The system tolerates an entity that doesn't have a transform yet
  // by silently skipping the update.
  setLocalCharacterEntity(entity: EntityId | null): void {
    this.localCharacter = entity;
  }

  getLocalCharacterEntity(): EntityId | null {
    return this.localCharacter;
  }

  update(world: World, _dt: number): void {
    if (this.localCharacter === null) return;
    var listener = world.resources.get<AudioListenerResource>(RESOURCE_AUDIO_LISTENER);
    if (!listener) return;

    var transforms = world.getPool<TransformPool>(POOL_TRANSFORM);
    if (!transforms) return;
    var idx = entityIndex(this.localCharacter);
    // Bounds check against the high-water mark so a fresh entity that
    // the consumer registered before attaching a transform doesn't
    // produce undefined reads on the typed arrays.
    if (idx >= transforms.getHighWaterMark()) return;

    var x = transforms.x[idx] ?? 0;
    var y = transforms.y[idx] ?? 0;
    var z = transforms.z[idx] ?? 0;

    listener.pose.x = x;
    listener.pose.y = y;
    listener.pose.z = z;

    var time = world.resources.get<TimeResource>(RESOURCE_TIME);
    listener.lastUpdateFrame = time ? time.frame : listener.lastUpdateFrame + 1;

    if (this.spatialBus) {
      this.spatialBus.setListener(listener.pose);
    }
  }
}
