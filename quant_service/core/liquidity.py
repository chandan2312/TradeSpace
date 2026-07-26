"""Liquidity intelligence. Parity target: lib/bias/liquidity.js.

Levels that hold resting stops (PDH/PDL, session H/L, equal highs/lows), each
classified by what price DID to it: untapped (magnet), swept (stop hunt →
reversal fuel), broken (genuine continuation). A momentum engine reads a sweep
as strength in that direction — exactly backwards; here a sweep scores against
its own direction.
"""

from __future__ import annotations

import numpy as np

from .bars import Bars
from .patterns import find_pivots

DAY = 86400
SESSIONS = [
    {"id": "asia", "label": "Asia", "from": 0, "to": 7},
    {"id": "london", "label": "London", "from": 7, "to": 13},
    {"id": "ny", "label": "New York", "from": 13, "to": 21},
]


def session_of(time_sec: int) -> dict:
    h = (time_sec % DAY) / 3600
    for s in SESSIONS:
        if s["from"] <= h < s["to"]:
            return s
    return {"id": "off", "label": "Off-hours"}


def _classify_level(bars: Bars, lv: dict, avg: float) -> dict:
    n = len(bars)
    eps = 0.05 * avg
    for i in range(lv["formedAt"] + 1, n):
        beyond = bars.high[i] > lv["price"] + eps if lv["side"] == 1 else bars.low[i] < lv["price"] - eps
        if not beyond:
            continue
        for j in range(i, min(i + 4, n)):
            back_in = bars.close[j] < lv["price"] if lv["side"] == 1 else bars.close[j] > lv["price"]
            if back_in:
                return {"state": "swept", "i": j}
        last_close = bars.close[n - 1]
        still_out = last_close > lv["price"] if lv["side"] == 1 else last_close < lv["price"]
        return {"state": "broken", "i": i} if still_out else {"state": "swept", "i": min(i + 3, n - 1)}
    return {"state": "untapped", "i": None}


def equal_clusters(bars: Bars, avg: float) -> list[dict]:
    """Equal highs/lows: 2+ pivots within tolerance — pools being engineered."""
    piv = find_pivots(bars, 3, 3)
    tol = 0.25 * avg
    out = []
    for pivots, side in ((piv["highs"][-25:], 1), (piv["lows"][-25:], -1)):
        grouped = set()
        for a in range(len(pivots) - 1):
            if a in grouped:
                continue
            grp = [pivots[a]]
            for b in range(a + 1, len(pivots)):
                if b not in grouped and abs(pivots[b]["price"] - pivots[a]["price"]) <= tol:
                    grp.append(pivots[b])
                    grouped.add(b)
            if len(grp) < 2:
                continue
            prices = [g["price"] for g in grp]
            out.append({
                "side": side,
                "price": max(prices) if side == 1 else min(prices),
                "touches": len(grp),
                "lastI": grp[-1]["i"],
            })
    return out


def liquidity_map(bars: Bars, avg: float) -> dict:
    n = len(bars)
    if n < 50:
        return {"levels": [], "sweeps": [], "builds": [], "draws": {"above": [], "below": []}}

    day_key = bars.time // DAY
    today_key = int(day_key[n - 1])
    today_idx = np.flatnonzero(day_key == today_key)
    prev_idx = np.flatnonzero(day_key < today_key)

    levels = []
    if len(prev_idx):
        prev_day_key = int(day_key[prev_idx[-1]])
        pd = prev_idx[day_key[prev_idx] == prev_day_key]
        formed = int(pd[-1])
        levels.append({"name": "PDH", "price": float(bars.high[pd].max()), "side": 1, "weightMul": 1.3, "formedAt": formed})
        levels.append({"name": "PDL", "price": float(bars.low[pd].min()), "side": -1, "weightMul": 1.3, "formedAt": formed})

    hours = (bars.time % DAY) / 3600
    for s in SESSIONS:
        idx = today_idx[(hours[today_idx] >= s["from"]) & (hours[today_idx] < s["to"])]
        if len(idx) < 3:
            continue
        formed = int(idx[-1])
        levels.append({"name": f"{s['label']} H", "price": float(bars.high[idx].max()), "side": 1, "weightMul": 1, "formedAt": formed})
        levels.append({"name": f"{s['label']} L", "price": float(bars.low[idx].min()), "side": -1, "weightMul": 1, "formedAt": formed})

    builds = equal_clusters(bars, avg)
    for b in builds:
        levels.append({
            "name": "EQH" if b["side"] == 1 else "EQL", "price": b["price"], "side": b["side"],
            "weightMul": 1.1, "formedAt": b["lastI"], "build": True,
        })

    px = bars.close[n - 1]
    sweeps = []
    draws = {"above": [], "below": []}
    for lv in levels:
        st = _classify_level(bars, lv, avg)
        lv["state"] = st["state"]
        if st["state"] == "swept":
            sweeps.append({**lv, "sweptAt": int(st["i"]), "age": n - 1 - int(st["i"])})
        elif st["state"] == "broken":
            lv["brokenAt"] = int(st["i"])
        elif st["state"] == "untapped":
            (draws["above"] if lv["price"] > px else draws["below"]).append(lv)
    draws["above"].sort(key=lambda x: x["price"])
    draws["below"].sort(key=lambda x: -x["price"])

    return {"levels": levels, "sweeps": sweeps, "builds": builds, "draws": draws}


def detect_qml(bars: Bars, avg: float, lookback: int = 90):
    """Quasimodo: swing extreme swept, then the intermediate swing breaks the
    other way — sweep + MSS in one shape."""
    n = len(bars)
    start = max(0, n - lookback)
    win = bars.slice(start, n)
    piv = find_pivots(win, 3, 3)
    eps = 0.05 * avg
    m = len(win)
    best = None

    for side in (1, -1):
        pivots = piv["highs"] if side == 1 else piv["lows"]
        for k in range(len(pivots) - 1, -1, -1):
            p = pivots[k]
            for i in range(p["i"] + 4, m):
                if side == 1:
                    swept = win.high[i] > p["price"] + eps and win.close[i] < p["price"]
                else:
                    swept = win.low[i] < p["price"] - eps and win.close[i] > p["price"]
                if not swept:
                    continue
                span = slice(p["i"] + 1, i)  # non-empty: i starts at p.i+4
                neck = float(win.low[span].min()) if side == 1 else float(win.high[span].max())
                for j in range(i + 1, min(i + 20, m)):
                    broke = win.close[j] < neck if side == 1 else win.close[j] > neck
                    if broke:
                        age = m - 1 - j
                        if best is None or age < best["age"]:
                            best = {"dir": -side, "age": age, "i": start + j}
                        break
                break  # only the first sweep of this pivot counts
            if best is not None and best["age"] <= 20:
                break
    return best
