"""Causal closed-bar institutional evidence; parity: lib/bias/institutional.js."""
from __future__ import annotations

from .bars import Bars


def _records(bars):
    return bars.to_records() if isinstance(bars, Bars) else (bars or [])


def confirmed_fractals(bars, width=5):
    if width not in (3, 5):
        raise ValueError("Fractal width must be 3 or 5")
    b = _records(bars)
    r = (width - 1) // 2
    out = {"highs": [], "lows": []}
    for i in range(r, len(b) - r):
        for key, field, side in (("highs", "high", 1), ("lows", "low", -1)):
            price = b[i][field]
            if all(j == i or (price > b[j][field] if side == 1 else price < b[j][field]) for j in range(i-r, i+r+1)):
                out[key].append({"id": f"F{width}:{side}:{b[i]['time']}", "side": side, "i": i,
                                    "price": price, "time": b[i]["time"], "confirmedAt": i+r,
                                    "confirmationTime": b[i+r]["time"]})
    return out


def _volume(b):
    for key in ("v", "tick_volume", "tickVolume", "volume"):
        if b.get(key) is not None:
            return float(b[key] or 0)
    return 0


def displacement_at(bars, i, direction):
    b = _records(bars)
    empty = {"valid": False, "bodyRatio": 0, "atrRatio": 0, "volumeRatio": None,
             "atr10": None, "volumeConfirmed": False, "volumeEvidence": "UNAVAILABLE"}
    if i < 10 or i >= len(b) or direction not in (1, -1):
        return empty
    tr = volume = volumes = 0
    for j in range(i-10, i):
        p = b[j-1]["close"] if j else b[j]["open"]
        tr += max(b[j]["high"] - b[j]["low"], abs(b[j]["high"]-p), abs(b[j]["low"]-p))
        v = _volume(b[j])
        if v > 0:
            volume += v
            volumes += 1
    atr = tr / 10
    span = b[i]["high"] - b[i]["low"]
    body = direction * (b[i]["close"] - b[i]["open"])
    body_ratio = body / span if span > 0 else 0
    atr_ratio = span / atr if atr > 0 else 0
    v = _volume(b[i])
    vr = v / (volume / volumes) if volumes == 10 and v > 0 else None
    return {"valid": body_ratio > .60 and atr_ratio >= 1.2, "bodyRatio": body_ratio,
            "atrRatio": atr_ratio, "volumeRatio": vr, "atr10": atr,
            "volumeConfirmed": vr is not None and vr >= 1,
            "volumeEvidence": "UNAVAILABLE" if vr is None else "STRONG" if vr >= 1.5 else "CONFIRMED" if vr >= 1 else "THIN"}


def _lifecycle(bars, zone):
    z = dict(zone, state="VIRGIN", mitigatedAt=None, mitigationTime=None,
             fullyMitigatedAt=None, fullMitigationTime=None, invertedAt=None, inversionTime=None,
             invalidatedAt=None, invalidationTime=None, respectedAt=None, respectTime=None,
             tested=False, deepestPenetration=None, respectQuality="A_PRIME_CE_DEFENDED")
    for j in range(z["born"]+1, len(bars)):
        b = bars[j]
        if z["state"] == "INVERTED":
            if b["close"] < z["bottom"] if z["dir"] == 1 else b["close"] > z["top"]:
                z.update(state="INVALIDATED", invalidatedAt=j, invalidationTime=b["time"])
                break
            continue
        bull = z["originalDir"] == 1
        if b["close"] < z["bottom"] if bull else b["close"] > z["top"]:
            if z["kind"] == "FVG":
                z.update(state="INVERTED", dir=-z["originalDir"], invertedAt=j, inversionTime=b["time"])
            else:
                z.update(state="INVALIDATED", invalidatedAt=j, invalidationTime=b["time"])
                break
            continue
        if b["low"] <= z["top"] and b["high"] >= z["bottom"]:
            z["tested"] = True
            if z["mitigatedAt"] is None:
                z.update(mitigatedAt=j, mitigationTime=b["time"])
            extreme = b["low"] if bull else b["high"]
            old = z["deepestPenetration"]
            z["deepestPenetration"] = extreme if old is None else min(old, extreme) if bull else max(old, extreme)
            if min(b["open"], b["close"]) < z["ce"] if bull else max(b["open"], b["close"]) > z["ce"]:
                z["respectQuality"] = "B_BOTTOM_DEFENDED" if bull else "B_TOP_DEFENDED"
            if b["low"] <= z["bottom"] if bull else b["high"] >= z["top"]:
                z["state"] = "FULLY_MITIGATED"
                if z["fullyMitigatedAt"] is None:
                    z.update(fullyMitigatedAt=j, fullMitigationTime=b["time"])
            elif z["state"] == "VIRGIN":
                z["state"] = "PARTIALLY_MITIGATED"
        if z["tested"] and (b["close"] > z["top"] if bull else b["close"] < z["bottom"]):
            z.update(respectedAt=j, respectTime=b["time"])
    last = bars[-1]
    z["ageBars"] = len(bars)-1-z["born"]
    z["isCurrentlyInside"] = z["state"] not in ("INVERTED", "INVALIDATED") and last["low"] <= z["top"] and last["high"] >= z["bottom"] and z["bottom"] <= last["close"] <= z["top"]
    return z


