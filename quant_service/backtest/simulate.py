"""Resolve planned brackets against the bars that followed. No lookahead.

`plan_bracket` says where the order rests; this says what happened to it. Every
rule here is chosen to be *pessimistic*, because the cheap version of this
module is a machine for manufacturing edge that does not exist:

- **Strict penetration to fill.** A limit resting at the exact extreme of a
  liquidity pool is at the back of the queue. A touch (`low == limit`) is not a
  fill; `low < limit` is.
- **Never the trigger bar.** The sweep bar already traded through the level. Let
  it fill and every trade is free.
- **SL wins same-bar ties.** If a bar spans both stop and target, take the stop.
- **The fill bar cannot win.** On the bar that fills, only the stop is live —
  a single OHLC bar cannot prove the fill preceded the target touch.
- **Unfilled is not a trade.** It expires and is counted in the fill rate, never
  in the win rate. This is the whole reason the fill rate is the headline number.

Prices are bid-side (the archive's frame); `plan["entry"]` already carries the
full round-trip spread, so R is computed straight off raw bid levels.
"""

from __future__ import annotations

import numpy as np

DEFAULT_MAX_HOLD_BARS = 96  # 24h of M15


def _first(mask: np.ndarray) -> int:
    """Index of the first True, or -1. argmax is O(n) but branch-free."""
    return int(mask.argmax()) if mask.any() else -1


def simulate_bracket(m15, trigger_idx: int, plan: dict, cfg: dict | None = None) -> dict:
    """One planned order against `m15` (the FULL series, not a window).

    `trigger_idx` is the index of the trigger bar within that series. Scanning
    starts at trigger_idx + 1. Returns a trade record with `outcome` in
    {filled_tp, filled_sl, filled_timeout, expired, truncated}.
    """
    cfg = cfg or {}
    d = plan["dir"]
    limit, sl, tp = plan["limit"], plan["sl"], plan["tp"]
    max_hold = int(cfg.get("algoMaxHoldBars") or DEFAULT_MAX_HOLD_BARS)
    expiry = int(plan["expiryBars"])
    n = len(m15)

    base = {"symbol": plan["symbol"], "dir": d, "rr": plan["rr"], "barTime": plan["barTime"],
            "entry": plan["entry"], "sl": sl, "tp": tp, "risk": plan["risk"]}

    s = trigger_idx + 1
    if s >= n:
        return {**base, "outcome": "truncated", "filled": False, "r": None}

    # ---- fill window
    e = min(s + expiry, n)
    lo, hi = m15.low[s:e], m15.high[s:e]
    fill_rel = _first(lo < limit) if d > 0 else _first(hi > limit)
    if fill_rel < 0:
        if e < s + expiry:
            return {**base, "outcome": "truncated", "filled": False, "r": None}
        return {**base, "outcome": "expired", "filled": False, "r": None, "barsToFill": None}
    fill_i = s + fill_rel

    # ---- the fill bar: stop only. A target touch here is unprovable.
    stopped_on_fill = m15.low[fill_i] <= sl if d > 0 else m15.high[fill_i] >= sl
    if stopped_on_fill:
        return {**base, "outcome": "filled_sl", "filled": True, "r": -1.0,
                "barsToFill": fill_rel, "barsHeld": 0, "exit": sl}

    # ---- hold window
    hs, he = fill_i + 1, min(fill_i + 1 + max_hold, n)
    if hs >= he:
        return {**base, "outcome": "truncated", "filled": True, "r": None, "barsToFill": fill_rel}
    lo, hi = m15.low[hs:he], m15.high[hs:he]
    hit_sl = (lo <= sl) if d > 0 else (hi >= sl)
    hit_tp = (hi >= tp) if d > 0 else (lo <= tp)
    i_sl, i_tp = _first(hit_sl), _first(hit_tp)

    if i_sl >= 0 and (i_tp < 0 or i_sl <= i_tp):  # ties go to the stop
        return {**base, "outcome": "filled_sl", "filled": True, "r": -1.0,
                "barsToFill": fill_rel, "barsHeld": i_sl + 1, "exit": sl}
    if i_tp >= 0:
        return {**base, "outcome": "filled_tp", "filled": True, "r": float(plan["rr"]),
                "barsToFill": fill_rel, "barsHeld": i_tp + 1, "exit": tp}

    if he - hs < max_hold:
        return {**base, "outcome": "truncated", "filled": True, "r": None, "barsToFill": fill_rel}
    px = float(m15.close[he - 1])
    return {**base, "outcome": "filled_timeout", "filled": True,
            "r": (px - plan["entry"]) * d / plan["risk"],
            "barsToFill": fill_rel, "barsHeld": max_hold, "exit": px}


