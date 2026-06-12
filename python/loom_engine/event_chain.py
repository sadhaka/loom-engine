"""event_chain - tamper-evident, HMAC-chained event log (Python port).

Byte-identical to the TS event-chain.ts (and the Rust loom_events crate): every
appended record is signed with HMAC-SHA-256, and each signature folds in the
PREVIOUS record's signature, so the whole log is a hash chain. verify_records
recomputes every signature AND checks the chain linkage, catching four tamper
classes a plain log cannot:

  - field tampering   - a payload / type / seq edited at rest (sig_mismatch)
  - record deletion   - a middle record removed (broken_chain_link)
  - record reordering - records shuffled (broken_chain_link)
  - tail truncation   - records dropped off the END, detected when an earlier
                        seal() commitment is supplied (seal_mismatch)

THE CANONICAL FRAMING (must match TS/Rust verbatim - pinned by the chain-head
signatures in test_vectors/v3_5_session_soak.json):

    message = field(RECORD_DOMAIN) + field(str(seq)) + field(type)
            + field(canonical_json(payload)) + field(prev_sig)
    sig     = HMAC-SHA-256(key, UTF8(message)) as lowercase hex

where field(s) = '<utf16len>:<value>' (the length counts UTF-16 code units,
matching JS String.length) and canonical_json reproduces JS JSON.stringify
escaping + UTF-16-code-unit key sort + safe-integer-only numbers, all
fail-closed. Use this module - NOT json.dumps - for anything that must verify
a TS-signed chain.

Records are plain dicts in the cross-language wire shape:
    {"seq": int, "type": str, "payload": ..., "prevSig": str, "sig": str}

SCOPE: integrity, not secrecy. Payloads are stored in the clear; the signature
proves they were not altered. The HMAC key is a runtime parameter, never
persisted or logged by the engine.
"""

import copy as _copy
import hashlib as _hashlib
import hmac as _hmac
import math as _math
import unicodedata as _unicodedata

# Domain tags keep record signatures and seal signatures in separate namespaces
# (a record HMAC can never be reinterpreted as a seal HMAC). The trailing /1 is
# a format version. MUST match the TS RECORD_DOMAIN / SEAL_DOMAIN verbatim.
RECORD_DOMAIN = "loom.chain.rec/1"
SEAL_DOMAIN = "loom.chain.seal/1"
# Codex audit P1 (persistence forge): world-bundle binding namespace. Signs
# worldId + snapshot stateHash + eventIndex + tailGenesis + sealed (count, head).
BUNDLE_DOMAIN = "loom.bundle.bind/1"

# Number.MAX_SAFE_INTEGER (2^53 - 1).
MAX_SAFE_INT = 9007199254740991

# Hard cap on canonicalization / clone recursion depth (matches the TS
# MAX_CANONICAL_DEPTH): a hostile deeply-nested payload is rejected early.
MAX_CANONICAL_DEPTH = 256

# Resource key for the world's resource registry.
RESOURCE_EVENT_CHAIN = "event_chain"

_ESCAPES = {
    '"': '\\"', "\\": "\\\\", "\b": "\\b", "\t": "\\t",
    "\n": "\\n", "\f": "\\f", "\r": "\\r",
}


def _utf16_len(s):
    # UTF-16 code-unit count (astral chars count as 2). Matches JS String.length.
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def field(s):
    """Length-prefixed '<utf16len>:<value>' - matches the TS field()."""
    return str(_utf16_len(s)) + ":" + s


def assert_clean_string(s):
    """Reject lone surrogates + non-NFC strings in any signed string.

    A Python str CAN carry a lone surrogate (json.loads of a bare "\\ud800"
    escape produces one); encoding it lossily would let two distinct strings
    collide after HMAC. Non-NFC is rejected (never normalized) so logically
    equal content cannot sign two ways and fork the chain - mirrors the TS
    assertCleanString + the Rust assert_nfc.
    """
    for ch in s:
        if 0xD800 <= ord(ch) <= 0xDFFF:
            raise ValueError("EventChain: lone surrogate in a signed string")
    if not _unicodedata.is_normalized("NFC", s):
        raise ValueError(
            "EventChain: non-NFC string in a signed payload (normalize to NFC first)")


def _js_json_string(s):
    # Exactly JS JSON.stringify(s) for a clean string (with surrounding quotes):
    # literal non-ASCII, \b \t \n \f \r, and lowercase \u00xx for the rest of C0.
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


