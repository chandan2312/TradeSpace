"use client";

import { useState, useEffect, useRef } from "react";
import { X, LayoutGrid, CheckSquare, Square, TrendingUp, TrendingDown, Minus } from "lucide-react";
import ChartPanel from "./ChartPanel";

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
  let list = new Set();
  
  if (CORRELATIONS[symbol]) {
    CORRELATIONS[symbol].forEach(s => list.add(s));
  } else if (symbol.length === 6) {
    const base = symbol.substring(0, 3);
    const quote = symbol.substring(3, 6);
    if (CORRELATIONS[base]) CORRELATIONS[base].forEach(s => list.add(s));
    if (CORRELATIONS[quote]) CORRELATIONS[quote].forEach(s => list.add(s));
  }
  
  list.delete(symbol); // Remove self
  return Array.from(list).slice(0, 10); // Return up to 10
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
        color: isBull ? "var(--up)" : isBear ? "var(--down)" : "var(--muted)" 
      }}>
        Score: {score > 0 ? "+" : ""}{score}
      </div>
      {isBull ? <TrendingUp size={14} color="var(--up)" /> : 
       isBear ? <TrendingDown size={14} color="var(--down)" /> : 
       <Minus size={14} color="var(--muted)" />}
      <div style={{ fontSize: 11, color: "var(--muted)" }}>
        ({data.phase || "Range"})
      </div>
    </div>
  );
}

export default function CorrelatedPairsModal({ symbol, indicators, onClose }) {
  const [step, setStep] = useState(1); // 1: Select Pairs, 2: View Charts
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [tf, setTf] = useState("M15");
  const barsCache = useRef(new Map());

  useEffect(() => {
    const c = guessCorrelations(symbol);
    setCandidates(c);
    setSelected(new Set(c.slice(0, 4))); // pre-select up to 4
  }, [symbol]);

  const toggle = (sym) => {
    const next = new Set(selected);
    if (next.has(sym)) next.delete(sym);
    else next.add(sym);
    setSelected(next);
  };

  const selectedArr = Array.from(selected);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px"
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: step === 1 ? "400px" : "95vw",
          height: step === 1 ? "auto" : "90vh",
          background: "var(--panel)", border: "1px solid var(--border-hi)",
          borderRadius: 12, display: "flex", flexDirection: "column",
          overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.8)"
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <LayoutGrid size={18} color="var(--accent)" />
            <span style={{ fontWeight: 600, fontSize: 14 }}>Correlated Pairs: {symbol}</span>
          </div>
          <button className="ghost" onClick={onClose}><X size={18} /></button>
        </div>

        {step === 1 && (
          <div style={{ padding: 16 }}>
            <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
              Select which correlated symbols you want to analyze alongside {symbol}.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "50vh", overflowY: "auto" }}>
              {candidates.map(c => (
                <div 
                  key={c}
                  onClick={() => toggle(c)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px",
                    background: selected.has(c) ? "var(--accent-soft)" : "var(--bg)",
                    border: `1px solid ${selected.has(c) ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 6, cursor: "pointer"
                  }}
                >
                  {selected.has(c) ? <CheckSquare size={16} color="var(--accent)" /> : <Square size={16} color="var(--muted)" />}
                  <span className="num">{c}</span>
                </div>
              ))}
              {candidates.length === 0 && (
                <div className="muted" style={{ padding: 20, textAlign: "center" }}>No predefined correlations found.</div>
              )}
            </div>

            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
              <button 
                className="btn primary" 
                disabled={selected.size === 0}
                onClick={() => setStep(2)}
              >
                View {selected.size} Charts
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ padding: "8px 16px", background: "var(--bg)", borderBottom: "1px solid var(--border)", display: "flex", gap: 8 }}>
              <button className="ghost" onClick={() => setStep(1)} style={{ fontSize: 12 }}>← Back to Selection</button>
              <div style={{ flex: 1 }} />
              {["M5", "M15", "H1", "H4"].map(t => (
                <button 
                  key={t}
                  className={`ghost ${tf === t ? "active" : ""}`}
                  style={{ color: tf === t ? "var(--accent)" : "inherit" }}
                  onClick={() => setTf(t)}
                >
                  {t}
                </button>
              ))}
            </div>

            <div style={{
              flex: 1, overflowY: "auto", padding: 12,
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
              gap: 12, alignContent: "start"
            }}>
              {selectedArr.map(sym => (
                <div key={sym} style={{ 
                  height: 350, border: "1px solid var(--border)", borderRadius: 8, 
                  display: "flex", flexDirection: "column", overflow: "hidden" 
                }}>
                  <div style={{ 
                    padding: "6px 10px", background: "var(--panel)", 
                    borderBottom: "1px solid var(--border)", 
                    display: "flex", justifyContent: "space-between", alignItems: "center" 
                  }}>
                    <span className="num" style={{ fontWeight: 600 }}>{sym}</span>
                    <MiniBiasScore symbol={sym} tf={tf} />
                  </div>
                  <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column" }}>
                    <ChartPanel 
                      symbol={sym} 
                      tf={tf} 
                      isActive={true} 
                      alerts={[]} 
                      setAlerts={() => {}} 
                      indicators={indicators || {}}
                      tick={null}
                      barsCache={barsCache}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
