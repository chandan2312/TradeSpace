"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AutonomousHeader from "./AutonomousHeader";
import AutonomousKpis from "./AutonomousKpis";
import PairRadar from "./PairRadar";
import StagedQueue from "./StagedQueue";
import ActivePositions from "./ActivePositions";
import BrainInspectorModal from "./BrainInspectorModal";
import ControlConsole from "./ControlConsole";
import AuditLog from "./AuditLog";

export default function AutonomousDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [inspectedPair, setInspectedPair] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const wsRef = useRef(null);

  // Fetch full state from /api/autonomous
  const loadState = useCallback(async () => {
    try {
      const res = await fetch("/api/autonomous", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setData(json);
      }
    } catch (err) {
      console.error("[AutonomousDashboard fetch error]", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadState();
    const iv = setInterval(loadState, 12_000);
    return () => clearInterval(iv);
  }, [loadState]);

  // WebSocket for instantaneous tick and state updates
  useEffect(() => {
    let dead = false;
    const connect = () => {
      if (dead) return;
      try {
        const proto = window.location.protocol === "https:" ? "wss" : "ws";
        const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
        wsRef.current = ws;

        ws.onopen = () => {
          // Subscribe to open active/staged symbols if any
          if (data?.activeTrades?.length || data?.stagedTrades?.length) {
            const syms = [
              ...(data?.activeTrades || []).map((t) => t.symbol),
              ...(data?.stagedTrades || []).map((t) => t.symbol),
            ];
            ws.send(JSON.stringify({ type: "subscribe", symbols: Array.from(new Set(syms)) }));
          }
        };

        ws.onmessage = (ev) => {
          try {
            const m = JSON.parse(ev.data);
            if (m.type === "autonomous_changed") {
              loadState();
            }
          } catch {}
        };

        ws.onclose = () => {
          if (!dead) setTimeout(connect, 3000);
        };
      } catch {}
    };

    connect();
    return () => {
      dead = true;
      if (wsRef.current) wsRef.current.close();
    };
  }, [loadState, data?.activeTrades, data?.stagedTrades]);

  // Actions
  const handleTogglePower = async () => {
    try {
      await fetch("/api/autonomous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle" }),
      });
      loadState();
    } catch (err) {
      console.error(err);
    }
  };

  const handleScanNow = async () => {
    try {
      await fetch("/api/autonomous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan" }),
      });
      loadState();
    } catch (err) {
      console.error(err);
    }
  };

  const handleApproveTrade = async (tradeId) => {
    try {
      await fetch("/api/autonomous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", tradeId }),
      });
      loadState();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDismissTrade = async (tradeId) => {
    try {
      await fetch("/api/autonomous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss", tradeId }),
      });
      loadState();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCloseActiveTrade = async (tradeId) => {
    try {
      await fetch("/api/autonomous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", tradeId }),
      });
      loadState();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveConfig = async (patch) => {
    try {
      await fetch("/api/autonomous/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      loadState();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleWhitelist = async (sym) => {
    if (!data?.config) return;
    const current = new Set(data.config.whitelist || []);
    if (current.has(sym)) current.delete(sym);
    else current.add(sym);
    await handleSaveConfig({ whitelist: Array.from(current) });
  };

  const config = data?.config || {};
  const metrics = data?.metrics || {};
  const activeTrades = data?.activeTrades || [];
  const stagedTrades = data?.stagedTrades || [];
  const rankedPairs = data?.leaderboard?.rankedPairs || [];
  const logs = data?.logs || [];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--fg)",
        padding: "16px 20px",
        fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
      }}
    >
      {/* Top Header */}
      <AutonomousHeader
        config={config}
        onTogglePower={handleTogglePower}
        onScanNow={handleScanNow}
        isScanning={data?.isScanning}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* KPIs Row */}
      <AutonomousKpis metrics={metrics} config={config} />

      {/* Main Grid: Active Positions & Staged Queue */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 16,
          marginBottom: 16,
        }}
      >
        {/* Active Positions */}
        <ActivePositions
          activeTrades={activeTrades}
          onCloseTrade={handleCloseActiveTrade}
        />

        {/* Staged Setups Queue */}
        <StagedQueue
          stagedTrades={stagedTrades}
          onApproveTrade={handleApproveTrade}
          onDismissTrade={handleDismissTrade}
          executionMode={config.executionMode}
        />
      </div>

      {/* Pair Radar & Universe Scanner */}
      <div style={{ marginBottom: 16 }}>
        <PairRadar
          pairs={rankedPairs}
          onInspectPair={(p) => setInspectedPair(p)}
          onToggleWhitelist={handleToggleWhitelist}
          whitelist={config.whitelist || []}
        />
      </div>

      {/* Execution Audit Trail & Cognitive Logs */}
      <div>
        <AuditLog logs={logs} />
      </div>

      {/* Modals */}
      {inspectedPair && (
        <BrainInspectorModal
          pair={inspectedPair}
          onClose={() => setInspectedPair(null)}
        />
      )}

      {settingsOpen && (
        <ControlConsole
          config={config}
          onSaveConfig={handleSaveConfig}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
