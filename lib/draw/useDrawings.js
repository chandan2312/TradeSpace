// useDrawings — the drawing-tools interaction state machine.
//
// Owns: active tool, style, drawings array, selection, hover, undo/redo,
// and persistence. Pushes a render state into DrawingsPrimitive and exposes
// pointer handlers that ChartPanel spreads onto the chart wrapper div.
//
// Coordinate anchors: every drawing point is { logical, price }. We convert
// pointer pixels <-> anchors via the chart's timeScale/series so drawings
// stay fixed as the user pans, zooms, or new bars append.
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
  hitTest, pxToPoint, drawingToPx, computeRR, DEFAULT_STYLE, PALETTE,
} from "./core.js";

const LS_KEY = "ts_drawings";
const UNDO_LIMIT = 50;

export function useDrawings({ chartRef, seriesRef, wrapRef, symbol, tf, barsRef, isActive, primRef }) {
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
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // accessor for the primitive (multi-pane safe: each pane owns its own ref)
  const prim = useCallback(() => primRef?.current || null, [primRef]);

  // ---------- helpers ----------
  const conv = useCallback(() => {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series) return null;
    const ts = chart.timeScale();
    return {
      X: (i) => (i == null ? null : ts.logicalToCoordinate(i)),
      Y: (p) => (p == null ? null : series.priceToCoordinate(p)),
      W: wrapRef.current?.clientWidth || 0,
    };
  }, [chartRef, seriesRef, wrapRef]);

  const inv = useCallback(() => {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series) return null;
    const ts = chart.timeScale();
    return {
      XtoL: (x) => ts.coordinateToLogical(x),
      YtoP: (y) => series.coordinateToPrice(y),
    };
  }, [chartRef, seriesRef]);

  const toPoint = useCallback((ev) => {
    const wrap = wrapRef.current;
    const iv = inv();
    if (!wrap || !iv) return null;
    const rect = wrap.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const pt = pxToPoint(px, py, iv);
    
    // Magnet snapping
    if (pt && magnetMode && barsRef?.current?.length) {
      const idx = Math.round(pt.logical);
      if (idx >= 0 && idx < barsRef.current.length) {
        const bar = barsRef.current[idx];
        const prices = [bar.open, bar.high, bar.low, bar.close].filter(x => x != null);
        if (prices.length > 0) {
          // snap to closest OHLC
          let closest = prices[0];
          let minDist = Math.abs(pt.price - closest);
          for (let i = 1; i < prices.length; i++) {
            const dist = Math.abs(pt.price - prices[i]);
            if (dist < minDist) {
              minDist = dist;
              closest = prices[i];
            }
          }
          pt.logical = idx; // snap x too
          pt.price = closest;
        }
      }
    }
    
    return pt ? { px, py, point: pt } : null;
  }, [wrapRef, inv, magnetMode, barsRef]);

  const pushPrimitive = useCallback((extra = {}) => {
    const p = prim();
    if (!p) return;
    const lastBar = barsRef?.current?.[barsRef.current.length - 1];
    p.setDrawings({
      drawings: drawingsRef.current,
      selectedId: selectedIdRef.current,
      hover: hoverRef.current,
      symbol,
      currentPrice: lastBar ? lastBar.close : null,
      ...extra,
    });
  }, [prim, symbol, barsRef]);
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
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        const all = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
        all[`${symbol}:${tf}`] = drawings;
        localStorage.setItem(LS_KEY, JSON.stringify(all));
        window.dispatchEvent(new CustomEvent("ts_drawings_sync"));
      } catch {}
    }, 300);
  }, [drawings, symbol, tf]);

  // load on symbol/tf change or cross-pane sync
  useEffect(() => {
    const loadFromStorage = () => {
      try {
        const all = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
        const arr = all[`${symbol}:${tf}`] || [];
        setDrawings(prev => JSON.stringify(prev) !== JSON.stringify(arr) ? arr : prev);
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
  }, [symbol, tf]);

  // keep primitive in sync with React state
  useEffect(() => { pushPrimitive(); }, [drawings, selectedId, hover, pushPrimitive]);

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
    chart.applyOptions({
      handleScroll: { pressedMouseMove: !activeTool },
      handleScale: { axisPressedMouseMove: !activeTool, axisDoubleClick: true, mouseWheel: true },
    });
  }, [activeTool, chartRef]);

  // ---------- cursor on hover ----------
  const cursorFor = useCallback((tool, hover) => {
    if (tool) return "crosshair";
    if (!hover) return "default";
    if (hover.handle) {
      const h = hover.handle;
      if (h === "price" || h === "stop" || h === "target") return "ns-resize";
      if (h === "entry") return "move";
      return "grab";
    }
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
      ev.preventDefault();
      ev.stopPropagation();
      const d = createDrawing(activeToolRef.current, point, point, drawStyle);
      gesture.current = {
        kind: "create",
        drawing: d,
        handle: d.type === "horizontal" ? "price" : d.type === "rrtool" ? "entry" : "p2",
      };
      // show preview immediately
      prim()?.setDrawings({ drawings: drawingsRef.current, selectedId: null, hover: null, preview: d });
      return;
    }

    // CURSOR MODE: hit-test
    const c = conv();
    if (!c) return;
    const hit = hitTest(drawingsRef.current, px, py, c);
    if (hit) {
      ev.preventDefault();
      ev.stopPropagation();
      if (hit.drawing.locked && hit.handle == null) {
        // locked: select only, no move
        setSelectedId(hit.drawing.id);
        return;
      }
      setSelectedId(hit.drawing.id);
      const d0 = hit.drawing;
      if (hit.handle) {
        gesture.current = { kind: "resize", drawing: d0, handle: hit.handle };
      } else {
        gesture.current = {
          kind: "move",
          drawing: d0,
          startPoint: point,
          dLog0: 0, dPrice0: 0,
        };
      }
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
    }
  }, [toPoint, conv, drawStyle]);

  // ---------- pointer move ----------
  const onPointerMove = useCallback((ev) => {
    // active gesture -> update live
    const g = gesture.current;
    if (g) {
      const info = toPoint(ev);
      if (!info) return;
      const { point } = info;
      if (g.kind === "create") {
        const updated = moveHandle(g.drawing, g.handle, point);
        g.drawing = updated;
        prim()?.setDrawings({ drawings: drawingsRef.current, selectedId: null, hover: null, preview: updated });
      } else if (g.kind === "resize") {
        const updated = moveHandle(g.drawing, g.handle, point);
        g.drawing = updated;
        commit((prev) => prev.map((d) => (d.id === updated.id ? updated : d)), { noUndo: true, keepRedo: true });
      } else if (g.kind === "move") {
        const dLog = point.logical - g.startPoint.logical;
        const dPrice = point.price - g.startPoint.price;
        const updated = translate(g.drawing, dLog, dPrice);
        g.drawing = updated;
        g.startPoint = point;
        commit((prev) => prev.map((d) => (d.id === updated.id ? updated : d)), { noUndo: true, keepRedo: true });
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
  }, [toPoint, conv, commit]);

  // ---------- pointer up ----------
  const onPointerUp = useCallback((ev) => {
    const g = gesture.current;
    document.body.style.userSelect = "";
    if (!g) return;
    gesture.current = null;

    if (g.kind === "create") {
      const d = g.drawing;
      // discard zero-size creations (a click without drag)
      if (isDegenerate(d)) {
        prim()?.setDrawings({ drawings: drawingsRef.current, selectedId: selectedIdRef.current, hover: hoverRef.current, preview: null });
        return;
      }
      commit((prev) => [...prev, d]);
      setSelectedId(d.id);
      prim()?.setDrawings({ drawings: [...drawingsRef.current, d], selectedId: d.id, hover: null, preview: null });
      // auto return to cursor unless locked
      if (!lockTool) setActiveTool(null);
    } else if (g.kind === "resize" || g.kind === "move") {
      // finalize: snapshot the pre-gesture state for undo.
      // The commit() during drag used noUndo, so push one undo entry now.
      // We do this by recording current as the "after"; the "before" is what
      // undo will restore. Simpler: take a snapshot of the final state's diff
      // by pushing the last undo entry lazily — handled via a wrapper below.
    }
  }, [commit, lockTool]);

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
    if (g && (g.kind === "move" || g.kind === "resize") && g._before) {
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
    commit((prev) => prev.filter((d) => d.id !== selectedIdRef.current));
    setSelectedId(null);
    setCtxMenu(null);
  }, [commit]);

  const cloneSelected = useCallback(() => {
    const d = drawingsRef.current.find((x) => x.id === selectedIdRef.current);
    if (!d) return;
    const copy = cloneDrawing(d);
    commit((prev) => [...prev, copy]);
    setSelectedId(copy.id);
    setCtxMenu(null);
  }, [commit]);

  const bringToFront = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    commit((prev) => {
      const d = prev.find((x) => x.id === id);
      if (!d) return prev;
      return [...prev.filter((x) => x.id !== id), d];
    });
    setCtxMenu(null);
  }, [commit]);

  const sendToBack = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    commit((prev) => {
      const d = prev.find((x) => x.id === id);
      if (!d) return prev;
      return [d, ...prev.filter((x) => x.id !== id)];
    });
    setCtxMenu(null);
  }, [commit]);

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
    commit(() => []);
    setSelectedId(null);
    setCtxMenu(null);
  }, [commit]);

  // ---------- keyboard ----------
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
      if (e.key === "Escape") {
        if (gesture.current) { gesture.current = null; prim()?.setDrawings({ drawings: drawingsRef.current, selectedId: selectedIdRef.current, hover: null, preview: null }); }
        setSelectedId(null); setActiveTool(null); setCtxMenu(null); setSettingsOpen(false);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedIdRef.current) {
        e.preventDefault(); deleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault(); redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, deleteSelected, undo, redo]);

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
    deleteSelected, cloneSelected, bringToFront, sendToBack,
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
      return d.p1.logical === d.p2.logical && d.p1.price === d.p2.price;
    case "horizontal":
    case "text":
      return false; // a single click makes a valid line/text
    case "rrtool":
      return false; // entry-only is valid; stop/target default around entry
    default:
      return true;
  }
}
