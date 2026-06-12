//! srd5e_slots - SRD 5.1 spell-slot economy (content pack, pure data + resolvers).
//!
//! The Rust port of the TS reference `src/runtime/srd5e-spell-slots.ts`: the
//! slot tables (full / half / pact casters), spend / restore, rests, the
//! widen-merge (the P0 level-up merge: shape always derives fresh from the
//! tables for the CURRENT class + level, only `used` carries over capped at
//! the new max), and the SRD upcast ladder (`upcast_effect` /
//! `total_dice_for_cast`).
//!
//! PURE: no RNG, no wall-clock, no I/O, never mutates an input pool (every
//! resolver takes `&SlotPool` and returns a new pool). The JSON wire shape is
//! host-side: numeric tiers keyed by their decimal string ('1'..'9') plus the
//! reserved 'pact' key - a serialized pool round-trips unchanged. Pinned by
//! test_vectors/srd5e_pack_v1.json (kind 'slots').
//!
//! NEVER PANICS on external paths: out-of-range levels clamp or return a
//! `SpendReason`, unknown classes/spells return empty/`None`, and arithmetic
//! saturates instead of overflowing.
//!
//! Content: mechanics from the D&D 5e System Reference Document 5.1
//! (CC-BY-4.0) - see NOTICE.md. Not affiliated with or endorsed by Wizards of
//! the Coast. No SRD prose is reproduced; tables ship as numbers.

use std::collections::BTreeMap;

pub const MAX_SLOT_LEVEL: i64 = 9;
/// The reserved pool key for the warlock pact tier in the JSON wire shape.
pub const PACT_KEY: &str = "pact";

/// One numeric slot tier: capacity and spent count.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SlotEntry {
    pub max: i64,
    pub used: i64,
}

/// The warlock pact tier: its slot level travels with the entry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PactEntry {
    pub slot_level: i64,
    pub max: i64,
    pub used: i64,
}

/// A spell-slot pool: numeric tiers (keys 1..=9 in the wire shape) plus the
/// optional pact tier. `BTreeMap` keeps iteration deterministic (the
/// cross-language canonical order).
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct SlotPool {
    pub levels: BTreeMap<i64, SlotEntry>,
    pub pact: Option<PactEntry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CasterKind {
    Full,
    Half,
    Pact,
}

/// Spend outcome taxonomy - mirrors the TS reason strings exactly.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpendReason {
    Ok,
    NoSlot,
    NoHigherSlot,
    BadSlotLevel,
    NotASlot,
}

impl SpendReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            SpendReason::Ok => "ok",
            SpendReason::NoSlot => "no_slot",
            SpendReason::NoHigherSlot => "no_higher_slot",
            SpendReason::BadSlotLevel => "bad_slot_level",
            SpendReason::NotASlot => "not_a_slot",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpendResult {
    pub ok: bool,
    pub reason: SpendReason,
    pub slot_level: Option<i64>,
    /// A new pool whether or not the spend succeeded (the input is never touched).
    pub slots: SlotPool,
}

/// Resolved upcast effect for one cast (see `upcast_effect`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpcastInfo {
    pub spell_id: &'static str,
    pub base_level: i64,
    pub cast_level: i64,
    pub levels_above: i64,
    /// "damage" | "heal" | "utility" - the TS effect strings verbatim.
    pub effect: &'static str,
    pub concentration: bool,
    /// TOTAL added dice at this cast level ("" when none).
    pub added_dice: String,
    /// TOTAL extra darts/rays/targets at this cast level.
    pub extra_instances: i64,
    pub note: &'static str,
}

// ---- Caster taxonomy (SRD 5.1) ---------------------------------------------

fn norm_id(s: &str) -> String {
    s.to_lowercase().trim().to_string()
}

pub fn caster_kind(class_id: &str) -> Option<CasterKind> {
    match norm_id(class_id).as_str() {
        "bard" | "cleric" | "druid" | "sorcerer" | "wizard" => Some(CasterKind::Full),
        "paladin" | "ranger" => Some(CasterKind::Half),
        "warlock" => Some(CasterKind::Pact),
        _ => None,
    }
}

pub fn is_caster(class_id: &str) -> bool {
    caster_kind(class_id).is_some()
}

/// The class's spellcasting ability ("int" | "wis" | "cha"), or `None`.
pub fn spell_ability_for_class(class_id: &str) -> Option<&'static str> {
    match norm_id(class_id).as_str() {
        "bard" | "paladin" | "sorcerer" | "warlock" => Some("cha"),
        "cleric" | "druid" | "ranger" => Some("wis"),
        "wizard" => Some("int"),
        _ => None,
    }
}

// ---- Slot tables (SRD 5.1) --------------------------------------------------
// Row index = class level - 1; column index = slot level - 1.

