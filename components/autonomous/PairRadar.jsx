"use client";

import { useState } from "react";
import {
  Compass,
  Eye,
  Sliders,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  Star,
  ChevronRight,
} from "lucide-react";

export default function PairRadar({
  pairs = [],
  onInspectPair,
  onToggleWhitelist,
  whitelist = [],
}) {
  const [filter, setFilter] = useState("all"); // "all" | "watchlist" | "prime" | "watching" | "blocked" | "context"

  const wlSet = new Set(whitelist);

  const filtered = pairs.filter((p) => {
    if (filter === "watchlist") return p.isInMainWatchlist;
    if (filter === "prime") return p.status === "PRIME_QUALIFIED";
    if (filter === "watching") return p.status === "WATCHING_RETRACE" || p.status === "WATCHING_RR";
    if (filter === "off_session") return p.status === "BLOCKED_OFF_SESSION";
    if (filter === "blocked") return p.status.startsWith("BLOCKED") && p.status !== "BLOCKED_OFF_SESSION";
    if (filter === "context") return !p.isInMainWatchlist;
    return true;
  });

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
      }}
    >
      {/* Header & Filter Pills */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Compass size={16} style={{ color: "var(--accent)" }} />
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
            Dynamic Opportunity Radar & Universe Scanner
          </h2>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            ({filtered.length} of {pairs.length} pairs)
          </span>
        </div>

        {/* Filter Pills */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { id: "all", label: "All Universe" },
            { id: "watchlist", label: "Main Watchlist Only" },
            { id: "prime", label: "Prime Setups" },
            { id: "watching", label: "Watching Retrace" },
            { id: "off_session", label: "Off-Session Gated" },
            { id: "blocked", label: "Blocked / Exhausted" },
            { id: "context", label: "Context Only" },
          ].map((btn) => (
            <button
              key={btn.id}
              onClick={() => setFilter(btn.id)}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 6,
                cursor: "pointer",
                background: filter === btn.id ? "rgba(56, 189, 248, 0.15)" : "transparent",
                color: filter === btn.id ? "var(--accent)" : "var(--muted)",
                border: `1px solid ${filter === btn.id ? "rgba(56, 189, 248, 0.4)" : "var(--border)"}`,
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr
              style={{
                borderBottom: "1px solid var(--border)",
                color: "var(--muted)",
                textAlign: "left",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              <th style={{ padding: "8px 6px" }}>Pair</th>
              <th style={{ padding: "8px 6px" }}>Bias & Verdict</th>
              <th style={{ padding: "8px 6px" }}>Horizon</th>
              <th style={{ padding: "8px 6px" }}>Conviction</th>
              <th style={{ padding: "8px 6px" }}>Range Runway</th>
              <th style={{ padding: "8px 6px" }}>Staged Level</th>
              <th style={{ padding: "8px 6px" }}>Status</th>
              <th style={{ padding: "8px 6px", textAlign: "right" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>
                  No pairs currently match this filter.
                </td>
              </tr>
            ) : (
              filtered.map((p) => {
                const isWl = wlSet.has(p.symbol);
                const isPrime = p.status === "PRIME_QUALIFIED";
                const isWatching = p.status.startsWith("WATCHING");
                const isBlocked = p.status.startsWith("BLOCKED");

                return (
                  <tr
                    key={p.symbol}
                    style={{
                      borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                      background: isPrime ? "rgba(34, 197, 94, 0.03)" : "transparent",
                    }}
                  >
                    {/* Pair + Whitelist + Watchlist Indicator */}
                    <td style={{ padding: "10px 6px", fontWeight: 700 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          onClick={() => onToggleWhitelist && onToggleWhitelist(p.symbol)}
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            padding: 0,
                            color: isWl ? "var(--orange)" : "rgba(255, 255, 255, 0.2)",
                          }}
                          title={isWl ? "Remove from Whitelist" : "Add to Priority Whitelist"}
                        >
                          <Star size={13} fill={isWl ? "var(--orange)" : "none"} />
                        </button>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span>{p.tradeableSymbol || p.symbol}</span>
                            {p.tradeableSymbol && p.tradeableSymbol !== p.symbol && (
                              <span style={{ fontSize: 9, color: "var(--muted)", fontWeight: 400 }}>
                                ({p.symbol})
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                            {p.isInMainWatchlist ? (
                              <span
                                style={{
                                  fontSize: 9,
                                  fontWeight: 700,
                                  color: "#10b981",
                                  background: "rgba(16, 185, 129, 0.12)",
                                  padding: "1px 5px",
                                  borderRadius: 4,
                                  width: "fit-content",
                                  letterSpacing: 0.3,
                                }}
                              >
                                MAIN WATCHLIST
                              </span>
                            ) : (
                              <span
                                style={{
                                  fontSize: 9,
                                  fontWeight: 600,
                                  color: "var(--muted)",
                                  background: "rgba(255, 255, 255, 0.05)",
                                  padding: "1px 5px",
                                  borderRadius: 4,
                                  width: "fit-content",
                                  letterSpacing: 0.3,
                                }}
                              >
                                CONTEXT ONLY
                              </span>
                            )}
                            {p.sessionProfile && (
                              <span
                                style={{
                                  fontSize: 9,
                                  fontWeight: 700,
                                  color: p.sessionProfile.badgeColor || "var(--accent)",
                                  background: `${p.sessionProfile.badgeColor || "#38bdf8"}18`,
                                  padding: "1px 5px",
                                  borderRadius: 4,
                                  border: `1px solid ${p.sessionProfile.badgeColor || "#38bdf8"}33`,
                                  letterSpacing: 0.2,
                                }}
                                title={`${p.sessionProfile.fullLabel} (${p.sessionProfile.eetHoursLabel})`}
                              >
                                {p.sessionProfile.label}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Direction & Brain Verdict */}
                    <td style={{ padding: "10px 6px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            padding: "2px 6px",
                            borderRadius: 4,
                            fontWeight: 700,
                            fontSize: 10,
                            background:
                              p.dir === 1
                                ? "rgba(34, 197, 94, 0.2)"
                                : p.dir === -1
                                ? "rgba(239, 68, 68, 0.2)"
                                : "rgba(255, 255, 255, 0.05)",
                            color:
                              p.dir === 1
                                ? "var(--green)"
                                : p.dir === -1
                                ? "var(--red)"
                                : "var(--muted)",
                          }}
                        >
                          {p.dirLabel}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--fg)",
                            maxWidth: 160,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={p.brain?.verdict}
                        >
                          {p.brain?.verdict?.replace(/_/g, " ")}
                        </span>
                      </div>
                    </td>

                    {/* Horizon */}
                    <td style={{ padding: "10px 6px" }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background:
                            p.scenario.id === "swing"
                              ? "rgba(168, 85, 247, 0.15)"
                              : "rgba(56, 189, 248, 0.15)",
                          color: p.scenario.id === "swing" ? "var(--purple)" : "var(--accent)",
                          border: "1px solid var(--border)",
                        }}
                        title={p.scenario.rationale}
                      >
                        {p.scenario.badge}
                      </span>
                    </td>

                    {/* Conviction */}
                    <td style={{ padding: "10px 6px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div
                          style={{
                            width: 48,
                            height: 6,
                            borderRadius: 3,
                            background: "rgba(255, 255, 255, 0.08)",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${p.brain?.conviction || 50}%`,
                              height: "100%",
                              background:
                                (p.brain?.conviction || 50) >= 75
                                  ? "var(--green)"
                                  : (p.brain?.conviction || 50) >= 60
                                  ? "var(--orange)"
                                  : "var(--red)",
                            }}
                          />
                        </div>
                        <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                          {p.brain?.conviction || 50}%
                        </span>
                      </div>
                    </td>

                    {/* Range Runway */}
                    <td style={{ padding: "10px 6px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 10, color: "var(--muted)" }}>
                          {p.range?.h4Zone?.replace(/_/g, " ")}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span
                            style={{
                              fontFamily: "monospace",
                              fontSize: 11,
                              color:
                                p.range?.remainingRunwayPct >= 40
                                  ? "var(--green)"
                                  : p.range?.remainingRunwayPct >= 20
                                  ? "var(--orange)"
                                  : "var(--red)",
                            }}
                          >
                            {p.range?.remainingRunwayPct}% runway
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Staged Level & Chosen Entry Model */}
                    <td style={{ padding: "10px 6px" }}>
                      {p.stagedLevel ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)" }}>
                              {p.stagedLevel.label}
                            </span>
                            {p.entryModel && (
                              <span
                                style={{
                                  fontSize: 9,
                                  fontWeight: 700,
                                  padding: "1px 5px",
                                  borderRadius: 4,
                                  background: "rgba(56, 189, 248, 0.15)",
                                  color: "var(--accent)",
                                  border: "1px solid rgba(56, 189, 248, 0.3)",
                                }}
                                title={p.entryModel.rationale}
                              >
                                {p.entryModel.badge}
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>
                            {p.stagedLevel.rr}R · SL: {p.stagedLevel.sl?.toFixed(4)}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>
                      )}
                    </td>

                    {/* Status Badge */}
                    <td style={{ padding: "10px 6px" }}>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "2px 8px",
                          borderRadius: 6,
                          fontSize: 10,
                          fontWeight: 700,
                          background: isPrime
                            ? "rgba(34, 197, 94, 0.15)"
                            : isWatching
                            ? "rgba(234, 179, 8, 0.15)"
                            : p.status === "BLOCKED_OFF_SESSION"
                            ? "rgba(168, 85, 247, 0.15)"
                            : isBlocked
                            ? "rgba(239, 68, 68, 0.15)"
                            : p.status === "RESTRICTED_CONTEXT_ONLY"
                            ? "rgba(56, 189, 248, 0.12)"
                            : "rgba(255, 255, 255, 0.05)",
                          color: isPrime
                            ? "var(--green)"
                            : isWatching
                            ? "var(--orange)"
                            : p.status === "BLOCKED_OFF_SESSION"
                            ? "#c084fc"
                            : isBlocked
                            ? "var(--red)"
                            : p.status === "RESTRICTED_CONTEXT_ONLY"
                            ? "var(--accent)"
                            : "var(--muted)",
                          border: `1px solid ${
                            isPrime
                              ? "rgba(34, 197, 94, 0.3)"
                              : isWatching
                              ? "rgba(234, 179, 8, 0.3)"
                              : p.status === "BLOCKED_OFF_SESSION"
                              ? "rgba(168, 85, 247, 0.35)"
                              : isBlocked
                              ? "rgba(239, 68, 68, 0.3)"
                              : p.status === "RESTRICTED_CONTEXT_ONLY"
                              ? "rgba(56, 189, 248, 0.25)"
                              : "var(--border)"
                          }`,
                        }}
                        title={p.statusReason}
                      >
                        {isPrime && <CheckCircle size={11} />}
                        {isWatching && <Clock size={11} />}
                        {p.status === "BLOCKED_OFF_SESSION" && <Clock size={11} />}
                        {isBlocked && p.status !== "BLOCKED_OFF_SESSION" && <XCircle size={11} />}
                        {p.status === "RESTRICTED_CONTEXT_ONLY"
                          ? "CONTEXT ONLY"
                          : p.status === "BLOCKED_OFF_SESSION"
                          ? "OFF-SESSION"
                          : p.status.replace(/_/g, " ")}
                      </div>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: "10px 6px", textAlign: "right" }}>
                      <button
                        onClick={() => onInspectPair(p)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "4px 8px",
                          borderRadius: 6,
                          background: "rgba(255, 255, 255, 0.06)",
                          border: "1px solid var(--border)",
                          color: "var(--fg)",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        <Eye size={12} /> Inspect
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
