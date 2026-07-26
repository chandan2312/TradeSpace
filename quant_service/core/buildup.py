"""Liquidity buildup / compression. Parity target: lib/bias/buildup.js.

Trendlines aren't straight lines — they're zones of grinding price action that
engineer liquidity before a sweep. Groups of cascading pivots are tracked with
internal counter-moves allowed, until an anchor break, a big jump, a temporal
gap, or a price gap splits the group.
"""

from __future__ import annotations

from .bars import Bars
from .patterns import detect_gaps, find_pivots


def _group(pivots, avg, eps, gaps, side):
    """Cascade grouping. side=1 → descending highs, side=-1 → ascending lows."""
    groups, cur = [], []
    for p in pivots:
        if not cur:
            cur = [p]
            continue
        anchor, prev = cur[0], cur[-1]
        gap_found = any(g["i"] > prev["i"] and g["i"] <= p["i"] for g in gaps)

        broke_anchor = p["price"] > anchor["price"] + eps if side == 1 else p["price"] < anchor["price"] - eps
        jumped = (
            (p["price"] > prev["price"] and p["price"] - prev["price"] > 3 * avg)
            if side == 1
            else (p["price"] < prev["price"] and prev["price"] - p["price"] > 3 * avg)
        )
        if broke_anchor or jumped or p["i"] - prev["i"] > 40 or gap_found:
            if len(cur) >= 3:
                groups.append(cur)
            cur = [p]
        else:
            cur.append(p)
    if len(cur) >= 3:
        groups.append(cur)
    return groups


def detect_trendline_liquidity(bars: Bars, avg: float, lookback: int = 120) -> dict:
    n = len(bars)
    if n < 20:
        return {"draws": []}

    start = max(0, n - lookback)
    win = bars.slice(start, n)
    n_win = len(win)
    piv = find_pivots(win, 3, 3)
    px = bars.close[n - 1]
    eps = 0.5 * avg
    gaps = detect_gaps(win, avg, 3.0)

    draws, sweeps = [], []
    for side, pivots, label in ((1, piv["highs"], "Descending BSL"), (-1, piv["lows"], "Ascending SSL")):
        for grp in _group(pivots, avg, eps, gaps, side):
            a, z = grp[0], grp[-1]
            cascades = z["price"] < a["price"] + eps if side == 1 else z["price"] > a["price"] - eps
            if not cascades:
                continue
            note = "Massive multi-phase compression" if len(grp) >= 5 else "Curvy trendline liquidity"

            state, swept_at = "untapped", None
            for j in range(z["i"] + 1, n_win):
                pierced = win.high[j] > a["price"] + eps / 2 if side == 1 else win.low[j] < a["price"] - eps / 2
                if not pierced:
                    continue
                closed_back = any(
                    (win.close[k] < a["price"]) if side == 1 else (win.close[k] > a["price"])
                    for k in range(j, min(j + 4, n_win))
                )
                if closed_back:
                    state, swept_at = "swept", start + j
                else:
                    state = "broken"
                break

            beyond_price = a["price"] > px if side == 1 else a["price"] < px
            if state == "untapped" and beyond_price:
                draws.append({"type": label, "side": side, "touches": len(grp), "start": a, "end": z, "note": note})
            elif state == "swept":
                sweeps.append({
                    "type": f"{label} Swept", "side": side, "touches": len(grp),
                    "start": a, "end": z, "note": note, "age": n - 1 - swept_at,
                })

    return {"draws": draws, "sweeps": sweeps}
