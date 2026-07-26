"""Vectorized pattern primitives. Parity target: lib/patterns/core.js + lib/bias/zones.js.

Two deliberate quirks are reproduced on purpose, because parity means matching
what JS *does*, not what it appears to intend:

  * `avgRange` filters `b.volume !== 0`, but bars carry `v`, never `volume`.
    `undefined !== 0` is true in JS, so the filter passes everything. Same here.
  * `detectGaps`'s zero-volume anomaly branch is dead for the same reason.

Fixing those is a behaviour change and belongs in a separate, deliberate commit.
"""

from __future__ import annotations

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from .bars import Bars

EPS_FLOOR = 1e-10


def avg_range(bars: Bars, n: int = 120) -> float:
    """Trimmed mean candle range — the scale unit every tolerance derives from."""
    hi, lo = bars.high, bars.low
    if len(hi) == 0:
        return EPS_FLOOR
    if len(hi) > n:
        hi, lo = hi[-n:], lo[-n:]
    ranges = np.sort(hi - lo)
    if len(ranges) >= 20:
        cutoff = ranges[int(len(ranges) * 0.95)]
        kept = ranges[ranges <= cutoff]
    else:
        kept = ranges
    if kept.size == 0:
        return EPS_FLOOR
    return max(float(kept.sum() / max(kept.size, 1)), EPS_FLOOR)


def rolling_avg_range(bars: Bars, n: int = 120) -> np.ndarray:
    """avg_range evaluated at EVERY bar index, in one pass.

    out[i] == avg_range(bars[:i+1]) — this is the precompute that turns a replay
    sweep from "re-derive 120 bars" into "read out[i]".
    """
    total = len(bars)
    out = np.empty(total, dtype=np.float64)
    if total == 0:
        return out
    rng = bars.high - bars.low

    # Warm-up region: windows are shorter than n, so handle them individually.
    warm = min(total, n - 1)
    for i in range(warm):
        window = np.sort(rng[: i + 1])
        if len(window) >= 20:
            kept = window[window <= window[int(len(window) * 0.95)]]
        else:
            kept = window
        out[i] = max(float(kept.sum() / max(kept.size, 1)), EPS_FLOOR) if kept.size else EPS_FLOOR

    if total < n:
        return out

    # Steady state: every window is exactly n wide → one sorted matrix.
    windows = np.sort(sliding_window_view(rng, n), axis=1)
    cutoff = windows[:, int(n * 0.95)][:, None]
    mask = windows <= cutoff
    sums = np.where(mask, windows, 0.0).sum(axis=1)
    counts = np.maximum(mask.sum(axis=1), 1)
    out[n - 1 :] = np.maximum(sums / counts, EPS_FLOOR)
    return out


def _pivot_arrays(bars: Bars, left: int, right: int):
    """(idx, price) arrays of strict swing extremes, computed over the whole array."""
    n = len(bars)
    width = left + right + 1
    if n < width:
        empty = np.empty(0, np.int64), np.empty(0, np.float64)
        return {"highs": empty, "lows": empty}

    hi_w = sliding_window_view(bars.high, width)
    lo_w = sliding_window_view(bars.low, width)
    centers = np.arange(left, n - right)
    hi_c = bars.high[left : n - right]
    lo_c = bars.low[left : n - right]

    # Strict max ⇔ exactly one element (the centre itself) is >= the centre.
    is_high = (hi_w >= hi_c[:, None]).sum(axis=1) == 1
    is_low = (lo_w <= lo_c[:, None]).sum(axis=1) == 1
    return {
        "highs": (centers[is_high], hi_c[is_high]),
        "lows": (centers[is_low], lo_c[is_low]),
    }


def find_pivots(bars: Bars, left: int = 4, right: int = 4):
    """Strict swing extremes: bar i beats every other bar in [i-left, i+right].

    A window's pivots are exactly the root's pivots whose full [i-left, i+right]
    span fits inside the window — the window sees identical bars there. So the
    root computes once and every slice is a searchsorted filter, which is what
    makes replay's 50k overlapping sweeps cheap.
    """
    root, off, n = bars._root, bars._off, len(bars)
    if n < left + right + 1:
        return {"highs": [], "lows": []}

    key = (left, right)
    arrays = root._cache.get(key)
    if arrays is None:
        arrays = root._cache[key] = _pivot_arrays(root, left, right)

    lo_bound, hi_bound = off + left, off + n - right  # root-space [lo, hi)
    out = {}
    for side in ("highs", "lows"):
        idx, price = arrays[side]
        a = int(np.searchsorted(idx, lo_bound, "left"))
        b = int(np.searchsorted(idx, hi_bound, "left"))
        out[side] = [{"i": int(i) - off, "price": float(p)}
                     for i, p in zip(idx[a:b], price[a:b])]
    return out


