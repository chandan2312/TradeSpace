"""Unit tests for Master Market Bias Brain in quant_service.

Validates:
  1. Multi-timeframe Dealing Ranges (ranges.py)
  2. 4H FVG Lifecycle (htf_fvg.py)
  3. HTF-Only Liquidity Intelligence (htf_liquidity.py)
  4. The Market Brain Dynamic Synthesis (brain.py)
  5. Full Engine Integration (engine.py)
"""

import pytest
import numpy as np

from quant_service.core.bars import Bars
from quant_service.core.ranges import compute_dealing_range, analyze_all_dealing_ranges
from quant_service.core.htf_fvg import analyze_4h_fvgs
from quant_service.core.htf_liquidity import analyze_htf_liquidity
from quant_service.core.brain import evaluate_market_brain
from quant_service.core.engine import compute_symbol_bias
from quant_service.core.smt import smt_divergence
from quant_service.core.lenses import lens_vote


def create_range_bars(n: int, low: float, high: float, final_close: float) -> Bars:
    times = []
    opens = []
    highs = []
    lows = []
    closes = []
    volumes = []
    t0 = 1700000000
    for i in range(n):
        o = 150.0 + np.sin(i * 0.5) * 10.0
        c = final_close if i == n - 1 else o + np.cos(i * 0.5) * 5.0
        h = high if i == 10 else max(o, c) + 2.0
        l = low if i == 20 else min(o, c) - 2.0
        times.append(t0 + i * 3600)
        opens.append(o)
        highs.append(h)
        lows.append(l)
        closes.append(c)
        volumes.append(100.0)
    return Bars(times, opens, highs, lows, closes, volumes)


def test_dealing_range_discount_and_premium():
    bars_low = create_range_bars(60, 100.0, 200.0, 110.0)
    r_low = compute_dealing_range(bars_low, "H4")
    assert r_low is not None
    assert r_low["high"] == 200.0
    assert r_low["low"] == 100.0
    assert r_low["eq"] == 150.0
    assert r_low["coveragePct"] == 10
    assert r_low["zone"] == "DEEP_DISCOUNT"
    assert r_low["status"] == "EXHAUSTED_LOW"
    assert r_low["isExhausted"] is True

    bars_high = create_range_bars(60, 100.0, 200.0, 192.0)
    r_high = compute_dealing_range(bars_high, "H4")
    assert r_high["coveragePct"] == 92
    assert r_high["zone"] == "DEEP_PREMIUM"
    assert r_high["status"] == "EXHAUSTED_HIGH"

    all_ranges = analyze_all_dealing_ranges({"H4": bars_high, "M15": create_range_bars(60, 180.0, 200.0, 195.0)})
    assert len(all_ranges["warnings"]) > 0
    assert any(w["type"] == "HTF_PREMIUM_EXHAUSTION" for w in all_ranges["warnings"])


def test_4h_fvg_respected_and_unrespected():
    # Bullish FVG respected
    t = [1000, 2000, 3000, 4000, 5000]
    o = [90.0, 91.0, 104.0, 106.0, 99.0]
    h = [92.0, 105.0, 108.0, 107.0, 112.0]
    l = [89.0, 91.0, 98.0, 94.0, 99.0]
    c = [91.0, 104.0, 106.0, 99.0, 110.0]
    v = [100.0] * 5
    bars_resp = Bars(t, o, h, l, c, v)

    res = analyze_4h_fvgs(bars_resp, 5.0)
    assert len(res["all"]) == 1
    assert len(res["respected"]) == 1
    assert res["orderFlowState"] in ("STRONG_BULLISH_ORDER_FLOW", "LEANING_BULLISH")

    # Bullish FVG violated
    c_viol = [91.0, 104.0, 106.0, 88.0, 84.0]
    l_viol = [89.0, 91.0, 98.0, 86.0, 82.0]
    bars_viol = Bars(t, o, h, l_viol, c_viol, v)
    res_viol = analyze_4h_fvgs(bars_viol, 5.0)
    assert len(res_viol["unrespected"]) == 1
    assert res_viol["orderFlowState"] in ("STRONG_BEARISH_ORDER_FLOW", "LEANING_BEARISH")


def test_htf_liquidity_sweeps_and_dol():
    DAY = 86400
    d1 = Bars(
        [10 * DAY, 11 * DAY],
        [100.0, 105.0],
        [110.0, 112.0],  # PDH = 110.0
        [98.0, 102.0],
        [105.0, 108.0],
        [100.0, 100.0],
    )
    h4 = Bars(
        [11 * DAY, 11 * DAY + 4 * 3600, 11 * DAY + 8 * 3600],
        [106.0, 107.0, 107.0],
        [108.0, 111.5, 107.5],  # 111.5 > 110.0, closes 107.0 -> PDH swept!
        [105.0, 106.5, 103.0],
        [107.0, 107.0, 104.0],
        [100.0, 100.0, 100.0],
    )
    res = analyze_htf_liquidity({"H4": h4, "D1": d1})
    assert "PDH" in res["keyLevels"]
    assert any(s["name"] == "PDH" and s["reversalDir"] == -1 for s in res["sweeps"])
    assert res["activeCycle"] == "ERL_TO_IRL"
    assert res["drawOnLiquidity"] is not None


