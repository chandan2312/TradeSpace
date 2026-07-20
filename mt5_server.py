"""
TradeSpace MT5 bridge — run on the Windows RDP next to MetaTrader 5.

Setup (once):
    pip install MetaTrader5

Run:
    set MT5_TOKEN=chandan-yashwant-chaudhari-2312
    python mt5_server.py --host 0.0.0.0 --port 8765

Then in TradeSpace's .env on your local box, keep:
    NEXUS_MT5_REMOTE_URL=http://<windows-public-ip>:8765
    NEXUS_MT5_REMOTE_TOKEN=chandan-yashwant-chaudhari-2312

Endpoints:
    GET  /health
    POST /tick     { "sym": "EURUSD" }
    POST /ticks    { "symbols": ["EURUSD", "XAUUSD"] }
    POST /rates    { "sym": "EURUSD", "timeframe": "M5", "count": 500 }
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import MetaTrader5 as mt5
except ImportError:
    raise SystemExit("MetaTrader5 package not installed. Run: pip install MetaTrader5")

TOKEN = os.getenv("MT5_TOKEN") or os.getenv("NEXUS_MT5_REMOTE_TOKEN") or ""
LOCK = threading.RLock()

# Common broker symbol aliases so the app can ask for "US30" and get "US30.cash" etc.
SYMBOL_ALIASES = {
    "DJ30":    ("DJ30", "DJI30", "US30", "US30.cash", "US30m", "DJI", "WallStreet30"),
    "NAS100":  ("NAS100", "NDX100", "US100", "USTEC", "USTEC.cash", "NAS100.cash", "NDX"),
    "SP500":   ("SP500", "SPX500", "US500", "SP500.cash", "SPX"),
    "EURUSD":  ("EURUSD", "EURUSD.", "EURUSDm", "EURUSD.pro"),
    "XAUUSD":  ("XAUUSD", "XAUUSD.", "XAUUSDm", "GOLD"),
    "BTCUSD":  ("BTCUSD", "BTCUSD.", "BTCUSDm", "BITCOIN"),
}

TF_MAP = {
    "M1":  mt5.TIMEFRAME_M1,
    "M5":  mt5.TIMEFRAME_M5,
    "M15": mt5.TIMEFRAME_M15,
    "M30": mt5.TIMEFRAME_M30,
    "H1":  mt5.TIMEFRAME_H1,
    "H4":  mt5.TIMEFRAME_H4,
    "D1":  mt5.TIMEFRAME_D1,
}


def ensure_mt5() -> tuple[bool, str]:
    """Make sure the shared MT5 terminal connection is alive. Reuses one init across requests."""
    info = mt5.terminal_info()
    if info is not None:
        return True, "ok"
    if not mt5.initialize():
        return False, f"initialize failed: {mt5.last_error()}"
    return True, "ok"


def resolve_symbol(app_symbol: str) -> str | None:
    """Try aliases, then substring-match against broker's Market Watch."""
    candidates = list(SYMBOL_ALIASES.get(app_symbol, (app_symbol,)))
    for name in dict.fromkeys(candidates):
        if mt5.symbol_select(name, True):
            return name
    available = mt5.symbols_get() or []
    lowered = {s.name.lower(): s.name for s in available}
    for name in dict.fromkeys(candidates):
        hit = lowered.get(name.lower())
        if hit and mt5.symbol_select(hit, True):
            return hit
    return None


def tick_dict(app_symbol: str) -> dict:
    symbol = resolve_symbol(app_symbol)
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
    return tick_dict(app_symbol)


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
    ticks = {s: tick_dict(s) for s in dict.fromkeys(symbols)}
    ok_count = sum(1 for t in ticks.values() if t.get("ok"))
    return {
        "ok": ok_count > 0,
        "status": "ticks" if ok_count == len(ticks) else "ticks-partial",
        "ticks": ticks,
        "ok_count": ok_count,
        "total": len(ticks),
    }


def handle_symbols(payload):
    """List all symbols visible to the terminal. Filter by substring + market path."""
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


