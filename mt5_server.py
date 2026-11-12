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
import sys
import socket
import time
import secrets
import threading
import math
import sqlite3
import hashlib
from contextlib import contextmanager
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
CACHE_LOCK = threading.Lock()
try:
    threading.stack_size(512 * 1024)  # 512 KB per thread stack (saves ~75% RAM on 1GB VPS)
except Exception:
    pass

HTTP_SEMAPHORE = threading.Semaphore(24)  # Bound concurrent active connections to protect VPS RAM
_RATES_CACHE = {}
_ACCOUNT_CACHE = None
_STATE_CACHE = None
_TICK_CACHE = {}
_SYMBOLS_CACHE = None
_IN_FLIGHT_RATES = {}
_SELECTED_SYMBOLS = set()

def _tf_cache_ttl(tf_name: str) -> float:
    t = str(tf_name).upper()
    if t in ("D1", "1D"):
        return 60.0
    if t in ("H4", "4H"):
        return 30.0
    if t in ("H1", "1H"):
        return 15.0
    if t in ("M30", "30M", "M15", "15M"):
        return 8.0
    return 3.0

# A write is journaled before order_send. After a crash/timeout its request id
# remains unresolved and is never replayed; orders/deals reconcile the outcome.
def init_journal():
    """Run one-time journal initialization at server startup to prevent thread lock contention."""
    try:
        path = os.getenv("MT5_REQUEST_JOURNAL") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "mt5_requests.sqlite3")
        conn = sqlite3.connect(path, timeout=10.0)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("CREATE TABLE IF NOT EXISTS requests (request_id TEXT PRIMARY KEY, digest TEXT NOT NULL, state TEXT NOT NULL, response TEXT, created REAL NOT NULL)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_requests_created ON requests (created)")
        conn.commit()
        conn.close()
    except Exception as exc:
        print(f"[journal] init warning: {exc}", flush=True)


@contextmanager
def journal_connection():
    path = os.getenv("MT5_REQUEST_JOURNAL") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "mt5_requests.sqlite3")
    conn = sqlite3.connect(path, timeout=5.0)
    try:
        with conn:
            yield conn
    finally:
        try:
            conn.close()
        except Exception:
            pass


def durable_write(handler, payload):
    global _STATE_CACHE
    with CACHE_LOCK:
        _STATE_CACHE = None
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
            with LOCK:
                account = mt5.account_info() if ok else None
            result = {"ok": False, "status": "account-mismatch", "message": "Broker account changed or unavailable"} if not account or str(account.login) != str(expected_account) else handler(payload)
        else:
            result = handler(payload)
    except Exception as exc:
        result = {"ok": False, "ambiguous": True, "status": "reconciliation-required", "message": str(exc)}
    result["request_id"] = request_id
    with journal_connection() as conn:
        conn.execute("UPDATE requests SET state=?,response=? WHERE request_id=?", ("finished", json.dumps(result), request_id))
    with CACHE_LOCK:
        _STATE_CACHE = None
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


_LAST_INIT_ATTEMPT = 0.0


def ensure_mt5() -> tuple[bool, str]:
    """Ensure connection to the MT5 terminal is active."""
    global _LAST_INIT_ATTEMPT
    if mt5 is None:
        return False, "MetaTrader5 package not installed (Windows only)"
    with LOCK:
        try:
            info = mt5.terminal_info()
            if info is not None:
                # Terminal IPC is connected. Now verify if account is authorized.
                acc = mt5.account_info()
                if acc is not None:
                    return True, "ok"

                # Terminal is running, but account is NOT authorized or logged in!
                mt5_login = os.getenv("MT5_LOGIN")
                now = time.monotonic()
                if mt5_login and (now - _LAST_INIT_ATTEMPT >= 5.0):
                    _LAST_INIT_ATTEMPT = now
                    login_kw = {"login": int(mt5_login)}
                    mt5_password = os.getenv("MT5_PASSWORD")
                    mt5_server = os.getenv("MT5_SERVER")
                    if mt5_password:
                        login_kw["password"] = mt5_password
                    if mt5_server:
                        login_kw["server"] = mt5_server
                    try:
                        if mt5.login(**login_kw):
                            print(f"[mt5] auto-login succeeded for account {mt5_login}", flush=True)
                            return True, "ok"
                        err = mt5.last_error()
                        return False, f"login to {mt5_login} failed: {err}"
                    except Exception as lex:
                        return False, f"login exception: {lex}"

                return False, "Terminal: Authorization failed (no account logged in - set MT5_LOGIN in .env or login in terminal64.exe)"

            # info is None: Python IPC is disconnected from terminal64.exe
            now = time.monotonic()
            if now - _LAST_INIT_ATTEMPT < 5.0:
                return False, "MT5 initializing (cooldown)"
            _LAST_INIT_ATTEMPT = now
            try:
                mt5.shutdown()
            except Exception:
                pass

            # Optional credentials support: auto-logins terminal if MT5 credentials are provided in .env
            init_kwargs = {}
            mt5_login = os.getenv("MT5_LOGIN")
            mt5_password = os.getenv("MT5_PASSWORD")
            mt5_server = os.getenv("MT5_SERVER")
            mt5_path = os.getenv("MT5_PATH")
            if mt5_login:
                try:
                    init_kwargs["login"] = int(mt5_login)
                except ValueError:
                    pass
            if mt5_password:
                init_kwargs["password"] = mt5_password
            if mt5_server:
                init_kwargs["server"] = mt5_server
            if mt5_path and os.path.exists(mt5_path):
                init_kwargs["path"] = mt5_path

            init_ok = mt5.initialize(**init_kwargs) if init_kwargs else mt5.initialize()
            if not init_ok:
                err = mt5.last_error()
                return False, f"initialize failed: {err}"
            return True, "ok"
        except Exception as exc:
            return False, f"mt5 exception: {exc}"


