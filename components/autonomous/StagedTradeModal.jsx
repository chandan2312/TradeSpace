"use client";

import { useState, useEffect } from "react";
import {
  Target,
  Shield,
  Layers,
  ExternalLink,
  Check,
  X,
  Clock,
  Sparkles,
  TrendingUp,
  CandlestickChart,
} from "lucide-react";
import RangeTelemetry from "./RangeTelemetry";
import ConfluenceBreakdown from "./ConfluenceBreakdown";
import DecisionReasons from "./DecisionReasons";
import EvidenceDetails from "./EvidenceDetails";
import StagedIdeaChart from "./StagedIdeaChart";
import {
  TelemetryValue,
  TargetLadder,
  formatPrice,
  formatUsd,
  formatR,
  tradeRiskTelemetry,
} from "./TradeTelemetry";
import { resolveCopierRouting } from "../../lib/autonomous/magicEncoder";
import { calculateEffectiveGroupRisk } from "../../lib/autonomous/risk";

const actionStyle = {
  padding: "6px 12px",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  border: "1px solid var(--border)",
  transition: "all 0.15s ease",
};

export default function StagedTradeModal({
  setup,
  onClose,
  onApprove,
  onDismiss,
  onModify,
  ticks = {},
  pendingAction,
  executionMode = "auto",
}) {
  const [modalTab, setModalTab] = useState("chart");
  const [editingId, setEditingId] = useState(null);
  const [editRR, setEditRR] = useState(2.2);
  const [editTp, setEditTp] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!setup) return null;

  const trade = setup.primaryTrade || setup;
  const isDual = setup.isDualLeg;
  const defaultLeg = setup.defaultLeg;
  const propLeg = setup.propLeg;
  const level = trade.levelDetails || trade.stagedLevel || {};
  const brain = trade.brainSnapshot || trade.brain || {};
  const armed = setup.status === "armed";
  const confirming = setup.status === "confirming";
  const vetoes = trade.vetoes || level.vetoes;
  const hasVeto = Array.isArray(vetoes) && vetoes.length > 0;
  const entryVal = Number(trade.entryPrice ?? level.entry);
  const slVal = Number(trade.initialSlPrice ?? trade.slPrice ?? level.sl);
  const dist = Math.abs(entryVal - slVal);
  const modalRoutingDefault = defaultLeg ? (defaultLeg.copierRouting || resolveCopierRouting(defaultLeg)) : null;
  const modalRoutingProp = propLeg ? (propLeg.copierRouting || resolveCopierRouting(propLeg)) : null;
  const modalRouting = trade.copierRouting || resolveCopierRouting(trade);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0, 0, 0, 0.78)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(8px, 2.5vw, 18px)",
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border-hi)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 840,
          maxHeight: "92dvh",
          overflowY: "auto",
          padding: "clamp(12px, 3vw, 20px)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.75)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pinned Sticky Header & Navigation Tabs Container */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 25,
            background: "var(--panel)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            flexShrink: 0,
            paddingTop: 2,
            paddingBottom: 8,
            borderBottom: "1px solid var(--border)",
          }}
        >
          {/* Modal Header */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 8,
              flexShrink: 0,
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, letterSpacing: "-0.01em" }}>
                  {trade.symbol} · {isDual ? "Dual-Leg Execution Setup" : "Setup Details"}
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
                  {trade.dir === 1 ? "BUY SETUP ▲" : "SELL SETUP ▼"}
                </span>
                {isDual && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "rgba(168, 85, 247, 0.18)",
                      color: "var(--purple, #c084fc)",
                      border: "1px solid rgba(168, 85, 247, 0.3)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Layers size={11} /> DUAL EXECUTION (50% + PROP)
                  </span>
                )}
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
              onClick={onClose}
              aria-label="Close setup modal"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--muted)",
                cursor: "pointer",
                padding: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <X size={20} />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              overflowX: "auto",
              flexShrink: 0,
              minHeight: 36,
              padding: "2px 2px 4px 2px",
              scrollbarWidth: "none",
            }}
          >
            {[
              { id: "chart", label: "Chart & Overview", icon: CandlestickChart },
              { id: "targets", label: "Dual Targets & Modifiers", icon: Target },
              { id: "confluence", label: "Confluence & Evidence", icon: Sparkles },
              { id: "gatekeeper", label: "Gatekeeper & Veto", icon: Shield },
              { id: "all", label: "All Details (Audit)", icon: Layers },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = modalTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setModalTab(tab.id)}
                  className="modal-tab-btn"
                  title={tab.label}
                  aria-label={tab.label}
                  style={{
                    flexShrink: 0,
                    minHeight: 30,
                    padding: "6px 12px",
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 6,
                    border: "1px solid",
                    borderColor: active ? "var(--accent)" : "transparent",
                    background: active ? "var(--panel-2)" : "transparent",
                    color: active ? "var(--fg)" : "var(--muted)",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    whiteSpace: "nowrap",
                    lineHeight: 1.2,
                    transition: "all 0.15s ease",
                  }}
                >
                  <Icon size={13} style={{ color: active ? "var(--accent)" : "currentColor", flexShrink: 0 }} />
                  <span className="modal-tab-label">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* TAB 1: CHART & OVERVIEW */}
        {(modalTab === "chart" || modalTab === "all") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Interactive Candlestick Chart with Upgraded Staged RR Tool */}
            <StagedIdeaChart trade={setup} ticks={ticks} height={320} />

            {/* Shared Execution Key Levels Quick Overview */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 120px), 1fr))",
                gap: 8,
                background: "var(--panel-2)",
                padding: 10,
                borderRadius: 8,
                border: "1px solid var(--border)",
              }}
            >
              <TelemetryValue label="Planned Entry" value={formatPrice(trade.entryPrice ?? level.entry)} />
              <TelemetryValue
                label="Structural SL"
                value={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                    <span>{formatPrice(trade.initialSlPrice ?? trade.slPrice ?? level.sl)}</span>
                    {(trade.slAudit?.anchorType || level.slAudit?.anchorType) && (
                      <span style={{ fontSize: 9, color: "var(--accent)", background: "rgba(56, 189, 248, 0.12)", padding: "1px 4px", borderRadius: 3, fontWeight: 700 }}>
                        {(trade.slAudit?.anchorType || level.slAudit?.anchorType).replace(/_/g, " ")}
                      </span>
                    )}
                  </span>
                }
                color="var(--red)"
              />
              <TelemetryValue label="50% Milestone" value={`${formatPrice(setup.halfPrice)} (${Number(setup.halfRR || 2.2).toFixed(1)}R)`} color="#f59e0b" />
              <TelemetryValue label="Prop Target" value={`${formatPrice(setup.propTp)} (${Number(setup.propRR || 2.0).toFixed(1)}R)`} color="#06b6d4" />
              <TelemetryValue label="Full Runner TP" value={`${formatPrice(setup.fullTp)} (${Number(setup.fullRR || 4.5).toFixed(1)}R)`} color="var(--green)" />
              <TelemetryValue label="Risk Distance" value={`${dist.toFixed(5)} (${trade.riskPips ? `${trade.riskPips} pips` : `${Math.round(dist * 10000)} pts`})`} color="var(--accent)" />
            </div>

            {/* Dealing Range Position */}
            {level.dealingRange && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>
                  Dealing Range Geometry
                </div>
                <RangeTelemetry range={level.dealingRange} currentPrice={entryVal} />
              </div>
            )}
          </div>
        )}

        {/* TAB 2: DUAL TARGETS & MODIFIERS */}
        {(modalTab === "targets" || modalTab === "all") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent)", display: "flex", alignItems: "center", gap: 6 }}>
              <Layers size={14} /> Dual Management Pipelines (Default + Prop-Firm)
            </div>

            {/* Leg A: Default Milestone Pathway */}
            {defaultLeg && (
              <div
                style={{
                  background: "var(--panel-2)",
                  border: "1px solid rgba(56, 189, 248, 0.3)",
                  borderRadius: 10,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 4, background: "rgba(56, 189, 248, 0.2)", color: "var(--accent)" }}>
                      PATHWAY A · DEFAULT LEG
                    </span>
                    <strong style={{ fontSize: 13 }}>50% Milestone + Full Runner</strong>
                    {defaultLeg.isPaper && (
                      <span style={{ fontSize: 10, color: "var(--muted)", background: "rgba(255,255,255,0.06)", padding: "1px 5px", borderRadius: 4 }}>
                        Paper Shadow
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, fontFamily: "monospace", color: "var(--accent)" }}>
                    Alloc: {defaultLeg.lotSize ? `${defaultLeg.lotSize} lots` : "1.0%"} · Target: {defaultLeg.targetRR || 4.5}R
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    background: "rgba(0, 0, 0, 0.2)",
                    padding: 8,
                    borderRadius: 6,
                    fontSize: 11,
                    fontFamily: "monospace",
                  }}
                >
                  <div>
                    <span style={{ color: "var(--muted)" }}>50% Target: </span>
                    <strong style={{ color: "#f59e0b" }}>{formatPrice(setup.halfPrice)} ({Number(setup.halfRR || 2.2).toFixed(1)}R)</strong>
                    <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 2 }}>
                      • Books 40% position quantity<br />
                      • Moves Stop-Loss to Breakeven<br />
                      • Triggers Redecision Engine
                    </div>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)" }}>Full Runner: </span>
                    <strong style={{ color: "var(--green)" }}>{formatPrice(setup.fullTp)} ({Number(setup.fullRR || 4.5).toFixed(1)}R)</strong>
                    <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 2 }}>
                      • Runs 60% to Draw on Liquidity<br />
                      • Dynamic trailing stop active
                    </div>
                  </div>
                </div>

                {defaultLeg.targets?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>
                      Default Leg Target Ladder
                    </div>
                    <TargetLadder targets={defaultLeg.targets} entryPrice={entryVal} slPrice={slVal} dir={trade.dir} />
                  </div>
                )}
              </div>
            )}

            {/* Leg B: Prop-Firm Safe Pathway */}
            {propLeg && (
              <div
                style={{
                  background: "var(--panel-2)",
                  border: "1px solid rgba(168, 85, 247, 0.3)",
                  borderRadius: 10,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 4, background: "rgba(168, 85, 247, 0.2)", color: "var(--purple, #c084fc)" }}>
                      PATHWAY B · PROP-FIRM SAFE
                    </span>
                    <strong style={{ fontSize: 13 }}>Protected Fixed Bracket (1.5R–2.5R)</strong>
                  </div>
                  <div style={{ fontSize: 11, fontFamily: "monospace", color: "var(--purple, #c084fc)" }}>
                    Alloc: {propLeg.lotSize ? `${propLeg.lotSize} lots` : "1.0%"} · Target: {propLeg.targetRR || 2.0}R
                  </div>
                </div>

                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.2)",
                    padding: 8,
                    borderRadius: 6,
                    fontSize: 11,
                    fontFamily: "monospace",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <span style={{ color: "var(--muted)" }}>Target Price: </span>
                    <strong style={{ color: "var(--purple, #c084fc)" }}>{formatPrice(setup.propTp)}</strong>
                    <span style={{ color: "var(--muted)", marginLeft: 6 }}>({Number(setup.propRR || 2.0).toFixed(1)}R)</span>
                  </div>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>
                    100% Exit at Landmark Target
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: CONFLUENCE & EVIDENCE */}
        {(modalTab === "confluence" || modalTab === "all") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {level.confluenceBreakdown && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>
                  Confluence Breakdown (Score: {level.confluenceScore ?? trade.confluenceScore ?? 85}/100)
                </div>
                <ConfluenceBreakdown breakdown={level.confluenceBreakdown} />
              </div>
            )}
            {level.evidence && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>
                  Model Evidence & Structural Formations
                </div>
                <EvidenceDetails evidence={level.evidence} />
              </div>
            )}
          </div>
        )}

        {/* TAB 4: GATEKEEPER & VETO */}
        {(modalTab === "gatekeeper" || modalTab === "all") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>
                Gatekeeper Veto Evaluation
              </div>
              {hasVeto ? (
                <div
                  style={{
                    background: "rgba(239, 68, 68, 0.12)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    borderRadius: 8,
                    padding: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--red)", display: "flex", alignItems: "center", gap: 6 }}>
                    <Shield size={14} /> Active Vetoes Preventing Armed Execution
                  </div>
                  {vetoes.map((v, i) => (
                    <div key={i} style={{ fontSize: 11, color: "var(--red)", fontFamily: "monospace" }}>
                      • {v.code ? `[${v.code}] ` : ""}{v.reason || v.message || JSON.stringify(v)}
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    background: "rgba(34, 197, 94, 0.1)",
                    border: "1px solid rgba(34, 197, 94, 0.25)",
                    borderRadius: 8,
                    padding: 10,
                    color: "var(--green)",
                    fontSize: 12,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Check size={14} /> All Gatekeeper & Veto checks cleared successfully.
                </div>
              )}
            </div>

            {/* Copier Routing Profiles */}
            <div
              style={{
                background: "var(--panel-2)",
                padding: 10,
                borderRadius: 8,
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>
                Downstream Receiver Copier Routing
              </div>
              <div style={{ fontSize: 11, fontFamily: "monospace", display: "flex", flexDirection: "column", gap: 4 }}>
                <div>Magic Number: <strong style={{ color: "var(--accent)" }}>{modalRouting?.magicNumber || "23224100"}</strong></div>
                <div>Broker Comment: <strong style={{ color: "var(--fg)" }}>{trade.brokerComment || modalRouting?.comment || "TS:AUTO"}</strong></div>
                <div>Eligible Accounts: <strong style={{ color: "var(--green)" }}>{modalRouting?.eligibleAccounts?.length || 0} account(s)</strong></div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: ALL DETAILS (AUDIT) */}
        {modalTab === "all" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
              Raw Setup JSON Audit
            </div>
            <pre
              style={{
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 10,
                fontSize: 10,
                fontFamily: "monospace",
                overflowX: "auto",
                maxHeight: 200,
              }}
            >
              {JSON.stringify({ id: trade._id, symbol: trade.symbol, dir: trade.dir, entry: entryVal, sl: slVal, halfPrice: setup.halfPrice, propTp: setup.propTp, fullTp: setup.fullTp, model: trade.modelId, vetoes }, null, 2)}
            </pre>
          </div>
        )}

        {/* Modal Actions Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
            gap: 8,
            flexWrap: "wrap",
            flexShrink: 0,
          }}
        >
          {onDismiss && (
            <button
              onClick={() => {
                onDismiss(setup);
                onClose();
              }}
              style={{
                ...actionStyle,
                padding: "8px 14px",
                background: "rgba(239, 68, 68, 0.15)",
                color: "var(--red)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
              }}
            >
              <X size={13} /> {isDual ? "Dismiss Dual Setup" : "Dismiss Setup"}
            </button>
          )}

          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button
              onClick={onClose}
              style={{
                ...actionStyle,
                padding: "8px 14px",
                background: "rgba(255, 255, 255, 0.05)",
                color: "var(--muted)",
              }}
            >
              Close
            </button>

            {onApprove && setup.status === "staged" && (
              <button
                disabled={hasVeto || !!pendingAction}
                onClick={() => {
                  onApprove(setup);
                  onClose();
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
                <Check size={14} /> {isDual ? "Approve & Arm Dual Execution" : "Approve & Arm Execution"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
