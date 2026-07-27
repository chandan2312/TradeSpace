"use client";

import { useState, useEffect, useRef } from "react";
import { X, LayoutGrid, CheckSquare, Square, TrendingUp, TrendingDown, Minus, Maximize2, Minimize2, ArrowLeft } from "lucide-react";
import ChartPanel from "./ChartPanel";
import { LAYOUT_CONFIG, LayoutIcon } from "../lib/layouts";

// Hardcoded correlation map for major pairs & indices
const CORRELATIONS = {
  // Forex Base
  GBP: ["GBPUSD", "GBPJPY", "GBPAUD", "GBPCAD", "GBPCHF", "GBPNZD", "EURGBP"],
  EUR: ["EURUSD", "EURJPY", "EURGBP", "EURAUD", "EURCAD", "EURCHF", "EURNZD"],
  USD: ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD"],
  JPY: ["USDJPY", "GBPJPY", "EURJPY", "AUDJPY", "CADJPY", "CHFJPY", "NZDJPY"],
  AUD: ["AUDUSD", "AUDJPY", "EURAUD", "GBPAUD", "AUDCAD", "AUDCHF", "AUDNZD"],
  CAD: ["USDCAD", "CADJPY", "EURCAD", "GBPCAD", "AUDCAD", "NZDCAD", "CADCHF"],
  CHF: ["USDCHF", "CHFJPY", "EURCHF", "GBPCHF", "AUDCHF", "NZDCHF", "CADCHF"],
  // Indices
  US30: ["NAS100", "SPX500", "GER40", "UK100", "US30", "DJ30"],
  DJ30: ["NAS100", "SPX500", "GER40", "UK100", "US30", "DJ30"],
  NAS100: ["US30", "SPX500", "GER40", "UK100", "NAS100", "US100"],
  US100: ["US30", "SPX500", "GER40", "UK100", "NAS100", "US100"],
  SPX500: ["US30", "NAS100", "GER40", "UK100", "SPX500", "US500"],
  US500: ["US30", "NAS100", "GER40", "UK100", "SPX500", "US500"],
  GER40: ["UK100", "FRA40", "EUSTX50", "US30", "NAS100", "SPX500"],
  UK100: ["GER40", "FRA40", "EUSTX50", "US30", "NAS100", "SPX500"],
  // Crypto
  BTCUSD: ["ETHUSD", "SOLUSD", "XRPUSD", "ADAUSD", "LTCUSD", "DOGEUSD"],
  ETHUSD: ["BTCUSD", "SOLUSD", "XRPUSD", "ADAUSD", "LTCUSD", "DOGEUSD"],
  SOLUSD: ["BTCUSD", "ETHUSD", "XRPUSD", "ADAUSD", "LTCUSD", "DOGEUSD"],
  // Metals & Energies
  XAUUSD: ["XAGUSD", "USDJPY", "EURUSD", "USOIL", "UKOIL", "XPTUSD"],
  XAGUSD: ["XAUUSD", "USDJPY", "EURUSD", "USOIL", "UKOIL", "XPTUSD"],
  USOIL: ["UKOIL", "XAUUSD", "USDCAD", "CADJPY"],
  UKOIL: ["USOIL", "XAUUSD", "USDCAD", "CADJPY"],
};

function guessCorrelations(symbol) {
  let groups = [];
  
  if (CORRELATIONS[symbol]) {
    const list = CORRELATIONS[symbol].filter(s => s !== symbol).slice(0, 10);
    groups.push({ title: "Correlated Assets", symbols: list });
  } else if (symbol.length === 6) {
    const base = symbol.substring(0, 3);
    const quote = symbol.substring(3, 6);
    
    if (CORRELATIONS[base]) {
      const list = CORRELATIONS[base].filter(s => s !== symbol).slice(0, 8);
      if (list.length > 0) groups.push({ title: `Base Currency (${base})`, symbols: list });
    }
    if (CORRELATIONS[quote]) {
      const list = CORRELATIONS[quote].filter(s => s !== symbol).slice(0, 8);
      if (list.length > 0) groups.push({ title: `Quote Currency (${quote})`, symbols: list });
    }
  }
  
  return groups;
}

