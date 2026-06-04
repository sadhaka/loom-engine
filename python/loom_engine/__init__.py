"""loom_engine - deterministic TTRPG simulation core (Python surface).

Byte-parity Python port of the loom-engine TypeScript package (npm: loom-engine).
The deterministic primitives - range bands, reaction economy, narration contract,
5e/PF2e ruleset adapters - produce identical results to the TS engine for the
same inputs, so a Python-server resolution equals a TS-client one: the basis for
server-authoritative anti-cheat + honest AI-narrated play.

DETERMINISM NOTE: these modules use ordered dicts + explicit sorts for all LOGIC,
so they never depend on hash() ordering. For any cross-language HASHING, serialize
with json.dumps(obj, sort_keys=True, separators=(',', ':')) and run with
PYTHONHASHSEED=0. Ban floats in deterministic paths; use an explicit floor-div
helper if negative-operand division is ever needed (JS truncates toward zero,
Python // floors).
"""

__version__ = "2.3.0"

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
