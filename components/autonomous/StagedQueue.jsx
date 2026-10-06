"use client";

import { useState } from "react";
import {
  Zap,
  Check,
  X,
  Edit3,
  Save,
  Maximize2,
  ExternalLink,
  Shield,
  Target,
  Layers,
  ArrowRight,
  Info,
} from "lucide-react";
import RangeTelemetry from "./RangeTelemetry";
import ConfluenceBreakdown from "./ConfluenceBreakdown";
import DecisionReasons from "./DecisionReasons";
import EvidenceDetails from "./EvidenceDetails";
import {
  TelemetryValue,
  TargetLadder,
  formatPrice,
  formatUsd,
  finiteNumber,
  markPriceFor,
} from "./TradeTelemetry";
import { resolveCopierRouting, decodeDecimalMagic } from "../../lib/autonomous/magicEncoder.js";

const actionStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 0.15s ease",
};

export default function StagedQueue({
  stagedTrades = [],
  onApproveTrade,
  onDismissTrade,
  onModifyTrade,
  ticks = {},
  pendingAction,
}) {
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editRR, setEditRR] = useState(2.2);
  const [editTp, setEditTp] = useState("");
  const [saving, setSaving] = useState(false);

  const openDetails = (trade) => {
    setSelectedTrade(trade);
    const level = trade.levelDetails || trade.stagedLevel || {};
    setEditingId(null);
    const isSwing = trade.scenario?.id === "swing" || trade.horizon === "swing" || trade.horizonCode === 1;
    const isProp = trade.managementLogic === "prop_firm_safe";
    const initialRR = Number(trade.targetRR ?? level.rr ?? (isProp ? 2.0 : 2.2));
    setEditRR(isSwing ? initialRR : isProp ? Math.min(2.5, Math.max(1.5, initialRR)) : Math.min(5.0, initialRR));
    setEditTp(trade.tpPrice ?? level.tp ?? "");
  };

  const closeDetails = () => {
    setSelectedTrade(null);
    setEditingId(null);
    setSaving(false);
  };

  const saveEdit = async (trade, level) => {
    setSaving(true);
    try {
      const isSwing = trade.scenario?.id === "swing" || trade.horizon === "swing" || trade.horizonCode === 1;
      const isProp = trade.managementLogic === "prop_firm_safe";
      const clampedRR = isSwing
        ? Math.max(0.5, Number(editRR) || 2.0)
        : isProp
        ? Math.min(2.5, Math.max(1.5, Number(editRR) || 2.0))
        : Math.min(5.0, Math.max(0.5, Number(editRR) || 2.0));
      const parsedTp = editTp ? Number(editTp) : undefined;
      if (onModifyTrade) {
        await onModifyTrade(trade._id, { targetRR: clampedRR, tpPrice: parsedTp });
      } else {
        await fetch("/api/autonomous", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "modify_target", tradeId: trade._id, targetRR: clampedRR, tpPrice: parsedTp }),
        });
      }
      setEditingId(null);
      // update selectedTrade in memory
      setSelectedTrade((prev) =>
        prev && prev._id === trade._id
          ? { ...prev, targetRR: clampedRR, tpPrice: parsedTp }
          : prev
      );
    } catch (err) {
      console.error("Failed to modify trade target:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
        minWidth: 0,
      }}
      aria-label="Ready to Fire and Staged Opportunities"
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Zap size={16} style={{ color: "var(--accent)" }} />
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
            Ready to Fire & Staged Setups
          </h2>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 10,
              background: stagedTrades.length > 0 ? "rgba(56, 189, 248, 0.15)" : "rgba(255, 255, 255, 0.05)",
              color: stagedTrades.length > 0 ? "var(--accent)" : "var(--muted)",
            }}
          >
            {stagedTrades.length}
          </span>
        </div>

        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          Click any setup for deep evidence & target adjustment
        </span>
      </div>

      {/* Main Grid of Minimal Cards */}
      {stagedTrades.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: 32,
            color: "var(--muted)",
            fontSize: 12,
            border: "1px dashed var(--border)",
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Zap size={20} style={{ opacity: 0.3 }} />
          <div>No setups currently staged or ready to fire.</div>
          <div style={{ fontSize: 11, opacity: 0.7 }}>
            The scanner loop monitors the watchlist continuously every 3m for qualified SMC entry models.
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))",
            gap: 12,
          }}
        >
          {stagedTrades.map((trade) => {
            const level = trade.levelDetails || trade.stagedLevel || {};
            const armed = trade.status === "armed";
            const confirming = trade.status === "confirming";
            const vetoes = trade.vetoes || level.vetoes;
            const hasVeto = Array.isArray(vetoes) && vetoes.length > 0;
            const entryVal = Number(trade.entryPrice ?? level.entry);
            const slVal = Number(trade.initialSlPrice ?? trade.slPrice ?? level.sl);
            const tpVal = Number(trade.tpPrice ?? level.tp);
            const rrVal = finiteNumber(trade.targetRR ?? level.rr);
            const confluence = trade.confluenceScore ?? level.confluenceScore ?? 85;
            const routing = trade.copierRouting || resolveCopierRouting(trade);

            return (
              <article
                key={trade._id}
                onClick={() => openDetails(trade)}
                style={{
                  background: armed
                    ? "rgba(34, 197, 94, 0.03)"
                    : "rgba(255, 255, 255, 0.02)",
                  border: `1px solid ${
                    armed
                      ? "rgba(34, 197, 94, 0.4)"
                      : hasVeto
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
                  boxShadow: armed ? "0 4px 14px rgba(34, 197, 94, 0.12)" : "none",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = armed
                    ? "rgba(34, 197, 94, 0.4)"
                    : hasVeto
                    ? "rgba(239, 68, 68, 0.2)"
                    : "var(--border)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {/* Top Row: Symbol, Direction, Status Badge, Confluence */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <strong style={{ fontSize: 15 }}>{trade.symbol}</strong>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background:
                          trade.dir === 1
                            ? "rgba(34, 197, 94, 0.18)"
                            : "rgba(239, 68, 68, 0.18)",
                        color: trade.dir === 1 ? "var(--green)" : "var(--red)",
                      }}
                    >
                      {trade.dir === 1 ? "BUY ▲" : "SELL ▼"}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>
                      {trade.scenario?.badge || trade.tf || "15M"}
                    </span>
                    {trade.managementLogic && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: "1px 5px",
                          borderRadius: 3,
                          background:
                            trade.managementLogic === "prop_firm_safe"
                              ? "rgba(168, 85, 247, 0.18)"
                              : "rgba(56, 189, 248, 0.18)",
                          color:
                            trade.managementLogic === "prop_firm_safe"
                              ? "var(--purple, #c084fc)"
                              : "var(--accent)",
                        }}
                      >
                        {trade.managementLogic === "prop_firm_safe" ? "PROP SAFE" : "DEFAULT (50%)"}
                      </span>
                    )}
                  </div>

                  {/* Ready to fire or armed status badge */}
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: "2px 7px",
                      borderRadius: 4,
                      background: armed
                        ? "rgba(34, 197, 94, 0.2)"
                        : confirming
                        ? "rgba(234, 179, 8, 0.2)"
                        : "rgba(56, 189, 248, 0.15)",
                      color: armed
                        ? "var(--green)"
                        : confirming
                        ? "var(--orange)"
                        : "var(--accent)",
                      border: `1px solid ${
                        armed
                          ? "rgba(34, 197, 94, 0.4)"
                          : confirming
                          ? "rgba(234, 179, 8, 0.4)"
                          : "rgba(56, 189, 248, 0.3)"
                      }`,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {armed ? "⚡ READY TO FIRE" : confirming ? "CONFIRMING" : "STAGED"}
                  </span>
                </div>

                {/* Second Row: Model & Confluence */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 11,
                  }}
                >
                  <span style={{ color: "var(--fg)", fontWeight: 600 }}>
                    {trade.modelId || level.model || "ICT 2022 Setup"}
                  </span>
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontWeight: 700,
                      color: "var(--accent)",
                    }}
                  >
                    Score: {confluence}/100
                  </span>
                </div>

                {/* Minimal Key Levels Chip Grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 6,
                    background: "rgba(0, 0, 0, 0.25)",
                    padding: "6px 8px",
                    borderRadius: 6,
                    fontFamily: "monospace",
                    fontSize: 10,
                    textAlign: "center",
                  }}
                >
                  <div>
                    <div style={{ color: "var(--muted)", fontSize: 9 }}>ENTRY</div>
                    <div style={{ fontWeight: 700, color: "var(--fg)" }}>{formatPrice(entryVal)}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--muted)", fontSize: 9 }}>STOP LOSS</div>
                    <div style={{ fontWeight: 700, color: "var(--red)" }}>{formatPrice(slVal)}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--muted)", fontSize: 9 }}>TARGET ({rrVal ? `${rrVal.toFixed(1)}R` : "TP"})</div>
                    <div style={{ fontWeight: 700, color: "var(--green)" }}>{formatPrice(tpVal)}</div>
                  </div>
                </div>

                {/* Target Landmark Badge (if resolved from Bias Engine) */}
                {(trade.targetLandmark || trade.propTarget?.source) && (
                  <div
                    style={{
                      fontSize: 10,
                      padding: "4px 8px",
                      borderRadius: 5,
                      background: "rgba(168, 85, 247, 0.1)",
                      border: "1px solid rgba(168, 85, 247, 0.25)",
                      color: "var(--purple, #c084fc)",
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      fontFamily: "monospace",
                    }}
                  >
                    <span>🎯</span>
                    <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Landmark: {trade.targetLandmark || trade.propTarget?.source}
                    </span>
                  </div>
                )}

                {/* CFD Spread Friction Telemetry Chip */}
                {trade.coveredRR && (
                  <div
                    style={{
                      fontSize: 10,
                      padding: "4px 8px",
                      borderRadius: 5,
                      background: "rgba(0, 176, 255, 0.08)",
                      border: "1px solid rgba(0, 176, 255, 0.25)",
                      color: "var(--accent, #00b0ff)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontFamily: "monospace",
                    }}
                  >
                    <span>🛡️ Net Covered R: <strong>{trade.coveredRR}R</strong></span>
                    <span style={{ color: "var(--muted)" }}>
                      Spread {trade.spreadPrice ?? 0} (drag -{trade.frictionDragR ?? "0.00"}R · {trade.recoveryPct ?? 64}% recov)
                    </span>
                  </div>
                )}

                {/* Minimal Copier & Magic Telemetry Strip */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 10,
                    fontFamily: "monospace",
                    padding: "4px 8px",
                    borderRadius: 6,
                    background: "rgba(255, 255, 255, 0.03)",
                    border: "1px solid rgba(255, 255, 255, 0.05)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ color: "var(--accent)", fontWeight: 700 }}>⚡ #{trade.magicNumber || routing.magicNumber}</span>
                    <span style={{ color: "var(--muted)", fontSize: 9 }}>({trade.brokerComment || routing.comment})</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 9, color: "var(--muted)" }}>Copier:</span>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "1px 5px",
                        borderRadius: 4,
                        background: routing.eligibleAccounts?.length > 0 ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                        color: routing.eligibleAccounts?.length > 0 ? "var(--green)" : "var(--red)",
                      }}
                    >
                      {routing.eligibleAccounts?.length > 0 ? `${routing.eligibleAccounts.length} Acct${routing.eligibleAccounts.length > 1 ? "s" : ""}` : "Filtered"}
                    </span>
                  </div>
                </div>

                {/* Action Buttons Row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 6,
                    paddingTop: 4,
                    borderTop: "1px solid rgba(255, 255, 255, 0.04)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => openDetails(trade)}
                    style={{
                      ...actionStyle,
                      padding: "4px 8px",
                      background: "transparent",
                      border: "none",
                      color: "var(--accent)",
                      fontSize: 10,
                    }}
                  >
                    <Info size={12} />
                    <span>More Info</span>
                  </button>

                  <div style={{ display: "flex", gap: 6 }}>
                    {trade.status === "staged" && (
                      <button
                        disabled={hasVeto || !!pendingAction}
                        onClick={() => onApproveTrade(trade._id)}
                        style={{
                          ...actionStyle,
                          padding: "4px 10px",
                          background: hasVeto ? "rgba(255, 255, 255, 0.05)" : "var(--accent)",
                          color: hasVeto ? "var(--muted)" : "#fff",
                          border: "none",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: hasVeto ? "not-allowed" : "pointer",
                        }}
                      >
                        <Check size={12} />
                        <span>Approve</span>
                      </button>
                    )}

                    <button
                      disabled={!!pendingAction}
                      onClick={() => onDismissTrade(trade._id)}
                      style={{
                        ...actionStyle,
                        padding: "4px 8px",
                        background: "rgba(255, 255, 255, 0.04)",
                        color: "var(--muted)",
                        fontSize: 11,
                      }}
                      title="Dismiss setup"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* 2. ON-CLICK SETUP DETAILS POPUP MODAL */}
      {selectedTrade && (() => {
        const trade = selectedTrade;
        const level = trade.levelDetails || trade.stagedLevel || {};
        const brain = trade.brainSnapshot || trade.brain || {};
        const armed = trade.status === "armed";
        const confirming = trade.status === "confirming";
        const vetoes = trade.vetoes || level.vetoes;
        const hasVeto = Array.isArray(vetoes) && vetoes.length > 0;
        const isEditing = editingId === trade._id;
        const entryVal = Number(trade.entryPrice ?? level.entry);
        const slVal = Number(trade.initialSlPrice ?? trade.slPrice ?? level.sl);
        const dist = Math.abs(entryVal - slVal);
        const isSwing = trade.scenario?.id === "swing" || trade.horizon === "swing" || trade.horizonCode === 1;
        const isProp = trade.managementLogic === "prop_firm_safe";
        const modalRouting = trade.copierRouting || resolveCopierRouting(trade);
        const modalMagicDecoded = decodeDecimalMagic(trade.magicNumber || modalRouting.magicNumber);

        return (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              background: "rgba(0, 0, 0, 0.75)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "clamp(10px, 3vw, 20px)",
            }}
            onClick={closeDetails}
          >
            <div
              role="dialog"
              aria-modal="true"
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border-hi)",
                borderRadius: 14,
                width: "100%",
                maxWidth: 680,
                maxHeight: "90dvh",
                overflowY: "auto",
                padding: "clamp(12px, 3vw, 22px)",
                display: "flex",
                flexDirection: "column",
                gap: 16,
                boxShadow: "0 24px 60px rgba(0, 0, 0, 0.7)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 8,
                  borderBottom: "1px solid var(--border)",
                  paddingBottom: 12,
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>
                      {trade.symbol} · Setup Details
                    </h2>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        padding: "2px 7px",
                        borderRadius: 4,
                        background:
                          trade.dir === 1
                            ? "rgba(34, 197, 94, 0.2)"
                            : "rgba(239, 68, 68, 0.2)",
                        color: trade.dir === 1 ? "var(--green)" : "var(--red)",
                      }}
                    >
                      {trade.dir === 1 ? "BUY SETUP" : "SELL SETUP"}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: "2px 7px",
                        borderRadius: 4,
                        background: armed
                          ? "rgba(34, 197, 94, 0.2)"
                          : confirming
                          ? "rgba(234, 179, 8, 0.2)"
                          : "rgba(56, 189, 248, 0.15)",
                        color: armed
                          ? "var(--green)"
                          : confirming
                          ? "var(--orange)"
                          : "var(--accent)",
                      }}
                    >
                      {armed ? "⚡ READY TO FIRE" : confirming ? "CONFIRMING" : "STAGED"}
                    </span>
                  </div>

                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                    Model: <strong style={{ color: "var(--accent)" }}>{trade.modelId || level.model || "ICT 2022"}</strong> · Timeframe: {trade.tf || "15M"} · Thesis: {trade.thesisId || brain.thesisId || "Confirmed"}
                  </div>
                </div>

                <button
                  onClick={closeDetails}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--muted)",
                    cursor: "pointer",
                    padding: 4,
                  }}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Macro & Dealing Range Telemetry */}
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
                  Macro Narrative: <strong style={{ color: "var(--fg)" }}>{brain.macroBias || "Bullish expansion"}</strong> · Direction: {brain.macroDir ?? "1"}
                </div>
                <RangeTelemetry brain={brain} range={trade.range} dealingRange={trade.dealingRange} price={markPriceFor(trade, ticks)} compact />
              </div>

              {/* Execution Levels Overview */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 120px), 1fr))",
                  gap: 8,
                  background: "rgba(0, 0, 0, 0.25)",
                  padding: 10,
                  borderRadius: 8,
                }}
              >
                <TelemetryValue label="Planned Entry" value={formatPrice(trade.entryPrice ?? level.entry)} />
                <TelemetryValue label="Initial SL" value={formatPrice(trade.initialSlPrice ?? trade.slPrice ?? level.sl)} color="var(--red)" />
                <TelemetryValue label="Target TP / DOL" value={formatPrice(trade.tpPrice ?? level.tp)} color="var(--green)" />
                <TelemetryValue label="Initial Risk USD" value={formatUsd(trade.initialRiskUsd ?? trade.riskUsd)} color="var(--orange)" />
              </div>

              {/* Target Ladder & Risk Sizing */}
              <TargetLadder targets={trade.targets || level.targets} legacyTarget={trade.tpPrice} />

              {/* Target Landmark Telemetry (if available) */}
              {(trade.targetLandmark || trade.propTarget?.source) && (
                <div
                  style={{
                    background: "rgba(168, 85, 247, 0.08)",
                    border: "1px solid rgba(168, 85, 247, 0.25)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 11,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    color: "var(--purple, #c084fc)",
                    fontFamily: "monospace",
                  }}
                >
                  <span style={{ fontSize: 14 }}>🎯</span>
                  <div>
                    <span style={{ fontWeight: 700 }}>Institutional Target Landmark: </span>
                    <span>{trade.targetLandmark || trade.propTarget?.source}</span>
                    {trade.propTarget?.landmarkType && (
                      <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: 10 }}>
                        ({trade.propTarget.landmarkType} · {trade.propTarget.tf || trade.tf})
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Interactive Target RR & TP Adjustment */}
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    Target Risk-to-Reward:{" "}
                    <span style={{ color: "var(--green)", fontFamily: "monospace" }}>
                      {finiteNumber(trade.targetRR ?? level.rr) === null ? "2.2" : `${trade.targetRR ?? level.rr}R`}
                    </span>
                  </div>

                  {!isEditing && (
                    <button
                      onClick={() => setEditingId(trade._id)}
                      style={{
                        ...actionStyle,
                        padding: "3px 8px",
                        fontSize: 10,
                        color: "var(--accent)",
                        background: "rgba(56, 189, 248, 0.1)",
                        border: "1px solid rgba(56, 189, 248, 0.3)",
                      }}
                    >
                      <Edit3 size={11} /> Modify Target RR / TP {isSwing ? "(Swing — No 5R Limit)" : isProp ? "(Prop-Firm: 1.5R–2.5R)" : "(Max 5.0R)"}
                    </button>
                  )}
                </div>

                {isEditing && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <label style={{ fontSize: 10, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 100 }}>
                        {isSwing ? "Target R:R (Swing Mode — No 5R Limit)" : isProp ? "Target R:R (Prop-Firm Safe: 1.5R–2.5R)" : "Target R:R (Max 5.0R)"}
                        <input
                          type="number"
                          step="0.1"
                          min={isProp ? "1.5" : "0.5"}
                          max={isSwing ? undefined : isProp ? "2.5" : "5.0"}
                          value={editRR}
                          onChange={(e) => {
                            const raw = Number(e.target.value) || 0.1;
                            const r = isSwing ? Math.max(0.1, raw) : isProp ? Math.min(2.5, Math.max(1.5, raw)) : Math.min(5.0, Math.max(0.1, raw));
                            setEditRR(r);
                            if (dist > 0) {
                              setEditTp(Number((entryVal + trade.dir * r * dist).toFixed(5)));
                            }
                          }}
                          style={{
                            background: "rgba(0, 0, 0, 0.4)",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            padding: "6px 8px",
                            fontSize: 12,
                            color: "var(--green)",
                            fontWeight: 700,
                          }}
                        />
                      </label>

                      <label style={{ fontSize: 10, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 120 }}>
                        Target TP Price
                        <input
                          type="number"
                          step="any"
                          value={editTp}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditTp(val);
                            const parsed = Number(val);
                            if (dist > 0 && parsed > 0) {
                              const rawRR = (trade.dir * (parsed - entryVal)) / dist;
                              const rounded = Math.round(rawRR * 10) / 10;
                              setEditRR(isSwing ? Math.max(0.1, rounded) : isProp ? Math.min(2.5, Math.max(1.5, rounded)) : Math.min(5.0, Math.max(0.1, rounded)));
                            }
                          }}
                          style={{
                            background: "rgba(0, 0, 0, 0.4)",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            padding: "6px 8px",
                            fontSize: 12,
                            color: "var(--fg)",
                          }}
                        />
                      </label>
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                      <button
                        disabled={saving}
                        onClick={() => saveEdit(trade, level)}
                        style={{
                          ...actionStyle,
                          padding: "5px 12px",
                          background: "var(--green)",
                          color: "#fff",
                          border: "none",
                        }}
                      >
                        <Save size={11} /> {saving ? "Saving..." : "Apply New Target"}
                      </button>
                      <button
                        disabled={saving}
                        onClick={() => setEditingId(null)}
                        style={{
                          ...actionStyle,
                          padding: "5px 10px",
                          background: "rgba(255, 255, 255, 0.05)",
                          color: "var(--muted)",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Confluence Breakdown */}
              <ConfluenceBreakdown
                breakdown={trade.confluenceBreakdown || level.confluenceBreakdown}
                score={trade.confluenceScore ?? level.confluenceScore}
              />

              {/* Vetoes & Staging Decision Reasons */}
              <DecisionReasons
                vetoes={vetoes}
                reason={trade.statusReason || trade.rejectionReason || level.rejectionReason}
                title="Institutional Gatekeeper & Veto Check"
              />

              {/* Evidence Details */}
              <EvidenceDetails evidence={trade.evidence || level.evidence} />

              {/* Trade Copier & Multi-Account Diversification Matrix */}
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Zap size={14} style={{ color: "var(--accent)" }} />
                    <strong style={{ fontSize: 12 }}>Trade Copier & Multi-Account Diversification Matrix</strong>
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: "monospace",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: "rgba(56, 189, 248, 0.12)",
                      color: "var(--accent)",
                      border: "1px solid rgba(56, 189, 248, 0.25)",
                    }}
                  >
                    Magic: {trade.magicNumber || modalRouting.magicNumber} · Comment: {trade.brokerComment || modalRouting.comment}
                  </span>
                </div>

                {/* Magic Number Positional Breakdown */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                    gap: 6,
                    background: "rgba(0, 0, 0, 0.25)",
                    padding: 8,
                    borderRadius: 6,
                    fontSize: 10,
                    fontFamily: "monospace",
                  }}
                >
                  <div>
                    <span style={{ color: "var(--muted)", fontSize: 9 }}>ASSET CLASS</span>
                    <div style={{ fontWeight: 700, color: "var(--fg)" }}>{modalMagicDecoded.asset?.label || "Asset"}</div>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)", fontSize: 9 }}>HORIZON</span>
                    <div style={{ fontWeight: 700, color: "var(--accent)" }}>{modalMagicDecoded.horizon?.label || "15M-1M"}</div>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)", fontSize: 9 }}>ENTRY MODEL</span>
                    <div style={{ fontWeight: 700, color: "var(--fg)" }}>{modalMagicDecoded.model?.badge || "ICT 2022"}</div>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)", fontSize: 9 }}>MANAGEMENT</span>
                    <div style={{ fontWeight: 700, color: "var(--green)" }}>{modalMagicDecoded.management?.label || "50% Milestone"}</div>
                  </div>
                </div>

                {/* Receiver Accounts Routing Status */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>
                    Receiver Account Routing ({modalRouting.eligibleCount} of {modalRouting.allAccountsCount} Accounts Will Copy):
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {modalRouting.evaluations.map((evalItem) => (
                      <div
                        key={evalItem.profileId}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          gap: 8,
                          padding: "8px 10px",
                          borderRadius: 6,
                          background: evalItem.eligible ? "rgba(34, 197, 94, 0.06)" : "rgba(255, 255, 255, 0.02)",
                          border: `1px solid ${evalItem.eligible ? "rgba(34, 197, 94, 0.25)" : "var(--border)"}`,
                          fontSize: 11,
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontWeight: 700, color: evalItem.eligible ? "var(--fg)" : "var(--muted)" }}>
                              {evalItem.profileName}
                            </span>
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                padding: "1px 5px",
                                borderRadius: 3,
                                background: evalItem.eligible ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                                color: evalItem.eligible ? "var(--green)" : "var(--red)",
                              }}
                            >
                              {evalItem.eligible ? "✓ WILL COPY" : "✗ FILTERED OUT"}
                            </span>
                          </div>
                          <div style={{ fontSize: 10, color: evalItem.eligible ? "var(--green)" : "var(--muted)" }}>
                            {evalItem.eligible
                              ? `Matched: ${evalItem.matches.join(" · ") || "All criteria aligned"}`
                              : `Blocked: ${evalItem.reasons.join(" · ")}`}
                          </div>
                        </div>

                        <div style={{ textAlign: "right", fontFamily: "monospace", fontSize: 10 }}>
                          <div style={{ color: "var(--muted)", fontSize: 9 }}>TARGET RISK</div>
                          <div style={{ fontWeight: 700, color: evalItem.eligible ? "var(--accent)" : "var(--muted)" }}>
                            {evalItem.riskOverridePct ? `${evalItem.riskOverridePct}% Risk` : "Standard Risk"}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Footer Actions */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  borderTop: "1px solid var(--border)",
                  paddingTop: 14,
                }}
              >
                <button
                  onClick={() => {
                    onDismissTrade(trade._id);
                    closeDetails();
                  }}
                  style={{
                    ...actionStyle,
                    padding: "8px 14px",
                    background: "rgba(239, 68, 68, 0.15)",
                    color: "var(--red)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                  }}
                >
                  <X size={13} /> Dismiss Setup
                </button>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={closeDetails}
                    style={{
                      ...actionStyle,
                      padding: "8px 14px",
                      background: "rgba(255, 255, 255, 0.05)",
                      color: "var(--muted)",
                    }}
                  >
                    Close
                  </button>

                  {trade.status === "staged" && (
                    <button
                      disabled={hasVeto || !!pendingAction}
                      onClick={() => {
                        onApproveTrade(trade._id);
                        closeDetails();
                      }}
                      style={{
                        ...actionStyle,
                        padding: "8px 18px",
                        background: hasVeto ? "rgba(255, 255, 255, 0.05)" : "var(--accent)",
                        color: hasVeto ? "var(--muted)" : "#fff",
                        border: "none",
                        fontWeight: 700,
                        cursor: hasVeto ? "not-allowed" : "pointer",
                      }}
                    >
                      <Check size={14} /> Approve & Arm Execution
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}
