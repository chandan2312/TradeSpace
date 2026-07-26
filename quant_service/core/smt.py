"""SMT divergence + risk beta. Parity target: lib/bias/context.js (pure parts).

getMarketContext() stays in JS — it fetches proxy frames over the network.
Python takes the resulting {score, note} as an extra.
"""

from __future__ import annotations

import re

from .bars import Bars
from .patterns import find_pivots

SMT_PAIRS = {
    "EURUSD": ["GBPUSD"],
    "GBPUSD": ["EURUSD"],
    "AUDUSD": ["NZDUSD"],
    "NZDUSD": ["AUDUSD"],
    "USDJPY": ["USDCHF"],
    "USDCHF": ["USDJPY"],
    "US30": ["NAS100", "US500"],
    "NAS100": ["US30", "US500"],
    "US500": ["US30", "NAS100"],
    "XAUUSD": ["XAGUSD"],
    "XAGUSD": ["XAUUSD"],
    "BTCUSD": ["ETHUSD"],
    "ETHUSD": ["BTCUSD"],
}


def risk_beta(symbol: str, category: str) -> float:
    s = symbol.upper()
    if category in ("indices", "crypto"):
        return 1
    if category == "metals" and re.match(r"^XAU|GOLD", s):
        return -1
    if category == "fx":
        base = re.sub(r"[._-].*$", "", s)
        if re.search(r"JPYm?$", base):
            return 1
        if re.match(r"^(AUD|NZD)", s):
            return 0.5
        if "CHF" in s and not s.startswith("CHF"):
            return 0.5
    return 0


def _last_two_swings(bars: Bars):
    piv = find_pivots(bars, 3, 3)
    if len(piv["highs"]) < 2 or len(piv["lows"]) < 2:
        return None
    h1, h2 = ({"price": p["price"], "time": int(bars.time[p["i"]])} for p in piv["highs"][-2:])
    l1, l2 = ({"price": p["price"], "time": int(bars.time[p["i"]])} for p in piv["lows"][-2:])
    return {"h1": h1, "h2": h2, "l1": l1, "l2": l2}


def smt_divergence(bars: Bars, partner_bars: Bars, partner_name: str):
    if bars is None or partner_bars is None:
        return None
    a, b = _last_two_swings(bars), _last_two_swings(partner_bars)
    if not a or not b:
        return None

    def aligned(x, y):
        return abs(x - y) <= 12 * 900

    if aligned(a["h2"]["time"], b["h2"]["time"]):
        if a["h2"]["price"] > a["h1"]["price"] and not b["h2"]["price"] > b["h1"]["price"]:
            return {"dir": -1, "note": f"HH unconfirmed by {partner_name}"}
    if aligned(a["l2"]["time"], b["l2"]["time"]):
        if a["l2"]["price"] < a["l1"]["price"] and not b["l2"]["price"] < b["l1"]["price"]:
            return {"dir": 1, "note": f"LL unconfirmed by {partner_name}"}
    return None
