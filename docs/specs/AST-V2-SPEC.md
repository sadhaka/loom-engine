# AST v2 Specification - Six Additive Node Families

Status: DRAFT for implementation (engine/v3-honesty-harness). Revision 2:
all 14 adversarial-panel findings folded in - see Appendix A for the
item-by-item resolution map.
Applies to: `src/runtime/ruleset-ast.ts` and its Python / Rust ports.
Baseline: the v1 ruleset AST as shipped (node set: `literal` / `dice` / `prop_ref` /
`math` expressions; `set_prop` / `add_prop` / `sub_prop` / `add_tag` / `remove_tag`
mutations; `delta_gte` / `delta_lte` / `nat_roll_eq` / `or` degree conditions;
budgets `MAX_EXPR_DEPTH = 16`, `MAX_NODES = 256`, `MAX_DICE_TOTAL = 1000`;
fail-closed static validation before any PRNG draw or state mutation).

Compatibility statement (normative): **v1 documents remain valid unchanged.**
Every v2 node family is purely additive. A v1-only surface that receives a v2
document rejects it fail-closed at validation as an unknown node type - that is
already the v1 contract ("unknown node/condition/mutation type throws, zero RNG
consumed, zero state mutated"), so no v1 surface needs to change to stay safe.
A v2 surface evaluates every v1 document byte-identically to a v1 surface (no
v1 semantics are altered by this spec, and no v1 document can trip any of the
new budgets - see section 8.5).

The conformance bar for every sentence in this document: the spec must be
implementable independently on TypeScript, Python, and Rust with byte-identical
results - identical accept/reject boundaries, identical PRNG consumption,
identical resolved degrees, identical applied-mutation lists, identical
post-state (and therefore identical `worldStateHash`).

---

## 0. v1 baseline recap (what v2 builds on, unchanged)

These v1 rules are restated because every v2 family leans on them. None of them
change.

- **Integer-only.** Every value is a JS-safe integer (`|x| <= 2^53 - 1`). Any
  intermediate or final value outside that range rejects (`assertInt`). `-0` is
  normalized to `+0` at the same choke point. Floats never exist anywhere in
  the AST or the state. Rust uses `i64` with an explicit `|x| <= 2^53 - 1`
  range check (i64 arithmetic alone is not enough - the JS-safe bound is the
  contract). Python ints are unbounded; the same explicit range check applies.
- **Dice.** `parseDice` accepts `NdM`, `NdM+K`, `NdM-K` only; `0 <= N <= 100`,
  `0 <= M <= 100000`; any `.` rejects; the modifier and the full result range
  must be JS-safe. Each die is `Pcg32.rollDie(sides)` -> `1..=sides`. Zero
  SIDES is special and normative: `rollDie(0)` is still CALLED once per die,
  returns 0, and consumes ZERO PRNG draws (`boundedU32(0)` returns 0 without
  drawing) - so an `Nd0` term with `N >= 1` produces N rolled-a-zero dice
  that advance nothing. Dice consume the PRNG left-to-right, depth-first, in
  expression-evaluation order.
- **Natural roll.** The first individual die rolled while evaluating a check's
  `roll` expression - INCLUDING a zero-sides die. If the first die of the
  `roll` expression is a `d0`, `natural` is 0, not null: the reference TS
  captures the first `rollDie` RESULT, and `rollDie(0)` returns 0. This is
  normative (section 2.2, vector A5) - `2d0` yields `natural = 0`, so
  `nat_roll_lte 0` matches and `compare` against the `natural` source sees 0.
  `natural` is `null` only when the roll expression CALLS `rollDie` zero
  times: no dice nodes at all, or only zero-COUNT (`0dM`) equations.
- **Division.** `floor_div` (toward negative infinity, Python `//`) is the only
  division. Divisor 0 returns 0. No other rounding exists in v1 and v2 adds
  none.
- **Clamping.** There is NO implicit clamping anywhere. HP may go negative.
  v2 adds no implicit clamps; rulesets that want clamping express it with the
  new conditional-mutation family (section 5 worked example).
- **Degree order.** `DEGREE_ORDER = ['critical_success', 'success', 'failure',
  'critical_failure']`, evaluated in that fixed order, first match wins. v2
  does NOT add degree names (deliberate cut, section 14). Degree keys outside
  this list are validated but never matched (v1 behavior, unchanged).
- **Validation before evaluation.** The whole document is statically validated
  (no RNG, no state) before the first PRNG draw. A rejected document advances
  neither the PRNG nor the state, on every surface. Rejection MESSAGES are
  surface-local (the `AST: ` prefix is recommended, not normative); the
  rejection BOUNDARY (which inputs reject) is normative and must be identical
  across surfaces.
- **Missing reads are zero.** `prop_ref` of a missing entity or property reads
  0. v2 operand reads (section 4) follow the same rule.
- **Target refs.** `actor` and `self` resolve to the context actor; `target`
  resolves to the context target and is a RUNTIME error if no target was
  supplied (validation cannot know). v2 adds one new ref, `each` (section 6),
  with a STATIC scope rule.

## 1. Conventions used in this document

### 1.1 Validation contexts

v2 introduces a normative distinction v1 did not need:

- **check context** - the document validated by `validateCheck` (a `check`
  node: `roll`, `dc`, degree conditions, degree mutation lists). The resolution
  quantities `roll`, `dc`, `delta` (= roll - dc), and `natural` exist.
- **trigger context** - the document validated by `validateTriggeredMutations`
  (a bare mutation list, e.g. a Bleed tick). There is no check, so `roll`,
  `dc`, `delta`, and `natural` DO NOT EXIST.

Any condition that references a nonexistent quantity is rejected AT VALIDATION
in trigger context (fail-closed, zero RNG, zero state):

| Condition / operand                  | check context | trigger context |
|--------------------------------------|---------------|-----------------|
| `delta_gte`, `delta_lte`             | valid         | REJECT          |
| `nat_roll_eq`, `nat_roll_gte`, `nat_roll_lte` | valid | REJECT          |
| `compare` operand source `roll` / `dc` / `delta` / `natural` | valid | REJECT |
| `compare` operand source `prop` / `literal` | valid   | valid           |
| `has_tag` (section 4.6)              | valid         | valid           |
| `and`, `or`                          | valid (children recurse) | valid (children recurse) |

(v1 never evaluated conditions in trigger context, so this table creates no
v1 incompatibility.)

### 1.2 Budget constants

| Constant                | Value | Origin | Meaning |
|-------------------------|-------|--------|---------|
| `MAX_EXPR_DEPTH`        | 16    | v1     | Max nesting depth, now governing THREE independent counters: expression depth (v1), condition depth (v1, `or` + new `and`), and NEW mutation-structure depth (`if` / `foreach_target` / `repeat` bodies). |
| `MAX_NODES`             | 256   | v1     | Total AST nodes per validated document. Every v2 node bumps it (accounting per family below). |
| `MAX_DICE_TOTAL`        | 1000  | v1     | Worst-case INDIVIDUAL DICE, summed by ONE document-global accumulator over the WHOLE document - `roll`, `dc`, and EVERY degree branch (or the whole trigger list) - even though at most one branch executes (section 8.2, vector H1). v2 charges each `dice` node `count * M` where `M` is the static multiplicity (section 8). For v1 documents `M` is always 1, so the charge is identical to v1. |
| `MAX_TARGETS`           | 32    | NEW    | Hard cap on entities one `foreach_target` node may touch; also the default `limit`. |
| `MAX_ITERATIONS`        | 16    | NEW    | Hard cap on a `repeat` node's `count`. |
| `MAX_APPLIED_MUTATIONS` | 1024  | NEW    | Worst-case leaf-mutation APPLICATIONS, summed by the same document-global accumulator (every degree branch charges, though at most one runs - section 8.2, vector H1), computed statically via `M` (section 8). |
| `MAX_WORLD_ENTITIES`    | 65536 | NEW    | RUNTIME cap on working-state entity count at any `foreach_target` SELECT (section 8.7). Exceeding it is a runtime error (v1 runtime-error class), identical on every surface. |

All seven constants are shared verbatim by the TS, Python, and Rust surfaces.

### 1.3 Dice-stream notation for golden vectors

Each golden vector in this spec lists `dice_stream`: the value of each
INDIVIDUAL die in exact consumption order. Entry `k` is the result of the
`k`-th STREAM-CONSUMING `rollDie` call of the resolution. Every entry must
satisfy `1 <= value <= sides` for the die that consumes it - which is only
satisfiable for `sides >= 1`, so the rule is completed as follows: zero-sides
dice take NO stream entry. A scripted-harness `rollDie(0)` call returns 0
WITHOUT popping the stream, mirroring production exactly (where `rollDie(0)`
returns 0 and draws nothing from the PRNG). A harness that pops an entry for
a `d0` desynchronizes from production and is non-conformant.

Conformance harnesses verify these vectors with a scripted test PRNG whose
`rollDie` pops the next stream entry (and whose stream MUST be fully consumed -
leftover entries or an exhausted stream is a harness failure; this is how the
"untaken branches consume zero RNG" pins work). The production path always
uses the real `Pcg32`. When the implementation lands, the repo vector file
(`test_vectors/`, generated the same way `tools/gen-ast-vectors.ts` generates
`v3_ast_bleed.json`) will pin real-`Pcg32` seeds plus the resulting
`worldStateHash` values; the spec-level vectors below pin SEMANTICS and are
hand-computed, so they intentionally state post-state deltas rather than
key-dependent hashes.

Vectors marked `expect.reject` must reject AT VALIDATION: zero PRNG draws,
state unchanged, before any evaluation begins.

### 1.4 JSON shape conventions

All shapes are strict: unknown `type` strings reject (v1 contract). Extra
fields - fields not listed for a node - are IGNORED on every surface,
normatively. (The previous "ignored-or-rejected per the v1 surface" wording
was self-contradictory - if ports must match the TS reference, which
structurally ignores extras, then rejection was never a legal choice - and is
withdrawn; the conformance bar is identical accept/reject boundaries, so
exactly one behavior can be conformant.) Ignored means INVISIBLE: an ignored
field is not walked, not validated, and charges no budget - a malformed or
over-budget subtree inside an ignored field can NOT reject the document, and
a typo'd field name (e.g. `els` next to `then`) silently drops that branch
on every surface alike. Vector D5 pins this boundary. The LISTED fields fully
determine behavior. All names (`property`, `tag`) pass the v1
`assertCleanName` (non-empty string, not `__proto__`, no lone surrogates).
All integers pass `assertInt` (JS-safe, `-0` normalized to `+0`).

Number lexical forms (normative). Validation is by VALUE after standard JSON
parsing, never by lexical form. JS `JSON.parse` cannot distinguish the text
`3.0` from `3` (both parse to the same number), so a lexical-form reject is
unimplementable on the reference surface; therefore every surface MUST accept
a JSON number whose PARSED VALUE is mathematically integral and JS-safe, at
every `assertInt` site - v1 `literal` values, condition `value`s, v2 `compare`
operand `value`, `repeat.count`, and `select.limit`. Python ports MUST treat
a parsed `float` `f` with `f.is_integer()` and `|f| <= 2^53 - 1` as the
integer `int(f)` (a bare isinstance-int check rejects documents TS accepts
and is non-conformant); Rust ports MUST accept integral in-range `f64` JSON
numbers the same way. Non-integral values (`3.5`) reject everywhere; lexical
`-0` / `-0.0` normalizes to `+0` everywhere (the same `assertInt` choke
point). Vector F7 pins the accept boundary with a `.0` literal.

### 1.5 Golden-vector schema (normative)

The vector blocks in this document previously used ad hoc field names
(`rng_draws` vs `rng_draws_total`, `applied` vs `applied_count`, three
post-state spellings) - not enough for three independent harness authors to
build compatible runners. This subsection is the normative schema. The
machine-readable vector file and every conformance harness MUST use exactly
these fields. Spec-level blocks below sometimes factor a shared AST into
prose ("same AST as C1 ...") for readability; machine vectors are always
self-contained.

Top-level fields:

- `label` (string): informative, never asserted.
- `context`: `"check"` or `"trigger"`.
- `actor` (string, required); `target` (string, optional).
- `state`: the complete input `WorldState`.
- Exactly one of `ast` (a check node - check context) or `mutations` (a
  mutation list - trigger context).
- `raw_document` (string, optional): the document as RAW JSON TEXT. When
  present, the harness MUST parse THIS string with its surface's standard
  JSON parser and ignore the `ast` / `mutations` field. Used by
  lexical-form vectors (F7), where a canonicalizing reserialization of the
  vector file would erase the lexical form under test.
- `dice_stream` (array of integers, required): section 1.3 rules apply -
  the scripted `rollDie` pops entries in order, the stream MUST be fully
  consumed on accept vectors, and zero-sides dice pop nothing.

`expect` fields for ACCEPT vectors (an absent field is simply not asserted
by that vector, except where marked required):

- `degree` (string): REQUIRED for check-context vectors - the winning degree
  key, or `"none"`.
- `roll`, `dc`, `delta` (integers) and `natural` (integer or `null`): check
  context only.
- `props_after`: map of entity id -> that entity's COMPLETE property map,
  compared exactly.
- `tags_after`: map of entity id -> that entity's complete tag array,
  compared exactly in stored (normalized) order.
- `hp_after`: shorthand map of entity id -> the value of that entity's `hp`
  property ONLY (asserts nothing else about that entity).
- Entities NOT listed in any `*_after` field are asserted UNCHANGED from the
  input state. An entity listed in some field is asserted only by the fields
  that list it.
- `applied`: the COMPLETE `AppliedMutation` list in exact application order.
  Record encoding matches the reference interface: `target` and `op` always;
  `property`, `previous`, `next` for property mutations; `tag` for tag
  mutations. `applied_count` asserts only the list length. A vector may
  carry either or both; when both appear they must agree.
- `rng_draws_total` (integer): total stream entries consumed. Redundant with
  the full-consumption rule (the stream length already pins it) but legal
  as emphasis; when present it MUST equal `dice_stream.length`.

`expect` fields for REJECT vectors:

- `reject: true`, `rng_draws_total: 0`, and `state_unchanged: true` - all
  three REQUIRED.
- `reason` (string): INFORMATIVE ONLY. Rejection message text is
  surface-local (section 9); a conformance harness MUST NOT assert `reason`
  against the surface's error message. It documents intent for humans.

---

## 2. Family A - `nat_roll_gte` / `nat_roll_lte` (natural-roll range conditions)

Range conditions on the natural roll. Enables "crit on natural 19-20"
(Champion-style), d100 band mechanics on the natural die (BRP 96-00 fumble,
01-05 crit), and any mechanic keyed to the raw die rather than the total.
(PbtA 7-9 partials are keyed to the TOTAL, not the natural - they are built
from Family B `and` plus the v1 delta conditions; see section 12.)

### 2.1 JSON shape

```json
{ "type": "nat_roll_gte", "value": 19 }
{ "type": "nat_roll_lte", "value": 5 }
```

Both are `DegreeCond` variants, usable anywhere a condition is accepted
(degree branches, `or` / `and` children, `if` conditions in check context).

### 2.2 Evaluation semantics (exact)

Let `natural` be the check's natural roll (first individual die of the `roll`
expression), or `null` if the roll expression called `rollDie` zero times
(section 0). A zero-sides first die sets `natural` to 0 - a REAL value these
conditions compare normally, not `null` (vector A5).

