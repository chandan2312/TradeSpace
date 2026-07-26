"""Bias engine v5. Parity target: lib/bias/engine.js.

Lens-ensemble scoring for one playbook: HTF bias (1D/4H/1H) → M15 session/PD/PW
sweeps → M15 MSS → FVG/iFVG/QML.

  1. DRIVES    directional facts, each tagged with a pillar and a lens
  2. LENS VOTE regime-weighted vote across lenses, not a single weighted sum
  3. DAMPENERS reasons to distrust the number, applied multiplicatively
  4. GROUP     aggregate() adds category consensus, FX strength, USD spillover

Anti-lag rules: sweeps score AGAINST their direction, a fresh displaced MSS
overrides its TF's stale structure, untapped pools are magnets, all decay.
"""

from __future__ import annotations

import numpy as np

from .bars import Bars
from .buildup import detect_trendline_liquidity
from .lenses import clamp, js_num, js_round, js_sign, lens_fitness, lens_vote, stability
from .liquidity import detect_qml, liquidity_map, session_of
from .news import news_risk, symbol_currencies
from .pairs import classify_symbol, normalize
from .patterns import avg_range, detect_gaps, detect_order_blocks, fvg_zones
from .playbook import detect_setup
from .reversals import grind_then_displacement, strong_levels, sweep_wick_candle, v_reversal
from .smt import SMT_PAIRS, risk_beta, smt_divergence
from .structure import analyze_structure
from .volume import profiles, rel_participation, vol_ratio

TF_CONF = {
    "D1": {"w": 4, "mssFull": 3, "mssZero": 10, "pillar": "htf"},
    "H4": {"w": 6, "mssFull": 6, "mssZero": 18, "pillar": "htf"},
    "H1": {"w": 4, "mssFull": 8, "mssZero": 24, "pillar": "htf"},
    "M15": {"w": 3, "mssFull": 12, "mssZero": 40, "pillar": "intraday"},
}

CAT_LABEL = {"fx": "Forex", "indices": "Indices", "metals": "Metals",
             "crypto": "Crypto", "energy": "Energy", "stocks": "Stocks"}


def decay(age, full, zero):
    return 1 if age <= full else clamp(1 - (age - full) / (zero - full), 0, 1)


def _fmt_min(m):
    return f"{m // 60}h {m % 60}m" if m >= 60 else f"{m}m"


def _fmt_signed(v):
    return f"+{v}" if v > 0 else str(v)


