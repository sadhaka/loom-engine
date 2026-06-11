//! loom_combat - deterministic combat primitives for the Loom Engine core.
//!
//! Pure, RNG-free logic ported from the TS (runtime/) + Python (loom_engine/)
//! reference surfaces: the per-round reaction ceiling and the 5e/PF2e ruleset
//! adapters (action economy, initiative ordering, conditions). The dice
//! themselves live in `loom_math`; these modules decide budgets, ordering, the
//! reaction ceiling, and condition durations.
//!
//! DETERMINISM: collections are `BTreeMap` (sorted iteration), the canonical
//! cross-language order - so a Rust snapshot is byte-stable and the TS/Python
//! surfaces sort their equivalent outputs to match (vs their current insertion
//! order). Integer math only; floats are denied at the crate root.
//!
//! Phase 2 of the Rust extraction (see ../../LOOM-RUST-EXTRACTION-SPEC.md).
//!
//! The SRD 5e action-pack pure modules (slot economy, concentration, condition
//! tables) live in the `srd5e_*` submodules - SRD 5.1 (CC-BY-4.0) mechanics
//! data, see NOTICE.md. Pinned by test_vectors/srd5e_pack_v1.json (the golden
//! harness lives in loom_ruleset/tests/golden_srd5e_pack.rs, next to the AST
//! executor the pack's action documents run through).

#![forbid(unsafe_code)]

pub mod srd5e_concentration;
pub mod srd5e_conditions;
pub mod srd5e_slots;

/// The per-round reaction ceiling: exactly one reaction per combatant per round.
pub mod reaction {
    use std::collections::BTreeMap;

    pub const REACTIONS_PER_ROUND: u32 = 1;

    /// `round` is 1-based. `spent` maps entity id -> the round it last spent its
    /// reaction; a stale prior-round record is inert (compared against `round`).
    #[derive(Clone, Debug)]
    pub struct ReactionLedger {
        pub round: u64,
        spent: BTreeMap<String, u64>,
    }

    impl ReactionLedger {
        pub fn new(round: u64) -> Self {
            ReactionLedger {
                round: if round > 0 { round } else { 1 },
                spent: BTreeMap::new(),
            }
        }

        pub fn can_react(&self, entity: &str) -> bool {
            if entity.is_empty() {
                return false;
            }
            self.spent.get(entity) != Some(&self.round)
        }

        pub fn reactions_remaining(&self, entity: &str) -> u32 {
            if self.can_react(entity) {
                REACTIONS_PER_ROUND
            } else {
                0
            }
        }

        /// Spend the reaction. `true` if spent, `false` if already spent this
        /// round (the ceiling) or the id is empty.
        pub fn spend(&mut self, entity: &str) -> bool {
            if entity.is_empty() || self.spent.get(entity) == Some(&self.round) {
                return false;
            }
            self.spent.insert(entity.to_string(), self.round);
            true
        }

        /// Advance to the next round; everyone refreshes. Returns the new round.
        pub fn advance_round(&mut self) -> u64 {
            self.round += 1;
            self.round
        }

        pub fn set_round(&mut self, round: u64) {
            if round > 0 {
                self.round = round;
            }
        }

        /// Drop spend-records older than the current round. Returns the count
        /// removed (behavior unchanged - stale records are already inert).
        pub fn prune_stale(&mut self) -> usize {
            let round = self.round;
            let stale: Vec<String> = self
                .spent
                .iter()
                .filter(|(_, &r)| r < round)
                .map(|(k, _)| k.clone())
                .collect();
            for k in &stale {
                self.spent.remove(k);
            }
            stale.len()
        }

        pub fn clear(&mut self) {
            self.spent.clear();
        }

        /// (entity, round) pairs in sorted order - the canonical snapshot.
        pub fn snapshot(&self) -> Vec<(String, u64)> {
            self.spent.iter().map(|(k, v)| (k.clone(), *v)).collect()
        }
    }
}

/// 5e + PF2e action economy, initiative ordering, and conditions.
pub mod ruleset {
    use std::collections::BTreeMap;

    pub const DURATION_UNTIL_REMOVED: i64 = -1;

    /// Per-turn starting budget. 5e: action+bonus+reaction. PF2e: 3 actions +
    /// reaction.
    pub fn start_turn_budget(ruleset: &str) -> BTreeMap<String, i64> {
        let mut m = BTreeMap::new();
        if ruleset == "pf2e" {
            m.insert("action".to_string(), 3);
            m.insert("reaction".to_string(), 1);
        } else {
            m.insert("action".to_string(), 1);
            m.insert("bonus".to_string(), 1);
            m.insert("reaction".to_string(), 1);
        }
        m
    }

