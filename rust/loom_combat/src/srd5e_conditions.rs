//! srd5e_conditions - 5e condition tables: advantage/disadvantage mapping,
//! STR/DEX save auto-fail, and reaction denial (content pack).
//!
//! The Rust port of the TS reference `src/runtime/srd5e-conditions.ts`.
//! Engine-side, conditions are world-state TAGS: the same lowercase ids feed
//! has_tag arms inside pack documents (auto-fail expressed in data) AND this
//! module (for host resolvers). PURE: no RNG, no state - this module computes
//! the advantage/disadvantage MODE only. The extra-die mechanic itself
//! (rolling a second d20 and keeping one) is NOT expressible in AST v2 (no
//! max/min op), so it stays a host-side resolver concern. NEVER PANICS on
//! external paths - inputs coerce fail-soft.
//!
//! Content: the 5e RAW condition rules from the SRD 5.1 (CC-BY-4.0) - see
//! NOTICE.md. Tables are mechanics-only id lists; no SRD prose.

/// Attacks AGAINST a target with any of these have advantage.
pub const ADV_AGAINST_TARGET: [&str; 4] = ["restrained", "stunned", "paralyzed", "unconscious"];

/// An ATTACKER with any of these has disadvantage on attack rolls.
pub const DISADV_ON_ATTACKER: [&str; 4] = ["poisoned", "frightened", "restrained", "prone"];

/// These auto-fail STRENGTH and DEXTERITY saving throws (and only those).
pub const AUTO_FAIL_STR_DEX: [&str; 3] = ["paralyzed", "stunned", "unconscious"];

/// These deny reactions (the SRD incapacitated family - an incapacitated
/// creature takes no actions or reactions).
pub const INCAPACITATED_NO_REACTION: [&str; 5] =
    ["paralyzed", "stunned", "unconscious", "incapacitated", "petrified"];

/// The advantage/disadvantage MODE of one attack roll.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AdvMode {
    Adv,
    Dis,
}

impl AdvMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            AdvMode::Adv => "adv",
            AdvMode::Dis => "dis",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct AdvDetail {
    pub adv_from: Vec<String>,
    pub dis_from: Vec<String>,
    pub cancelled: bool,
    pub prone_skipped: bool,
}

/// Normalize arbitrary condition ids: entries are trimmed, lowercased, empties
/// dropped, deduped in first-seen order. Unknown ids pass through (the tables
/// simply never match them). For a comma-separated single string, see
/// `coerce_conditions_str`.
pub fn coerce_conditions<'a, I>(input: I) -> Vec<String>
where
    I: IntoIterator<Item = &'a str>,
{
    let mut out: Vec<String> = Vec::new();
    for raw in input {
        let id = raw.trim().to_lowercase();
        if id.is_empty() {
            continue;
        }
        if out.contains(&id) {
            continue;
        }
        out.push(id);
    }
    out
}

/// The one-string form: a (possibly comma-separated) condition list.
pub fn coerce_conditions_str(input: &str) -> Vec<String> {
    coerce_conditions(input.split(','))
}

fn has_cond(conds: &[String], id: &str) -> bool {
    conds.iter().any(|c| c == id)
}

