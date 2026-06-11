//! srd5e_concentration - the 5e concentration state machine (content pack).
//!
//! The Rust port of the TS reference `src/runtime/srd5e-concentration.ts`.
//! PURE and RNG-FREE BY DESIGN: the caller rolls the d20 CON save (via its
//! own AST check or host rng) and passes the TOTAL in - this module only
//! decides. The one-spell-at-a-time rule lives in `start_concentration`'s
//! `dropped` return. Pinned by test_vectors/srd5e_pack_v1.json (kind
//! 'concentration'). NEVER PANICS on external paths - every function is
//! total over its inputs.
//!
//! Content: mechanics from the D&D 5e System Reference Document 5.1
//! (CC-BY-4.0) - see NOTICE.md. DC = max(10, floor(damage / 2)), keep iff
//! total >= dc.

pub const CONCENTRATION_MIN_DC: i64 = 10;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConcentrationState {
    pub spell_id: String,
    pub spell_name: String,
    /// Absent in the wire shape when the cast had no slot (host convention).
    pub slot_level: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConcChange {
    pub concentration: Option<ConcentrationState>,
    pub dropped: Option<ConcentrationState>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MaintainResult {
    pub needed: bool,
    pub dc: i64,
    pub total: i64,
    pub success: bool,
    pub concentration: Option<ConcentrationState>,
    pub dropped: Option<ConcentrationState>,
}

/// The concentration save DC for taking `damage`: max(10, floor(damage / 2)).
/// `div_euclid(2)` IS floor division for a positive divisor - the same result
/// as the engine's shared floorDiv (toward -inf) on every surface.
pub fn maintain_save_dc(damage: i64) -> i64 {
    let half = damage.div_euclid(2);
    if half > CONCENTRATION_MIN_DC {
        half
    } else {
        CONCENTRATION_MIN_DC
    }
}

/// Concentrating iff a state is present with a non-empty spell_id (a blank
/// state is idle - mirrors the TS truthiness gate).
pub fn is_concentrating(c: Option<&ConcentrationState>) -> bool {
    c.map(|s| !s.spell_id.is_empty()).unwrap_or(false)
}

/// Begin concentrating on a spell. If already concentrating, the previous
/// spell DROPS (one spell at a time - 5e RAW) and is returned in `dropped`.
/// `spell_name` falls back to the id when absent or empty.
pub fn start_concentration(
    c: Option<&ConcentrationState>,
    spell_id: &str,
    spell_name: Option<&str>,
    slot_level: Option<i64>,
) -> ConcChange {
    let dropped = if is_concentrating(c) { c.cloned() } else { None };
    let name = match spell_name {
        Some(n) if !n.is_empty() => n.to_string(),
        _ => spell_id.to_string(),
    };
    ConcChange {
        concentration: Some(ConcentrationState {
            spell_id: spell_id.to_string(),
            spell_name: name,
            slot_level,
        }),
        dropped,
    }
}

/// Voluntarily (or forcibly) end concentration. No-op when not concentrating.
pub fn drop_concentration(c: Option<&ConcentrationState>) -> ConcChange {
    if !is_concentrating(c) {
        return ConcChange { concentration: None, dropped: None };
    }
    ConcChange { concentration: None, dropped: c.cloned() }
}

/// Resolve a concentration save after taking damage. The caller has already
/// rolled the d20 CON save and passes the TOTAL; this module compares it to
/// the DC. Keep iff total >= dc (exact direction - 5e RAW "DC or higher").
/// Not concentrating: nothing is needed and nothing can drop (the input
/// state, possibly idle, passes through unchanged).
pub fn maintain_save(
    c: Option<&ConcentrationState>,
    damage: i64,
    con_save_total: i64,
) -> MaintainResult {
    let dc = maintain_save_dc(damage);
    if !is_concentrating(c) {
        return MaintainResult {
            needed: false,
            dc,
            total: con_save_total,
            success: true,
            concentration: c.cloned(),
            dropped: None,
        };
    }
    if con_save_total >= dc {
        MaintainResult {
            needed: true,
            dc,
            total: con_save_total,
            success: true,
            concentration: c.cloned(),
            dropped: None,
        }
    } else {
        MaintainResult {
            needed: true,
            dc,
            total: con_save_total,
            success: false,
            concentration: None,
            dropped: c.cloned(),
        }
    }
}

#[cfg(test)]
mod tests {
    // Mirrors tests/srd5e-concentration.test.ts.
    use super::*;

    fn state(id: &str, name: &str, slot: Option<i64>) -> ConcentrationState {
        ConcentrationState { spell_id: id.to_string(), spell_name: name.to_string(), slot_level: slot }
    }

    #[test]
    fn dc_is_max_10_floor_half_damage() {
        assert_eq!(CONCENTRATION_MIN_DC, 10);
        assert_eq!(maintain_save_dc(0), 10);
        assert_eq!(maintain_save_dc(1), 10);
        assert_eq!(maintain_save_dc(19), 10);
        assert_eq!(maintain_save_dc(20), 10);
        assert_eq!(maintain_save_dc(21), 10, "floor(21/2) = 10, still the floor");
        assert_eq!(maintain_save_dc(22), 11);
        assert_eq!(maintain_save_dc(23), 11, "round DOWN, never up");
        assert_eq!(maintain_save_dc(36), 18);
        assert_eq!(maintain_save_dc(100), 50);
        assert_eq!(maintain_save_dc(-9), 10, "negative damage still floors at 10");
    }

    #[test]
    fn is_concentrating_gate() {
        assert!(!is_concentrating(None));
        assert!(!is_concentrating(Some(&state("", "", None))));
        assert!(is_concentrating(Some(&state("web", "Web", None))));
    }

    #[test]
    fn start_drops_the_previous_spell() {
        let first = start_concentration(None, "bless", Some("Bless"), Some(1));
        assert_eq!(first.concentration, Some(state("bless", "Bless", Some(1))));
        assert_eq!(first.dropped, None);
        let second =
            start_concentration(first.concentration.as_ref(), "witch_bolt", Some("Witch Bolt"), Some(2));
        assert_eq!(second.concentration, Some(state("witch_bolt", "Witch Bolt", Some(2))));
        assert_eq!(second.dropped, Some(state("bless", "Bless", Some(1))));
        // spell_name defaults to the id; slot_level only appears when supplied.
        let bare = start_concentration(None, "hex", None, None);
        assert_eq!(bare.concentration, Some(state("hex", "hex", None)));
    }

    #[test]
    fn drop_concentration_flow() {
        let idle = drop_concentration(None);
        assert_eq!(idle.concentration, None);
        assert_eq!(idle.dropped, None);
        let c = state("web", "Web", Some(2));
        let r = drop_concentration(Some(&c));
        assert_eq!(r.concentration, None);
        assert_eq!(r.dropped, Some(c.clone()));
    }

    #[test]
    fn maintain_save_boundaries_keep_iff_total_gte_dc() {
        let c = state("hold_person", "Hold Person", Some(2));
        let pre = c.clone();
        // Exactly the DC keeps.
        let keep = maintain_save(Some(&c), 22, 11);
        assert_eq!(
            keep,
            MaintainResult {
                needed: true,
                dc: 11,
                total: 11,
                success: true,
                concentration: Some(c.clone()),
                dropped: None,
            }
        );
        // One under drops.
        let fail = maintain_save(Some(&c), 22, 10);
        assert!(!fail.success);
        assert_eq!(fail.concentration, None);
        assert_eq!(fail.dropped, Some(c.clone()));
        // Small damage still floors the DC at 10.
        let floor = maintain_save(Some(&c), 3, 9);
        assert_eq!(floor.dc, 10);
        assert!(!floor.success);
        // Not concentrating: nothing needed, nothing drops, success true.
        let idle = maintain_save(None, 30, 1);
        assert_eq!(
            idle,
            MaintainResult { needed: false, dc: 15, total: 1, success: true, concentration: None, dropped: None }
        );
        // Purity: the caller's state is never mutated (refs in, clones out).
        assert_eq!(c, pre);
    }
}
