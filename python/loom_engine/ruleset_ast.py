"""ruleset_ast - deterministic data-driven ruleset interpreter (Python port).

Byte-identical to the TS ruleset-ast.ts (and the forthcoming Rust port). The
ruleset is a strict JSON AST the engine EVALUATES, never code it executes - so any
system (5e, PF2e, homebrew) runs with no untrusted-code risk. Composes the
parity-proven pcg32 (Pcg32) + floor_div + the world_snapshot canonical encoder.

v1 baseline (pinned by test_vectors/v3_ast_bleed.json):
  - integer-only; a dice equation with '.' is rejected; literals are JS-safe ints.
  - all randomness via the seeded Pcg32; dice roll die-by-die so the FIRST
    individual die is the natural roll (NOT the sum), in a fixed PRNG order.
  - the only division is floor_div (toward -inf); no native division node.
  - mul cannot persist -0 (Python ints have no -0, matching the TS normalize).
  - a STATIC validation pass runs BEFORE any rng draw or mutation, so a rejected
    AST advances neither - the reject boundary is byte-identical across surfaces.

AST v2 (docs/specs/AST-V2-SPEC.md, pinned by test_vectors/ast_v2_families.json) -
six additive families; every v1 document evaluates byte-identically:
  A. nat_roll_gte / nat_roll_lte - natural-roll range conditions (spec 2). A
     null natural is FALSE, never vacuously true; a zero-sides first die SETS
     natural to 0 (a real value).
  B. and - boolean conjunction. Short-circuit is NORMATIVE for `and` AND the
     v1 `or` (throw-vs-result is observable - spec 3.2). An EMPTY `and`
     rejects at validation (vacuous truth is fail-open); an empty `or` stays
     accepted (evaluates false), exactly as v1 shipped.
  C. compare / has_tag - RNG-free state conditions (spec 4). Operands are a
     CLOSED set (roll/dc/delta/natural/prop/literal) - no dice, no math. Both
     operands always resolve, left then right; null never skips; uniform
     false-on-null for all six ops. has_tag reads live tags in BOTH contexts.
  D. if - conditional mutations; the untaken branch is completely inert
     (zero PRNG, zero state - spec 5).
  E. foreach_target - bounded multi-target scope: tag SELECT (re-run on EVERY
     execution), UTF-16 code-unit ORDER, limit TRUNCATE, per-execution
     SNAPSHOT, fresh dice per iteration; `each` target ref with a STATIC
     scope rule (spec 6). MAX_WORLD_ENTITIES is a runtime cap at SELECT.
  F. repeat - bounded literal-count iteration, fresh dice per pass (spec 7).
  Budgets (spec 8): ONE document-global accumulator (nodes / dice / applied)
  threads the entire walk - roll, dc, and EVERY degree branch CHARGE though at
  most one EXECUTES; static multiplicity M multiplies dice + applied charges
  inside foreach/repeat bodies, with an immediate reject when M' > 1024.
  Validation contexts (spec 1.1): check-only quantities (roll/dc/delta/
  natural) REJECT in trigger context. Numbers validate by VALUE after JSON
  parsing (spec 1.4): an integral float (json.loads of `3.0`) IS that integer
  at every assert_int site, repeat.count, and select.limit. Extra (unlisted)
  fields are IGNORED - not walked, not validated, charging no budget.
  Fail-closed reject-unknown everywhere, unchanged.
"""

import copy
import re

from .pcg32 import Pcg32, floor_div
from .world_snapshot import normalize_tags

MAX_INT = 9007199254740991  # 2^53 - 1
MAX_EXPR_DEPTH = 16          # bounds 3 independent counters: expression, condition, mutation-structure depth (spec 8.3)
MAX_NODES = 256
MAX_DICE_TOTAL = 1000        # v2: charged count * M, summed document-globally
MAX_TARGETS = 32             # v2: hard cap on one foreach_target's entities; also the default limit
MAX_ITERATIONS = 16          # v2: hard cap on a repeat node's count
MAX_APPLIED_MUTATIONS = 1024  # v2: worst-case leaf-mutation applications at multiplicity M, document-global
MAX_WORLD_ENTITIES = 65536   # v2: RUNTIME cap on working-state entity count at foreach_target SELECT (spec 8.7)
# Codex audit P2: cap property/tag name length so a valid AST cannot smuggle a
# multi-megabyte name past the node/dice budgets. Counted in UTF-16 code units
# (JS string .length) for byte-identical limits across TS, Python, and Rust.
MAX_NAME_LEN = 256
DEGREE_ORDER = ["critical_success", "success", "failure", "critical_failure"]