- `nat_roll_gte` matches iff `natural !== null AND natural >= value`.
- `nat_roll_lte` matches iff `natural !== null AND natural <= value`.

When `natural` is `null` the condition is FALSE - never an error, never
vacuously true. This is exactly the v1 `nat_roll_eq` null rule extended to the
range forms. Comparison is exact integer comparison of two JS-safe integers
(no overflow surface exists: both operands are already range-checked).

### 2.3 Validation, budgets, rejection

- `value` must pass `assertInt`. Non-integer / unsafe / missing `value`
  rejects.
- Trigger context: REJECT (section 1.1) - there is no natural roll to test.
- Node budget: bumps `MAX_NODES` by 1 (same as `nat_roll_eq`).
- Condition depth: occupies one level, like every condition node.
- Unknown sibling fields carry no meaning; the node has no children.
- On a v1-only surface this node rejects as an unknown condition type
  (fail-closed, zero RNG) - the additive-compatibility contract.

### 2.4 Golden vectors

Vector A1 - "crit on natural 19-20, the 19 case" (check context)

```json
{
  "label": "A1 nat_roll_gte 19 fires on a natural 19",
  "context": "check", "actor": "hero", "target": "dummy",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "hero":  { "properties": {}, "tags": [] },
    "dummy": { "properties": { "hp": 30 }, "tags": [] } } },
  "ast": { "type": "check",
    "roll": { "type": "dice", "equation": "1d20" },
    "dc":   { "type": "literal", "value": 10 },
    "degrees": {
      "critical_success": { "condition": { "type": "nat_roll_gte", "value": 19 },
        "mutations": [ { "type": "sub_prop", "target": "target", "property": "hp",
                         "value": { "type": "literal", "value": 10 } } ] },
      "success": { "condition": { "type": "delta_gte", "value": 0 },
        "mutations": [ { "type": "sub_prop", "target": "target", "property": "hp",
                         "value": { "type": "literal", "value": 5 } } ] } } },
  "dice_stream": [19],
  "expect": { "degree": "critical_success", "roll": 19, "natural": 19,
              "dc": 10, "delta": 9, "hp_after": { "dummy": 20 },
              "applied_count": 1 }
}
```

Vector A2 - "natural 18 misses the band, falls through to success"

Same `state` and `ast` as A1, `dice_stream: [18]`.

```json
{ "expect": { "degree": "success", "roll": 18, "natural": 18, "dc": 10,
              "delta": 8, "hp_after": { "dummy": 25 }, "applied_count": 1 } }
```

Vector A3 - "d100 fumble band 96-00 via nat_roll_gte (with Family B exclusion)"

```json
{
  "label": "A3 1d100 vs skill, 97 lands in the fumble band",
  "context": "check", "actor": "hero",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "hero": { "properties": { "skill": 60 }, "tags": [] } } },
  "ast": { "type": "check",
    "roll": { "type": "dice", "equation": "1d100" },
    "dc":   { "type": "prop_ref", "target": "actor", "property": "skill" },
    "degrees": {
      "success": { "condition": { "type": "delta_lte", "value": 0 },
        "mutations": [ { "type": "add_tag", "target": "self", "tag": "succeeded" } ] },
      "failure": { "condition": { "type": "and", "conditions": [
          { "type": "delta_gte", "value": 1 },
          { "type": "nat_roll_lte", "value": 95 } ] },
        "mutations": [ { "type": "add_tag", "target": "self", "tag": "failed" } ] },
      "critical_failure": { "condition": { "type": "nat_roll_gte", "value": 96 },
        "mutations": [ { "type": "add_tag", "target": "self", "tag": "fumbled" } ] } } },
  "dice_stream": [97],
  "expect": { "degree": "critical_failure", "roll": 97, "natural": 97,
              "dc": 60, "delta": 37,
              "tags_after": { "hero": ["fumbled"] }, "applied_count": 1 }
}
```

(Walk: `success` fails because delta 37 > 0; `failure` fails because the `and`
requires natural <= 95 and the natural is 97; `critical_failure` matches.
Without the `nat_roll_lte 95` exclusion, plain `delta_gte 1` would have
matched FIRST and the fumble would be unreachable - first match wins.)

Vector A4 - "null natural is FALSE, never vacuously true"

```json
{
  "label": "A4 diceless roll: nat_roll_gte 1 must NOT match",
  "context": "check", "actor": "hero",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "hero": { "properties": {}, "tags": [] } } },
  "ast": { "type": "check",
    "roll": { "type": "literal", "value": 7 },
    "dc":   { "type": "literal", "value": 5 },
    "degrees": {
      "critical_success": { "condition": { "type": "nat_roll_gte", "value": 1 },
        "mutations": [ { "type": "add_tag", "target": "self", "tag": "crit" } ] },
      "success": { "condition": { "type": "delta_gte", "value": 0 },
        "mutations": [ { "type": "add_tag", "target": "self", "tag": "hit" } ] } } },
  "dice_stream": [],
  "expect": { "degree": "success", "roll": 7, "natural": null, "dc": 5,
              "delta": 2, "tags_after": { "hero": ["hit"] }, "applied_count": 1 }
}
```

Vector A5 - "zero-sides dice SET natural to 0 and consume NO stream entries"

```json
{
  "label": "A5 2d0 first: natural is 0 (not null), the d0s pop nothing",
  "context": "check", "actor": "hero",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "hero": { "properties": {}, "tags": [] } } },
  "ast": { "type": "check",
    "roll": { "type": "math", "op": "add",
      "left":  { "type": "dice", "equation": "2d0" },
      "right": { "type": "dice", "equation": "1d6" } },
    "dc":   { "type": "literal", "value": 3 },
    "degrees": {
      "critical_success": { "condition": { "type": "nat_roll_lte", "value": 0 },
        "mutations": [ { "type": "add_tag", "target": "self", "tag": "zeroed" } ] },
      "success": { "condition": { "type": "delta_gte", "value": 0 },
        "mutations": [ { "type": "add_tag", "target": "self", "tag": "plain" } ] } } },
  "dice_stream": [4],
  "expect": { "degree": "critical_success", "roll": 4, "natural": 0, "dc": 3,
              "delta": 1, "tags_after": { "hero": ["zeroed"] },
              "applied_count": 1, "rng_draws_total": 1 }
}
```

(The `2d0` calls `rollDie(0)` twice; each returns 0 and pops NOTHING; the
FIRST of them is captured as the natural roll, so `natural` is 0 and
`nat_roll_lte 0` matches. The `1d6` then pops the only stream entry, 4 -
roll = 0 + 0 + 4 = 4. A harness whose `d0` pops an entry, or an
implementation whose `natural` stays null past a `d0`, fails this vector.
An A4-shaped implementation note: `nat_roll_gte 1` would NOT match here -
0 is a real natural below the band, which is exactly the pin.)

### 2.5 Worked example (A1, step by step)

1. Validation walks the whole check: 2 expression nodes (`dice`, `literal`),
   2 condition nodes, 2 mutation nodes + 2 value literals = 8 nodes <= 256;
   dice charge 1 * M(=1) = 1 <= 1000. Accepted. Zero RNG so far.
2. `roll` evaluates: `1d20` consumes stream entry 19; `naturalRoll` was null,
   so it becomes 19. Roll = 19.
3. `dc` evaluates: literal 10. `delta` = 19 - 10 = 9.
4. Degree walk in fixed order: `critical_success` first.
   `nat_roll_gte 19`: natural 19 is not null and 19 >= 19 -> MATCH. Stop.
5. Apply that branch's mutations in order: `sub_prop dummy.hp 10`:
   previous 30, next 20. One `AppliedMutation` record.
6. Result: degree `critical_success`, roll 19, natural 19, dc 10, delta 9.

---

## 3. Family B - `and` (boolean conjunction in DegreeCond)

### 3.1 JSON shape

```json
{ "type": "and", "conditions": [ <DegreeCond>, <DegreeCond>, ... ] }
```

A `DegreeCond` variant. Children may be any condition node, including nested
`and` / `or`, within depth and node budgets.

### 3.2 Evaluation semantics (exact)

Matches iff EVERY child condition matches. Children are evaluated
left-to-right (array order), and `and` MUST short-circuit on the first false
child. The symmetric rule is hereby made normative for v1 `or` as well: `or`
MUST short-circuit on the first TRUE child (this matches the shipped TS
reference, whose `or` returns on the first matching child).

This is a MUST, not a SHOULD, because evaluation strategy IS observable in
v2 - the earlier claim that eager and short-circuit implementations are
byte-identical was WRONG and is withdrawn. The counterexample: a child
`compare` with a `prop` operand using target ref `target` throws at RUNTIME
when no context target was supplied (the v1 `resolveTarget` error -
validation cannot catch it, section 9). An eager implementation resolves
that operand - and throws - even when an earlier child has already decided
the result; a short-circuiting one returns the decided result and never
reaches the throw. Throw-vs-result is an observable divergence, so exactly
one strategy can be conformant, and it is short-circuit: a decided `and` /
`or` MUST NOT evaluate, resolve operands for, or throw from any later child.
Conditions still consume zero PRNG on every path, so the strategy never
shifts dice consumption; the observable difference is the throw alone, and
this paragraph pins it. (`compare`'s own operand-resolution order is pinned
in section 4.2 step 1.)

The empty-array case: an empty `and` would be vacuously TRUE (an always-firing
degree), which is fail-OPEN. It is therefore REJECTED at validation. Contrast
v1 `or`, where the empty array evaluates FALSE (never fires - fail-closed in
spirit) and remains accepted exactly as v1 shipped it. This asymmetry is
deliberate and normative.

### 3.3 Validation, budgets, rejection

- `conditions` must be an array with `length >= 1`; otherwise reject.
- Each child is validated recursively at condition depth + 1; depth >
  `MAX_EXPR_DEPTH` rejects (same rule as `or`).
- Node budget: the `and` node bumps `MAX_NODES` by 1; each child bumps its
  own count recursively.
- Context: `and` itself is valid in both contexts; each child is checked
  against the context table in section 1.1 (an `and` containing `delta_gte`
  is rejected in trigger context because the CHILD is).
- On a v1-only surface: rejects as unknown condition type, fail-closed.

### 3.4 Golden vectors

Shared AST for B1-B3 - a PbtA-style move (2d6 + cool vs flat 0, four bands:
12+ advanced, 10-11 full, 7-9 partial, 6- miss):

```json
{
  "context": "check", "actor": "pc",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "pc": { "properties": { "cool": 1 }, "tags": [] } } },
  "ast": { "type": "check",
    "roll": { "type": "math", "op": "add",
      "left":  { "type": "dice", "equation": "2d6" },
      "right": { "type": "prop_ref", "target": "actor", "property": "cool" } },
    "dc": { "type": "literal", "value": 0 },
    "degrees": {
      "critical_success": { "condition": { "type": "delta_gte", "value": 12 },
        "mutations": [ { "type": "add_tag", "target": "self", "tag": "advanced" } ] },
      "success": { "condition": { "type": "delta_gte", "value": 10 },
        "mutations": [ { "type": "add_tag", "target": "self", "tag": "full_hit" } ] },
      "failure": { "condition": { "type": "and", "conditions": [
          { "type": "delta_gte", "value": 7 },
          { "type": "delta_lte", "value": 9 } ] },
        "mutations": [ { "type": "add_tag", "target": "self", "tag": "partial" } ] },
      "critical_failure": { "condition": { "type": "delta_lte", "value": 6 },
        "mutations": [ { "type": "add_prop", "target": "self", "property": "xp",
                         "value": { "type": "literal", "value": 1 } } ] } } }
}
```

Vector B1 - "7-9 partial band via and"

`dice_stream: [4, 3]` -> roll 4+3+1 = 8, natural 4, delta 8.

```json
{ "expect": { "degree": "failure", "roll": 8, "natural": 4, "dc": 0,
              "delta": 8, "tags_after": { "pc": ["partial"] }, "applied_count": 1 } }
```

Vector B2 - "12+ advanced band (and does not over-match)"

