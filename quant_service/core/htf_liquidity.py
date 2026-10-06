"""HTF Liquidity Intelligence Engine (4H & D1 Only). Parity target: lib/bias/htfLiquidity.js.

Focuses strictly on macro liquidity:
  1. External Range Liquidity (ERL) vs Internal Range Liquidity (IRL)
  2. Active Delivery Cycle: IRL → ERL vs ERL → IRL
  3. HTF Liquidity Sweeps (PDH, PDL, PWH, PWL, 4H EQH, 4H EQL, 4H Swings)
  4. Macro Equal Highs / Lows (4H EQH / EQL magnets)
  5. Definitive Institutional Draw on Liquidity (DOL)
"""

from __future__ import annotations

import numpy as np

from .bars import Bars
from .patterns import avg_range, find_pivots


def analyze_htf_liquidity(frames: dict, structures: dict | None = None) -> dict:
    h4: Bars | None = frames.get("H4")
    d1: Bars | None = frames.get("D1")
    structures = structures or {}

    if h4 is None or len(h4) < 3:
        return {
            "activeCycle": "UNKNOWN",
            "drawOnLiquidity": None,
            "sweeps": [],
            "pools": {"bsl": [], "ssl": []},
            "eqh": [],
            "eql": [],
            "keyLevels": {},
        }

    n = len(h4)
    avg_h4 = avg_range(h4)
    current_price = float(h4.close[-1])

    pdh = pdl = pwh = pwl = None
    key_levels = {}

    if d1 is not None and len(d1) >= 2:
        prev_d1_h = float(d1.high[-2])
        prev_d1_l = float(d1.low[-2])
        pdh, pdl = prev_d1_h, prev_d1_l
        key_levels["PDH"] = {"price": pdh, "name": "PDH", "side": 1, "type": "ERL"}
        key_levels["PDL"] = {"price": pdl, "name": "PDL", "side": -1, "type": "ERL"}

        week = (d1.time // 86400 + 3) // 7
        cur_w = int(week[-1])
        prev_idx = np.flatnonzero(week == cur_w - 1)
        if len(prev_idx) > 0:
            pwh = float(d1.high[prev_idx].max())
            pwl = float(d1.low[prev_idx].min())
            key_levels["PWH"] = {"price": pwh, "name": "PWH", "side": 1, "type": "ERL"}
            key_levels["PWL"] = {"price": pwl, "name": "PWL", "side": -1, "type": "ERL"}

    piv = find_pivots(h4, 3, 3)
    highs, lows = piv["highs"], piv["lows"]
    tol = 0.25 * avg_h4

    eqh = []
    eql = []
    for i in range(len(highs) - 1):
        for j in range(i + 1, len(highs)):
            if abs(highs[i]["price"] - highs[j]["price"]) <= tol and highs[j]["i"] - highs[i]["i"] >= 4:
                eqh.append({
                    "name": "4H EQH",
                    "price": max(highs[i]["price"], highs[j]["price"]),
                    "side": 1,
                    "i1": highs[i]["i"],
                    "i2": highs[j]["i"],
                    "age": n - 1 - highs[j]["i"],
                })

    for i in range(len(lows) - 1):
        for j in range(i + 1, len(lows)):
            if abs(lows[i]["price"] - lows[j]["price"]) <= tol and lows[j]["i"] - lows[i]["i"] >= 4:
                eql.append({
                    "name": "4H EQL",
                    "price": min(lows[i]["price"], lows[j]["price"]),
                    "side": -1,
                    "i1": lows[i]["i"],
                    "i2": lows[j]["i"],
                    "age": n - 1 - lows[j]["i"],
                })

    sweep_cands = []
    if pdh is not None:
        sweep_cands.append({"name": "PDH", "price": pdh, "side": 1})
    if pdl is not None:
        sweep_cands.append({"name": "PDL", "price": pdl, "side": -1})
    if pwh is not None:
        sweep_cands.append({"name": "PWH", "price": pwh, "side": 1})
    if pwl is not None:
        sweep_cands.append({"name": "PWL", "price": pwl, "side": -1})

    for e in eqh[-3:]:
        sweep_cands.append({"name": "4H EQH", "price": e["price"], "side": 1})
    for e in eql[-3:]:
        sweep_cands.append({"name": "4H EQL", "price": e["price"], "side": -1})

    if len(highs) >= 2:
        sweep_cands.append({"name": "4H Swing High", "price": highs[-2]["price"], "side": 1})
    if len(lows) >= 2:
        sweep_cands.append({"name": "4H Swing Low", "price": lows[-2]["price"], "side": -1})

    sweeps = []
    lookback_bars = min(n, 24)
    for cand in sweep_cands:
        for i in range(n - lookback_bars, n):
            h_val = float(h4.high[i])
            l_val = float(h4.low[i])
            c_val = float(h4.close[i])

            if cand["side"] == 1:
                if h_val > cand["price"] and c_val < cand["price"]:
                    sweeps.append({
                        "name": cand["name"],
                        "levelPrice": cand["price"],
                        "sweptPrice": h_val,
                        "side": 1,
                        "age": n - 1 - i,
                        "time": int(h4.time[i]),
                        "reversalDir": -1,
                    })
            else:
                if l_val < cand["price"] and c_val > cand["price"]:
                    sweeps.append({
                        "name": cand["name"],
                        "levelPrice": cand["price"],
                        "sweptPrice": l_val,
                        "side": -1,
                        "age": n - 1 - i,
                        "time": int(h4.time[i]),
                        "reversalDir": 1,
                    })

    unique_sweeps = []
    seen = set()
    sweeps.sort(key=lambda s: s["age"])
    for s in sweeps:
        if s["name"] not in seen:
            seen.add(s["name"])
            unique_sweeps.append(s)

    bsl = []
    ssl = []

    def add_pool(name, price, side, p_type):
        if side == 1 and price > current_price:
            bsl.append({"name": name, "price": price, "distance": price - current_price, "type": p_type})
        elif side == -1 and price < current_price:
            ssl.append({"name": name, "price": price, "distance": current_price - price, "type": p_type})

    if pdh is not None:
        add_pool("PDH", pdh, 1, "ERL")
    if pdl is not None:
        add_pool("PDL", pdl, -1, "ERL")
    if pwh is not None:
        add_pool("PWH", pwh, 1, "ERL")
    if pwl is not None:
        add_pool("PWL", pwl, -1, "ERL")

    for e in eqh:
        add_pool("4H EQH", e["price"], 1, "MAGNET_BSL")
    for e in eql:
        add_pool("4H EQL", e["price"], -1, "MAGNET_SSL")

    for h in highs[-4:]:
        if h["price"] > current_price and not any(abs(p["price"] - h["price"]) < tol for p in bsl):
            add_pool("4H Swing High", h["price"], 1, "ERL")
    for l in lows[-4:]:
        if l["price"] < current_price and not any(abs(p["price"] - l["price"]) < tol for p in ssl):
            add_pool("4H Swing Low", l["price"], -1, "ERL")

    bsl.sort(key=lambda x: x["distance"])
    ssl.sort(key=lambda x: x["distance"])

    fresh_sweep = next((s for s in unique_sweeps if s["age"] <= 6), None)
    active_cycle = "IRL_TO_ERL"
    cycle_note = "Expanding towards External Range Liquidity targets"

    if fresh_sweep:
        active_cycle = "ERL_TO_IRL"
        cycle_note = f"Fresh {fresh_sweep['name']} sweep {fresh_sweep['age'] * 4}h ago; rotating into internal liquidity"

    macro_dir = (
        structures.get("D1", {}).get("dir")
        or structures.get("H4", {}).get("dir")
        or (fresh_sweep["reversalDir"] if fresh_sweep else 0)
    ) if structures else (fresh_sweep["reversalDir"] if fresh_sweep else 0)

    if macro_dir == 0 and len(highs) >= 2 and len(lows) >= 2:
        if highs[-1]["price"] > highs[-2]["price"] and lows[-1]["price"] > lows[-2]["price"]:
            macro_dir = 1
        elif highs[-1]["price"] < highs[-2]["price"] and lows[-1]["price"] < lows[-2]["price"]:
            macro_dir = -1

    draw_on_liquidity = None
    if active_cycle == "ERL_TO_IRL" and fresh_sweep:
        if fresh_sweep["side"] == 1 and ssl:
            draw_on_liquidity = dict(ssl[0], targetSide="SSL", direction=-1, causal=True, confirmationTime=fresh_sweep["time"], catalyst=f"Rotation following {fresh_sweep['name']} sweep")
        elif fresh_sweep["side"] == -1 and bsl:
            draw_on_liquidity = dict(bsl[0], targetSide="BSL", direction=1, causal=True, confirmationTime=fresh_sweep["time"], catalyst=f"Rotation following {fresh_sweep['name']} sweep")
    else:
        if macro_dir == 1 and bsl:
            draw_on_liquidity = dict(bsl[0], targetSide="BSL", direction=1, causal=True, confirmationTime=bsl[0].get("time") or int(h4.time[-1]), catalyst="Macro Bullish Expansion toward BSL")
        elif macro_dir == -1 and ssl:
            draw_on_liquidity = dict(ssl[0], targetSide="SSL", direction=-1, causal=True, confirmationTime=ssl[0].get("time") or int(h4.time[-1]), catalyst="Macro Bearish Expansion toward SSL")
        elif bsl and (not ssl or bsl[0]["distance"] < ssl[0]["distance"]):
            draw_on_liquidity = dict(bsl[0], targetSide="BSL", direction=1, causal=True, confirmationTime=bsl[0].get("time") or int(h4.time[-1]), catalyst="Clean Buy-Side Liquidity draw above")
        elif ssl:
            draw_on_liquidity = dict(ssl[0], targetSide="SSL", direction=-1, causal=True, confirmationTime=ssl[0].get("time") or int(h4.time[-1]), catalyst="Clean Sell-Side Liquidity draw below")

    return {
        "activeCycle": active_cycle,
        "cycleNote": cycle_note,
        "drawOnLiquidity": draw_on_liquidity,
        "sweeps": unique_sweeps,
        "pools": {"bsl": bsl, "ssl": ssl},
        "eqh": eqh,
        "eql": eql,
        "keyLevels": key_levels,
        "currentPrice": current_price,
    }