function MiniBiasScore({ symbol, tf }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(`/api/bias?symbols=${symbol}&tf=${tf}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.symbols && d.symbols.length > 0) {
          setData(d.symbols[0]);
        }
      })
      .catch(() => {});
  }, [symbol, tf]);

  if (!data) return <div className="muted" style={{ fontSize: 11 }}>Loading Bias...</div>;

  const score = data.score || 0;
  const isBull = score > 15;
  const isBear = score < -15;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ 
        fontSize: 12, fontWeight: 700, 
        color: isBull ? "var(--green)" : isBear ? "var(--red)" : "var(--muted)" 
      }}>
        Score: {score > 0 ? "+" : ""}{score}
      </div>
      {isBull ? <TrendingUp size={14} color="var(--green)" /> : 
       isBear ? <TrendingDown size={14} color="var(--red)" /> : 
       <Minus size={14} color="var(--muted)" />}
      <div style={{ fontSize: 11, color: "var(--muted)" }}>
        ({data.phase || "Range"})
      </div>
    </div>
  );
}

export default function CorrelatedPairsModal({ 
  symbol, indicators, onClose,
  alerts = [],
  onAddAlert, onAddAlertLayer, onDeleteAlert, onDeleteAlertsBySymbol,
  onMoveAlert, onRearmAlert, onRateAlert, onCreateChainAlert, onJoinChainAlert
}) {
  const [step, setStep] = useState(1); // 1: Select Pairs, 2: View Charts
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [tf, setTf] = useState("M15");
  const [fullScreenSym, setFullScreenSym] = useState(null);
  const [selectedLayout, setSelectedLayout] = useState(null);
  const [syncOpts, setSyncOpts] = useState({ symbol: false, tf: false, time: false, crosshair: false });
  const [syncedLogicalRange, setSyncedLogicalRange] = useState(null);
  const [syncedCrosshair, setSyncedCrosshair] = useState(null);
  
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const barsCache = useRef(new Map());

  useEffect(() => {
    const groups = guessCorrelations(symbol);
    setCandidates(groups);
    const initialSelect = groups.flatMap(g => g.symbols).slice(0, 4);
    setSelected(new Set(initialSelect)); // pre-select up to 4
  }, [symbol]);

  const toggle = (sym) => {
    const next = new Set(selected);
    if (next.has(sym)) next.delete(sym);
    else next.add(sym);
    setSelected(next);
  };

  const selectedArr = Array.from(selected);
  const displaySymbols = fullScreenSym ? [fullScreenSym] : selectedArr;

  const targetCount = Math.min(selectedArr.length, 8);
  const normalizedTargetCount = targetCount === 7 ? 8 : targetCount;
  const availableLayouts = Object.keys(LAYOUT_CONFIG).filter(k => LAYOUT_CONFIG[k].count === normalizedTargetCount);
  const activeLayoutId = selectedLayout && LAYOUT_CONFIG[selectedLayout]?.count === normalizedTargetCount 
    ? selectedLayout 
    : (availableLayouts[0] || "4");

  const cfg = fullScreenSym ? LAYOUT_CONFIG["1"] : (LAYOUT_CONFIG[activeLayoutId] || LAYOUT_CONFIG["4"]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "var(--bg)",
        display: "flex", flexDirection: "column",
        overflow: "hidden"
      }}
    >
      {/* Top Header Bar */}
      <div style={{
        padding: "8px 16px", background: "var(--panel)", borderBottom: "1px solid var(--border)",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {step === 2 && (
            <button className="ghost" onClick={() => { setStep(1); setFullScreenSym(null); }} title="Back to Selection" style={{ padding: "4px 8px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <ArrowLeft size={16} /> <span className="hide-mobile">Selection</span>
            </button>
          )}
          <LayoutGrid size={18} color="var(--accent)" />
          <span style={{ fontWeight: 600, fontSize: 14 }}>Correlated Pairs: {symbol}</span>
        </div>

        {step === 2 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {["M5", "M15", "H1", "H4"].map(t => (
              <button 
                key={t}
                className={tf === t ? "primary" : "ghost"}
                style={{ fontSize: 12, padding: "3px 8px" }}
                onClick={() => setTf(t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        <button className="ghost" onClick={onClose} title="Close"><X size={18} /></button>
      </div>

      {step === 1 && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{
            width: "100%", maxWidth: 560, background: "var(--panel)", border: "1px solid var(--border)",
            borderRadius: 12, padding: 20, boxShadow: "0 12px 36px rgba(0,0,0,0.5)",
            maxHeight: "90vh", overflowY: "auto"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Select Correlated Assets</h3>
              {/* Global select/unselect only for non-FX (single group) */}
              {candidates.length <= 1 && (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button
                    className="ghost"
                    onClick={() => setSelected(new Set(candidates.flatMap(g => g.symbols)))}
                    title="Select All"
                    style={{ padding: "4px 8px", display: "flex", alignItems: "center", gap: 4, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6 }}
                  >
                    <CheckSquare size={15} color="var(--accent)" />
                  </button>
                  <button
                    className="ghost"
                    onClick={() => setSelected(new Set())}
                    title="Unselect All"
                    style={{ padding: "4px 8px", display: "flex", alignItems: "center", gap: 4, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6 }}
                  >
                    <Square size={15} color="var(--muted)" />
                  </button>
                </div>
              )}
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
              Select assets and choose layout & synchronization options for side-by-side analysis of {symbol}.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "40vh", overflowY: "auto", paddingRight: 4 }}>
              {candidates.map((g, idx) => (
                <div key={idx}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {g.title}
                    </div>
                    {/* Per-group select/unselect for FX pairs (multiple groups) */}
                    {candidates.length > 1 && (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          className="ghost"
                          onClick={() => setSelected(prev => new Set([...prev, ...g.symbols]))}
                          title={`Select all ${g.title}`}
                          style={{ padding: "2px 6px", display: "flex", alignItems: "center", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4 }}
                        >
                          <CheckSquare size={13} color="var(--accent)" />
                        </button>
                        <button
                          className="ghost"
                          onClick={() => setSelected(prev => {
                            const next = new Set(prev);
                            g.symbols.forEach(s => next.delete(s));
                            return next;
                          })}
                          title={`Unselect all ${g.title}`}
                          style={{ padding: "2px 6px", display: "flex", alignItems: "center", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4 }}
                        >
                          <Square size={13} color="var(--muted)" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 6 }}>
                    {g.symbols.map(c => (
                      <div 
                        key={c}
                        onClick={() => toggle(c)}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, padding: "7px 9px",
                          background: selected.has(c) ? "var(--accent-soft)" : "var(--bg)",
                          border: `1px solid ${selected.has(c) ? "var(--accent)" : "var(--border)"}`,
                          borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600
                        }}
                      >
                        {selected.has(c) ? <CheckSquare size={15} color="var(--accent)" /> : <Square size={15} color="var(--muted)" />}
                        <span className="num">{c}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {selectedArr.length > 0 && availableLayouts.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                  Choose Layout Style ({selectedArr.length} Symbols)
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {availableLayouts.map(lId => (
                    <LayoutIcon 
                      key={lId} 
                      layoutId={lId} 
                      isActive={activeLayoutId === lId} 
                      onClick={() => setSelectedLayout(lId)} 
                    />
                  ))}
                </div>
              </div>
            )}

            {selectedArr.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                  Sync Options
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  {[
                    { id: "crosshair", label: "Crosshair" },
                    { id: "time", label: "Time Range" },
                    { id: "tf", label: "Timeframe" },
                    { id: "symbol", label: "Symbol" }
                  ].map(opt => (
                    <label key={opt.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", userSelect: "none" }}>
                      <input 
                        type="checkbox" 
                        checked={syncOpts[opt.id]} 
                        onChange={(e) => setSyncOpts(p => ({ ...p, [opt.id]: e.target.checked }))} 
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
              <button 
                className="primary" 
                disabled={selected.size === 0}
                onClick={() => setStep(2)}
                style={{ padding: "8px 20px", fontSize: 13, fontWeight: 600 }}
              >
                View {selected.size} Charts →
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: 8, overflow: "hidden" }}>
          {fullScreenSym && (
            <div style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <button className="ghost" onClick={() => setFullScreenSym(null)} style={{ fontSize: 12, padding: "4px 8px", display: "flex", alignItems: "center", gap: 6, color: "var(--accent)" }}>
                <Minimize2 size={14} /> Exit Fullscreen ({fullScreenSym})
              </button>
            </div>
          )}

          <div style={{
            flex: 1, minHeight: 0,
            display: "grid",
            gridTemplateColumns: (fullScreenSym || isMobile) ? "1fr" : `repeat(${cfg.cols}, 1fr)`,
            gridTemplateRows: fullScreenSym ? "1fr" : (isMobile ? "auto" : `repeat(${cfg.rows}, 1fr)`),
            gridAutoRows: (isMobile && !fullScreenSym) ? "350px" : undefined,
            gap: 8, overflowY: fullScreenSym ? "hidden" : "auto", overflowX: "hidden"
          }}>
            {displaySymbols.map((sym, idx) => {
              const spanStyle = (!fullScreenSym && !isMobile && cfg.spans && cfg.spans[idx]) ? {
                gridColumn: `${cfg.spans[idx][0]} / ${cfg.spans[idx][2]}`,
                gridRow: `${cfg.spans[idx][1]} / ${cfg.spans[idx][3]}`
              } : {};

              return (
                <div 
                  key={sym}
                  onDoubleClick={() => setFullScreenSym(fullScreenSym === sym ? null : sym)}
                  title="Double click to toggle fullscreen"
                  style={{ 
                    border: "1px solid var(--border)", borderRadius: 8, 
                    display: "flex", flexDirection: "column", overflow: "hidden",
                    background: "var(--panel)", height: "100%", minHeight: 0,
                    ...spanStyle
                  }}
                >
                  <div style={{ 
                    padding: "6px 10px", background: "var(--bg)", 
                    borderBottom: "1px solid var(--border)", 
                    display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="num" style={{ fontWeight: 700, fontSize: 13 }}>{sym}</span>
                      <MiniBiasScore symbol={sym} tf={tf} />
                    </div>

                    <button 
                      className="ghost" 
                      onClick={(e) => { e.stopPropagation(); setFullScreenSym(fullScreenSym === sym ? null : sym); }} 
                      title={fullScreenSym === sym ? "Exit Fullscreen" : "Fullscreen"}
                      style={{ padding: "3px 6px", display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}
                    >
                      {fullScreenSym === sym ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                      <span style={{ fontSize: 11 }}>{fullScreenSym === sym ? "Exit" : "Full"}</span>
                    </button>
                  </div>
                  <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", minHeight: 0 }}>
                    <ChartPanel 
                      symbol={sym} 
                      tf={tf} 
                      isActive={true} 
                      alerts={alerts.filter(a => a.symbol === sym && (a.status === "active" || a.status === "triggered" || a.status === "pending_chain"))}
                      setAlerts={() => {}} 
                      indicators={indicators || {}}
                      tick={null}
                      barsCache={barsCache}
                      paneId={sym}
                      onAddAlert={(price) => onAddAlert?.(sym, price)}
                      onAddAlertLayer={onAddAlertLayer}
                      onDeleteAlert={onDeleteAlert}
                      onDeleteAlertsBySymbol={onDeleteAlertsBySymbol}
                      onMoveAlert={onMoveAlert}
                      onRearmAlert={onRearmAlert}
                      onRateAlert={onRateAlert}
                      onCreateChainAlert={onCreateChainAlert}
                      onJoinChainAlert={onJoinChainAlert}
                      syncOpts={syncOpts}
                      syncedLogicalRange={syncedLogicalRange}
                      setSyncedLogicalRange={setSyncedLogicalRange}
                      syncedCrosshair={syncedCrosshair}
                      setSyncedCrosshair={setSyncedCrosshair}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
