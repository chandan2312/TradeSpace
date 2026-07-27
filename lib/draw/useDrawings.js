// useDrawings — the drawing-tools interaction state machine.
//
// Owns: active tool, style, drawings array, selection, hover, undo/redo,
// and persistence. Pushes a render state into DrawingsPrimitive and exposes
// pointer handlers that ChartPanel spreads onto the chart wrapper div.
//
// Coordinate anchors: every drawing point is { time, price } (unix seconds +
// raw price). Time is universal across timeframes; we convert pixels <-> time
// via the current bars so drawings stay fixed as the user pans/zooms/switches
// TF or new bars append.
//
// Coexistence with the chart:
//  - When a tool is active, chart drag-pan is disabled (pressedMouseMove off)
//    so press-drag-release draws instead of panning. Wheel zoom stays on.
//  - In cursor mode the chart pans normally; only when a drawing/handle is
//    grabbed do we take over the gesture (window-level pointer listeners,
//    mirroring ChartPanel's beginDrag).
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDrawing, cloneDrawing, moveHandle, translate,
  hitTest, hitTestAll, pxToPoint, computeRR, DEFAULT_STYLE, PALETTE,
  timeToLogical, logicalToTime, sanitizeDrawings, logicalToPx,
} from "./core.js";

const LS_KEY = "ts_drawings";
const UNDO_LIMIT = 50;