def handle_rates(payload):
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "status": "not-connected", "message": msg}
    app_symbol = str(payload.get("sym") or payload.get("symbol") or "").strip().upper()
    if not app_symbol:
        return {"ok": False, "status": "bad-request", "message": "sym required"}
    symbol = resolve_symbol(app_symbol)
    if not symbol:
        return {"ok": False, "status": "symbol-missing", "message": f"no MT5 symbol for {app_symbol}"}
    tf_name = str(payload.get("timeframe") or payload.get("tf") or "M5").strip().upper()
    tf_const = TF_MAP.get(tf_name)
    if tf_const is None:
        return {"ok": False, "status": "bad-request", "message": f"unsupported timeframe {tf_name}"}
    count = max(1, min(int(payload.get("count") or 500), 5000))
    offset = max(0, int(payload.get("offset") or 0))

    rates = None
    for attempt in (
        lambda: mt5.copy_rates_from_pos(symbol, tf_const, offset, count),
        # Fallback: fetch using a time far in the future to ensure we get the latest bars
        lambda: mt5.copy_rates_from(symbol, tf_const, int(datetime.now().timestamp()) + 86400, count) if offset == 0 else None,
    ):
        try:
            rates = attempt()
        except Exception:
            rates = None
        if rates is not None and len(rates) > 0:
            break

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
    for app_symbol in dict.fromkeys(symbols):
        symbol = resolve_symbol(app_symbol)
        if not symbol:
            continue
        rates = None
        for attempt in (
            lambda: mt5.copy_rates_from_pos(symbol, tf_const, 0, count),
            lambda: mt5.copy_rates_from(symbol, tf_const, int(datetime.now().timestamp()) + 86400, count),
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

    return {
        "ok": True,
        "status": "bulk-rates",
        "timeframe": tf_name,
        "count": count,
        "data": results,
    }


def handle_order(payload):
    ok, msg = ensure_mt5()
    if not ok:
        return {"ok": False, "status": "not-connected", "message": msg}
    
    action = str(payload.get("action") or "").strip().lower()
    symbol = str(payload.get("symbol") or "").strip().upper()
    volume = float(payload.get("volume") or 0.01)
    sl = float(payload.get("sl") or 0.0)
    tp = float(payload.get("tp") or 0.0)
    
    if not action or not symbol:
        return {"ok": False, "status": "bad-request", "message": "action and symbol required"}
        
    mt5_symbol = resolve_symbol(symbol)
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
        
    price = tick.ask if order_type == mt5.ORDER_TYPE_BUY else tick.bid
    
    # Determine filling mode
    filling = mt5.ORDER_FILLING_IOC
    if sym_info.filling_mode & mt5.SYMBOL_FILLING_FOK:
        filling = mt5.ORDER_FILLING_FOK
    elif sym_info.filling_mode & mt5.SYMBOL_FILLING_IOC:
        filling = mt5.ORDER_FILLING_IOC
        
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": mt5_symbol,
        "volume": volume,
        "type": order_type,
        "price": price,
        "sl": sl,
        "tp": tp,
        "deviation": 20,
        "magic": 231223,
        "comment": "TradeSpace Algo",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": filling,
    }
    
    result = mt5.order_send(request)
    if not result or result.retcode != mt5.TRADE_RETCODE_DONE:
        err_msg = result.comment if result else "unknown error"
        retcode = result.retcode if result else "none"
        return {
            "ok": False, 
            "status": "order-failed", 
            "message": f"Order failed: {err_msg} ({retcode})"
        }
        
    return {
        "ok": True, 
        "status": "order-filled", 
        "ticket": result.order,
        "price": result.price,
        "volume": result.volume
    }


def handle_modify(payload):
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
    
    request = {
        "action": mt5.TRADE_ACTION_SLTP,
        "symbol": pos.symbol,
        "position": ticket,
        "sl": sl if sl > 0 else pos.sl,
        "tp": tp if tp > 0 else pos.tp,
        "magic": pos.magic,
    }
    
    result = mt5.order_send(request)
    if not result or result.retcode != mt5.TRADE_RETCODE_DONE:
        err_msg = result.comment if result else "unknown error"
        retcode = result.retcode if result else "none"
        return {
            "ok": False, 
            "status": "modify-failed", 
            "message": f"Modify failed: {err_msg} ({retcode})"
        }
        
    return {
        "ok": True, 
        "status": "modified", 
        "ticket": ticket,
        "sl": sl,
        "tp": tp
    }


ROUTES = {
    ("GET",  "/health"): handle_health,
    ("POST", "/health"): handle_health,
    ("POST", "/tick"):    handle_tick,
    ("POST", "/ticks"):   handle_ticks,
    ("POST", "/rates"):   handle_rates,
    ("POST", "/bulk-rates"): handle_bulk_rates,
    ("POST", "/symbols"): handle_symbols,
    ("GET",  "/symbols"): handle_symbols,
    ("POST", "/order"):   handle_order,
    ("POST", "/modify"):  handle_modify,
}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, obj):
        body = json.dumps(obj, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _payload(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            return {}

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
        handler = ROUTES.get((method, self.path))
        if not handler:
            self._send(404, {"ok": False, "status": "not-found", "message": f"unknown route {method} {self.path}"})
            return
        if not self._authorized():
            self._send(401, {"ok": False, "status": "unauthorized", "message": "MT5_TOKEN missing or invalid"})
            return
        try:
            payload = self._payload() if method == "POST" else {}
            with LOCK:
                result = handler(payload)
            self._send(200, result)
        except Exception as exc:
            self._send(500, {"ok": False, "status": "bridge-exception", "message": str(exc)})

    def log_message(self, fmt, *args):
        print(f"[mt5-bridge] {self.address_string()} {fmt % args}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0", help="0.0.0.0 to accept remote connections")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    print("=" * 60, flush=True)
    ok, msg = ensure_mt5()
    if not ok:
        print(f"[warn] MT5 not connected yet: {msg}", flush=True)
        print("[warn] Make sure MetaTrader 5 terminal is running and logged in.", flush=True)
    else:
        info = mt5.account_info()
        term = mt5.terminal_info()
        if info:
            print(f"[mt5] account={info.login} server={info.server} balance={info.balance} {info.currency}", flush=True)
        if term:
            print(f"[mt5] terminal={term.name} build={term.build} connected={term.connected}", flush=True)

    print(f"[bridge] listening on http://{args.host}:{args.port}", flush=True)
    print(f"[bridge] auth: {'required (MT5_TOKEN set)' if TOKEN else 'OPEN — set MT5_TOKEN env var to require a bearer token'}", flush=True)
    print("=" * 60, flush=True)

    try:
        ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\n[bridge] shutting down…", flush=True)
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
