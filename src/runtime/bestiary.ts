// Bestiary - the universal creature lifecycle kernel: a population
// of NPC creatures stored SoA with generational handles, ticked from
// a per-slot BehaviorTree, fed perception events from SonicSync,
// mood values from LoomPulse, AI decisions from InferenceOrchestrator
// for high-tier creatures, and prior-encounter bias from
// NarrativeMemory at spawn. Emits compact death FX events through a
// double-buffered ring so the render layer can read taxonomy events
// (BONE_SHATTER, SOUL_WISP_RISE, SIGIL_BURST, CYAN_DIVIDE_SPLIT_2,
// CHAMPION_COLLAPSE) without ever observing creature internals.
//
// The Trinity dossier Wave 2.1 candidate. The driving principle is
// that creature lifecycle is a *universal* primitive: every game
// mode that wants NPC mobs should pay <100 bytes per creature, hit
// the 14 Trinity kernels through one facade, and never write its
// own ad-hoc AI / spawn / death pipeline that leaks into engine code.
//
// FIXED-POINT WORLD COORDINATES. Positions, velocities, facing,
// mood, and progress are Q16.16 Int32 (16 integer bits, 16 fractional).
// One integer step is one engine world unit. This is the no-floats
// rule shared with SonicSync and LoomPulse - a replay is bit-for-bit
// identical regardless of FPU mode.
//
// SoA LAYOUT (gate 1). 13 typed arrays of length maxCreatures.
// Slot layout (one slot = 56 bytes):
//   posX,   posY,   posZ            Int32 Q16.16   12 bytes
//   velX,   velY                    Int32 Q16.16    8 bytes
//   hp                              Int32           4 bytes
//   action                          Uint8           1 byte
//   actionProgress                  Int32 Q16.16    4 bytes
//   facing                          Int32 Q16.16    4 bytes
//   targetHandle                    Int32           4 bytes
//   behaviorTreeStateIdx            Int32           4 bytes
//   moodValue                       Int32 Q16.16    4 bytes
//   inferenceRequestHandle          Int32           4 bytes
//   variantIdx                      Uint8           1 byte
//   lastPerceivedAt                 Uint32          4 bytes
//   generation                      Uint16          2 bytes
// Total 56 bytes per creature; for maxCreatures = 32 that is exactly
// 1,792 bytes of SoA - well inside the <100-bytes-per-creature gate.
// Per-slot BehaviorTree instances live OUTSIDE the SoA byte budget
// (one heap object per slot, ~1KB each). These are pre-allocated on
// first spawn into a given slot and disposed on despawn - never
// per-tick allocations.
//
// GENERATIONAL HANDLES (gate 2). Public API returns Int32 handles
// packed as (generation << 16) | slot. spawnCreature increments the
// slot's generation BEFORE returning; despawnCreature increments AGAIN
// so the old handle is doubly stale and any read returns CREATURE_-
// HANDLE_INVALID. 16-bit generation space wraps around 65536 spawns
// per slot, which at 1 spawn/sec is 18+ hours of unique handle space
// per slot - effectively unbounded for any session.
//
// DEFENSIVE DEGRADATION (gate 3). Every integration is optional and
// constructed with a single typed reference at kernel-init time. If
// SonicSync is absent the kernel simply skips perception drain; if
// LoomPulse is absent moodValue stays at zero; if InferenceOrchestrator
// is absent T3 creatures use only the fallback BT; if NarrativeMemory
// is absent the spawn bias query no-ops. The kernel never throws on
// integration absence - the entire tick path is bounded by integration
// presence checks.
//
// PRE-ALLOCATED BT POOL (gate 4). Per-slot BehaviorTree reference array
// sized to maxCreatures. The factory provided in the integrations
// instantiates a fresh tree on first spawn into that slot; subsequent
// spawns into the same slot reset the tree state. Tree disposal
// happens in despawnCreature - no tree heap thrash in tick().
//
// DOUBLE-BUFFERED DEATH FX RING (gate 5). Front / back rings of
// DEATH_FX_EVENT_STRIDE Int32 values each, swapped by tickEventBuffers
// every tick. The render layer reads the FRONT ring (consumer-stable
// for the duration of the frame) while the kernel writes into the
// BACK ring. Capacity is configurable; overflow increments
// deathFxEventsDroppedTotal as a caller-visible diagnostic.
//
// PERCEPTION EVENT DRAIN (gate 6). SonicSync events arrive as
// [sourceSlot, listenerSlot, semanticId, attenuation, distance,
// tickEmitted]. The kernel registers each creature as a SonicSync
// listener on spawn (storing the listener slot in
// sonicListenerSlot[creatureSlot]); on tickCreatures, drains the
// FRONT event ring and routes events whose listenerSlot maps back
// to one of our creatures into that creature's blackboard as
// 'perceivedSourceSlot', 'perceivedAttenuation', 'perceivedDistance'.
// Lookup is O(1) via sonicListenerOwner reverse-map.
//
// INFERENCE LANE ROUTING (gate 7). Variants declare inferenceLane in
// the catalog. 'none' (T1/T2) bypasses the orchestrator entirely.
// 'local_slm_consented' (reserved for future variants) routes to the
// LOCAL_SLM lane. 'cloud' (T3 First Standing) routes to CLOUD on
// spawn AND on combat phase change. The kernel submits the request;
// the consumer's deferred dispatcher does the actual LLM call and
// calls back via applyInferenceDecision so the kernel can update the
// blackboard for the next BT tick.
//
// NARRATIVE BIAS QUERY (gate 8). spawnCreature optionally calls
// narrativeMemory.recall(characterId, subjectId, { tags: ['death'] })
// with characterId = variantId and subjectId = playerId; if a prior
// death fact ranks above the bias threshold, the kernel pre-loads the
// creature's moodValue with an overconfidence / taunt stance. The
// integration is purely additive - no narrative-memory presence means
// every spawn starts at neutral mood.
//
// The 8 Trinity gates for Bestiary, enforced:
//   1. "SoA, no per-creature heap" - 13 typed-array columns; max 32
//      creatures = 1,792 bytes; constructor allocates everything; the
//      tick path makes zero allocations.
//   2. "generational handles validated at every cross-reference" -
//      public API uses (gen << 16) | slot; every read validates
//      generation against the slot's current generation column;
//      despawn double-increments so stale handles are doubly rejected.
//   3. "defensive degradation if subsystems absent" - every integration
//      is optional; tick path is bounded by presence checks; never
//      throws on absence.
//   4. "no BT instance heap thrash in tick" - per-slot pre-allocated
//      BT pool; instances are lazily constructed on first spawn into
//      slot and reset (not reconstructed) on subsequent spawns.
//   5. "death FX events double-buffered" - front / back rings; tick
//      swap; render reads previous tick's writes; overflow counted.
//   6. "perception drain is O(active) not O(N*M)" - SonicSync owns
//      the broad-phase; the kernel just resolves listenerSlot back to
//      creatureSlot via a reverse-map and pushes into the per-slot
//      blackboard. Drain bounded by events emitted, not creatures.
//   7. "inference budget respected per variant" - submitRequest is
//      called only for cloud-lane variants; the orchestrator's own
//      rate / token / TTL limits enforce the overall cap; the kernel
//      stores the request handle per slot and polls for completion.
//   8. "narrative bias is additive, not substitutive" - prior-death
//      recall biases initial moodValue; absence of a fact = neutral;
//      absence of NarrativeMemory = neutral. Never blocks spawn.
//
// Non-negotiable engine gates: no RNG; no wall clock - tickCreatures
// takes a dtMs parameter and tickEventBuffers takes a t parameter;
// every handle / slot / variantIdx / target bounds-checked; fixed-
// capacity storage; storage allocated once in the constructor.

import type {
  BTContext,
  BTNode,
  BTStatus,
} from './behavior-tree.js';
import { BehaviorTree } from './behavior-tree.js';
import type { InferenceOrchestrator } from './inference-orchestrator.js';
import {
  LANE_CLOUD,
  LANE_LOCAL_SLM,
  PRIORITY_HIGH,
  REQUEST_HANDLE_INVALID,
  REQUEST_STATE_NONE,
  REQUEST_STATE_INFLIGHT,
} from './inference-orchestrator.js';
import type { LoomPulse } from './loom-pulse.js';
import type { NarrativeMemory } from './narrative-memory.js';
import type { SonicSync } from './sonic-sync.js';
import {
  FP_ONE as SONIC_FP_ONE,
  PERCEPTION_EVENT_STRIDE,
} from './sonic-sync.js';

// Q16.16 fixed-point. BESTIARY_FP_ONE represents 1.0. The kernel
// shares numeric format with SonicSync and LoomPulse so positions /
// radii / mood values can pass through without scale conversions.
export const BESTIARY_FP_SHIFT = 16;
export const BESTIARY_FP_ONE = 1 << BESTIARY_FP_SHIFT; // 65536

// Tier silhouette principles. T1 fodder, T2 elite, T3 mini-boss,
// T4 boss, T5 raid. Phase 221 ships T1 / T2 / T3; T4 / T5 are
// reserved for future content.
export const TIER_FODDER = 1;
export const TIER_ELITE = 2;
export const TIER_MINIBOSS = 3;
export const TIER_BOSS = 4;
export const TIER_RAID = 5;

// Inference lane resolution. 'none' / 'local_slm_consented' / 'cloud'
// from the spec collapse to a uint8 routed by submitToLane.
export const INFERENCE_LANE_NONE = 0;
export const INFERENCE_LANE_LOCAL_SLM = 1;
export const INFERENCE_LANE_CLOUD = 2;

// Death FX taxonomy. Render layer interprets these codes and emits
// the corresponding particle / shader / cinematic.
export const DEATH_FX_NONE = 0;
export const DEATH_FX_BONE_SHATTER = 1;
export const DEATH_FX_SOUL_WISP_RISE = 2;
export const DEATH_FX_SIGIL_BURST = 3;
export const DEATH_FX_CYAN_DIVIDE_SPLIT_2 = 4;
export const DEATH_FX_CHAMPION_COLLAPSE = 5;

// Action enum. Mirrors the survivor-mobs.js sprite-state tags so the
// render layer's existing sprite.tick({action}) consumer maps without
// translation. Add new actions at the tail; never renumber.
export const CREATURE_ACTION_IDLE = 0;
export const CREATURE_ACTION_PATROL = 1;
export const CREATURE_ACTION_PURSUE = 2;
export const CREATURE_ACTION_WIND_UP = 3;
export const CREATURE_ACTION_SWING = 4;
export const CREATURE_ACTION_DRAW = 5;
export const CREATURE_ACTION_RELEASE = 6;
export const CREATURE_ACTION_CHANNEL = 7;
export const CREATURE_ACTION_TAUNT = 8;
export const CREATURE_ACTION_FLEE = 9;
export const CREATURE_ACTION_TAKE_DAMAGE = 10;
export const CREATURE_ACTION_DEAD = 11;

