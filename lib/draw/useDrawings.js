// useDrawings — Pure DrawingManager integration for lightweight-charts v5.
//
// 100% powered by `lightweight-charts-drawing` (TradingView standard tools).
// No custom drawing primitives or non-standard tools.
// Manages reactive tool states, selection, persistence to localStorage + API,
// undo/redo, and cross-symbol isolation.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sanitizeDrawings } from "./core.js";

const LS_KEY = "ts_drawings";
const LS_STYLE_KEY = "ts_tool_last_style";

export function useDrawings({ drawingManagerRef, chartReady, symbol, tf, barsRef, isActive, wrapRef, dataVersion, storageKey = LS_KEY, persistRemote = true } = {}) {
  const [activeTool, setActiveToolState] = useState(null);
  const [lockTool, setLockTool] = useState(false);
  const [magnetMode, setMagnetModeState] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [selectedId, setSelectedIdState] = useState(null);
  const [drawingsVersion, setDrawingsVersion] = useState(0);

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
      const raw = all[scopeKey];
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
      const stopDist = d.style?.stopLevel ?? (Math.abs(p1.price - p0.price) || pip * 100);
      const profitDist = d.style?.profitLevel ?? (Math.abs(p1.price - p0.price) || pip * 100);

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
      const HANDLE_RADIUS = isTouch ? 32 : 12;
      const BODY_RADIUS = isTouch ? 16 : 8;

      // Check handle dots first (giving priority to currently selected drawings)
      const checkHandleHit = (d) => {
        if (!mgr.shown(d) || d.locked) return null;

        // RR Tool (long-position / short-position)
        if (d.kind === "long-position" || d.kind === "short-position") {
          const geom = getPositionGeometry(d);
          if (!geom) return null;

          // Handle 3: Take Profit (left dot, right corner, or top level line)
          if (
            Math.hypot(geom.xMin - t.x, geom.syProfit - t.y) <= HANDLE_RADIUS ||
            Math.hypot(geom.xMax - t.x, geom.syProfit - t.y) <= HANDLE_RADIUS ||
            (Math.abs(t.y - geom.syProfit) <= HANDLE_RADIUS && t.x >= geom.xMin - HANDLE_RADIUS && t.x <= geom.xMax + HANDLE_RADIUS)
          ) {
            return {
              drawing: d,
              mode: { hit: "handle", handleIndex: 3 },
              pts: geom.anchors,
            };
          }

          // Handle 2: Stop Loss (left dot, right corner, or bottom level line)
          if (
            Math.hypot(geom.xMin - t.x, geom.syStop - t.y) <= HANDLE_RADIUS ||
            Math.hypot(geom.xMax - t.x, geom.syStop - t.y) <= HANDLE_RADIUS ||
            (Math.abs(t.y - geom.syStop) <= HANDLE_RADIUS && t.x >= geom.xMin - HANDLE_RADIUS && t.x <= geom.xMax + HANDLE_RADIUS)
          ) {
            return {
              drawing: d,
              mode: { hit: "handle", handleIndex: 2 },
              pts: geom.anchors,
            };
          }

          // Handle 1: Right boundary / hold duration (dot or right vertical edge)
          if (
            Math.hypot(geom.sx1 - t.x, geom.sy0 - t.y) <= HANDLE_RADIUS ||
            (Math.abs(t.x - geom.sx1) <= HANDLE_RADIUS && t.y >= Math.min(geom.syStop, geom.syProfit) - HANDLE_RADIUS && t.y <= Math.max(geom.syStop, geom.syProfit) + HANDLE_RADIUS)
          ) {
            return {
              drawing: d,
              mode: { hit: "handle", handleIndex: 1 },
              pts: geom.anchors,
            };
          }

          // Handle 0: Entry anchor (dot or entry horizontal line)
          if (
            Math.hypot(geom.sx0 - t.x, geom.sy0 - t.y) <= HANDLE_RADIUS ||
            (Math.abs(t.y - geom.sy0) <= HANDLE_RADIUS && t.x >= geom.xMin - HANDLE_RADIUS && t.x <= geom.xMax + HANDLE_RADIUS)
          ) {
            return {
              drawing: d,
              mode: { hit: "handle", handleIndex: 0 },
              pts: geom.anchors,
            };
          }

          return null;
        }

        // Rectangle: check 4 corners
        if (d.kind === "rectangle" && d.points && d.points.length >= 2) {
          const p0 = d.points[0];
          const p1 = d.points[1];
          const x0 = coords.timeToX(p0.time);
          const y0 = coords.priceToY(p0.price);
          const x1 = coords.timeToX(p1.time);
          const y1 = coords.priceToY(p1.price);
          if (x0 != null && y0 != null && x1 != null && y1 != null) {
            const screenPts = [{ x: x0, y: y0 }, { x: x1, y: y1 }];
            if (Math.hypot(x0 - t.x, y0 - t.y) <= HANDLE_RADIUS) return { drawing: d, mode: { hit: "handle", handleIndex: 0 }, pts: screenPts };
            if (Math.hypot(x1 - t.x, y1 - t.y) <= HANDLE_RADIUS) return { drawing: d, mode: { hit: "handle", handleIndex: 1 }, pts: screenPts };
            if (Math.hypot(x1 - t.x, y0 - t.y) <= HANDLE_RADIUS) return { drawing: d, mode: { hit: "handle", handleIndex: 1 }, pts: screenPts };
            if (Math.hypot(x0 - t.x, y1 - t.y) <= HANDLE_RADIUS) return { drawing: d, mode: { hit: "handle", handleIndex: 0 }, pts: screenPts };
          }
        }

        // Generic tools: check all anchor points
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
              pts: pts.map((pt) => ({ x: coords.timeToX(pt.time), y: coords.priceToY(pt.price) })),
            };
          }
        }

        return null;
      };

      // 1. Check selected drawings' handles first
      const selectedIds = mgr.selected || [];
      for (const id of selectedIds) {
        const d = mgr.get(id);
        if (d) {
          const hit = checkHandleHit(d);
          if (hit) return hit;
        }
      }

      // 2. Check all other drawings' handles
      for (let i = mgr.list.length - 1; i >= 0; i--) {
        const d = mgr.list[i];
        if (!selectedIds.includes(d.id)) {
          const hit = checkHandleHit(d);
          if (hit) return hit;
        }
      }

      // 3. Fallback to library exact hit if it found a handle
      const exact = origHitTopmost(t);
      if (exact && exact.mode.hit === "handle") return exact;

      // 4. Check for body hit
      for (let i = mgr.list.length - 1; i >= 0; i--) {
        const d = mgr.list[i];
        if (!mgr.shown(d)) continue;

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
                pts: geom.anchors,
              };
            }
          }
          continue;
        }

        // Generic tool line body hit
        const pts = d.points || [];
        if (pts.length < 2) continue;
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
              pts: pts.map((pt) => ({ x: coords.timeToX(pt.time), y: coords.priceToY(pt.price) })),
            };
          }
        }
      }

      if (exact && exact.mode.hit === "body") return exact;
      return null;
    };

    // 3. SelectionDown override:
    // Only handle dots are draggable. Swiping on the body allows normal chart panning/scrolling.
    // Tapping on the body selects the tool without moving it.
    mgr.selectionDown = function (t, n) {
      const o = mgr.hitTopmost(n);
      const isCtrl = t.ctrlKey || t.metaKey;

      if (!o) {
        if (!isCtrl && mgr.selected.length) {
          mgr.select([]);
        }
        return;
      }

      // Handle Hit: user touched an edge/corner dot!
      if (o.mode.hit === "handle") {
        t.stopPropagation();
        if (t.cancelable) t.preventDefault();
        mgr.holdChart();

        if (!mgr.selected.includes(o.drawing.id)) {
          mgr.select([o.drawing.id]);
        }

        if (o.drawing.locked) {
          window.addEventListener("pointerup", () => mgr.releaseChart(), { once: true });
          return;
        }

        const targetEl = t.target;
        if (targetEl && targetEl.setPointerCapture && t.pointerId != null) {
          try {
            targetEl.setPointerCapture(t.pointerId);
          } catch (err) {}
        }

        const a = mgr.paneSize();
        mgr.gesture = {
          id: o.drawing.id,
          start: o.drawing,
          startCursor: n,
          startScreen: o.pts,
          mode: o.mode,
          active: false,
          group: undefined,
          pendingToggle: false,
          pendingCollapse: false,
          pane: a,
          canDrag: true, // Handle is ALWAYS draggable
        };

        const onHandleMove = (u) => {
          u.stopPropagation();
          if (u.cancelable) u.preventDefault();
          mgr.dragMove(mgr.panePoint(u));
        };

        const onHandleEnd = (u) => {
          window.removeEventListener("pointermove", onHandleMove, { capture: true });
          window.removeEventListener("pointerup", onHandleEnd, { capture: true });
          window.removeEventListener("pointercancel", onHandleEnd, { capture: true });

          if (targetEl && targetEl.releasePointerCapture && t.pointerId != null) {
            try {
              targetEl.releasePointerCapture(t.pointerId);
            } catch (err) {}
          }

          mgr.endGesture();
          mgr.emit("gestureEnd");
        };

        window.addEventListener("pointermove", onHandleMove, { capture: true, passive: false });
        window.addEventListener("pointerup", onHandleEnd, { capture: true });
        window.addEventListener("pointercancel", onHandleEnd, { capture: true });
        return;
      }

      // Body Hit:
      // Swiping on the body MUST NOT move the tool, allowing native chart pan/scroll!
      // Only an in-place tap (< 8px movement within 350ms) selects the tool.
      const downX = t.clientX;
      const downY = t.clientY;
      const downTime = Date.now();
      let hasMoved = false;

      const onBodyMove = (u) => {
        if (Math.hypot(u.clientX - downX, u.clientY - downY) > 8) {
          hasMoved = true;
        }
      };

      const onBodyUp = () => {
        window.removeEventListener("pointermove", onBodyMove, { capture: true });
        window.removeEventListener("pointerup", onBodyUp, { capture: true });
        window.removeEventListener("pointercancel", onBodyUp, { capture: true });

        // If finger lifted without dragging: select drawing!
        if (!hasMoved && Date.now() - downTime < 350) {
          if (isCtrl) {
            mgr.toggle(o.drawing.id);
          } else {
            mgr.select([o.drawing.id]);
          }
        }
      };

      window.addEventListener("pointermove", onBodyMove, { capture: true, passive: true });
      window.addEventListener("pointerup", onBodyUp, { capture: true });
      window.addEventListener("pointercancel", onBodyUp, { capture: true });
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
        if (lastStyle && Object.keys(lastStyle).length > 0) {
          // Merge last-used style over factory defaults (don't overwrite points/id)
          mgr.update({ ...d, style: { ...(d.style || {}), ...lastStyle } });
        }
      } catch {}
    });

    // Subscribe to tool arm/disarm
    const unTool = mgr.on("tool", (kind) => {
      setActiveToolState(kind);
      if (!kind) {
        origReleaseChart();
      }
    });

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
        const sym = prevSymbolRef.current || symbol;
        const key = sym;
        const currentExport = mgr.exportJSON();
        if (currentExport === lastExportedRef.current) return;
        lastExportedRef.current = currentExport;

        const all = JSON.parse(localStorage.getItem(storageKey) || "{}");
        all[key] = JSON.parse(currentExport).filter((d) => !String(d.id).startsWith("auto_"));
        const str = JSON.stringify(all);
        localStorage.setItem(storageKey, str);
        window.dispatchEvent(new CustomEvent("ts_drawings_sync", { detail: { originSym: sym } }));
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
      if (ev?.detail?.originSym && ev.detail.originSym === symbol) {
        return;
      }
      try {
        const all = JSON.parse(localStorage.getItem(storageKey) || "{}");
        const raw = all[scopeKey];
        if (raw) {
          const cleaned = sanitizeDrawings(raw);
          const str = JSON.stringify(cleaned);
          if (str !== lastExportedRef.current) {
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
      const prevKey = prevSym;
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
        const raw = all[scopeKey];
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
      if (mgr.drawings().length === 0) {
        try {
          const all = JSON.parse(localStorage.getItem(storageKey) || "{}");
          const raw = all[scopeKey];
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
    const tfMap = { M1: "1", M5: "5", M15: "15", M30: "30", H1: "60", H4: "240", D1: "1D" };
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
      if (mgr._origReleaseChart) {
        mgr._origReleaseChart();
      } else {
        mgr.releaseChart();
      }
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
      const sym = prevSymbolRef.current || symbol;
      const currentExport = mgr.exportJSON();
      lastExportedRef.current = currentExport;
      const all = JSON.parse(localStorage.getItem(storageKey) || "{}");
      all[sym] = JSON.parse(currentExport).filter((d) => !String(d.id).startsWith("auto_"));
      const str = JSON.stringify(all);
      localStorage.setItem(storageKey, str);
      window.dispatchEvent(new CustomEvent("ts_drawings_sync", { detail: { originSym: sym } }));
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
        if (patch.style) {
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

        // Persist last-used style for this tool kind
        try {
          const saved = JSON.parse(localStorage.getItem(LS_STYLE_KEY) || "{}");
          saved[d.kind] = nextStyle;
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
      const sym = prevSymbolRef.current || symbol;
      const all = JSON.parse(localStorage.getItem(storageKey) || "{}");
      all[sym] = [];
      const str = JSON.stringify(all);
      localStorage.setItem(storageKey, str);
      lastExportedRef.current = "[]";
      window.dispatchEvent(new CustomEvent("ts_drawings_sync", { detail: { originSym: sym } }));
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
