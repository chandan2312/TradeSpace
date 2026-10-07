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
  const derivedScore = breakdown && typeof breakdown === "object"
    ? Object.values(breakdown).reduce((acc, val) => (typeof val === "number" && Number.isFinite(val) ? acc + val : acc), 0)
    : null;
  const displayScore = validScore ? score : derivedScore !== null ? derivedScore : 0;

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "var(--accent)" }}>
        Confluence · {`${displayScore}/100`}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: 6 }}>
        {FACTORS.map(([key, label, max]) => {
          const raw = breakdown?.[key];
          const hasValue = typeof raw === "number" && Number.isFinite(raw);
          const value = hasValue ? raw : 0;
          return (
            <div key={key} style={{ fontSize: 10, minWidth: 0 }}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 4 }}>
                <span style={{ color: "var(--muted)" }}>{label}</span>
                <span style={{ fontFamily: "monospace", color: value > 0 ? "var(--fg)" : "var(--muted)" }}>
                  {`${value}/${max}`}
                </span>
              </div>
              <div style={{ height: 3, background: "rgba(255, 255, 255, 0.08)", borderRadius: 2, marginTop: 3 }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, Math.max(0, (value / max) * 100))}%`,
                    background: value > 0 ? "var(--accent)" : "transparent",
                    borderRadius: 2,
                    transition: "width 0.2s ease",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
