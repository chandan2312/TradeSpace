"use client";

export default function DecisionReasons({ vetoes, reason, title = "Decision evidence" }) {
  const reasons = Array.isArray(vetoes) ? vetoes : [];
  const isDuplicateReason = Boolean(
    reason && reasons.some((v) => v.reason === reason || (v.reason && String(reason).trim().toLowerCase() === String(v.reason).trim().toLowerCase()))
  );
  if (!reason && reasons.length === 0) return null;
  return (
    <div style={{ minWidth: 0, fontSize: 11, lineHeight: 1.5, overflowWrap: "anywhere" }}>
      <div style={{ color: "var(--muted)", fontWeight: 700 }}>{title}</div>
      {reason && !isDuplicateReason && <div>{reason}</div>}
      {reasons.map((veto, i) => (
        <div key={`${veto.code}-${i}`} style={{ color: "var(--red)", marginTop: 3 }}>
          <strong>{veto.code || "Code unavailable"}</strong> · {veto.reason || "Reason unavailable"}
        </div>
      ))}
    </div>
  );
}