def _num_str(value, where):
    # The canonical String(n) of a JS-safe-integer number. A JSON 5.0 parses to
    # the number 5 in JS (String -> '5') but to float 5.0 in Python - coerce the
    # integral float so both surfaces canonicalize identically. Everything else
    # (NaN/Infinity/-0.0/fractions/beyond 2^53-1) is rejected fail-closed.
    if isinstance(value, bool):
        raise ValueError(where + ": bool is not a number")
    if isinstance(value, float):
        if not _math.isfinite(value):
            raise ValueError(where + ": non-finite number (NaN/Infinity) not allowed")
        if value == 0.0 and _math.copysign(1.0, value) < 0:
            raise ValueError(where + ": negative zero not allowed")
        if value != int(value):
            raise ValueError(where + ": number must be a JS-safe integer")
        value = int(value)
    if not isinstance(value, int):
        raise ValueError(where + ": expected a number")
    if abs(value) > MAX_SAFE_INT:
        raise ValueError(where + ": number must be a JS-safe integer (|n| <= 2^53-1)")
    return str(value)


def canonical_json(value, depth=0):
    """Deterministic, STRICT JSON - byte-identical to the TS canonicalJson.

    Object keys sorted by UTF-16 code unit; strings escaped exactly like JS
    JSON.stringify; numbers are JS-safe integers only. Any value that cannot be
    faithfully + injectively serialized raises (fail closed).
    """
    if depth > MAX_CANONICAL_DEPTH:
        raise ValueError(
            "EventChain: payload nesting exceeds max depth %d" % MAX_CANONICAL_DEPTH)
    if value is None:
        return "null"
    # bool BEFORE int (bool is a subclass of int in Python).
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        assert_clean_string(value)
        return _js_json_string(value)
    if isinstance(value, (int, float)):
        return _num_str(value, "EventChain")
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_json(v, depth + 1) for v in value) + "]"
    if isinstance(value, dict):
        # A JSON-parsed '__proto__' key cannot be faithfully round-tripped on the
        # JS side, so the TS core rejects it fail-closed; mirror that here.
        if "__proto__" in value:
            raise ValueError('EventChain: "__proto__" key not allowed in payload')
        keys = []
        for k in value.keys():
            if not isinstance(k, str):
                raise ValueError("EventChain: object keys must be strings")
            assert_clean_string(k)
            keys.append(k)
        # JS Object.keys().sort() = UTF-16 code-unit order (utf-16-be byte order).
        keys.sort(key=lambda k: k.encode("utf-16-be", "surrogatepass"))
        parts = []
        for k in keys:
            parts.append(_js_json_string(k) + ":" + canonical_json(value[k], depth + 1))
        return "{" + ",".join(parts) + "}"
    raise ValueError("EventChain: unsupported value type %r in payload" % type(value))


def _key_bytes(key):
    if isinstance(key, str):
        if len(key) == 0:
            raise ValueError("EventChain: key must not be empty")
        return key.encode("utf-8")
    if isinstance(key, (bytes, bytearray)):
        return bytes(key)
    raise ValueError("EventChain: key must be a string or bytes")


def hmac_sha256_hex(key, message):
    """HMAC-SHA-256 of the UTF-8 message under the key, as lowercase hex."""
    return _hmac.new(_key_bytes(key), message.encode("utf-8"), _hashlib.sha256).hexdigest()


def canonical_message(seq, type_, payload, prev_sig):
    """The exact (injective) string fed to HMAC for one record."""
    assert_clean_string(type_)
    assert_clean_string(prev_sig)
    return (field(RECORD_DOMAIN) + field(_num_str(seq, "EventChain"))
            + field(type_) + field(canonical_json(payload)) + field(prev_sig))


def _seal_message(count, head):
    """The string fed to HMAC for a seal commitment."""
    assert_clean_string(head)
    return field(SEAL_DOMAIN) + field(_num_str(count, "EventChain")) + field(head)


def _bundle_bind_message(world_id, state_hash, event_index, tail_genesis, count, head):
    """Codex audit P1: the world-bundle binding message - byte-identical to the
    TS bundleBindMessage. Length-prefixed (injective) fields."""
    assert_clean_string(world_id)
    assert_clean_string(state_hash)
    assert_clean_string(tail_genesis)
    assert_clean_string(head)
    return (field(BUNDLE_DOMAIN) + field(world_id) + field(state_hash)
            + field(_num_str(event_index, "EventChain")) + field(tail_genesis)
            + field(_num_str(count, "EventChain")) + field(head))


