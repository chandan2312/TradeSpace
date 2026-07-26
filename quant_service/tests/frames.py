"""Loads the same archive slices the JS fixture exporter used.

Mirrors scripts/fixture_common.mjs exactly. If this drifts, every parity test
becomes a lie, so the two files must be read side by side when either changes.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache

from ..core.bars import Bars

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ARCHIVE_DIR = os.path.join(ROOT, "data", "dukascopy")
FIXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")

SPEC_COUNTS = {"M15": 320, "H1": 240, "H4": 200, "D1": 80}
FIXTURE_SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "AUDNZD", "GBPJPY"]
CUT_OFFSETS = [0, 1500, 7000, 20000]


@lru_cache(maxsize=32)
def load_archive(symbol: str):
    p = os.path.join(ARCHIVE_DIR, f"{symbol}.json")
    if not os.path.exists(p):
        return None
    with open(p) as f:
        raw = json.load(f)
    # archive also carries symbol/start/end/counts metadata keys
    return {tf: Bars.from_records(raw[tf]) for tf in ("M15", "H1", "H4") if tf in raw}


def target_time_for(cut: int):
    ref = load_archive("EURUSD")
    if ref is None:
        return None
    idx = len(ref["M15"]) - 1 - cut
    return int(ref["M15"].time[idx]) if idx >= 0 else None


def _derive_d1(h4: Bars) -> Bars:
    """D1 isn't in the archive; roll it up from H4 (same rule as the JS side)."""
    day = h4.time // 86400
    starts = [0] + [i for i in range(1, len(h4)) if day[i] != day[i - 1]]
    ends = starts[1:] + [len(h4)]
    return Bars(
        [h4.time[e - 1] for s, e in zip(starts, ends)],
        [h4.open[s] for s in starts],
        [h4.high[s:e].max() for s, e in zip(starts, ends)],
        [h4.low[s:e].min() for s, e in zip(starts, ends)],
        [h4.close[e - 1] for s, e in zip(starts, ends)],
        [h4.v[s:e].sum() for s, e in zip(starts, ends)],
    )


def load_frames(symbol: str, cut: int):
    data = load_archive(symbol)
    t = target_time_for(cut)
    if data is None or t is None:
        return None
    m15 = data["M15"].upto(t, SPEC_COUNTS["M15"])
    h1 = data["H1"].upto(t, SPEC_COUNTS["H1"])
    h4 = data["H4"].upto(t, SPEC_COUNTS["H4"])
    if len(m15) < 50 or len(h1) < 50 or len(h4) < 50:
        return None
    d1 = _derive_d1(data["H4"].upto(t, SPEC_COUNTS["H4"] * 6)).tail(SPEC_COUNTS["D1"])
    return {"M15": m15, "H1": h1, "H4": h4, "D1": d1}


@lru_cache(maxsize=8)
def fixture(name: str):
    with open(os.path.join(FIXTURE_DIR, f"{name}.json")) as f:
        return json.load(f)
