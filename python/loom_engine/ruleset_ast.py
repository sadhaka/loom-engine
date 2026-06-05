"""ruleset_ast - deterministic data-driven ruleset interpreter (Python port).

Byte-identical to the TS ruleset-ast.ts (and the forthcoming Rust port). The
ruleset is a strict JSON AST the engine EVALUATES, never code it executes - so any
system (5e, PF2e, homebrew) runs with no untrusted-code risk. Composes the
parity-proven pcg32 (Pcg32) + floor_div + the world_snapshot canonical encoder.

Pinned by test_vectors/v3_ast_bleed.json: this module's tests load the SAME AST the
TS generator produced and assert the SAME degree / roll / natural / mutations /
world-state hash. Mirrors the post-audit TS contract exactly:
  - integer-only; a dice equation with '.' is rejected; literals are JS-safe ints.
  - all randomness via the seeded Pcg32; dice roll die-by-die so the FIRST
    individual die is the natural roll (NOT the sum), in a fixed PRNG order.
  - the only division is floor_div (toward -inf); no native division node.
  - mul cannot persist -0 (Python ints have no -0, matching the TS normalize).
  - a STATIC validation pass runs BEFORE any rng draw or mutation, so a rejected
    AST advances neither - the reject boundary is byte-identical across surfaces.
"""

import copy
import re

from .pcg32 import Pcg32, floor_div
from .world_snapshot import normalize_tags

MAX_INT = 9007199254740991  # 2^53 - 1
MAX_EXPR_DEPTH = 16
MAX_NODES = 256
MAX_DICE_TOTAL = 1000
DEGREE_ORDER = ["critical_success", "success", "failure", "critical_failure"]

_DICE_RE = re.compile(r"^([0-9]+)d([0-9]+)([+-][0-9]+)?$")


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


def _assert_clean_string(s):
    # Reject lone surrogates (a proper astral scalar like U+1F40D has no surrogate
    # code points in a Python str, so it passes) - matches event-chain assertCleanString.
    for ch in s:
        if 0xD800 <= ord(ch) <= 0xDFFF:
            raise ValueError("AST: string contains a lone surrogate")


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
    raise ValueError("AST: unknown target ref: %r" % (t,))


def _ensure_entity(state, eid):
    ent = state["entities"].get(eid)
    if ent is None:
        ent = {"properties": {}, "tags": []}
        state["entities"][eid] = ent
    return ent


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
        total = 0
        for _ in range(p["count"]):
            one = ctx["rng"].roll_die(p["sides"])
            if ctx["natural"] is None:
                ctx["natural"] = one  # first INDIVIDUAL die = the natural roll
            total += one
        return _assert_int(total + p["mod"], "dice result")
    if t == "prop_ref":
        eid = _resolve_target(node["target"], ctx)
        ent = ctx["state"]["entities"].get(eid)
        v = ent["properties"].get(node["property"]) if ent and "properties" in ent else None
        return _assert_int(0 if v is None else v, "property " + node["property"])
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


def _match_degree(cond, delta, natural, depth=0):
    if depth > MAX_EXPR_DEPTH:
        raise ValueError("AST: degree condition exceeds max depth %d" % MAX_EXPR_DEPTH)
    if not isinstance(cond, dict) or not isinstance(cond.get("type"), str):
        raise ValueError("AST: malformed degree condition")
    t = cond["type"]
    if t == "delta_gte":
        return delta >= _assert_int(cond["value"], "delta_gte")
    if t == "delta_lte":
        return delta <= _assert_int(cond["value"], "delta_lte")
    if t == "nat_roll_eq":
        return natural is not None and natural == _assert_int(cond["value"], "nat_roll_eq")
    if t == "or":
        if not isinstance(cond.get("conditions"), list):
            raise ValueError("AST: or condition requires a conditions array")
        for sub in cond["conditions"]:
            if _match_degree(sub, delta, natural, depth + 1):
                return True
        return False
    raise ValueError("AST: unknown degree condition: %r" % (t,))


def _apply_mutation(state, node, ctx):
    if not isinstance(node, dict) or not isinstance(node.get("type"), str):
        raise ValueError("AST: malformed mutation node")
    eid = _resolve_target(node["target"], ctx)
    ent = _ensure_entity(state, eid)
    t = node["type"]
    if t in ("set_prop", "add_prop", "sub_prop"):
        value = eval_expression(node["value"], ctx)
        prev = ent["properties"].get(node["property"])
        if prev is None:
            prev = 0
        if t == "set_prop":
            nxt = value
        elif t == "add_prop":
            nxt = prev + value
        else:
            nxt = prev - value
        final = _assert_int(nxt, "mutated property " + node["property"])
        ent["properties"][node["property"]] = final
        return {"target": eid, "property": node["property"], "op": t, "previous": prev, "next": final}
    if t == "add_tag":
        ent["tags"] = normalize_tags(ent["tags"] + [node["tag"]])
        return {"target": eid, "tag": node["tag"], "op": "add_tag"}
    if t == "remove_tag":
        ent["tags"] = [x for x in ent["tags"] if x != node["tag"]]
        return {"target": eid, "tag": node["tag"], "op": "remove_tag"}
    raise ValueError("AST: unknown mutation node type: %r" % (t,))


# ---- Static validation pass (validate BEFORE any rng draw / mutation) --------

def _bump_node(budget):
    budget["nodes"] += 1
    if budget["nodes"] > MAX_NODES:
        raise ValueError("AST: node budget exceeded (max %d)" % MAX_NODES)


