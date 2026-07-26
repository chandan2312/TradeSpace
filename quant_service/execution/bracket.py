"""The sweep bracket — limit, stop and target from a triggered execution gate.

The JS engine computes the exact swept price, records it, and then enters at
market with no take-profit at all (lib/telemetry/algo.js:276). This module is
the missing half: rest a limit AT the swept level, stop beyond the sweep wick,
target the nearest untapped pool.

**Price frame.** The Dukascopy archive is bid-side, so every price here is a bid
price and the cost of crossing is folded into ONE number, `entry`:

    long  rests at bid `limit`, pays ask   → entry = limit + spread
    short rests at bid `limit`, buys back on the ask at exit → entry = limit - spread

i.e. `entry = limit + direction * spread`. Both sides then measure against raw
bid stops and targets, so `risk = (entry - sl) * dir` and `reward = (tp - entry)
* dir` each already carry exactly one full spread per round trip. A short's
`entry` is therefore a cost-adjusted price, not a quote you could trade on.
"""

from __future__ import annotations

from ..core.liquidity import liquidity_map
from ..core.pairs import minimum_stop_pips, pip_size
from ..core.patterns import avg_range
from ..data.loader import spread_price

DEFAULT_MIN_RR = 1.5
DEFAULT_EXPIRY_BARS = 4


def _reject(reason: str) -> dict:
    return {"ok": False, "reason": reason}


def plan_bracket(frames: dict, dir_: str | int, execution: dict, symbol: str, cfg: dict | None = None) -> dict:
    """`execution` is the dict assess_execution_trigger() returns.

    Returns {ok: True, limit, entry, sl, tp, risk, reward, rr, spread, expiryBars,
    pool, wick} or {ok: False, reason}.
    """
    cfg = cfg or {}
    direction = 1 if dir_ in ("buy", 1) else -1 if dir_ in ("sell", -1) else 0
    if not direction:
        return _reject("invalid direction")
    if not execution or not execution.get("ok") or execution.get("kind") != "sweep_reclaim":
        return _reject("no sweep trigger")

    m15 = frames.get("M15")
    if m15 is None or len(m15) < 50:
        return _reject("M15 data incomplete")

    level = execution["level"]
    limit = float(level["price"])
    spread = spread_price(symbol, cfg)
    avg = avg_range(m15)
    n = len(m15)

    # The sweep wick, not the level. Stopping at the level itself puts the stop
    # inside the range price just demonstrated it will trade through.
    swept_at = execution.get("sweptAt")
    m = liquidity_map(m15, avg)
    src = next((lv for lv in m["sweeps"] if lv["name"] == level["name"] and lv["side"] == level["side"]), None)
    formed_at = src["formedAt"] if src else None
    if not isinstance(swept_at, int) or not isinstance(formed_at, int) or formed_at + 1 > swept_at:
        return _reject("sweep window unresolved")
    lo, hi = formed_at + 1, min(swept_at, n - 1) + 1
    wick = float(m15.low[lo:hi].min()) if direction > 0 else float(m15.high[lo:hi].max())

    buffer_ = 0.25 * avg
    entry = limit + direction * spread
    sl = wick - direction * buffer_

    # Every FX stop needs room to breathe — same floor the JS side applies.
    floor = minimum_stop_pips(symbol, cfg) * pip_size(symbol)
    risk = (entry - sl) * direction
    if risk < floor:
        sl = entry - direction * floor
        risk = floor
    if risk <= 0:
        return _reject("stop is on the wrong side of entry")

    # Nearest untapped pool BEYOND the entry. draws are sorted nearest-first from
    # the last close, which may already sit past the closest one.
    pools = m["draws"]["above" if direction > 0 else "below"]
    pool = next((p for p in pools if (float(p["price"]) - entry) * direction > 0), None)
    if pool is None:
        return _reject("no untapped pool to target")
    tp = float(pool["price"])
    reward = (tp - entry) * direction
    if reward <= 0:
        return _reject("target is not beyond entry after costs")

    rr = reward / risk
    min_rr = float(cfg.get("algoMinRR") or DEFAULT_MIN_RR)
    if rr < min_rr:
        return _reject(f"rr {rr:.2f} below {min_rr:.2f}")

    return {
        "ok": True, "dir": direction, "symbol": symbol,
        "limit": limit, "entry": entry, "sl": sl, "tp": tp,
        "risk": risk, "reward": reward, "rr": rr,
        "spread": spread, "wick": wick, "avg": avg,
        "expiryBars": int(cfg.get("algoOrderExpiryBars") or DEFAULT_EXPIRY_BARS),
        "pool": {"name": pool["name"], "price": tp},
        "level": level, "sweptAt": swept_at, "barTime": int(m15.time[n - 1]),
    }


if __name__ == "__main__":
    from ..config import SPEC_COUNTS
    from ..data.loader import archive_symbols, frames_at, load_archive, step_times
    from .trigger import assess_execution_trigger

    syms = archive_symbols()
    assert syms, "no archive to check against"

    planned, rejects, triggers = [], {}, 0
    for sym in syms[:6]:
        data = load_archive(sym)
        for t in step_times(data, SPEC_COUNTS, every=97):
            f = frames_at(data, t, SPEC_COUNTS)
            if f is None:
                continue
            for d in (1, -1):
                ex = assess_execution_trigger(f, d)
                if not ex.get("ok") or ex.get("kind") != "sweep_reclaim":
                    continue
                triggers += 1
                b = plan_bracket(f, d, ex, sym)
                if b["ok"]:
                    planned.append(b)
                else:
                    key = "rr below minimum" if b["reason"].startswith("rr ") else b["reason"]
                    rejects[key] = rejects.get(key, 0) + 1

    assert triggers >= 20, f"corpus too thin to prove anything: {triggers} triggers"
    assert planned, "no bracket ever planned"
    for b in planned:
        d = b["dir"]
        assert (b["entry"] - b["sl"]) * d > 0, "stop must be on the risk side"
        assert (b["tp"] - b["entry"]) * d > 0, "target must be on the reward side"
        # the stop sits beyond the wick, which itself is beyond the swept level
        assert (b["wick"] - b["sl"]) * d > 0, "stop is not beyond the sweep wick"
        assert (b["limit"] - b["wick"]) * d > 0, "wick did not penetrate the level"
        assert b["rr"] >= DEFAULT_MIN_RR - 1e-12, "sub-minimum RR escaped the gate"
        assert b["risk"] >= minimum_stop_pips(b["symbol"]) * pip_size(b["symbol"]) - 1e-12, "stop floor not enforced"
        if d > 0:
            assert abs(b["entry"] - (b["limit"] + b["spread"])) < 1e-12, "long must pay the spread at entry"
        else:
            assert abs(b["entry"] - (b["limit"] - b["spread"])) < 1e-12, "short must pay the spread at exit"

    assert "no untapped pool to target" in rejects or "rr below minimum" in rejects, \
        f"nothing was ever rejected — the gate is not a gate: {rejects}"
    print(f"bracket ok — {triggers} triggers, {len(planned)} planned, rejects: {rejects}")
