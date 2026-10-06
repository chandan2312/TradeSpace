"use client";

const FACTORS = [
  ["dolAlignment", "DOL alignment", 25],
  ["premiumDiscount", "Premium / discount", 20],
  ["displacement", "Displacement", 20],
  ["killzone", "Killzone", 15],
  ["smt", "SMT", 10],
  ["htfPdArray", "HTF PD array", 10],
];

export default function ConfluenceBreakdown({ breakdown, score, compact = false }) {
  const validScore = typeof score === "number" && Number.isFinite(score);
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "var(--accent)" }}>
        Confluence · {validScore ? `${score}/100` : "Score unavailable"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: 6 }}>
        {FACTORS.map(([key, label, max]) => {
          const value = breakdown?.[key];
          const available = typeof value === "number" && Number.isFinite(value);
          return (
            <div key={key} style={{ fontSize: 10, minWidth: 0 }}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 4 }}>
                <span style={{ color: "var(--muted)" }}>{label}</span>
                <span style={{ fontFamily: "monospace" }}>{available ? `${value}/${max}` : "Unavailable"}</span>
              </div>
              {available && <div style={{ height: 3, background: "var(--border)", borderRadius: 2, marginTop: 3 }}>
                <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, value / max * 100))}%`, background: "var(--accent)" }} />
              </div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