const FULL_SLOT_TABLE: [&[i64]; 20] = [
    &[2],
    &[3],
    &[4, 2],
    &[4, 3],
    &[4, 3, 2],
    &[4, 3, 3],
    &[4, 3, 3, 1],
    &[4, 3, 3, 2],
    &[4, 3, 3, 3, 1],
    &[4, 3, 3, 3, 2],
    &[4, 3, 3, 3, 2, 1],
    &[4, 3, 3, 3, 2, 1],
    &[4, 3, 3, 3, 2, 1, 1],
    &[4, 3, 3, 3, 2, 1, 1],
    &[4, 3, 3, 3, 2, 1, 1, 1],
    &[4, 3, 3, 3, 2, 1, 1, 1],
    &[4, 3, 3, 3, 2, 1, 1, 1, 1],
    &[4, 3, 3, 3, 3, 1, 1, 1, 1],
    &[4, 3, 3, 3, 3, 2, 1, 1, 1],
    &[4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const HALF_SLOT_TABLE: [&[i64]; 20] = [
    &[],
    &[2],
    &[3],
    &[3],
    &[4, 2],
    &[4, 2],
    &[4, 3],
    &[4, 3],
    &[4, 3, 2],
    &[4, 3, 2],
    &[4, 3, 3],
    &[4, 3, 3],
    &[4, 3, 3, 1],
    &[4, 3, 3, 1],
    &[4, 3, 3, 2],
    &[4, 3, 3, 2],
    &[4, 3, 3, 3, 1],
    &[4, 3, 3, 3, 1],
    &[4, 3, 3, 3, 2],
    &[4, 3, 3, 3, 2],
];

// [pact slot level, pact slot count] per warlock level (Mystic Arcanum is a
// class feature, not a slot - out of scope here, exactly as in the SRD table).
const PACT_TABLE: [[i64; 2]; 20] = [
    [1, 1], [1, 2], [2, 2], [2, 2], [3, 2], [3, 2], [4, 2], [4, 2], [5, 2], [5, 2],
    [5, 3], [5, 3], [5, 3], [5, 3], [5, 3], [5, 3], [5, 4], [5, 4], [5, 4], [5, 4],
];

fn clamp_level(level: i64) -> i64 {
    level.clamp(1, 20)
}

/// Fresh slot pool for a class + level (all used = 0). Non-caster -> empty.
/// Level is clamped into 1..=20.
pub fn spell_slots_for(class_id: &str, level: i64) -> SlotPool {
    let mut out = SlotPool::default();
    let kind = match caster_kind(class_id) {
        Some(k) => k,
        None => return out,
    };
    let lvl = clamp_level(level);
    let row_index = (lvl - 1) as usize;
    if kind == CasterKind::Pact {
        if let Some(row) = PACT_TABLE.get(row_index) {
            out.pact = Some(PactEntry { slot_level: row[0], max: row[1], used: 0 });
        }
        return out;
    }
    let table: &[&[i64]; 20] = if kind == CasterKind::Full { &FULL_SLOT_TABLE } else { &HALF_SLOT_TABLE };
    if let Some(slots) = table.get(row_index) {
        for (i, max) in slots.iter().enumerate() {
            if *max > 0 {
                out.levels.insert(i as i64 + 1, SlotEntry { max: *max, used: 0 });
            }
        }
    }
    out
}

/// Codex audit P2: a host-supplied pool is untrusted. Clamp an entry to a
/// well-formed shape (max >= 0, used in [0, max]) so a corrupted entry such as
/// { max: 1, used: -100 } cannot inflate availability or be spent forever. A
/// valid entry is returned unchanged. Mirrors the TS normEntry.
fn norm_entry(max: i64, used: i64) -> (i64, i64) {
    let m = if max > 0 { max } else { 0 };
    let mut u = if used < 0 { 0 } else { used };
    if u > m {
        u = m;
    }
    (m, u)
}

/// Codex audit P2 boundary helper: clamp every entry of an untrusted pool. A
/// well-formed pool is returned byte-identical. Every public op already
/// sanitizes internally, so this is a convenience, not a precondition.
pub fn sanitize_slot_pool(slots: &SlotPool) -> SlotPool {
    let mut levels: BTreeMap<i64, SlotEntry> = BTreeMap::new();
    for (k, e) in slots.levels.iter() {
        let (m, u) = norm_entry(e.max, e.used);
        levels.insert(*k, SlotEntry { max: m, used: u });
    }
    let pact = slots.pact.as_ref().map(|p| {
        let (m, u) = norm_entry(p.max, p.used);
        PactEntry { slot_level: p.slot_level, max: m, used: u }
    });
    SlotPool { levels, pact }
}

/// Highest slot level with max > 0 anywhere in the pool (pact included). 0 if none.
pub fn highest_slot_level(slots: &SlotPool) -> i64 {
    let mut best = 0;
    for level in 1..=MAX_SLOT_LEVEL {
        if let Some(e) = slots.levels.get(&level) {
            if norm_entry(e.max, e.used).0 > 0 {
                best = level;
            }
        }
    }
    if let Some(p) = &slots.pact {
        if norm_entry(p.max, p.used).0 > 0 && p.slot_level > best {
            best = p.slot_level;
        }
    }
    best
}

/// Unused slots at exactly `slot_level` (numeric tier + a matching pact tier summed).
pub fn slot_available(slots: &SlotPool, slot_level: i64) -> i64 {
    let mut n: i64 = 0;
    if let Some(e) = slots.levels.get(&slot_level) {
        let (m, u) = norm_entry(e.max, e.used); // P2: clamp untrusted entry
        if m > u {
            n = n.saturating_add(m - u);
        }
    }
    if let Some(p) = &slots.pact {
        if p.slot_level == slot_level {
            let (m, u) = norm_entry(p.max, p.used);
            if m > u {
                n = n.saturating_add(m - u);
            }
        }
    }
    n
}

fn spend_reject(slots: &SlotPool, reason: SpendReason) -> SpendResult {
    // P2: return the sanitized pool (TS spendReject returns clonePool, which
    // now clamps) so a rejected spend on a malformed pool matches across surfaces.
    SpendResult { ok: false, reason, slot_level: None, slots: sanitize_slot_pool(slots) }
}

/// Spend ONE slot at exactly `slot_level`. Never mutates the input (the
/// returned pool is a clone whether or not the spend succeeded). Numeric
/// slots spend before a matching pact slot (deterministic order).
pub fn spend_slot(slots: &SlotPool, slot_level: i64) -> SpendResult {
    if slot_level == 0 {
        return spend_reject(slots, SpendReason::NotASlot); // a cantrip is not a slot
    }
    if !(1..=MAX_SLOT_LEVEL).contains(&slot_level) {
        return spend_reject(slots, SpendReason::BadSlotLevel);
    }
    let mut out = sanitize_slot_pool(slots); // P2: clamp before spending
    if let Some(e) = out.levels.get_mut(&slot_level) {
        if e.used < e.max {
            e.used += 1; // used < max, so no overflow is possible here
            return SpendResult { ok: true, reason: SpendReason::Ok, slot_level: Some(slot_level), slots: out };
        }
    }
    if let Some(p) = &mut out.pact {
        if p.slot_level == slot_level && p.used < p.max {
            p.used += 1;
            return SpendResult { ok: true, reason: SpendReason::Ok, slot_level: Some(slot_level), slots: out };
        }
    }
    spend_reject(slots, SpendReason::NoSlot)
}

/// Spend the LOWEST available slot at `min_level` or above (walks up from
/// min_level - the 5e RAW auto-upcast when the base tier is dry). Reason
/// `NoHigherSlot` when the whole walk comes up dry.
pub fn spend_lowest_available(slots: &SlotPool, min_level: i64) -> SpendResult {
    if min_level == 0 {
        return spend_reject(slots, SpendReason::NotASlot);
    }
    if !(1..=MAX_SLOT_LEVEL).contains(&min_level) {
        return spend_reject(slots, SpendReason::BadSlotLevel);
    }
    for level in min_level..=MAX_SLOT_LEVEL {
        if slot_available(slots, level) > 0 {
            return spend_slot(slots, level);
        }
    }
    spend_reject(slots, SpendReason::NoHigherSlot)
}

/// Restore `count` spent slots at `slot_level` (used floors at 0; count <= 0
/// behaves as 1, the TS default). Numeric tier restores first; a matching
/// pact tier restores only when no numeric tier exists at that level.
/// Unknown level is a no-op clone.
pub fn restore_slot(slots: &SlotPool, slot_level: i64, count: i64) -> SlotPool {
    let mut out = sanitize_slot_pool(slots); // P2: clamp before restoring
    let n = if count > 0 { count } else { 1 };
    if let Some(e) = out.levels.get_mut(&slot_level) {
        e.used = e.used.saturating_sub(n).max(0);
        return out;
    }
    if let Some(p) = &mut out.pact {
        if p.slot_level == slot_level {
            p.used = p.used.saturating_sub(n).max(0);
        }
    }
    out
}

/// Remaining (unused) slots per level, pact merged into its slot level.
pub fn slots_remaining(slots: &SlotPool) -> BTreeMap<i64, i64> {
    let mut out: BTreeMap<i64, i64> = BTreeMap::new();
    for level in 1..=MAX_SLOT_LEVEL {
        if let Some(e) = slots.levels.get(&level) {
            let (m, u) = norm_entry(e.max, e.used); // P2: clamp untrusted entry
            if m > 0 {
                out.insert(level, m - u);
            }
        }
    }
    if let Some(p) = &slots.pact {
        let (m, u) = norm_entry(p.max, p.used);
        if m > 0 {
            let rem = m - u;
            let prior = out.get(&p.slot_level).copied().unwrap_or(0);
            out.insert(p.slot_level, prior.saturating_add(rem));
        }
    }
    out
}

/// Long rest: every slot refreshes - a fresh pool for the class + level.
pub fn long_rest(class_id: &str, level: i64) -> SlotPool {
    spell_slots_for(class_id, level)
}

/// Short rest: pact slots refresh (warlock); everyone else is unchanged. The
/// pact entry's shape (slot_level / max) re-derives from the tables for the
/// CURRENT class + level, so a stale stored shape self-heals here too.
pub fn short_rest(class_id: &str, level: i64, slots: &SlotPool) -> SlotPool {
    let mut out = slots.clone();
    if caster_kind(class_id) != Some(CasterKind::Pact) {
        return out;
    }
    let fresh = spell_slots_for(class_id, level);
    if let Some(fp) = fresh.pact {
        out.pact = Some(PactEntry { slot_level: fp.slot_level, max: fp.max, used: 0 });
    }
    out
}

/// THE P0 widen-merge. Shape (tiers + maxima) ALWAYS derives fresh from the
/// tables for the CURRENT class + level; only `used` carries over, capped at
/// the new max. Levels present in the stored pool but absent from the fresh
/// shape are dropped. Non-caster / unknown class returns the stored pool
/// untouched (as a clone); `None` / empty stored returns the fresh pool.
pub fn widen_slots(stored: Option<&SlotPool>, class_id: &str, level: i64) -> SlotPool {
    if caster_kind(class_id).is_none() {
        return stored.cloned().unwrap_or_default();
    }
    let mut fresh = spell_slots_for(class_id, level);
    let stored = match stored {
        Some(s) => s,
        None => return fresh,
    };
    if stored.levels.is_empty() && stored.pact.is_none() {
        return fresh;
    }
    for (lvl, fe) in fresh.levels.iter_mut() {
        let carried = match stored.levels.get(lvl) {
            Some(se) if se.used > 0 => se.used,
            _ => 0,
        };
        fe.used = carried.min(fe.max);
    }
    if let Some(fp) = &mut fresh.pact {
        let carried = match &stored.pact {
            Some(sp) if sp.used > 0 => sp.used,
            _ => 0,
        };
        fp.used = carried.min(fp.max);
    }
    fresh
}

// ---- SRD upcast ladder -------------------------------------------------------
// Mechanics-only upcast data (SRD-true). Entries with no action document yet
// (bless / bane / hex / charm_person / sleep / faerie_fire / hunters_mark)
// still ship - the ladder is useful catalog data on its own.

struct UpcastDef {
    id: &'static str,
    base_level: i64,
    effect: &'static str,
    concentration: bool,
    /// Per upcast STEP ("" when the upcast adds no dice).
    added_dice: &'static str,
    /// Slot levels per step (2 for spiritual_weapon).
    per_levels: i64,
    /// Extra darts/rays/targets per slot level above base.
    extra_instances: i64,
    note: &'static str,
}

const SPELL_UPCAST: [UpcastDef; 28] = [
    UpcastDef { id: "magic_missile", base_level: 1, effect: "damage", concentration: false, added_dice: "", per_levels: 1, extra_instances: 1, note: "one extra dart per slot level above 1st" },
    UpcastDef { id: "cure_wounds", base_level: 1, effect: "heal", concentration: false, added_dice: "1d8", per_levels: 1, extra_instances: 0, note: "+1d8 healing per slot level above 1st" },
    UpcastDef { id: "healing_word", base_level: 1, effect: "heal", concentration: false, added_dice: "1d4", per_levels: 1, extra_instances: 0, note: "+1d4 healing per slot level above 1st" },
    UpcastDef { id: "guiding_bolt", base_level: 1, effect: "damage", concentration: false, added_dice: "1d6", per_levels: 1, extra_instances: 0, note: "+1d6 damage per slot level above 1st" },
    UpcastDef { id: "inflict_wounds", base_level: 1, effect: "damage", concentration: false, added_dice: "1d10", per_levels: 1, extra_instances: 0, note: "+1d10 damage per slot level above 1st" },
    UpcastDef { id: "witch_bolt", base_level: 1, effect: "damage", concentration: true, added_dice: "1d12", per_levels: 1, extra_instances: 0, note: "+1d12 initial damage per slot level above 1st" },
    UpcastDef { id: "hellish_rebuke", base_level: 1, effect: "damage", concentration: false, added_dice: "1d10", per_levels: 1, extra_instances: 0, note: "+1d10 damage per slot level above 1st" },
    UpcastDef { id: "burning_hands", base_level: 1, effect: "damage", concentration: false, added_dice: "1d6", per_levels: 1, extra_instances: 0, note: "+1d6 damage per slot level above 1st" },
    UpcastDef { id: "thunderwave", base_level: 1, effect: "damage", concentration: false, added_dice: "1d8", per_levels: 1, extra_instances: 0, note: "+1d8 damage per slot level above 1st" },
    UpcastDef { id: "spiritual_weapon", base_level: 2, effect: "damage", concentration: false, added_dice: "1d8", per_levels: 2, extra_instances: 0, note: "+1d8 damage per TWO slot levels above 2nd - generated variants exist only at even slot levels" },
    UpcastDef { id: "scorching_ray", base_level: 2, effect: "damage", concentration: false, added_dice: "", per_levels: 1, extra_instances: 1, note: "one extra ray per slot level above 2nd" },
    UpcastDef { id: "shatter", base_level: 2, effect: "damage", concentration: false, added_dice: "1d8", per_levels: 1, extra_instances: 0, note: "+1d8 damage per slot level above 2nd" },
    UpcastDef { id: "fireball", base_level: 3, effect: "damage", concentration: false, added_dice: "1d6", per_levels: 1, extra_instances: 0, note: "+1d6 damage per slot level above 3rd" },
    UpcastDef { id: "lightning_bolt", base_level: 3, effect: "damage", concentration: false, added_dice: "1d6", per_levels: 1, extra_instances: 0, note: "+1d6 damage per slot level above 3rd" },
    UpcastDef { id: "spirit_guardians", base_level: 3, effect: "damage", concentration: true, added_dice: "1d8", per_levels: 1, extra_instances: 0, note: "+1d8 damage per slot level above 3rd" },
    UpcastDef { id: "cone_of_cold", base_level: 5, effect: "damage", concentration: false, added_dice: "1d8", per_levels: 1, extra_instances: 0, note: "+1d8 damage per slot level above 5th" },
    UpcastDef { id: "hold_person", base_level: 2, effect: "utility", concentration: true, added_dice: "", per_levels: 1, extra_instances: 1, note: "one extra humanoid target per slot level above 2nd (host enumerates targets)" },
    UpcastDef { id: "hold_monster", base_level: 5, effect: "utility", concentration: true, added_dice: "", per_levels: 1, extra_instances: 1, note: "one extra target per slot level above 5th (host enumerates targets)" },
    UpcastDef { id: "web", base_level: 2, effect: "utility", concentration: true, added_dice: "", per_levels: 1, extra_instances: 0, note: "no upcast effect" },
    UpcastDef { id: "blindness_deafness", base_level: 2, effect: "utility", concentration: false, added_dice: "", per_levels: 1, extra_instances: 1, note: "one extra target per slot level above 2nd (host enumerates targets)" },
    UpcastDef { id: "slow", base_level: 3, effect: "utility", concentration: true, added_dice: "", per_levels: 1, extra_instances: 0, note: "no upcast effect" },
    UpcastDef { id: "bless", base_level: 1, effect: "utility", concentration: true, added_dice: "", per_levels: 1, extra_instances: 1, note: "one extra creature per slot level above 1st" },
    UpcastDef { id: "bane", base_level: 1, effect: "utility", concentration: true, added_dice: "", per_levels: 1, extra_instances: 1, note: "one extra creature per slot level above 1st" },
    UpcastDef { id: "hex", base_level: 1, effect: "utility", concentration: true, added_dice: "", per_levels: 1, extra_instances: 0, note: "higher slots extend duration (host policy)" },
    UpcastDef { id: "charm_person", base_level: 1, effect: "utility", concentration: false, added_dice: "", per_levels: 1, extra_instances: 1, note: "one extra creature per slot level above 1st" },
    UpcastDef { id: "sleep", base_level: 1, effect: "utility", concentration: false, added_dice: "2d8", per_levels: 1, extra_instances: 0, note: "+2d8 to the hit-point pool per slot level above 1st" },
    UpcastDef { id: "faerie_fire", base_level: 1, effect: "utility", concentration: true, added_dice: "", per_levels: 1, extra_instances: 0, note: "no upcast effect" },
    UpcastDef { id: "hunters_mark", base_level: 1, effect: "utility", concentration: true, added_dice: "", per_levels: 1, extra_instances: 0, note: "higher slots extend duration (host policy)" },
];

fn upcast_def(spell_id: &str) -> Option<&'static UpcastDef> {
    let id = norm_id(spell_id);
    SPELL_UPCAST.iter().find(|d| d.id == id)
}

/// Split a dice equation 'NdS' / 'NdS+M' / 'NdS-M' into (count, sides_str,
/// mod_str) - the TS DICE_RE `^([0-9]+)d([0-9]+)([+-][0-9]+)?$` exactly,
/// keeping sides + modifier as strings so reassembly is byte-faithful.
/// `None` when the string does not match (including count overflow).
fn parse_dice(eq: &str) -> Option<(i64, &str, &str)> {
    let d_pos = eq.find('d')?;
    let count_str = &eq[..d_pos];
    if count_str.is_empty() || !count_str.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let rest = &eq[d_pos + 1..];
    let sides_len = rest.bytes().position(|b| !b.is_ascii_digit()).unwrap_or(rest.len());
    if sides_len == 0 {
        return None;
    }
    let sides_str = &rest[..sides_len];
    let mod_str = &rest[sides_len..];
    if !mod_str.is_empty() {
        let mb = mod_str.as_bytes();
        if mb.len() < 2 || (mb[0] != b'+' && mb[0] != b'-') || !mb[1..].iter().all(|b| b.is_ascii_digit()) {
            return None;
        }
    }
    let count = count_str.parse::<i64>().ok()?;
    Some((count, sides_str, mod_str))
}

pub fn spell_requires_concentration(spell_id: &str) -> bool {
    upcast_def(spell_id).map(|d| d.concentration).unwrap_or(false)
}

pub fn spell_base_level(spell_id: &str) -> Option<i64> {
    upcast_def(spell_id).map(|d| d.base_level)
}

/// Resolve the upcast effect of casting `spell_id` with a slot of
/// `cast_slot_level`. The cast level is clamped into base_level..=9 (an
/// under-level request casts at base). Unknown spell -> `None`.
pub fn upcast_effect(spell_id: &str, cast_slot_level: i64) -> Option<UpcastInfo> {
    let def = upcast_def(spell_id)?;
    let cast = cast_slot_level.clamp(def.base_level, MAX_SLOT_LEVEL);
    let above = cast - def.base_level;
    let steps = if def.per_levels > 0 { above / def.per_levels } else { 0 };
    let mut added_dice = String::new();
    if !def.added_dice.is_empty() && steps > 0 {
        if let Some((count, sides, _)) = parse_dice(def.added_dice) {
            added_dice = format!("{}d{}", count.saturating_mul(steps), sides);
        }
    }
    let extra = if def.extra_instances > 0 { def.extra_instances.saturating_mul(above) } else { 0 };
    Some(UpcastInfo {
        spell_id: def.id,
        base_level: def.base_level,
        cast_level: cast,
        levels_above: above,
        effect: def.effect,
        concentration: def.concentration,
        added_dice,
        extra_instances: extra,
        note: def.note,
    })
}

/// Total damage/heal dice for a cast: `base_dice` plus the upcast's added
/// dice. Only same-sided dice merge (every SRD entry here adds the same die
/// as its base); anything else returns `base_dice` unchanged. The base
/// equation's flat modifier (if any) is preserved once, never scaled.
pub fn total_dice_for_cast(base_dice: &str, spell_id: &str, cast_slot_level: i64) -> String {
    let (base_count, base_sides, base_mod) = match parse_dice(base_dice) {
        Some(m) => m,
        None => return base_dice.to_string(),
    };
    let info = match upcast_effect(spell_id, cast_slot_level) {
        Some(i) => i,
        None => return base_dice.to_string(),
    };
    if info.added_dice.is_empty() {
        return base_dice.to_string();
    }
    let (added_count, added_sides, added_mod) = match parse_dice(&info.added_dice) {
        Some(m) => m,
        None => return base_dice.to_string(),
    };
    if !added_mod.is_empty() || added_sides != base_sides {
        return base_dice.to_string();
    }
    format!("{}d{}{}", base_count.saturating_add(added_count), base_sides, base_mod)
}

#[cfg(test)]
mod tests {
    // Mirrors tests/srd5e-spell-slots.test.ts.
    use super::*;

    fn pool(entries: &[(i64, i64, i64)], pact: Option<(i64, i64, i64)>) -> SlotPool {
        let mut p = SlotPool::default();
        for (lvl, max, used) in entries {
            p.levels.insert(*lvl, SlotEntry { max: *max, used: *used });
        }
        if let Some((slot_level, max, used)) = pact {
            p.pact = Some(PactEntry { slot_level, max, used });
        }
        p
    }

    #[test]
    fn caster_taxonomy_and_ability() {
        assert_eq!(MAX_SLOT_LEVEL, 9);
        assert_eq!(caster_kind("wizard"), Some(CasterKind::Full));
        assert_eq!(caster_kind("cleric"), Some(CasterKind::Full));
        assert_eq!(caster_kind("paladin"), Some(CasterKind::Half));
        assert_eq!(caster_kind("ranger"), Some(CasterKind::Half));
        assert_eq!(caster_kind("warlock"), Some(CasterKind::Pact));
        assert_eq!(caster_kind("fighter"), None);
        assert_eq!(caster_kind("  Wizard  "), Some(CasterKind::Full)); // normalizes
        assert!(is_caster("druid"));
        assert!(!is_caster("rogue"));
        assert_eq!(spell_ability_for_class("wizard"), Some("int"));
        assert_eq!(spell_ability_for_class("cleric"), Some("wis"));
        assert_eq!(spell_ability_for_class("warlock"), Some("cha"));
        assert_eq!(spell_ability_for_class("paladin"), Some("cha"));
        assert_eq!(spell_ability_for_class("barbarian"), None);
    }

    // Codex audit P2: a malformed pool must not mint slots.
    #[test]
    fn audit_malformed_pool_clamped() {
        let bad = pool(&[(1, 1, -100)], None);
        assert_eq!(slot_available(&bad, 1), 1, "negative used clamps to 0");
        assert_eq!(slots_remaining(&bad).get(&1).copied(), Some(1));
        let s1 = spend_slot(&bad, 1);
        assert!(s1.ok);
        assert_eq!(slot_available(&s1.slots, 1), 0, "the one real slot is spent");
        assert!(!spend_slot(&s1.slots, 1).ok, "no phantom slots remain");
        assert_eq!(slot_available(&pool(&[(2, 2, 9)], None), 2), 0, "used over max clamps down");
        // A valid pool sanitizes byte-identical.
        let clean = spell_slots_for("wizard", 5);
        assert_eq!(sanitize_slot_pool(&clean), clean);
        assert_eq!(sanitize_slot_pool(&bad), pool(&[(1, 1, 0)], None));
    }

    #[test]
    fn srd_slot_tables() {
        assert_eq!(spell_slots_for("wizard", 1), pool(&[(1, 2, 0)], None));
        assert_eq!(spell_slots_for("wizard", 5), pool(&[(1, 4, 0), (2, 3, 0), (3, 2, 0)], None));
        assert_eq!(
            spell_slots_for("wizard", 20),
            pool(
                &[(1, 4, 0), (2, 3, 0), (3, 3, 0), (4, 3, 0), (5, 3, 0), (6, 2, 0), (7, 2, 0), (8, 1, 0), (9, 1, 0)],
                None
            )
        );
        // Half casters lag: nothing at 1, 2 first-level slots at 2.
        assert_eq!(spell_slots_for("paladin", 1), SlotPool::default());
        assert_eq!(spell_slots_for("paladin", 2), pool(&[(1, 2, 0)], None));
        assert_eq!(
            spell_slots_for("ranger", 20),
            pool(&[(1, 4, 0), (2, 3, 0), (3, 3, 0), (4, 3, 0), (5, 2, 0)], None)
        );
        // Pact ladder: level/count milestones.
        assert_eq!(spell_slots_for("warlock", 1), pool(&[], Some((1, 1, 0))));
        assert_eq!(spell_slots_for("warlock", 2), pool(&[], Some((1, 2, 0))));
        assert_eq!(spell_slots_for("warlock", 5), pool(&[], Some((3, 2, 0))));
        assert_eq!(spell_slots_for("warlock", 9), pool(&[], Some((5, 2, 0))));
        assert_eq!(spell_slots_for("warlock", 11), pool(&[], Some((5, 3, 0))));
        assert_eq!(spell_slots_for("warlock", 17), pool(&[], Some((5, 4, 0))));
        // Non-caster: empty. Level clamps into 1..20.
        assert_eq!(spell_slots_for("fighter", 10), SlotPool::default());
        assert_eq!(spell_slots_for("wizard", 0), spell_slots_for("wizard", 1));
        assert_eq!(spell_slots_for("wizard", 25), spell_slots_for("wizard", 20));
    }

    #[test]
    fn highest_and_available_pact_included() {
        assert_eq!(highest_slot_level(&spell_slots_for("wizard", 5)), 3);
        assert_eq!(highest_slot_level(&spell_slots_for("warlock", 9)), 5);
        assert_eq!(highest_slot_level(&SlotPool::default()), 0);
        let p = pool(&[(3, 2, 1)], Some((3, 2, 0)));
        assert_eq!(slot_available(&p, 3), 3); // numeric remainder + matching pact remainder
        assert_eq!(slot_available(&p, 2), 0);
    }

    #[test]
    fn spend_slot_pure_exact_level_numeric_before_pact() {
        let p = spell_slots_for("wizard", 5);
        let pre = p.clone();
        let r = spend_slot(&p, 3);
        assert!(r.ok);
        assert_eq!(r.reason, SpendReason::Ok);
        assert_eq!(r.slot_level, Some(3));
        assert_eq!(r.slots.levels.get(&3).map(|e| e.used), Some(1));
        assert_eq!(p, pre, "input pool never mutated");
        // Exact level only - a dry tier does NOT walk up.
        let dry = pool(&[(1, 2, 2), (2, 3, 0)], None);
        let r2 = spend_slot(&dry, 1);
        assert!(!r2.ok);
        assert_eq!(r2.reason, SpendReason::NoSlot);
        assert_eq!(r2.slot_level, None);
        assert_eq!(r2.slots, dry, "failed spend returns the pool unchanged");
        // Numeric tier spends before a matching pact tier.
        let mixed = pool(&[(3, 1, 0)], Some((3, 2, 0)));
        let r3 = spend_slot(&mixed, 3);
        assert_eq!(r3.slots.levels.get(&3).map(|e| e.used), Some(1));
        assert_eq!(r3.slots.pact.map(|x| x.used), Some(0));
        // Reason taxonomy.
        assert_eq!(spend_slot(&p, 0).reason, SpendReason::NotASlot);
        assert_eq!(spend_slot(&p, 10).reason, SpendReason::BadSlotLevel);
        assert_eq!(spend_slot(&p, -1).reason, SpendReason::BadSlotLevel);
    }

    #[test]
    fn spend_lowest_walks_up_and_reports_no_higher_slot() {
        let p = pool(&[(1, 2, 2), (2, 3, 3), (3, 2, 0)], None);
        let r = spend_lowest_available(&p, 1);
        assert!(r.ok);
        assert_eq!(r.slot_level, Some(3), "walks past two dry tiers");
        let all_dry = pool(&[(1, 2, 2)], None);
        let r2 = spend_lowest_available(&all_dry, 1);
        assert!(!r2.ok);
        assert_eq!(r2.reason, SpendReason::NoHigherSlot);
        // Pact tiers join the walk.
        let pact = spell_slots_for("warlock", 5);
        let r3 = spend_lowest_available(&pact, 1);
        assert_eq!(r3.slot_level, Some(3));
        assert_eq!(r3.slots.pact.map(|x| x.used), Some(1));
        assert_eq!(spend_lowest_available(&p, 0).reason, SpendReason::NotASlot);
        assert_eq!(spend_lowest_available(&p, 11).reason, SpendReason::BadSlotLevel);
    }

    #[test]
    fn restore_floors_at_zero_and_remaining_merges_pact() {
        let p = pool(&[(2, 3, 2)], None);
        assert_eq!(restore_slot(&p, 2, 1), pool(&[(2, 3, 1)], None));
        assert_eq!(restore_slot(&p, 2, 5), pool(&[(2, 3, 0)], None));
        assert_eq!(restore_slot(&p, 7, 1), p, "unknown level is a no-op");
        let pact = pool(&[], Some((3, 2, 2)));
        assert_eq!(restore_slot(&pact, 3, 1), pool(&[], Some((3, 2, 1))));
        let mixed = pool(&[(1, 4, 1), (3, 1, 0)], Some((3, 2, 1)));
        let rem = slots_remaining(&mixed);
        assert_eq!(rem.get(&1), Some(&3));
        assert_eq!(rem.get(&3), Some(&2), "pact remainder merges into its slot level");
        assert_eq!(rem.len(), 2);
    }

    #[test]
    fn rests_long_all_short_pact_only() {
        assert_eq!(long_rest("wizard", 4), spell_slots_for("wizard", 4));
        let wiz = pool(&[(1, 4, 3)], None);
        assert_eq!(short_rest("wizard", 5, &wiz), wiz, "wizard short rest is a no-op");
        let lock = pool(&[], Some((3, 2, 2)));
        assert_eq!(short_rest("warlock", 5, &lock), pool(&[], Some((3, 2, 0))));
        assert_eq!(lock, pool(&[], Some((3, 2, 2))), "input never mutated");
    }

    #[test]
    fn widen_merge_shape_fresh_used_carries_capped() {
        // Level-up: a new tier appears; spent slots stay spent.
        let stored = pool(&[(1, 4, 4), (2, 3, 1)], None);
        assert_eq!(
            widen_slots(Some(&stored), "wizard", 5),
            pool(&[(1, 4, 4), (2, 3, 1), (3, 2, 0)], None)
        );
        // Carried used caps at the NEW max (corrupt / downleveled stores self-heal).
        assert_eq!(
            widen_slots(Some(&pool(&[(1, 2, 7)], None)), "wizard", 1),
            pool(&[(1, 2, 2)], None)
        );
        // Stored tiers absent from the fresh shape are dropped.
        assert_eq!(
            widen_slots(Some(&pool(&[(9, 1, 1)], None)), "wizard", 1),
            pool(&[(1, 2, 0)], None)
        );
        // Non-caster / unknown class: stored returns untouched (value-identical).
        let nc = pool(&[(1, 4, 2)], None);
        assert_eq!(widen_slots(Some(&nc), "fighter", 5), nc);
        // None / empty stored: fresh pool.
        assert_eq!(widen_slots(None, "wizard", 3), spell_slots_for("wizard", 3));
        assert_eq!(widen_slots(Some(&SlotPool::default()), "wizard", 3), spell_slots_for("wizard", 3));
        // Pact shape re-derives; pact used carries.
        assert_eq!(
            widen_slots(Some(&pool(&[], Some((1, 2, 1)))), "warlock", 5),
            pool(&[], Some((3, 2, 1)))
        );
        // Class-shape switch: a stored numeric pool widened as a warlock yields
        // the pure pact shape (stored numeric tiers drop - shape is the CURRENT class).
        assert_eq!(
            widen_slots(Some(&pool(&[(1, 2, 1)], None)), "warlock", 5),
            pool(&[], Some((3, 2, 0)))
        );
        // Purity: stored is never mutated.
        let pre = stored.clone();
        widen_slots(Some(&stored), "wizard", 9);
        assert_eq!(stored, pre);
    }

    #[test]
    fn upcast_ladder_and_total_dice() {
        assert_eq!(spell_base_level("fireball"), Some(3));
        assert_eq!(spell_base_level("nonsense"), None);
        assert!(spell_requires_concentration("witch_bolt"));
        assert!(spell_requires_concentration("hold_person"));
        assert!(!spell_requires_concentration("fireball"));
        assert!(!spell_requires_concentration("nonsense"));
        // Clamping: under base casts at base; over 9 clamps to 9.
        let low = upcast_effect("fireball", 1).expect("fireball");
        assert_eq!(low.cast_level, 3);
        assert_eq!(low.levels_above, 0);
        assert_eq!(low.added_dice, "");
        let high = upcast_effect("fireball", 12).expect("fireball");
        assert_eq!(high.cast_level, 9);
        assert_eq!(high.added_dice, "6d6");
        // Per-TWO-levels step (spiritual_weapon): odd levels do not step.
        let sw3 = upcast_effect("spiritual_weapon", 3).expect("sw3");
        assert_eq!(sw3.added_dice, "", "slot 3 is below the first even step");
        let sw4 = upcast_effect("spiritual_weapon", 4).expect("sw4");
        assert_eq!(sw4.added_dice, "1d8");
        // Instance scaling (darts / rays / targets).
        assert_eq!(upcast_effect("magic_missile", 5).expect("mm").extra_instances, 4);
        assert_eq!(upcast_effect("scorching_ray", 4).expect("sr").extra_instances, 2);
        // The no-document entries still carry ladder data.
        let bless = upcast_effect("bless", 3).expect("bless");
        assert_eq!(bless.extra_instances, 2);
        assert!(bless.concentration);
        assert_eq!(upcast_effect("sleep", 2).expect("sleep").added_dice, "2d8");
        // total_dice_for_cast merges same-sided dice and preserves a flat mod once.
        assert_eq!(total_dice_for_cast("8d6", "fireball", 5), "10d6");
        assert_eq!(total_dice_for_cast("8d6", "fireball", 3), "8d6");
        assert_eq!(total_dice_for_cast("1d12", "witch_bolt", 4), "4d12");
        assert_eq!(total_dice_for_cast("1d8", "spiritual_weapon", 6), "3d8");
        assert_eq!(total_dice_for_cast("2d10+3", "hellish_rebuke", 2), "3d10+3", "flat modifier preserved once");
        assert_eq!(total_dice_for_cast("1d4", "magic_missile", 9), "1d4", "instance upcasts never touch dice");
        assert_eq!(total_dice_for_cast("3d8", "nonsense", 5), "3d8", "unknown spell passes base through");
        assert_eq!(total_dice_for_cast("garbage", "fireball", 5), "garbage", "non-dice base passes through");
    }
}
