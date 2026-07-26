"""Lens ensemble. Parity target: lib/bias/lenses.js.

The bias is a regime-weighted VOTE of eight models that each read the same
market through one concept. Each lens has a fitness for the current regime (a
reversal lens is most credible right after a sweep; structure/fvg during
expansion; sr in ranges). Disagreement is output, not noise — and stability()
stress-tests the verdict against +/-30% weight jitter.
"""

from __future__ import annotations

import numpy as np

LENSES = [
    {"id": "structure", "label": "Structure", "base": 1.0},
    {"id": "liquidity", "label": "Liquidity", "base": 1.0},
    {"id": "reversal", "label": "Reversal", "base": 1.1},  # playbook priority
    {"id": "fvg", "label": "FVG", "base": 0.8},
    {"id": "ob", "label": "Order Blk", "base": 0.85},
    {"id": "sr", "label": "S/R", "base": 0.9},
    {"id": "volume", "label": "Volume", "base": 0.9},
    {"id": "flow", "label": "Flow", "base": 0.7},
]
BASE = {lens["id"]: lens["base"] for lens in LENSES}
LENS_IDS = [lens["id"] for lens in LENSES]


def clamp(v, lo, hi):
    return min(hi, max(lo, v))


def js_round(x: float) -> int:
    """JS Math.round: half rounds UP (toward +inf), unlike Python's banker's rounding."""
    return int(np.floor(x + 0.5))


def js_sign(x) -> int:
    return int(x > 0) - int(x < 0)


def js_num(x) -> str:
    """JS number→string: 2.0 prints as "2", not "2.0"."""
    return str(int(x)) if float(x).is_integer() else str(float(x))


def lens_fitness(ctx: dict) -> dict:
    er_norm = clamp(((ctx.get("er") or 0) - 0.2) / 0.25, 0, 1)
    return {
        "structure": 0.55 + 0.45 * er_norm,
        "liquidity": 0.6 + 0.08 * min(ctx.get("liveLevels") or 0, 5),
        "reversal": 0.55 + 0.45 * clamp(abs(ctx.get("reversalPush") or 0) / 25, 0, 1),
        "fvg": 0.55 + 0.35 * er_norm,
        "ob": 0.9 if ctx.get("obNear") else 0.6,
        "sr": 0.55 + 0.45 * (1 - er_norm),
        "volume": 0.5 + 0.4 * clamp((ctx.get("relPart") or 0) / 1.25, 0, 1),
        "flow": 0.5 + 0.1 * min(ctx.get("flowN") or 0, 5),
    }


def lens_vote(drives: list[dict], fitness: dict) -> dict:
    lenses = {}
    for lens in LENSES:
        lid = lens["id"]
        members = [d for d in drives if d["lens"] == lid]
        w = sum(d["w"] for d in members)
        lenses[lid] = {
            "label": lens["label"],
            "score": js_round((sum(d["dir"] * d["w"] for d in members) / w) * 100) if w else 0,
            "fitness": js_round(fitness[lid] * 100) / 100,
            "n": len(members),
        }

    num = den = 0.0
    for lid, l in lenses.items():
        if not l["n"]:
            continue
        wt = BASE[lid] * l["fitness"]
        num += l["score"] * wt
        den += wt
    final = clamp(num / den, -100, 100) if den else 0

    agree_mass = mass = 0.0
    for lid, l in lenses.items():
        if not l["n"] or abs(l["score"]) < 10:
            continue
        m = BASE[lid] * l["fitness"] * abs(l["score"])
        mass += m
        if js_sign(l["score"]) == js_sign(final):
            agree_mass += m
    agreement = js_round((agree_mass / mass) * 100) if mass else 100

    return {"lenses": lenses, "final": final, "agreement": agreement, "contested": agreement < 70}


def _mulberry32_stream(seed: int, n: int) -> np.ndarray:
    """n draws of JS mulberry32 at once. The state is linear (a_k = seed + k*C
    mod 2^32), so the whole stream is a vectorized uint32 expression."""
    C = np.uint32(0x6D2B79F5)
    a = (np.uint32(seed) + C * np.arange(1, n + 1, dtype=np.uint32)).astype(np.uint32)
    t = ((a ^ (a >> np.uint32(15))).astype(np.uint64) * (np.uint32(1) | a).astype(np.uint64)).astype(np.uint32)
    t2 = ((t ^ (t >> np.uint32(7))).astype(np.uint64) * (np.uint32(61) | t).astype(np.uint64)).astype(np.uint32)
    t = (t + t2).astype(np.uint32) ^ t
    return (t ^ (t >> np.uint32(14))).astype(np.float64) / 4294967296.0


def stability(drives: list[dict], fitness: dict, final_score: float, trials: int = 200):
    """Does the verdict survive ±30% weight jitter? A big score that flips is fragile."""
    if abs(final_score) < 5:
        return None
    n = len(drives)
    if not n:
        return js_round(1 * 100)
    sign = js_sign(final_score)

    r = _mulberry32_stream(len(drives) * 7919 + js_round(abs(final_score)), trials * n)
    w = np.array([d["w"] for d in drives], dtype=np.float64) * (0.7 + 0.6 * r.reshape(trials, n))

    # per-lens sums across all trials at once: (trials, n) → (trials, 8)
    idx = np.array([LENS_IDS.index(d["lens"]) for d in drives])
    dirs = np.array([d["dir"] for d in drives], dtype=np.float64)
    onehot = np.zeros((n, len(LENS_IDS)))
    onehot[np.arange(n), idx] = 1.0
    wsum = w @ onehot
    dsum = (w * dirs) @ onehot

    with np.errstate(invalid="ignore", divide="ignore"):
        scores = np.floor(np.where(wsum > 0, dsum / wsum, 0) * 100 + 0.5)

    present = np.array([any(d["lens"] == lid for d in drives) for lid in LENS_IDS])
    wt = np.array([BASE[lid] * (js_round(fitness[lid] * 100) / 100) for lid in LENS_IDS]) * present
    den = wt.sum()
    if den == 0:
        return js_round(0 if sign else 100)
    final = np.clip((scores * wt).sum(axis=1) / den, -100, 100)
    return js_round((np.sign(final) == sign).sum() / trials * 100)
