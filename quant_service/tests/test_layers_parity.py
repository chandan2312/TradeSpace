"""Parity: structure / liquidity / volume / buildup / reversals / playbook vs JS fixtures."""

import numpy as np
import pytest

from quant_service.core import buildup as B
from quant_service.core import liquidity as L
from quant_service.core import playbook as PB
from quant_service.core import reversals as R
from quant_service.core import structure as S
from quant_service.core import volume as V
from quant_service.tests.frames import fixture, load_frames

TOL = 1e-9
ROWS = fixture("layers")


@pytest.fixture(scope="module", params=ROWS, ids=lambda r: f"{r['symbol']}@{r['cut']}")
def row(request):
    return request.param


@pytest.fixture(scope="module")
def frames(row):
    f = load_frames(row["symbol"], row["cut"])
    assert f is not None
    return f


def approx(a, b):
    assert a == pytest.approx(b, abs=TOL)


def test_session_of(row, frames):
    got = L.session_of(int(frames["M15"].time[-1]))
    assert got["id"] == row["session"]["id"]


@pytest.mark.parametrize("tf", ["M15", "H1", "H4"])
def test_structure(row, frames, tf):
    got = S.analyze_structure(frames[tf], row["avgRange"][tf])
    exp = row["structure"][tf]
    assert (got["dir"], got["seq"], got["ranging"]) == (exp["dir"], exp["seq"], exp["ranging"])
    approx(got["strength"], exp["strength"])
    assert len(got["events"]) == len(exp["events"])
    for g, e in zip(got["events"], exp["events"]):
        assert (g["type"], g["dir"], g["i"], g["displaced"]) == (e["type"], e["dir"], e["i"], e["displaced"])
        approx(g["level"], e["level"])
    if exp["lastEvent"] is None:
        assert got["lastEvent"] is None
    else:
        assert got["lastEvent"]["age"] == exp["lastEvent"]["age"]


def test_liquidity_levels(row, frames):
    got = L.liquidity_map(frames["M15"], row["avgRange"]["M15"])
    exp = row["liquidityM15"]
    assert len(got["levels"]) == len(exp["levels"])
    for g, e in zip(got["levels"], exp["levels"]):
        assert (g["name"], g["side"], g["formedAt"], g["state"]) == (e["name"], e["side"], e["formedAt"], e["state"])
        approx(g["price"], e["price"])
        assert g.get("brokenAt") == e.get("brokenAt")

    assert [(s["name"], s["sweptAt"], s["age"]) for s in got["sweeps"]] == [
        (s["name"], s["sweptAt"], s["age"]) for s in exp["sweeps"]
    ]
    for side in ("above", "below"):
        assert np.allclose([d["price"] for d in got["draws"][side]], [d["price"] for d in exp["draws"][side]], atol=TOL)
    assert [(b["side"], b["touches"], b["lastI"]) for b in got["builds"]] == [
        (b["side"], b["touches"], b["lastI"]) for b in exp["builds"]
    ]


def test_qml(row, frames):
    got = L.detect_qml(frames["M15"], row["avgRange"]["M15"])
    exp = row["qmlM15"]
    if exp is None:
        assert got is None
    else:
        assert (got["dir"], got["age"], got["i"]) == (exp["dir"], exp["age"], exp["i"])


def test_volume_profiles(row, frames):
    got = V.profiles(frames["M15"], row["avgRange"]["M15"])
    exp = row["volumeM15"]
    for key in ("prior", "today", "dealing"):
        g, e = got[key], exp[key]
        if e is None:
            assert g is None, key
            continue
        assert g is not None, key
        for f in ("poc", "vah", "val", "total"):
            approx(g[f], e[f])
        for nk in ("hvns", "lvns"):
            assert len(g[nk]) == len(e[nk])
            assert np.allclose([x["price"] for x in g[nk]], [x["price"] for x in e[nk]], atol=TOL)


