"use client";

import { useEffect, useRef, useState } from "react";
import { X, Brain, CandlestickChart, Compass, Layers, CheckCircle2, AlertTriangle, ShieldAlert } from "lucide-react";
import RangeTelemetry from "./RangeTelemetry";
import ConfluenceBreakdown from "./ConfluenceBreakdown";
import DecisionReasons from "./DecisionReasons";
import EvidenceDetails from "./EvidenceDetails";
import RadarIdeaChart from "./RadarIdeaChart";
import { TelemetryValue, formatPrice, finiteNumber, markPriceFor } from "./TradeTelemetry";

export default function BrainInspectorModal({ pair, onClose, ticks = {} }) {
  const dialogRef = useRef(null);
  const [activeTab, setActiveTab] = useState("chart"); // "chart" | "structure" | "confluence" | "all"

  useEffect(() => {
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [onClose]);

  if (!pair) return null;

  const brain = pair.brain || {};
  const staged = pair.stagedLevel;
  const candidates = staged?.allCandidates || pair.entryModel?.allCandidates || [];
  const panel = {
    background: "var(--panel-2)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 12,
    minWidth: 0,
  };

  const macroBiasRaw =
    brain.macroBias ||
    brain.macroCompass ||
    brain.htfLiquidity?.macroBias;
  const macroBias =
    (typeof macroBiasRaw === "string" && macroBiasRaw) ||
    (pair.dir === 1 ? "BULLISH" : pair.dir === -1 ? "BEARISH" : "NEUTRAL");

  const dirText =
    (typeof pair.dirLabel === "string" && pair.dirLabel) ||
    (brain.macroDir === 1 ? "BUY / LONG" : brain.macroDir === -1 ? "SELL / SHORT" : "NEUTRAL");

  const thesisRaw =
    brain.thesisId ||
    pair.thesisId ||
    brain.htfLiquidity?.drawOnLiquidity?.catalyst;
  const thesisText =
    (typeof thesisRaw === "string" && thesisRaw) ||
    (typeof thesisRaw === "object" ? thesisRaw?.name || thesisRaw?.catalyst || thesisRaw?.label : null) ||
    "HTF Structural Expansion";

  const horizonKey =
    pair.scenario?.id === "swing" || pair.horizon === "swing"
      ? "SWING"
      : pair.scenario?.id === "scalp" || pair.horizon === "scalp"
      ? "SCALP"
      : "DAY";

  const horizonGate = brain.horizons?.[horizonKey]?.gatekeeper;
  const gatekeeperVeto =
    typeof brain.gatekeeperVeto === "boolean"
      ? brain.gatekeeperVeto
      : Boolean(horizonGate?.vetoActive || brain.dayTraderContext?.ltfGatekeeper?.vetoActive);

  const gatekeeperStatus =
    brain.gatekeeperStatus ||
    horizonGate?.triggerStatus ||
    brain.dayTraderContext?.ltfGatekeeper?.triggerStatus ||
    (gatekeeperVeto ? "VETO ACTIVE" : "APPROVED");

  const modelName =
    pair.entryModel?.name ||
    staged?.modelName ||
    (pair.status === "WATCHING_RETRACE"
      ? "Scanning Retracement Entry (FVG / OTE)"
      : "Scanning Market Structure");

  const modelRationale =
    pair.entryModel?.rationale ||
    staged?.rationale ||
    pair.statusReason ||
    "Monitoring order flow and dealing range discount/premium.";

  const macroLabel = pair.scenario?.macroTf
    ? `${pair.scenario.macroTf} Macro Compass`
    : "1D / 4H Macro Bias";
  const gatekeeperLabel = `${pair.scenario?.gatekeeperTf || "15M"} Gatekeeper`;

  const markPrice = markPriceFor(pair, ticks);
  const entryVal = finiteNumber(staged?.entry ?? candidates?.[0]?.entry ?? markPrice);
  const slVal = finiteNumber(staged?.sl ?? candidates?.[0]?.sl);
  const tpVal = finiteNumber(staged?.tp ?? candidates?.[0]?.tp ?? staged?.targets?.[0]?.price);
  const rawRR = staged?.rr ?? staged?.targetRR ?? candidates?.[0]?.rr;
  const displayRR = finiteNumber(rawRR);

  const conviction = finiteNumber(brain.conviction);
  const opportunityScore = finiteNumber(pair.opportunityScore ?? pair.rawScore);

  const isPrime = pair.status === "PRIME_QUALIFIED";
  const isWatching = String(pair.status || "").startsWith("WATCHING");
  const isBlocked = String(pair.status || "").startsWith("BLOCKED");

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,.75)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "min(4vw, 16px)",
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="brain-inspector-title"
        tabIndex={-1}
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 880,
          maxHeight: "92dvh",
          overflowY: "auto",
          padding: "clamp(12px, 2.5vw, 22px)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minWidth: 0,
          boxSizing: "border-box",
          overflowWrap: "anywhere",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Pinned Sticky Header & Tab Navigation Container */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 30,
            background: "var(--panel)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            flexShrink: 0,
            paddingTop: 2,
            paddingBottom: 8,
            borderBottom: "1px solid var(--border)",
          }}
        >
          {/* Header Bar */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 10,
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "rgba(168, 85, 247, 0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#c084fc",
                  flexShrink: 0,
                }}
              >
                <Brain size={18} />
              </div>

              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <h2
                    id="brain-inspector-title"
                    style={{ fontSize: 17, fontWeight: 800, margin: 0, color: "var(--fg)" }}
                  >
                    {pair.tradeableSymbol || pair.symbol}
                  </h2>

                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background:
                        pair.dir === 1
                          ? "rgba(34, 197, 94, 0.18)"
                          : pair.dir === -1
                          ? "rgba(239, 68, 68, 0.18)"
                          : "var(--panel-2)",
                      color:
                        pair.dir === 1
                          ? "var(--green)"
                          : pair.dir === -1
                          ? "var(--red)"
                          : "var(--muted)",
                    }}
                  >
                    {pair.dir === 1 ? "BUY / LONG ▲" : pair.dir === -1 ? "SELL / SHORT ▼" : "NEUTRAL ⬌"}
                  </span>

                  <span
                    style={{
                      fontSize: 9.5,
                      fontFamily: "monospace",
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "rgba(168, 85, 247, 0.15)",
                      color: "#c084fc",
                      border: "1px solid rgba(168, 85, 247, 0.3)",
                    }}
                  >
                    {pair.horizonBadge || pair.scenario?.badge || "4H-15M"} ({horizonKey})
                  </span>

                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: isPrime
                        ? "rgba(34, 197, 94, 0.18)"
                        : isWatching
                        ? "rgba(249, 115, 22, 0.15)"
                        : isBlocked
                        ? "rgba(239, 68, 68, 0.15)"
                        : "var(--panel-2)",
                      color: isPrime
                        ? "var(--green)"
                        : isWatching
                        ? "var(--orange)"
                        : isBlocked
                        ? "var(--red)"
                        : "var(--muted)",
                    }}
                  >
                    {String(pair.status || "RADAR").replace(/_/g, " ")}
                  </span>
                </div>
              </div>
            </div>

            {/* Top Right Controls & Dedicated Close Button */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {opportunityScore !== null && (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "monospace",
                    fontWeight: 800,
                    padding: "3px 8px",
                    borderRadius: 6,
                    background: "rgba(56, 189, 248, 0.12)",
                    color: "var(--accent)",
                    border: "1px solid rgba(56, 189, 248, 0.25)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Opp: {opportunityScore}/100
                </span>
              )}

              {/* Dedicated Top-Right Close Button */}
              <button
                onClick={onClose}
                aria-label="Close radar inspector"
                title="Close (Esc)"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  border: "1px solid var(--border)",
                  background: "rgba(255, 255, 255, 0.08)",
                  color: "var(--fg)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  padding: 0,
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(239, 68, 68, 0.2)";
                  e.currentTarget.style.color = "var(--red)";
                  e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.4)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
                  e.currentTarget.style.color = "var(--fg)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Tab Navigation Controls (Pinned under header row, never collapses or hides) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              overflowX: "auto",
              scrollbarWidth: "none",
              flexShrink: 0,
              minHeight: 34,
              paddingTop: 2,
            }}
          >
            <button
              onClick={() => setActiveTab("chart")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "6px 12px",
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 6,
                border: "1px solid",
                borderColor: activeTab === "chart" ? "#a855f7" : "transparent",
                background: activeTab === "chart" ? "rgba(168, 85, 247, 0.15)" : "transparent",
                color: activeTab === "chart" ? "#c084fc" : "var(--muted)",
                cursor: "pointer",
                flexShrink: 0,
                whiteSpace: "nowrap",
                transition: "all 0.15s ease",
              }}
            >
              <CandlestickChart size={13} />
              <span>Trade Idea Chart</span>
            </button>

            <button
              onClick={() => setActiveTab("structure")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "6px 12px",
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 6,
                border: "1px solid",
                borderColor: activeTab === "structure" ? "var(--accent)" : "transparent",
                background: activeTab === "structure" ? "rgba(56, 189, 248, 0.15)" : "transparent",
                color: activeTab === "structure" ? "var(--accent)" : "var(--muted)",
                cursor: "pointer",
                flexShrink: 0,
                whiteSpace: "nowrap",
                transition: "all 0.15s ease",
              }}
            >
              <Compass size={13} />
              <span>Macro & Range Structure</span>
            </button>

            <button
              onClick={() => setActiveTab("confluence")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "6px 12px",
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 6,
                border: "1px solid",
                borderColor: activeTab === "confluence" ? "var(--green)" : "transparent",
                background: activeTab === "confluence" ? "rgba(34, 197, 94, 0.15)" : "transparent",
                color: activeTab === "confluence" ? "var(--green)" : "var(--muted)",
                cursor: "pointer",
                flexShrink: 0,
                whiteSpace: "nowrap",
                transition: "all 0.15s ease",
              }}
            >
              <Layers size={13} />
              <span>Confluences & Candidates</span>
            </button>

            <button
              onClick={() => setActiveTab("all")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "6px 10px",
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 6,
                border: "1px solid",
                borderColor: activeTab === "all" ? "var(--border)" : "transparent",
                background: activeTab === "all" ? "var(--panel-2)" : "transparent",
                color: activeTab === "all" ? "var(--fg)" : "var(--muted)",
                marginLeft: "auto",
                cursor: "pointer",
                flexShrink: 0,
                whiteSpace: "nowrap",
                transition: "all 0.15s ease",
              }}
            >
              <span>Overview View</span>
            </button>
          </div>
        </div>

        {/* Executive Verdict & Conviction Banner */}
        <div
          style={{
            background: "rgba(168, 85, 247, 0.06)",
            border: "1px solid rgba(168, 85, 247, 0.25)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
            <strong style={{ color: "#c084fc", fontSize: 13 }}>
              {typeof brain.verdict === "string" ? brain.verdict.replaceAll("_", " ") : "Market Evaluation Active"}
            </strong>
            <span
              style={{
                fontSize: 11,
                fontFamily: "monospace",
                fontWeight: 800,
                color: (conviction ?? 0) >= 75 ? "var(--green)" : "var(--accent)",
              }}
            >
              {conviction !== null ? `${conviction}% Conviction` : "—"}
            </span>
          </div>
          <div style={{ color: "var(--fg)", opacity: 0.9 }}>
            {typeof brain.narrative === "string" ? brain.narrative : "Evaluating HTF order flow, liquidity draws, and execution readiness."}
          </div>
        </div>

        {/* Quick Execution Geometry Strip */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 110px), 1fr))",
            gap: 8,
            background: "var(--panel-2)",
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            fontFamily: "monospace",
          }}
        >
          <TelemetryValue label="Mark Price" value={formatPrice(markPrice)} />
          <TelemetryValue label="Planned Entry" value={formatPrice(entryVal)} color="var(--accent)" />
          <TelemetryValue label="Structural SL" value={formatPrice(slVal)} color="#ea580c" />
          <TelemetryValue label="Target TP" value={formatPrice(tpVal)} color="#a855f7" />
          <TelemetryValue
            label="Potential R:R"
            value={displayRR !== null ? `${displayRR.toFixed(2)}R` : "—"}
            color="var(--green)"
          />
        </div>

        {/* Tab 1: Trade Idea Chart */}
        {(activeTab === "chart" || activeTab === "all") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <RadarIdeaChart pair={pair} ticks={ticks} height={310} />

            {/* Model Setup Rationale & Status Callout */}
            <div
              style={{
                ...panel,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontSize: 11,
                lineHeight: 1.5,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                <span style={{ fontWeight: 800, color: "var(--fg)", fontSize: 12 }}>
                  {modelName} · {pair.activeTimeSlot?.name || "Active Session"}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: gatekeeperVeto ? "var(--red)" : "var(--green)",
                  }}
                >
                  {gatekeeperVeto ? "⚠ 15M Retracement Gate Active" : "✓ Gatekeeper Cleared"}
                </span>
              </div>
              <div style={{ color: "var(--muted)" }}>{modelRationale}</div>
            </div>
          </div>
        )}

        {/* Tab 2: Macro & Range Architecture */}
        {(activeTab === "structure" || activeTab === "all") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 10 }}>
              <div style={panel}>
                <TelemetryValue
                  label={macroLabel}
                  value={macroBias}
                  color={pair.dir === 1 ? "var(--green)" : pair.dir === -1 ? "var(--red)" : "var(--accent)"}
                />
                <div style={{ fontSize: 11, marginTop: 6, fontWeight: 600 }}>Direction: {dirText}</div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>Thesis: {thesisText}</div>
              </div>

              <div style={panel}>
                <TelemetryValue
                  label={gatekeeperLabel}
                  value={gatekeeperVeto ? "VETO ACTIVE" : "GATEKEEPER APPROVED"}
                  color={gatekeeperVeto ? "var(--red)" : "var(--green)"}
                />
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>{gatekeeperStatus}</div>
              </div>
            </div>

            <div style={panel}>
              <RangeTelemetry
                brain={brain}
                range={pair.range || brain.dealingRange || brain.ranges?.H4}
                dealingRange={pair.dealingRange || brain.dealingRange || brain.ranges?.H4}
                price={markPrice}
              />
            </div>
          </div>
        )}

        {/* Tab 3: Confluences, Candidates & Decisions */}
        {(activeTab === "confluence" || activeTab === "all") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <DecisionReasons
              vetoes={pair.vetoes || staged?.vetoes}
              reason={pair.statusReason}
              title="Staging / Rejection Decision Log"
            />

            <div style={panel}>
              <div style={{ fontWeight: 700, color: "var(--accent)", fontSize: 12, marginBottom: 8 }}>
                Institutional Confluence Engine (Score: {staged?.confluenceScore ?? pair.opportunityScore ?? 0}/100)
              </div>
              <ConfluenceBreakdown
                breakdown={pair.confluenceBreakdown || staged?.confluenceBreakdown || pair.entryModel?.confluenceBreakdown}
                score={staged?.confluenceScore ?? pair.entryModel?.confluenceScore ?? pair.opportunityScore}
              />
              <EvidenceDetails evidence={staged?.evidence || pair.evidence} />
            </div>

            {/* Evaluated candidate levels */}
            <section>
              <h3 style={{ fontSize: 12, margin: "0 0 8px", color: "var(--muted)" }}>
                Evaluated Institutional Candidate Levels
              </h3>
              {candidates.length === 0 ? (
                <div
                  style={{
                    color: "var(--muted)",
                    fontSize: 11,
                    fontStyle: "italic",
                    padding: "12px",
                    background: "var(--panel-2)",
                    borderRadius: 8,
                    textAlign: "center",
                  }}
                >
                  {pair.status === "WATCHING_RETRACE"
                    ? `Holding ${dirText} bias. No causal limit formed at current price — waiting for liquidity pool sweep or FVG retest.`
                    : "No candidate levels currently meet causal qualification criteria."}
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 250px), 1fr))",
                    gap: 10,
                  }}
                >
                  {candidates.map((level, index) => {
                    const candidateEntry = level.entry ?? level.price;
                    const candidateSl = level.sl;
                    const candidateTp = level.tp ?? level.targetPrice;
                    const cRawRR = level.rr ?? level.targetRR;
                    const cRR = finiteNumber(cRawRR);
                    const qualStatus =
                      level.status ||
                      (level.meetsMinRR === false
                        ? "RR rejected"
                        : level.meetsMinRR
                        ? "Qualified"
                        : "Pending qualification");

                    return (
                      <article
                        key={level.id || `${level.modelId}-${index}`}
                        style={{ ...panel, display: "flex", flexDirection: "column", gap: 8 }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700 }}>
                          {level.modelName || level.name || level.label || level.type || "Candidate Level"}
                          {pair.activeTimeSlot?.name ? (
                            <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                              {" "}
                              · {pair.activeTimeSlot.name}
                            </span>
                          ) : null}
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 75px), 1fr))",
                            gap: 6,
                          }}
                        >
                          <TelemetryValue label="Entry" value={formatPrice(candidateEntry)} />
                          <TelemetryValue label="SL" value={formatPrice(candidateSl)} color="#ea580c" />
                          <TelemetryValue label="TP / DOL" value={formatPrice(candidateTp)} color="#a855f7" />
                        </div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>
                          R:R {cRR !== null ? `${cRR.toFixed(2)}R` : "—"} · {qualStatus}
                        </div>
                        {level.slAudit && (
                          <div
                            style={{
                              fontSize: 10,
                              color: "var(--muted)",
                              display: "flex",
                              gap: 5,
                              alignItems: "center",
                              flexWrap: "wrap",
                            }}
                          >
                            <span
                              style={{
                                padding: "1px 5px",
                                borderRadius: 3,
                                background: "rgba(234, 88, 12, 0.15)",
                                color: "#ea580c",
                                fontWeight: 700,
                                fontSize: 9,
                              }}
                            >
                              {level.slAudit.anchorType?.replace(/_/g, " ") || "STRUCTURAL SL"}
                            </span>
                            {level.slAudit.isNoiseFree && (
                              <span style={{ fontSize: 9, color: "var(--green)", fontWeight: 600 }}>
                                ✓ Noise-safe (
                                {level.slAudit.riskDistance != null
                                  ? `${Number(level.slAudit.riskDistance).toFixed(1)} ${
                                      level.slAudit.units?.unitLabel || "pts"
                                    }`
                                  : "verified"}
                                )
                              </span>
                            )}
                          </div>
                        )}
                        <DecisionReasons
                          vetoes={level.vetoes}
                          reason={level.rejectionReason || level.rationale}
                          title="Candidate decision"
                        />
                        <ConfluenceBreakdown breakdown={level.confluenceBreakdown} score={level.confluenceScore} />
                        <EvidenceDetails evidence={level.evidence} />
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
