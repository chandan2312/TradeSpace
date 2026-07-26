"""Parity: compute_symbol_bias + aggregate vs JS fixtures.

The exporter calls computeSymbolBias(symbol, frames) with NO extras, so the
SMT-divergence, risk-tape and news drives never fire here. That gap is real:
smt.py / news.py are covered by their own unit checks below, not by fixtures.
"""

import numpy as np
import pytest

from quant_service.core import news as N
from quant_service.core import smt as SMT
from quant_service.core.engine import aggregate, compute_symbol_bias
from quant_service.core.pairs import TELEMETRY_ANALYSIS_FX
from quant_service.tests.frames import fixture, load_frames

TOL = 1e-9
ROWS = fixture("bias")
AGGS = fixture("aggregate")


@pytest.fixture(scope="module", params=ROWS, ids=lambda r: f"{r['symbol']}@{r['cut']}")
def row(request):
    return request.param


@pytest.fixture(scope="module")
def got(row):
    f = load_frames(row["symbol"], row["cut"])
    assert f is not None
    return compute_symbol_bias(row["symbol"], f)


def test_scalars(row, got):
    exp = row["result"]
    for k in ("symbol", "category", "score", "phase", "confidence", "stability",
              "agreement", "session", "setup", "missing"):
        assert got[k] == exp[k], k
    assert got["dampMult"] == pytest.approx(exp["dampMult"], abs=TOL)


def test_layers_and_pillars(row, got):
    exp = row["result"]
    assert got["layers"] == exp["layers"]
    assert got["pillars"] == exp["pillars"]


def test_lenses(row, got):
    exp = row["result"]["lenses"]
    assert set(got["lenses"]) == set(exp)
    for lid, e in exp.items():
        g = got["lenses"][lid]
        assert (g["label"], g["score"], g["n"]) == (e["label"], e["score"], e["n"]), lid
        assert g["fitness"] == pytest.approx(e["fitness"], abs=TOL), lid


def test_factors(row, got):
    exp = row["result"]["factors"]
    assert len(got["factors"]) == len(exp)
    for g, e in zip(got["factors"], exp):
        assert g == e


def test_damps(row, got):
    exp = row["result"]["damps"]
    assert len(got["damps"]) == len(exp)
    for g, e in zip(got["damps"], exp):
        assert (g["label"], g["note"]) == (e["label"], e["note"])
        assert g["mult"] == pytest.approx(e["mult"], abs=TOL)


@pytest.mark.parametrize("agg", AGGS, ids=lambda a: f"cut{a['cut']}")
def test_aggregate(agg):
    results = []
    for symbol in TELEMETRY_ANALYSIS_FX:
        f = load_frames(symbol, agg["cut"])
        if f is None:
            continue
        results.append(compute_symbol_bias(symbol, f))
    assert len(results) == agg["nSymbols"]

    out = aggregate(results)  # mutates results in place, like the JS
    assert out["currencyStrength"] == agg["currencyStrength"]
    assert len(out["categories"]) == len(agg["categories"])
    for g, e in zip(out["categories"], agg["categories"]):
        assert g == e
    for r in results:
        e = agg["finalScores"][r["symbol"]]
        assert (r["score"], r["dir"], r["phase"]) == (e["score"], e["dir"], e["phase"]), r["symbol"]


def test_news_risk_windows():
    now = 1_700_000_000_000
    events = [
        {"currency": "USD", "title": "NFP", "at": now + 30 * 60_000},
        {"currency": "EUR", "title": "CPI", "at": now - 20 * 60_000},
        {"currency": "GBP", "title": "GDP", "at": now + 5 * 3600_000},  # too far out
        {"currency": "JPY", "title": "BoJ", "at": now + 10 * 60_000},   # wrong currency
    ]
    out = N.news_risk(events, ["USD", "EUR"], now_ms=now)
    assert [(e["title"], e["when"]) for e in out] == [("CPI", "released"), ("NFP", "upcoming")]
    assert out[0]["agoMin"] == 20 and out[1]["inMin"] == 30

    assert N.symbol_currencies("EURUSD", "fx") == ["EUR", "USD"]
    # JS uppercases before stripping the lowercase broker suffix, so /m$/ never
    # matches and "EURUSDm" falls through to the USD default. Reproduced on purpose.
    assert N.symbol_currencies("EURUSDm", "fx") == ["USD"]
    assert N.symbol_currencies("EURUSD.raw", "fx") == ["EUR", "USD"]
    assert N.symbol_currencies("GER40", "indices") == ["EUR"]
    assert N.symbol_currencies("XAUUSD", "metals") == ["USD"]


def test_smt_divergence_synthetic():
    """Symbol makes a higher high; partner fails to. Smart money didn't sponsor it.
    No fixture triggers SMT (the exporter passes no partnerFrames), so parity here
    is against values captured from the JS on these exact bars."""
    from quant_service.core.bars import Bars

    def build(second_high):
        anchors = {5: 99.0, 10: 102.0, 20: 98.5, 30: second_high, 35: 98.0}
        t = 1_700_000_000
        return Bars.from_records([
            {"time": t + i * 900, "open": (px := anchors.get(i, 100.0)), "high": px + 0.1,
             "low": px - 0.1, "close": px, "v": 100}
            for i in range(45)
        ])

    lead = build(103.0)
    assert SMT.smt_divergence(lead, build(101.0), "GBPUSD") == {
        "dir": -1, "note": "HH unconfirmed by GBPUSD"}
    assert SMT.smt_divergence(lead, build(103.5), "GBPUSD") is None

    assert SMT.risk_beta("XAUUSD", "metals") == -1
    assert SMT.risk_beta("AUDJPY", "fx") == 1
    assert SMT.risk_beta("EURUSD", "fx") == 0


def test_fixtures_are_not_vacuous():
    assert sum(len(r["result"]["factors"]) for r in ROWS) > 100
    assert sum(len(r["result"]["damps"]) for r in ROWS) > 5
    assert len({r["result"]["phase"] for r in ROWS}) >= 3
    assert any(r["result"]["setup"] for r in ROWS)
    assert any(r["result"]["stability"] is not None for r in ROWS)