def test_market_brain_scenarios():
    bars_high = create_range_bars(60, 100.0, 200.0, 192.0)
    ranges_exh = analyze_all_dealing_ranges({
        "H4": bars_high,
        "M15": create_range_bars(60, 180.0, 200.0, 196.0),
    })
    brain_exh = evaluate_market_brain(
        symbol="EURUSD",
        ranges=ranges_exh,
        htf_fvg={"all": [], "respected": [], "unrespected": [], "active": None, "orderFlowState": "NEUTRAL"},
        htf_liq={"sweeps": [], "activeCycle": "UNKNOWN", "drawOnLiquidity": None, "pools": {"bsl": [], "ssl": []}},
        structures={"M15": {"dir": 1}, "H4": {"dir": 1}},
        score=65.0,
    )
    assert brain_exh["verdict"] == "EXHAUSTED_BULLISH"
    assert brain_exh["allowedToLong"] is False
    assert brain_exh["action"] == "STAND_ASIDE"

    # Day Trader 15M Overextension Veto
    ranges_over = analyze_all_dealing_ranges({
        "H4": create_range_bars(60, 100.0, 200.0, 135.0),  # 35% in Discount
        "M15": create_range_bars(60, 100.0, 200.0, 178.0), # 78% in Premium (Overextended!)
    })
    brain_over = evaluate_market_brain(
        symbol="EURUSD",
        ranges=ranges_over,
        htf_fvg={"all": [], "respected": [{"dir": 1, "ageBars": 2}], "unrespected": [], "active": None, "orderFlowState": "STRONG_BULLISH_ORDER_FLOW"},
        htf_liq={"sweeps": [], "activeCycle": "IRL_TO_ERL", "drawOnLiquidity": {"name": "4H EQH BSL", "price": 195.0, "targetSide": "BSL"}, "pools": {"bsl": [], "ssl": []}},
        structures={"M15": {"dir": 1}, "H4": {"dir": 1}},
        score=60.0,
    )
    assert brain_over["allowedToLong"] is False
    assert brain_over["action"] == "WAIT_FOR_15M_PULLBACK"
    assert brain_over["dayTraderContext"]["ltfGatekeeper"]["vetoActive"] is True

    # Day Trader 15M Retracement Leg Veto
    ranges_leg = analyze_all_dealing_ranges({
        "H4": create_range_bars(60, 100.0, 200.0, 135.0),  # 35% in Discount
        "M15": create_range_bars(60, 100.0, 200.0, 138.0), # 38% in Discount!
    })
    brain_leg = evaluate_market_brain(
        symbol="EURUSD",
        ranges=ranges_leg,
        htf_fvg={"all": [], "respected": [{"dir": 1, "ageBars": 2}], "unrespected": [], "active": None, "orderFlowState": "STRONG_BULLISH_ORDER_FLOW"},
        htf_liq={"sweeps": [], "activeCycle": "IRL_TO_ERL", "drawOnLiquidity": {"name": "4H EQH BSL", "price": 195.0, "targetSide": "BSL"}, "pools": {"bsl": [], "ssl": []}},
        structures={"M15": {"dir": -1}, "H4": {"dir": 1}},  # Active downward leg!
        score=60.0,
    )
    assert brain_leg["allowedToLong"] is False
    assert brain_leg["action"] == "WAIT_FOR_15M_TRIGGER"
    assert brain_leg["dayTraderContext"]["ltfGatekeeper"]["triggerStatus"] == "WAIT_SHIFT"

    # Day Trader 15M Unlocked
    brain_unlocked = evaluate_market_brain(
        symbol="EURUSD",
        ranges=ranges_leg,
        htf_fvg={"all": [], "respected": [{"dir": 1, "ageBars": 2}], "unrespected": [], "active": None, "orderFlowState": "STRONG_BULLISH_ORDER_FLOW"},
        htf_liq={"sweeps": [], "activeCycle": "IRL_TO_ERL", "drawOnLiquidity": {"name": "4H EQH BSL", "price": 195.0, "targetSide": "BSL"}, "pools": {"bsl": [], "ssl": []}},
        structures={"M15": {"dir": 1}, "H4": {"dir": 1}},  # Structure aligned!
        score=60.0,
    )
    assert brain_unlocked["allowedToLong"] is True
    assert brain_unlocked["action"] == "READY_FOR_LONG"
    assert brain_unlocked["dayTraderContext"]["ltfGatekeeper"]["triggerStatus"] == "APPROVED"
    assert "horizons" in brain_unlocked
    assert brain_unlocked["horizons"]["SWING"]["timeframeCombo"] == "1D-1H"
    assert brain_unlocked["horizons"]["DAY"]["timeframeCombo"] == "4H-15M"
    assert brain_unlocked["horizons"]["SCALP"]["timeframeCombo"] == "15M-1M"