_DICE_RE = re.compile(r"^([0-9]+)d([0-9]+)([+-][0-9]+)?$")

_MISSING = object()  # distinguishes an ABSENT property (reads 0) from a present non-integer (throws)


def _assert_int(n, what):
    if isinstance(n, bool):
        raise ValueError("AST: %s must be a JS-safe integer: %r" % (what, n))
    if isinstance(n, float):
        if not n.is_integer():
            raise ValueError("AST: %s must be a JS-safe integer: %r" % (what, n))
        n = int(n)
    if not isinstance(n, int) or abs(n) > MAX_INT:
        raise ValueError("AST: %s must be a JS-safe integer: %r" % (what, n))
    return n  # Python int has no -0; mul(0,-1) == 0


def _safe_int_value(n):
    """Number.isSafeInteger analog, judged by VALUE after JSON parsing (spec 1.4).
    Returns the normalized int, or None when n is not an integral JS-safe number
    (json.loads of a lexical `3.0` yields float 3.0 - that IS the integer 3)."""
    if isinstance(n, bool):
        return None
    if isinstance(n, int):
        return n if abs(n) <= MAX_INT else None
    if isinstance(n, float) and n.is_integer() and abs(int(n)) <= MAX_INT:
        return int(n)
    return None


def _assert_clean_string(s):
    # Reject lone surrogates (a proper astral scalar like U+1F40D has no surrogate
    # code points in a Python str, so it passes) - matches event-chain assertCleanString.
    for ch in s:
        if 0xD800 <= ord(ch) <= 0xDFFF:
            raise ValueError("AST: string contains a lone surrogate")
    # Round-7 audit HIGH (instance #5 of the NFC class): a property/tag NAME must
    # also be NFC, exactly like the TS assertCleanName -> assertCleanString path.
    # Without this a non-NFC name ("cafe" + U+0301) signed two ways and forked
    # the chain at the AST mutation gate across producers that normalize
    # differently. REJECT (never silently normalize a player's name).
    import unicodedata as _ud
    if not _ud.is_normalized("NFC", s):
        raise ValueError(
            "AST: non-NFC name (normalize to NFC first)")


def _utf16_key(s):
    # UTF-16 code-unit sort key - the SAME comparator canonical JSON object keys
    # and normalize_tags use ("one sort rule everywhere" - spec 6.2 step 2). NOT
    # code-point order and NOT the numeric-aware compare_ids: "e10" < "e2".
    # surrogatepass so a lone-surrogate id still sorts by its code units,
    # exactly like the JS default string sort.
    return s.encode("utf-16-be", "surrogatepass")


def parse_dice(equation):
    if not isinstance(equation, str) or "." in equation:
        raise ValueError("AST: dice equation must be a decimal-free string: %r" % (equation,))
    m = _DICE_RE.match(equation)
    if not m:
        raise ValueError("AST: invalid dice equation: %r" % (equation,))
    count = int(m.group(1))
    sides = int(m.group(2))
    mod = int(m.group(3)) if m.group(3) else 0
    if count < 0 or count > 100 or sides < 0 or sides > 100000:
        raise ValueError("AST: dice out of bounds: %r" % (equation,))
    # Codex P1b: the modifier + the whole result range [count+mod .. count*sides+mod]
    # must stay JS-safe, else eval rolls (advancing the PRNG) before _assert_int throws
    # on the unsafe sum - breaking the fail-closed / zero-rng contract. parse_dice runs
    # during validation (before any draw), so reject here. Python ints are exact.
    if abs(mod) > MAX_INT or abs(count * sides + mod) > MAX_INT or abs(count + mod) > MAX_INT:
        raise ValueError("AST: dice modifier/result out of safe-integer range: %r" % (equation,))
    return {"count": count, "sides": sides, "mod": mod}


def _resolve_target(t, ctx):
    if t in ("actor", "self"):
        return ctx["actor"]
    if t == "target":
        if ctx.get("target") is None:
            raise ValueError("AST: action references target but none supplied")
        return ctx["target"]
    if t == "each":
        # The static scope rule (spec 6.3) makes a missing binding unreachable
        # post-validation; keep the defensive throw so a bug can never silently
        # alias an entity.
        if ctx.get("each_id") is None:
            raise ValueError("AST: target ref each has no foreach_target binding")
        return ctx["each_id"]
    raise ValueError("AST: unknown target ref: %r" % (t,))


def _ensure_entity(state, eid):
    ent = state["entities"].get(eid)
    if ent is None:
        ent = {"properties": {}, "tags": []}
        state["entities"][eid] = ent
    return ent