    pub fn can_spend(budget: &BTreeMap<String, i64>, resource: &str, n: i64) -> bool {
        let need = if n > 0 { n } else { 1 };
        matches!(budget.get(resource), Some(&have) if have >= need)
    }

    /// Spend `n` (min 1) of a resource. `true` if spent, `false` if insufficient.
    pub fn spend(budget: &mut BTreeMap<String, i64>, resource: &str, n: i64) -> bool {
        let need = if n > 0 { n } else { 1 };
        if !can_spend(budget, resource, need) {
            return false;
        }
        if let Some(have) = budget.get_mut(resource) {
            *have -= need;
        }
        true
    }

    #[derive(Clone, Debug)]
    pub struct InitiativeEntry {
        pub id: String,
        pub total: i64,
        pub modifier: i64,
        pub d20: i64,
    }

    /// True iff `s` is a "pure numeric" id: an optional '-' then >=1 ASCII digit.
    fn is_pure_numeric(s: &str) -> bool {
        let b = s.as_bytes();
        let rest = if !b.is_empty() && b[0] == b'-' { &b[1..] } else { b };
        !rest.is_empty() && rest.iter().all(|c| c.is_ascii_digit())
    }

    /// (is_negative_nonzero, magnitude_digits_without_leading_zeros).
    fn normalize_numeric(s: &str) -> (bool, &str) {
        let neg = s.as_bytes().first() == Some(&b'-');
        let digits = if neg { &s[1..] } else { s };
        let trimmed = digits.trim_start_matches('0');
        let norm = if trimmed.is_empty() { "0" } else { trimmed };
        (neg && norm != "0", norm) // -0 is +0
    }

    /// Numeric-aware id comparison (Codex P1 / the shadow-wire finding). Numeric
    /// ids sort by VALUE (so 2 < 10, not "10" < "2"), strings lexicographically,
    /// numbers before strings. NO integer parsing - compares sign + digit-length +
    /// bytes, so ids beyond i64 (uuids, "9999...") are handled without overflow.
    /// Byte-for-byte identical across Rust / TS / Python (UTF-8 byte compares).
    pub fn compare_ids(a: &str, b: &str) -> core::cmp::Ordering {
        use core::cmp::Ordering;
        match (is_pure_numeric(a), is_pure_numeric(b)) {
            (true, false) => Ordering::Less,    // numbers sort before strings
            (false, true) => Ordering::Greater,
            (false, false) => a.as_bytes().cmp(b.as_bytes()), // lexicographic (UTF-8)
            (true, true) => {
                let (a_neg, a_mag) = normalize_numeric(a);
                let (b_neg, b_mag) = normalize_numeric(b);
                match (a_neg, b_neg) {
                    (false, true) => return Ordering::Greater, // +a > -b
                    (true, false) => return Ordering::Less,
                    _ => {}
                }
                let mag = a_mag
                    .len()
                    .cmp(&b_mag.len())
                    .then_with(|| a_mag.as_bytes().cmp(b_mag.as_bytes()));
                let by_value = if a_neg { mag.reverse() } else { mag }; // -100 < -9
                if by_value != Ordering::Equal {
                    by_value
                } else {
                    // math-equal (e.g. "02" vs "2"): raw bytes for a total order
                    a.as_bytes().cmp(b.as_bytes())
                }
            }
        }
    }

    /// Deterministic order: total DESC, modifier DESC, natural d20 DESC, then a
    /// NUMERIC-AWARE id tiebreak (compare_ids). One tiebreak correct for both 5e
    /// and PF2e and for integer ids AND string entity ids. Returns a new Vec.
    pub fn initiative_order(mut entries: Vec<InitiativeEntry>) -> Vec<InitiativeEntry> {
        entries.sort_by(|a, b| {
            b.total
                .cmp(&a.total)
                .then(b.modifier.cmp(&a.modifier))
                .then(b.d20.cmp(&a.d20))
                .then_with(|| compare_ids(&a.id, &b.id))
        });
        entries
    }

    /// Content-agnostic condition-duration tracker (caller supplies the names,
    /// so no SRD text lives here).
    #[derive(Clone, Debug, Default)]
    pub struct ConditionTrack {
        conds: BTreeMap<String, i64>,
    }

    impl ConditionTrack {
        pub fn new() -> Self {
            ConditionTrack { conds: BTreeMap::new() }
        }

        /// Apply / refresh. `rounds` of 0 (or via apply_until_removed) means
        /// "until removed".
        pub fn apply(&mut self, condition_id: &str, rounds: i64) {
            if condition_id.is_empty() {
                return;
            }
            let r = if rounds == 0 { DURATION_UNTIL_REMOVED } else { rounds };
            self.conds.insert(condition_id.to_string(), r);
        }

