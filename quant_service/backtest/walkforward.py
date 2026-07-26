"""Anchored walk-forward gate over the candidate table.

A single 70/30 split on 730 days is one regime, tested once. This runs anchored
folds — train grows, test steps forward — and reports **per fold**. Pooling is
how an edge that lived in one quarter gets sold as an edge that lives always.

Three rules do the real work:

- **Fixed thresholds, no search.** `algoMinEdge` is what it is. The JS
  `solveInflection` scans 9 edge x 7 score x 5 session and takes the first
  combination that passes, with no multiple-testing correction — that finds a
  cutoff in pure noise. Removing the search is what makes an OOS pass mean
  anything. The train side is used only to *report* what it would have shown.
- **Embargo.** A trade whose outcome resolves after the boundary shares bars
  with the other side of it. 24h either way, dropped.
- **Non-overlapping n.** 15-min steps with multi-hour holds overlap ~90%+, and
  the 28 G8 crosses are linearly dependent (EURUSD·GBPUSD ⇒ EURGBP). `n` counts
  trades that share no bars with an already-counted trade, so the promotion gate
  reads independent observations, not row count.
"""

from __future__ import annotations

import json
import os

import numpy as np

from ..data.loader import ROOT
from .candidates import load as load_candidates
from .simulate import summarize

DAY = 86_400
OUT_PATH = os.path.join(ROOT, "data", "walkforward_report.json")

TRAIN_DAYS = 365
TEST_DAYS = 90
STEP_DAYS = 90
EMBARGO_SEC = DAY

MIN_EXPECTANCY = 0.0
MIN_PROFIT_FACTOR = 1.30
MIN_SAMPLES = 30


def passes_filter(row: dict, cfg: dict) -> bool:
    """The FIXED entry filter. Nothing here is fitted to the data."""
    if abs(row["edge"]) < float(cfg.get("algoMinEdge") or 20):
        return False
    if abs(row["score"]) < float(cfg.get("algoMinScore") or 0):
        return False
    return True


def _exit_time(row: dict) -> int:
    """When this row stops depending on future bars. Held bars are M15."""
    bars = (row.get("barsToFill") or 0) + (row.get("barsHeld") or 0) + 1
    return int(row["t"]) + bars * 900


def independent_count(rows: list[dict]) -> int:
    """Greedy non-overlap: a trade counts only if it shares no bar with a counted
    one on the same symbol, and no calendar overlap with any counted trade.

    Cross-symbol overlap matters because the basket is linearly dependent — five
    simultaneous USD-leg trades are close to one observation, not five.
    """
    counted_until = -1
    n = 0
    for r in sorted(rows, key=lambda r: r["t"]):
        if int(r["t"]) >= counted_until:
            n += 1
            counted_until = _exit_time(r)
    return n


def fold_bounds(rows: list[dict]):
    if not rows:
        return []
    t0, t1 = int(rows[0]["t"]), int(rows[-1]["t"])
    out = []
    train_start = t0
    test_start = t0 + TRAIN_DAYS * DAY
    while test_start + TEST_DAYS * DAY <= t1:
        out.append((train_start, test_start, test_start + TEST_DAYS * DAY))
        test_start += STEP_DAYS * DAY
    return out


def run(rows: list[dict] | None = None, cfg: dict | None = None) -> dict:
    cfg = cfg or {}
    rows = rows if rows is not None else load_candidates()
    rows = [r for r in rows if r["outcome"] != "truncated"]
    rows.sort(key=lambda r: r["t"])
    kept = [r for r in rows if passes_filter(r, cfg)]

    folds = []
    for i, (tr0, te0, te1) in enumerate(fold_bounds(rows)):
        train = [r for r in kept if tr0 <= r["t"] and _exit_time(r) <= te0 - EMBARGO_SEC]
        test = [r for r in kept if te0 + EMBARGO_SEC <= r["t"] and _exit_time(r) <= te1]
        filled = [r for r in test if r["filled"]]
        folds.append({
            "fold": i,
            "trainFrom": tr0, "testFrom": te0, "testTo": te1,
            "train": summarize(train),
            "test": summarize(test),
            "independentN": independent_count(filled),
        })

    test_rows = [r for f, (tr0, te0, te1) in zip(folds, fold_bounds(rows))
                 for r in kept if te0 + EMBARGO_SEC <= r["t"] and _exit_time(r) <= te1]
    pooled = summarize(test_rows)
    pooled_n = independent_count([r for r in test_rows if r["filled"]])

    decided = [f for f in folds if f["test"].get("filled", 0) > 0]
    reasons = []
    if not decided:
        reasons.append("no fold produced a filled trade")
    for f in decided:
        if f["test"].get("expectancy", -1) <= MIN_EXPECTANCY:
            reasons.append(f"fold {f['fold']} expectancy {f['test'].get('expectancy'):.3f}R <= 0")
    if pooled.get("profitFactor", 0) < MIN_PROFIT_FACTOR:
        reasons.append(f"pooled PF {pooled.get('profitFactor', 0):.2f} < {MIN_PROFIT_FACTOR}")
    if pooled_n < MIN_SAMPLES:
        reasons.append(f"independent n {pooled_n} < {MIN_SAMPLES}")

    return {
        "config": {
            "algoMinEdge": float(cfg.get("algoMinEdge") or 20),
            "algoMinScore": float(cfg.get("algoMinScore") or 0),
            "trainDays": TRAIN_DAYS, "testDays": TEST_DAYS, "stepDays": STEP_DAYS,
            "embargoSec": EMBARGO_SEC,
        },
        "candidates": len(rows), "afterFilter": len(kept),
        "folds": folds,
        "pooledTest": pooled, "pooledIndependentN": pooled_n,
        "promote": not reasons,
        "blockedBy": reasons,
    }