// Sentinel values.
export const CREATURE_HANDLE_INVALID = -1;
export const TARGET_HANDLE_NONE = -1;
export const VARIANT_IDX_INVALID = -1;

// Mood channels - resolve catalog strings to LoomPulse vibe ids. The
// CONSUMER decides the actual LoomPulse vibeId assignments; the kernel
// just uses the resolved index from the catalog spec. These constants
// document the canonical id space.
export const MOOD_AGITATION = 0;
export const MOOD_FEAR = 1;
export const MOOD_CAUTION = 2;
export const MOOD_BLOODLUST = 3;
export const MOOD_SORROW = 4;
export const MOOD_DOMINANCE = 5;
export const MOOD_INVALID = -1;

// Semantic IDs the kernel uses when registering creatures as SonicSync
// listeners. The default mask hears player footsteps, player attacks,
// and ally cries - the consumer can override via setListenerSemanticMask.
export const SONIC_SEMANTIC_PLAYER_FOOTSTEP = 1;
export const SONIC_SEMANTIC_PLAYER_ATTACK = 2;
export const SONIC_SEMANTIC_ALLY_DEATH = 3;
export const DEFAULT_LISTENER_SEMANTIC_MASK =
  (1 << SONIC_SEMANTIC_PLAYER_FOOTSTEP) |
  (1 << SONIC_SEMANTIC_PLAYER_ATTACK) |
  (1 << SONIC_SEMANTIC_ALLY_DEATH);

// Death FX event record stride. drainDeathFxEvent writes:
// [deathFxId, epicenterX, epicenterY, intensity, payloadHi, payloadLo, tickEmitted].
// 7 i32 per record. payload bytes carry split-spawn coords for
// CYAN_DIVIDE_SPLIT_2 (two Q16.16 packed) or 0 for fx without payload.
export const DEATH_FX_EVENT_STRIDE = 7;

// Sanity caps. A bad config throws a clear RangeError rather than
// trying to allocate an absurd typed array.
const MAX_CREATURES = 1 << 12; // 4096
const MAX_DEATH_FX_CAPACITY = 1 << 14;
const MAX_TICK_DT_FP = 1 << 20; // ~16 seconds in Q16.16 ms
const U16_MAX = 0xffff;

// Default inference token budget per T3 spawn / phase change.
const DEFAULT_INFERENCE_TOKENS_PER_REQUEST = 256;
// Default inference TTL ticks (request canceled if dispatcher doesn't
// resolve within this window).
const DEFAULT_INFERENCE_TTL_TICKS = 600; // ~10 sec at 60 Hz
// Action type id the kernel registers with InferenceOrchestrator for
// T3 decisions. The consumer can override via setInferenceActionType.
const DEFAULT_INFERENCE_ACTION_TYPE = 0;
// Allowed result mask for the T3 decision - bits the LLM may set in
// the result. Catalog signatureBehaviors define semantics; this is
// just the bitmask the orchestrator validates against.
const DEFAULT_INFERENCE_ALLOWED_MASK = 0xffff;

// Audible signature scale factor. The catalog encodes audibleSignature
// in Q16.16 (freq = steps/sec * FP_ONE; intensity = 0..FP_ONE). The
// kernel converts intensity to the 0..255 SonicSync source byte by
// scaling and clamping at register time.
const SONIC_INTENSITY_BYTE_MAX = 255;

// The declarative catalog row authoring contract. Authors add a new
// creature by appending a CreatureSpec object to CREATURE_CATALOG.
// Adding a variant requires zero kernel code changes. Every field is
// validated at registration time (resolveCatalogIndex) so a malformed
// row fails loudly instead of silently miscomputing scale or palette.
export interface CreatureSpec {
  // Unique string identifier. Used as the spawn key from consumer code.
  id: string;
  // Localization key or display string.
  displayName: string;
  // Tier band 1..5 - drives silhouette scale + HUD treatment.
  tier: 1 | 2 | 3 | 4 | 5;
  // Q16.16 fp multiplier applied to base sprite size. 1.0x = 65536.
  sizeScale: number;
  // Bone palette enum / hex - resolved by the render layer's biome tinter.
  bonePalette: string;
  // Weapon class - drives render layer's hand/loadout selection.
  weaponClass: string;
  // BehaviorTree id - resolved to a factory by behaviorTreeFactory.
  behaviorTreeId: string;
  // Audible signature emitted as a SonicSync source on movement.
  audibleSignature: {
    // Steps per second in Q16.16 (e.g. 131072 = 2.0 steps/sec).
    freq: number;
    // Source intensity in Q16.16 [0, FP_ONE]; scaled to 0..255 byte.
    intensity: number;
  };
  // Listening radius in Q16.16 world units. Drives SonicSync listener
  // setup for this creature.
  perceptionRadius: number;
  // Mood channel - resolved to LoomPulse vibe id via moodChannelId.
  moodChannel: string;
  // Resolved numeric mood id (set at catalog init - do not hand-edit).
  moodChannelId: number;
  // Inference lane spec from blueprint - 'none' | 'local_slm_consented' | 'cloud'.
  inferenceLane: 'none' | 'local_slm_consented' | 'cloud';
  // Resolved numeric inference lane id (set at catalog init).
  inferenceLaneId: number;
  // Death FX taxonomy string - resolved to a numeric code.
  deathFxId: string;
  // Resolved numeric death fx code (set at catalog init).
  deathFxCode: number;
  // Array of behavior flags consumed by the BT factory.
  signatureBehaviors: string[];
  // Stat defaults applied at spawn. baseHp / baseDamage / baseXpVal
  // are Int32; baseSpeed (units per second in Q16.16) and baseRadius
  // (Q16.16 fp world units) are fp.
  baseHp: number;
  baseSpeed: number;
  baseDamage: number;
  baseRadius: number;
  baseXpVal: number;
}

// Resolve a mood-channel string from the spec to a LoomPulse vibe id.
function resolveMoodChannel(channel: string): number {
  if (channel === 'AGITATION') return MOOD_AGITATION;
  if (channel === 'FEAR') return MOOD_FEAR;
  if (channel === 'CAUTION') return MOOD_CAUTION;
  if (channel === 'BLOODLUST') return MOOD_BLOODLUST;
  if (channel === 'SORROW') return MOOD_SORROW;
  if (channel === 'DOMINANCE') return MOOD_DOMINANCE;
  return MOOD_INVALID;
}

// Resolve a death-fx string from the spec to a numeric code.
function resolveDeathFx(id: string): number {
  if (id === 'BONE_SHATTER') return DEATH_FX_BONE_SHATTER;
  if (id === 'SOUL_WISP_RISE') return DEATH_FX_SOUL_WISP_RISE;
  if (id === 'SIGIL_BURST') return DEATH_FX_SIGIL_BURST;
  if (id === 'CYAN_DIVIDE_SPLIT_2') return DEATH_FX_CYAN_DIVIDE_SPLIT_2;
  if (id === 'CHAMPION_COLLAPSE') return DEATH_FX_CHAMPION_COLLAPSE;
  return DEATH_FX_NONE;
}

// Resolve an inference-lane string from the spec to a numeric code.
function resolveInferenceLane(lane: string): number {
  if (lane === 'local_slm_consented') return INFERENCE_LANE_LOCAL_SLM;
  if (lane === 'cloud') return INFERENCE_LANE_CLOUD;
  return INFERENCE_LANE_NONE;
}

