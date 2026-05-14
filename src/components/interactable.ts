// InteractablePool - per-entity flag marking the entity as something
// the player can interact with (talk, examine, use, transition).
//
// NPCs, portal tiles, lore stones, treasure chests all get an
// InteractableComponent. The InteractionSystem detects player clicks
// or proximity-key-press and dispatches the configured action.
//
// Layout: kind (tag for routing), prompt (label shown when in range),
// payload (free-form data for the action handler). For Phase 8 v1
// the payload is just a string id that the demo's action handler
// switches on; future versions may extend to action functions.

import { type EntityId, entityIndex } from '../entity.js';
import { growF32, growU8, nextPow2, tightenHighWaterMark } from '../util/typed-arrays.js';
import type { ISnapshotable, SnapshotWriter, SnapshotReader } from '../runtime/state-snapshot.js';

export const INTERACTABLE_FLAG_ACTIVE = 1 << 0;

export type InteractableKind = 'npc' | 'portal' | 'lore' | 'item';

export interface InteractableConfig {
  kind: InteractableKind;
  // Short label shown when the player is in range. Examples:
  // 'Talk to Misha Dev', 'Enter Iron Reach', 'Read the stone'.
  prompt: string;
  // Free-form id the action handler routes on. For NPCs, the dialog
  // line id. For portals, the destination zone id. For lore, the
  // text id.
  payload: string;
  // Interaction radius in world tile units. Player must be this
  // close (or click within this distance) to trigger.
  radius: number;
}

export class InteractablePool implements ISnapshotable {
  // Hot
  radius: Float32Array;

  // Cold (per-entity strings)
  kind: InteractableKind[];
  prompt: string[];
  payload: string[];

  flags: Uint8Array;

  private capacity: number = 0;
  private highWaterMark: number = 0;

  constructor(initialCapacity: number = 32) {
    this.capacity = nextPow2(initialCapacity);
    this.radius = new Float32Array(this.capacity);
    this.kind = new Array<InteractableKind>(this.capacity).fill('npc');
    this.prompt = new Array<string>(this.capacity).fill('');
    this.payload = new Array<string>(this.capacity).fill('');
    this.flags = new Uint8Array(this.capacity);
  }

  ensureCapacity(neededIndex: number): void {
    if (neededIndex < this.capacity) return;
    const next = nextPow2(neededIndex + 1);
    this.radius = growF32(this.radius, next);
    this.kind.length = next;
    this.prompt.length = next;
    this.payload.length = next;
    for (let i = this.capacity; i < next; i++) {
      this.kind[i] = 'npc';
      this.prompt[i] = '';
      this.payload[i] = '';
    }
    this.flags = growU8(this.flags, next);
    this.capacity = next;
  }

  attach(e: EntityId, cfg: InteractableConfig): void {
    const i = entityIndex(e);
    this.ensureCapacity(i);
    this.radius[i] = cfg.radius;
    this.kind[i] = cfg.kind;
    this.prompt[i] = cfg.prompt;
    this.payload[i] = cfg.payload;
    this.flags[i] = INTERACTABLE_FLAG_ACTIVE;
    if (i >= this.highWaterMark) this.highWaterMark = i + 1;
  }

  detach(e: EntityId): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    this.flags[i] = 0;
  }

  isActive(e: EntityId): boolean {
    const i = entityIndex(e);
    if (i >= this.capacity) return false;
    return ((this.flags[i] ?? 0) & INTERACTABLE_FLAG_ACTIVE) !== 0;
  }

  getPrompt(e: EntityId): string {
    const i = entityIndex(e);
    if (i >= this.capacity) return '';
    return this.prompt[i] ?? '';
  }

  getKind(e: EntityId): InteractableKind {
    const i = entityIndex(e);
    if (i >= this.capacity) return 'npc';
    return this.kind[i] ?? 'npc';
  }

  getPayload(e: EntityId): string {
    const i = entityIndex(e);
    if (i >= this.capacity) return '';
    return this.payload[i] ?? '';
  }

  getHighWaterMark(): number { return this.highWaterMark; }
  getCapacity(): number { return this.capacity; }

  // Lower highWaterMark past trailing detached slots. INTERACTABLE_-
  // FLAG_ACTIVE is set by attach and cleared only by detach.
  tighten(): void {
    this.highWaterMark = tightenHighWaterMark(this.flags, this.highWaterMark);
  }

  // --- ISnapshotable: the radius column, the three string columns,
  // and flags - all [0, highWaterMark). ---

  readonly snapshotKey: string = 'loom.interactable-pool';

  snapshotInto(w: SnapshotWriter): void {
    const n = this.highWaterMark;
    w.writeU32(n);
    w.writeF32Slice(this.radius, n);
    // The string columns are plain arrays with no self-describing
    // slice writer, so n (written above) is the count for all three.
    for (let i = 0; i < n; i++) w.writeString(this.kind[i] ?? 'npc');
    for (let i = 0; i < n; i++) w.writeString(this.prompt[i] ?? '');
    for (let i = 0; i < n; i++) w.writeString(this.payload[i] ?? '');
    w.writeU8Slice(this.flags, n);
  }

  restoreFrom(r: SnapshotReader): void {
    const n = r.readU32();
    this.radius = r.readF32Slice();
    // Read order mirrors snapshotInto's write order exactly.
    this.kind = new Array<InteractableKind>(n);
    // Our own format: readString returns string; the kind column is
    // the narrower InteractableKind union.
    for (let i = 0; i < n; i++) this.kind[i] = r.readString() as InteractableKind;
    this.prompt = new Array<string>(n);
    for (let i = 0; i < n; i++) this.prompt[i] = r.readString();
    this.payload = new Array<string>(n);
    for (let i = 0; i < n; i++) this.payload[i] = r.readString();
    this.flags = r.readU8Slice();
    // Match TransformPool: a restored pool is exactly-sized, capacity
    // == highWaterMark, and grows via nextPow2 on the next attach.
    this.capacity = n;
    this.highWaterMark = n;
  }
}

export const POOL_INTERACTABLE = 'interactable';