def verify_bundle_binding(key, world_id, state_hash, event_index, tail_genesis, count, head, binding):
    """Verify a world-bundle binding (constant-time). A mismatch on ANY identity
    field fails closed. Mirrors the TS EventChain.verifyBundleBinding."""
    if (not isinstance(binding, str) or not isinstance(world_id, str)
            or not isinstance(state_hash, str) or not isinstance(tail_genesis, str)
            or not isinstance(head, str)):
        return False
    try:
        expected = hmac_sha256_hex(
            key, _bundle_bind_message(world_id, state_hash, event_index, tail_genesis, count, head))
    except Exception:
        return False
    return _hmac.compare_digest(expected, binding)


def verify_records(key, records, genesis="", expected_seal=None):
    """Verify an external record list (e.g. loaded from disk / the network /
    a WorldBundle chainTail) without an instance. Returns
    {"ok": bool, "total": int, "mismatches": [{"seq", "type", "reason"}]}.
    Supply expected_seal (a prior seal() dict) to also detect tail truncation."""
    mismatches = []
    prev_actual = genesis
    for rec in records:
        try:
            expected = hmac_sha256_hex(
                key, canonical_message(rec["seq"], rec["type"], rec["payload"], rec["prevSig"]))
        except Exception:
            # A record whose stored content is not canonicalizable can never
            # carry a valid signature - mismatch (fail closed), do not raise.
            mismatches.append({"seq": rec.get("seq"), "type": rec.get("type"),
                               "reason": "sig_mismatch"})
            prev_actual = rec.get("sig")
            continue
        if not _hmac.compare_digest(expected, rec["sig"]):
            mismatches.append({"seq": rec["seq"], "type": rec["type"],
                               "reason": "sig_mismatch"})
        # Link continuity: a deleted / reordered record makes the stored prevSig
        # disagree with the real predecessor's signature.
        if rec["prevSig"] != prev_actual:
            mismatches.append({"seq": rec["seq"], "type": rec["type"],
                               "reason": "broken_chain_link"})
        prev_actual = rec["sig"]
    # Tail-truncation / head commitment: if a prior seal is supplied, the record
    # count and head must still match it (and the seal itself be valid).
    if expected_seal is not None:
        head_now = records[-1]["sig"] if len(records) > 0 else genesis
        seal_valid = verify_seal(key, expected_seal)
        if (not seal_valid or expected_seal.get("count") != len(records)
                or expected_seal.get("head") != head_now):
            mismatches.append({"seq": expected_seal.get("count"), "type": "(seal)",
                               "reason": "seal_mismatch"})
    return {"ok": len(mismatches) == 0, "total": len(records), "mismatches": mismatches}


def verify_seal(key, seal):
    """Verify a seal's own signature (constant-time). Does not check it against
    any record set - verify_records(..., expected_seal=seal) does that."""
    if not isinstance(seal, dict):
        return False
    count = seal.get("count")
    head = seal.get("head")
    sig = seal.get("sig")
    if (isinstance(count, bool) or not isinstance(count, (int, float))
            or not isinstance(head, str) or not isinstance(sig, str)):
        return False
    try:
        expected = hmac_sha256_hex(key, _seal_message(count, head))
    except Exception:
        # A malformed head can never be part of a valid seal - fail closed.
        return False
    return _hmac.compare_digest(expected, sig)


def _clone_record(rec):
    return {"seq": rec["seq"], "type": rec["type"],
            "payload": _copy.deepcopy(rec["payload"]),
            "prevSig": rec["prevSig"], "sig": rec["sig"]}


