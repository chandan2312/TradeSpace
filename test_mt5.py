import MetaTrader5 as mt5

if not mt5.initialize():
    print("initialize() failed")
    mt5.shutdown()

rates1 = mt5.copy_rates_from_pos("EURUSD", mt5.TIMEFRAME_H1, 0, 5)
print("pos 0, count 5:")
for r in rates1: print(r['time'])

rates2 = mt5.copy_rates_from_pos("EURUSD", mt5.TIMEFRAME_H1, 5, 5)
print("pos 5, count 5:")
for r in rates2: print(r['time'])

mt5.shutdown()
