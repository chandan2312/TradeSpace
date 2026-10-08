"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
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
  Clock,
  FileText,
  FileSpreadsheet,
  Compass,
  Terminal,
  Maximize2,
  Minimize2,
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
import { groupStagedTrades } from "./StagedQueue";
import JournalView from "../journal/JournalView";
import PairRadar from "./PairRadar";
import BrainInspectorModal from "./BrainInspectorModal";
import AuditLog from "./AuditLog";
import StagedTradeModal from "./StagedTradeModal";
import LiveTradeModal from "./LiveTradeModal";

export default function AutonomousLiveHUD({
  trades = [],
  ticks = {},
  radarPairs: radarPairsProp = [],
  logs: logsProp = [],
  onRefresh,
  isOpen: isOpenProp,
  onClose,
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = typeof isOpenProp === "boolean";
  const isOpen = isControlled ? isOpenProp : internalOpen;

  const [tab, setTab] = useState("active"); // "active" | "staged" | "journal" | "radar" | "logs"
  const [isExpanded, setIsExpanded] = useState(false);
  const [loadingAction, setLoadingAction] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);
  const [isMobile, setIsMobile] = useState(false);

  const [selectedActiveTrade, setSelectedActiveTrade] = useState(null);
  const [selectedStagedSetup, setSelectedStagedSetup] = useState(null);
  const [inspectedPair, setInspectedPair] = useState(null);

  const [auxRadarPairs, setAuxRadarPairs] = useState(radarPairsProp || []);
  const [auxLogs, setAuxLogs] = useState(logsProp || []);

  const fetchAuxState = useCallback(async () => {
    try {
      const res = await fetch("/api/autonomous", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ok) {
        if (Array.isArray(data.leaderboard?.rankedPairs)) {
          setAuxRadarPairs(data.leaderboard.rankedPairs);
        }
        if (Array.isArray(data.logs)) {
          setAuxLogs(data.logs);
        }
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchAuxState();
    }
  }, [isOpen, fetchAuxState]);

  const effectiveRadarPairs = radarPairsProp.length > 0 ? radarPairsProp : auxRadarPairs;
  const effectiveLogs = logsProp.length > 0 ? logsProp : auxLogs;

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

  // Auto-refresh when drawer opens
  useEffect(() => {
    if (isOpen && onRefresh) {
      onRefresh();
    }
  }, [isOpen, onRefresh]);

  const activeTrades = useMemo(() => {
    return (trades || []).filter((t) =>
      ["active", "managing", "closing", "open", "filling", "armed_fill"].includes(t.status)
    );
  }, [trades]);

  const stagedTrades = useMemo(() => {
    return (trades || []).filter((t) => ["staged", "confirming", "armed"].includes(t.status));
  }, [trades]);

  const unifiedStagedSetups = useMemo(() => {
    return groupStagedTrades(stagedTrades);
  }, [stagedTrades]);

  // If there are no active positions but there are staged setups, automatically show staged tab
  useEffect(() => {
    if (isOpen && activeTrades.length === 0 && unifiedStagedSetups.length > 0) {
      setTab("staged");
    }
  }, [isOpen, activeTrades.length, unifiedStagedSetups.length]);

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
      stagedCount: unifiedStagedSetups.length,
    };
  }, [activeTrades, unifiedStagedSetups, ticks]);

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
  const handleApprove = async (setupOrId) => {
    const isObj = setupOrId && typeof setupOrId === "object";
    const primaryId = isObj ? (setupOrId.primaryId || setupOrId._id) : setupOrId;
    const hasGroupId = isObj ? Boolean(setupOrId.groupId) : false;
    const allIds = isObj && Array.isArray(setupOrId.tradeIds) ? setupOrId.tradeIds : [primaryId];

    if (loadingAction) return;
    setLoadingAction(primaryId);
    setActionMsg(null);
    try {
      const res = await fetch("/api/autonomous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", tradeId: primaryId }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Failed to approve setup");
      }

      // If not grouped by backend groupId and there are separate sibling ids, approve remaining
      if (!hasGroupId && allIds.length > 1) {
        for (const id of allIds) {
          if (id === primaryId) continue;
          await fetch("/api/autonomous", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "approve", tradeId: id }),
          });
        }
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

  // Quick action: dismiss staged setup
  const handleDismissSetup = async (setupOrId) => {
    const isObj = setupOrId && typeof setupOrId === "object";
    const primaryId = isObj ? (setupOrId.primaryId || setupOrId._id) : setupOrId;
    const hasGroupId = isObj ? Boolean(setupOrId.groupId) : false;
    const allIds = isObj && Array.isArray(setupOrId.tradeIds) ? setupOrId.tradeIds : [primaryId];

    if (loadingAction) return;
    setLoadingAction(primaryId);
    setActionMsg(null);
    try {
      const res = await fetch("/api/autonomous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss", tradeId: primaryId }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Failed to dismiss setup");
      }

      if (!hasGroupId && allIds.length > 1) {
        for (const id of allIds) {
          if (id === primaryId) continue;
          await fetch("/api/autonomous", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "dismiss", tradeId: id }),
          });
        }
      }

      setActionMsg({ type: "success", text: "Setup dismissed" });
      onRefresh?.();
    } catch (err) {
      setActionMsg({ type: "error", text: err.message });
    } finally {
      setLoadingAction(null);
      setTimeout(() => setActionMsg(null), 3000);
    }
  };

  const hasTrades = activeTrades.length > 0 || unifiedStagedSetups.length > 0;
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
                width: (isExpanded || tab === "journal" || tab === "radar") ? "min(1080px, 96vw)" : 460,
                maxWidth: "96vw",
                height: "100vh",
                transition: "width 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
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
                        <button
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? "Collapse Width" : "Expand Cockpit Width"}
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
              {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
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

            <Link
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
            </Link>

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

          {/* Tab Filter (5 Institutional Cockpit Tabs) */}
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid var(--border)",
              background: "var(--panel-2)",
              overflowX: "auto",
              flexShrink: 0,
              scrollbarWidth: "none",
            }}
          >
            {/* Tab 1: Active Positions */}
            <button
              onClick={() => setTab("active")}
              title="Active Positions"
              aria-label="Active Positions"
              style={{
                flex: 1,
                minWidth: 70,
                padding: "8px 10px",
                fontSize: 11,
                fontWeight: 700,
                border: "none",
                background: tab === "active" ? "rgba(255, 255, 255, 0.06)" : "transparent",
                color: tab === "active" ? "var(--fg)" : "var(--muted)",
                borderBottom: tab === "active" ? "2px solid var(--accent)" : "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                whiteSpace: "nowrap",
              }}
            >
              <Zap size={13} />
              <span>Active</span>
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 5px",
                  borderRadius: 10,
                  background: tab === "active" ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.05)",
                  color: tab === "active" ? "#fff" : "var(--muted)",
                  fontWeight: 800,
                }}
              >
                {activeTrades.length}
              </span>
            </button>

            {/* Tab 2: Staged Setups */}
            <button
              onClick={() => setTab("staged")}
              title="Staged Setups"
              aria-label="Staged Setups"
              style={{
                flex: 1,
                minWidth: 72,
                padding: "8px 10px",
                fontSize: 11,
                fontWeight: 700,
                border: "none",
                background: tab === "staged" ? "rgba(255, 255, 255, 0.06)" : "transparent",
                color: tab === "staged" ? "var(--fg)" : (unifiedStagedSetups.length > 0 ? "var(--accent)" : "var(--muted)"),
                borderBottom: tab === "staged" ? "2px solid var(--accent)" : "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                whiteSpace: "nowrap",
              }}
            >
              <Clock size={13} />
              <span>Staged</span>
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 5px",
                  borderRadius: 10,
                  background: unifiedStagedSetups.length > 0 ? "rgba(56, 189, 248, 0.2)" : "rgba(255, 255, 255, 0.05)",
                  color: unifiedStagedSetups.length > 0 ? "var(--accent)" : "var(--muted)",
                  fontWeight: 800,
                }}
              >
                {unifiedStagedSetups.length}
              </span>
            </button>

            {/* Tab 3: Trading Journal */}
            <button
              onClick={() => setTab("journal")}
              title="Trading Journal"
              aria-label="Trading Journal"
              style={{
                flex: 1,
                minWidth: 72,
                padding: "8px 10px",
                fontSize: 11,
                fontWeight: 700,
                border: "none",
                background: tab === "journal" ? "rgba(255, 255, 255, 0.06)" : "transparent",
                color: tab === "journal" ? "var(--fg)" : "var(--muted)",
                borderBottom: tab === "journal" ? "2px solid var(--accent)" : "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                whiteSpace: "nowrap",
              }}
            >
              <FileSpreadsheet size={13} />
              <span>Journal</span>
            </button>

            {/* Tab 4: Market Radar */}
            <button
              onClick={() => setTab("radar")}
              title="Market Radar"
              aria-label="Market Radar"
              style={{
                flex: 1,
                minWidth: 68,
                padding: "8px 10px",
                fontSize: 11,
                fontWeight: 700,
                border: "none",
                background: tab === "radar" ? "rgba(255, 255, 255, 0.06)" : "transparent",
                color: tab === "radar" ? "var(--fg)" : "var(--muted)",
                borderBottom: tab === "radar" ? "2px solid var(--accent)" : "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                whiteSpace: "nowrap",
              }}
            >
              <Compass size={13} />
              <span>Radar</span>
              {effectiveRadarPairs.length > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    padding: "1px 5px",
                    borderRadius: 10,
                    background: tab === "radar" ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.05)",
                    color: tab === "radar" ? "#fff" : "var(--muted)",
                    fontWeight: 800,
                  }}
                >
                  {effectiveRadarPairs.length}
                </span>
              )}
            </button>

            {/* Tab 5: Audit Logs */}
            <button
              onClick={() => setTab("logs")}
              title="Audit Logs"
              aria-label="Audit Logs"
              style={{
                flex: 1,
                minWidth: 62,
                padding: "8px 10px",
                fontSize: 11,
                fontWeight: 700,
                border: "none",
                background: tab === "logs" ? "rgba(255, 255, 255, 0.06)" : "transparent",
                color: tab === "logs" ? "var(--fg)" : "var(--muted)",
                borderBottom: tab === "logs" ? "2px solid var(--accent)" : "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                whiteSpace: "nowrap",
              }}
            >
              <Terminal size={13} />
              <span>Logs</span>
              {effectiveLogs.length > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    padding: "1px 5px",
                    borderRadius: 10,
                    background: tab === "logs" ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.05)",
                    color: tab === "logs" ? "#fff" : "var(--muted)",
                    fontWeight: 800,
                  }}
                >
                  {effectiveLogs.length}
                </span>
              )}
            </button>
          </div>

          {/* Body Content / Card List */}
          <div
            style={{
              padding: tab === "journal" || tab === "radar" || tab === "logs" ? 6 : 12,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              minHeight: 120,
              flex: 1,
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
                        onClick={() => setSelectedActiveTrade(trade)}
                        title="Click to view live trade popup"
                        style={{
                          background: "rgba(255, 255, 255, 0.02)",
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: 12,
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                          cursor: "pointer",
                          transition: "border-color 0.15s ease, background 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "var(--accent)";
                          e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "var(--border)";
                          e.currentTarget.style.background = "rgba(255, 255, 255, 0.02)";
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

                          {trade.redecisionDone && (
                            <div
                              style={{
                                fontSize: 9,
                                color:
                                  trade.redecisionAction === "CLOSE_FULL_NOW"
                                    ? "var(--red)"
                                    : trade.redecisionAction === "REDUCE_TP"
                                    ? "var(--accent)"
                                    : trade.redecisionAction === "EXPAND_TP"
                                    ? "var(--purple, #c084fc)"
                                    : "var(--green)",
                                fontWeight: 700,
                                marginTop: 2,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                fontFamily: "monospace",
                              }}
                            >
                              <span>
                                {trade.redecisionAction === "CLOSE_FULL_NOW"
                                  ? "⚡ Redecision: Closed Full Runner"
                                  : trade.redecisionAction === "REDUCE_TP"
                                  ? `🎯 Redecision: Reduced TP (${trade.redecisionNewRR || trade.targetRR}R)`
                                  : trade.redecisionAction === "EXPAND_TP"
                                  ? `🚀 Redecision: Expanded TP (${trade.redecisionNewRR || trade.targetRR}R)`
                                  : `💎 Redecision: Hold Full (${trade.targetRR}R)`}
                              </span>
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
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCloseTrade(trade._id);
                            }}
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
                {unifiedStagedSetups.length === 0 ? (
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
                  unifiedStagedSetups.map((setup) => {
                    const trade = setup.primaryTrade || setup;
                    const level = trade.levelDetails || trade.stagedLevel || {};
                    const isApproving = loadingAction === (setup.primaryId || setup._id);
                    const confluence = level.confluenceScore ?? trade.confluenceScore ?? 85;
                    const isDual = setup.isDualLeg;
                    const defaultLeg = setup.defaultLeg;
                    const propLeg = setup.propLeg;

                    return (
                      <div
                        key={setup.groupKey || setup.primaryId || setup._id}
                        onClick={() => setSelectedStagedSetup(setup)}
                        title="Click to view staged setup popup"
                        style={{
                          background: "rgba(255, 255, 255, 0.02)",
                          border: isDual ? "1px solid rgba(56, 189, 248, 0.25)" : "1px solid var(--border)",
                          borderRadius: 10,
                          padding: 12,
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          cursor: "pointer",
                          transition: "border-color 0.15s ease, background 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "var(--accent)";
                          e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = isDual ? "rgba(56, 189, 248, 0.25)" : "var(--border)";
                          e.currentTarget.style.background = "rgba(255, 255, 255, 0.02)";
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
                            <strong style={{ fontSize: 13 }}>{setup.symbol}</strong>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background:
                                  setup.dir === 1 ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)",
                                color: setup.dir === 1 ? "var(--green)" : "var(--red)",
                              }}
                            >
                              {setup.dir === 1 ? "BUY SETUP" : "SELL SETUP"}
                            </span>
                            {isDual && (
                              <span
                                style={{
                                  fontSize: 9,
                                  fontWeight: 800,
                                  padding: "2px 5px",
                                  borderRadius: 4,
                                  background: "rgba(56, 189, 248, 0.15)",
                                  color: "var(--accent)",
                                  letterSpacing: 0.3,
                                }}
                              >
                                DUAL LEG
                              </span>
                            )}
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

                        <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>
                          <span>Model: <strong style={{ color: "var(--fg)" }}>{setup.modelId || level.model || "ICT 2022"}</strong></span>
                          {setup.status === "armed" && (
                            <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 10 }}>⚡ ARMED</span>
                          )}
                        </div>

                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 10,
                            fontFamily: "monospace",
                            background: "var(--panel-2)",
                            padding: "6px 8px",
                            borderRadius: 6,
                          }}
                        >
                          <span>Entry: <strong style={{ color: "var(--fg)" }}>{formatPrice(setup.entryPrice ?? level.entry)}</strong></span>
                          <span>SL: <strong style={{ color: "var(--red)" }}>{formatPrice(setup.slPrice ?? level.sl)}</strong></span>
                          {!isDual && (
                            <span>TP: <strong style={{ color: "var(--green)" }}>{formatPrice(setup.tpPrice ?? level.tp)}</strong></span>
                          )}
                        </div>

                        {/* Dual Management Pathways: Default 50% Milestone + Full TP vs Prop Safe */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          {/* Pathway 1: Default Milestone & Full TP */}
                          <div
                            style={{
                              background: "rgba(56, 189, 248, 0.04)",
                              border: "1px solid rgba(56, 189, 248, 0.22)",
                              borderRadius: 6,
                              padding: "5px 8px",
                              display: "flex",
                              flexDirection: "column",
                              gap: 3,
                              fontSize: 10,
                              fontFamily: "monospace",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontWeight: 800, color: "var(--accent)", fontSize: 9 }}>
                                PATH A · DEFAULT (50% + RUNNER)
                              </span>
                              {(defaultLeg?.magicNumber || defaultLeg?.routing?.magicNumber) && (
                                <span style={{ color: "var(--accent)", fontSize: 9 }}>⚡ MT5 #{defaultLeg.magicNumber || defaultLeg.routing?.magicNumber}</span>
                              )}
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ color: "var(--muted)", fontSize: 9.5 }}>
                                50% Level: <strong style={{ color: "var(--accent)" }}>{formatPrice(setup.halfPrice)}</strong> ({Number(setup.halfRR || 2.2).toFixed(1)}R)
                              </span>
                              <span style={{ fontSize: 8.5, color: "var(--accent)", fontWeight: 700 }}>Book 40% + BE</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ color: "var(--muted)", fontSize: 9.5 }}>
                                Full TP: <strong style={{ color: "var(--green)" }}>{formatPrice(setup.fullTp)}</strong> ({Number(setup.fullRR || defaultLeg?.targetRR || 4.0).toFixed(1)}R)
                              </span>
                              <span style={{ fontSize: 8.5, color: "var(--green)", fontWeight: 700 }}>60% to DOL</span>
                            </div>
                          </div>

                          {/* Pathway 2: Prop Safe */}
                          <div
                            style={{
                              background: "rgba(168, 85, 247, 0.04)",
                              border: "1px solid rgba(168, 85, 247, 0.22)",
                              borderRadius: 6,
                              padding: "5px 8px",
                              display: "flex",
                              flexDirection: "column",
                              gap: 3,
                              fontSize: 10,
                              fontFamily: "monospace",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontWeight: 800, color: "var(--purple, #c084fc)", fontSize: 9 }}>
                                PATH B · PROP-FIRM SAFE
                              </span>
                              {(propLeg?.magicNumber || propLeg?.routing?.magicNumber) && (
                                <span style={{ color: "var(--purple, #c084fc)", fontSize: 9 }}>⚡ MT5 #{propLeg.magicNumber || propLeg.routing?.magicNumber}</span>
                              )}
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ color: "var(--muted)", fontSize: 9.5 }}>
                                Target: <strong style={{ color: "var(--green)" }}>{formatPrice(setup.propTp)}</strong> ({Number(setup.propRR || 2.0).toFixed(1)}R)
                              </span>
                              <span style={{ fontSize: 8.5, color: "var(--purple, #c084fc)", fontWeight: 700 }}>100% Exit</span>
                            </div>
                            {(propLeg?.targetLandmark || propLeg?.propTarget?.source) && (
                              <div style={{ color: "var(--purple, #c084fc)", fontSize: 8.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                🎯 {propLeg?.targetLandmark || propLeg?.propTarget?.source}
                              </div>
                            )}
                          </div>
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, paddingTop: 2 }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDismissSetup(setup);
                            }}
                            disabled={isApproving}
                            style={{
                              padding: "4px 10px",
                              borderRadius: 5,
                              fontSize: 11,
                              fontWeight: 600,
                              background: "rgba(255, 255, 255, 0.05)",
                              color: "var(--muted)",
                              border: "1px solid var(--border)",
                              cursor: isApproving ? "wait" : "pointer",
                            }}
                          >
                            Dismiss
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleApprove(setup);
                            }}
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
                            {isApproving ? "Approving..." : isDual ? "Approve Dual Setup" : "Approve Trade"}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </>
            )}

            {/* TAB: TRADING JOURNAL */}
            {tab === "journal" && (
              <div style={{ flex: 1, minHeight: 480, overflowY: "auto" }}>
                <JournalView />
              </div>
            )}

            {/* TAB: MARKET RADAR */}
            {tab === "radar" && (
              <div style={{ flex: 1, minHeight: 480, overflowY: "auto" }}>
                <PairRadar
                  pairs={effectiveRadarPairs}
                  ticks={ticks}
                  onInspectPair={(p) => setInspectedPair(p)}
                />
              </div>
            )}

            {/* TAB: AUDIT LOGS */}
            {tab === "logs" && (
              <div style={{ flex: 1, minHeight: 480, overflowY: "auto" }}>
                <AuditLog logs={effectiveLogs} />
              </div>
            )}
          </div>

          {/* Footer Bar */}
          <div
            style={{
              padding: "8px 14px",
              borderTop: "1px solid var(--border)",
              background: "var(--panel-2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 10,
              color: "var(--muted)",
            }}
          >
            <span>Auto-syncs on tick stream</span>
            <Link
              href="/autonomous"
              style={{
                color: "var(--accent)",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Open Full Cockpit →
            </Link>
          </div>

          {/* Modals: Staged Setup, Live Position, and Radar Brain Inspector */}
          {selectedStagedSetup && (
            <StagedTradeModal
              setup={selectedStagedSetup}
              ticks={ticks}
              onClose={() => setSelectedStagedSetup(null)}
              onApprove={(s) => {
                handleApprove(s);
                setSelectedStagedSetup(null);
              }}
              onDismiss={(s) => {
                handleDismissSetup(s);
                setSelectedStagedSetup(null);
              }}
              pendingAction={loadingAction}
            />
          )}

          {selectedActiveTrade && (
            <LiveTradeModal
              trade={selectedActiveTrade}
              ticks={ticks}
              onClose={() => setSelectedActiveTrade(null)}
              onCloseTrade={(id) => {
                handleCloseTrade(id);
                setSelectedActiveTrade(null);
              }}
            />
          )}

          {inspectedPair && (
            <BrainInspectorModal
              pair={effectiveRadarPairs.find((p) => (p.radarKey && inspectedPair.radarKey ? p.radarKey === inspectedPair.radarKey : p.symbol === inspectedPair.symbol)) || inspectedPair}
              ticks={ticks}
              onClose={() => setInspectedPair(null)}
            />
          )}
        </aside>
    </div>
  );
}
