"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Zap,
  Activity,
  ChevronUp,
  ChevronDown,
  X,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  Target,
  Shield,
  Layers,
} from "lucide-react";
import {
  tradeRiskTelemetry,
  formatPrice,
  formatR,
  formatUsd,
  formatIR,
  formatAR,
  IRARBadge,
  finiteNumber,
} from "./TradeTelemetry";

export default function AutonomousLiveHUD({
  trades = [],
  ticks = {},
  onRefresh,
  isOpen: isOpenProp,
  onClose,
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = typeof isOpenProp === "boolean";
  const isOpen = isControlled ? isOpenProp : internalOpen;

  const [tab, setTab] = useState("active"); // "active" | "staged" | "closed"
  const [loadingAction, setLoadingAction] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleDismiss = () => {
    if (onClose) {
      onClose();
    } else {
      setInternalOpen(false);
    }
  };

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        handleDismiss();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const activeTrades = useMemo(() => {
    return (trades || []).filter((t) =>
      ["active", "managing", "closing", "open", "filling", "armed_fill"].includes(t.status)
    );
  }, [trades]);

  const stagedTrades = useMemo(() => {
    return (trades || []).filter((t) => ["staged", "confirming", "armed"].includes(t.status));
  }, [trades]);

  const closedTrades = useMemo(() => {
    return (trades || [])
      .filter((t) =>
        ["closed_tp", "closed_sl", "closed_be", "closed"].includes(t.status) || Boolean(t.closedAt)
      )
      .sort((a, b) => new Date(b.closedAt || b.createdAt) - new Date(a.closedAt || a.createdAt));
  }, [trades]);

  // Aggregate telemetry for all active positions
  const netTelemetry = useMemo(() => {
    let totalFloatingUsd = 0;
    let totalFloatingR = 0;
    let hasTelemetry = false;

    activeTrades.forEach((trade) => {
      const tel = tradeRiskTelemetry(trade, ticks);
      if (tel.floatingUsd !== null) {
        totalFloatingUsd += tel.floatingUsd;
        hasTelemetry = true;
      }
      if (tel.priceR !== null) {
        totalFloatingR += tel.priceR;
      }
    });

    return {
      totalUsd: hasTelemetry ? totalFloatingUsd : null,
      totalR: hasTelemetry ? totalFloatingR : null,
      count: activeTrades.length,
      stagedCount: stagedTrades.length,
    };
  }, [activeTrades, stagedTrades, ticks]);

  // Quick action: close active position
  const handleCloseTrade = async (tradeId) => {
    if (loadingAction) return;
    setLoadingAction(tradeId);
    setActionMsg(null);
    try {
      const res = await fetch("/api/autonomous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", tradeId }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Failed to close trade");
      }
      setActionMsg({ type: "success", text: "Close order dispatched" });
      onRefresh?.();
    } catch (err) {
      setActionMsg({ type: "error", text: err.message });
    } finally {
      setLoadingAction(null);
      setTimeout(() => setActionMsg(null), 3000);
    }
  };

  // Quick action: approve staged setup
  const handleApprove = async (tradeId) => {
    if (loadingAction) return;
    setLoadingAction(tradeId);
    setActionMsg(null);
    try {
      const res = await fetch("/api/autonomous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", tradeId }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Failed to approve setup");
      }
      setActionMsg({ type: "success", text: "Setup approved for execution" });
      onRefresh?.();
    } catch (err) {
      setActionMsg({ type: "error", text: err.message });
    } finally {
      setLoadingAction(null);
      setTimeout(() => setActionMsg(null), 3000);
    }
  };

  const hasTrades = activeTrades.length > 0 || stagedTrades.length > 0;
  const isNetProfit = (netTelemetry.totalUsd ?? 0) >= 0;

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Autonomous Live Trading Cockpit"
      onClick={handleDismiss}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        animation: "autoBackdropFadeIn 0.2s ease-out",
        display: "flex",
        justifyContent: isMobile ? "center" : "flex-end",
        alignItems: isMobile ? "flex-end" : "stretch",
      }}
    >
      <aside
        aria-label="Autonomous Live Trading Cockpit"
        onClick={(e) => e.stopPropagation()}
        style={
          isMobile
            ? {
                width: "100%",
                maxHeight: "88vh",
                background: "var(--panel)",
                borderTop: "1px solid var(--border-hi)",
                borderRadius: "20px 20px 0 0",
                boxShadow: "0 -10px 40px rgba(0, 0, 0, 0.8)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                animation: "autoSheetSlideInUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
              }
            : {
                width: 440,
                maxWidth: "92vw",
                height: "100vh",
                background: "var(--panel)",
                borderLeft: "1px solid var(--border-hi)",
                boxShadow: "-12px 0 40px rgba(0, 0, 0, 0.7)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                animation: "autoDrawerSlideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
              }
        }
      >
        {/* On mobile: touch drag handle bar */}
        {isMobile && (
          <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px", cursor: "grab" }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--border-hi)" }} />
          </div>
        )}

        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            background: "rgba(255, 255, 255, 0.02)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: activeTrades.length > 0 ? "var(--green)" : "var(--muted)",
                boxShadow: activeTrades.length > 0 ? "0 0 8px var(--green)" : "none",
              }}
            />
            <strong style={{ fontSize: 13, fontWeight: 700, letterSpacing: -0.2 }}>
              Live Autonomous Cockpit
            </strong>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: 4,
                background: "rgba(56, 189, 248, 0.15)",
                color: "var(--accent)",
              }}
            >
              LIVE MT5
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {onRefresh && (
              <button
                onClick={onRefresh}
                title="Refresh trades"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--muted)",
                  cursor: "pointer",
                  padding: 4,
                  display: "flex",
                  alignItems: "center",
                  borderRadius: 4,
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--fg)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
              >
                <RefreshCw size={14} />
              </button>
            )}

            <a
              href="/autonomous"
              title="Open Full Autonomous Page"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: "var(--muted)",
                textDecoration: "none",
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--fg)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
            >
              <span>Full Page</span>
              <ExternalLink size={11} />
            </a>

            <button
              onClick={handleDismiss}
              aria-label="Close Autonomous Cockpit"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: 6,
                background: "transparent",
                border: "none",
                color: "var(--muted)",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--fg)";
                e.currentTarget.style.background = "var(--panel-2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--muted)";
                e.currentTarget.style.background = "transparent";
              }}
              title="Close Cockpit (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

          {/* Action Notification Toast */}
          {actionMsg && (
            <div
              style={{
                padding: "8px 12px",
                fontSize: 11,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 6,
                background:
                  actionMsg.type === "success" ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                color: actionMsg.type === "success" ? "var(--green)" : "var(--red)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {actionMsg.type === "success" ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
              <span>{actionMsg.text}</span>
            </div>
          )}

          {/* Net Floating Summary Banner */}
          {activeTrades.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                background: isNetProfit ? "rgba(34, 197, 94, 0.08)" : "rgba(239, 68, 68, 0.08)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div>
                <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>
                  Net Unrealized P&L
                </div>
                <div
                  style={{
                    fontFamily: "monospace",
                    fontSize: 16,
                    fontWeight: 800,
                    color: isNetProfit ? "var(--green)" : "var(--red)",
                  }}
                >
                  {formatUsd(netTelemetry.totalUsd)}
                  <span style={{ fontSize: 12, marginLeft: 6, fontWeight: 700 }}>
                    ({formatR(netTelemetry.totalR)})
                  </span>
                </div>
              </div>

              <div style={{ textAlign: "right", fontSize: 11 }}>
                <span
                  style={{
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 10,
                    background: "rgba(255, 255, 255, 0.08)",
                  }}
                >
                  {activeTrades.length} Active {activeTrades.length === 1 ? "Trade" : "Trades"}
                </span>
              </div>
            </div>
          )}

          {/* Tab Filter */}
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid var(--border)",
              background: "rgba(0, 0, 0, 0.2)",
            }}
          >
            <button
              onClick={() => setTab("active")}
              style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: 11,
                fontWeight: 700,
                border: "none",
                background: tab === "active" ? "rgba(255, 255, 255, 0.06)" : "transparent",
                color: tab === "active" ? "var(--fg)" : "var(--muted)",
                borderBottom: tab === "active" ? "2px solid var(--accent)" : "none",
                cursor: "pointer",
              }}
            >
              Active ({activeTrades.length})
            </button>
            <button
              onClick={() => setTab("staged")}
              style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: 11,
                fontWeight: 700,
                border: "none",
                background: tab === "staged" ? "rgba(255, 255, 255, 0.06)" : "transparent",
                color: tab === "staged" ? "var(--fg)" : "var(--muted)",
                borderBottom: tab === "staged" ? "2px solid var(--accent)" : "none",
                cursor: "pointer",
              }}
            >
              Staged ({stagedTrades.length})
            </button>
            <button
              onClick={() => setTab("history")}
              style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: 11,
                fontWeight: 700,
                border: "none",
                background: tab === "history" ? "rgba(255, 255, 255, 0.06)" : "transparent",
                color: tab === "history" ? "var(--fg)" : "var(--muted)",
                borderBottom: tab === "history" ? "2px solid var(--accent)" : "none",
                cursor: "pointer",
              }}
            >
              History ({closedTrades.length})
            </button>
          </div>

          {/* Body Content / Card List */}
          <div
            style={{
              padding: 12,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              minHeight: 120,
            }}
          >
            {/* TAB: ACTIVE POSITIONS */}
            {tab === "active" && (
              <>
                {activeTrades.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "24px 16px",
                      color: "var(--muted)",
                      fontSize: 12,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <Activity size={24} style={{ opacity: 0.4 }} />
                    <div>No open positions currently running.</div>
                    <div style={{ fontSize: 11, opacity: 0.7 }}>
                      Scanner is actively monitoring qualified SMC setups.
                    </div>
                  </div>
                ) : (
                  activeTrades.map((trade) => {
                    const telemetry = tradeRiskTelemetry(trade, ticks);
                    const targets = Array.isArray(trade.targets) ? trade.targets : [];
                    const fill = telemetry.fill ?? trade.entryPrice;
                    const mark = telemetry.mark;
                    const target = targets.find((t) => t.id === "runner")?.price ?? trade.tpPrice;
                    const targetDistance =
                      typeof target === "number" && typeof fill === "number" ? Math.abs(target - fill) : null;
                    const dir = trade.dir ?? (String(trade.direction || trade.dirLabel || "").toLowerCase() === "sell" ? -1 : 1);
                    const targetRR = finiteNumber(trade.targetRR) || (targetDistance && telemetry.initialRisk ? targetDistance / telemetry.initialRisk : 2.0);

                    // 1. Current Progress % (clamped 0 to 100)
                    let currentProgress = 0;
                    if (targetDistance > 0 && mark !== null && fill !== null) {
                      currentProgress = Math.min(100, Math.max(0, ((dir * (mark - fill)) / targetDistance) * 100));
                    } else if (targetRR > 0 && telemetry.priceR !== null) {
                      currentProgress = Math.min(100, Math.max(0, (telemetry.priceR / targetRR) * 100));
                    }

                    // 2. Highest Reach Point / Max Excursion % (clamped 0 to 100, always >= currentProgress)
                    const peakPrice = telemetry.peakPrice ?? trade.peakPrice;
                    const peakR = telemetry.peakR ?? trade.peakR;
                    let maxReached = currentProgress;
                    if (targetDistance > 0 && peakPrice !== null && fill !== null && Number.isFinite(peakPrice)) {
                      const pFromPrice = Math.min(100, Math.max(0, ((dir * (peakPrice - fill)) / targetDistance) * 100));
                      maxReached = Math.max(maxReached, pFromPrice);
                    }
                    if (targetRR > 0 && peakR !== null && Number.isFinite(peakR)) {
                      const pFromR = Math.min(100, Math.max(0, (peakR / targetRR) * 100));
                      maxReached = Math.max(maxReached, pFromR);
                    }
                    maxReached = Math.max(currentProgress, maxReached);

                    const isProfitable = (telemetry.priceR ?? 0) >= 0;
                    const isClosing = loadingAction === trade._id;

                    return (
                      <div
                        key={trade._id || `${trade.symbol}-${trade.createdAt}`}
                        style={{
                          background: "rgba(255, 255, 255, 0.02)",
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: 12,
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                        }}
                      >
                        {/* Top Line: Symbol, Direction, Status, Live P&L */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <strong style={{ fontSize: 14 }}>{trade.symbol}</strong>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 800,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background:
                                  trade.dir === 1 ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)",
                                color: trade.dir === 1 ? "var(--green)" : "var(--red)",
                              }}
                            >
                              {trade.dir === 1 ? "BUY" : "SELL"}
                            </span>
                            {trade.lot && (
                              <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>
                                {trade.lot}L
                              </span>
                            )}
                          </div>

                          <div style={{ textAlign: "right", fontFamily: "monospace" }}>
                            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 6 }}>
                              <span
                                title="Actual R (AR): Effective account return with closed partials + remaining quantity"
                                style={{
                                  fontSize: 14,
                                  fontWeight: 800,
                                  color: (telemetry.actualR ?? 0) >= 0 ? "var(--green)" : "var(--red)",
                                }}
                              >
                                {formatAR(telemetry.actualR)}
                              </span>
                              <span
                                title="Ideal R (IR): Theoretical return assuming 100% position was held without partials"
                                style={{
                                  fontSize: 10,
                                  color: "var(--muted)",
                                  fontWeight: 600,
                                }}
                              >
                                ({formatIR(telemetry.idealR)})
                              </span>
                            </div>
                            {(telemetry.totalUsd !== null || telemetry.floatingUsd !== null) && (
                              <div style={{ fontSize: 10, color: "var(--muted)" }}>
                                {formatUsd(telemetry.totalUsd ?? telemetry.floatingUsd)}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Three-Layered Trade Progress Bar (Below Line -> Max Reached Darker -> Current Progress) */}
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
                            <span>Fill: {formatPrice(fill)}</span>
                            <span style={{ fontFamily: "monospace" }}>
                              {`Live: ${Math.round(currentProgress)}% · Peak: ${Math.round(maxReached)}%`}
                            </span>
                            <span>TP: {formatPrice(target)}</span>
                          </div>

                          <div
                            style={{
                              width: "100%",
                              height: 7,
                              borderRadius: 4,
                              background: "rgba(255, 255, 255, 0.08)", // Layer 1: Progress below line
                              position: "relative",
                              overflow: "visible",
                            }}
                          >
                            {/* Layer 2: Max Reached Range (Darker background color showing peak excursion) */}
                            {maxReached > 0 && (
                              <div
                                title={`Peak Reached: ${Math.round(maxReached)}%`}
                                style={{
                                  position: "absolute",
                                  left: 0,
                                  top: 0,
                                  width: `${Math.min(100, Math.max(0, maxReached))}%`,
                                  height: "100%",
                                  background: isProfitable
                                    ? "rgba(16, 185, 129, 0.28)" // Darker green background
                                    : "rgba(239, 68, 68, 0.28)", // Darker red background
                                  borderRadius: 4,
                                  transition: "width 0.3s ease",
                                  zIndex: 1,
                                }}
                              />
                            )}

                            {/* Layer 2 Peak Boundary Notch */}
                            {maxReached > 0 && (
                              <div
                                title={`Highest Reach Point: ${Math.round(maxReached)}%`}
                                style={{
                                  position: "absolute",
                                  left: `calc(${Math.min(100, Math.max(0, maxReached))}% - 1px)`,
                                  top: -2,
                                  width: 2,
                                  height: 11,
                                  background: isProfitable ? "#34d399" : "#f87171",
                                  borderRadius: 1,
                                  zIndex: 2,
                                  boxShadow: isProfitable ? "0 0 5px rgba(52, 211, 153, 0.9)" : "0 0 5px rgba(248, 113, 113, 0.9)",
                                }}
                              />
                            )}

                            {/* 50% Milestone Marker (Books 40% & moves SL to BE) */}
                            <div
                              title="50% Target Milestone (40% Booked, SL to BE)"
                              style={{
                                position: "absolute",
                                left: "calc(50% - 1px)",
                                top: -2,
                                width: 2,
                                height: 11,
                                background: trade.halfTargetBooked || trade.isBreakeven ? "var(--green)" : "rgba(255, 255, 255, 0.4)",
                                borderRadius: 1,
                                zIndex: 3,
                              }}
                            />

                            {/* Layer 3: Current Progress Bar (Bright active fill) */}
                            <div
                              title={`Current Progress: ${Math.round(currentProgress)}%`}
                              style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                width: `${Math.min(100, Math.max(0, currentProgress))}%`,
                                height: "100%",
                                borderRadius: 4,
                                background: isProfitable
                                  ? "linear-gradient(90deg, #10b981, #059669)"
                                  : "linear-gradient(90deg, #ef4444, #dc2626)",
                                transition: "width 0.3s ease",
                                zIndex: 4,
                              }}
                            />
                          </div>

                          {/* Milestone state label */}
                          {(trade.halfTargetBooked || trade.isBreakeven) && (
                            <div
                              style={{
                                fontSize: 9,
                                color: "var(--green)",
                                fontWeight: 700,
                                marginTop: 4,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <Shield size={10} /> 40% Booked · Stop at Breakeven
                            </div>
                          )}
                        </div>

                        {/* Price chips & Actions */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            fontSize: 10,
                            paddingTop: 4,
                            borderTop: "1px solid rgba(255, 255, 255, 0.04)",
                          }}
                        >
                          <div style={{ display: "flex", gap: 8, color: "var(--muted)", fontFamily: "monospace", flexWrap: "wrap", alignItems: "center" }}>
                            <span>SL: {formatPrice(trade.confirmedSlPrice ?? trade.slPrice)}</span>
                            <span>Mark: {formatPrice(mark)}</span>
                            <span style={{ color: "var(--accent)" }}>{formatIR(telemetry.idealR)}</span>
                            <span style={{ color: (telemetry.actualR ?? 0) >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
                              {formatAR(telemetry.actualR)}
                            </span>
                          </div>

                          <button
                            onClick={() => handleCloseTrade(trade._id)}
                            disabled={isClosing}
                            style={{
                              padding: "3px 8px",
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 700,
                              background: "rgba(239, 68, 68, 0.15)",
                              color: "var(--red)",
                              border: "1px solid rgba(239, 68, 68, 0.3)",
                              cursor: isClosing ? "wait" : "pointer",
                            }}
                          >
                            {isClosing ? "Closing..." : "Close"}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </>
            )}

            {/* TAB: STAGED SETUPS */}
            {tab === "staged" && (
              <>
                {stagedTrades.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "24px 16px",
                      color: "var(--muted)",
                      fontSize: 12,
                    }}
                  >
                    No setups currently staged.
                  </div>
                ) : (
                  stagedTrades.map((staged) => {
                    const level = staged.levelDetails || staged.stagedLevel || {};
                    const isApproving = loadingAction === staged._id;
                    const confluence = level.confluenceScore ?? 85;

                    return (
                      <div
                        key={staged._id}
                        style={{
                          background: "rgba(255, 255, 255, 0.02)",
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: 12,
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <strong style={{ fontSize: 13 }}>{staged.symbol}</strong>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background:
                                  staged.dir === 1 ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)",
                                color: staged.dir === 1 ? "var(--green)" : "var(--red)",
                              }}
                            >
                              {staged.dir === 1 ? "BUY SETUP" : "SELL SETUP"}
                            </span>
                          </div>

                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: "var(--accent)",
                              fontFamily: "monospace",
                            }}
                          >
                            Score: {confluence}/100
                          </span>
                        </div>

                        <div style={{ fontSize: 11, color: "var(--muted)" }}>
                          Model: <strong style={{ color: "var(--fg)" }}>{staged.modelId || level.model || "ICT 2022"}</strong>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 10,
                            fontFamily: "monospace",
                            background: "rgba(0, 0, 0, 0.2)",
                            padding: "6px 8px",
                            borderRadius: 6,
                          }}
                        >
                          <span>Entry: {formatPrice(staged.entryPrice ?? level.entry)}</span>
                          <span>SL: {formatPrice(staged.slPrice ?? level.sl)}</span>
                          <span>TP: {formatPrice(staged.tpPrice ?? level.tp)}</span>
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                          <button
                            onClick={() => handleApprove(staged._id)}
                            disabled={isApproving}
                            style={{
                              padding: "4px 10px",
                              borderRadius: 5,
                              fontSize: 11,
                              fontWeight: 700,
                              background: "var(--accent)",
                              color: "#fff",
                              border: "none",
                              cursor: isApproving ? "wait" : "pointer",
                            }}
                          >
                            {isApproving ? "Approving..." : "Approve Trade"}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </>
            )}

            {/* TAB: HISTORY / CLOSED TRADES */}
            {tab === "history" && (
              <>
                {closedTrades.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "24px 16px",
                      color: "var(--muted)",
                      fontSize: 12,
                    }}
                  >
                    No closed trades recorded.
                  </div>
                ) : (
                  closedTrades.map((trade) => {
                    const isWin = trade.status === "closed_tp";
                    const isBe = trade.status === "closed_be" || trade.closeReason === "breakeven";
                    const outcomeLabel = isWin ? "TAKE PROFIT" : isBe ? "BREAKEVEN" : "STOP LOSS";
                    const outcomeColor = isWin ? "var(--green)" : isBe ? "var(--accent)" : "var(--red)";
                    const outcomeBg = isWin ? "rgba(34, 197, 94, 0.15)" : isBe ? "rgba(56, 189, 248, 0.15)" : "rgba(239, 68, 68, 0.15)";
                    const realizedR = isWin ? "+2.0R" : isBe ? "0.0R" : "-1.0R";

                    return (
                      <div
                        key={trade._id}
                        style={{
                          background: "rgba(255, 255, 255, 0.02)",
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: 12,
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <strong style={{ fontSize: 13 }}>{trade.symbol}</strong>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 800,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background:
                                  trade.dir === -1 || String(trade.direction || trade.dirLabel).toUpperCase() === "SELL"
                                    ? "rgba(239, 68, 68, 0.2)"
                                    : "rgba(34, 197, 94, 0.2)",
                                color:
                                  trade.dir === -1 || String(trade.direction || trade.dirLabel).toUpperCase() === "SELL"
                                    ? "var(--red)"
                                    : "var(--green)",
                              }}
                            >
                              {trade.dir === -1 || String(trade.direction || trade.dirLabel).toUpperCase() === "SELL" ? "SELL" : "BUY"}
                            </span>
                            {trade.lot && (
                              <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>
                                {trade.lot}L
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 800,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: outcomeBg,
                                color: outcomeColor,
                              }}
                            >
                              {outcomeLabel}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 800, fontFamily: "monospace", color: outcomeColor }}>
                              {realizedR}
                            </span>
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 10,
                            fontFamily: "monospace",
                            background: "rgba(0, 0, 0, 0.2)",
                            padding: "6px 8px",
                            borderRadius: 6,
                          }}
                        >
                          <span>Entry: {formatPrice(trade.filledPrice ?? trade.entryPrice)}</span>
                          <span>SL: {formatPrice(trade.initialSlPrice ?? trade.slPrice)}</span>
                          <span>TP: {formatPrice(trade.tpPrice)}</span>
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)" }}>
                          <span>Filled: {trade.filledAt ? new Date(trade.filledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                          <span>Closed: {trade.closedAt ? new Date(trade.closedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </>
            )}
          </div>

          {/* Footer Bar */}
          <div
            style={{
              padding: "8px 14px",
              borderTop: "1px solid var(--border)",
              background: "rgba(0, 0, 0, 0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 10,
              color: "var(--muted)",
            }}
          >
            <span>Auto-syncs on tick stream</span>
            <a
              href="/autonomous"
              style={{
                color: "var(--accent)",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Open Full Cockpit →
            </a>
          </div>
        </aside>
    </div>
  );
}
