// lib/autonomous/tradeDrawing.js — Map Autonomous Trades to Lightweight Charts Drawing Tools (long-position / short-position)

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

  // If rawSec is completely disconnected from bars range (e.g. synthetic test timestamps 3 years apart)
  if (rawSec < firstBar.time - 86400 * 365 || rawSec > lastBar.time + 86400 * 365) {
    return null;
  }

  // Clamping to visible history range so trades entering before loaded bars neatly anchor to the left edge
  if (rawSec <= firstBar.time) return firstBar;
  if (rawSec >= lastBar.time) return lastBar;

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
    ["active", "managing", "closing", "closed_tp", "closed_sl", "closed_be"].includes(trade.status);
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

  // Entry timestamp (seconds) in chart coordinates
  let rawEntryTime = null;
  if (Number.isFinite(trade.brokerEntryTime) && trade.brokerEntryTime > 0) {
    rawEntryTime = Number(trade.brokerEntryTime);
  } else if (trade.filledAt) {
    rawEntryTime = Math.round(new Date(trade.filledAt).getTime() / 1000);
  } else if (trade.createdAt) {
    rawEntryTime = Math.round(new Date(trade.createdAt).getTime() / 1000);
  }

  // If live broker trade has UTC timestamps but bars are in EET broker time (~3h ahead):
  if (trade.isLive && rawEntryTime !== null && Array.isArray(bars) && bars.length > 0) {
    if (rawEntryTime + 10800 >= bars[0].time - step && rawEntryTime + 10800 <= bars[bars.length - 1].time + step) {
      if (rawEntryTime < bars[0].time - step) {
        rawEntryTime += 10800;
      }
    }
  }

  const entryBar = findBarForTime(rawEntryTime, bars, step);
  let entryTime = entryBar ? entryBar.time : rawEntryTime;

  if (!entryTime && bars && bars.length) {
    entryTime = bars[Math.max(0, bars.length - 20)].time;
  }
  if (!entryTime) {
    entryTime = Math.round(Date.now() / 1000) - 3600;
  }

  // 4. Right side boundary timestamp (seconds)
  // Strictly truncate at the exact candle where TP, SL, BE, or Trailing SL was hit.
  // For open running trades with no exit hit yet, snap to the latest current bar (+1 step for live wick visibility).
  const isClosed =
    ["closed_tp", "closed_sl", "closed_be", "closed", "invalidated", "cancelled", "expired"].includes(
      trade.status
    ) || Boolean(trade.closedAt);

  let rawClosedAtSec = null;
  if (Number.isFinite(trade.brokerCloseTime) && trade.brokerCloseTime > 0) {
    rawClosedAtSec = Number(trade.brokerCloseTime);
  } else if (trade.closedAt) {
    rawClosedAtSec = Math.round(new Date(trade.closedAt).getTime() / 1000);
  }

  if (trade.isLive && rawClosedAtSec !== null && Array.isArray(bars) && bars.length > 0) {
    if (rawClosedAtSec + 10800 >= bars[0].time - step && rawClosedAtSec + 10800 <= bars[bars.length - 1].time + step) {
      if (rawClosedAtSec < bars[0].time - step) {
        rawClosedAtSec += 10800;
      }
    }
  }

  // Suppress closed trades that finished completely before the visible chart range
  if (isClosed && rawClosedAtSec !== null && Array.isArray(bars) && bars.length > 0 && rawClosedAtSec < bars[0].time) {
    return null;
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

  if (Array.isArray(bars) && bars.length > 0) {
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
      } else if (isClosed) {
        // Generic closed trade: earliest outcome hit
        if (isTpHit || isSlHit || isExitHit || (isPostEntry && (isTrailHit || isBeHit))) {
          hitBarTime = b.time;
          break;
        }
      } else {
        // Active / managing trade: check if live candles reached TP or pulled back to tap trailing SL line!
        if (isTpHit) {
          hitBarTime = b.time;
          break;
        }
        if (isPostEntry && (isTrailHit || (trade.isBreakeven && isBeHit))) {
          hitBarTime = b.time;
          break;
        }
      }
    }
  }

  let p2Time = null;
  if (hitBarTime !== null) {
    p2Time = hitBarTime;
  } else if (isClosed && closedBar !== null) {
    p2Time = closedBar.time;
  } else if (isClosed && closedAtSec !== null) {
    p2Time = closedAtSec;
  } else {
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
  if (hasTrailingOrBe && trailingPrice !== null) {
    trailingLineDrawing = {
      id: `auto_trail_${trade._id || trade.id}`,
      kind: "trend-line",
      points: [
        { time: entryTime, price: trailingPrice },
        { time: p2Time, price: trailingPrice },
      ],
      style: {
        color: isProp ? "#c084fc" : "#38bdf8",
        width: 1.5,
        lineStyle: "dashed",
        showPriceLabels: true,
      },
      locked: true,
    };
  }

  return { posDrawing, trailingLineDrawing };
}

/**
 * Returns single native position drawing for backward compatibility.
 */
export function tradeToPositionDrawing(trade, bars = [], tfSec = 300) {
  const result = buildAutonomousDrawings(trade, bars, tfSec);
  return result?.posDrawing ?? null;
}

/**
 * Returns all drawings for the trade (native position tool + trailing SL line if active).
 */
export function tradeToPositionDrawings(trade, bars = [], tfSec = 300) {
  const result = buildAutonomousDrawings(trade, bars, tfSec);
  if (!result || !result.posDrawing) return [];
  return result.trailingLineDrawing ? [result.posDrawing, result.trailingLineDrawing] : [result.posDrawing];
}
