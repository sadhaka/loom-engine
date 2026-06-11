"""Add provenance fields (meta.generator + meta.generated_note) to every
test_vectors/*.json that lacks them - WITHOUT touching any payload value.

Surgical text insertion: the two lines are inserted right after the
`"meta": {` line, preserving each file's existing formatting and line
endings byte-for-byte everywhere else (several vectors are hand-formatted,
so a full json re-serialization would churn the whole file). After writing,
the script re-parses and asserts the new document equals the old one plus
EXACTLY the two meta keys.

Run from the repo root:  python tools/add_vector_provenance.py
Idempotent - files that already carry both fields are skipped.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VEC = os.path.join(HERE, "..", "test_vectors")

# filename -> (generator, generated_note). Origins verified against git
# history and the tools/ + rust/ sources on 2026-06-12.
PROVENANCE = {
    "event_chain_v1.json": (
        "tools/gen-event-vectors.ts",
        "Regenerate with: npx tsx tools/gen-event-vectors.ts (runs the real "
        "engine EventChain + hmacSha256Hex). The pinned cases must regenerate "
        "byte-identical unless the canonical-message format itself changes.",
    ),
    "v2_3_0_primitives.json": (
        "hand-authored (no generator tool)",
        "Hand-authored in commit a1681a451 alongside the TS + Python golden "
        "harnesses; there is no generator script - edit by hand and keep the "
        "TS, Python and Rust harnesses green.",
    ),
    "v3_0_snapshot_canonical.json": (
        "tools/gen-snapshot-vectors.ts",
        "Regenerate with: npx tsx tools/gen-snapshot-vectors.ts (runs the real "
        "TS canonicalJson + world-state HMAC).",
    ),
    "v3_3_epoch_tick.json": (
        "tools/gen-epoch-vectors.ts",
        "Regenerate with: npx tsx tools/gen-epoch-vectors.ts (runs the real TS "
        "tickEpoch / catchUpEpochs).",
    ),
    "v3_4_world_session.json": (
        "tools/gen-session-vectors.ts",
        "Regenerate with: npx tsx tools/gen-session-vectors.ts (runs the real "
        "TS suspend/resume).",
    ),
    "v3_ast_bleed.json": (
        "tools/gen-ast-vectors.ts",
        "Regenerate with: npx tsx tools/gen-ast-vectors.ts (runs the real TS "
        "ruleset-AST evaluator).",
    ),
    "v3_pcg32.json": (
        "rust/loom_math/src/lib.rs::emit_pcg32_golden",
        "Values emitted by the authoritative Rust core: cargo test -p "
        "loom_math emit_pcg32_golden -- --nocapture; the JSON file is "
        "hand-assembled around the emitted block (the floor_div cases are "
        "hand-pinned).",
    ),
    "v5_1_command_frame.json": (
        "tools/gen-frame-vectors.ts",
        "Regenerate with: npx tsx tools/gen-frame-vectors.ts (runs the real TS "
        "tickFrame).",
    ),
    "v5_2_reconciliation.json": (
        "tools/gen-reconcile-vectors.ts",
        "Regenerate with: npx tsx tools/gen-reconcile-vectors.ts (runs the "
        "real TS tickFrame + reconcileFrames).",
    ),
    "v5_3_region_hash.json": (
        "tools/gen-region-vectors.ts",
        "Regenerate with: npx tsx tools/gen-region-vectors.ts (runs the real "
        "TS regionLeaves + globalRegionHash).",
    ),
}


def strip_provenance(doc):
    """Deep-copy of the parsed doc with the two provenance keys removed."""
    clone = json.loads(json.dumps(doc))
    clone.get("meta", {}).pop("generator", None)
    clone.get("meta", {}).pop("generated_note", None)
    return clone


def main():
    changed = 0
    for name in sorted(os.listdir(VEC)):
        if not name.endswith(".json"):
            continue
        if name not in PROVENANCE:
            print("SKIP (no provenance mapping - add one): " + name)
            continue
        path = os.path.join(VEC, name)
        raw = open(path, "rb").read().decode("utf-8")
        old = json.loads(raw)
        meta = old.get("meta")
        if meta is None:
            print("ERROR: " + name + " has no meta block; refusing to guess")
            return 1
        if "generator" in meta and "generated_note" in meta:
            print("ok (already has provenance): " + name)
            continue

        eol = "\r\n" if "\r\n" in raw else "\n"
        lines = raw.split(eol)
        # Find the line that opens the meta object (meta is the first key in
        # every vector file; its value is a flat object).
        open_idx = None
        for i, line in enumerate(lines):
            if line.strip() == '"meta": {':
                open_idx = i
                break
        if open_idx is None:
            print("ERROR: " + name + " - could not locate the meta block opener")
            return 1
        # Indent like the first existing meta key.
        nxt = lines[open_idx + 1]
        indent = nxt[: len(nxt) - len(nxt.lstrip())]
        gen, note = PROVENANCE[name]
        ins = []
        if "generator" not in meta:
            ins.append(indent + '"generator": ' + json.dumps(gen, ensure_ascii=False) + ",")
        if "generated_note" not in meta:
            ins.append(indent + '"generated_note": ' + json.dumps(note, ensure_ascii=False) + ",")
        new_lines = lines[: open_idx + 1] + ins + lines[open_idx + 1 :]
        out = eol.join(new_lines)

        new = json.loads(out)
        # Hard guarantee: nothing but the two meta keys changed.
        if strip_provenance(new) != strip_provenance(old):
            print("ERROR: " + name + " - insertion altered non-provenance content; aborting before write")
            return 1
        assert new["meta"]["generator"] == gen and new["meta"]["generated_note"] == note

        with open(path, "wb") as f:
            f.write(out.encode("utf-8"))
        print("provenance added: " + name)
        changed += 1
    print("done - " + str(changed) + " file(s) updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
