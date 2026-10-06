"use client";

import { Terminal } from "lucide-react";
import DecisionReasons from "./DecisionReasons";

export default function AuditLog({ logs = [] }) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <Terminal size={15} style={{ color: "var(--accent)" }} />
        <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Execution Audit Trail & Cognitive Logs
        </h2>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>({logs.length} entries)</span>
      </div>

      <div
        style={{
          maxHeight: 180,
          overflowY: "auto",
          background: "rgba(0, 0, 0, 0.3)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 10,
          fontFamily: "monospace",
          fontSize: 11,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {logs.length === 0 ? (
          <div style={{ color: "var(--muted)", textAlign: "center", padding: 12 }}>
            No log entries recorded yet.
          </div>
        ) : (
          logs.map((l, i) => {
            const timeStr = l.createdAt || l.time
              ? new Date(l.createdAt || l.time).toLocaleTimeString([], { hour12: false })
              : "--:--:--";

            let typeColor = "var(--muted)";
            if (l.type?.includes("WON") || l.type?.includes("FILLED")) typeColor = "var(--green)";
            else if (l.type?.includes("LOST") || l.type?.includes("INVALIDATED")) typeColor = "var(--red)";
            else if (l.type?.includes("STAGED") || l.type?.includes("ARMED")) typeColor = "var(--accent)";
            else if (l.type?.includes("BREAKEVEN")) typeColor = "var(--purple)";

            return (
              <div key={l._id || `${l.tradeId || "log"}-${i}`} style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", lineHeight: 1.4, minWidth: 0, overflowWrap: "anywhere" }}>
                <span style={{ color: "var(--muted)", flexShrink: 0 }}>[{timeStr}]</span>
                <span style={{ color: typeColor, fontWeight: 700, flexShrink: 0 }}>{l.type}</span>
                {l.symbol && <span style={{ color: "var(--accent)" }}>{l.symbol}</span>}
                <span style={{ color: "var(--fg)" }}>{l.message || l.note || "Message unavailable"}</span>
                {(l.vetoes?.length > 0 || l.details?.vetoes?.length > 0) && <div style={{ width: "100%" }}><DecisionReasons vetoes={l.vetoes || l.details.vetoes} title="Recorded vetoes" /></div>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