        pub fn apply_until_removed(&mut self, condition_id: &str) {
            self.apply(condition_id, DURATION_UNTIL_REMOVED);
        }

        pub fn remove(&mut self, condition_id: &str) -> bool {
            self.conds.remove(condition_id).is_some()
        }

        pub fn has(&self, condition_id: &str) -> bool {
            self.conds.contains_key(condition_id)
        }

        pub fn remaining(&self, condition_id: &str) -> i64 {
            *self.conds.get(condition_id).unwrap_or(&0)
        }

        /// Tick every FINITE condition down one round; expire (remove) any
        /// reaching 0. DURATION_UNTIL_REMOVED never ticks. Returns the expired
        /// ids in sorted order.
        pub fn tick(&mut self) -> Vec<String> {
            let mut expired: Vec<String> = Vec::new();
            for (id, rem) in self.conds.iter_mut() {
                if *rem == DURATION_UNTIL_REMOVED {
                    continue;
                }
                if *rem <= 1 {
                    expired.push(id.clone());
                } else {
                    *rem -= 1;
                }
            }
            for id in &expired {
                self.conds.remove(id);
            }
            expired
        }

        /// Active condition ids in sorted order.
        pub fn active(&self) -> Vec<String> {
            self.conds.keys().cloned().collect()
        }
    }
}

/// Grid-free relative positioning: Engaged / Near / Far per combatant pair.
///
/// CANONICAL UNIT: integer feet (no floats in the deterministic core). Real
/// TTRPG distances are integer feet; the float-feet TS/Python surfaces round to
/// integer feet at the source for byte-parity. Thresholds: <=5 Engaged, <=30
/// Near, else Far.
pub mod range_bands {
    use std::collections::BTreeMap;

    pub const ENGAGED: &str = "engaged";
    pub const NEAR: &str = "near";
    pub const FAR: &str = "far";
    pub const ENGAGED_MAX_FT: i64 = 5;
    pub const NEAR_MAX_FT: i64 = 30;