// The 6 skeleton variants for Phase 221 (Wave 2.1 candidate). Adding
// new families (Voidkind, Cultists, Beasts) requires only an append
// here plus a BT factory wired in behaviorTreeFactory.
//
// Numeric audible signatures are Q16.16: freq 131072 = 2.0 steps/sec;
// intensity 32768 = 0.5; perceptionRadius 655360 = 10 world units.
// Stats are tuned to the survivor inline defaults that this kernel
// replaces, scaled up modestly for the MMORPG-direction visual scale
// (T2 1.4x / T3 1.8x sizeScale, heavier baseHp on T3 to match the
// boss-tier silhouette).
//
// resolved* fields are populated by resolveCatalog() at module load.
const RAW_CREATURE_CATALOG: CreatureSpec[] = [
  {
    id: 'skel_warrior_t1',
    displayName: 'Skeleton Warrior',
    tier: 1,
    sizeScale: 65536, // 1.0x
    bonePalette: 'BONE_STANDARD',
    weaponClass: 'SWORD_SHIELD',
    behaviorTreeId: 'bt_skel_melee_aggro',
    audibleSignature: { freq: 131072, intensity: 32768 },
    perceptionRadius: 655360,
    moodChannel: 'AGITATION',
    moodChannelId: MOOD_INVALID,
    inferenceLane: 'none',
    inferenceLaneId: INFERENCE_LANE_NONE,
    deathFxId: 'BONE_SHATTER',
    deathFxCode: DEATH_FX_NONE,
    signatureBehaviors: ['SWING_ARC', 'CHARGE_ON_HIT'],
    baseHp: 16,
    baseSpeed: 111575, // 1.7 units/sec fp
    baseDamage: 8,
    baseRadius: 29491, // 0.45 fp
    baseXpVal: 2,
  },
  {
    id: 'skel_archer_t1',
    displayName: 'Skeleton Archer',
    tier: 1,
    sizeScale: 65536,
    bonePalette: 'BONE_STANDARD',
    weaponClass: 'BOW',
    behaviorTreeId: 'bt_skel_ranged_kite',
    audibleSignature: { freq: 98304, intensity: 16384 },
    perceptionRadius: 983040,
    moodChannel: 'FEAR',
    moodChannelId: MOOD_INVALID,
    inferenceLane: 'none',
    inferenceLaneId: INFERENCE_LANE_NONE,
    deathFxId: 'BONE_SHATTER',
    deathFxCode: DEATH_FX_NONE,
    signatureBehaviors: ['KITE_RETREAT', 'AIMED_SHOT'],
    baseHp: 10,
    baseSpeed: 98304, // 1.5 fp
    baseDamage: 7,
    baseRadius: 26214, // 0.40 fp
    baseXpVal: 3,
  },
  {
    id: 'skel_caster_t1',
    displayName: 'Skeleton Caster',
    tier: 1,
    sizeScale: 65536,
    bonePalette: 'BONE_ASH',
    weaponClass: 'STAFF',
    behaviorTreeId: 'bt_skel_magic_cautious',
    audibleSignature: { freq: 65536, intensity: 65535 },
    perceptionRadius: 786432,
    moodChannel: 'CAUTION',
    moodChannelId: MOOD_INVALID,
    inferenceLane: 'none',
    inferenceLaneId: INFERENCE_LANE_NONE,
    deathFxId: 'SOUL_WISP_RISE',
    deathFxCode: DEATH_FX_NONE,
    signatureBehaviors: ['HOMING_BOLT', 'HIDE_BEHIND_ALLY'],
    baseHp: 12,
    baseSpeed: 72090, // 1.1 fp
    baseDamage: 9,
    baseRadius: 27525, // 0.42 fp
    baseXpVal: 4,
  },
  {
    id: 'skel_reaver_t2',
    displayName: 'Bone Reaver',
    tier: 2,
    sizeScale: 91750, // ~1.4x
    bonePalette: 'BONE_CHARRED',
    weaponClass: 'DUAL_SCYTHE',
    behaviorTreeId: 'bt_skel_elite_reaver',
    audibleSignature: { freq: 163840, intensity: 65535 },
    perceptionRadius: 1310720,
    moodChannel: 'BLOODLUST',
    moodChannelId: MOOD_INVALID,
    inferenceLane: 'none',
    inferenceLaneId: INFERENCE_LANE_NONE,
    deathFxId: 'SIGIL_BURST',
    deathFxCode: DEATH_FX_NONE,
    signatureBehaviors: ['PIERCING_CHARGE', 'ALWAYS_AGGRO'],
    baseHp: 56,
    baseSpeed: 98304, // 1.5 fp
    baseDamage: 16,
    baseRadius: 42598, // 0.65 fp
    baseXpVal: 12,
  },
  {
    id: 'skel_choir_t2',
    displayName: 'Choir Skeleton',
    tier: 2,
    sizeScale: 65536, // 1.0x sprite, larger sigil aura via render
    bonePalette: 'BONE_CYAN_GLOW',
    weaponClass: 'NONE',
    behaviorTreeId: 'bt_skel_elite_summoner',
    audibleSignature: { freq: 32768, intensity: 65535 },
    perceptionRadius: 1310720,
    moodChannel: 'SORROW',
    moodChannelId: MOOD_INVALID,
    inferenceLane: 'none',
    inferenceLaneId: INFERENCE_LANE_NONE,
    deathFxId: 'CYAN_DIVIDE_SPLIT_2',
    deathFxCode: DEATH_FX_NONE,
    signatureBehaviors: ['WAIL_WAVE_ARC', 'SPLIT_ON_DEATH'],
    baseHp: 48,
    baseSpeed: 65536, // 1.0 fp
    baseDamage: 12,
    baseRadius: 40631, // 0.62 fp
    baseXpVal: 14,
  },
  {
    id: 'skel_first_standing_t3',
    displayName: 'First Standing',
    tier: 3,
    sizeScale: 117964, // ~1.8x
    bonePalette: 'BONE_GILDED',
    weaponClass: 'MASTER_ALL',
    behaviorTreeId: 'bt_skel_boss_fallback',
    audibleSignature: { freq: 196608, intensity: 65535 },
    perceptionRadius: 1966080,
    moodChannel: 'DOMINANCE',
    moodChannelId: MOOD_INVALID,
    inferenceLane: 'cloud',
    inferenceLaneId: INFERENCE_LANE_NONE,
    deathFxId: 'CHAMPION_COLLAPSE',
    deathFxCode: DEATH_FX_NONE,
    signatureBehaviors: ['STANCE_DANCE', 'NARRATIVE_TAUNT', 'PHASE_SHIFT'],
    baseHp: 320,
    baseSpeed: 78643, // 1.2 fp
    baseDamage: 28,
    baseRadius: 58981, // 0.9 fp
    baseXpVal: 80,
  },
];

// Resolve every catalog row's enum strings to numeric ids in place.
// Called once at module load. A spec with an unrecognised moodChannel
// or deathFxId silently resolves to MOOD_INVALID / DEATH_FX_NONE -
// the consumer can detect via isCatalogValid().
function resolveCatalog(): CreatureSpec[] {
  for (let i = 0; i < RAW_CREATURE_CATALOG.length; i++) {
    const spec = RAW_CREATURE_CATALOG[i];
    if (!spec) continue;
    spec.moodChannelId = resolveMoodChannel(spec.moodChannel);
    spec.deathFxCode = resolveDeathFx(spec.deathFxId);
    spec.inferenceLaneId = resolveInferenceLane(spec.inferenceLane);
  }
  return RAW_CREATURE_CATALOG;
}

export const CREATURE_CATALOG: ReadonlyArray<CreatureSpec> = resolveCatalog();

// Public catalog index lookup. Returns the variantIdx (slot into the
// catalog) for a given string id, or VARIANT_IDX_INVALID if unknown.
export function getVariantIndex(id: string): number {
  for (let i = 0; i < CREATURE_CATALOG.length; i++) {
    const spec = CREATURE_CATALOG[i];
    if (spec && spec.id === id) return i;
  }
  return VARIANT_IDX_INVALID;
}

// Public catalog spec lookup. Returns the read-only spec or null if
// the variantIdx is out of range.
export function getSpec(variantIdx: number): CreatureSpec | null {
  if (!Number.isInteger(variantIdx)) return null;
  if (variantIdx < 0 || variantIdx >= CREATURE_CATALOG.length) return null;
  return CREATURE_CATALOG[variantIdx] ?? null;
}

// Validate the resolved catalog - every spec's moodChannel and
// deathFxId must resolve to a known id. Used by tests + the consumer's
// init-time sanity check.
export function isCatalogValid(): boolean {
  for (let i = 0; i < CREATURE_CATALOG.length; i++) {
    const spec = CREATURE_CATALOG[i];
    if (!spec) return false;
    if (spec.moodChannelId === MOOD_INVALID) return false;
    if (spec.deathFxCode === DEATH_FX_NONE) return false;
  }
  return true;
}

// Generational handle helpers. The 32-bit Int is (gen << 16) | slot;
// slot is in [0, maxCreatures); generation wraps at 65536.
export function makeCreatureHandle(slot: number, generation: number): number {
  return (((generation & 0xffff) << 16) | (slot & 0xffff)) | 0;
}
export function creatureSlot(handle: number): number {
  return handle & 0xffff;
}
export function creatureGeneration(handle: number): number {
  return (handle >>> 16) & 0xffff;
}

// Kernel construction config.
export interface BestiaryConfig {
  // Maximum number of concurrent creatures. Default 32, max 4096.
  maxCreatures: number;
  // Death FX event ring capacity (per ring half - two rings allocated).
  // Default 64, max 16384.
  deathFxEventCapacity: number;
  // Hard cap on total inflight T3 inference requests. Tracked
  // independently of the orchestrator's own per-lane ceiling so the
  // kernel can refuse to submit if there is already too much pending
  // for the consumer's render layer to track. Default 1.
  maxSimultaneousInference?: number;
  // Tokens per inference request. Default 256.
  inferenceTokensPerRequest?: number;
  // Inference request TTL ticks. Default 600 (~10s at 60Hz).
  inferenceTtlTicks?: number;
  // Inference action type id the kernel registers with the orchestrator.
  // Defaults to 0; override if 0 is already in use.
  inferenceActionType?: number;
  // Allowed result mask. Defaults to 0xffff.
  inferenceAllowedResultMask?: number;
}

// Optional integration adapters. Each is null by default; presence
// gates the corresponding integration code path inside tickCreatures.
export interface BestiaryIntegrations {
  sonicSync?: SonicSync | null;
  loomPulse?: LoomPulse | null;
  inferenceOrchestrator?: InferenceOrchestrator | null;
  narrativeMemory?: NarrativeMemory | null;
  // Factory function: given a catalog variantIdx, returns the BT root
  // for that variant. The factory is called on first spawn into a
  // given slot; the kernel disposes / replaces the instance if a
  // later spawn into the same slot wants a different variant. Returns
  // null for variants the consumer hasn't authored a BT for - the
  // kernel falls back to CREATURE_ACTION_IDLE.
  behaviorTreeFactory?: ((variantIdx: number) => BTNode | null) | null;
}

// Per-slot blackboard keys the kernel writes before each tree.tick.
// BTs read these via ctx.blackboard.<key>. Document the contract so
// authored trees aren't tied to random key names.
export const BB_KEY_HP = 'hp';
export const BB_KEY_MAX_HP = 'maxHp';
export const BB_KEY_POS_X = 'posX';
export const BB_KEY_POS_Y = 'posY';
export const BB_KEY_FACING = 'facing';
export const BB_KEY_MOOD = 'mood';
export const BB_KEY_TARGET_HANDLE = 'targetHandle';
export const BB_KEY_TARGET_X = 'targetX';
export const BB_KEY_TARGET_Y = 'targetY';
export const BB_KEY_PERCEIVED_SOURCE = 'perceivedSource';
export const BB_KEY_PERCEIVED_DISTANCE = 'perceivedDistance';
export const BB_KEY_TICK_COUNT = 'tickCount';
export const BB_KEY_VARIANT_IDX = 'variantIdx';
// Per-slot blackboard keys the BT WRITES; the kernel reads them back
// after tree.tick to drive the SoA action / velocity columns.
export const BB_KEY_INTENT_ACTION = 'intentAction';
export const BB_KEY_INTENT_VEL_X = 'intentVelX';
export const BB_KEY_INTENT_VEL_Y = 'intentVelY';
export const BB_KEY_INTENT_FACING = 'intentFacing';
// Inference decision result, written by applyInferenceDecision and
// consumed by the BT root for T3 variants. Action enum.
export const BB_KEY_INFERENCE_DECISION = 'inferenceDecision';
// Initial bias from NarrativeMemory recall on spawn.
export const BB_KEY_BIAS_FROM_MEMORY = 'biasFromMemory';

const U32_MAX = 0xffffffff;

export class BestiaryKernel {
  readonly maxCreatures: number;
  readonly deathFxEventCapacity: number;
  readonly maxSimultaneousInference: number;
  readonly inferenceTokensPerRequest: number;
  readonly inferenceTtlTicks: number;
  readonly inferenceActionType: number;
  readonly inferenceAllowedResultMask: number;

