"use client";

import { useState, useEffect } from "react";
import { Activity, TrendingUp, TrendingDown, Minus } from "lucide-react";

export default function CurrencyStrengthMeter({ onSelectSuggested }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/bias?symbols=ALL`)
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.currencyStrength) {
          const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD"];
          const finalCurrencies = {};
          
          // Determine scale max (ignoring crazy outliers like > 50)
          // 40 is a very strong structural bias. Anything above is just clamped.
          const CAP = 40; 
          let absMax = 1;
          d.currencyStrength.forEach(c => {
            const capped = Math.max(-CAP, Math.min(CAP, c.score));
            if (Math.abs(capped) > absMax) absMax = Math.abs(capped);
          });

          // Ensure absMax is at least something reasonable so small scores don't blow up
          absMax = Math.max(15, absMax);

          CURRENCIES.forEach(cName => {
            const cData = d.currencyStrength.find(c => c.ccy === cName);
            const raw = cData ? cData.score : 0;
            const capped = Math.max(-CAP, Math.min(CAP, raw));
            
            let n = capped / absMax;
            n = Math.max(-1, Math.min(1, n));
            
            finalCurrencies[cName] = {
              name: cName,
              score: parseFloat(n.toFixed(2)),
              rawScore: raw,
              at: d.at
            };
          });

          // Convert to array and sort
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
        <div className="skeleton-pulse" style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>Analyzing Structural Orderflow...</div>
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14 }}>
          <Activity size={16} color="var(--accent)" />
          Structural Currency Strength
        </div>
        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--accent)", background: "var(--accent-soft)", padding: "2px 6px", borderRadius: 4 }}>
          BIAS ENGINE
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "0 48px", fontSize: 10, textTransform: "uppercase", fontWeight: 700, color: "var(--muted)", letterSpacing: 1 }}>
          <span>Weak</span>
          <span>Strong</span>
        </div>
        
        {currencies.map(c => {
          const isStrong = c.score > 0.15;
          const isWeak = c.score < -0.15;
          
          // Calculate width percentage relative to the half-bar (max deviation is 1.0)
          const deviation = Math.abs(c.score);
          const widthPct = Math.min(100, deviation * 100);
          
          return (
            <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ 
                width: 36, fontSize: 13, fontWeight: 700, 
                color: isStrong ? "var(--green)" : isWeak ? "var(--red)" : "var(--text)" 
              }}>
                {c.name}
              </div>
              
              <div style={{ 
                flex: 1, display: "flex", height: 18, background: "var(--bg)", 
                borderRadius: 4, overflow: "hidden", position: "relative"
              }}>
                {/* Center Divider */}
                <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, background: "var(--border)", zIndex: 2, transform: "translateX(-50%)" }} />
                
                {/* Left Side (Weakness) */}
                <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", alignItems: "stretch" }}>
                  {c.score < 0 && (
                    <div style={{
                      height: "100%",
                      width: `${widthPct}%`,
                      backgroundColor: "var(--red)",
                      background: "linear-gradient(90deg, rgba(244,67,54,0.3) 0%, var(--red) 100%)",
                      transition: "width 0.5s ease-out"
                    }} />
                  )}
                </div>
                
                {/* Right Side (Strength) */}
                <div style={{ flex: 1, display: "flex", justifyContent: "flex-start", alignItems: "stretch" }}>
                  {c.score > 0 && (
                    <div style={{
                      height: "100%",
                      width: `${widthPct}%`,
                      backgroundColor: "var(--green)",
                      background: "linear-gradient(90deg, var(--green) 0%, rgba(76,175,80,0.3) 100%)",
                      transition: "width 0.5s ease-out"
                    }} />
                  )}
                </div>
              </div>

              <div style={{ 
                width: 42, textAlign: "right", fontSize: 13, fontWeight: 700, fontFamily: "monospace",
                color: isStrong ? "var(--green)" : isWeak ? "var(--red)" : "var(--muted)" 
              }}>
                {c.score > 0 ? "+" : ""}{c.score.toFixed(2)}
              </div>
            </div>
          );
        })}
      </div>
      
      {currencies.length >= 2 && (() => {
        // Find top 2 and bottom 2
        const top = [currencies[0], currencies[1]].filter(c => c && c.score > 0.2);
        const bottom = [currencies[currencies.length - 1], currencies[currencies.length - 2]].filter(c => c && c.score < -0.2);
        
        if (top.length === 0 || bottom.length === 0) return null;

        const getPair = (strong, weak) => {
          const order = ["EUR", "GBP", "AUD", "NZD", "USD", "CAD", "CHF", "JPY"];
          const i1 = order.indexOf(strong);
          const i2 = order.indexOf(weak);
          if (i1 < i2) return { symbol: strong + weak, action: "Buy" };
          return { symbol: weak + strong, action: "Sell" };
        };

        const suggestions = [];
        if (top[0] && bottom[0]) suggestions.push(getPair(top[0].name, bottom[0].name));
        if (top[0] && bottom[1]) suggestions.push(getPair(top[0].name, bottom[1].name));
        if (top[1] && bottom[0]) suggestions.push(getPair(top[1].name, bottom[0].name));

        // Deduplicate
        const uniqueSuggestions = [];
        const seen = new Set();
        suggestions.forEach(s => {
          if (!seen.has(s.symbol)) {
            seen.add(s.symbol);
            uniqueSuggestions.push(s);
          }
        });

        if (uniqueSuggestions.length === 0) return null;

        return (
          <div style={{ marginTop: 8, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
              High-Conviction Pairings
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {uniqueSuggestions.map(s => (
                <button
                  key={s.symbol}
                  className="ghost"
                  onClick={() => onSelectSuggested && onSelectSuggested(s.symbol)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: `1px solid ${s.action === "Buy" ? "var(--green)" : "var(--red)"}`,
                    background: s.action === "Buy" ? "rgba(38, 166, 154, 0.1)" : "rgba(239, 83, 80, 0.1)",
                    color: "var(--text)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  <span style={{ fontFamily: "monospace" }}>{s.symbol}</span>
                  <span style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: s.action === "Buy" ? "var(--green)" : "var(--red)",
                    color: "#fff"
                  }}>
                    {s.action}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="muted" style={{ fontSize: 10, lineHeight: 1.4, marginTop: 12 }}>
        Calculated using the <strong>Structural Bias Engine</strong>.<br/>
        Scores reflect multi-timeframe orderflow, FVGs, liquidity sweeps, and market structure across all 28 forex pairs.
        {data.length > 0 && data[0].at && (
          <div style={{ marginTop: 4, opacity: 0.6 }}>
            Updated: {new Date(data[0].at).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}
