"""
TradeSpace Institutional MT5 Bridge Server
===========================================
High-performance HTTP REST bridge designed to run on the Windows VPS alongside MetaTrader 5.
Directly referenced from the battle-tested Alpha project architecture with full order execution,
active position management (SL/TP modify, partial/full close), position tracking, and historical deals.

Setup (Windows VPS):
    pip install MetaTrader5

Run:
    # Option 1: Auto-detects token from .env in Tradespace folder:
    python mt5_server.py

    # Option 2: Pass token directly via CLI flag:
    python mt5_server.py --token chandan-yashwant-chaudhari-2312

    # Option 3: Set environment variable in PowerShell:
    $env:MT5_TOKEN="chandan-yashwant-chaudhari-2312"
    python mt5_server.py --host 0.0.0.0 --port 8765

In TradeSpace .env:
    NEXUS_MT5_REMOTE_URL=http://<windows-vps-ip>:8765
    NEXUS_MT5_REMOTE_TOKEN=chandan-yashwant-chaudhari-2312

Endpoints:
    GET/POST /health
    POST     /tick             { "sym": "EURUSD" }
    POST     /ticks            { "symbols": ["EURUSD", "XAUUSD"] }
    POST     /rates            { "sym": "EURUSD", "timeframe": "M5", "count": 500 }
    POST     /bulk-rates       { "symbols": ["NAS100", "US30"], "timeframe": "M15", "count": 100 }
    POST     /ping-timeframes  { "sym": "EURUSD", "timeframes": ["M1","M5","M15","H1","H4","D1"] }
    GET/POST /symbols          { "query": "EUR", "visible_only": true }
    GET/POST /symbol           { "sym": "EURUSD" }
    POST     /order            { "symbol": "EURUSD", "action": "buy", "volume": 0.1, "sl": 1.08, "tp": 1.10 }
    POST     /modify           { "ticket": 123456, "sl": 1.085, "tp": 1.10 }
    POST     /close            { "ticket": 123456, "volume": 0.05 }
    GET/POST /positions        { "sym": "EURUSD" }
    GET/POST /history          { "days": 7, "sym": "EURUSD" }
    GET/POST /account
"""

from __future__ import annotations

import argparse
import json
import os
import time
import secrets
import threading
import math
import sqlite3
import hashlib
try:
    from zoneinfo import ZoneInfo
except Exception:
    try:
        from backports.zoneinfo import ZoneInfo
    except Exception:
        ZoneInfo = None

from urllib.parse import urlparse, parse_qsl
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = None

def _load_env_file():
    """Auto-load variables from .env in cwd or script directory if present."""
    search_dirs = [os.getcwd(), os.path.dirname(os.path.abspath(__file__))]
    for d in search_dirs:
        env_file = os.path.join(d, ".env")
        if os.path.isfile(env_file):
            try:
                with open(env_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        k, v = line.split("=", 1)
                        k, v = k.strip(), v.strip().strip("'\"")
                        if k and k not in os.environ:
                            os.environ[k] = v
                break
            except Exception:
                pass

_load_env_file()

TOKEN = os.getenv("MT5_TOKEN") or os.getenv("NEXUS_MT5_REMOTE_TOKEN") or ""
LOCK = threading.RLock()

# A write is journaled before order_send. After a crash/timeout its request id
# remains unresolved and is never replayed; orders/deals reconcile the outcome.
def journal_connection():
    path = os.getenv("MT5_REQUEST_JOURNAL") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "mt5_requests.sqlite3")
    conn = sqlite3.connect(path, timeout=30.0)
    conn.execute("CREATE TABLE IF NOT EXISTS requests (request_id TEXT PRIMARY KEY, digest TEXT NOT NULL, state TEXT NOT NULL, response TEXT, created REAL NOT NULL)")
    return conn


def durable_write(handler, payload):
    request_id = str(payload.get("request_id") or "")
    if not request_id:
        return handler(payload)  # Existing market bridge clients retain compatibility.
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    with journal_connection() as conn:
        row = conn.execute("SELECT digest,state,response FROM requests WHERE request_id=?", (request_id,)).fetchone()
        if row:
            if row[0] != digest:
                return {"ok": False, "status": "request-conflict", "message": "request id reused with different payload"}
            return json.loads(row[2]) if row[2] else {"ok": False, "ambiguous": True, "status": "reconciliation-required", "request_id": request_id}
        conn.execute("INSERT INTO requests VALUES (?,?,?,?,?)", (request_id, digest, "submitted", None, datetime.now(timezone.utc).timestamp()))
    try:
        expected_account = payload.get("account_login")
        if expected_account is not None:
            ok, msg = ensure_mt5()
            account = mt5.account_info() if ok else None
            result = {"ok": False, "status": "account-mismatch", "message": "Broker account changed or unavailable"} if not account or str(account.login) != str(expected_account) else handler(payload)
        else:
            result = handler(payload)
    except Exception as exc:
        result = {"ok": False, "ambiguous": True, "status": "reconciliation-required", "message": str(exc)}
    result["request_id"] = request_id
    with journal_connection() as conn:
        conn.execute("UPDATE requests SET state=?,response=? WHERE request_id=?", ("finished", json.dumps(result), request_id))
    return result


def valid_volume(volume, info, remaining=None):
    step = float(getattr(info, "volume_step", 0))
    minimum = float(getattr(info, "volume_min", 0))
    maximum = float(getattr(info, "volume_max", 0))
    if not math.isfinite(volume) or not step > 0 or not minimum > 0 or volume < minimum - 1e-9 or volume > maximum + 1e-9:
        return False
    if abs(volume / step - round(volume / step)) > 1e-7:
        return False
    if remaining is not None:
        rest = remaining - volume
        if rest < -1e-9 or (rest > 1e-9 and (rest < minimum - 1e-9 or abs(rest / step - round(rest / step)) > 1e-7)):
            return False
    return True


def send_result(result, success_codes, failure_status):
    if result is None:
        return {"ok": False, "ambiguous": True, "status": "reconciliation-required", "message": "order_send returned no receipt"}
    if result.retcode not in success_codes:
        ambiguous = result.retcode in [getattr(mt5, "TRADE_RETCODE_TIMEOUT", 10012), getattr(mt5, "TRADE_RETCODE_CONNECTION", 10031)]
        return {"ok": False, "ambiguous": ambiguous, "status": failure_status, "retcode": result.retcode, "message": result.comment}
    return None

