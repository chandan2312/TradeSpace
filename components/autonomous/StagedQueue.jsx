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
  CandlestickChart,
  Sparkles,
  Sliders,
  ChevronRight,
  Activity,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import RangeTelemetry from "./RangeTelemetry";
import ConfluenceBreakdown from "./ConfluenceBreakdown";
import DecisionReasons from "./DecisionReasons";
import EvidenceDetails from "./EvidenceDetails";
import StagedIdeaChart from "./StagedIdeaChart";
import StagedTradeModal from "./StagedTradeModal";
import ModelBadge from "./ModelBadge";
import SessionLedDot from "./SessionLedDot";
import NegativeScoreBarWithTooltip from "./NegativeScoreBarWithTooltip";
import PositiveScoreBarWithTooltip from "./PositiveScoreBarWithTooltip";
import {
  TelemetryValue,
  TargetLadder,
  formatPrice,
  formatUsd,
  finiteNumber,
  markPriceFor,
  calculateSlDistance,
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
    const propLegRaw = items.find((t) => t.legId === "prop_firm" || t.managementLogic === "prop_firm_safe");
    const base = propLegRaw || items[0];
    const level = base.levelDetails || base.stagedLevel || {};
    const dir = Number(base.dir || 1);
    const entry = Number(base.entryPrice ?? level.entry);
    const sl = Number(base.initialSlPrice ?? base.slPrice ?? level.sl);
    const riskDist = Math.abs(entry - sl) || 0.001;

    // Prop Target resolution (Standardized Prop-Firm Safe 1.5R–3.0R)
    const propTarget = base.propTarget || level.propTarget;
    const propRR = Number(base.targetRR ?? base.propRR ?? propTarget?.targetRR ?? 2.0);
    const propTp = Number(base.tpPrice ?? base.propTp ?? propTarget?.tpPrice ?? (entry + dir * (riskDist * propRR)));

    const armed = items.some((t) => t.status === "armed");
    const confirming = items.some((t) => t.status === "confirming");
    const status = armed ? "armed" : confirming ? "confirming" : base.status;

    unified.push({
      ...base,
      groupKey: key,
      isDualLeg: false,
      status,
      primaryTrade: base,
      tradeIds: items.map((t) => t._id),
      primaryId: base._id,
      defaultLeg: null,
      propLeg: base,
      fullTp: propTp,
      fullRR: propRR,
      halfPrice: null,
      halfRR: null,
      propTp,
      propRR,
      targetRR: propRR,
      tpPrice: propTp,
      legs: [base],
    });
  }

  return unified;
}