/// The 5e RAW advantage/disadvantage mapping for ONE attack roll.
///
/// - Target conditions in `ADV_AGAINST_TARGET` grant advantage.
/// - Attacker conditions in `DISADV_ON_ATTACKER` impose disadvantage.
/// - A PRONE TARGET is split by range: melee attacks gain advantage, ranged
///   attacks suffer disadvantage - and when `is_melee` is `None` (the host
///   could not establish range), prone is SKIPPED entirely and flagged via
///   `detail.prone_skipped` (never guessed).
/// - Any advantage + any disadvantage CANCEL to a straight roll (5e RAW: they
///   never stack or outweigh) - mode `None` with `detail.cancelled` true.
pub fn attack_advantage_mode(
    attacker_conds: &[String],
    target_conds: &[String],
    is_melee: Option<bool>,
) -> (Option<AdvMode>, AdvDetail) {
    let mut adv_from: Vec<String> = Vec::new();
    let mut dis_from: Vec<String> = Vec::new();
    let mut prone_skipped = false;
    for id in ADV_AGAINST_TARGET.iter() {
        if has_cond(target_conds, id) {
            adv_from.push((*id).to_string());
        }
    }
    if has_cond(target_conds, "prone") {
        match is_melee {
            Some(true) => adv_from.push("prone".to_string()),
            Some(false) => dis_from.push("prone".to_string()),
            None => prone_skipped = true,
        }
    }
    for id in DISADV_ON_ATTACKER.iter() {
        if has_cond(attacker_conds, id) {
            dis_from.push((*id).to_string());
        }
    }
    let cancelled = !adv_from.is_empty() && !dis_from.is_empty();
    let mode = if !adv_from.is_empty() && dis_from.is_empty() {
        Some(AdvMode::Adv)
    } else if !dis_from.is_empty() && adv_from.is_empty() {
        Some(AdvMode::Dis)
    } else {
        None
    };
    (mode, AdvDetail { adv_from, dis_from, cancelled, prone_skipped })
}

/// Human-readable note for an attack roll's advantage state. `kept` (the die
/// kept) and `pair` (e.g. "17/9") are passed explicitly by the host that
/// rolled the extra die - this module never sees a roll object.
pub fn condition_roll_note(
    mode: Option<AdvMode>,
    detail: &AdvDetail,
    kept: Option<i64>,
    pair: Option<&str>,
) -> String {
    let mut note = String::new();
    match mode {
        Some(AdvMode::Adv) => {
            note = format!("advantage ({})", detail.adv_from.join(", "));
            if let (Some(k), Some(p)) = (kept, pair) {
                note = format!("{}: rolled {}, kept {}", note, p, k);
            }
        }
        Some(AdvMode::Dis) => {
            note = format!("disadvantage ({})", detail.dis_from.join(", "));
            if let (Some(k), Some(p)) = (kept, pair) {
                note = format!("{}: rolled {}, kept {}", note, p, k);
            }
        }
        None => {
            if detail.cancelled {
                note = format!(
                    "advantage ({}) and disadvantage ({}) cancel: straight roll",
                    detail.adv_from.join(", "),
                    detail.dis_from.join(", ")
                );
            }
        }
    }
    if detail.prone_skipped {
        if !note.is_empty() {
            note.push(' ');
        }
        note.push_str("[prone ignored: melee/ranged unknown]");
    }
    note
}

/// Lowercase, trim, and take the first 3 chars of an ability name ("strength"
/// -> "str"). Char-based, so it never panics on a UTF-8 boundary.
fn ability_prefix(save_ability: &str) -> String {
    save_ability.to_lowercase().trim().chars().take(3).collect()
}

/// The first target condition that auto-fails a STR or DEX save, or `None`.
/// Only STR/DEX saves auto-fail (5e RAW); every other ability returns `None`
/// regardless of conditions. Accepts "str"/"dex" or full ability names.
pub fn auto_fail_save_condition(save_ability: &str, target_conds: &[String]) -> Option<&'static str> {
    let a = ability_prefix(save_ability);
    if a != "str" && a != "dex" {
        return None;
    }
    AUTO_FAIL_STR_DEX.iter().find(|id| has_cond(target_conds, id)).copied()
}

/// The first condition that denies the entity its reaction, or `None`.
pub fn reaction_denied_by_conditions(target_conds: &[String]) -> Option<&'static str> {
    INCAPACITATED_NO_REACTION.iter().find(|id| has_cond(target_conds, id)).copied()
}

#[cfg(test)]
mod tests {
    // Mirrors tests/srd5e-conditions.test.ts.
    use super::*;

    fn conds(items: &[&str]) -> Vec<String> {
        coerce_conditions(items.iter().copied())
    }

