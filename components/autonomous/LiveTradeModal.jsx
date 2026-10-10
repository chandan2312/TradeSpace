"use client";

import { useState, useEffect } from "react";
import {
  Activity,
  Zap,
  Target,
  Shield,
  Layers,
  X,
  TrendingUp,
  CandlestickChart,
  CheckCircle2,
  AlertTriangle,
  FileText,
} from "lucide-react";
import StagedIdeaChart from "./StagedIdeaChart";
import {
  TelemetryValue,
  TargetLadder,
  formatPrice,
  formatUsd,
  formatR,
  formatIR,
  formatAR,
  IRARBadge,
  tradeRiskTelemetry,
  markPriceFor,
} from "./TradeTelemetry";
import ModelBadge from "./ModelBadge";

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

export default function LiveTradeModal({
  trade,
  ticks = {},
  onClose,
  onCloseTrade,
}) {
  const [modalTab, setModalTab] = useState("chart");
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!trade) return null;

  const telemetry = tradeRiskTelemetry(trade, ticks);
  const mark = markPriceFor(trade, ticks);
  const isProfitable = (telemetry.floatingUsd ?? 0) >= 0;
  const isShort = trade.dir === -1 || String(trade.direction || trade.dirLabel).toLowerCase() === "sell";
  const entryVal = Number(trade.filledPrice ?? trade.entryPrice ?? 0);
  const slVal = Number(trade.confirmedSlPrice ?? trade.slPrice ?? trade.initialSlPrice ?? 0);
  const tpVal = Number(trade.tpPrice ?? 0);
  const dist = Math.abs(entryVal - slVal);

  const isProp =
    trade.isPropFirm === true ||
    trade.managementModel === "prop_firm_safe" ||
    trade.legId === "prop" ||
    trade.legLabel === "TradeProp" ||
    (Number(trade.magicNumber ?? trade.magic ?? 0) > 0 &&
      Math.floor((Number(trade.magicNumber ?? trade.magic ?? 0) % 1000) / 100) === 2) ||
    String(trade.brokerComment || trade.comment || "").toUpperCase().includes("PROP") ||
    String(trade.brokerComment || trade.comment || "").toUpperCase().includes(":MG2:");

  const defaultTp = Number(trade.fullTp ?? trade.defaultLeg?.tpPrice ?? trade.tpPrice ?? 0);
  const propTp = Number(trade.propTp ?? trade.propLeg?.tpPrice ?? trade.propTarget?.tpPrice ?? 0);
  const halfPrice = Number(trade.halfPrice ?? trade.halfTarget?.price ?? 0);

  // Milestone Progress Bar math
  const totalTargetDistance = Math.abs(defaultTp - entryVal) || dist * 3 || 1;
  const currentDistanceTraveled = isShort ? entryVal - mark : mark - entryVal;
  const currentProgress = Math.max(0, Math.min(100, (currentDistanceTraveled / totalTargetDistance) * 100));

  const peakPrice = Number(trade.peakPrice ?? mark);
  const peakDistanceTraveled = isShort ? entryVal - peakPrice : peakPrice - entryVal;
  const maxReached = Math.max(0, Math.min(100, (peakDistanceTraveled / totalTargetDistance) * 100));

  const handleClose = async () => {
    if (!onCloseTrade || closing) return;
    setClosing(true);
    try {
      await onCloseTrade(trade._id || trade.primaryId || trade.ticket);
      onClose();
    } catch (_) {
      setClosing(false);
    }
  };

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
          {/* Header */}
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
                  {trade.symbol} · Active Position
                </h2>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    padding: "2px 7px",
                    borderRadius: 4,
                    background: !isShort ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)",
                    color: !isShort ? "var(--green)" : "var(--red)",
                  }}
                >
                  {!isShort ? "BUY ACTIVE ▲" : "SELL ACTIVE ▼"}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: isProp ? "rgba(168, 85, 247, 0.2)" : "rgba(56, 189, 248, 0.2)",
                    color: isProp ? "#c084fc" : "#38bdf8",
                    border: `1px solid ${isProp ? "rgba(168, 85, 247, 0.4)" : "rgba(56, 189, 248, 0.4)"}`,
                    letterSpacing: "0.03em",
                  }}
                >
                  {isProp ? "🛡️ TRADEPROP (Safe)" : "🏛️ TRADEDEFAULT (Milestone)"}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: isProfitable ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)",
                    color: isProfitable ? "var(--green)" : "var(--red)",
                    fontFamily: "monospace",
                  }}
                >
                  {formatUsd(telemetry.floatingUsd)} ({formatR(telemetry.priceR)})
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    padding: "2px 7px",
                    borderRadius: 4,
                    background: "rgba(56, 189, 248, 0.15)",
                    color: "var(--accent)",
                  }}
                >
                  {trade.status === "managing" ? "MANAGING" : "ACTIVE"}
                </span>
                <ModelBadge item={trade} size="sm" showName={true} />
                {trade.ticket && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--muted)",
                      background: "rgba(255, 255, 255, 0.05)",
                      padding: "2px 6px",
                      borderRadius: 4,
                      fontFamily: "monospace",
                    }}
                  >
                    MT5 #{trade.ticket}
                  </span>
                )}
              </div>

              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <ModelBadge item={trade} size="xs" />
                <span>·</span>
                <span>Timeframe: <strong style={{ color: "var(--fg)" }}>{trade.tf || "15M"}</strong></span>
                <span>·</span>
                <span>Volume: <strong style={{ color: "var(--fg)" }}>{trade.lotSize || trade.remainingVolume || 0.1} Lots</strong></span>
              </div>
            </div>

            <button
              onClick={onClose}
              aria-label="Close live position modal"
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
              { id: "chart", label: "Live Chart & Overview", icon: CandlestickChart },
              { id: "management", label: "Management & Targets", icon: Target },
              { id: "audit", label: "Execution & MT5 Audit", icon: FileText },
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

        {/* TAB 1: LIVE CHART & OVERVIEW */}
        {modalTab === "chart" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Interactive Candlestick Chart */}
            <StagedIdeaChart trade={trade} ticks={ticks} height={320} />

            {/* Key Levels Overview */}
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
              <TelemetryValue label="Filled Entry" value={formatPrice(entryVal)} />
              <TelemetryValue label="Live Mark" value={formatPrice(mark)} color={isProfitable ? "var(--green)" : "var(--red)"} />
              <TelemetryValue label="Stop Loss" value={formatPrice(slVal)} color="var(--red)" />
              {halfPrice > 0 && <TelemetryValue label="50% Target" value={formatPrice(halfPrice)} color="#f59e0b" />}
              {propTp > 0 && <TelemetryValue label="Prop TP" value={formatPrice(propTp)} color="#06b6d4" />}
              {defaultTp > 0 && <TelemetryValue label="Full TP" value={formatPrice(defaultTp)} color="var(--green)" />}
              <TelemetryValue label="Unrealized PnL" value={`${formatUsd(telemetry.floatingUsd)} (${formatR(telemetry.priceR)})`} color={isProfitable ? "var(--green)" : "var(--red)"} />
              <TelemetryValue label="Peak R" value={formatR(trade.peakR || telemetry.priceR)} color="var(--accent)" />
            </div>

            {/* Progress Bar towards Milestone Target */}
            <div
              style={{
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 10,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: "var(--muted)", fontWeight: 600 }}>Target Runway Progress</span>
                <span style={{ fontFamily: "monospace", fontWeight: 700, color: isProfitable ? "var(--green)" : "var(--red)" }}>
                  {Math.round(currentProgress)}% (Peak: {Math.round(maxReached)}%)
                </span>
              </div>

              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: 10,
                  borderRadius: 5,
                  background: "rgba(255, 255, 255, 0.06)",
                  overflow: "hidden",
                }}
              >
                {/* Milestone 50% line */}
                <div
                  title="50% Milestone (40% Booked + BE)"
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: 0,
                    bottom: 0,
                    width: 2,
                    background: trade.halfTargetBooked || trade.isBreakeven ? "var(--green)" : "rgba(255, 255, 255, 0.4)",
                    zIndex: 3,
                  }}
                />
                {/* Active progress */}
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    height: "100%",
                    width: `${currentProgress}%`,
                    background: isProfitable ? "var(--green)" : "var(--red)",
                    borderRadius: 5,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>

              {(trade.halfTargetBooked || trade.isBreakeven) && (
                <div style={{ fontSize: 10, color: "var(--green)", fontWeight: 700, display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                  <Shield size={12} /> 40% Volume Booked · Stop-Loss Locked at Breakeven
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: MANAGEMENT & TARGETS */}
        {modalTab === "management" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 800, color: isProp ? "#c084fc" : "var(--accent)" }}>
                {isProp ? "🛡️ TradeProp State Machine (Safe Prop-Firm)" : "🏛️ TradeDefault State Machine (50% Milestone + Runner)"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11, fontFamily: "monospace" }}>
                <div>Strategy: <strong style={{ color: isProp ? "#c084fc" : "#38bdf8" }}>{isProp ? "PROP_FIRM_SAFE" : "DEFAULT_MILESTONE"}</strong></div>
                <div>Status: <strong style={{ color: "var(--fg)" }}>{trade.status}</strong></div>
                <div>Breakeven: <strong style={{ color: trade.isBreakeven ? "var(--green)" : "var(--muted)" }}>{trade.isBreakeven ? "ACTIVE" : "NO"}</strong></div>
                <div>50% Booked: <strong style={{ color: trade.halfTargetBooked ? "var(--green)" : "var(--muted)" }}>{isProp ? "N/A (Full Size)" : trade.halfTargetBooked ? "YES (40%)" : "NO"}</strong></div>
                <div>Trailing Stop: <strong style={{ color: trade.isTrailing ? "var(--purple, #c084fc)" : "var(--muted)" }}>{trade.isTrailing ? "ENGAGED" : "NO"}</strong></div>
              </div>
            </div>

            {trade.targets?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>
                  Target Exit Ladder
                </div>
                <TargetLadder targets={trade.targets} entryPrice={entryVal} slPrice={slVal} dir={trade.dir} />
              </div>
            )}
          </div>
        )}

        {/* TAB 3: EXECUTION & MT5 AUDIT */}
        {modalTab === "audit" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
              MT5 Position Telemetry & Routing
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
                maxHeight: 260,
              }}
            >
              {JSON.stringify({
                _id: trade._id,
                strategy: isProp ? "TradeProp (prop_firm_safe)" : "TradeDefault (milestone_50)",
                isPropFirm: isProp,
                legId: trade.legId || (isProp ? "prop" : "default"),
                symbol: trade.symbol,
                dir: trade.dir,
                ticket: trade.ticket,
                magicNumber: trade.magicNumber,
                brokerComment: trade.brokerComment,
                filledPrice: trade.filledPrice,
                initialSlPrice: trade.initialSlPrice,
                slPrice: trade.slPrice,
                tpPrice: trade.tpPrice,
                lotSize: trade.lotSize,
                remainingVolume: trade.remainingVolume,
                brokerAccountLogin: trade.brokerAccountLogin,
                filledAt: trade.filledAt,
              }, null, 2)}
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
          {onCloseTrade && (
            <button
              onClick={handleClose}
              disabled={closing}
              style={{
                ...actionStyle,
                padding: "8px 14px",
                background: "rgba(239, 68, 68, 0.15)",
                color: "var(--red)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                cursor: closing ? "wait" : "pointer",
              }}
            >
              <X size={13} /> {closing ? "Closing Position..." : "Market Close Position"}
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
              Close Modal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
