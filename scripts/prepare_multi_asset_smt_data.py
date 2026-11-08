import os
import sys
import time
import struct
import json
import datetime as dt
import polars as pl

def convert_fx_csv(symbol, in_csv_15, in_csv_1, out_dir):
    sym_lower = symbol.lower()
    print(f"\n===============================================================================")
    print(f" PROCESSING {symbol} (15M JSON + 1M BINARY BUFFER)")
    print(f"===============================================================================")
    
    # 1. 15M JSON Export
    if os.path.exists(in_csv_15):
        print(f"Reading 15M CSV: {in_csv_15}...")
        t0 = time.time()
        # Format: 2017-01-02 00:00\t1.0523\t1.0526\t1.05199\t1.05205\t33.63
        df15 = pl.read_csv(
            in_csv_15,
            separator="\t",
            has_header=False,
            new_columns=["timestamp", "open", "high", "low", "close", "volume"],
        )
        df15 = df15.with_columns(
            pl.col("timestamp").str.strptime(pl.Datetime, "%Y-%m-%d %H:%M")
        )
        df15 = df15.filter(pl.col("timestamp") >= pl.datetime(2021, 1, 1))
        df15 = df15.sort("timestamp")
        print(f"Filtered {symbol} 15M: {len(df15)} bars ({df15['timestamp'].min()} to {df15['timestamp'].max()}) in {time.time()-t0:.1f}s")
        
        ts15 = df15["timestamp"].dt.timestamp("ms").to_list()
        o15 = df15["open"].to_list()
        h15 = df15["high"].to_list()
        l15 = df15["low"].to_list()
        c15 = df15["close"].to_list()
        v15 = df15["volume"].to_list()
        
        records15 = [{"t": int(ts15[i]/1000), "open": float(o15[i]), "high": float(h15[i]), "low": float(l15[i]), "close": float(c15[i]), "volume": float(v15[i])} for i in range(len(df15))]
        out_json_15 = os.path.join(out_dir, f"{sym_lower}_15m.json")
        with open(out_json_15, "w", encoding="utf-8") as f:
            json.dump(records15, f)
        print(f"Saved {out_json_15} ({os.path.getsize(out_json_15)/(1024*1024):.2f} MB)")
    
    # 2. 1M Binary Export
    if in_csv_1 and os.path.exists(in_csv_1):
        print(f"\nReading 1M CSV: {in_csv_1}...")
        t0 = time.time()
        df1 = pl.read_csv(
            in_csv_1,
            separator="\t",
            has_header=False,
            new_columns=["timestamp", "open", "high", "low", "close", "volume"],
        )
        df1 = df1.with_columns(
            pl.col("timestamp").str.strptime(pl.Datetime, "%Y-%m-%d %H:%M")
        )
        df1 = df1.filter(pl.col("timestamp") >= pl.datetime(2021, 1, 1))
        df1 = df1.sort("timestamp")
        print(f"Filtered {symbol} 1M: {len(df1)} bars in {time.time()-t0:.1f}s")
        
        bin_path = os.path.join(out_dir, f"{sym_lower}_1m.bin")
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

def convert_parquet(symbol, p_15, p_1, out_dir):
    sym_lower = symbol.lower()
    print(f"\n===============================================================================")
    print(f" PROCESSING {symbol} FROM PARQUET")
    print(f"===============================================================================")
    
    if os.path.exists(p_15):
        print(f"Reading {p_15}...")
        df15 = pl.read_parquet(p_15)
        df15 = df15.filter(pl.col("timestamp") >= pl.datetime(2021, 1, 1))
        df15 = df15.sort("timestamp")
        print(f"{symbol} 15M: {len(df15)} bars")
        
        ts15 = df15["timestamp"].dt.timestamp("ms").to_list()
        o15 = df15["open"].to_list()
        h15 = df15["high"].to_list()
        l15 = df15["low"].to_list()
        c15 = df15["close"].to_list()
        v15 = df15["volume"].to_list() if "volume" in df15.columns else [100.0]*len(df15)
        
        records15 = [{"t": int(ts15[i]/1000), "open": float(o15[i]), "high": float(h15[i]), "low": float(l15[i]), "close": float(c15[i]), "volume": float(v15[i])} for i in range(len(df15))]
        out_json_15 = os.path.join(out_dir, f"{sym_lower}_15m.json")
        with open(out_json_15, "w", encoding="utf-8") as f:
            json.dump(records15, f)
        print(f"Saved {out_json_15} ({os.path.getsize(out_json_15)/(1024*1024):.2f} MB)")

def main():
    out_dir = r"R:\TradeSpace\quant_service\data"
    os.makedirs(out_dir, exist_ok=True)
    
    # 1. EURUSD (Primary FX) & GBPUSD (SMT Partner)
    convert_fx_csv("EURUSD", r"R:\TradeSpace\tick-data\EURUSD\EURUSD_15.csv", r"R:\TradeSpace\tick-data\EURUSD\EURUSD_1.csv", out_dir)
    convert_fx_csv("GBPUSD", r"R:\TradeSpace\tick-data\GBPUSD\GBPUSD_15.csv", None, out_dir)
    
    # 2. GER40 & SPX500
    convert_parquet("SPX500", r"R:\TradeSpace\tick-data\SPX500\SPX500_15.parquet", None, out_dir)
    convert_fx_csv("GER40", r"R:\TradeSpace\tick-data\GER40\GER40_15.csv", r"R:\TradeSpace\tick-data\GER40\GER40_1.csv", out_dir)
    
    print("\n===============================================================================")
    print(" ALL MULTI-ASSET & SMT PARTNER DATASETS PROCESSED SUCCESSFULLY!")
    print("===============================================================================")

if __name__ == "__main__":
    main()
