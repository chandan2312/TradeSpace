"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Zap,
  Compass,
  FileText,
  Target,
  AlertCircle,
  Radio,
  FileSpreadsheet,
} from "lucide-react";
import AutonomousHeader from "./AutonomousHeader";
import PairRadar from "./PairRadar";
import StagedQueue, { groupStagedTrades } from "./StagedQueue";
import ActivePositions from "./ActivePositions";
import BrainInspectorModal from "./BrainInspectorModal";
import ControlConsole from "./ControlConsole";
import AuditLog from "./AuditLog";
import ExecutionDiagnostics from "./ExecutionDiagnostics";
import JournalView from "../journal/JournalView";
import {
  tradeRiskTelemetry,
  formatPrice,
  formatR,
  formatUsd,
  formatIR,
  formatAR,
  finiteNumber,
} from "./TradeTelemetry";

export default function AutonomousDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState("cockpit"); // "cockpit" | "journal" | "radar" | "audit"
  const [inspectedPair, setInspectedPair] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ticks, setTicks] = useState({});
  const [socketState, setSocketState] = useState("connecting");
  const [stateError, setStateError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const actionRef = useRef(null);
  const wsRef = useRef(null);
  const stateAbortRef = useRef(null);
  const stateRequestRef = useRef(0);
  const symbolsRef = useRef([]);

  const closeInspector = useCallback(() => setInspectedPair(null), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const target = params.get("section") || params.get("tab");
      if (target === "journal" || target === "history") {
        setSection("journal");
      } else if (target === "radar" || target === "audit" || target === "cockpit") {
        setSection(target);
      }
    }
  }, []);

  const handleSelectSection = useCallback((sec) => {
    setSection(sec);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("section", sec);
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  // Fetch full state from /api/autonomous
  const loadState = useCallback(async () => {
    const requestId = ++stateRequestRef.current;
    stateAbortRef.current?.abort();
    const controller = new AbortController();
    stateAbortRef.current = controller;
    try {
      const res = await fetch("/api/autonomous", { cache: "no-store", signal: controller.signal });
      if (!res.ok) {
        let errMsg = `Server returned HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          if (errJson?.error) errMsg = errJson.error;
        } catch (_) {}
        if (requestId === stateRequestRef.current) {
          setStateError(errMsg);
        }
        return;
      }
      const json = await res.json();
      if (requestId === stateRequestRef.current && json.ok) {
        setData(json);
        setStateError(null);
      } else if (requestId === stateRequestRef.current && !json.ok) {
        setStateError(json.error || "Autonomous state unavailable");
      }
    } catch (err) {
      if (err.name !== "AbortError" && requestId === stateRequestRef.current) {
        setStateError(err.message || "Autonomous state unavailable");
      }
    } finally {
      if (requestId === stateRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadState();
    const iv = setInterval(loadState, 12_000);
    return () => {
      clearInterval(iv);
      stateAbortRef.current?.abort();
      stateRequestRef.current++;
    };
  }, [loadState]);

  const symbolKey = Array.from(new Set([
    ...(data?.openTrades || [...(data?.activeTrades || []), ...(data?.stagedTrades || [])]).flatMap((t) => [t.symbol, t.tradeableSymbol, t.canonicalSymbol]),
    ...((data?.leaderboard?.rankedPairs || []).filter((p) => p.isInMainWatchlist || p.symbol === inspectedPair?.symbol).flatMap((p) => [p.symbol, p.tradeableSymbol])),
  ].filter(Boolean).map(String))).sort().join(",");

  // Single WebSocket connection for dashboard tick telemetry
  useEffect(() => {
    let dead = false;
    let reconnectTimer;
    let pingTimer;

    const connect = () => {
      if (dead) return;
      try {
        const proto = window.location.protocol === "https:" ? "wss" : "ws";
        const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
        wsRef.current = ws;
        setSocketState("connecting");

        ws.onopen = () => {
          if (dead || ws !== wsRef.current) return;
          setSocketState("connected");
          ws.send(JSON.stringify({ type: "subscribe", symbols: symbolsRef.current }));

          // Periodic client keepalive ping every 15s
          clearInterval(pingTimer);
          pingTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              try { ws.send(JSON.stringify({ type: "ping" })); } catch {}
            }
          }, 15000);
        };

        ws.onmessage = (ev) => {
          if (dead || ws !== wsRef.current) return;
          try {
            const m = JSON.parse(ev.data);
            if (m.type === "ticks" && m.ticks && typeof m.ticks === "object") {
              const now = Date.now();
              const batch = {};
              for (const [symbol, tick] of Object.entries(m.ticks)) {
                if (!tick || typeof tick !== "object") continue;
                const symUpper = symbol.toUpperCase();
                const symClean = symUpper.replace(/\.I$/i, "");
                const isSubscribed = symbolsRef.current.length === 0 || symbolsRef.current.some((s) => {
                  const su = String(s).toUpperCase();
                  return su === symUpper || su === symClean || su.replace(/\.I$/i, "") === symClean;
                });
                if (isSubscribed) {
                  const tickObj = { ...tick, receivedAt: now };
                  batch[symbol] = tickObj;
                  batch[symUpper] = tickObj;
                  batch[symClean] = tickObj;
                }
              }
              setTicks((prev) => ({ ...prev, ...batch }));
            } else if (m.type === "autonomous_changed") {
              loadState();
            }
          } catch {}
        };

        const handleDisconnect = () => {
          if (dead) return;
          clearInterval(pingTimer);
          if (ws === wsRef.current) {
            setSocketState("reconnecting");
            setTicks({});
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connect, 2000);
          }
        };

        ws.onclose = handleDisconnect;
        ws.onerror = () => {
          if (ws === wsRef.current) {
            setSocketState("reconnecting");
            try { ws.close(); } catch {}
          }
        };
      } catch {
        setSocketState("reconnecting");
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 2000);
      }
    };

    connect();

    // Reconnect immediately when user returns to this tab or network reconnects
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !dead) {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          clearTimeout(reconnectTimer);
          connect();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleVisibility);

    return () => {
      dead = true;
      clearTimeout(reconnectTimer);
      clearInterval(pingTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleVisibility);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) ws.close();
    };
  }, [loadState]);

  useEffect(() => {
    const symbols = symbolKey ? symbolKey.split(",") : [];
    symbolsRef.current = symbols;
    setTicks((previous) => Object.fromEntries(Object.entries(previous).filter(([symbol]) => symbols.includes(symbol))));
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "subscribe", symbols }));
  }, [symbolKey]);

  const mutate = async (body, path = "/api/autonomous") => {
    if (actionRef.current) throw new Error("An autonomous action is already pending");
    actionRef.current = body.action || "config";
    setPendingAction(actionRef.current);
    setActionError(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.error || result.reason || "Autonomous action failed");
      await loadState();
      return result;
    } catch (err) {
      setActionError(err.message);
      loadState();
      throw err;
    } finally {
      actionRef.current = null;
      setPendingAction(null);
    }
  };

  const handleTogglePower = () => mutate({ action: "toggle" }).catch(() => {});
  const handleToggleLiveTrading = () => mutate({ action: "toggleLive" }).catch(() => {});
  const handleScanNow = () => mutate({ action: "scan" }).catch(() => {});
  const handleApproveTrade = (tradeId) => mutate({ action: "approve", tradeId }).catch(() => {});
  const handleDismissTrade = (tradeId) => mutate({ action: "dismiss", tradeId }).catch(() => {});
  const handleCloseActiveTrade = (tradeId, opts = {}) => mutate({ action: "close", tradeId, ...opts }).catch(() => {});
  const handleModifyTradeTarget = (tradeId, { targetRR, tpPrice }) => mutate({ action: "modify_target", tradeId, targetRR, tpPrice });
  const handleSaveConfig = (patch) => mutate(patch, "/api/autonomous/config");

  const handleToggleWhitelist = async (sym) => {
    if (!data?.config) return;
    const current = new Set(data.config.whitelist || []);
    if (current.has(sym)) current.delete(sym);
    else current.add(sym);
    await handleSaveConfig({ whitelist: Array.from(current) }).catch(() => {});
  };

  const config = data?.config || {};
  const metrics = data?.metrics || {};
  const brokerAccount = data?.brokerAccount || null;
  const activeTrades = data?.activeTrades || [];
  const stagedTrades = data?.stagedTrades || [];
  const unifiedStagedSetups = useMemo(() => groupStagedTrades(stagedTrades), [stagedTrades]);
  const recentClosed = data?.recentClosed || [];
  const rankedPairs = data?.leaderboard?.rankedPairs || [];
  const logs = data?.logs || [];

  // Live aggregate floating telemetry across all active positions
  const aggregateTelemetry = useMemo(() => {
    let totalUsd = 0;
    let totalActualR = 0;
    let totalIdealR = 0;
    let validCount = 0;

    activeTrades.forEach((trade) => {
      const tel = tradeRiskTelemetry(trade, ticks);
      if (tel.totalUsd !== null || tel.floatingUsd !== null) {
        totalUsd += (tel.totalUsd ?? tel.floatingUsd ?? 0);
        validCount++;
      }
      if (tel.actualR !== null) {
        totalActualR += tel.actualR;
      }
      if (tel.idealR !== null) {
        totalIdealR += tel.idealR;
      }
    });

    return {
      totalUsd: validCount > 0 ? totalUsd : null,
      totalActualR: validCount > 0 ? totalActualR : null,
      totalIdealR: validCount > 0 ? totalIdealR : null,
      count: activeTrades.length,
    };
  }, [activeTrades, ticks]);

  const isBrokerLive = Number(brokerAccount?.equity ?? brokerAccount?.balance) > 0;
  const effectiveEquity = isBrokerLive ? Number(brokerAccount.equity ?? brokerAccount.balance) : finiteNumber(config?.accountSize);
  const isNetProfit = (aggregateTelemetry.totalUsd ?? 0) >= 0;

  return (
    <div
      className="autonomous-page-container"
      style={{
        minHeight: "100dvh",
        background: "var(--bg)",
        color: "var(--fg)",
        overflowY: "auto",
        overflowX: "hidden",
        WebkitOverflowScrolling: "touch",
        fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
      }}
    >
      {/* Centered anti-stretching container */}
      <div
        style={{
          maxWidth: section === "audit" ? "100%" : 1380,
          margin: "0 auto",
          width: "100%",
          padding: "clamp(10px, 2.5vw, 20px)",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* 1. COMPACT TOP HEADER */}
        <AutonomousHeader
          config={config}
          brokerAccount={brokerAccount}
          onTogglePower={handleTogglePower}
          onToggleLiveTrading={handleToggleLiveTrading}
          onScanNow={handleScanNow}
          isScanning={data?.isScanning || pendingAction === "scan"}
          onOpenSettings={() => setSettingsOpen(true)}
          pendingAction={pendingAction}
          onOpenJournal={() => handleSelectSection("journal")}
          activeSection={section}
          loading={loading}
          stateError={stateError}
        />

        {/* System Error Banner if present */}
        {(actionError || stateError) && (
          <div
            role="alert"
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              background: "rgba(239, 68, 68, 0.12)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "var(--red)",
              fontSize: 12,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <AlertCircle size={15} />
            <span>{actionError || stateError}</span>
          </div>
        )}

        {/* 2. MINIMAL FOCUS HERO COMMAND STRIP (4 Compact Focused Cards) */}
        {/* 2. TOP HIGH-LEVEL KPI STRIP (4 Essential Metrics) */}
        <div className="autonomous-kpi-strip">
          {/* Card 1: Active Positions & Floating P&L */}
          <div
            className="autonomous-kpi-card"
            style={{
              borderColor:
                activeTrades.length > 0
                  ? isNetProfit
                    ? "rgba(34, 197, 94, 0.3)"
                    : "rgba(239, 68, 68, 0.3)"
                  : "var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
              <span className="autonomous-kpi-title">Active Positions</span>
              <span
                className="autonomous-kpi-badge"
                style={{
                  background:
                    activeTrades.length > 0
                      ? isNetProfit
                        ? "rgba(34, 197, 94, 0.15)"
                        : "rgba(239, 68, 68, 0.15)"
                      : "rgba(255, 255, 255, 0.05)",
                  color:
                    activeTrades.length > 0
                      ? isNetProfit
                        ? "var(--green)"
                        : "var(--red)"
                      : "var(--muted)",
                }}
              >
                {activeTrades.length > 0 ? (isNetProfit ? "PROFIT" : "DRAWDOWN") : "IDLE"}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: 5, minWidth: 0 }}>
              <span
                className="autonomous-kpi-value"
                style={{
                  color:
                    activeTrades.length > 0
                      ? isNetProfit
                        ? "var(--green)"
                        : "var(--red)"
                      : "var(--fg)",
                }}
              >
                {activeTrades.length > 0
                  ? aggregateTelemetry.totalUsd !== null
                    ? formatUsd(aggregateTelemetry.totalUsd)
                    : `${activeTrades.length} Active`
                  : "0 Open"}
              </span>
              {activeTrades.length > 0 && aggregateTelemetry.totalActualR !== null && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 3,
                    fontFamily: "monospace",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: isNetProfit ? "var(--green)" : "var(--red)",
                    }}
                  >
                    AR {formatR(aggregateTelemetry.totalActualR)}
                  </span>
                  {aggregateTelemetry.totalIdealR !== null && Math.abs(aggregateTelemetry.totalIdealR - aggregateTelemetry.totalActualR) >= 0.05 && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--muted)",
                        fontWeight: 600,
                      }}
                    >
                      (IR {formatR(aggregateTelemetry.totalIdealR)})
                    </span>
                  )}
                </div>
              )}
            </div>

            <div
              className="autonomous-kpi-sub"
              title={`${activeTrades.length} / ${config.maxConcurrentTrades || 3} Max capacity · Live tick mark`}
            >
              {activeTrades.length} / {config.maxConcurrentTrades || 3} Max cap · Live tick
            </div>
          </div>

          {/* Card 2: Staged Setups Queue */}
          <div
            className="autonomous-kpi-card"
            style={{
              borderColor: unifiedStagedSetups.length > 0 ? "rgba(56, 189, 248, 0.3)" : "var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
              <span className="autonomous-kpi-title">Action Queue</span>
              <span
                className="autonomous-kpi-badge"
                style={{
                  background: unifiedStagedSetups.length > 0 ? "rgba(56, 189, 248, 0.15)" : "rgba(255, 255, 255, 0.05)",
                  color: unifiedStagedSetups.length > 0 ? "var(--accent)" : "var(--muted)",
                }}
              >
                {unifiedStagedSetups.length > 0 ? "ARMED" : "SCANNING"}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: 5, minWidth: 0 }}>
              <span className="autonomous-kpi-value">
                {unifiedStagedSetups.length} {unifiedStagedSetups.length === 1 ? "Setup" : "Setups"}
              </span>
              {unifiedStagedSetups.length > 0 && (
                <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700, whiteSpace: "nowrap" }}>
                  Ready to Fire
                </span>
              )}
            </div>

            <div
              className="autonomous-kpi-sub"
              title={
                unifiedStagedSetups.length > 0
                  ? `Lead: ${unifiedStagedSetups[0]?.symbol || "SMC"} (${unifiedStagedSetups[0]?.modelId || "A+"})`
                  : "Scanner loop active · Refreshes every 3m"
              }
            >
              {unifiedStagedSetups.length > 0
                ? `Lead: ${unifiedStagedSetups[0]?.symbol || "SMC"} (${unifiedStagedSetups[0]?.modelId || "A+"})`
                : "Scanner loop active · Refreshes every 3m"}
            </div>
          </div>
        </div>

        {/* 3. MULTI-SECTION NAVIGATION TABS (Sleek Segmented Pill Bar) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
            borderBottom: "1px solid var(--border)",
            paddingBottom: 4,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: "rgba(255, 255, 255, 0.03)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 4,
              overflowX: "auto",
              maxWidth: "100%",
            }}
          >
            {/* Tab 1: Live Cockpit (Primary Focus) */}
            <button
              onClick={() => handleSelectSection("cockpit")}
              title="Live Cockpit"
              aria-label="Live Cockpit"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                padding: "8px 12px",
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                background: section === "cockpit" ? "var(--accent)" : "transparent",
                color: section === "cockpit" ? "#fff" : "var(--muted)",
                transition: "all 0.15s ease",
              }}
            >
              <Zap size={15} />
              {activeTrades.length > 0 && (
                <span
                  style={{
                    padding: "1px 6px",
                    borderRadius: 10,
                    fontSize: 10,
                    background: section === "cockpit" ? "rgba(255, 255, 255, 0.25)" : "var(--accent)",
                    color: "#fff",
                    fontWeight: 800,
                  }}
                >
                  {activeTrades.length}
                </span>
              )}
            </button>

            {/* Tab 2: Trading Journal */}
            <button
              onClick={() => handleSelectSection("journal")}
              title="Trading Journal"
              aria-label="Trading Journal"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                padding: "8px 12px",
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                background: (section === "journal" || section === "history") ? "var(--accent)" : "transparent",
                color: (section === "journal" || section === "history") ? "#fff" : "var(--muted)",
                transition: "all 0.15s ease",
              }}
            >
              <FileSpreadsheet size={15} />
            </button>

            {/* Tab 3: Market Radar */}
            <button
              onClick={() => handleSelectSection("radar")}
              title="Market Radar"
              aria-label="Market Radar"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                padding: "8px 12px",
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                background: section === "radar" ? "var(--accent)" : "transparent",
                color: section === "radar" ? "#fff" : "var(--muted)",
                transition: "all 0.15s ease",
              }}
            >
              <Compass size={15} />
              <span
                style={{
                  padding: "1px 6px",
                  borderRadius: 10,
                  fontSize: 10,
                  background: section === "radar" ? "rgba(255, 255, 255, 0.25)" : "rgba(255, 255, 255, 0.08)",
                  color: section === "radar" ? "#fff" : "var(--muted)",
                  fontWeight: 800,
                }}
              >
                {rankedPairs.length}
              </span>
            </button>

            {/* Tab 4: Audit Trail */}
            <button
              onClick={() => handleSelectSection("audit")}
              title="Audit Trail"
              aria-label="Audit Trail"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                padding: "8px 12px",
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                background: section === "audit" ? "var(--accent)" : "transparent",
                color: section === "audit" ? "#fff" : "var(--muted)",
                transition: "all 0.15s ease",
              }}
            >
              <FileText size={15} />
              {logs.length > 0 && (
                <span
                  style={{
                    padding: "1px 6px",
                    borderRadius: 10,
                    fontSize: 10,
                    background: section === "audit" ? "rgba(255, 255, 255, 0.25)" : "rgba(255, 255, 255, 0.08)",
                    color: section === "audit" ? "#fff" : "var(--muted)",
                    fontWeight: 800,
                  }}
                >
                  {logs.length}
                </span>
              )}
            </button>
          </div>

          {/* Quick socket status telemetry */}
          <div
            style={{
              fontSize: 11,
              fontFamily: "monospace",
              color: socketState === "connected" ? "var(--green)" : "var(--orange)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Radio size={13} />
            <span>
              {socketState === "connected" ? "STREAM LIVE" : socketState.toUpperCase()} ·{" "}
              {Object.keys(ticks).length} Live feeds
            </span>
          </div>
        </div>

        {/* 4. DYNAMIC SECTION CONTENTS */}

        {/* SECTION 1: LIVE COCKPIT (First View Minimal Focus) */}
        {section === "cockpit" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Active Positions Cards */}
            <ActivePositions
              activeTrades={activeTrades}
              onCloseTrade={handleCloseActiveTrade}
              ticks={ticks}
              pendingAction={pendingAction}
            />

            {/* Staged Opportunities Cards */}
            <StagedQueue
              stagedTrades={stagedTrades}
              onApproveTrade={handleApproveTrade}
              onDismissTrade={handleDismissTrade}
              onModifyTrade={handleModifyTradeTarget}
              executionMode={config.executionMode}
              ticks={ticks}
              pendingAction={pendingAction}
            />

            {/* Compact Diagnostics */}
            <ExecutionDiagnostics
              trades={data?.executionTrades || []}
              diagnostics={data?.executionDiagnostics}
            />

          </div>
        )}

        {/* SECTION: EMBEDDED TRADING JOURNAL */}
        {(section === "journal" || section === "history") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <JournalView />
          </div>
        )}

        {/* SECTION 2: OPPORTUNITY RADAR */}
        {section === "radar" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <PairRadar
              pairs={rankedPairs}
              onInspectPair={(p) => setInspectedPair(p)}
              onToggleWhitelist={handleToggleWhitelist}
              whitelist={config.whitelist || []}
              ticks={ticks}
            />
          </div>
        )}


        {/* SECTION 4: AUDIT TRAIL */}
        {section === "audit" && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <AuditLog
              logs={[...logs, ...(data?.events || [])].sort(
                (a, b) => new Date(b.createdAt || b.time) - new Date(a.createdAt || a.time)
              )}
            />
          </div>
        )}

        {/* MODALS */}
        {inspectedPair && (
          <BrainInspectorModal
            pair={rankedPairs.find((pair) => (pair.radarKey && inspectedPair.radarKey ? pair.radarKey === inspectedPair.radarKey : pair.symbol === inspectedPair.symbol)) || inspectedPair}
            ticks={ticks}
            onClose={closeInspector}
          />
        )}

        {settingsOpen && (
          <ControlConsole
            config={config}
            brokerAccount={brokerAccount}
            allTimeSlots={data?.allTimeSlots}
            allSymbolProfiles={data?.allSymbolProfiles}
            allEntryModels={data?.allEntryModels}
            universe={config.universe || data?.universe || []}
            onSaveConfig={handleSaveConfig}
            onClose={closeSettings}
          />
        )}
      </div>
    </div>
  );
}
