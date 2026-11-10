// useDrawings — Pure DrawingManager integration for lightweight-charts v5.
//
// 100% powered by `lightweight-charts-drawing` (TradingView standard tools).
// No custom drawing primitives or non-standard tools.
// Manages reactive tool states, selection, persistence to localStorage + API,
// undo/redo, and cross-symbol isolation.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sanitizeDrawings } from "./core.js";
import { toCanonicalSymbol, toBrokerSymbol } from "../symbols/mapping.js";
import { calculateSlDistance } from "../autonomous/tradeDrawing.js";

const LS_KEY = "ts_drawings";
const LS_STYLE_KEY = "ts_tool_last_style";

export function resolveSymbolDrawings(all, sym) {
  if (!all || !sym) return null;
  if (all[sym] && all[sym].length) return all[sym];
  const canon = toCanonicalSymbol(sym);
  if (all[canon] && all[canon].length) return all[canon];
  const broker = toBrokerSymbol(canon);
  if (all[broker] && all[broker].length) return all[broker];
  for (const [k, v] of Object.entries(all)) {
    if (v && v.length && toCanonicalSymbol(k) === canon) return v;
  }
  return null;
}

export function useDrawings({ drawingManagerRef, chartReady, symbol, tf, barsRef, isActive, wrapRef, dataVersion, storageKey = LS_KEY, persistRemote = true } = {}) {
  const [activeTool, setActiveToolState] = useState(null);
  const [lockTool, setLockTool] = useState(false);
  const [magnetMode, setMagnetModeState] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [selectedId, setSelectedIdState] = useState(null);
  const [drawingsVersion, setDrawingsVersion] = useState(0);

  const clientIdRef = useRef(Math.random().toString(36).slice(2) + Date.now().toString(36));
  const currentSymbolRef = useRef(symbol);
  currentSymbolRef.current = symbol;

  const prevSymbolRef = useRef(symbol);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const isImportingRef = useRef(false);
  const lastExportedRef = useRef("");
  const dismissedAutoIdsRef = useRef(new Set());
  const initialBarsLoadedRef = useRef(new Set());
  const UNDO_LIMIT = 50;

  const scopeKey = symbol;

  // 1. When chartReady becomes true, wire up listeners and load saved drawings
  useEffect(() => {
    if (!chartReady) return;
    const mgr = drawingManagerRef?.current;
    if (!mgr) return;

    // Load initial drawings for this symbol
    try {
      isImportingRef.current = true;
      const all = JSON.parse(localStorage.getItem(storageKey) || "{}");
      const activeSym = currentSymbolRef.current || symbol;
      const raw = resolveSymbolDrawings(all, activeSym);
      if (raw) {
        const cleaned = sanitizeDrawings(raw);
        const str = JSON.stringify(cleaned);
        mgr.importJSON(str);
        lastExportedRef.current = mgr.exportJSON();
      }
    } catch (e) {
      console.warn("[useDrawings] Failed to import saved drawings:", e);
    } finally {
      isImportingRef.current = false;
      mgr.redraw();
    }

    // Enhance DrawingManager.scenes: project 0 & 1 level lines left to first candle contact
    // without shifting middle levels or background fill
    if (!mgr._origScenes) {
      mgr._origScenes = mgr.scenes.bind(mgr);
    }
    const origScenes = mgr._origScenes;
    mgr.scenes = function (w, h) {
      // 1. Ensure any fib drawing with extendAnchorLevelsLeft does NOT have extendLeft enabled on the base drawing
      for (const d of mgr.list) {
        if (d.kind === "fib-retracement" && (d.style?.extendAnchorLevelsLeft || d.style?.extendZeroOneLeft)) {
          if (d.style.extendLeft) {
            d.style.extendLeft = false;
          }
        }
      }

      // 2. Generate standard scenes
      const out = origScenes(w, h);
      const coords = mgr.coords;
      const bars = (typeof mgr.opts?.bars === "function" ? mgr.opts.bars() : null) || barsRef?.current || [];
      if (!coords || !out) return out;

      // 3. Process each fib drawing with extendAnchorLevelsLeft
      for (const d of mgr.list) {
        if (d.kind !== "fib-retracement" || (!d.style?.extendAnchorLevelsLeft && !d.style?.extendZeroOneLeft)) continue;
        if (!d.points || d.points.length < 2) continue;

        const p0 = d.points[0];
        const p1 = d.points[1];
        if (p0.price == null || p1.price == null || p0.time == null || p1.time == null) continue;

        const isRev = !!d.style.reverse;
        // In lightweight-charts-drawing fib: level 0 is at p1 when !reverse, p0 when reverse; level 1 is at p0 when !reverse, p1 when reverse
        const price0 = isRev ? p0.price : p1.price;
        const price1 = isRev ? p1.price : p0.price;

        const y0 = coords.priceToY(price0);
        const y1 = coords.priceToY(price1);
        if (y0 == null || y1 == null) continue;

        const x0 = coords.timeToX(p0.time);
        const x1 = coords.timeToX(p1.time);
        if (x0 == null || x1 == null) continue;

        const xLeft = Math.min(x0, x1);
        const tLeft = Math.min(p0.time, p1.time);

        const findContactX = (targetPrice) => {
          if (!bars || bars.length === 0) return 0;
          let startIdx = -1;
          for (let bIdx = bars.length - 1; bIdx >= 0; bIdx--) {
            if (bars[bIdx].time <= tLeft) {
              startIdx = bIdx;
              break;
            }
          }
          if (startIdx === -1) return 0;

          // 1. Exact bar crossing
          for (let bIdx = startIdx; bIdx >= 0; bIdx--) {
            const b = bars[bIdx];
            if (b.low <= targetPrice && b.high >= targetPrice) {
              const cx = coords.timeToX(b.time);
              if (cx != null && cx < xLeft) return cx;
            }
          }

          // 2. Tolerance check (0.3% near wick)
          const tol = Math.max(1e-4, Math.abs(targetPrice) * 0.003);
          for (let bIdx = startIdx; bIdx >= 0; bIdx--) {
            const b = bars[bIdx];
            if (Math.abs(b.high - targetPrice) <= tol || Math.abs(b.low - targetPrice) <= tol) {
              const cx = coords.timeToX(b.time);
              if (cx != null && cx < xLeft) return cx;
            }
          }

          // Fallback to chart left / oldest bar
          const firstBarX = coords.timeToX(bars[0].time);
          return firstBarX != null ? Math.min(firstBarX, 0) : 0;
        };

        const contactX0 = findContactX(price0);
        const contactX1 = findContactX(price1);

        const levels = d.style.levels || [];
        const lvl0Def = levels.find((l) => Math.abs(l.coeff - 0) < 0.001) || { color: d.style.color || "#808080" };
        const lvl1Def = levels.find((l) => Math.abs(l.coeff - 1) < 0.001) || { color: d.style.color || "#808080" };

        const color0 = lvl0Def.color || d.style.color || "#808080";
        const color1 = lvl1Def.color || d.style.color || "#808080";

        const extraSceneItems = [];
        if (lvl0Def.visible !== false && contactX0 < xLeft) {
          extraSceneItems.push({
            t: "line",
            a: { x: contactX0, y: y0 },
            b: { x: xLeft, y: y0 },
            stroke: color0,
            strokeWidth: lvl0Def.width || 1,
            dash: "2 3",
            cap: "round",
            inert: true,
          });
        }

        if (lvl1Def.visible !== false && contactX1 < xLeft) {
          extraSceneItems.push({
            t: "line",
            a: { x: contactX1, y: y1 },
            b: { x: xLeft, y: y1 },
            stroke: color1,
            strokeWidth: lvl1Def.width || 1,
            dash: "2 3",
            cap: "round",
            inert: true,
          });
        }

        if (extraSceneItems.length > 0) {
          out.push({
            scene: extraSceneItems,
            selected: false,
            hoveredAnchor: -1,
          });
        }
      }

      // 4. Custom Mandatory RR Stats Badges (SL points/pips & RR, dynamic Live RR placement):
      // - For Limit Orders & Staged Orders: Mandatory 2 stats: SL points/pips & RR below SL zone.
      // - For Live Trades: Live RR below SL zone till < 1R. After 1R: Live RR above TP zone!
      for (const d of mgr.list) {
        if (!d || (d.kind !== "long-position" && d.kind !== "short-position")) continue;
        if (!d.points || d.points.length < 2) continue;
        const p0 = d.points[0];
        const p1 = d.points[1];
        if (p0.price == null || p0.time == null || p1.time == null) continue;

        const isLong = d.kind === "long-position";
        const dir = isLong ? 1 : -1;
        const stopDist = d.style?.stopLevel ?? Math.abs(p1.price - p0.price);
        const profitDist = d.style?.profitLevel ?? (stopDist * 2);
        if (!(stopDist > 0)) continue;

        const sx0 = coords.timeToX(p0.time);
        const sx1 = coords.timeToX(p1.time);
        const sy0 = coords.priceToY(p0.price);
        if (sx0 == null || sx1 == null || sy0 == null) continue;

        const slPrice = p0.price - dir * stopDist;
        const tpPrice = p0.price + dir * profitDist;
        const syStop = coords.priceToY(slPrice);
        const syProfit = coords.priceToY(tpPrice);
        if (syStop == null || syProfit == null) continue;

        const toolWidth = Math.abs(xMax - xMin);
        if (toolWidth < 15) continue;

        // Minimal stats text adapted to tool width
        let statsText = "";
        let strokeColor = "#334155";
        let textColor = "#f1f5f9";

        if (isLive) {
          strokeColor = liveR >= 0 ? (liveR >= 1.0 ? "#10b981" : (isProp ? "#a855f7" : "#0284c7")) : "#ef4444";
          textColor = liveR >= 1.0 ? "#34d399" : (liveR >= 0 ? "#38bdf8" : "#f87171");

          if (toolWidth >= 170) {
            statsText = `LIVE ${liveRText} · Target: ${rrText} · SL: ${slText}`;
          } else if (toolWidth >= 110) {
            statsText = `LIVE ${liveRText} · ${rrText} · ${slText}`;
          } else if (toolWidth >= 65) {
            statsText = `${liveRText} · ${rrText}`;
          } else {
            statsText = liveRText;
          }
        } else if (isPendingLimit) {
          strokeColor = "#0284c7";
          textColor = "#7dd3fc";

          if (toolWidth >= 150) {
            statsText = `LIMIT · SL: ${slText} · ${rrText}`;
          } else if (toolWidth >= 95) {
            statsText = `SL: ${slText} · ${rrText}`;
          } else {
            statsText = `${slText} · ${rrText}`;
          }
        } else if (isStaged) {
          strokeColor = "#0891b2";
          textColor = "#67e8f9";

          if (toolWidth >= 150) {
            statsText = `STAGED · SL: ${slText} · ${rrText}`;
          } else if (toolWidth >= 95) {
            statsText = `SL: ${slText} · ${rrText}`;
          } else {
            statsText = `${slText} · ${rrText}`;
          }
        } else if (isHistoricalClosed) {
          strokeColor = liveR >= 0 ? "#10b981" : "#ef4444";
          textColor = liveR >= 0 ? "#34d399" : "#f87171";

          if (toolWidth >= 140) {
            statsText = `CLOSED · AR: ${liveRText} · SL: ${slText}`;
          } else if (toolWidth >= 90) {
            statsText = `CLOSED ${liveRText} · ${rrText}`;
          } else {
            statsText = liveRText;
          }
        } else {
          // Manual user tool
          strokeColor = isProp ? "#ec4899" : (d.style?.stopColor || "#ea580c");
          textColor = "#f8fafc";

          if (toolWidth >= 95) {
            statsText = `SL: ${slText} · ${rrText}`;
          } else {
            statsText = rrText;
          }
        }

        // Maximized strictly to RR tool width along the entry line (sy0)
        // Anchored to [xMin, xMax] time coordinates so it NEVER floats with scrolling
        const pillH = 18;
        const pillY = Math.round(sy0 - pillH / 2);

        // Center text within visible portion of tool width if partially scrolled offscreen,
        // but strictly clamped inside [xMin + 25, xMax - 25] so it NEVER leaves the RR tool width
        const visibleMin = Math.max(0, xMin);
        const visibleMax = Math.min(w, xMax);
        const center = (visibleMin + visibleMax) / 2;
        const textX = Math.round(Math.max(xMin + 25, Math.min(xMax - 25, center)));

        const badgeSceneItems = [
          {
            t: "rect",
            x: xMin,
            y: pillY,
            w: toolWidth,
            h: pillH,
            rx: 3,
            fill: "#0b0e14",
            fillOpacity: 0.88,
            stroke: strokeColor,
            strokeWidth: 1,
            inert: true,
          },
          {
            t: "text",
            x: textX,
            y: sy0,
            text: statsText,
            size: 10.5,
            weight: "bold",
            fill: textColor,
            anchor: "middle",
            baseline: "middle",
            inert: true,
          },
        ];

        out.push({
          scene: badgeSceneItems,
          selected: false,
          hoveredAnchor: -1,
        });
      }

      // 4. Crosshair Guiding Lines while Drawing or Adjusting Tools:
      // When a tool is armed (mgr.spec != null) or an anchor handle is being dragged (mgr.gesture?.mode?.hit === "handle"),
      // render faint horizontal (and vertical) crosshair alignment projection lines across the entire chart
      // so the user can visually align points with candles and horizontal price levels instead of assuming.
      const isDrawing = !!mgr.spec;
      const isDraggingHandle = !!(mgr.gesture && mgr.gesture.active && mgr.gesture.mode?.hit === "handle");

      if ((isDrawing || isDraggingHandle) && mgr.cursor) {
        const pt = (typeof mgr.aimAt === "function") ? mgr.aimAt(mgr.cursor) : mgr.cursor;
        const cx = Math.round(pt.x);
        const cy = Math.round(pt.y);
        const inside = (cx >= 0 && cx <= w && cy >= 0 && cy <= h);

        if (inside) {
          const isLight = (typeof window !== "undefined" && (
            document.documentElement.getAttribute("data-theme") === "light" ||
            document.documentElement.getAttribute("data-theme") === "creamy"
          ));
          const guideColor = isLight ? "rgba(0, 0, 0, 0.28)" : "rgba(255, 255, 255, 0.32)";

          const guideSceneItems = [];

          // Primary horizontal guide line across full chart width at current cursor Y
          guideSceneItems.push({
            t: "line",
            a: { x: 0, y: cy },
            b: { x: w, y: cy },
            stroke: guideColor,
            strokeWidth: 1,
            dash: "3 3",
            cap: "round",
            inert: true,
          });

          // Primary vertical guide line across full chart height at current cursor X
          guideSceneItems.push({
            t: "line",
            a: { x: cx, y: 0 },
            b: { x: cx, y: h },
            stroke: guideColor,
            strokeWidth: 1,
            dash: "3 3",
            cap: "round",
            inert: true,
          });

          // Secondary guide lines for points already placed in the pending drawing
          if (mgr.pending && mgr.pending.length > 0) {
            for (const p of mgr.pending) {
              if (p.price != null && coords.priceToY) {
                const py = Math.round(coords.priceToY(p.price));
                if (py != null && Number.isFinite(py) && Math.abs(py - cy) > 2) {
                  guideSceneItems.push({
                    t: "line",
                    a: { x: 0, y: py },
                    b: { x: w, y: py },
                    stroke: guideColor,
                    strokeWidth: 1,
                    dash: "2 3",
                    cap: "round",
                    inert: true,
                  });
                }
              }
              if (p.time != null && coords.timeToX) {
                const px = Math.round(coords.timeToX(p.time));
                if (px != null && Number.isFinite(px) && Math.abs(px - cx) > 2) {
                  guideSceneItems.push({
                    t: "line",
                    a: { x: px, y: 0 },
                    b: { x: px, y: h },
                    stroke: guideColor,
                    strokeWidth: 1,
                    dash: "2 3",
                    cap: "round",
                    inert: true,
                  });
                }
              }
            }
          }

          if (guideSceneItems.length > 0) {
            out.push({
              scene: guideSceneItems,
              selected: false,
              hoveredAnchor: -1,
            });
          }
        }
      }

      return out;
    };

    // -------------------------------------------------------------------------
    // Mobile & Touchscreen Drawing Architecture Enhancement
    // -------------------------------------------------------------------------

    // 1. Enhanced holdChart / releaseChart: prevent premature unlock between points
    if (!mgr._origReleaseChart) {
      mgr._origReleaseChart = mgr.releaseChart.bind(mgr);
    }
    const origReleaseChart = mgr._origReleaseChart;
    mgr.releaseChart = function () {
      // If a tool is active and still has pending points to place, keep the chart locked!
      if (mgr.spec && mgr.pending && mgr.pending.length > 0) {
        return;
      }
      origReleaseChart();
    };

    // Helper: Compute position geometry (RR Tool)
    const getPositionGeometry = (d) => {
      if (!d || (d.kind !== "long-position" && d.kind !== "short-position")) return null;
      if (!d.points || d.points.length < 2) return null;
      const coords = mgr.coords;
      if (!coords) return null;
      const p0 = d.points[0];
      const p1 = d.points[1];
      if (p0.time == null || p0.price == null || p1.time == null) return null;

      const sx0 = coords.timeToX(p0.time);
      const sy0 = coords.priceToY(p0.price);
      const sx1 = coords.timeToX(p1.time);
      if (sx0 == null || sy0 == null || sx1 == null) return null;

      const isLong = d.kind === "long-position";
      const dir = isLong ? 1 : -1;
      const pip = coords.pipSize ? coords.pipSize() : 0.01;
      let stopDist = d.style?.stopLevel ?? (Math.abs(p1.price - p0.price) || pip * 100);
      let profitDist = d.style?.profitLevel ?? (Math.abs(p1.price - p0.price) || pip * 100);

      // Institutional bounds guard: prevent absurd spreads or negative prices from breaking screen layout
      const price = p0.price;
      if (price > 0 && Number.isFinite(price)) {
        if (!Number.isFinite(stopDist) || stopDist <= 0 || stopDist > price * 0.5) {
          stopDist = price * 0.003;
        }
        if (!Number.isFinite(profitDist) || profitDist <= 0 || profitDist > price * 0.9) {
          profitDist = stopDist * 2;
        }
        // For short positions, profit price must remain strictly positive
        if (!isLong && price - profitDist <= 0) {
          profitDist = price * 0.006;
          stopDist = price * 0.003;
        }
      }

      const stopPrice = p0.price - dir * stopDist;
      const profitPrice = p0.price + dir * profitDist;

      const syStop = coords.priceToY(stopPrice) ?? (sy0 + (isLong ? 40 : -40));
      const syProfit = coords.priceToY(profitPrice) ?? (sy0 - (isLong ? 40 : -40));

      const xMin = Math.min(sx0, sx1);
      const xMax = Math.max(sx0, sx1);

      return {
        sx0,
        sy0,
        sx1,
        syStop,
        syProfit,
        xMin,
        xMax,
        anchors: [
          { x: sx0, y: sy0 },
          { x: sx1, y: sy0 },
          { x: sx0, y: syStop },
          { x: sx0, y: syProfit },
        ],
      };
    };

    // 2. Touch-friendly hitTopmost: expanded tolerance for touch handles & lines
    if (!mgr._origHitTopmost) {
      mgr._origHitTopmost = mgr.hitTopmost.bind(mgr);
    }
    const origHitTopmost = mgr._origHitTopmost;

    mgr.hitTopmost = function (t) {
      const coords = mgr.coords;
      if (!coords || !mgr.list) return origHitTopmost(t);

      const isTouch = typeof window !== "undefined" && (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
      const HANDLE_RADIUS = isTouch ? 28 : 10;
      const LINE_RADIUS = isTouch ? 14 : 6;
      const BODY_RADIUS = isTouch ? 16 : 8;

      const selectedIds = mgr.selected || [];

      // Helper to compute standard screen points matching d.points (required for body move/translation)
      const getDrawingScreenPts = (d) => {
        if (!coords || !d || !d.points) return [];
        return d.points.map((pt) => {
          const x = coords.timeToX(pt.time);
          const y = coords.priceToY(pt.price);
          return {
            x: x != null ? x : 0,
            y: y != null ? y : 0,
          };
        });
      };

      // Check handle dots & exit edges (ONLY for drawings currently in Edit Mode!)
      // - Moving points: swiping moves that specific control point
      // - Exit points: swiping extends in that specific direction
      // - Anywhere else on the body: swiping moves/translates the entire drawing
      const checkHandleHit = (d) => {
        if (!mgr.shown(d) || d.locked) return null;
        const screenPts = getDrawingScreenPts(d);

        // RR Tool (long-position / short-position)
        if (d.kind === "long-position" || d.kind === "short-position") {
          const geom = getPositionGeometry(d);
          if (!geom) return null;

          // Exit Point 3: Take Profit (swiping extends TP vertically in that direction)
          if (
            Math.hypot(geom.xMin - t.x, geom.syProfit - t.y) <= HANDLE_RADIUS ||
            Math.hypot(geom.xMax - t.x, geom.syProfit - t.y) <= HANDLE_RADIUS ||
            (Math.abs(t.y - geom.syProfit) <= LINE_RADIUS && t.x >= geom.xMin - HANDLE_RADIUS && t.x <= geom.xMax + HANDLE_RADIUS)
          ) {
            return {
              drawing: d,
              mode: { hit: "handle", handleIndex: 3 },
              pts: screenPts,
            };
          }

          // Exit Point 2: Stop Loss (swiping extends SL vertically in that direction)
          if (
            Math.hypot(geom.xMin - t.x, geom.syStop - t.y) <= HANDLE_RADIUS ||
            Math.hypot(geom.xMax - t.x, geom.syStop - t.y) <= HANDLE_RADIUS ||
            (Math.abs(t.y - geom.syStop) <= LINE_RADIUS && t.x >= geom.xMin - HANDLE_RADIUS && t.x <= geom.xMax + HANDLE_RADIUS)
          ) {
            return {
              drawing: d,
              mode: { hit: "handle", handleIndex: 2 },
              pts: screenPts,
            };
          }

          // Exit Point 1: Right boundary (swiping extends time duration horizontally)
          if (
            Math.hypot(geom.sx1 - t.x, geom.sy0 - t.y) <= HANDLE_RADIUS ||
            (Math.abs(t.x - geom.sx1) <= LINE_RADIUS && t.y >= Math.min(geom.syStop, geom.syProfit) - HANDLE_RADIUS && t.y <= Math.max(geom.syStop, geom.syProfit) + HANDLE_RADIUS)
          ) {
            return {
              drawing: d,
              mode: { hit: "handle", handleIndex: 1 },
              pts: screenPts,
            };
          }

          // Moving Point 0: Entry anchor dot (swiping moves entry point; middle of line remains body)
          if (Math.hypot(geom.sx0 - t.x, geom.sy0 - t.y) <= HANDLE_RADIUS) {
            return {
              drawing: d,
              mode: { hit: "handle", handleIndex: 0 },
              pts: screenPts,
            };
          }

          return null;
        }

        // Rectangle: check 4 corner moving points (0..3) and 4 exit edges (4..7)
        if (d.kind === "rectangle" && d.points && d.points.length >= 2) {
          const p0 = d.points[0];
          const p1 = d.points[1];
          const x0 = coords.timeToX(p0.time);
          const y0 = coords.priceToY(p0.price);
          const x1 = coords.timeToX(p1.time);
          const y1 = coords.priceToY(p1.price);
          if (x0 != null && y0 != null && x1 != null && y1 != null) {
            const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
            const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
            // Corner moving points: 0: top-left, 1: top-right, 2: bottom-right, 3: bottom-left
            if (Math.hypot(minX - t.x, minY - t.y) <= HANDLE_RADIUS) return { drawing: d, mode: { hit: "handle", handleIndex: 0 }, pts: screenPts };
            if (Math.hypot(maxX - t.x, minY - t.y) <= HANDLE_RADIUS) return { drawing: d, mode: { hit: "handle", handleIndex: 1 }, pts: screenPts };
            if (Math.hypot(maxX - t.x, maxY - t.y) <= HANDLE_RADIUS) return { drawing: d, mode: { hit: "handle", handleIndex: 2 }, pts: screenPts };
            if (Math.hypot(minX - t.x, maxY - t.y) <= HANDLE_RADIUS) return { drawing: d, mode: { hit: "handle", handleIndex: 3 }, pts: screenPts };
            // Exit edges (extends in that direction): 4: top, 5: right, 6: bottom, 7: left
            if (Math.abs(t.y - minY) <= LINE_RADIUS && t.x >= minX + HANDLE_RADIUS && t.x <= maxX - HANDLE_RADIUS) return { drawing: d, mode: { hit: "handle", handleIndex: 4 }, pts: screenPts };
            if (Math.abs(t.x - maxX) <= LINE_RADIUS && t.y >= minY + HANDLE_RADIUS && t.y <= maxY - HANDLE_RADIUS) return { drawing: d, mode: { hit: "handle", handleIndex: 5 }, pts: screenPts };
            if (Math.abs(t.y - maxY) <= LINE_RADIUS && t.x >= minX + HANDLE_RADIUS && t.x <= maxX - HANDLE_RADIUS) return { drawing: d, mode: { hit: "handle", handleIndex: 6 }, pts: screenPts };
            if (Math.abs(t.x - minX) <= LINE_RADIUS && t.y >= minY + HANDLE_RADIUS && t.y <= maxY - HANDLE_RADIUS) return { drawing: d, mode: { hit: "handle", handleIndex: 7 }, pts: screenPts };
          }
        }

        // Generic tools (trendline, fib, ray, arrow): check anchor moving points
        const pts = d.points || [];
        for (let j = 0; j < pts.length; j++) {
          const p = pts[j];
          if (p.time == null || p.price == null) continue;
          const sx = coords.timeToX(p.time);
          const sy = coords.priceToY(p.price);
          if (sx != null && sy != null && Math.hypot(sx - t.x, sy - t.y) <= HANDLE_RADIUS) {
            return {
              drawing: d,
              mode: { hit: "handle", handleIndex: j },
              pts: screenPts,
            };
          }
        }

        return null;
      };

      // 1. If any drawing is selected (Edit Mode), check its handles FIRST
      for (const id of selectedIds) {
        const d = mgr.get(id);
        if (d) {
          const hit = checkHandleHit(d);
          if (hit) return hit;
        }
      }

      // Check library exact hit for selected drawings' handles
      const exact = origHitTopmost(t);
      if (exact && exact.mode.hit === "handle" && selectedIds.includes(exact.drawing.id)) {
        return {
          ...exact,
          pts: getDrawingScreenPts(exact.drawing),
        };
      }

      // Helper to check body hit for any drawing
      const checkBodyHit = (d) => {
        if (!mgr.shown(d)) return null;
        const screenPts = getDrawingScreenPts(d);

        // RR Tool body (inside green / red boxes)
        if (d.kind === "long-position" || d.kind === "short-position") {
          const geom = getPositionGeometry(d);
          if (geom) {
            const yTop = Math.min(geom.syStop, geom.syProfit);
            const yBottom = Math.max(geom.syStop, geom.syProfit);
            if (t.x >= geom.xMin && t.x <= geom.xMax && t.y >= yTop && t.y <= yBottom) {
              return {
                drawing: d,
                mode: { hit: "body" },
                pts: screenPts,
              };
            }
          }
          return null;
        }

        // Rectangle body
        if (d.kind === "rectangle" && d.points && d.points.length >= 2) {
          const p0 = d.points[0];
          const p1 = d.points[1];
          const x0 = coords.timeToX(p0.time);
          const y0 = coords.priceToY(p0.price);
          const x1 = coords.timeToX(p1.time);
          const y1 = coords.priceToY(p1.price);
          if (x0 != null && y0 != null && x1 != null && y1 != null) {
            const minX = Math.min(x0, x1) - BODY_RADIUS;
            const maxX = Math.max(x0, x1) + BODY_RADIUS;
            const minY = Math.min(y0, y1) - BODY_RADIUS;
            const maxY = Math.max(y0, y1) + BODY_RADIUS;
            if (t.x >= minX && t.x <= maxX && t.y >= minY && t.y <= maxY) {
              return {
                drawing: d,
                mode: { hit: "body" },
                pts: screenPts,
              };
            }
          }
          return null;
        }

        // Generic tool line body hit
        const pts = d.points || [];
        if (pts.length < 2) {
          if (pts.length === 1) {
            const sx = coords.timeToX(pts[0].time);
            const sy = coords.priceToY(pts[0].price);
            if (sx != null && sy != null && Math.hypot(sx - t.x, sy - t.y) <= BODY_RADIUS * 2) {
              return { drawing: d, mode: { hit: "body" }, pts: screenPts };
            }
          }
          return null;
        }
        for (let j = 0; j < pts.length - 1; j++) {
          const p1 = pts[j];
          const p2 = pts[j + 1];
          const x1 = coords.timeToX(p1.time);
          const y1 = coords.priceToY(p1.price);
          const x2 = coords.timeToX(p2.time);
          const y2 = coords.priceToY(p2.price);
          if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
          const dx = x2 - x1;
          const dy = y2 - y1;
          const l2 = dx * dx + dy * dy;
          let dist;
          if (l2 === 0) {
            dist = Math.hypot(t.x - x1, t.y - y1);
          } else {
            const u = Math.max(0, Math.min(1, ((t.x - x1) * dx + (t.y - y1) * dy) / l2));
            dist = Math.hypot(t.x - (x1 + u * dx), t.y - (y1 + u * dy));
          }
          if (dist <= BODY_RADIUS) {
            return {
              drawing: d,
              mode: { hit: "body" },
              pts: screenPts,
            };
          }
        }
        return null;
      };

      // 2. Check body hit on selected drawings first
      for (const id of selectedIds) {
        const d = mgr.get(id);
        if (d) {
          const hit = checkBodyHit(d);
          if (hit) return hit;
        }
      }

      // 3. Check all other (unselected) drawings
      // For unselected drawings, ANY hit (whether near anchor, edge, or body) is ALWAYS returned as hit: "body"
      // to ensure handles are never exposed or dragged before the drawing is explicitly selected (Edit Mode).
      for (let i = mgr.list.length - 1; i >= 0; i--) {
        const d = mgr.list[i];
        if (!selectedIds.includes(d.id)) {
          const bHit = checkBodyHit(d);
          if (bHit) return { ...bHit, mode: { hit: "body" } };
          const hHit = checkHandleHit(d);
          if (hHit) return { ...hHit, mode: { hit: "body" } };
        }
      }

      // 4. Fallback to origHitTopmost
      if (exact) {
        // If unselected, force mode.hit to "body" so handles are never dragged when not in Edit Mode!
        const isSel = selectedIds.includes(exact.drawing.id);
        return {
          ...exact,
          pts: getDrawingScreenPts(exact.drawing),
          mode: isSel ? exact.mode : { hit: "body" },
        };
      }

      return null;
    };

    // 3. SelectionDown override:
    // When NOT in Edit Mode:
    //   - Drawings MUST NOT drag on body, edge, or anywhere.
    //   - First click/tap selects the drawing, entering Edit Mode.
    //   - Swiping/panning allows normal chart panning without disturbing the drawing.
    // When IN Edit Mode:
    //   - Dragging the center/body translates the entire drawing across time & price.
    //   - Dragging edges/handles swings/resizes that specific level.
    // Clicking empty chart exits Edit Mode (deselects).
    mgr.selectionDown = function (t, n) {
      const o = mgr.hitTopmost(n);
      const isCtrl = t.ctrlKey || t.metaKey;

      if (!o) {
        if (!isCtrl && mgr.selected.length) {
          mgr.select([]);
        }
        return;
      }

      const isSelected = (mgr.selected || []).includes(o.drawing.id);

      // --- CASE 1: Drawing is NOT in Edit Mode (!isSelected) ---
      // Do NOT drag body or handles. Only an in-place tap (< 8px movement within 500ms) selects it into Edit Mode.
      // Swiping across the chart allows normal chart panning.
      if (!isSelected) {
        const downX = t.clientX;
        const downY = t.clientY;
        const downTime = Date.now();
        let hasMoved = false;

        const onUnselectedMove = (u) => {
          if (Math.hypot(u.clientX - downX, u.clientY - downY) > 8) {
            hasMoved = true;
          }
        };

        const onUnselectedUp = () => {
          window.removeEventListener("pointermove", onUnselectedMove, { capture: true });
          window.removeEventListener("pointerup", onUnselectedUp, { capture: true });
          window.removeEventListener("pointercancel", onUnselectedUp, { capture: true });

          // If finger/mouse released without dragging: enter Edit Mode!
          if (!hasMoved && Date.now() - downTime < 500) {
            if (isCtrl) {
              mgr.toggle(o.drawing.id);
            } else {
              mgr.select([o.drawing.id]);
            }
          }
        };

        window.addEventListener("pointermove", onUnselectedMove, { capture: true, passive: true });
        window.addEventListener("pointerup", onUnselectedUp, { capture: true });
        window.addEventListener("pointercancel", onUnselectedUp, { capture: true });
        return;
      }

      // --- CASE 2: Drawing IS in Edit Mode (isSelected) ---
      // Both handle swings and body translations are enabled!
      if (o.drawing.locked) {
        if (isCtrl) {
          mgr.toggle(o.drawing.id);
        }
        return;
      }

      t.stopPropagation();
      if (t.cancelable) t.preventDefault();
      mgr.holdChart();

      const targetEl = t.target;
      if (targetEl && targetEl.setPointerCapture && t.pointerId != null) {
        try {
          targetEl.setPointerCapture(t.pointerId);
        } catch (_) {}
      }

      const pane = mgr.paneSize();
      const coords = mgr.coords;
      const r = mgr.selected || [];
      const isMulti = r.length > 1;

      // Helper to compute standard screen points matching d.points (required for body move/translation)
      const getDrawingScreenPts = (d) => {
        if (!coords || !d || !d.points) return o.pts;
        const pts = d.points.map((pt) => ({
          x: coords.timeToX(pt.time),
          y: coords.priceToY(pt.price),
        }));
        return pts.every((p) => p.x != null && p.y != null) ? pts : o.pts;
      };

      const screenPts = getDrawingScreenPts(o.drawing);
      const groupScreenPts = (isMulti && o.mode.hit === "body")
        ? r.map((id) => mgr.get(id)).filter((u) => !!u && !u.locked && mgr.shown(u)).map((u) => ({
            start: u,
            startScreen: getDrawingScreenPts(u),
          })).filter((u) => !!u.startScreen && u.startScreen.length > 0)
        : undefined;

      mgr.gesture = {
        id: o.drawing.id,
        start: o.drawing,
        startCursor: n,
        startScreen: screenPts.length > 0 ? screenPts : o.pts,
        mode: o.mode, // { hit: "handle", handleIndex } or { hit: "body" }
        active: false,
        group: groupScreenPts,
        pendingToggle: isCtrl,
        pendingCollapse: !isCtrl && isMulti,
        pane,
        canDrag: true, // Both handles and body are draggable in Edit Mode!
      };

      const onEditDragMove = (u) => {
        u.stopPropagation();
        if (u.cancelable) u.preventDefault();
        const pt = mgr.panePoint(u);
        if (mgr.gesture && mgr.gesture.mode?.hit === "handle") {
          mgr.cursor = pt;
        }
        mgr.dragMove(pt);
      };

      const onEditDragEnd = (u) => {
        window.removeEventListener("pointermove", onEditDragMove, { capture: true });
        window.removeEventListener("pointerup", onEditDragEnd, { capture: true });
        window.removeEventListener("pointercancel", onEditDragEnd, { capture: true });

        if (mgr.gesture && mgr.gesture.mode?.hit === "handle") {
          mgr.cursor = null;
          mgr.redraw();
        }

        if (targetEl && targetEl.releasePointerCapture && t.pointerId != null) {
          try {
            targetEl.releasePointerCapture(t.pointerId);
          } catch (_) {}
        }

        const gesture = mgr.gesture;
        if (gesture && !gesture.active) {
          if (gesture.pendingToggle) {
            mgr.toggle(gesture.id);
          } else if (gesture.pendingCollapse) {
            mgr.select([gesture.id]);
          }
        }

        mgr.endGesture();
        mgr.emit("gestureEnd");
      };

      window.addEventListener("pointermove", onEditDragMove, { capture: true, passive: false });
      window.addEventListener("pointerup", onEditDragEnd, { capture: true });
      window.addEventListener("pointercancel", onEditDragEnd, { capture: true });
    };

    // 3. Robust touch & pointer drag-to-draw / tap-to-place placement engine
    let touchPlacementState = null;

    if (!mgr._origOnPointerDown) {
      mgr._origOnPointerDown = mgr.onPointerDown.bind(mgr);
    }
    const origOnPointerDown = mgr._origOnPointerDown;

    mgr.onPointerDown = function (t) {
      if (t.button !== 0 && t.pointerType !== "touch") return;

      if (!mgr.spec) {
        origOnPointerDown(t);
        return;
      }

      // Drawing tool IS armed!
      t.stopPropagation();
      mgr.holdChart();

      if (mgr.spec.freehand) {
        const n = mgr.panePoint(t);
        mgr.startFreehand(n);
        return;
      }

      const n = mgr.panePoint(t);
      const { w, h } = mgr.paneSize();
      if (n.x < 0 || n.x > w || n.y < 0 || n.y > h) return;

      const initialCount = mgr.pending ? mgr.pending.length : 0;
      touchPlacementState = {
        startX: n.x,
        startY: n.y,
        clientX: t.clientX,
        clientY: t.clientY,
        pointerId: t.pointerId,
        initialCount,
        hasMoved: false,
        startTime: Date.now(),
      };

      if (initialCount === 0) {
        // First point: place immediately
        mgr.placementClick(n);
        mgr.cursor = n;
        mgr.redraw();
      } else {
        // Subsequent point: align cursor
        mgr.cursor = n;
        mgr.redraw();
      }
    };

    // Enhanced onHover: never drop cursor preview during touch drag
    if (!mgr._origOnHover) {
      mgr._origOnHover = mgr.onHover.bind(mgr);
    }
    const origOnHover = mgr._origOnHover;

    mgr.onHover = function (t) {
      if (mgr.spec) {
        const n = mgr.panePoint(t);
        mgr.cursor = n;
        mgr.redraw();
        return;
      }
      origOnHover(t);
    };

    // Global pointermove / pointerup listeners on window to guarantee drag-to-draw
    // works even if the finger moves rapidly or releases slightly outside canvas bounds
    const onTouchMove = (e) => {
      if (!mgr.spec) return;
      const n = mgr.panePoint(e);
      mgr.cursor = n;
      mgr.redraw();

      if (touchPlacementState) {
        const dx = e.clientX - touchPlacementState.clientX;
        const dy = e.clientY - touchPlacementState.clientY;
        if (Math.hypot(dx, dy) > 8) {
          touchPlacementState.hasMoved = true;
        }
        e.stopPropagation();
        if (e.cancelable) e.preventDefault();
      }
    };

    const onTouchUp = (e) => {
      if (!touchPlacementState) return;
      const state = touchPlacementState;
      touchPlacementState = null;

      if (!mgr.spec) return;

      // If tool already finished on pointerdown (e.g. single-point tools like Horizontal Line):
      if (mgr.pending && mgr.pending.length === 0) {
        origReleaseChart();
        return;
      }

      const n = mgr.panePoint(e);
      const dx = e.clientX - state.clientX;
      const dy = e.clientY - state.clientY;
      const dist = Math.hypot(dx, dy);
      const wasDrag = state.hasMoved || dist >= 10;
      const { w, h } = mgr.paneSize();
      const inside = (n.x >= 0 && n.x <= w && n.y >= 0 && n.y <= h);

      if (!inside) {
        return;
      }

      if (state.initialCount === 0) {
        if (wasDrag) {
          // Dragged from Point 1 to Point 2: place Point 2!
          mgr.placementClick(n);
          e.stopPropagation();
        } else {
          // Tapped Point 1: keep chart held for Point 2
          mgr.holdChart();
          e.stopPropagation();
        }
      } else {
        // Subsequent point touch-release: place subsequent point!
        mgr.placementClick(n);
        e.stopPropagation();
      }

      if (!mgr.spec || (mgr.pending && mgr.pending.length === 0)) {
        origReleaseChart();
      } else {
        mgr.holdChart();
      }
    };

    const onTouchCancel = () => {
      touchPlacementState = null;
    };

    window.addEventListener("pointermove", onTouchMove, { capture: true, passive: false });
    window.addEventListener("pointerup", onTouchUp, { capture: true });
    window.addEventListener("pointercancel", onTouchCancel, { capture: true });

    // Subscribe to "add" — inject last-used style so new drawings start with persisted settings
    const unAdd = mgr.on("add", (d) => {
      try {
        const saved = JSON.parse(localStorage.getItem(LS_STYLE_KEY) || "{}");
        const lastStyle = saved[d.kind];
        let merged = { ...(d.style || {}) };

        if (lastStyle && Object.keys(lastStyle).length > 0) {
          const cleanLastStyle = { ...lastStyle };
          // Strip position-specific price levels from last-used defaults so they never bleed across symbols!
          delete cleanLastStyle.stopLevel;
          delete cleanLastStyle.profitLevel;
          delete cleanLastStyle.targetPrice;
          delete cleanLastStyle.stopPrice;

          // Merge last-used visual style over factory defaults (don't overwrite points/id)
          merged = { ...merged, ...cleanLastStyle };

          // Rectangles must NOT auto-extend right by default when newly drawn
          if (d.kind === "rectangle") {
            merged.extendRight = false;
            if (saved.rectangle?.extendRight) {
              delete saved.rectangle.extendRight;
              localStorage.setItem(LS_STYLE_KEY, JSON.stringify(saved));
            }
          }
        } else if (d.kind === "rectangle" && d.style?.extendRight) {
          merged.extendRight = false;
        }

        // Clean any persisted stop/profit from saved style in storage
        if (saved[d.kind]?.stopLevel !== undefined || saved[d.kind]?.profitLevel !== undefined) {
          delete saved[d.kind].stopLevel;
          delete saved[d.kind].profitLevel;
          delete saved[d.kind].targetPrice;
          delete saved[d.kind].stopPrice;
          localStorage.setItem(LS_STYLE_KEY, JSON.stringify(saved));
        }

        // Sanitize & normalize newly placed Long / Short RR tool
        if (d.kind === "long-position" || d.kind === "short-position") {
          const p0 = d.points?.[0];
          const entryPrice = p0?.price;
          if (entryPrice && Number.isFinite(entryPrice) && entryPrice > 0) {
            const coords = mgr.coords;
            let sensibleStop = 0;

            if (coords) {
              const topPrice = coords.yToPrice(0);
              const botPrice = coords.yToPrice(coords.paneSize ? coords.paneSize().h : 500);
              if (topPrice != null && botPrice != null && Number.isFinite(topPrice) && Number.isFinite(botPrice)) {
                const visibleSpan = Math.abs(topPrice - botPrice);
                if (visibleSpan > 0 && visibleSpan < entryPrice * 1.5 && visibleSpan > entryPrice * 0.0001) {
                  sensibleStop = visibleSpan * 0.12;
                }
              }
            }

            if (!sensibleStop || sensibleStop <= 0 || !Number.isFinite(sensibleStop)) {
              sensibleStop = entryPrice * 0.003;
            }

            const curStop = d.style?.stopLevel;
            const isAbsurdHigh = curStop != null && (curStop > entryPrice * 0.2 || (d.kind === "short-position" && entryPrice - curStop <= 0));
            const isCollapsedLow = curStop != null && curStop < entryPrice * 0.00005;
            const isMissingOrBad = curStop == null || !Number.isFinite(curStop) || curStop <= 0;

            if (isAbsurdHigh || isCollapsedLow || isMissingOrBad) {
              merged.stopLevel = Number(sensibleStop.toPrecision(4));
              merged.profitLevel = Number((sensibleStop * 2).toPrecision(4));
            } else {
              const curProfit = d.style?.profitLevel;
              if (curProfit == null || !Number.isFinite(curProfit) || curProfit <= 0 || curProfit > entryPrice * 0.8 || (d.kind === "short-position" && entryPrice - curProfit <= 0)) {
                merged.profitLevel = Number((curStop * 2).toPrecision(4));
              }
            }

            if (d.kind === "short-position" && entryPrice - merged.profitLevel <= 0) {
              merged.profitLevel = Number((entryPrice * 0.006).toPrecision(4));
              merged.stopLevel = Number((entryPrice * 0.003).toPrecision(4));
            }
          }
        }

        mgr.update({ ...d, style: merged });
      } catch {}
    });

    // Subscribe to tool arm/disarm
    const unTool = mgr.on("tool", (kind) => {
      setActiveToolState(kind);
      if (!kind) {
        mgr.cursor = null;
        origReleaseChart();
        mgr.redraw();
      }
    });

    // Clear crosshair guiding lines if pointer leaves chart element
    const onChartPointerLeave = () => {
      if (mgr.cursor) {
        mgr.cursor = null;
        mgr.redraw();
      }
    };
    if (mgr.el) {
      mgr.el.addEventListener("pointerleave", onChartPointerLeave);
    }

    // Subscribe to selection
    const unSel = mgr.on("selection", (ids) => {
      if (ids && ids.length > 0) {
        setSelectedIdState(ids[0]);
      } else {
        setSelectedIdState(null);
      }
      setDrawingsVersion((v) => v + 1);
    });

    // Subscribe to drawings mutation
    const unChange = mgr.on("change", () => {
      setDrawingsVersion((v) => v + 1);
      if (isImportingRef.current) return;
      try {
        const sym = currentSymbolRef.current || symbol;
        const key = toCanonicalSymbol(sym) || sym;
        const currentExport = mgr.exportJSON();
        if (currentExport === lastExportedRef.current) return;
        lastExportedRef.current = currentExport;

        const all = JSON.parse(localStorage.getItem(storageKey) || "{}");
        all[key] = JSON.parse(currentExport).filter((d) => !String(d.id).startsWith("auto_"));
        const str = JSON.stringify(all);
        localStorage.setItem(storageKey, str);
        window.dispatchEvent(new CustomEvent("ts_drawings_sync", {
          detail: { originSym: key, clientId: clientIdRef.current }
        }));
        if (persistRemote) fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ drawings: str }),
        }).catch(() => {});
      } catch (err) {
        console.warn("[useDrawings] Failed to persist drawings:", err);
      }
    });

    // Subscribe to gesture end for undo
    const unGesture = mgr.on("gestureEnd", () => {
      try {
        undoStack.current.push(mgr.exportJSON());
        if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
        redoStack.current = [];
      } catch {}
    });

    // Subscribe to text edit
    const unText = mgr.on("textEdit", (d) => {
      const currentText = d.text || d.style?.text || "";
      const newText = window.prompt("Enter text for drawing:", currentText);
      if (newText !== null && newText !== currentText) {
        mgr.update({
          ...d,
          text: newText,
          style: { ...(d.style || {}), text: newText },
        });
      }
    });

    // Global sync listener: receives updates from Dashboard or other tabs
    const handleSync = (ev) => {
      if (isImportingRef.current) return;
      // 1. Ignore events originating from this very same useDrawings instance!
      if (ev?.detail?.clientId && ev.detail.clientId === clientIdRef.current) {
        return;
      }
      const activeSym = currentSymbolRef.current || symbol;
      // 2. If the event specifies an origin symbol, ignore if it is for a different symbol
      if (ev?.detail?.originSym && toCanonicalSymbol(ev.detail.originSym) !== toCanonicalSymbol(activeSym)) {
        return;
      }
      try {
        const all = JSON.parse(localStorage.getItem(storageKey) || "{}");
        const raw = resolveSymbolDrawings(all, activeSym);
        if (raw) {
          const cleaned = sanitizeDrawings(raw);
          const str = JSON.stringify(cleaned);
          // Compare against current non-auto user drawings in mgr
          const currentSanitized = sanitizeDrawings(mgr.list || []);
          if (str !== JSON.stringify(currentSanitized)) {
            isImportingRef.current = true;
            mgr.importJSON(str);
            lastExportedRef.current = mgr.exportJSON();
            setDrawingsVersion((v) => v + 1);
            mgr.redraw();
          }
        }
      } catch (e) {
        console.warn("[useDrawings] Sync import error:", e);
      } finally {
        isImportingRef.current = false;
      }
    };

    window.addEventListener("ts_drawings_sync", handleSync);
    window.addEventListener("storage", handleSync);

    return () => {
      if (mgr) {
        if (mgr._origScenes) {
          mgr.scenes = mgr._origScenes;
          delete mgr._origScenes;
        }
        if (mgr._origReleaseChart) {
          mgr.releaseChart = mgr._origReleaseChart;
          delete mgr._origReleaseChart;
        }
        if (mgr._origHitTopmost) {
          mgr.hitTopmost = mgr._origHitTopmost;
          delete mgr._origHitTopmost;
        }
        if (mgr._origOnPointerDown) {
          mgr.onPointerDown = mgr._origOnPointerDown;
          delete mgr._origOnPointerDown;
        }
        if (mgr._origOnHover) {
          mgr.onHover = mgr._origOnHover;
          delete mgr._origOnHover;
        }
      }
      window.removeEventListener("pointermove", onTouchMove, { capture: true });
      window.removeEventListener("pointerup", onTouchUp, { capture: true });
      window.removeEventListener("pointercancel", onTouchCancel, { capture: true });
      if (mgr && mgr.el) {
        mgr.el.removeEventListener("pointerleave", onChartPointerLeave);
      }
      unAdd?.();
      unTool?.();
      unSel?.();
      unChange?.();
      unGesture?.();
      unText?.();
      window.removeEventListener("ts_drawings_sync", handleSync);
      window.removeEventListener("storage", handleSync);
    };
  }, [chartReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Symbol switch handler: preserves old symbol drawings and loads new symbol drawings
  useEffect(() => {
    if (!chartReady) return;
    const mgr = drawingManagerRef?.current;
    const prevSym = prevSymbolRef.current;

    if (mgr && prevSym && prevSym !== symbol) {
      const prevKey = toCanonicalSymbol(prevSym) || prevSym;
      // Step A: Save previous symbol drawings
      try {
        const all = JSON.parse(localStorage.getItem(storageKey) || "{}");
        all[prevKey] = JSON.parse(mgr.exportJSON()).filter((d) => !String(d.id).startsWith("auto_"));
        localStorage.setItem(storageKey, JSON.stringify(all));
      } catch {}

      // Step B: Clear canvas with isImporting flag so unChange doesn't clobber
      isImportingRef.current = true;
      try {
        mgr.clear();
        setSelectedIdState(null);
        setCtxMenu(null);

        // Step C: Load new symbol drawings
        const all = JSON.parse(localStorage.getItem(storageKey) || "{}");
        const raw = resolveSymbolDrawings(all, symbol);
        if (raw) {
          const cleaned = sanitizeDrawings(raw);
          mgr.importJSON(JSON.stringify(cleaned));
        }
        lastExportedRef.current = mgr.exportJSON();
      } catch (e) {
        console.warn("[useDrawings] Failed to switch symbol drawings:", e);
      } finally {
        isImportingRef.current = false;
        mgr.redraw();
      }
    }

    prevSymbolRef.current = symbol;
  }, [symbol, chartReady, drawingManagerRef]);

  // 3. Re-project and redraw when candlestick bars finish loading or updating
  useEffect(() => {
    if (!chartReady || !drawingManagerRef?.current) return;
    const mgr = drawingManagerRef.current;
    if (!initialBarsLoadedRef.current.has(symbol)) {
      initialBarsLoadedRef.current.add(symbol);
      const userList = (mgr.list || []).filter((d) => !String(d.id).startsWith("auto_"));
      if (userList.length === 0) {
        try {
          const all = JSON.parse(localStorage.getItem(storageKey) || "{}");
          const raw = resolveSymbolDrawings(all, symbol);
          if (raw) {
            const cleaned = sanitizeDrawings(raw);
            if (cleaned.length > 0) {
              isImportingRef.current = true;
              mgr.importJSON(JSON.stringify(cleaned));
              lastExportedRef.current = mgr.exportJSON();
              setDrawingsVersion((v) => v + 1);
            }
          }
        } catch {} finally {
          isImportingRef.current = false;
        }
      }
    }
    mgr.redraw();
  }, [dataVersion, chartReady, symbol, drawingManagerRef]);

  // 4. Timeframe sync
  useEffect(() => {
    if (!chartReady) return;
    const tfMap = {
      M1: "1", "1M": "1",
      M5: "5", "5M": "5",
      M15: "15", "15M": "15",
      M30: "30", "30M": "30",
      H1: "60", "1H": "60",
      H4: "240", "4H": "240",
      D1: "1D", "1D": "1D",
    };
    drawingManagerRef?.current?.setInterval(tfMap[tf] ?? tf);
  }, [tf, chartReady, drawingManagerRef]);

  // 4. Lock tool mode
  useEffect(() => {
    if (!chartReady) return;
    drawingManagerRef?.current?.setStayInDrawingMode(lockTool);
  }, [lockTool, chartReady, drawingManagerRef]);

  // 5. Magnet mode
  useEffect(() => {
    if (!chartReady) return;
    drawingManagerRef?.current?.setMagnet(magnetMode ? "weak" : "off");
  }, [magnetMode, chartReady, drawingManagerRef]);

  // 6. Arm / disarm tool
  const setActiveTool = useCallback((tool) => {
    const mgr = drawingManagerRef?.current;
    if (!mgr) return;
    if (tool === null || tool === "cursor") {
      mgr.setTool(null);
      setActiveToolState(null);
      mgr.cursor = null;
      if (mgr._origReleaseChart) {
        mgr._origReleaseChart();
      } else {
        mgr.releaseChart();
      }
      mgr.redraw();
    } else {
      try {
        mgr.setTool(tool);
        setActiveToolState(tool);
        mgr.holdChart();
      } catch (e) {
        console.warn("[useDrawings] Failed to arm tool:", tool, e);
      }
    }
  }, [drawingManagerRef]);

  // 7. Selected drawing view with complete tool-specific style properties
  const selected = useMemo(() => {
    if (!selectedId || !drawingManagerRef?.current) return null;
    const d = drawingManagerRef.current.get(selectedId);
    if (!d) return null;
    const rawStyle = d.style || {};
    const lineStyleMap = { 0: "solid", 1: "dotted", 2: "dashed" };
    return {
      ...d,
      type: d.kind,
      style: rawStyle,
      // Top-level aliases for UI convenience:
      color: rawStyle.color || "#2962ff",
      width: rawStyle.width || 1,
      lineStyleName: lineStyleMap[rawStyle.lineStyle] || "solid",
      fill: rawStyle.backgroundColor || rawStyle.color || "#2962ff",
      fillOpacity: rawStyle.transparency != null ? (1 - rawStyle.transparency / 100) : 0.12,
      extendLeft: !!rawStyle.extendLeft,
      extendRight: !!rawStyle.extendRight,
      extendLines: !!rawStyle.extendLines,
      levels: rawStyle.levels || [],
      reverse: !!rawStyle.reverse,
      fibLevelsAsPercents: !!rawStyle.fibLevelsAsPercents,
      showPrices: rawStyle.showPrices !== false,
      showCoeffs: rawStyle.showCoeffs !== false,
      stopColor: rawStyle.stopColor || "#f23645",
      targetColor: rawStyle.targetColor || "#089981",
      stopTransparency: rawStyle.stopTransparency ?? 80,
      targetTransparency: rawStyle.targetTransparency ?? 80,
      accountSize: rawStyle.accountSize ?? 100000,
      riskPercent: rawStyle.riskPercent ?? 1,
      lotSize: rawStyle.lotSize ?? 1,
      riskDisplayMode: rawStyle.riskDisplayMode || "percents",
      showPriceLabels: rawStyle.showPriceLabels !== false,
      compactStats: !!rawStyle.compactStats,
      text: d.text || rawStyle.text || "",
      fontSize: rawStyle.fontSize || 14,
      textColor: rawStyle.textColor || "#2962ff",
      locked: !!d.locked,
      hidden: !!d.hidden,
    };
  }, [selectedId, drawingsVersion, drawingManagerRef]);

  // 8. Drawings array
  const drawings = useMemo(() => {
    return drawingManagerRef?.current ? drawingManagerRef.current.drawings() : [];
  }, [drawingsVersion, drawingManagerRef]);

  // 9. Unified actions
  const deleteSelected = useCallback((targetId) => {
    const mgr = drawingManagerRef?.current;
    if (!mgr) return;
    const id = (typeof targetId === "string" ? targetId : null)
      || selectedId
      || (mgr.selection && mgr.selection()[0])
      || (mgr.selected && mgr.selected[0]);
    if (!id) return;

    try {
      undoStack.current.push(mgr.exportJSON());
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
      redoStack.current = [];
    } catch {}

    if (String(id).startsWith("auto_")) {
      dismissedAutoIdsRef.current.add(id);
      const baseId = id.replace("auto_trail_", "auto_");
      dismissedAutoIdsRef.current.add(baseId);
      dismissedAutoIdsRef.current.add(`auto_trail_${baseId.replace("auto_", "")}`);
    }

    mgr.remove(id);

    try {
      const sym = currentSymbolRef.current || symbol;
      const key = toCanonicalSymbol(sym) || sym;
      const currentExport = mgr.exportJSON();
      lastExportedRef.current = currentExport;
      const all = JSON.parse(localStorage.getItem(storageKey) || "{}");
      all[key] = JSON.parse(currentExport).filter((d) => !String(d.id).startsWith("auto_"));
      const str = JSON.stringify(all);
      localStorage.setItem(storageKey, str);
      window.dispatchEvent(new CustomEvent("ts_drawings_sync", {
        detail: { originSym: key, clientId: clientIdRef.current }
      }));
      if (persistRemote) {
        fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ drawings: str }),
        }).catch(() => {});
      }
    } catch (err) {
      console.warn("[useDrawings] Failed to persist drawing deletion:", err);
    }

    setSelectedIdState(null);
    setCtxMenu(null);
    setDrawingsVersion((v) => v + 1);
    mgr.redraw();
  }, [selectedId, drawingManagerRef, symbol, storageKey, persistRemote]);

  const cloneSelected = useCallback((targetId) => {
    const mgr = drawingManagerRef?.current;
    if (!mgr) return;
    const id = (typeof targetId === "string" ? targetId : null)
      || selectedId
      || (mgr.selection && mgr.selection()[0]);
    if (id) {
      const d = mgr.get(id);
      if (d) {
        const { id: _, ...rest } = d;
        const newId = mgr.add(rest);
        mgr.select([newId]);
        setSelectedIdState(newId);
        setDrawingsVersion((v) => v + 1);
        mgr.redraw();
      }
    }
    setCtxMenu(null);
  }, [selectedId, drawingManagerRef]);

  const bringToFront = useCallback((targetId) => {
    const mgr = drawingManagerRef?.current;
    if (!mgr) return;
    const id = (typeof targetId === "string" ? targetId : null)
      || selectedId
      || (mgr.selection && mgr.selection()[0]);
    if (id) {
      mgr.bringToFront(id);
      setDrawingsVersion((v) => v + 1);
      mgr.redraw();
    }
    setCtxMenu(null);
  }, [selectedId, drawingManagerRef]);

  const sendToBack = useCallback((targetId) => {
    const mgr = drawingManagerRef?.current;
    if (!mgr) return;
    const id = (typeof targetId === "string" ? targetId : null)
      || selectedId
      || (mgr.selection && mgr.selection()[0]);
    if (id) {
      mgr.sendToBack(id);
      setDrawingsVersion((v) => v + 1);
      mgr.redraw();
    }
    setCtxMenu(null);
  }, [selectedId, drawingManagerRef]);

  const toggleLock = useCallback((id) => {
    const mgr = drawingManagerRef?.current;
    if (!mgr) return;
    const target = (typeof id === "string" ? id : null)
      || selectedId
      || (mgr.selection && mgr.selection()[0]);
    if (target) {
      const d = mgr.get(target);
      if (d) {
        mgr.update({ ...d, locked: !d.locked });
        setDrawingsVersion((v) => v + 1);
        mgr.redraw();
      }
    }
    setCtxMenu(null);
  }, [selectedId, drawingManagerRef]);

  const toggleHide = useCallback((id) => {
    const mgr = drawingManagerRef?.current;
    if (!mgr) return;
    const target = (typeof id === "string" ? id : null)
      || selectedId
      || (mgr.selection && mgr.selection()[0]);
    if (target) {
      const d = mgr.get(target);
      if (d) {
        mgr.update({ ...d, hidden: !d.hidden });
        setDrawingsVersion((v) => v + 1);
        mgr.redraw();
      }
    }
    setCtxMenu(null);
  }, [selectedId, drawingManagerRef]);

  const updateSelected = useCallback((patch) => {
    if (selectedId && drawingManagerRef?.current) {
      const d = drawingManagerRef.current.get(selectedId);
      if (d) {
        const currentStyle = { ...(d.style || {}) };
        const nextStyle = { ...currentStyle };

        // 1. Direct style object passed in patch
        if (patch.style && typeof patch.style === "object") {
          Object.assign(nextStyle, patch.style);
        }

        // 2. Flat style properties passed in patch
        if (patch.color) nextStyle.color = patch.color;
        if (patch.width !== undefined) nextStyle.width = patch.width;
        if (patch.style !== undefined && typeof patch.style === "string") {
          nextStyle.lineStyle = patch.style === "dotted" ? 1 : patch.style === "dashed" ? 2 : 0;
        } else if (patch.lineStyle !== undefined) {
          nextStyle.lineStyle = patch.lineStyle;
        }
        if (patch.fill) nextStyle.backgroundColor = patch.fill;
        if (patch.backgroundColor) nextStyle.backgroundColor = patch.backgroundColor;
        if (patch.fillBackground !== undefined) nextStyle.fillBackground = patch.fillBackground;
        if (patch.fillOpacity !== undefined) nextStyle.transparency = Math.round((1 - patch.fillOpacity) * 100);
        if (patch.transparency !== undefined) nextStyle.transparency = patch.transparency;
        if (patch.extendLeft !== undefined) nextStyle.extendLeft = patch.extendLeft;
        if (patch.extendRight !== undefined) nextStyle.extendRight = patch.extendRight;
        if (patch.extendLines !== undefined) nextStyle.extendLines = patch.extendLines;
        if (patch.extendAnchorLevelsLeft !== undefined) {
          nextStyle.extendAnchorLevelsLeft = patch.extendAnchorLevelsLeft;
          if (patch.extendAnchorLevelsLeft) nextStyle.extendLeft = false;
        }
        if (patch.extendZeroOneLeft !== undefined) {
          nextStyle.extendZeroOneLeft = patch.extendZeroOneLeft;
          if (patch.extendZeroOneLeft) nextStyle.extendLeft = false;
        }
        if (patch.levels !== undefined) nextStyle.levels = patch.levels;
        if (patch.reverse !== undefined) nextStyle.reverse = patch.reverse;
        if (patch.fibLevelsAsPercents !== undefined) nextStyle.fibLevelsAsPercents = patch.fibLevelsAsPercents;
        if (patch.showPrices !== undefined) nextStyle.showPrices = patch.showPrices;
        if (patch.showCoeffs !== undefined) nextStyle.showCoeffs = patch.showCoeffs;
        if (patch.fibTrendLine !== undefined) nextStyle.fibTrendLine = { ...(nextStyle.fibTrendLine || {}), ...patch.fibTrendLine };
        if (patch.horzTextAlign !== undefined) nextStyle.horzTextAlign = patch.horzTextAlign;
        if (patch.vertTextAlign !== undefined) nextStyle.vertTextAlign = patch.vertTextAlign;
        if (patch.stopColor !== undefined) nextStyle.stopColor = patch.stopColor;
        if (patch.targetColor !== undefined) nextStyle.targetColor = patch.targetColor;
        if (patch.stopTransparency !== undefined) nextStyle.stopTransparency = patch.stopTransparency;
        if (patch.targetTransparency !== undefined) nextStyle.targetTransparency = patch.targetTransparency;
        if (patch.accountSize !== undefined) nextStyle.accountSize = patch.accountSize;
        if (patch.riskPercent !== undefined) nextStyle.riskPercent = patch.riskPercent;
        if (patch.lotSize !== undefined) nextStyle.lotSize = patch.lotSize;
        if (patch.riskDisplayMode !== undefined) nextStyle.riskDisplayMode = patch.riskDisplayMode;
        if (patch.showPriceLabels !== undefined) nextStyle.showPriceLabels = patch.showPriceLabels;
        if (patch.compactStats !== undefined) nextStyle.compactStats = patch.compactStats;
        if (patch.fontSize !== undefined) nextStyle.fontSize = patch.fontSize;
        if (patch.textColor !== undefined) nextStyle.textColor = patch.textColor;
        if (patch.stopLevel !== undefined) nextStyle.stopLevel = patch.stopLevel;
        if (patch.profitLevel !== undefined) nextStyle.profitLevel = patch.profitLevel;
        if (patch.targetRR !== undefined && nextStyle.stopLevel > 0) {
          const naturalRR = Math.max(0.1, Number(patch.targetRR) || 0.1);
          nextStyle.profitLevel = naturalRR * nextStyle.stopLevel;
        }

        const nextDrawing = {
          ...d,
          style: nextStyle,
          ...(patch.points ? { points: patch.points } : {}),
          ...(patch.text !== undefined ? { text: patch.text } : {}),
          ...(patch.locked !== undefined ? { locked: patch.locked } : {}),
          ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
          ...(patch.stop !== undefined ? { stop: patch.stop } : {}),
          ...(patch.target !== undefined ? { target: patch.target } : {}),
          ...(patch.ratio !== undefined ? { ratio: Number(patch.ratio) } : {}),
          ...(patch.entry !== undefined ? { entry: patch.entry } : {}),
        };

        drawingManagerRef.current.update(nextDrawing);

        // Persist last-used style for this tool kind (stripping symbol-specific price levels)
        try {
          const saved = JSON.parse(localStorage.getItem(LS_STYLE_KEY) || "{}");
          const styleToPersist = { ...nextStyle };
          delete styleToPersist.stopLevel;
          delete styleToPersist.profitLevel;
          delete styleToPersist.targetPrice;
          delete styleToPersist.stopPrice;
          delete styleToPersist.target;
          delete styleToPersist.stop;
          delete styleToPersist.entry;

          saved[d.kind] = styleToPersist;
          localStorage.setItem(LS_STYLE_KEY, JSON.stringify(saved));
        } catch {}

        setDrawingsVersion((v) => v + 1);
      }
    }
  }, [selectedId, drawingManagerRef]);

  const clearAll = useCallback(() => {
    const mgr = drawingManagerRef?.current;
    if (!mgr) return;
    try {
      undoStack.current.push(mgr.exportJSON());
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
      redoStack.current = [];
    } catch {}

    mgr.clear();
    setSelectedIdState(null);
    setCtxMenu(null);

    try {
      const sym = currentSymbolRef.current || symbol;
      const key = toCanonicalSymbol(sym) || sym;
      const all = JSON.parse(localStorage.getItem(storageKey) || "{}");
      all[key] = [];
      const str = JSON.stringify(all);
      localStorage.setItem(storageKey, str);
      lastExportedRef.current = "[]";
      window.dispatchEvent(new CustomEvent("ts_drawings_sync", {
        detail: { originSym: key, clientId: clientIdRef.current }
      }));
      if (persistRemote) {
        fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ drawings: str }),
        }).catch(() => {});
      }
    } catch (err) {
      console.warn("[useDrawings] Failed to persist clearAll:", err);
    }

    setDrawingsVersion((v) => v + 1);
    mgr.redraw();
  }, [drawingManagerRef, symbol, storageKey, persistRemote]);

  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    const prev = undoStack.current.pop();
    const cur = drawingManagerRef?.current ? drawingManagerRef.current.exportJSON() : "[]";
    redoStack.current.push(cur);
    if (prev && drawingManagerRef?.current) {
      drawingManagerRef.current.importJSON(prev);
    }
    setSelectedIdState(null);
  }, [drawingManagerRef]);

  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    const next = redoStack.current.pop();
    const cur = drawingManagerRef?.current ? drawingManagerRef.current.exportJSON() : "[]";
    undoStack.current.push(cur);
    if (next && drawingManagerRef?.current) {
      drawingManagerRef.current.importJSON(next);
    }
  }, [drawingManagerRef]);

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  // 10. Context menu on right click
  const onContextMenu = useCallback((ev) => {
    const mgr = drawingManagerRef?.current;
    if (!mgr || !wrapRef?.current) return;
    const hovered = mgr.hoveredId();
    const targetId = hovered || selectedId || (mgr.selection && mgr.selection()[0]);
    if (targetId) {
      ev.preventDefault();
      ev.stopPropagation();
      mgr.select([targetId]);
      setSelectedIdState(targetId);
      const rect = wrapRef.current.getBoundingClientRect();
      setCtxMenu({
        x: Math.min(ev.clientX - rect.left, rect.width - 200),
        y: Math.min(ev.clientY - rect.top, rect.height - 240),
      });
    }
  }, [drawingManagerRef, wrapRef, selectedId]);

  // 11. Keyboard shortcuts
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;

      if (e.key === "Escape") {
        setSelectedIdState(null);
        setCtxMenu(null);
        setSettingsOpen(false);
        if (activeTool) setActiveTool(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, activeTool, selectedId, deleteSelected, undo, redo, setActiveTool]);

  const pointerHandlers = {
    onPointerDown: () => {},
    onPointerMove: () => {},
    onPointerUp: () => {},
    onContextMenu,
  };

  const cursorFor = useCallback((tool) => {
    if (tool) return "crosshair";
    return "default";
  }, []);

  return {
    manager: drawingManagerRef,
    activeTool,
    setActiveTool,
    lockTool,
    setLockTool,
    magnetMode,
    setMagnetMode: setMagnetModeState,
    drawings,
    selectedId,
    setSelectedId: setSelectedIdState,
    selected,
    hover: null,
    ctxMenu,
    setCtxMenu,
    settingsOpen,
    setSettingsOpen,
    deleteSelected,
    cloneSelected,
    bringToFront,
    sendToBack,
    updateSelected,
    toggleLock,
    toggleHide,
    clearAll,
    undo,
    redo,
    canUndo,
    canRedo,
    dismissedAutoIds: dismissedAutoIdsRef,
    pointerHandlers,
    cursorFor,
  };
}