# Institutional broker symbol aliases (handles broker naming differences across prop firms & brokers)
SYMBOL_ALIASES = {
    "DJ30":    ("DJ30", "DJI30", "US30", "US30.cash", "US30m", "DJI", "WallStreet30"),
    "US30":    ("DJ30", "DJI30", "US30", "US30.cash", "US30m", "DJI", "WallStreet30"),
    "NAS100":  ("NAS100", "NDX100", "US100", "USTEC", "USTEC.cash", "NAS100.cash", "NDX"),
    "US100":   ("NAS100", "NDX100", "US100", "USTEC", "USTEC.cash", "NAS100.cash", "NDX"),
    "SP500":   ("SP500", "SPX500", "US500", "SP500.cash", "SPX"),
    "SPX500":  ("SP500", "SPX500", "US500", "SP500.cash", "SPX"),
    "US500":   ("SP500", "SPX500", "US500", "SP500.cash", "SPX"),
    "GER40":   ("GER40", "DAX40", "DE40", "GER30", "DAX30", "GER40.cash", "DE30"),
    "JP225":   ("JP225", "NIKKEI", "JP225.cash", "NI225", "N225"),
    "UK100":   ("UK100", "FTSE100", "UK100.cash", "FTSE"),
    "AU200":   ("AU200", "AUS200", "AU200.cash", "ASX200"),
    "FR40":    ("FR40", "FRA40", "FR40.cash", "CAC40"),
    "EURUSD":  ("EURUSD", "EURUSD.i", "EURUSD.I", "EURUSD.", "EURUSDm", "EURUSD.pro", "EURUSD.raw"),
    "GBPUSD":  ("GBPUSD", "GBPUSD.i", "GBPUSD.I", "GBPUSD.", "GBPUSDm", "GBPUSD.pro", "GBPUSD.raw"),
    "USDJPY":  ("USDJPY", "USDJPY.i", "USDJPY.I", "USDJPY.", "USDJPYm", "USDJPY.pro", "USDJPY.raw"),
    "USDCHF":  ("USDCHF", "USDCHF.i", "USDCHF.I", "USDCHF.", "USDCHFm", "USDCHF.pro", "USDCHF.raw"),
    "AUDUSD":  ("AUDUSD", "AUDUSD.i", "AUDUSD.I", "AUDUSD.", "AUDUSDm", "AUDUSD.pro", "AUDUSD.raw"),
    "USDCAD":  ("USDCAD", "USDCAD.i", "USDCAD.I", "USDCAD.", "USDCADm", "USDCAD.pro", "USDCAD.raw"),
    "NZDUSD":  ("NZDUSD", "NZDUSD.i", "NZDUSD.I", "NZDUSD.", "NZDUSDm", "NZDUSD.pro", "NZDUSD.raw"),
    "EURJPY":  ("EURJPY", "EURJPY.i", "EURJPY.I", "EURJPY.", "EURJPYm", "EURJPY.pro"),
    "GBPJPY":  ("GBPJPY", "GBPJPY.i", "GBPJPY.I", "GBPJPY.", "GBPJPYm", "GBPJPY.pro"),
    "XAUUSD":  ("XAUUSD", "XAUUSD.", "XAUUSDm", "GOLD", "XAUUSD.i"),
    "XAGUSD":  ("XAGUSD", "XAGUSD.", "XAGUSDm", "SILVER", "XAGUSD.i"),
    "BTCUSD":  ("BTCUSD", "BTCUSD.", "BTCUSDm", "BITCOIN", "BTCUSD.i"),
    "ETHUSD":  ("ETHUSD", "ETHUSD.", "ETHUSDm", "ETHEREUM", "ETHUSD.i"),
    "SOLUSD":  ("SOLUSD", "SOLUSD.", "SOLUSDm", "SOLUSD.i"),
    "XRPUSD":  ("XRPUSD", "XRPUSD.", "XRPUSDm", "XRPUSD.i"),
}

TF_MAP = {
    "M1":  getattr(mt5, "TIMEFRAME_M1", 1) if mt5 else 1,
    "M5":  getattr(mt5, "TIMEFRAME_M5", 5) if mt5 else 5,
    "M15": getattr(mt5, "TIMEFRAME_M15", 15) if mt5 else 15,
    "M30": getattr(mt5, "TIMEFRAME_M30", 30) if mt5 else 30,
    "H1":  getattr(mt5, "TIMEFRAME_H1", 16385) if mt5 else 16385,
    "H4":  getattr(mt5, "TIMEFRAME_H4", 16388) if mt5 else 16388,
    "D1":  getattr(mt5, "TIMEFRAME_D1", 16408) if mt5 else 16408,
    # Aliases
    "1M":  getattr(mt5, "TIMEFRAME_M1", 1) if mt5 else 1,
    "5M":  getattr(mt5, "TIMEFRAME_M5", 5) if mt5 else 5,
    "15M": getattr(mt5, "TIMEFRAME_M15", 15) if mt5 else 15,
    "30M": getattr(mt5, "TIMEFRAME_M30", 30) if mt5 else 30,
    "1H":  getattr(mt5, "TIMEFRAME_H1", 16385) if mt5 else 16385,
    "4H":  getattr(mt5, "TIMEFRAME_H4", 16388) if mt5 else 16388,
    "1D":  getattr(mt5, "TIMEFRAME_D1", 16408) if mt5 else 16408,
}


def ensure_mt5() -> tuple[bool, str]:
    """Ensure connection to the MT5 terminal is active."""
    if mt5 is None:
        return False, "MetaTrader5 package not installed (Windows only)"
    try:
        info = mt5.terminal_info()
        if info is not None:
            return True, "ok"
        if not mt5.initialize():
            return False, f"initialize failed: {mt5.last_error()}"
        return True, "ok"
    except Exception as exc:
        return False, f"mt5 exception: {exc}"


_RESOLVED_CACHE: dict[str, str | None] = {}