def _validate_target_ref(t):
    if t not in ("actor", "self", "target"):
        raise ValueError("AST: unknown target ref: %r" % (t,))


def _assert_clean_name(s, what):
    if not isinstance(s, str) or len(s) == 0:
        raise ValueError("AST: %s name must be a non-empty string" % what)
    if s == "__proto__":
        raise ValueError('AST: %s name "__proto__" is forbidden' % what)
    _assert_clean_string(s)


def _validate_expr(node, budget, depth):
    _bump_node(budget)
    if depth > MAX_EXPR_DEPTH:
        raise ValueError("AST: expression exceeds max depth %d" % MAX_EXPR_DEPTH)
    if not isinstance(node, dict) or not isinstance(node.get("type"), str):
        raise ValueError("AST: malformed expression node")
    t = node["type"]
    if t == "literal":
        _assert_int(node["value"], "literal")
        return
    if t == "dice":
        p = parse_dice(node["equation"])
        budget["dice"] += p["count"]
        if budget["dice"] > MAX_DICE_TOTAL:
            raise ValueError("AST: total dice count exceeds budget %d" % MAX_DICE_TOTAL)
        return
    if t == "prop_ref":
        _validate_target_ref(node["target"])
        _assert_clean_name(node["property"], "property")
        return
    if t == "math":
        if node.get("op") not in ("add", "sub", "mul", "floor_div"):
            raise ValueError("AST: unknown math op: %r" % (node.get("op"),))
        _validate_expr(node["left"], budget, depth + 1)
        _validate_expr(node["right"], budget, depth + 1)
        return
    raise ValueError("AST: unknown expression node type: %r" % (t,))


def _validate_degree_cond(cond, budget, depth):
    _bump_node(budget)
    if depth > MAX_EXPR_DEPTH:
        raise ValueError("AST: degree condition exceeds max depth %d" % MAX_EXPR_DEPTH)
    if not isinstance(cond, dict) or not isinstance(cond.get("type"), str):
        raise ValueError("AST: malformed degree condition")
    t = cond["type"]
    if t in ("delta_gte", "delta_lte", "nat_roll_eq"):
        _assert_int(cond["value"], t)
        return
    if t == "or":
        if not isinstance(cond.get("conditions"), list):
            raise ValueError("AST: or condition requires a conditions array")
        for sub in cond["conditions"]:
            _validate_degree_cond(sub, budget, depth + 1)
        return
    raise ValueError("AST: unknown degree condition: %r" % (t,))


def _validate_mutation(node, budget):
    _bump_node(budget)
    if not isinstance(node, dict) or not isinstance(node.get("type"), str):
        raise ValueError("AST: malformed mutation node")
    _validate_target_ref(node["target"])
    t = node["type"]
    if t in ("set_prop", "add_prop", "sub_prop"):
        _assert_clean_name(node["property"], "property")
        _validate_expr(node["value"], budget, 0)
        return
    if t in ("add_tag", "remove_tag"):
        _assert_clean_name(node["tag"], "tag")
        return
    raise ValueError("AST: unknown mutation node type: %r" % (t,))


def _validate_mutation_list(mutations, budget):
    if not isinstance(mutations, list):
        raise ValueError("AST: mutations must be an array")
    for m in mutations:
        _validate_mutation(m, budget)


def validate_check(check):
    if not isinstance(check, dict) or check.get("type") != "check":
        raise ValueError("AST: expected a check node")
    budget = {"nodes": 0, "dice": 0}
    _validate_expr(check["roll"], budget, 0)
    _validate_expr(check["dc"], budget, 0)
    if not isinstance(check.get("degrees"), dict):
        raise ValueError("AST: check.degrees must be an object")
    for k in sorted(check["degrees"].keys()):
        branch = check["degrees"][k]
        if not isinstance(branch, dict):
            raise ValueError("AST: malformed degree branch: %s" % k)
        _validate_degree_cond(branch["condition"], budget, 0)
        _validate_mutation_list(branch["mutations"], budget)


def validate_triggered_mutations(mutations):
    _validate_mutation_list(mutations, {"nodes": 0, "dice": 0})


# ---- Public API ------------------------------------------------------------

def make_context(state, actor, seed, target=None):
    return {"state": state, "actor": actor, "target": target, "rng": Pcg32.seeded(seed), "natural": None}


def apply_triggered_mutations(state, mutations, ctx):
    validate_triggered_mutations(mutations)  # fail-closed before any rng/mutation
    work = copy.deepcopy(state)
    ctx2 = {"state": work, "actor": ctx["actor"], "target": ctx.get("target"), "rng": ctx["rng"], "natural": None}
    applied = [_apply_mutation(work, m, ctx2) for m in mutations]
    return {"state": work, "mutations": applied}


def evaluate_action(state, check, ctx):
    validate_check(check)  # fail-closed before any rng/mutation
    work = copy.deepcopy(state)
    ctx2 = {"state": work, "actor": ctx["actor"], "target": ctx.get("target"), "rng": ctx["rng"], "natural": None}
    roll = eval_expression(check["roll"], ctx2)
    natural = ctx2["natural"]
    dc = eval_expression(check["dc"], ctx2)
    delta = roll - dc
    chosen = "none"
    muts = []
    for name in DEGREE_ORDER:
        branch = check["degrees"].get(name)
        if branch is None:
            continue
        if _match_degree(branch["condition"], delta, natural):
            chosen = name
            muts = branch["mutations"]
            break
    applied = [_apply_mutation(work, m, ctx2) for m in muts]
    return {"state": work, "degree": chosen, "roll": roll, "natural": natural, "dc": dc, "delta": delta, "mutations": applied}