  // SoA columns (gate 1).
  private readonly posX: Int32Array;
  private readonly posY: Int32Array;
  private readonly posZ: Int32Array;
  private readonly velX: Int32Array;
  private readonly velY: Int32Array;
  private readonly hp: Int32Array;
  private readonly maxHp: Int32Array;
  private readonly action: Uint8Array;
  private readonly actionProgress: Int32Array;
  private readonly facing: Int32Array;
  private readonly targetHandle: Int32Array;
  private readonly behaviorTreeStateIdx: Int32Array;
  private readonly moodValue: Int32Array;
  private readonly inferenceRequestHandle: Int32Array;
  private readonly variantIdx: Uint8Array;
  private readonly lastPerceivedAt: Uint32Array;
  private readonly generation: Uint16Array;
  // Auxiliary tracking (outside the per-creature byte budget).
  private readonly active: Uint8Array;
  // SonicSync listener slot the creature is registered as (or -1).
  private readonly sonicListenerSlot: Int32Array;
  // Per-slot pre-allocated BehaviorTree (or null until first spawn).
  private readonly behaviorTrees: Array<BehaviorTree | null>;
  // Per-slot blackboard, owned by the BT. The kernel writes input
  // keys / reads output keys via tree.setBlackboardEntry / get.
  // Stored separately so we can reset cheaply via clearSlot.

  // Free slot stack - LIFO so consecutive spawns reuse the most-
  // recently freed slot (better data-cache locality for spawn-heavy
  // workloads).
  private readonly freeSlotStack: Int32Array;
  private freeSlotTop: number;

  // Death FX event rings (gate 5).
  private readonly deathFxEventRing0: Int32Array;
  private readonly deathFxEventRing1: Int32Array;
  private frontRingIsRing0: boolean;
  private frontDeathFxEventCount: number;
  private backDeathFxEventCount: number;
  private deathFxEventsDroppedTotal: number;

  // Integration adapters.
  private sonicSync: SonicSync | null;
  private loomPulse: LoomPulse | null;
  private inferenceOrchestrator: InferenceOrchestrator | null;
  private narrativeMemory: NarrativeMemory | null;
  private behaviorTreeFactory: ((variantIdx: number) => BTNode | null) | null;

  // Cached scratch buffers for SonicSync drain + integration. Sized
  // at construction; reused per tick to avoid heap thrash.
  private readonly perceptionEventScratch: Int32Array;

  // Tick + diagnostic counters.
  private currentTick: number;
  private inflightInferenceCount: number;
  private spawnedTotal: number;
  private despawnedTotal: number;

  constructor(config: BestiaryConfig, integrations?: BestiaryIntegrations) {
    const maxCreatures = config?.maxCreatures;
    if (!Number.isInteger(maxCreatures) || maxCreatures < 1 || maxCreatures > MAX_CREATURES) {
      throw new RangeError(
        'BestiaryKernel: maxCreatures must be in [1, ' + MAX_CREATURES + '], got ' + maxCreatures,
      );
    }
    const deathFxCap = config?.deathFxEventCapacity;
    if (!Number.isInteger(deathFxCap) || deathFxCap < 1 || deathFxCap > MAX_DEATH_FX_CAPACITY) {
      throw new RangeError(
        'BestiaryKernel: deathFxEventCapacity must be in [1, ' + MAX_DEATH_FX_CAPACITY + '], got ' + deathFxCap,
      );
    }
    const maxSimInf = config.maxSimultaneousInference ?? 1;
    if (!Number.isInteger(maxSimInf) || maxSimInf < 0 || maxSimInf > 64) {
      throw new RangeError(
        'BestiaryKernel: maxSimultaneousInference must be in [0, 64], got ' + maxSimInf,
      );
    }
    const tokens = config.inferenceTokensPerRequest ?? DEFAULT_INFERENCE_TOKENS_PER_REQUEST;
    if (!Number.isInteger(tokens) || tokens < 1) {
      throw new RangeError('BestiaryKernel: inferenceTokensPerRequest must be a positive integer, got ' + tokens);
    }
    const ttl = config.inferenceTtlTicks ?? DEFAULT_INFERENCE_TTL_TICKS;
    if (!Number.isInteger(ttl) || ttl < 1) {
      throw new RangeError('BestiaryKernel: inferenceTtlTicks must be a positive integer, got ' + ttl);
    }
    const actionType = config.inferenceActionType ?? DEFAULT_INFERENCE_ACTION_TYPE;
    if (!Number.isInteger(actionType) || actionType < 0 || actionType > 0xfff) {
      throw new RangeError('BestiaryKernel: inferenceActionType out of range, got ' + actionType);
    }
    const allowedMask = config.inferenceAllowedResultMask ?? DEFAULT_INFERENCE_ALLOWED_MASK;
    if (!Number.isInteger(allowedMask) || allowedMask < 0 || allowedMask > 0xffffffff) {
      throw new RangeError('BestiaryKernel: inferenceAllowedResultMask out of range, got ' + allowedMask);
    }
    this.maxCreatures = maxCreatures;
    this.deathFxEventCapacity = deathFxCap;
    this.maxSimultaneousInference = maxSimInf;
    this.inferenceTokensPerRequest = tokens;
    this.inferenceTtlTicks = ttl;
    this.inferenceActionType = actionType;
    this.inferenceAllowedResultMask = allowedMask;

    this.posX = new Int32Array(maxCreatures);
    this.posY = new Int32Array(maxCreatures);
    this.posZ = new Int32Array(maxCreatures);
    this.velX = new Int32Array(maxCreatures);
    this.velY = new Int32Array(maxCreatures);
    this.hp = new Int32Array(maxCreatures);
    this.maxHp = new Int32Array(maxCreatures);
    this.action = new Uint8Array(maxCreatures);
    this.actionProgress = new Int32Array(maxCreatures);
    this.facing = new Int32Array(maxCreatures);
    this.targetHandle = new Int32Array(maxCreatures).fill(TARGET_HANDLE_NONE);
    this.behaviorTreeStateIdx = new Int32Array(maxCreatures);
    this.moodValue = new Int32Array(maxCreatures);
    this.inferenceRequestHandle = new Int32Array(maxCreatures).fill(REQUEST_HANDLE_INVALID);
    this.variantIdx = new Uint8Array(maxCreatures);
    this.lastPerceivedAt = new Uint32Array(maxCreatures);
    this.generation = new Uint16Array(maxCreatures);
    this.active = new Uint8Array(maxCreatures);
    this.sonicListenerSlot = new Int32Array(maxCreatures).fill(-1);
    this.behaviorTrees = new Array(maxCreatures).fill(null);

    this.freeSlotStack = new Int32Array(maxCreatures);
    // LIFO order: push 0..N-1 so the first pop returns N-1 (irrelevant
    // semantically - any unique slot works) and subsequent operations
    // are O(1).
    for (let i = 0; i < maxCreatures; i++) this.freeSlotStack[i] = i;
    this.freeSlotTop = maxCreatures;

    this.deathFxEventRing0 = new Int32Array(deathFxCap * DEATH_FX_EVENT_STRIDE);
    this.deathFxEventRing1 = new Int32Array(deathFxCap * DEATH_FX_EVENT_STRIDE);
    this.frontRingIsRing0 = true;
    this.frontDeathFxEventCount = 0;
    this.backDeathFxEventCount = 0;
    this.deathFxEventsDroppedTotal = 0;

    this.sonicSync = integrations?.sonicSync ?? null;
    this.loomPulse = integrations?.loomPulse ?? null;
    this.inferenceOrchestrator = integrations?.inferenceOrchestrator ?? null;
    this.narrativeMemory = integrations?.narrativeMemory ?? null;
    this.behaviorTreeFactory = integrations?.behaviorTreeFactory ?? null;

    // Pre-register the inference action type with allowed mask. The
    // orchestrator's clear() wipes registrations, so the consumer is
    // responsible for re-registering after orchestrator resets. The
    // kernel re-registers here on construction; the consumer may
    // override later via registerInferenceActionType.
    if (this.inferenceOrchestrator) {
      this.inferenceOrchestrator.registerActionType(
        this.inferenceActionType,
        this.inferenceAllowedResultMask,
      );
    }

    this.perceptionEventScratch = new Int32Array(PERCEPTION_EVENT_STRIDE);

    this.currentTick = 0;
    this.inflightInferenceCount = 0;
    this.spawnedTotal = 0;
    this.despawnedTotal = 0;
  }

  // --- integration adapters (post-construction swap) ---
  setSonicSync(ss: SonicSync | null): void { this.sonicSync = ss; }
  setLoomPulse(lp: LoomPulse | null): void { this.loomPulse = lp; }
  setInferenceOrchestrator(io: InferenceOrchestrator | null): void {
    this.inferenceOrchestrator = io;
    if (io) {
      io.registerActionType(this.inferenceActionType, this.inferenceAllowedResultMask);
    }
  }
  setNarrativeMemory(nm: NarrativeMemory | null): void { this.narrativeMemory = nm; }
  setBehaviorTreeFactory(f: ((variantIdx: number) => BTNode | null) | null): void {
    this.behaviorTreeFactory = f;
  }

  // --- counters ---
  getActiveCount(): number {
    return this.maxCreatures - this.freeSlotTop;
  }
  getFreeCount(): number { return this.freeSlotTop; }
  getCurrentTick(): number { return this.currentTick; }
  getInflightInferenceCount(): number { return this.inflightInferenceCount; }
  getSpawnedTotal(): number { return this.spawnedTotal; }
  getDespawnedTotal(): number { return this.despawnedTotal; }
  getDeathFxEventsDroppedTotal(): number { return this.deathFxEventsDroppedTotal; }
  getFrontDeathFxEventCount(): number { return this.frontDeathFxEventCount; }

  // --- catalog facade (instance-mirror of module exports) ---
  static getVariantIndex(id: string): number { return getVariantIndex(id); }
  static getSpec(variantIdx: number): CreatureSpec | null { return getSpec(variantIdx); }
  static getCatalog(): ReadonlyArray<CreatureSpec> { return CREATURE_CATALOG; }