`dice_stream: [6, 5]` -> roll 6+5+1 = 12, delta 12.

```json
{ "expect": { "degree": "critical_success", "roll": 12, "natural": 6,
              "dc": 0, "delta": 12, "tags_after": { "pc": ["advanced"] },
              "applied_count": 1 } }
```

Vector B3 - "6- miss band; and's children both false"

`dice_stream: [1, 2]` -> roll 1+2+1 = 4, delta 4.

```json
{ "expect": { "degree": "critical_failure", "roll": 4, "natural": 1,
              "dc": 0, "delta": 4, "props_after": { "pc": { "cool": 1, "xp": 1 } },
              "applied_count": 1 } }
```

Vector B4 - "empty and rejects at validation"

Same AST as B1-B3 except the `failure` condition is
`{ "type": "and", "conditions": [] }`.

```json
{ "dice_stream": [],
  "expect": { "reject": true,
              "reason": "and requires a non-empty conditions array",
              "rng_draws_total": 0, "state_unchanged": true } }
```

### 3.5 Worked example (B1)

1. Validation: every node known, `and` has 2 children, depth max 1, node
   count well under 256, dice charge 2. Accepted.
2. Roll: `math.add` evaluates LEFT first (PRNG order rule): `2d6` consumes
   stream entries 4 then 3 (natural = 4, the FIRST die), sum 7; then
   `prop_ref pc.cool` = 1. Roll = 8. DC = 0. Delta = 8.
3. Degrees: `critical_success` (8 >= 12 false), `success` (8 >= 10 false),
   `failure`: `and` -> child 1 `delta_gte 7` (8 >= 7 true), child 2
   `delta_lte 9` (8 <= 9 true) -> MATCH.
4. Apply `add_tag pc partial` (tags re-normalized via `normalizeTags`).

---

## 4. Family C - `compare` / `has_tag` (RNG-free state conditions)

A condition that compares two RNG-free operands directly, instead of routing
everything through the single `roll - dc` delta. This is what makes "attack
total vs target.ac with no precomputed DC", opposed-stat checks, and
state-dependent degree logic (execute thresholds, bloodied checks)
expressible. Together with its companion `has_tag` (section 4.6, which tests
tag presence the same RNG-free way), Family C supplies the conditions usable
inside trigger-context `if` mutations: `compare` with `prop` / `literal`
operands, and `has_tag` anywhere.

### 4.1 JSON shape

```json
{ "type": "compare", "op": "gte",
  "left":  { "source": "roll" },
  "right": { "source": "prop", "target": "target", "property": "ac" } }
```

`op` is one of exactly: `"gt"`, `"gte"`, `"lt"`, `"lte"`, `"eq"`, `"ne"`.

An OPERAND is one of exactly these six shapes:

```json
{ "source": "roll" }
{ "source": "dc" }
{ "source": "delta" }
{ "source": "natural" }
{ "source": "prop", "target": "actor" | "self" | "target" | "each", "property": "<name>" }
{ "source": "literal", "value": <int> }
```

Operands are deliberately a CLOSED, RNG-free set. `dice` and `math` are NOT
permitted inside operands: conditions are evaluated zero or more times during
the fixed-order degree walk, so any PRNG draw inside a condition would make
PRNG consumption depend on which earlier branches were tested - a determinism
trap this spec forbids structurally. Computed comparisons must be folded into
the `roll` / `dc` expressions or precomputed into entity properties by the
content layer (deliberate cut, section 14).

### 4.2 Evaluation semantics (exact)

1. Resolve `left` fully, THEN `right` fully - BOTH operands are ALWAYS
   resolved, in that order, normatively. A `null` left operand (diceless
   `natural`) does NOT skip resolving the right operand: a right `prop`
   operand with target ref `target` and no context target still throws the
   v1 missing-target runtime error even when the left operand is already
   `null`. Operand-resolution order and the no-null-skip rule are observable
   exactly through that throw (and through nothing else - operands are pure
   and consume zero PRNG), which is why this step pins both rather than
   leaving them to implementations:
   - `roll`, `dc`, `delta`: the enclosing check's frozen resolution values
     (computed once per check, BEFORE the degree walk; mutations applied
     during the same resolution never change them).
   - `natural`: the check's natural roll, possibly `null`.
   - `prop`: resolve the target ref (v1 `resolveTarget`, extended with `each`
     per section 6), then read `entities[id].properties[property]`; a missing
     entity or property reads 0 (v1 rule). The read value passes the SAME
     `assertInt` choke point as v1 `prop_ref` (JS-safe range check, `-0`
     normalized to `+0`): a non-integer or unsafe property value in a
     corrupted or hand-built state throws the same runtime error on every
     surface, identically - the `compare` read and the `prop_ref` read share
     one boundary. The read is against the LIVE working state at the moment
     the condition is evaluated - inside an `if` mutation this means earlier
     mutations in the same list ARE visible.
   - `literal`: the value, `assertInt`-normalized (`-0` -> `+0`).
2. If EITHER operand is `null` (only possible via `natural` on a diceless
   roll), the whole `compare` evaluates FALSE - for ALL six ops, including
   `ne`. Uniform false-on-null, no exceptions, matching the Family A null
   rule. (Yes, this means `ne` against a null natural is false even though
   "not equal" might read as intuitively true. Uniformity beats intuition
   here; a divergent special case per op is exactly the kind of ambiguity
   this spec exists to kill.)
3. Otherwise compare the two integers exactly:
   `gt`: left > right; `gte`: left >= right; `lt`: left < right;
   `lte`: left <= right; `eq`: left == right; `ne`: left != right.
   Every operand source is JS-safe by construction - including `delta`,
   which is now `assertInt`-checked at computation time (see "delta
   exactness" below) - so the comparison is exact on every surface (f64
   compares JS-safe integers exactly; i64 and Python int trivially so). No
   arithmetic is performed - `compare` cannot overflow.

delta exactness (normative, including a required amendment to the v1
reference). `delta = roll - dc`, where `roll` and `dc` are each
`assertInt`-checked - so the EXACT difference can reach `+/-(2^54 - 2)`,
outside JS-safe range, and the shipped v1 reference (`ruleset-ast.ts`, the
`roll - dc` line) does NOT recheck it. In TS f64 that exact value is INEXACT
for odd magnitudes above `2^53`, while Python and Rust compute it exactly:
the earlier claim that "both operands are range-checked integers, so the
comparison is exact on every surface" was FALSE for the `delta` operand
source, and an out-of-range delta could additionally reach the serialized
resolution event with different bytes per surface. The fix, normative on
every surface INCLUDING the TS reference (a required one-line amendment:
pass `roll - dc` through `assertInt`): `delta` MUST be computed as the exact
integer difference and MUST pass the `assertInt` choke point; when
`|roll - dc| > 2^53 - 1` the resolution throws a RUNTIME error - the same
error class as an unsafe v1 `math` result, occurring after the roll/dc dice
were consumed, like every v1 runtime error (section 9). This boundary is
implementable in plain f64, no BigInt needed, by the following argument
(normative): both inputs are exactly representable integers; IEEE
subtraction returns the exact result whenever that result is representable,
and every integer of magnitude `<= 2^53 - 1` is representable - so all
in-range deltas are EXACT in f64; conversely, when the exact difference has
magnitude `>= 2^53`, the nearest representable doubles flank it at or above
`2^53`, so the rounded f64 result also has magnitude `>= 2^53` and
`Number.isSafeInteger` is false - the TS throw boundary coincides exactly
with the exact-arithmetic boundary Python and Rust check explicitly.
Consequences: `delta`'s domain is the JS-safe integers; `delta_gte` /
`delta_lte` and the `delta` operand always compare exact values; and no
non-JS-safe delta can ever reach the serialized resolution event or the
hash gate on any surface, so no port needs a reject the TS reference lacks.
Reachability note: triggering this requires `roll` and `dc` near `2^53`
with opposite signs - no realistic ruleset gets close, but the boundary
must be identical everywhere, which is what this paragraph buys.

### 4.3 Validation, budgets, rejection

- `op` outside the six listed strings: reject.
- `left` / `right` missing, non-object, or with `source` outside the six
  listed sources: reject.
- `prop` operand: target ref must be `actor` / `self` / `target` / `each`
  (`each` only inside a `foreach_target` body - static scope rule, section
  6.3); `property` passes `assertCleanName`. Violation rejects.
- `literal` operand: `value` passes `assertInt`.
- Context: sources `roll` / `dc` / `delta` / `natural` REJECT in trigger
  context (section 1.1). Sources `prop` / `literal` are valid in both.
- Node budget: the `compare` node bumps `MAX_NODES` by 1, plus 1 per operand
  (total 3). Operands are leaves; they add no depth.
- Condition depth: one level for the `compare` node itself.
- On a v1-only surface: rejects as unknown condition type, fail-closed.

### 4.4 Golden vectors

Shared AST for C1-C2 - attack total vs `target.ac` with NO precomputed DC
(`dc` is a flat 0; the hit logic lives entirely in `compare`):

```json
{
  "context": "check", "actor": "hero", "target": "goblin",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "hero":   { "properties": { "str_mod": 5 }, "tags": [] },
    "goblin": { "properties": { "hp": 20, "ac": 15 }, "tags": [] } } },
  "ast": { "type": "check",
    "roll": { "type": "math", "op": "add",
      "left":  { "type": "dice", "equation": "1d20" },
      "right": { "type": "prop_ref", "target": "actor", "property": "str_mod" } },
    "dc": { "type": "literal", "value": 0 },
    "degrees": {
      "success": { "condition": { "type": "compare", "op": "gte",
          "left": { "source": "roll" },
          "right": { "source": "prop", "target": "target", "property": "ac" } },
        "mutations": [ { "type": "sub_prop", "target": "target", "property": "hp",
                         "value": { "type": "dice", "equation": "1d8" } } ] },
      "failure": { "condition": { "type": "compare", "op": "lt",
          "left": { "source": "roll" },
          "right": { "source": "prop", "target": "target", "property": "ac" } },
        "mutations": [ { "type": "add_tag", "target": "self", "tag": "missed" } ] } } }
}
```

Vector C1 - "roll total beats target.ac"

`dice_stream: [13, 6]` -> roll 13+5 = 18 vs ac 15; damage die 6.

```json
{ "expect": { "degree": "success", "roll": 18, "natural": 13, "dc": 0,
              "delta": 18, "hp_after": { "goblin": 14 }, "applied_count": 1 } }
```

Vector C2 - "roll total under target.ac"

`dice_stream: [2]` -> roll 2+5 = 7 vs ac 15. The damage die is NEVER rolled
(the success branch was not taken - one stream entry total).

```json
{ "expect": { "degree": "failure", "roll": 7, "natural": 2, "dc": 0,
              "delta": 7, "hp_after": { "goblin": 20 },
              "tags_after": { "hero": ["missed"] }, "applied_count": 1 } }
```

Vector C3 - "execute threshold: prop-vs-literal inside and"

```json
{
  "label": "C3 finisher: crit branch requires target.hp <= 5",
  "context": "check", "actor": "hero", "target": "goblin",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "hero":   { "properties": {}, "tags": [] },
    "goblin": { "properties": { "hp": 4, "ac": 10 }, "tags": [] } } },
  "ast": { "type": "check",
    "roll": { "type": "dice", "equation": "1d20" },
    "dc":   { "type": "prop_ref", "target": "target", "property": "ac" },
    "degrees": {
      "critical_success": { "condition": { "type": "and", "conditions": [
          { "type": "delta_gte", "value": 0 },
          { "type": "compare", "op": "lte",
            "left": { "source": "prop", "target": "target", "property": "hp" },
            "right": { "source": "literal", "value": 5 } } ] },
        "mutations": [ { "type": "set_prop", "target": "target", "property": "hp",
                         "value": { "type": "literal", "value": 0 } } ] },
      "success": { "condition": { "type": "delta_gte", "value": 0 },
        "mutations": [ { "type": "sub_prop", "target": "target", "property": "hp",
                         "value": { "type": "literal", "value": 1 } } ] } } },
  "dice_stream": [15],
  "expect": { "degree": "critical_success", "roll": 15, "natural": 15,
              "dc": 10, "delta": 5, "hp_after": { "goblin": 0 },
              "applied_count": 1 }
}
```

Vector C4 - "natural operand on a diceless roll is false for every op"

```json
{
  "label": "C4 compare natural gte 1 must NOT match when natural is null",
  "context": "check", "actor": "hero",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "hero": { "properties": {}, "tags": [] } } },
  "ast": { "type": "check",
    "roll": { "type": "literal", "value": 3 },
    "dc":   { "type": "literal", "value": 0 },
    "degrees": {
      "success": { "condition": { "type": "compare", "op": "gte",
          "left": { "source": "natural" }, "right": { "source": "literal", "value": 1 } },
        "mutations": [ { "type": "add_tag", "target": "self", "tag": "lucky" } ] },
      "failure": { "condition": { "type": "delta_gte", "value": 0 },
        "mutations": [ { "type": "add_tag", "target": "self", "tag": "flat" } ] } } },
  "dice_stream": [],
  "expect": { "degree": "failure", "roll": 3, "natural": null, "dc": 0,
              "delta": 3, "tags_after": { "hero": ["flat"] }, "applied_count": 1 }
}
```

Vector C5 - "unknown op rejects at validation"

Same AST as C1 with `"op": "div"`.

```json
{ "dice_stream": [],
  "expect": { "reject": true, "reason": "unknown compare op",
              "rng_draws_total": 0, "state_unchanged": true } }
```

### 4.5 Worked example (C1)

1. Validation: both `compare` nodes are 3 budget-nodes each (node + 2
   operands); ops `gte` / `lt` known; operand sources known; check context so
   `roll` operands are legal. Accepted.
