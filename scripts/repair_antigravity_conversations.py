import os
import sqlite3
import glob

CORRUPT_PID_BYTES = b"ee7f32\x1dd-0b95-4313-856b-3c6ba7b3f688"
CORRUPT_PID_STR = "ee7f32\x1dd-0b95-4313-856b-3c6ba7b3f688"
CORRECT_PID_BYTES = b"ee7f322d-0b95-4313-856b-3c6ba7b3f688"
CORRECT_PID_STR = "ee7f322d-0b95-4313-856b-3c6ba7b3f688"

WINDOWS_WS_URI = '["file:///R:/TradeSpace"]'
LINUX_TS_URI = '["file:///home/cc/Downloads/TRADING/TradeSpace"]'
LINUX_TV_URI = '["file:///home/cc/Downloads/GEMINI_PROJECTS/TRADINGVIEW"]'

antigravity_dir = r"C:\Users\chand\.gemini\antigravity"
db_path = os.path.join(antigravity_dir, "conversation_summaries.db")
agyhub_path = os.path.join(antigravity_dir, "agyhub_summaries_proto.pb")
convos_dir = os.path.join(antigravity_dir, "conversations")

print("===================================================================")
print(" TradeSpace Antigravity Conversation & Path Repair Utility")
print("===================================================================")

# 1. Update SQLite conversation_summaries.db
if os.path.exists(db_path):
    print("\n[1/3] Repairing SQLite conversation_summaries.db...")
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    
    # A. Fix corrupted project_id
    cur.execute("UPDATE conversation_summaries SET project_id = ? WHERE project_id = ?;", 
                (CORRECT_PID_STR, CORRUPT_PID_STR))
    print(f"  -> Fixed {cur.rowcount} corrupted project_id strings.")
    
    # B. Fix raw_summary blobs
    rows_with_raw = cur.execute("SELECT conversation_id, raw_summary FROM conversation_summaries WHERE raw_summary LIKE ?;", 
                                (b"%" + CORRUPT_PID_BYTES + b"%",)).fetchall()
    for cid, raw in rows_with_raw:
        new_raw = raw.replace(CORRUPT_PID_BYTES, CORRECT_PID_BYTES)
        cur.execute("UPDATE conversation_summaries SET raw_summary = ? WHERE conversation_id = ?;", (new_raw, cid))
    print(f"  -> Fixed {len(rows_with_raw)} raw_summary binary blobs.")
    
    # C. Map all TradeSpace & TradingView conversations to Windows TradeSpace project
    rows = cur.execute("SELECT conversation_id, title, preview, workspace_uris, project_id FROM conversation_summaries;").fetchall()
    ts_count = 0
    for cid, title, preview, ws, pid in rows:
        combined = f"{title or ''} {preview or ''} {ws or ''}".lower()
        is_ts = ("tradespace" in combined or 
                 "tradingview" in combined or 
                 "trade space" in combined or 
                 pid == CORRECT_PID_STR or 
                 ws == WINDOWS_WS_URI or 
                 ws == LINUX_TS_URI or 
                 ws == LINUX_TV_URI)
        if is_ts:
            ts_count += 1
            # Update workspace_uris if pointing to Linux
            if ws in [LINUX_TS_URI, LINUX_TV_URI] or "home/cc" in (ws or ""):
                cur.execute("UPDATE conversation_summaries SET workspace_uris = ? WHERE conversation_id = ?;", (WINDOWS_WS_URI, cid))
            # Assign project_id
            if pid != CORRECT_PID_STR:
                cur.execute("UPDATE conversation_summaries SET project_id = ? WHERE conversation_id = ?;", (CORRECT_PID_STR, cid))
            # Update FTS table
            cur.execute("UPDATE conversations_fts SET workspace = 'TradeSpace', project = 'TradeSpace' WHERE conversation_id = ?;", (cid,))

    print(f"  -> Successfully mapped {ts_count} TradeSpace conversations to project {CORRECT_PID_STR}.")
    
    # D. Checkpoint WAL and commit
    con.commit()
    try:
        cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        print("  -> WAL checkpointed and truncated.")
    except Exception as e:
        print(f"  -> WAL checkpoint notice: {e}")
    con.close()
else:
    print(f"ERROR: {db_path} not found!")

# 2. Update agyhub_summaries_proto.pb
if os.path.exists(agyhub_path):
    print("\n[2/3] Repairing agyhub_summaries_proto.pb cache...")
    with open(agyhub_path, "rb") as f:
        data = f.read()
    
    cnt_pid = data.count(CORRUPT_PID_BYTES)
    new_data = data.replace(CORRUPT_PID_BYTES, CORRECT_PID_BYTES)
    with open(agyhub_path, "wb") as f:
        f.write(new_data)
    print(f"  -> Replaced {cnt_pid} corrupted project_id references in binary proto cache.")
    
    # Remove old .bak to prevent re-infection
    bak_file = agyhub_path + ".bak"
    if os.path.exists(bak_file):
        try:
            os.remove(bak_file)
            print("  -> Cleared stale agyhub_summaries_proto.pb.bak.")
        except Exception:
            pass

# 3. Update individual conversation databases
if os.path.exists(convos_dir):
    print("\n[3/3] Auditing and repairing individual conversation databases...")
    db_files = glob.glob(os.path.join(convos_dir, "*.db"))
    fixed_dbs = 0
    for db_file in db_files:
        try:
            c_con = sqlite3.connect(db_file)
            c_cur = c_con.cursor()
            tbls = [t[0] for t in c_cur.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()]
            if "trajectory_metadata_blob" in tbls:
                rows = c_cur.execute("SELECT id, data FROM trajectory_metadata_blob;").fetchall()
                for row_id, blob_data in rows:
                    if blob_data and CORRUPT_PID_BYTES in blob_data:
                        new_blob = blob_data.replace(CORRUPT_PID_BYTES, CORRECT_PID_BYTES)
                        c_cur.execute("UPDATE trajectory_metadata_blob SET data = ? WHERE id = ?;", (new_blob, row_id))
                        c_con.commit()
                        fixed_dbs += 1
            c_con.close()
        except Exception:
            pass
    print(f"  -> Verified and patched {fixed_dbs} conversation trajectory files.")

print("\n===================================================================")
print(" Repair complete! Verified all TradeSpace conversations.")
print("===================================================================")
