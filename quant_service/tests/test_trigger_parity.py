"""Parity: execution/trigger.py vs the JS golden fixtures.

Regenerate with `node scripts/export_trigger_fixtures.mjs` after any deliberate
change to assessExecutionTrigger in lib/telemetry/core.js.
"""

import pytest

from quant_service.execution.trigger import assess_execution_trigger
from quant_service.tests.frames import fixture, load_frames

ROWS = fixture("trigger")["cases"]


@pytest.fixture(scope="module", params=ROWS, ids=lambda r: f"{r['symbol']}@{r['cut']}:{r['dir']}")
def row(request):
    return request.param


def test_trigger_matches_js(row):
    f = load_frames(row["symbol"], row["cut"])
    assert f is not None, f"archive missing for {row['symbol']}"
    got, want = assess_execution_trigger(f, row["dir"]), row["out"]

    assert got["ok"] == want["ok"]
    assert got["stage"] == want["stage"]
    assert got["reason"] == want["reason"]
    assert got.get("kind") == want.get("kind")
    assert got.get("m15BarTime") == want.get("m15BarTime")

    if want.get("level"):
        assert got["level"] == want["level"]

    for g, w in zip(got.get("htf") or [], want.get("htf") or []):
        assert g["tf"] == w["tf"]
        assert g["aligned"] == w["aligned"]
        assert g["opposing"] == w["opposing"]
        assert (g["source"] or {}).get("type") == (w["source"] or {}).get("type")
        assert (g["source"] or {}).get("level") == (w["source"] or {}).get("level")


def test_fixtures_are_not_vacuous():
    """Green tests are worthless if the trigger never fires in the corpus."""
    stages = {}
    for r in ROWS:
        stages[r["out"]["stage"]] = stages.get(r["out"]["stage"], 0) + 1
    assert stages.get("triggered", 0) >= 20, stages
    assert stages.get("waiting_context", 0) >= 10, stages
    assert stages.get("waiting_trigger", 0) >= 10, stages
