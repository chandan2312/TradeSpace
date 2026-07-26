"""Parity: core/patterns.py vs the JS golden fixtures.

Every assertion here is "Python == what JS actually produced on real bars",
not "Python looks reasonable". Regenerate fixtures with
`node scripts/export_parity_fixtures.mjs` after any deliberate JS change.
"""

import numpy as np
import pytest

from quant_service.core import patterns as P
from quant_service.tests.frames import fixture, load_frames

TOL = 1e-9
ROWS = fixture("layers")


def _frames(row):
    f = load_frames(row["symbol"], row["cut"])
    assert f is not None, f"archive missing for {row['symbol']}"
    return f


@pytest.fixture(scope="module", params=ROWS, ids=lambda r: f"{r['symbol']}@{r['cut']}")
def row(request):
    return request.param


def test_slicing_matches_js(row):
    f = _frames(row)
    for tf in ("M15", "H1", "H4"):
        assert len(f[tf]) == row["bars"][tf]
        assert int(f[tf].time[-1]) == row["lastTime"][tf]


def test_avg_range(row):
    f = _frames(row)
    for tf in ("M15", "H1", "H4"):
        assert P.avg_range(f[tf]) == pytest.approx(row["avgRange"][tf], abs=TOL)


def test_rolling_avg_range_matches_scalar(row):
    """The precompute must equal the per-bar scalar it replaces."""
    bars = _frames(row)["M15"]
    roll = P.rolling_avg_range(bars)
    assert roll[-1] == pytest.approx(row["avgRange"]["M15"], abs=TOL)
    for i in (0, 5, 19, 20, 119, 120, len(bars) // 2, len(bars) - 1):
        assert roll[i] == pytest.approx(P.avg_range(bars.slice(0, i + 1)), abs=TOL)


@pytest.mark.parametrize(("lr", "key"), [((3, 3), "pivotsM15"), ((4, 4), "pivotsM15_44")])
def test_find_pivots(row, lr, key):
    bars = _frames(row)["M15"]
    got = P.find_pivots(bars, *lr)
    exp = row[key]
    for side in ("highs", "lows"):
        assert [p["i"] for p in got[side]] == [p["i"] for p in exp[side]]
        assert np.allclose([p["price"] for p in got[side]], [p["price"] for p in exp[side]], atol=TOL)


def test_pivot_masks_agree_with_find_pivots(row):
    bars = _frames(row)["M15"]
    hi, lo = P.pivot_masks(bars, 3, 3)
    piv = P.find_pivots(bars, 3, 3)
    assert list(np.flatnonzero(hi)) == [p["i"] for p in piv["highs"]]
    assert list(np.flatnonzero(lo)) == [p["i"] for p in piv["lows"]]


def test_detect_gaps(row):
    f = _frames(row)
    got = P.detect_gaps(f["M15"], row["avgRange"]["M15"], 4.0)
    exp = row["gapsM15"]
    assert [g["i"] for g in got] == [g["i"] for g in exp]
    assert [g["age"] for g in got] == [g["age"] for g in exp]
    assert np.allclose([g["gap"] for g in got], [g["gap"] for g in exp], atol=TOL)


@pytest.mark.parametrize("tf", ["M15", "H1"])
def test_fvg_zones(row, tf):
    f = _frames(row)
    got = P.fvg_zones(f[tf], row["avgRange"][tf])
    exp = row[f"fvg{tf}"]
    assert len(got) == len(exp)
    for g, e in zip(got, exp):
        assert (g["dir"], g["i"], g["age"], g["state"]) == (e["dir"], e["i"], e["age"], e["state"])
        assert g["invertedAt"] == e["invertedAt"]
        assert g["top"] == pytest.approx(e["top"], abs=TOL)
        assert g["bottom"] == pytest.approx(e["bottom"], abs=TOL)


@pytest.mark.parametrize("tf", ["M15", "H1"])
def test_order_blocks(row, tf):
    f = _frames(row)
    got = P.detect_order_blocks(f[tf], row["avgRange"][tf])
    exp = row[f"ob{tf}"]
    assert len(got) == len(exp)
    for g, e in zip(got, exp):
        assert (g["dir"], g["i"], g["age"], g["tapped"]) == (e["dir"], e["i"], e["age"], e["tapped"])
        assert g["top"] == pytest.approx(e["top"], abs=TOL)
        assert g["bottom"] == pytest.approx(e["bottom"], abs=TOL)


def test_fixtures_are_not_vacuous():
    """Guard against green tests that only prove both sides return nothing."""
    assert sum(len(r["fvgM15"]) for r in ROWS) > 0
    assert sum(len(r["obM15"]) for r in ROWS) > 0
    assert sum(len(r["pivotsM15"]["highs"]) for r in ROWS) > 50