def resolve_symbol(app_symbol: str, payload: dict = None) -> str | None:
    """
    Resolve requested symbol to the broker's exact Market Watch symbol name.
    1. Check memory cache
    2. Check payload broker_mapping
    3. Check candidate aliases
    4. Check fuzzy prefix/suffix against broker Market Watch
    """
    if not app_symbol:
        return None
    if mt5 is None:
        return app_symbol

    app_clean = app_symbol.strip()
    app_upper = app_clean.upper()

    # Fast cache hit (if no custom request-specific broker_mapping override)
    if not (payload and "broker_mapping" in payload) and app_upper in _RESOLVED_CACHE:
        return _RESOLVED_CACHE[app_upper]

    # 1. Explicit broker mapping from request payload
    if payload and "broker_mapping" in payload:
        mapping = payload["broker_mapping"]
        if app_upper in mapping:
            explicit_sym = mapping[app_upper]
            if mt5.symbol_select(explicit_sym, True):
                _RESOLVED_CACHE[app_upper] = explicit_sym
                return explicit_sym

    # 2. Candidate list from SYMBOL_ALIASES
    candidates = list(SYMBOL_ALIASES.get(app_upper, (app_clean, app_upper)))
    for name in dict.fromkeys(candidates):
        if mt5.symbol_select(name, True):
            _RESOLVED_CACHE[app_upper] = name
            return name

    # 3. Market Watch fuzzy discovery
    available = mt5.symbols_get() or []
    lowered = {s.name.lower(): s.name for s in available}

    # Direct lowercase match
    for name in dict.fromkeys(candidates):
        hit = lowered.get(name.lower())
        if hit and mt5.symbol_select(hit, True):
            _RESOLVED_CACHE[app_upper] = hit
            return hit

    # Prefix match (e.g. EURUSD matching EURUSD.i, EURUSD.raw, EURUSDm)
    for s in available:
        s_name = s.name
        base = s_name.split(".")[0].split("_")[0].split("-")[0].rstrip("m").upper()
        if base == app_upper:
            if mt5.symbol_select(s_name, True):
                _RESOLVED_CACHE[app_upper] = s_name
                return s_name

    # Substring match fallback
    for s in available:
        if app_upper in s.name.upper():
            if mt5.symbol_select(s.name, True):
                _RESOLVED_CACHE[app_upper] = s.name
                return s.name

    _RESOLVED_CACHE[app_upper] = None
    return None


def tick_dict(app_symbol: str, payload: dict = None) -> dict:
    symbol = resolve_symbol(app_symbol, payload)
    if not symbol:
        return {"ok": False, "status": "symbol-missing", "message": f"no MT5 symbol for {app_symbol}", "app_symbol": app_symbol}
    info = mt5.symbol_info(symbol)
    tick = mt5.symbol_info_tick(symbol)
    if not info or not tick:
        return {"ok": False, "status": "symbol-unavailable", "message": f"no tick for {symbol}", "app_symbol": app_symbol, "symbol": symbol}
    point = float(getattr(info, "point", 0.0) or 0.0)
    bid = float(getattr(tick, "bid", 0.0) or 0.0)
    ask = float(getattr(tick, "ask", 0.0) or 0.0)
    return {
        "ok": True,
        "status": "tick",
        "app_symbol": app_symbol,
        "symbol": symbol,
        "bid": bid,
        "ask": ask,
        "last": float(getattr(tick, "last", 0.0) or 0.0),
        "time": getattr(tick, "time", None),
        "time_msc": getattr(tick, "time_msc", None),
        "point": point,
        "digits": getattr(info, "digits", None),
        "spread_points": ((ask - bid) / point) if point else None,
    }


def handle_health(_payload):
    ok, msg = ensure_mt5()
    return {
        "ok": ok,
        "status": "bridge-ready" if ok else "bridge-unhealthy",
        "message": msg,
        "auth": "required" if TOKEN else "open",
        "capabilities": {"timeframes": list(TF_MAP.keys())},
    }


def handle_tick(payload):
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "status": "not-connected", "message": msg}
    app_symbol = str(payload.get("sym") or payload.get("symbol") or "").strip().upper()
    if not app_symbol:
        return {"ok": False, "status": "bad-request", "message": "sym required"}
    return tick_dict(app_symbol, payload)


def handle_ticks(payload):
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "status": "not-connected", "message": msg}
    symbols = payload.get("symbols") or payload.get("syms") or []
    if isinstance(symbols, str):
        symbols = [symbols]
    symbols = [str(s).strip().upper() for s in symbols if str(s).strip()]
    if not symbols:
        return {"ok": False, "status": "bad-request", "message": "symbols required"}
    ticks = {s: tick_dict(s, payload) for s in dict.fromkeys(symbols)}
    ok_count = sum(1 for t in ticks.values() if t.get("ok"))
    return {
        "ok": ok_count > 0,
        "status": "ticks" if ok_count == len(ticks) else "ticks-partial",
        "ticks": ticks,
        "ok_count": ok_count,
        "total": len(ticks),
    }


def handle_symbols(payload):
    """List all symbols visible to the terminal."""
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "status": "not-connected", "message": msg}
    query = str(payload.get("query") or payload.get("q") or "").strip().lower()
    group = str(payload.get("group") or "").strip()
    visible_only = bool(payload.get("visible_only", False))
    limit = int(payload.get("limit") or 0)

    raw = mt5.symbols_get(group) if group else mt5.symbols_get()
    items = []
    for s in raw or []:
        if visible_only and not getattr(s, "visible", False):
            continue
        name = getattr(s, "name", "")
        if query and query not in name.lower() and query not in (getattr(s, "description", "") or "").lower():
            continue
        items.append({
            "name": name,
            "description": getattr(s, "description", "") or "",
            "path": getattr(s, "path", "") or "",
            "digits": getattr(s, "digits", None),
            "trade_mode": getattr(s, "trade_mode", None),
            "visible": bool(getattr(s, "visible", False)),
            "currency_base": getattr(s, "currency_base", "") or "",
            "currency_profit": getattr(s, "currency_profit", "") or "",
        })
    items.sort(key=lambda x: (not x["visible"], x["name"]))
    total = len(items)
    if limit > 0:
        items = items[:limit]
    return {"ok": True, "status": "symbols", "total": total, "count": len(items), "symbols": items}