def _read_prop(state, eid, prop):
    """The ONE property-read boundary shared by prop_ref and compare `prop`
    operands (spec 4.2 step 1): live working state; a missing entity or
    property reads 0; a PRESENT non-integer value (e.g. a JSON null in a
    hand-built state) hits the same assert_int choke point as the TS reference
    (undefined -> 0, null -> throw)."""
    ent = state["entities"].get(eid)
    props = ent.get("properties") if ent else None
    v = props.get(prop, _MISSING) if props else _MISSING
    return _assert_int(0 if v is _MISSING else v, "property " + prop)


def eval_expression(node, ctx, depth=0):
    if depth > MAX_EXPR_DEPTH:
        raise ValueError("AST: expression exceeds max depth %d" % MAX_EXPR_DEPTH)
    if not isinstance(node, dict) or not isinstance(node.get("type"), str):
        raise ValueError("AST: malformed expression node")
    t = node["type"]
    if t == "literal":
        return _assert_int(node["value"], "literal")
    if t == "dice":
        p = parse_dice(node["equation"])
        # Roll die-by-die so the FIRST INDIVIDUAL die is the natural roll - NOT
        # the sum. A zero-sides first die SETS natural to 0 (roll_die(0) is
        # still CALLED, returns 0, consumes zero PRNG draws) - spec 2.2, vector A5.
        total = 0
        for _ in range(p["count"]):
            one = ctx["rng"].roll_die(p["sides"])
            if ctx["natural"] is None:
                ctx["natural"] = one  # first INDIVIDUAL die = the natural roll
            total += one
        return _assert_int(total + p["mod"], "dice result")
    if t == "prop_ref":
        eid = _resolve_target(node["target"], ctx)
        return _read_prop(ctx["state"], eid, node["property"])
    if t == "math":
        left = eval_expression(node["left"], ctx, depth + 1)   # LEFT first - PRNG order
        right = eval_expression(node["right"], ctx, depth + 1)
        op = node["op"]
        if op == "add":
            out = left + right
        elif op == "sub":
            out = left - right
        elif op == "mul":
            out = left * right
        elif op == "floor_div":
            out = floor_div(left, right)
        else:
            raise ValueError("AST: unknown math op: %r" % (op,))
        return _assert_int(out, "math result")
    raise ValueError("AST: unknown expression node type: %r" % (t,))


# ---- Condition matching ------------------------------------------------------

def _require_q(q, what):
    """Validation rejects check-only quantities in trigger context (spec 1.1),
    so this guard is defensive (unreachable post-validation), not a reject path."""
    if q is None:
        raise ValueError("AST: %s is not valid in trigger context" % what)
    return q


def _resolve_operand(opnd, ctx, q):
    """Resolve one compare operand to an integer, or None (only possible via
    `natural` on a diceless roll). Pure: zero PRNG, zero state change."""
    if not isinstance(opnd, dict) or not isinstance(opnd.get("source"), str):
        raise ValueError("AST: malformed compare operand")
    s = opnd["source"]
    if s == "roll":
        return _require_q(q, "compare operand source roll")["roll"]
    if s == "dc":
        return _require_q(q, "compare operand source dc")["dc"]
    if s == "delta":
        return _require_q(q, "compare operand source delta")["delta"]
    if s == "natural":
        return _require_q(q, "compare operand source natural")["natural"]
    if s == "prop":
        eid = _resolve_target(opnd["target"], ctx)
        return _read_prop(ctx["state"], eid, opnd["property"])
    if s == "literal":
        return _assert_int(opnd["value"], "compare literal operand")
    raise ValueError("AST: unknown compare operand source: %r" % (s,))


