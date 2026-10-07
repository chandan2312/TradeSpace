"use client";

import { useMemo, useState } from "react";
import {
  History,
  CheckCircle2,
  AlertTriangle,
  MinusCircle,
  TrendingUp,
  ArrowRight,
  Filter,
  Layers,
  Target,
  Shield,
  XCircle,
} from "lucide-react";
import { formatPrice, formatR, formatUsd, formatIR, formatAR, finiteNumber } from "./TradeTelemetry";

export default function ClosedHistory({ closedTrades = [] }) {
  const [filter, setFilter] = useState("all"); // "all" | "tp" | "be" | "sl"

  const actualClosedTrades = useMemo(() => {
    return closedTrades.filter(
      (t) => Boolean(t.filledAt) || Boolean(t.filledPrice) || ["closed_tp", "closed_sl", "closed_be"].includes(t.status)
    );
  }, [closedTrades]);

  const filteredTrades = useMemo(() => {
    if (filter === "all") return actualClosedTrades;
    if (filter === "tp") return actualClosedTrades.filter((t) => t.status === "closed_tp");
    if (filter === "be") {
      return actualClosedTrades.filter(
        (t) => t.status === "closed_be" || t.closeReason === "breakeven"
      );
    }
    if (filter === "sl") {
      return actualClosedTrades.filter(
        (t) =>
          t.status === "closed_sl" ||
          (t.status === "closed" && t.closeReason !== "breakeven" && t.closeReason !== "take_profit")
      );
    }
    return actualClosedTrades;
  }, [actualClosedTrades, filter]);

  // Aggregate stats across closed trades
  const stats = useMemo(() => {
    let wins = 0;
    let bes = 0;
    let losses = 0;
    let netR = 0;

    for (const t of actualClosedTrades) {
      if (t.status === "closed_tp") {
        wins++;
        netR += finiteNumber(t.realizedR ?? t.pnlR ?? 2);
      } else if (t.status === "closed_be" || t.closeReason === "breakeven") {
        bes++;
        netR += finiteNumber(t.realizedR ?? t.pnlR ?? 0);
      } else {
        losses++;
        netR += finiteNumber(t.realizedR ?? t.pnlR ?? -1);
      }
    }

    const total = actualClosedTrades.length;
    const decisive = wins + losses;
    const winRate = decisive > 0 ? ((wins / decisive) * 100).toFixed(1) : "0.0";

    return { total, wins, bes, losses, netR, winRate };
  }, [actualClosedTrades]);

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Header & Quick Summary */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <History size={16} style={{ color: "var(--accent)" }} />
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              margin: 0,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Closed Trade Execution History
          </h2>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            ({closedTrades.length} trades recorded)
          </span>
        </div>

        {/* Aggregated Metric Pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "4px 8px",
              borderRadius: 6,
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid var(--border)",
              color: "var(--fg)",
            }}
          >
            Win Rate: <strong style={{ color: "var(--green)" }}>{stats.winRate}%</strong> ({stats.wins}W / {stats.losses}L / {stats.bes}BE)
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "4px 8px",
              borderRadius: 6,
              background: stats.netR >= 0 ? "rgba(34, 197, 94, 0.12)" : "rgba(239, 68, 68, 0.12)",
              border: `1px solid ${stats.netR >= 0 ? "rgba(34, 197, 94, 0.25)" : "rgba(239, 68, 68, 0.25)"}`,
              color: stats.netR >= 0 ? "var(--green)" : "var(--red)",
            }}
          >
            Realized Edge: {formatR(stats.netR)}
          </span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <button
          onClick={() => setFilter("all")}
          title="All Closed Trades"
          aria-label="All Closed Trades"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 6,
            border: "1px solid",
            borderColor: filter === "all" ? "var(--accent)" : "var(--border)",
            background: filter === "all" ? "var(--accent)" : "rgba(255, 255, 255, 0.02)",
            color: filter === "all" ? "#fff" : "var(--muted)",
            cursor: "pointer",
          }}
        >
          <Layers size={13} />
          <span style={{ fontSize: 10, fontFamily: "monospace", opacity: 0.85 }}>
            {closedTrades.length}
          </span>
        </button>
        <button
          onClick={() => setFilter("tp")}
          title="Take Profit"
          aria-label="Take Profit"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 6,
            border: "1px solid",
            borderColor: filter === "tp" ? "var(--green)" : "var(--border)",
            background: filter === "tp" ? "rgba(34, 197, 94, 0.2)" : "rgba(255, 255, 255, 0.02)",
            color: filter === "tp" ? "var(--green)" : "var(--muted)",
            cursor: "pointer",
          }}
        >
          <Target size={13} />
          <span style={{ fontSize: 10, fontFamily: "monospace", opacity: 0.85 }}>
            {stats.wins}
          </span>
        </button>
        <button
          onClick={() => setFilter("be")}
          title="Breakeven"
          aria-label="Breakeven"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 6,
            border: "1px solid",
            borderColor: filter === "be" ? "var(--accent)" : "var(--border)",
            background: filter === "be" ? "rgba(56, 189, 248, 0.2)" : "rgba(255, 255, 255, 0.02)",
            color: filter === "be" ? "var(--accent)" : "var(--muted)",
            cursor: "pointer",
          }}
        >
          <Shield size={13} />
          <span style={{ fontSize: 10, fontFamily: "monospace", opacity: 0.85 }}>
            {stats.bes}
          </span>
        </button>
        <button
          onClick={() => setFilter("sl")}
          title="Stop Loss"
          aria-label="Stop Loss"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 6,
            border: "1px solid",
            borderColor: filter === "sl" ? "var(--red)" : "var(--border)",
            background: filter === "sl" ? "rgba(239, 68, 68, 0.2)" : "rgba(255, 255, 255, 0.02)",
            color: filter === "sl" ? "var(--red)" : "var(--muted)",
            cursor: "pointer",
          }}
        >
          <XCircle size={13} />
          <span style={{ fontSize: 10, fontFamily: "monospace", opacity: 0.85 }}>
            {stats.losses}
          </span>
        </button>
      </div>

      {/* Trade List Table / Cards */}
      {filteredTrades.length === 0 ? (
        <div
          style={{
            padding: "32px 16px",
            textAlign: "center",
            color: "var(--muted)",
            fontSize: 12,
            background: "rgba(0, 0, 0, 0.2)",
            borderRadius: 8,
            border: "1px dashed var(--border)",
          }}
        >
          No closed trades matching the selected filter.
        </div>
      ) : (
        <div
          style={{
            overflowX: "auto",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "rgba(0, 0, 0, 0.25)",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              textAlign: "left",
              fontSize: 12,
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--border)",
                  background: "rgba(255, 255, 255, 0.03)",
                  color: "var(--muted)",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                <th style={{ padding: "10px 14px" }}>Symbol & Side</th>
                <th style={{ padding: "10px 14px" }}>Setup / Model</th>
                <th style={{ padding: "10px 14px" }}>Execution Prices</th>
                <th style={{ padding: "10px 14px" }}>Filled → Closed</th>
                <th style={{ padding: "10px 14px" }}>Outcome</th>
                <th style={{ padding: "10px 14px", textAlign: "right" }}>R Return (AR / IR) & P&L</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.map((t, idx) => {
                const isSell =
                  t.dir === -1 || String(t.direction || t.dirLabel).toUpperCase() === "SELL";
                const isWin = t.status === "closed_tp";
                const isBe = t.status === "closed_be" || t.closeReason === "breakeven";

                let outcomeBadge = {
                  label: isWin ? "TAKE PROFIT" : isBe ? "BREAKEVEN" : "STOP LOSS",
                  bg: isWin
                    ? "rgba(34, 197, 94, 0.15)"
                    : isBe
                    ? "rgba(56, 189, 248, 0.15)"
                    : "rgba(239, 68, 68, 0.15)",
                  color: isWin ? "var(--green)" : isBe ? "var(--accent)" : "var(--red)",
                  icon: isWin ? (
                    <CheckCircle2 size={12} />
                  ) : isBe ? (
                    <MinusCircle size={12} />
                  ) : (
                    <AlertTriangle size={12} />
                  ),
                };

                const actualRNum = isWin
                  ? finiteNumber(t.actualR ?? t.realizedR ?? t.pnlR ?? (t.targetRR ?? 2))
                  : isBe
                  ? finiteNumber(t.actualR ?? t.realizedR ?? t.pnlR ?? 0)
                  : finiteNumber(t.actualR ?? t.realizedR ?? t.pnlR ?? -1);

                const idealRNum = finiteNumber(t.idealR) ??
                  (finiteNumber(t.exitPrice) && finiteNumber(t.entryPrice) && finiteNumber(t.initialRiskDistance) && t.initialRiskDistance > 0
                    ? Number(((t.dir === -1 ? t.entryPrice - t.exitPrice : t.exitPrice - t.entryPrice) / t.initialRiskDistance).toFixed(2))
                    : actualRNum);

                const fillTimeStr = t.filledAt || t.createdAt
                  ? new Date(t.filledAt || t.createdAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })
                  : "--";

                const closeTimeStr = t.closedAt
                  ? new Date(t.closedAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })
                  : "--";

                return (
                  <tr
                    key={t._id || idx}
                    style={{
                      borderBottom:
                        idx === filteredTrades.length - 1 ? "none" : "1px solid rgba(255, 255, 255, 0.05)",
                      transition: "background 0.15s ease",
                    }}
                  >
                    {/* Symbol & Side */}
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 800, fontSize: 13 }}>{t.symbol}</span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            padding: "1px 5px",
                            borderRadius: 4,
                            background: isSell ? "rgba(239, 68, 68, 0.2)" : "rgba(34, 197, 94, 0.2)",
                            color: isSell ? "var(--red)" : "var(--green)",
                          }}
                        >
                          {isSell ? "SELL" : "BUY"}
                        </span>
                        {t.lot && (
                          <span
                            style={{
                              fontSize: 10,
                              color: "var(--muted)",
                              fontFamily: "monospace",
                            }}
                          >
                            {t.lot}L
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace", marginTop: 2 }}>
                        #{String(t._id || "").slice(-8)}
                      </div>
                    </td>

                    {/* Setup / Model */}
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ fontWeight: 600, color: "var(--fg)" }}>
                        {t.modelId || t.scenario?.modelId || "ICT 2022"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        {t.tf || t.scenario?.tf || "15M"} · {t.scenario?.setupTier || "A+"}
                      </div>
                    </td>

                    {/* Execution Prices */}
                    <td style={{ padding: "12px 14px", fontFamily: "monospace" }}>
                      <div>
                        Entry:{" "}
                        <strong style={{ color: "var(--fg)" }}>
                          {formatPrice(t.filledPrice ?? t.entryPrice)}
                        </strong>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        SL: {formatPrice(t.initialSlPrice ?? t.slPrice)} · TP:{" "}
                        {formatPrice(t.tpPrice)}
                      </div>
                    </td>

                    {/* Timeline */}
                    <td style={{ padding: "12px 14px", fontSize: 11 }}>
                      <div style={{ color: "var(--fg)" }}>{closeTimeStr}</div>
                      <div style={{ color: "var(--muted)", fontSize: 10 }}>In: {fillTimeStr}</div>
                    </td>

                    {/* Outcome Badge */}
                    <td style={{ padding: "12px 14px" }}>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 10,
                          fontWeight: 800,
                          padding: "3px 8px",
                          borderRadius: 6,
                          background: outcomeBadge.bg,
                          color: outcomeBadge.color,
                        }}
                      >
                        {outcomeBadge.icon}
                        <span>{outcomeBadge.label}</span>
                      </div>
                      {t.closeReason && (
                        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                          Reason: {t.closeReason}
                        </div>
                      )}
                    </td>

                    {/* R Return (AR / IR) & P&L */}
                    <td style={{ padding: "12px 14px", textAlign: "right" }}>
                      <div
                        style={{
                          fontFamily: "monospace",
                          fontWeight: 800,
                          fontSize: 14,
                          color: outcomeBadge.color,
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "flex-end",
                          gap: 6,
                        }}
                      >
                        <span>AR {formatR(actualRNum)}</span>
                        {idealRNum !== null && Math.abs(idealRNum - actualRNum) >= 0.05 && (
                          <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>
                            (IR {formatR(idealRNum)})
                          </span>
                        )}
                      </div>
                      {t.pnlUsd !== undefined && t.pnlUsd !== null && (
                        <div
                          style={{
                            fontFamily: "monospace",
                            fontSize: 11,
                            color: "var(--muted)",
                          }}
                        >
                          {formatUsd(t.pnlUsd)}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
