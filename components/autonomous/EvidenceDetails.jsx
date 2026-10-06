"use client";

export default function EvidenceDetails({ evidence, title = "Structural evidence" }) {
  return (
    <details style={{ fontSize: 11, minWidth: 0, overflowWrap: "anywhere" }}>
      <summary style={{ cursor: "pointer", color: "var(--accent)", padding: "4px 0" }}>{title}</summary>
      {evidence ? <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "6px 0", fontSize: 10, color: "var(--muted)" }}>{typeof evidence === "string" ? evidence : JSON.stringify(evidence, null, 2)}</pre> : <div style={{ color: "var(--muted)" }}>Evidence unavailable</div>}
    </details>
  );
}