def _match_condition(cond, ctx, q, depth):
    """Match one condition. Pure: conditions consume ZERO PRNG and change ZERO
    state, always (spec 8.4 rule 3). `and`/`or` MUST short-circuit - a decided
    conjunction/disjunction never evaluates, resolves operands for, or throws
    from any later child (spec 3.2: throw-vs-result is observable)."""
    if depth > MAX_EXPR_DEPTH:
        raise ValueError("AST: degree condition exceeds max depth %d" % MAX_EXPR_DEPTH)
    if not isinstance(cond, dict) or not isinstance(cond.get("type"), str):
        raise ValueError("AST: malformed degree condition")
    t = cond["type"]
    if t == "delta_gte":
        return _require_q(q, "delta_gte")["delta"] >= _assert_int(cond["value"], "delta_gte")
    if t == "delta_lte":
        return _require_q(q, "delta_lte")["delta"] <= _assert_int(cond["value"], "delta_lte")
    if t == "nat_roll_eq":
        n = _require_q(q, "nat_roll_eq")["natural"]
        return n is not None and n == _assert_int(cond["value"], "nat_roll_eq")
    if t == "nat_roll_gte":
        # null natural is FALSE - never an error, never vacuously true (spec 2.2).
        n = _require_q(q, "nat_roll_gte")["natural"]
        return n is not None and n >= _assert_int(cond["value"], "nat_roll_gte")
    if t == "nat_roll_lte":
        n = _require_q(q, "nat_roll_lte")["natural"]
        return n is not None and n <= _assert_int(cond["value"], "nat_roll_lte")
    if t == "or":
        if not isinstance(cond.get("conditions"), list):
            raise ValueError("AST: or condition requires a conditions array")
        for sub in cond["conditions"]:
            if _match_condition(sub, ctx, q, depth + 1):
                return True  # short-circuit on first TRUE child
        return False  # empty `or` evaluates FALSE (v1 behavior, kept - spec 3.2)
    if t == "and":
        if not isinstance(cond.get("conditions"), list):
            raise ValueError("AST: and requires a non-empty conditions array")
        for sub in cond["conditions"]:
            if not _match_condition(sub, ctx, q, depth + 1):
                return False  # short-circuit on first FALSE child
        return True  # empty array is rejected at validation (fail-OPEN otherwise)
    if t == "compare":
        # Resolve left fully, THEN right fully - BOTH operands are ALWAYS
        # resolved, in that order, normatively. A null left does NOT skip the
        # right (a missing-target throw there must still fire) - spec 4.2 step 1.
        lv = _resolve_operand(cond["left"], ctx, q)
        rv = _resolve_operand(cond["right"], ctx, q)
        # Uniform false-on-null for ALL six ops, including ne (spec 4.2 step 2).
        if lv is None or rv is None:
            return False
        op = cond["op"]
        if op == "gt":
            return lv > rv
        if op == "gte":
            return lv >= rv
        if op == "lt":
            return lv < rv
        if op == "lte":
            return lv <= rv
        if op == "eq":
            return lv == rv
        if op == "ne":
            return lv != rv
        raise ValueError("AST: unknown compare op: %r" % (op,))
    if t == "has_tag":
        # Tag analog of missing-reads-are-zero: a missing entity has no tags ->
        # FALSE, never an error. Live working state; exact string equality - the
        # identical membership test foreach_target SELECT applies (spec 4.6).
        tid = _resolve_target(cond["target"], ctx)
        tent = ctx["state"]["entities"].get(tid)
        if not tent or not isinstance(tent.get("tags"), list):
            return False
        return cond["tag"] in tent["tags"]
    raise ValueError("AST: unknown degree condition: %r" % (t,))


# ---- Mutation application ----------------------------------------------------

