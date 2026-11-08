import polars as pl
import os
import json
import time

def export_aligned_dataset():
    root = r"R:\TradeSpace\tick-data"
    out_dir = r"R:\TradeSpace\quant_service\data"
    os.makedirs(out_dir, exist_ok=True)
    
    print("=== EXPORTING ALIGNED M15 DATASET (2021 - 2026) ===")
    t0 = time.time()
    
    # 1. Read NAS100 15M
    p_nas15 = os.path.join(root, "NAS100", "NAS100_15_unified_2012_2026.parquet")
    df_nas15 = pl.read_parquet(p_nas15)
    df_nas15 = df_nas15.filter(pl.col("timestamp") >= pl.datetime(2021, 1, 1, time_zone="UTC"))
    
    # 2. Read DJ30 15M
    p_dj15 = os.path.join(root, "DJ30", "DJ30_15.parquet")
    df_dj15 = pl.read_parquet(p_dj15)
    # DJ30 timestamp might be naive UTC
    if df_dj15.schema["timestamp"].time_zone is None:
        df_dj15 = df_dj15.with_columns(pl.col("timestamp").dt.replace_time_zone("UTC"))
    df_dj15 = df_dj15.filter(pl.col("timestamp") >= pl.datetime(2021, 1, 1, time_zone="UTC"))
    
    # 3. Read SPX500 15M
    p_spx15 = os.path.join(root, "SPX500", "SPX500_15.parquet")
    df_spx15 = pl.read_parquet(p_spx15)
    if df_spx15.schema["timestamp"].time_zone is None:
        df_spx15 = df_spx15.with_columns(pl.col("timestamp").dt.replace_time_zone("UTC"))
    df_spx15 = df_spx15.filter(pl.col("timestamp") >= pl.datetime(2021, 1, 1, time_zone="UTC"))
    
    print(f"NAS100 15M: {len(df_nas15)} bars ({df_nas15['timestamp'].min()} to {df_nas15['timestamp'].max()})")
    print(f"DJ30   15M: {len(df_dj15)} bars ({df_dj15['timestamp'].min()} to {df_dj15['timestamp'].max()})")
    print(f"SPX500 15M: {len(df_spx15)} bars ({df_spx15['timestamp'].min()} to {df_spx15['timestamp'].max()})")
    
    # Export M15 to fast JSON lines / compressed format for Node.js
    def to_records(df):
        ts = df["timestamp"].dt.timestamp("ms").to_list()
        o = df["open"].to_list()
        h = df["high"].to_list()
        l = df["low"].to_list()
        c = df["close"].to_list()
        v = df["volume"].to_list() if "volume" in df.columns else [100.0] * len(df)
        return [{"t": int(ts[i]/1000), "open": o[i], "high": h[i], "low": l[i], "close": c[i], "volume": v[i]} for i in range(len(df))]

    nas_records = to_records(df_nas15)
    dj_records = to_records(df_dj15)
    spx_records = to_records(df_spx15)
    
    with open(os.path.join(out_dir, "nas100_15m.json"), "w", encoding="utf-8") as f:
        json.dump(nas_records, f)
    with open(os.path.join(out_dir, "dj30_15m.json"), "w", encoding="utf-8") as f:
        json.dump(dj_records, f)
    with open(os.path.join(out_dir, "spx500_15m.json"), "w", encoding="utf-8") as f:
        json.dump(spx_records, f)
        
    print(f"Saved M15 JSON files in {time.time() - t0:.2f}s")
    
    # 4. Check NAS100 1M
    p_nas1 = os.path.join(root, "NAS100", "NAS100_1_multi_era.parquet")
    df_nas1 = pl.read_parquet(p_nas1)
    print(f"NAS100 1M: {len(df_nas1)} bars ({df_nas1['timestamp'].min()} to {df_nas1['timestamp'].max()})")
    
    # Export 1M to binary flat file (t: int64, o: f32, h: f32, l: f32, c: f32) -> 24 bytes per bar
    # 1.98M bars * 24 bytes = ~47 MB
    import struct
    bin_path = os.path.join(out_dir, "nas100_1m.bin")
    ts1 = df_nas1["timestamp"].dt.timestamp("ms").to_list()
    o1 = df_nas1["open"].to_list()
    h1 = df_nas1["high"].to_list()
    l1 = df_nas1["low"].to_list()
    c1 = df_nas1["close"].to_list()
    
    print("Writing binary 1M buffer for ultra-fast Node.js memory mapping...")
    with open(bin_path, "wb") as bf:
        for i in range(len(df_nas1)):
            bf.write(struct.pack("<Qffff", int(ts1[i]/1000), float(o1[i]), float(h1[i]), float(l1[i]), float(c1[i])))
            
    print(f"Saved {bin_path} ({os.path.getsize(bin_path)/(1024*1024):.2f} MB) in {time.time() - t0:.2f}s total!")

if __name__ == "__main__":
    export_aligned_dataset()
