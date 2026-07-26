"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2, Plus, GripVertical, Flag, X, ArrowUp, ArrowDown, Settings2, LayoutGrid, Zap, ChevronDown } from "lucide-react";
import { LAYOUT_CONFIG, LayoutIcon } from "../lib/layouts";

// Right-sidebar watchlist with multiple named lists (tabs), create/rename/delete,
// live bid/spread per symbol, click-to-switch, and drag-to-reorder rows.
export default function Watchlist({
  watchlists, activeListId, setActiveListId,
  symbol, setSymbol, ticks, alerts,
  onCreate, onRename, onDelete, onAddSymbol, onRemoveSymbol,
  symbolFlags, setSymbolFlags, onNavUp, onNavDown, onGridify,
  onDoubleJump, biasData, onSelectAutoList
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
    { _id: "cat-idx", name: "📊 Indices", symbols: ["US30", "SPX500", "NAS100", "GER40", "UK100", "JPN225", "AUS200"], isVirtual: true, type: "auto" },
    { _id: "cat-mtl", name: "🥇 Metals & Energy", symbols: ["XAUUSD", "XAGUSD", "USOIL", "UKOIL"], isVirtual: true, type: "auto" },
    { _id: "cat-cry", name: "₿ Crypto", symbols: ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD"], isVirtual: true, type: "auto" }
  );

  const allWatchlists = [...watchlists, ...virtualWatchlists];
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
  
  const baseMainLists = allWatchlists.filter(w => w.type !== "auto" || (isMobile && w._id.includes("star")));
  const autoLists = allWatchlists.filter(w => w.type === "auto" && !(isMobile && w._id.includes("star")));
  const activeAutoList = autoLists.find(w => w._id === activeListId);

  const mainLists = [
    ...baseMainLists,
    ...(activeAutoList && !baseMainLists.some(w => w._id === activeAutoList._id) ? [activeAutoList] : [])
  ];

  const list = allWatchlists.find((w) => w._id === activeListId) || null;
  const [editing, setEditing] = useState(null); // list id being renamed, or "new"
  const [name, setName] = useState("");
  const [drag, setDrag] = useState(null); // symbol being dragged
  const [over, setOver] = useState(null); // symbol currently hovered
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [gridifyOpen, setGridifyOpen] = useState(false);
  const [autoMenuOpen, setAutoMenuOpen] = useState(false);
  const [gridifySelection, setGridifySelection] = useState([]);
  const [gridifyFlags, setGridifyFlags] = useState([]);
  const [selectedGridifyLayout, setSelectedGridifyLayout] = useState(null);
  const [gridifySync, setGridifySync] = useState({ symbol: false, tf: true, time: true, crosshair: true });

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

  const [dailyOpens, setDailyOpens] = useState({});
  useEffect(() => {
    const syms = list?.symbols || [];
    syms.forEach((sym) => {
      if (dailyOpens[sym] || dailyOpens[sym] === "loading") return;
      setDailyOpens((prev) => ({ ...prev, [sym]: "loading" }));
      fetch(`/api/rates?symbol=${sym}&tf=D1&count=1`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && data.bars?.length > 0) {
            setDailyOpens((prev) => ({ ...prev, [sym]: data.bars[0].o }));
          } else {
            setDailyOpens((prev) => ({ ...prev, [sym]: null }));
          }
        })
        .catch(() => setDailyOpens((prev) => ({ ...prev, [sym]: null })));
    });
  }, [list?.symbols]);

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
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, width: "100%" }}>
      {/* Tabs row */}
      {/* Tabs and mobile action buttons row */}
      <div style={{
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
                className={w._id === activeListId && !w.isVirtual ? "primary" : "ghost"}
                title={w.isVirtual ? `${w.name} (${(w.symbols || []).length})` : `${w.name} (${(w.symbols || []).length}) — double-click to rename`}
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
                    background: w._id === activeListId ? (w.style?.background || "rgba(41, 98, 255, 0.2)") : "transparent",
                    color: w._id === activeListId ? (w.style?.color || "var(--accent)") : "var(--muted)",
                    border: w._id === activeListId ? `1px solid ${w.style?.color || "var(--accent)"}` : "1px solid transparent",
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
                    ...(typeof window !== "undefined" && window.innerWidth <= 768
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
      <div className="wl-rows">
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

        {list && (list.symbols || []).map((sym, i) => (
          <WatchRow
            key={sym + i}
            sym={sym}
            tick={ticks[sym]}
            dailyOpen={typeof dailyOpens[sym] === "number" ? dailyOpens[sym] : null}
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
            onDragStart={!list.isVirtual ? () => setDrag(sym) : undefined}
            onDragOver={(e) => { e.preventDefault(); setOver(sym); }}
            onDragLeave={() => setOver((o) => (o === sym ? null : o))}
            onDrop={() => {
              if (drag && drag !== sym) reorder(list, drag, sym);
              setDrag(null); setOver(null);
            }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            flag={symbolFlags?.[sym]}
            onFlag={(color) => setSymbolFlags(p => {
              const next = { ...p };
              if (color) next[sym] = color;
              else delete next[sym];
              return next;
            })}
          />
        ))}
      </div>

      {editModalOpen && list && (
        <WatchlistEditModal 
          list={list} 
          onClose={() => setEditModalOpen(false)} 
          onAddSymbol={onAddSymbol} 
          onRemoveSymbol={onRemoveSymbol} 
          onDeleteList={() => {
            if (confirm(`Delete list “${list.name}”?`)) {
              onDelete(list._id);
              setEditModalOpen(false);
            }
          }}
        />
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
                     onGridify(gridifySelection, layoutToUse, gridifySync);
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
async function reorder(list, fromSym, toSym) {
  const syms = [...(list.symbols || [])];
  const from = syms.indexOf(fromSym);
  const to = syms.indexOf(toSym);
  if (from < 0 || to < 0 || from === to) return;
  syms.splice(from, 1);
  syms.splice(to, 0, fromSym);
  try {
    await fetch(`/api/watchlists/${list._id}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: syms }),
    });
  } catch { /* optimistic UI will self-heal on next WS broadcast */ }
}

function WatchRow({
  sym, tick, dailyOpen, current, hasAlert, onJump, onDoubleClick, onRemove,
  dragging, dropTarget, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
  flag, onFlag
}) {
  const [showPalette, setShowPalette] = useState(false);
  const paletteRef = useRef(null);
  const rowRef = useRef(null);
  const [isDraggable, setIsDraggable] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined' && (('ontouchstart' in window) || (navigator.maxTouchPoints > 0))) {
      setIsDraggable(false);
    }
  }, []);

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
  let bgColor = "var(--bg)"; // Darker background to make rows/pills stand out more
  if (dropTarget) {
    bgColor = "var(--accent-soft)";
  } else if (current) {
    if (flag === "red") bgColor = "rgba(239, 83, 80, 0.15)";
    else if (flag === "blue") bgColor = "rgba(41, 98, 255, 0.15)";
    else if (flag === "green") bgColor = "rgba(38, 166, 154, 0.15)";
    else if (flag === "yellow") bgColor = "rgba(255, 235, 59, 0.15)";
    else bgColor = "rgba(41,98,255,.08)";
  } else if (flag) {
    if (flag === "red") bgColor = "rgba(239, 83, 80, 0.06)";
    else if (flag === "blue") bgColor = "rgba(41, 98, 255, 0.06)";
    else if (flag === "green") bgColor = "rgba(38, 166, 154, 0.06)";
    else if (flag === "yellow") bgColor = "rgba(255, 235, 59, 0.06)";
  }

  return (
    <div
      ref={rowRef}
      className="wl-row-item"
      draggable={isDraggable}
      onDragStart={isDraggable ? onDragStart : undefined}
      onDragOver={isDraggable ? onDragOver : undefined}
      onDragLeave={isDraggable ? onDragLeave : undefined}
      onDrop={isDraggable ? onDrop : undefined}
      onDragEnd={isDraggable ? onDragEnd : undefined}
      onClick={onJump}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setShowPalette(true); }}
      title={current ? "Current chart" : `Switch to ${sym}`}
      style={{
        background: bgColor,
        opacity: dragging ? 0.4 : 1,
        borderLeft: current ? "2px solid var(--accent)" : "2px solid transparent",
      }}
    >
      <div className="wl-row-drag muted hide-mobile" style={{ display: "flex", alignItems: "center", cursor: "grab", userSelect: "none", opacity: 0.5 }} title="Drag to reorder"><GripVertical size={12} /></div>
      
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
          {hasAlert && <span style={{ color: "var(--orange)", fontSize: 9 }} title="Has active alert">●</span>}
        </div>
        {spreadPips != null && (
          <div className="muted wl-row-spread" style={{ fontSize: 9 }}>{spreadPips.toFixed(1)} pips</div>
        )}
      </div>

      {bid != null && dailyOpen != null ? (
        <div className="num" style={{ textAlign: "right", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
          <div className={bid > dailyOpen ? "up" : bid < dailyOpen ? "down" : ""}>
            {bid > dailyOpen ? "+" : ""}{(((bid - dailyOpen) / dailyOpen) * 100).toFixed(2)}%
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
            <button className="ghost danger" onClick={(e) => { e.stopPropagation(); onRemove(); setShowPalette(false); }} style={{padding: 8}}><Trash2 size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

function WatchlistEditModal({ list, onClose, onAddSymbol, onRemoveSymbol, onDeleteList }) {
  const syms = list?.symbols || [];

  const moveUp = async (idx) => {
    if (idx === 0) return;
    const fromSym = syms[idx];
    const toSym = syms[idx - 1];
    await reorder(list, fromSym, toSym);
  };
  const moveDown = async (idx) => {
    if (idx === syms.length - 1) return;
    const fromSym = syms[idx];
    const toSym = syms[idx + 1];
    await reorder(list, fromSym, toSym);
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.6)", zIndex: 1500,
      display: "flex", flexDirection: "column", justifyContent: "flex-end"
    }}>
      <div style={{
        background: "var(--bg)", borderTop: "1px solid var(--border)",
        borderTopLeftRadius: 16, borderTopRightRadius: 16,
        padding: 16, maxHeight: "80vh", display: "flex", flexDirection: "column"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Edit: {list.name}</div>
          <button className="ghost" onClick={onClose} style={{ padding: 4 }}><X size={20} /></button>
        </div>

        <div style={{ overflowY: "auto", flex: 1, marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {syms.map((sym, i) => (
            <div key={sym} style={{
              display: "flex", alignItems: "center", padding: "8px 12px",
              background: "var(--panel)", borderRadius: 8, border: "1px solid var(--border)"
            }}>
              <div style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{sym}</div>
              <div style={{ display: "flex", gap: 4 }}>
                <button className="ghost" onClick={() => moveUp(i)} disabled={i === 0} style={{ padding: 6 }}><ArrowUp size={16} /></button>
                <button className="ghost" onClick={() => moveDown(i)} disabled={i === syms.length - 1} style={{ padding: 6 }}><ArrowDown size={16} /></button>
                <button className="ghost danger" onClick={() => onRemoveSymbol(list._id, sym)} style={{ padding: 6, marginLeft: 8 }}><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
          {syms.length === 0 && <div className="muted" style={{ textAlign: "center", padding: 20 }}>List is empty.</div>}
        </div>
        
        <div style={{ display: "flex", gap: 8 }}>
          <button className="ghost danger" onClick={onDeleteList} style={{ padding: "12px", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Trash2 size={18} />
          </button>
          <button className="primary" onClick={onAddSymbol} style={{ padding: "12px", flex: 1, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Plus size={18} /> Add Symbol
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
