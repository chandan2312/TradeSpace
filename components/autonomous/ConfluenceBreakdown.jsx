"use client";

const POSITIVE_FACTORS = [
  ["dolAlignment", "DOL alignment", 25],
  ["premiumDiscount", "Premium / discount", 20],
  ["displacement", "Displacement", 20],
  ["retracementQuality", "Retracement quality", 15],
  ["killzone", "Killzone timing", 15],
  ["smt", "SMT divergence", 10],
  ["htfPdArray", "HTF PD array", 10],
];

const NEGATIVE_FACTORS = [
  ["opposingFriction", "Opposing PDA wall", -10],
  ["velocityDrag", "Adverse velocity / freight train", -14],
  ["staleAge", "Stale setup age (>6-10 bars)", -8],
  ["runwayExhaustion", "Target runway exhausted (>75%)", -10],
  ["spreadDrag", "Spread friction drag (>12% SL)", -6],
  ["macroHeadwind", "Macro bias / chop headwind", -15],
  ["timingLull", "Off-peak / dead zone lull", -15],
];

export default function ConfluenceBreakdown({ breakdown, score, compact = false }) {
  const validScore = typeof score === "number" && Number.isFinite(score);
  
  const posScore = breakdown?.positiveScore ?? POSITIVE_FACTORS.reduce((acc, [key]) => {
    const val = breakdown?.[key];
    return typeof val === "number" && val > 0 ? acc + val : acc;
  }, 0);

  const negScore = breakdown?.negativeScore ?? NEGATIVE_FACTORS.reduce((acc, [key]) => {
    const val = breakdown?.[key];
    return typeof val === "number" && val < 0 ? acc + val : acc;
  }, 0);

  const derivedNet = breakdown?.netScore ?? Math.max(10, Math.min(100, Math.round(posScore + negScore)));
  const displayScore = validScore ? score : derivedNet;

  const activeNegativeFactors = NEGATIVE_FACTORS.filter(([key]) => {
    const val = breakdown?.[key];
    return typeof val === "number" && val < 0;
  });

  return (
    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Header with Net Score + Positive/Negative Breakdown */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)" }}>
          Net Confluence · <span style={{ fontFamily: "monospace" }}>{`${displayScore}/100`}</span>
        </div>
        <div style={{ fontSize: 10, fontFamily: "monospace", display: "flex", gap: 6 }}>
          <span style={{ color: "var(--green)", fontWeight: 700 }}>+{posScore} Pos</span>
          {negScore < 0 && <span style={{ color: "var(--red)", fontWeight: 700 }}>{negScore} Neg</span>}
        </div>
      </div>

      {/* Positive Confluence Pillars */}
      <div>
        <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Positive Edge Pillars
        </div>
        <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(auto-fit, minmax(min(100%, 140px), 1fr))", gap: 6 }}>
          {POSITIVE_FACTORS.map(([key, label, max]) => {
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

      {/* Negative Friction & Deductions */}
      <div>
        <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Negative Friction & Risk Deductions
        </div>
        {activeNegativeFactors.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {activeNegativeFactors.map(([key, label]) => {
              const val = breakdown[key];
              return (
                <div
                  key={key}
                  style={{
                    fontSize: 9.5,
                    fontFamily: "monospace",
                    background: "rgba(239, 68, 68, 0.12)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    borderRadius: 4,
                    padding: "2px 6px",
                    color: "var(--red)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <span style={{ fontWeight: 800 }}>{val} pts</span>
                  <span style={{ color: "var(--fg)", opacity: 0.85 }}>{label}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 10, color: "var(--green)", fontStyle: "italic", display: "flex", alignItems: "center", gap: 4 }}>
            <span>✓</span>
            <span>Clean path: zero adverse friction or structural hazards detected (+0 deduction)</span>
          </div>
        )}
      </div>
    </div>
  );
}
