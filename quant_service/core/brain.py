"""The Market Brain Synthesis Engine. Parity target: lib/bias/brain.js.

Combines Multi-Timeframe Dealing Ranges, 4H FVG Order Flow, HTF Liquidity,
and Intraday Triggers into a cognitive market thesis for automated systems.

Key principles:
  1. Dynamic evaluation over simple score sums
  2. Range coverage awareness: Never chase exhausted moves
  3. 4H FVG defense vs violation governs institutional bias
  4. Institutional Draw on Liquidity (DOL) dictates direction
  5. Day-Trading Division of Labor:
     - 1D & 4H: THE COMPASS (Directional bias & Macro Target/DOL)
     - 1H: THE SESSION ROADMAP (Intermediate dealing range & context)
     - 15M: THE GATEKEEPER & TRIGGER (100% Veto Power over execution)
"""

from __future__ import annotations


def evaluate_market_brain(
    symbol: str,
    ranges: dict,
    htf_fvg: dict,
    htf_liq: dict,
    structures: dict | None = None,
    intraday: dict | None = None,
    score: float = 0.0,
) -> dict:
    structures = structures or {}
    intraday = intraday or {}

    h4_range = ranges.get("ranges", {}).get("H4")
    m15_range = ranges.get("ranges", {}).get("M15")
    h1_range = ranges.get("ranges", {}).get("H1")
    d1_range = ranges.get("ranges", {}).get("D1")

    dol = htf_liq.get("drawOnLiquidity")
    fvg_order_flow = htf_fvg.get("orderFlowState", "NEUTRAL")
    recent_sweeps = htf_liq.get("sweeps", [])
    fresh_htf_sweep = next((s for s in recent_sweeps if s["age"] <= 6), None)

    catalysts = []
    block_reasons = []
    conflicts = []

    verdict = "RANGE_EQUILIBRIUM_CHOP"
    action = "STAND_ASIDE"
    conviction = 50
    allowed_to_long = False
    allowed_to_short = False
    invalidation_price = None
    warning = None

    # 1. Evaluate Range Coverage & Exhaustion
    is_h4_deep_prem = h4_range and h4_range.get("coveragePct", 50) >= 78
    is_h4_deep_disc = h4_range and h4_range.get("coveragePct", 50) <= 22
    is_m15_exhaust_high = m15_range and m15_range.get("status") == "EXHAUSTED_HIGH"
    is_m15_exhaust_low = m15_range and m15_range.get("status") == "EXHAUSTED_LOW"

    if is_h4_deep_prem and is_m15_exhaust_high:
        warning = "H4 and M15 ranges are both exhausted in Deep Premium (>80%). Chasing longs is strictly blocked."
        block_reasons.append("Severe range exhaustion at premium ceiling")
    elif is_h4_deep_disc and is_m15_exhaust_low:
        warning = "H4 and M15 ranges are both exhausted in Deep Discount (<20%). Chasing shorts is strictly blocked."
        block_reasons.append("Severe range exhaustion at discount floor")

    # 2. Evaluate 4H FVG Respect vs Violation
    has_resp_bull = any(g["dir"] == 1 and g.get("ageBars", 99) <= 12 for g in htf_fvg.get("respected", []))
    has_resp_bear = any(g["dir"] == -1 and g.get("ageBars", 99) <= 12 for g in htf_fvg.get("respected", []))
    has_viol_bull = any(g["dir"] == 1 and g.get("ageBars", 99) <= 12 for g in htf_fvg.get("unrespected", []))
    has_viol_bear = any(g["dir"] == -1 and g.get("ageBars", 99) <= 12 for g in htf_fvg.get("unrespected", []))

    if has_resp_bull:
        catalysts.append("4H Bullish FVG tested and respected (institutional buy defense)")
    if has_resp_bear:
        catalysts.append("4H Bearish FVG tested and respected (institutional sell defense)")
    if has_viol_bull:
        catalysts.append("4H Bullish FVG violated and inverted into resistance")
    if has_viol_bear:
        catalysts.append("4H Bearish FVG violated and inverted into support")

    # 3. Evaluate HTF Sweeps & ERL/IRL Cycle
    if fresh_htf_sweep:
        catalysts.append(f"HTF liquidity raid: {fresh_htf_sweep['name']} swept on 4H frame ({fresh_htf_sweep['age'] * 4}h ago)")
    if htf_liq.get("activeCycle") == "IRL_TO_ERL":
        catalysts.append("Active HTF auction cycle: Expanding from internal liquidity towards external pool")
    elif htf_liq.get("activeCycle") == "ERL_TO_IRL":
        catalysts.append("Active HTF auction cycle: Rotating from external pool into internal range")

    # 4. DAY-TRADING DIVISION OF LABOR: Macro Compass & 15M Gatekeeper
    m15_dir = (structures.get("M15") or {}).get("dir", 0)
    h4_dir = (structures.get("H4") or {}).get("dir", 0)
    setup_dir = (intraday.get("setup") or {}).get("dir", 0)

    macro_compass = "NEUTRAL"
    macro_rationale = "Macro context in equilibrium consolidation."

    d1_dir = (structures.get("D1") or {}).get("dir", 0)

    if fresh_htf_sweep and fresh_htf_sweep["side"] == -1:
        macro_compass = "BULLISH"
        macro_rationale = f"Institutional SSL purge ({fresh_htf_sweep['name']}). Reversal seeking buy-side liquidity."
    elif fresh_htf_sweep and fresh_htf_sweep["side"] == 1:
        macro_compass = "BEARISH"
        macro_rationale = f"Institutional BSL purge ({fresh_htf_sweep['name']}). Reversal seeking sell-side liquidity."
    elif has_resp_bull or fvg_order_flow == "STRONG_BULLISH_ORDER_FLOW" or (h4_dir == 1 and score > 15):
        macro_compass = "BULLISH"
        macro_rationale = "4H institutional bullish order flow actively defended."
    elif has_resp_bear or fvg_order_flow == "STRONG_BEARISH_ORDER_FLOW" or (h4_dir == -1 and score < -15):
        macro_compass = "BEARISH"
        macro_rationale = "4H institutional bearish order flow actively defended."
    elif h4_dir == 1 or d1_dir == 1:
        macro_compass = "BULLISH"
        macro_rationale = "Higher timeframe structural trend is bullish (HH+HL)."
    elif h4_dir == -1 or d1_dir == -1:
        macro_compass = "BEARISH"
        macro_rationale = "Higher timeframe structural trend is bearish (LH+LL)."
    elif score > 25:
        macro_compass = "BULLISH"
        macro_rationale = "Multi-lens ensemble leaning bullish in neutral HTF context."
    elif score < -25:
        macro_compass = "BEARISH"
        macro_rationale = "Multi-lens ensemble leaning bearish in neutral HTF context."

    m15_coverage = m15_range.get("coveragePct") if m15_range else None
    m15_zone = m15_range.get("zone") if m15_range else None

    m15_veto_active = False
    m15_veto_reason = None
    m15_trigger_status = "NEUTRAL"  # "APPROVED" | "WAIT_PULLBACK" | "WAIT_SHIFT" | "BLOCKED"

    if macro_compass == "BULLISH":
        if m15_coverage is not None and (m15_coverage > 65 or m15_range.get("status") == "EXHAUSTED_HIGH"):
            m15_veto_active = True
            m15_veto_reason = f"15M is overextended in {m15_zone} ({m15_coverage}%). Day traders must wait for 15M pullback into Discount (<50%)."
            m15_trigger_status = "WAIT_PULLBACK"
        elif m15_coverage is not None and m15_coverage <= 65:
            if m15_dir == -1 and setup_dir != 1:
                m15_veto_active = True
                m15_veto_reason = f"15M reached {m15_zone} ({m15_coverage}%) but is still in active downward retracement leg. Awaiting 15M structure shift (MSS/CHoCH) to confirm entry."
                m15_trigger_status = "WAIT_SHIFT"
            else:
                m15_veto_active = False
                m15_trigger_status = "APPROVED"
        elif m15_dir == 1 or setup_dir == 1:
            m15_veto_active = False
            m15_trigger_status = "APPROVED"
    elif macro_compass == "BEARISH":
        if m15_coverage is not None and (m15_coverage < 35 or m15_range.get("status") == "EXHAUSTED_LOW"):
            m15_veto_active = True
            m15_veto_reason = f"15M is overextended in {m15_zone} ({m15_coverage}%). Day traders must wait for 15M pullback into Premium (>50%)."
            m15_trigger_status = "WAIT_PULLBACK"
        elif m15_coverage is not None and m15_coverage >= 35:
            if m15_dir == 1 and setup_dir != -1:
                m15_veto_active = True
                m15_veto_reason = f"15M reached {m15_zone} ({m15_coverage}%) but is still in active upward retracement leg. Awaiting 15M structure shift (MSS/CHoCH) to confirm entry."
                m15_trigger_status = "WAIT_SHIFT"
            else:
                m15_veto_active = False
                m15_trigger_status = "APPROVED"
        elif m15_dir == -1 or setup_dir == -1:
            m15_veto_active = False
            m15_trigger_status = "APPROVED"

    # Swing Gatekeeper (1D Compass -> 1H Trigger)
    d1_dir = (structures.get("D1") or {}).get("dir", 0)
    h1_dir = (structures.get("H1") or {}).get("dir", 0)
    h1_coverage = h1_range.get("coveragePct") if h1_range else None
    h1_zone = h1_range.get("zone") if h1_range else None

    h1_veto_active = False
    h1_veto_reason = None
    h1_trigger_status = "NEUTRAL"

    if d1_dir == 1 or (d1_dir == 0 and macro_compass == "BULLISH"):
        if h1_coverage is not None and (h1_coverage > 65 or (h1_range and h1_range.get("status") == "EXHAUSTED_HIGH")):
            h1_veto_active = True
            h1_veto_reason = f"1H is overextended in {h1_zone} ({h1_coverage}%). Swing traders must wait for 1H pullback into Discount (<50%)."
            h1_trigger_status = "WAIT_PULLBACK"
        elif h1_dir == -1:
            h1_veto_active = True
            h1_veto_reason = f"1H reached {h1_zone} ({h1_coverage}%) but is in active downward retracement leg. Awaiting 1H structure shift (MSS/CHoCH)."
            h1_trigger_status = "WAIT_SHIFT"
        else:
            h1_veto_active = False
            h1_trigger_status = "APPROVED"
    elif d1_dir == -1 or (d1_dir == 0 and macro_compass == "BEARISH"):
        if h1_coverage is not None and (h1_coverage < 35 or (h1_range and h1_range.get("status") == "EXHAUSTED_LOW")):
            h1_veto_active = True
            h1_veto_reason = f"1H is overextended in {h1_zone} ({h1_coverage}%). Swing traders must wait for 1H pullback into Premium (>50%)."
            h1_trigger_status = "WAIT_PULLBACK"
        elif h1_dir == 1:
            h1_veto_active = True
            h1_veto_reason = f"1H reached {h1_zone} ({h1_coverage}%) but is in active upward retracement leg. Awaiting 1H structure shift (MSS/CHoCH)."
            h1_trigger_status = "WAIT_SHIFT"
        else:
            h1_veto_active = False
            h1_trigger_status = "APPROVED"

    # Scalp Gatekeeper (15M Compass -> 1M Trigger)
    m1_dir = (structures.get("M1") or {}).get("dir", 0)
    m1_veto_active = False
    m1_veto_reason = None
    m1_trigger_status = "NEUTRAL"

    if m15_dir == 1 or setup_dir == 1:
        if m15_coverage is not None and (m15_coverage > 70 or (m15_range and m15_range.get("status") == "EXHAUSTED_HIGH")):
            m1_veto_active = True
            m1_veto_reason = f"15M is overextended in {m15_zone} ({m15_coverage}%). Scalpers must wait for 15M/5M pullback."
            m1_trigger_status = "WAIT_PULLBACK"
        elif m1_dir == -1:
            m1_veto_active = True
            m1_veto_reason = "1M is in active counter-trend leg. Awaiting 1M displacement shift."
            m1_trigger_status = "WAIT_SHIFT"
        else:
            m1_veto_active = False
            m1_trigger_status = "APPROVED"
    elif m15_dir == -1 or setup_dir == -1:
        if m15_coverage is not None and (m15_coverage < 30 or (m15_range and m15_range.get("status") == "EXHAUSTED_LOW")):
            m1_veto_active = True
            m1_veto_reason = f"15M is overextended in {m15_zone} ({m15_coverage}%). Scalpers must wait for 15M/5M pullback."
            m1_trigger_status = "WAIT_PULLBACK"
        elif m1_dir == 1:
            m1_veto_active = True
            m1_veto_reason = "1M is in active counter-trend leg. Awaiting 1M displacement shift."
            m1_trigger_status = "WAIT_SHIFT"
        else:
            m1_veto_active = False
            m1_trigger_status = "APPROVED"

    # 5. Dynamic Cognitive Synthesis
    if fresh_htf_sweep and fresh_htf_sweep["side"] == -1 and (
        has_resp_bull or setup_dir == 1 or m15_dir == 1
    ):
        verdict = "BULLISH_REVERSAL_CONFIRMED"
        conviction = 88
        invalidation_price = fresh_htf_sweep["sweptPrice"]
        catalysts.append("SSL swept + immediate lower-timeframe bullish reclamation")

        if m15_veto_active:
            allowed_to_long = False
            action = "WAIT_FOR_15M_PULLBACK" if m15_trigger_status == "WAIT_PULLBACK" else "WAIT_FOR_15M_TRIGGER"
            block_reasons.append(m15_veto_reason)
        else:
            allowed_to_long = True
            action = "READY_FOR_LONG"

    elif fresh_htf_sweep and fresh_htf_sweep["side"] == 1 and (
        has_resp_bear or setup_dir == -1 or m15_dir == -1
    ):
        verdict = "BEARISH_REVERSAL_CONFIRMED"
        conviction = 88
        invalidation_price = fresh_htf_sweep["sweptPrice"]
        catalysts.append("BSL swept + immediate lower-timeframe bearish rejection")

        if m15_veto_active:
            allowed_to_short = False
            action = "WAIT_FOR_15M_PULLBACK" if m15_trigger_status == "WAIT_PULLBACK" else "WAIT_FOR_15M_TRIGGER"
            block_reasons.append(m15_veto_reason)
        else:
            allowed_to_short = True
            action = "READY_FOR_SHORT"

    elif (
        (has_resp_bull or has_viol_bear or fvg_order_flow == "STRONG_BULLISH_ORDER_FLOW")
        and (not h4_range or h4_range.get("coveragePct", 50) < 75)
        and score > 15
    ):
        verdict = "STRONG_BULLISH_EXPANSION"
        conviction = 84
        sup = htf_fvg.get("nearestSupportFVG")
        invalidation_price = sup["bottom"] if sup else (h4_range["eq"] if h4_range else None)
        catalysts.append("Bullish 4H order flow defended with ample uncovered range runway to target")

        if m15_veto_active:
            allowed_to_long = False
            action = "WAIT_FOR_15M_PULLBACK" if m15_trigger_status == "WAIT_PULLBACK" else "WAIT_FOR_15M_TRIGGER"
            block_reasons.append(m15_veto_reason)
        else:
            allowed_to_long = True
            action = "READY_FOR_LONG"
            catalysts.append("15M Gatekeeper confirmed: In Discount with bullish structure alignment")

    elif (
        (has_resp_bear or has_viol_bull or fvg_order_flow == "STRONG_BEARISH_ORDER_FLOW")
        and (not h4_range or h4_range.get("coveragePct", 50) > 25)
        and score < -15
    ):
        verdict = "STRONG_BEARISH_EXPANSION"
        conviction = 84
        res = htf_fvg.get("nearestResistanceFVG")
        invalidation_price = res["top"] if res else (h4_range["eq"] if h4_range else None)
        catalysts.append("Bearish 4H order flow defended with ample uncovered range runway to target")

        if m15_veto_active:
            allowed_to_short = False
            action = "WAIT_FOR_15M_PULLBACK" if m15_trigger_status == "WAIT_PULLBACK" else "WAIT_FOR_15M_TRIGGER"
            block_reasons.append(m15_veto_reason)
        else:
            allowed_to_short = True
            action = "READY_FOR_SHORT"
            catalysts.append("15M Gatekeeper confirmed: In Premium with bearish structure alignment")

    elif score > 10 and (is_h4_deep_prem or (is_m15_exhaust_high and (not h4_range or h4_range.get("coveragePct", 50) >= 70))):
        verdict = "EXHAUSTED_BULLISH"
        action = "STAND_ASIDE"
        allowed_to_long = False
        conviction = 65
        conflicts.append("Bullish momentum present but range coverage is >= 85% exhausted into resistance")
        block_reasons.append("Range exhausted at range ceiling")

    elif score < -10 and (is_h4_deep_disc or (is_m15_exhaust_low and (not h4_range or h4_range.get("coveragePct", 50) <= 30))):
        verdict = "EXHAUSTED_BEARISH"
        action = "STAND_ASIDE"
        allowed_to_short = False
        conviction = 65
        conflicts.append("Bearish momentum present but range coverage is <= 15% exhausted into support")
        block_reasons.append("Range exhausted at range floor")

    elif h4_dir == 1 and h4_range and h4_range.get("zone") == "DISCOUNT" and has_resp_bull:
        verdict = "BULLISH_PULLBACK_DEFENDED"
        conviction = 80
        sup = htf_fvg.get("nearestSupportFVG")
        invalidation_price = sup["bottom"] if sup else h4_range["low"]

        if m15_veto_active:
            allowed_to_long = False
            action = "WAIT_FOR_15M_PULLBACK" if m15_trigger_status == "WAIT_PULLBACK" else "WAIT_FOR_15M_TRIGGER"
            block_reasons.append(m15_veto_reason)
        else:
            allowed_to_long = True
            action = "READY_FOR_LONG"

    elif h4_dir == -1 and h4_range and h4_range.get("zone") == "PREMIUM" and has_resp_bear:
        verdict = "BEARISH_PULLBACK_DEFENDED"
        conviction = 80
        res = htf_fvg.get("nearestResistanceFVG")
        invalidation_price = res["top"] if res else h4_range["high"]

        if m15_veto_active:
            allowed_to_short = False
            action = "WAIT_FOR_15M_PULLBACK" if m15_trigger_status == "WAIT_PULLBACK" else "WAIT_FOR_15M_TRIGGER"
            block_reasons.append(m15_veto_reason)
        else:
            allowed_to_short = True
            action = "READY_FOR_SHORT"

    else:
        verdict = "RANGE_EQUILIBRIUM_CHOP"
        action = "STAND_ASIDE"
        conviction = 40
        conflicts.append("Price hovering in Equilibrium without clear institutional order flow defense")

    # 6. Generate Institutional Narrative
    h1_coverage = h1_range.get("coveragePct") if h1_range else None
    h4_cov = h4_range.get("coveragePct") if h4_range else None

    if verdict == "STRONG_BULLISH_EXPANSION":
        narrative = f"Macro Compass is BULLISH: 4H fair value gaps are defended and delivery targets {dol['name'] if dol else 'overhead liquidity'}. "
        if m15_veto_active:
            narrative += f"[15M VETO ACTIVE]: {m15_veto_reason}"
        else:
            rem = m15_range.get("remainingPctToHigh") if m15_range else None
            narrative += f"15M Gatekeeper approves execution with {f'{rem}% uncovered upside in the M15 dealing range' if rem else 'clean runway'}."
    elif verdict == "STRONG_BEARISH_EXPANSION":
        narrative = f"Macro Compass is BEARISH: 4H fair value gaps are defended and delivery targets {dol['name'] if dol else 'sell-side liquidity'}. "
        if m15_veto_active:
            narrative += f"[15M VETO ACTIVE]: {m15_veto_reason}"
        else:
            rem = m15_range.get("remainingPctToLow") if m15_range else None
            narrative += f"15M Gatekeeper approves execution with {f'{rem}% uncovered downside in the M15 dealing range' if rem else 'clean runway'}."
    elif verdict == "EXHAUSTED_BULLISH":
        narrative = f"Bullish movement is currently covering terminal ground. Price is located in deep premium ({h4_cov or 90}% of H4 range) near external liquidity. Long entries are blocked due to range exhaustion and high probability of rotation."
    elif verdict == "EXHAUSTED_BEARISH":
        narrative = f"Bearish movement is currently covering terminal ground. Price is located in deep discount ({h4_cov or 10}% of H4 range) near key sell-side stops. Short entries are blocked due to range exhaustion and high probability of bounce."
    elif verdict == "BULLISH_REVERSAL_CONFIRMED":
        sw_name = fresh_htf_sweep["name"] if fresh_htf_sweep else "SSL"
        narrative = f"Institutional liquidity raid completed. Sell-side liquidity ({sw_name}) was purged, and price has reclaimed value with 4H support holding. "
        if m15_veto_active:
            narrative += f"[15M VETO ACTIVE]: {m15_veto_reason}"
        else:
            narrative += "15M Gatekeeper confirmed immediate lower-timeframe reclamation."
    elif verdict == "BEARISH_REVERSAL_CONFIRMED":
        sw_name = fresh_htf_sweep["name"] if fresh_htf_sweep else "BSL"
        narrative = f"Institutional liquidity raid completed. Buy-side liquidity ({sw_name}) was purged, and price has rejected value with 4H resistance holding. "
        if m15_veto_active:
            narrative += f"[15M VETO ACTIVE]: {m15_veto_reason}"
        else:
            narrative += "15M Gatekeeper confirmed immediate lower-timeframe rejection."
    else:
        narrative = f"Market is currently consolidating within the dealing range equilibrium ({h4_cov or 50}% of H4 range). Order flow does not show high-conviction institutional defense. Stand aside and wait for liquidity raid or clean breakout."

    return {
        "verdict": verdict,
        "narrative": narrative,
        "action": action,
        "conviction": conviction,
        "allowedToLong": allowed_to_long,
        "allowedToShort": allowed_to_short,
        "invalidationPrice": invalidation_price,
        "targetDOL": dol,
        "catalysts": catalysts,
        "blockReasons": block_reasons,
        "conflicts": conflicts,
        "warning": warning,
        "h4CoveragePct": h4_cov,
        "m15CoveragePct": m15_coverage,
        "h4Zone": h4_range.get("zone") if h4_range else None,
        "m15Zone": m15_zone,
        "fvgOrderFlow": fvg_order_flow,
        "activeCycle": htf_liq.get("activeCycle", "UNKNOWN"),
        # 3 Official Horizons Matrix: Swing (1D-1H), Day (4H-15M), Scalp (15M-1M)
        "horizons": {
            "SWING": {
                "horizon": "SWING",
                "timeframeCombo": "1D-1H",
                "macroCompass": "BULLISH" if d1_dir == 1 else "BEARISH" if d1_dir == -1 else macro_compass,
                "compassTf": "1D",
                "roadmapTf": "4H",
                "gatekeeperTf": "1H",
                "roadmap": {
                    "h4Zone": h4_range.get("zone") if h4_range else None,
                    "h4CoveragePct": h4_cov,
                    "h4Status": h4_range.get("status", "NORMAL") if h4_range else "NORMAL",
                    "h4StructureDir": (structures.get("H4") or {}).get("dir", 0),
                    "fvgOrderFlow": fvg_order_flow,
                },
                "gatekeeper": {
                    "h1Zone": h1_zone,
                    "h1CoveragePct": h1_coverage,
                    "h1StructureDir": h1_dir,
                    "vetoActive": h1_veto_active,
                    "vetoReason": h1_veto_reason,
                    "triggerStatus": h1_trigger_status,
                },
            },
            "DAY": {
                "horizon": "DAY",
                "timeframeCombo": "4H-15M",
                "macroCompass": macro_compass,
                "macroRationale": macro_rationale,
                "compassTf": "4H",
                "roadmapTf": "1H",
                "gatekeeperTf": "15M",
                "sessionRoadmap": {
                    "h1Zone": h1_range.get("zone") if h1_range else None,
                    "h1CoveragePct": h1_range.get("coveragePct") if h1_range else None,
                    "h1Status": h1_range.get("status", "NORMAL") if h1_range else "NORMAL",
                    "h1StructureDir": (structures.get("H1") or {}).get("dir", 0),
                },
                "ltfGatekeeper": {
                    "m15Zone": m15_zone,
                    "m15CoveragePct": m15_coverage,
                    "m15StructureDir": m15_dir,
                    "vetoActive": m15_veto_active,
                    "vetoReason": m15_veto_reason,
                    "triggerStatus": m15_trigger_status,
                },
                "gatekeeper": {
                    "m15Zone": m15_zone,
                    "m15CoveragePct": m15_coverage,
                    "m15StructureDir": m15_dir,
                    "vetoActive": m15_veto_active,
                    "vetoReason": m15_veto_reason,
                    "triggerStatus": m15_trigger_status,
                },
            },
            "SCALP": {
                "horizon": "SCALP",
                "timeframeCombo": "15M-1M",
                "macroCompass": "BULLISH" if m15_dir == 1 else "BEARISH" if m15_dir == -1 else "NEUTRAL",
                "compassTf": "15M",
                "roadmapTf": "5M",
                "gatekeeperTf": "1M",
                "roadmap": {
                    "m5StructureDir": (structures.get("M5") or {}).get("dir", 0),
                    "m5Range": ranges.get("ranges", {}).get("M5"),
                },
                "gatekeeper": {
                    "m1StructureDir": m1_dir,
                    "vetoActive": m1_veto_active,
                    "vetoReason": m1_veto_reason,
                    "triggerStatus": m1_trigger_status,
                },
            },
        },
        # Day Trader Multi-Timeframe Matrix (Maintained for backward compatibility)
        "dayTraderContext": {
            "macroCompass": macro_compass,
            "macroRationale": macro_rationale,
            "sessionRoadmap": {
                "h1Zone": h1_range.get("zone") if h1_range else None,
                "h1CoveragePct": h1_range.get("coveragePct") if h1_range else None,
                "h1Status": h1_range.get("status", "NORMAL") if h1_range else "NORMAL",
                "h1StructureDir": (structures.get("H1") or {}).get("dir", 0),
            },
            "ltfGatekeeper": {
                "m15Zone": m15_zone,
                "m15CoveragePct": m15_coverage,
                "m15StructureDir": m15_dir,
                "vetoActive": m15_veto_active,
                "vetoReason": m15_veto_reason,
                "triggerStatus": m15_trigger_status,
            },
        },
    }
