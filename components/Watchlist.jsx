"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Trash2, Plus, GripVertical, Flag, X, ArrowUp, ArrowDown, Settings2, LayoutGrid, Zap, ChevronDown, Copy, Eraser } from "lucide-react";
import { LAYOUT_CONFIG, LayoutIcon } from "../lib/layouts";
import { getSymbolAliases, resolveAliasValue } from "../lib/watchlistAliases.js";
import SessionLedDot from "./autonomous/SessionLedDot";
import { getTradingDateString } from "../lib/time";

const TFS = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
const TF_LABEL = { M1: "1m", M5: "5m", M15: "15m", M30: "30m", H1: "1h", H4: "4h", D1: "1D" };

// Right-sidebar watchlist with multiple named lists (tabs), create/rename/delete,
// live bid/spread per symbol, click-to-switch, and drag-to-reorder rows.
export default function Watchlist({
  watchlists, activeListId, setActiveListId,
  symbol, setSymbol, ticks, alerts,
  onCreate, onRename, onDelete, onAddSymbol, onRemoveSymbol,
  symbolFlags, setSymbolFlags, onNavUp, onNavDown, onGridify,
  onDoubleJump, biasData, onSelectAutoList, onReorder
}) {
  const flagColors = ["red", "blue", "green", "yellow"];
  const virtualWatchlists = [];
  
  if (symbolFlags) {
    flagColors.forEach(color => {
      const symbolsWithFlag = Object.keys(symbolFlags).filter(sym => symbolFlags[sym] === color);
      if (symbolsWithFlag.length > 0) {
        virtualWatchlists.push({
          _id: `flag-${color}`,
          name: color.charAt(0).toUpperCase() + color.slice(1),
          symbols: symbolsWithFlag.sort(),
          isVirtual: true,
          color: color
        });
      }
    });
  }

  // Auto Watchlists based on Bias Engine
  if (biasData?.symbols) {
    const uptrend = [];
    const downtrend = [];
    const sideways = [];
    const reversals = [];
    const setups = [];
    const sweeps = [];
    const retracing = [];

    biasData.symbols.forEach((r) => {
      // 1. Textbook Setups
      if (r.setup) setups.push(r.symbol);
      
      // 2. Liquidity Sweeps (if factors mention a sweep/hunt)
      const hasSweep = r.factors && r.factors.some(f => f.label?.includes("swept") || f.note?.includes("hunt") || f.lens === "reversal");
      if (hasSweep) sweeps.push(r.symbol);

      // 3. Reversal Watch (from engine phase)
      if (r.phase === "reversal-watch") reversals.push(r.symbol);

      // 4. Trend & Pullbacks based on H4 & H1 combined
      const h4 = r.layers?.H4?.dir;
      const h1 = r.layers?.H1?.dir;

      if (h4 === 1 && h1 === 1) {
        uptrend.push(r.symbol);
      } else if (h4 === -1 && h1 === -1) {
        downtrend.push(r.symbol);
      } else if ((h4 === 1 && h1 === -1) || (h4 === -1 && h1 === 1)) {
        retracing.push(r.symbol);
      } else if (!r.setup && r.phase === "chop") {
        sideways.push(r.symbol);
      }
    });

    if (setups.length > 0) virtualWatchlists.push({ _id: "auto-setup", name: "⚡ Setups", symbols: setups.sort(), isVirtual: true, type: "auto", style: { color: "var(--orange)", background: "rgba(255, 152, 0, 0.15)" } });
    if (sweeps.length > 0) virtualWatchlists.push({ _id: "auto-sweeps", name: "🧹 Sweeps", symbols: sweeps.sort(), isVirtual: true, type: "auto", style: { color: "#e040fb", background: "rgba(224, 64, 251, 0.15)" } });
    if (uptrend.length > 0) virtualWatchlists.push({ _id: "auto-uptrend", name: "📈 Uptrend", symbols: uptrend.sort(), isVirtual: true, type: "auto", style: { color: "var(--green)", background: "rgba(76, 175, 80, 0.15)" } });
    if (downtrend.length > 0) virtualWatchlists.push({ _id: "auto-downtrend", name: "📉 Downtrend", symbols: downtrend.sort(), isVirtual: true, type: "auto", style: { color: "var(--red)", background: "rgba(244, 67, 54, 0.15)" } });
    if (retracing.length > 0) virtualWatchlists.push({ _id: "auto-retracing", name: "↩️ Retracing", symbols: retracing.sort(), isVirtual: true, type: "auto", style: { color: "var(--accent)", background: "rgba(41, 98, 255, 0.15)" } });
    if (reversals.length > 0) virtualWatchlists.push({ _id: "auto-reversal", name: "🔄 Reversals", symbols: reversals.sort(), isVirtual: true, type: "auto", style: { color: "var(--orange)", background: "rgba(255, 152, 0, 0.15)" } });
    if (sideways.length > 0) virtualWatchlists.push({ _id: "auto-sideways", name: "➖ Chop", symbols: sideways.sort(), isVirtual: true, type: "auto", style: { color: "var(--muted)", background: "var(--panel-2)" } });
  }

  // Rated Alerts Watchlists
  if (alerts && alerts.length > 0) {
    const stars3 = [];
    const stars2 = [];
    const stars1 = [];
    
    // Sort alerts descending by most recent
    const ratedAlerts = [...alerts].filter(a => a.rating && a.status === "triggered").sort((a, b) => {
      const ta = new Date(a.triggeredAt || a.updatedAt || a.createdAt).getTime();
      const tb = new Date(b.triggeredAt || b.updatedAt || b.createdAt).getTime();
      return tb - ta;
    });
    
    ratedAlerts.forEach(a => {
       if (a.rating === 3 && !stars3.includes(a.symbol) && stars3.length < 10) stars3.push(a.symbol);
       if (a.rating === 2 && !stars2.includes(a.symbol) && stars2.length < 10) stars2.push(a.symbol);
       if (a.rating === 1 && !stars1.includes(a.symbol) && stars1.length < 10) stars1.push(a.symbol);
    });

    if (stars3.length > 0) virtualWatchlists.push({ _id: "auto-3star", name: "3★", symbols: stars3, isVirtual: true, type: "auto", style: { color: "var(--orange)", background: "rgba(255, 152, 0, 0.15)" } });
    if (stars2.length > 0) virtualWatchlists.push({ _id: "auto-2star", name: "2★", symbols: stars2, isVirtual: true, type: "auto", style: { color: "var(--orange)", background: "rgba(255, 152, 0, 0.15)" } });
    if (stars1.length > 0) virtualWatchlists.push({ _id: "auto-1star", name: "1★", symbols: stars1, isVirtual: true, type: "auto", style: { color: "var(--orange)", background: "rgba(255, 152, 0, 0.15)" } });
  }

  // Category Watchlists
  virtualWatchlists.push(
    { _id: "cat-usd", name: "💵 USD Majors", symbols: ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY", "USDCHF", "USDCAD"], isVirtual: true, type: "auto" },
    { _id: "cat-jpy", name: "💴 JPY Crosses", symbols: ["EURJPY", "GBPJPY", "AUDJPY", "NZDJPY", "CADJPY", "CHFJPY"], isVirtual: true, type: "auto" },
    { _id: "cat-eur", name: "💶 EUR Crosses", symbols: ["EURGBP", "EURAUD", "EURNZD", "EURCAD", "EURCHF"], isVirtual: true, type: "auto" },
    { _id: "cat-gbp", name: "💷 GBP Crosses", symbols: ["GBPAUD", "GBPNZD", "GBPCAD", "GBPCHF"], isVirtual: true, type: "auto" },
    { _id: "cat-aud", name: "🦘 AUD Crosses", symbols: ["AUDUSD", "AUDJPY", "EURAUD", "GBPAUD", "AUDCAD", "AUDCHF", "AUDNZD"], isVirtual: true, type: "auto" },
    { _id: "cat-nzd", name: "🥝 NZD Crosses", symbols: ["NZDUSD", "NZDJPY", "EURNZD", "GBPNZD", "AUDNZD", "NZDCAD", "NZDCHF"], isVirtual: true, type: "auto" },
    { _id: "cat-cad", name: "🍁 CAD Crosses", symbols: ["USDCAD", "CADJPY", "EURCAD", "GBPCAD", "AUDCAD", "NZDCAD", "CADCHF"], isVirtual: true, type: "auto" },
    { _id: "cat-chf", name: "🏔️ CHF Crosses", symbols: ["USDCHF", "CHFJPY", "EURCHF", "GBPCHF", "AUDCHF", "NZDCHF", "CADCHF"], isVirtual: true, type: "auto" },
    { _id: "cat-idx", name: "📊 Indices", symbols: ["US30", "SPX500", "NDX100", "GER30", "UK100", "JP225", "AUS200"], isVirtual: true, type: "auto" },
    { _id: "cat-mtl", name: "🥇 Metals & Energy", symbols: ["XAUUSD", "XAGUSD", "USOIL", "UKOIL"], isVirtual: true, type: "auto" },
    { _id: "cat-cry", name: "₿ Crypto", symbols: ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD"], isVirtual: true, type: "auto" }
  );

  const allWatchlists = [...watchlists, ...virtualWatchlists];
  const [isMobile, setIsMobile] = useState(false);
  const rowsContainerRef = useRef(null);

  useEffect(() => {
    const handleResize = () => {
      if (typeof window === "undefined") return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      setIsMobile(w <= 768 || (h <= 550 && w <= 1080));
    };
    handleResize();
    const delayed = () => {
      handleResize();
      setTimeout(handleResize, 80);
      setTimeout(handleResize, 250);
    };
    window.addEventListener("resize", delayed);
    window.addEventListener("orientationchange", delayed);
    screen?.orientation?.addEventListener?.("change", delayed);
    return () => {
      window.removeEventListener("resize", delayed);
      window.removeEventListener("orientationchange", delayed);
      screen?.orientation?.removeEventListener?.("change", delayed);
    };
  }, []);

  useEffect(() => {
    if (rowsContainerRef.current) {
      rowsContainerRef.current.scrollTop = 0;
    }
  }, [isMobile]);
  
  const baseMainLists = allWatchlists.filter(w => w.type !== "auto" || (isMobile && w._id.includes("star")));
  const autoLists = allWatchlists.filter(w => w.type === "auto" && !(isMobile && w._id.includes("star")));
  const activeAutoList = autoLists.find(w => w._id === activeListId);

  const mainLists = [
    ...baseMainLists,
    ...(activeAutoList && !baseMainLists.some(w => w._id === activeAutoList._id) ? [activeAutoList] : [])
  ];

  const list = allWatchlists.find((w) => w._id === activeListId) || allWatchlists[0] || null;
  const [editing, setEditing] = useState(null);
  const [activeTab, setActiveTab] = useState("main"); // main or auto
  const [name, setName] = useState("");
  const [drag, setDrag] = useState(null); // symbol being dragged
  const [over, setOver] = useState(null); // symbol currently hovered
  
  const [virtualSorts, setVirtualSorts] = useState(() => {
    if (typeof window !== "undefined") {
      try { return JSON.parse(localStorage.getItem("ts_virtual_sorts")) || {}; } catch { return {}; }
    }
    return {};
  });

  const saveVirtualSort = useCallback((listId, sortedSymbols) => {
    const next = { ...virtualSorts, [listId]: sortedSymbols };
    setVirtualSorts(next);
    if (typeof window !== "undefined") localStorage.setItem("ts_virtual_sorts", JSON.stringify(next));
  }, [virtualSorts]);

  const renderedSymbols = useMemo(() => {
    if (!list) return [];
    if (!list.isVirtual) return list.symbols || [];
    const syms = [...(list.symbols || [])];
    const sortOrder = virtualSorts[list._id];
    if (sortOrder) {
      syms.sort((a, b) => {
        const ia = sortOrder.indexOf(a);
        const ib = sortOrder.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return 1;
        if (ib !== -1) return -1;
        return a.localeCompare(b);
      });
    }
    return syms;
  }, [list, virtualSorts]);

  const reorder = useCallback(async (listObj, draggedSym, droppedSym, onReorderFn) => {
    const items = listObj.isVirtual ? [...renderedSymbols] : [...(listObj.symbols || [])];
    const dragIdx = items.indexOf(draggedSym);
    const dropIdx = items.indexOf(droppedSym);
    if (dragIdx < 0 || dropIdx < 0) return;
    items.splice(dragIdx, 1);
    items.splice(dropIdx, 0, draggedSym);
    
    if (listObj.isVirtual) {
      saveVirtualSort(listObj._id, items);
    } else {
      if (onReorderFn) onReorderFn(listObj._id, items);
    }
  }, [renderedSymbols, saveVirtualSort]);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [gridifyOpen, setGridifyOpen] = useState(false);
  const [autoMenuOpen, setAutoMenuOpen] = useState(false);
  const [gridifySelection, setGridifySelection] = useState([]);
  const [gridifyFlags, setGridifyFlags] = useState([]);
  const [selectedGridifyLayout, setSelectedGridifyLayout] = useState(null);
  const [gridifySync, setGridifySync] = useState({ symbol: false, tf: true, time: true, crosshair: true });
  const [gridifyTf, setGridifyTf] = useState("M15");

  const activeAlertSymbols = new Set(
    alerts.filter((a) => a.status === "active").map((a) => a.symbol)
  );

  const startCreate = () => { setEditing("new"); setName(""); };
  const startRename = (w) => { setEditing(w._id); setName(w.name); };

  const commitName = async () => {
    const v = name.trim();
    if (editing === "new") {
      if (v) await onCreate(v);
    } else if (editing) {
      if (v) await onRename(editing, v);
    }
    setEditing(null);
    setName("");
  };

  const lastTradingDateRef = useRef(getTradingDateString(Date.now()));

  const [dailyOpens, setDailyOpens] = useState(() => {
    if (typeof window === "undefined") return {};
    try {
      const stored = JSON.parse(localStorage.getItem("ts_daily_opens") || "{}");
      const today = getTradingDateString(Date.now());
      if (stored?.tradingDate === today && stored?.opens) {
        return stored.opens;
      }
      return {};
    } catch {
      return {};
    }
  });

  const [fallbackPrices, setFallbackPrices] = useState(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(localStorage.getItem("ts_fallback_prices") || "{}");
    } catch {
      return {};
    }
  });

  const [tabContextMenu, setTabContextMenu] = useState(null); // { list: w, x: number, y: number }
  const tabLongPressTimer = useRef(null);

  const handleTabTouchStart = (w, e) => {
    if (tabLongPressTimer.current) clearTimeout(tabLongPressTimer.current);
    const touch = e.touches[0];
    const clientX = touch.clientX;
    const clientY = touch.clientY;
    tabLongPressTimer.current = setTimeout(() => {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try { navigator.vibrate(50); } catch {}
      }
      setTabContextMenu({ list: w, x: clientX, y: clientY });
      tabLongPressTimer.current = null;
    }, 450);
  };

  const handleTabTouchEnd = () => {
    if (tabLongPressTimer.current) {
      clearTimeout(tabLongPressTimer.current);
      tabLongPressTimer.current = null;
    }
  };

  const updateSymbolRates = useCallback((sym, openVal, closeVal) => {
    const aliases = getSymbolAliases(sym);
    const today = getTradingDateString(Date.now());
    if (typeof openVal === "number" && openVal > 0) {
      setDailyOpens((prev) => {
        const next = { ...prev };
        for (const a of aliases) next[a] = openVal;
        try {
          const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => typeof v === "number" && v > 0));
          localStorage.setItem("ts_daily_opens", JSON.stringify({ tradingDate: today, opens: clean }));
        } catch {}
        return next;
      });
    }
    if (typeof closeVal === "number" && closeVal > 0) {
      setFallbackPrices((prev) => {
        const next = { ...prev };
        for (const a of aliases) next[a] = closeVal;
        try {
          const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => typeof v === "number" && v > 0));
          localStorage.setItem("ts_fallback_prices", JSON.stringify(clean));
        } catch {}
        return next;
      });
    }
  }, []);

  // Invalidate and refresh daily opens upon 00:00:00 Europe/Athens daily candle rollover
  useEffect(() => {
    const interval = setInterval(() => {
      const currentTradingDate = getTradingDateString(Date.now());
      if (currentTradingDate && currentTradingDate !== lastTradingDateRef.current) {
        lastTradingDateRef.current = currentTradingDate;
        setDailyOpens({});
        try {
          localStorage.removeItem("ts_daily_opens");
        } catch {}
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const syms = list?.symbols || [];
    syms.forEach((sym) => {
      const existingOpen = resolveAliasValue(sym, dailyOpens);
      const existingPrice = resolveAliasValue(sym, fallbackPrices);
      if (typeof existingOpen === "number" && typeof existingPrice === "number") return;
      if (dailyOpens[sym] === "loading") return;

      setDailyOpens((prev) => ({ ...prev, [sym]: "loading" }));
      fetch(`/api/rates?symbol=${encodeURIComponent(sym)}&tf=D1&count=2`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && Array.isArray(data.bars) && data.bars.length > 0) {
            // Newest daily bar is ALWAYS the last element
            const b = data.bars[data.bars.length - 1];
            const openVal = b?.o ?? b?.open;
            const closeVal = b?.c ?? b?.close;
            if (typeof openVal === "number" && openVal > 0) {
              updateSymbolRates(sym, openVal, closeVal);
              return;
            }
          }
          // Check localStorage bars cache as fallback across aliases and timeframes
          let foundOpen = null;
          let foundClose = null;
          try {
            const bc = JSON.parse(localStorage.getItem("ts_bars_cache") || "{}");
            const aliases = getSymbolAliases(sym);
            for (const a of aliases) {
              const d1Bars = bc[`${a}:D1`]?.bars;
              if (d1Bars && d1Bars.length > 0) {
                const lastD1 = d1Bars[d1Bars.length - 1];
                if (lastD1 && typeof (lastD1.open ?? lastD1.o) === "number") {
                  foundOpen = lastD1.open ?? lastD1.o;
                }
              }
              for (const tf of ["M5", "M1", "M15", "H1", "H4", "D1"]) {
                const tfBars = bc[`${a}:${tf}`]?.bars;
                if (tfBars && tfBars.length > 0) {
                  const lastTf = tfBars[tfBars.length - 1];
                  if (lastTf && typeof (lastTf.close ?? lastTf.c) === "number") {
                    foundClose = lastTf.close ?? lastTf.c;
                    break;
                  }
                }
              }
            }
          } catch {}

          if (foundOpen || foundClose) {
            updateSymbolRates(sym, foundOpen, foundClose);
          } else {
            setDailyOpens((prev) => (typeof prev[sym] === "number" ? prev : { ...prev, [sym]: null }));
          }
        })
        .catch(() => {
          let foundOpen = null;
          let foundClose = null;
          try {
            const bc = JSON.parse(localStorage.getItem("ts_bars_cache") || "{}");
            const aliases = getSymbolAliases(sym);
            for (const a of aliases) {
              const d1Bars = bc[`${a}:D1`]?.bars;
              if (d1Bars && d1Bars.length > 0) {
                const lastD1 = d1Bars[d1Bars.length - 1];
                if (lastD1 && typeof (lastD1.open ?? lastD1.o) === "number") {
                  foundOpen = lastD1.open ?? lastD1.o;
                }
              }
              for (const tf of ["M5", "M1", "M15", "H1", "H4", "D1"]) {
                const tfBars = bc[`${a}:${tf}`]?.bars;
                if (tfBars && tfBars.length > 0) {
                  const lastTf = tfBars[tfBars.length - 1];
                  if (lastTf && typeof (lastTf.close ?? lastTf.c) === "number") {
                    foundClose = lastTf.close ?? lastTf.c;
                    break;
                  }
                }
              }
            }
          } catch {}

          if (foundOpen || foundClose) {
            updateSymbolRates(sym, foundOpen, foundClose);
          } else {
            setDailyOpens((prev) => (typeof prev[sym] === "number" ? prev : { ...prev, [sym]: null }));
          }
        });
    });
  }, [list?.symbols, dailyOpens, fallbackPrices, updateSymbolRates]);

  // Reactive refresh when broker symbol mapping is updated in settings
  useEffect(() => {
    const onMappingUpdated = () => {
      const syms = list?.symbols || [];
      syms.forEach((sym) => {
        fetch(`/api/rates?symbol=${encodeURIComponent(sym)}&tf=D1&count=1`)
          .then((r) => r.json())
          .then((data) => {
            if (data.ok && data.bars?.length > 0) {
              const b = data.bars[0];
              updateSymbolRates(sym, b.o, b.c);
            }
          })
          .catch(() => {});
      });
    };
    window.addEventListener("ts_symbol_mapping_updated", onMappingUpdated);
    return () => window.removeEventListener("ts_symbol_mapping_updated", onMappingUpdated);
  }, [list?.symbols, updateSymbolRates]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (e.defaultPrevented || typeof window !== "undefined" && window.__ts_drawing_selected) return;
        if (!list || !list.symbols || list.symbols.length === 0) return;
        
        const idx = list.symbols.indexOf(symbol);
        if (idx === -1) return; // If current symbol isn't in active list, don't do anything
        
        let nextIdx = idx;
        if (e.key === "ArrowDown") {
          nextIdx = idx < list.symbols.length - 1 ? idx + 1 : 0;
        } else if (e.key === "ArrowUp") {
          nextIdx = idx > 0 ? idx - 1 : list.symbols.length - 1;
        }
        
        if (nextIdx !== idx) {
          e.preventDefault();
          const nextSym = list.symbols[nextIdx];
          setSymbol(nextSym);
          if (typeof window !== "undefined" && window.innerWidth <= 768) {
             document.body.classList.remove("sidebar-open");
          }
        }
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [list, symbol, setSymbol]);

  const handleGridClick = () => {
    if (!list || !list.symbols || !list.symbols.length) return;
    if (list.isVirtual) {
      setGridifyFlags([list.color]);
    } else {
      setGridifyFlags([]);
    }
    setGridifySelection(list.symbols.slice(0, 8)); // select first 8 by default
    setSelectedGridifyLayout(null);
    setGridifyOpen(true);
  };

  let gridifyPool = list?.symbols || [];
  if (gridifyFlags.length > 0) {
    const pool = [];
    gridifyFlags.forEach(color => {
      const vList = virtualWatchlists.find(v => v.color === color);
      if (vList) pool.push(...vList.symbols);
    });
    gridifyPool = [...new Set(pool)].sort();
  }

  return (
    <div className="watchlist-container" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, width: "100%" }}>
      {/* Tabs row */}
      {/* Tabs and mobile action buttons row */}
      <div className="watchlist-top-bar" style={{
        display: "flex", alignItems: "center",
        borderBottom: "1px solid var(--border)",
      }}>
        <div className="watchlist-tabs" style={{
          flex: 1, display: "flex", alignItems: "center", gap: 4, padding: "6px 8px",
          overflowX: "auto", minWidth: 0
        }}>
        {mainLists.map((w) => (
          editing === w._id && !w.isVirtual ? (
            <NameEditor
              key={w._id}
              value={name}
              setValue={setName}
              onCommit={commitName}
              onCancel={() => { setEditing(null); setName(""); }}
            />
          ) : (
              <button
                key={w._id}
                onClick={() => setActiveListId(w._id)}
                onDoubleClick={() => !w.isVirtual && startRename(w)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setTabContextMenu({ list: w, x: e.clientX, y: e.clientY });
                }}
                onTouchStart={(e) => handleTabTouchStart(w, e)}
                onTouchEnd={handleTabTouchEnd}
                onTouchCancel={handleTabTouchEnd}
                className={w._id === activeListId && !w.isVirtual ? "primary" : "ghost"}
                title={w.isVirtual ? `${w.name} (${(w.symbols || []).length})` : `${w.name} (${(w.symbols || []).length}) — double-click to rename, long-press for options`}
                style={{
                  fontSize: 11, padding: "3px 8px", whiteSpace: "nowrap",
                  display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                  ...(w.isVirtual && w.color ? { 
                    background: w.color === "red" ? "rgba(239, 83, 80, 0.2)" : 
                                w.color === "blue" ? "rgba(41, 98, 255, 0.2)" : 
                                w.color === "green" ? "rgba(38, 166, 154, 0.2)" : 
                                w.color === "yellow" ? "rgba(255, 235, 59, 0.2)" : "inherit",
                    border: w._id === activeListId ? `1px solid ${
                                w.color === "red" ? "#ef5350" : 
                                w.color === "blue" ? "#2962ff" : 
                                w.color === "green" ? "#26a69a" : 
                                w.color === "yellow" ? "#ffeb3b" : "inherit"
                    }` : "1px solid transparent"
                  } : w.type === "auto" ? {
                    background: w._id === activeListId ? (w.style?.background || "var(--accent-soft)") : "transparent",
                    color: w._id === activeListId ? (w.style?.color || "var(--fg)") : "var(--muted)",
                    border: w._id === activeListId ? `1px solid var(--border-hi)` : "1px solid transparent",
                    fontWeight: 600
                  } : {})
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {w.isVirtual && w.color ? (
                    <div style={{
                      width: 10, height: 10, borderRadius: "50%",
                      background: w.color === "red" ? "#ef5350" : w.color === "blue" ? "#2962ff" : w.color === "green" ? "#26a69a" : w.color === "yellow" ? "#ffeb3b" : "inherit"
                    }} />
                  ) : (
                    w.name
                  )}
                </div>
              <span style={{ opacity: 0.55 }}>{(w.symbols || []).length}</span>
            </button>
          )
        ))}
        {editing === "new" ? (
          <NameEditor
            value={name}
            setValue={setName}
            onCommit={commitName}
            onCancel={() => { setEditing(null); setName(""); }}
            placeholder="List name…"
          />
        ) : (
          <button className="ghost" onClick={startCreate} title="New watchlist" style={{ padding: "3px 7px", flexShrink: 0 }}>＋</button>
        )}

        </div>

        {/* Auto Watchlist Dropdown (pinned right on desktop & mobile) */}
        {autoLists.length > 0 && (
          <div style={{ position: "relative", flexShrink: 0, display: "flex", alignItems: "center", paddingLeft: 4 }}>
            <button 
              className="ghost"
              onClick={() => setAutoMenuOpen(!autoMenuOpen)}
              title="Auto-Generated Watchlists"
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", fontSize: 11, fontWeight: 600,
                color: autoLists.some(w => w._id === activeListId) ? "var(--accent)" : "var(--muted)",
                background: autoLists.some(w => w._id === activeListId) ? "rgba(41, 98, 255, 0.15)" : "transparent",
                borderRadius: 4
              }}
            >
              <Zap size={14} style={{ fill: autoLists.some(w => w._id === activeListId) ? "var(--accent)" : "none" }} />
              <ChevronDown size={14} />
            </button>
            {autoMenuOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setAutoMenuOpen(false)} />
                <div
                  style={{
                    position: "absolute", right: 0,
                    ...(isMobile
                       ? { bottom: "100%", marginBottom: 4 }
                       : { top: "100%", marginTop: 4 }),
                    background: "var(--panel)", border: "1px solid var(--border-hi)",
                    borderRadius: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                    zIndex: 100, minWidth: 160, display: "flex", flexDirection: "column", padding: 4
                  }}
                >
                  {autoLists.filter(w => w._id.includes("star")).length > 0 && (
                    <div className="muted" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, padding: "4px 8px 6px" }}>Priority Rated</div>
                  )}
                  {autoLists.filter(w => w._id.includes("star")).map(w => (
                    <button
                      key={w._id}
                      className="ghost"
                      onClick={() => { 
                        setActiveListId(w._id); 
                        setAutoMenuOpen(false); 
                        onSelectAutoList?.();
                      }}
                      style={{
                        textAlign: "left", padding: "6px 10px", fontSize: 12, display: "flex", justifyContent: "space-between", alignItems: "center",
                        borderRadius: 4,
                        color: w._id === activeListId ? "var(--accent)" : "inherit",
                        background: w._id === activeListId ? "rgba(41, 98, 255, 0.15)" : "transparent"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={w.style ? { 
                          background: w.style.background, color: w.style.color, 
                          padding: "2px 6px", borderRadius: 4, fontSize: 11, fontWeight: 600 
                        } : {}}>{w.name}</span>
                      </div>
                      <span style={{ opacity: 0.5 }}>{w.symbols.length}</span>
                    </button>
                  ))}

                  {autoLists.filter(w => !w._id.startsWith("cat-") && !w._id.includes("star")).length > 0 && (
                    <div className="muted" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, padding: "10px 8px 6px", borderTop: autoLists.filter(x => x._id.includes("star")).length > 0 ? "1px solid var(--border)" : "none", marginTop: autoLists.filter(x => x._id.includes("star")).length > 0 ? 4 : 0 }}>Bias Engine Matches</div>
                  )}
                  {autoLists.filter(w => !w._id.startsWith("cat-") && !w._id.includes("star")).map(w => (
                    <button
                      key={w._id}
                      className="ghost"
                      onClick={() => { 
                        setActiveListId(w._id); 
                        setAutoMenuOpen(false); 
                        onSelectAutoList?.();
                      }}
                      style={{
                        textAlign: "left", padding: "6px 10px", fontSize: 12, display: "flex", justifyContent: "space-between", alignItems: "center",
                        borderRadius: 4,
                        color: w._id === activeListId ? "var(--accent)" : "inherit",
                        background: w._id === activeListId ? "rgba(41, 98, 255, 0.15)" : "transparent"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={w.style ? { 
                          background: w.style.background, color: w.style.color, 
                          padding: "2px 6px", borderRadius: 4, fontSize: 11, fontWeight: 600 
                        } : {}}>{w.name}</span>
                      </div>
                      <span style={{ opacity: 0.5 }}>{w.symbols.length}</span>
                    </button>
                  ))}
                  
                  {autoLists.filter(w => w._id.startsWith("cat-")).length > 0 && (
                    <div className="muted" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, padding: "10px 8px 6px", borderTop: "1px solid var(--border)", marginTop: 4 }}>Categories</div>
                  )}
                  {autoLists.filter(w => w._id.startsWith("cat-")).map(w => (
                    <button
                      key={w._id}
                      className="ghost"
                      onClick={() => { 
                        setActiveListId(w._id); 
                        setAutoMenuOpen(false); 
                        onSelectAutoList?.();
                      }}
                      style={{
                        textAlign: "left", padding: "6px 10px", fontSize: 12, display: "flex", justifyContent: "space-between", alignItems: "center",
                        borderRadius: 4,
                        color: w._id === activeListId ? "var(--accent)" : "inherit",
                        background: w._id === activeListId ? "rgba(41, 98, 255, 0.15)" : "transparent"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 500 }}>{w.name}</span>
                      </div>
                      <span style={{ opacity: 0.5 }}>{w.symbols.length}</span>
                    </button>
                  ))}
                  
                  {Object.keys(symbolFlags).length > 0 && (
                    <>
                      <div style={{ height: 1, background: "var(--border)", margin: "8px 0" }} />
                      <button
                        className="ghost"
                        onClick={() => {
                          if (confirm("Clear all flags?")) {
                            setSymbolFlags({});
                            setAutoMenuOpen(false);
                          }
                        }}
                        style={{
                          textAlign: "left", padding: "6px 10px", fontSize: 12, display: "flex", justifyContent: "center", alignItems: "center",
                          borderRadius: 4, color: "var(--red)", fontWeight: 500
                        }}
                      >
                        Clear All Flags ({Object.keys(symbolFlags).length})
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Mobile-only action buttons pinned to the right */}
        <div className="hide-desktop" style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", background: "var(--panel)" }}>
          {onNavUp && (
            <>
              <button 
                className="ghost" 
                style={{ padding: "4px", display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={onNavUp}
              >
                <ArrowUp size={14} />
              </button>
              <button 
                className="ghost" 
                style={{ padding: "4px", display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={onNavDown}
              >
                <ArrowDown size={14} />
              </button>
            </>
          )}
          {list && !list.isVirtual && (
            <button className="ghost" onClick={() => setEditModalOpen(true)} title="Edit Watchlist" style={{ fontSize: 12, padding: "4px 8px", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
              <Settings2 size={14} /> Edit
            </button>
          )}
          {list && (list.symbols || []).length > 0 && (
            <button className="ghost" onClick={handleGridClick} title="Grid View" style={{ padding: "4px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--brand)" }}>
              <LayoutGrid size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Header (Desktop Only) */}
      <div className="hide-mobile" style={{
        display: "flex", alignItems: "center", padding: "5px 8px",
        borderBottom: "1px solid var(--border)",
      }}>
        <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {list ? `${list.name} · ${(list.symbols || []).length}` : "No list"}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 2, flexShrink: 0 }}>
          {list && !list.isVirtual && watchlists.length > 0 && (
            <button
              className="ghost danger"
              onClick={() => {
                if (confirm(`Delete list “${list.name}”? Its symbols stay in your alerts.`)) onDelete(list._id);
              }}
              title="Delete this list"
              style={{ padding: "2px 4px", display: "flex", alignItems: "center" }}
            >
              <Trash2 size={13} />
            </button>
          )}
          {list && !list.isVirtual && (
            <button className="ghost" onClick={onAddSymbol} title="Add symbol to list" style={{ fontSize: 11, padding: "2px 5px", fontWeight: 600, display: "flex", alignItems: "center", gap: 2 }}>
              <Plus size={13} /> Add
            </button>
          )}
          {list && (list.symbols || []).length > 0 && (
            <button className="ghost" onClick={handleGridClick} title="Grid View" style={{ fontSize: 11, padding: "2px 5px", fontWeight: 600, display: "flex", alignItems: "center", gap: 2, color: "var(--brand)" }}>
              <LayoutGrid size={13} /> Grid
            </button>
          )}
        </div>
      </div>

      {/* Rows */}
      <div className="wl-rows" ref={rowsContainerRef} style={{ position: "relative", minHeight: isMobile ? 40 : undefined }}>
        {!list && (
          <div className="muted" style={{ padding: 16, textAlign: "center", fontSize: 12 }}>
            No watchlist selected.
          </div>
        )}
        {list && !(list.symbols || []).length && (
          <div className="muted" style={{ padding: 16, textAlign: "center", fontSize: 12 }}>
            Empty list. Click <b><Plus size={12} style={{verticalAlign:"middle", display:"inline-block"}} /> Add</b> to search the broker universe.
          </div>
        )}

        {list && renderedSymbols.map((sym, i) => {
          const resolvedTick = resolveAliasValue(sym, ticks);
          const resolvedOpen = resolveAliasValue(sym, dailyOpens);
          const resolvedFallback = resolveAliasValue(sym, fallbackPrices);
          return (
            <WatchRow
              key={sym + i}
              sym={sym}
              isMobile={isMobile}
              tick={resolvedTick}
              dailyOpen={typeof resolvedOpen === "number" ? resolvedOpen : null}
              fallbackPriceProp={typeof resolvedFallback === "number" ? resolvedFallback : null}
              current={sym === symbol}
              hasAlert={activeAlertSymbols.has(sym)}
              onJump={() => setSymbol(sym)}
              onDoubleClick={() => { if (onDoubleJump) onDoubleJump(sym); }}
              onRemove={() => {
                if (list.isVirtual) {
                  setSymbolFlags(p => {
                    const next = { ...p };
                    delete next[sym];
                    return next;
                  });
                } else {
                  onRemoveSymbol(list._id, sym);
                }
              }}
              dragging={drag === sym}
              dropTarget={over === sym && drag && drag !== sym}
              onDragStart={(e) => {
                try {
                  e.dataTransfer.setData("text/plain", sym);
                  e.dataTransfer.effectAllowed = "move";
                } catch {}
                setDrag(sym);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                try { e.dataTransfer.dropEffect = "move"; } catch {}
                if (over !== sym) setOver(sym);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setOver((o) => (o === sym ? null : o));
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (drag && drag !== sym) reorder(list, drag, sym, onReorder);
                setDrag(null); setOver(null);
              }}
              onDragEnd={() => {
                setDrag(null); setOver(null);
              }}
              onGripPointerDown={(e, gripSym) => {
                e.preventDefault();
                e.stopPropagation();
                // Start touch drag immediately when grip is pressed
                setDrag(gripSym);
                const rowEls = document.querySelectorAll(".wl-row-item");
                const onMove = (ev) => {
                  const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
                  for (const el of rowEls) {
                    const rect = el.getBoundingClientRect();
                    if (clientY >= rect.top && clientY <= rect.bottom) {
                      const hSym = el.dataset.sym;
                      if (hSym && hSym !== gripSym) setOver(hSym);
                      break;
                    }
                  }
                };
                const onUp = (ev) => {
                  const clientY = ev.changedTouches ? ev.changedTouches[0].clientY : ev.clientY;
                  let dropSym = null;
                  for (const el of rowEls) {
                    const rect = el.getBoundingClientRect();
                    if (clientY >= rect.top && clientY <= rect.bottom) {
                      dropSym = el.dataset.sym;
                      break;
                    }
                  }
                  if (dropSym && dropSym !== gripSym) reorder(list, gripSym, dropSym, onReorder);
                  setDrag(null); setOver(null);
                  window.removeEventListener("pointermove", onMove);
                  window.removeEventListener("pointerup", onUp);
                  window.removeEventListener("touchmove", onMove);
                  window.removeEventListener("touchend", onUp);
                };
                window.addEventListener("pointermove", onMove, { passive: true });
                window.addEventListener("pointerup", onUp);
                window.addEventListener("touchmove", onMove, { passive: true });
                window.addEventListener("touchend", onUp);
              }}
              flag={symbolFlags?.[sym]}
              onFlag={(color) => setSymbolFlags(p => {
                const next = { ...p };
                if (color) next[sym] = color;
                else delete next[sym];
                return next;
              })}
              onReorderClick={() => setEditModalOpen(true)}
              onHorizontalReorder={(dragSym, dropSym) => reorder(list, dragSym, dropSym, onReorder)}
            />
          );
        })}
      </div>

      {editModalOpen && list && (
        <WatchlistEditModal 
          list={list} 
          symbolFlags={symbolFlags}
          onClose={() => setEditModalOpen(false)} 
          onAddSymbol={onAddSymbol} 
          onRemoveSymbol={onRemoveSymbol} 
          onReorder={onReorder}
          reorderFn={reorder}
          onDeleteList={() => {
            if (confirm(`Delete list “${list.name}”?`)) {
              onDelete(list._id);
              setEditModalOpen(false);
            }
          }}
        />
      )}

      {tabContextMenu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 1200 }}
            onClick={() => setTabContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setTabContextMenu(null); }}
          />
          <div
            style={{
              position: "fixed",
              top: Math.min(tabContextMenu.y || 100, typeof window !== "undefined" ? window.innerHeight - 250 : 300),
              left: Math.min(tabContextMenu.x || 100, typeof window !== "undefined" ? window.innerWidth - 220 : 200),
              zIndex: 1201,
              background: "var(--panel)",
              border: "1px solid var(--border-hi)",
              borderRadius: 8,
              boxShadow: "0 10px 28px rgba(0,0,0,0.65)",
              minWidth: 200,
              padding: 6,
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "6px 10px 8px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{tabContextMenu.list.name}</span>
              <span className="muted" style={{ fontSize: 11 }}>{(tabContextMenu.list.symbols || []).length} symbols</span>
            </div>

            {!tabContextMenu.list.isVirtual && (
              <button
                className="ghost"
                onClick={() => {
                  const l = tabContextMenu.list;
                  setTabContextMenu(null);
                  startRename(l);
                }}
                style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 8, borderRadius: 4 }}
              >
                <Settings2 size={14} /> Rename Watchlist
              </button>
            )}

            {!tabContextMenu.list.isVirtual && (
              <button
                className="ghost"
                onClick={() => {
                  const l = tabContextMenu.list;
                  setTabContextMenu(null);
                  onCreate?.(`${l.name} (Copy)`, l.symbols || []);
                }}
                style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 8, borderRadius: 4 }}
              >
                <Copy size={14} /> Duplicate Watchlist
              </button>
            )}

            <button
              className="ghost"
              onClick={() => {
                const l = tabContextMenu.list;
                setTabContextMenu(null);
                if (confirm(`Clear all ${(l.symbols || []).length} symbols from “${l.name}”?`)) {
                  onReorder(l._id, []);
                }
              }}
              style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 8, borderRadius: 4 }}
            >
              <Eraser size={14} /> Clear All Symbols
            </button>

            {!tabContextMenu.list.isVirtual && (
              <button
                className="ghost"
                onClick={() => {
                  const l = tabContextMenu.list;
                  setActiveListId(l._id);
                  setTabContextMenu(null);
                  setEditModalOpen(true);
                }}
                style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 8, borderRadius: 4 }}
              >
                <LayoutGrid size={14} /> Edit & Reorder Symbols
              </button>
            )}

            {(() => {
              const isDefault = tabContextMenu.list._id === "main" ||
                                tabContextMenu.list.isDefault ||
                                tabContextMenu.list.name?.toLowerCase() === "main" ||
                                (watchlists.length <= 1 && watchlists[0]?._id === tabContextMenu.list._id);
              if (isDefault) {
                return (
                  <div
                    className="muted"
                    title="Default watchlist cannot be deleted"
                    style={{ padding: "8px 10px", fontSize: 12, opacity: 0.35, cursor: "not-allowed", display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <Trash2 size={14} /> Delete (Default Protected)
                  </div>
                );
              }
              return (
                <button
                  className="ghost danger"
                  onClick={() => {
                    const l = tabContextMenu.list;
                    setTabContextMenu(null);
                    if (confirm(`Delete watchlist “${l.name}”?`)) {
                      onDelete(l._id);
                    }
                  }}
                  style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 8, borderRadius: 4 }}
                >
                  <Trash2 size={14} /> Delete Watchlist
                </button>
              );
            })()}
          </div>
        </>
      )}

      {gridifyOpen && list && (
        <div className="modal-overlay" onClick={() => setGridifyOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: 400, maxWidth: "90%", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, margin: 0 }}>Grid Layout Selection</h2>
              <button className="ghost" onClick={() => setGridifyOpen(false)} style={{ padding: 4 }}><X size={18} /></button>
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
              Select up to 8 symbols to display in the grid view.
            </p>

            {gridifyFlags.length > 0 && (
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                {["red", "blue", "green", "yellow"].map(color => {
                  const isActive = gridifyFlags.includes(color);
                  const hasSymbols = virtualWatchlists.some(v => v.color === color && v.symbols.length > 0);
                  if (!hasSymbols && !isActive) return null;
                  return (
                    <button
                      key={color}
                      className={isActive ? "primary" : "ghost"}
                      style={{ padding: "4px 10px", fontSize: 11, borderRadius: 16, display: "flex", alignItems: "center", gap: 6, opacity: isActive ? 1 : 0.6 }}
                      onClick={() => {
                        setGridifyFlags(prev => {
                          const next = prev.includes(color) ? prev.filter(c => c !== color) : [...prev, color];
                          if (next.length === 0) return [color]; // Don't allow empty selection, just force one to stay active
                          
                          const newPool = [];
                          next.forEach(c => {
                             const v = virtualWatchlists.find(x => x.color === c);
                             if (v) newPool.push(...v.symbols);
                          });
                          const uniquePool = [...new Set(newPool)].sort();
                          
                          const newSelection = gridifySelection.filter(s => uniquePool.includes(s));
                          for (const sym of uniquePool) {
                             if (newSelection.length >= 8) break;
                             if (!newSelection.includes(sym)) newSelection.push(sym);
                          }
                          setGridifySelection(newSelection);
                          return next;
                        });
                      }}
                    >
                      <Flag size={12} fill={isActive ? "currentColor" : "none"} style={{ color: color === "red" ? "#ef5350" : color === "blue" ? "#2962ff" : color === "green" ? "#26a69a" : color === "yellow" ? "#ffeb3b" : "inherit" }} />
                      {color.charAt(0).toUpperCase() + color.slice(1)}
                    </button>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24, maxHeight: 300, overflowY: "auto", paddingBottom: 10 }}>
              {gridifyPool.map(sym => {
                const isSelected = gridifySelection.includes(sym);
                return (
                  <button 
                    key={sym}
                    className={isSelected ? "primary" : "ghost"}
                    style={{ fontSize: 12, padding: "6px 12px", borderRadius: 16, border: isSelected ? "none" : "1px solid var(--border)" }}
                    onClick={() => {
                      setGridifySelection(prev => {
                        if (prev.includes(sym)) return prev.filter(s => s !== sym);
                        if (prev.length >= 8) return prev;
                        return [...prev, sym];
                      });
                    }}
                  >
                    {sym}
                  </button>
                );
              })}
            </div>

            {gridifySelection.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, marginBottom: 8, fontWeight: 600, opacity: 0.8 }}>Choose Layout Style:</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(() => {
                    const count = Math.min(gridifySelection.length, 8);
                    const targetCount = count === 7 ? 8 : count;
                    const availableLayouts = Object.keys(LAYOUT_CONFIG).filter(k => LAYOUT_CONFIG[k].count === targetCount);
                    return availableLayouts.map(lId => (
                      <LayoutIcon 
                        key={lId} 
                        layoutId={lId} 
                        isActive={(selectedGridifyLayout || availableLayouts[0]) === lId} 
                        onClick={() => setSelectedGridifyLayout(lId)} 
                      />
                    ));
                  })()}
                </div>
              </div>
            )}

            {gridifySelection.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, marginBottom: 8, fontWeight: 600, opacity: 0.8 }}>Timeframe:</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {TFS.map((t) => (
                    <button
                      key={t}
                      className={gridifyTf === t ? "primary" : "ghost"}
                      onClick={() => setGridifyTf(t)}
                      style={{ padding: "4px 8px", fontSize: 11, borderRadius: 4 }}
                    >
                      {TF_LABEL[t]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {gridifySelection.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 12, marginBottom: 8, fontWeight: 600, opacity: 0.8 }}>Sync Options:</div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  {["crosshair", "time", "tf", "symbol"].map(opt => (
                    <label key={opt} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                      <input 
                        type="checkbox" 
                        checked={gridifySync[opt]} 
                        onChange={(e) => setGridifySync(p => ({ ...p, [opt]: e.target.checked }))} 
                      />
                      <span style={{ textTransform: "capitalize" }}>{opt === "tf" ? "Timeframe" : opt}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button className="ghost" onClick={() => setGridifyOpen(false)} style={{ padding: "6px 16px" }}>Cancel</button>
              <button 
                className="primary" 
                style={{ padding: "6px 16px", borderRadius: 4 }}
                onClick={() => {
                  if (onGridify) {
                     const count = Math.min(gridifySelection.length, 8);
                     const targetCount = count === 7 ? 8 : count;
                     const availableLayouts = Object.keys(LAYOUT_CONFIG).filter(k => LAYOUT_CONFIG[k].count === targetCount);
                     const layoutToUse = selectedGridifyLayout && availableLayouts.includes(selectedGridifyLayout) ? selectedGridifyLayout : availableLayouts[0];
                     onGridify(gridifySelection, layoutToUse, gridifySync, gridifyTf);
                  }
                  setGridifyOpen(false);
                }}
                disabled={gridifySelection.length === 0}
              >
                Create Grid ({gridifySelection.length}/8)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Reorder by persisting the new symbol order to the active list.
// We reuse the rename endpoint's "watchlists changed" broadcast path by
// POSTing the full symbol array to a small dedicated endpoint.
async function reorder(list, fromSym, toSym, onReorder) {
  const syms = [...(list.symbols || [])];
  const from = syms.indexOf(fromSym);
  const to = syms.indexOf(toSym);
  if (from < 0 || to < 0 || from === to) return;
  syms.splice(from, 1);
  syms.splice(to, 0, fromSym);
  if (onReorder) {
    onReorder(list._id, syms);
  } else {
    try {
      await fetch(`/api/watchlists/${list._id}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: syms }),
      });
    } catch { /* optimistic UI will self-heal on next WS broadcast */ }
  }
}

function WatchRow({
  sym, tick, dailyOpen, fallbackPriceProp, current, hasAlert, onJump, onDoubleClick, onRemove,
  dragging, dropTarget, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
  onGripPointerDown, flag, onFlag, isMobile, onReorderClick, onHorizontalReorder
}) {
  const [showPalette, setShowPalette] = useState(false);
  const [isHoldingToDrag, setIsHoldingToDrag] = useState(false);
  const [horizontalOver, setHorizontalOver] = useState(null);
  const paletteRef = useRef(null);
  const rowRef = useRef(null);
  const longPressTimer = useRef(null);
  const dragTouchStart = useRef({ x: 0, y: 0 });
  const hasDraggedHorizontally = useRef(false);

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTouchStart = (e) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    const touch = e.touches[0];
    dragTouchStart.current = { x: touch.clientX, y: touch.clientY };
    hasDraggedHorizontally.current = false;

    longPressTimer.current = setTimeout(() => {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try { navigator.vibrate(50); } catch {}
      }
      setIsHoldingToDrag(true);
      longPressTimer.current = null;

      const onTouchMove = (ev) => {
        const t = ev.touches[0];
        const dx = Math.abs(t.clientX - dragTouchStart.current.x);
        const dy = Math.abs(t.clientY - dragTouchStart.current.y);
        if (dx > 6 || dy > 6) {
          hasDraggedHorizontally.current = true;
        }

        const rowEls = document.querySelectorAll(".wl-row-item");
        for (const el of rowEls) {
          const rect = el.getBoundingClientRect();
          if (t.clientX >= rect.left && t.clientX <= rect.right && t.clientY >= rect.top - 20 && t.clientY <= rect.bottom + 20) {
            const hSym = el.dataset.sym;
            if (hSym && hSym !== sym) {
              setHorizontalOver(hSym);
            }
            break;
          }
        }

        const container = document.querySelector(".wl-rows");
        if (container) {
          const cRect = container.getBoundingClientRect();
          if (t.clientX < cRect.left + 40) {
            container.scrollLeft -= 10;
          } else if (t.clientX > cRect.right - 40) {
            container.scrollLeft += 10;
          }
        }
      };

      const onTouchEnd = () => {
        window.removeEventListener("touchmove", onTouchMove);
        window.removeEventListener("touchend", onTouchEnd);
        setIsHoldingToDrag(false);

        setHorizontalOver((currentOver) => {
          if (hasDraggedHorizontally.current && currentOver && currentOver !== sym) {
            if (onHorizontalReorder) onHorizontalReorder(sym, currentOver);
          } else if (!hasDraggedHorizontally.current) {
            setShowPalette(true);
          }
          return null;
        });
      };

      window.addEventListener("touchmove", onTouchMove, { passive: true });
      window.addEventListener("touchend", onTouchEnd);
    }, 350);
  };

  const handleTouchMove = (e) => {
    if (!isHoldingToDrag) {
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - dragTouchStart.current.x);
      const dy = Math.abs(touch.clientY - dragTouchStart.current.y);
      if (dx > 8 || dy > 8) {
        cancelLongPress();
      }
    }
  };

  useEffect(() => {
    if (current && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [current]);

  useEffect(() => {
    if (!showPalette) return;
    const close = (e) => {
      if (!paletteRef.current?.contains(e.target)) setShowPalette(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close, { passive: true });
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [showPalette]);

  const digits = tick?.digits ?? 5;
  const bid = tick?.bid;
  const spreadPips = tick?.bid && tick?.ask ? (tick.ask - tick.bid) * Math.pow(10, digits === 3 || digits === 5 ? digits - 1 : 0) : null;
  const dir = tick?.dir;
  let bgColor = "var(--bg)";
  if (dropTarget || horizontalOver === sym) {
    bgColor = "var(--accent-soft)";
  } else if (isHoldingToDrag) {
    bgColor = "var(--panel-2)";
  } else if (current) {
    if (flag === "red") bgColor = "rgba(239, 83, 80, 0.15)";
    else if (flag === "blue") bgColor = "rgba(41, 98, 255, 0.15)";
    else if (flag === "green") bgColor = "rgba(38, 166, 154, 0.15)";
    else if (flag === "yellow") bgColor = "rgba(255, 235, 59, 0.15)";
    else bgColor = "var(--accent-soft)";
  } else if (flag) {
    if (flag === "red") bgColor = "rgba(239, 83, 80, 0.06)";
    else if (flag === "blue") bgColor = "rgba(41, 98, 255, 0.06)";
    else if (flag === "green") bgColor = "rgba(38, 166, 154, 0.06)";
    else if (flag === "yellow") bgColor = "rgba(255, 235, 59, 0.06)";
  }

  let fallbackPrice = fallbackPriceProp;
  if (bid == null && fallbackPrice == null && typeof window !== "undefined") {
    try {
      const bc = JSON.parse(localStorage.getItem("ts_bars_cache") || "{}");
      const aliases = getSymbolAliases(sym);
      for (const a of aliases) {
        for (const tf of ["M5", "M1", "M15", "H1", "H4", "D1", "M30"]) {
          const symBars = bc[`${a}:${tf}`]?.bars;
          if (symBars && symBars.length > 0 && typeof symBars[symBars.length - 1]?.close === "number") {
            fallbackPrice = symBars[symBars.length - 1].close;
            break;
          }
        }
        if (fallbackPrice != null) break;
      }
    } catch {}
  }
  const effectivePrice = bid ?? tick?.last ?? fallbackPrice;

  return (
    <div
      ref={rowRef}
      className="wl-row-item"
      data-sym={sym}
      draggable={!isMobile && Boolean(onDragStart)}
      onDragStart={!isMobile ? onDragStart : undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onJump}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setShowPalette(true); }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={cancelLongPress}
      onTouchCancel={cancelLongPress}
      title={current ? "Current chart" : `Switch to ${sym}`}
      style={{
        background: bgColor,
        opacity: dragging ? 0.4 : 1,
        borderLeft: current ? "2px solid var(--accent)" : "2px solid transparent",
        WebkitTouchCallout: "none",
        ...(isHoldingToDrag ? {
          transform: "scale(1.06)",
          zIndex: 50,
          boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
          borderColor: "var(--accent)",
        } : (horizontalOver === sym || dropTarget) ? {
          borderColor: "var(--accent)",
          boxShadow: "0 0 0 1px var(--accent)",
        } : {})
      }}
    >
      {Boolean(onGripPointerDown) && (
        <div
          className="wl-row-drag muted hide-on-mobile"
          style={{ display: "flex", alignItems: "center", cursor: "grab", userSelect: "none", opacity: 0.5, touchAction: "none" }}
          title="Drag to reorder"
          onPointerDown={(e) => onGripPointerDown(e, sym)}
        ><GripVertical size={12} /></div>
      )}
      
      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          {flag && (
            <Flag 
              size={10} 
              fill="currentColor" 
              strokeWidth={0} 
              style={{ flexShrink: 0, color: flag === "red" ? "#ef5350" : flag === "blue" ? "#2962ff" : flag === "green" ? "#26a69a" : flag === "yellow" ? "#ffeb3b" : "var(--text)" }} 
            />
          )}
          <span className="num" style={{ fontWeight: 700, fontSize: 11 }}>{sym}</span>
          <SessionLedDot symbol={sym} size={5.5} style={{ marginLeft: 2 }} />
          {hasAlert && <span style={{ color: "var(--orange)", fontSize: 9 }} title="Has active alert">●</span>}
        </div>
        {spreadPips != null && (
          <div className="muted wl-row-spread" style={{ fontSize: 9 }}>{spreadPips.toFixed(1)} pips</div>
        )}
      </div>

      {effectivePrice != null && dailyOpen != null ? (
        <div className="num" style={{ textAlign: "right", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
          <div className={effectivePrice > dailyOpen ? "up" : effectivePrice < dailyOpen ? "down" : ""}>
            {effectivePrice > dailyOpen ? "+" : ""}{(((effectivePrice - dailyOpen) / dailyOpen) * 100).toFixed(2)}%
          </div>
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 10 }}>—</div>
      )}

      <button
        className="ghost danger wl-row-remove hide-mobile"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title={`Remove ${sym} from list`}
        style={{ padding: "2px", display: "flex", alignItems: "center", flexShrink: 0 }}
      >
        <X size={12} />
      </button>

      {showPalette && (
        <div 
          className="flag-palette"
          ref={paletteRef}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{display: 'flex', gap: 4, alignItems: 'center'}}>
            <button className="ghost" onClick={(e) => { e.stopPropagation(); onFlag("red"); setShowPalette(false); }} style={{color: "#ef5350", padding: 8}}><Flag size={14} fill="currentColor" strokeWidth={0} /></button>
            <button className="ghost" onClick={(e) => { e.stopPropagation(); onFlag("blue"); setShowPalette(false); }} style={{color: "#2962ff", padding: 8}}><Flag size={14} fill="currentColor" strokeWidth={0} /></button>
            <button className="ghost" onClick={(e) => { e.stopPropagation(); onFlag("green"); setShowPalette(false); }} style={{color: "#26a69a", padding: 8}}><Flag size={14} fill="currentColor" strokeWidth={0} /></button>
            <button className="ghost" onClick={(e) => { e.stopPropagation(); onFlag("yellow"); setShowPalette(false); }} style={{color: "#ffeb3b", padding: 8}}><Flag size={14} fill="currentColor" strokeWidth={0} /></button>
            <button className="ghost" onClick={(e) => { e.stopPropagation(); onFlag(null); setShowPalette(false); }} style={{padding: 8}}><Flag size={14} strokeWidth={2} /></button>
            <div style={{width: 1, height: 16, background: "var(--border)", margin: "0 4px"}}></div>
            {onReorderClick && (
              <button className="ghost" onClick={(e) => { e.stopPropagation(); onReorderClick(); setShowPalette(false); }} style={{padding: 8}} title="Reorder Watchlist"><GripVertical size={14} /></button>
            )}
            <button className="ghost danger" onClick={(e) => { e.stopPropagation(); onRemove(); setShowPalette(false); }} style={{padding: 8}} title="Remove from list"><Trash2 size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

function WatchlistEditModal({ list, symbolFlags, onClose, onAddSymbol, onRemoveSymbol, onDeleteList, onReorder, reorderFn }) {
  const syms = list?.symbols || [];
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const listContainerRef = useRef(null);

  const moveUp = async (idx) => {
    if (idx === 0) return;
    const fromSym = syms[idx];
    const toSym = syms[idx - 1];
    if (reorderFn) await reorderFn(list, fromSym, toSym, onReorder);
  };
  const moveDown = async (idx) => {
    if (idx === syms.length - 1) return;
    const fromSym = syms[idx];
    const toSym = syms[idx + 1];
    if (reorderFn) await reorderFn(list, fromSym, toSym, onReorder);
  };

  const handlePointerDown = (e, index) => {
    e.preventDefault();
    setDragIdx(index);
    setOverIdx(index);

    const onPointerMove = (ev) => {
      const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const rowEls = listContainerRef.current?.querySelectorAll(".modal-symbol-row");
      if (!rowEls) return;
      for (let i = 0; i < rowEls.length; i++) {
        const rect = rowEls[i].getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
          setOverIdx(i);
          break;
        }
      }
    };

    const onPointerUp = async (ev) => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("touchmove", onPointerMove);
      window.removeEventListener("touchend", onPointerUp);

      const clientY = ev.changedTouches ? ev.changedTouches[0].clientY : ev.clientY;
      const rowEls = listContainerRef.current?.querySelectorAll(".modal-symbol-row");
      let targetIdx = null;
      if (rowEls) {
        for (let i = 0; i < rowEls.length; i++) {
          const rect = rowEls[i].getBoundingClientRect();
          if (clientY >= rect.top && clientY <= rect.bottom) {
            targetIdx = i;
            break;
          }
        }
      }
      if (targetIdx != null && targetIdx !== index && syms[index] && syms[targetIdx]) {
        if (reorderFn) await reorderFn(list, syms[index], syms[targetIdx], onReorder);
      }
      setDragIdx(null);
      setOverIdx(null);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("touchmove", onPointerMove, { passive: true });
    window.addEventListener("touchend", onPointerUp);
  };

  const isDefault = list?._id === "main" || list?.isDefault || list?.name?.toLowerCase() === "main";

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.65)", zIndex: 1500,
      display: "flex", flexDirection: "column", justifyContent: "flex-end"
    }} onClick={onClose}>
      <div style={{
        background: "var(--bg)", borderTop: "1px solid var(--border-hi)",
        borderTopLeftRadius: 16, borderTopRightRadius: 16,
        padding: "16px 16px 24px", maxHeight: "85vh", display: "flex", flexDirection: "column"
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Edit Watchlist: {list.name}</div>
            <div className="muted" style={{ fontSize: 11 }}>Hold & drag handle to reorder, or use arrows</div>
          </div>
          <button className="ghost" onClick={onClose} style={{ padding: 6 }}><X size={20} /></button>
        </div>

        <div ref={listContainerRef} style={{ overflowY: "auto", flex: 1, marginBottom: 16, display: "flex", flexDirection: "column", gap: 6, minHeight: 120 }}>
          {syms.map((sym, i) => {
            const flag = symbolFlags?.[sym];
            const isDragging = dragIdx === i;
            const isTarget = overIdx === i && dragIdx !== null && dragIdx !== i;
            return (
              <div
                key={sym}
                className="modal-symbol-row"
                data-idx={i}
                data-sym={sym}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", String(i));
                  setDragIdx(i);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (overIdx !== i) setOverIdx(i);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  if (dragIdx !== null && dragIdx !== i && syms[dragIdx]) {
                    if (reorderFn) await reorderFn(list, syms[dragIdx], sym, onReorder);
                  }
                  setDragIdx(null);
                  setOverIdx(null);
                }}
                onDragEnd={() => {
                  setDragIdx(null);
                  setOverIdx(null);
                }}
                style={{
                  display: "flex", alignItems: "center", padding: "8px 12px", gap: 8,
                  background: isTarget ? "var(--accent-soft)" : "var(--panel)",
                  borderRadius: 8,
                  border: isTarget ? "1px solid var(--accent)" : "1px solid var(--border)",
                  opacity: isDragging ? 0.4 : 1,
                  transition: "background 100ms, border-color 100ms"
                }}
              >
                {/* Drag Handle */}
                <div
                  onPointerDown={(e) => handlePointerDown(e, i)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "grab", touchAction: "none", padding: "4px 6px",
                    color: "var(--muted)", userSelect: "none"
                  }}
                  title="Drag to reorder"
                >
                  <GripVertical size={18} />
                </div>

                {/* Flag Indicator */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 18 }}>
                  {flag ? (
                    <Flag
                      size={14}
                      fill="currentColor"
                      strokeWidth={0}
                      style={{
                        color: flag === "red" ? "#ef5350" : flag === "blue" ? "#2962ff" : flag === "green" ? "#26a69a" : flag === "yellow" ? "#ffeb3b" : "var(--text)"
                      }}
                      title={`Flagged: ${flag}`}
                    />
                  ) : (
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--border)", opacity: 0.4 }} title="Not flagged" />
                  )}
                </div>

                {/* Symbol Name */}
                <div style={{ flex: 1, fontWeight: 700, fontSize: 13, letterSpacing: 0.2 }}>
                  {sym}
                </div>

                {/* Action Buttons: Arrows + Delete */}
                <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                  <button className="ghost" onClick={() => moveUp(i)} disabled={i === 0} style={{ padding: "5px 6px" }} title="Move Up">
                    <ArrowUp size={15} />
                  </button>
                  <button className="ghost" onClick={() => moveDown(i)} disabled={i === syms.length - 1} style={{ padding: "5px 6px" }} title="Move Down">
                    <ArrowDown size={15} />
                  </button>
                  <button className="ghost danger" onClick={() => onRemoveSymbol(list._id, sym)} style={{ padding: "5px 6px", marginLeft: 4 }} title="Remove symbol">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
          {syms.length === 0 && <div className="muted" style={{ textAlign: "center", padding: 28 }}>Watchlist has no symbols yet.</div>}
        </div>
        
        <div style={{ display: "flex", gap: 10 }}>
          {isDefault ? (
            <button
              className="ghost"
              disabled
              title="Default watchlist cannot be deleted"
              style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600, opacity: 0.35, cursor: "not-allowed", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <Trash2 size={16} />
            </button>
          ) : (
            <button
              className="ghost danger"
              onClick={onDeleteList}
              title="Delete this watchlist"
              style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <Trash2 size={16} />
            </button>
          )}
          <button
            className="primary"
            onClick={onAddSymbol}
            style={{ padding: "12px", flex: 1, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 6 }}
          >
            <Plus size={16} /> Add Symbol
          </button>
        </div>
      </div>
    </div>
  );
}

function NameEditor({ value, setValue, onCommit, onCancel, placeholder }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <input
      ref={ref}
      value={value}
      placeholder={placeholder || "Rename…"}
      onChange={(e) => setValue(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); onCommit(); }
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
      style={{ width: 120, fontSize: 11, padding: "3px 7px" }}
    />
  );
}
