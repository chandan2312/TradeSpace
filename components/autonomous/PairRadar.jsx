"use client";

import { useState } from "react";
import { Compass, Eye, Star, TrendingUp, TrendingDown, Minus, ShieldCheck, AlertCircle } from "lucide-react";
import { finiteNumber, formatPrice, markPriceFor } from "./TradeTelemetry";

const FILTERS = [
  ["all", "All"],
  ["watchlist", "Watchlist"],
  ["prime", "Prime A+"],
  ["watching", "Watching"],
  ["scanning", "Scanning"],
  ["off_session", "Off-Session"],
  ["blocked", "Blocked"],
];

const buttonStyle = {
  padding: "5px 10px",
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 6,
  cursor: "pointer",
  background: "transparent",
  color: "var(--muted)",
  border: "1px solid var(--border)",
  transition: "all 0.15s ease",
};

export default function PairRadar({
  pairs = [],
  onInspectPair,
  onToggleWhitelist,
  whitelist = [],
  ticks = {},
}) {
  const [filter, setFilter] = useState("all");
  const whitelistSet = new Set(whitelist);

  const filtered = pairs.filter((pair) => {
    const status = pair.status || "";
    if (filter === "watchlist") return pair.isInMainWatchlist;
    if (filter === "prime") return status === "PRIME_QUALIFIED";
    if (filter === "watching") return status.startsWith("WATCHING");
    if (filter === "scanning") return status.startsWith("SCANNING");
    if (filter === "off_session") return /OFF_SESSION|OFF_HOURS|TIME_SLOT|DEAD_ZONE/.test(status);
    if (filter === "blocked") return status.startsWith("BLOCKED");
    return true;
  });

  return (
    <section
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
        minWidth: 0,
      }}
      aria-label="Market Opportunity Radar"
    >
      {/* Header & Filter Row */}
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
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Market Opportunity Radar</h2>
          <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>
            ({filtered.length} of {pairs.length} pairs)
          </span>
        </div>

        {/* Filter Pills */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTERS.map(([id, label]) => {
            const active = filter === id;
            return (
              <button
                key={id}
                aria-pressed={active}
                onClick={() => setFilter(id)}
                style={{
                  ...buttonStyle,
                  color: active ? "#fff" : "var(--muted)",
                  background: active ? "var(--accent)" : "rgba(255, 255, 255, 0.03)",
                  borderColor: active ? "var(--accent)" : "var(--border)",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid of Minimal Pair Cards */}
      {filtered.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: 32,
            color: "var(--muted)",
            fontSize: 12,
            border: "1px dashed var(--border)",
            borderRadius: 8,
          }}
        >
          No pairs match the selected filter.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))",
            gap: 12,
          }}
        >
          {filtered.map((pair) => {
            const status = pair.status || "UNAVAILABLE";
            const prime = status === "PRIME_QUALIFIED";
            const isBlocked = status.startsWith("BLOCKED");
            const isWatching = status.startsWith("WATCHING");
            const isScanning = status.startsWith("SCANNING");
            const isOffSession = /OFF_SESSION|DEAD_ZONE|TIMING/.test(status);

            const statusColor = prime
              ? "var(--green)"
              : isWatching
              ? "var(--orange)"
              : isScanning
              ? "var(--accent)"
              : isOffSession
              ? "var(--muted)"
              : isBlocked
              ? "var(--red)"
              : "var(--muted)";

            const level = pair.stagedLevel;
            const conviction = finiteNumber(pair.brain?.conviction);
            const isWhitelisted = whitelistSet.has(pair.symbol);
            const currentMark = markPriceFor(pair, ticks);
            const rangeZone = pair.dealingRange?.zone || pair.range?.zone || "MID";

            return (
              <article
                key={pair.symbol}
                onClick={() => onInspectPair?.(pair)}
                style={{
                  background: prime
                    ? "rgba(34, 197, 94, 0.03)"
                    : "rgba(255, 255, 255, 0.02)",
                  border: `1px solid ${
                    prime
                      ? "rgba(34, 197, 94, 0.4)"
                      : isWatching
                      ? "rgba(249, 115, 22, 0.3)"
                      : isScanning
                      ? "rgba(56, 189, 248, 0.25)"
                      : isBlocked
                      ? "rgba(239, 68, 68, 0.2)"
                      : "var(--border)"
                  }`,
                  borderRadius: 10,
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxShadow: prime ? "0 4px 12px rgba(34, 197, 94, 0.1)" : "none",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = prime
                    ? "rgba(34, 197, 94, 0.4)"
                    : isBlocked
                    ? "rgba(239, 68, 68, 0.2)"
                    : "var(--border)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {/* Top Row: Star, Symbol, Direction, Watchlist tag */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      aria-label={`${isWhitelisted ? "Remove" : "Add"} ${pair.symbol} priority whitelist`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleWhitelist?.(pair.symbol);
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: 2,
                        cursor: "pointer",
                        color: isWhitelisted ? "var(--orange)" : "var(--muted)",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <Star size={13} fill={isWhitelisted ? "currentColor" : "none"} />
                    </button>

                    <strong style={{ fontSize: 14 }}>{pair.tradeableSymbol || pair.symbol}</strong>

                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background:
                          pair.dir === 1
                            ? "rgba(34, 197, 94, 0.15)"
                            : pair.dir === -1
                            ? "rgba(239, 68, 68, 0.15)"
                            : "rgba(255, 255, 255, 0.05)",
                        color:
                          pair.dir === 1
                            ? "var(--green)"
                            : pair.dir === -1
                            ? "var(--red)"
                            : "var(--muted)",
                      }}
                    >
                      {pair.dir === 1 ? "LONG ▲" : pair.dir === -1 ? "SHORT ▼" : "NEUTRAL ⬌"}
                    </span>
                  </div>

                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      padding: "2px 5px",
                      borderRadius: 3,
                      background: pair.isInMainWatchlist
                        ? "rgba(34, 197, 94, 0.12)"
                        : "rgba(255, 255, 255, 0.05)",
                      color: pair.isInMainWatchlist ? "var(--green)" : "var(--muted)",
                    }}
                  >
                    {pair.isInMainWatchlist ? "WATCHLIST" : "CONTEXT"}
                  </span>
                </div>

                {/* Middle Row: Conviction, Status Pill, Dealing Zone */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 800,
                        fontFamily: "monospace",
                        color:
                          conviction >= 75
                            ? "var(--green)"
                            : conviction >= 50
                            ? "var(--accent)"
                            : "var(--muted)",
                      }}
                    >
                      {conviction !== null ? `${conviction}%` : "—"}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--muted)" }}>Conviction</span>
                  </div>

                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: prime
                        ? "rgba(34, 197, 94, 0.2)"
                        : isWatching
                        ? "rgba(249, 115, 22, 0.15)"
                        : isScanning
                        ? "rgba(56, 189, 248, 0.12)"
                        : isBlocked
                        ? "rgba(239, 68, 68, 0.15)"
                        : "rgba(255, 255, 255, 0.06)",
                      color: statusColor,
                      border: `1px solid ${statusColor}`,
                    }}
                  >
                    {status.replaceAll("_", " ")}
                  </span>
                </div>

                {/* Macro Narrative & Zone Chip */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 10,
                    color: "var(--muted)",
                    paddingTop: 4,
                    borderTop: "1px solid rgba(255, 255, 255, 0.04)",
                  }}
                >
                  <span>
                    Zone:{" "}
                    <strong
                      style={{
                        color:
                          rangeZone.includes("DISCOUNT")
                            ? "var(--green)"
                            : rangeZone.includes("PREMIUM")
                            ? "var(--red)"
                            : "var(--fg)",
                      }}
                    >
                      {rangeZone.replace(/_/g, " ")}
                    </strong>
                  </span>

                  <span style={{ fontFamily: "monospace" }}>
                    Mark: {formatPrice(currentMark)}
                  </span>
                </div>

                {/* Staged Execution Chip if active */}
                {level?.entry && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 10,
                      fontFamily: "monospace",
                      background: "rgba(0, 0, 0, 0.25)",
                      padding: "4px 8px",
                      borderRadius: 4,
                    }}
                  >
                    <span style={{ color: "var(--accent)" }}>
                      Entry: {formatPrice(level.entry)}
                    </span>
                    <span style={{ color: "var(--green)", fontWeight: 700 }}>
                      R:R: {level.rr ? `${level.rr.toFixed(1)}R` : "—"}
                    </span>
                  </div>
                )}

                {/* Click to Inspect Prompt */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 4,
                    fontSize: 10,
                    color: "var(--accent)",
                    fontWeight: 600,
                  }}
                >
                  <Eye size={11} />
                  <span>Inspect Brain Details</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
