"use client";

import { Activity, Shield, TrendingUp, X, Check, ArrowRight } from "lucide-react";

export default function ActivePositions({
  activeTrades = [],
  onCloseTrade,
}) {
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
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Activity size={16} style={{ color: "var(--green)" }} />
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
            Active Market Positions & Live Trade Management
          </h2>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(34, 197, 94, 0.15)",
              color: "var(--green)",
            }}
          >
            {activeTrades.length} Active
          </span>
        </div>
      </div>

      {activeTrades.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: 28,
            color: "var(--muted)",
            fontSize: 13,
            border: "1px dashed var(--border)",
            borderRadius: 8,
          }}
        >
          No open positions. Armed setups will automatically enter upon tapping their staged institutional levels.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 14,
          }}
        >
          {activeTrades.map((t) => {
            const isBuy = t.dir === 1;
            const currentR = t.unrealizedR || 0;
            const isPositive = currentR >= 0;
            const pnlDollars = t.unrealizedPnl || 0;
            const isBe = t.isBreakeven;
            const isTrailing = t.isTrailing;

            // Calculate progress toward TP (0..100)
            const riskDist = Math.abs(t.entryPrice - t.slPrice);
            const targetDist = Math.abs(t.tpPrice - t.entryPrice);
            const currentDist = isBuy ? (t.currentPrice - t.entryPrice) : (t.entryPrice - t.currentPrice);
            let progressPct = 0;
            if (targetDist > 0) {
              progressPct = Math.min(100, Math.max(0, (currentDist / targetDist) * 100));
            }

            return (
              <div
                key={t._id}
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {/* Header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16, fontWeight: 800 }}>{t.symbol}</span>
                    <span
                      style={{
                        padding: "2px 6px",
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 700,
                        background: isBuy ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)",
                        color: isBuy ? "var(--green)" : "var(--red)",
                      }}
                    >
                      {t.dirLabel}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "rgba(255, 255, 255, 0.06)",
                        color: "var(--muted)",
                      }}
                    >
                      {t.scenario?.badge || "15M-1M"}
                    </span>
                  </div>

                  {/* PnL Badge */}
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontWeight: 700,
                      fontSize: 14,
                      color: isPositive ? "var(--green)" : "var(--red)",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span>{isPositive ? "+" : ""}{currentR}R</span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      (${isPositive ? "+" : ""}{pnlDollars})
                    </span>
                  </div>
                </div>

                {/* Coordinates */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 6,
                    background: "rgba(0, 0, 0, 0.25)",
                    padding: 8,
                    borderRadius: 6,
                    fontSize: 11,
                    fontFamily: "monospace",
                  }}
                >
                  <div>
                    <div style={{ color: "var(--muted)", fontSize: 9 }}>FILL ENTRY</div>
                    <div style={{ fontWeight: 700 }}>{t.entryPrice?.toFixed(5)}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--muted)", fontSize: 9 }}>CURRENT</div>
                    <div style={{ fontWeight: 700, color: "var(--accent)" }}>
                      {t.currentPrice ? t.currentPrice.toFixed(5) : t.entryPrice?.toFixed(5)}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "var(--muted)", fontSize: 9 }}>TARGET DOL</div>
                    <div style={{ fontWeight: 700, color: "var(--green)" }}>{t.tpPrice?.toFixed(5)}</div>
                  </div>
                </div>

                {/* Progress toward target */}
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 10,
                      color: "var(--muted)",
                      marginBottom: 4,
                    }}
                  >
                    <span>SL: {t.slPrice?.toFixed(5)}</span>
                    <span>TP: +{t.targetRR || 2}R ({Math.round(progressPct)}% reached)</span>
                  </div>
                  <div
                    style={{
                      width: "100%",
                      height: 6,
                      borderRadius: 3,
                      background: "rgba(255, 255, 255, 0.08)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${progressPct}%`,
                        height: "100%",
                        background: "var(--green)",
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                </div>

                {/* Management Flags */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {isBe && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "rgba(34, 197, 94, 0.15)",
                        color: "var(--green)",
                        border: "1px solid rgba(34, 197, 94, 0.3)",
                      }}
                    >
                      🛡️ BREAKEVEN ARMED
                    </span>
                  )}
                  {isTrailing && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "rgba(168, 85, 247, 0.15)",
                        color: "var(--purple)",
                        border: "1px solid rgba(168, 85, 247, 0.3)",
                      }}
                    >
                      ⚡ TRAILING STOP ACTIVE
                    </span>
                  )}
                </div>

                {/* Manual Close Button */}
                <button
                  onClick={() => onCloseTrade(t._id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 6,
                    background: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "var(--red)",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  <X size={13} /> Close Position Now ({isPositive ? "+" : ""}{currentR}R)
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
