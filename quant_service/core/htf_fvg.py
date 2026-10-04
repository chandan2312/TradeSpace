"""4H Fair Value Gap (FVG) Order Flow Engine. Parity target: lib/bias/htfFvg.js.

Tracks 4H institutional imbalances with full lifecycle intelligence:
  1. Formation: 3-candle imbalance (BISI vs SIBI) with Consequent Encroachment (CE = 50%)
  2. Respected: Price retests the gap, bodies defend boundary/CE, and rejects outward
  3. Unrespected: A 4H candle CLOSES decisively through the far side (gap fails into iFVG)
  4. Active Testing: Current price is currently inside the zone
  5. Order Flow Synthesis: Ratio and sequence of respected vs violated gaps
"""

from __future__ import annotations

from .bars import Bars
from .patterns import avg_range


def analyze_4h_fvgs(bars: Bars, avg: float | None = None, lookback: int = 80) -> dict:
    if bars is None or len(bars) < 3:
        return {
            "all": [],
            "respected": [],
            "unrespected": [],
            "unmitigated": [],
            "active": None,
            "orderFlowState": "NEUTRAL",
            "bullishRespectedCount": 0,
            "bullishUnrespectedCount": 0,
            "bearishRespectedCount": 0,
            "bearishUnrespectedCount": 0,
            "netRespectScore": 0,
            "nearestSupportFVG": None,
            "nearestResistanceFVG": None,
        }

    n = len(bars)
    a = avg if avg is not None else avg_range(bars)
    min_gap = 0.28 * a
    start = max(2, n - lookback)
    current_price = float(bars.close[-1])

    raw_gaps = []
    for i in range(start, n):
        prev_h = float(bars.high[i - 2])
        prev_l = float(bars.low[i - 2])
        curr_h = float(bars.high[i])
        curr_l = float(bars.low[i])

        if curr_l - prev_h >= min_gap:
            top = curr_l
            bottom = prev_h
            raw_gaps.append({
                "id": f"4H-BULL-{i}",
                "dir": 1,
                "type": "BULLISH_FVG",
                "top": top,
                "bottom": bottom,
                "ce": (top + bottom) / 2.0,
                "size": top - bottom,
                "born": i,
                "bornTime": int(bars.time[i]),
            })
        elif prev_l - curr_h >= min_gap:
            top = prev_l
            bottom = curr_h
            raw_gaps.append({
                "id": f"4H-BEAR-{i}",
                "dir": -1,
                "type": "BEARISH_FVG",
                "top": top,
                "bottom": bottom,
                "ce": (top + bottom) / 2.0,
                "size": top - bottom,
                "born": i,
                "bornTime": int(bars.time[i]),
            })

    all_gaps = []
    respected = []
    unrespected = []
    unmitigated = []
    active = None

    for gap in raw_gaps:
        bull = gap["dir"] == 1
        state = "UNMITIGATED"
        tested = False
        respected_at = None
        violated_at = None
        deepest_pen = None
        bodies_above_ce = True
        bodies_below_ce = True

        for j in range(gap["born"] + 1, n):
            b_l = float(bars.low[j])
            b_h = float(bars.high[j])
            b_c = float(bars.close[j])

            if bull:
                if b_l <= gap["top"]:
                    tested = True
                    if deepest_pen is None or b_l < deepest_pen:
                        deepest_pen = b_l
                    if b_c < gap["ce"]:
                        bodies_above_ce = False

                    if b_c < gap["bottom"]:
                        state = "UNRESPECTED"
                        violated_at = j
                        break

                    if b_c >= gap["bottom"]:
                        bounced = any(
                            float(bars.close[k]) > gap["top"] or float(bars.high[k]) > gap["top"] + 0.5 * a
                            for k in range(j, min(j + 4, n))
                        )
                        if bounced:
                            state = "RESPECTED"
                            respected_at = j
            else:
                if b_h >= gap["bottom"]:
                    tested = True
                    if deepest_pen is None or b_h > deepest_pen:
                        deepest_pen = b_h
                    if b_c > gap["ce"]:
                        bodies_below_ce = False

                    if b_c > gap["top"]:
                        state = "UNRESPECTED"
                        violated_at = j
                        break

                    if b_c <= gap["top"]:
                        dropped = any(
                            float(bars.close[k]) < gap["bottom"] or float(bars.low[k]) < gap["bottom"] - 0.5 * a
                            for k in range(j, min(j + 4, n))
                        )
                        if dropped:
                            state = "RESPECTED"
                            respected_at = j

        last_l = float(bars.low[-1])
        last_h = float(bars.high[-1])
        last_c = float(bars.close[-1])
        is_inside = (last_l <= gap["top"] and last_c >= gap["bottom"]) if bull else (last_h >= gap["bottom"] and last_c <= gap["top"])

        if is_inside and state != "UNRESPECTED":
            state = "TESTING"

        age_bars = n - 1 - gap["born"]
        respect_quality = (
            ("A_PRIME_CE_DEFENDED" if bodies_above_ce else "B_BOTTOM_DEFENDED")
            if bull else
            ("A_PRIME_CE_DEFENDED" if bodies_below_ce else "B_TOP_DEFENDED")
        )

        classified = dict(
            gap,
            state=state,
            tested=tested,
            ageBars=age_bars,
            isCurrentlyInside=is_inside,
            respectedAt=(n - 1 - respected_at) if respected_at is not None else None,
            violatedAt=(n - 1 - violated_at) if violated_at is not None else None,
            deepestPenetration=deepest_pen,
            respectQuality=respect_quality,
        )
        all_gaps.append(classified)

        if state == "RESPECTED":
            respected.append(classified)
        elif state == "UNRESPECTED":
            unrespected.append(classified)
        elif state == "UNMITIGATED":
            unmitigated.append(classified)
        elif state == "TESTING":
            active = classified

    bull_resp = sum(1 for g in respected if g["dir"] == 1)
    bull_unresp = sum(1 for g in unrespected if g["dir"] == 1)
    bear_resp = sum(1 for g in respected if g["dir"] == -1)
    bear_unresp = sum(1 for g in unrespected if g["dir"] == -1)

    bull_pts = bull_resp * 2 + bear_unresp * 1.5
    bear_pts = bear_resp * 2 + bull_unresp * 1.5
    net_score = int(round(bull_pts - bear_pts))

    order_flow_state = "NEUTRAL"
    if net_score >= 3:
        order_flow_state = "STRONG_BULLISH_ORDER_FLOW"
    elif net_score <= -3:
        order_flow_state = "STRONG_BEARISH_ORDER_FLOW"
    elif net_score > 0:
        order_flow_state = "LEANING_BULLISH"
    elif net_score < 0:
        order_flow_state = "LEANING_BEARISH"

    support_cands = [g for g in all_gaps if g["state"] != "UNRESPECTED" and g["dir"] == 1 and g["top"] <= current_price]
    support_cands.sort(key=lambda x: x["top"], reverse=True)
    nearest_sup = support_cands[0] if support_cands else None

    resist_cands = [g for g in all_gaps if g["state"] != "UNRESPECTED" and g["dir"] == -1 and g["bottom"] >= current_price]
    resist_cands.sort(key=lambda x: x["bottom"])
    nearest_res = resist_cands[0] if resist_cands else None

    return {
        "all": all_gaps,
        "respected": respected,
        "unrespected": unrespected,
        "unmitigated": unmitigated,
        "active": active,
        "orderFlowState": order_flow_state,
        "bullishRespectedCount": bull_resp,
        "bullishUnrespectedCount": bull_unresp,
        "bearishRespectedCount": bear_resp,
        "bearishUnrespectedCount": bear_unresp,
        "netRespectScore": net_score,
        "nearestSupportFVG": nearest_sup,
        "nearestResistanceFVG": nearest_res,
        "currentPrice": current_price,
    }
