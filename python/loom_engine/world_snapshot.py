"""world_snapshot - deterministic, cross-language world-state snapshot hash (Python).

The Python surface of loom_snapshot (v3.0 Phase 1). Byte-identical to the TS
world-state-snapshot.ts and the Rust loom_snapshot crate:

    state_hash = HMAC-SHA-256(key, field(SNAPSHOT_DOMAIN) + field(canonical_world_state(state)))

Pinned by the shared golden vector test_vectors/v3_0_snapshot_canonical.json, which
this module's tests load and reproduce.

The canonical encoder reproduces the engine's rules EXACTLY - it is NOT json.dumps:
  - object keys sorted by UTF-16 code unit (encode('utf-16-be') gives code-unit
    order), NOT Unicode code point and NOT UTF-8 bytes;
  - the field length prefix counts UTF-16 code units (astral chars count as 2);
  - JS JSON.stringify string escaping: literal non-ASCII, with \\b \\t \\n \\f \\r
    and \\u00xx (lowercase) for the rest of the C0 control set;
  - integer-only: reject a float fraction, -0.0, |n| > 2^53-1, and an own
    "__proto__" key, all fail-closed.

This is the module to use for any cross-language hashing - NOT json.dumps(sort_keys=True),
which sorts by code point and escapes non-ASCII, both of which diverge from the engine.
"""

import hashlib as _hashlib
import hmac as _hmac
import math as _math

# Namespace tag for snapshot HMACs. MUST match the TS/Rust SNAPSHOT_DOMAIN verbatim.
SNAPSHOT_DOMAIN = "loom.snapshot/1"
# Number.MAX_SAFE_INTEGER (2^53 - 1).
MAX_SAFE_INT = 9007199254740991
_MAX_DEPTH = 256

_ESCAPES = {
    '"': '\\"', "\\": "\\\\", "\b": "\\b", "\t": "\\t",
    "\n": "\\n", "\f": "\\f", "\r": "\\r",
}


def _utf16_len(s):
    # UTF-16 code-unit count (astral chars count as 2). Matches JS String.length.
    return len(s.encode("utf-16-le")) // 2


def _field(s):
    # Length-prefixed '<utf16len>:<value>' - matches the TS/Rust field().
    return str(_utf16_len(s)) + ":" + s


def _js_json_string(s):
    # Exactly JS JSON.stringify(s) for a string (with surrounding quotes).
    out = ['"']
    for ch in s:
        esc = _ESCAPES.get(ch)
        if esc is not None:
            out.append(esc)
        elif ord(ch) < 0x20:
            out.append("\\u%04x" % ord(ch))
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _canonical(value, depth):
    if depth > _MAX_DEPTH:
        raise ValueError("WorldStateSnapshot: payload nesting exceeds max depth")
    if value is None:
        return "null"
    # bool BEFORE int (bool is a subclass of int in Python).
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _js_json_string(value)
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_INT:
            raise ValueError("WorldStateSnapshot: integer must be JS-safe (|n| <= 2^53-1)")
        return str(value)
    if isinstance(value, float):
        if not _math.isfinite(value):
            raise ValueError("WorldStateSnapshot: non-finite number not allowed")
        if value == 0.0 and _math.copysign(1.0, value) < 0:
            raise ValueError("WorldStateSnapshot: negative zero not allowed")
        if value != int(value):
            raise ValueError("WorldStateSnapshot: number must be an integer")
        iv = int(value)
        if abs(iv) > MAX_SAFE_INT:
            raise ValueError("WorldStateSnapshot: integer must be JS-safe (|n| <= 2^53-1)")
        return str(iv)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_canonical(v, depth + 1) for v in value) + "]"
    if isinstance(value, dict):
        if "__proto__" in value:
            raise ValueError("WorldStateSnapshot: forbidden key __proto__")
        # Sort keys by UTF-16 code unit (utf-16-be byte order == code-unit order),
        # matching JS Object.keys().sort() and the Rust encode_utf16 comparator.
        keys = sorted(value.keys(), key=lambda k: k.encode("utf-16-be"))
        parts = []
        for k in keys:
            if not isinstance(k, str):
                raise ValueError("WorldStateSnapshot: object keys must be strings")
            parts.append(_js_json_string(k) + ":" + _canonical(value[k], depth + 1))
        return "{" + ",".join(parts) + "}"
    raise ValueError("WorldStateSnapshot: unsupported value type %r" % type(value))


def canonical_world_state(state):
    """Canonical (deterministic, injective) JSON encoding of a world state."""
    return _canonical(state, 0)


def _key_bytes(key):
    return key.encode("utf-8") if isinstance(key, str) else bytes(key)


def world_state_hash(key, state):
    """Pure content hash of a world state. Byte-identical to TS/Rust."""
    msg = _field(SNAPSHOT_DOMAIN) + _field(canonical_world_state(state))
    return _hmac.new(_key_bytes(key), msg.encode("utf-8"), _hashlib.sha256).hexdigest()


def verify_world_snapshot(key, state, expected_hash):
    """True iff the world matches the expected hash (constant-time compare)."""
    return _hmac.compare_digest(world_state_hash(key, state), expected_hash)


def normalize_tags(tags):
    """De-duplicate + sort tags by UTF-16 code unit (matches TS/Rust normalize_tags)."""
    seen = set()
    out = []
    for t in tags:
        if not isinstance(t, str):
            raise ValueError("WorldStateSnapshot: tag must be a string")
        if t not in seen:
            seen.add(t)
            out.append(t)
    out.sort(key=lambda s: s.encode("utf-16-be"))
    return out
