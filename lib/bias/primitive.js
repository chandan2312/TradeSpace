/**
 * lib/bias/primitive.js
 *
 * Minimal Institutional Bias Engine Telemetry Renderer.
 *
 * STRICT "NO-LINES" ARCHITECTURE:
 * - NEVER draws horizontal lines or giant shaded boxes across historical candlesticks.
 * - Historical candles remain 100% clean, crisp, and uncluttered.
 *
 * HOW ELEMENTS ARE PLOTTED:
 * 1. Event Markers (Sweeps & MSS/QML Break):
 *    - Rendered as compact single-candle glyphs directly at the wick of the candle that formed them:
 *      `🧹 SWEEP: [Name] ▼/▲` (at the exact sweep wick tip).
 *      `⚡ MSS [▲/▼]` (at the exact structural break candle).
 *    - Zero lines slicing across other candles.
 *
 * 2. Forward Target Stubs (In the right open space past the live candle):
 *    - Positioned ONLY in the blank future space ahead of the current live candle:
 *      `🎯 DOL: [Name] [Price]` (Target Draw On Liquidity)
 *      `🛑 Inval: [Price]` (Structural Invalidation)
 *      `x x x BSL: [Name] [Price]` (Nearest Buy-Side Liquidity Pool)
 *      `x x x SSL: [Name] [Price]` (Nearest Sell-Side Liquidity Pool)
 *      `50% EQ [Price]` & `OTE 70.5% [Price]` (Macro Range Equilibrium & OTE)
 *      `4H FVG` (Compact vertical bracket in open space, strictly unmitigated only)
 *    - Each target sits at its exact price coordinate with a short 22px forward stub.
 *    - Never cuts backwards across candlestick bodies or wicks.
 */

