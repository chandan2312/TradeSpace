"""Reversal anatomy. Parity target: lib/bias/reversals.js.

Candle behaviour that marks strong highs/lows: sweep-rejection wicks, V-shape
reversals, grind→displacement. On HTF these create PROTECTED lows/highs which
strong_levels() keeps on the books until price closes through them.
"""

from __future__ import annotations

import numpy as np

from .bars import Bars
from .patterns import find_pivots


def sweep_wick_candle(bars: Bars, avg: float, lookback: int = 24):
    n = len(bars)
    piv = find_pivots(bars, 3, 3)
    eps = 0.05 * avg

    for i in range(n - 1, max(1, n - lookback) - 1, -1):
        o, h, l, c = bars.open[i], bars.high[i], bars.low[i], bars.close[i]
        rng = h - l
        if rng < 1.3 * avg:
            continue
        if abs(c - o) < 0.22 * rng:
            continue
        lower_wick = min(o, c) - l
        upper_wick = h - max(o, c)

        if lower_wick >= 0.55 * rng and c >= h - 0.35 * rng:
            swept = any(p["i"] < i - 2 and i - p["i"] <= 40 and l < p["price"] - eps and c > p["price"] for p in piv["lows"])
            return {"kind": "sweep-rejection", "dir": 1, "i": i, "age": n - 1 - i,
                    "extreme": float(l), "grade": "A" if swept else "B", "swept": swept}
        if upper_wick >= 0.55 * rng and c <= l + 0.35 * rng:
            swept = any(p["i"] < i - 2 and i - p["i"] <= 40 and h > p["price"] + eps and c < p["price"] for p in piv["highs"])
            return {"kind": "sweep-rejection", "dir": -1, "i": i, "age": n - 1 - i,
                    "extreme": float(h), "grade": "A" if swept else "B", "swept": swept}
    return None


def v_reversal(bars: Bars, avg: float, window: int = 10):
    n = len(bars)
    piv = find_pivots(bars, 4, 4)

    def scan(pivots, direction):
        for k in range(len(pivots) - 1, max(0, len(pivots) - 3) - 1, -1):
            p = pivots[k]
            pre_s, pre_e = max(0, p["i"] - window), p["i"]
            post_s, post_e = p["i"] + 1, min(n, p["i"] + 1 + window)
            if pre_e - pre_s < 3 or post_e - post_s < 3:
                continue
            leg = (
                float(bars.high[pre_s:pre_e].max()) - p["price"]
                if direction == 1
                else p["price"] - float(bars.low[pre_s:pre_e].min())
            )
            if leg < 2.2 * avg:
                continue
            back = (
                bars.close[post_s:post_e] - p["price"]
                if direction == 1
                else p["price"] - bars.close[post_s:post_e]
            )
            hit = np.flatnonzero(back >= 0.7 * leg)
            if not len(hit):
                continue
            recovered_at = post_s + int(hit[0])
            return {"kind": "V-reversal", "dir": direction, "i": p["i"], "age": n - 1 - recovered_at,
                    "extreme": float(p["price"]), "grade": "A" if leg >= 3.5 * avg else "B"}
        return None

    bull, bear = scan(piv["lows"], 1), scan(piv["highs"], -1)
    if bull and bear:
        return bull if bull["age"] <= bear["age"] else bear
    return bull or bear


def grind_then_displacement(bars: Bars, avg: float):
    n = len(bars)
    for i in range(n - 1, max(12, n - 8) - 1, -1):
        d_body = abs(bars.close[i] - bars.open[i])
        if d_body < 1.5 * avg:
            continue
        direction = int(np.sign(bars.close[i] - bars.open[i]))

        g0, g1 = i - 10, i
        bodies = np.abs(bars.close[g0:g1] - bars.open[g0:g1])
        mean_body = float(bodies.mean())
        drift = bars.close[g1 - 1] - bars.open[g0]

        slow = mean_body < 0.55 * avg and float(bodies.max()) < 0.9 * avg
        counter = np.sign(drift) == -direction and abs(drift) >= avg
        if slow and counter and d_body / (mean_body or avg) >= 2.5:
            return {"kind": "grind→displacement", "dir": direction, "i": i, "age": n - 1 - i,
                    "ratio": round(float(d_body / (mean_body or avg)) * 10) / 10}
    return None


def strong_levels(bars: Bars, avg: float, lookback: int = 60) -> list[dict]:
    """Every unviolated reversal extreme in the window stays as standing evidence."""
    n = len(bars)
    out, seen = [], set()

    def consider(sig):
        if not sig or sig["i"] in seen:
            return
        seen.add(sig["i"])
        after = slice(sig["i"] + 1, n)
        violated = (
            bool((bars.close[after] < sig["extreme"]).any())
            if sig["dir"] == 1
            else bool((bars.close[after] > sig["extreme"]).any())
        )
        if violated:
            return
        out.append({"side": "low" if sig["dir"] == 1 else "high", "price": sig["extreme"],
                    "i": sig["i"], "age": n - 1 - sig["i"], "kind": sig["kind"], "grade": sig["grade"]})

    # slice the window so we collect ALL qualifying candles, not just the freshest
    for end in range(n, max(20, n - lookback), -6):
        sl = bars.slice(0, end)
        consider(sweep_wick_candle(sl, avg, 6))
        consider(v_reversal(sl, avg))
    return out
