"""Market structure per timeframe. Parity target: lib/bias/structure.js.

Swing sequence (HH/HL vs LH/LL) plus the event stream of structure breaks —
BOS (continuation) vs MSS/CHoCH (shift). An MSS only counts if it happened
WITH displacement; a limp poke through a swing is noise.
"""

from __future__ import annotations

from .bars import Bars
from .patterns import find_pivots

EMPTY = {"dir": 0, "seq": "n/a", "strength": 0, "lastEvent": None, "events": [], "ranging": True}


def is_displaced(bars: Bars, i: int, direction: int, avg: float) -> bool:
    """The break candle (or its predecessor) has real body in the break direction."""
    for k in (i, i - 1):
        if k < 0:
            continue
        body = bars.close[k] - bars.open[k] if direction == 1 else bars.open[k] - bars.close[k]
        if body >= 1.1 * avg:
            return True
    return False


def analyze_structure(bars: Bars, avg: float, left: int = 3, right: int = 3) -> dict:
    n = len(bars)
    if n < left + right + 10:
        return dict(EMPTY, events=[])

    piv = find_pivots(bars, left, right)
    highs, lows = piv["highs"], piv["lows"]
    if len(highs) < 2 or len(lows) < 2:
        return dict(EMPTY, events=[])

    direction = 0
    last_h = last_l = None
    h_idx = l_idx = 0
    events = []

    for i in range(n):
        while h_idx < len(highs) and highs[h_idx]["i"] + right <= i:
            last_h = highs[h_idx]
            h_idx += 1
        while l_idx < len(lows) and lows[l_idx]["i"] + right <= i:
            last_l = lows[l_idx]
            l_idx += 1
        c = bars.close[i]

        if last_h is not None and c > last_h["price"]:
            events.append({
                "type": "MSS" if direction < 0 else "BOS", "dir": 1, "i": i,
                "level": float(last_h["price"]), "displaced": is_displaced(bars, i, 1, avg),
            })
            direction, last_h = 1, None
        elif last_l is not None and c < last_l["price"]:
            events.append({
                "type": "MSS" if direction > 0 else "BOS", "dir": -1, "i": i,
                "level": float(last_l["price"]), "displaced": is_displaced(bars, i, -1, avg),
            })
            direction, last_l = -1, None

    h1, h2 = highs[-2:]
    l1, l2 = lows[-2:]
    hh = h2["price"] > h1["price"]
    hl = l2["price"] > l1["price"]
    seq_dir, seq = 0, "mixed"
    if hh and hl:
        seq_dir, seq = 1, "HH+HL"
    elif not hh and not hl:
        seq_dir, seq = -1, "LH+LL"

    last = events[-1] if events else None
    if last is not None:
        last["age"] = n - 1 - last["i"]

    recent = events[-4:]
    agree = (
        sum(1 for e in recent if e["dir"] == (seq_dir or direction)) / len(recent) if recent else 0
    )
    flips = sum(1 for i, e in enumerate(recent) if i > 0 and e["dir"] != recent[i - 1]["dir"])

    return {
        "dir": seq_dir or direction,
        "seq": seq,
        "strength": max(agree, 0.5 if seq_dir != 0 else 0.25),
        "lastEvent": last,
        "events": events,
        "ranging": seq == "mixed" and flips >= 2,
    }
