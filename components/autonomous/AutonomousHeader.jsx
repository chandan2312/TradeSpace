"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Play,
  Pause,
  Sliders,
  RefreshCw,
  Compass,
  Clock,
  Layers,
  ArrowLeft,
  BookOpen,
} from "lucide-react";

import { getCurrentTimeSlot, getEetTime } from "../../lib/autonomous/timeslots.js";

export default function AutonomousHeader({
  config,
  brokerAccount,
  onTogglePower,
  onToggleLiveTrading,
  onScanNow,
  isScanning,
  onOpenSettings,
  pendingAction,
  onOpenJournal,
  activeSection,
  loading = false,
  stateError = null,
}) {
  const [eetTime, setEetTime] = useState("");
  const [activeSession, setActiveSession] = useState("");
  const [currentSlot, setCurrentSlot] = useState(null);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const { h, m, s } = getEetTime(now);
      setEetTime(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} EET`
      );

      const slot = getCurrentTimeSlot(now);
      setCurrentSlot(slot);

      const sessions = [];
      if (h >= 2 && h <= 8) sessions.push("ASIA");
      if (h >= 10 && h <= 18) sessions.push("LONDON");
      if (h >= 15 && h <= 23) sessions.push("NEW YORK");
      setActiveSession(sessions.join(" · ") || "OFF-HOURS");
    };
    updateTime();
    const iv = setInterval(updateTime, 1000);
    return () => clearInterval(iv);
  }, []);

  const isRunning = !!config?.enabled;
  const configAvailable = typeof config?.enabled === "boolean";
  const execMode = (config?.executionMode || "unavailable").toUpperCase();
  const horizonMode = (config?.horizonMode || "unavailable").toUpperCase();

  return (
    <header className="autonomous-header">
      {/* Row 1: Nav & Title/Status */}
      <div className="autonomous-header-top">
        <div className="autonomous-header-nav-group" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <a
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: "var(--muted)",
              textDecoration: "none",
              fontSize: 13,
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              whiteSpace: "nowrap",
            }}
            title="Return to Charts"
          >
            <ArrowLeft size={14} /> Charts
          </a>

          <button
            type="button"
            onClick={() => {
              if (onOpenJournal) {
                onOpenJournal();
              } else if (typeof window !== "undefined") {
                window.location.href = "/autonomous?section=journal";
              }
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: activeSection === "journal" ? "#fff" : "var(--accent)",
              textDecoration: "none",
              fontSize: 13,
              padding: "4px 8px",
              borderRadius: 6,
              border: activeSection === "journal" ? "1px solid var(--accent)" : "1px solid rgba(41, 98, 255, 0.3)",
              background: activeSection === "journal" ? "var(--accent)" : "rgba(41, 98, 255, 0.1)",
              cursor: "pointer",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
            title="Open Autonomous Trading Journal"
          >
            <BookOpen size={14} /> Journal
          </button>
        </div>

        <div className="autonomous-header-title-box" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              flexShrink: 0,
              background: isRunning ? "var(--green)" : "var(--muted)",
              boxShadow: isRunning ? "0 0 10px var(--green)" : "none",
            }}
          />
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: -0.2, whiteSpace: "nowrap" }}>
            Autonomous Brain Trader
          </h1>
          <span
            className="inst-tag"
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(56, 189, 248, 0.15)",
              color: "var(--accent)",
              border: "1px solid rgba(56, 189, 248, 0.3)",
              whiteSpace: "nowrap",
            }}
          >
            INSTITUTIONAL
          </span>
        </div>
      </div>

      {/* Row 2: Center badges (Mode, MT5 Live, Horizon, Killzone, Session) */}
      <div className="autonomous-header-badges">
        {/* Execution Mode */}
        <div
          className="autonomous-badge-chip"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 8px",
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 600,
            background:
              execMode === "AUTO"
                ? "rgba(34, 197, 94, 0.15)"
                : execMode === "COPILOT"
                ? "rgba(168, 85, 247, 0.15)"
                : "rgba(234, 179, 8, 0.15)",
            color:
              execMode === "AUTO"
                ? "var(--green)"
                : execMode === "COPILOT"
                ? "var(--purple)"
                : "var(--orange)",
            border: "1px solid var(--border)",
          }}
          title={`Execution Mode: ${execMode}`}
        >
          <Layers size={13} /> {execMode}
        </div>

        {/* MT5 Broker Execution Status (1-Click Toggle) */}
        <button
          className="autonomous-badge-chip"
          onClick={onToggleLiveTrading}
          disabled={pendingAction === "toggleLive"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 8px",
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
            background: config?.liveTrading
              ? "rgba(16, 185, 129, 0.2)"
              : "rgba(255, 255, 255, 0.05)",
            color: config?.liveTrading ? "#10b981" : "var(--muted)",
            border: `1px solid ${config?.liveTrading ? "rgba(16, 185, 129, 0.4)" : "var(--border)"}`,
          }}
          title={
            config?.liveTrading
              ? `MT5 LIVE ENABLED: Connected to ${brokerAccount?.server || "MT5"} (#${brokerAccount?.login || ""}) · Balance: $${Number(brokerAccount?.equity || brokerAccount?.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} - Click to switch to Paper Sim`
              : "PAPER SIM ACTIVE: Click to toggle LIVE MT5 broker execution"
          }
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: config?.liveTrading ? "#10b981" : "var(--muted)",
              boxShadow: config?.liveTrading ? "0 0 8px #10b981" : "none",
            }}
          />
          {config?.liveTrading ? "MT5: ON" : "MT5: PAPER"}
        </button>

        {/* Horizon Mode */}
        <div
          className="autonomous-badge-chip"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 8px",
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 600,
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid var(--border)",
            color: "var(--fg)",
          }}
          title={`Horizon Mode: ${horizonMode}`}
        >
          <Compass size={13} style={{ color: "var(--accent)" }} /> {horizonMode}
        </div>

        {/* Active Time Slot & Killzone */}
        {currentSlot && (
          <div
            className="autonomous-badge-chip"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 8px",
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              background: currentSlot.isDeadZone
                ? "rgba(239, 68, 68, 0.15)"
                : currentSlot.isSilverBullet
                ? "rgba(168, 85, 247, 0.18)"
                : currentSlot.isKillzone
                ? "rgba(34, 197, 94, 0.15)"
                : "rgba(255, 255, 255, 0.04)",
              color: currentSlot.isDeadZone
                ? "var(--red)"
                : currentSlot.isSilverBullet
                ? "var(--purple)"
                : currentSlot.isKillzone
                ? "var(--green)"
                : "var(--fg)",
              border: `1px solid ${
                currentSlot.isDeadZone
                  ? "rgba(239, 68, 68, 0.4)"
                  : currentSlot.isSilverBullet
                  ? "rgba(168, 85, 247, 0.4)"
                  : currentSlot.isKillzone
                  ? "rgba(34, 197, 94, 0.3)"
                  : "var(--border)"
              }`,
            }}
            title={`${currentSlot.name} (${currentSlot.eetRange}) · ${currentSlot.description}`}
          >
            <Activity size={12} />
            <span>{currentSlot.shortBadge}</span>
            {currentSlot.minutesRemaining > 0 && !currentSlot.isDeadZone && (
              <span style={{ fontSize: 9, opacity: 0.8, fontFamily: "monospace" }}>
                ({currentSlot.minutesRemaining}m left)
              </span>
            )}
          </div>
        )}

        {/* Session & Clock */}
        <div
          className="autonomous-badge-chip"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 8px",
            borderRadius: 8,
            fontSize: 11,
            color: "var(--muted)",
            background: "rgba(255, 255, 255, 0.02)",
            border: "1px solid var(--border)",
            fontFamily: "monospace",
          }}
        >
          <Clock size={13} /> {eetTime} · <span style={{ color: "var(--accent)", fontWeight: 600 }}>{activeSession}</span>
        </div>
      </div>

      {/* Control Buttons */}
      <div className="autonomous-header-actions">
        {/* Scan Now */}
        <button
          onClick={onScanNow}
          disabled={isScanning || !!pendingAction || !configAvailable}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            padding: 0,
            borderRadius: 8,
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid var(--border)",
            color: "var(--fg)",
            cursor: isScanning ? "wait" : "pointer",
          }}
          title={isScanning ? "Scanning universe..." : "Scan Universe"}
          aria-label="Scan Universe"
        >
          <RefreshCw size={14} className={isScanning ? "animate-spin" : ""} />
        </button>

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          disabled={!!pendingAction || !configAvailable}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            padding: 0,
            borderRadius: 8,
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid var(--border)",
            color: "var(--fg)",
            cursor: "pointer",
          }}
          title="Autonomous Settings & Session Windows"
          aria-label="Settings"
        >
          <Sliders size={14} />
        </button>

        {/* Master Power Toggle */}
        <button
          onClick={onTogglePower}
          disabled={!!pendingAction || !configAvailable || loading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 34,
            height: 32,
            padding: 0,
            borderRadius: 8,
            cursor: loading || !configAvailable ? "not-allowed" : "pointer",
            background: isRunning ? "rgba(239, 68, 68, 0.15)" : "rgba(34, 197, 94, 0.15)",
            color: isRunning ? "var(--red)" : "var(--green)",
            border: `1px solid ${isRunning ? "rgba(239, 68, 68, 0.4)" : "rgba(34, 197, 94, 0.4)"}`,
            opacity: loading || !configAvailable ? 0.6 : 1,
          }}
          title={
            loading
              ? "Connecting to Autonomous Brain..."
              : !configAvailable
              ? (stateError ? `System Unavailable: ${stateError}` : "System Unavailable — Reconnecting to Backend...")
              : isRunning
              ? "Halt Autonomous Trading"
              : "Engage Autonomous Trading"
          }
          aria-label={isRunning ? "Halt Trading" : "Engage Trading"}
        >
          {isRunning ? <Pause size={14} /> : <Play size={14} />}
        </button>
      </div>
    </header>
  );
}