def test_rel_participation(row, frames):
    got = V.rel_participation(frames["M15"])
    exp = row["relParticipationM15"]
    assert (got is None) == (exp is None)
    if exp is not None:
        approx(got, exp)


def test_buildup(row, frames):
    got = B.detect_trendline_liquidity(frames["M15"], row["avgRange"]["M15"])
    exp = row["buildupM15"]
    for key in ("draws", "sweeps"):
        g, e = got.get(key, []), exp.get(key, [])
        assert len(g) == len(e), key
        for a, b in zip(g, e):
            assert (a["type"], a["side"], a["touches"], a["note"]) == (b["type"], b["side"], b["touches"], b["note"])
            assert a["start"]["i"] == b["start"]["i"] and a["end"]["i"] == b["end"]["i"]
            assert a.get("age") == b.get("age")


def test_strong_levels(row, frames):
    got = R.strong_levels(frames["H4"], row["avgRange"]["H4"])
    exp = row["strongLevelsH4"]
    assert len(got) == len(exp)
    for g, e in zip(got, exp):
        assert (g["side"], g["i"], g["age"], g["kind"], g["grade"]) == (e["side"], e["i"], e["age"], e["kind"], e["grade"])
        approx(g["price"], e["price"])


def test_reversal_signals(row, frames):
    avg = row["avgRange"]["M15"]
    bars = frames["M15"]
    exp = row["reversalsM15"]
    for fn, key in ((R.sweep_wick_candle, "sweepWick"), (R.v_reversal, "vReversal"), (R.grind_then_displacement, "grind")):
        got, e = fn(bars, avg), exp[key]
        if e is None:
            assert got is None, key
            continue
        assert got is not None, key
        for f in ("kind", "dir", "i", "age"):
            assert got[f] == e[f], (key, f)
        if "extreme" in e:
            approx(got["extreme"], e["extreme"])


def test_playbook(row, frames):
    avg = row["avgRange"]["M15"]
    sweeps = L.liquidity_map(frames["M15"], avg)["sweeps"]
    got = PB.detect_setup(sweeps, frames["M15"])
    exp = row["playbookM15"]
    if exp is None:
        assert got is None
    else:
        assert got == exp


def test_grind_then_displacement_synthetic():
    """The archive never triggers this detector, so parity on it needs a made-up
    case. Expected values captured from the JS implementation on these exact bars."""
    import random

    recs, px, t = [], 100.0, 1_700_000_000
    random.seed(7)
    for i in range(30):
        o = px
        c = o + random.uniform(-0.6, 0.6)
        recs.append({"time": t + i * 900, "open": o, "high": max(o, c) + 0.3, "low": min(o, c) - 0.3, "close": c, "v": 100 + i})
        px = c
    for i in range(10):  # slow downward grind: small bodies, no impulses
        o, c = px, px - 0.18
        recs.append({"time": t + (30 + i) * 900, "open": o, "high": o + 0.05, "low": c - 0.05, "close": c, "v": 80})
        px = c
    o, c = px, px + 3.0  # displacement up
    recs.append({"time": t + 40 * 900, "open": o, "high": c + 0.1, "low": o - 0.1, "close": c, "v": 400})

    from quant_service.core.bars import Bars
    from quant_service.core.patterns import avg_range

    bars = Bars.from_records(recs)
    avg = avg_range(bars)
    approx(avg, 0.7509130411001865)
    assert R.grind_then_displacement(bars, avg) == {
        "kind": "grind→displacement", "dir": 1, "i": 40, "age": 0, "ratio": 16.7,
    }


def test_fixtures_are_not_vacuous():
    assert sum(len(r["liquidityM15"]["sweeps"]) for r in ROWS) > 10
    assert sum(len(r["structure"]["M15"]["events"]) for r in ROWS) > 50
    assert sum(len(r["strongLevelsH4"]) for r in ROWS) > 0