    #[test]
    fn srd_tables() {
        assert_eq!(ADV_AGAINST_TARGET, ["restrained", "stunned", "paralyzed", "unconscious"]);
        assert_eq!(DISADV_ON_ATTACKER, ["poisoned", "frightened", "restrained", "prone"]);
        assert_eq!(AUTO_FAIL_STR_DEX, ["paralyzed", "stunned", "unconscious"]);
        assert_eq!(
            INCAPACITATED_NO_REACTION,
            ["paralyzed", "stunned", "unconscious", "incapacitated", "petrified"]
        );
    }

    #[test]
    fn coerce_is_fail_soft_and_normalizing() {
        assert_eq!(conds(&["Prone", " STUNNED ", "prone"]), vec!["prone", "stunned"]);
        assert_eq!(coerce_conditions_str("poisoned, frightened"), vec!["poisoned", "frightened"]);
        assert_eq!(conds(&["ok", "", "fine"]), vec!["ok", "fine"], "empties drop");
        assert_eq!(conds(&[]), Vec::<String>::new());
    }

    #[test]
    fn advantage_disadvantage_and_cancel() {
        let (mode, detail) = attack_advantage_mode(&conds(&[]), &conds(&["restrained"]), Some(true));
        assert_eq!(mode, Some(AdvMode::Adv));
        assert_eq!(
            detail,
            AdvDetail {
                adv_from: vec!["restrained".to_string()],
                dis_from: vec![],
                cancelled: false,
                prone_skipped: false
            }
        );

        let (mode, detail) = attack_advantage_mode(&conds(&["poisoned"]), &conds(&[]), Some(true));
        assert_eq!(mode, Some(AdvMode::Dis));
        assert_eq!(detail.dis_from, vec!["poisoned".to_string()]);

        // Both sides present: 5e RAW cancel to a straight roll (never stack).
        let (mode, detail) =
            attack_advantage_mode(&conds(&["frightened"]), &conds(&["stunned", "paralyzed"]), Some(true));
        assert_eq!(mode, None);
        assert!(detail.cancelled);
        assert_eq!(detail.adv_from, vec!["stunned".to_string(), "paralyzed".to_string()]);
        assert_eq!(detail.dis_from, vec!["frightened".to_string()]);

        // No conditions at all.
        let (mode, detail) = attack_advantage_mode(&conds(&[]), &conds(&[]), None);
        assert_eq!(mode, None);
        assert!(!detail.cancelled);

        // A restrained ATTACKER has disadvantage; a restrained TARGET grants advantage.
        assert_eq!(attack_advantage_mode(&conds(&["restrained"]), &conds(&[]), Some(true)).0, Some(AdvMode::Dis));
        assert_eq!(attack_advantage_mode(&conds(&[]), &conds(&["restrained"]), None).0, Some(AdvMode::Adv));
    }

    #[test]
    fn prone_splits_by_range_unknown_range_skips() {
        // Melee vs prone: advantage.
        let (mode, detail) = attack_advantage_mode(&conds(&[]), &conds(&["prone"]), Some(true));
        assert_eq!(mode, Some(AdvMode::Adv));
        assert_eq!(detail.adv_from, vec!["prone".to_string()]);
        // Ranged vs prone: disadvantage.
        let (mode, detail) = attack_advantage_mode(&conds(&[]), &conds(&["prone"]), Some(false));
        assert_eq!(mode, Some(AdvMode::Dis));
        assert_eq!(detail.dis_from, vec!["prone".to_string()]);
        // Unknown range: prone is skipped, flagged, and decides NOTHING.
        let (mode, detail) = attack_advantage_mode(&conds(&[]), &conds(&["prone"]), None);
        assert_eq!(mode, None);
        assert!(detail.prone_skipped);
        assert!(detail.adv_from.is_empty());
        assert!(detail.dis_from.is_empty());
        // Skipped prone does not block other sources.
        let (mode, detail) = attack_advantage_mode(&conds(&[]), &conds(&["prone", "stunned"]), None);
        assert_eq!(mode, Some(AdvMode::Adv));
        assert!(detail.prone_skipped);
        // A prone ATTACKER is unconditional disadvantage (own-prone, not target-prone).
        let (mode, detail) = attack_advantage_mode(&conds(&["prone"]), &conds(&[]), None);
        assert_eq!(mode, Some(AdvMode::Dis));
        assert!(!detail.prone_skipped);
    }

