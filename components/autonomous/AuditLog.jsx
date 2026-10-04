"use client";

import { Terminal } from "lucide-react";

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
            const timeStr = l.createdAt
              ? new Date(l.createdAt).toLocaleTimeString([], { hour12: false })
              : "--:--:--";

            let typeColor = "var(--muted)";
            if (l.type?.includes("WON") || l.type?.includes("FILLED")) typeColor = "var(--green)";
            else if (l.type?.includes("LOST") || l.type?.includes("INVALIDATED")) typeColor = "var(--red)";
            else if (l.type?.includes("STAGED") || l.type?.includes("ARMED")) typeColor = "var(--accent)";
            else if (l.type?.includes("BREAKEVEN")) typeColor = "var(--purple)";

            return (
              <div key={i} style={{ display: "flex", gap: 10, lineHeight: 1.4 }}>
                <span style={{ color: "var(--muted)", flexShrink: 0 }}>[{timeStr}]</span>
                <span style={{ color: typeColor, fontWeight: 700, flexShrink: 0 }}>{l.type}</span>
                <span style={{ color: "var(--fg)" }}>{l.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
