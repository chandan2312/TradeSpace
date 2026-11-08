#!/usr/bin/env python3
"""
Dukascopy Historical Candle Harvester for TradeSpace Telemetry Replay Engine.

Downloads 2 years of M15 bid candles across all 28 G8 FX pairs, resamples
them into clean H1 and H4 timeframes, and archives them as JSON files in
`data/dukascopy/` for fast, offline backtesting without MT5 bridge latency.

Usage:
    python3 scripts/scrape_dukascopy.py [--workers 4] [--start 2024-07-25] [--end 2026-07-25] [--force]
"""

import argparse
import concurrent.futures
import datetime as dt
import json
import logging
import os
import sys
import time

try:
    import dukascopy_python as dp
    import pandas as pd
except ImportError:
    print("Error: Required packages missing. Run: pip install --break-system-packages --user dukascopy-python pandas")
    sys.exit(1)

# All 28 conventional G8 FX crosses observed by Telemetry Engine
TELEMETRY_ANALYSIS_FX = [
    "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY", "USDCHF", "USDCAD",
    "EURGBP", "EURAUD", "EURNZD", "EURJPY", "EURCHF", "EURCAD",
    "GBPAUD", "GBPNZD", "GBPJPY", "GBPCHF", "GBPCAD",
    "AUDNZD", "AUDJPY", "AUDCHF", "AUDCAD",
    "NZDJPY", "NZDCHF", "NZDCAD",
    "CADJPY", "CADCHF", "CHFJPY",
]

def format_symbol(sym: str) -> str:
    """Convert EURUSD to EUR/USD required by dukascopy_python."""
    return f"{sym[:3]}/{sym[3:]}"

def df_to_records(df: pd.DataFrame) -> list:
    """Convert pandas DataFrame to list of bar objects matching replay.mjs format."""
    records = []
    for ts, row in df.iterrows():
        records.append({
            "time": int(ts.timestamp()),
            "open": round(float(row['open']), 5),
            "high": round(float(row['high']), 5),
            "low": round(float(row['low']), 5),
            "close": round(float(row['close']), 5),
            "v": round(float(row['volume']), 2)
        })
    return records

def harvest_symbol(sym: str, start_dt: dt.datetime, end_dt: dt.datetime, out_dir: str, force: bool = False):
    out_file = os.path.join(out_dir, f"{sym}.json")
    if not force and os.path.exists(out_file) and os.path.getsize(out_file) > 1000:
        return sym, True, "skipped (already exists)", 0

    t0 = time.time()
    duka_sym = format_symbol(sym)
    
    try:
        # Fetch M15 bid candles from Dukascopy
        df_m15 = dp.fetch(duka_sym, dp.INTERVAL_MIN_15, dp.OFFER_SIDE_BID, start_dt, end_dt)
        if df_m15 is None or df_m15.empty:
            return sym, False, "no data returned", 0

        # Ensure timestamp index is sorted and remove duplicates
        df_m15 = df_m15.sort_index()
        df_m15 = df_m15[~df_m15.index.duplicated(keep='first')]

        # Resample to H1 and H4
        df_h1 = df_m15.resample('1h').agg({
            'open': 'first',
            'high': 'max',
            'low': 'min',
            'close': 'last',
            'volume': 'sum'
        }).dropna()

        df_h4 = df_m15.resample('4h').agg({
            'open': 'first',
            'high': 'max',
            'low': 'min',
            'close': 'last',
            'volume': 'sum'
        }).dropna()

        # Build JSON document
        doc = {
            "symbol": sym,
            "start": start_dt.isoformat(),
            "end": end_dt.isoformat(),
            "harvested_at": dt.datetime.now().isoformat(),
            "counts": {
                "M15": len(df_m15),
                "H1": len(df_h1),
                "H4": len(df_h4)
            },
            "M15": df_to_records(df_m15),
            "H1": df_to_records(df_h1),
            "H4": df_to_records(df_h4)
        }

        # Atomic write
        tmp_file = out_file + ".tmp"
        with open(tmp_file, "w") as f:
            json.dump(doc, f)
        os.replace(tmp_file, out_file)

        elapsed = round(time.time() - t0, 1)
        msg = f"harvested M15 ({len(df_m15)}), H1 ({len(df_h1)}), H4 ({len(df_h4)}) in {elapsed}s"
        return sym, True, msg, len(df_m15)

    except Exception as e:
        return sym, False, f"error: {str(e)}", 0

def main():
    parser = argparse.ArgumentParser(description="Dukascopy FX Candle Harvester")
    parser.add_argument("--workers", type=int, default=4, help="Number of concurrent download threads (default: 4)")
    parser.add_argument("--start", type=str, default="2024-07-25", help="Start date YYYY-MM-DD (default: 2024-07-25)")
    parser.add_argument("--end", type=str, default="2026-07-25", help="End date YYYY-MM-DD (default: 2026-07-25)")
    parser.add_argument("--out", type=str, default="data/dukascopy", help="Output directory (default: data/dukascopy)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing files")
    parser.add_argument("--symbol", type=str, help="Harvest only a single symbol (optional)")
    args = parser.parse_args()

    start_dt = dt.datetime.strptime(args.start, "%Y-%m-%d")
    end_dt = dt.datetime.strptime(args.end, "%Y-%m-%d")
    
    os.makedirs(args.out, exist_ok=True)
    
    symbols = [args.symbol] if args.symbol else TELEMETRY_ANALYSIS_FX

    print(f"🚀 Starting Dukascopy Harvester across {len(symbols)} symbol(s)...")
    print(f"📅 Range: {args.start} to {args.end} (2 years)")
    print(f"📂 Output Directory: {args.out}")
    print(f"⚡ Threads: {args.workers}")
    print("-" * 60)

    t_start = time.time()
    healthy_symbols = 0
    total_bars_m15 = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(harvest_symbol, sym, start_dt, end_dt, args.out, args.force): sym 
            for sym in symbols
        }
        
        for idx, future in enumerate(concurrent.futures.as_completed(futures), 1):
            sym = futures[future]
            try:
                sym, ok, msg, count_m15 = future.result()
                status_icon = "✅" if ok else "❌"
                print(f"[{idx:02d}/{len(symbols):02d}] {status_icon} {sym:7s} -> {msg}")
                if ok and count_m15 > 0:
                    healthy_symbols += 1
                    total_bars_m15 += count_m15
            except Exception as exc:
                print(f"[{idx:02d}/{len(symbols):02d}] ❌ {sym:7s} -> exception generated: {exc}")

    total_time = round(time.time() - t_start, 1)
    print("-" * 60)
    print(f"🏆 Harvesting Complete in {total_time}s!")
    print(f"   • Healthy Symbols: {healthy_symbols} / {len(symbols)}")
    print(f"   • Total M15 Bars Harvested: {total_bars_m15:,}")

if __name__ == "__main__":
    main()
