"use client";

import { useState, useMemo } from "react";
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
import { resolveCopierRouting } from "../../lib/autonomous/magicEncoder.js";

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

/**
 * Combines sibling legs of the same trade opportunity (e.g. Default milestone + Prop Safe)
 * into a single unified setup card, while preserving multi-leg execution telemetry.
 */
export function groupStagedTrades(trades = []) {
  if (!Array.isArray(trades) || trades.length === 0) return [];

  const groups = new Map();

  for (const trade of trades) {
    if (!trade) continue;
    const entryStr = Number(trade.entryPrice ?? trade.levelDetails?.entry ?? 0).toFixed(5);
    const slStr = Number(trade.initialSlPrice ?? trade.slPrice ?? trade.levelDetails?.sl ?? 0).toFixed(5);
    const key = trade.groupId || `${trade.symbol}_${trade.dir}_${entryStr}_${slStr}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(trade);
  }

  const unified = [];

  for (const [key, items] of groups.entries()) {
    const defaultLegRaw = items.find((t) => t.legId === "default" || t.managementLogic === "milestone_50");
    const propLegRaw = items.find((t) => t.legId === "prop_firm" || t.managementLogic === "prop_firm_safe");

    const base = defaultLegRaw || propLegRaw || items[0];
    const level = base.levelDetails || base.stagedLevel || {};
    const dir = Number(base.dir || 1);
    const entry = Number(base.entryPrice ?? level.entry);
    const sl = Number(base.initialSlPrice ?? base.slPrice ?? level.sl);
    const riskDist = Math.abs(entry - sl) || 0.001;

    // Full target resolution (matching Market Radar full structural TP)
    const fullTp = Number(defaultLegRaw?.tpPrice ?? base.fullTp ?? level.fullTp ?? level.tp ?? base.tpPrice);
    const fullRR = Number(defaultLegRaw?.targetRR ?? base.fullRR ?? level.fullRR ?? level.rr ?? (riskDist > 0 ? Math.abs(fullTp - entry) / riskDist : 3.0));

    // 50% Milestone resolution
    const halfTarget = defaultLegRaw?.halfTarget || base.halfTarget || level.halfTarget;
    const halfRR = halfTarget?.halfRR != null ? Number(halfTarget.halfRR) : Number((fullRR * 0.5).toFixed(2));
    const halfPrice = halfTarget?.price != null ? Number(halfTarget.price) : Number((entry + dir * Math.abs(fullTp - entry) * 0.5).toFixed(5));

    // Prop Target resolution
    const propTarget = propLegRaw?.propTarget || base.propTarget || level.propTarget;
    const propRR = Number(propLegRaw?.targetRR ?? base.propRR ?? propTarget?.targetRR ?? 2.0);
    const propTp = Number(propLegRaw?.tpPrice ?? base.propTp ?? propTarget?.tpPrice ?? (entry + dir * (riskDist * propRR)));

    // Reconstruct defaultLeg if missing
    const defaultLeg = defaultLegRaw || {
      ...base,
      _id: `${base._id}_def_synth`,
      legId: "default",
      legLabel: "Default (50% Milestone + Runner)",
      managementLogic: "milestone_50",
      entryPrice: entry,
      slPrice: sl,
      tpPrice: fullTp,
      targetRR: fullRR,
      halfTarget: { halfRR, price: halfPrice },
      isSynthesized: true,
    };

    // Reconstruct propLeg if missing
    const propLeg = propLegRaw || {
      ...base,
      _id: `${base._id}_prop_synth`,
      legId: "prop_firm",
      legLabel: "Prop-Firm Safe (1.5R–2.5R)",
      managementLogic: "prop_firm_safe",
      entryPrice: entry,
      slPrice: sl,
      tpPrice: propTp,
      targetRR: propRR,
      propTarget,
      targetLandmark: propLegRaw?.targetLandmark || base.targetLandmark || propTarget?.source,
      isSynthesized: true,
    };

    const primaryTrade = defaultLegRaw || base;
    const armed = items.some((t) => t.status === "armed");
    const confirming = items.some((t) => t.status === "confirming");
    const status = armed ? "armed" : confirming ? "confirming" : primaryTrade.status;

    unified.push({
      ...primaryTrade,
      groupKey: key,
      isDualLeg: true,
      status,
      primaryTrade,
      tradeIds: items.map((t) => t._id),
      primaryId: primaryTrade._id,
      defaultLeg,
      propLeg,
      fullTp,
      fullRR,
      halfPrice,
      halfRR,
      propTp,
      propRR,
      legs: [defaultLeg, propLeg],
    });
  }

  return unified;
}

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

  const unifiedSetups = useMemo(() => groupStagedTrades(stagedTrades), [stagedTrades]);

  const handleApprove = async (setup) => {
    if (!onApproveTrade) return;
    const primaryId = setup.primaryId || setup._id;
    await onApproveTrade(primaryId);
    if (!setup.groupId && Array.isArray(setup.tradeIds)) {
      const remainingIds = setup.tradeIds.filter((id) => id !== primaryId);
      for (const id of remainingIds) {
        await onApproveTrade(id);
      }
    }
  };

  const handleDismiss = async (setup) => {
    if (!onDismissTrade) return;
    const primaryId = setup.primaryId || setup._id;
    await onDismissTrade(primaryId);
    if (!setup.groupId && Array.isArray(setup.tradeIds)) {
      const remainingIds = setup.tradeIds.filter((id) => id !== primaryId);
      for (const id of remainingIds) {
        await onDismissTrade(id);
      }
    }
  };

  const openDetails = (setup) => {
    setSelectedTrade(setup);
    const trade = setup.primaryTrade || setup;
    const level = trade.levelDetails || trade.stagedLevel || {};
    setEditingId(null);
    const isSwing = trade.scenario?.id === "swing" || trade.horizon === "swing" || trade.horizonCode === 1;
    const isScalp = trade.scenario?.id === "scalp" || trade.horizon === "scalp" || trade.horizonCode === 3;
    const isProp = trade.managementLogic === "prop_firm_safe";
    const initialRR = Number(trade.targetRR ?? level.rr ?? (isProp ? 2.0 : 2.2));
    setEditRR(isProp ? Math.min(2.5, Math.max(1.5, initialRR)) : Math.max(0.5, initialRR));
    setEditTp(trade.tpPrice ?? level.tp ?? "");
  };

  const closeDetails = () => {
    setSelectedTrade(null);
    setEditingId(null);
    setSaving(false);
  };

  const saveEdit = async (targetTrade, overrideRR, overrideTp) => {
    setSaving(true);
    try {
      const tradeToEdit = targetTrade || selectedTrade?.primaryTrade || selectedTrade;
      const isProp = tradeToEdit.managementLogic === "prop_firm_safe";
      const rrToUse = overrideRR != null ? overrideRR : editRR;
      const tpToUse = overrideTp != null ? overrideTp : editTp;

      const clampedRR = isProp
        ? Math.min(2.5, Math.max(1.5, Number(rrToUse) || 2.0))
        : Math.max(0.5, Number(rrToUse) || 2.0);
      const parsedTp = tpToUse ? Number(tpToUse) : undefined;

      if (onModifyTrade) {
        await onModifyTrade(tradeToEdit._id, { targetRR: clampedRR, tpPrice: parsedTp });
      } else {
        await fetch("/api/autonomous", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "modify_target", tradeId: tradeToEdit._id, targetRR: clampedRR, tpPrice: parsedTp }),
        });
      }
      setEditingId(null);

      // update selectedTrade in memory
      setSelectedTrade((prev) => {
        if (!prev) return null;
        if (prev._id === tradeToEdit._id) {
          return { ...prev, targetRR: clampedRR, tpPrice: parsedTp };
        }
        if (prev.defaultLeg && prev.defaultLeg._id === tradeToEdit._id) {
          return {
            ...prev,
            defaultLeg: { ...prev.defaultLeg, targetRR: clampedRR, tpPrice: parsedTp },
          };
        }
        if (prev.propLeg && prev.propLeg._id === tradeToEdit._id) {
          return {
            ...prev,
            propLeg: { ...prev.propLeg, targetRR: clampedRR, tpPrice: parsedTp },
          };
        }
        return prev;
      });
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
              background: unifiedSetups.length > 0 ? "rgba(56, 189, 248, 0.15)" : "rgba(255, 255, 255, 0.05)",
              color: unifiedSetups.length > 0 ? "var(--accent)" : "var(--muted)",
            }}
          >
            {unifiedSetups.length}
          </span>
        </div>

        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          Click any setup for deep evidence & target adjustment
        </span>
      </div>

      {/* Main Grid of Minimal Cards */}
      {unifiedSetups.length === 0 ? (
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
            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))",
            gap: 12,
          }}
        >
          {unifiedSetups.map((setup) => {
            const trade = setup.primaryTrade || setup;
            const level = trade.levelDetails || trade.stagedLevel || {};
            const defaultLeg = setup.defaultLeg;
            const propLeg = setup.propLeg;
            const armed = setup.status === "armed";
            const confirming = setup.status === "confirming";
            const vetoes = trade.vetoes || level.vetoes;
            const hasVeto = Array.isArray(vetoes) && vetoes.length > 0;
            const entryVal = Number(trade.entryPrice ?? level.entry);
            const slVal = Number(trade.initialSlPrice ?? trade.slPrice ?? level.sl);
            const dist = Math.abs(entryVal - slVal);
            const confluence = trade.confluenceScore ?? level.confluenceScore ?? 85;
            const routingDefault = defaultLeg ? (defaultLeg.copierRouting || resolveCopierRouting(defaultLeg)) : null;
            const routingProp = propLeg ? (propLeg.copierRouting || resolveCopierRouting(propLeg)) : null;
            const routingSingle = !setup.isDualLeg ? (trade.copierRouting || resolveCopierRouting(trade)) : null;
            const isApproving = setup.tradeIds?.some((id) => pendingAction === id) || pendingAction === setup._id;

            return (
              <article
                key={setup.groupKey || setup._id}
                onClick={() => openDetails(setup)}
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
                {/* Top Row: Symbol, Direction, Mode, Status */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
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
                    {setup.isDualLeg ? (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          padding: "2px 6px",
                          borderRadius: 3,
                          background: "rgba(168, 85, 247, 0.15)",
                          color: "var(--purple, #c084fc)",
                          border: "1px solid rgba(168, 85, 247, 0.3)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <Layers size={10} /> DUAL EXECUTION (50% + PROP)
                      </span>
                    ) : trade.managementLogic && (
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

                {/* Shared Key Levels: Entry & Stop Loss */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, 1fr)",
                    gap: 6,
                    background: "var(--panel-2)",
                    padding: "6px 10px",
                    borderRadius: 6,
                    fontFamily: "monospace",
                    fontSize: 10,
                    textAlign: "center",
                  }}
                >
                  <div>
                    <div style={{ color: "var(--muted)", fontSize: 9 }}>PLANNED ENTRY</div>
                    <div style={{ fontWeight: 700, color: "var(--fg)" }}>{formatPrice(entryVal)}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--muted)", fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", gap: 3, flexWrap: "wrap" }}>
                      <span>STRUCTURAL SL</span>
                      {(trade.slAudit?.anchorType || level.slAudit?.anchorType) && (
                        <span style={{ fontSize: 7.5, color: "var(--accent)", background: "rgba(56, 189, 248, 0.12)", padding: "1px 4px", borderRadius: 3, fontWeight: 700 }}>
                          {(trade.slAudit?.anchorType || level.slAudit?.anchorType).replace(/_/g, " ")}
                        </span>
                      )}
                    </div>
                    <div style={{ fontWeight: 700, color: "var(--red)" }}>{formatPrice(slVal)}</div>
                  </div>
                </div>

                {/* Dual Management Pathways: Trade Default (50% Milestone + Full TP) vs Prop Safe (1.5R–2.5R) */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {/* Pathway 1: Default Milestone & Full Runner Target */}
                  <div
                    style={{
                      background: "rgba(56, 189, 248, 0.04)",
                      border: "1px solid rgba(56, 189, 248, 0.22)",
                      borderRadius: 6,
                      padding: "6px 8px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      fontSize: 10,
                      fontFamily: "monospace",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 4 }}>
                      <span style={{ fontWeight: 800, color: "var(--accent)", fontSize: 9.5, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Target size={11} /> PATH A · DEFAULT (50% + RUNNER)
                      </span>
                      {(defaultLeg?.magicNumber || routingDefault?.magicNumber) && (
                        <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 9 }}>
                          ⚡ MT5 #{defaultLeg?.magicNumber || routingDefault?.magicNumber}
                        </span>
                      )}
                    </div>

                    {/* 50% Milestone Level */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "var(--panel-2)",
                        padding: "3px 6px",
                        borderRadius: 4,
                      }}
                    >
                      <span style={{ color: "var(--muted)", fontSize: 9.5 }}>
                        50% LEVEL: <strong style={{ color: "var(--accent)" }}>{formatPrice(setup.halfPrice)}</strong> ({Number(setup.halfRR || 2.2).toFixed(1)}R)
                      </span>
                      <span style={{ fontSize: 8.5, color: "var(--accent)", fontWeight: 700, background: "rgba(56, 189, 248, 0.15)", padding: "1px 5px", borderRadius: 3 }}>
                        40% Book + BE SL
                      </span>
                    </div>

                    {/* Full TP Level (matching Market Radar) */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "var(--panel-2)",
                        padding: "3px 6px",
                        borderRadius: 4,
                      }}
                    >
                      <span style={{ color: "var(--muted)", fontSize: 9.5 }}>
                        FULL TP: <strong style={{ color: "var(--green)" }}>{formatPrice(setup.fullTp)}</strong> ({Number(setup.fullRR || 4.5).toFixed(1)}R)
                      </span>
                      <span style={{ fontSize: 8.5, color: "var(--green)", fontWeight: 700, background: "rgba(34, 197, 94, 0.15)", padding: "1px 5px", borderRadius: 3 }}>
                        60% to DOL
                      </span>
                    </div>

                    {defaultLeg?.coveredRR && (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--muted)", fontSize: 8.5 }}>
                        <span>🛡️ Net Covered: <strong style={{ color: "var(--accent)" }}>{defaultLeg.coveredRR}R</strong></span>
                        <span style={{ color: "var(--muted)" }}>drag -{defaultLeg.frictionDragR ?? "0.00"}R</span>
                      </div>
                    )}
                  </div>

                  {/* Pathway 2: Prop-Firm Safe */}
                  <div
                    style={{
                      background: "rgba(168, 85, 247, 0.04)",
                      border: "1px solid rgba(168, 85, 247, 0.22)",
                      borderRadius: 6,
                      padding: "6px 8px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      fontSize: 10,
                      fontFamily: "monospace",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 4 }}>
                      <span style={{ fontWeight: 800, color: "var(--purple, #c084fc)", fontSize: 9.5, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Shield size={11} /> PATH B · PROP-FIRM SAFE
                      </span>
                      {(propLeg?.magicNumber || routingProp?.magicNumber) && (
                        <span style={{ color: "var(--purple, #c084fc)", fontWeight: 700, fontSize: 9 }}>
                          ⚡ MT5 #{propLeg?.magicNumber || routingProp?.magicNumber}
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "var(--panel-2)",
                        padding: "3px 6px",
                        borderRadius: 4,
                      }}
                    >
                      <span style={{ color: "var(--muted)", fontSize: 9.5 }}>
                        PROP TARGET: <strong style={{ color: "var(--green)" }}>{formatPrice(setup.propTp)}</strong> ({Number(setup.propRR || 2.0).toFixed(1)}R)
                      </span>
                      <span style={{ fontSize: 8.5, color: "var(--purple, #c084fc)", fontWeight: 700, background: "rgba(168, 85, 247, 0.15)", padding: "1px 5px", borderRadius: 3 }}>
                        100% Exit
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--muted)", fontSize: 8.5, flexWrap: "wrap", gap: 4 }}>
                      <span>1.0R → -0.5R Risk · 1.5R → BE</span>
                      {(propLeg?.targetLandmark || propLeg?.propTarget?.source) && (
                        <span style={{ color: "var(--purple, #c084fc)", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140, whiteSpace: "nowrap" }}>
                          🎯 {propLeg?.targetLandmark || propLeg?.propTarget?.source}
                        </span>
                      )}
                    </div>

                    {propLeg?.coveredRR && (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--muted)", fontSize: 8.5 }}>
                        <span>🛡️ Net Covered: <strong style={{ color: "var(--accent)" }}>{propLeg.coveredRR}R</strong></span>
                        <span style={{ color: "var(--muted)" }}>drag -{propLeg.frictionDragR ?? "0.00"}R</span>
                      </div>
                    )}
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
                    onClick={() => openDetails(setup)}
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
                    {setup.status === "staged" && (
                      <button
                        disabled={hasVeto || isApproving}
                        onClick={() => handleApprove(setup)}
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
                        <span>{isApproving ? "Approving..." : setup.isDualLeg ? "Approve Dual Setup" : "Approve"}</span>
                      </button>
                    )}

                    <button
                      disabled={isApproving}
                      onClick={() => handleDismiss(setup)}
                      style={{
                        ...actionStyle,
                        padding: "4px 8px",
                        background: "rgba(255, 255, 255, 0.04)",
                        color: "var(--muted)",
                        fontSize: 11,
                      }}
                      title={setup.isDualLeg ? "Dismiss dual setup" : "Dismiss setup"}
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
        const setup = selectedTrade;
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
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>
                      {trade.symbol} · {isDual ? "Dual-Leg Setup Details" : "Setup Details"}
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

              {/* Shared Execution Levels Overview */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 120px), 1fr))",
                  gap: 8,
                  background: "var(--panel-2)",
                  padding: 10,
                  borderRadius: 8,
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
                <TelemetryValue label="Risk Distance" value={`${dist.toFixed(5)} (${trade.riskPips ? `${trade.riskPips} pips` : `${Math.round(dist * 10000)} pts`})`} color="var(--accent)" />
                <TelemetryValue label="Initial Risk USD" value={formatUsd(trade.initialRiskUsd ?? trade.riskUsd)} color="var(--orange)" />
              </div>

              {/* Dual Leg Targets or Single Leg Target Ladder */}
              {isDual ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--fg)" }}>
                    Combined Dual-Leg Execution Targets
                  </div>

                  {/* Leg 1 Target Box */}
                  {defaultLeg && (() => {
                    const legTrade = defaultLeg;
                    const legLevel = legTrade.levelDetails || legTrade.stagedLevel || {};
                    const isEditingThis = editingId === legTrade._id;
                    return (
                      <div
                        style={{
                          background: "rgba(56, 189, 248, 0.04)",
                          border: "1px solid rgba(56, 189, 248, 0.25)",
                          borderRadius: 8,
                          padding: 12,
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                          <div>
                            <span style={{ fontWeight: 800, color: "var(--accent)", fontSize: 11 }}>
                              LEG 1 · DEFAULT (50% MILESTONE + RUNNER)
                            </span>
                            <div style={{ fontSize: 11, fontFamily: "monospace", marginTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                              <div>
                                50% Milestone: <strong style={{ color: "var(--accent)" }}>{formatPrice(setup.halfPrice)}</strong> ({Number(setup.halfRR || 2.2).toFixed(1)}R)
                                <span style={{ color: "var(--muted)", marginLeft: 6 }}>· Book 40% volume + Move SL to Breakeven</span>
                              </div>
                              <div>
                                Full Target (Runner): <strong style={{ color: "var(--green)" }}>{formatPrice(legTrade.tpPrice ?? legLevel.tp ?? setup.fullTp)}</strong> (
                                {finiteNumber(legTrade.targetRR ?? legLevel.rr ?? setup.fullRR) === null ? "4.0" : `${legTrade.targetRR ?? legLevel.rr ?? setup.fullRR}R`})
                                <span style={{ color: "var(--muted)", marginLeft: 6 }}>· Hold 60% runner to DOL</span>
                              </div>
                              {legTrade.coveredRR && <div style={{ color: "var(--muted)", fontSize: 10 }}>🛡️ Net Covered: {legTrade.coveredRR}R</div>}
                            </div>
                          </div>

                          {!isEditingThis && (
                            <button
                              onClick={() => {
                                setEditingId(legTrade._id);
                                setEditRR(Number(legTrade.targetRR ?? legLevel.rr ?? 4.0));
                                setEditTp(legTrade.tpPrice ?? legLevel.tp ?? "");
                              }}
                              style={{
                                ...actionStyle,
                                padding: "3px 8px",
                                fontSize: 10,
                                color: "var(--accent)",
                                background: "rgba(56, 189, 248, 0.1)",
                                border: "1px solid rgba(56, 189, 248, 0.3)",
                              }}
                            >
                              <Edit3 size={11} /> Modify Leg 1 Target
                            </button>
                          )}
                        </div>

                        {isEditingThis && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                              <label style={{ fontSize: 10, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 100 }}>
                                Target R:R (Default Leg)
                                <input
                                  type="number"
                                  step="any"
                                  min="0.5"
                                  value={editRR}
                                  onChange={(e) => {
                                    const raw = Number(e.target.value) || 0.1;
                                    const r = Math.max(0.1, raw);
                                    setEditRR(r);
                                    if (dist > 0) setEditTp(Number((entryVal + trade.dir * r * dist).toFixed(5)));
                                  }}
                                  style={{
                                    background: "var(--bg)",
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
                                      setEditRR(Math.max(0.1, rounded));
                                    }
                                  }}
                                  style={{
                                    background: "var(--bg)",
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
                                onClick={() => saveEdit(legTrade, editRR, editTp)}
                                style={{
                                  ...actionStyle,
                                  padding: "5px 12px",
                                  background: "var(--green)",
                                  color: "#fff",
                                  border: "none",
                                }}
                              >
                                <Save size={11} /> {saving ? "Saving..." : "Apply Leg 1 Target"}
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
                    );
                  })()}

                  {/* Leg 2 Target Box */}
                  {propLeg && (() => {
                    const legTrade = propLeg;
                    const legLevel = legTrade.levelDetails || legTrade.stagedLevel || {};
                    const isEditingThis = editingId === legTrade._id;
                    return (
                      <div
                        style={{
                          background: "rgba(168, 85, 247, 0.04)",
                          border: "1px solid rgba(168, 85, 247, 0.25)",
                          borderRadius: 8,
                          padding: 12,
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                          <div>
                            <span style={{ fontWeight: 800, color: "var(--purple, #c084fc)", fontSize: 11 }}>
                              LEG 2 · PROP-FIRM SAFE (1.5R–2.5R BRACKET)
                            </span>
                            <div style={{ fontSize: 11, fontFamily: "monospace", marginTop: 2 }}>
                              Target: <strong style={{ color: "var(--green)" }}>{formatPrice(legTrade.tpPrice ?? legLevel.tp)}</strong> (
                              {finiteNumber(legTrade.targetRR ?? legLevel.rr) === null ? "2.2" : `${legTrade.targetRR ?? legLevel.rr}R`})
                              {legTrade.coveredRR && <span style={{ color: "var(--muted)", marginLeft: 6 }}>· Net Covered: {legTrade.coveredRR}R</span>}
                            </div>
                            {(legTrade.targetLandmark || legTrade.propTarget?.source) && (
                              <div style={{ fontSize: 10, color: "var(--purple, #c084fc)", marginTop: 2 }}>
                                🎯 Landmark: {legTrade.targetLandmark || legTrade.propTarget?.source}
                              </div>
                            )}
                          </div>

                          {!isEditingThis && (
                            <button
                              onClick={() => {
                                setEditingId(legTrade._id);
                                setEditRR(Number(legTrade.targetRR ?? legLevel.rr ?? 2.2));
                                setEditTp(legTrade.tpPrice ?? legLevel.tp ?? "");
                              }}
                              style={{
                                ...actionStyle,
                                padding: "3px 8px",
                                fontSize: 10,
                                color: "var(--purple, #c084fc)",
                                background: "rgba(168, 85, 247, 0.1)",
                                border: "1px solid rgba(168, 85, 247, 0.3)",
                              }}
                            >
                              <Edit3 size={11} /> Modify Leg 2 Target
                            </button>
                          )}
                        </div>

                        {isEditingThis && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                              <label style={{ fontSize: 10, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 100 }}>
                                Target R:R (Prop-Firm Safe: 1.5R–2.5R)
                                <input
                                  type="number"
                                  step="any"
                                  min="1.5"
                                  max="2.5"
                                  value={editRR}
                                  onChange={(e) => {
                                    const raw = Number(e.target.value) || 1.5;
                                    const r = Math.min(2.5, Math.max(1.5, raw));
                                    setEditRR(r);
                                    if (dist > 0) setEditTp(Number((entryVal + trade.dir * r * dist).toFixed(5)));
                                  }}
                                  style={{
                                    background: "var(--bg)",
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
                                      setEditRR(Math.min(2.5, Math.max(1.5, rounded)));
                                    }
                                  }}
                                  style={{
                                    background: "var(--bg)",
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
                                onClick={() => saveEdit(legTrade, editRR, editTp)}
                                style={{
                                  ...actionStyle,
                                  padding: "5px 12px",
                                  background: "var(--green)",
                                  color: "#fff",
                                  border: "none",
                                }}
                              >
                                <Save size={11} /> {saving ? "Saving..." : "Apply Leg 2 Target"}
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
                    );
                  })()}
                </div>
              ) : (
                <>
                  <TargetLadder targets={trade.targets || level.targets} legacyTarget={trade.tpPrice} />

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
                      </div>
                    </div>
                  )}
                </>
              )}

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

              {/* Direct MT5 Order Submission Credentials */}
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
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Zap size={14} style={{ color: "var(--accent)" }} />
                  <strong style={{ fontSize: 12 }}>Direct MT5 Order Submission Credentials</strong>
                </div>

                {isDual ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 250px), 1fr))", gap: 8, fontFamily: "monospace", fontSize: 11 }}>
                    <div style={{ background: "var(--panel-2)", padding: "6px 8px", borderRadius: 5 }}>
                      <span style={{ color: "var(--accent)", fontWeight: 700 }}>Leg 1 (Default): </span>
                      <span>Magic #{defaultLeg?.magicNumber || modalRoutingDefault?.magicNumber}</span>
                      <div style={{ color: "var(--muted)", fontSize: 10, marginTop: 2 }}>Comment: {defaultLeg?.brokerComment || modalRoutingDefault?.comment}</div>
                    </div>
                    <div style={{ background: "var(--panel-2)", padding: "6px 8px", borderRadius: 5 }}>
                      <span style={{ color: "var(--purple, #c084fc)", fontWeight: 700 }}>Leg 2 (Prop Safe): </span>
                      <span>Magic #{propLeg?.magicNumber || modalRoutingProp?.magicNumber}</span>
                      <div style={{ color: "var(--muted)", fontSize: 10, marginTop: 2 }}>Comment: {propLeg?.brokerComment || modalRoutingProp?.comment}</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "monospace", fontSize: 11 }}>
                    {(trade.magicNumber || modalRouting?.magicNumber) && (
                      <span
                        style={{
                          padding: "3px 8px",
                          borderRadius: 4,
                          background: "rgba(56, 189, 248, 0.12)",
                          color: "var(--accent)",
                          border: "1px solid rgba(56, 189, 248, 0.25)",
                          fontWeight: 700,
                        }}
                      >
                        Magic: #{trade.magicNumber || modalRouting.magicNumber}
                      </span>
                    )}
                    {(trade.brokerComment || modalRouting?.comment) && (
                      <span
                        style={{
                          padding: "3px 8px",
                          borderRadius: 4,
                          background: "rgba(255, 255, 255, 0.05)",
                          color: "var(--fg)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        Comment: {trade.brokerComment || modalRouting.comment}
                      </span>
                    )}
                  </div>
                )}
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
                    handleDismiss(setup);
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
                  <X size={13} /> {isDual ? "Dismiss Dual Setup" : "Dismiss Setup"}
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

                  {setup.status === "staged" && (
                    <button
                      disabled={hasVeto || !!pendingAction}
                      onClick={() => {
                        handleApprove(setup);
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
                      <Check size={14} /> {isDual ? "Approve & Arm Dual Execution" : "Approve & Arm Execution"}
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