def handle_symbol(payload):
    """Fetch full symbol specifications (digits, point, spread, tick size/value, volumes)."""
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "status": "not-connected", "message": msg}
    app_symbol = payload.get("sym") or payload.get("symbol")
    if not app_symbol:
        return {"ok": False, "status": "bad-request", "message": "symbol required"}

    symbol = resolve_symbol(str(app_symbol).strip().upper(), payload)
    if not symbol:
        return {"ok": False, "status": "symbol-missing", "message": f"no MT5 symbol for {app_symbol}"}

    info = mt5.symbol_info(symbol)
    if not info:
        return {"ok": False, "status": "symbol-error", "message": f"Failed to get symbol info for {symbol}"}

    return {
        "ok": True,
        "symbol": {
            "name": info.name,
            "app_symbol": app_symbol,
            "digits": info.digits,
            "spread": info.spread,
            "point": info.point,
            "trade_calc_mode": info.trade_calc_mode,
            "trade_mode": info.trade_mode,
            "trade_stops_level": info.trade_stops_level,
            "trade_freeze_level": info.trade_freeze_level,
            "volume_min": info.volume_min,
            "volume_max": info.volume_max,
            "volume_step": info.volume_step,
            "volume_limit": info.volume_limit,
            "trade_contract_size": info.trade_contract_size,
            "trade_tick_value": info.trade_tick_value,
            "trade_tick_value_profit": info.trade_tick_value_profit,
            "trade_tick_value_loss": info.trade_tick_value_loss,
            "trade_tick_size": info.trade_tick_size,
            "margin_initial": info.margin_initial,
            "margin_maintenance": info.margin_maintenance,
            "currency_base": info.currency_base,
            "currency_profit": info.currency_profit,
        }
    }


def handle_rates(payload):
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "status": "not-connected", "message": msg}
    app_symbol = str(payload.get("sym") or payload.get("symbol") or "").strip().upper()
    if not app_symbol:
        return {"ok": False, "status": "bad-request", "message": "sym required"}
    symbol = resolve_symbol(app_symbol, payload)
    if not symbol:
        return {"ok": False, "status": "symbol-missing", "message": f"no MT5 symbol for {app_symbol}"}
    tf_name = str(payload.get("timeframe") or payload.get("tf") or "M5").strip().upper()
    tf_const = TF_MAP.get(tf_name)
    if tf_const is None:
        return {"ok": False, "status": "bad-request", "message": f"unsupported timeframe {tf_name}"}
    count = max(1, min(int(payload.get("count") or 500), 5000))
    offset = max(0, int(payload.get("offset") or 0))

    rates = None
    now_ts = int(datetime.now(timezone.utc).timestamp())
    try:
        mt5.symbol_select(symbol, True)
    except Exception:
        pass

    # Try fetching with progressive backoff retry to allow MT5 to download historical candles from the broker
    delays = [0.15, 0.25, 0.5, 0.75, 1.0]
    for attempt_idx in range(len(delays)):
        for req_count in (count, max(20, count // 2) if count > 50 else count):
            for attempt in (
                lambda: mt5.copy_rates_from_pos(symbol, tf_const, offset, req_count),
                lambda: mt5.copy_rates_from(symbol, tf_const, now_ts + 86400, req_count) if offset == 0 else None,
            ):
                try:
                    rates = attempt()
                except Exception:
                    rates = None
                if rates is not None and len(rates) > 0:
                    break
            if rates is not None and len(rates) > 0:
                break
        if rates is not None and len(rates) > 0:
            break
        time.sleep(delays[attempt_idx])

    if rates is None or len(rates) == 0:
        return {"ok": False, "status": "rates-unavailable", "message": f"no rates for {symbol}: {mt5.last_error()}", "symbol": symbol}

    bars = []
    for row in rates:
        try:
            bars.append({
                "t": int(row["time"]) * 1000,
                "o": float(row["open"]),
                "h": float(row["high"]),
                "l": float(row["low"]),
                "c": float(row["close"]),
                "tick_volume": int(row["tick_volume"]) if "tick_volume" in row.dtype.names else None,
            })
        except Exception:
            continue
    bars.sort(key=lambda b: b["t"])

    # Seamlessly normalize consecutive continuous-session candle opens
    tf_seconds_map = {
        "M1": 60, "1M": 60, "M5": 300, "5M": 300, "M15": 900, "15M": 900,
        "M30": 1800, "30M": 1800, "H1": 3600, "1H": 3600, "H4": 14400, "4H": 14400,
        "D1": 86400, "1D": 86400,
    }
    tf_sec = tf_seconds_map.get(tf_name, 300)
    is_d1 = tf_name in ("D1", "1D")
    for i in range(1, len(bars)):
        prev = bars[i - 1]
        curr = bars[i]
        dt = (curr["t"] - prev["t"]) // 1000
        is_consec = (86400 <= dt <= 86400 * 1.5) if is_d1 else (abs(dt - tf_sec) <= 2)
        if is_consec and prev["c"] > 0:
            curr["o"] = prev["c"]
            curr["h"] = max(curr["h"], curr["o"])
            curr["l"] = min(curr["l"], curr["o"])

    return {
        "ok": bool(bars),
        "status": "rates" if bars else "rates-empty",
        "app_symbol": app_symbol,
        "symbol": symbol,
        "timeframe": tf_name,
        "count": len(bars),
        "bars": bars,
    }


def handle_bulk_rates(payload):
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "status": "not-connected", "message": msg}
    symbols = payload.get("symbols") or payload.get("syms") or []
    if isinstance(symbols, str):
        symbols = [symbols]
    symbols = [str(s).strip().upper() for s in symbols if str(s).strip()]
    if not symbols:
        return {"ok": False, "status": "bad-request", "message": "symbols required"}
    tf_name = str(payload.get("timeframe") or payload.get("tf") or "D1").strip().upper()
    tf_const = TF_MAP.get(tf_name)
    if tf_const is None:
        return {"ok": False, "status": "bad-request", "message": f"unsupported timeframe {tf_name}"}
    count = max(1, min(int(payload.get("count") or 2), 500))

    results = {}
    now_ts = int(datetime.now(timezone.utc).timestamp())
    for app_symbol in dict.fromkeys(symbols):
        symbol = resolve_symbol(app_symbol, payload)
        if not symbol:
            continue
        rates = None
        for attempt in (
            lambda: mt5.copy_rates_from_pos(symbol, tf_const, 0, count),
            lambda: mt5.copy_rates_from(symbol, tf_const, now_ts + 86400, count),
        ):
            try:
                rates = attempt()
            except Exception:
                rates = None
            if rates is not None and len(rates) > 0:
                break
        if rates is None or len(rates) == 0:
            continue
        bars = []
        for row in rates:
            try:
                bars.append({
                    "t": int(row["time"]) * 1000,
                    "o": float(row["open"]),
                    "h": float(row["high"]),
                    "l": float(row["low"]),
                    "c": float(row["close"]),
                })
            except Exception:
                continue
        bars.sort(key=lambda b: b["t"])
        results[app_symbol] = bars

    return {"ok": True, "status": "bulk-rates", "timeframe": tf_name, "count": count, "data": results}


def handle_ping_timeframes(payload):
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "status": "not-connected", "message": msg}
    app_symbol = str(payload.get("sym") or payload.get("symbol") or "").strip().upper()
    if not app_symbol:
        return {"ok": False, "status": "bad-request", "message": "sym required"}
    symbol = resolve_symbol(app_symbol, payload)
    if not symbol:
        return {"ok": False, "status": "symbol-missing", "message": f"no MT5 symbol for {app_symbol}"}

    tfs = payload.get("timeframes") or payload.get("tfs") or ["M1", "M5", "M15", "H1", "H4", "D1"]
    results = {}
    now_ts = int(datetime.now(timezone.utc).timestamp())
    for tf_name in tfs:
        tf_name = str(tf_name).strip().upper()
        tf_const = TF_MAP.get(tf_name)
        if tf_const is None:
            results[tf_name] = {"ok": False, "message": f"unsupported timeframe {tf_name}"}
            continue
        rates = None
        for attempt in (
            lambda: mt5.copy_rates_from_pos(symbol, tf_const, 0, 1),
            lambda: mt5.copy_rates_from(symbol, tf_const, now_ts + 86400, 1),
        ):
            try:
                rates = attempt()
            except Exception:
                rates = None
            if rates is not None and len(rates) > 0:
                break
        if rates is None or len(rates) == 0:
            results[tf_name] = {"ok": False, "message": "no rates"}
        else:
            row = rates[0]
            results[tf_name] = {
                "ok": True,
                "t": int(row["time"]) * 1000,
                "o": float(row["open"]),
                "h": float(row["high"]),
                "l": float(row["low"]),
                "c": float(row["close"]),
                "tick_volume": int(row["tick_volume"]) if "tick_volume" in row.dtype.names else None,
            }

    return {"ok": True, "status": "ping-timeframes", "app_symbol": app_symbol, "symbol": symbol, "data": results}


