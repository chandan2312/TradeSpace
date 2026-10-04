"use client";

import { X, Brain, Compass, Layers, Shield, CheckCircle, AlertTriangle } from "lucide-react";

export default function BrainInspectorModal({ pair, onClose }) {
  if (!pair) return null;

  const brain = pair.brain || {};
  const range = pair.range || {};
  const scenario = pair.scenario || {};
  const staged = pair.stagedLevel;
  const candidates = staged?.allCandidates || [];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 720,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          boxShadow: "0 16px 40px rgba(0, 0, 0, 0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border)",
            paddingBottom: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Brain size={20} style={{ color: "var(--accent)" }} />
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>
                {pair.symbol} Institutional Brain Deep Dive
              </h2>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {scenario.label} · Status: {pair.status}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Narrative Box */}
        <div
          style={{
            background: "rgba(56, 189, 248, 0.05)",
            border: "1px solid rgba(56, 189, 248, 0.2)",
            borderRadius: 8,
            padding: 12,
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--fg)",
          }}
        >
          <div style={{ fontWeight: 700, color: "var(--accent)", marginBottom: 4 }}>
            MARKET BRAIN VERDICT: {brain.verdict?.replace(/_/g, " ")} ({brain.conviction}% Conviction)
          </div>
          <div>{brain.narrative || "No narrative generated."}</div>
        </div>

        {/* Day Trader Multi-Timeframe Matrix */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase" }}>
            Multi-Timeframe Division of Labor
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 10,
            }}
          >
            {/* 1D/4H Compass */}
            <div
              style={{
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 10,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", display: "flex", alignItems: "center", gap: 6 }}>
                <Compass size={13} /> 1D / 4H THE COMPASS
              </div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {brain.macroCompass || "NEUTRAL"}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                Target DOL: {brain.targetDOL?.name || "None resolved"}
              </div>
            </div>

            {/* 1H Session Roadmap */}
            <div
              style={{
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 10,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--purple)", display: "flex", alignItems: "center", gap: 6 }}>
                <Layers size={13} /> 1H SESSION ROADMAP
              </div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {range.h4Zone?.replace(/_/g, " ") || "EQUILIBRIUM"}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                Runway Remaining: {range.remainingRunwayPct}%
              </div>
            </div>

            {/* 15M Gatekeeper */}
            <div
              style={{
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 10,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--green)", display: "flex", alignItems: "center", gap: 6 }}>
                <Shield size={13} /> 15M GATEKEEPER (VETO)
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: brain.gatekeeperVeto ? "var(--red)" : "var(--green)" }}>
                {brain.gatekeeperVeto ? "VETO ACTIVE" : "APPROVED"}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                Trigger: {brain.gatekeeperStatus || "NORMAL"}
              </div>
            </div>
          </div>
        </div>

        {/* Chosen Entry Model & Time Slot Breakdown */}
        {pair.entryModel && (
          <div
            style={{
              background: "rgba(16, 185, 129, 0.05)",
              border: "1px solid rgba(16, 185, 129, 0.2)",
              borderRadius: 8,
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "var(--green)" }}>
                  SELECTED ENTRY MODEL: {pair.entryModel.name}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: "rgba(16, 185, 129, 0.15)",
                    color: "var(--green)",
                  }}
                >
                  {pair.entryModel.badge}
                </span>
              </div>
              {pair.activeTimeSlot && (
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    fontFamily: "monospace",
                    background: "rgba(255, 255, 255, 0.04)",
                    padding: "2px 8px",
                    borderRadius: 6,
                  }}
                >
                  {pair.activeTimeSlot.name} ({pair.activeTimeSlot.eetRange || pair.activeTimeSlot.brokerRange || ""})
                </span>
              )}
            </div>

            <div style={{ fontSize: 11, color: "var(--fg)", fontStyle: "italic" }}>
              "{pair.entryModel.rationale}"
            </div>

            <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>
              <span>Confluence: <strong style={{ color: "var(--accent)" }}>{pair.entryModel.confluenceScore}/100</strong></span>
              <span>Tags: {pair.entryModel.confluenceTags?.join(" · ")}</span>
            </div>
          </div>
        )}

        {/* Dynamic Candidate Levels Table */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase" }}>
            Candidate Institutional Reaction Levels & Evaluated Models
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted)", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Model / Level</th>
                  <th style={{ padding: "6px 8px" }}>Entry</th>
                  <th style={{ padding: "6px 8px" }}>SL</th>
                  <th style={{ padding: "6px 8px" }}>TP</th>
                  <th style={{ padding: "6px 8px" }}>R:R</th>
                  <th style={{ padding: "6px 8px" }}>Confluence</th>
                  <th style={{ padding: "6px 8px" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {candidates.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 12, textAlign: "center", color: "var(--muted)" }}>
                      No candidate models evaluated yet.
                    </td>
                  </tr>
                ) : (
                  candidates.map((lvl, idx) => (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                        background: idx === 0 ? "rgba(56, 189, 248, 0.05)" : "transparent",
                      }}
                    >
                      <td style={{ padding: "6px 8px", fontWeight: idx === 0 ? 700 : 500 }}>
                        {lvl.name || lvl.label || lvl.type}
                        {idx === 0 && <span style={{ marginLeft: 6, color: "var(--accent)", fontSize: 9 }}>[PRIMARY]</span>}
                      </td>
                      <td style={{ padding: "6px 8px", fontFamily: "monospace" }}>{(lvl.entry || lvl.price)?.toFixed(5)}</td>
                      <td style={{ padding: "6px 8px", fontFamily: "monospace", color: "var(--red)" }}>{lvl.sl?.toFixed(5) || "—"}</td>
                      <td style={{ padding: "6px 8px", fontFamily: "monospace", color: "var(--green)" }}>{lvl.tp?.toFixed(5) || "—"}</td>
                      <td style={{ padding: "6px 8px", fontFamily: "monospace", fontWeight: 700 }}>{lvl.rr ? `${lvl.rr}R` : "—"}</td>
                      <td style={{ padding: "6px 8px", fontFamily: "monospace", color: "var(--accent)" }}>
                        {lvl.confluenceScore}/100
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: "1px 5px",
                            borderRadius: 4,
                            background: lvl.meetsMinRR !== false ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                            color: lvl.meetsMinRR !== false ? "var(--green)" : "var(--red)",
                          }}
                        >
                          {lvl.meetsMinRR !== false ? "QUALIFIED" : "RR_REJECTED"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid var(--border)",
              color: "var(--fg)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
}