  // --- spawn / despawn (gates 1, 2, 4, 8) ---
  // Allocate a creature slot, initialise SoA from the catalog spec,
  // register kernel-level integration hooks (SonicSync listener,
  // BehaviorTree instance, optional NarrativeMemory bias query, T3
  // inference submission). Returns a generational handle or
  // CREATURE_HANDLE_INVALID on bad input / pool exhaustion.
  spawnCreature(variantIdOrIdx: string | number, posX: number, posY: number): number {
    // Resolve variant.
    let vIdx: number;
    if (typeof variantIdOrIdx === 'string') {
      vIdx = getVariantIndex(variantIdOrIdx);
    } else if (Number.isInteger(variantIdOrIdx)) {
      vIdx = variantIdOrIdx as number;
    } else {
      return CREATURE_HANDLE_INVALID;
    }
    if (vIdx < 0 || vIdx >= CREATURE_CATALOG.length) return CREATURE_HANDLE_INVALID;
    const spec = CREATURE_CATALOG[vIdx];
    if (!spec) return CREATURE_HANDLE_INVALID;
    if (!Number.isInteger(posX) || !Number.isInteger(posY)) return CREATURE_HANDLE_INVALID;
    if (this.freeSlotTop <= 0) return CREATURE_HANDLE_INVALID;

    // Pop a free slot.
    const slot = (this.freeSlotStack[--this.freeSlotTop] ?? 0) | 0;

    // Bump generation BEFORE writing so the prior occupant's handle is
    // immediately rejected.
    const nextGen = ((this.generation[slot] ?? 0) + 1) & 0xffff;
    this.generation[slot] = nextGen;

    // Initialise SoA columns from the spec.
    this.posX[slot] = posX | 0;
    this.posY[slot] = posY | 0;
    this.posZ[slot] = 0;
    this.velX[slot] = 0;
    this.velY[slot] = 0;
    this.hp[slot] = spec.baseHp | 0;
    this.maxHp[slot] = spec.baseHp | 0;
    this.action[slot] = CREATURE_ACTION_IDLE;
    this.actionProgress[slot] = 0;
    this.facing[slot] = 0;
    this.targetHandle[slot] = TARGET_HANDLE_NONE;
    this.behaviorTreeStateIdx[slot] = 0;
    this.moodValue[slot] = 0;
    this.inferenceRequestHandle[slot] = REQUEST_HANDLE_INVALID;
    this.variantIdx[slot] = vIdx & 0xff;
    this.lastPerceivedAt[slot] = 0;
    this.active[slot] = 1;

    // SonicSync listener registration (gate 6).
    let listenerSlot = -1;
    if (this.sonicSync) {
      listenerSlot = this.sonicSync.addListener(
        posX | 0, posY | 0, 0,
        spec.perceptionRadius | 0,
        DEFAULT_LISTENER_SEMANTIC_MASK,
      );
    }
    this.sonicListenerSlot[slot] = listenerSlot;

    // BehaviorTree instance allocation / reset (gate 4).
    let tree = this.behaviorTrees[slot] ?? null;
    if (tree) {
      // Reuse the existing tree if its blackboard is from the same
      // variant; otherwise dispose and reallocate.
      const existingVariant = tree.getBlackboardEntry(BB_KEY_VARIANT_IDX);
      if (existingVariant !== vIdx) {
        try { tree.dispose(); } catch (_e) { /* fault-tolerant */ }
        tree = null;
      } else {
        tree.reset();
      }
    }
    if (!tree && this.behaviorTreeFactory) {
      const root = this.behaviorTreeFactory(vIdx);
      if (root) {
        tree = BehaviorTree.create({
          root,
          blackboard: {},
        });
      }
    }
    this.behaviorTrees[slot] = tree;
    if (tree) {
      tree.setBlackboardEntry(BB_KEY_VARIANT_IDX, vIdx);
      tree.setBlackboardEntry(BB_KEY_HP, spec.baseHp);
      tree.setBlackboardEntry(BB_KEY_MAX_HP, spec.baseHp);
      tree.setBlackboardEntry(BB_KEY_POS_X, posX);
      tree.setBlackboardEntry(BB_KEY_POS_Y, posY);
      tree.setBlackboardEntry(BB_KEY_FACING, 0);
      tree.setBlackboardEntry(BB_KEY_MOOD, 0);
      tree.setBlackboardEntry(BB_KEY_TARGET_HANDLE, TARGET_HANDLE_NONE);
      tree.setBlackboardEntry(BB_KEY_TICK_COUNT, 0);
      tree.setBlackboardEntry(BB_KEY_INTENT_ACTION, CREATURE_ACTION_IDLE);
      tree.setBlackboardEntry(BB_KEY_INTENT_VEL_X, 0);
      tree.setBlackboardEntry(BB_KEY_INTENT_VEL_Y, 0);
      tree.setBlackboardEntry(BB_KEY_INTENT_FACING, 0);
    }

    // NarrativeMemory bias query (gate 8). Look up prior deaths of
    // the player by this variant; if any, bias mood by salience-scaled
    // overconfidence (mapped via spec's moodChannelId).
    if (this.narrativeMemory) {
      try {
        const recalled = this.narrativeMemory.recall(spec.id, 'player', { tags: ['death'] });
        if (recalled && recalled.length > 0) {
          const topFact = recalled[0];
          const salience = (topFact && typeof topFact.salience === 'number') ? topFact.salience : 0;
          // Map salience [0..1] to Q16.16 mood bias. Cap at 0.6 so
          // initial bias is "noticeable but not dominant" - the BT
          // catches up via LoomPulse-driven dynamics.
          const cap = Math.floor(0.6 * BESTIARY_FP_ONE);
          const biased = Math.min(cap, Math.floor(salience * BESTIARY_FP_ONE));
          this.moodValue[slot] = biased | 0;
          if (tree) tree.setBlackboardEntry(BB_KEY_BIAS_FROM_MEMORY, biased);
        } else if (tree) {
          tree.setBlackboardEntry(BB_KEY_BIAS_FROM_MEMORY, 0);
        }
      } catch (_e) {
        // Defensive: a narrative-memory recall fault must not block spawn.
        if (tree) tree.setBlackboardEntry(BB_KEY_BIAS_FROM_MEMORY, 0);
      }
    } else if (tree) {
      tree.setBlackboardEntry(BB_KEY_BIAS_FROM_MEMORY, 0);
    }

    // InferenceOrchestrator submission for cloud-lane variants (T3).
    if (
      spec.inferenceLaneId === INFERENCE_LANE_CLOUD &&
      this.inferenceOrchestrator &&
      this.inflightInferenceCount < this.maxSimultaneousInference
    ) {
      const reqHandle = this.inferenceOrchestrator.submitRequest(
        slot,
        LANE_CLOUD,
        PRIORITY_HIGH,
        this.inferenceTokensPerRequest,
        this.inferenceTtlTicks,
      );
      if (reqHandle !== REQUEST_HANDLE_INVALID) {
        this.inferenceRequestHandle[slot] = reqHandle;
        this.inflightInferenceCount++;
      }
    } else if (
      spec.inferenceLaneId === INFERENCE_LANE_LOCAL_SLM &&
      this.inferenceOrchestrator &&
      this.inflightInferenceCount < this.maxSimultaneousInference
    ) {
      const reqHandle = this.inferenceOrchestrator.submitRequest(
        slot,
        LANE_LOCAL_SLM,
        PRIORITY_HIGH,
        this.inferenceTokensPerRequest,
        this.inferenceTtlTicks,
      );
      if (reqHandle !== REQUEST_HANDLE_INVALID) {
        this.inferenceRequestHandle[slot] = reqHandle;
        this.inflightInferenceCount++;
      }
    }

    this.spawnedTotal++;
    return makeCreatureHandle(slot, nextGen);
  }

  // Despawn a creature. Emits a DEATH_FX event into the BACK ring,
  // deactivates the SonicSync listener, cancels any inflight inference,
  // disposes the BT instance, and returns the slot to the free stack.
  // Double-increments the generation so the now-stale handle is doubly
  // rejected by every subsequent read.
  despawnCreature(handle: number): boolean {
    const slot = creatureSlot(handle);
    if (!this.requireLiveHandle(handle)) return false;
    const vIdx = this.variantIdx[slot] ?? 0;
    const spec = CREATURE_CATALOG[vIdx];

    // Emit DEATH_FX event with payload (gate 5).
    if (this.backDeathFxEventCount >= this.deathFxEventCapacity) {
      this.deathFxEventsDroppedTotal++;
    } else if (spec) {
      const back = this.frontRingIsRing0 ? this.deathFxEventRing1 : this.deathFxEventRing0;
      const off = this.backDeathFxEventCount * DEATH_FX_EVENT_STRIDE;
      const x = this.posX[slot] ?? 0;
      const y = this.posY[slot] ?? 0;
      // Intensity scales linearly with tier (T1 = 1.0, T2 = 1.5, T3 = 2.0).
      const intensityFp = (BESTIARY_FP_ONE * (1 + (spec.tier - 1) * 0.5)) | 0;
      back[off + 0] = spec.deathFxCode;
      back[off + 1] = x;
      back[off + 2] = y;
      back[off + 3] = intensityFp;
      // Payload: for CYAN_DIVIDE_SPLIT_2, pack two spawn coords for
      // the two summoned warriors. The render layer ignores payload
      // for fx without a split contract.
      if (spec.deathFxCode === DEATH_FX_CYAN_DIVIDE_SPLIT_2) {
        // Split into two locations one tile diagonally apart - the
        // consumer's spawn director can choose to actually summon there.
        back[off + 4] = (x + BESTIARY_FP_ONE) | 0;
        back[off + 5] = (y + BESTIARY_FP_ONE) | 0;
      } else {
        back[off + 4] = 0;
        back[off + 5] = 0;
      }
      back[off + 6] = this.currentTick | 0;
      this.backDeathFxEventCount++;
    }

    // Deactivate SonicSync listener.
    const lSlot = this.sonicListenerSlot[slot] ?? -1;
    if (lSlot >= 0 && this.sonicSync) {
      try { this.sonicSync.deactivateListener(lSlot); } catch (_e) { /* defensive */ }
    }
    this.sonicListenerSlot[slot] = -1;

    // Cancel any inflight inference.
    const reqHandle = this.inferenceRequestHandle[slot] ?? REQUEST_HANDLE_INVALID;
    if (reqHandle !== REQUEST_HANDLE_INVALID && this.inferenceOrchestrator) {
      try {
        if (this.inferenceOrchestrator.cancelRequest(reqHandle)) {
          if (this.inflightInferenceCount > 0) this.inflightInferenceCount--;
        }
      } catch (_e) { /* defensive */ }
    }
    this.inferenceRequestHandle[slot] = REQUEST_HANDLE_INVALID;

    // Dispose BT instance (the slot's tree will be re-allocated on
    // next spawn if the variant changes; we keep it as-is for reuse
    // when the same variant respawns).
    // (Trees are reset on spawn, not disposed here, so the heap stays
    //  bounded by per-slot ownership.)

    // Increment generation AGAIN so the handle is doubly-stale.
    this.generation[slot] = ((this.generation[slot] ?? 0) + 1) & 0xffff;

    // Return slot to free stack.
    this.active[slot] = 0;
    this.freeSlotStack[this.freeSlotTop++] = slot;

    this.despawnedTotal++;
    return true;
  }