def summarize(trades: list[dict]) -> dict:
    """Fill rate first. A 70% win rate on a 4%-fill strategy is not a strategy."""
    decided = [t for t in trades if t["outcome"] != "truncated"]
    filled = [t for t in decided if t["filled"]]
    rs = np.array([t["r"] for t in filled], dtype=np.float64)
    if rs.size == 0:
        return {"signals": len(decided), "filled": 0, "fillRate": 0.0, "truncated": len(trades) - len(decided)}

    wins, losses = rs[rs > 0], rs[rs < 0]
    gross_loss = float(-losses.sum())
    equity = np.cumsum(rs)
    return {
        "signals": len(decided),
        "filled": len(filled),
        "fillRate": len(filled) / len(decided),
        "truncated": len(trades) - len(decided),
        "expectancy": float(rs.mean()),
        "profitFactor": float(wins.sum() / gross_loss) if gross_loss > 0 else float("inf"),
        "winRate": float((rs > 0).mean()),
        "totalR": float(rs.sum()),
        "maxDrawdownR": float((np.maximum.accumulate(equity) - equity).max()),
        "avgWinR": float(wins.mean()) if wins.size else 0.0,
        "avgLossR": float(losses.mean()) if losses.size else 0.0,
        "byOutcome": {o: sum(1 for t in decided if t["outcome"] == o)
                      for o in ("filled_tp", "filled_sl", "filled_timeout", "expired")},
    }


if __name__ == "__main__":
    from ..core.bars import Bars

    def bars(rows):  # (low, high) per bar, close = mid
        return Bars(
            [i * 900 for i in range(len(rows))],
            [(l + h) / 2 for l, h in rows], [h for _, h in rows],
            [l for l, _ in rows], [(l + h) / 2 for l, h in rows],
        )

    P = {"dir": 1, "symbol": "EURUSD", "limit": 1.10, "entry": 1.1001, "sl": 1.09, "tp": 1.12,
         "risk": 0.0101, "rr": 1.98, "expiryBars": 3, "barTime": 0}
    CFG = {"algoMaxHoldBars": 4}  # short hold so the checks stay hand-countable

    # trigger bar (idx 0) blows through everything — must be ignored entirely
    assert simulate_bracket(bars([(1.08, 1.13)] + [(1.101, 1.105)] * 6), 0, P, CFG)["outcome"] == "expired", \
        "trigger bar filled the order"

    # a touch is not a fill: low == limit exactly
    assert simulate_bracket(bars([(1.105, 1.11)] + [(1.100, 1.105)] * 6), 0, P, CFG)["outcome"] == "expired", \
        "touch at the limit counted as a fill"

    # strict penetration is
    t = simulate_bracket(bars([(1.105, 1.11), (1.0999, 1.105), (1.105, 1.125)] + [(1.11, 1.115)] * 4), 0, P, CFG)
    assert t["outcome"] == "filled_tp" and t["barsToFill"] == 0 and t["r"] == P["rr"], t

    # the fill bar cannot win — same bar spans limit and tp
    t = simulate_bracket(bars([(1.105, 1.11), (1.0999, 1.125)] + [(1.105, 1.11)] * 6), 0, P, CFG)
    assert t["outcome"] == "filled_timeout", t

    # ...but it can lose: same bar spans limit and sl
    t = simulate_bracket(bars([(1.105, 1.11), (1.089, 1.105)] + [(1.105, 1.11)] * 6), 0, P, CFG)
    assert t["outcome"] == "filled_sl" and t["r"] == -1.0, t

    # SL wins a same-bar tie after the fill
    t = simulate_bracket(bars([(1.105, 1.11), (1.0999, 1.105), (1.089, 1.125)] + [(1.11, 1.115)] * 4), 0, P, CFG)
    assert t["outcome"] == "filled_sl" and t["r"] == -1.0, t

    # expiry counts bars, and the bar AFTER the window does not fill
    assert simulate_bracket(bars([(1.105, 1.11)] * 4 + [(1.0999, 1.105)] * 4), 0, P, CFG)["outcome"] == "expired"

    # not enough bars left to decide → truncated, never a free win
    assert simulate_bracket(bars([(1.105, 1.11), (1.0999, 1.105)]), 0, P, CFG)["outcome"] == "truncated"

    # short side mirrors: strict penetration UP, entry already net of spread
    S = {**P, "dir": -1, "limit": 1.10, "entry": 1.0999, "sl": 1.11, "tp": 1.08, "risk": 0.0101, "rr": 1.98}
    t = simulate_bracket(bars([(1.09, 1.095), (1.095, 1.1001), (1.075, 1.095)] + [(1.085, 1.09)] * 4), 0, S, CFG)
    assert t["outcome"] == "filled_tp", t
    assert simulate_bracket(bars([(1.09, 1.095), (1.095, 1.100)] + [(1.085, 1.09)] * 6), 0, S, CFG)["outcome"] == "expired", \
        "short touch at the limit counted as a fill"

    s = summarize([
        {"outcome": "filled_tp", "filled": True, "r": 2.0},
        {"outcome": "filled_sl", "filled": True, "r": -1.0},
        {"outcome": "expired", "filled": False, "r": None},
        {"outcome": "truncated", "filled": False, "r": None},
    ])
    assert s["signals"] == 3 and s["filled"] == 2 and abs(s["fillRate"] - 2 / 3) < 1e-12
    assert s["profitFactor"] == 2.0 and abs(s["expectancy"] - 0.5) < 1e-12
    assert s["maxDrawdownR"] == 1.0, s
    print("simulate ok")