def _apply_mutation_into(node, ctx, q, applied):
    """Apply one mutation node (leaf or structural) to the working state,
    appending leaf AppliedMutation records to `applied` in exact application
    order. Structural nodes (if / foreach_target / repeat) emit NO record."""
    if not isinstance(node, dict) or not isinstance(node.get("type"), str):
        raise ValueError("AST: malformed mutation node")
    t = node["type"]
    if t in ("set_prop", "add_prop", "sub_prop"):
        eid = _resolve_target(node["target"], ctx)
        ent = _ensure_entity(ctx["state"], eid)
        value = eval_expression(node["value"], ctx)
        # Codex audit P1: the previous-value read must use the SAME boundary as
        # prop_ref and compare `prop` - missing reads 0, a PRESENT non-integer
        # (including null) throws. The old `.get() or 0` conflated a missing key
        # with a present JSON null (both -> 0), forking from TS (recorded null)
        # and Rust (rejected). _read_prop is that one shared boundary.
        prev = _read_prop(ctx["state"], eid, node["property"])
        if t == "set_prop":
            nxt = value
        elif t == "add_prop":
            nxt = prev + value
        else:
            nxt = prev - value
        final = _assert_int(nxt, "mutated property " + node["property"])
        ent["properties"][node["property"]] = final
        applied.append({"target": eid, "property": node["property"], "op": t, "previous": prev, "next": final})
        return
    if t == "add_tag":
        eid = _resolve_target(node["target"], ctx)
        ent = _ensure_entity(ctx["state"], eid)
        ent["tags"] = normalize_tags(ent["tags"] + [node["tag"]])
        applied.append({"target": eid, "tag": node["tag"], "op": "add_tag"})
        return
    if t == "remove_tag":
        eid = _resolve_target(node["target"], ctx)
        ent = _ensure_entity(ctx["state"], eid)
        ent["tags"] = [x for x in ent["tags"] if x != node["tag"]]
        applied.append({"target": eid, "tag": node["tag"], "op": "remove_tag"})
        return
    if t == "if":
        # Evaluate the condition exactly once, against the LIVE working state and
        # the FROZEN check quantities. The untaken branch is completely inert:
        # zero PRNG, zero state (spec 5.2, vector D3).
        if _match_condition(node["condition"], ctx, q, 0):
            taken = node["then"]
        else:
            taken = node["else"] if "else" in node else []
        for sub in taken:
            _apply_mutation_into(sub, ctx, q, applied)
        return
    if t == "foreach_target":
        # SELECT - re-run on EVERY execution of this node (spec 6.2 step 1,
        # vector E7); caching a selection across executions desynchronizes the
        # dice stream. Entity cap is a RUNTIME bound: the document budgets
        # cannot see state size (spec 8.7).
        entities = ctx["state"]["entities"]
        all_ids = list(entities.keys())
        if len(all_ids) > MAX_WORLD_ENTITIES:
            raise ValueError("AST: world entity count %d exceeds MAX_WORLD_ENTITIES (%d) at foreach_target select"
                             % (len(all_ids), MAX_WORLD_ENTITIES))
        tag = node["select"]["tag"]
        matched = []
        for cid in all_ids:
            cand = entities.get(cid)
            if cand and isinstance(cand.get("tags"), list) and tag in cand["tags"]:
                matched.append(cid)
        # ORDER: ascending UTF-16 code units - the SAME comparator canonical JSON
        # keys and normalize_tags use. NOT numeric-aware: "e10" < "e2" (vector E4).
        matched.sort(key=_utf16_key)
        # TRUNCATE: keep the deterministic prefix; over-matching is NOT an error.
        lim = int(node["select"]["limit"]) if "limit" in node["select"] else MAX_TARGETS
        if len(matched) > lim:
            matched = matched[:lim]
        # SNAPSHOT: membership and order are FIXED for this execution (vector E3).
        # ITERATE: `each` binds to the innermost enclosing foreach_target; fresh
        # value-expression evaluation (dice re-roll) per target (spec 6.2 step 5).
        prev_each = ctx.get("each_id")
        for eid in matched:
            ctx["each_id"] = eid
            for sub in node["mutations"]:
                _apply_mutation_into(sub, ctx, q, applied)
        ctx["each_id"] = prev_each
        return
    if t == "repeat":
        # Exactly count passes, in order; no early exit, no condition. Value
        # expressions evaluate FRESH each pass (spec 7.2).
        for _ in range(int(node["count"])):
            for sub in node["mutations"]:
                _apply_mutation_into(sub, ctx, q, applied)
        return
    raise ValueError("AST: unknown mutation node type: %r" % (t,))


# ---- Static validation pass (validate BEFORE any rng draw / mutation) --------
#
# Walks the entire AST once, touching NO rng and NO state, and rejects fail-closed
# on: unknown node / condition / mutation / operand types, non-integer values
# (judged by VALUE after JSON parsing - spec 1.4), over-depth subtrees (three
# independent counters share MAX_EXPR_DEPTH: expression, condition, and the NEW
# mutation-structure depth - spec 8.3), a non-array or.conditions, an EMPTY
# and.conditions, malformed dice, unclean / __proto__ names, check-only
# quantities in trigger context (spec 1.1), `each` outside any foreach_target
# body (static scope rule - spec 6.3), bad repeat counts / select limits, and
# the document-global budgets: nodes, dice (charged count * M), applied
# mutations (charged M per leaf), and the multiplicity cap M' <= 1024 at every
# body entry (spec 8.2). Extra (unlisted) fields are IGNORED: not walked, not
# validated, charging no budget (spec 1.4, vector D5).

def _bump_node(w):
    w["nodes"] += 1
    if w["nodes"] > MAX_NODES:
        raise ValueError("AST: node budget exceeded (max %d)" % MAX_NODES)


def _charge_dice(w, count, m):
    w["dice"] += count * m
    if w["dice"] > MAX_DICE_TOTAL:
        raise ValueError("AST: total dice count exceeds budget %d" % MAX_DICE_TOTAL)


def _charge_applied(w, m):
    w["applied"] += m
    if w["applied"] > MAX_APPLIED_MUTATIONS:
        raise ValueError("AST: applied-mutation budget exceeded (max %d)" % MAX_APPLIED_MUTATIONS)