def handle_order(payload):
    """
    Market-compatible endpoint with explicit resting BUY_LIMIT/SELL_LIMIT support.
    Structural absolute SL/TP prices are never shifted by quote/fill delta.
    """
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "status": "not-connected", "message": msg}

    action = str(payload.get("action") or "").strip().lower()
    symbol = str(payload.get("symbol") or "").strip().upper()
    volume = float(payload.get("volume", 0.01))
    sl = float(payload.get("sl") or 0.0)
    tp = float(payload.get("tp") or 0.0)
    comment = str(payload.get("comment") or "TradeSpace Algo").strip()[:31]
    magic = int(payload.get("magic") or 231223)
    deviation = int(payload.get("deviation") or 20)

    if not action or not symbol:
        return {"ok": False, "status": "bad-request", "message": "action and symbol required"}

    mt5_symbol = resolve_symbol(symbol, payload)
    if not mt5_symbol:
        return {"ok": False, "status": "symbol-missing", "message": f"no MT5 symbol for {symbol}"}

    mt5.symbol_select(mt5_symbol, True)
    tick = mt5.symbol_info_tick(mt5_symbol)
    sym_info = mt5.symbol_info(mt5_symbol)

    if not tick or not sym_info:
        return {"ok": False, "status": "no-tick", "message": f"could not get tick/info for {mt5_symbol}"}

    order_type = mt5.ORDER_TYPE_BUY if action == "buy" else mt5.ORDER_TYPE_SELL if action == "sell" else None
    if order_type is None:
        return {"ok": False, "status": "bad-request", "message": "action must be buy or sell"}

    is_limit = payload.get("order_type") == "limit"
    price = float(payload.get("entry_price") or 0) if is_limit else (tick.ask if action == "buy" else tick.bid)
    if not all(math.isfinite(v) for v in [volume, price, sl, tp]) or price <= 0:
        return {"ok": False, "status": "bad-request", "message": "Finite positive volume/entry required"}
    if is_limit:
        if action == "buy" and price >= tick.ask or action == "sell" and price <= tick.bid:
            return {"ok": False, "status": "bad-limit", "message": "Limit must rest below ask for buy / above bid for sell"}
        order_type = mt5.ORDER_TYPE_BUY_LIMIT if action == "buy" else mt5.ORDER_TYPE_SELL_LIMIT
    if payload.get("structural_levels"):
        minimum_distance = float(getattr(sym_info, "trade_stops_level", 0)) * float(sym_info.point)
        if sl <= 0 or tp <= 0 or (action == "buy" and not sl < price < tp) or (action == "sell" and not tp < price < sl) or min(abs(price - sl), abs(tp - price)) < minimum_distance:
            return {"ok": False, "status": "bad-levels", "message": "Structural SL/TP direction or broker stop distance invalid"}
        # Autonomous legs require an unambiguous dedicated position; netting an
        # unrelated position would corrupt the original-volume risk ledger.
        # Sibling legs (different magic numbers e.g. Default vs Prop-Firm Safe) are separate positions.
        # Only reject if a position/order with the SAME magic number already occupies the symbol.
        positions = mt5.positions_get(symbol=mt5_symbol)
        orders = mt5.orders_get(symbol=mt5_symbol)
        if positions is None or orders is None:
            return {"ok": False, "status": "broker-state-unavailable", "message": "Cannot establish symbol capacity"}
        same_magic_pos = [p for p in (positions or []) if getattr(p, "magic", None) == magic]
        same_magic_ord = [o for o in (orders or []) if getattr(o, "magic", None) == magic]
        if same_magic_pos or same_magic_ord:
            return {"ok": False, "status": "symbol-occupied", "message": f"Symbol already has broker position/order with magic {magic}"}

    # Determine filling mode
    filling = getattr(mt5, "ORDER_FILLING_IOC", 1)
    fok_flag = getattr(mt5, "SYMBOL_FILLING_FOK", 1)
    ioc_flag = getattr(mt5, "SYMBOL_FILLING_IOC", 2)
    mode = getattr(sym_info, "filling_mode", 0)

    if mode & fok_flag:
        filling = getattr(mt5, "ORDER_FILLING_FOK", 0)
    elif mode & ioc_flag:
        filling = getattr(mt5, "ORDER_FILLING_IOC", 1)

    if not valid_volume(volume, sym_info):
        return {"ok": False, "status": "bad-volume", "message": "Volume violates broker min/max/step"}

    request = {
        "action": mt5.TRADE_ACTION_PENDING if is_limit else mt5.TRADE_ACTION_DEAL,
        "symbol": mt5_symbol,
        "volume": volume,
        "type": order_type,
        "price": round(price, sym_info.digits),
        "sl": round(sl, sym_info.digits) if sl > 0 else 0.0,
        "tp": round(tp, sym_info.digits) if tp > 0 else 0.0,
        "deviation": deviation,
        "magic": magic,
        "comment": comment,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": getattr(mt5, "ORDER_FILLING_RETURN", 2) if is_limit else filling,
    }
    expiration = int(payload.get("expiration") or 0)
    if is_limit and expiration:
        if expiration <= datetime.now(timezone.utc).timestamp():
            return {"ok": False, "status": "expired", "message": "Pending expiration is in the past"}
        request["type_time"] = getattr(mt5, "ORDER_TIME_SPECIFIED", 2)
        request["expiration"] = expiration

    # Position closing parameter support
    close_ticket = payload.get("close") or payload.get("position")
    if close_ticket:
        request["position"] = int(close_ticket)

    result = mt5.order_send(request)
    # Automatic fallback to GTC if broker rejects specified expiration (TRADE_RETCODE_INVALID_EXPIRATION == 10022)
    invalid_exp_retcode = getattr(mt5, "TRADE_RETCODE_INVALID_EXPIRATION", 10022)
    if result and getattr(result, "retcode", None) == invalid_exp_retcode and request.get("type_time") != mt5.ORDER_TIME_GTC:
        request["type_time"] = mt5.ORDER_TIME_GTC
        request.pop("expiration", None)
        result = mt5.order_send(request)

    failure = send_result(result, [mt5.TRADE_RETCODE_DONE, getattr(mt5, "TRADE_RETCODE_PLACED", 10008), getattr(mt5, "TRADE_RETCODE_DONE_PARTIAL", 10010)], "order-failed")
    if failure:
        return failure
    deal = mt5.history_deals_get(ticket=result.deal) if getattr(result, "deal", 0) else None

    return {
        "ok": True,
        "status": "order-pending" if is_limit else "order-filled",
        "ticket": result.order,
        "orderTicket": result.order,
        "dealTicket": getattr(result, "deal", None),
        "positionId": getattr(deal[0], "position_id", None) if deal else None,
        "price": result.price,
        "volume": volume if is_limit else result.volume,
    }