  // --- per-tick advance (gates 1, 3, 4, 6, 7) ---
  // Tick every active creature: pull mood from LoomPulse, drain
  // SonicSync perception events, step the BT, apply intent to SoA,
  // and integrate velocity into position. dtMsFp is the per-tick
  // delta in Q16.16 ms (e.g. 16ms tick = 16 * FP_ONE = 1048576).
  // Pure logic - no rendering, no allocation in the hot path.
  tickCreatures(dtMsFp: number): void {
    if (!Number.isInteger(dtMsFp) || dtMsFp < 0 || dtMsFp > MAX_TICK_DT_FP) return;
    const dtMs = dtMsFp / BESTIARY_FP_ONE;
    // Drain SonicSync FRONT ring into a per-slot map of "most-recent
    // perceived source". O(events), not O(creatures * sources).
    if (this.sonicSync) {
      const eventCount = this.sonicSync.getFrontEventCount();
      const scratch = this.perceptionEventScratch;
      for (let i = 0; i < eventCount; i++) {
        if (!this.sonicSync.readEvent(i, scratch, 0)) continue;
        const listenerSlot = scratch[1] ?? -1;
        if (listenerSlot < 0) continue;
        // Resolve listenerSlot -> creatureSlot via reverse scan. We
        // store the listener-slot per creature in sonicListenerSlot;
        // this is O(maxCreatures) per event in the worst case.
        // maxCreatures = 32 typical, so 32 * events stays comfortably
        // under the perf budget. (For larger worlds the reverse map
        // can become an open-addressed hash.)
        for (let cSlot = 0; cSlot < this.maxCreatures; cSlot++) {
          if (!this.active[cSlot]) continue;
          if (this.sonicListenerSlot[cSlot] !== listenerSlot) continue;
          // Write perception into the BT's blackboard.
          const tree = this.behaviorTrees[cSlot];
          if (tree) {
            tree.setBlackboardEntry(BB_KEY_PERCEIVED_SOURCE, scratch[0] ?? -1);
            tree.setBlackboardEntry(BB_KEY_PERCEIVED_DISTANCE, scratch[4] ?? 0);
          }
          this.lastPerceivedAt[cSlot] = this.currentTick | 0;
          break;
        }
      }
    }

    // Per-creature tick.
    for (let slot = 0; slot < this.maxCreatures; slot++) {
      if (!this.active[slot]) continue;
      const vIdx = this.variantIdx[slot] ?? 0;
      const spec = CREATURE_CATALOG[vIdx];
      if (!spec) continue;

      // Pull mood from LoomPulse if available.
      if (this.loomPulse) {
        const moodId = spec.moodChannelId;
        if (moodId >= 0) {
          const moodFp = this.loomPulse.getEffectiveVibe(moodId);
          // Track decayed mood; clamp to fp 1.0.
          this.moodValue[slot] = Math.max(0, Math.min(BESTIARY_FP_ONE, moodFp | 0));
        }
      }

      const tree = this.behaviorTrees[slot];
      if (!tree) {
        // Variants without an authored BT default to IDLE.
        this.action[slot] = CREATURE_ACTION_IDLE;
        continue;
      }

      // Write input keys to blackboard.
      tree.setBlackboardEntry(BB_KEY_HP, this.hp[slot] ?? 0);
      tree.setBlackboardEntry(BB_KEY_MAX_HP, this.maxHp[slot] ?? 0);
      tree.setBlackboardEntry(BB_KEY_POS_X, this.posX[slot] ?? 0);
      tree.setBlackboardEntry(BB_KEY_POS_Y, this.posY[slot] ?? 0);
      tree.setBlackboardEntry(BB_KEY_FACING, this.facing[slot] ?? 0);
      tree.setBlackboardEntry(BB_KEY_MOOD, this.moodValue[slot] ?? 0);
      tree.setBlackboardEntry(BB_KEY_TARGET_HANDLE, this.targetHandle[slot] ?? TARGET_HANDLE_NONE);
      tree.setBlackboardEntry(BB_KEY_TICK_COUNT, ((tree.getBlackboardEntry(BB_KEY_TICK_COUNT) as number) | 0) + 1);

      // Step the tree.
      try {
        tree.tick(dtMs);
      } catch (_e) {
        // BT fault - revert to IDLE and continue. Tick must never throw.
        this.action[slot] = CREATURE_ACTION_IDLE;
        continue;
      }

      // Read intent back from blackboard.
      const intentActionAny = tree.getBlackboardEntry(BB_KEY_INTENT_ACTION);
      const intentAction =
        typeof intentActionAny === 'number' ? intentActionAny | 0 : CREATURE_ACTION_IDLE;
      const intentVelXAny = tree.getBlackboardEntry(BB_KEY_INTENT_VEL_X);
      const intentVelYAny = tree.getBlackboardEntry(BB_KEY_INTENT_VEL_Y);
      const intentFacingAny = tree.getBlackboardEntry(BB_KEY_INTENT_FACING);
      const intentVelX = typeof intentVelXAny === 'number' ? intentVelXAny | 0 : 0;
      const intentVelY = typeof intentVelYAny === 'number' ? intentVelYAny | 0 : 0;
      const intentFacing = typeof intentFacingAny === 'number' ? intentFacingAny | 0 : this.facing[slot] ?? 0;

      this.action[slot] =
        intentAction >= 0 && intentAction <= CREATURE_ACTION_DEAD
          ? intentAction
          : CREATURE_ACTION_IDLE;
      this.velX[slot] = intentVelX;
      this.velY[slot] = intentVelY;
      this.facing[slot] = intentFacing;

      // Integrate velocity into position. velX/velY are Q16.16 units
      // per second; dtMs is plain float ms. position update is
      // floor(vel * dtMs / 1000). Using Math.floor preserves the fp
      // integer invariant.
      const dx = Math.floor((intentVelX * dtMs) / 1000);
      const dy = Math.floor((intentVelY * dtMs) / 1000);
      this.posX[slot] = ((this.posX[slot] ?? 0) + dx) | 0;
      this.posY[slot] = ((this.posY[slot] ?? 0) + dy) | 0;

      // Update SonicSync listener position so perception tracks movement.
      const lSlot = this.sonicListenerSlot[slot] ?? -1;
      if (lSlot >= 0 && this.sonicSync) {
        try {
          this.sonicSync.updateListener(
            lSlot,
            this.posX[slot] ?? 0,
            this.posY[slot] ?? 0,
            0,
            spec.perceptionRadius,
            DEFAULT_LISTENER_SEMANTIC_MASK,
          );
        } catch (_e) { /* defensive */ }
      }

      // Action progress: advance fp progress proportional to dtMs.
      // Wraps at FP_ONE - the BT decides what to do at completion.
      const prog = (this.actionProgress[slot] ?? 0) + (Math.floor(dtMs * 32) | 0);
      this.actionProgress[slot] = Math.min(BESTIARY_FP_ONE, prog) | 0;

      // Poll inference completion for T3 slots.
      const reqHandle = this.inferenceRequestHandle[slot] ?? REQUEST_HANDLE_INVALID;
      if (reqHandle !== REQUEST_HANDLE_INVALID && this.inferenceOrchestrator) {
        const state = this.inferenceOrchestrator.getSlotState(reqHandle);
        if (state === REQUEST_STATE_NONE) {
          // Request completed, cancelled, or expired; clear the handle
          // and decrement inflight counter. The blackboard's
          // BB_KEY_INFERENCE_DECISION (if set by the consumer via
          // applyInferenceDecision) is what the BT actually reads.
          this.inferenceRequestHandle[slot] = REQUEST_HANDLE_INVALID;
          if (this.inflightInferenceCount > 0) this.inflightInferenceCount--;
        }
        // INFLIGHT or PENDING: BT uses fallback action.
      }
    }
  }

  // --- event buffer rotation (gate 5) ---
  // Swap death FX event rings + advance currentTick. Consumers read
  // front-ring events between tickEventBuffers calls. Must be called
  // exactly once per game tick AFTER tickCreatures.
  tickEventBuffers(t: number): void {
    if (!Number.isInteger(t) || t < 0 || t > U32_MAX) {
      throw new RangeError('BestiaryKernel.tickEventBuffers: t must be a u32, got ' + t);
    }
    this.frontRingIsRing0 = !this.frontRingIsRing0;
    this.frontDeathFxEventCount = this.backDeathFxEventCount;
    this.backDeathFxEventCount = 0;
    this.currentTick = t | 0;
  }

  // --- death FX event readback ---
  readDeathFxEvent(i: number, out: Int32Array, outOffset = 0): boolean {
    if (!Number.isInteger(i) || i < 0 || i >= this.frontDeathFxEventCount) return false;
    if (outOffset < 0 || outOffset + DEATH_FX_EVENT_STRIDE > out.length) return false;
    const front = this.frontRingIsRing0 ? this.deathFxEventRing0 : this.deathFxEventRing1;
    const off = i * DEATH_FX_EVENT_STRIDE;
    out[outOffset + 0] = front[off + 0] ?? 0;
    out[outOffset + 1] = front[off + 1] ?? 0;
    out[outOffset + 2] = front[off + 2] ?? 0;
    out[outOffset + 3] = front[off + 3] ?? 0;
    out[outOffset + 4] = front[off + 4] ?? 0;
    out[outOffset + 5] = front[off + 5] ?? 0;
    out[outOffset + 6] = front[off + 6] ?? 0;
    return true;
  }

  // --- consumer mutations ---
  // Apply damage to a creature. Returns true if the damage causes
  // death (consumer should then call despawnCreature - the kernel
  // does not auto-despawn so the consumer can sequence death FX,
  // loot drops, etc. before releasing the slot).
  applyDamage(handle: number, amount: number): boolean {
    const slot = creatureSlot(handle);
    if (!this.requireLiveHandle(handle)) return false;
    if (!Number.isInteger(amount) || amount < 0) return false;
    const cur = this.hp[slot] ?? 0;
    const next = cur - amount;
    this.hp[slot] = (next < 0 ? 0 : next) | 0;
    // Set the action to TAKE_DAMAGE so render can react; the BT will
    // re-evaluate on next tick.
    if (next > 0) {
      this.action[slot] = CREATURE_ACTION_TAKE_DAMAGE;
    } else {
      this.action[slot] = CREATURE_ACTION_DEAD;
    }
    return next <= 0;
  }