def _validate_target_ref(t, each_ok):
    # `each` is a STATIC scope rule (spec 6.3): legal only lexically inside some
    # foreach_target.mutations subtree (each_ok threads that fact).
    if t in ("actor", "self", "target"):
        return
    if t == "each":
        if each_ok:
            return
        raise ValueError("AST: target ref each is only valid inside a foreach_target body")
    raise ValueError("AST: unknown target ref: %r" % (t,))


def _assert_clean_name(s, what):
    if not isinstance(s, str) or len(s) == 0:
        raise ValueError("AST: %s name must be a non-empty string" % what)
    if s == "__proto__":
        raise ValueError('AST: %s name "__proto__" is forbidden' % what)
    # Codex audit P2: bound name length in UTF-16 code units (JS .length) so a
    # huge property/tag name cannot pass the node/dice budgets. len(str) counts
    # code points, so measure UTF-16 units explicitly for cross-surface parity.
    if len(s.encode("utf-16-le")) // 2 > MAX_NAME_LEN:
        raise ValueError("AST: %s name exceeds max length %d" % (what, MAX_NAME_LEN))
    _assert_clean_string(s)


def _validate_expr(node, w, depth, m, each_ok):
    _bump_node(w)
    if depth > MAX_EXPR_DEPTH:
        raise ValueError("AST: expression exceeds max depth %d" % MAX_EXPR_DEPTH)
    if not isinstance(node, dict) or not isinstance(node.get("type"), str):
        raise ValueError("AST: malformed expression node")
    t = node["type"]
    if t == "literal":
        _assert_int(node.get("value"), "literal")
        return
    if t == "dice":
        p = parse_dice(node.get("equation"))  # dry-run: throws on float / junk / out-of-bounds
        _charge_dice(w, p["count"], m)        # v2: charged at static multiplicity M (spec 8.2 rule 2)
        return
    if t == "prop_ref":
        _validate_target_ref(node.get("target"), each_ok)
        _assert_clean_name(node.get("property"), "property")
        return
    if t == "math":
        if node.get("op") not in ("add", "sub", "mul", "floor_div"):
            raise ValueError("AST: unknown math op: %r" % (node.get("op"),))
        _validate_expr(node.get("left"), w, depth + 1, m, each_ok)
        _validate_expr(node.get("right"), w, depth + 1, m, each_ok)
        return
    raise ValueError("AST: unknown expression node type: %r" % (t,))


def _validate_operand(opnd, w, each_ok):
    # Compare operands are leaves: 1 node each, no depth (spec 4.3).
    _bump_node(w)
    if not isinstance(opnd, dict) or not isinstance(opnd.get("source"), str):
        raise ValueError("AST: malformed compare operand")
    s = opnd["source"]
    if s in ("roll", "dc", "delta", "natural"):
        if w["trigger"]:
            raise ValueError("AST: compare operand source %s is not valid in trigger context" % s)
        return
    if s == "prop":
        _validate_target_ref(opnd.get("target"), each_ok)
        _assert_clean_name(opnd.get("property"), "property")
        return
    if s == "literal":
        _assert_int(opnd.get("value"), "compare literal operand")
        return
    raise ValueError("AST: unknown compare operand source: %r" % (s,))


def _validate_degree_cond(cond, w, depth, each_ok):
    _bump_node(w)
    if depth > MAX_EXPR_DEPTH:
        raise ValueError("AST: degree condition exceeds max depth %d" % MAX_EXPR_DEPTH)
    if not isinstance(cond, dict) or not isinstance(cond.get("type"), str):
        raise ValueError("AST: malformed degree condition")
    t = cond["type"]
    if t in ("delta_gte", "delta_lte", "nat_roll_eq", "nat_roll_gte", "nat_roll_lte"):
        # Check-only quantities DO NOT EXIST in trigger context (spec 1.1).
        if w["trigger"]:
            raise ValueError("AST: %s is not valid in trigger context" % t)
        _assert_int(cond.get("value"), t)
        return
    if t == "or":
        # Empty `or` stays ACCEPTED (evaluates false - fail-closed in spirit),
        # exactly as v1 shipped it. The and/or asymmetry is deliberate (spec 3.2).
        if not isinstance(cond.get("conditions"), list):
            raise ValueError("AST: or condition requires a conditions array")
        for sub in cond["conditions"]:
            _validate_degree_cond(sub, w, depth + 1, each_ok)
        return
    if t == "and":
        # An empty `and` would be vacuously TRUE (fail-OPEN) -> REJECT (spec 3.2).
        if not isinstance(cond.get("conditions"), list) or len(cond["conditions"]) == 0:
            raise ValueError("AST: and requires a non-empty conditions array")
        for sub in cond["conditions"]:
            _validate_degree_cond(sub, w, depth + 1, each_ok)
        return
    if t == "compare":
        if cond.get("op") not in ("gt", "gte", "lt", "lte", "eq", "ne"):
            raise ValueError("AST: unknown compare op: %r" % (cond.get("op"),))
        _validate_operand(cond.get("left"), w, each_ok)
        _validate_operand(cond.get("right"), w, each_ok)
        return
    if t == "has_tag":
        # Valid in BOTH contexts - it reads only state, never check quantities.
        _validate_target_ref(cond.get("target"), each_ok)
        _assert_clean_name(cond.get("tag"), "tag")
        return
    raise ValueError("AST: unknown degree condition: %r" % (t,))


