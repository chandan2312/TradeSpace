"use client";

import { useState } from "react";
import {
  X,
  Calendar,
  Clock,
  TrendingUp,
  TrendingDown,
  Shield,
  Target,
  Zap,
  ExternalLink,
  Save,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  Star,
  Activity,
  Layers,
  FileText,
} from "lucide-react";

function formatPrice5(val) {
  if (val == null) return "-";
  const num = Number(val);
  if (!Number.isFinite(num)) return "-";
  const factor = 100000;
  const rounded = Math.round(num * factor) / factor;
  const s = rounded.toFixed(5);
  return s.replace(/(\.\d{2,}?)0+$/, "$1");
}

export default function JournalDrawerModal({
  trade,
  onClose,
  onSaveJournal,
  saving = false,
}) {
  const [notes, setNotes] = useState(trade?.notes || "");
  const [imageUrl, setImageUrl] = useState(trade?.imageUrl || "");
  const [rating, setRating] = useState(trade?.rating || 0);
  const [tags, setTags] = useState(trade?.tags || []);
  const [tagInput, setTagInput] = useState("");
  const [activeTab, setActiveTab] = useState("overview"); // "overview" | "context" | "screenshot" | "events"
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!trade) return null;

  const handleAddTag = (e) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      const val = tagInput.trim();
      if (!tags.includes(val)) {
        setTags([...tags, val]);
      }
      setTagInput("");
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSave = async () => {
    if (onSaveJournal) {
      await onSaveJournal(trade.id, {
        notes,
        imageUrl,
        rating,
        tags,
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    }
  };

  const isWin = trade.outcome === "WIN";
  const isLoss = trade.outcome === "LOSS";
  const isBe = trade.outcome === "BREAKEVEN";

  const outcomeColor = isWin ? "var(--green)" : isLoss ? "var(--red)" : "var(--muted)";
  const outcomeBg = isWin
    ? "rgba(38, 166, 154, 0.15)"
    : isLoss
    ? "rgba(239, 83, 80, 0.15)"
    : "rgba(255, 255, 255, 0.08)";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(4px)",
        display: "flex",
        justifyContent: "flex-end",
        animation: "fadeIn 0.2s ease",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 640,
          height: "100%",
          background: "var(--panel, #151a23)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-8px 0 32px rgba(0, 0, 0, 0.6)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--panel-2, #1a202c)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <strong style={{ fontSize: 18, color: "var(--fg)" }}>{trade.symbol}</strong>
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                padding: "2px 8px",
                borderRadius: 4,
                background: trade.dir === 1 ? "rgba(38, 166, 154, 0.2)" : "rgba(239, 83, 80, 0.2)",
                color: trade.dir === 1 ? "var(--green)" : "var(--red)",
              }}
            >
              {trade.dirLabel} {trade.dir === 1 ? "▲" : "▼"}
            </span>

            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 4,
                background: outcomeBg,
                color: outcomeColor,
                border: `1px solid ${outcomeColor}`,
              }}
            >
              {trade.outcome} {isWin ? "🎯" : isLoss ? "🛑" : isBe ? "⚪" : "🟢"}
            </span>

            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: 4,
                background: trade.isPropFirm ? "rgba(171, 71, 188, 0.2)" : "rgba(41, 98, 255, 0.2)",
                color: trade.isPropFirm ? "var(--purple, #ab47bc)" : "var(--accent)",
              }}
            >
              {trade.isPropFirm ? "PROP-FIRM SAFE" : "DEFAULT (50%)"}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <a
              href={`/?symbol=${encodeURIComponent(trade.symbol)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11,
                fontWeight: 700,
                padding: "4px 10px",
                borderRadius: 6,
                background: "rgba(41, 98, 255, 0.15)",
                color: "var(--accent)",
                border: "1px solid rgba(41, 98, 255, 0.3)",
                textDecoration: "none",
              }}
              title="Open this symbol in the live chart view with RR tool"
            >
              <ExternalLink size={12} /> Chart
            </a>
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--muted)",
                cursor: "pointer",
                padding: 4,
                borderRadius: 4,
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid var(--border)",
            background: "var(--panel-2)",
            padding: "0 16px",
          }}
        >
          {[
            { id: "overview", label: "Overview & Numbers", icon: Activity },
            { id: "context", label: "Bias & Context", icon: Layers },
            { id: "screenshot", label: "Screenshot & Notes", icon: ImageIcon },
            { id: "events", label: "Execution Timeline", icon: FileText },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
                aria-label={tab.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "10px 16px",
                  color: active ? "var(--accent)" : "var(--muted)",
                  borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
                  background: "transparent",
                  borderTop: "none",
                  borderLeft: "none",
                  borderRight: "none",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <Icon size={14} />
              </button>
            );
          })}
        </div>

        {/* Tab Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* TAB 1: OVERVIEW & NUMBERS */}
          {activeTab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Highlight KPI Cards Strip */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 8,
                }}
              >
                <div style={{ background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700 }}>ACTUAL RETURN (AR)</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: (trade.actualR ?? trade.realizedR) > 0 ? "var(--green)" : (trade.actualR ?? trade.realizedR) < 0 ? "var(--red)" : "var(--fg)", fontFamily: "monospace" }}>
                    {(trade.actualR ?? trade.realizedR) > 0 ? `+${(trade.actualR ?? trade.realizedR).toFixed(2)}` : (trade.actualR ?? trade.realizedR).toFixed(2)} AR
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                    ${trade.realizedPnlUsd > 0 ? `+${trade.realizedPnlUsd.toFixed(2)}` : trade.realizedPnlUsd.toFixed(2)}
                  </div>
                </div>

                <div style={{ background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700 }}>IDEAL R (IR)</div>
                  {trade.idealR != null && Number(trade.idealR) > 0.2 ? (
                    <>
                      <div style={{ fontSize: 17, fontWeight: 800, color: "var(--accent)", fontFamily: "monospace" }}>
                        +{Number(trade.idealR).toFixed(2)} IR
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                        100% Lot Baseline
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 17, fontWeight: 800, color: "var(--muted)", fontFamily: "monospace" }}>
                        —
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                        N/A (Loss / Breakeven)
                      </div>
                    </>
                  )}
                </div>

                <div style={{ background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700 }}>MAX EQUITY (MFE)</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: "var(--green)", fontFamily: "monospace" }}>
                    +{trade.peakR.toFixed(2)} R
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                    Peak MFE
                  </div>
                </div>

                <div style={{ background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700 }}>MAX DRAWDOWN (MAE)</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: trade.maxDrawdownR < 0 ? "var(--red)" : "var(--muted)", fontFamily: "monospace" }}>
                    {trade.maxDrawdownR.toFixed(2)} R
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                    Deepest MAE
                  </div>
                </div>
              </div>

              {/* Execution Level Chips */}
              <div
                style={{
                  background: "var(--panel-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, color: "var(--fg)" }}>EXECUTION LEVELS & GEOMETRY</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 110px), 1fr))", gap: 8, fontFamily: "monospace", fontSize: 11 }}>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>ENTRY PRICE</span>
                    <strong style={{ color: "var(--fg)" }}>{formatPrice5(trade.entryPrice)}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>STOP LOSS</span>
                    <strong style={{ color: "var(--red)" }}>{formatPrice5(trade.slPrice)}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>ACTIVE TP</span>
                    <strong style={{ color: "var(--green)" }}>{formatPrice5(trade.tpPrice)}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>FULL ASSIGNED TP</span>
                    <strong style={{ color: "var(--green)" }}>
                      {formatPrice5(trade.fullTpPrice ?? trade.tpPrice)}
                      {trade.fullTpRR || trade.targetRR ? ` (${trade.fullTpRR || trade.targetRR}R)` : ""}
                    </strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>EXIT PRICE</span>
                    <strong style={{ color: outcomeColor }}>{trade.exitPrice ? formatPrice5(trade.exitPrice) : "-"}</strong>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255, 255, 255, 0.05)", fontFamily: "monospace", fontSize: 11 }}>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>TARGET R:R</span>
                    <strong>{trade.targetRR}R</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>LOT SIZE / VOLUME</span>
                    <strong>{formatPrice5(trade.lotSize)} lots</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>INITIAL RISK ($)</span>
                    <strong style={{ color: "var(--orange)" }}>${trade.initialRiskUsd}</strong>
                  </div>
                </div>
              </div>

              {/* CFD SPREAD & DUAL-R FRICTION TELEMETRY */}
              <div
                style={{
                  background: "var(--panel-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fg)" }}>CFD SPREAD & FRICTION TELEMETRY</div>
                  {trade.isFrictionExcessive ? (
                    <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4, background: "rgba(239, 83, 80, 0.2)", color: "var(--red)" }}>
                      HIGH SPREAD FRICTION
                    </span>
                  ) : (
                    <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4, background: "rgba(38, 166, 154, 0.2)", color: "var(--green)" }}>
                      OPTIMIZED INSTITUTIONAL
                    </span>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, fontFamily: "monospace", fontSize: 11 }}>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>IDLE NOMINAL R</span>
                    <strong style={{ color: "var(--fg)" }}>{trade.idleRR ?? trade.targetRR}R</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>NET COVERED R</span>
                    <strong style={{ color: "var(--accent, #00b0ff)" }}>{trade.coveredRR ?? trade.targetRR}R</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>FRICTION DRAG</span>
                    <strong style={{ color: (trade.frictionDragR || 0) > 0.2 ? "var(--red)" : "var(--orange, #ff9800)" }}>
                      -{trade.frictionDragR ?? "0.00"} R
                    </strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>DRAG RECOVERED</span>
                    <strong style={{ color: "var(--green)" }}>{trade.recoveryPct ?? 64.0}%</strong>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", fontFamily: "monospace", fontSize: 11 }}>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>MARKET SPREAD</span>
                    <span>{trade.spreadPrice ?? 0} pts</span>
                  </div>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>SPREAD-TO-RISK %</span>
                    <span style={{ color: trade.spreadToRiskPct > 15 ? "var(--red)" : "var(--fg)" }}>{trade.spreadToRiskPct ?? 0}%</span>
                  </div>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>BROKER ENTRY LEVEL</span>
                    <span style={{ color: "var(--accent)" }}>{trade.brokerLevels?.entry ?? trade.entryPrice}</span>
                  </div>
                </div>
              </div>

              {/* Target Landmark Badge */}
              <div
                style={{
                  background: "rgba(171, 71, 188, 0.08)",
                  border: "1px solid rgba(171, 71, 188, 0.25)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 11,
                  fontFamily: "monospace",
                  color: "var(--purple, #ab47bc)",
                }}
              >
                <span>🎯</span>
                <div>
                  <span style={{ fontWeight: 700 }}>Target Landmark: </span>
                  <span>{trade.targetLandmark}</span>
                </div>
              </div>

              {/* 50% MILESTONE REDECISION AUDIT TELEMETRY */}
              {trade.redecisionDone && (
                <div
                  style={{
                    background:
                      trade.redecisionAction === "CLOSE_FULL_NOW"
                        ? "rgba(239, 83, 80, 0.08)"
                        : trade.redecisionAction === "REDUCE_TP"
                        ? "rgba(0, 176, 255, 0.08)"
                        : trade.redecisionAction === "EXPAND_TP"
                        ? "rgba(171, 71, 188, 0.08)"
                        : "rgba(38, 166, 154, 0.08)",
                    border: `1px solid ${
                      trade.redecisionAction === "CLOSE_FULL_NOW"
                        ? "rgba(239, 83, 80, 0.3)"
                        : trade.redecisionAction === "REDUCE_TP"
                        ? "rgba(0, 176, 255, 0.3)"
                        : trade.redecisionAction === "EXPAND_TP"
                        ? "rgba(171, 71, 188, 0.3)"
                        : "rgba(38, 166, 154, 0.3)"
                    }`,
                    borderRadius: 8,
                    padding: 12,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fg)" }}>50% MILESTONE REDECISION (AMRE)</div>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background:
                          trade.redecisionAction === "CLOSE_FULL_NOW"
                            ? "rgba(239, 83, 80, 0.2)"
                            : trade.redecisionAction === "REDUCE_TP"
                            ? "rgba(0, 176, 255, 0.2)"
                            : trade.redecisionAction === "EXPAND_TP"
                            ? "rgba(171, 71, 188, 0.2)"
                            : "rgba(38, 166, 154, 0.2)",
                        color:
                          trade.redecisionAction === "CLOSE_FULL_NOW"
                            ? "var(--red)"
                            : trade.redecisionAction === "REDUCE_TP"
                            ? "var(--accent)"
                            : trade.redecisionAction === "EXPAND_TP"
                            ? "var(--purple, #ab47bc)"
                            : "var(--green)",
                      }}
                    >
                      {trade.redecisionAction}
                    </span>
                  </div>

                  <div style={{ fontSize: 11, color: "var(--fg)", marginBottom: 8, lineHeight: 1.4 }}>
                    {trade.redecisionReason}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, fontFamily: "monospace", fontSize: 11 }}>
                    <div>
                      <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>SCORE</span>
                      <strong style={{ color: "var(--accent)" }}>{trade.redecisionScore > 0 ? `+${trade.redecisionScore}` : trade.redecisionScore}/100</strong>
                    </div>
                    <div>
                      <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>OLD TARGET</span>
                      <span>{trade.redecisionOldTp ? formatPrice5(trade.redecisionOldTp) : "-"} ({trade.redecisionOldRR ?? trade.targetRR}R)</span>
                    </div>
                    <div>
                      <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>NEW TARGET</span>
                      <strong style={{ color: "var(--green)" }}>{trade.redecisionNewTp ? formatPrice5(trade.redecisionNewTp) : (trade.redecisionAction === "CLOSE_FULL_NOW" ? "MARKET EXIT" : "-")} ({trade.redecisionNewRR ?? trade.targetRR}R)</strong>
                    </div>
                  </div>
                </div>
              )}

              {/* Time Telemetry */}
              <div
                style={{
                  background: "var(--panel-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  fontSize: 11,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Staged At:</span>
                  <span style={{ fontFamily: "monospace" }}>{trade.stagedTime ? new Date(trade.stagedTime).toLocaleString() : "-"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Filled / Entry:</span>
                  <span style={{ fontFamily: "monospace" }}>{trade.entryTime ? new Date(trade.entryTime).toLocaleString() : "-"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Closed At:</span>
                  <span style={{ fontFamily: "monospace" }}>{trade.closeTime ? new Date(trade.closeTime).toLocaleString() : "Active Position"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Trade Duration:</span>
                  <span style={{ fontFamily: "monospace", color: "var(--accent)" }}>{trade.durationMinutes != null ? `${trade.durationMinutes} mins` : "-"}</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: BIAS & CONTEXT */}
          {activeTab === "context" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "var(--fg)" }}>INSTITUTIONAL STRATEGY PROFILE</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11 }}>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>TIMEFRAME HORIZON</span>
                    <strong style={{ color: "var(--accent)" }}>{trade.horizon}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>ENTRY MODEL</span>
                    <strong style={{ color: "var(--fg)" }}>{trade.entryModel}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>SESSION / KILLZONE</span>
                    <strong>{trade.session}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>CONFLUENCE SCORE</span>
                    <strong style={{ color: "var(--green)" }}>{trade.confluenceScore}/100</strong>
                  </div>
                </div>
              </div>

              {/* Master Market Bias Snapshot */}
              <div style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "var(--fg)" }}>MASTER MARKET BIAS SNAPSHOT</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>Brain Numeric Conviction:</span>
                  <span style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", color: trade.biasScore >= 0 ? "var(--green)" : "var(--red)" }}>
                    {trade.biasScore >= 0 ? `+${trade.biasScore}` : trade.biasScore} / 100
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Macro Narrative:</div>
                <div style={{ fontSize: 11, color: "var(--fg)", background: "var(--panel)", padding: 8, borderRadius: 6, border: "1px solid var(--border)" }}>
                  {trade.biasMacro}
                </div>
              </div>

              {/* Broker Order Telemetry Strip */}
              <div style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "var(--fg)" }}>BROKER ORDER TELEMETRY</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11, fontFamily: "monospace" }}>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>MAGIC NUMBER</span>
                    <strong style={{ color: "var(--accent)" }}>#{trade.magicNumber || "N/A"}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>EXECUTION VENUE</span>
                    <strong>{trade.executionMode} ({trade.account})</strong>
                  </div>
                  <div style={{ gridColumn: "span 2" }}>
                    <span style={{ fontSize: 9, color: "var(--muted)", display: "block" }}>BROKER COMMENT</span>
                    <strong style={{ color: "var(--fg)" }}>{trade.brokerComment || "TS"}</strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SCREENSHOT & TRADER JOURNAL */}
          {activeTab === "screenshot" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Image Preview / Screenshot */}
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  overflow: "hidden",
                  minHeight: 180,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                }}
              >
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={`${trade.symbol} Chart`}
                    style={{ width: "100%", height: "auto", maxHeight: 320, objectFit: "contain" }}
                  />
                ) : (
                  <div style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>
                    <ImageIcon size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
                    <div style={{ fontSize: 11 }}>No chart screenshot attached yet.</div>
                    <div style={{ fontSize: 10, opacity: 0.7 }}>Paste image URL below or take a snapshot from chart.</div>
                  </div>
                )}
              </div>

              {/* Image URL input */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 10, color: "var(--muted)" }}>Screenshot Image URL or Data URI</label>
                <input
                  type="text"
                  placeholder="https://... or data:image/png;base64,..."
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  style={{
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "8px 10px",
                    fontSize: 11,
                    color: "var(--fg)",
                  }}
                />
              </div>

              {/* Performance Rating (Stars) */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>Setup Execution Grade:</span>
                <div style={{ display: "flex", gap: 4 }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: star <= rating ? "#f59e0b" : "var(--muted)",
                        padding: 2,
                      }}
                    >
                      <Star size={16} fill={star <= rating ? "#f59e0b" : "none"} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags Input */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 10, color: "var(--muted)" }}>Tags (press Enter to add)</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 4 }}>
                  {tags.map((t) => (
                    <span
                      key={t}
                      style={{
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 12,
                        background: "rgba(41, 98, 255, 0.15)",
                        border: "1px solid rgba(41, 98, 255, 0.3)",
                        color: "var(--accent)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      {t}
                      <X size={10} style={{ cursor: "pointer" }} onClick={() => handleRemoveTag(t)} />
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="e.g. A+ Setup, Clean FVG, Followed Rules..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleAddTag}
                  style={{
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "6px 10px",
                    fontSize: 11,
                    color: "var(--fg)",
                  }}
                />
              </div>

              {/* Reflection Notes */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 10, color: "var(--muted)" }}>Trader Journal Notes & Cognitive Review</label>
                <textarea
                  rows={4}
                  placeholder="Record your thoughts, emotions, plan adherence, execution quality, or lessons learned..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "8px 10px",
                    fontSize: 11,
                    color: "var(--fg)",
                    resize: "vertical",
                    fontFamily: "inherit",
                  }}
                />
              </div>

              {/* Save Button */}
              <button
                disabled={saving}
                onClick={handleSave}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: "8px 16px",
                  borderRadius: 6,
                  background: savedSuccess ? "var(--green)" : "var(--accent)",
                  border: "none",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: saving ? "wait" : "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                {savedSuccess ? (
                  <>
                    <CheckCircle2 size={14} /> Saved Successfully
                  </>
                ) : (
                  <>
                    <Save size={14} /> {saving ? "Saving..." : "Save Journal Review"}
                  </>
                )}
              </button>
            </div>
          )}

          {/* TAB 4: EXECUTION TIMELINE */}
          {activeTab === "events" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fg)" }}>AUTONOMOUS EXECUTION AUDIT TRAIL</div>
              {(!trade.events || trade.events.length === 0) ? (
                <div style={{ color: "var(--muted)", fontSize: 11, textAlign: "center", padding: 24 }}>
                  No execution events recorded for this trade.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {trade.events.map((ev, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: "8px 12px",
                        background: "var(--panel-2)",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        fontSize: 11,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, color: "var(--accent)" }}>{ev.type || "EVENT"}</span>
                        <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "monospace" }}>
                          {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : "-"}
                        </span>
                      </div>
                      <div style={{ color: "var(--fg)", fontSize: 10 }}>{ev.note || ev.message || "-"}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Partial Exits ladder if any */}
              {trade.partialExits && trade.partialExits.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fg)", marginBottom: 6 }}>PARTIAL BOOKINGS LEDGER</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {trade.partialExits.map((p, idx) => (
                      <div
                        key={idx}
                        style={{
                          padding: "6px 10px",
                          background: "rgba(38, 166, 154, 0.08)",
                          border: "1px solid rgba(38, 166, 154, 0.25)",
                          borderRadius: 6,
                          fontSize: 10,
                          display: "flex",
                          justifyContent: "space-between",
                          fontFamily: "monospace",
                        }}
                      >
                        <span>{p.id}: {p.volume} lots @ {p.price}</span>
                        <span style={{ color: "var(--green)", fontWeight: 700 }}>+{Number(p.r || 0).toFixed(2)}R (${Number(p.pnl || 0).toFixed(2)})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Drawer Footer with Link to Live Chart */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border)",
            background: "var(--panel-2, #1a202c)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <a
            href={`/?symbol=${trade.canonicalSymbol || trade.symbol}&tf=${trade.tf || "15M"}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              color: "var(--accent)",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            <ExternalLink size={12} /> Open in Live Chart Panel
          </a>

          <button
            onClick={onClose}
            style={{
              padding: "5px 12px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--fg)",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