def handle_modify(payload):
    """Modify SL and/or TP on an existing open position."""
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "status": "not-connected", "message": msg}

    ticket = int(payload.get("ticket") or 0)
    sl = float(payload.get("sl") or 0.0)
    tp = float(payload.get("tp") or 0.0)

    if not ticket:
        return {"ok": False, "status": "bad-request", "message": "ticket required"}

    position = mt5.positions_get(ticket=ticket)
    if not position or len(position) == 0:
        return {"ok": False, "status": "position-missing", "message": f"position {ticket} not found"}

    pos = position[0]
    sym_info = mt5.symbol_info(pos.symbol)
    digits = sym_info.digits if sym_info else 5
    if not math.isfinite(sl) or not math.isfinite(tp):
        return {"ok": False, "status": "bad-levels", "message": "SL/TP must be finite"}

    request = {
        "action": mt5.TRADE_ACTION_SLTP,
        "symbol": pos.symbol,
        "position": ticket,
        "sl": round(sl, digits) if sl > 0 else pos.sl,
        "tp": round(tp, digits) if tp > 0 else pos.tp,
        "magic": pos.magic,
    }

    result = mt5.order_send(request)
    failure = send_result(result, [mt5.TRADE_RETCODE_DONE, getattr(mt5, "TRADE_RETCODE_NO_CHANGES", 10025)], "modify-failed")
    if failure:
        return failure

    return {
        "ok": True,
        "status": "modified",
        "ticket": ticket,
        "sl": sl,
        "tp": tp,
    }


def handle_close(payload):
    """Close an active MT5 position by ticket (full or partial)."""
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "status": "not-connected", "message": msg}

    ticket = int(payload.get("ticket") or 0)
    if not ticket:
        return {"ok": False, "status": "bad-request", "message": "ticket required"}
    volume = float(payload.get("volume", 0.0))

    position = mt5.positions_get(ticket=ticket)
    if not position or len(position) == 0:
        return {"ok": False, "status": "position-missing", "message": f"position {ticket} not found"}
    pos = position[0]

    sym_info = mt5.symbol_info(pos.symbol)
    if not sym_info:
        return {"ok": False, "status": "symbol-missing", "message": f"symbol {pos.symbol} info not found"}
    volume = pos.volume if "volume" not in payload else volume
    if not valid_volume(volume, sym_info, float(pos.volume)):
        return {"ok": False, "status": "bad-volume", "message": "Partial volume/remainder violates broker min/step"}
    tick = mt5.symbol_info_tick(pos.symbol)
    if not tick:
        return {"ok": False, "status": "no-tick", "message": "Close quote unavailable"}

    filling = getattr(mt5, "ORDER_FILLING_IOC", 1)
    fok_flag = getattr(mt5, "SYMBOL_FILLING_FOK", 1)
    ioc_flag = getattr(mt5, "SYMBOL_FILLING_IOC", 2)
    mode = getattr(sym_info, "filling_mode", 0)

    if mode & fok_flag:
        filling = getattr(mt5, "ORDER_FILLING_FOK", 0)
    elif mode & ioc_flag:
        filling = getattr(mt5, "ORDER_FILLING_IOC", 1)

    order_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
    price = tick.bid if pos.type == mt5.ORDER_TYPE_BUY else tick.ask

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": pos.symbol,
        "volume": volume,
        "type": order_type,
        "position": pos.ticket,
        "price": price,
        "deviation": 20,
        "magic": pos.magic,
        "comment": "TradeSpace close",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": filling,
    }

    result = mt5.order_send(request)
    failure = send_result(result, [mt5.TRADE_RETCODE_DONE, getattr(mt5, "TRADE_RETCODE_DONE_PARTIAL", 10010)], "close-failed")
    if failure:
        return failure

    return {
        "ok": True,
        "status": "close-filled",
        "ticket": ticket,
        "volume": result.volume,
        "dealTicket": getattr(result, "deal", None),
        "positionId": getattr(pos, "identifier", pos.ticket),
        "price": result.price,
    }


