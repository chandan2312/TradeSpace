"use client";

import { useState, useMemo } from "react";
import { Terminal, Search, X, Copy, Check } from "lucide-react";
import DecisionReasons from "./DecisionReasons";

export default function AuditLog({ logs = [] }) {
  const [filterText, setFilterText] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [copied, setCopied] = useState(false);

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      // Type filter
      if (filterType === "filled") {
        if (!l.type?.includes("WON") && !l.type?.includes("FILLED")) return false;
      } else if (filterType === "invalidated") {
        if (!l.type?.includes("LOST") && !l.type?.includes("INVALIDATED")) return false;
      } else if (filterType === "staged") {
        if (!l.type?.includes("STAGED") && !l.type?.includes("ARMED")) return false;
      } else if (filterType === "veto") {
        const hasVetoes = (l.vetoes?.length > 0) || (l.details?.vetoes?.length > 0) || l.message?.includes("Gating") || l.message?.includes("Veto");
        if (!hasVetoes) return false;
      }

      // Text search
      if (filterText.trim()) {
        const q = filterText.toLowerCase();
        const msg = (l.message || l.note || "").toLowerCase();
        const sym = (l.symbol || "").toLowerCase();
        const type = (l.type || "").toLowerCase();
        const vetoText = JSON.stringify(l.vetoes || l.details?.vetoes || "").toLowerCase();
        return msg.includes(q) || sym.includes(q) || type.includes(q) || vetoText.includes(q);
      }

      return true;
    });
  }, [logs, filterType, filterText]);

  const handleCopyLogs = () => {
    try {
      const text = filteredLogs.map((l) => {
        const timeStr = l.createdAt || l.time ? new Date(l.createdAt || l.time).toISOString() : "";
        return `[${timeStr}] [${l.type || "LOG"}] ${l.symbol ? `[${l.symbol}] ` : ""}${l.message || l.note || ""}`;
      }).join("\n");
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "16px 20px",
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        minHeight: "max(520px, calc(100dvh - 320px))",
        height: "max(520px, calc(100dvh - 300px))",
      }}
    >
      {/* Header with Title and Search/Filters */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 14,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Terminal size={16} style={{ color: "var(--accent)" }} />
          <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Execution Audit Trail & Cognitive Logs
          </h2>
          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
            ({filteredLogs.length}{filteredLogs.length !== logs.length ? ` of ${logs.length}` : ""} entries)
          </span>
        </div>

        {/* Action Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Quick Filter Buttons */}
          <div style={{ display: "flex", gap: 3, background: "rgba(255,255,255,0.04)", padding: 2, borderRadius: 6, border: "1px solid var(--border)" }}>
            {[
              { id: "all", label: "All" },
              { id: "filled", label: "Filled" },
              { id: "invalidated", label: "Invalidated" },
              { id: "staged", label: "Staged" },
              { id: "veto", label: "Vetoes" },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterType(f.id)}
                style={{
                  border: "none",
                  cursor: "pointer",
                  padding: "3px 8px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  background: filterType === f.id ? "var(--accent)" : "transparent",
                  color: filterType === f.id ? "#fff" : "var(--muted)",
                  transition: "all 0.15s ease",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <Search size={13} style={{ position: "absolute", left: 8, color: "var(--muted)" }} />
            <input
              type="text"
              placeholder="Search logs..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              style={{
                background: "rgba(0, 0, 0, 0.3)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "4px 24px 4px 26px",
                fontSize: 11,
                color: "var(--fg)",
                outline: "none",
                width: 140,
              }}
            />
            {filterText && (
              <button
                onClick={() => setFilterText("")}
                style={{
                  position: "absolute", right: 6, background: "none", border: "none",
                  cursor: "pointer", color: "var(--muted)", padding: 2, display: "flex"
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Copy Button */}
          <button
            onClick={handleCopyLogs}
            title="Copy filtered logs to clipboard"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 8px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid var(--border)",
              color: copied ? "var(--green)" : "var(--muted)",
              cursor: "pointer",
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          background: "rgba(0, 0, 0, 0.45)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "12px 16px",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 11.5,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          boxSizing: "border-box",
        }}
      >
        {filteredLogs.length === 0 ? (
          <div style={{ color: "var(--muted)", textAlign: "center", padding: 32, fontSize: 12 }}>
            {filterText || filterType !== "all"
              ? "No log entries matching the active filter."
              : "No log entries recorded yet."}
          </div>
        ) : (
          filteredLogs.map((l, i) => {
            const timeStr = l.createdAt || l.time
              ? new Date(l.createdAt || l.time).toLocaleTimeString([], { hour12: false })
              : "--:--:--";

            let typeColor = "var(--muted)";
            if (l.type?.includes("WON") || l.type?.includes("FILLED")) typeColor = "var(--green)";
            else if (l.type?.includes("LOST") || l.type?.includes("INVALIDATED")) typeColor = "var(--red)";
            else if (l.type?.includes("STAGED") || l.type?.includes("ARMED")) typeColor = "var(--accent)";
            else if (l.type?.includes("BREAKEVEN")) typeColor = "var(--purple)";

            return (
              <div
                key={l._id || `${l.tradeId || "log"}-${i}`}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "2px 10px",
                  lineHeight: 1.5,
                  minWidth: 0,
                  overflowWrap: "anywhere",
                  padding: "3px 0",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.03)",
                }}
              >
                <span style={{ color: "var(--muted)", flexShrink: 0 }}>[{timeStr}]</span>
                <span style={{ color: typeColor, fontWeight: 700, flexShrink: 0 }}>{l.type}</span>
                {l.symbol && (
                  <span
                    style={{
                      color: "var(--accent)",
                      fontWeight: 700,
                      background: "rgba(56, 189, 248, 0.1)",
                      padding: "0 4px",
                      borderRadius: 4,
                      flexShrink: 0,
                    }}
                  >
                    {l.symbol}
                  </span>
                )}
                <span style={{ color: "var(--fg)", flex: 1, minWidth: 200 }}>
                  {l.message || l.note || "Message unavailable"}
                </span>
                {(l.vetoes?.length > 0 || l.details?.vetoes?.length > 0) && (
                  <div style={{ width: "100%", marginTop: 2, paddingLeft: 10, borderLeft: "2px solid rgba(239, 68, 68, 0.4)" }}>
                    <DecisionReasons vetoes={l.vetoes || l.details.vetoes} title="Recorded vetoes" />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
