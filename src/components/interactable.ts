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
import { growF32, growU8, nextPow2 } from '../util/typed-arrays.js';

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

export class InteractablePool {
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
}

export const POOL_INTERACTABLE = 'interactable';