export function useDrawings({ chartRef, seriesRef, wrapRef, symbol, tf, barsRef, isActive, primRef, dataVersion }) {
  const [activeTool, setActiveTool] = useState(null); // null = cursor
  const [drawStyle, setDrawStyle] = useState(DEFAULT_STYLE);
  const [lockTool, setLockTool] = useState(false); // keep tool active after drawing
  const [drawings, setDrawings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [hover, setHover] = useState(null); // { drawing, handle }
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y }
  const [magnetMode, setMagnetMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // undo/redo (snapshots of drawings array)
  const undoStack = useRef([]);
  const redoStack = useRef([]);

  // live gesture state (not React state — updated on every pointermove)
  const gesture = useRef(null); // { kind:"create"|"move"|"resize", startPx, startPy, startPoint, drawing0, handle, dLog0, dPrice0 }

  // latest refs for stable handlers
  const drawingsRef = useRef(drawings);
  const activeToolRef = useRef(activeTool);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (typeof window !== "undefined") window.__ts_drawing_selected = Boolean(selectedId);
    return () => { if (typeof window !== "undefined") window.__ts_drawing_selected = false; };
  }, [selectedId]);

  // accessor for the primitive (multi-pane safe: each pane owns its own ref)
  const prim = useCallback(() => primRef?.current || null, [primRef]);

  const tfSec = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 }[tf] || 300;

  // ---------- helpers ----------
  // time (unix s) → x pixel, via the current bars. Single mapping shared with
  // the primitive: anchors are time-only, so this is the whole story.
  const conv = useCallback(() => {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series) return null;
    const ts = chart.timeScale();
    // Prefer live series data over barsRef — during TF transitions
    // barsRef is zeroed before the API fetch completes, which would
    // make timeToLogical return null for every anchor → hit-testing
    // fails → drawings appear unselectable and the toolbar won't open.
    let bars = barsRef?.current;
    try {
      const sd = series.data?.();
      if (sd && sd.length > 0) bars = sd;
    } catch (_) {}
    if (!bars || bars.length < 2) return null;
    // Derive tfSec from bars for accuracy (matches primitive renderer)
    let derivedTfSec = tfSec;
    if (bars.length > 1) {
      derivedTfSec = (bars[bars.length - 1].time - bars[0].time) / (bars.length - 1);
    }
    const isTouch = (typeof window !== "undefined" && (("ontouchstart" in window) || navigator.maxTouchPoints > 0));
    return {
      isTouch,
      X: (t) => {
        const l = timeToLogical(bars, t, derivedTfSec);
        return logicalToPx(ts, l);
      },
      Y: (p) => (p == null ? null : series.priceToCoordinate(p)),
      W: wrapRef.current?.clientWidth || 0,
      H: wrapRef.current?.clientHeight || 0,
      bars,
      ts,
      tfSec: derivedTfSec,
    };
  }, [chartRef, seriesRef, wrapRef, barsRef, tfSec]);

  // pixel → { time, price }. x → fractional bar index → time (interpolate/
  // extrapolate via bars), so clicks in the future whitespace still anchor.
  const inv = useCallback(() => {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series) return null;
    const ts = chart.timeScale();
    return {
      XtoT: (x) => logicalToTime(barsRef?.current, ts.coordinateToLogical(x), tfSec),
      YtoP: (y) => series.coordinateToPrice(y),
    };
  }, [chartRef, seriesRef, barsRef, tfSec]);

  const toPoint = useCallback((ev) => {
    const wrap = wrapRef.current;
    const iv = inv();
    if (!wrap || !iv) return null;
    const rect = wrap.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const pt = pxToPoint(px, py, iv);
    if (!pt) return null;

    // Snap horizontal time to exact bar timestamp only if magnet mode is enabled
    if (barsRef?.current?.length) {
      const bars = barsRef.current;
      const l = timeToLogical(bars, pt.time, tfSec);
      if (l != null && Number.isFinite(l)) {
        const idx = Math.round(l);
        if (idx >= 0 && idx < bars.length) {
          const bar = bars[idx];
          // Magnet: snap time and price to the nearest OHLC of the bar under the cursor.
          if (magnetMode) {
            pt.time = bar.time;
            const prices = [bar.open, bar.high, bar.low, bar.close].filter((x) => x != null);
            if (prices.length) {
              let closest = prices[0], best = Math.abs(pt.price - closest);
              for (let i = 1; i < prices.length; i++) {
                const dd = Math.abs(pt.price - prices[i]);
                if (dd < best) { best = dd; closest = prices[i]; }
              }
              pt.price = closest;
            }
          }
        } else if (idx >= bars.length) {
          if (magnetMode) {
            const lastBar = bars[bars.length - 1];
            const steps = Math.round((pt.time - lastBar.time) / (tfSec || 300));
            pt.time = lastBar.time + steps * (tfSec || 300);
          }
        }
      }
    }
    return { px, py, point: pt };
  }, [wrapRef, inv, magnetMode, barsRef, tfSec]);

  // default right-boundary time for a click-created RR: entry + 15 bars.
  const rrDefaultRight = useCallback((entryTime) => {
    const bars = barsRef?.current;
    const l = timeToLogical(bars, entryTime, tfSec);
    if (l == null) return entryTime + 15 * tfSec;
    return logicalToTime(bars, l + 15, tfSec) ?? (entryTime + 15 * tfSec);
  }, [barsRef, tfSec]);

  const pushPrimitive = useCallback((extra = {}) => {
    const p = prim();
    if (!p) return;
    const bars = barsRef?.current;
    const lastBar = bars?.[bars.length - 1];
    p.setDrawings({
      drawings: drawingsRef.current,
      selectedId: selectedIdRef.current,
      hover: hoverRef.current,
      symbol,
      currentPrice: lastBar ? lastBar.close : null,
      // ponytail: primitive needs bars to interpolate cross-TF time anchors
      // via fractional logical (ts.timeToCoordinate only matches exact bar times)
      bars,
      tfSec,
      ...extra,
    });
  }, [prim, symbol, barsRef, tfSec]);
  const hoverRef = useRef(null);
  useEffect(() => { hoverRef.current = hover; }, [hover]);

  // commit a new drawings array, snapshot the previous for undo
  const commit = useCallback((updater, opts = {}) => {
    setDrawings((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (next === prev) return prev;
      if (!opts.noUndo) {
        undoStack.current.push(prev);
        if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
        if (!opts.keepRedo) redoStack.current = [];
      }
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    setDrawings((cur) => {
      const prev = undoStack.current.pop();
      redoStack.current.push(cur);
      return prev;
    });
    setSelectedId(null);
  }, []);

  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    setDrawings((cur) => {
      const next = redoStack.current.pop();
      undoStack.current.push(cur);
      return next;
    });
  }, []);

  // ---------- persistence ----------
  const saveTimer = useRef(null);
  const flushSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    try {
      const all = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      // Store per-symbol (not per-symbol:tf) so drawings render on every TF.
      // Each anchor carries `time`, which the renderer prefers over logical.
      all[symbol] = drawingsRef.current;
      const str = JSON.stringify(all);
      localStorage.setItem(LS_KEY, str);
      window.dispatchEvent(new CustomEvent("ts_drawings_sync"));
      fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drawings: str })
      }).catch(() => {});
    } catch {}
  }, [symbol]);

  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 300);
  }, [drawings, flushSave]);

  // Flush pending save when the tab is hidden or unloaded — mobile browsers
  // discard backgrounded tabs on memory pressure and would otherwise drop
  // the last <300ms of edits.
  useEffect(() => {
    const onHide = () => { if (saveTimer.current) flushSave(); };
    const onVis = () => { if (document.visibilityState === "hidden") onHide(); };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [flushSave]);

  // load on symbol change (drawings are per-symbol; time anchors are TF-agnostic)
  useEffect(() => {
    const loadFromStorage = () => {
      try {
        const all = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
        // Also sweep legacy per-TF keys (`SYMBOL:TF`) into the per-symbol slot.
        let raw = all[symbol];
        if (!raw) {
          const legacyKeys = Object.keys(all).filter((k) => k.startsWith(`${symbol}:`));
          raw = legacyKeys.flatMap((k) => all[k] || []);
          legacyKeys.forEach((k) => delete all[k]);
        }
        // Drop anything without valid time anchors: pre-time-model drawings
        // are unplaceable on any TF but their (unrecorded) origin TF.
        const arr = sanitizeDrawings(raw);
        setDrawings((prev) => (JSON.stringify(prev) !== JSON.stringify(arr) ? arr : prev));
      } catch { setDrawings([]); }
    };

    loadFromStorage();
    setSelectedId(null);
    setHover(null);
    undoStack.current = [];
    redoStack.current = [];

    window.addEventListener("ts_drawings_sync", loadFromStorage);
    window.addEventListener("storage", loadFromStorage);
    return () => {
      window.removeEventListener("ts_drawings_sync", loadFromStorage);
      window.removeEventListener("storage", loadFromStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // keep primitive in sync with React state
  useEffect(() => { pushPrimitive(); }, [drawings, selectedId, hover, pushPrimitive]);

  // Repaint when new bars land or timeframe changes (TF switch / refetch) — time anchors resolve
  // against the fresh bars.
  useEffect(() => { pushPrimitive(); }, [dataVersion, tf, pushPrimitive]);

  // re-render primitive when the chart scrolls/zooms (coordinates change)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const ts = chart.timeScale();
    const handler = () => pushPrimitive();
    ts.subscribeVisibleLogicalRangeChange(handler);
    const onResize = () => pushPrimitive();
    window.addEventListener("resize", onResize);
    return () => {
      ts.unsubscribeVisibleLogicalRangeChange(handler);
      window.removeEventListener("resize", onResize);
    };
  }, [chartRef, pushPrimitive]);

  // ---------- chart pan/zoom control ----------
  // disable chart drag-pan while a tool is active so drawing works
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const active = !activeTool;
    chart.applyOptions({
      handleScroll: { pressedMouseMove: active, horzTouchDrag: active, vertTouchDrag: active },
      handleScale: { axisPressedMouseMove: active, pinch: active, axisDoubleClick: true, mouseWheel: true },
    });
  }, [activeTool, chartRef]);

  const disableChartScroll = useCallback(() => {
    if (chartRef.current) {
      try {
        chartRef.current.applyOptions({
          handleScroll: { pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false },
          handleScale: { axisPressedMouseMove: false, pinch: false },
        });
      } catch {}
    }
  }, [chartRef]);

  const enableChartScroll = useCallback(() => {
    if (chartRef.current) {
      try {
        const active = !activeToolRef.current;
        chartRef.current.applyOptions({
          handleScroll: { pressedMouseMove: active, horzTouchDrag: active, vertTouchDrag: active },
          handleScale: { axisPressedMouseMove: active, pinch: active, axisDoubleClick: true, mouseWheel: true },
        });
      } catch {}
    }
  }, [chartRef]);

  // ---------- cursor on hover ----------
  const cursorFor = useCallback((tool, hover) => {
    if (tool) return "crosshair";
    if (!hover) return "default";
    if (hover.handle) {
      const h = hover.handle;
      if (h === "price" || h === "stop" || h === "target") return "ns-resize";
      if (h === "right") return "ew-resize";
      if (h === "entry" || h === "move") return "move";
      return "grab";
    }
    if (hover.drawing?.type === "rrtool") return "pointer";
    return "move";
  }, []);

  // ---------- pointer down ----------
  const onPointerDown = useCallback((ev) => {
    if (ev.button === 2) return; // right click handled by onContextMenu
    const info = toPoint(ev);
    if (!info) return;
    const { px, py, point } = info;

    // DRAWING MODE: start creating
    if (activeToolRef.current) {
      if (gesture.current && gesture.current.kind === "create_2_click") {
        ev.preventDefault();
        ev.stopPropagation();
        const d = gesture.current.drawing;
        commit((prev) => [...prev, d]);
        setSelectedId(d.id);
        pushPrimitive({ drawings: [...drawingsRef.current, d], selectedId: d.id, hover: null, preview: null });
        if (!lockTool) setActiveTool(null);
        gesture.current = null;
        enableChartScroll();
        return;
      }

      ev.preventDefault();
      ev.stopPropagation();
      const d = createDrawing(activeToolRef.current, point, point, drawStyle);
      
      // if it's a position tool, a single click finishes creation (no drag needed)
      if (d.type === "rrtool") {
        // stamp barCount: 15 so the box preserves 15 bars width on every TF like TradingView
        const rr = { ...d, barCount: 15, widthBars: 15, p2Time: rrDefaultRight(d.entry.time) };
        commit((prev) => [...prev, rr]);
        setSelectedId(rr.id);
        pushPrimitive({ drawings: [...drawingsRef.current, rr], selectedId: rr.id, hover: null, preview: null });
        if (!lockTool) setActiveTool(null);
        return;
      }
      if (d.type === "horizontal" || d.type === "text") {
        commit((prev) => [...prev, d]);
        setSelectedId(d.id);
        pushPrimitive({ drawings: [...drawingsRef.current, d], selectedId: d.id, hover: null, preview: null });
        if (!lockTool) setActiveTool(null);
        return;
      }

      gesture.current = {
        kind: "create",
        drawing: d,
        handle: "p2",
        startPx: px,
        startPy: py,
        dragMoved: false,
      };
      disableChartScroll();
      try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch {}
      // show preview immediately
      pushPrimitive({ selectedId: null, hover: null, preview: d });
      return;
    }

    // CURSOR MODE: hit-test
    const c = conv();
    if (!c) return;
    const hits = hitTestAll(drawingsRef.current, px, py, c);
    const hit = hits.length > 0 ? hits[0] : null;
    if (hit) {
      const isTouch = ev.pointerType === "touch" || (typeof window !== "undefined" && (("ontouchstart" in window) || navigator.maxTouchPoints > 0));
      // On touch devices, touching the body (handle == null) of an UNSELECTED drawing only selects it without initiating drag/blocking scroll
      if (isTouch && hit.handle == null && selectedIdRef.current !== hit.drawing.id) {
        setSelectedId(hit.drawing.id);
        return;
      }
      if (hit.handle == null && hit.drawing.type === "rrtool" && selectedIdRef.current !== hit.drawing.id) {
        // For RR tool, body clicks/touches ONLY select the tool without initiating a move gesture or blocking chart scroll.
        // To move the RR tool, users must grab the dedicated move handle in the middle of the entry line.
        setSelectedId(hit.drawing.id);
        return;
      }

      // Algorithmic Z-Index Cycling for Overlapping Drawings:
      if (hits.length > 1 && hit.handle == null && selectedIdRef.current) {
        const curIdx = hits.findIndex((h) => h.drawing.id === selectedIdRef.current);
        if (curIdx !== -1) {
          const nextHit = hits[(curIdx + 1) % hits.length];
          setSelectedId(nextHit.drawing.id);
          return;
        }
      }

      ev.preventDefault();
      ev.stopPropagation();
      if (hit.drawing.locked) {
        // locked: select only, no move or resize of any handle or body!
        setSelectedId(hit.drawing.id);
        return;
      }
      setSelectedId(hit.drawing.id);
      const d0 = hit.drawing;
      if (hit.handle && hit.handle !== "move" && hit.handle !== "entry") {
        gesture.current = { kind: "resize", drawing: d0, drawing0: d0, handle: hit.handle };
      } else {
        gesture.current = { kind: "move", drawing: d0, drawing0: d0, startPoint: point };
      }
      disableChartScroll();
      try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch {}
      document.body.style.userSelect = "none";
    } else {
      // empty: deselect (let chart pan)
      const prevId = selectedIdRef.current;
      if (prevId) {
        const d = drawingsRef.current.find(x => x.id === prevId);
        if (d && d.transient) {
          commit((prev) => prev.filter(x => x.id !== prevId));
        }
      }
      setSelectedId(null);
      setCtxMenu(null);
      setSettingsOpen(false);
      if (chartRef?.current) {
        try { chartRef.current.priceScale("right").applyOptions({ autoScale: false }); } catch {}
      }
    }
  }, [toPoint, conv, drawStyle, lockTool, commit, pushPrimitive, rrDefaultRight]);

  const onPointerMove = useCallback((ev) => {
    // active gesture -> update live
    const g = gesture.current;
    if (g) {
      if (g.drawing?.locked) return;
      ev.preventDefault();
      ev.stopPropagation();
      const info = toPoint(ev);
      if (!info) return;
      const { px, py, point } = info;
      if (g.kind === "create" || g.kind === "create_2_click") {
        const updated = moveHandle(g.drawing, g.handle, point, conv());
        g.drawing = updated;
        if (g.kind === "create") {
          const dx = px - g.startPx, dy = py - g.startPy;
          if (dx*dx + dy*dy > 25) g.dragMoved = true;
        }
        pushPrimitive({ selectedId: null, hover: null, preview: updated });
      } else if (g.kind === "resize") {
        const base = g.drawing0 || g.drawing;
        const updated = moveHandle(base, g.handle, point, conv());
        g.drawing = updated;
        g.moved = true;
        pushPrimitive({ drawings: drawingsRef.current.map((d) => (d.id === updated.id ? updated : d)), selectedId: updated.id, hover: null, preview: null });
      } else if (g.kind === "move") {
        const base = g.drawing0 || g.drawing;
        const dTime = point.time - g.startPoint.time;
        const dPrice = point.price - g.startPoint.price;
        if (dTime === 0 && dPrice === 0) return;
        const updated = translate(base, dTime, dPrice);
        g.drawing = updated;
        g.moved = true;
        pushPrimitive({ drawings: drawingsRef.current.map((d) => (d.id === updated.id ? updated : d)), selectedId: updated.id, hover: null, preview: null });
      }
      return;
    }

    // hover hit-test (cursor mode only)
    if (activeToolRef.current) return;
    const info = toPoint(ev);
    if (!info) return;
    const { px, py } = info;
    const c = conv();
    if (!c) return;
    const hit = hitTest(drawingsRef.current, px, py, c);
    setHover(hit);
  }, [toPoint, conv, commit, pushPrimitive]);

  // Cancel an in-flight gesture (Escape, delete-during-drag). Restores pre-drag
  // state for move/resize; drops preview for create.
  const cancelGesture = useCallback(() => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    enableChartScroll();
    document.body.style.userSelect = "";
    if ((g.kind === "move" || g.kind === "resize") && g._before) {
      commit(() => g._before, { noUndo: true, keepRedo: true });
    }
    pushPrimitive({ drawings: g._before || drawingsRef.current, hover: null, preview: null });
  }, [commit, pushPrimitive, enableChartScroll]);

  // ---------- pointer up ----------
  const onPointerUp = useCallback((ev) => {
    const g = gesture.current;
    if (g && (g.kind === "create_2_click" || (g.kind === "create" && !g.dragMoved))) {
      // Just a click, or already in 2-click mode. Transition and wait for 2nd click!
      if (g.kind === "create") g.kind = "create_2_click";
      document.body.style.userSelect = "";
      try { ev.currentTarget?.releasePointerCapture?.(ev.pointerId); } catch {}
      return;
    }

    document.body.style.userSelect = "";
    try { ev.currentTarget?.releasePointerCapture?.(ev.pointerId); } catch {}
    if (!g) return;
    gesture.current = null;
    enableChartScroll();

    if (g.kind === "create") {
      // finished via drag!
      const d = g.drawing;
      commit((prev) => [...prev, d]);
      setSelectedId(d.id);
      pushPrimitive({ drawings: [...drawingsRef.current, d], selectedId: d.id, hover: null, preview: null });
      if (!lockTool) setActiveTool(null);
    } else if ((g.kind === "move" || g.kind === "resize") && g.moved && g.drawing) {
      const updated = g.drawing;
      commit((prev) => prev.map((d) => (d.id === updated.id ? updated : d)), { noUndo: true, keepRedo: true });
      pushPrimitive({ drawings: drawingsRef.current.map((d) => (d.id === updated.id ? updated : d)), selectedId: updated.id, hover: null, preview: null });
    }
    // move/resize undo snapshot handled in onPointerUpWrap (needs _before)
  }, [commit, lockTool, pushPrimitive]);

  // Because drag commits used noUndo, we need an undo entry for the *whole*
  // drag. Capture the pre-drag snapshot at pointer-down time instead.
  const onPointerDownWrap = useCallback((ev) => {
    // snapshot for potential undo of move/resize
    const before = drawingsRef.current;
    onPointerDown(ev);
    const g = gesture.current;
    if (g && (g.kind === "move" || g.kind === "resize")) {
      g._before = before;
    }
  }, [onPointerDown]);

  const onPointerUpWrap = useCallback((ev) => {
    const g = gesture.current;
    onPointerUp(ev);
    // Only snapshot for undo if the drag actually mutated state.
    if (g && (g.kind === "move" || g.kind === "resize") && g._before && g.moved) {
      undoStack.current.push(g._before);
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
      redoStack.current = [];
    }
  }, [onPointerUp]);

  // ---------- right click: context menu ----------
  const onContextMenu = useCallback((ev) => {
    const info = toPoint(ev);
    if (!info) return;
    const { px, py } = info;
    const c = conv();
    if (!c) return;
    const hit = hitTest(drawingsRef.current, px, py, c);
    if (hit) {
      ev.preventDefault();
      ev.stopPropagation();
      setSelectedId(hit.drawing.id);
      const wrap = wrapRef.current;
      const rect = wrap.getBoundingClientRect();
      setCtxMenu({ x: Math.min(ev.clientX - rect.left, rect.width - 220), y: Math.min(ev.clientY - rect.top, rect.height - 240) });
    }
  }, [toPoint, conv]);

  // ---------- actions ----------
  const deleteSelected = useCallback(() => {
    if (!selectedIdRef.current) return;
    // Abort any in-flight gesture on the deleted drawing (prevents pointermove
    // from resurrecting it via commit()).
    if (gesture.current && gesture.current.drawing?.id === selectedIdRef.current) {
      gesture.current = null;
      enableChartScroll();
      document.body.style.userSelect = "";
    }
    commit((prev) => prev.filter((d) => d.id !== selectedIdRef.current));
    setSelectedId(null);
    setCtxMenu(null);
  }, [commit, enableChartScroll]);

  const cloneSelected = useCallback(() => {
    const d = drawingsRef.current.find((x) => x.id === selectedIdRef.current);
    if (!d) return;
    // offset the copy by ~3 bars so it doesn't land exactly on the original
    const bars = barsRef?.current;
    const span = bars?.length > 1 ? bars[1].time - bars[0].time : 60;
    const copy = cloneDrawing(d, span * 3, 0);
    commit((prev) => [...prev, copy]);
    setSelectedId(copy.id);
    setCtxMenu(null);
  }, [commit, barsRef]);

  const bringToFront = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    commit((prev) => {
      const d = prev.find((x) => x.id === id);
      if (!d) return prev;
      const next = [...prev.filter((x) => x.id !== id), d];
      drawingsRef.current = next;
      pushPrimitive({ drawings: next });
      return next;
    });
    setCtxMenu(null);
  }, [commit, pushPrimitive]);

  const sendToBack = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    commit((prev) => {
      const d = prev.find((x) => x.id === id);
      if (!d) return prev;
      const next = [d, ...prev.filter((x) => x.id !== id)];
      drawingsRef.current = next;
      pushPrimitive({ drawings: next });
      return next;
    });
    setCtxMenu(null);
  }, [commit, pushPrimitive]);

  // rrtool → Executor: arm the drawn setup (entry/stop/target) for execution.
  // Fire-and-forget POST; the /executor page picks it up via executor_changed.
  const sendToExecutor = useCallback(async () => {
    const d = drawingsRef.current.find((x) => x.id === selectedIdRef.current);
    setCtxMenu(null);
    if (!d || d.type !== "rrtool") return { ok: false, error: "not an R/R tool" };
    try {
      const r = await fetch("/api/executor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "arm",
          setup: { symbol, tf, entry: d.entry.price, sl: d.stop, tp: d.target, drawingId: d.id },
        }),
      });
      return await r.json();
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, [symbol, tf]);

  const toggleLock = useCallback((id) => {
    const target = id || selectedIdRef.current;
    if (!target) return;
    commit((prev) => prev.map((d) => (d.id === target ? { ...d, locked: !d.locked } : d)));
    setCtxMenu(null);
  }, [commit]);

  const toggleHide = useCallback((id) => {
    const target = id || selectedIdRef.current;
    if (!target) return;
    commit((prev) => prev.map((d) => (d.id === target ? { ...d, hidden: !d.hidden } : d)));
    setCtxMenu(null);
  }, [commit]);

  const updateSelected = useCallback((patch) => {
    const id = selectedIdRef.current;
    if (!id) return;
    commit((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, [commit]);

  const clearAll = useCallback(() => {
    if (!drawingsRef.current.length) return;
    gesture.current = null;
    enableChartScroll();
    document.body.style.userSelect = "";
    commit(() => []);
    setSelectedId(null);
    setCtxMenu(null);
  }, [commit, enableChartScroll]);

  // ---------- keyboard ----------
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
      if (e.key === "Escape") {
        if (gesture.current) cancelGesture();
        setSelectedId(null); setActiveTool(null); setCtxMenu(null); setSettingsOpen(false);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedIdRef.current) {
        e.preventDefault(); deleteSelected();
      } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) && selectedIdRef.current) {
        const d = drawingsRef.current.find((x) => x.id === selectedIdRef.current);
        if (!d || d.locked) return;
        e.preventDefault();
        const c = conv();
        const i = inv();
        if (!c || !i) return;
        let dTime = 0;
        let dPrice = 0;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          const stepBars = e.shiftKey ? 5 : 1;
          dTime = (e.key === "ArrowLeft" ? -1 : 1) * stepBars * (c.tfSec || 300);
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          const refPrice = d.entry?.price ?? d.price ?? d.p1?.price ?? 0;
          const py = c.Y(refPrice);
          if (py != null) {
            const stepPx = e.shiftKey ? 10 : 2;
            const targetPy = py + (e.key === "ArrowUp" ? -stepPx : stepPx);
            const newPrice = i.YtoP(targetPy);
            if (newPrice != null && Number.isFinite(newPrice)) {
              dPrice = newPrice - refPrice;
            }
          }
        }
        if (dTime === 0 && dPrice === 0) return;
        const updated = translate(d, dTime, dPrice);
        commit((prev) => prev.map((x) => (x.id === updated.id ? updated : x)), { noUndo: e.repeat, keepRedo: true });
        pushPrimitive({ drawings: drawingsRef.current.map((x) => (x.id === updated.id ? updated : x)), selectedId: updated.id, hover: null, preview: null });
      } else if ((e.key === "[" || e.key === "PageDown") && selectedIdRef.current) {
        e.preventDefault(); sendToBack();
      } else if ((e.key === "]" || e.key === "PageUp") && selectedIdRef.current) {
        e.preventDefault(); bringToFront();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault(); redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, deleteSelected, undo, redo, cancelGesture, conv, inv, commit, pushPrimitive, bringToFront, sendToBack]);

  const selected = drawings.find((d) => d.id === selectedId) || null;

  const pointerHandlers = {
    onPointerDown: onPointerDownWrap,
    onPointerMove: onPointerMove,
    onPointerUp: onPointerUpWrap,
    onContextMenu,
  };

  const exportChart = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const canvas = chart.takeScreenshot();
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `TradeSpace-${symbol}-${tf}-${Date.now()}.png`;
    a.click();
  }, [chartRef, symbol, tf]);

  return {
    activeTool, setActiveTool,
    drawStyle, setDrawStyle,
    lockTool, setLockTool,
    magnetMode, setMagnetMode,
    drawings, selected, selectedId, setSelectedId,
    hover, cursorFor,
    ctxMenu, setCtxMenu,
    settingsOpen, setSettingsOpen,
    pointerHandlers,
    gestureRef: gesture,
    deleteSelected, cloneSelected, bringToFront, sendToBack, sendToExecutor,
    toggleLock, toggleHide, updateSelected, clearAll,
    undo, redo, exportChart, pushPrimitive,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}

// a creation that didn't move (no drag) — discard it
function isDegenerate(d) {
  switch (d.type) {
    case "trendline":
    case "rectangle":
    case "measure":
    case "fib":
      return d.p1.time === d.p2.time && d.p1.price === d.p2.price;
    case "horizontal":
    case "text":
    case "rrtool":
      return false; // a single click makes a valid object
    default:
      return true;
  }
}
