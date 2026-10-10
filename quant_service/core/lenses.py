"""Lens ensemble. Parity target: lib/bias/lenses.js.

The bias is a regime-weighted VOTE of eight models that each read the same
market through one concept:
  structure — continuation: swing sequences, breaks holding, displacement
  liquidity — pools: sweeps (against), draws/magnets, weekly stop hunts
  reversal  — the trap: sweeps→MSS, QML, wicks, V-shapes; the user's playbook
  fvg       — imbalance: unfilled gap stacks, inversions (iFVG)
  ob        — order blocks: unmitigated origin candles of displacement legs
  sr        — levels: defended strong highs/lows, SR flips, premium/discount
  volume    — participation: volume profile POC, value area acceptance (VAH/VAL), HVN/LVN
  flow      — the group: SMT, risk tape, currency/category consensus

Each lens has a fitness for the current regime. Disagreement is output, not noise
— and stability() stress-tests the verdict against model and drive weight jitter.
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
    # Smoothstep transition over a wider band [0.15, 0.50] to eliminate the 1-candle knife-edge cliff
    raw_er = clamp(((ctx.get("er") or 0) - 0.15) / 0.35, 0, 1)
    er_norm = raw_er * raw_er * (3 - 2 * raw_er)

    # Continuous exponential distance decay for Order Block fitness + fresh displacement OB awareness
    ob_dist = ctx.get("obDist")
    has_fresh_ob = bool(ctx.get("hasFreshOb"))
    if ob_dist is not None and np.isfinite(ob_dist):
        ob_fit = max(0.85 if has_fresh_ob else 0.60, 0.60 + 0.35 * float(np.exp(-ob_dist / 0.8)))
    else:
        ob_fit = 0.85 if has_fresh_ob else (0.9 if ctx.get("obNear") else 0.6)

    rev_push = abs(ctx.get("reversalPush")) if ctx.get("reversalPush") is not None else (25.0 if ctx.get("setupActive") else 0.0)

    return {
        "structure": 0.55 + 0.45 * er_norm,
        "liquidity": 0.6 + 0.08 * min(ctx.get("liveLevels") or 0, 5),
        "reversal": 0.55 + 0.45 * clamp(rev_push / 25.0, 0, 1),
        "fvg": 0.55 + 0.35 * er_norm,
        "ob": ob_fit,
        "sr": 0.55 + 0.45 * (1 - er_norm),
        "volume": 0.5 + 0.4 * clamp((ctx.get("relPart") or 0) / 1.25, 0, 1),
        "flow": 0.5 + 0.1 * min(ctx.get("flowN") or 0, 5),
    }


def lens_vote(drives: list[dict], fitness: dict, options: dict = None) -> dict:
    options = options or {}
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

    # ICT Sequential Override:
    # When a verified Sweep -> MSS reversal is active, the prior trend continuation
    # was merely the precondition building the swept liquidity pool.
    # Temporarily subordinate the weight of opposing structure and FVG continuation lenses
    # so the textbook reversal is not diluted to ~0 by the democracy paradox.
    rev_lens = lenses.get("reversal")
    has_active_reversal = bool(options.get("setupActive") or (rev_lens and abs(rev_lens["score"]) >= 40 and rev_lens["fitness"] >= 0.70))
    rev_dir = options.get("setupDir") or (js_sign(rev_lens["score"]) if rev_lens else 0)

    num = den = 0.0
    for lid, l in lenses.items():
        if not l["n"]:
            continue
        members = [d for d in drives if d["lens"] == lid]
        w_total = sum(d["w"] for d in members)

        # Calibrated saturation ceiling: Volume and Flow have lower maximum concurrent drive capacity (~9)
        cap = 9.0 if lid in ("volume", "flow") else 16.0
        mass_mult = clamp(w_total / cap, 0.45, 1.0)

        base_weight = BASE[lid]
        if has_active_reversal and rev_dir != 0:
            if lid in ("structure", "fvg") and js_sign(l["score"]) != rev_dir and abs(l["score"]) >= 15:
                base_weight *= 0.35
            elif lid == "reversal" and (js_sign(l["score"]) == rev_dir or l["score"] == 0):
                base_weight *= 1.35

        wt = base_weight * l["fitness"] * mass_mult

        # Intra-Lens Deadlock correction:
        # Scale denominator weight by directional conviction so conflicted lenses don't anchor bias to zero
        conviction = abs(l["score"]) / 100.0
        eff_weight = wt * (0.35 + 0.65 * conviction)

        num += l["score"] * wt
        den += eff_weight
    final = clamp(num / den, -100, 100) if den else 0

    agree_mass = mass = 0.0
    for lid, l in lenses.items():
        if not l["n"]:
            continue
        members = [d for d in drives if d["lens"] == lid]
        w_total = sum(d["w"] for d in members)
        cap = 9.0 if lid in ("volume", "flow") else 16.0
        mass_mult = clamp(w_total / cap, 0.45, 1.0)

        base_weight = BASE[lid]
        if has_active_reversal and rev_dir != 0:
            if lid in ("structure", "fvg") and js_sign(l["score"]) != rev_dir and abs(l["score"]) >= 15:
                base_weight *= 0.35
            elif lid == "reversal" and js_sign(l["score"]) == rev_dir:
                base_weight *= 1.35

        wt = base_weight * l["fitness"] * mass_mult
        pos_w = sum(d["w"] for d in members if d["dir"] > 0)
        neg_w = sum(d["w"] for d in members if d["dir"] < 0)
        conflict_ratio = (2.0 * min(pos_w, neg_w) / w_total) if w_total > 0 else 0.0
        eff_mag = max(abs(l["score"]), conflict_ratio * 100.0)
        m = wt * eff_mag
        mass += m
        if abs(l["score"]) >= 10 and js_sign(l["score"]) == js_sign(final):
            agree_mass += wt * abs(l["score"])
    agreement = js_round((agree_mass / mass) * 100) if mass else 100

    return {"lenses": lenses, "final": final, "agreement": agreement, "contested": agreement < 65}


def _mulberry32_stream(seed: int, n: int) -> np.ndarray:
    """n draws of JS mulberry32 at once. The state is linear (a_k = seed + k*C
    mod 2^32), so the whole stream is a vectorized uint32 expression."""
    C = np.uint32(0x6D2B79F5)
    a = (np.uint32(seed) + C * np.arange(1, n + 1, dtype=np.uint32)).astype(np.uint32)
    t = ((a ^ (a >> np.uint32(15))).astype(np.uint64) * (np.uint32(1) | a).astype(np.uint64)).astype(np.uint32)
    t2 = ((t ^ (t >> np.uint32(7))).astype(np.uint64) * (np.uint32(61) | t).astype(np.uint64)).astype(np.uint32)
    t = (t + t2).astype(np.uint32) ^ t
    return (t ^ (t >> np.uint32(14))).astype(np.float64) / 4294967296.0


def stability(drives: list[dict], fitness: dict, final_score: float, trials: int = 200, options: dict = None):
    """Does the verdict survive weight jitter? A big score that flips is fragile."""
    options = options or {}
    if abs(final_score) < 5:
        return None
    n = len(drives)
    if not n:
        return js_round(1 * 100)
    sign = js_sign(final_score)

    # Model-level perturbation to prevent Central Limit Theorem distortion
    n_lenses = len(LENS_IDS)
    r_lens = _mulberry32_stream(len(drives) * 7919 + js_round(abs(final_score)), trials * n_lenses)
    lens_shock = 0.75 + 0.50 * r_lens.reshape(trials, n_lenses)

    r_drive = _mulberry32_stream(len(drives) * 7919 + js_round(abs(final_score)) + 1013, trials * n)
    drive_micro = 0.92 + 0.16 * r_drive.reshape(trials, n)

    idx = np.array([LENS_IDS.index(d["lens"]) for d in drives])
    w_base = np.array([d["w"] for d in drives], dtype=np.float64)
    w = np.zeros((trials, n), dtype=np.float64)
    for j in range(n):
        w[:, j] = w_base[j] * lens_shock[:, idx[j]] * drive_micro[:, j]

    dirs = np.array([d["dir"] for d in drives], dtype=np.float64)
    onehot = np.zeros((n, len(LENS_IDS)))
    onehot[np.arange(n), idx] = 1.0
    wsum = w @ onehot
    dsum = (w * dirs) @ onehot

    with np.errstate(invalid="ignore", divide="ignore"):
        scores = np.floor(np.where(wsum > 0, dsum / wsum, 0) * 100 + 0.5)

    # Vectorized mass_mult with per-lens saturation ceiling
    caps = np.array([9.0 if lid in ("volume", "flow") else 16.0 for lid in LENS_IDS])
    mass_mult = np.clip(wsum / caps, 0.45, 1.0)

    present = np.array([any(d["lens"] == lid for d in drives) for lid in LENS_IDS])
    wt_base = np.array([BASE[lid] * (js_round(fitness[lid] * 100) / 100) for lid in LENS_IDS]) * present

    # ICT Sequential Reversal override in vectorized weights
    rev_lens_idx = LENS_IDS.index("reversal")
    has_rev = options.get("setupActive") or (present[rev_lens_idx] and fitness.get("reversal", 0) >= 0.70)
    rev_dir = options.get("setupDir") or 0

    wt_trials = wt_base * mass_mult
    if has_rev and rev_dir != 0:
        for s_idx in [LENS_IDS.index("structure"), LENS_IDS.index("fvg")]:
            if present[s_idx]:
                wt_trials[:, s_idx] *= np.where((np.sign(scores[:, s_idx]) != rev_dir) & (np.abs(scores[:, s_idx]) >= 15), 0.35, 1.0)
        if present[rev_lens_idx]:
            wt_trials[:, rev_lens_idx] *= np.where((np.sign(scores[:, rev_lens_idx]) == rev_dir) | (scores[:, rev_lens_idx] == 0), 1.35, 1.0)

    conviction = np.abs(scores) / 100.0
    den_trials = (wt_trials * (0.35 + 0.65 * conviction)).sum(axis=1)
    den_trials = np.where(den_trials == 0, 1e-10, den_trials)

    final = np.clip((scores * wt_trials).sum(axis=1) / den_trials, -100, 100)
    return js_round((np.sign(final) == sign).sum() / trials * 100)
