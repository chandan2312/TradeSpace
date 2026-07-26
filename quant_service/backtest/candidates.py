"""Replay the whole archive once and emit every candidate trade, decided.

This is the expensive pass — one full 28-symbol bias sweep per M15 step, because
currency strength is a cross-sectional quantity and cannot be computed for one
pair in isolation. ~17 ms/step single-core over ~49k steps, so it is chunked
across processes and the result is cached to disk.

The output is deliberately *undecided by any threshold*: every row carries its
edge, scenario inputs, session and realized R. The walk-forward gate then slices
that table without re-running the sweep, which is what makes fold-by-fold
evaluation cheap enough to be honest.

No lookahead anywhere: frames come from `frames_at` (closed bars only), and each
row's outcome is resolved by `simulate_bracket` strictly after its trigger bar.
"""

from __future__ import annotations

import json
import os
from concurrent.futures import ProcessPoolExecutor, as_completed

import numpy as np

from ..config import SPEC_COUNTS
from ..core.engine import aggregate, compute_symbol_bias
from ..core.liquidity import session_of
from ..data.loader import ROOT, archive_symbols, frames_at, load_archive, step_times
from ..execution.bracket import plan_bracket
from ..execution.trigger import assess_execution_trigger
from .simulate import simulate_bracket, summarize

OUT_PATH = os.path.join(ROOT, "data", "candidates.json")


def _run_chunk(chunk):
    """One contiguous slice of the replay clock. Runs in its own process."""
    times, symbols, cfg = chunk
    data = {s: load_archive(s, mmap=True) for s in symbols}
    # index of each symbol's M15 bar at a given step time, for simulate's trigger_idx
    rows = []

    for t in times:
        frames = {}
        results = []
        for s in symbols:
            f = frames_at(data[s], t, SPEC_COUNTS)
            if f is None:
                continue
            frames[s] = f
            results.append(compute_symbol_bias(s, f))
        if len(results) < int(cfg.get("analysisMinSymbols") or 24):
            continue  # a partial basket makes strength incomparable across steps

        strength = {c["ccy"]: c["score"] for c in aggregate(results)["currencyStrength"]}
        by_symbol = {r["symbol"]: r for r in results}
        session = session_of(t)["id"]

        for s, f in frames.items():
            edge = strength.get(s[:3], 0) - strength.get(s[3:6], 0)
            if edge == 0:
                continue
            d = 1 if edge > 0 else -1
            ex = assess_execution_trigger(f, d, cfg)
            if not ex.get("ok") or ex.get("kind") != "sweep_reclaim":
                continue
            plan = plan_bracket(f, d, ex, s, cfg)
            if not plan["ok"]:
                continue

            full = data[s]["M15"]
            trigger_idx = int(np.searchsorted(full.time, plan["barTime"], side="left"))
            trade = simulate_bracket(full, trigger_idx, plan, cfg)
            r = by_symbol[s]
            rows.append({
                **trade,
                "t": int(t), "session": session, "edge": float(edge),
                "score": float(r["score"]), "phase": r["phase"], "confidence": float(r.get("confidence", 0)),
                "rr": float(plan["rr"]), "expiryBars": plan["expiryBars"],
            })
    return rows


def build_candidates(symbols=None, every: int = 1, cfg: dict | None = None, workers: int = 0,
                     limit: int | None = None, progress=None, checkpoint_dir: str | None = None):
    """Blocks are checkpointed to `checkpoint_dir` and skipped on a re-run.

    The full 28-symbol sweep is ~18 CPU-hours; on a box with a few hundred MB
    spare an OOM kill mid-run is routine. Resuming beats restarting.
    """
    cfg = cfg or {}
    symbols = symbols or archive_symbols()
    clock = load_archive(symbols[0])
    times = list(step_times(clock, SPEC_COUNTS, every=every))
    if limit:
        times = times[:limit]
    workers = workers or max(1, (os.cpu_count() or 4) - 2)

    # contiguous blocks, not round-robin: neighbouring steps share warm caches
    blocks = [list(b) for b in np.array_split(np.array(times), max(workers * 4, 32)) if len(b)]
    if checkpoint_dir:
        os.makedirs(checkpoint_dir, exist_ok=True)

    def ck(i):
        return os.path.join(checkpoint_dir, f"block_{i:04d}.json") if checkpoint_dir else None

    rows = []
    todo = []
    for i, b in enumerate(blocks):
        p = ck(i)
        if p and os.path.exists(p):
            with open(p) as f:
                rows.extend(json.load(f))
        else:
            todo.append((i, b))

    done = len(blocks) - len(todo)
    if progress and done:
        progress(done, len(blocks), len(rows))

    if workers == 1:
        # in-process path: avoids the forkserver + one extra data copy, which is
        # the only way this run survives on a memory-starved box.
        for i, b in todo:
            part = _run_chunk((b, symbols, cfg))
            rows.extend(part)
            p = ck(i)
            if p:
                with open(p, "w") as f:
                    json.dump(part, f)
            done += 1
            if progress:
                progress(done, len(blocks), len(rows))
    else:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_run_chunk, (b, symbols, cfg)): i for i, b in todo}
            for fut in as_completed(futures):
                part = fut.result()
                rows.extend(part)
                p = ck(futures[fut])
                if p:
                    with open(p, "w") as f:
                        json.dump(part, f)
                done += 1
                if progress:
                    progress(done, len(blocks), len(rows))

    rows.sort(key=lambda r: r["t"])
    return rows


def save(rows, path: str = OUT_PATH):
    with open(path, "w") as f:
        json.dump({"n": len(rows), "rows": rows}, f)
    return path


def load(path: str = OUT_PATH):
    with open(path) as f:
        return json.load(f)["rows"]


if __name__ == "__main__":
    import argparse
    import time

    ap = argparse.ArgumentParser()
    ap.add_argument("--every", type=int, default=1, help="M15 steps between sweeps")
    ap.add_argument("--limit", type=int, default=None, help="cap step count (smoke test)")
    ap.add_argument("--symbols", type=str, default=None, help="comma list; default all 28")
    ap.add_argument("--workers", type=int, default=0)
    ap.add_argument("--out", type=str, default=OUT_PATH)
    ap.add_argument("--checkpoint", type=str, default=os.path.join(ROOT, "data", "candidate_blocks"),
                    help="resume dir; '' to disable")
    a = ap.parse_args()

    syms = a.symbols.split(",") if a.symbols else None
    t0 = time.time()

    def tick(done, total, found):
        el = time.time() - t0
        eta = el / max(done, 1) * (total - done)
        print(f"  block {done}/{total} · {found} candidates · {el / 60:.1f}m elapsed · ~{eta / 60:.1f}m left", flush=True)

    rows = build_candidates(symbols=syms, every=a.every, workers=a.workers, limit=a.limit,
                            progress=tick, checkpoint_dir=a.checkpoint or None)
    dt = time.time() - t0

    s = summarize(rows)
    print(f"{len(rows)} candidates in {dt:.1f}s")
    print(json.dumps(s, indent=2))
    print("→", save(rows, a.out))