2. Roll: `1d20` -> 13 (natural 13), + `str_mod` 5 -> 18. DC = 0, delta = 18
   (delta is still computed and reported even though no degree uses it).
3. Degree walk: `success` -> `compare gte`: left `roll` = 18, right
   `prop goblin.ac` = 15, 18 >= 15 -> MATCH.
4. Apply `sub_prop goblin.hp 1d8`: rolls stream entry 6 (mutation VALUE
   expressions may roll dice - only CONDITIONS are RNG-free). hp 20 -> 14.

### 4.6 `has_tag` - tag-presence condition

Added in revision 2. The panel finding: section 5 promised "Bleed that only
ticks while a tag is present" as an if-family use case, but no condition
could read tags - `compare` operands are a closed set with no tag source -
so the content layer would have had to mirror every gating status into BOTH
a tag (required by `foreach_target` selection) and a property (required by
conditions), duplicated state with no lockstep guarantee. `has_tag` closes
that hole as data, with the same membership test selection already uses.

JSON shape:

```json
{ "type": "has_tag", "target": "actor" | "self" | "target" | "each", "tag": "<name>" }
```

A `DegreeCond` variant, usable anywhere a condition is accepted (degree
branches, `and` / `or` children, `if` conditions) and in BOTH contexts - it
reads only state, never check quantities (section 1.1 table).

Evaluation semantics (exact):

1. Resolve the target ref (v1 `resolveTarget`, plus `each` under the section
   6.3 static scope rule). `target` with no context target is the v1
   missing-target RUNTIME error, exactly as for `compare` `prop` operands.
2. Matches iff the resolved entity EXISTS in the working state and its
   `tags` array contains `tag` (exact string equality - the identical test
   `foreach_target` SELECT applies). A missing entity has no tags: FALSE,
   never an error - the tag analog of missing-reads-are-zero. The read is
   against the LIVE working state (earlier mutations in the same resolution
   are visible).
3. Pure, like every condition: zero PRNG consumed, zero state changed.

Validation, budgets, rejection:

- `target` outside the four refs: reject. `each` outside a `foreach_target`
  body: reject (static scope rule, section 6.3).
- `tag` must pass `assertCleanName`; violation rejects.
- Node budget: bumps `MAX_NODES` by 1. Condition depth: one level; the node
  has no children.
- Valid in check AND trigger context.
- On a v1-only surface: rejects as unknown condition type, fail-closed.

Vector C6 - "Bleed gated on the tag, tag present" (the section 5 use case)

```json
{
  "label": "C6 has_tag gates a bleed tick - tag present",
  "context": "trigger", "actor": "e1",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "e1": { "properties": { "hp": 10 }, "tags": ["bleeding"] } } },
  "mutations": [
    { "type": "if",
      "condition": { "type": "has_tag", "target": "self", "tag": "bleeding" },
      "then": [ { "type": "sub_prop", "target": "self", "property": "hp",
                  "value": { "type": "dice", "equation": "1d4" } } ] } ],
  "dice_stream": [3],
  "expect": { "props_after": { "e1": { "hp": 7 } },
              "tags_after": { "e1": ["bleeding"] },
              "applied_count": 1, "rng_draws_total": 1 }
}
```

Vector C7 - "tag absent: zero draws, zero mutations"

Same `mutations` as C6; state has `"tags": []`.

```json
{ "dice_stream": [],
  "expect": { "props_after": { "e1": { "hp": 10 } }, "tags_after": { "e1": [] },
              "applied_count": 0, "rng_draws_total": 0 } }
```

(The untaken `then` rolls nothing. This is "Bleed that only ticks while a
tag is present", expressed with NO property mirror of the `bleeding`
status - the duplication the panel objected to never arises.)

---

## 5. Family D - `if` (conditional mutations)

