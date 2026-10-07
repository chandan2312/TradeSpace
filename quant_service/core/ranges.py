"""Multi-Timeframe Structural Dealing Range Engine. Parity target: lib/bias/ranges.js.

Evaluates the active dealing ranges on M15, H1, H4, and D1:
  1. Governing Range High & Range Low
  2. Equilibrium (50% midpoint)
  3. Current position in range (% covered, Discount vs Premium)
  4. Range coverage status: Uncovered Run vs Range Exhaustion / Expansion
  5. Multi-timeframe range alignment and warning flags
"""

from __future__ import annotations

import numpy as np

from .bars import Bars
from .lenses import clamp
from .patterns import avg_range, find_pivots

TF_SETTINGS = {
    "M1": {"lookback": 60, "left": 3, "right": 3},
    "M5": {"lookback": 64, "left": 3, "right": 3},
    "M15": {"lookback": 64, "left": 3, "right": 3},
    "M30": {"lookback": 68, "left": 3, "right": 3},
    "H1": {"lookback": 72, "left": 3, "right": 3},
    "H4": {"lookback": 80, "left": 3, "right": 3},
    "D1": {"lookback": 60, "left": 2, "right": 2},
}


def compute_dealing_range(bars: Bars, tf: str = "H4", avg: float | None = None) -> dict | None:
    if bars is None or len(bars) < 15:
        return None

    conf = TF_SETTINGS.get(tf, {"lookback": 60, "left": 3, "right": 3})
    n = len(bars)
    lookback = min(n, conf["lookback"])
    start = n - lookback
    current_price = float(bars.close[-1])

    # Slice bars
    win = Bars(
        bars.time[start:],
        bars.open[start:],
        bars.high[start:],
        bars.low[start:],
        bars.close[start:],
        bars.v[start:],
    )

    piv = find_pivots(win, conf["left"], conf["right"])
    highs, lows = piv["highs"], piv["lows"]

    range_high = -float("inf")
    range_low = float("inf")
    high_pivot = low_pivot = None

    if len(highs) >= 1 and len(lows) >= 1:
        for h in highs:
            if h["price"] > range_high:
                range_high = float(h["price"])
                high_pivot = h
        for l in lows:
            if l["price"] < range_low:
                range_low = float(l["price"])
                low_pivot = l

    if high_pivot is None or low_pivot is None or range_high <= range_low:
        range_high = float(win.high.max())
        range_low = float(win.low.min())

    range_size = range_high - range_low
    if range_size <= 0:
        return None

    eq = (range_high + range_low) / 2.0
    raw_pos = (current_price - range_low) / range_size
    pos = clamp(raw_pos, 0.0, 1.0)
    coverage_pct = int(round(pos * 100))

    zone = "EQUILIBRIUM"
    if pos < 0.25:
        zone = "DEEP_DISCOUNT"
    elif pos < 0.45:
        zone = "DISCOUNT"
    elif pos > 0.75:
        zone = "DEEP_PREMIUM"
    elif pos > 0.55:
        zone = "PREMIUM"

    status = "MID_RANGE"
    is_exhausted = False
    exhausted_side = None

    if current_price > range_high:
        status = "EXPANDED_ABOVE"
    elif current_price < range_low:
        status = "EXPANDED_BELOW"
    elif pos >= 0.88:
        status = "EXHAUSTED_HIGH"
        is_exhausted = True
        exhausted_side = "high"
    elif pos <= 0.12:
        status = "EXHAUSTED_LOW"
        is_exhausted = True
        exhausted_side = "low"
    elif pos < 0.45:
        status = "UNCOVERED_UPSIDE"
    elif pos > 0.55:
        status = "UNCOVERED_DOWNSIDE"

    remaining_to_high = max(0.0, range_high - current_price)
    remaining_to_low = max(0.0, current_price - range_low)
    remaining_pct_to_high = max(0, 100 - coverage_pct)
    remaining_pct_to_low = max(0, coverage_pct)

    return {
        "tf": tf,
        "high": range_high,
        "low": range_low,
        "eq": eq,
        "size": range_size,
        "currentPrice": current_price,
        "pos": round(pos, 3),
        "coveragePct": coverage_pct,
        "zone": zone,
        "status": status,
        "isExhausted": is_exhausted,
        "exhaustedSide": exhausted_side,
        "remainingToHigh": remaining_to_high,
        "remainingToLow": remaining_to_low,
        "remainingPctToHigh": remaining_pct_to_high,
        "remainingPctToLow": remaining_pct_to_low,
        "barsInWindow": lookback,
    }