def pivot_masks(bars: Bars, left: int = 4, right: int = 4):
    """Boolean masks over all bars — the array-native form of find_pivots."""
    n = len(bars)
    width = left + right + 1
    hi_mask = np.zeros(n, dtype=bool)
    lo_mask = np.zeros(n, dtype=bool)
    if n < width:
        return hi_mask, lo_mask
    hi_w = sliding_window_view(bars.high, width)
    lo_w = sliding_window_view(bars.low, width)
    hi_c = bars.high[left : n - right]
    lo_c = bars.low[left : n - right]
    hi_mask[left : n - right] = (hi_w >= hi_c[:, None]).sum(axis=1) == 1
    lo_mask[left : n - right] = (lo_w <= lo_c[:, None]).sum(axis=1) == 1
    return hi_mask, lo_mask


def detect_gaps(bars: Bars, avg: float, threshold_mult: float = 4.0) -> list[dict]:
    """Weekend/spread price gaps. Vectorized over the whole series."""
    n = len(bars)
    if n < 2:
        return []
    gap = np.abs(bars.open[1:] - bars.close[:-1])
    spread = bars.high[1:] - bars.low[1:]
    hit = np.flatnonzero(gap > avg * threshold_mult) + 1
    return [
        {"i": int(i), "age": int(n - 1 - i), "gap": float(max(gap[i - 1], spread[i - 1]))}
        for i in hit
    ]


def fvg_zones(bars: Bars, avg: float, lookback: int = 60) -> list[dict]:
    """3-candle imbalances with lifecycle: open -> inverted (iFVG) -> reclaimed(dead).

    A wick through the far side fills (kills) an open gap; a CLOSE through
    inverts it; a close back beyond the near side after inversion reclaims it.
    """
    n = len(bars)
    start = max(2, n - lookback)
    if n < 3 or start >= n:
        return []
    min_gap = 0.35 * avg
    hi, lo, close = bars.high, bars.low, bars.close

    idx = np.arange(start, n)
    bull = lo[idx] - hi[idx - 2] >= min_gap
    bear = lo[idx - 2] - hi[idx] >= min_gap

    out = []
    for k, i in enumerate(idx):
        if bull[k]:
            direction, top, bottom = 1, float(lo[i]), float(hi[i - 2])
        elif bear[k]:
            direction, top, bottom = -1, float(lo[i - 2]), float(hi[i])
        else:
            continue

        state, inverted_at, dead = "open", None, False
        for j in range(i + 1, n):
            c = close[j]
            if state == "open":
                if (c < bottom) if direction == 1 else (c > top):
                    state, inverted_at = "inverted", j
                elif (lo[j] <= bottom) if direction == 1 else (hi[j] >= top):
                    dead = True
                    break
            elif (c > top) if direction == 1 else (c < bottom):
                dead = True
                break
        if not dead:
            out.append({
                "dir": direction, "top": top, "bottom": bottom, "i": int(i),
                "age": int(n - 1 - i), "state": state,
                "invertedAt": None if inverted_at is None else int(inverted_at),
            })
    return out


def _last_opposite(bars: Bars, break_i: int, direction: int):
    """Nearest opposite-colour candle before the displacement — the block itself."""
    for k in range(break_i - 1, max(-1, break_i - 11), -1):
        if (bars.close[k] < bars.open[k]) if direction == 1 else (bars.close[k] > bars.open[k]):
            return {"high": float(bars.high[k]), "low": float(bars.low[k]), "i": k}
    return None


def detect_order_blocks(bars: Bars, avg: float, lookback: int = 120) -> list[dict]:
    """Unmitigated origins of displacement legs that broke a confirmed swing."""
    n = len(bars)
    start = max(0, n - lookback)
    right = 3
    pivots = find_pivots(bars, 3, 3)
    highs, lows = pivots["highs"], pivots["lows"]

    last_h = last_l = None
    h_idx = l_idx = 0
    raw = []
    for i in range(n):
        # a pivot only exists once its right-hand window has printed
        while h_idx < len(highs) and highs[h_idx]["i"] + right <= i:
            last_h = highs[h_idx]
            h_idx += 1
        while l_idx < len(lows) and lows[l_idx]["i"] + right <= i:
            last_l = lows[l_idx]
            l_idx += 1
        if i < start:
            continue
        c, o = bars.close[i], bars.open[i]
        if last_h is not None and c > last_h["price"] and c - o >= 1.2 * avg:
            ob = _last_opposite(bars, i, 1)
            if ob:
                raw.append({"dir": 1, "top": ob["high"], "bottom": ob["low"], "i": ob["i"], "brokeAt": i})
            last_h = None
        elif last_l is not None and c < last_l["price"] and o - c >= 1.2 * avg:
            ob = _last_opposite(bars, i, -1)
            if ob:
                raw.append({"dir": -1, "top": ob["high"], "bottom": ob["low"], "i": ob["i"], "brokeAt": i})
            last_l = None

    out = []
    for z in raw:
        tapped = dead = False
        for j in range(z["brokeAt"] + 1, n):
            if (bars.close[j] < z["bottom"]) if z["dir"] == 1 else (bars.close[j] > z["top"]):
                dead = True
                break
            if (bars.low[j] <= z["top"]) if z["dir"] == 1 else (bars.high[j] >= z["bottom"]):
                tapped = True
        if not dead:
            out.append({
                "dir": z["dir"], "top": z["top"], "bottom": z["bottom"], "i": int(z["i"]),
                "age": int(n - 1 - z["brokeAt"]), "tapped": tapped,
            })
    return out[-8:]