def handle_positions(payload):
    """Get active MT5 positions."""
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "status": "not-connected", "message": msg}

    app_symbol = payload.get("sym") or payload.get("symbol")
    symbol = resolve_symbol(app_symbol, payload) if app_symbol else None

    positions = mt5.positions_get(symbol=symbol) if symbol else mt5.positions_get()
    if positions is None:
        return {"ok": False, "status": "positions-unavailable", "message": str(mt5.last_error())}

    res = []
    broker_mapping = payload.get("broker_mapping") or {}
    reverse_mapping = {v: k for k, v in broker_mapping.items()}

    for p in positions:
        try:
            res.append({
                "ticket": getattr(p, "ticket", None),
                "time": getattr(p, "time", None),
                "type": "BUY" if getattr(p, "type", -1) == mt5.ORDER_TYPE_BUY else "SELL",
                "magic": getattr(p, "magic", 0),
                "identifier": getattr(p, "identifier", None),
                "volume": getattr(p, "volume", 0),
                "price_open": getattr(p, "price_open", 0),
                "sl": getattr(p, "sl", 0),
                "tp": getattr(p, "tp", 0),
                "price_current": getattr(p, "price_current", 0),
                "swap": getattr(p, "swap", 0),
                "profit": getattr(p, "profit", 0),
                "symbol": getattr(p, "symbol", ""),
                "app_symbol": reverse_mapping.get(getattr(p, "symbol", ""), getattr(p, "symbol", "")),
                "comment": getattr(p, "comment", ""),
            })
        except Exception:
            continue

    return {"ok": True, "status": "positions", "positions": res}


def handle_history(payload):
    """Get trade deals history."""
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "status": "not-connected", "message": msg}

    days = int(payload.get("days") or 7)
    app_symbol = payload.get("sym") or payload.get("symbol")
    symbol = resolve_symbol(app_symbol, payload) if app_symbol else None

    now = datetime.now(timezone.utc)
    from_date = now - timedelta(days=days)
    to_date = now + timedelta(days=1)

    deals = mt5.history_deals_get(from_date, to_date, group=f"*{symbol}*") if symbol else mt5.history_deals_get(from_date, to_date)
    if deals is None:
        return {"ok": False, "status": "history-unavailable", "message": str(mt5.last_error())}

    res = []
    for d in deals:
        res.append({
            "ticket": getattr(d, "ticket", None),
            "order": getattr(d, "order", None),
            "time": getattr(d, "time", None),
            "time_msc": getattr(d, "time_msc", None),
            "type": "BUY" if getattr(d, "type", -1) == getattr(mt5, "DEAL_TYPE_BUY", 0) else "SELL" if getattr(d, "type", -1) == getattr(mt5, "DEAL_TYPE_SELL", 1) else "OTHER",
            "entry": getattr(d, "entry", None),
            "magic": getattr(d, "magic", None),
            "position_id": getattr(d, "position_id", None),
            "volume": getattr(d, "volume", None),
            "price": getattr(d, "price", None),
            "commission": getattr(d, "commission", None),
            "fee": getattr(d, "fee", None),
            "swap": getattr(d, "swap", None),
            "profit": getattr(d, "profit", None),
            "symbol": getattr(d, "symbol", None),
            "comment": getattr(d, "comment", None),
        })

    return {"ok": True, "status": "history", "history": res}


def handle_orders(payload):
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "message": msg}
    app_symbol = payload.get("sym") or payload.get("symbol")
    symbol = resolve_symbol(app_symbol, payload) if app_symbol else None
    orders = mt5.orders_get(symbol=symbol) if symbol else mt5.orders_get()
    if orders is None:
        return {"ok": False, "message": "Pending orders unavailable"}
    fields = ["ticket", "symbol", "type", "state", "time_setup", "time_expiration", "volume_initial", "volume_current", "price_open", "sl", "tp", "magic", "comment", "position_id"]
    return {"ok": True, "orders": [{k: getattr(order, k, None) for k in fields} for order in orders]}


def handle_cancel(payload):
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "message": msg}
    ticket = int(payload.get("ticket") or 0)
    orders = mt5.orders_get(ticket=ticket)
    if not ticket or orders is None:
        return {"ok": False, "status": "order-unavailable", "message": "Pending order lookup failed"}
    if not orders:
        return {"ok": False, "ambiguous": True, "status": "reconciliation-required", "message": "Order absent; may have filled"}
    result = mt5.order_send({"action": mt5.TRADE_ACTION_REMOVE, "order": ticket})
    failure = send_result(result, [mt5.TRADE_RETCODE_DONE], "cancel-failed")
    return failure or {"ok": True, "status": "cancelled", "orderTicket": ticket}


def handle_calc_profit(payload):
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "message": msg}
    symbol = resolve_symbol(payload.get("symbol") or payload.get("sym"), payload)
    action = payload.get("action")
    if not symbol or action not in ["buy", "sell"]:
        return {"ok": False, "message": "Valid symbol/direction required"}
    entry, sl = float(payload.get("entry_price") or 0), float(payload.get("sl") or 0)
    if not all(math.isfinite(v) and v > 0 for v in [entry, sl]) or entry == sl:
        return {"ok": False, "message": "Valid initial stop required"}
    profit = mt5.order_calc_profit(mt5.ORDER_TYPE_BUY if action == "buy" else mt5.ORDER_TYPE_SELL, symbol, 1.0, entry, sl)
    if profit is None or not math.isfinite(profit) or profit >= 0:
        return {"ok": False, "message": "Broker account-currency loss calculation unavailable"}
    return {"ok": True, "lossPerLot": -profit, "currency": mt5.account_info().currency}


def handle_state(payload):
    positions, orders, history, account = handle_positions({}), handle_orders({}), handle_history(payload), handle_account({})
    if not all(r.get("ok") for r in [positions, orders, history, account]):
        return {"ok": False, "message": "Incomplete broker snapshot"}
    now = datetime.now(timezone.utc)
    raw_orders = mt5.history_orders_get(now - timedelta(days=int(payload.get("days") or 7)), now + timedelta(days=1))
    if raw_orders is None:
        return {"ok": False, "message": "Order history unavailable"}
    with journal_connection() as conn:
        rows = conn.execute("SELECT request_id,state,response FROM requests WHERE created>=?", ((now - timedelta(days=7)).timestamp(),)).fetchall()
    requests_list = []
    for r in rows:
        resp = None
        if r[2]:
            try:
                resp = json.loads(r[2])
            except Exception:
                resp = str(r[2])
        requests_list.append({"request_id": r[0], "state": r[1], "response": resp})
    tz_name = os.getenv("MT5_BROKER_TIMEZONE", "Europe/Athens")
    try:
        if ZoneInfo:
            day_start = now.astimezone(ZoneInfo(tz_name)).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        else:
            day_start = now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    except Exception:
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    daily = [d for d in history["history"] if float(d.get("time") or 0) >= day_start and d.get("type") in ["BUY", "SELL"]]
    pnl = sum(float(d.get("profit") or 0) + float(d.get("commission") or 0) + float(d.get("swap") or 0) + float(d.get("fee") or 0) for d in daily)
    order_fields = ["ticket", "position_id", "state", "comment", "symbol", "volume_initial", "volume_current"]
    return {"ok": True, "positions": positions["positions"], "orders": orders["orders"], "history": history["history"], "account": account["account"], "requests": requests_list, "order_history": [{k: getattr(o, k, None) for k in order_fields} for o in raw_orders], "dailyPnl": pnl, "dayStartEquity": account["account"]["balance"] - pnl, "brokerDayStart": day_start, "at": now.timestamp()}