def analyze_all_dealing_ranges(frames: dict, structures: dict | None = None) -> dict:
    structures = structures or {}
    ranges = {}
    for tf in ("M1", "M5", "M15", "M30", "H1", "H4", "D1"):
        b = frames.get(tf) or (frames.get("30M") if tf == "M30" else None)
        if b is not None and len(b) >= 15:
            r = compute_dealing_range(b, tf)
            if r is not None:
                ranges[tf] = r

    h4 = ranges.get("H4")
    m15 = ranges.get("M15")
    warnings = []
    alignments = []

    if h4 and (h4["status"] == "EXHAUSTED_HIGH" or (h4["coveragePct"] >= 85 and m15 and m15.get("zone") == "PREMIUM")):
        warnings.append({
            "type": "HTF_PREMIUM_EXHAUSTION",
            "severity": "high",
            "note": f"H4 range {h4['coveragePct']}% covered (Deep Premium). Longs near range ceiling are high-risk.",
        })

    if h4 and (h4["status"] == "EXHAUSTED_LOW" or (h4["coveragePct"] <= 15 and m15 and m15.get("zone") == "DISCOUNT")):
        warnings.append({
            "type": "HTF_DISCOUNT_EXHAUSTION",
            "severity": "high",
            "note": f"H4 range {h4['coveragePct']}% covered (Deep Discount). Shorts near range floor are high-risk.",
        })

    h4_dir = (structures.get("H4") or {}).get("dir", 0)

    if h4 and m15:
        if h4_dir == 1:
            if h4["coveragePct"] < 50 and m15["coveragePct"] < 55:
                alignments.append({
                    "type": "BULLISH_UNCOVERED_EXPANSION",
                    "dir": 1,
                    "note": f"H4 in Discount ({h4['coveragePct']}%) with {m15['remainingPctToHigh']}% uncovered upside runway.",
                })
            elif 50 <= h4["coveragePct"] < 85 and m15["remainingPctToHigh"] >= 20:
                alignments.append({
                    "type": "BULLISH_UNCOVERED_EXPANSION",
                    "dir": 1,
                    "note": f"H4 delivering through Premium ({h4['coveragePct']}%) with {m15['remainingPctToHigh']}% to range ceiling.",
                })
        elif h4_dir == -1:
            if h4["coveragePct"] > 50 and m15["coveragePct"] > 45:
                alignments.append({
                    "type": "BEARISH_UNCOVERED_EXPANSION",
                    "dir": -1,
                    "note": f"H4 in Premium ({h4['coveragePct']}%) with {m15['remainingPctToLow']}% uncovered downside runway.",
                })
            elif 15 < h4["coveragePct"] <= 50 and m15["remainingPctToLow"] >= 20:
                alignments.append({
                    "type": "BEARISH_UNCOVERED_EXPANSION",
                    "dir": -1,
                    "note": f"H4 delivering through Discount ({h4['coveragePct']}%) with {m15['remainingPctToLow']}% to range floor.",
                })
        else:
            if h4["coveragePct"] < 50 and m15["coveragePct"] < 50:
                alignments.append({
                    "type": "BULLISH_UNCOVERED_EXPANSION",
                    "dir": 1,
                    "note": f"H4 in Discount ({h4['coveragePct']}%) and M15 has {m15['remainingPctToHigh']}% uncovered upside room.",
                })
            elif h4["coveragePct"] > 50 and m15["coveragePct"] > 50:
                alignments.append({
                    "type": "BEARISH_UNCOVERED_EXPANSION",
                    "dir": -1,
                    "note": f"H4 in Premium ({h4['coveragePct']}%) and M15 has {m15['remainingPctToLow']}% uncovered downside room.",
                })

    return {
        "ranges": ranges,
        "warnings": warnings,
        "alignments": alignments,
        "h4CoveragePct": h4["coveragePct"] if h4 else None,
        "m15CoveragePct": m15["coveragePct"] if m15 else None,
        "h4Zone": h4["zone"] if h4 else None,
        "m15Zone": m15["zone"] if m15 else None,
    }