export class BiasEnginePrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._symBias = null;
    this._tf = "M15";
    this._bars = [];
    this._enabled = true;
    this._digits = 5;

    const renderer = { draw: (target) => this._draw(target) };
    this._paneView = { renderer: () => renderer, zOrder: () => "bottom" };
  }

  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  updateAllViews() {}

  paneViews() {
    return [this._paneView];
  }

  update(symBias, tf, bars, enabled = true, digits = 5) {
    this._symBias = symBias || null;
    this._tf = tf || "M15";
    this._bars = bars || [];
    this._enabled = Boolean(enabled);
    this._digits = digits || 5;
    this._requestUpdate?.();
  }

  _draw(target) {
    if (!this._enabled || !this._symBias || !this._bars.length) return;
    const chart = this._chart;
    const series = this._series;
    if (!chart || !series) return;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const ts = chart.timeScale();
      const X = (i) => ts.logicalToCoordinate(i);
      const Y = (p) => series.priceToCoordinate(p);
      const W = mediaSize.width;
      const H = mediaSize.height;

      const bars = this._bars;
      const n = bars.length;
      const lastBar = bars[n - 1];
      const curPrice = lastBar.close;
      const digits = this._digits;
      const fmt = (p) => Number(p).toFixed(digits);

      // Local ATR to filter distant levels
      const recent = bars.slice(-25);
      const avgSpread = recent.reduce((sum, b) => sum + Math.abs(b.high - b.low), 0) / (recent.length || 1);
      const maxDistance = avgSpread * 7;

      const bias = this._symBias;
      const brain = bias.brain || bias.executionReadiness || {};

      // Calculate where the right open space begins (ahead of the last candle)
      const lastBarX = X(n - 1);
      // If lastBarX is on screen, start stubs slightly ahead; if scrolled past, anchor safely
      const stubX = lastBarX != null ? Math.min(Math.max(lastBarX + 12, 10), W - 140) : W - 140;
      const stubLen = 22;

      // -------------------------------------------------------------
      // 1. LIQUIDITY SWEEPS (Single-Candle Wick Markers, NO Lines)
      // -------------------------------------------------------------
      const allSweeps = [
        ...(Array.isArray(bias.liquidity?.sweeps) ? bias.liquidity.sweeps : []),
        ...(Array.isArray(bias.htfLiquidity?.sweeps) ? bias.htfLiquidity.sweeps : []),
      ].filter((s) => s && (s.age == null || s.age <= 24));

      const drawnSweeps = new Set();
      let drawnSweepCount = 0;

      for (const sw of allSweeps) {
        if (drawnSweepCount >= 3) break;
        const levelPrice = sw.price ?? sw.levelPrice;
        const sweptPrice = sw.sweptPrice ?? levelPrice;
        if (!Number.isFinite(levelPrice) || !Number.isFinite(sweptPrice)) continue;

        const sweepKey = `${sw.name || "SWEEP"}_${levelPrice.toFixed(digits)}`;
        if (drawnSweeps.has(sweepKey)) continue;

        let iSweep = -1;
        if (sw.time || sw.candleTime) {
          iSweep = findBarIndexForTime(bars, sw.time || sw.candleTime);
        }
        if (iSweep < 0) {
          iSweep = findBarIndexForPrice(bars, sweptPrice, sw.side, 30);
        }
        if (iSweep < 0 && sw.sweptAt != null && sw.sweptAt < n) {
          iSweep = sw.sweptAt;
        }
        if (iSweep < 0 || iSweep >= n) continue;

        const xSweep = X(iSweep);
        const ySwept = Y(sweptPrice);
        if (xSweep == null || ySwept == null || xSweep < 0 || xSweep > W) continue;

        drawnSweeps.add(sweepKey);
        drawnSweepCount++;

        const isBslSweep = sw.side === 1; // High Swept
        const tagBg = isBslSweep ? "rgba(67, 20, 7, 0.9)" : "rgba(12, 74, 110, 0.9)";
        const tagColor = isBslSweep ? "#fb923c" : "#38bdf8";

        // Draw ONLY a single-point marker at the wick tip — NO horizontal lines!
        const labelText = `🧹 ${sw.name || "SWEEP"} (${fmt(levelPrice)}) ${isBslSweep ? "▼" : "▲"}`;
        drawCompactPill(ctx, labelText, xSweep, ySwept, {
          color: tagColor,
          bg: tagBg,
          fontWeight: "700",
          align: "center",
          offsetY: isBslSweep ? -9 : 9,
        });
      }

      // -------------------------------------------------------------
      // 2. FRESH UNMITIGATED QML / MSS (Single-Candle Marker + Stub)
      // -------------------------------------------------------------
      const qml = bias.qml;
      if (
        qml &&
        qml.valid &&
        qml.qmlPrice &&
        qml.state !== "mitigated" &&
        !qml.mitigated &&
        qml.age <= 16
      ) {
        const yQml = Y(qml.qmlPrice);
        if (yQml != null && yQml >= 0 && yQml <= H && Math.abs(qml.qmlPrice - curPrice) <= maxDistance) {
          const isBull = qml.dir > 0;

          // Check mitigation on visible chart bars
          let isMitigated = false;
          let breakIdx = qml.breakI ?? (qml.i ? qml.i : n - 1 - qml.age);
          if (breakIdx >= 0 && breakIdx < n - 1) {
            for (let m = breakIdx + 1; m < n; m++) {
              if (isBull && bars[m].low <= qml.qmlPrice) {
                isMitigated = true;
                break;
              }
              if (!isBull && bars[m].high >= qml.qmlPrice) {
                isMitigated = true;
                break;
              }
            }
          }

          if (!isMitigated) {
            // A. Single-candle break marker on the structural break bar
            if (breakIdx >= 0 && breakIdx < n) {
              const xBreak = X(breakIdx);
              if (xBreak != null && xBreak >= 0 && xBreak <= W) {
                const bPrice = isBull ? bars[breakIdx].high : bars[breakIdx].low;
                const yB = Y(bPrice);
                if (yB != null) {
                  drawCompactPill(ctx, `⚡ MSS ${isBull ? "▲" : "▼"}`, xBreak, yB, {
                    color: isBull ? "#4ade80" : "#f87171",
                    bg: isBull ? "rgba(20, 83, 45, 0.9)" : "rgba(69, 10, 10, 0.9)",
                    align: "center",
                    offsetY: isBull ? -8 : 8,
                  });
                }
              }
            }

            // B. Short stub in the right open space ONLY
            drawForwardStub(ctx, stubX, stubLen, yQml, `QML ${isBull ? "▲" : "▼"} ${fmt(qml.qmlPrice)}`, {
              color: isBull ? "#4ade80" : "#f87171",
              bg: isBull ? "rgba(20, 83, 45, 0.85)" : "rgba(69, 10, 10, 0.85)",
            });
          }
        }
      }

      // -------------------------------------------------------------
      // 3. TARGET DRAW ON LIQUIDITY (DOL) — Forward Stub in Open Space
      // -------------------------------------------------------------
      const targetDOL = brain.targetDOL;
      if (targetDOL && Number.isFinite(targetDOL.price)) {
        const p = targetDOL.price;
        const y = Y(p);
        if (y != null && y >= 0 && y <= H && Math.abs(p - curPrice) <= maxDistance * 1.5) {
          const isBull = p >= curPrice;
          const color = isBull ? "#22d3ee" : "#fb923c";
          const bg = isBull ? "rgba(8, 51, 68, 0.9)" : "rgba(67, 20, 7, 0.9)";
          const targetName = targetDOL.name || targetDOL.targetSide || "DOL";

          drawForwardStub(ctx, stubX, stubLen + 8, y, `🎯 DOL: ${targetName} ${fmt(p)}`, {
            color,
            bg,
            fontWeight: "700",
          });
        }
      }

      // -------------------------------------------------------------
      // 4. STRUCTURAL INVALIDATION LEVEL — Forward Stub in Open Space
      // -------------------------------------------------------------
      const inval = brain.invalidationPrice;
      const invalPrice = typeof inval === "number" ? inval : inval?.price;
      if (Number.isFinite(invalPrice)) {
        const y = Y(invalPrice);
        if (y != null && y >= 0 && y <= H && Math.abs(invalPrice - curPrice) <= maxDistance) {
          drawForwardStub(ctx, stubX, stubLen, y, `🛑 Inval: ${fmt(invalPrice)}`, {
            color: "#f87171",
            bg: "rgba(69, 10, 10, 0.9)",
            fontWeight: "700",
          });
        }
      }

      // -------------------------------------------------------------
      // 5. UNMITIGATED ACTIVE LIQUIDITY POOLS (Forward Stubs in Open Space)
      // -------------------------------------------------------------
      const htfPools = bias.htfLiquidity?.pools || {};
      const keyLevels = bias.htfLiquidity?.keyLevels || {};
      const intradayLevels = bias.liquidity?.levels || [];

      const poolCandidates = [];
      for (const p of htfPools.bsl || []) {
        if (p && Number.isFinite(p.price) && p.price > curPrice) {
          poolCandidates.push({ name: p.name || "4H BSL", price: p.price, side: 1 });
        }
      }
      for (const p of htfPools.ssl || []) {
        if (p && Number.isFinite(p.price) && p.price < curPrice) {
          poolCandidates.push({ name: p.name || "4H SSL", price: p.price, side: -1 });
        }
      }
      for (const [key, val] of Object.entries(keyLevels)) {
        if (val && Number.isFinite(val.price)) {
          const isHigh = val.side === 1 || key.endsWith("H");
          poolCandidates.push({ name: key, price: val.price, side: isHigh ? 1 : -1 });
        }
      }
      for (const l of intradayLevels) {
        if (l && l.state === "untapped" && Number.isFinite(l.price)) {
          poolCandidates.push({ name: l.name, price: l.price, side: l.side });
        }
      }

      const activeBsl = [];
      const activeSsl = [];

      for (const p of poolCandidates) {
        if (Math.abs(p.price - curPrice) > maxDistance) continue;

        // Check if penetrated by recent visible candles
        let alreadySwept = false;
        for (let k = Math.max(0, n - 40); k < n; k++) {
          if (p.side === 1 && bars[k].high >= p.price) {
            alreadySwept = true;
            break;
          }
          if (p.side === -1 && bars[k].low <= p.price) {
            alreadySwept = true;
            break;
          }
        }
        if (alreadySwept) continue;

        if (p.side === 1 && p.price > curPrice) {
          if (!activeBsl.some((b) => Math.abs(b.price - p.price) <= 0.25 * avgSpread)) {
            activeBsl.push(p);
          }
        } else if (p.side === -1 && p.price < curPrice) {
          if (!activeSsl.some((s) => Math.abs(s.price - p.price) <= 0.25 * avgSpread)) {
            activeSsl.push(p);
          }
        }
      }

      activeBsl.sort((a, b) => a.price - b.price);
      activeSsl.sort((a, b) => b.price - a.price);

      // Top 2 nearest BSL and top 2 nearest SSL in open space
      for (const pool of [...activeBsl.slice(0, 2), ...activeSsl.slice(0, 2)]) {
        const y = Y(pool.price);
        if (y == null || y < 0 || y > H) continue;

        const isBsl = pool.side === 1;
        const color = isBsl ? "#38bdf8" : "#fb923c";
        const bg = isBsl ? "rgba(12, 74, 110, 0.88)" : "rgba(67, 20, 7, 0.88)";
        const labelText = `x x x ${pool.name || (isBsl ? "BSL" : "SSL")} ${fmt(pool.price)}`;

        drawForwardStub(ctx, stubX, stubLen, y, labelText, {
          color,
          bg,
        });
      }

      // -------------------------------------------------------------
      // 6. MACRO DEALING RANGE EQUILIBRIUM & OTE (Forward Stubs in Open Space)
      // -------------------------------------------------------------
      const ranges = bias.ranges || {};
      const activeRange =
        this._tf === "M1" || this._tf === "M5" || this._tf === "M15"
          ? ranges.H1 || ranges.H4 || ranges.M15 || ranges.D1
          : this._tf === "M30" || this._tf === "H1"
          ? ranges.H4 || ranges.D1 || ranges.H1
          : ranges.D1 || ranges.H4 || ranges.H1;

      if (activeRange && activeRange.eq) {
        const { eq, fibs } = activeRange;
        const tfLabel = activeRange.tf || "HTF";

        // 50% Equilibrium forward stub
        const yEq = Y(eq);
        if (yEq != null && yEq >= 0 && yEq <= H && Math.abs(eq - curPrice) <= maxDistance) {
          drawForwardStub(ctx, stubX, stubLen, yEq, `${tfLabel} 50% EQ ${fmt(eq)}`, {
            color: "#94a3b8",
            bg: "rgba(30, 41, 59, 0.88)",
          });
        }

        // OTE 70.5% forward stub
        const ote705 = fibs?.ote705 || fibs?.oteDiscount705;
        if (ote705 && Math.abs(ote705 - curPrice) <= maxDistance) {
          const yOte = Y(ote705);
          if (yOte != null && yOte >= 0 && yOte <= H) {
            drawForwardStub(ctx, stubX, stubLen, yOte, `${tfLabel} OTE 70.5% ${fmt(ote705)}`, {
              color: "#fbbf24",
              bg: "rgba(40, 25, 6, 0.88)",
            });
          }
        }
      }

      // -------------------------------------------------------------
      // 7. UNMITIGATED HTF FVG (Compact Open-Space Bracket, NO giant boxes)
      // -------------------------------------------------------------
      const htfFvg = bias.htfFvg || brain.htfFvg || {};
      const rawFvgList = [
        ...(Array.isArray(htfFvg.unmitigated) ? htfFvg.unmitigated : []),
        ...(Array.isArray(htfFvg.activeGaps) ? htfFvg.activeGaps : []),
        ...(Array.isArray(htfFvg.unreclaimedIfvgs) ? htfFvg.unreclaimedIfvgs : []),
      ].filter(Boolean);

      const renderedFvgs = new Set();
      let drawnFvgCount = 0;

      for (const fvg of rawFvgList) {
        if (!fvg.top || !fvg.bottom || drawnFvgCount >= 2) continue;
        if (fvg.fillPct >= 0.85 || fvg.state === "FILLED" || fvg.state === "MITIGATED") continue;

        const key = `${fvg.top.toFixed(digits)}_${fvg.bottom.toFixed(digits)}`;
        if (renderedFvgs.has(key)) continue;

        const isBull =
          (fvg.dir != null && fvg.dir > 0) ||
          fvg.type === "bullish" ||
          fvg.type === "BULLISH_FVG" ||
          fvg.side === 1;

        // Strict mitigation check on visible chart bars
        let isMitigated = false;
        let iStart = fvg.bornTime ? findBarIndexForTime(bars, fvg.bornTime) : -1;
        if (iStart >= 0 && iStart < n - 1) {
          for (let j = iStart + 1; j < n; j++) {
            const b = bars[j];
            if (isBull && (b.low <= fvg.bottom || (fvg.midpoint && b.close < fvg.midpoint))) {
              isMitigated = true;
              break;
            }
            if (!isBull && (b.high >= fvg.top || (fvg.midpoint && b.close > fvg.midpoint))) {
              isMitigated = true;
              break;
            }
          }
        }
        if (isMitigated) {
          renderedFvgs.add(key);
          continue;
        }

        const yTop = Y(fvg.top);
        const yBot = Y(fvg.bottom);
        if (yTop == null || yBot == null) continue;

        const minY = Math.min(yTop, yBot);
        const boxH = Math.max(Math.abs(yBot - yTop), 4);
        if (minY + boxH < 0 || minY > H) continue;

        renderedFvgs.add(key);
        drawnFvgCount++;

        // Render ONLY as a compact 14px bracket in the right open space
        const bracketX = stubX + stubLen + 2;
        const color = isBull ? "rgba(34, 197, 94, 0.5)" : "rgba(239, 68, 68, 0.5)";
        const tagColor = isBull ? "#4ade80" : "#f87171";
        const tagBg = isBull ? "rgba(20, 83, 45, 0.88)" : "rgba(69, 10, 10, 0.88)";

        ctx.fillStyle = isBull ? "rgba(34, 197, 94, 0.12)" : "rgba(239, 68, 68, 0.12)";
        ctx.fillRect(bracketX, minY, 14, boxH);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(bracketX, minY, 14, boxH);

        const fvgLabel = `${fvg.timeframe || "4H"} FVG`;
        drawCompactPill(ctx, fvgLabel, bracketX + 18, minY + boxH / 2, {
          color: tagColor,
          bg: tagBg,
          offsetY: 0,
        });
      }
    });
  }
}