def detect_pd_arrays(bars, options=None, *, tf=None):
    b = _records(bars)
    tf = tf or (options or {}).get("tf", "H4")
    fvgs, obs, used = [], [], set()
    piv = confirmed_fractals(b)

    def create(kind, direction, top, bottom, born, origin, displacement):
        return {"id": f"{tf}:{kind}:{direction}:{b[origin]['time']}:{b[born]['time']}", "tf": tf, "kind": kind,
                "type": ("BULLISH_FVG" if direction == 1 else "BEARISH_FVG") if kind == "FVG" else "ORDER_BLOCK",
                "dir": direction, "originalDir": direction, "top": top, "bottom": bottom, "ce": (top+bottom)/2,
                "mt": (b[origin]["open"]+b[origin]["close"])/2 if kind == "OB" else None,
                "size": top-bottom, "born": born, "bornTime": b[born]["time"], "originTime": b[origin]["time"],
                "confirmedAt": born, "confirmationTime": b[born]["time"], "displacement": displacement}

    for i in range(2, len(b)):
        direction = 1 if b[i]["low"] > b[i-2]["high"] else -1 if b[i]["high"] < b[i-2]["low"] else 0
        d = displacement_at(b, i-1, direction)
        if direction and d["valid"]:
            top = b[i]["low"] if direction == 1 else b[i-2]["low"]
            bottom = b[i-2]["high"] if direction == 1 else b[i]["high"]
            fvgs.append(_lifecycle(b, create("FVG", direction, top, bottom, i, i-1, d)))
        for direction in (1, -1):
            d = displacement_at(b, i, direction)
            if not d["valid"]:
                continue
            ps = [p for p in piv["highs" if direction == 1 else "lows"] if p["confirmedAt"] < i]
            p = ps[-1] if ps else None
            if not p or not (b[i]["close"] > p["price"] and b[i-1]["close"] <= p["price"] if direction == 1 else b[i]["close"] < p["price"] and b[i-1]["close"] >= p["price"]):
                continue
            for j in range(i-1, max(-1, i-11), -1):
                if direction * (b[j]["close"]-b[j]["open"]) >= 0:
                    continue
                key = (direction, b[j]["time"])
                if key not in used:
                    used.add(key)
                    obs.append(_lifecycle(b, create("OB", direction, b[j]["high"], b[j]["low"], i, j, d)))
                break
    return {"fvgs": fvgs, "orderBlocks": obs}


def detect_liquidity_raids(bars, options=None, *, levels=None, max_reclaim_bars=2):
    b = _records(bars)
    options = options or {}
    levels = levels if levels is not None else options.get("levels")
    max_reclaim_bars = options.get("maxReclaimBars", max_reclaim_bars)
    if levels is None:
        p = confirmed_fractals(b)
        levels = p["highs"] + p["lows"]
    out = []
    for level in levels:
        at = level.get("confirmedAt", level.get("formedAt"))
        time = level.get("confirmationTime", b[at]["time"] if at is not None and 0 <= at < len(b) else None)
        side = level.get("side")
        if time is None or side not in (1, -1):
            continue
        for i in range(len(b)):
            if b[i]["time"] <= time or not (b[i]["high"] > level["price"] if side == 1 else b[i]["low"] < level["price"]):
                continue
            extreme = b[i]["high"] if side == 1 else b[i]["low"]
            for j in range(i, min(i+max(0, min(2, int(max_reclaim_bars)))+1, len(b))):
                extreme = max(extreme, b[j]["high"]) if side == 1 else min(extreme, b[j]["low"])
                if b[j]["close"] < level["price"] if side == 1 else b[j]["close"] > level["price"]:
                    out.append({"dir": -side, "i": j, "raidIndex": i, "reclaimIndex": j,
                                "levelPrice": level["price"], "extreme": extreme, "time": b[j]["time"],
                                "raidTime": b[i]["time"], "levelId": level.get("id", f"L:{side}:{time}"),
                                "confirmationTime": time, "side": side, "age": len(b)-1-j})
                    break
            break
    return sorted(out, key=lambda x: (-x["i"], x["levelId"]))