def prior_week_levels(d1: Bars) -> list[dict]:
    """Prior ISO-week high/low from daily bars, classified against this week."""
    week = (d1.time // 86400 + 3) // 7  # Monday-start
    cur = int(week[-1])
    prev = np.flatnonzero(week == cur - 1)
    this_wk = np.flatnonzero(week == cur)
    if not len(prev):
        return []
    pwh = float(d1.high[prev].max())
    pwl = float(d1.low[prev].min())
    px = d1.close[-1]
    a = avg_range(d1)

    def classify(price, side):
        crossed = (
            bool((d1.high[this_wk] > price).any()) if side == 1 else bool((d1.low[this_wk] < price).any())
        )
        if not crossed:
            return "untapped"
        return "broken" if (px > price if side == 1 else px < price) else "swept"

    return [
        {"name": "PWH", "price": pwh, "side": 1, "state": classify(pwh, 1), "near": abs(pwh - px) <= 3 * a},
        {"name": "PWL", "price": pwl, "side": -1, "state": classify(pwl, -1), "near": abs(pwl - px) <= 3 * a},
    ]


def compute_symbol_bias(symbol: str, frames: dict, extras: dict | None = None, now_ms: int | None = None):
    extras = extras or {}
    category = classify_symbol(symbol)
    drives: list[dict] = []
    damps: list[dict] = []
    layers: dict = {}
    missing = [tf for tf, b in frames.items() if b is None or len(b) == 0]

    reversal_push = 0.0
    htf_sum = 0.0
    trigger_sum = 0.0
    macro_trend = 0

    def push(pillar, lens, label, direction, w, note):
        drives.append({"pillar": pillar, "lens": lens, "label": label, "dir": direction, "w": w, "note": note})

    # ---------- structure per TF (a fresh displaced MSS flips to the reversal lens)
    structures = {}
    for tf, conf in TF_CONF.items():
        bars = frames.get(tf)
        if bars is None or len(bars) == 0:
            continue
        avg = avg_range(bars)
        st = analyze_structure(bars, avg)
        structures[tf] = st
        direction = st["dir"]
        w = conf["w"] * (0.4 if st["ranging"] else st["strength"])
        note = st["seq"]
        lens = "structure"

        ev = st["lastEvent"]
        if ev and ev["type"] == "MSS" and ev["displaced"]:
            k = decay(ev["age"], conf["mssFull"], conf["mssZero"])
            if k > 0:
                direction = ev["dir"]
                w = conf["w"] * (0.6 + 0.4 * k) + 4 * k
                note = f"MSS {'↑' if ev['dir'] > 0 else '↓'} {ev['age']} bars ago, displaced"
                lens = "reversal"
                vr = vol_ratio(bars, ev["i"])
                if vr is not None and vr >= 1.5:
                    w *= 1.15
                    note += f", {js_num(vr)}× vol"
                elif vr is not None and vr <= 0.6:
                    w *= 0.85
                    note += f", thin {js_num(vr)}× vol"
                if tf in ("H1", "M15"):
                    reversal_push += ev["dir"] * 10 * k
                    trigger_sum += ev["dir"] * 10 * k

        layers[tf] = {"dir": direction, "note": note}
        push(conf["pillar"], lens, f"{tf} structure", direction, w, note)
        if conf["pillar"] == "htf":
            htf_sum += direction * w

    # ---------- HTF reversal anatomy + standing protected extremes
    for tf, w0, full_age, zero_age in (("D1", 10, 3, 8), ("H4", 8, 6, 16)):
        bars = frames.get(tf)
        if bars is None or len(bars) == 0:
            continue
        avg = avg_range(bars)

        sigs = [s for s in (sweep_wick_candle(bars, avg), v_reversal(bars, avg)) if s]
        if sigs:
            sig = sorted(sigs, key=lambda s: s["age"])[0]
            k = decay(sig["age"], full_age, zero_age)
            if k > 0:
                w_eff = w0 * k * (1.15 if sig["grade"] == "A" else 1)
                push("htf", "reversal", f"{tf} {sig['kind']}", sig["dir"], w_eff,
                     f"{'swept liquidity, ' if sig['grade'] == 'A' else ''}{sig['age']} bars ago")
                reversal_push += sig["dir"] * w_eff * 0.7

        px = bars.close[-1]
        lvls = strong_levels(bars, avg)
        lows = sorted((l for l in lvls if l["side"] == "low" and l["price"] < px), key=lambda l: -l["price"])
        highs = sorted((l for l in lvls if l["side"] == "high" and l["price"] > px), key=lambda l: l["price"])
        base_w = 18 if tf == "D1" else 14

        if lows:
            push("htf", "sr", f"{tf} strong base holding", 1, base_w, f"{lows[0]['kind']} low, macro uptrend base")
            htf_sum += base_w
            if not macro_trend:
                macro_trend = 1
        if highs:
            push("htf", "sr", f"{tf} strong ceiling holding", -1, base_w, f"{highs[0]['kind']} high, macro downtrend base")
            htf_sum -= base_w
            if not macro_trend:
                macro_trend = -1

    # ---------- HTF POIs for fractal sweep validation
    htf_pois = []
    for tf in ("H1", "H4"):
        bars = frames.get(tf)
        if bars is None or len(bars) == 0:
            continue
        avg = avg_range(bars)
        for z in fvg_zones(bars, avg):
            if z["state"] == "open":
                htf_pois.append({"type": f"{tf} FVG", "dir": z["dir"], "top": z["top"], "bottom": z["bottom"]})
        for z in detect_order_blocks(bars, avg):
            if z["age"] < 50:
                htf_pois.append({"type": f"{tf} OB", "dir": z["dir"], "top": z["top"], "bottom": z["bottom"]})

    def check_mitigation(extreme_px, expected_dir):
        for z in htf_pois:
            if z["dir"] == expected_dir and z["bottom"] <= extreme_px <= z["top"]:
                return z
        return None

    # ---------- liquidity: sweeps / breaks / draws / builds (M15)
    intraday = frames.get("M15")
    if intraday is not None and len(intraday) == 0:
        intraday = None
    session = None
    liq = None
    intraday_avg = 0.0
    if intraday is not None:
        intraday_avg = avg_range(intraday)
        px = intraday.close[-1]
        liq = liquidity_map(intraday, intraday_avg)
        session = session_of(int(intraday.time[-1]))

        for s in liq["sweeps"]:
            k = decay(s["age"], 8, 48)
            if k <= 0:
                continue
            direction = -s["side"]
            si = s["sweptAt"]
            killzone = session_of(int(intraday.time[si]))
            session_mult = 1.3 if killzone["id"] in ("london", "ny") else 1.0

            w = 12 * s["weightMul"] * k * session_mult
            note = f"stop hunt {s['age']} bars ago"
            if session_mult > 1:
                note += f" ({killzone['label']} KZ)"

            vr = vol_ratio(intraday, si)
            if vr is not None and vr >= 1.8:
                w *= 1.25
                note += f", climactic {js_num(vr)}× vol"
            elif vr is not None and vr <= 0.7:
                w *= 0.75
                note += f", thin {js_num(vr)}× vol"

            extreme_px = intraday.high[si] if s["side"] == 1 else intraday.low[si]
            mit = check_mitigation(extreme_px, direction)
            if mit:
                w *= 1.5  # fractal alignment
                note += f" + tapped {mit['type']}"

            push("liquidity", "liquidity", f"{s['name']} swept", direction, w, note)
            reversal_push += direction * w * 0.8
            trigger_sum += direction * w * 0.6

        for lv in liq["levels"]:
            if lv["state"] != "broken" or lv.get("brokenAt") is None:
                continue
            k = decay(len(intraday) - 1 - lv["brokenAt"], 12, 60)
            if k <= 0:
                continue
            w = 7 * k
            note = "acceptance beyond level"
            vr = vol_ratio(intraday, lv["brokenAt"])
            if vr is not None and vr <= 0.7:
                w *= 0.7
                note = f"low-volume break ({js_num(vr)}×) — trap risk"
            push("liquidity", "sr", f"{lv['name']} broken & holding", lv["side"], w, note)

        def near(arr):
            for lv in arr:
                if abs(lv["price"] - px) <= 25 * intraday_avg:
                    return lv
            return None

        up, dn = near(liq["draws"]["above"]), near(liq["draws"]["below"])
        if up and (not dn or abs(up["price"] - px) < abs(dn["price"] - px)):
            push("liquidity", "liquidity", f"draw → {up['name']}", 1, 6, "untapped pool above")
        elif dn:
            push("liquidity", "liquidity", f"draw → {dn['name']}", -1, 6, "untapped pool below")

        active_eqh = [b for b in liq["builds"] if b["side"] == 1 and b["price"] > px]
        active_eql = [b for b in liq["builds"] if b["side"] == -1 and b["price"] < px]
        if active_eqh:
            push("liquidity", "liquidity", "EQH Buildup", 1, 14 if macro_trend == 1 else 7,
                 f"{len(active_eqh)} equal high pools active")
        if active_eql:
            push("liquidity", "liquidity", "EQL Buildup", -1, 14 if macro_trend == -1 else 7,
                 f"{len(active_eql)} equal low pools active")

        tl = detect_trendline_liquidity(intraday, intraday_avg)
        for d in tl["draws"]:
            w = 16 if (d["side"] == macro_trend and macro_trend != 0) else 8
            push("liquidity", "liquidity", d["type"], d["side"], w, f"{d['touches']} touches: {d['note']}")
        for s in tl["sweeps"]:
            k = decay(s["age"], 8, 48)
            if k <= 0:
                continue
            direction = -s["side"]
            si = len(intraday) - 1 - s["age"]
            killzone = session_of(int(intraday.time[si]))
            session_mult = 1.3 if killzone["id"] in ("london", "ny") else 1.0

            w = 18 * k * session_mult
            note = f"Hunted {s['touches']}-touch {s['note']}, {s['age']} bars ago"
            if session_mult > 1:
                note += f" ({killzone['label']} KZ)"

            extreme_px = intraday.high[si] if s["side"] == 1 else intraday.low[si]
            mit = check_mitigation(extreme_px, direction)
            if mit:
                w *= 1.5
                note += f" + tapped {mit['type']}"

            push("liquidity", "reversal", s["type"], direction, w, note)
            reversal_push += direction * w * 0.9
            trigger_sum += direction * w * 0.9

    # ---------- prior WEEK high/low from D1
    d1 = frames.get("D1")
    if d1 is not None and len(d1):
        for lv in prior_week_levels(d1):
            if lv["state"] == "swept":
                push("liquidity", "liquidity", f"{lv['name']} swept", -lv["side"], 10, "weekly stop hunt")
                reversal_push += -lv["side"] * 8
            elif lv["state"] == "untapped" and lv["near"]:
                push("liquidity", "liquidity", f"draw → {lv['name']}", lv["side"], 5, "weekly pool in reach")

    # ---------- intraday triggers: QML, FVG stack, reversal anatomy
    m15 = intraday
    if m15 is not None:
        m15avg = avg_range(m15)
        qml = detect_qml(m15, m15avg)
        if qml:
            k = decay(qml["age"], 10, 30)
            if k > 0:
                w = 11 * k
                note = f"sweep→neck break {qml['age']} bars ago"
                vr = vol_ratio(m15, qml["i"])
                if vr is not None and vr >= 1.5:
                    w *= 1.15
                    note += f", {js_num(vr)}× vol"
                push("intraday", "reversal", "QML", qml["dir"], w, note)
                reversal_push += qml["dir"] * w
                trigger_sum += qml["dir"] * w

        gaps = fvg_zones(m15, m15avg)
        open_bull = sum(1 for z in gaps if z["state"] == "open" and z["dir"] == 1)
        open_bear = sum(1 for z in gaps if z["state"] == "open" and z["dir"] == -1)
        net = open_bull - open_bear
        if abs(net) >= 2:
            push("intraday", "fvg", "FVG stack", js_sign(net), 4,
                 f"{max(open_bull, open_bear)} unfilled {'bullish' if net > 0 else 'bearish'} gaps")

        inverted = sorted((z for z in gaps if z["state"] == "inverted"), key=lambda z: -z["invertedAt"])
        if inverted:
            inv = inverted[0]
            age = len(m15) - 1 - inv["invertedAt"]
            k = decay(age, 8, 30)
            if k > 0:
                push("intraday", "fvg", "iFVG flip", -inv["dir"], 7 * k,
                     f"{'bullish' if inv['dir'] > 0 else 'bearish'} gap inverted {age} bars ago")

        px_m15 = m15.close[-1]

        def edge(z):
            return z["top"] if z["dir"] == 1 else z["bottom"]

        supporting = [
            z for z in gaps
            if z["state"] == "open"
            and (z["top"] < px_m15 if z["dir"] == 1 else z["bottom"] > px_m15)
            and abs(edge(z) - px_m15) <= 10 * m15avg
        ]
        if supporting:
            o = sorted(supporting, key=lambda z: abs(edge(z) - px_m15))[0]
            push("intraday", "fvg", "FVG support below" if o["dir"] > 0 else "FVG resistance above",
                 o["dir"], 4, "unfilled gap in the pullback path")

        sw = sweep_wick_candle(m15, m15avg)
        if sw:
            k = decay(sw["age"], 6, 24)
            if k > 0:
                w = 7 * k * (1.2 if sw["grade"] == "A" else 1)
                push("intraday", "reversal", f"M15 {sw['kind']}", sw["dir"], w,
                     "wick ran a swing, closed back strong" if sw["swept"] else "strong rejection wick")
                reversal_push += sw["dir"] * w * 0.8
                trigger_sum += sw["dir"] * w * 0.8

        v = v_reversal(m15, m15avg)
        if v:
            k = decay(v["age"], 8, 30)
            if k > 0:
                push("intraday", "reversal", "M15 V-reversal", v["dir"], 7 * k,
                     f"sharp leg recovered ≥70% ({v['grade']})")
                reversal_push += v["dir"] * 7 * k * 0.7
                trigger_sum += v["dir"] * 7 * k * 0.7

        gd = grind_then_displacement(m15, m15avg)
        if gd:
            k = decay(gd["age"], 5, 20)
            if k > 0:
                push("intraday", "structure", "grind → displacement", gd["dir"], 7 * k,
                     f"slow pullback broken {js_num(gd['ratio'])}× faster")
                trigger_sum += gd["dir"] * 7 * k

    # ---------- premium / discount of the H4 dealing range
    h4 = frames.get("H4")
    if h4 is not None and len(h4):
        win = h4.tail(90)
        hi, lo = float(win.high.max()), float(win.low.min())
        if hi > lo:
            pos = clamp((h4.close[-1] - lo) / (hi - lo), 0, 1)
            if pos < 0.42 or pos > 0.58:
                push("htf", "sr", "discount" if pos < 0.5 else "premium", 1 if pos < 0.5 else -1,
                     9 * abs(pos - 0.5) * 2, f"{js_round(pos * 100)}% of H4 range")

    # ---------- order blocks: unmitigated origins of displacement legs
    ob_near = False
    for tf, bars, pillar in (("H1", frames.get("H1"), "htf"), ("M15", m15, "intraday")):
        if bars is None or len(bars) == 0:
            continue
        avg = avg_range(bars)
        px = bars.close[-1]
        obs = detect_order_blocks(bars, avg)

        at_zone = sorted(
            (z for z in obs if z["bottom"] - 0.5 * avg <= px <= z["top"] + 0.5 * avg),
            key=lambda z: z["age"],
        )
        at = at_zone[0] if at_zone else None
        if at:
            k = decay(at["age"], 20, 80)
            if k > 0:
                ob_near = True
                inside = at["bottom"] <= px <= at["top"]
                push(pillar, "ob", f"{tf} {'demand' if at['dir'] > 0 else 'supply'} OB", at["dir"],
                     8 * (1 if inside else 0.7) * k,
                     f"price {'inside' if inside else 'at'} unmitigated block")

        fresh = sorted((z for z in obs if z["age"] <= 3), key=lambda z: z["age"])
        if fresh and fresh[0] is not at:
            push(pillar, "ob", f"fresh {tf} OB", fresh[0]["dir"], 5, "displacement just left a block behind")

    # ---------- volume: profile location (POC / value area / HVN / LVN)
    rel_part = None
    if intraday is not None:
        rel_part = rel_participation(intraday)
        px = intraday.close[-1]
        vp = profiles(intraday, intraday_avg)

        if vp["prior"]:
            p = vp["prior"]
            if px > p["vah"] + 0.25 * intraday_avg:
                push("intraday", "volume", "accepted above value", 1, 5, "trading above prior-day VAH")
            elif px < p["val"] - 0.25 * intraday_avg:
                push("intraday", "volume", "accepted below value", -1, 5, "trading below prior-day VAL")
            elif abs(p["poc"] - px) >= 2 * intraday_avg:
                push("intraday", "volume", "rotation to PD POC", js_sign(p["poc"] - px), 4,
                     "inside prior value — POC magnet")

        if vp["today"] and abs(vp["today"]["poc"] - px) >= 2 * intraday_avg:
            push("intraday", "volume", "draw → today's POC", js_sign(vp["today"]["poc"] - px), 3,
                 "developing POC magnet")

        if vp["dealing"]:
            hvns = vp["dealing"]["hvns"]
            shelf = next((h for h in hvns if h["price"] < px and px - h["price"] <= 2 * intraday_avg), None)
            ceil = next((h for h in hvns if h["price"] > px and h["price"] - px <= 2 * intraday_avg), None)
            if shelf:
                push("intraday", "volume", "HVN shelf below", 1, 4, "high-volume acceptance under price")
            if ceil:
                push("intraday", "volume", "HVN ceiling above", -1, 4, "high-volume acceptance over price")

            if liq:
                lvns = vp["dealing"]["lvns"]

                def between(t):
                    return any(min(px, t) < l["price"] < max(px, t) for l in lvns)

                up = liq["draws"]["above"][0] if liq["draws"]["above"] else None
                dn = liq["draws"]["below"][0] if liq["draws"]["below"] else None
                if up and between(up["price"]):
                    push("intraday", "volume", "LVN void above", 1, 3, f"thin path to {up['name']}")
                elif dn and between(dn["price"]):
                    push("intraday", "volume", "LVN void below", -1, 3, f"thin path to {dn['name']}")

    # ---------- the playbook: pool swept → M15 displaced MSS
    setup = None
    if liq and intraday is not None:
        setup = detect_setup(liq["sweeps"], intraday)
        if setup:
            w = 18 * (1.15 if setup["grade"] == "A" else 1)
            vol_note = f" on {js_num(setup['volRatio'])}× vol" if setup["volRatio"] else ""
            push("intraday", "reversal", f"sweep → {setup['mssTf']} MSS", setup["dir"], w,
                 f"{setup['pool']} swept, MSS {setup['mssAgeMin']}m ago{vol_note} ({setup['grade']})")
            reversal_push += setup["dir"] * 16
            trigger_sum += setup["dir"] * 14

    # ---------- context: SMT divergence + risk sentiment
    base = normalize(symbol)
    for partner in SMT_PAIRS.get(base, []):
        p_frames = (extras.get("partnerFrames") or {}).get(partner)
        if not p_frames or p_frames.get("M15") is None:
            continue
        smt = smt_divergence(frames.get("M15"), p_frames["M15"], partner)
        if smt:
            push("context", "flow", "SMT divergence", smt["dir"], 9, smt["note"])
            reversal_push += smt["dir"] * 7
            break

    beta = risk_beta(symbol, category)
    risk = extras.get("risk")
    if risk and beta != 0 and abs(risk["score"]) >= 25:
        push("context", "flow", "risk-on tape" if risk["score"] > 0 else "risk-off tape",
             js_sign(risk["score"] * beta), 6 * abs(beta), risk["note"])

    # ---------- confluence: HTF and fresh triggers agree
    if abs(htf_sum) > 10 and abs(trigger_sum) > 8 and js_sign(htf_sum) == js_sign(trigger_sum):
        push("intraday", "structure", "A+ alignment", js_sign(htf_sum), 8, "HTF bias + fresh trigger agree")

    # ---------- lens vote
    er = 0.0
    h1 = frames.get("H1")
    if h1 is not None and len(h1) > 21:
        cl = h1.close[-21:]
        path = float(np.abs(np.diff(cl)).sum())
        er = abs(float(cl[-1] - cl[0])) / path if path else 0.0
    live_levels = (
        len(liq["sweeps"]) + len(liq["draws"]["above"]) + len(liq["draws"]["below"]) if liq else 0
    )
    fitness = lens_fitness({
        "er": er, "reversalPush": reversal_push, "liveLevels": live_levels,
        "obNear": ob_near, "relPart": rel_part,
        "flowN": sum(1 for d in drives if d["lens"] == "flow"),
    })
    vote = lens_vote(drives, fitness)
    score = vote["final"]

    phase = "trend"
    if setup:
        phase = "setup"
    elif (
        vote["contested"]
        and abs(vote["lenses"]["reversal"]["score"]) >= 25
        and js_sign(vote["lenses"]["reversal"]["score"]) != js_sign(vote["lenses"]["structure"]["score"] or htf_sum)
    ):
        phase = "reversal-watch"

    stab = stability(drives, fitness, score)

    # ---------- dampeners
    if (structures.get("H1") or {}).get("ranging") and (structures.get("M15") or {}).get("ranging"):
        damps.append({"label": "structure chop", "mult": 0.65, "note": "H1 and M15 both ranging"})

    events = news_risk(extras.get("news") or [], symbol_currencies(symbol, category), now_ms=now_ms)
    upcoming = next((e for e in events if e["when"] == "upcoming"), None)
    released = next((e for e in events if e["when"] == "released"), None)
    if upcoming:
        damps.append({"label": "news risk", "mult": 0.6,
                      "note": f"{upcoming['currency']} {upcoming['title']} in {_fmt_min(upcoming['inMin'])}"})
    elif released:
        damps.append({"label": "post-news volatility", "mult": 0.75,
                      "note": f"{released['currency']} {released['title']} {_fmt_min(released['agoMin'])} ago"})

    if vote["agreement"] < 60 and abs(score) >= 15:
        damps.append({"label": "lenses disagree", "mult": 0.8,
                      "note": f"only {vote['agreement']}% of lens mass agrees"})
    if stab is not None and stab < 60:
        damps.append({"label": "fragile verdict", "mult": 0.85,
                      "note": f"flips under small weight changes ({stab}%)"})

    if h1 is not None and len(h1) > 21:
        mean = float(h1.close[-20:].sum()) / 20
        dist = abs(h1.close[-1] - mean)
        a = avg_range(h1)
        if dist > 3 * a:
            damps.append({"label": "extended from mean", "mult": 0.85,
                          "note": f"{dist / a:.1f}× H1 range off 20-bar mean"})

    if session and session["id"] == "off":
        damps.append({"label": "off-hours", "mult": 0.7, "note": "thin liquidity window"})

    if intraday is not None:
        fresh_gap = next((g for g in detect_gaps(intraday, intraday_avg, 4.0) if g["age"] <= 1), None)
        if fresh_gap:
            damps.append({"label": "post-gap anomaly", "mult": 0.5,
                          "note": f"massive price gap detected {fresh_gap['age']} bars ago, reducing confidence"})

    if rel_part is not None and rel_part < 0.55 and abs(score) >= 15:
        damps.append({"label": "dead tape", "mult": 0.85,
                      "note": f"participation {js_round(rel_part * 100)}% of normal"})

    if liq and abs(score) >= 15:
        pool = liq["draws"]["below"] if score > 0 else liq["draws"]["above"]
        against = pool[0] if pool else None
        if against and abs(against["price"] - intraday.close[-1]) <= 5 * intraday_avg:
            damps.append({"label": "counter-liquidity near", "mult": 0.85,
                          "note": f"{against['name']} likely to be run first"})

    damp_mult = 1.0
    for d in damps:
        damp_mult *= d["mult"]

    pillars = {}
    for p in ("htf", "intraday", "liquidity", "context"):
        fs = [d for d in drives if d["pillar"] == p]
        w = sum(d["w"] for d in fs)
        pillars[p] = js_round((sum(d["dir"] * d["w"] for d in fs) / w) * 100) if w else 0

    completeness = 1 - len(missing) / (len(frames) or 1)
    confidence = js_round(clamp((vote["agreement"] / 100) * completeness * (0.5 + 0.5 * damp_mult), 0, 1) * 100)

    drives.sort(key=lambda d: -d["w"])
    return {
        "symbol": symbol,
        "category": category,
        "score": js_round(score),  # pre-group, pre-damp; finalized in aggregate()
        "dampMult": damp_mult,
        "phase": phase,
        "setup": setup,
        "confidence": confidence,
        "stability": stab,
        "agreement": vote["agreement"],
        "lenses": vote["lenses"],
        "session": session["label"] if session else None,
        "layers": layers,
        "pillars": pillars,
        "factors": [
            {"pillar": f["pillar"], "lens": f["lens"], "label": f["label"], "dir": f["dir"],
             "w": js_round(f["w"]), "note": f["note"]}
            for f in drives[:9]
        ],
        "damps": damps,
        "news": events[:3],
        "missing": missing,
    }


def aggregate(results: list[dict]) -> dict:
    """Group pass — category consensus, FX currency strength, USD spillover into
    metals; dampeners applied LAST. MUTATES `results` in place, like the JS."""
    cats: dict[str, list[dict]] = {}
    for r in results:
        cats.setdefault(r["category"], []).append(r)

    categories = []
    for cid, members in cats.items():
        mean = sum(m["score"] for m in members) / len(members)
        aligned = sum(1 for m in members if js_sign(m["score"]) == js_sign(mean) and m["score"] != 0)
        alignment = js_round((aligned / len(members)) * 100) if len(members) > 1 else 100
        categories.append({"id": cid, "label": CAT_LABEL.get(cid, cid), "score": js_round(mean),
                           "alignment": alignment, "members": [m["symbol"] for m in members]})

        if len(members) >= 3:
            boost = clamp(mean * 0.12, -8, 8)
            if abs(boost) >= 2:
                for m in members:
                    m["score"] = clamp(m["score"] + boost, -100, 100)
                    m["factors"].append({
                        "pillar": "context", "lens": "flow",
                        "label": f"{CAT_LABEL.get(cid, cid)} {'tailwind' if boost > 0 else 'headwind'}",
                        "dir": js_sign(boost), "w": abs(js_round(boost)), "note": f"category mean {js_round(mean)}",
                    })

    fx = cats.get("fx", [])
    strength: dict[str, dict] = {}
    for r in fx:
        s = normalize(r["symbol"])
        b, q = s[:3], s[3:]
        strength.setdefault(b, {"sum": 0, "n": 0})
        strength[b]["sum"] += r["score"]
        strength[b]["n"] += 1
        strength.setdefault(q, {"sum": 0, "n": 0})
        strength[q]["sum"] -= r["score"]
        strength[q]["n"] += 1
    ccy_score = {c: js_round(v["sum"] / v["n"]) for c, v in strength.items()}

    if len(fx) >= 3:
        for r in fx:
            s = normalize(r["symbol"])
            b, q = ccy_score.get(s[:3], 0), ccy_score.get(s[3:], 0)
            adj = clamp(((b - q) / 2 - r["score"]) * 0.15, -6, 6)
            if abs(adj) >= 2:
                r["score"] = clamp(r["score"] + adj, -100, 100)
                r["factors"].append({
                    "pillar": "context", "lens": "flow", "label": "currency consensus",
                    "dir": js_sign(adj), "w": abs(js_round(adj)),
                    "note": f"{s[:3]} {_fmt_signed(b)} vs {s[3:]} {_fmt_signed(q)}",
                })
        usd = ccy_score.get("USD", 0)
        for m in cats.get("metals", []):
            adj = clamp(-usd * 0.06, -5, 5)
            if abs(adj) >= 2:
                m["score"] = clamp(m["score"] + adj, -100, 100)
                m["factors"].append({
                    "pillar": "context", "lens": "flow", "label": "USD consensus (inverse)",
                    "dir": js_sign(adj), "w": abs(js_round(adj)), "note": f"USD {_fmt_signed(usd)}",
                })

    for r in results:
        r["score"] = clamp(js_round(r["score"] * r["dampMult"]), -100, 100)
        r["dir"] = "bullish" if r["score"] > 15 else "bearish" if r["score"] < -15 else "neutral"
        if abs(r["score"]) < 15 and r["phase"] not in ("reversal-watch", "setup"):
            r["phase"] = "chop"
    for c in categories:
        members = cats[c["id"]]
        c["score"] = js_round(sum(m["score"] for m in members) / len(members))

    currency_strength = sorted(
        ({"ccy": c, "score": s} for c, s in ccy_score.items()), key=lambda x: -x["score"]
    )
    categories.sort(key=lambda c: -abs(c["score"]))
    return {"categories": categories, "currencyStrength": currency_strength}