def handle_account(_payload):
    """Get account balance, equity, margin, leverage."""
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "status": "not-connected", "message": msg}

    acc = mt5.account_info()
    if not acc:
        return {"ok": False, "status": "account-error", "message": "Failed to get account info"}

    return {
        "ok": True,
        "account": {
            "login": acc.login,
            "trade_mode": acc.trade_mode,
            "leverage": acc.leverage,
            "balance": acc.balance,
            "equity": acc.equity,
            "profit": acc.profit,
            "margin": acc.margin,
            "margin_free": acc.margin_free,
            "margin_level": acc.margin_level,
            "currency": acc.currency,
            "server": acc.server,
            "company": acc.company,
            "trade_allowed": acc.trade_allowed,
            "trade_expert": acc.trade_expert,
        }
    }


ROUTES = {
    ("GET",  "/health"): handle_health,
    ("POST", "/health"): handle_health,
    ("POST", "/tick"):    handle_tick,
    ("POST", "/ticks"):   handle_ticks,
    ("POST", "/rates"):   handle_rates,
    ("POST", "/bulk-rates"): handle_bulk_rates,
    ("POST", "/ping-timeframes"): handle_ping_timeframes,
    ("POST", "/symbols"): handle_symbols,
    ("GET",  "/symbols"): handle_symbols,
    ("POST", "/symbol"):  handle_symbol,
    ("GET",  "/symbol"):  handle_symbol,
    ("POST", "/order"):   handle_order,
    ("POST", "/modify"):  handle_modify,
    ("POST", "/close"):   handle_close,
    ("POST", "/cancel"):  handle_cancel,
    ("POST", "/orders"):  handle_orders,
    ("GET",  "/orders"):  handle_orders,
    ("POST", "/state"):   handle_state,
    ("POST", "/calc-profit"): handle_calc_profit,
    ("GET",  "/positions"): handle_positions,
    ("POST", "/positions"): handle_positions,
    ("GET",  "/history"):   handle_history,
    ("POST", "/history"):   handle_history,
    ("GET",  "/account"):   handle_account,
    ("POST", "/account"):   handle_account,
}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, obj):
        body = json.dumps(obj, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-NEXUS-MT5-TOKEN")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _payload(self, parsed_path=None):
        payload = {}
        if parsed_path and parsed_path.query:
            for k, v in parse_qsl(parsed_path.query):
                payload[k] = v
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                payload.update(body)
            except Exception:
                pass
        return payload

    def _authorized(self):
        if not TOKEN:
            return True
        header = str(self.headers.get("Authorization") or "").strip()
        provided = header[7:].strip() if header.lower().startswith("bearer ") else ""
        provided = provided or str(self.headers.get("X-NEXUS-MT5-TOKEN") or "").strip()
        return bool(provided) and secrets.compare_digest(provided, TOKEN)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def _route(self, method):
        parsed = urlparse(self.path)
        path = parsed.path
        handler = ROUTES.get((method, path))
        if not handler:
            self._send(404, {"ok": False, "status": "not-found", "message": f"unknown route {method} {path}"})
            return
        if path != "/health" and not self._authorized():
            self._send(401, {"ok": False, "status": "unauthorized", "message": "MT5_TOKEN missing or invalid"})
            return
        try:
            payload = self._payload(parsed)
            with LOCK:
                result = durable_write(handler, payload) if path in ["/order", "/modify", "/close", "/cancel"] else handler(payload)
            self._send(200, result)
        except Exception as exc:
            self._send(500, {"ok": False, "status": "bridge-exception", "message": str(exc)})

    def address_string(self):
        """Return the client IP directly without blocking reverse DNS lookups (socket.getfqdn)."""
        return str(self.client_address[0])

    def log_message(self, fmt, *args):
        # Suppress logging for high-frequency poll requests to prevent console buffer memory thrashing
        if hasattr(self, "path") and (self.path.startswith("/ticks") or self.path == "/health" or self.path == "/tick"):
            return
        print(f"[mt5-bridge] {self.address_string()} {fmt % args}", flush=True)


def main():
    global TOKEN
    parser = argparse.ArgumentParser(description="TradeSpace Institutional MT5 Bridge Server")
    parser.add_argument("--host", default="0.0.0.0", help="0.0.0.0 to accept remote connections")
    parser.add_argument("--port", type=int, default=8765, help="Port to listen on (default: 8765)")
    parser.add_argument("--token", default=None, help="Auth token (overrides MT5_TOKEN / NEXUS_MT5_REMOTE_TOKEN from .env)")
    args = parser.parse_args()

    if args.token:
        TOKEN = args.token
    elif not TOKEN:
        TOKEN = os.getenv("MT5_TOKEN") or os.getenv("NEXUS_MT5_REMOTE_TOKEN") or ""

    print("=" * 60, flush=True)
    print("TradeSpace Institutional MT5 Bridge Server", flush=True)
    ok, msg = ensure_mt5()
    if not ok:
        print(f"[warn] MT5 not connected: {msg}", flush=True)
        print("[warn] Make sure MetaTrader 5 terminal is running and logged in.", flush=True)
    else:
        info = mt5.account_info()
        term = mt5.terminal_info()
        if info:
            print(f"[mt5] account={info.login} server={info.server} balance={info.balance} {info.currency}", flush=True)
        if term:
            print(f"[mt5] terminal={term.name} build={term.build} connected={term.connected}", flush=True)

    print(f"[bridge] listening on http://{args.host}:{args.port}", flush=True)
    print(f"[bridge] auth: {'required (MT5_TOKEN set)' if TOKEN else 'OPEN - set MT5_TOKEN env var'}", flush=True)
    print("=" * 60, flush=True)

    try:
        ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\n[bridge] shutting down...", flush=True)
    finally:
        if mt5:
            mt5.shutdown()


if __name__ == "__main__":
    main()