_RESOLVED_CACHE: dict[str, str | None] = {}


def resolve_symbol(app_symbol: str, payload: dict = None) -> str | None:
    """
    Resolve requested symbol to the broker's exact Market Watch symbol name.
    1. Check memory cache (thread-safe)
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
    with CACHE_LOCK:
        cached_sym = _RESOLVED_CACHE.get(app_upper)
        if not (payload and "broker_mapping" in payload) and cached_sym:
            return cached_sym

    with LOCK:
        # Double-check cache inside mutex in case another worker resolved it while waiting
        with CACHE_LOCK:
            cached_sym = _RESOLVED_CACHE.get(app_upper)
            if not (payload and "broker_mapping" in payload) and cached_sym:
                return cached_sym

        # 1. Explicit broker mapping from request payload
        if payload and "broker_mapping" in payload:
            mapping = payload["broker_mapping"]
            if app_upper in mapping:
                explicit_sym = mapping[app_upper]
                try:
                    if mt5.symbol_select(explicit_sym, True):
                        with CACHE_LOCK:
                            _RESOLVED_CACHE[app_upper] = explicit_sym
                        return explicit_sym
                except Exception:
                    pass

        # 2. Candidate list from SYMBOL_ALIASES
        candidates = list(SYMBOL_ALIASES.get(app_upper, (app_clean, app_upper)))
        for name in dict.fromkeys(candidates):
            try:
                if mt5.symbol_select(name, True):
                    with CACHE_LOCK:
                        _RESOLVED_CACHE[app_upper] = name
                    return name
            except Exception:
                pass

        # 3. Market Watch fuzzy discovery
        try:
            available = mt5.symbols_get() or []
        except Exception:
            available = []
        lowered = {s.name.lower(): s.name for s in available}

        # Direct lowercase match
        for name in dict.fromkeys(candidates):
            hit = lowered.get(name.lower())
            if hit:
                try:
                    if mt5.symbol_select(hit, True):
                        with CACHE_LOCK:
                            _RESOLVED_CACHE[app_upper] = hit
                        return hit
                except Exception:
                    pass

        # Prefix match (e.g. EURUSD matching EURUSD.i, EURUSD.raw, EURUSDm)
        for s in available:
            s_name = s.name
            base = s_name.split(".")[0].split("_")[0].split("-")[0].rstrip("m").upper()
            if base == app_upper:
                try:
                    if mt5.symbol_select(s_name, True):
                        with CACHE_LOCK:
                            _RESOLVED_CACHE[app_upper] = s_name
                        return s_name
                except Exception:
                    pass

        # Substring match fallback
        for s in available:
            if app_upper in s.name.upper():
                try:
                    if mt5.symbol_select(s.name, True):
                        with CACHE_LOCK:
                            _RESOLVED_CACHE[app_upper] = s.name
                        return s.name
                except Exception:
                    pass

        # Do not cache None permanently so subsequent retries can resolve once terminal connects
        return None


def tick_dict(app_symbol: str, payload: dict = None) -> dict:
    app_upper = str(app_symbol or "").strip().upper()
    now_mono = time.monotonic()
    with CACHE_LOCK:
        cached = _TICK_CACHE.get(app_upper)
        if cached and (now_mono - cached[0] < 0.5):
            return cached[1]

    symbol = resolve_symbol(app_symbol, payload)
    if not symbol:
        return {"ok": False, "status": "symbol-missing", "message": f"no MT5 symbol for {app_symbol}", "app_symbol": app_symbol}
    with LOCK:
        try:
            info = mt5.symbol_info(symbol)
            tick = mt5.symbol_info_tick(symbol)
        except Exception as exc:
            return {"ok": False, "status": "symbol-error", "message": f"tick exception: {exc}", "app_symbol": app_symbol, "symbol": symbol}
    if not info or not tick:
        with CACHE_LOCK:
            cached_entry = _TICK_CACHE.get(app_upper)
            if cached_entry and isinstance(cached_entry[1], dict) and cached_entry[1].get("ok"):
                stale_tick = dict(cached_entry[1])
                stale_tick["stale"] = True
                return stale_tick
        return {"ok": False, "status": "symbol-unavailable", "message": f"no tick for {symbol}", "app_symbol": app_symbol, "symbol": symbol}
    point = float(getattr(info, "point", 0.0) or 0.0)
    bid = float(getattr(tick, "bid", 0.0) or 0.0)
    ask = float(getattr(tick, "ask", 0.0) or 0.0)
    res = {
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
    with CACHE_LOCK:
        _TICK_CACHE[app_upper] = (now_mono, res)
        if len(_TICK_CACHE) > 200:
            oldest_k = min(_TICK_CACHE.keys(), key=lambda k: _TICK_CACHE[k][0])
            _TICK_CACHE.pop(oldest_k, None)
    return res


def handle_health(_payload):
    # Instant, non-blocking liveness check.
    # NEVER acquire LOCK or block on MT5 terminal queries here so health sentinels never time out under load.
    return {
        "ok": True,
        "status": "bridge-ready",
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
    global _SYMBOLS_CACHE
    query = str(payload.get("query") or payload.get("q") or "").strip().lower()
    group = str(payload.get("group") or "").strip()
    visible_only = bool(payload.get("visible_only", False))
    limit = int(payload.get("limit") or 0)
    now_mono = time.monotonic()

    # Fast in-memory hit for base symbols query
    if not query and not group and not visible_only and not limit:
        with CACHE_LOCK:
            if _SYMBOLS_CACHE and (now_mono - _SYMBOLS_CACHE[0] < 60.0):
                return _SYMBOLS_CACHE[1]

    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "status": "not-connected", "message": msg}

    with LOCK:
        try:
            raw = mt5.symbols_get(group) if group else mt5.symbols_get()
        except Exception as exc:
            return {"ok": False, "status": "symbols-error", "message": str(exc)}
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
    res = {"ok": True, "status": "symbols", "total": total, "count": len(items), "symbols": items}
    if not query and not group and not visible_only and not limit:
        with CACHE_LOCK:
            _SYMBOLS_CACHE = (now_mono, res)
    return res


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

    with LOCK:
        try:
            info = mt5.symbol_info(symbol)
        except Exception as exc:
            return {"ok": False, "status": "symbol-error", "message": str(exc)}
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
    app_symbol = str(payload.get("sym") or payload.get("symbol") or "").strip().upper()
    if not app_symbol:
        return {"ok": False, "status": "bad-request", "message": "sym required"}
    tf_name = str(payload.get("timeframe") or payload.get("tf") or "M5").strip().upper()
    tf_const = TF_MAP.get(tf_name)
    if tf_const is None:
        return {"ok": False, "status": "bad-request", "message": f"unsupported timeframe {tf_name}"}
    count = max(1, min(int(payload.get("count") or 500), 5000))
    offset = max(0, int(payload.get("offset") or 0))

    cache_key = (app_symbol, tf_name, count, offset)
    now_mono = time.monotonic()
    ttl = _tf_cache_ttl(tf_name)
    with CACHE_LOCK:
        # 1. Exact cache match
        cached = _RATES_CACHE.get(cache_key)
        if cached and (now_mono - cached[0] < ttl):
            return cached[1]

        # 2. Dynamic cache slicing: if an existing cached entry with offset 0 has >= count bars, slice and serve directly
        if offset == 0:
            for (k_sym, k_tf, k_cnt, k_off), (c_time, c_res) in list(_RATES_CACHE.items()):
                if k_sym == app_symbol and k_tf == tf_name and k_off == 0 and (now_mono - c_time < ttl):
                    bars = c_res.get("bars", [])
                    if len(bars) >= count:
                        sliced_bars = bars[-count:]
                        sliced_res = {
                            "ok": True,
                            "status": "rates",
                            "app_symbol": app_symbol,
                            "symbol": c_res.get("symbol", app_symbol),
                            "timeframe": tf_name,
                            "count": len(sliced_bars),
                            "bars": sliced_bars,
                        }
                        _RATES_CACHE[cache_key] = (c_time, sliced_res)
                        return sliced_res

        # 3. In-flight single-flight coalescing
        flight_event = _IN_FLIGHT_RATES.get(cache_key)
        if flight_event is None:
            flight_event = threading.Event()
            _IN_FLIGHT_RATES[cache_key] = flight_event
            is_leader = True
        else:
            is_leader = False

    if not is_leader:
        flight_event.wait(timeout=8.0)
        with CACHE_LOCK:
            cached = _RATES_CACHE.get(cache_key)
            if cached:
                return cached[1]

    try:
        ok, msg = ensure_mt5()
        if not ok:
            return {"ok": False, "status": "not-connected", "message": msg}
        symbol = resolve_symbol(app_symbol, payload)
        if not symbol:
            return {"ok": False, "status": "symbol-missing", "message": f"no MT5 symbol for {app_symbol}"}

        rates = None
        now_ts = int(datetime.now(timezone.utc).timestamp())
        
        with CACHE_LOCK:
            already_selected = symbol in _SELECTED_SYMBOLS
        if not already_selected:
            with LOCK:
                try:
                    if mt5.symbol_select(symbol, True):
                        with CACHE_LOCK:
                            _SELECTED_SYMBOLS.add(symbol)
                except Exception:
                    pass

        for attempt in (
            lambda: mt5.copy_rates_from_pos(symbol, tf_const, offset, count),
            lambda: mt5.copy_rates_from(symbol, tf_const, now_ts + 86400, count) if offset == 0 else None,
        ):
            with LOCK:
                try:
                    rates = attempt()
                except Exception:
                    rates = None
            if rates is not None and len(rates) > 0:
                break

        # If first attempt is None/empty (cold symbol / historical download from broker), retry with progressive backoff
        if rates is None or len(rates) == 0:
            for delay in (0.1, 0.25):
                time.sleep(delay)
                for attempt in (
                    lambda: mt5.copy_rates_from_pos(symbol, tf_const, offset, count),
                    lambda: mt5.copy_rates_from(symbol, tf_const, now_ts + 86400, count) if offset == 0 else None,
                ):
                    with LOCK:
                        try:
                            rates = attempt()
                        except Exception:
                            rates = None
                    if rates is not None and len(rates) > 0:
                        break
                if rates is not None and len(rates) > 0:
                    break

        if rates is None or len(rates) == 0:
            with LOCK:
                try:
                    last_err = str(mt5.last_error())
                except Exception:
                    last_err = "unknown"

            # Resilient Stale-While-Revalidate: Return previously cached bars during transient broker blips
            # Prevents charts and radars from freezing or showing blank state
            with CACHE_LOCK:
                stale_entry = _RATES_CACHE.get(cache_key)
                if stale_entry and isinstance(stale_entry[1], dict) and stale_entry[1].get("ok") and stale_entry[1].get("bars"):
                    stale_res = dict(stale_entry[1])
                    stale_res["stale"] = True
                    stale_res["status"] = "rates-cached"
                    return stale_res

            err_res = {"ok": False, "status": "rates-unavailable", "message": f"no rates for {symbol}: {last_err}", "symbol": symbol}
            with CACHE_LOCK:
                # Do NOT cache error responses for the full timeframe TTL (which could be 15-60s)
                # Cache for only 1.5 seconds so rapid retries can fetch newly loaded broker data
                _RATES_CACHE[cache_key] = (now_mono - ttl + 1.5, err_res)
            return err_res

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

        res = {
            "ok": bool(bars),
            "status": "rates" if bars else "rates-empty",
            "app_symbol": app_symbol,
            "symbol": symbol,
            "timeframe": tf_name,
            "count": len(bars),
            "bars": bars,
        }
        with CACHE_LOCK:
            _RATES_CACHE[cache_key] = (now_mono, res)
            if len(_RATES_CACHE) > 200:
                oldest_k = min(_RATES_CACHE.keys(), key=lambda k: _RATES_CACHE[k][0])
                _RATES_CACHE.pop(oldest_k, None)
        return res
    finally:
        with CACHE_LOCK:
            _IN_FLIGHT_RATES.pop(cache_key, None)
        flight_event.set()


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
            with LOCK:
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
            with LOCK:
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

    with LOCK:
        mt5_symbol = resolve_symbol(symbol, payload)
        if not mt5_symbol:
            return {"ok": False, "status": "symbol-missing", "message": f"no MT5 symbol for {symbol}"}

        try:
            mt5.symbol_select(mt5_symbol, True)
            tick = mt5.symbol_info_tick(mt5_symbol)
            sym_info = mt5.symbol_info(mt5_symbol)
        except Exception as exc:
            return {"ok": False, "status": "symbol-error", "message": str(exc)}

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
            if (action == "buy" and price >= tick.ask) or (action == "sell" and price <= tick.bid):
                # Market price has reached or crossed limit entry price during order transit.
                # Convert immediately to market deal (TRADE_ACTION_DEAL) rather than failing with bad-limit!
                is_limit = False
                order_type = mt5.ORDER_TYPE_BUY if action == "buy" else mt5.ORDER_TYPE_SELL
                price = tick.ask if action == "buy" else tick.bid
            else:
                order_type = mt5.ORDER_TYPE_BUY_LIMIT if action == "buy" else mt5.ORDER_TYPE_SELL_LIMIT
        if payload.get("structural_levels"):
            minimum_distance = float(getattr(sym_info, "trade_stops_level", 0)) * float(sym_info.point)
            if sl <= 0 or tp <= 0 or (action == "buy" and not sl < price < tp) or (action == "sell" and not tp < price < sl) or min(abs(price - sl), abs(tp - price)) < minimum_distance:
                return {"ok": False, "status": "bad-levels", "message": "Structural SL/TP direction or broker stop distance invalid"}
            try:
                positions = mt5.positions_get(symbol=mt5_symbol)
                orders = mt5.orders_get(symbol=mt5_symbol)
            except Exception as exc:
                return {"ok": False, "status": "broker-state-unavailable", "message": f"Cannot establish symbol capacity: {exc}"}
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

        try:
            result = mt5.order_send(request)
            # Automatic fallback to GTC if broker rejects specified expiration (TRADE_RETCODE_INVALID_EXPIRATION == 10022)
            invalid_exp_retcode = getattr(mt5, "TRADE_RETCODE_INVALID_EXPIRATION", 10022)
            if result and getattr(result, "retcode", None) == invalid_exp_retcode and request.get("type_time") != mt5.ORDER_TIME_GTC:
                request["type_time"] = mt5.ORDER_TIME_GTC
                request.pop("expiration", None)
                result = mt5.order_send(request)
        except Exception as exc:
            return {"ok": False, "ambiguous": True, "status": "reconciliation-required", "message": f"order_send exception: {exc}"}

        failure = send_result(result, [mt5.TRADE_RETCODE_DONE, getattr(mt5, "TRADE_RETCODE_PLACED", 10008), getattr(mt5, "TRADE_RETCODE_DONE_PARTIAL", 10010)], "order-failed")
        if failure:
            return failure
        try:
            deal = mt5.history_deals_get(ticket=result.deal) if getattr(result, "deal", 0) else None
        except Exception:
            deal = None

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

    with LOCK:
        try:
            position = mt5.positions_get(ticket=ticket)
        except Exception as exc:
            return {"ok": False, "status": "position-missing", "message": str(exc)}
        if not position or len(position) == 0:
            return {"ok": False, "status": "position-missing", "message": f"position {ticket} not found"}

        pos = position[0]
        try:
            sym_info = mt5.symbol_info(pos.symbol)
        except Exception:
            sym_info = None
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

        try:
            result = mt5.order_send(request)
        except Exception as exc:
            return {"ok": False, "ambiguous": True, "status": "reconciliation-required", "message": str(exc)}

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

    with LOCK:
        try:
            position = mt5.positions_get(ticket=ticket)
        except Exception as exc:
            return {"ok": False, "status": "position-missing", "message": str(exc)}
        if not position or len(position) == 0:
            return {"ok": False, "status": "position-missing", "message": f"position {ticket} not found"}
        pos = position[0]

        try:
            sym_info = mt5.symbol_info(pos.symbol)
            tick = mt5.symbol_info_tick(pos.symbol)
        except Exception as exc:
            return {"ok": False, "status": "symbol-missing", "message": str(exc)}

        if not sym_info:
            return {"ok": False, "status": "symbol-missing", "message": f"symbol {pos.symbol} info not found"}
        volume = pos.volume if "volume" not in payload else volume
        if not valid_volume(volume, sym_info, float(pos.volume)):
            return {"ok": False, "status": "bad-volume", "message": "Partial volume/remainder violates broker min/step"}
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

        try:
            result = mt5.order_send(request)
        except Exception as exc:
            return {"ok": False, "ambiguous": True, "status": "reconciliation-required", "message": str(exc)}

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

    with LOCK:
        try:
            positions = mt5.positions_get(symbol=symbol) if symbol else mt5.positions_get()
            last_err = str(mt5.last_error()) if positions is None else ""
        except Exception as exc:
            return {"ok": False, "status": "positions-unavailable", "message": str(exc)}

    if positions is None:
        return {"ok": False, "status": "positions-unavailable", "message": last_err or "positions unavailable"}

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

    with LOCK:
        try:
            deals = mt5.history_deals_get(from_date, to_date, group=f"*{symbol}*") if symbol else mt5.history_deals_get(from_date, to_date)
            last_err = str(mt5.last_error()) if deals is None else ""
        except Exception as exc:
            return {"ok": False, "status": "history-unavailable", "message": str(exc)}

    if deals is None:
        return {"ok": False, "status": "history-unavailable", "message": last_err or "history unavailable"}

    res = []
    for d in deals:
        try:
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
        except Exception:
            continue

    return {"ok": True, "status": "history", "history": res}


def handle_orders(payload):
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "message": msg}
    app_symbol = payload.get("sym") or payload.get("symbol")
    symbol = resolve_symbol(app_symbol, payload) if app_symbol else None
    with LOCK:
        try:
            orders = mt5.orders_get(symbol=symbol) if symbol else mt5.orders_get()
            last_err = str(mt5.last_error()) if orders is None else ""
        except Exception as exc:
            return {"ok": False, "message": f"orders error: {exc}"}

    if orders is None:
        return {"ok": False, "message": f"Pending orders unavailable: {last_err}"}
    fields = ["ticket", "symbol", "type", "state", "time_setup", "time_expiration", "volume_initial", "volume_current", "price_open", "sl", "tp", "magic", "comment", "position_id"]
    return {"ok": True, "orders": [{k: getattr(order, k, None) for k in fields} for order in orders]}


def handle_cancel(payload):
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "message": msg}
    ticket = int(payload.get("ticket") or 0)
    if not ticket:
        return {"ok": False, "status": "order-unavailable", "message": "Ticket required"}

    with LOCK:
        try:
            orders = mt5.orders_get(ticket=ticket)
        except Exception as exc:
            return {"ok": False, "status": "order-unavailable", "message": f"Pending order lookup error: {exc}"}
        if orders is None:
            return {"ok": False, "status": "order-unavailable", "message": "Pending order lookup failed"}
        if not orders:
            try:
                positions = mt5.positions_get(ticket=ticket)
            except Exception:
                positions = None
            if positions:
                return {"ok": False, "status": "already-filled", "message": "Order absent from pending; active as position", "positionTicket": ticket}
            return {"ok": True, "status": "cancelled", "message": "Order confirmed absent from broker pending orders", "orderTicket": ticket}
        try:
            result = mt5.order_send({"action": mt5.TRADE_ACTION_REMOVE, "order": ticket})
        except Exception as exc:
            return {"ok": False, "ambiguous": True, "status": "reconciliation-required", "message": str(exc)}
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
    with LOCK:
        try:
            profit = mt5.order_calc_profit(mt5.ORDER_TYPE_BUY if action == "buy" else mt5.ORDER_TYPE_SELL, symbol, 1.0, entry, sl)
            acc = mt5.account_info()
            curr = acc.currency if acc else "USD"
        except Exception as exc:
            return {"ok": False, "message": f"Broker calc profit error: {exc}"}
    if profit is None or not math.isfinite(profit) or profit >= 0:
        return {"ok": False, "message": "Broker account-currency loss calculation unavailable"}
    return {"ok": True, "lossPerLot": -profit, "currency": curr}


def handle_state(payload):
    global _STATE_CACHE
    now_mono = time.monotonic()
    days = int(payload.get("days") or 7)
    with CACHE_LOCK:
        if _STATE_CACHE and (now_mono - _STATE_CACHE[0] < 1.0) and _STATE_CACHE[2] == days:
            return _STATE_CACHE[1]

    positions, orders, history, account = handle_positions({}), handle_orders({}), handle_history(payload), handle_account({})
    if not all(r.get("ok") for r in [positions, orders, history, account]):
        return {"ok": False, "message": "Incomplete broker snapshot"}
    now = datetime.now(timezone.utc)
    with LOCK:
        try:
            raw_orders = mt5.history_orders_get(now - timedelta(days=days), now + timedelta(days=1))
        except Exception:
            raw_orders = []
    if raw_orders is None:
        raw_orders = []
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
    res = {"ok": True, "positions": positions["positions"], "orders": orders["orders"], "history": history["history"], "account": account["account"], "requests": requests_list, "order_history": [{k: getattr(o, k, None) for k in order_fields} for o in raw_orders], "dailyPnl": pnl, "dayStartEquity": account["account"]["balance"] - pnl, "brokerDayStart": day_start, "at": now.timestamp()}
    with CACHE_LOCK:
        _STATE_CACHE = (now_mono, res, days)
    return res


def handle_account(_payload):
    """Get account balance, equity, margin, leverage."""
    global _ACCOUNT_CACHE
    now_mono = time.monotonic()
    with CACHE_LOCK:
        if _ACCOUNT_CACHE and (now_mono - _ACCOUNT_CACHE[0] < 1.5):
            return _ACCOUNT_CACHE[1]

    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "status": "not-connected", "message": msg}

    with LOCK:
        try:
            acc = mt5.account_info()
        except Exception as exc:
            return {"ok": False, "status": "account-error", "message": str(exc)}

    if not acc:
        return {"ok": False, "status": "account-error", "message": "Failed to get account info"}

    res = {
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
    with CACHE_LOCK:
        _ACCOUNT_CACHE = (now_mono, res)
    return res


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


class RobustThreadingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 64

    def handle_error(self, request, client_address):
        exc_type, exc_val, _ = sys.exc_info()
        if exc_type in (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            return  # Suppress normal client disconnection / abort
        if exc_type and issubclass(exc_type, socket.error):
            if getattr(exc_val, "winerror", None) in (10054, 10053, 10060, 10058):
                return  # Suppress Windows socket connection resets
        err_str = str(exc_val)
        if any(code in err_str for code in ("10054", "10053", "10060", "10058")):
            return
        super().handle_error(request, client_address)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True
        except socket.error as e:
            if getattr(e, "winerror", None) in (10054, 10053, 10060):
                self.close_connection = True
            else:
                raise

    def handle(self):
        try:
            super().handle()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True
        except socket.error as e:
            if getattr(e, "winerror", None) in (10054, 10053, 10060):
                self.close_connection = True
            else:
                raise

    def _send(self, status, obj):
        try:
            body = json.dumps(obj, default=str).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-NEXUS-MT5-TOKEN")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass
        except socket.error as e:
            if getattr(e, "winerror", None) in (10054, 10053, 10060):
                pass
        except Exception:
            pass
        finally:
            self.close_connection = True

    def _payload(self, parsed_path=None):
        payload = {}
        if parsed_path and parsed_path.query:
            for k, v in parse_qsl(parsed_path.query):
                payload[k] = v
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                if isinstance(body, dict):
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

        # /health is a non-blocking liveness probe: zero auth, zero semaphores, zero waiting
        if path == "/health":
            try:
                self._send(200, handler({}))
            except Exception as exc:
                self._send(500, {"ok": False, "status": "health-error", "message": str(exc)})
            return

        if not self._authorized():
            self._send(401, {"ok": False, "status": "unauthorized", "message": "MT5_TOKEN missing or invalid"})
            return

        # Acquire concurrency semaphore for data and execution routes (bounds active threads)
        acquired = HTTP_SEMAPHORE.acquire(timeout=8.0)
        if not acquired:
            self._send(503, {"ok": False, "status": 503, "message": "server busy - worker pool saturated"})
            return

        try:
            payload = self._payload(parsed)
            # Only write operations and state mutations require LOCK; read endpoints execute concurrently
            is_write = path in ["/order", "/modify", "/close", "/cancel"]
            if is_write:
                with LOCK:
                    result = durable_write(handler, payload)
            else:
                result = handler(payload)
            self._send(200, result)
        except Exception as exc:
            self._send(500, {"ok": False, "status": "bridge-exception", "message": str(exc)})
        finally:
            HTTP_SEMAPHORE.release()

    def address_string(self):
        """Return the client IP directly without blocking reverse DNS lookups (socket.getfqdn)."""
        return str(self.client_address[0])

    def log_message(self, fmt, *args):
        # Completely suppress all HTTP access logs to eliminate Windows console buffer deadlocks,
        # conhost memory growth, and stdout socket disconnects.
        pass


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
    init_journal()

    # Pre-bind the HTTP server on args.port so the port opens immediately (<0.05s)
    server = RobustThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[bridge] listening on http://{args.host}:{args.port}", flush=True)
    print(f"[bridge] auth: {'required (MT5_TOKEN set)' if TOKEN else 'OPEN - set MT5_TOKEN env var'}", flush=True)
    print("=" * 60, flush=True)

    # Initialize MT5 in a background thread so the HTTP server and port sentinel are never blocked at boot
    def _async_mt5_init():
        ok, msg = ensure_mt5()
        if not ok:
            print(f"[warn] MT5 not connected: {msg}", flush=True)
            print("[warn] Make sure MetaTrader 5 terminal is running and logged in.", flush=True)
        else:
            with LOCK:
                try:
                    info = mt5.account_info()
                    term = mt5.terminal_info()
                except Exception:
                    info, term = None, None
            if info:
                print(f"[mt5] account={info.login} server={info.server} balance={info.balance} {info.currency}", flush=True)
            if term:
                print(f"[mt5] terminal={term.name} build={term.build} connected={term.connected}", flush=True)

    threading.Thread(target=_async_mt5_init, daemon=True).start()

    # Proactive memory release, journal maintenance, and cache pruning for constrained VPS (1GB RAM)
    def _periodic_gc():
        import gc
        gc_counter = 0
        while True:
            time.sleep(30)
            try:
                gc_counter += 1
                now_mono = time.monotonic()
                with CACHE_LOCK:
                    expired_rates = [k for k, v in _RATES_CACHE.items() if (now_mono - v[0]) > 10.0]
                    for k in expired_rates:
                        _RATES_CACHE.pop(k, None)
                    if len(_RATES_CACHE) > 100:
                        oldest = sorted(_RATES_CACHE.items(), key=lambda item: item[1][0])[:len(_RATES_CACHE) - 100]
                        for k, _ in oldest:
                            _RATES_CACHE.pop(k, None)

                    expired_ticks = [k for k, v in _TICK_CACHE.items() if (now_mono - v[0]) > 5.0]
                    for k in expired_ticks:
                        _TICK_CACHE.pop(k, None)
                    if len(_TICK_CACHE) > 100:
                        oldest_t = sorted(_TICK_CACHE.items(), key=lambda item: item[1][0])[:len(_TICK_CACHE) - 100]
                        for k, _ in oldest_t:
                            _TICK_CACHE.pop(k, None)

                # Periodic SQLite journal pruning and checkpoint (every 5 minutes)
                # Purges transaction records older than 14 days and checkpoints WAL to eliminate disk/RAM clogging
                if gc_counter % 10 == 0:
                    try:
                        cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).timestamp()
                        with journal_connection() as conn:
                            conn.execute("DELETE FROM requests WHERE created < ?", (cutoff,))
                            conn.commit()
                            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                            if gc_counter % 60 == 0:
                                conn.execute("PRAGMA incremental_vacuum(50)")
                    except Exception:
                        pass

                gc.collect()
            except Exception:
                pass

    threading.Thread(target=_periodic_gc, daemon=True).start()

    # Active internal memory guard & working set trimmer
    def _health_watchdog():
        while True:
            time.sleep(15)
            try:
                # Memory guard: proactively trim caches and working set if RSS exceeds 350MB
                try:
                    import psutil
                    rss_mb = psutil.Process().memory_info().rss / (1024 * 1024)
                    if rss_mb > 350.0:
                        with CACHE_LOCK:
                            _RATES_CACHE.clear()
                            _TICK_CACHE.clear()
                        import gc
                        gc.collect()
                        try:
                            import ctypes
                            ctypes.windll.kernel32.SetProcessWorkingSetSize(-1, -1, -1)
                        except Exception:
                            pass
                except Exception:
                    pass
            except Exception:
                pass

    threading.Thread(target=_health_watchdog, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[bridge] shutting down...", flush=True)
    finally:
        if mt5:
            with LOCK:
                try:
                    mt5.shutdown()
                except Exception:
                    pass


if __name__ == "__main__":
    main()