/**
 * Searches for the first bar with time >= targetTimestamp
 */
function findBarIndexForTime(bars, targetTimestamp) {
  if (!bars || !bars.length || !Number.isFinite(targetTimestamp)) return -1;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].time >= targetTimestamp) return i;
  }
  return -1;
}

/**
 * Searches backwards for the candle nearest to targetPrice
 */
function findBarIndexForPrice(bars, targetPrice, side = 0, lookback = 80) {
  if (!bars || !bars.length || !Number.isFinite(targetPrice)) return -1;
  const start = Math.max(0, bars.length - lookback);
  let bestIdx = -1;
  let minDiff = Infinity;
  for (let i = bars.length - 1; i >= start; i--) {
    const b = bars[i];
    const diffH = Math.abs(b.high - targetPrice);
    const diffL = Math.abs(b.low - targetPrice);
    const diff = side > 0 ? diffH : side < 0 ? diffL : Math.min(diffH, diffL);
    if (diff < minDiff) {
      minDiff = diff;
      bestIdx = i;
      if (diff === 0) break;
    }
  }
  return bestIdx;
}

/**
 * Renders a clean short forward stub in the right open space ahead of the live candle.
 * NEVER cuts across historical candles.
 */
function drawForwardStub(ctx, startX, len, y, text, options = {}) {
  const {
    color = "#cbd5e1",
    bg = "rgba(15, 23, 42, 0.88)",
    fontWeight = "600",
    fontSize = 10,
  } = options;

  // Short forward stub tick in the open space
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  ctx.moveTo(startX, y);
  ctx.lineTo(startX + len, y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Compact tag directly next to the stub
  drawCompactPill(ctx, text, startX + len + 4, y, {
    color,
    bg,
    fontWeight,
    fontSize,
    offsetY: 0,
    align: "left",
  });
}

/**
 * Compact micro-pill renderer.
 */
function drawCompactPill(ctx, text, x, y, options = {}) {
  const {
    color = "#cbd5e1",
    bg = "rgba(15, 23, 42, 0.88)",
    fontSize = 9.5,
    fontWeight = "600",
    offsetY = 0,
    align = "left",
  } = options;

  ctx.font = `${fontWeight} ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
  const metrics = ctx.measureText(text);
  const padX = 4;
  const padY = 2;
  const w = metrics.width + padX * 2;
  const h = fontSize + padY * 2;

  let lx = x;
  if (align === "center") {
    lx = x - w / 2;
  }
  const ly = y + offsetY - h / 2;

  ctx.fillStyle = bg;
  ctx.fillRect(lx, ly, w, h);

  ctx.strokeStyle = color;
  ctx.lineWidth = 0.75;
  ctx.strokeRect(lx, ly, w, h);

  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, lx + padX, ly + h / 2);
}