def _fmt(report: dict) -> str:
    lines = [f"candidates {report['candidates']} → after filter {report['afterFilter']}", ""]
    lines.append(f"{'fold':>4} {'test window':>24} {'sig':>5} {'fill':>6} {'n*':>4} {'exp R':>7} {'PF':>6} {'win':>6}")
    for f in report["folds"]:
        t = f["test"]
        win = f"{t.get('winRate', 0) * 100:5.1f}%" if t.get("filled") else "    —"
        lines.append(
            f"{f['fold']:>4} {f['testFrom']:>11}..{f['testTo']:<11} {t['signals']:>5} "
            f"{t['fillRate'] * 100:5.1f}% {f['independentN']:>4} "
            f"{t.get('expectancy', float('nan')):>7.3f} {t.get('profitFactor', float('nan')):>6.2f} {win}"
        )
    p = report["pooledTest"]
    lines += ["", f"pooled OOS: {p.get('filled', 0)} filled / {p['signals']} signals "
                  f"({p['fillRate'] * 100:.1f}% fill), independent n={report['pooledIndependentN']}"]
    if p.get("filled"):
        lines.append(f"            expectancy {p['expectancy']:.3f}R · PF {p['profitFactor']:.2f} · "
                     f"win {p['winRate'] * 100:.1f}% · maxDD {p['maxDrawdownR']:.1f}R")
    lines.append("")
    lines.append("PROMOTE" if report["promote"] else "DO NOT PROMOTE: " + "; ".join(report["blockedBy"]))
    return "\n".join(lines)


def _selfcheck():
    base = {"outcome": "filled_tp", "filled": True, "r": 2.0, "edge": 30, "score": 50,
            "barsToFill": 0, "barsHeld": 3}
    rows = [{**base, "t": i * 900} for i in range(10)]
    assert independent_count(rows) == 3, independent_count(rows)  # each spans 4 M15 bars

    # the filter is fixed, not fitted
    assert passes_filter({"edge": 25, "score": 0}, {"algoMinEdge": 20})
    assert not passes_filter({"edge": 15, "score": 0}, {"algoMinEdge": 20})
    assert not passes_filter({"edge": -15, "score": 0}, {"algoMinEdge": 20})

    span = TRAIN_DAYS * DAY
    rows = ([{**base, "t": t} for t in range(0, span, DAY)]
            + [{**base, "t": span - 1000}, {**base, "t": span + 1000}]
            + [{**base, "t": t} for t in range(span + 2 * DAY, span + (TEST_DAYS + 5) * DAY, DAY)])
    rows.sort(key=lambda r: r["t"])
    rep = run(rows, {"algoMinEdge": 20})
    f0 = rep["folds"][0]
    in_test = {r["t"] for r in rows
               if f0["testFrom"] + EMBARGO_SEC <= r["t"] and _exit_time(r) <= f0["testTo"]}
    assert span + 1000 not in in_test, "embargoed row leaked into test"
    assert span - 1000 not in in_test, "train-side row leaked into test"
    assert in_test, "embargo ate the entire test window"

    losers = [{**base, "outcome": "filled_sl", "r": -1.0, "t": t}
              for t in range(0, span + TEST_DAYS * DAY, 3600)]
    assert not run(losers, {"algoMinEdge": 20})["promote"], "a pure loser promoted"

    # ...and a clean winner with enough independent samples must
    assert run(rows, {"algoMinEdge": 20})["promote"], "a pure winner failed to promote"
    print("walkforward ok")


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--selfcheck", action="store_true")
    ap.add_argument("--candidates", default=None)
    ap.add_argument("--min-edge", type=float, default=20)
    ap.add_argument("--min-score", type=float, default=0)
    ap.add_argument("--out", default=OUT_PATH)
    a = ap.parse_args()

    if a.selfcheck:
        _selfcheck()
    else:
        rows = load_candidates(a.candidates) if a.candidates else load_candidates()
        rep = run(rows, {"algoMinEdge": a.min_edge, "algoMinScore": a.min_score})
        print(_fmt(rep))
        with open(a.out, "w") as f:
            json.dump(rep, f, indent=2)
        print("\n→", a.out)
