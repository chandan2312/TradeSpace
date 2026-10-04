"use client";

import { Zap, Check, X, ArrowUpRight, ArrowDownRight, Target, Shield, AlertCircle } from "lucide-react";

export default function StagedQueue({
  stagedTrades = [],
  onApproveTrade,
  onDismissTrade,
  executionMode = "paper",
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
          <Zap size={16} style={{ color: "var(--accent)" }} />
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
            Staged Institutional Setups (Copilot & Pending Fills)
          </h2>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(56, 189, 248, 0.15)",
              color: "var(--accent)",
            }}
          >
            {stagedTrades.length}
          </span>
        </div>
      </div>

      {stagedTrades.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: 32,
            color: "var(--muted)",
            fontSize: 13,
            border: "1px dashed var(--border)",
            borderRadius: 8,
          }}
        >
          No pending staged setups. Universe scanner continuously monitors for high-conviction institutional setups.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 14,
          }}
        >
          {stagedTrades.map((t) => {
            const isBuy = t.dir === 1;
            const level = t.levelDetails || {};
            const brain = t.brainSnapshot || {};
            const isArmed = t.status === "armed";

            return (
              <div
                key={t._id}
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: `1px solid ${isArmed ? "rgba(34, 197, 94, 0.3)" : "var(--border)"}`,
                  borderRadius: 10,
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {/* Card Header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 800 }}>{t.symbol}</span>
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
                    {t.entryModel && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: "rgba(56, 189, 248, 0.15)",
                          color: "var(--accent)",
                          border: "1px solid rgba(56, 189, 248, 0.3)",
                        }}
                      >
                        {t.entryModel.badge || t.entryModel.name}
                      </span>
                    )}
                  </div>

                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: isArmed ? "rgba(34, 197, 94, 0.15)" : "rgba(234, 179, 8, 0.15)",
                      color: isArmed ? "var(--green)" : "var(--orange)",
                      border: `1px solid ${isArmed ? "rgba(34, 197, 94, 0.3)" : "rgba(234, 179, 8, 0.3)"}`,
                    }}
                  >
                    {isArmed ? "ARMED (WATCHING TAP)" : "COPILOT STAGED"}
                  </span>
                </div>

                {/* Staged Level Rationale & Entry Model */}
                <div style={{ fontSize: 12, color: "var(--fg)", lineHeight: 1.4 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 2 }}>
                    <span style={{ fontWeight: 700, color: "var(--accent)" }}>
                      {level.label || "Institutional Entry Level"}
                    </span>
                    {t.activeTimeSlot && (
                      <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "monospace" }}>
                        {t.activeTimeSlot.name}
                      </span>
                    )}
                  </div>
                  {t.entryModel?.rationale && (
                    <div style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.85)", marginBottom: 4, fontStyle: "italic" }}>
                      "{t.entryModel.rationale}"
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: "var(--muted)" }}>
                    Confluence Score: {level.confluenceScore || 70}/100 · Tags:{" "}
                    {(level.confluenceTags || []).join(" · ")}
                  </div>
                </div>

                {/* Price Coordinates Grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 8,
                    background: "rgba(0, 0, 0, 0.2)",
                    padding: 8,
                    borderRadius: 6,
                    fontSize: 11,
                    fontFamily: "monospace",
                  }}
                >
                  <div>
                    <div style={{ color: "var(--muted)", fontSize: 9 }}>ENTRY ZONE</div>
                    <div style={{ fontWeight: 700, color: "var(--fg)" }}>{t.entryPrice?.toFixed(5)}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--muted)", fontSize: 9 }}>INVALIDATION (SL)</div>
                    <div style={{ fontWeight: 700, color: "var(--red)" }}>{t.slPrice?.toFixed(5)}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--muted)", fontSize: 9 }}>TARGET DOL (TP)</div>
                    <div style={{ fontWeight: 700, color: "var(--green)" }}>{t.tpPrice?.toFixed(5)}</div>
                  </div>
                </div>

                {/* Risk and R:R row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 11,
                  }}
                >
                  <span style={{ color: "var(--muted)" }}>
                    Risk: ${Math.round(t.riskUsd || 500)} ({t.lotSize || 0.1} lots)
                  </span>
                  <span style={{ fontWeight: 700, color: "var(--green)", fontFamily: "monospace" }}>
                    R:R: +{t.targetRR || 2}R
                  </span>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  {!isArmed ? (
                    <button
                      onClick={() => onApproveTrade(t._id)}
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        padding: "6px 10px",
                        borderRadius: 6,
                        background: "rgba(34, 197, 94, 0.2)",
                        border: "1px solid rgba(34, 197, 94, 0.4)",
                        color: "var(--green)",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      <Check size={13} /> Approve & Arm
                    </button>
                  ) : (
                    <div
                      style={{
                        flex: 1,
                        textAlign: "center",
                        padding: "6px 10px",
                        fontSize: 11,
                        color: "var(--green)",
                        background: "rgba(34, 197, 94, 0.08)",
                        borderRadius: 6,
                      }}
                    >
                      Armed: Waiting for price to tap entry zone
                    </div>
                  )}

                  <button
                    onClick={() => onDismissTrade(t._id)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "6px 10px",
                      borderRadius: 6,
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid var(--border)",
                      color: "var(--muted)",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                    title="Dismiss Setup"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