A mutation-list node that applies one of two mutation lists depending on a
condition. This is the building block for riders ("on a hit, if the target is
bloodied, also stun"), clamps ("if hp < 0, set hp 0"), and trigger-context
branching - including Bleed that only ticks while a tag is present, which is
expressible via the `has_tag` condition (section 4.6, vectors C6/C7).

### 5.1 JSON shape

```json
{ "type": "if",
  "condition": <DegreeCond>,
  "then": [ <MutationNode>, ... ],
  "else": [ <MutationNode>, ... ] }
```

A `MutationNode` variant, legal anywhere a mutation list is legal (degree
branches, trigger lists, `then` / `else` bodies, `foreach_target` bodies,
`repeat` bodies). `else` is optional; absent means "apply nothing on false".
`then` is required and must be an array; both arrays may be empty (a no-op
branch is legal, matching v1's acceptance of empty mutation lists).

### 5.2 Evaluation semantics (exact)

1. Evaluate `condition` exactly once, against the LIVE working state (earlier
   mutations in the same resolution are visible to `prop` operands) and the
   FROZEN check quantities (`roll` / `dc` / `delta` / `natural`, check context
   only). Conditions are pure: this step consumes ZERO PRNG and changes ZERO
   state, always.
2. If true, apply every node of `then` in array order. If false, apply every
   node of `else` in array order (or nothing if `else` is absent).
3. The UNTAKEN branch is completely inert: it consumes zero PRNG draws and
   performs zero state changes. This is the determinism crux of the family
   and is pinned by vector D3.
4. The `if` node itself emits NO `AppliedMutation` record. Only leaf
   mutations emit records, flattened into the resolution's single `mutations`
   array in exact application order.

### 5.3 Validation, budgets, rejection

- `condition` is validated as a condition (full section 1.1 context table
  applies - in trigger context, `delta_*` / `nat_roll_*` / `roll` / `dc` /
  `delta` / `natural` operands inside this condition REJECT).
- `then` missing or not an array: reject. `else` present but not an array:
  reject.
- Mutation-structure depth: entering `then` or `else` increments the
  mutation-structure depth counter; depth > `MAX_EXPR_DEPTH` rejects. (The
  counter starts at 0 for each top-level mutation list and is shared with
  Families E and F.)
- Node budget: the `if` node bumps `MAX_NODES` by 1; its condition subtree
  and both branch subtrees count recursively.
- Budget multiplicity: BOTH branches are charged in full at the current
  multiplicity `M` (section 8) - deliberately conservative (the static pass
  does not try to prove which branch runs). Dice inside either branch charge
  `count * M`; leaf mutations in either branch charge `M` applied-mutation
  units each.
- On a v1-only surface: rejects as unknown mutation type, fail-closed.

### 5.4 Golden vectors

Vector D1 - "clamp-to-zero rider (live-state read)" (trigger context)

```json
{
  "label": "D1 bleed tick then clamp hp at 0",
  "context": "trigger", "actor": "e1",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "e1": { "properties": { "hp": 5 }, "tags": [] } } },
  "mutations": [
    { "type": "sub_prop", "target": "self", "property": "hp",
      "value": { "type": "dice", "equation": "1d8" } },
    { "type": "if",
      "condition": { "type": "compare", "op": "lte",
        "left": { "source": "prop", "target": "self", "property": "hp" },
        "right": { "source": "literal", "value": 0 } },
      "then": [
        { "type": "set_prop", "target": "self", "property": "hp",
          "value": { "type": "literal", "value": 0 } },
        { "type": "add_tag", "target": "self", "tag": "down" } ] } ],
  "dice_stream": [7],
  "expect": { "props_after": { "e1": { "hp": 0 } },
              "tags_after": { "e1": ["down"] },
              "applied": [
                { "target": "e1", "property": "hp", "op": "sub_prop", "previous": 5,  "next": -2 },
                { "target": "e1", "property": "hp", "op": "set_prop", "previous": -2, "next": 0 },
                { "target": "e1", "tag": "down", "op": "add_tag" } ] }
}
```

(The condition reads hp = -2, the LIVE value after the first mutation - not
the pre-resolution 5.)

Vector D2 - "false condition with no else is a no-op"

Same AST as D1, state hp = 20, `dice_stream: [3]`.

```json
{ "expect": { "props_after": { "e1": { "hp": 17 } },
              "tags_after": { "e1": [] }, "applied_count": 1 } }
```

Vector D3 - "the untaken branch consumes ZERO RNG"

```json
{
  "label": "D3 dice in the untaken then-branch must not advance the PRNG",
  "context": "trigger", "actor": "e1",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "e1": { "properties": { "hp": 10, "flag": 0 }, "tags": [] } } },
  "mutations": [
    { "type": "if",
      "condition": { "type": "compare", "op": "eq",
        "left": { "source": "prop", "target": "self", "property": "flag" },
        "right": { "source": "literal", "value": 1 } },
      "then": [ { "type": "sub_prop", "target": "self", "property": "hp",
                  "value": { "type": "dice", "equation": "1d6" } } ],
      "else": [ { "type": "sub_prop", "target": "self", "property": "hp",
                  "value": { "type": "literal", "value": 1 } } ] },
    { "type": "sub_prop", "target": "self", "property": "hp",
      "value": { "type": "dice", "equation": "1d6" } } ],
  "dice_stream": [4],
  "expect": { "props_after": { "e1": { "hp": 5, "flag": 0 } },
              "applied_count": 2, "rng_draws_total": 1 }
}
```

(flag is 0, so the else branch fires: hp 10 -> 9 with no die. The second
top-level mutation rolls the ONLY die of the resolution: 4, hp 9 -> 5. A
stream of exactly one entry, fully consumed, IS the pin: an implementation
that pre-rolls or eagerly evaluates the then-branch will desynchronize.)

Vector D4 - "check-only condition in trigger context rejects"

```json
{
  "label": "D4 delta_gte inside a trigger-context if",
  "context": "trigger", "actor": "e1",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "e1": { "properties": { "hp": 10 }, "tags": [] } } },
  "mutations": [
    { "type": "if", "condition": { "type": "delta_gte", "value": 0 },
      "then": [ { "type": "add_tag", "target": "self", "tag": "x" } ] } ],
  "dice_stream": [],
  "expect": { "reject": true,
              "reason": "delta_gte is not valid in trigger context",
              "rng_draws_total": 0, "state_unchanged": true }
}
```

Vector D5 - "extra fields are IGNORED, not validated (section 1.4)"

```json
{
  "label": "D5 stray 'els' next to 'then' is invisible on every surface",
  "context": "trigger", "actor": "e1",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "e1": { "properties": { "hp": 5 }, "tags": [] } } },
  "mutations": [
    { "type": "if",
      "condition": { "type": "compare", "op": "gte",
        "left":  { "source": "prop", "target": "self", "property": "hp" },
        "right": { "source": "literal", "value": 100 } },
      "then": [ { "type": "add_tag", "target": "self", "tag": "big" } ],
      "els":  [ { "type": "totally_unknown_node" } ] } ],
  "dice_stream": [],
  "expect": { "props_after": { "e1": { "hp": 5 } }, "tags_after": { "e1": [] },
              "applied_count": 0, "rng_draws_total": 0 }
}
```

(Two pins in one: the document is ACCEPTED - the typo'd `els` is an unknown
field, so it is ignored, not rejected, and its content is NOT walked - the
`totally_unknown_node` inside it cannot trip the unknown-type reject. And at
evaluation the false condition finds no `else`, so nothing applies. A port
that validates or executes `els`, or rejects the extra field, fails this
vector. Authors beware: this is the cost of the v1 structural-ignore
contract - a misspelled `else` silently drops the branch everywhere.)

### 5.5 Worked example (D1)

1. Validation (trigger context): `sub_prop` ok; `if` ok; its condition is a
   `compare` with `prop` / `literal` operands - legal in trigger context;
   `then` has 2 mutations; no `else`. Mutation-structure depth inside `then`
   is 1 <= 16. Dice charge: 1 (the 1d8) * M(=1). Applied-mutation charge:
   3 leaf mutations * 1 = 3 <= 1024. Accepted.
2. Mutation 1: `sub_prop e1.hp 1d8` rolls 7 -> hp 5 - 7 = -2 (negative is
   legal; no implicit clamp). Record: previous 5, next -2.
3. Mutation 2: `if` evaluates its condition against the live state:
   hp = -2 <= 0 -> true. Apply `then` in order: `set_prop hp 0` (record:
   previous -2, next 0), `add_tag down`.
4. Applied list: exactly the 3 records, in that order. The `if` itself
   contributed no record.

---

## 6. Family E - `foreach_target` (bounded multi-target mutation scope)

Applies a mutation list once per entity in a tag-selected, deterministically
ordered, budget-capped set. This is the fireball / aura / "all foes" scope.

### 6.1 JSON shape

```json
{ "type": "foreach_target",
  "select": { "tag": "foe", "limit": 8 },
  "mutations": [ <MutationNode>, ... ] }
```

A `MutationNode` variant. `select.tag` is required (the only selector in v2 -
deliberate cut, section 14). `select.limit` is optional; when present it must
be an integer with `1 <= limit <= MAX_TARGETS`; when absent it defaults to
`MAX_TARGETS` (32).

Inside `mutations` (and inside value expressions and `compare` operands within
it), the target ref `each` resolves to the entity of the current iteration.

### 6.2 Evaluation semantics (exact)

1. SELECT: at the moment the `foreach_target` node executes (i.e. after every
   earlier mutation in the same resolution has been applied), collect the ids
   of every entity in the working state whose `tags` array contains
   `select.tag` (exact string equality). The actor and the context target are
   eligible like any other entity; selection is purely by tag. Entities are
   never created by selection. Entity cap (runtime, normative): if the
   working state contains more than `MAX_WORLD_ENTITIES` (65536) entities at
   this moment, the resolution throws a RUNTIME error - the v1 runtime-error
   class, identical on every surface; the SELECT itself has consumed zero
   PRNG when it fires (section 8.7 explains why this bound exists).
   Re-selection (normative): SELECT - and the step-4 SNAPSHOT - re-run on
   EVERY EXECUTION of this node. When a `foreach_target` sits inside a
   `repeat` (or another `foreach_target`), each iteration of the enclosing
   structure executes this node afresh: tags added by iteration 1 change the
   membership, the iteration count, and therefore the TOTAL PRNG consumption
   of iteration 2. An implementation that caches the selection across
   executions desynchronizes the dice stream and is non-conformant (vector
   E7). The snapshot in step 4 is per-EXECUTION, never per-document.
2. ORDER: sort the collected ids ascending by UTF-16 code units - the SAME
   comparator `canonicalJson` uses for object keys and `normalizeTags` uses
   for tags ("one sort rule everywhere", per world-state-snapshot). This is
   NOT UTF-8 byte order and NOT the numeric-aware `compareIds` from
   ruleset.ts: `"e10"` sorts BEFORE `"e2"` (code unit 0x31 < 0x32), and an
   astral-plane id sorts by its surrogate code units. Rust must sort by the
   `encode_utf16` sequence, not native `str` `Ord`; Python must sort with a
   UTF-16 key, not code-point order. (Both already implement this comparator
   for canonical JSON - reuse it.)
3. TRUNCATE: keep the first `min(matched, limit)` ids of that order. Matching
   more entities than `limit` is NOT an error - the prefix is deterministic,
   so truncation keeps the fail-closed boundary at validation time where it
   belongs (a runtime throw here would fire AFTER dice may already have been
   consumed, breaking the "rejection advances nothing" invariant).
   Zero matches is NOT an error: the node applies nothing, consumes zero
   PRNG, emits zero records.
4. SNAPSHOT: the selected id list is now FIXED for this node's execution.
   Mutations applied during the iteration can add or remove the tag on any
   entity; the iteration membership and order DO NOT change mid-flight
   (pinned by vector E3).
5. ITERATE: for each selected id in order, apply `mutations` in array order
   with `each` bound to that id. Value expressions are evaluated FRESH for
   every iteration - dice re-roll per target, consuming the PRNG in iteration
   order then list order then expression order (left-to-right, depth-first).
   There is no roll-once-share-everywhere mode in v2 (deliberate cut, section
   14): 5e-style "roll fireball damage once for all targets" is NOT
   expressible; per-target rolls are.
6. Property reads via `each` (and via `actor` / `self` / `target`) see the
   live working state, including changes made in earlier iterations of the
   same node.
7. The `foreach_target` node itself emits no `AppliedMutation` record; leaf
   mutations inside it emit records in exact application order, with `target`
   set to the resolved per-iteration entity id.
8. Nesting: `foreach_target` may nest inside `if` / `repeat` /
   `foreach_target` bodies, subject to depth and multiplicity budgets. In
   nested foreach scopes, `each` binds to the INNERMOST enclosing
   `foreach_target`.

### 6.3 Validation, budgets, rejection

- `select` missing / not an object, or `select.tag` failing `assertCleanName`:
  reject.
- `select.limit` present but not an integer in `1..MAX_TARGETS`: reject
  (`0`, negatives, non-integral numbers, and values above 32 all reject - the
  cap is a validation-time constant, never a silent runtime clamp of the
  LIMIT itself; only the matched SET is truncated at runtime). Integer-ness
  is judged by VALUE: a lexical `2.0` is the integer 2 (section 1.4).
- `mutations` must be an array (possibly empty).
- The target ref `each` is a STATIC scope rule: `each` appearing in any
  mutation target, `prop_ref` target, or `compare` `prop` operand that is not
  lexically inside some `foreach_target.mutations` subtree REJECTS at
  validation. (At runtime, resolution of `each` therefore always has a
  binding; a defensive runtime throw for a missing binding should be
  unreachable.)
- Mutation-structure depth: entering `mutations` increments the shared
  depth counter; > `MAX_EXPR_DEPTH` rejects.
- Node budget: the node bumps `MAX_NODES` by 1; its subtree counts
  recursively.
- Multiplicity (section 8): entering the body multiplies `M` by
  `L = limit or MAX_TARGETS`. If `M * L > MAX_APPLIED_MUTATIONS`, reject
  immediately at entry (this also caps `M` itself at 1024 on every surface,
  so multiplicity arithmetic can never overflow even i32). Dice inside the
  body charge `count * M'`; leaf mutations charge `M'` each.
- Context: legal in both check and trigger context (conditions nested inside
  still obey the section 1.1 table).
- On a v1-only surface: rejects as unknown mutation type, fail-closed.

### 6.4 Golden vectors

Vector E1 - "fireball: per-target fresh dice, canonical order" (check context)

```json
{
  "label": "E1 success branch hits every 'foe' with its own 1d6",
  "context": "check", "actor": "hero",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "hero":     { "properties": {}, "tags": [] },
    "goblin_a": { "properties": { "hp": 10 }, "tags": ["foe"] },
    "goblin_b": { "properties": { "hp": 12 }, "tags": ["foe"] },
    "ally":     { "properties": { "hp": 8 },  "tags": [] } } },
  "ast": { "type": "check",
    "roll": { "type": "dice", "equation": "1d20" },
    "dc":   { "type": "literal", "value": 10 },
    "degrees": {
      "success": { "condition": { "type": "delta_gte", "value": 0 },
        "mutations": [
          { "type": "foreach_target", "select": { "tag": "foe", "limit": 8 },
            "mutations": [ { "type": "sub_prop", "target": "each", "property": "hp",
                             "value": { "type": "dice", "equation": "1d6" } } ] } ] } } },
  "dice_stream": [15, 3, 5],
  "expect": { "degree": "success", "roll": 15, "natural": 15, "dc": 10,
              "delta": 5,
              "hp_after": { "goblin_a": 7, "goblin_b": 7, "ally": 8 },
              "applied": [
                { "target": "goblin_a", "property": "hp", "op": "sub_prop", "previous": 10, "next": 7 },
                { "target": "goblin_b", "property": "hp", "op": "sub_prop", "previous": 12, "next": 7 } ] }
}
```

Vector E2 - "limit truncates to the deterministic prefix"

Same AST and state as E1 with `"limit": 1`, `dice_stream: [15, 4]`.

```json
{ "expect": { "degree": "success",
              "hp_after": { "goblin_a": 6, "goblin_b": 12, "ally": 8 },
              "applied_count": 1 } }
```

Vector E3 - "selection is a snapshot: tags changed mid-iteration do not join"
(trigger context, context target supplied)

```json
{
  "label": "E3 ally gains 'foe' during the loop but is NOT iterated",
  "context": "trigger", "actor": "caster", "target": "ally",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "caster": { "properties": {}, "tags": [] },
    "g_a":    { "properties": { "hp": 10 }, "tags": ["foe"] },
    "g_b":    { "properties": { "hp": 12 }, "tags": ["foe"] },
    "ally":   { "properties": { "hp": 8 },  "tags": [] } } },
  "mutations": [
    { "type": "foreach_target", "select": { "tag": "foe" },
      "mutations": [
        { "type": "sub_prop", "target": "each", "property": "hp",
          "value": { "type": "literal", "value": 2 } },
        { "type": "add_tag", "target": "target", "tag": "foe" } ] } ],
  "dice_stream": [],
  "expect": { "hp_after": { "g_a": 8, "g_b": 10, "ally": 8 },
              "tags_after": { "ally": ["foe"] },
              "applied_count": 4 }
}
```

(Iteration set is {g_a, g_b}, frozen before the first pass. The ally is
tagged `foe` during g_a's pass and again - idempotently, `normalizeTags`
dedupes - during g_b's pass, but its hp is untouched.)

Vector E4 - "UTF-16 order, not numeric: e10 before e2; truncation after order"

```json
{
  "label": "E4 ids sort by code units, then limit 2 keeps the prefix",
  "context": "trigger", "actor": "caster",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "caster": { "properties": {}, "tags": [] },
    "e10": { "properties": { "hp": 10 }, "tags": ["foe"] },
    "e2":  { "properties": { "hp": 10 }, "tags": ["foe"] },
    "e3":  { "properties": { "hp": 10 }, "tags": ["foe"] } } },
  "mutations": [
    { "type": "foreach_target", "select": { "tag": "foe", "limit": 2 },
      "mutations": [ { "type": "sub_prop", "target": "each", "property": "hp",
                       "value": { "type": "dice", "equation": "1d4" } } ] } ],
  "dice_stream": [2, 3],
  "expect": { "hp_after": { "e10": 8, "e2": 7, "e3": 10 },
              "applied_count": 2 }
}
```

(Order is `e10` < `e2` < `e3` by UTF-16 code units; a numeric-aware sort
would produce e2, e3, e10 and FAIL this vector.)

Vector E5 - "each outside foreach scope rejects at validation"

```json
{
  "label": "E5 'each' with no enclosing foreach_target",
  "context": "trigger", "actor": "caster",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "caster": { "properties": { "hp": 5 }, "tags": [] } } },
  "mutations": [ { "type": "sub_prop", "target": "each", "property": "hp",
                   "value": { "type": "literal", "value": 1 } } ],
  "dice_stream": [],
  "expect": { "reject": true,
              "reason": "target ref 'each' is only valid inside foreach_target",
              "rng_draws_total": 0, "state_unchanged": true }
}
```

Vector E6 - "per-target save for half damage: the scratch-property idiom"
(see section 6.6 for the normative discussion)

```json
{
  "label": "E6 every foe saves vs the caster's DC; half damage on success",
  "context": "trigger", "actor": "hero",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "hero": { "properties": { "spell_dc": 13 }, "tags": [] },
    "g_a":  { "properties": { "hp": 20, "dex_save": 5 }, "tags": ["foe"] },
    "g_b":  { "properties": { "hp": 15, "dex_save": 0 }, "tags": ["foe"] } } },
  "mutations": [
    { "type": "foreach_target", "select": { "tag": "foe" },
      "mutations": [
        { "type": "set_prop", "target": "each", "property": "save_roll",
          "value": { "type": "math", "op": "add",
            "left":  { "type": "dice", "equation": "1d20" },
            "right": { "type": "prop_ref", "target": "each", "property": "dex_save" } } },
        { "type": "if",
          "condition": { "type": "compare", "op": "gte",
            "left":  { "source": "prop", "target": "each", "property": "save_roll" },
            "right": { "source": "prop", "target": "actor", "property": "spell_dc" } },
          "then": [ { "type": "sub_prop", "target": "each", "property": "hp",
                      "value": { "type": "math", "op": "floor_div",
                        "left":  { "type": "dice", "equation": "2d6" },
                        "right": { "type": "literal", "value": 2 } } } ],
          "else": [ { "type": "sub_prop", "target": "each", "property": "hp",
                      "value": { "type": "dice", "equation": "2d6" } } ] } ] } ],
  "dice_stream": [9, 4, 5, 7, 6, 2],
  "expect": { "props_after": {
                "g_a": { "hp": 16, "dex_save": 5, "save_roll": 14 },
                "g_b": { "hp": 7,  "dex_save": 0, "save_roll": 7 } },
              "applied_count": 4, "rng_draws_total": 6 }
}
```

(g_a: d20 -> 9, + dex 5 = 14 >= dc 13, save SUCCEEDS -> then-branch: 2d6 ->
4+5 = 9, floor_div 2 = 4, hp 20 -> 16. g_b: d20 -> 7, + 0 = 7 < 13, save
FAILS -> else-branch: 2d6 -> 6+2 = 8, hp 15 -> 7. Note `props_after` asserts
the persisted `save_roll` values - the scratch property remains in the
post-state and the hash, deliberately; section 6.6.)

Vector E7 - "selection re-runs on EVERY execution (repeat around foreach)"

```json
{
  "label": "E7 a tag added in repeat-iteration 1 joins iteration 2's selection",
  "context": "trigger", "actor": "caster", "target": "recruit",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "caster":  { "properties": {}, "tags": [] },
    "g_a":     { "properties": { "hp": 10 }, "tags": ["foe"] },
    "recruit": { "properties": { "hp": 10 }, "tags": [] } } },
  "mutations": [
    { "type": "repeat", "count": 2,
      "mutations": [
        { "type": "foreach_target", "select": { "tag": "foe" },
          "mutations": [
            { "type": "sub_prop", "target": "each", "property": "hp",
              "value": { "type": "dice", "equation": "1d4" } },
            { "type": "add_tag", "target": "target", "tag": "foe" } ] } ] } ],
  "dice_stream": [2, 3, 1],
  "expect": { "props_after": { "g_a": { "hp": 5 }, "recruit": { "hp": 9 } },
              "tags_after": { "g_a": ["foe"], "recruit": ["foe"] },
              "applied_count": 6, "rng_draws_total": 3 }
}
```

(Repeat iteration 1: SELECT finds {g_a} - ONE draw (2), g_a hp 10 -> 8, and
the body tags `recruit` with "foe". Repeat iteration 2: SELECT RE-RUNS and
now finds {g_a, recruit} ("g_a" < "recruit" by UTF-16) - TWO draws (3 then
1), g_a 8 -> 5, recruit 10 -> 9. The stream is 1-then-2 draws, 3 total,
fully consumed: an implementation that caches iteration 1's selection
consumes only 2 and desynchronizes - that asymmetric draw count IS the pin.
Six applied records: the idempotent re-taggings of `recruit` still emit
`add_tag` records.)

### 6.5 Worked example (E1)

1. Validation: node count fine; entering the foreach body sets
   `M' = 1 * 8 = 8 <= 1024`; the one leaf mutation charges 8 applied units;
   its `1d6` charges `1 * 8 = 8` dice; plus the check's `1d20` charges 1.
   Totals: 9 dice <= 1000, 8 applied <= 1024. Accepted.
2. Check resolves: roll 15 (natural 15), dc 10, delta 5 -> `success`.
3. The branch's single mutation is the foreach. Select: tags contain "foe"
   for goblin_a and goblin_b (ally has no tag). Order by UTF-16:
   goblin_a, goblin_b. Limit 8 > 2, no truncation. Snapshot fixed.
4. Pass 1 (`each` = goblin_a): `sub_prop hp 1d6` rolls 3 -> 10 - 3 = 7.
5. Pass 2 (`each` = goblin_b): fresh evaluation, rolls 5 -> 12 - 5 = 7.
6. Applied records in exactly that order; PRNG consumed exactly 3 dice
   total (d20, then 3, then 5).

### 6.6 The per-target-save idiom (normative)

The defining 5e multi-target mechanic - EVERY target rolls its own save,
half damage on success - is expressible in v2, but only through an idiom
this section blesses explicitly. (Panel finding: vector E1 is labeled
"fireball" yet omits the save entirely, so the spec's multi-target
expressibility claim rested on an undemonstrated, undocumented pattern.
Vector E6 is now the demonstration; this section is the documentation.)

The idiom. Conditions are RNG-free (section 4.1), so the save can NOT be
rolled inside the `if` condition. It MUST be materialized first - a
`set_prop` into a SCRATCH PROPERTY on the per-iteration entity - then tested
with `compare` `prop` operands:

```
foreach (tag "foe") body =
  1. set_prop each.save_roll = math.add(dice "1d20", prop_ref each.dex_save)
  2. if compare(prop each.save_roll  gte  prop actor.spell_dc)
       then [ sub_prop each.hp = math.floor_div(dice <damage>, literal 2) ]
       else [ sub_prop each.hp = dice <damage> ]
```

Normative consequences, all deliberate:

- The save is rolled fresh per target (section 6.2 step 5), and so is the
  damage - in whichever branch is taken (only the taken branch rolls, so
  each target costs exactly one save die plus its branch's damage dice).
- `floor_div(x, 2)` is 5e's round-down half, exactly (section 0).
- The scratch property PERSISTS. There is no `remove_prop` in v1 or v2
  (section 14), so `save_roll` remains on the entity - and in
  `worldStateHash` - after the resolution ends. An absent property and a
  stored 0 READ identically (missing-reads-are-zero) but HASH differently:
  the first resolution that writes a scratch name permanently changes which
  states are hash-equal. Content layers MUST treat scratch names as
  permanent, reused slots - every later save OVERWRITES `save_roll` via
  `set_prop` - and MUST NOT expect cleanup. Vector E6's `props_after`
  asserts the persisted values to pin exactly this.
- Budget shape at full 5e scale (`limit` 16, 8d6 damage): `M' = 16`; dice =
  `16 * 1` (saves) + `16 * 8` (then) + `16 * 8` (else) = 272 <= 1000;
  applied = 3 leaves * 16 = 48 <= 1024; mutation-structure depth 2 <= 16.
  Passes with room (vector E6 uses 2d6 and two targets only to keep the
  hand-checked stream short; the arithmetic above is the limit-16 case).

---

## 7. Family F - `repeat` (bounded per-target iteration)

Applies a mutation list a fixed number of times. Composed inside
`foreach_target` it gives bounded per-target iteration (the "three magic
missiles", "two ticks per foe" shapes).

### 7.1 JSON shape

```json
{ "type": "repeat", "count": 3, "mutations": [ <MutationNode>, ... ] }
```

A `MutationNode` variant. `count` is a plain JSON integer - NOT an `ExprNode`.
Dynamic counts (dice or property-driven, e.g. "repeat 1d4 times") are NOT
expressible in v2; that is a deliberate cut (section 14) because a dynamic
count would make the static multiplicity budget (section 8) unsound or force
a runtime-rejection path after PRNG consumption.

### 7.2 Evaluation semantics (exact)

1. Apply `mutations` in array order, exactly `count` times (iterations
   1..count, in order). No early exit, no condition (compose with `if` for
   conditional bodies).
2. Value expressions are evaluated FRESH each iteration - dice re-roll every
   pass, consuming the PRNG in iteration order then list order then
   expression order.
3. Property reads see the live working state, including earlier iterations
   of the same node.
4. The `repeat` node emits no `AppliedMutation` record; leaf mutations emit
   records in exact application order.
5. Nesting: legal inside and around `if` / `foreach_target` / `repeat`,
   subject to the shared depth counter and the multiplicity budget. `each`
   inside a `repeat` body refers to the innermost ENCLOSING `foreach_target`
   (a `repeat` introduces no binding of its own).

### 7.3 Validation, budgets, rejection

- `count` must be an integer with `1 <= count <= MAX_ITERATIONS` (16).
  0, negatives, non-integral numbers, non-numbers, and values above 16 ALL
  reject at validation. Integer-ness is judged by VALUE after JSON parsing:
  a lexical `3.0` is the integer 3 and is ACCEPTED (section 1.4, vector F7).
  (Note: `count` of 0 is rejected rather than treated as a no-op; an author
  who wants a no-op writes an empty mutations array.)
- `mutations` must be an array (possibly empty).
- Mutation-structure depth: entering the body increments the shared counter;
  > `MAX_EXPR_DEPTH` rejects.
- Node budget: 1 for the node; subtree counts recursively.
- Multiplicity: entering the body multiplies `M` by `count`; if
  `M * count > MAX_APPLIED_MUTATIONS`, reject at entry. Dice inside charge
  `count_dice * M'`; leaf mutations charge `M'` each.
- Context: legal in both contexts.
- On a v1-only surface: rejects as unknown mutation type, fail-closed.

### 7.4 Golden vectors

Vector F1 - "three missiles, each rolled fresh" (trigger context, target
supplied)

```json
{
  "label": "F1 repeat 3 of sub_prop target.hp 1d4+1",
  "context": "trigger", "actor": "mage", "target": "imp",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "mage": { "properties": {}, "tags": [] },
    "imp":  { "properties": { "hp": 20 }, "tags": [] } } },
  "mutations": [
    { "type": "repeat", "count": 3,
      "mutations": [ { "type": "sub_prop", "target": "target", "property": "hp",
                       "value": { "type": "dice", "equation": "1d4+1" } } ] } ],
  "dice_stream": [2, 4, 1],
  "expect": { "hp_after": { "imp": 10 },
              "applied": [
                { "target": "imp", "property": "hp", "op": "sub_prop", "previous": 20, "next": 17 },
                { "target": "imp", "property": "hp", "op": "sub_prop", "previous": 17, "next": 12 },
                { "target": "imp", "property": "hp", "op": "sub_prop", "previous": 12, "next": 10 } ] }
}
```

(Damage per missile is die + 1: 3, 5, 2.)

Vector F2 - "repeat inside foreach: per-target iteration"

```json
{
  "label": "F2 two ticks per foe",
  "context": "trigger", "actor": "caster",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "caster": { "properties": {}, "tags": [] },
    "g_a": { "properties": { "hp": 5 }, "tags": ["foe"] },
    "g_b": { "properties": { "hp": 5 }, "tags": ["foe"] } } },
  "mutations": [
    { "type": "foreach_target", "select": { "tag": "foe" },
      "mutations": [
        { "type": "repeat", "count": 2,
          "mutations": [ { "type": "sub_prop", "target": "each", "property": "hp",
                           "value": { "type": "literal", "value": 1 } } ] } ] } ],
  "dice_stream": [],
  "expect": { "hp_after": { "g_a": 3, "g_b": 3 }, "applied_count": 4 }
}
```

(Application order: g_a tick, g_a tick, g_b tick, g_b tick - target order is
the OUTER loop.)

Vector F3 - "count 0 rejects"

```json
{ "context": "trigger", "actor": "caster",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "caster": { "properties": { "hp": 5 }, "tags": [] } } },
  "mutations": [ { "type": "repeat", "count": 0, "mutations": [] } ],
  "dice_stream": [],
  "expect": { "reject": true, "reason": "repeat count must be an integer in 1..16",
              "rng_draws_total": 0, "state_unchanged": true } }
```

Vector F4 - "count 17 rejects (over MAX_ITERATIONS)"

Same as F3 with `"count": 17`; same rejection expectation.

Vector F5 - "multiplicity overruns MAX_APPLIED_MUTATIONS"

```json
{ "context": "trigger", "actor": "caster",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "caster": { "properties": {}, "tags": [] } } },
  "mutations": [
    { "type": "repeat", "count": 16,
      "mutations": [
        { "type": "foreach_target", "select": { "tag": "foe", "limit": 32 },
          "mutations": [
            { "type": "sub_prop", "target": "each", "property": "hp",
              "value": { "type": "literal", "value": 1 } },
            { "type": "add_tag", "target": "each", "tag": "burning" },
            { "type": "remove_tag", "target": "each", "tag": "hidden" } ] } ] } ],
  "dice_stream": [],
  "expect": { "reject": true,
              "reason": "applied-mutation budget exceeded (max 1024)",
              "rng_draws_total": 0, "state_unchanged": true } }
```

(M = 16 * 32 = 512; three leaf mutations charge 3 * 512 = 1536 > 1024.
With only TWO leaf mutations the charge would be exactly 1024 and the
document would be ACCEPTED - the budget check is strictly-greater-than.)

Vector F6 - "multiplied dice overrun MAX_DICE_TOTAL"

```json
{ "context": "trigger", "actor": "caster",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "caster": { "properties": {}, "tags": [] } } },
  "mutations": [
    { "type": "foreach_target", "select": { "tag": "foe", "limit": 32 },
      "mutations": [
        { "type": "repeat", "count": 16,
          "mutations": [ { "type": "sub_prop", "target": "each", "property": "hp",
                           "value": { "type": "dice", "equation": "2d6" } } ] } ] } ],
  "dice_stream": [],
  "expect": { "reject": true, "reason": "total dice count exceeds budget 1000",
              "rng_draws_total": 0, "state_unchanged": true } }
```

(M = 32 * 16 = 512; the `2d6` charges 2 * 512 = 1024 > 1000. Note the
applied-mutation charge alone - 512 - would have passed; the dice budget is
the binding constraint here.)

Vector F7 - "lexical '3.0' for repeat.count accepts BY VALUE (section 1.4)"

Identical to F1 in state, stream, and every expectation - the document
differs only in the lexical form of `count`. Because reserializing the
vector file would erase that form, this vector carries the document as raw
text (section 1.5 `raw_document`); the harness MUST parse the string with
its surface's standard JSON parser:

```json
{
  "label": "F7 repeat count written as 3.0 parses to integer 3 everywhere",
  "context": "trigger", "actor": "mage", "target": "imp",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "mage": { "properties": {}, "tags": [] },
    "imp":  { "properties": { "hp": 20 }, "tags": [] } } },
  "raw_document": "[{\"type\":\"repeat\",\"count\":3.0,\"mutations\":[{\"type\":\"sub_prop\",\"target\":\"target\",\"property\":\"hp\",\"value\":{\"type\":\"dice\",\"equation\":\"1d4+1\"}}]}]",
  "dice_stream": [2, 4, 1],
  "expect": { "hp_after": { "imp": 10 }, "applied_count": 3,
              "rng_draws_total": 3 }
}
```

(JS `JSON.parse` yields the number 3 - indistinguishable from a lexical `3`.
Python `json.loads` yields `float 3.0`; a port that rejects it on a bare
int-type check accepts/rejects differently from the reference on the SAME
document bytes and fails this vector. The normative rule is section 1.4:
integral-valued, JS-safe numbers are integers regardless of lexical form.)

### 7.5 Worked example (F1)

1. Validation: `count` 3 in range; M' = 3; the leaf mutation charges 3
   applied units; the `1d4+1` charges 1 * 3 = 3 dice. Accepted.
2. Iteration 1: `1d4+1` rolls 2 -> value 3; hp 20 -> 17.
3. Iteration 2: fresh roll 4 -> value 5; hp 17 -> 12.
4. Iteration 3: fresh roll 1 -> value 2; hp 12 -> 10.
5. Three records, in order; PRNG consumed exactly 3 draws.

---

## 8. Budget algebra - the static multiplicity multiplier `M`

This section defines the EXACT validation-time algorithm every surface must
implement identically. It runs entirely inside the existing fail-closed
static pass (zero RNG, zero state).

### 8.1 State

The v1 `ValidateBudget { nodes, dice }` gains one field: `applied`
(worst-case leaf-mutation applications). The walk additionally threads an
integer multiplier `M`, starting at 1 for each validated document (a check or
a trigger list), and a static scope flag/stack for `each` (section 6.3).

### 8.2 Rules

1. Every AST node bumps `nodes` by 1 on first visit (operands of `compare`
   bump 1 each as well); `nodes > MAX_NODES` rejects. v2 changes NOTHING
   about how v1 nodes are counted.
2. A `dice` expression node with parsed `count` charges `dice += count * M`;
   `dice > MAX_DICE_TOTAL` rejects.
3. A LEAF mutation node (`set_prop` / `add_prop` / `sub_prop` / `add_tag` /
   `remove_tag`) charges `applied += M`; `applied > MAX_APPLIED_MUTATIONS`
   rejects. Structural mutation nodes (`if` / `foreach_target` / `repeat`)
   charge nothing themselves.
4. Entering a `foreach_target` body: `M' = M * L` where `L = select.limit`
   if present else `MAX_TARGETS`. If `M' > MAX_APPLIED_MUTATIONS`, reject
   immediately (before walking the body). Walk the body with `M'`.
5. Entering a `repeat` body: `M' = M * count`; same immediate-reject rule;
   walk the body with `M'`.
6. Entering an `if`: walk the condition (charges nodes only), then walk
   `then` AND `else` each with the UNCHANGED `M` - both branches are charged
   in full (conservative by design; the static pass never reasons about
   which branch will run).
7. The check's `roll` and `dc` expressions and all degree conditions are
   walked with `M = 1` (no structural mutation node can enclose them).
8. Accumulator scope (normative): the three accumulators (`nodes`, `dice`,
   `applied`) are DOCUMENT-GLOBAL. ONE shared accumulator threads the entire
   walk - the `roll` expression, the `dc` expression, and EVERY degree
   branch's condition and mutation list (or the entire trigger list) -
   exactly as the shipped v1 `validateCheck` threads its single
   `ValidateBudget` across the roll, the dc, and all four branches. At most
   one degree branch ever EXECUTES, but ALL of them CHARGE. The
   constants-table phrase "per resolution" means "per validated document",
   NOT "per executed path": an implementation that charges
   max-over-branches ACCEPTS documents the reference REJECTS and is
   non-conformant. Vector H1 (section 8.6) pins this boundary.

Because rule 4/5 reject the moment `M'` exceeds 1024, `M` is bounded by 1024
on every surface and every product in this algorithm fits comfortably in i32,
i64, f64, and Python int alike - the algebra itself has no overflow surface.

### 8.3 Depth counters

Three independent counters share the constant `MAX_EXPR_DEPTH = 16`:

1. Expression depth (v1, unchanged): `math` nesting inside one expression.
2. Condition depth (v1, extended): `or` and now `and` nesting inside one
   condition tree. `compare` operands are leaves and add no depth.
3. Mutation-structure depth (NEW): starts at 0 at each top-level mutation
   list; +1 when entering an `if` branch list, a `foreach_target` body, or a
   `repeat` body. Exceeding 16 rejects.

Each expression tree starts its own expression-depth count at 0 wherever it
is rooted (a mutation value, `roll`, `dc`) - v1 behavior, unchanged.

### 8.4 Evaluation-order summary (normative, one list)

Within one resolution, the PRNG-consuming order is exactly:

1. Check context only: `roll` expression (left-to-right, depth-first), then
   `dc` expression. (Trigger context: neither exists.)
2. Mutations of the winning degree branch (or the trigger list), in array
   order. Within a mutation: its value expression, left-to-right depth-first.
   Within an `if`: the taken branch's list, in order (untaken branch: zero).
   Within a `foreach_target`: iteration order (UTF-16-sorted, truncated id
   list) is the outer loop, mutation-list order the inner.
   Within a `repeat`: iteration 1..count outer, mutation-list order inner.
3. Conditions NEVER consume PRNG, anywhere.

### 8.5 Why no v1 document is affected

For a v1 document, no structural mutation nodes exist, so `M` is 1
everywhere: the dice charge equals the v1 charge exactly, and `applied` is
bounded by the number of mutation nodes, which `MAX_NODES = 256` already
caps below `MAX_APPLIED_MUTATIONS = 1024`. Therefore no v1-valid document
can reject under v2 rules, and no v1 evaluation changes: v2 surfaces are
drop-in for v1 documents.

### 8.6 Golden vector - the accumulator is document-global

Vector H1 - "every branch is under the dice budget alone; the document sum
is not - the document REJECTS"

```json
{
  "label": "H1 dice budget sums across ALL degree branches",
  "context": "check", "actor": "hero",
  "state": { "epoch": 0, "worldSeed": 0, "entities": {
    "hero": { "properties": { "hp": 1000 }, "tags": [] } } },
  "ast": { "type": "check",
    "roll": { "type": "dice", "equation": "1d20" },
    "dc":   { "type": "literal", "value": 10 },
    "degrees": {
      "critical_success": { "condition": { "type": "delta_gte", "value": 10 },
        "mutations": [
          { "type": "sub_prop", "target": "self", "property": "hp",
            "value": { "type": "dice", "equation": "100d6" } },
          { "type": "sub_prop", "target": "self", "property": "hp",
            "value": { "type": "dice", "equation": "100d6" } },
          { "type": "sub_prop", "target": "self", "property": "hp",
            "value": { "type": "dice", "equation": "100d6" } } ] },
      "success":          { "condition": { "type": "delta_gte", "value": 0 },
        "mutations": [ "...the same three 100d6 sub_props..." ] },
      "failure":          { "condition": { "type": "delta_lte", "value": -1 },
        "mutations": [ "...the same three 100d6 sub_props..." ] },
      "critical_failure": { "condition": { "type": "delta_lte", "value": -10 },
        "mutations": [ "...the same three 100d6 sub_props..." ] } } },
  "dice_stream": [],
  "expect": { "reject": true,
              "reason": "total dice count exceeds budget 1000",
              "rng_draws_total": 0, "state_unchanged": true }
}
```

(The three `"..."` strings are presentation shorthand for THIS DOCUMENT
only - the machine vector spells out the identical three-mutation list in
all four branches. The arithmetic: the roll charges 1 die; each branch
charges 300; the document-global sum is 1 + 4 * 300 = 1201 > 1000 ->
REJECT, zero draws, state unchanged. Any single branch plus the roll is
301 <= 1000, so a max-over-branches implementation - a natural misreading of
"per resolution", since only one branch ever runs - ACCEPTS this document
and fails the vector. That is the pin.)

### 8.7 Uncharged work: condition evaluation and selection scans

The budget algebra charges dice and leaf-mutation applications. It does NOT
charge condition evaluation, selection scans, or structural-node executions
- and empty `then` / `else` / `mutations` bodies are legal (sections 5.1,
6.3), so a tiny document can legally make structural nodes execute many
times while charging nothing. Example: `repeat 16 { repeat 16 { repeat 4 {
foreach (limit 1) { mutations: [] } } } }` is ~10 nodes, zero dice, zero
applied units - every budget passes - yet the foreach SELECT runs 16 * 16 *
4 = 1024 times; an `if` over a large condition tree in the same position
would evaluate that tree 1024 times. This is deliberate, and its ceiling is
pinned here instead of charged:

- Structural multiplicity is hard-capped: rules 4/5 reject the moment
  `M' > 1024`, so NO structural body - empty or not - can execute more than
  `MAX_APPLIED_MUTATIONS = 1024` times per resolution, regardless of shape.
- Condition work per execution is capped by document size: a condition tree
  is at most `MAX_NODES = 256` nodes, so uncharged condition-node
  evaluations are bounded by `1024 * 256 = 262,144` per resolution - each
  one an RNG-free integer comparison or tag-membership test. This ceiling
  is ACCEPTED by design: it is sub-millisecond work on every target
  surface, and charging it would complicate the algebra for no security
  gain.
- Selection scans are bounded by executions times state size: at most 1024
  SELECT scans per resolution (one per foreach execution, M-capped), each
  `O(N_entities)`. The document budgets CANNOT bound `N_entities` - it is a
  property of the STATE, invisible to static validation - so v2 bounds it
  at runtime instead: `MAX_WORLD_ENTITIES = 65536` (section 6.2 step 1). A
  SELECT against a larger working state throws a runtime error (the v1
  runtime-error class - like the missing-target error it can fire after
  earlier dice were consumed; the SELECT itself has consumed zero PRNG),
  identically on every surface, so heterogeneous fleets cannot diverge on
  huge states either. Worst-case uncharged selection work is therefore
  `1024 * 65536` tag-membership tests per resolution - large but linear,
  bounded, and deterministic; and any state near that size is already
  paying `O(N)` per event at the canonical-hash gate, which dwarfs the
  scan.

So the panel's question - can nested iteration x multi-target x
and-composition multiply evaluation cost past the budgets - closes as: dice
and mutation cost cannot (rules 1-8); condition-evaluation and
selection-scan cost are multiplied by structural M but are bounded by
`M <= 1024` times `MAX_NODES` and `MAX_WORLD_ENTITIES` respectively, as
stated above, and both bounds are normative.

---

## 9. Rejection behavior on unknown / over-budget input (consolidated)

All of the following reject at STATIC VALIDATION - fail-closed, zero PRNG
draws, zero state changes, identically on TS / Python / Rust:

- Unknown `type` on any expression / condition / mutation node (this is also
  exactly what happens when a v2 document reaches a v1-only surface).
- Unknown `compare` `op` or operand `source`; malformed operand objects.
- `and` with a missing, non-array, or EMPTY `conditions` array.
- `nat_roll_gte` / `nat_roll_lte` / `delta_*` / `nat_roll_eq`, or `compare`
  operands `roll` / `dc` / `delta` / `natural`, in TRIGGER context.
- `each` outside any `foreach_target` body.
- `has_tag` with a target ref outside the four refs, an unclean `tag`, or
  an out-of-scope `each` (section 4.6).
- `repeat.count` not an integer in `1..MAX_ITERATIONS`.
- `foreach_target.select.limit` present but not an integer in
  `1..MAX_TARGETS`; missing / unclean `select.tag`.
- `nodes > MAX_NODES`; `dice > MAX_DICE_TOTAL` (charged at multiplicity M,
  summed document-globally - section 8.2 rule 8); `applied >
  MAX_APPLIED_MUTATIONS`; `M' > MAX_APPLIED_MUTATIONS` at body entry; any of
  the three depth counters exceeding `MAX_EXPR_DEPTH`.
- All v1 rejections, unchanged (non-integral numbers - by VALUE, section
  1.4 - unsafe integers, malformed dice, unclean names, `__proto__`,
  unknown target refs, etc.).

Error message TEXT is surface-local; the reject/accept BOUNDARY is normative.

Runtime errors that survive validation keep v1 semantics (e.g. target ref
`target` with no context target supplied - reachable in v2 also through
`compare` `prop` operands and `has_tag`). v2 adds exactly two new runtime
errors, both identical on every surface: the exact-`delta` range check
(section 4.2) and the `MAX_WORLD_ENTITIES` cap at `foreach_target` SELECT
(sections 6.2, 8.7). On every surface "throws" means that surface's error
channel; on the C-ABI / WASM / UniFFI binding surfaces every rejection and
runtime error is an ERROR RETURN, never a panic, foreign exception, or
process abort - section 10's binding rule is part of this contract.

---

## 10. Cross-language implementation notes

- Integer model: JS-safe integers everywhere (`|x| <= 2^53 - 1`), `-0`
  normalized to `+0` at the assertInt choke point. Rust: i64 plus the
  explicit range check. Python: int plus the explicit range check. v2 adds
  NO new arithmetic operations (comparisons and bounded loop counters only),
  so it adds no new overflow surface; all arithmetic remains v1 `math` +
  `assertInt`.
- Sorting: the ONLY ordering introduced by v2 is the `foreach_target` id
  sort, and it reuses the UTF-16-code-unit comparator already required for
  canonical JSON keys and `normalizeTags`. Do not introduce a second
  comparator.
- PRNG: only `Pcg32.rollDie` consumes randomness, only inside expression
  evaluation, in the order of section 8.4. Conditions, selection, ordering,
  truncation, and loop control consume zero.
- Validation first, always: implement the section 8 algebra inside the
  existing `validateCheck` / `validateTriggeredMutations` walks so the
  reject boundary stays byte-identical (zero RNG, zero state) on every
  surface.
- Binding surfaces (C ABI / WASM / UniFFI) - the reject contract crosses the
  FFI as an ERROR, never a crash. The Rust port of this ruleset code is a
  first-class embedding target: LOOM-RUST-EXTRACTION-SPEC.md exposes it
  through `loom_c_abi` (`#[no_mangle] pub extern "C"`, raw pointers, for
  Unity / Godot / C# hosts), `loom_wasm`, and UniFFI. Sections 9-11 describe
  rejection as "throws", which is TS semantics; across `extern "C"` the
  Rust analog of a throw is a panic, and a panic that unwinds across the
  FFI boundary is undefined behavior or a process abort. Without a stated
  rule, a malicious v2 document reaching a strict C-ABI surface - or a
  lagging v1-only C-ABI port doing its contractual reject-unknown on a v2
  node - could kill the host process: a denial of service that defeats the
  very "unknown node throws, zero RNG, zero state, reject advances nothing"
  invariant the rejection is supposed to uphold. Normative: on the C-ABI,
  WASM, and UniFFI surfaces, EVERY rejection and runtime error defined by
  this spec (unknown node, over-budget, bad context, malformed dice,
  missing target, unsafe delta, entity cap) MUST cross the boundary as an
  error return / out-param, never as an uncaught panic or foreign
  exception. The binding layer MUST make this total: either the core
  returns `Result` end-to-end on every entry point, or the binding wraps
  evaluation in `catch_unwind` and converts any panic into the error return
  (and a crate relying on `catch_unwind` must not be built with
  `panic = "abort"`). The error channel changes NOTHING about the contract
  itself: a rejected document advances neither the PRNG nor the state, and
  the same input rejects at the same boundary on every binding. This rule
  binds v1-only C-ABI ports exactly as it binds v2 surfaces - the
  reject-unknown path is the one a heterogeneous fleet exercises most.
- Conformance vectors: the spec-level vectors above (scripted dice streams)
  pin semantics; the repo-pinned vector file generated by the real TS
  evaluator (per `tools/gen-ast-vectors.ts`) additionally pins real Pcg32
  seeds and `worldStateHash` values. Ports must pass BOTH.

## 11. Compatibility and versioning

Restated normatively: v1 documents remain valid, byte-identically evaluated,
on v2 surfaces (section 8.5). The six v2 families are additive. Old (v1-only)
surfaces reject any document containing a v2 node as an unknown node type,
fail-closed with zero PRNG and zero state effect - that is the EXISTING v1
contract, so heterogeneous fleets (a v2 TS surface alongside a v1 Rust port
mid-migration) can never silently diverge: a document either evaluates
identically everywhere or is rejected outright by the lagging surface. On
embedded binding surfaces that lagging-surface rejection is an ERROR RETURN,
never a panic or process abort - the section 10 C-ABI / WASM / UniFFI rule
applies to v1-only ports exactly as to v2 surfaces, because reject-unknown
is the path every mixed-version fleet exercises.

---

## 12. Complete example ruleset 1 - PbtA-style move (pure JSON data)

"Act Under Pressure": 2d6 + cool against a flat 0 (PbtA has no DC; the bands
live on the total). 12+ advanced success, 10-11 full hit, 7-9 partial hit
(costs 1 stress), 6- miss (marks 1 xp). Degree KEYS are the engine's fixed
ordered slots - the ruleset maps its fiction onto them; the mutations carry
the meaning.

```json
{
  "type": "check",
  "roll": {
    "type": "math", "op": "add",
    "left":  { "type": "dice", "equation": "2d6" },
    "right": { "type": "prop_ref", "target": "actor", "property": "cool" }
  },
  "dc": { "type": "literal", "value": 0 },
  "degrees": {
    "critical_success": {
      "condition": { "type": "delta_gte", "value": 12 },
      "mutations": [
        { "type": "add_tag", "target": "actor", "tag": "advanced_hit" },
        { "type": "add_prop", "target": "actor", "property": "momentum",
          "value": { "type": "literal", "value": 2 } },
        { "type": "set_prop", "target": "actor", "property": "last_outcome",
          "value": { "type": "literal", "value": 3 } }
      ]
    },
    "success": {
      "condition": { "type": "delta_gte", "value": 10 },
      "mutations": [
        { "type": "add_tag", "target": "actor", "tag": "full_hit" },
        { "type": "add_prop", "target": "actor", "property": "momentum",
          "value": { "type": "literal", "value": 1 } },
        { "type": "set_prop", "target": "actor", "property": "last_outcome",
          "value": { "type": "literal", "value": 2 } }
      ]
    },
    "failure": {
      "condition": { "type": "and", "conditions": [
        { "type": "delta_gte", "value": 7 },
        { "type": "delta_lte", "value": 9 }
      ] },
      "mutations": [
        { "type": "add_tag", "target": "actor", "tag": "partial_hit" },
        { "type": "add_prop", "target": "actor", "property": "stress",
          "value": { "type": "literal", "value": 1 } },
        { "type": "set_prop", "target": "actor", "property": "last_outcome",
          "value": { "type": "literal", "value": 1 } }
      ]
    },
    "critical_failure": {
      "condition": { "type": "delta_lte", "value": 6 },
      "mutations": [
        { "type": "add_tag", "target": "actor", "tag": "missed" },
        { "type": "add_prop", "target": "actor", "property": "xp",
          "value": { "type": "literal", "value": 1 } },
        { "type": "set_prop", "target": "actor", "property": "last_outcome",
          "value": { "type": "literal", "value": 0 } }
      ]
    }
  }
}
```

Band totality: the four conditions partition every possible total (delta =
total since dc is 0): >= 12, 10-11 (>= 10 checked after >= 12 fails),
7-9, <= 6. First-match-wins ordering makes the >= 10 band safe to write
without an upper bound.

Worked resolution: actor `pc` with `cool: 1`, dice stream `[4, 3]`. Roll =
4 + 3 + 1 = 8, natural 4, dc 0, delta 8. Degrees: 8 >= 12 no; 8 >= 10 no;
`and`(8 >= 7, 8 <= 9) yes -> `failure` slot = partial hit. Mutations apply
in order: tag `partial_hit`, stress 0 -> 1, last_outcome -> 1. Three applied
records; exactly two dice consumed (the 2d6), zero others.

## 13. Complete example ruleset 2 - d100 BRP-style skill check (pure JSON data)

Roll 1d100 against `skill` (roll-under: success when roll <= skill, i.e.
delta <= 0). Bands: 01-05 critical (only if also a success), special on
natural <= `skill_fifth` (a rider INSIDE success, since the engine has four
fixed degree slots), 96-00 always a fumble (excluded from plain
success/failure by `nat_roll_lte 95`). `last_outcome` encoding: 4 crit,
3 special, 2 success, 1 failure, 0 fumble.

Content-layer convention: `skill_fifth` is a stored derived stat
(`floor_div(skill, 5)`) maintained by the content layer whenever `skill`
changes, because `compare` operands are deliberately math-free in v2
(section 4.1 / section 14).

```json
{
  "type": "check",
  "roll": { "type": "dice", "equation": "1d100" },
  "dc":   { "type": "prop_ref", "target": "actor", "property": "skill" },
  "degrees": {
    "critical_success": {
      "condition": { "type": "and", "conditions": [
        { "type": "nat_roll_lte", "value": 5 },
        { "type": "delta_lte", "value": 0 }
      ] },
      "mutations": [
        { "type": "add_tag", "target": "actor", "tag": "crit" },
        { "type": "set_prop", "target": "actor", "property": "last_outcome",
          "value": { "type": "literal", "value": 4 } }
      ]
    },
    "success": {
      "condition": { "type": "and", "conditions": [
        { "type": "delta_lte", "value": 0 },
        { "type": "nat_roll_lte", "value": 95 }
      ] },
      "mutations": [
        { "type": "set_prop", "target": "actor", "property": "last_outcome",
          "value": { "type": "literal", "value": 2 } },
        { "type": "if",
          "condition": { "type": "compare", "op": "lte",
            "left":  { "source": "natural" },
            "right": { "source": "prop", "target": "actor", "property": "skill_fifth" } },
          "then": [
            { "type": "add_tag", "target": "actor", "tag": "special_success" },
            { "type": "set_prop", "target": "actor", "property": "last_outcome",
              "value": { "type": "literal", "value": 3 } }
          ]
        }
      ]
    },
    "failure": {
      "condition": { "type": "and", "conditions": [
        { "type": "delta_gte", "value": 1 },
        { "type": "nat_roll_lte", "value": 95 }
      ] },
      "mutations": [
        { "type": "set_prop", "target": "actor", "property": "last_outcome",
          "value": { "type": "literal", "value": 1 } }
      ]
    },
    "critical_failure": {
      "condition": { "type": "nat_roll_gte", "value": 96 },
      "mutations": [
        { "type": "add_tag", "target": "actor", "tag": "fumble" },
        { "type": "set_prop", "target": "actor", "property": "last_outcome",
          "value": { "type": "literal", "value": 0 } }
      ]
    }
  }
}
```

Band totality (natural = roll for 1d100, single die, no modifier): naturals
96-100 always land in `critical_failure` (both success and failure exclude
them via `nat_roll_lte 95` - a design choice: 96-00 fails even for skill
>= 96, BRP-style). Naturals 1-95 split exactly by delta sign into success
(<= 0) and failure (>= 1). Crit is checked first and additionally requires
the roll to be a success, so a natural 3 against skill 2 (delta 1) is a
plain failure, not a crit.

Worked resolution: actor with `skill: 40`, `skill_fifth: 8`, dice stream
`[7]`. Roll 7, natural 7, dc 40, delta -33. Degrees: crit -> `and`(7 <= 5
FALSE) no; success -> `and`(-33 <= 0, 7 <= 95) yes -> MATCH. Mutations:
`last_outcome` -> 2; then the `if` rider: natural 7 <= skill_fifth 8 ->
true -> tag `special_success`, `last_outcome` -> 3. Three applied records;
the final state says special success - expressed without a fifth degree
slot and without any precomputed special THRESHOLD comparison result (only
the stored fifth itself).

## 14. Deliberate scope cuts (v2 non-goals, stated so nobody fakes them)

- **No `not` condition.** Negation is expressed by writing the complementary
  band (`nat_roll_lte 95` instead of "not >= 96"). A `not` node is a clean
  v3 candidate.
- **No math / dice inside `compare` operands.** Conditions stay structurally
  RNG-free and trivially pure; derived thresholds are precomputed into
  properties by the content layer (section 13's `skill_fifth`).
- **No value bindings.** Roll-once-apply-to-many (5e fireball's shared
  damage roll) is NOT expressible; `foreach_target` re-rolls per target.
  A `let`-binding family is the v3 candidate that would unlock it.
- **No dynamic `repeat` counts.** `count` is a literal so the multiplicity
  budget stays sound at validation time.
- **No new degree names and no reordering.** `DEGREE_ORDER` stays the fixed
  four; rulesets map their fiction onto the ordered slots (sections 12, 13).
- **No new selectors.** `foreach_target` selects by one tag only; richer
  selection (property predicates, unions) composes badly with the budget
  algebra and waits for evidence it is needed.
- **No keep-highest / keep-lowest dice pools through check degrees.** (FitD /
  Blades-style "roll Nd6, keep the highest; two 6s = critical".) The
  expression family has no `max` / `min` / count-successes op and no
  comparisons, conditions are RNG-free by design (so they cannot roll the
  pool), and mutations run only AFTER degree selection - so no single
  document can band `ActionResult.degree` on "highest die is 6" or "two 6s".
  Two data-only constructions EXIST, and both are stated here so nobody
  half-fakes them: (a) a pure trigger-context build - per-die blocks guarded
  by `if compare(prop pool gte k)` so untaken branches roll nothing, running
  best / sixes accumulators via `compare` + `set_prop` scratch properties,
  and a nested `if`/`else` outcome chain (roughly 100 nodes, ~6 dice at
  M = 1, depth <= 3 - every budget passes) - which works but BYPASSES
  `ActionResult.degree` entirely, so nothing keyed on degrees ever sees the
  outcome; or (b) two documents host-sequenced - a trigger pre-roll into
  `best` / `sixes`, then a check with `roll = prop_ref best`, `dc` 0, and a
  crit condition `compare(prop sixes gte 2)` - which yields a REAL degree
  but requires host-side sequencing this spec does not define, and `natural`
  is null in that check. Both are INFORMATIVE sketches only: v2 blesses
  neither with golden vectors, and the honest statement is that FitD pools
  do NOT reach the check/degree machinery in v2. A `max` / keep expression
  op (with a defined natural-roll rule for kept dice) is the v3 candidate
  that would make this a first-class single check.
- **No `remove_prop` (no property deletion).** Scratch properties written
  during a resolution (the per-target-save idiom, section 6.6; the FitD
  accumulators above) persist in the entity and in `worldStateHash` forever.
  An absent property and a stored 0 READ identically
  (missing-reads-are-zero) but HASH differently - content layers must treat
  scratch names as permanent, reused slots (overwrite via `set_prop`, never
  expect cleanup). A `remove_prop` mutation is a clean v3 candidate.

Every one of these can ship later WITHOUT breaking v2 documents, by the same
additive mechanism v2 itself uses.

---

## Appendix A - Revision 2 resolution map (adversarial panel, 14 findings)

All 14 findings were accepted; none were rejected. Where the panel offered
two remedies, the chosen branch and its grounds are noted.

1. FitD keep-highest pools: resolved as a section 14 deliberate cut (the
   panel's "or" branch), with both data-only constructions documented as
   informative sketches. Grounds for choosing the cut over a blessed worked
   example: pattern (a) bypasses `ActionResult.degree` - blessing it with
   vectors would canonize a degree-less outcome channel the rest of the
   engine cannot key on; pattern (b) requires host-side two-document
   sequencing this spec has no machinery to define. A `max`/keep v3 op is
   the honest fix; faking first-class support via vectors is not.
2. Tag-testing conditions: resolved by ADDING `has_tag` (section 4.6,
   vectors C6/C7) rather than cutting the section 5 use case - the
   duplicated tag+property mirror with no lockstep guarantee was a real
   content-layer trap, and the node is a leaf with trivial budget impact.
3. Per-target save: resolved with vector E6 plus normative idiom section
   6.6 (scratch property, hash persistence, full-scale budget math) and the
   `remove_prop` cut stated in section 14.
4. Zero-sides dice: pinned to TS behavior - `Nd0` SETS natural to 0;
   `rollDie(0)` pops no scripted-stream entry (sections 0, 1.3, 2.2,
   vector A5).
5. Evaluation strategy: short-circuit is now MUST for `and` AND v1 `or`
   (matching the shipped TS `or`); `compare` resolves left then right, both
   always, null never skips; the byte-identical claim is withdrawn
   (sections 3.2, 4.2).
6. Budget accumulator: document-global, normatively (section 8.2 rule 8,
   constants table), pinned by vector H1 (section 8.6).
7. `delta` exactness: `assertInt` mandated at delta computation on every
   surface including a one-line TS reference amendment; f64 boundary
   equivalence proven normatively (section 4.2).
8. Number lexical forms: validation by VALUE after standard JSON parsing;
   Python/Rust must normalize integral floats; pinned by vector F7
   (sections 1.4, 6.3, 7.3).
9. foreach re-selection: SELECT + snapshot re-run per EXECUTION, caching is
   non-conformant; pinned by vector E7 (section 6.2 step 1).
10. `compare` prop reads: pass the same `assertInt` choke point as
    `prop_ref`, including `-0` normalization (section 4.2).
11. Extra fields: IGNORED on every surface, invisible to validation and
    budgets; the self-contradictory wording is withdrawn; pinned by vector
    D5 (sections 1.4, 5.4).
12. Vector schema: normative schema in section 1.5; `rng_draws` renamed
    `rng_draws_total` throughout; `reason` is informative-only.
13. C-ABI reject contract: error return / out-param, never a panic or
    abort; `catch_unwind` (or `Result` end-to-end) mandated; applies to
    lagging v1-only ports (sections 9, 10, 11).
14. Uncharged work: condition-eval and selection-scan ceilings stated and
    accepted (`M <= 1024` times `MAX_NODES`); the missing state-size bound
    is pinned as the new `MAX_WORLD_ENTITIES = 65536` runtime cap
    (sections 1.2, 6.2, 8.7).