    /// Band from a distance in integer feet. Negative -> the neutral Near.
    pub fn band_from_distance_ft(feet: i64) -> &'static str {
        if feet < 0 {
            NEAR
        } else if feet <= ENGAGED_MAX_FT {
            ENGAGED
        } else if feet <= NEAR_MAX_FT {
            NEAR
        } else {
            FAR
        }
    }

    fn order(band: &str) -> Option<u8> {
        match band {
            "engaged" => Some(0),
            "near" => Some(1),
            "far" => Some(2),
            _ => None,
        }
    }

    /// True iff `band` is at least as close as `max_band` (engaged < near < far).
    pub fn band_within(band: &str, max_band: &str) -> bool {
        match (order(band), order(max_band)) {
            (Some(a), Some(b)) => a <= b,
            _ => false,
        }
    }

    /// Directed (source, target) -> band store. set_pair writes both directions
    /// symmetrically by default. BTreeMap keys -> sorted, deterministic iteration.
    #[derive(Clone, Debug, Default)]
    pub struct RangeBandField {
        bands: BTreeMap<(String, String), String>,
    }

    impl RangeBandField {
        pub fn new() -> Self {
            RangeBandField { bands: BTreeMap::new() }
        }

        pub fn set_pair_band(&mut self, a: &str, b: &str, band: &str, symmetric: bool) {
            if a.is_empty() || b.is_empty() || a == b || order(band).is_none() {
                return;
            }
            self.bands.insert((a.to_string(), b.to_string()), band.to_string());
            if symmetric {
                self.bands.insert((b.to_string(), a.to_string()), band.to_string());
            }
        }

        pub fn set_pair_distance(&mut self, a: &str, b: &str, feet: i64, symmetric: bool) {
            self.set_pair_band(a, b, band_from_distance_ft(feet), symmetric);
        }

        pub fn get_band(&self, source: &str, target: &str) -> Option<&str> {
            self.bands
                .get(&(source.to_string(), target.to_string()))
                .map(|s| s.as_str())
        }

        pub fn is_engaged(&self, a: &str, b: &str) -> bool {
            self.get_band(a, b) == Some(ENGAGED)
        }

        /// Targets within `max_band` of source (inclusive of closer), sorted.
        pub fn targets_within(&self, source: &str, max_band: &str) -> Vec<String> {
            let mut out = Vec::new();
            for ((src, tgt), band) in self.bands.iter() {
                if src == source && band_within(band, max_band) {
                    out.push(tgt.clone());
                }
            }
            out
        }

        pub fn engaged_with(&self, source: &str) -> Vec<String> {
            self.targets_within(source, ENGAGED)
        }

        pub fn clear(&mut self) {
            self.bands.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::range_bands::*;
    use super::reaction::*;
    use super::ruleset::*;

    #[test]
    fn reaction_ceiling() {
        let mut l = ReactionLedger::new(1);
        assert!(l.can_react("pc"));
        assert_eq!(l.reactions_remaining("pc"), 1);
        assert!(l.spend("pc"));
        assert!(!l.can_react("pc"));
        assert!(!l.spend("pc")); // the ceiling refuses the 2nd
        assert!(l.can_react("goblin")); // independent
        assert!(!l.spend("")); // empty no-op
    }

    #[test]
    fn reaction_round_refresh_and_stale_inert() {
        let mut l = ReactionLedger::new(1);
        l.spend("pc");
        assert_eq!(l.advance_round(), 2);
        assert!(l.can_react("pc")); // refreshed; round-1 record stale/inert
        assert!(l.spend("pc"));
        l.set_round(5);
        assert_eq!(l.prune_stale(), 1); // the round-2 record is now stale
        assert!(l.snapshot().is_empty());
    }

    #[test]
    fn action_economy_5e_and_pf2e() {
        let mut b5 = start_turn_budget("5e");
        assert!(spend(&mut b5, "action", 1));
        assert!(!spend(&mut b5, "action", 1)); // exhausted
        assert!(spend(&mut b5, "bonus", 1));

        let mut bp = start_turn_budget("pf2e");
        assert!(spend(&mut bp, "action", 1));
        assert!(spend(&mut bp, "action", 2));
        assert!(!spend(&mut bp, "action", 1)); // 0 left
        assert!(spend(&mut bp, "reaction", 1));
        assert!(!spend(&mut bp, "reaction", 1));
    }

    #[test]
    fn initiative_tiebreak() {
        let order = initiative_order(vec![
            InitiativeEntry { id: "c".into(), total: 18, modifier: 2, d20: 16 },
            InitiativeEntry { id: "a".into(), total: 18, modifier: 5, d20: 13 },
            InitiativeEntry { id: "b".into(), total: 12, modifier: 1, d20: 11 },
            InitiativeEntry { id: "d".into(), total: 18, modifier: 2, d20: 16 },
        ]);
        let ids: Vec<&str> = order.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "c", "d", "b"]);
    }

    #[test]
    fn conditions_tick_and_expire() {
        let mut t = ConditionTrack::new();
        t.apply("frightened", 2);
        t.apply("slowed", 1);
        t.apply_until_removed("doomed");
        assert_eq!(t.remaining("frightened"), 2);
        assert_eq!(t.remaining("doomed"), DURATION_UNTIL_REMOVED);
        assert_eq!(t.remaining("absent"), 0);
        assert_eq!(t.tick(), vec!["slowed".to_string()]); // expires at 0
        assert_eq!(t.remaining("frightened"), 1);
        assert_eq!(t.active(), vec!["doomed".to_string(), "frightened".to_string()]); // sorted
        assert_eq!(t.tick(), vec!["frightened".to_string()]);
        assert_eq!(t.active(), vec!["doomed".to_string()]); // until-removed survives
        assert!(t.remove("doomed"));
    }

    #[test]
    fn range_band_thresholds_and_field() {
        assert_eq!(band_from_distance_ft(0), ENGAGED);
        assert_eq!(band_from_distance_ft(5), ENGAGED);
        assert_eq!(band_from_distance_ft(6), NEAR);
        assert_eq!(band_from_distance_ft(30), NEAR);
        assert_eq!(band_from_distance_ft(31), FAR);
        assert_eq!(band_from_distance_ft(-10), NEAR); // defensive
        assert!(band_within("engaged", "near"));
        assert!(!band_within("far", "near"));

        let mut f = RangeBandField::new();
        f.set_pair_distance("pc", "goblin", 5, true);
        f.set_pair_distance("pc", "archer", 20, true);
        f.set_pair_distance("pc", "sniper", 60, true);
        assert_eq!(f.get_band("pc", "goblin"), Some(ENGAGED));
        assert_eq!(f.get_band("goblin", "pc"), Some(ENGAGED)); // symmetric
        assert!(f.is_engaged("pc", "goblin"));
        assert_eq!(f.engaged_with("pc"), vec!["goblin".to_string()]);
        let within_near = f.targets_within("pc", NEAR);
        assert_eq!(within_near, vec!["archer".to_string(), "goblin".to_string()]); // sorted
        assert_eq!(f.targets_within("pc", FAR).len(), 3);
        f.clear();
        assert_eq!(f.get_band("pc", "goblin"), None);
    }
}