  // Set a creature's target by handle. Returns false if either handle
  // is stale.
  setTarget(handle: number, targetHandle: number): boolean {
    const slot = creatureSlot(handle);
    if (!this.requireLiveHandle(handle)) return false;
    if (targetHandle !== TARGET_HANDLE_NONE && !this.isHandleValid(targetHandle)) {
      // Allow null target or live target; reject stale.
      return false;
    }
    this.targetHandle[slot] = targetHandle | 0;
    return true;
  }

  // Inject a synthetic perception ping (used by consumers that have
  // their own perception pipeline and want to nudge the BT). sourceSlot
  // is opaque - the consumer's BT interprets it.
  injectPerceptionPing(handle: number, sourceSlot: number, distanceFp: number): boolean {
    const slot = creatureSlot(handle);
    if (!this.requireLiveHandle(handle)) return false;
    const tree = this.behaviorTrees[slot];
    if (!tree) return false;
    tree.setBlackboardEntry(BB_KEY_PERCEIVED_SOURCE, sourceSlot | 0);
    tree.setBlackboardEntry(BB_KEY_PERCEIVED_DISTANCE, distanceFp | 0);
    this.lastPerceivedAt[slot] = this.currentTick | 0;
    return true;
  }

  // Apply an inference decision from the consumer's deferred dispatcher.
  // decisionAction is one of the CREATURE_ACTION_* enums; the BT reads
  // it from BB_KEY_INFERENCE_DECISION on the next tick.
  applyInferenceDecision(handle: number, decisionAction: number): boolean {
    const slot = creatureSlot(handle);
    if (!this.requireLiveHandle(handle)) return false;
    if (!Number.isInteger(decisionAction)) return false;
    const tree = this.behaviorTrees[slot];
    if (!tree) return false;
    tree.setBlackboardEntry(BB_KEY_INFERENCE_DECISION, decisionAction | 0);
    return true;
  }

  // --- getters (gates 2 - all generation-checked) ---
  isHandleValid(handle: number): boolean {
    const slot = creatureSlot(handle);
    const gen = creatureGeneration(handle);
    if (slot < 0 || slot >= this.maxCreatures) return false;
    if (!this.active[slot]) return false;
    return (this.generation[slot] ?? 0) === gen;
  }

  getCreaturePos(handle: number, out: Int32Array, outOffset = 0): boolean {
    const slot = creatureSlot(handle);
    if (!this.requireLiveHandle(handle)) return false;
    if (outOffset < 0 || outOffset + 3 > out.length) return false;
    out[outOffset + 0] = this.posX[slot] ?? 0;
    out[outOffset + 1] = this.posY[slot] ?? 0;
    out[outOffset + 2] = this.posZ[slot] ?? 0;
    return true;
  }

  getCreatureMood(handle: number): number {
    const slot = creatureSlot(handle);
    if (!this.requireLiveHandle(handle)) return 0;
    return this.moodValue[slot] ?? 0;
  }

  getCreatureAction(handle: number): number {
    const slot = creatureSlot(handle);
    if (!this.requireLiveHandle(handle)) return CREATURE_ACTION_IDLE;
    return this.action[slot] ?? CREATURE_ACTION_IDLE;
  }

  getCreatureHp(handle: number): number {
    const slot = creatureSlot(handle);
    if (!this.requireLiveHandle(handle)) return 0;
    return this.hp[slot] ?? 0;
  }

  getCreatureMaxHp(handle: number): number {
    const slot = creatureSlot(handle);
    if (!this.requireLiveHandle(handle)) return 0;
    return this.maxHp[slot] ?? 0;
  }

  getCreatureFacing(handle: number): number {
    const slot = creatureSlot(handle);
    if (!this.requireLiveHandle(handle)) return 0;
    return this.facing[slot] ?? 0;
  }

  getCreatureVariantIdx(handle: number): number {
    const slot = creatureSlot(handle);
    if (!this.requireLiveHandle(handle)) return VARIANT_IDX_INVALID;
    return this.variantIdx[slot] ?? VARIANT_IDX_INVALID;
  }

  getCreatureTier(handle: number): number {
    const v = this.getCreatureVariantIdx(handle);
    if (v < 0) return 0;
    return CREATURE_CATALOG[v]?.tier ?? 0;
  }

  getCreatureTargetHandle(handle: number): number {
    const slot = creatureSlot(handle);
    if (!this.requireLiveHandle(handle)) return TARGET_HANDLE_NONE;
    return this.targetHandle[slot] ?? TARGET_HANDLE_NONE;
  }

  getCreatureActionProgress(handle: number): number {
    const slot = creatureSlot(handle);
    if (!this.requireLiveHandle(handle)) return 0;
    return this.actionProgress[slot] ?? 0;
  }

  getCreatureSonicListenerSlot(handle: number): number {
    const slot = creatureSlot(handle);
    if (!this.requireLiveHandle(handle)) return -1;
    return this.sonicListenerSlot[slot] ?? -1;
  }

  // --- handle iteration ---
  // Push every active creature's handle into out, up to out.length.
  // Returns the number written. Iterates in slot order (not spawn
  // order) so the result is stable for snapshotting.
  listActiveHandles(out: Int32Array, outOffset = 0): number {
    let written = 0;
    for (let slot = 0; slot < this.maxCreatures && outOffset + written < out.length; slot++) {
      if (!this.active[slot]) continue;
      out[outOffset + written++] = makeCreatureHandle(slot, this.generation[slot] ?? 0);
    }
    return written;
  }

  // --- helpers ---
  private requireLiveHandle(handle: number): boolean {
    if (!Number.isInteger(handle)) return false;
    const slot = creatureSlot(handle);
    const gen = creatureGeneration(handle);
    if (slot < 0 || slot >= this.maxCreatures) return false;
    if (!this.active[slot]) return false;
    return (this.generation[slot] ?? 0) === gen;
  }

  // --- lifecycle ---
  // Reset every slot + ring + counter. Leaves backing arrays allocated.
  // Disposes per-slot BT instances; consumer re-spawns to reinstall.
  clear(): void {
    for (let slot = 0; slot < this.maxCreatures; slot++) {
      const tree = this.behaviorTrees[slot];
      if (tree) {
        try { tree.dispose(); } catch (_e) { /* defensive */ }
      }
      this.behaviorTrees[slot] = null;
    }
    this.posX.fill(0);
    this.posY.fill(0);
    this.posZ.fill(0);
    this.velX.fill(0);
    this.velY.fill(0);
    this.hp.fill(0);
    this.maxHp.fill(0);
    this.action.fill(0);
    this.actionProgress.fill(0);
    this.facing.fill(0);
    this.targetHandle.fill(TARGET_HANDLE_NONE);
    this.behaviorTreeStateIdx.fill(0);
    this.moodValue.fill(0);
    this.inferenceRequestHandle.fill(REQUEST_HANDLE_INVALID);
    this.variantIdx.fill(0);
    this.lastPerceivedAt.fill(0);
    this.active.fill(0);
    this.sonicListenerSlot.fill(-1);
    // Generation column is preserved across clear() so a stale handle
    // saved before clear() is still rejected after a fresh spawn into
    // the same slot.
    this.deathFxEventRing0.fill(0);
    this.deathFxEventRing1.fill(0);
    this.frontRingIsRing0 = true;
    this.frontDeathFxEventCount = 0;
    this.backDeathFxEventCount = 0;
    this.deathFxEventsDroppedTotal = 0;
    for (let i = 0; i < this.maxCreatures; i++) this.freeSlotStack[i] = i;
    this.freeSlotTop = this.maxCreatures;
    this.currentTick = 0;
    this.inflightInferenceCount = 0;
    this.spawnedTotal = 0;
    this.despawnedTotal = 0;
  }
}

// ----------------------------------------------------------------------
// Default BehaviorTree factory for the 6 skeleton variants.
// ----------------------------------------------------------------------
//
// Each variant's tree is a small selector/sequence with leaf actions
// that READ the blackboard input keys (hp, posX/Y, targetHandle,
// targetX/Y, mood, perceivedSource, perceivedDistance) and WRITE
// intent keys (intentAction, intentVelX, intentVelY, intentFacing).
// The kernel reads intent keys after each tree.tick to drive the SoA.
//
// These are reference trees; consumers can replace the factory wholesale
// via setBehaviorTreeFactory if they want richer per-variant authoring.
// The defaults provide enough behavior to verify the integration works
// and to drive the 30-concurrent-skeleton perf demo.

function readBlackboardNumber(ctx: BTContext, key: string, fallback: number): number {
  const v = ctx.blackboard[key];
  return typeof v === 'number' ? v : fallback;
}

function setIntentIdle(ctx: BTContext): BTStatus {
  ctx.blackboard[BB_KEY_INTENT_ACTION] = CREATURE_ACTION_IDLE;
  ctx.blackboard[BB_KEY_INTENT_VEL_X] = 0;
  ctx.blackboard[BB_KEY_INTENT_VEL_Y] = 0;
  return 'success';
}

function setIntentPursue(ctx: BTContext, speedFp: number): BTStatus {
  const px = readBlackboardNumber(ctx, BB_KEY_POS_X, 0);
  const py = readBlackboardNumber(ctx, BB_KEY_POS_Y, 0);
  const tx = readBlackboardNumber(ctx, BB_KEY_TARGET_X, px);
  const ty = readBlackboardNumber(ctx, BB_KEY_TARGET_Y, py);
  const dx = tx - px;
  const dy = ty - py;
  // Magnitude via Manhattan + clamp avoids a sqrt in the hot path.
  const mag = Math.abs(dx) + Math.abs(dy);
  if (mag <= 0) {
    ctx.blackboard[BB_KEY_INTENT_ACTION] = CREATURE_ACTION_IDLE;
    ctx.blackboard[BB_KEY_INTENT_VEL_X] = 0;
    ctx.blackboard[BB_KEY_INTENT_VEL_Y] = 0;
    return 'success';
  }
  const vx = Math.floor((dx * speedFp) / mag);
  const vy = Math.floor((dy * speedFp) / mag);
  ctx.blackboard[BB_KEY_INTENT_ACTION] = CREATURE_ACTION_PURSUE;
  ctx.blackboard[BB_KEY_INTENT_VEL_X] = vx;
  ctx.blackboard[BB_KEY_INTENT_VEL_Y] = vy;
  // Face the target (atan2 substitute: facing is the dominant axis sign).
  ctx.blackboard[BB_KEY_INTENT_FACING] = vx;
  return 'success';
}

