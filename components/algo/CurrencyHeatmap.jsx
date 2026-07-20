"use client";
import { useState, useEffect, Fragment } from "react";
import { Activity } from "lucide-react";

export default function CurrencyHeatmap() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(`/api/bias?symbols=ALL`)
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.currencyStrength) {
          setData(d.currencyStrength);
        }
      })
      .catch(() => {});
  }, []);

  if (!data) return null;

  const CURRENCIES = ["EUR", "GBP", "AUD", "NZD", "USD", "CAD", "CHF", "JPY"];
  
  const getCellColor = (base, quote) => {
    if (base === quote) return "transparent";
    const b = data.find(c => c.ccy === base)?.score || 0;
    const q = data.find(c => c.ccy === quote)?.score || 0;
    const edge = b - q;
    
    // Normalize edge (typical edge ranges from -40 to +40)
    const intensity = Math.min(1, Math.abs(edge) / 40);
    
    if (edge > 10) return `rgba(38, 166, 154, ${intensity})`; // Green
    if (edge < -10) return `rgba(239, 83, 80, ${intensity})`; // Red
    return "rgba(138, 147, 166, 0.1)"; // Neutral
  };

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
        <Activity size={16} color="var(--purple)" />
        Cross-Asset Matrix
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `30px repeat(8, 1fr)`, gap: 2 }}>
        <div />
        {CURRENCIES.map(c => (
          <div key={`header-${c}`} style={{ fontSize: 10, color: "var(--muted)", textAlign: "center", fontWeight: 700 }}>{c}</div>
        ))}
        
        {CURRENCIES.map(base => (
          <Fragment key={`frag-${base}`}>
            <div key={`row-${base}`} style={{ fontSize: 10, color: "var(--muted)", display: "flex", alignItems: "center", fontWeight: 700 }}>{base}</div>
            {CURRENCIES.map(quote => (
              <div 
                key={`${base}-${quote}`}
                style={{ 
                  aspectRatio: "1", 
                  background: getCellColor(base, quote),
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 600,
                  color: base === quote ? "transparent" : "var(--text)",
                  border: base === quote ? "none" : "1px solid rgba(255,255,255,0.02)",
                  transition: "background 0.3s"
                }}
              >
                {base !== quote && Math.round((data.find(c => c.ccy === base)?.score || 0) - (data.find(c => c.ccy === quote)?.score || 0))}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
