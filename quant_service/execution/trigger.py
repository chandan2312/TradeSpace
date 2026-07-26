"""M15 execution gate. Parity target: assessExecutionTrigger in lib/telemetry/core.js.

Telemetry picks the pair and direction; this decides *where* and *whether*. It
waits for H1/H4 liquidity to point the same way, then for a precise M15 trigger:
a sweep that got reclaimed, or a break that got retested.

The returned `level.price` is the exact swept price — which is what the bracket
rests its limit on. The JS engine computes this, records it, and then enters at
market anyway.
"""

from __future__ import annotations

from ..core.bars import Bars
from ..core.liquidity import liquidity_map
from ..core.patterns import avg_range

TFS = ("H1", "H4")


def _bounded_int(value, fallback: int, lo: int, hi: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(lo, min(hi, n))


def _round6(v: float) -> float:
    return round(float(v) * 1e6) / 1e6


def _compact(level: dict) -> dict:
    return {"name": level["name"], "price": _round6(level["price"]), "side": level["side"], "age": level.get("age")}


def _reclaimed(bars: Bars, level: dict, direction: int) -> bool:
    n = len(bars)
    if n < 2:
        return False
    c, o = float(bars.close[n - 1]), float(bars.open[n - 1])
    pc = float(bars.close[n - 2])
    px = level["price"]
    if direction > 0:
        return c > px and (c >= o or pc > px)
    return c < px and (c <= o or pc < px)


def _retested(bars: Bars, level: dict, direction: int, avg: float) -> bool:
    n = len(bars)
    tol = max(avg * 0.35, 1e-300)
    c, o = float(bars.close[n - 1]), float(bars.open[n - 1])
    px = level["price"]
    if direction > 0:
        return float(bars.low[n - 1]) <= px + tol and c > px and c >= o
    return float(bars.high[n - 1]) >= px - tol and c < px and c <= o


def _broken_levels(m: dict, n: int, direction: int, max_age: int) -> list[dict]:
    out = []
    for lv in m["levels"]:
        if lv.get("state") != "broken" or not isinstance(lv.get("brokenAt"), int):
            continue
        if lv["side"] != direction:
            continue
        age = n - 1 - lv["brokenAt"]
        if 0 <= age <= max_age:
            out.append({**lv, "age": age})
    out.sort(key=lambda x: x["age"])
    return out


def _liquidity_context(tf: str, bars: Bars, direction: int, max_breakout_age: int) -> dict:
    avg = avg_range(bars)
    m = liquidity_map(bars, avg)
    n = len(bars)
    aligned_sweeps = sorted(
        (lv for lv in m["sweeps"] if -lv["side"] == direction and lv["age"] <= max_breakout_age),
        key=lambda x: x["age"],
    )
    broken = _broken_levels(m, n, direction, max_breakout_age)
    draw = (m["draws"]["above"] if direction > 0 else m["draws"]["below"])
    opposing = any(-lv["side"] == -direction and lv["age"] <= max_breakout_age for lv in m["sweeps"])

    if aligned_sweeps:
        source = {"type": "sweep", "level": aligned_sweeps[0]}
    elif broken:
        source = {"type": "break", "level": broken[0]}
    elif draw:
        source = {"type": "draw", "level": draw[0]}
    else:
        source = None
    return {
        "tf": tf,
        "aligned": source is not None,
        "opposing": opposing,
        "source": {"type": source["type"], "level": _compact(source["level"])} if source else None,
    }


def assess_execution_trigger(frames: dict, dir_: str | int, cfg: dict | None = None) -> dict:
    cfg = cfg or {}
    direction = 1 if dir_ in ("buy", 1) else -1 if dir_ in ("sell", -1) else 0
    if not direction:
        return {"ok": False, "stage": "execution", "reason": "invalid direction"}

    m15 = frames.get("M15") if frames else None
    if (m15 is None or frames.get("H1") is None or frames.get("H4") is None
            or len(m15) < 50 or len(frames["H1"]) < 50 or len(frames["H4"]) < 50):
        return {"ok": False, "stage": "execution", "reason": "M15/H1/H4 liquidity data incomplete"}

    max_sweep_age = _bounded_int(cfg.get("algoExecutionSweepMaxAge"), 4, 0, 24)
    max_breakout_age = _bounded_int(cfg.get("algoExecutionBreakoutMaxAge"), 12, 1, 48)
    min_htf = _bounded_int(cfg.get("algoExecutionHtfMinAlignments"), 1, 1, 2)

    htf = [_liquidity_context(tf, frames[tf], direction, max_breakout_age) for tf in TFS]
    n_aligned = sum(1 for c in htf if c["aligned"])
    n_opposing = sum(1 for c in htf if c["opposing"])
    if n_aligned < min_htf or n_opposing == 2:
        return {
            "ok": False, "stage": "waiting_context", "htf": htf,
            "reason": "HTF liquidity context is conflicted" if n_aligned else "waiting for H1/H4 liquidity context",
        }

    avg = avg_range(m15)
    m = liquidity_map(m15, avg)
    n = len(m15)
    bar_time = int(m15.time[n - 1])

    candidates = sorted(
        (lv for lv in m["sweeps"] if -lv["side"] == direction and lv["age"] <= max_sweep_age),
        key=lambda x: x["age"],
    )
    sweep = next((lv for lv in candidates if _reclaimed(m15, lv, direction)), None)
    if sweep:
        return {"ok": True, "stage": "triggered", "kind": "sweep_reclaim",
                "reason": f"M15 {sweep['name']} sweep/reclaim", "level": _compact(sweep),
                "sweptAt": sweep["sweptAt"], "htf": htf, "m15BarTime": bar_time}

    breakout = next((lv for lv in _broken_levels(m, n, direction, max_breakout_age)
                     if _retested(m15, lv, direction, avg)), None)
    if breakout:
        return {"ok": True, "stage": "triggered", "kind": "breakout_retest",
                "reason": f"M15 {breakout['name']} breakout/retest", "level": _compact(breakout),
                "brokenAt": breakout["brokenAt"], "htf": htf, "m15BarTime": bar_time}

    return {"ok": False, "stage": "waiting_trigger",
            "reason": "waiting for M15 sweep/reclaim or breakout/retest", "htf": htf, "m15BarTime": bar_time}
