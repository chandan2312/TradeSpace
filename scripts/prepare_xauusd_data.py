import os
import sys
import time
import struct
import datetime as dt
import pandas as pd
import polars as pl
import dukascopy_python as dp

def download_xagusd_m15(start_year=2021, end_year=2026):
    print("===============================================================================")
    print(" STEP 1: DOWNLOADING XAGUSD (SILVER) M15 SMT PARTNER DATA (2021-2026)")
    print("===============================================================================")
    
    out_dir_tick = r"R:\TradeSpace\tick-data\XAGUSD"
    out_dir_quant = r"R:\TradeSpace\quant_service\data"
    os.makedirs(out_dir_tick, exist_ok=True)
    os.makedirs(out_dir_quant, exist_ok=True)
    
    periods = []
    for y in range(start_year, end_year + 1):
        periods.append((dt.datetime(y, 1, 1), dt.datetime(y, 7, 1)))
        if y < 2026:
            periods.append((dt.datetime(y, 7, 1), dt.datetime(y + 1, 1, 1)))
        else:
            periods.append((dt.datetime(y, 7, 1), dt.datetime(y, 8, 15)))
            
    dfs = []
    total_bars = 0
    t0 = time.time()
    
    for s_dt, e_dt in periods:
        print(f"Downloading XAG/USD: {s_dt.strftime('%Y-%m-%d')} to {e_dt.strftime('%Y-%m-%d')}...", end=" ", flush=True)
        try:
            candles = dp.fetch_candles('XAG-USD', 15, dp.TimeUnit.MINUTE, dp.OfferSide.BID, s_dt, e_dt)
            df = dp.to_dataframe(candles)
            if df is not None and not df.empty:
                dfs.append(df)
                total_bars += len(df)
                print(f"OK ({len(df)} bars)")
            else:
                print("EMPTY")
        except Exception as e:
            print(f"ERROR: {e}")
            
    if not dfs:
        raise RuntimeError("Failed to download any XAGUSD data!")
        
    master_df = pd.concat(dfs)
    master_df = master_df[~master_df.index.duplicated(keep='first')]
    master_df = master_df.sort_index()
    # Drop non-numeric dukascopy metadata columns
    master_df = master_df[['open', 'high', 'low', 'close', 'volume']]
    
    print(f"\nDownloaded Total: {len(master_df)} unique M15 bars in {time.time() - t0:.1f}s")
    print(f"Date Span: {master_df.index.min()} to {master_df.index.max()}")
    
    # Save Parquet
    parquet_path = os.path.join(out_dir_tick, "XAGUSD_15.parquet")
    # Reset index to timestamp column
    pl_df = pl.from_pandas(master_df.reset_index())
    pl_df.write_parquet(parquet_path)
    print(f"Saved tick-data parquet: {parquet_path}")
    
    # Save JSON for fast Node.js ingestion
    records = []
    for ts, row in master_df.iterrows():
        records.append({
            "t": int(ts.timestamp()),
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": float(row.get("volume", 100.0)),
        })
        
    json_path = os.path.join(out_dir_quant, "xagusd_15m.json")
    import json
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(records, f)
    print(f"Saved quant JSON: {json_path} ({os.path.getsize(json_path)/(1024*1024):.2f} MB)")
    return json_path

def export_xauusd_data():
    print("\n===============================================================================")
    print(" STEP 2: EXPORTING XAUUSD (GOLD) 15M AND 1M DATASETS")
    print("===============================================================================")
    
    root = r"R:\TradeSpace\tick-data\XAUUSD"
    out_dir = r"R:\TradeSpace\quant_service\data"
    os.makedirs(out_dir, exist_ok=True)
    
    # 1. 15M Export
    p15 = os.path.join(root, "XAUUSD_15.parquet")
    print(f"Reading {p15}...")
    df15 = pl.read_parquet(p15)
    df15 = df15.filter(pl.col("timestamp") >= pl.datetime(2021, 1, 1))
    df15 = df15.sort("timestamp")
    print(f"XAUUSD 15M: {len(df15)} bars ({df15['timestamp'].min()} to {df15['timestamp'].max()})")
    
    ts15 = df15["timestamp"].dt.timestamp("ms").to_list()
    o15 = df15["open"].to_list()
    h15 = df15["high"].to_list()
    l15 = df15["low"].to_list()
    c15 = df15["close"].to_list()
    v15 = [100.0] * len(df15)
    
    records15 = [{"t": int(ts15[i]/1000), "open": o15[i], "high": h15[i], "low": l15[i], "close": c15[i], "volume": v15[i]} for i in range(len(df15))]
    out15 = os.path.join(out_dir, "xauusd_15m.json")
    import json
    with open(out15, "w", encoding="utf-8") as f:
        json.dump(records15, f)
    print(f"Saved {out15} ({os.path.getsize(out15)/(1024*1024):.2f} MB)")
    
    # 2. 1M Binary Export
    p1 = os.path.join(root, "XAUUSD_1.parquet")
    print(f"\nReading {p1}...")
    t0 = time.time()
    df1 = pl.read_parquet(p1)
    df1 = df1.filter(pl.col("timestamp") >= pl.datetime(2021, 1, 1))
    df1 = df1.sort("timestamp")
    print(f"XAUUSD 1M: {len(df1)} bars ({df1['timestamp'].min()} to {df1['timestamp'].max()}) in {time.time()-t0:.1f}s")
    
    bin_path = os.path.join(out_dir, "xauusd_1m.bin")
    ts1 = df1["timestamp"].dt.timestamp("ms").to_list()
    o1 = df1["open"].to_list()
    h1 = df1["high"].to_list()
    l1 = df1["low"].to_list()
    c1 = df1["close"].to_list()
    
    print("Writing binary 1M flat buffer (24 bytes per bar)...")
    with open(bin_path, "wb") as bf:
        for i in range(len(df1)):
            bf.write(struct.pack("<Qffff", int(ts1[i]/1000), float(o1[i]), float(h1[i]), float(l1[i]), float(c1[i])))
            
    print(f"Saved binary feed: {bin_path} ({os.path.getsize(bin_path)/(1024*1024):.2f} MB)")
    print("\nALL XAUUSD AND XAGUSD DATASETS PREPARED AND ALIGNED SUCCESSFULLY!")

if __name__ == "__main__":
    download_xagusd_m15()
    export_xauusd_data()
