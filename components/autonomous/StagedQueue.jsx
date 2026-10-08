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
                    <span style={{ color: "var(--fg)", fontWeight: 700 }}>
                      {trade.modelId || level.model || "ICT 2022 Setup"}
                    </span>
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
              background: "rgba(0, 0, 0, 0.78)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "clamp(8px, 2.5vw, 18px)",
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
                  onClick={closeDetails}
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
                  paddingBottom: 4,
                  borderBottom: "1px solid var(--border)",
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
                      style={{
                        padding: "6px 11px",
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
                        gap: 5,
                        whiteSpace: "nowrap",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <Icon size={13} style={{ color: active ? "var(--accent)" : "currentColor" }} />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
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
                    <TelemetryValue label="Initial Risk USD" value={formatUsd(trade.initialRiskUsd ?? trade.riskUsd)} color="var(--orange)" />
                  </div>

                  {/* Macro Narrative & Dealing Range Telemetry */}
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
                </div>
              )}

              {/* TAB 2: DUAL TARGETS & TARGET MODIFIERS */}
              {(modalTab === "targets" || modalTab === "all") && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Dual Leg Targets or Single Leg Target Ladder */}
                  {isDual ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--fg)", display: "flex", alignItems: "center", gap: 6 }}>
                        <Target size={14} style={{ color: "var(--accent)" }} />
                        <span>Combined Dual-Leg Execution Targets & Interactive Modifiers</span>
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
                                    50% Milestone: <strong style={{ color: "#f59e0b" }}>{formatPrice(setup.halfPrice)}</strong> ({Number(setup.halfRR || 2.2).toFixed(1)}R)
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
                                    padding: "4px 9px",
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
                                    padding: "4px 9px",
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
                </div>
              )}

              {/* TAB 3: CONFLUENCE & EVIDENCE */}
              {(modalTab === "confluence" || modalTab === "all") && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <ConfluenceBreakdown
                    breakdown={trade.confluenceBreakdown || level.confluenceBreakdown}
                    score={trade.confluenceScore ?? level.confluenceScore}
                  />
                  <EvidenceDetails evidence={trade.evidence || level.evidence} />
                </div>
              )}

              {/* TAB 4: GATEKEEPER & VETO CHECK */}
              {(modalTab === "gatekeeper" || modalTab === "all") && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <DecisionReasons
                    vetoes={vetoes}
                    reason={trade.statusReason || trade.rejectionReason || level.rejectionReason}
                    title="Institutional Gatekeeper & Veto Check"
                  />
                </div>
              )}

              {/* Footer Actions */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  borderTop: "1px solid var(--border)",
                  paddingTop: 14,
                  flexWrap: "wrap",
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