    #[test]
    fn roll_note_strings() {
        let (mode, detail) = attack_advantage_mode(&conds(&[]), &conds(&["restrained", "stunned"]), Some(true));
        assert_eq!(
            condition_roll_note(mode, &detail, Some(17), Some("17/9")),
            "advantage (restrained, stunned): rolled 17/9, kept 17"
        );
        assert_eq!(
            condition_roll_note(mode, &detail, None, None),
            "advantage (restrained, stunned)",
            "kept/pair are optional"
        );
        let (mode, detail) = attack_advantage_mode(&conds(&["poisoned"]), &conds(&[]), Some(true));
        assert_eq!(
            condition_roll_note(mode, &detail, Some(4), Some("4/12")),
            "disadvantage (poisoned): rolled 4/12, kept 4"
        );
        let (mode, detail) = attack_advantage_mode(&conds(&["frightened"]), &conds(&["stunned"]), Some(true));
        assert_eq!(
            condition_roll_note(mode, &detail, None, None),
            "advantage (stunned) and disadvantage (frightened) cancel: straight roll"
        );
        let (mode, detail) = attack_advantage_mode(&conds(&[]), &conds(&["prone"]), None);
        assert_eq!(condition_roll_note(mode, &detail, None, None), "[prone ignored: melee/ranged unknown]");
        let (mode, detail) = attack_advantage_mode(&conds(&[]), &conds(&[]), Some(true));
        assert_eq!(condition_roll_note(mode, &detail, None, None), "");
    }

    #[test]
    fn auto_fail_only_fires_on_str_dex() {
        assert_eq!(auto_fail_save_condition("dex", &conds(&["paralyzed"])), Some("paralyzed"));
        assert_eq!(auto_fail_save_condition("str", &conds(&["unconscious"])), Some("unconscious"));
        assert_eq!(auto_fail_save_condition("strength", &conds(&["stunned"])), Some("stunned"));
        assert_eq!(auto_fail_save_condition("dexterity", &conds(&["stunned"])), Some("stunned"));
        // Table order decides which condition is named first.
        assert_eq!(auto_fail_save_condition("dex", &conds(&["unconscious", "paralyzed"])), Some("paralyzed"));
        // WIS/CON/CHA/INT saves never auto-fail.
        assert_eq!(auto_fail_save_condition("wis", &conds(&["paralyzed"])), None);
        assert_eq!(auto_fail_save_condition("con", &conds(&["stunned", "unconscious"])), None);
        assert_eq!(auto_fail_save_condition("cha", &conds(&["paralyzed"])), None);
        // Non-auto-fail conditions return None even on DEX.
        assert_eq!(auto_fail_save_condition("dex", &conds(&["restrained", "prone"])), None);
        assert_eq!(auto_fail_save_condition("dex", &conds(&[])), None);
        assert_eq!(auto_fail_save_condition("", &conds(&["paralyzed"])), None);
    }

    #[test]
    fn reaction_denial_incapacitated_family() {
        assert_eq!(reaction_denied_by_conditions(&conds(&["stunned"])), Some("stunned"));
        assert_eq!(reaction_denied_by_conditions(&conds(&["petrified"])), Some("petrified"));
        assert_eq!(reaction_denied_by_conditions(&conds(&["incapacitated"])), Some("incapacitated"));
        assert_eq!(
            reaction_denied_by_conditions(&conds(&["paralyzed", "stunned"])),
            Some("paralyzed"),
            "table order decides"
        );
        assert_eq!(reaction_denied_by_conditions(&conds(&["prone", "restrained", "poisoned"])), None);
        assert_eq!(reaction_denied_by_conditions(&conds(&[])), None);
        assert_eq!(reaction_denied_by_conditions(&coerce_conditions_str("Stunned")), Some("stunned"));
    }
}