function setIntentRetreat(ctx: BTContext, speedFp: number): BTStatus {
  // Same as pursue but with negated direction.
  const px = readBlackboardNumber(ctx, BB_KEY_POS_X, 0);
  const py = readBlackboardNumber(ctx, BB_KEY_POS_Y, 0);
  const tx = readBlackboardNumber(ctx, BB_KEY_TARGET_X, px);
  const ty = readBlackboardNumber(ctx, BB_KEY_TARGET_Y, py);
  const dx = px - tx;
  const dy = py - ty;
  const mag = Math.abs(dx) + Math.abs(dy);
  if (mag <= 0) return setIntentIdle(ctx);
  const vx = Math.floor((dx * speedFp) / mag);
  const vy = Math.floor((dy * speedFp) / mag);
  ctx.blackboard[BB_KEY_INTENT_ACTION] = CREATURE_ACTION_FLEE;
  ctx.blackboard[BB_KEY_INTENT_VEL_X] = vx;
  ctx.blackboard[BB_KEY_INTENT_VEL_Y] = vy;
  ctx.blackboard[BB_KEY_INTENT_FACING] = vx;
  return 'success';
}

function setIntentSwing(ctx: BTContext): BTStatus {
  ctx.blackboard[BB_KEY_INTENT_ACTION] = CREATURE_ACTION_SWING;
  ctx.blackboard[BB_KEY_INTENT_VEL_X] = 0;
  ctx.blackboard[BB_KEY_INTENT_VEL_Y] = 0;
  return 'success';
}

function setIntentDraw(ctx: BTContext): BTStatus {
  ctx.blackboard[BB_KEY_INTENT_ACTION] = CREATURE_ACTION_DRAW;
  ctx.blackboard[BB_KEY_INTENT_VEL_X] = 0;
  ctx.blackboard[BB_KEY_INTENT_VEL_Y] = 0;
  return 'success';
}

function setIntentChannel(ctx: BTContext): BTStatus {
  ctx.blackboard[BB_KEY_INTENT_ACTION] = CREATURE_ACTION_CHANNEL;
  ctx.blackboard[BB_KEY_INTENT_VEL_X] = 0;
  ctx.blackboard[BB_KEY_INTENT_VEL_Y] = 0;
  return 'success';
}

function setIntentTaunt(ctx: BTContext): BTStatus {
  ctx.blackboard[BB_KEY_INTENT_ACTION] = CREATURE_ACTION_TAUNT;
  ctx.blackboard[BB_KEY_INTENT_VEL_X] = 0;
  ctx.blackboard[BB_KEY_INTENT_VEL_Y] = 0;
  return 'success';
}

// Distance squared between (px, py) and (tx, ty) in Q16.16 squared.
// JS doubles hold up to 2^53 exactly so two Q16.16 ints squared fit.
function distSqFp(px: number, py: number, tx: number, ty: number): number {
  const dx = tx - px;
  const dy = ty - py;
  return dx * dx + dy * dy;
}

function hasLiveTarget(ctx: BTContext): boolean {
  const th = readBlackboardNumber(ctx, BB_KEY_TARGET_HANDLE, TARGET_HANDLE_NONE);
  return th !== TARGET_HANDLE_NONE;
}

function inMeleeRange(ctx: BTContext, meleeRangeFp: number): boolean {
  if (!hasLiveTarget(ctx)) return false;
  const px = readBlackboardNumber(ctx, BB_KEY_POS_X, 0);
  const py = readBlackboardNumber(ctx, BB_KEY_POS_Y, 0);
  const tx = readBlackboardNumber(ctx, BB_KEY_TARGET_X, px);
  const ty = readBlackboardNumber(ctx, BB_KEY_TARGET_Y, py);
  return distSqFp(px, py, tx, ty) <= meleeRangeFp * meleeRangeFp;
}

function inKiteRange(ctx: BTContext, minFp: number, maxFp: number): boolean {
  if (!hasLiveTarget(ctx)) return false;
  const px = readBlackboardNumber(ctx, BB_KEY_POS_X, 0);
  const py = readBlackboardNumber(ctx, BB_KEY_POS_Y, 0);
  const tx = readBlackboardNumber(ctx, BB_KEY_TARGET_X, px);
  const ty = readBlackboardNumber(ctx, BB_KEY_TARGET_Y, py);
  const d2 = distSqFp(px, py, tx, ty);
  return d2 >= minFp * minFp && d2 <= maxFp * maxFp;
}

// Build the default BT root for a given variant. Returns null if the
// variantIdx is out of range. Each tree is hand-authored against the
// signatureBehaviors list in the corresponding catalog row.
export function defaultBehaviorTreeFactory(variantIdx: number): BTNode | null {
  const spec = getSpec(variantIdx);
  if (!spec) return null;
  const speed = spec.baseSpeed;

  if (spec.id === 'skel_warrior_t1') {
    const meleeRange = spec.baseRadius + 65536; // baseRadius + 1.0 fp
    return {
      kind: 'selector',
      children: [
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', predicate: function (ctx) { return inMeleeRange(ctx, meleeRange); } },
            { kind: 'action', run: setIntentSwing },
          ],
        },
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', predicate: hasLiveTarget },
            { kind: 'action', run: function (ctx) { return setIntentPursue(ctx, speed); } },
          ],
        },
        { kind: 'action', run: setIntentIdle },
      ],
    };
  }

  if (spec.id === 'skel_archer_t1') {
    const minKite = spec.baseRadius + 196608; // ~3 fp
    const maxKite = 786432; // ~12 fp
    return {
      kind: 'selector',
      children: [
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', predicate: function (ctx) { return inKiteRange(ctx, minKite, maxKite); } },
            { kind: 'action', run: setIntentDraw },
          ],
        },
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', predicate: function (ctx) { return inMeleeRange(ctx, minKite); } },
            { kind: 'action', run: function (ctx) { return setIntentRetreat(ctx, speed); } },
          ],
        },
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', predicate: hasLiveTarget },
            { kind: 'action', run: function (ctx) { return setIntentPursue(ctx, speed); } },
          ],
        },
        { kind: 'action', run: setIntentIdle },
      ],
    };
  }

  if (spec.id === 'skel_caster_t1') {
    const minCast = spec.baseRadius + 131072; // ~2 fp
    const maxCast = 655360; // ~10 fp
    return {
      kind: 'selector',
      children: [
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', predicate: function (ctx) { return inKiteRange(ctx, minCast, maxCast); } },
            { kind: 'action', run: setIntentChannel },
          ],
        },
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', predicate: function (ctx) { return inMeleeRange(ctx, minCast); } },
            { kind: 'action', run: function (ctx) { return setIntentRetreat(ctx, speed); } },
          ],
        },
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', predicate: hasLiveTarget },
            { kind: 'action', run: function (ctx) { return setIntentPursue(ctx, speed); } },
          ],
        },
        { kind: 'action', run: setIntentIdle },
      ],
    };
  }

  if (spec.id === 'skel_reaver_t2') {
    // ALWAYS_AGGRO + PIERCING_CHARGE: pursue unconditionally; swing
    // when in extended melee range.
    const reach = spec.baseRadius + 98304; // ~1.5 fp
    return {
      kind: 'selector',
      children: [
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', predicate: function (ctx) { return inMeleeRange(ctx, reach); } },
            { kind: 'action', run: setIntentSwing },
          ],
        },
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', predicate: hasLiveTarget },
            { kind: 'action', run: function (ctx) { return setIntentPursue(ctx, speed); } },
          ],
        },
        { kind: 'action', run: setIntentIdle },
      ],
    };
  }

  if (spec.id === 'skel_choir_t2') {
    // WAIL_WAVE_ARC: channel from mid-range; SPLIT_ON_DEATH handled
    // by the death FX payload, not the BT.
    const minWail = spec.baseRadius + 196608;
    const maxWail = 1310720;
    return {
      kind: 'selector',
      children: [
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', predicate: function (ctx) { return inKiteRange(ctx, minWail, maxWail); } },
            { kind: 'action', run: setIntentChannel },
          ],
        },
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', predicate: function (ctx) { return inMeleeRange(ctx, minWail); } },
            { kind: 'action', run: function (ctx) { return setIntentRetreat(ctx, speed); } },
          ],
        },
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', predicate: hasLiveTarget },
            { kind: 'action', run: function (ctx) { return setIntentPursue(ctx, speed); } },
          ],
        },
        { kind: 'action', run: setIntentIdle },
      ],
    };
  }

  if (spec.id === 'skel_first_standing_t3') {
    // STANCE_DANCE + NARRATIVE_TAUNT + PHASE_SHIFT: the BT is a
    // fallback selector. Inference decisions land in
    // BB_KEY_INFERENCE_DECISION; when set, they override the
    // fallback for one tick. Phase shift is HP-band triggered.
    const meleeRange = spec.baseRadius + 131072;
    function isInferenceDecided(ctx: BTContext): boolean {
      const d = ctx.blackboard[BB_KEY_INFERENCE_DECISION];
      return typeof d === 'number' && d >= 0;
    }
    function applyInferenceAction(ctx: BTContext): BTStatus {
      const d = readBlackboardNumber(ctx, BB_KEY_INFERENCE_DECISION, CREATURE_ACTION_IDLE);
      ctx.blackboard[BB_KEY_INTENT_ACTION] = d;
      // One-shot: clear the decision so subsequent ticks fall back.
      ctx.blackboard[BB_KEY_INFERENCE_DECISION] = -1;
      return 'success';
    }
    function shouldTaunt(ctx: BTContext): boolean {
      const hp = readBlackboardNumber(ctx, BB_KEY_HP, 0);
      const max = readBlackboardNumber(ctx, BB_KEY_MAX_HP, 0);
      if (max <= 0) return false;
      // Taunt at the 75% / 50% / 25% phase boundaries (within +-2% band).
      const pct = hp / max;
      return (pct > 0.73 && pct < 0.77) ||
             (pct > 0.48 && pct < 0.52) ||
             (pct > 0.23 && pct < 0.27);
    }
    return {
      kind: 'selector',
      children: [
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', predicate: isInferenceDecided },
            { kind: 'action', run: applyInferenceAction },
          ],
        },
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', predicate: shouldTaunt },
            { kind: 'action', run: setIntentTaunt },
          ],
        },
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', predicate: function (ctx) { return inMeleeRange(ctx, meleeRange); } },
            { kind: 'action', run: setIntentSwing },
          ],
        },
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', predicate: hasLiveTarget },
            { kind: 'action', run: function (ctx) { return setIntentPursue(ctx, speed); } },
          ],
        },
        { kind: 'action', run: setIntentIdle },
      ],
    };
  }

  return null;
}

// Convenience resource id for engine-wide resource registration.
export const RESOURCE_BESTIARY = 'bestiary';
