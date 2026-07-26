"""Currency-pair conventions. Mirror of lib/algo/pairs.js."""

CCY_ORDER = ["EUR", "GBP", "AUD", "NZD", "USD", "CAD", "CHF", "JPY"]

TRADEABLE_FX = [
    "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY", "USDCHF", "USDCAD",
    "EURJPY", "GBPJPY", "AUDJPY", "EURGBP", "EURAUD", "GBPAUD",
]

# All 28 conventional G8 crosses — every currency gets seven contributions.
TELEMETRY_ANALYSIS_FX = [
    "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY", "USDCHF", "USDCAD",
    "EURGBP", "EURAUD", "EURNZD", "EURJPY", "EURCHF", "EURCAD",
    "GBPAUD", "GBPNZD", "GBPJPY", "GBPCHF", "GBPCAD",
    "AUDNZD", "AUDJPY", "AUDCHF", "AUDCAD",
    "NZDJPY", "NZDCHF", "NZDCAD",
    "CADJPY", "CADCHF", "CHFJPY",
]

TELEMETRY_EXECUTION_FX = [
    "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY", "USDCHF", "USDCAD",
    "EURJPY", "GBPJPY", "AUDJPY", "NZDJPY", "CADJPY", "CHFJPY",
    "GBPCHF", "GBPCAD", "EURCHF", "EURCAD",
]

TELEMETRY_ANALYSIS_UNIVERSE = "g8-28-v1"

CCY = ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"]

_METALS = ("XAU", "XAG", "GOLD", "SILVER", "XPT", "XPD")
_CRYPTO = ("BTC", "ETH", "XRP", "SOL", "LTC", "DOGE", "ADA", "BNB")
_INDICES = (
    "US30", "DJ30", "NAS100", "USTEC", "NDX", "US100", "SPX", "US500", "SP500",
    "GER40", "DAX", "DE40", "UK100", "FTSE", "JP225", "NIK", "AUS200", "HK50", "STOXX",
)
_ENERGY = ("USOIL", "UKOIL", "WTI", "BRENT", "XTI", "XBR", "NGAS")


def normalize(symbol: str) -> str:
    """Strip broker suffixes: 'EURUSD.m' / 'EURUSD_i' / 'EURUSDm' -> 'EURUSD'."""
    s = symbol.upper()
    for sep in (".", "_", "-"):
        if sep in s:
            s = s.split(sep)[0]
    if s.endswith("M"):
        # only strip a trailing broker 'm' when what remains is still a real symbol
        if len(s) == 7 and s[:3] in CCY and s[3:6] in CCY:
            s = s[:6]
    return s


def classify_symbol(symbol: str) -> str:
    s = normalize(symbol)
    if s.startswith(_METALS):
        return "metals"
    if s.startswith(_CRYPTO):
        return "crypto"
    if any(tag in s for tag in _INDICES):
        return "indices"
    if len(s) == 6 and s[:3] in CCY and s[3:] in CCY:
        return "fx"
    if s.startswith(_ENERGY):
        return "energy"
    return "stocks"


def get_pair(strong: str, weak: str):
    """strong+weak -> {'symbol', 'dir'} where dir is on the SYMBOL (1 buy / -1 sell)."""
    if strong == weak or strong not in CCY_ORDER or weak not in CCY_ORDER:
        return None
    si, wi = CCY_ORDER.index(strong), CCY_ORDER.index(weak)
    if si < wi:
        return {"symbol": f"{strong}{weak}", "dir": 1}
    return {"symbol": f"{weak}{strong}", "dir": -1}


def pip_size(symbol: str) -> float:
    return 0.01 if "JPY" in symbol.upper() else 0.0001


def minimum_stop_pips(symbol: str, cfg: dict | None = None) -> float:
    """JPY/CAD symbols need the wider 15-pip floor; everything else 10."""
    cfg = cfg or {}
    s = symbol.upper()
    if "JPY" in s or "CAD" in s:
        return max(15.0, float(cfg.get("algoMinStopJpyCadPips") or 15))
    return max(10.0, float(cfg.get("algoMinStopPips") or 10))


def stop_distance(symbol: str, atr: float, cfg: dict | None = None) -> float:
    cfg = cfg or {}
    atr_distance = float(cfg.get("algoSlAtrMult") or 3) * atr
    return max(atr_distance, minimum_stop_pips(symbol, cfg) * pip_size(symbol))