export default function StagedQueue({
  stagedTrades = [],
  onApproveTrade,
  onDismissTrade,
  onModifyTrade,
  executionMode = "auto",
  ticks = {},
  pendingAction,
}) {
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [modalTab, setModalTab] = useState("chart");
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
    setModalTab("chart");
    const trade = setup.primaryTrade || setup;
    const level = trade.levelDetails || trade.stagedLevel || {};
    setEditingId(null);
    const isProp = trade.managementLogic === "prop_firm_safe";
    const initialRR = Number(trade.targetRR ?? level.rr ?? (isProp ? 2.0 : 2.2));
    setEditRR(isProp ? Math.min(3.0, Math.max(1.5, initialRR)) : Math.max(0.5, initialRR));
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
        ? Math.min(3.0, Math.max(1.5, Number(rrToUse) || 2.0))
        : Math.max(0.5, Number(rrToUse) || 2.0);
      const parsedTp = tpToUse ? Number(tpToUse) : undefined;

      if (onModifyTrade) {
        await onModifyTrade(tradeToEdit._id, { targetRR: clampedRR, tpPrice: parsedTp });
      } else {
        await fetch("/api/autonomous", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "modify_target",
            tradeId: tradeToEdit._id,
            targetRR: clampedRR,
            tpPrice: parsedTp,
          }),
        });
      }
      setEditingId(null);

      // Update selectedTrade in memory
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

  const handleModifyTrade = async (targetTrade, overrideRR, overrideTp) => {
    return saveEdit(targetTrade, overrideRR, overrideTp);
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
      {/* Section Header */}
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
          Click any setup card for chart inspect & execution controls
        </span>
      </div>

      {/* Main Grid of Upgraded Cards */}
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
            The scanner loop monitors the watchlist continuously for qualified SMC entry models.
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
            const breakdown =
              trade.confluenceBreakdown ||
              level.confluenceBreakdown ||
              trade.evidence?.confluenceBreakdown ||
              level.evidence?.confluenceBreakdown ||
              {};
            const stagedPosScore =
              trade.positiveScore ??
              level.positiveScore ??
              breakdown.positiveScore ??
              (confluence > 0 ? confluence : 0);
            const stagedNegScore =
              trade.negativeScore ??
              level.negativeScore ??
              (typeof breakdown.negativeScore === "number"
                ? breakdown.negativeScore
                : typeof breakdown.netScore === "number" && typeof breakdown.positiveScore === "number"
                ? breakdown.netScore - breakdown.positiveScore
                : 0);

            const isBlended = Boolean(trade.isBlended || level.isBlended);
            const topContenders = Array.isArray(trade.topContenders)
              ? trade.topContenders
              : Array.isArray(level.topContenders)
              ? level.topContenders
              : [];

            const activeNegativeTags = [];
            if (typeof breakdown.velocityDrag === "number" && breakdown.velocityDrag < 0) {
              activeNegativeTags.push({ label: "Velocity Drag", val: breakdown.velocityDrag });
            }
            if (typeof breakdown.macroHeadwind === "number" && breakdown.macroHeadwind < 0) {
              activeNegativeTags.push({ label: "Macro Headwind", val: breakdown.macroHeadwind });
            }
            if (typeof breakdown.opposingFriction === "number" && breakdown.opposingFriction < 0) {
              activeNegativeTags.push({ label: "Opposing Wall", val: breakdown.opposingFriction });
            }
            if (typeof breakdown.timingLull === "number" && breakdown.timingLull < 0) {
              activeNegativeTags.push({ label: "Timing Lull", val: breakdown.timingLull });
            }
            if (typeof breakdown.staleAge === "number" && breakdown.staleAge < 0) {
              activeNegativeTags.push({ label: "Stale Age", val: breakdown.staleAge });
            }
            if (typeof breakdown.runwayExhaustion === "number" && breakdown.runwayExhaustion < 0) {
              activeNegativeTags.push({ label: "Runway Exhausted", val: breakdown.runwayExhaustion });
            }
            if (typeof breakdown.spreadDrag === "number" && breakdown.spreadDrag < 0) {
              activeNegativeTags.push({ label: "Spread Drag", val: breakdown.spreadDrag });
            }
            if (typeof level?.zoneBreakdown?.trapPenalty === "number" && level.zoneBreakdown.trapPenalty > 0) {
              activeNegativeTags.push({ label: "Trap Penalty", val: -level.zoneBreakdown.trapPenalty });
            }
            if (activeNegativeTags.length === 0 && Array.isArray(trade.negativeTags || level.negativeTags)) {
              const rawTags = trade.negativeTags || level.negativeTags;
              rawTags.forEach((t) => {
                activeNegativeTags.push({ label: String(t).replace(/_/g, " "), val: "" });
              });
            }

            // Staged trade conviction & DBCC breakdown extraction
            const stagedConviction = finiteNumber(trade.brain?.conviction ?? trade.brainSnapshot?.conviction);
            const stagedConvictionBreakdown = trade.convictionBreakdown || trade.brainSnapshot?.convictionBreakdown || trade.brain?.convictionBreakdown || null;
            const stagedConvictionDeductions = stagedConvictionBreakdown?.deductions || [];
            const stagedConvictionNegMod = stagedConvictionBreakdown?.negativeMod ?? 0;

            // Positive Confluence Edge factors
            const activePositiveFactors = [];
            if (typeof breakdown.dolAlignment === "number" && breakdown.dolAlignment > 0) {
              activePositiveFactors.push({ label: "DOL Alignment", val: `+${breakdown.dolAlignment} pts` });
            }
            if (typeof breakdown.premiumDiscount === "number" && breakdown.premiumDiscount > 0) {
              activePositiveFactors.push({ label: "Premium / Discount Zone", val: `+${breakdown.premiumDiscount} pts` });
            }
            if (typeof breakdown.displacement === "number" && breakdown.displacement > 0) {
              activePositiveFactors.push({ label: "Displacement / MSS", val: `+${breakdown.displacement} pts` });
            }
            if (typeof breakdown.retracementQuality === "number" && breakdown.retracementQuality > 0) {
              activePositiveFactors.push({ label: "Retracement Quality", val: `+${breakdown.retracementQuality} pts` });
            }
            if (typeof breakdown.killzone === "number" && breakdown.killzone > 0) {
              activePositiveFactors.push({ label: "Killzone Timing", val: `+${breakdown.killzone} pts` });
            }
            if (typeof breakdown.smt === "number" && breakdown.smt > 0) {
              activePositiveFactors.push({ label: "SMT Divergence", val: `+${breakdown.smt} pts` });
            }
            if (typeof breakdown.htfPdArray === "number" && breakdown.htfPdArray > 0) {
              activePositiveFactors.push({ label: "HTF PD Array", val: `+${breakdown.htfPdArray} pts` });
            }
            if (activePositiveFactors.length === 0) {
              if (trade.modelName || level.modelName) {
                activePositiveFactors.push({ label: `Model: ${trade.modelName || level.modelName}`, val: "+30 pts" });
              }
              const stagedDol =
                trade.dolName ||
                level.dolName ||
                (typeof trade.dol === "string" ? trade.dol : trade.dol?.name || trade.dol?.target || trade.dol?.label) ||
                (typeof level.dol === "string" ? level.dol : level.dol?.name || level.dol?.target || level.dol?.label);
              if (stagedDol) {
                activePositiveFactors.push({ label: `DOL: ${stagedDol}`, val: "+25 pts" });
              }
              if (stagedPosScore > 0 && activePositiveFactors.length === 0) {
                activePositiveFactors.push({ label: "Entry Geometry & Retracement", val: `+${stagedPosScore} pts` });
              }
            }

            // Staged trade positive conviction factors
            const activeConvictionFactors = [];
            if (stagedConvictionBreakdown?.baseConviction) {
              const baseName = stagedConvictionBreakdown.baseScenario
                ? stagedConvictionBreakdown.baseScenario.replace(/_/g, " ")
                : "Staged Setup Baseline";
              activeConvictionFactors.push({
                label: `Base: ${baseName}`,
                val: `${stagedConvictionBreakdown.baseConviction}%`,
              });
            }
            if (Array.isArray(stagedConvictionBreakdown?.bonuses) && stagedConvictionBreakdown.bonuses.length > 0) {
              stagedConvictionBreakdown.bonuses.forEach((b) => {
                activeConvictionFactors.push({
                  label: b.label || String(b.key || "Bonus").replace(/_/g, " "),
                  val: `+${b.pts}%`,
                });
              });
            }
            if (activeConvictionFactors.length === 0) {
              const stability = trade.brain?.stability ?? trade.brainSnapshot?.stability;
              const agreement = trade.brain?.agreement ?? trade.brainSnapshot?.agreement;
              if (typeof stability === "number") {
                activeConvictionFactors.push({
                  label: `Multi-Frame Stability (${Math.round(stability)}%)`,
                  val: "Aligned",
                });
              }
              if (typeof agreement === "number") {
                activeConvictionFactors.push({
                  label: `Multi-Lens Consensus (${Math.round(agreement)}%)`,
                  val: "High",
                });
              }
              if (stagedConviction !== null && activeConvictionFactors.length === 0) {
                activeConvictionFactors.push({
                  label: "Staged Order Flow Conviction",
                  val: `${stagedConviction}%`,
                });
              }
            }

            const routingDefault = defaultLeg ? (defaultLeg.copierRouting || resolveCopierRouting(defaultLeg)) : null;
            const routingProp = propLeg ? (propLeg.copierRouting || resolveCopierRouting(propLeg)) : null;
            const isApproving = setup.tradeIds?.some((id) => pendingAction === id) || pendingAction === setup._id;

            const scoreColor =
              confluence >= 80
                ? "var(--green)"
                : confluence >= 60
                ? "var(--accent)"
                : "var(--orange)";

            return (
              <article
                key={setup.groupKey || setup._id}
                onClick={() => openDetails(setup)}
                style={{
                  background: armed
                    ? "rgba(34, 197, 94, 0.04)"
                    : confirming
                    ? "rgba(245, 158, 11, 0.03)"
                    : "var(--panel-2)",
                  border: `1px solid ${
                    armed
                      ? "rgba(34, 197, 94, 0.45)"
                      : confirming
                      ? "rgba(245, 158, 11, 0.4)"
                      : hasVeto
                      ? "rgba(239, 68, 68, 0.25)"
                      : "var(--border)"
                  }`,
                  borderRadius: 10,
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxShadow: armed
                    ? "0 4px 14px rgba(34, 197, 94, 0.12)"
                    : "none",
                  position: "relative",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = armed
                    ? "rgba(34, 197, 94, 0.45)"
                    : confirming
                    ? "rgba(245, 158, 11, 0.4)"
                    : hasVeto
                    ? "rgba(239, 68, 68, 0.25)"
                    : "var(--border)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {/* 1. Top Header Row: Symbol, Direction, Timeframe, Dual Badge & Status */}
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
                    <strong style={{ fontSize: 15, letterSpacing: "-0.01em" }}>
                      {trade.symbol}
                    </strong>
                    <SessionLedDot symbol={trade.symbol} size={7.5} />
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: "2px 7px",
                        borderRadius: 4,
                        background:
                          trade.dir === 1
                            ? "rgba(34, 197, 94, 0.18)"
                            : "rgba(239, 68, 68, 0.18)",
                        color: trade.dir === 1 ? "var(--green)" : "var(--red)",
                        border: `1px solid ${
                          trade.dir === 1 ? "rgba(34, 197, 94, 0.35)" : "rgba(239, 68, 68, 0.35)"
                        }`,
                      }}
                    >
                      {trade.dir === 1 ? "BUY ▲" : "SELL ▼"}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--muted)",
                        fontFamily: "monospace",
                        background: "var(--panel)",
                        padding: "1px 5px",
                        borderRadius: 3,
                        border: "1px solid var(--border)",
                      }}
                    >
                      {trade.scenario?.badge || trade.tf || "15M"}
                    </span>
                    <ModelBadge item={trade} size="sm" />
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
                    {(trade.lastRefinedAt || trade.events?.some((e) => e.type === "STAGED_REFINED")) && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          padding: "2px 6px",
                          borderRadius: 3,
                          background: "rgba(59, 130, 246, 0.15)",
                          color: "var(--accent, #60a5fa)",
                          border: "1px solid rgba(59, 130, 246, 0.35)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                        }}
                        title={`Live Adaptive Order Flow: Re-anchored to fresh market structure at ${trade.lastRefinedAt ? new Date(trade.lastRefinedAt).toLocaleTimeString() : 'latest scan'}`}
                      >
                        <Zap size={9} /> DYNAMIC RE-ANCHORED
                      </span>
                    )}
                    {isBlended && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          padding: "2px 6px",
                          borderRadius: 3,
                          background: "rgba(168, 85, 247, 0.15)",
                          color: "var(--purple, #c084fc)",
                          border: "1px solid rgba(168, 85, 247, 0.35)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                        }}
                        title="Blended Sweet Spot: Merged FVG + Order Block zone (100% RPT allocation)"
                      >
                        💎 BLENDED SWEET SPOT
                      </span>
                    )}
                  </div>

                  {/* Status Badge */}
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

                {/* 2. Model & Confluence Rating Meter */}
                <div
                  style={{
                    background: "var(--panel)",
                    padding: "7px 9px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 5,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 11,
                      flexWrap: "wrap",
                      gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "var(--muted)", fontSize: 10, fontWeight: 600 }}>Model:</span>
                      <ModelBadge item={trade} size="xs" showName={true} />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "monospace", fontSize: 10.5 }}>
                      <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 9.5 }}>
                        +{stagedPosScore} Pos
                      </span>
                      {stagedNegScore < 0 ? (
                        <span
                          style={{
                            color: "var(--red)",
                            fontWeight: 700,
                            fontSize: 9.5,
                            background: "rgba(239, 68, 68, 0.12)",
                            padding: "0 4px",
                            borderRadius: 3,
                            border: "1px solid rgba(239, 68, 68, 0.25)",
                          }}
                          title={`Negative deductions: ${stagedNegScore} pts`}
                        >
                          {stagedNegScore} Neg
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)", fontSize: 9, opacity: 0.65 }}>0 Drag</span>
                      )}
                    </div>
                  </div>

                  {/* Institutional Dual Meter Strip: Confluence & Conviction with Red Drag Progress Bars */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                      padding: "7px 9px",
                      background: "rgba(255, 255, 255, 0.02)",
                      borderRadius: 6,
                      border: "1px solid rgba(255, 255, 255, 0.06)",
                    }}
                  >
                    {/* Column 1: Confluence Score + Red Friction Drag Meter */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {/* Positive Confluence Score Bar with Tooltip */}
                      <PositiveScoreBarWithTooltip
                        label="Confluence"
                        value={confluence}
                        valueDisplay={`${confluence}/100`}
                        barPercent={confluence}
                        barColor={scoreColor}
                        icon="▲"
                        factors={activePositiveFactors}
                        tooltipTitle="Confluence Edge Pillars"
                        emptyText="Evaluating macro context & SMC order flow..."
                        align="left"
                        placement="bottom"
                      />

                      {/* Red Negative Friction Drag Bar with Tooltip */}
                      <NegativeScoreBarWithTooltip
                        label="Friction Drag"
                        value={stagedNegScore}
                        barPercent={Math.min(100, Math.round(Math.abs(stagedNegScore) * 1.5))}
                        factors={activeNegativeTags}
                        tooltipTitle="Staged Negative Friction"
                        emptyText="No adverse friction. Pristine entry geometry."
                        align="left"
                        placement="bottom"
                      />
                    </div>

                    {/* Column 2: Conviction + Red Conviction Drag Meter */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {/* Positive Conviction Bar with Tooltip */}
                      <PositiveScoreBarWithTooltip
                        label="Conviction"
                        value={stagedConviction ?? 0}
                        valueDisplay={stagedConviction !== null ? `${stagedConviction}%` : "—"}
                        barPercent={stagedConviction ?? 0}
                        barColor={(stagedConviction ?? 0) >= 75 ? "var(--green)" : "var(--accent)"}
                        icon="▲"
                        factors={activeConvictionFactors}
                        tooltipTitle="Market Brain Conviction Drivers"
                        emptyText="Analyzing multi-timeframe consensus & stability..."
                        align="right"
                        placement="bottom"
                      />

                      {/* Red Negative Conviction Drag Bar with Tooltip */}
                      <NegativeScoreBarWithTooltip
                        label="Conviction Drag"
                        value={stagedConvictionNegMod}
                        barPercent={Math.min(100, Math.round(Math.abs(stagedConvictionNegMod) * 2.0))}
                        factors={stagedConvictionDeductions.map((d) => ({ label: d.label, val: d.pts }))}
                        tooltipTitle="Conviction Deductions"
                        emptyText="No conviction deductions. Full multi-timeframe confirmation."
                        align="right"
                        placement="bottom"
                      />
                    </div>
                  </div>

                  {/* Dynamic Arbiter summary if multiple models evaluated */}
                  {topContenders.length > 1 && (
                    <div style={{ fontSize: 8.5, color: "var(--muted)", fontFamily: "monospace", display: "flex", alignItems: "center", gap: 4 }}>
                      <span>⚖️ Arbiter:</span>
                      <span>Top setup ranked from {topContenders.length} candidates</span>
                    </div>
                  )}
                </div>

                {/* 3. 3-Column Setup Geometry Strip */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 6,
                    background: "var(--panel)",
                    padding: "6px 8px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    fontFamily: "monospace",
                    fontSize: 10,
                    textAlign: "center",
                  }}
                >
                  <div>
                    <div style={{ color: "var(--muted)", fontSize: 8.5 }}>ENTRY</div>
                    <div style={{ fontWeight: 700, color: "var(--fg)" }}>{formatPrice(entryVal)}</div>
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 4, color: "var(--muted)", fontSize: 8.5 }}>
                      <span>STOP LOSS</span>
                      {(() => {
                        const dist = calculateSlDistance(entryVal, slVal, trade.symbol);
                        return dist?.short ? (
                          <span
                            style={{
                              color: "var(--red)",
                              fontWeight: 800,
                              background: "rgba(239, 68, 68, 0.15)",
                              padding: "0 3px",
                              borderRadius: 3,
                            }}
                            title={`SL Distance: ${dist.formatted}`}
                          >
                            {dist.short}
                          </span>
                        ) : null;
                      })()}
                    </div>
                    <div style={{ fontWeight: 700, color: "var(--red)" }}>{formatPrice(slVal)}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--muted)", fontSize: 8.5 }}>TARGET (PROP TP)</div>
                    <div style={{ fontWeight: 700, color: "#06b6d4" }}>{formatPrice(setup.propTp || trade.tpPrice)}</div>
                  </div>
                </div>

                {/* 4. Prop-Firm Safe Management Strip */}
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
                      <Shield size={11} /> PROP-FIRM SAFE (1.5R–3.0R BRACKET)
                    </span>
                    {(trade.magicNumber || routingProp?.magicNumber) && (
                      <span style={{ color: "var(--purple, #c084fc)", fontWeight: 700, fontSize: 8.5 }}>
                        ⚡ MT5 #{trade.magicNumber || routingProp?.magicNumber}
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--panel)", padding: "3px 6px", borderRadius: 4 }}>
                    <span style={{ color: "var(--muted)", fontSize: 9 }}>
                      Target: <strong style={{ color: "#06b6d4" }}>{formatPrice(setup.propTp || trade.tpPrice)}</strong> ({Number(setup.propRR || trade.targetRR || 2.0).toFixed(1)}R)
                    </span>
                    <span style={{ fontSize: 8.5, color: "var(--purple, #c084fc)", fontWeight: 700, background: "rgba(168, 85, 247, 0.15)", padding: "1px 5px", borderRadius: 3 }}>
                      100% Exit at Target
                    </span>
                  </div>

                  {(trade.coveredRR || routingProp?.coveredRR) && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--muted)", fontSize: 8.5 }}>
                      <span>🛡️ Net Covered: <strong style={{ color: "var(--purple, #c084fc)" }}>{trade.coveredRR || routingProp?.coveredRR}R</strong></span>
                      <span>drag -{trade.frictionDragR || routingProp?.frictionDragR || "0.00"}R</span>
                    </div>
                  )}

                  {(trade.targetLandmark || trade.propTarget?.source) && (
                    <div style={{ color: "var(--purple, #c084fc)", fontSize: 8.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      🎯 Landmark: {trade.targetLandmark || trade.propTarget?.source}
                    </div>
                  )}
                </div>

                {/* 5. Card Footer: Inspect Chart CTA & Execution Actions */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 6,
                    paddingTop: 4,
                    borderTop: "1px solid rgba(255, 255, 255, 0.05)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Inspect Chart & Setup button */}
                  <button
                    onClick={() => openDetails(setup)}
                    style={{
                      ...actionStyle,
                      padding: "5px 9px",
                      background: "rgba(56, 189, 248, 0.08)",
                      border: "1px solid rgba(56, 189, 248, 0.25)",
                      color: "var(--accent)",
                      fontSize: 10.5,
                      fontWeight: 700,
                    }}
                  >
                    <CandlestickChart size={13} />
                    <span>Inspect Chart & Setup</span>
                  </button>

                  <div style={{ display: "flex", gap: 6 }}>
                    {setup.status === "staged" && (
                      <button
                        disabled={hasVeto || isApproving}
                        onClick={() => handleApprove(setup)}
                        style={{
                          ...actionStyle,
                          padding: "5px 10px",
                          background: hasVeto ? "rgba(255, 255, 255, 0.05)" : "var(--accent)",
                          color: hasVeto ? "var(--muted)" : "#fff",
                          border: "none",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: hasVeto ? "not-allowed" : "pointer",
                        }}
                      >
                        <Check size={12} />
                        <span>{isApproving ? "Approving..." : "Approve"}</span>
                      </button>
                    )}

                    <button
                      disabled={isApproving}
                      onClick={() => handleDismiss(setup)}
                      style={{
                        ...actionStyle,
                        padding: "5px 8px",
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

      {/* 2. UPGRADED ON-CLICK SETUP DETAILS POPUP MODAL WITH INTERACTIVE CHART */}
      {selectedTrade && (
        <StagedTradeModal
          setup={selectedTrade}
          onClose={closeDetails}
          onApprove={handleApprove}
          onDismiss={handleDismiss}
          onModify={handleModifyTrade}
          ticks={ticks}
          pendingAction={pendingAction}
          executionMode={executionMode}
        />
      )}
    </section>
  );
}
