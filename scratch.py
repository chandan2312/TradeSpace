import MetaTrader5 as mt5
import sys

if not mt5.initialize():
    print("initialize() failed")
    sys.exit()

info = mt5.symbol_info("EURUSD")
if info:
    for k, v in info._asdict().items():
        print(f"{k}: {v}")
mt5.shutdown()
