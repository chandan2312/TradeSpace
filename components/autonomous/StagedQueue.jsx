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
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "var(--muted)", fontSize: 10, fontWeight: 600 }}>Model:</span>
                      <ModelBadge item={trade} size="xs" showName={true} />
                    </div>
                    <span
                      style={{
                        fontFamily: "monospace",
                        fontWeight: 800,
                        color: scoreColor,
                        fontSize: 10.5,
                      }}
                    >
                      Confluence: {confluence}/100
                    </span>
                  </div>

                  {/* Visual Confluence Bar */}
                  <div
                    style={{
                      width: "100%",
                      height: 4,
                      background: "rgba(255, 255, 255, 0.08)",
                      borderRadius: 2,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min(100, Math.max(0, confluence))}%`,
                        background: scoreColor,
                        borderRadius: 2,
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                </div>

                {/* 3. 4-Column Setup Geometry Strip */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
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
                    <div style={{ color: "var(--muted)", fontSize: 8.5 }}>STOP LOSS</div>
                    <div style={{ fontWeight: 700, color: "var(--red)" }}>{formatPrice(slVal)}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--muted)", fontSize: 8.5 }}>50% LEVEL</div>
                    <div style={{ fontWeight: 700, color: "#f59e0b" }}>{formatPrice(setup.halfPrice)}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--muted)", fontSize: 8.5 }}>FULL TP</div>
                    <div style={{ fontWeight: 700, color: "var(--green)" }}>{formatPrice(setup.fullTp)}</div>
                  </div>
                </div>

                {/* 4. Dual Management Pathways Preview Strip */}
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {/* Pathway A: Default Milestone (50%) & Full Runner */}
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
                        <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 8.5 }}>
                          ⚡ MT5 #{defaultLeg?.magicNumber || routingDefault?.magicNumber}
                        </span>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--panel)", padding: "3px 6px", borderRadius: 4 }}>
                      <span style={{ color: "var(--muted)", fontSize: 9 }}>
                        50%: <strong style={{ color: "#f59e0b" }}>{formatPrice(setup.halfPrice)}</strong> ({Number(setup.halfRR || 2.2).toFixed(1)}R)
                      </span>
                      <span style={{ color: "var(--muted)", fontSize: 9 }}>
                        Full TP: <strong style={{ color: "var(--green)" }}>{formatPrice(setup.fullTp)}</strong> ({Number(setup.fullRR || 4.5).toFixed(1)}R)
                      </span>
                    </div>

                    {defaultLeg?.coveredRR && (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--muted)", fontSize: 8.5 }}>
                        <span>🛡️ Net Covered: <strong style={{ color: "var(--accent)" }}>{defaultLeg.coveredRR}R</strong></span>
                        <span>drag -{defaultLeg.frictionDragR ?? "0.00"}R</span>
                      </div>
                    )}
                  </div>

                  {/* Pathway B: Prop-Firm Safe Target */}
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
                        <span style={{ color: "var(--purple, #c084fc)", fontWeight: 700, fontSize: 8.5 }}>
                          ⚡ MT5 #{propLeg?.magicNumber || routingProp?.magicNumber}
                        </span>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--panel)", padding: "3px 6px", borderRadius: 4 }}>
                      <span style={{ color: "var(--muted)", fontSize: 9 }}>
                        Prop Target: <strong style={{ color: "#06b6d4" }}>{formatPrice(setup.propTp)}</strong> ({Number(setup.propRR || 2.0).toFixed(1)}R)
                      </span>
                      <span style={{ fontSize: 8.5, color: "var(--purple, #c084fc)", fontWeight: 700, background: "rgba(168, 85, 247, 0.15)", padding: "1px 5px", borderRadius: 3 }}>
                        100% Exit
                      </span>
                    </div>

                    {(propLeg?.targetLandmark || propLeg?.propTarget?.source) && (
                      <div style={{ color: "var(--purple, #c084fc)", fontSize: 8.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        🎯 Landmark: {propLeg?.targetLandmark || propLeg?.propTarget?.source}
                      </div>
                    )}
                  </div>
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
                        <span>{isApproving ? "Approving..." : setup.isDualLeg ? "Approve Dual" : "Approve"}</span>
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
