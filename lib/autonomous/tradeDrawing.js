// lib/autonomous/tradeDrawing.js — Map Autonomous Trades to Lightweight Charts Drawing Tools (long-position / short-position)

import { getEetOffsetSec, brokerTimestampToUtcSec } from "../time.js";

function finiteNumber(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

/**
 * Maps a UTC timestamp (seconds) to the bar that contains it on the chart series.
 * Each bar at index i spans [bars[i].time, bars[i+1]?.time ?? bars[i].time + step).
 */
export function findBarForTime(rawSec, bars, step = 300) {
  if (!Number.isFinite(rawSec) || !Array.isArray(bars) || bars.length === 0) return null;

  const firstBar = bars[0];
  const lastBar = bars[bars.length - 1];

  // If rawSec is completely disconnected from the loaded bar range (> 7 days outside range)
  // return null so caller retains their true timestamp coordinates
  if (rawSec < firstBar.time - 86400 * 7 || rawSec > lastBar.time + Math.max(step * 5, 86400 * 3)) {
    return null;
  }

  // If rawSec is before or at the first bar, map to earliest bar
  if (rawSec <= firstBar.time) {
    return firstBar;
  }

  // If rawSec is at or after the last bar's timestamp, map to current forming bar
  if (rawSec >= lastBar.time) {
    return lastBar;
  }

  // Fast binary search for the containing bar: bars[mid].time <= rawSec < nextTime
  let low = 0;
  let high = bars.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const b = bars[mid];
    const nextTime = mid + 1 < bars.length ? bars[mid + 1].time : b.time + step;
    if (rawSec >= b.time && rawSec < nextTime) {
      return b;
    }
    if (rawSec < b.time) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return bars.find((b) => b.time <= rawSec && rawSec < b.time + step) || lastBar;
}

/**
 * Converts an autonomous trade into the exact native Drawing schema expected by
 * `lightweight-charts-drawing` for "long-position" and "short-position" tools.
 *
 * Parameters mapped from trade:
 * - Entry Price & Time: points[0] = { time: entryTime, price: entryPrice }
 * - Right Boundary Time: points[1] = { time: p2Time, price: entryPrice }
 * - Stop Loss: style.stopLevel = |entryPrice - slPrice| (anchored to initial structural SL)
 * - Take Profit: style.profitLevel = |tpPrice - entryPrice|
 * - Direction: kind = "long-position" (BUY) or "short-position" (SELL)
 */
export function buildAutonomousDrawings(trade, bars = [], tfSec = 300) {
  if (!trade) return null;

  // Only render trades that were actually filled or active!
  // Reject unentered staged, invalidated, or cancelled setups with no fill.
  const isFilledOrActive =
    Boolean(trade.filledAt) ||
    Boolean(trade.filledPrice) ||
    Boolean(trade.entryTime) ||
    ["active", "managing", "closing", "closed_tp", "closed_sl", "closed_be", "closed"].includes(trade.status);
  if (!isFilledOrActive) return null;

  const entryPrice = finiteNumber(trade.filledPrice ?? trade.entryPrice);
  if (entryPrice === null) return null;

  const dir = trade.dir === -1 || String(trade.direction || trade.dirLabel).toLowerCase() === "sell" ? -1 : 1;
  const isShort = dir === -1;
  const kind = isShort ? "short-position" : "long-position";

  // 1. Initial Structural Stop Loss determination
  let initialSl = finiteNumber(
    trade.initialSlPrice ?? trade.levelDetails?.sl ?? trade.stagedLevel?.sl
  );
  if (initialSl !== null && Math.abs(entryPrice - initialSl) < 1e-5) {
    initialSl = null; // Stored SL at exact entry price is breakeven, not original risk
  }

  // If initial structural SL was not explicitly stored, check slPrice ONLY if not at breakeven/trailing
  if (initialSl === null && !trade.isBreakeven && !trade.isTrailing && !trade.isRiskFree) {
    const rawSl = finiteNumber(trade.slPrice);
    if (rawSl !== null && Math.abs(entryPrice - rawSl) > 1e-5) {
      initialSl = rawSl;
    }
  }

  let stopLevel = null;
  if (initialSl !== null) {
    stopLevel = Math.abs(entryPrice - initialSl);
  }

  // 2. Take Profit / Target determination
  let targetPrice = finiteNumber(
    trade.tpPrice ??
      (Array.isArray(trade.targets)
        ? trade.targets.find((t) => t.id === "runner" || t.id === "tp")?.price
        : null) ??
      trade.targetPrice
  );

  // 3. Fallback for trades that do not have original SL in data:
  // Enforce exactly 2.0RR trade setup (stop distance = 1/2 of profit distance from entry)
  if (!(stopLevel > 0)) {
    if (targetPrice !== null && Math.abs(targetPrice - entryPrice) > 1e-5) {
      const profitDist = Math.abs(targetPrice - entryPrice);
      stopLevel = profitDist / 2.0; // 2RR setup: Reward = 2 * Risk
      initialSl = isShort ? entryPrice + stopLevel : entryPrice - stopLevel;
    } else {
      const defaultDist = entryPrice * 0.005; // 0.5% default fallback
      stopLevel = defaultDist;
      initialSl = isShort ? entryPrice + stopLevel : entryPrice - stopLevel;
    }
  }

  if (targetPrice === null) {
    const targetRR = finiteNumber(trade.targetRR) || 2.0;
    targetPrice = isShort ? entryPrice - stopLevel * targetRR : entryPrice + stopLevel * targetRR;
  }

  const profitLevel = Number(Math.abs(targetPrice - entryPrice).toFixed(8));
  stopLevel = Number(stopLevel.toFixed(8));
  if (!(profitLevel > 0) || !(stopLevel > 0)) return null;

  const step = tfSec || 300;

  // Entry timestamp (seconds) in chart coordinates (strictly pure UTC epoch seconds, Rule 1.7)
  let rawEntryTime = null;
  if (trade.filledAt) {
    rawEntryTime = brokerTimestampToUtcSec(trade.filledAt);
  } else if (trade.entryTime) {
    rawEntryTime = brokerTimestampToUtcSec(trade.entryTime);
  } else if (Number.isFinite(trade.brokerEntryTime) && trade.brokerEntryTime > 0) {
    rawEntryTime = brokerTimestampToUtcSec(Number(trade.brokerEntryTime));
  } else if (trade.createdAt) {
    rawEntryTime = brokerTimestampToUtcSec(trade.createdAt);
  } else if (trade.stagedTime) {
    rawEntryTime = brokerTimestampToUtcSec(trade.stagedTime);
  }

  // Safety fallback: if rawEntryTime is ahead of current wall-clock time (> now + 60s),
  // it was an unparsed broker timestamp (+2h / +3h). Auto-convert it:
  if (Number.isFinite(rawEntryTime) && rawEntryTime > Math.round(Date.now() / 1000) + 60) {
    rawEntryTime = brokerTimestampToUtcSec(rawEntryTime);
  }

  const entryBar = findBarForTime(rawEntryTime, bars, step);
  let entryTime = entryBar ? entryBar.time : rawEntryTime;

  if (!entryTime && bars && bars.length) {
    entryTime = bars[Math.max(0, bars.length - 20)].time;
  }
  if (!entryTime) {
    entryTime = Math.round(Date.now() / 1000) - 3600;
  }

  // Active / managing / open status:
  const isOpenStatus = ["active", "managing", "open"].includes(String(trade.status || "").toLowerCase());
  if (isOpenStatus && Array.isArray(bars) && bars.length > 0) {
    if (entryTime < bars[0].time) {
      entryTime = bars[0].time;
    }
  }

  // 4. Right side boundary timestamp (seconds)
  // Strictly truncate at the exact candle where TP, SL, BE, or Trailing SL was hit for CLOSED trades.
  // For open running trades, strictly span to the current live candle + 1 candle offset (+1 step).
  const isClosed =
    !isOpenStatus &&
    (["closed_tp", "closed_sl", "closed_be", "closed", "invalidated", "cancelled", "expired"].includes(
      String(trade.status || "").toLowerCase()
    ) || Boolean(trade.closedAt) || Boolean(trade.closeTime));

  let rawClosedAtSec = null;
  if (trade.closedAt) {
    rawClosedAtSec = brokerTimestampToUtcSec(trade.closedAt);
  } else if (trade.closeTime) {
    rawClosedAtSec = brokerTimestampToUtcSec(trade.closeTime);
  } else if (Number.isFinite(trade.brokerCloseTime) && trade.brokerCloseTime > 0) {
    rawClosedAtSec = brokerTimestampToUtcSec(Number(trade.brokerCloseTime));
  }

  if (Number.isFinite(rawClosedAtSec) && rawClosedAtSec > Math.round(Date.now() / 1000) + 60) {
    rawClosedAtSec = brokerTimestampToUtcSec(rawClosedAtSec);
  }

  const closedBar = rawClosedAtSec ? findBarForTime(rawClosedAtSec, bars, step) : null;
  const closedAtSec = closedBar ? closedBar.time : rawClosedAtSec;

  const bePrice = finiteNumber(trade.breakevenPrice ?? entryPrice);
  const exitPrice = finiteNumber(trade.exitPrice);
  const effectiveTrailingSl = finiteNumber(
    trade.confirmedSlPrice ??
      (trade.isBreakeven ? bePrice : trade.slPrice)
  );

  const isTpOutcome =
    trade.status === "closed_tp" ||
    trade.outcome === "WIN" ||
    trade.closeReason === "tp" ||
    trade.closeReason === "runner";

  const isSlOutcome =
    trade.status === "closed_sl" ||
    trade.outcome === "LOSS" ||
    trade.closeReason === "sl" ||
    trade.closeReason === "stop";

  const isTrailingOutcome =
    trade.closeReason === "trailing" ||
    (trade.status === "closed_be" && Boolean(trade.isTrailing || trade.slHalfMoved || trade.confirmedSlPrice));

  const isBeOutcome =
    trade.status === "closed_be" ||
    trade.outcome === "BREAKEVEN" ||
    trade.closeReason === "breakeven" ||
    trade.closeReason === "risk_free";

  let hitBarTime = null;

  if (isClosed && Array.isArray(bars) && bars.length > 0) {
    if (rawClosedAtSec !== null && rawClosedAtSec < bars[0].time) {
      return null;
    }
    const entryIndex = bars.findIndex((b) => b.time === entryTime);
    const startIdx = entryIndex >= 0 ? entryIndex : 0;

    for (let i = startIdx; i < bars.length; i++) {
      const b = bars[i];
      if (!b || !Number.isFinite(b.time)) continue;

      // Candle must be at or after entry
      if (b.time + step <= entryTime) continue;

      // Do not scan past explicit closedBar if known
      if (closedBar && b.time > closedBar.time + step) break;

      const low = Number(b.low ?? b.close);
      const high = Number(b.high ?? b.close);

      const isExitHit = exitPrice !== null && (isShort ? high >= exitPrice : low <= exitPrice);
      const isTpHit = isShort ? low <= targetPrice : high >= targetPrice;
      const isSlHit = initialSl !== null && (isShort ? high >= initialSl : low <= initialSl);
      const isTrailHit =
        effectiveTrailingSl !== null &&
        (isShort ? high >= effectiveTrailingSl : low <= effectiveTrailingSl);
      const isBeHit = bePrice !== null && (isShort ? high >= bePrice : low <= bePrice);

      const isPostEntry = b.time > entryTime;

      if (isTpOutcome) {
        if (isTpHit || (isExitHit && Math.abs(exitPrice - targetPrice) <= Math.abs(entryPrice - targetPrice) * 0.15)) {
          hitBarTime = b.time;
          break;
        }
      } else if (isSlOutcome) {
        if (isSlHit || (isExitHit && (isShort ? exitPrice >= entryPrice : exitPrice <= entryPrice))) {
          hitBarTime = b.time;
          break;
        }
      } else if (isTrailingOutcome) {
        if (isPostEntry && (isTrailHit || isExitHit)) {
          hitBarTime = b.time;
          break;
        }
      } else if (isBeOutcome) {
        if (isPostEntry && (isBeHit || isTrailHit || isExitHit)) {
          hitBarTime = b.time;
          break;
        }
      } else {
        // Generic closed trade: earliest outcome hit
        if (isTpHit || isSlHit || isExitHit || (isPostEntry && (isTrailHit || isBeHit))) {
          hitBarTime = b.time;
          break;
        }
      }
    }
  }

  let p2Time = null;
  if (isClosed) {
    if (hitBarTime !== null) {
      p2Time = hitBarTime;
    } else if (closedBar !== null) {
      p2Time = closedBar.time;
    } else if (closedAtSec !== null) {
      p2Time = closedAtSec;
    }
  }

  if (p2Time === null) {
    // In live current running trades: right boundary is exactly ONE candle next (+1 step)
    // so the user can see the live wick clearly without excessive rightward extension.
    const lastBarTime = bars && bars.length ? bars[bars.length - 1].time : entryTime;
    p2Time = Math.max(lastBarTime + step, entryTime + step);
  }

  // Ensure minimum 1 bar width so drawing is visible if entry & exit are on the same candle
  // (e.g. on higher timeframes like 1H/4H where trade opened and closed inside the same bar)
  if (p2Time <= entryTime) {
    p2Time = entryTime + step;
  }

  // Distinct institutional model colors (Non-red and non-green to differentiate from manual RR)
  const isProp =
    trade.managementLogic === "prop_firm_safe" ||
    trade.leg === "prop" ||
    String(trade.model || "").toLowerCase().includes("prop");

  // Default Model: Electric Cobalt Blue TP side vs Vivid Tangerine SL side
  // Prop-Firm Model: Neon Violet TP side vs Vivid Fuchsia/Magenta SL side
  const entryColor = isProp ? "#c084fc" : "#38bdf8";
  const targetColor = isProp ? "#a855f7" : "#0284c7"; // Violet vs Cobalt Blue
  const stopColor = isProp ? "#ec4899" : "#ea580c";   // Magenta vs Tangerine Amber

  const posDrawing = {
    id: `auto_${trade._id || trade.id}`,
    kind,
    points: [
      { time: entryTime, price: entryPrice },
      { time: p2Time, price: entryPrice },
    ],
    style: {
      color: entryColor,
      width: 1.5,
      lineStyle: "solid",
      textColor: "#ffffff",
      fontSize: 12,
      targetColor,
      stopColor,
      targetTransparency: 90, // Exactly 10% fill opacity (100 - 90 = 10%)
      stopTransparency: 90,   // Exactly 10% fill opacity (100 - 90 = 10%)
      showPriceLabels: true,
      compactStats: true,
      stopLevel,
      profitLevel,
      accountSize: finiteNumber(trade.initialRiskUsd) || 1000,
      riskPercent: finiteNumber(trade.riskPercent) || 1,
      lotSize: finiteNumber(trade.lotSize ?? trade.lots) || 1,
      idealR: (trade.actualR ?? trade.realizedR) > 0.2 ? finiteNumber(trade.idealR ?? trade.targetRR ?? 2.0) : null,
      actualR: finiteNumber(trade.actualR ?? trade.realizedR ?? (trade.status === "closed_sl" ? -1.0 : 0.0)),
      statsLabel: (() => {
        const ar = Number(trade.actualR ?? trade.realizedR ?? (trade.status === "closed_sl" ? -1.0 : 0.0));
        if (ar > 0.2 || trade.outcome === "WIN") {
          const ir = Number(trade.idealR ?? trade.targetRR ?? 2.0);
          return `IR: +${ir.toFixed(2)}R | AR: +${ar.toFixed(2)}R`;
        }
        if (ar >= -0.2 && ar <= 0.2) {
          return "BE: 0.00R";
        }
        return `AR: ${ar.toFixed(2)}R`;
      })(),
    },
    locked: true,
  };

  // Trailing Stop Loss / Breakeven line from boundary to boundary
  const hasTrailingOrBe =
    Boolean(trade.isBreakeven) ||
    Boolean(trade.isTrailing) ||
    Boolean(trade.isHalfRisk) ||
    Boolean(trade.slHalfMoved) ||
    Boolean(trade.confirmedSlPrice) ||
    (effectiveTrailingSl !== null && initialSl !== null && Math.abs(effectiveTrailingSl - initialSl) > 1e-5);

  const trailingPrice = effectiveTrailingSl ?? (trade.isBreakeven ? bePrice : null);

  let trailingLineDrawing = null;
  const milestoneDrawings = [];
  const digits = trade.symbolSpec?.digits || 5;

  if (hasTrailingOrBe && trailingPrice !== null) {
    const isMovedToProfit = isShort ? trailingPrice <= entryPrice : trailingPrice >= entryPrice;
    const trailLabel = trade.isTrailing
      ? "🔒 Trailing SL"
      : (trade.isBreakeven ? "🛡️ Breakeven SL" : (isMovedToProfit ? "🔒 Protected SL" : "🛡️ Reduced Risk SL"));

    trailingLineDrawing = {
      id: `auto_trail_${trade._id || trade.id}`,
      kind: "trend-line",
      points: [
        { time: entryTime, price: trailingPrice },
        { time: p2Time, price: trailingPrice },
      ],
      style: {
        color: isMovedToProfit ? "#38bdf8" : "#f59e0b",
        width: 2,
        lineStyle: "dashed",
        showPriceLabels: true,
        text: trailLabel,
      },
      locked: true,
    };
  }

  // RR Milestones for actively running trades
  if (isOpenStatus && stopLevel > 0) {
    const isAlreadyRiskFree = trade.isBreakeven || trade.isTrailing || (hasTrailingOrBe && trailingPrice && (isShort ? trailingPrice <= entryPrice : trailingPrice >= entryPrice));

    // A. Breakeven Trigger Milestone (where SL will jump to entry / breakeven)
    if (!isAlreadyRiskFree) {
      const beMilestoneRR = isProp ? 1.5 : (trade.managementLogic === "milestone_50" ? Math.min(1.5, (profitLevel / stopLevel) * 0.5) : 1.25);
      const beTriggerPrice = Number((isShort ? entryPrice - stopLevel * beMilestoneRR : entryPrice + stopLevel * beMilestoneRR).toFixed(digits));

      // Only show if BE trigger is before full TP
      if (profitLevel > stopLevel * beMilestoneRR * 1.05) {
        milestoneDrawings.push({
          id: `auto_be_trigger_${trade._id || trade.id}`,
          kind: "trend-line",
          points: [
            { time: entryTime, price: beTriggerPrice },
            { time: p2Time, price: beTriggerPrice },
          ],
          style: {
            color: "#38bdf8",
            width: 1.5,
            lineStyle: "dotted",
            showPriceLabels: true,
            text: `⚡ BE Trigger (${beMilestoneRR.toFixed(1)}R)`,
          },
          locked: true,
        });
      }

      // Prop-Firm Half-Risk Milestone (1.0R)
      if (isProp && !trade.isHalfRisk && !trade.slHalfMoved) {
        const halfRiskPrice = Number((isShort ? entryPrice - stopLevel * 1.0 : entryPrice + stopLevel * 1.0).toFixed(digits));
        if (profitLevel > stopLevel * 1.1) {
          milestoneDrawings.push({
            id: `auto_half_risk_${trade._id || trade.id}`,
            kind: "trend-line",
            points: [
              { time: entryTime, price: halfRiskPrice },
              { time: p2Time, price: halfRiskPrice },
            ],
            style: {
              color: "#fb923c",
              width: 1,
              lineStyle: "dotted",
              showPriceLabels: true,
              text: "🛡️ Half-Risk (1.0R)",
            },
            locked: true,
          });
        }
      }
    }

    // B. Trailing Activation Milestone (2.0R for Prop, 2.5R for Standard)
    if (!trade.isTrailing) {
      const trailMilestoneRR = isProp ? 2.0 : 2.5;
      const trailTriggerPrice = Number((isShort ? entryPrice - stopLevel * trailMilestoneRR : entryPrice + stopLevel * trailMilestoneRR).toFixed(digits));

      if (profitLevel >= stopLevel * (trailMilestoneRR * 0.95)) {
        milestoneDrawings.push({
          id: `auto_trail_trigger_${trade._id || trade.id}`,
          kind: "trend-line",
          points: [
            { time: entryTime, price: trailTriggerPrice },
            { time: p2Time, price: trailTriggerPrice },
          ],
          style: {
            color: "#a855f7",
            width: 1.5,
            lineStyle: "dotted",
            showPriceLabels: true,
            text: `🎯 Trailing Trigger (${trailMilestoneRR.toFixed(1)}R)`,
          },
          locked: true,
        });
      }
    }

    // C. Multi-target / Partial Milestones
    if (Array.isArray(trade.targets) && trade.targets.length > 1) {
      for (const tg of trade.targets) {
        if (!tg || !Number.isFinite(tg.price)) continue;
        const tgPrice = Number(tg.price.toFixed(digits));
        if (Math.abs(tgPrice - targetPrice) < 1e-5) continue;

        const fractionPct = Math.round((Number(tg.fraction) || 0.5) * 100);
        const tgLabel = `🎯 ${tg.id?.toUpperCase() || 'TP'} (${fractionPct}%)`;

        milestoneDrawings.push({
          id: `auto_target_${trade._id || trade.id}_${tg.id || tgPrice}`,
          kind: "trend-line",
          points: [
            { time: entryTime, price: tgPrice },
            { time: p2Time, price: tgPrice },
          ],
          style: {
            color: "#22c55e",
            width: 1.5,
            lineStyle: "dashed",
            showPriceLabels: true,
            text: tgLabel,
          },
          locked: true,
        });
      }
    }
  }

  return { posDrawing, trailingLineDrawing, milestoneDrawings };
}

/**
 * Returns single native position drawing for backward compatibility.
 */
export function tradeToPositionDrawing(trade, bars = [], tfSec = 300) {
  const result = buildAutonomousDrawings(trade, bars, tfSec);
  return result?.posDrawing ?? null;
}

/**
 * Returns all drawings for the trade (native position tool + trailing SL line + optional milestone lines).
 */
export function tradeToPositionDrawings(trade, bars = [], tfSec = 300, options = {}) {
  const result = buildAutonomousDrawings(trade, bars, tfSec, options);
  if (!result || !result.posDrawing) return [];
  const drawings = [result.posDrawing];
  if (result.trailingLineDrawing) drawings.push(result.trailingLineDrawing);
  if (options.includeMilestones === true && Array.isArray(result.milestoneDrawings)) {
    drawings.push(...result.milestoneDrawings);
  }
  return drawings;
}

/**
 * Converts a staged autonomous trade into the exact native Drawing schema expected by
 * `lightweight-charts-drawing` for "long-position" and "short-position" tools.
 *
 * Requirements:
 * - Positioned on the right side of the current candle with a 4-5 candle gap.
 * - Ephemeral: ID starts with "auto_staged_" so DrawingManager does not persist it.
 * - Automatically removed when invalidated, cancelled, or executed.
 * - Distinct colors: Different from both default RR tool (green/red) and live trade RR tool (cobalt blue / violet).
 */
export function buildStagedTradeDrawings(trade, bars = [], tfSec = 300, index = 0) {
  if (!trade) return null;

  // Staged trades only! (Must be unentered pending / staged setup)
  const isStaged = !trade.status || ["staged", "confirming", "armed", "pending"].includes(trade.status);
  if (!isStaged) return null;

  const entryPrice = finiteNumber(
    trade.entryPrice ?? trade.stagedPrice ?? trade.levelDetails?.entry ?? trade.stagedLevel?.entry
  );
  if (entryPrice === null) return null;

  const dir = trade.dir === -1 || String(trade.direction || trade.dirLabel).toLowerCase() === "sell" ? -1 : 1;
  const isShort = dir === -1;
  const kind = isShort ? "short-position" : "long-position";

  // Stop loss determination
  let slPrice = finiteNumber(
    trade.initialSlPrice ?? trade.slPrice ?? trade.levelDetails?.sl ?? trade.stagedLevel?.sl
  );

  let stopLevel = null;
  if (slPrice !== null && Math.abs(entryPrice - slPrice) > 1e-5) {
    stopLevel = Math.abs(entryPrice - slPrice);
  }

  // Standardized Autonomous Trade Target Determination (TradeProp: 1.5R - 3.0R Safe Bracket):
  let targetTp = finiteNumber(
    trade.tpPrice ??
    trade.propTp ??
    trade.propTarget?.tpPrice ??
    trade.levelDetails?.propTp ??
    trade.levelDetails?.tp ??
    trade.fullTp ??
    trade.targetPrice
  );

  // Fallback for stopLevel if missing
  if (!(stopLevel > 0)) {
    if (targetTp !== null && Math.abs(targetTp - entryPrice) > 1e-5) {
      stopLevel = Math.abs(targetTp - entryPrice) / 2.0;
      slPrice = isShort ? entryPrice + stopLevel : entryPrice - stopLevel;
    } else {
      stopLevel = entryPrice * 0.005;
      slPrice = isShort ? entryPrice + stopLevel : entryPrice - stopLevel;
    }
  }

  // Fallback for targetTp if missing
  if (targetTp === null) {
    const targetRR = finiteNumber(trade.targetRR ?? trade.propRR) || 2.0;
    targetTp = isShort ? entryPrice - stopLevel * targetRR : entryPrice + stopLevel * targetRR;
  }

  const profitLevel = Number(Math.abs(targetTp - entryPrice).toFixed(8));
  stopLevel = Number(stopLevel.toFixed(8));
  if (!(profitLevel > 0) || !(stopLevel > 0)) return null;

  const step = tfSec || 300;

  // Find latest/current candle
  const lastBar = Array.isArray(bars) && bars.length > 0 ? bars[bars.length - 1] : null;
  const lastBarTime = lastBar ? lastBar.time : Math.round(Date.now() / 1000);

  // Safety guard: If market price has already breached the structural invalidation stop loss,
  // suppress drawing so no dead/inverted bracket hovers on the chart.
  if (lastBar && slPrice !== null && entryPrice !== null) {
    const isPriceOrderMatch = Math.abs(lastBar.close - entryPrice) <= Math.max(entryPrice * 0.35, Math.abs(entryPrice - slPrice) * 5);
    if (isPriceOrderMatch) {
      const slBreached = isShort ? lastBar.close >= slPrice : lastBar.close <= slPrice;
      if (slBreached) return null;
    }
  }

  // User specification:
  // "show it on the right side of current candle, keep the gap of the 4-5 candles between current candle and left boundary of the staged live trades RR tool"
  const gapCandles = 5 + (index > 0 ? index * 2 : 0);
  const entryTime = lastBarTime + (gapCandles * step);

  // Box width (12 bars wide for clean readability and proportions)
  const boxWidthBars = 12;
  const p2Time = entryTime + (boxWidthBars * step);

  // Distinct Color Palette for Staged Setups:
  // Different from Default RR (green/red) and Live Trades (cobalt blue & violet)
  const isProp =
    trade.managementLogic === "prop_firm_safe" ||
    trade.leg === "prop" ||
    String(trade.model || "").toLowerCase().includes("prop");

  // Default Staged: Vivid Amber Gold TP vs Crimson Coral SL (with Dashed Amber Entry)
  // Prop-Firm Staged: Electric Cyan TP vs Radiant Rose SL (with Dashed Cyan Entry)
  const entryColor = isProp ? "#06b6d4" : "#f59e0b";
  const targetColor = isProp ? "#22d3ee" : "#facc15";
  const stopColor = isProp ? "#fb7185" : "#e11d48";

  const rrRatio = (profitLevel / stopLevel).toFixed(2);
  const horizonTag = String(trade.horizon || trade.scenario?.id || "DAY").toUpperCase();
  const legTag = isProp ? "prop" : "def";

  const posDrawing = {
    id: `auto_staged_${trade._id || trade.id || trade.fingerprint}_${legTag}`,
    kind,
    points: [
      { time: entryTime, price: entryPrice },
      { time: p2Time, price: entryPrice },
    ],
    style: {
      color: entryColor,
      width: 1.5,
      lineStyle: "dashed",
      textColor: "#ffffff",
      fontSize: 12,
      targetColor,
      stopColor,
      targetTransparency: 88,
      stopTransparency: 88,
      showPriceLabels: true,
      compactStats: true,
      stopLevel,
      profitLevel,
      accountSize: finiteNumber(trade.initialRiskUsd) || 1000,
      riskPercent: finiteNumber(trade.riskPercent) || 1,
      lotSize: finiteNumber(trade.lotSize ?? trade.lots) || 1,
      idealR: finiteNumber(trade.targetRR ?? rrRatio) || Number(rrRatio),
      actualR: 0,
      statsLabel: `STAGED | 1:${rrRatio}RR | ${horizonTag}${isProp ? " (PROP)" : ""}`,
    },
    locked: true,
  };

  return { posDrawing, propLineDrawing: null, halfLineDrawing: null };
}

export function buildStagedTradeDrawing(trade, bars = [], tfSec = 300, index = 0) {
  const result = buildStagedTradeDrawings(trade, bars, tfSec, index);
  return result?.posDrawing ?? null;
}

/**
 * Returns drawings array for a staged setup:
 * 1. Main RR position tool displaying full tradeDefault target
 * 2. Prop Target dashed line (bounded exactly within opening and closing candle times)
 * 3. 50% tradeDefault level dotted line (bounded exactly within opening and closing candle times)
 */
export function tradeToStagedPositionDrawings(trade, bars = [], tfSec = 300, index = 0) {
  const result = buildStagedTradeDrawings(trade, bars, tfSec, index);
  if (!result || !result.posDrawing) return [];
  const list = [result.posDrawing];
  if (result.propLineDrawing) list.push(result.propLineDrawing);
  if (result.halfLineDrawing) list.push(result.halfLineDrawing);
  return list;
}

/**
 * Resolves exact institutional trade idea pricing (entry, sl, tp, rr) for a Radar pair.
 * Strictly checks structural stagedLevels and qualified candidate models.
 * NEVER falls back to current market price. If pricing is not established, returns nulls.
 */
export function resolveRadarTradeIdeaPricing(pair) {
  if (!pair) {
    return {
      dir: 0,
      isLong: false,
      isShort: false,
      entry: null,
      sl: null,
      tp: null,
      rr: null,
      hasSetup: false,
    };
  }

  let dir = pair.dir === 1 ? 1 : pair.dir === -1 ? -1 : 0;
  if (dir === 0) {
    const s = String(pair.side || pair.dirLabel || pair.direction || "").toUpperCase();
    if (s.includes("BUY") || s.includes("LONG") || s.includes("BULL")) dir = 1;
    else if (s.includes("SELL") || s.includes("SHORT") || s.includes("BEAR")) dir = -1;
  }

  const staged = pair.stagedLevel || pair.entryModel;
  const candidate =
    Array.isArray(pair.candidates) && pair.candidates.length > 0
      ? pair.candidates[0]
      : Array.isArray(pair.entryModel?.allCandidates) && pair.entryModel.allCandidates.length > 0
      ? pair.entryModel.allCandidates[0]
      : Array.isArray(staged?.allCandidates) && staged.allCandidates.length > 0
      ? staged.allCandidates[0]
      : null;

  const entry = finiteNumber(
    staged?.entry ??
    staged?.price ??
    staged?.entryLevel ??
    candidate?.entry ??
    candidate?.price ??
    pair.entryModel?.entry ??
    pair.entryModel?.price ??
    pair.entryPrice ??
    pair.entry
  );

  const sl = finiteNumber(
    staged?.sl ??
    staged?.initialSlPrice ??
    candidate?.sl ??
    candidate?.initialSlPrice ??
    pair.entryModel?.sl ??
    pair.entryModel?.initialSlPrice ??
    pair.slPrice ??
    pair.sl
  );

  const tp = finiteNumber(
    staged?.tp ??
    candidate?.tp ??
    candidate?.targetPrice ??
    (Array.isArray(staged?.targets) ? staged.targets[0]?.price : null) ??
    (Array.isArray(pair.targets) ? pair.targets[0]?.price : null) ??
    pair.entryModel?.tp ??
    pair.entryModel?.targetPrice ??
    pair.tpPrice ??
    pair.tp
  );

  const rawRR = staged?.rr ?? staged?.targetRR ?? candidate?.rr ?? candidate?.targetRR ?? pair.rr ?? pair.targetRR;
  let rr = finiteNumber(rawRR);
  if (rr === null && entry !== null && sl !== null && tp !== null) {
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    if (risk > 0 && reward > 0) {
      rr = Number((reward / risk).toFixed(2));
    }
  }

  const hasSetup = entry !== null && sl !== null && tp !== null && dir !== 0;

  return {
    dir,
    isLong: dir === 1,
    isShort: dir === -1,
    entry,
    sl,
    tp,
    rr,
    hasSetup,
  };
}

/**
 * Builds a lightweight-charts-drawing RR tool for a Market Opportunity Radar trade idea.
 * Uses a unique institutional color palette:
 * - Electric Violet / Purple (#a855f7) for Profit/Target
 * - Burnt Orange / Tangerine (#ea580c) for Risk/Stop
 * - Lavender (#c084fc) for Entry
 * Completely distinct from Live trades (Green/Red) and Staged trades (Cyan/Rose or Gold/Crimson).
 */
export function buildRadarTradeIdeaDrawing(pair, bars = [], tfSec = 300, index = 0) {
  if (!pair) return null;

  const pricing = resolveRadarTradeIdeaPricing(pair);
  if (!pricing.hasSetup) return null;

  const { isShort, entry: entryPrice, sl: slPrice, tp: tpPrice } = pricing;
  const kind = isShort ? "short-position" : "long-position";

  const stopLevel = Number(Math.abs(entryPrice - slPrice).toFixed(8));
  const profitLevel = Number(Math.abs(tpPrice - entryPrice).toFixed(8));
  if (!(stopLevel > 0) || !(profitLevel > 0)) return null;

  // Safety guard: If current price breached SL, suppress drawing
  const lastBar = Array.isArray(bars) && bars.length > 0 ? bars[bars.length - 1] : null;
  if (lastBar && slPrice !== null && entryPrice !== null) {
    const isPriceOrderMatch = Math.abs(lastBar.close - entryPrice) <= Math.max(entryPrice * 0.35, Math.abs(entryPrice - slPrice) * 5);
    if (isPriceOrderMatch) {
      const slBreached = isShort ? lastBar.close >= slPrice : lastBar.close <= slPrice;
      if (slBreached) return null;
    }
  }

  const step = tfSec || 300;
  const lastBarTime = lastBar ? lastBar.time : Math.round(Date.now() / 1000);

  // Position to the right with offset so it doesn't overlap staged trades
  const gapCandles = 3 + (index * 12);
  const entryTime = lastBarTime + (gapCandles * step);
  const boxWidthBars = 12;
  const p2Time = entryTime + (boxWidthBars * step);

  // Distinct Radar Color Palette:
  // Target: Electric Violet (#a855f7)
  // Stop: Burnt Orange / Amber (#ea580c)
  // Entry: Lavender (#c084fc)
  const entryColor = "#c084fc";
  const targetColor = "#a855f7";
  const stopColor = "#ea580c";

  const rrRatio = (profitLevel / stopLevel).toFixed(2);
  const horizonTag = String(pair.horizon || pair.scenario?.id || "DAY").toUpperCase();
  const statusClean = String(pair.status || "RADAR").replace(/_/g, " ");

  const posDrawing = {
    id: `auto_radar_${pair.radarKey || pair.symbol || "idea"}_${index}`,
    kind,
    points: [
      { time: entryTime, price: entryPrice },
      { time: p2Time, price: entryPrice },
    ],
    style: {
      color: entryColor,
      width: 1.5,
      lineStyle: "dashed",
      textColor: "#ffffff",
      fontSize: 12,
      targetColor,
      stopColor,
      targetTransparency: 85,
      stopTransparency: 85,
      showPriceLabels: true,
      compactStats: true,
      stopLevel,
      profitLevel,
      accountSize: 100000,
      riskPercent: 1,
      lotSize: 1,
      idealR: Number(rrRatio),
      actualR: 0,
      statsLabel: `RADAR | 1:${rrRatio}RR | ${horizonTag} | ${statusClean}`,
    },
    locked: true,
  };

  return posDrawing;
}

/**
 * Returns drawings array for a Radar Opportunity Trade Idea.
 */
export function pairToRadarTradeIdeaDrawings(pair, bars = [], tfSec = 300, index = 0) {
  const d = buildRadarTradeIdeaDrawing(pair, bars, tfSec, index);
  return d ? [d] : [];
}

