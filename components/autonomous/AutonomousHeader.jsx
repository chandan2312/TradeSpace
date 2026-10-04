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
} from "lucide-react";

import { getCurrentTimeSlot, getEetTime } from "../../lib/autonomous/timeslots.js";

export default function AutonomousHeader({
  config,
  onTogglePower,
  onScanNow,
  isScanning,
  onOpenSettings,
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
  const execMode = (config?.executionMode || "paper").toUpperCase();
  const horizonMode = (config?.horizonMode || "adaptive").toUpperCase();

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
        padding: "12px 18px",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        marginBottom: 16,
      }}
    >
      {/* Brand & Status */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
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
          }}
          title="Return to Charts"
        >
          <ArrowLeft size={14} /> Charts
        </a>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: isRunning ? "var(--green)" : "var(--muted)",
              boxShadow: isRunning ? "0 0 10px var(--green)" : "none",
            }}
          />
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: -0.2 }}>
            Autonomous Brain Trader
          </h1>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(56, 189, 248, 0.15)",
              color: "var(--accent)",
              border: "1px solid rgba(56, 189, 248, 0.3)",
            }}
          >
            INSTITUTIONAL
          </span>
        </div>
      </div>

      {/* Center badges: Mode, Horizon, Sessions */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {/* Execution Mode */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
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
        >
          <Layers size={13} /> MODE: {execMode}
        </div>

        {/* MT5 Broker Execution Status */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 700,
            background: config?.liveTrading
              ? "rgba(16, 185, 129, 0.15)"
              : "rgba(255, 255, 255, 0.05)",
            color: config?.liveTrading ? "#10b981" : "var(--muted)",
            border: `1px solid ${config?.liveTrading ? "rgba(16, 185, 129, 0.3)" : "var(--border)"}`,
          }}
          title={config?.liveTrading ? "Orders execute live on MT5 broker terminal" : "Orders are simulated in paper trading mode"}
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
          {config?.liveTrading ? "MT5 LIVE" : "PAPER SIM"}
        </div>

        {/* Horizon Mode */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 600,
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid var(--border)",
            color: "var(--fg)",
          }}
        >
          <Compass size={13} style={{ color: "var(--accent)" }} /> HORIZON: {horizonMode}
        </div>

        {/* Active Time Slot & Killzone */}
        {currentSlot && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
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
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 8,
            fontSize: 11,
            color: "var(--muted)",
            background: "rgba(255, 255, 255, 0.02)",
            border: "1px solid var(--border)",
            fontFamily: "monospace",
          }}
        >
          <Clock size={13} /> {eetTime} (Broker) · <span style={{ color: "var(--accent)", fontWeight: 600 }}>{activeSession}</span>
        </div>
      </div>

      {/* Control Buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Scan Now */}
        <button
          onClick={onScanNow}
          disabled={isScanning}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 8,
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid var(--border)",
            color: "var(--fg)",
            fontSize: 12,
            fontWeight: 600,
            cursor: isScanning ? "wait" : "pointer",
          }}
        >
          <RefreshCw size={13} className={isScanning ? "animate-spin" : ""} />
          {isScanning ? "Scanning..." : "Scan Universe"}
        </button>

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 8,
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid var(--border)",
            color: "var(--fg)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
          title="Autonomous Risk & Horizon Configuration"
        >
          <Sliders size={13} /> Settings
        </button>

        {/* Master Power Toggle */}
        <button
          onClick={onTogglePower}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            background: isRunning ? "rgba(239, 68, 68, 0.15)" : "rgba(34, 197, 94, 0.15)",
            color: isRunning ? "var(--red)" : "var(--green)",
            border: `1px solid ${isRunning ? "rgba(239, 68, 68, 0.4)" : "rgba(34, 197, 94, 0.4)"}`,
          }}
        >
          {isRunning ? <Pause size={14} /> : <Play size={14} />}
          {isRunning ? "HALT ENGINE" : "ENGAGE ENGINE"}
        </button>
      </div>
    </header>
  );
}
