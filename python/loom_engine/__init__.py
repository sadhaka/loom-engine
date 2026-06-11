"""loom_engine - deterministic TTRPG simulation core (Python surface).

Byte-parity Python port of the loom-engine TypeScript package (npm: loom-engine).
The deterministic primitives - range bands, reaction economy, narration contract,
5e/PF2e ruleset adapters - produce identical results to the TS engine for the
same inputs, so a Python-server resolution equals a TS-client one: the basis for
server-authoritative anti-cheat + honest AI-narrated play.

DETERMINISM NOTE: these modules use ordered dicts + explicit sorts for all LOGIC,
so they never depend on hash() ordering. Ban floats in deterministic paths; use an
explicit floor-div helper if negative-operand division is ever needed (JS truncates
toward zero, Python // floors).

For cross-language HASHING use the world_snapshot module (canonical_world_state /
world_state_hash). Do NOT use json.dumps(sort_keys=True): it sorts object keys by
Unicode code point and escapes non-ASCII, both of which DIVERGE from the engine's
canonical encoder (JS UTF-16 key sort + literal non-ASCII). The snapshot encoder
matches the TS/Rust core byte-for-byte (pinned by v3_0_snapshot_canonical.json).
"""

__version__ = "3.0.0"

from .range_bands import (  # noqa: F401
    RANGE_BAND_ENGAGED, RANGE_BAND_NEAR, RANGE_BAND_FAR, ENGAGED_MAX_FT,
    NEAR_MAX_FT, band_from_distance_ft, normalize_band, band_within,
    compare_bands, RangeBandField, RESOURCE_RANGE_BANDS,
)
from .reaction_economy import (  # noqa: F401
    REACTIONS_PER_ROUND, ReactionLedger, create_reaction_ledger, can_react,
    reactions_remaining, spend_reaction, advance_reaction_round,
    set_reaction_round, prune_stale_spends, clear_reactions,
    reaction_ledger_snapshot, RESOURCE_REACTION_ECONOMY,
)
from .narration_contract import (  # noqa: F401
    parse_number_word, extract_candidate_numbers, find_invented_number,
    is_narration_grounded, RESOURCE_NARRATION_CONTRACT,
)
from .ruleset import (  # noqa: F401
    RULESET_5E, RULESET_PF2E, start_turn_budget, can_spend, spend,
    initiative_order, create_condition_track, apply_condition,
    remove_condition, has_condition, condition_remaining, tick_conditions,
    active_conditions, DURATION_UNTIL_REMOVED, RESOURCE_RULESET,
)
from .world_snapshot import (  # noqa: F401
    SNAPSHOT_DOMAIN, canonical_world_state, world_state_hash,
    verify_world_snapshot, normalize_tags,
)
from .pcg32 import Pcg32, floor_div, floor_mod  # noqa: F401
from .ruleset_ast import (  # noqa: F401
    parse_dice, eval_expression, evaluate_action, apply_triggered_mutations,
    make_context, validate_check, validate_triggered_mutations,
)
from .world_epoch import (  # noqa: F401
    derive_epoch_prng, tick_epoch, catch_up_epochs,
    DEFAULT_ACTOR_TAG, RESOURCE_WORLD_EPOCH,
    REASON_UNKNOWN_ACTION, REASON_INVALID_ACTION, REASON_EVAL_ERROR,
)
from .srd5e_spell_slots import (  # noqa: F401
    MAX_SLOT_LEVEL, PACT_KEY, caster_kind, is_caster, spell_ability_for_class,
    spell_slots_for, highest_slot_level, slot_available, spend_slot,
    spend_lowest_available, restore_slot, slots_remaining, long_rest,
    short_rest, widen_slots, spell_requires_concentration, spell_base_level,
    upcast_effect, total_dice_for_cast,
)
from .srd5e_concentration import (  # noqa: F401
    CONCENTRATION_MIN_DC, maintain_save_dc, is_concentrating,
    start_concentration, drop_concentration, maintain_save,
)
from .srd5e_conditions import (  # noqa: F401
    ADV_AGAINST_TARGET, DISADV_ON_ATTACKER, AUTO_FAIL_STR_DEX,
    INCAPACITATED_NO_REACTION, coerce_conditions, attack_advantage_mode,
    condition_roll_note, auto_fail_save_condition, reaction_denied_by_conditions,
)
from .event_chain import (  # noqa: F401
    EventChain, verify_records, verify_seal, canonical_json,
    RECORD_DOMAIN, SEAL_DOMAIN, RESOURCE_EVENT_CHAIN,
)
from .world_session import (  # noqa: F401
    suspend, resume, replay_epoch_event, RESOURCE_WORLD_SESSION,
)
from .region_hash import (  # noqa: F401
    region_hash, region_leaves, global_region_hash, verify_region,
    RESOURCE_REGION_HASH,
)
from .region_sync import (  # noqa: F401
    DEFAULT_REGION_TAG_PREFIX, partition_regions, diff_region_leaves,
    apply_partial_sync, RESOURCE_REGION_SYNC,
)
from .srd5e_pack import (  # noqa: F401
    CANTRIPS, CLASS_CANTRIPS, LEVELED_SPELLS, CLASS_LEVELED_SPELLS,
    class_can_cast, cantrip_dice_count, eldritch_blast_beams, scaled_cantrip_dice,
    build_weapon_attack_check, build_attack_cantrip_check, build_save_cantrip_check,
    build_attack_spell_check, build_save_spell_check, build_multi_target_save_trigger,
    build_magic_missile_trigger, build_heal_trigger, build_condition_spell_check,
    plan_leveled_cast,
)