class EventChain(object):
    """The appendable chain. Use EventChain.create(key=..., genesis=...)."""

    def __init__(self, key, genesis=""):
        _key_bytes(key)  # validate fail-closed at construction
        self._key = key
        self._genesis = genesis if isinstance(genesis, str) else ""
        self._head_sig = self._genesis
        self._records = []
        self._next_seq = 1
        self._disposed = False

    @classmethod
    def create(cls, key, genesis=""):
        return cls(key, genesis)

    def append(self, type_, payload):
        """Append + sign a record. Returns a clone of the stored record, or None
        on rejection (disposed / bad type / non-canonicalizable payload). An
        invalid payload does NOT advance the sequence."""
        if self._disposed:
            return None
        if not isinstance(type_, str) or len(type_) == 0:
            return None
        seq = self._next_seq
        prev_sig = self._head_sig
        try:
            sig = hmac_sha256_hex(self._key, canonical_message(seq, type_, payload, prev_sig))
        except Exception:
            return None  # fail closed - do not store, do not advance next_seq
        # Store a deep copy so a caller mutating its input after append cannot
        # reach back into signed chain state.
        rec = {"seq": seq, "type": type_, "payload": _copy.deepcopy(payload),
               "prevSig": prev_sig, "sig": sig}
        self._records.append(rec)
        self._next_seq = seq + 1
        self._head_sig = sig
        return _clone_record(rec)

    def verify(self, expected_seal=None):
        return verify_records(self._key, self._records, self._genesis, expected_seal)

    def seal(self):
        """Sign the current (count, head) so a holder can later prove no records
        were dropped off the end. Persist this out of band."""
        count = len(self._records)
        head = self._head_sig
        return {"count": count, "head": head,
                "sig": hmac_sha256_hex(self._key, _seal_message(count, head))}

    def bind_bundle(self, world_id, state_hash, event_index, tail_genesis):
        """Codex audit P1 (persistence forge): sign a world bundle's identity -
        worldId + snapshot stateHash + eventIndex + tailGenesis + (count, head).
        Byte-identical to the TS EventChain.bindBundle."""
        count = len(self._records)
        head = self._head_sig
        return hmac_sha256_hex(
            self._key,
            _bundle_bind_message(world_id, state_hash, event_index, tail_genesis, count, head))

    def by_seq(self, seq):
        if isinstance(seq, bool) or not isinstance(seq, (int, float)) or seq <= 0:
            return None
        for rec in self._records:
            if rec["seq"] == seq:
                return _clone_record(rec)
        return None

    def by_type(self, type_):
        return [_clone_record(r) for r in self._records if r["type"] == type_]

    def list(self):
        return [_clone_record(r) for r in self._records]

    def head(self):
        """Current head signature - the value the NEXT append will fold in.
        Equals the genesis anchor when the chain is empty."""
        return self._head_sig

    def size(self):
        return len(self._records)

    def high_water_mark(self):
        return self._next_seq - 1

    def to_snapshot(self):
        """Snapshot for save / load / network sync (independently verifiable)."""
        return self.list()

    def from_snapshot(self, records):
        """Restore from a snapshot. Does NOT re-sign; call verify() afterward.
        Rejects malformed rows; TRANSACTIONAL (prior state intact on failure)."""
        if self._disposed or not isinstance(records, list):
            return
        next_records = []
        max_seq = 0
        last_sig = self._genesis
        try:
            for r in records:
                if not isinstance(r, dict):
                    continue
                seq = r.get("seq")
                if isinstance(seq, bool) or not isinstance(seq, (int, float)) or seq <= 0:
                    continue
                if not isinstance(r.get("type"), str) or len(r["type"]) == 0:
                    continue
                if not isinstance(r.get("sig"), str) or not isinstance(r.get("prevSig"), str):
                    continue
                next_records.append({"seq": seq, "type": r["type"],
                                     "payload": _copy.deepcopy(r.get("payload")),
                                     "prevSig": r["prevSig"], "sig": r["sig"]})
                if seq > max_seq:
                    max_seq = seq
                last_sig = r["sig"]
        except Exception:
            return  # fail closed - leave records / next_seq / head_sig untouched
        self._records = next_records
        self._next_seq = int(max_seq) + 1
        self._head_sig = last_sig

    def from_verified_snapshot(self, records, expected_seal=None):
        """Verify-before-mutate: loads the snapshot only when integrity holds.
        Returns the verify result; the instance is untouched when ok is False."""
        if self._disposed:
            return {"ok": False, "total": 0,
                    "mismatches": [{"seq": 0, "type": "(disposed)", "reason": "sig_mismatch"}]}
        rows = records if isinstance(records, list) else []
        res = verify_records(self._key, rows, self._genesis, expected_seal)
        if res["ok"]:
            self.from_snapshot(rows)
        return res

    def dispose(self):
        self._records = []
        self._head_sig = ""
        self._key = ""
        self._disposed = True
