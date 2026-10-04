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
        all[key] = JSON.parse(currentExport);
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
      if (ev?.detail?.originSym && ev.detail.originSym === symbol && mgr.drawings().length > 0) {
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
      if (mgr && mgr._origScenes) {
        mgr.scenes = mgr._origScenes;
        delete mgr._origScenes;
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
      const prevKey = prevSym;
      // Step A: Save previous symbol drawings
      try {
        const all = JSON.parse(localStorage.getItem(storageKey) || "{}");
        all[prevKey] = JSON.parse(mgr.exportJSON());
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
    } else {
      try {
        mgr.setTool(tool);
        setActiveToolState(tool);
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
  const deleteSelected = useCallback(() => {
    if (selectedId && drawingManagerRef?.current) {
      drawingManagerRef.current.remove(selectedId);
      setSelectedIdState(null);
      setCtxMenu(null);
    }
  }, [selectedId, drawingManagerRef]);

  const cloneSelected = useCallback(() => {
    if (selectedId && drawingManagerRef?.current) {
      const d = drawingManagerRef.current.get(selectedId);
      if (d) {
        const { id, ...rest } = d;
        const newId = drawingManagerRef.current.add(rest);
        drawingManagerRef.current.select([newId]);
        setSelectedIdState(newId);
      }
    }
    setCtxMenu(null);
  }, [selectedId, drawingManagerRef]);

  const bringToFront = useCallback(() => {
    if (selectedId && drawingManagerRef?.current) {
      drawingManagerRef.current.bringToFront(selectedId);
    }
    setCtxMenu(null);
  }, [selectedId, drawingManagerRef]);

  const sendToBack = useCallback(() => {
    if (selectedId && drawingManagerRef?.current) {
      drawingManagerRef.current.sendToBack(selectedId);
    }
    setCtxMenu(null);
  }, [selectedId, drawingManagerRef]);

  const toggleLock = useCallback((id) => {
    const target = id || selectedId;
    if (target && drawingManagerRef?.current) {
      const d = drawingManagerRef.current.get(target);
      if (d) {
        drawingManagerRef.current.update({ ...d, locked: !d.locked });
        setDrawingsVersion((v) => v + 1);
      }
    }
    setCtxMenu(null);
  }, [selectedId, drawingManagerRef]);

  const toggleHide = useCallback((id) => {
    const target = id || selectedId;
    if (target && drawingManagerRef?.current) {
      const d = drawingManagerRef.current.get(target);
      if (d) {
        drawingManagerRef.current.update({ ...d, hidden: !d.hidden });
        setDrawingsVersion((v) => v + 1);
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
        if (patch.bold !== undefined) nextStyle.bold = patch.bold;
        if (patch.italic !== undefined) nextStyle.italic = patch.italic;

        const nextDrawing = {
          ...d,
          style: nextStyle,
          ...(patch.points ? { points: patch.points } : {}),
          ...(patch.text !== undefined ? { text: patch.text } : {}),
          ...(patch.locked !== undefined ? { locked: patch.locked } : {}),
          ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
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
    drawingManagerRef?.current?.clear();
    setSelectedIdState(null);
    setCtxMenu(null);
  }, [drawingManagerRef]);

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
    if (hovered) {
      ev.preventDefault();
      ev.stopPropagation();
      mgr.select([hovered]);
      setSelectedIdState(hovered);
      const rect = wrapRef.current.getBoundingClientRect();
      setCtxMenu({
        x: Math.min(ev.clientX - rect.left, rect.width - 200),
        y: Math.min(ev.clientY - rect.top, rect.height - 240),
      });
    }
  }, [drawingManagerRef, wrapRef]);

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
    pointerHandlers,
    cursorFor,
  };
}
