"""Economic calendar dampener. Parity target: lib/bias/news.js (pure parts only).

The feed fetch lives on the JS side (Next.js caches it); Python receives the
already-normalized event list.
"""

from __future__ import annotations

import re
import time


def news_risk(events, currencies, soon_ms=2 * 3600e3, past_ms=3600e3, now_ms=None):
    now = now_ms if now_ms is not None else time.time() * 1000
    out = []
    for e in events:
        if e["currency"] not in currencies:
            continue
        dt = e["at"] - now
        if 0 < dt <= soon_ms:
            out.append({**e, "when": "upcoming", "inMin": round(dt / 60e3)})
        elif dt <= 0 and -dt <= past_ms:
            out.append({**e, "when": "released", "agoMin": round(-dt / 60e3)})
    out.sort(key=lambda e: e["at"])
    return out


def symbol_currencies(symbol: str, category: str) -> list[str]:
    s = re.sub(r"m$", "", re.sub(r"[._-].*$", "", symbol.upper()))
    if category == "fx" and len(s) == 6:
        return [s[:3], s[3:]]
    if category == "indices":
        if re.search(r"GER|DAX|DE40|STOXX", s):
            return ["EUR"]
        if re.search(r"UK100|FTSE", s):
            return ["GBP"]
        if re.search(r"JP225|NIK", s):
            return ["JPY"]
        if re.search(r"AUS200", s):
            return ["AUD"]
    return ["USD"]