def _validate_mutation(node, w, mdepth, m, each_ok):
    _bump_node(w)
    if not isinstance(node, dict) or not isinstance(node.get("type"), str):
        raise ValueError("AST: malformed mutation node")
    t = node["type"]
    if t in ("set_prop", "add_prop", "sub_prop"):
        _validate_target_ref(node.get("target"), each_ok)
        _assert_clean_name(node.get("property"), "property")
        _validate_expr(node.get("value"), w, 0, m, each_ok)
        _charge_applied(w, m)  # leaf mutation: M applied units (spec 8.2 rule 3)
        return
    if t in ("add_tag", "remove_tag"):
        _validate_target_ref(node.get("target"), each_ok)
        _assert_clean_name(node.get("tag"), "tag")
        _charge_applied(w, m)
        return
    if t == "if":
        # Full context table applies to the condition; BOTH branches are charged
        # at the UNCHANGED M - the static pass never reasons about which branch
        # runs (spec 5.3, 8.2 rule 6). The structural node charges no applied units.
        _validate_degree_cond(node.get("condition"), w, 0, each_ok)
        if not isinstance(node.get("then"), list):
            raise ValueError("AST: if.then must be a mutation array")
        _validate_mutation_list(node["then"], w, mdepth + 1, m, each_ok)
        if "else" in node:
            if not isinstance(node["else"], list):
                raise ValueError("AST: if.else must be a mutation array")
            _validate_mutation_list(node["else"], w, mdepth + 1, m, each_ok)
        return
    if t == "foreach_target":
        sel = node.get("select")
        if not isinstance(sel, dict):
            raise ValueError("AST: foreach_target.select must be an object")
        _assert_clean_name(sel.get("tag"), "tag")
        lim = MAX_TARGETS
        if "limit" in sel:
            # Integer-ness judged by VALUE after JSON parsing (spec 1.4): a lexical
            # 2.0 IS the integer 2. 0 / negatives / non-integral / > 32 all reject -
            # the cap is a validation-time constant, never a runtime clamp of the
            # LIMIT itself (only the matched SET truncates at runtime).
            lv = _safe_int_value(sel["limit"])
            if lv is None or lv < 1 or lv > MAX_TARGETS:
                raise ValueError("AST: foreach_target select.limit must be an integer in 1..%d" % MAX_TARGETS)
            lim = lv
        # Multiplicity: reject IMMEDIATELY at body entry when M' overruns - this
        # also caps M itself at 1024, so the algebra can never overflow (spec 8.2
        # rule 4).
        m_foreach = m * lim
        if m_foreach > MAX_APPLIED_MUTATIONS:
            raise ValueError("AST: applied-mutation budget exceeded (max %d): foreach_target multiplicity %d"
                             % (MAX_APPLIED_MUTATIONS, m_foreach))
        if not isinstance(node.get("mutations"), list):
            raise ValueError("AST: foreach_target.mutations must be an array")
        _validate_mutation_list(node["mutations"], w, mdepth + 1, m_foreach, True)  # `each` in scope inside the body
        return
    if t == "repeat":
        # count is a plain JSON integer, judged by VALUE (spec 1.4 / 7.3, vector
        # F7): 1..MAX_ITERATIONS only; 0 is rejected (a no-op is an empty list).
        cv = _safe_int_value(node.get("count"))
        if cv is None or cv < 1 or cv > MAX_ITERATIONS:
            raise ValueError("AST: repeat count must be an integer in 1..%d" % MAX_ITERATIONS)
        m_repeat = m * cv
        if m_repeat > MAX_APPLIED_MUTATIONS:
            raise ValueError("AST: applied-mutation budget exceeded (max %d): repeat multiplicity %d"
                             % (MAX_APPLIED_MUTATIONS, m_repeat))
        if not isinstance(node.get("mutations"), list):
            raise ValueError("AST: repeat.mutations must be an array")
        _validate_mutation_list(node["mutations"], w, mdepth + 1, m_repeat, each_ok)  # repeat introduces no `each` binding
        return
    raise ValueError("AST: unknown mutation node type: %r" % (t,))