def test_full_engine_integration():
    bars_d1 = create_range_bars(40, 80.0, 220.0, 140.0)
    bars_h4 = create_range_bars(60, 100.0, 200.0, 135.0)
    bars_h1 = create_range_bars(60, 110.0, 180.0, 135.0)
    bars_m15 = create_range_bars(60, 120.0, 160.0, 135.0)
    frames = {"D1": bars_d1, "H4": bars_h4, "H1": bars_h1, "M15": bars_m15}

    res = compute_symbol_bias("EURUSD", frames)
    assert isinstance(res["score"], (int, float))
    assert "ranges" in res
    assert "htfFvg" in res
    assert "htfLiquidity" in res
    assert "brain" in res
    assert "executionReadiness" in res
    assert isinstance(res["executionReadiness"]["allowedToLong"], bool)
    assert isinstance(res["executionReadiness"]["action"], str)


def test_heuristic_review_and_anti_bias():
    # 1. Bidirectional SMT Divergence Test (Partner runs high, Base fails -> Bearish SMT)
    def create_smt_bars(h2: float) -> Bars:
        times, opens, highs, lows, closes, volumes = [], [], [], [], [], []
        base_time = 1700000000
        for i in range(4):
            times.append(base_time + i * 900)
            opens.append(100.0); highs.append(102.0); lows.append(98.0); closes.append(100.0); volumes.append(100.0)
        # bar 4: Low 1 = 90
        times.append(base_time + 4 * 900)
        opens.append(98.0); highs.append(99.0); lows.append(90.0); closes.append(95.0); volumes.append(100.0)
        # bar 5..8 rising
        for i in range(5, 9):
            times.append(base_time + i * 900)
            opens.append(95.0 + (i - 4)*3); highs.append(97.0 + (i - 4)*3); lows.append(94.0 + (i - 4)*3); closes.append(96.0 + (i - 4)*3); volumes.append(100.0)
        # bar 9: High 1 = 110
        times.append(base_time + 9 * 900)
        opens.append(107.0); highs.append(110.0); lows.append(105.0); closes.append(108.0); volumes.append(100.0)
        # bar 10..14 falling
        for i in range(10, 15):
            times.append(base_time + i * 900)
            opens.append(108.0 - (i - 9)*3); highs.append(109.0 - (i - 9)*3); lows.append(104.0 - (i - 9)*3); closes.append(105.0 - (i - 9)*3); volumes.append(100.0)
        # bar 15: Low 2 = 92
        times.append(base_time + 15 * 900)
        opens.append(94.0); highs.append(96.0); lows.append(92.0); closes.append(95.0); volumes.append(100.0)
        # bar 16..20 rising
        for i in range(16, 21):
            times.append(base_time + i * 900)
            opens.append(95.0 + (i - 15)*2); highs.append(97.0 + (i - 15)*2); lows.append(94.0 + (i - 15)*2); closes.append(96.0 + (i - 15)*2); volumes.append(100.0)
        # bar 21: High 2 = h2
        times.append(base_time + 21 * 900)
        opens.append(105.0); highs.append(h2); lows.append(103.0); closes.append(106.0); volumes.append(100.0)
        # bar 22..25 pulling back
        for i in range(22, 26):
            times.append(base_time + i * 900)
            opens.append(104.0); highs.append(105.0); lows.append(101.0); closes.append(102.0); volumes.append(100.0)
        return Bars(times, opens, highs, lows, closes, volumes)

    m15_base = create_smt_bars(108.0)
    m15_partner = create_smt_bars(114.0)
    smt_res = smt_divergence(m15_base, m15_partner, "GBPUSD")
    assert smt_res is not None
    assert smt_res["dir"] == -1
    assert "divergence" in smt_res["note"]

    # 2. Evidence Mass Scaling in Lens Voting Test
    drives_thin = [{"lens": "flow", "dir": 1, "w": 4}]
    drives_deep = [{"lens": "structure", "dir": -1, "w": 24}]
    fitness_mock = {k: 0.8 for k in ["structure", "liquidity", "reversal", "fvg", "ob", "sr", "volume", "flow"]}
    vote_res = lens_vote(drives_thin + drives_deep, fitness_mock)
    assert vote_res["final"] < -30

    # 3. Dealing Range Runway in Uptrend (Uptrend in Premium is NOT a Bearish Expansion)
    h4_bars = create_range_bars(60, 100.0, 200.0, 165.0)
    m15_bars = create_range_bars(60, 140.0, 180.0, 165.0)
    ranges_res = analyze_all_dealing_ranges(
        {"H4": h4_bars, "M15": m15_bars},
        {"H4": {"dir": 1, "seq": "HH+HL"}},
    )
    has_false_bearish = any(a["type"] == "BEARISH_UNCOVERED_EXPANSION" for a in ranges_res["alignments"])
    assert not has_false_bearish
    has_bullish_delivery = any(a["type"] == "BULLISH_UNCOVERED_EXPANSION" and a["dir"] == 1 for a in ranges_res["alignments"])
    assert has_bullish_delivery

