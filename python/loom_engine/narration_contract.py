"""loom_engine.narration_contract - engine-owns-outcomes (no-invented-number).

Byte-parity hand-port of the TypeScript runtime/narration-contract.ts. Given the
canonical numbers the engine produced this turn, find any mechanics-significant
number in the prose the engine did NOT produce - catching numerals AND
number-words. The differentiator vs pure-LLM story apps: the AI may describe the
engine's outcomes, never invent them. Pure + deterministic.
"""

from __future__ import annotations

import re
from typing import Iterable, List, Optional

_ONES = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19,
}
_TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "seventy": 70, "eighty": 80, "ninety": 90,
}

_NUMERAL_RE = re.compile(r"\d[\d,]*")
_WORD_SPLIT_RE = re.compile(r"[^a-z]+")


def parse_number_word(token) -> Optional[int]:
    """Parse a single number-word ('seven', 'twenty', 'twenty-one', 'twenty one')
    to its value, or None."""
    t = str(token or "").strip().lower()
    if not t:
        return None
    if t in _ONES:
        return _ONES[t]
    if t in _TENS:
        return _TENS[t]
    parts = re.split(r"[\s-]+", t)
    if len(parts) == 2 and parts[0] in _TENS and parts[1] in _ONES:
        ones = _ONES[parts[1]]
        if 1 <= ones <= 9:
            return _TENS[parts[0]] + ones
    return None


def extract_candidate_numbers(text) -> List[int]:
    """Every candidate mechanics number in `text` - numerals (incl. 1,024) and
    number-words (incl. 'twenty-one'), order-preserving with duplicates."""
    out: List[int] = []
    if not text or not isinstance(text, str):
        return out
    for m in _NUMERAL_RE.finditer(text):
        raw = m.group(0).replace(",", "")
        try:
            out.append(int(raw))
        except ValueError:
            pass
    words = _WORD_SPLIT_RE.split(text.lower())
    i = 0
    while i < len(words):
        w = words[i]
        if not w:
            i += 1
            continue
        if w in _TENS:
            nxt = words[i + 1] if i + 1 < len(words) else ""
            if nxt in _ONES and 1 <= _ONES[nxt] <= 9:
                out.append(_TENS[w] + _ONES[nxt])
                i += 2
                continue
            out.append(_TENS[w])
        elif w in _ONES:
            out.append(_ONES[w])
        i += 1
    return out


def find_invented_number(text, attested: Iterable[int],
                         ignore_at_or_below: int = 2) -> Optional[int]:
    """First mechanics number in `text` NOT in the engine's attested set, or None.
    Numbers <= ignore_at_or_below are treated as ambiguous flavor (default 2)."""
    allowed = set()
    if attested:
        for a in attested:
            if isinstance(a, (int, float)) and a == a:
                allowed.add(int(a) if isinstance(a, int) else a)
                allowed.add(a)
    for c in extract_candidate_numbers(text):
        if c <= ignore_at_or_below:
            continue
        if c not in allowed:
            return c
    return None


def is_narration_grounded(text, attested: Iterable[int],
                          ignore_at_or_below: int = 2) -> bool:
    return find_invented_number(text, attested, ignore_at_or_below) is None


RESOURCE_NARRATION_CONTRACT = "narrationContract"