def _validate_mutation_list(mutations, w, mdepth, m, each_ok):
    # mdepth is the NEW mutation-structure depth counter (spec 8.3 counter 3):
    # starts at 0 for each top-level mutation list; +1 entering an if branch
    # list, a foreach_target body, or a repeat body.
    if mdepth > MAX_EXPR_DEPTH:
        raise ValueError("AST: mutation structure exceeds max depth %d" % MAX_EXPR_DEPTH)
    if not isinstance(mutations, list):
        raise ValueError("AST: mutations must be an array")
    for node in mutations:
        _validate_mutation(node, w, mdepth, m, each_ok)


def validate_check(check):
    """Validate a full check AST fail-closed (no rng / no state). The budget
    accumulators are DOCUMENT-GLOBAL: one budget threads the roll, the dc, and
    EVERY degree branch - all branches CHARGE though at most one EXECUTES
    (spec 8.2 rule 8, vector H1)."""
    if not isinstance(check, dict) or check.get("type") != "check":
        raise ValueError("AST: expected a check node")
    w = {"nodes": 0, "dice": 0, "applied": 0, "trigger": False}
    _validate_expr(check.get("roll"), w, 0, 1, False)
    _validate_expr(check.get("dc"), w, 0, 1, False)
    if not isinstance(check.get("degrees"), dict):
        raise ValueError("AST: check.degrees must be an object")
    for k in sorted(check["degrees"].keys()):
        branch = check["degrees"][k]
        if not isinstance(branch, dict):
            raise ValueError("AST: malformed degree branch: %s" % k)
        _validate_degree_cond(branch.get("condition"), w, 0, False)
        _validate_mutation_list(branch.get("mutations"), w, 0, 1, False)


def validate_triggered_mutations(mutations):
    """Validate a trigger's mutation list fail-closed (no rng / no state).
    Trigger context: roll / dc / delta / natural DO NOT EXIST, so any condition
    reading them rejects here (spec 1.1)."""
    w = {"nodes": 0, "dice": 0, "applied": 0, "trigger": True}
    _validate_mutation_list(mutations, w, 0, 1, False)


# ---- Public API ------------------------------------------------------------

def make_context(state, actor, seed, target=None):
    return {"state": state, "actor": actor, "target": target,
            "rng": Pcg32.seeded(seed), "natural": None, "each_id": None}


def apply_triggered_mutations(state, mutations, ctx):
    validate_triggered_mutations(mutations)  # fail-closed before any rng/mutation
    work = copy.deepcopy(state)
    ctx2 = {"state": work, "actor": ctx["actor"], "target": ctx.get("target"),
            "rng": ctx["rng"], "natural": None, "each_id": None}
    applied = []
    for m in mutations:
        _apply_mutation_into(m, ctx2, None, applied)  # q is None: no check quantities exist
    return {"state": work, "mutations": applied}


def evaluate_action(state, check, ctx):
    validate_check(check)  # fail-closed before any rng/mutation
    work = copy.deepcopy(state)
    ctx2 = {"state": work, "actor": ctx["actor"], "target": ctx.get("target"),
            "rng": ctx["rng"], "natural": None, "each_id": None}
    roll = eval_expression(check["roll"], ctx2)
    natural = ctx2["natural"]
    dc = eval_expression(check["dc"], ctx2)
    # delta exactness (spec 4.2, the v2 amendment): |roll - dc| can exceed the
    # JS-safe range even though roll and dc are each in range; the exact
    # difference must pass the same assert_int choke point on every surface
    # (a RUNTIME error, after the roll/dc dice were consumed - the v1
    # runtime-error class).
    delta = _assert_int(roll - dc, "delta")
    # The FROZEN check quantities (computed once, BEFORE the degree walk -
    # mutations applied during the same resolution never change them).
    q = {"roll": roll, "dc": dc, "delta": delta, "natural": natural}
    chosen = "none"
    muts = []
    for name in DEGREE_ORDER:
        branch = check["degrees"].get(name)
        if branch is None:
            continue
        if _match_condition(branch["condition"], ctx2, q, 0):
            chosen = name
            muts = branch["mutations"]
            break
    applied = []
    for m in muts:
        _apply_mutation_into(m, ctx2, q, applied)
    return {"state": work, "degree": chosen, "roll": roll, "natural": natural,
            "dc": dc, "delta": delta, "mutations": applied}
