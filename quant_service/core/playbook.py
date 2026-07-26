"""The user's core playbook signature. Parity target: lib/bias/playbook.js.

A real liquidity pool gets SWEPT → M15 prints a DISPLACED MSS in the reversal
direction AFTER the sweep bar. M15 is the execution frame by design.
"""

from __future__ import annotations

from .bars import Bars
from .patterns import avg_range
from .structure import analyze_structure
from .volume import vol_ratio

STRONG_POOLS = {"PDH", "PDL", "PWH", "PWL", "EQH", "EQL"}


def _mss_confirm(bars: Bars, direction: int, sweep_time: int, max_age: int):
    """Fresh displaced MSS in `direction` after the sweep. Continuation BOS keeps
    it valid; any opposite-direction event negates it."""
    if len(bars) < 30:
        return None
    st = analyze_structure(bars, avg_range(bars))
    for ev in reversed(st["events"]):
        if ev["dir"] != direction:
            return None
        if ev["type"] != "MSS" or not ev["displaced"]:
            continue
        age = len(bars) - 1 - ev["i"]
        if age > max_age:
            return None
        if bars.time[ev["i"]] <= sweep_time:
            return None
        return {**ev, "age": age, "volRatio": vol_ratio(bars, ev["i"])}
    return None


def detect_setup(sweeps: list[dict], bars: Bars):
    if not sweeps or bars is None or len(bars) == 0:
        return None

    for s in sorted((x for x in sweeps if x["age"] <= 12), key=lambda x: x["age"]):
        if s["sweptAt"] >= len(bars):
            continue
        sweep_time = int(bars.time[s["sweptAt"]])
        direction = -s["side"]  # reversal trades against the sweep
        mss = _mss_confirm(bars, direction, sweep_time, 16)
        if not mss:
            continue

        vr = mss["volRatio"]
        grade = "A" if s["name"] in STRONG_POOLS else "B"
        if vr is not None and vr >= 1.8:
            grade = "A"
        elif vr is not None and vr < 0.6:
            grade = "B"

        return {
            "dir": direction, "pool": s["name"], "sweptAgo": s["age"], "mssTf": "M15",
            "mssAgeMin": mss["age"] * 15, "volRatio": vr, "grade": grade,
        }
    return None
