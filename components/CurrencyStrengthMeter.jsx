"use client";

import { useState, useEffect } from "react";
import { Activity, TrendingUp, TrendingDown, Minus, Zap, Sparkles, Target, Compass, Shield } from "lucide-react";

export default function CurrencyStrengthMeter({ onSelectSuggested, allowedSymbols = [] }) {
  const [data, setData] = useState(null);
  const [symbolsMap, setSymbolsMap] = useState({});
  const [hoveredCcy, setHoveredCcy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/bias?symbols=ALL`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.currencyStrength) {
          const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD"];
          const finalCurrencies = {};
          
          // Determine scale max (40 represents a powerful macro-bias edge)
          const CAP = 40; 
          let absMax = 1;
          d.currencyStrength.forEach((c) => {
            const capped = Math.max(-CAP, Math.min(CAP, c.score));
            if (Math.abs(capped) > absMax) absMax = Math.abs(capped);
          });
          absMax = Math.max(15, absMax);

          CURRENCIES.forEach((cName) => {
            const cData = d.currencyStrength.find((c) => c.ccy === cName);
            const raw = cData ? cData.score : 0;
            const capped = Math.max(-CAP, Math.min(CAP, raw));
            
            let n = capped / absMax;
            n = Math.max(-1, Math.min(1, n));
            
            finalCurrencies[cName] = {
              name: cName,
              score: parseFloat(n.toFixed(2)),
              rawScore: raw,
              conviction: cData?.conviction ?? 60,
              stability: cData?.stability ?? 60,
              agreement: cData?.agreement ?? 60,
              orderFlowState: cData?.orderFlowState || "EQUILIBRIUM_CHOP",
              status: cData?.status || "Neutral Equilibrium",
              dominantDrivers: cData?.dominantDrivers || [],
              pairsCount: cData?.pairsCount || 0,
              at: d.at,
            };
          });

          // Store evaluated symbols map for smart pair cross-referencing
          const sMap = {};
          if (Array.isArray(d.symbols)) {
            d.symbols.forEach((s) => {
              if (s && s.symbol) sMap[s.symbol] = s;
            });
          }
          setSymbolsMap(sMap);

          // Convert to array and sort descending by score
          const sorted = Object.values(finalCurrencies).sort((a, b) => b.score - a.score);
          setData(sorted);
        } else {
          setError(d.error || "Failed to load structural data");
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  if (loading && !data) {
    return (
      <div style={{ padding: 16, display: "flex", justifyContent: "center", alignItems: "center", height: 200, background: "var(--panel)", borderRadius: 12, border: "1px solid var(--border)" }}>
        <div className="skeleton-pulse" style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>Analyzing Structural Orderflow & Conviction...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: 16, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", height: 200, background: "var(--panel)", borderRadius: 12, border: "1px solid var(--border)", color: "var(--red)" }}>
        <Activity size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
        <div style={{ fontSize: 12, fontWeight: 600 }}>Engine Offline</div>
        <div style={{ fontSize: 10, opacity: 0.8, marginTop: 4 }}>{error || "Could not reach MT5 server"}</div>
      </div>
    );
  }

  const currencies = data;

  return (
    <div style={{ 
      background: "var(--panel)", border: "1px solid var(--border)", 
      borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 16 
    }}>
      {/* Top Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14 }}>
          <Activity size={16} color="var(--accent)" />
          <span>Structural Currency Strength</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9.5, fontWeight: 800, color: "var(--green)", background: "rgba(34, 197, 94, 0.12)", border: "1px solid rgba(34, 197, 94, 0.25)", padding: "2px 7px", borderRadius: 4, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Zap size={10} /> CONVICTION-WEIGHTED
          </span>
          <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--accent)", background: "rgba(56, 189, 248, 0.12)", border: "1px solid rgba(56, 189, 248, 0.25)", padding: "2px 6px", borderRadius: 4 }}>
            BIAS BRAIN
          </span>
        </div>
      </div>

      {/* Symmetric Currency Strength Bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "0 60px 0 74px", fontSize: 9.5, textTransform: "uppercase", fontWeight: 700, color: "var(--muted)", letterSpacing: 1 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <TrendingDown size={11} style={{ color: "var(--red)" }} />
            <span>Institutional Weakness</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span>Institutional Strength</span>
            <TrendingUp size={11} style={{ color: "var(--green)" }} />
          </span>
        </div>
        
        {currencies.map((c) => {
          const isStrong = c.score > 0.15;
          const isWeak = c.score < -0.15;
          const isHovered = hoveredCcy === c.name;
          
          // Calculate width percentage relative to the half-bar
          const deviation = Math.abs(c.score);
          const widthPct = Math.min(100, deviation * 100);
          
          return (
            <div
              key={c.name}
              style={{ position: "relative" }}
              onMouseEnter={() => setHoveredCcy(c.name)}
              onMouseLeave={() => setHoveredCcy(null)}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "4px 6px",
                  borderRadius: 6,
                  background: isHovered ? "rgba(255, 255, 255, 0.04)" : "transparent",
                  transition: "background 0.15s ease",
                  cursor: "help",
                }}
              >
                {/* Currency Symbol & Conviction Badge */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, width: 68 }}>
                  <span style={{ 
                    fontSize: 13, fontWeight: 800, fontFamily: "monospace",
                    color: isStrong ? "var(--green)" : isWeak ? "var(--red)" : "var(--text)" 
                  }}>
                    {c.name}
                  </span>
                  <span style={{
                    fontSize: 9,
                    fontFamily: "monospace",
                    fontWeight: 700,
                    padding: "1px 4px",
                    borderRadius: 3,
                    background: c.conviction >= 75 ? "rgba(34, 197, 94, 0.15)" : "rgba(255, 255, 255, 0.06)",
                    color: c.conviction >= 75 ? "var(--green)" : "var(--muted)",
                    border: `1px solid ${c.conviction >= 75 ? "rgba(34, 197, 94, 0.3)" : "var(--border)"}`,
                  }}>
                    {c.conviction}%
                  </span>
                </div>
                
                {/* 2-Sided Strength Bar */}
                <div style={{ 
                  flex: 1, display: "flex", height: 18, background: "var(--bg)", 
                  borderRadius: 4, overflow: "hidden", position: "relative",
                  border: "1px solid var(--border)"
                }}>
                  {/* Center Divider */}
                  <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, background: "var(--border)", zIndex: 2, transform: "translateX(-50%)" }} />
                  
                  {/* Left Side (Weakness) */}
                  <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", alignItems: "stretch" }}>
                    {c.score < 0 && (
                      <div style={{
                        height: "100%",
                        width: `${widthPct}%`,
                        background: "linear-gradient(90deg, rgba(239,68,68,0.3) 0%, var(--red) 100%)",
                        transition: "width 0.4s ease-out"
                      }} />
                    )}
                  </div>
                  
                  {/* Right Side (Strength) */}
                  <div style={{ flex: 1, display: "flex", justifyContent: "flex-start", alignItems: "stretch" }}>
                    {c.score > 0 && (
                      <div style={{
                        height: "100%",
                        width: `${widthPct}%`,
                        background: "linear-gradient(90deg, var(--green) 0%, rgba(34,197,94,0.3) 100%)",
                        transition: "width 0.4s ease-out"
                      }} />
                    )}
                  </div>
                </div>

                {/* Score and Status Label */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 54, justifyContent: "flex-end" }}>
                  <span style={{ 
                    textAlign: "right", fontSize: 12, fontWeight: 800, fontFamily: "monospace",
                    color: isStrong ? "var(--green)" : isWeak ? "var(--red)" : "var(--muted)" 
                  }}>
                    {c.rawScore > 0 ? `+${c.rawScore}` : c.rawScore}
                  </span>
                </div>
              </div>

              {/* Hover Tooltip Popup detailing Conviction, Stability, and Contributing Drivers */}
              {isHovered && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    zIndex: 150,
                    background: "rgba(15, 23, 42, 0.98)",
                    backdropFilter: "blur(12px)",
                    border: "1px solid rgba(56, 189, 248, 0.4)",
                    borderRadius: 8,
                    padding: "9px 12px",
                    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.8), 0 0 12px rgba(56, 189, 248, 0.15)",
                    pointerEvents: "none",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <strong style={{ fontSize: 13, color: isStrong ? "var(--green)" : isWeak ? "var(--red)" : "#fff" }}>
                        {c.name}
                      </strong>
                      <span style={{ fontSize: 10, color: "var(--muted)" }}>• {c.status}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, fontFamily: "monospace", fontSize: 10 }}>
                      <span style={{ color: c.conviction >= 75 ? "var(--green)" : "var(--accent)", fontWeight: 700 }}>
                        {c.conviction}% Conv
                      </span>
                      <span style={{ color: "var(--muted)" }}>{c.stability}% Stability</span>
                    </div>
                  </div>

                  {c.dominantDrivers && c.dominantDrivers.length > 0 ? (
                    <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.08)", paddingTop: 5, display: "flex", flexDirection: "column", gap: 3.5 }}>
                      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                        Contributing Pair Drivers ({c.pairsCount} FX vectors):
                      </div>
                      {c.dominantDrivers.map((d, idx) => (
                        <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 9.5, fontFamily: "monospace" }}>
                          <span style={{ color: "rgba(255, 255, 255, 0.85)" }}>
                            {d.symbol}
                          </span>
                          <div style={{ display: "flex", gap: 8 }}>
                            <span style={{ color: d.contribution >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
                              {d.contribution >= 0 ? `+${d.contribution}` : d.contribution} pts
                            </span>
                            <span style={{ color: "var(--muted)" }}>{d.conviction}% Conv</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 9.5, color: "var(--muted)", borderTop: "1px solid rgba(255, 255, 255, 0.08)", paddingTop: 4 }}>
                      Evaluating cross-currency order flow...
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      {/* High-Conviction Pairings Section (Enhanced with Live Market Brain Resolution) */}
      {currencies.length >= 2 && (() => {
        const top = currencies.slice(0, 3);
        const bottom = currencies.slice(-3).reverse();
        
        if (top.length === 0 || bottom.length === 0) return null;

        const getPair = (strong, weak) => {
          const order = ["EUR", "GBP", "AUD", "NZD", "USD", "CAD", "CHF", "JPY"];
          const i1 = order.indexOf(strong.name);
          const i2 = order.indexOf(weak.name);
          const edge = (strong.rawScore || 0) - (weak.rawScore || 0);
          if (i1 < i2) return { symbol: strong.name + weak.name, action: "Buy", strong: strong.name, weak: weak.name, edge };
          return { symbol: weak.name + strong.name, action: "Sell", strong: strong.name, weak: weak.name, edge };
        };

        const suggestions = [];
        for (const t of top) {
          for (const b of bottom) {
            suggestions.push(getPair(t, b));
          }
        }

        // Deduplicate and filter by allowed symbols (if any)
        const uniqueSuggestions = [];
        const seen = new Set();
        suggestions.forEach((s) => {
          if (!seen.has(s.symbol)) {
            seen.add(s.symbol);
            if (allowedSymbols.length === 0 || allowedSymbols.includes(s.symbol)) {
              uniqueSuggestions.push(s);
            }
          }
        });

        if (uniqueSuggestions.length === 0) return null;

        return (
          <div style={{ marginTop: 4, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text)", textTransform: "uppercase", letterSpacing: 0.5, display: "flex", alignItems: "center", gap: 5 }}>
                <Sparkles size={12} style={{ color: "#fbbf24" }} />
                <span>High-Conviction Pairings</span>
              </div>
              <span style={{ fontSize: 9.5, color: "var(--muted)", fontFamily: "monospace" }}>
                Ranked by Currency Divergence Edge
              </span>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {uniqueSuggestions.map((s) => {
                const symData = symbolsMap[s.symbol];
                const brainConviction = symData?.brain?.conviction ?? symData?.conviction;
                const brainAction = symData?.brain?.action;
                const dolName = symData?.brain?.targetDOL?.name || symData?.brain?.targetDOL;
                const isReady = brainAction === "READY_FOR_LONG" || brainAction === "READY_FOR_SHORT";
                const isPullback = brainAction === "WAIT_FOR_15M_PULLBACK" || brainAction === "WAIT_FOR_RETRACEMENT";

                return (
                  <button
                    key={s.symbol}
                    className="ghost"
                    onClick={() => onSelectSuggested && onSelectSuggested(s.symbol)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: `1px solid ${s.action === "Buy" ? "rgba(34, 197, 94, 0.4)" : "rgba(239, 68, 68, 0.4)"}`,
                      background: s.action === "Buy" ? "rgba(34, 197, 94, 0.06)" : "rgba(239, 68, 68, 0.06)",
                      color: "var(--text)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = s.action === "Buy" ? "var(--green)" : "var(--red)";
                      e.currentTarget.style.transform = "translateY(-1px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = s.action === "Buy" ? "rgba(34, 197, 94, 0.4)" : "rgba(239, 68, 68, 0.4)";
                      e.currentTarget.style.transform = "translateY(0)";
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 12 }}>{s.symbol}</span>
                      <span style={{
                        fontSize: 9.5,
                        fontWeight: 800,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: s.action === "Buy" ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)",
                        color: s.action === "Buy" ? "var(--green)" : "var(--red)",
                      }}>
                        {s.action === "Buy" ? "BUY ▲" : "SELL ▼"}
                      </span>
                      {typeof brainConviction === "number" && (
                        <span style={{ fontSize: 9.5, fontFamily: "monospace", color: brainConviction >= 75 ? "var(--green)" : "var(--accent)", fontWeight: 700 }}>
                          {brainConviction}%
                        </span>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9, color: "var(--muted)", fontFamily: "monospace" }}>
                      <span>Δ {s.edge > 0 ? `+${s.edge}` : s.edge} pts</span>
                      {isReady && (
                        <span style={{ color: "var(--green)", fontWeight: 800 }}>⚡ A+ READY</span>
                      )}
                      {isPullback && (
                        <span style={{ color: "var(--orange)", fontWeight: 700 }}>⏳ OTE RETRACE</span>
                      )}
                      {dolName && (
                        <span style={{ color: "var(--muted)", opacity: 0.8 }}>🎯 {typeof dolName === "string" ? dolName : dolName.name || "DOL"}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Footer Info */}
      <div className="muted" style={{ fontSize: 9.5, lineHeight: 1.4, marginTop: 4, borderTop: "1px solid rgba(255, 255, 255, 0.05)", paddingTop: 8 }}>
        Powered by the <strong>Conviction-Weighted Structural Bias Engine</strong>.<br/>
        Scores reflect multi-timeframe orderflow, HTF dealing range depth, FVGs, and multi-lens consensus across all FX pairs.
        {data.length > 0 && data[0].at && (
          <div style={{ marginTop: 2, opacity: 0.6, fontFamily: "monospace", fontSize: 9 }}>
            Last Synced: {new Date(data[0].at).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}
