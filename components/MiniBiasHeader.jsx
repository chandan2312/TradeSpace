"use client";

import { useState, useRef, useEffect } from "react";
import { Maximize2, X } from "lucide-react";
import BiasPanel from "./BiasPanel"; // We can reuse BiasPanel's SymbolRow? 
// Actually, let's just create a small dropdown with the SymbolRow.

const PHASE = {
  trend: { tag: "T", title: "Trending — layers agree", color: "var(--accent)" },
  "reversal-watch": { tag: "R", title: "Reversal watch", color: "var(--orange)" },
  setup: { tag: "⚡", title: "Setup", color: "var(--orange)" },
  chop: { tag: "C", title: "Chop — no edge", color: "var(--muted)" },
};

const scoreColor = (s) => s > 15 ? "var(--green)" : s < -15 ? "var(--red)" : "var(--muted)";

export default function MiniBiasHeader({ symbol, symBias, catBias }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const click = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", click);
    return () => document.removeEventListener("mousedown", click);
  }, [open]);

  if (!symBias) return null;

  const tfs = ["M15", "H1", "H4", "D1"];

  return (
    <div ref={ref} style={{ display: "flex", alignItems: "center", gap: 8, pointerEvents: "auto" }}>
      {/* Category Bias */}
      {catBias && (
        <div style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "var(--panel-2)", border: "1px solid var(--border)", color: scoreColor(catBias.score) }}>
          {catBias.label} {catBias.score > 0 ? "+" : ""}{catBias.score}
        </div>
      )}

      {/* Symbol Bias Score */}
      <div style={{ fontSize: 11, fontWeight: 700, color: scoreColor(symBias.score), background: "var(--panel-2)", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--border)" }}>
        {symBias.score > 0 ? "+" : ""}{symBias.score}
      </div>

      {/* Timeframe Blocks */}
      <div style={{ display: "flex", gap: 2 }}>
        {tfs.map(tf => {
          const l = symBias.layers?.[tf];
          const dir = l?.dir || 0;
          const bg = dir > 0 ? "var(--green)" : dir < 0 ? "var(--red)" : "var(--border)";
          return (
            <div key={tf} title={`${tf} bias`} style={{ width: 14, height: 14, background: bg, borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: dir === 0 ? "var(--muted)" : "#fff" }}>
              {tf.replace("M", "").replace("H", "").replace("D", "D")}
            </div>
          );
        })}
      </div>

      <button className="ghost" onClick={() => setOpen(!open)} style={{ padding: "2px 4px" }}>
        <Maximize2 size={12} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, marginTop: 4, width: 360,
          background: "var(--panel)", border: "1px solid var(--border-hi)", borderRadius: 6,
          boxShadow: "0 8px 24px rgba(0,0,0,0.6)", zIndex: 100, padding: 12
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 12 }}>{symbol} Bias Breakdown</span>
            <button className="ghost" onClick={() => setOpen(false)} style={{ padding: 2 }}><X size={12} /></button>
          </div>
          
          <div style={{ fontSize: 11 }}>
            {/* drives */}
            <div className="muted" style={{ fontSize: 9, textTransform: "uppercase", marginBottom: 4 }}>Factors</div>
            {symBias.factors?.map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 6, padding: "2px 0", alignItems: "baseline" }}>
                <span style={{ color: f.dir > 0 ? "var(--green)" : f.dir < 0 ? "var(--red)" : "var(--muted)", width: 10 }}>
                  {f.dir > 0 ? "▲" : f.dir < 0 ? "▼" : "•"}
                </span>
                <span>{f.label}</span>
                <span className="muted num" style={{ marginLeft: "auto", fontSize: 9.5 }}>w{f.w}</span>
              </div>
            ))}

            {/* dampeners */}
            {symBias.damps?.length > 0 && (
              <>
                <div className="muted" style={{ fontSize: 9, textTransform: "uppercase", marginTop: 8, marginBottom: 4 }}>Dampeners</div>
                {symBias.damps.map((d, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, padding: "2px 0", alignItems: "baseline", color: "var(--orange)" }}>
                    <span style={{ width: 10 }}>⚠</span>
                    <span>{d.label}</span>
                    <span className="num" style={{ marginLeft: "auto", fontSize: 9.5 }}>−{Math.round((1 - d.mult) * 100)}%</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
