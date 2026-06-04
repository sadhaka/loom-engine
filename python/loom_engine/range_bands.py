"""loom_engine.range_bands - grid-free relative positioning.

PARITY CONTRACT: this is a hand-port of the TypeScript runtime/range-bands.ts.
The band math + ordering MUST match the TS module byte-for-byte (same
thresholds, same insertion-ordered iteration via Python's ordered dict), so a
Python-server result is identical to a TS-client result for the same inputs.
The shared golden vectors in ../test_vectors/ are the cross-language gate.

Pure + deterministic: no RNG, no floats stored (distance is advisory).
"""

from __future__ import annotations

from typing import Dict, List, Optional

RANGE_BAND_ENGAGED = "engaged"
RANGE_BAND_NEAR = "near"
RANGE_BAND_FAR = "far"

ENGAGED_MAX_FT = 5
NEAR_MAX_FT = 30

_BAND_ORDER: Dict[str, int] = {"engaged": 0, "near": 1, "far": 2}


def band_from_distance_ft(feet) -> str:
    """Map a distance in feet to a band, classifying on the RAW float (5.49 ft is
    Near, not Engaged). Negative / NaN / unparseable -> the neutral Near."""
    try:
        d = float(feet)
    except (TypeError, ValueError):
        return RANGE_BAND_NEAR
    if d != d:  # NaN
        return RANGE_BAND_NEAR
    if d < 0:
        return RANGE_BAND_NEAR
    if d <= ENGAGED_MAX_FT:
        return RANGE_BAND_ENGAGED
    if d <= NEAR_MAX_FT:
        return RANGE_BAND_NEAR
    return RANGE_BAND_FAR


def normalize_band(band) -> Optional[str]:
    return band if band in _BAND_ORDER else None


def band_within(band: str, max_band: str) -> bool:
    """True iff `band` is at least as close as `max_band` (engaged < near < far)."""
    a = _BAND_ORDER.get(band)
    b = _BAND_ORDER.get(max_band)
    if a is None or b is None:
        return False
    return a <= b


def compare_bands(a: str, b: str) -> int:
    ai = _BAND_ORDER.get(a, 99)
    bi = _BAND_ORDER.get(b, 99)
    return ai - bi


def _pair_key(source: str, target: str) -> str:
    return source + " " + target


class RangeBandField:
    """Directed (source -> target) band store for one encounter. set_pair writes
    both directions symmetrically by default. Backed by an insertion-ordered
    dict (Python 3.7+), matching the TS Map iteration order."""

    def __init__(self) -> None:
        self.bands: Dict[str, str] = {}

    def set_pair(self, a: str, b: str, band: Optional[str] = None,
                 distance_feet=None, symmetric: bool = True) -> str:
        explicit = normalize_band(band) if band is not None else None
        if explicit is not None:
            resolved = explicit
        elif distance_feet is not None:
            resolved = band_from_distance_ft(distance_feet)
        else:
            resolved = RANGE_BAND_NEAR
        if not a or not b or a == b:
            return resolved
        self.bands[_pair_key(a, b)] = resolved
        if symmetric:
            self.bands[_pair_key(b, a)] = resolved
        return resolved

    def get_band(self, source: str, target: str) -> Optional[str]:
        return self.bands.get(_pair_key(source, target))

    def is_engaged(self, a: str, b: str) -> bool:
        return self.get_band(a, b) == RANGE_BAND_ENGAGED

    def targets_within(self, source: str, max_band: str) -> List[str]:
        out: List[str] = []
        prefix = source + " "
        for key, band in self.bands.items():
            if key.startswith(prefix) and band_within(band, max_band):
                out.append(key[len(prefix):])
        return out

    def engaged_with(self, source: str) -> List[str]:
        return self.targets_within(source, RANGE_BAND_ENGAGED)

    def clear(self) -> None:
        self.bands.clear()

    def snapshot(self) -> List[dict]:
        out: List[dict] = []
        for key, band in self.bands.items():
            i = key.index(" ")
            out.append({"source": key[:i], "target": key[i + 1:], "band": band})
        return out


RESOURCE_RANGE_BANDS = "rangeBands"
