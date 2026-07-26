"""Volume intelligence (MT5 tick-volume proxy). Parity target: lib/bias/volume.js.

All thresholds are RELATIVE ratios so the proxy nature doesn't skew levels.
Everything returns None when volume data is absent — the engine then behaves
exactly as it did before volume existed (fail-soft).
"""

from __future__ import annotations

import numpy as np

from .bars import Bars
from .structure import analyze_structure

DAY = 86400


def volume_profile(bars: Bars, avg: float):
    """Price-binned histogram → POC, VAH/VAL (70% value area), HVNs, LVNs."""
    n = len(bars)
    if n == 0 or not (avg > 0):
        return None
    keep = np.flatnonzero(bars.v > 0)
    if len(keep) < 20 or len(keep) < n * 0.5:
        return None

    hi_k, lo_k, v_k = bars.high[keep], bars.low[keep], bars.v[keep]
    lo, hi = float(lo_k.min()), float(hi_k.max())
    if hi <= lo:
        return None

    n_bins = int(round(min(60, max(20, (hi - lo) / (0.25 * avg)))))
    bin_size = (hi - lo) / n_bins
    k0 = np.clip(np.floor((lo_k - lo) / bin_size).astype(np.int64), 0, n_bins - 1)
    k1 = np.clip(np.floor((hi_k - lo) / bin_size).astype(np.int64), 0, n_bins - 1)
    share = v_k / (k1 - k0 + 1)

    # each bar spreads its volume over [k0, k1] — do it as a difference array
    diff = np.zeros(n_bins + 1)
    np.add.at(diff, k0, share)
    np.add.at(diff, k1 + 1, -share)
    hist = np.cumsum(diff[:-1])

    total = float(hist.sum())
    if not total:
        return None

    def price(k):
        return lo + (k + 0.5) * bin_size

    poc_idx = int(np.argmax(hist))
    va_lo = va_hi = poc_idx
    acc = hist[poc_idx]
    while acc < 0.7 * total and (va_lo > 0 or va_hi < n_bins - 1):
        dn = hist[va_lo - 1] if va_lo > 0 else -1
        up = hist[va_hi + 1] if va_hi < n_bins - 1 else -1
        if up >= dn:
            va_hi += 1
            acc += hist[va_hi]
        else:
            va_lo -= 1
            acc += hist[va_lo]

    padded = np.concatenate(([hist[0]], hist, [hist[-1]]))
    counts = np.full(n_bins, 3.0)
    counts[0] = counts[-1] = 2.0
    sums = padded[:-2] + padded[1:-1] + padded[2:]
    sums[0] = hist[0] + hist[1]
    sums[-1] = hist[-2] + hist[-1]
    sm = sums / counts

    mean = total / n_bins
    hvns, lvns = [], []
    for k in range(1, n_bins - 1):
        if sm[k] >= sm[k - 1] and sm[k] >= sm[k + 1] and sm[k] >= 1.3 * mean:
            hvns.append({"price": price(k), "v": float(sm[k])})
        elif sm[k] <= sm[k - 1] and sm[k] <= sm[k + 1] and sm[k] <= 0.6 * mean:
            lvns.append({"price": price(k), "v": float(sm[k])})
    hvns.sort(key=lambda x: -x["v"])
    lvns.sort(key=lambda x: x["v"])

    return {
        "poc": price(poc_idx),
        "vah": lo + (va_hi + 1) * bin_size,
        "val": lo + va_lo * bin_size,
        "hvns": hvns[:3],
        "lvns": lvns[:3],
        "total": total,
    }


def profiles(bars: Bars, avg: float) -> dict:
    """Profiles on smart ranges: prior completed day / today / current dealing leg."""
    out = {"prior": None, "today": None, "dealing": None}
    n = len(bars)
    if n == 0:
        return out

    day = bars.time // DAY
    last_day = int(day[n - 1])
    today = np.flatnonzero(day == last_day)
    before = np.flatnonzero(day < last_day)
    prior = before[day[before] == int(day[before[-1]])] if len(before) else np.array([], dtype=np.int64)

    # dealing range: since the last displaced MSS (the active structural leg)
    start = max(0, n - 120)
    st = analyze_structure(bars, avg)
    for ev in reversed(st["events"]):
        if ev["type"] == "MSS" and ev["displaced"]:
            start = max(0, ev["i"] - 10)
            break

    if len(prior) >= 20:
        out["prior"] = volume_profile(bars.slice(int(prior[0]), int(prior[-1]) + 1), avg)
    if len(today) >= 20:
        out["today"] = volume_profile(bars.slice(int(today[0]), int(today[-1]) + 1), avg)
    out["dealing"] = volume_profile(bars.slice(start, n), avg)
    return out


def vol_ratio(bars: Bars, i: int, lookback: int = 60):
    """Bar i's volume vs the preceding mean (>=1.8 climax, <=0.7 thin)."""
    if i is None or i < 0 or i >= len(bars) or not (bars.v[i] > 0):
        return None
    window = bars.v[max(0, i - lookback) : i]
    pos = window[window > 0]
    if len(pos) < 10:
        return None
    return round(float(bars.v[i] / pos.mean()) * 10) / 10


def rel_participation(bars: Bars):
    """Fast/slow volume SMA — is the market participating right now?"""
    n = len(bars)
    if n == 0:
        return None

    def sma(m, minimum):
        window = bars.v[max(0, n - m) :]
        pos = window[window > 0]
        return float(pos.mean()) if len(pos) >= minimum else None

    fast, slow = sma(5, 3), sma(60, 30)
    if not fast or not slow:
        return None
    return round((fast / slow) * 100) / 100
