"use client";

import { useEffect, useRef } from "react";
import { X, Brain } from "lucide-react";
import RangeTelemetry from "./RangeTelemetry";
import ConfluenceBreakdown from "./ConfluenceBreakdown";
import DecisionReasons from "./DecisionReasons";
import EvidenceDetails from "./EvidenceDetails";
import { TelemetryValue, formatPrice, finiteNumber, markPriceFor } from "./TradeTelemetry";

export default function BrainInspectorModal({ pair, onClose, ticks = {} }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previousFocus?.focus(); };
  }, [onClose]);
  if (!pair) return null;
  const brain = pair.brain || {};
  const staged = pair.stagedLevel;
  const candidates = staged?.allCandidates || pair.entryModel?.allCandidates || [];
  const panel = { background: "rgba(255,255,255,.03)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, minWidth: 0 };
  const macroBias = brain.macroBias || brain.macroCompass || brain.htfLiquidity?.macroBias || (pair.dir === 1 ? "BULLISH" : pair.dir === -1 ? "BEARISH" : "NEUTRAL");
  const dirText = pair.dirLabel || (brain.macroDir === 1 ? "BUY / LONG" : brain.macroDir === -1 ? "SELL / SHORT" : "NEUTRAL");
  const thesisText = brain.thesisId || pair.thesisId || brain.htfLiquidity?.drawOnLiquidity?.catalyst || "HTF Structural Expansion";
  const horizonKey = (pair.scenario?.id === "swing" || pair.horizon === "swing")
    ? "SWING"
    : (pair.scenario?.id === "scalp" || pair.horizon === "scalp")
    ? "SCALP"
    : "DAY";
  const horizonGate = brain.horizons?.[horizonKey]?.gatekeeper;
  const gatekeeperVeto = typeof brain.gatekeeperVeto === "boolean"
    ? brain.gatekeeperVeto
    : Boolean(horizonGate?.vetoActive || brain.dayTraderContext?.ltfGatekeeper?.vetoActive);
  const gatekeeperStatus = brain.gatekeeperStatus || horizonGate?.triggerStatus || brain.dayTraderContext?.ltfGatekeeper?.triggerStatus || (gatekeeperVeto ? "VETO ACTIVE" : "APPROVED");
  const modelName = pair.entryModel?.name || staged?.modelName || (pair.status === "WATCHING_RETRACE" ? "Scanning Retracement Entry (FVG / OTE)" : "Scanning Market Structure");
  const modelRationale = pair.entryModel?.rationale || staged?.rationale || pair.statusReason || "Monitoring order flow and dealing range discount/premium.";

  const macroLabel = pair.scenario?.macroTf ? `${pair.scenario.macroTf} Macro Compass` : "1D / 4H Macro Bias";
  const gatekeeperLabel = `${pair.scenario?.gatekeeperTf || "15M"} Gatekeeper`;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: "min(4vw, 16px)" }} onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="brain-inspector-title" tabIndex={-1} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, width: "100%", maxWidth: 760, maxHeight: "90dvh", overflowY: "auto", padding: "clamp(10px, 3vw, 20px)", display: "flex", flexDirection: "column", gap: 16, minWidth: 0, boxSizing: "border-box", overflowWrap: "anywhere" }} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h2 id="brain-inspector-title" style={{ fontSize: 16, margin: 0 }}><Brain size={17} style={{ color: "var(--accent)" }} /> {pair.symbol} · Institutional Brain</h2>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{pair.scenario?.label || "Horizon unavailable"} · {pair.status || "State unavailable"}</div>
          </div>
          <button onClick={onClose} aria-label="Close brain inspector" style={{ border: "none", background: "transparent", color: "var(--muted)", padding: 5, cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div style={{ ...panel, background: "rgba(56,189,248,.05)", fontSize: 12, lineHeight: 1.5 }}>
          <strong style={{ color: "var(--accent)" }}>{brain.verdict?.replaceAll("_", " ") || "Verdict unavailable"} · {finiteNumber(brain.conviction) === null ? "Conviction unavailable" : `${brain.conviction}% conviction`}</strong>
          <div>{brain.narrative || "Narrative unavailable"}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 10 }}>
          <div style={panel}>
            <TelemetryValue label={macroLabel} value={macroBias} color={pair.dir === 1 ? "var(--green)" : pair.dir === -1 ? "var(--red)" : "var(--accent)"} />
            <div style={{ fontSize: 11, marginTop: 6 }}>Direction: {dirText}</div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>Thesis: {thesisText}</div>
          </div>
          <div style={panel}>
            <TelemetryValue label={gatekeeperLabel} value={gatekeeperVeto ? "VETO ACTIVE" : "GATEKEEPER APPROVED"} color={gatekeeperVeto ? "var(--red)" : "var(--green)"} />
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>{gatekeeperStatus}</div>
          </div>
        </div>
        <div style={panel}><RangeTelemetry brain={brain} range={pair.range || brain.dealingRange || brain.ranges?.H4} dealingRange={pair.dealingRange || brain.dealingRange || brain.ranges?.H4} price={markPriceFor(pair, ticks)} /></div>
        <DecisionReasons vetoes={pair.vetoes || staged?.vetoes} reason={pair.statusReason} title="Staging / rejection decision" />
        <div style={panel}>
          <div style={{ fontWeight: 700, color: "var(--accent)", fontSize: 12 }}>{modelName} · {pair.activeTimeSlot?.name || "Active Session"}</div>
          <div style={{ fontSize: 11, lineHeight: 1.5, margin: "5px 0 8px" }}>{modelRationale}</div>
          <ConfluenceBreakdown
            breakdown={pair.confluenceBreakdown || staged?.confluenceBreakdown || pair.entryModel?.confluenceBreakdown}
            score={staged?.confluenceScore ?? pair.entryModel?.confluenceScore ?? pair.opportunityScore}
          />
          <EvidenceDetails evidence={staged?.evidence || pair.evidence} />
        </div>
        <section>
          <h3 style={{ fontSize: 12, margin: "0 0 8px", color: "var(--muted)" }}>Evaluated institutional candidate levels</h3>
          {candidates.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 11, fontStyle: "italic", padding: "8px 0" }}>
              {pair.status === "WATCHING_RETRACE"
                ? `Holding ${dirText} bias. No causal limit formed at current price — waiting for liquidity pool sweep or FVG retest.`
                : "No candidate levels currently meet causal qualification criteria."}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 10 }}>
              {candidates.map((level, index) => {
                const entryVal = level.entry ?? level.price;
                const slVal = level.sl;
                const tpVal = level.tp ?? level.targetPrice;
                const rawRR = level.rr ?? level.targetRR;
                const rrVal = finiteNumber(rawRR) !== null ? Number(rawRR) : null;
                const scoreVal = level.confluenceScore;
                const qualStatus = level.status
                  || (level.meetsMinRR === false ? "RR rejected" : level.meetsMinRR ? "Qualified" : "Pending qualification");
                return (
                  <article key={level.id || `${level.modelId}-${index}`} style={{ ...panel, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{level.modelName || level.name || level.label || level.type || "Level unavailable"}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 85px), 1fr))", gap: 7 }}>
                      <TelemetryValue label="Entry" value={formatPrice(entryVal)} />
                      <TelemetryValue label="SL" value={formatPrice(slVal)} color="var(--red)" />
                      <TelemetryValue label="TP / DOL" value={formatPrice(tpVal)} color="var(--green)" />
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      R:R {finiteNumber(rrVal) !== null ? `${Number(rrVal).toFixed(2)}R` : "—"} · {qualStatus}
                    </div>
                    {level.slAudit && (
                      <div style={{ fontSize: 10, color: "var(--muted)", display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ padding: "1px 5px", borderRadius: 3, background: "rgba(239, 68, 68, 0.12)", color: "var(--red)", fontWeight: 700, fontSize: 9 }}>
                          {level.slAudit.anchorType?.replace(/_/g, " ") || "STRUCTURAL SL"}
                        </span>
                        {level.slAudit.isNoiseFree && (
                          <span style={{ fontSize: 9, color: "var(--green)", fontWeight: 600 }}>
                            ✓ Noise-safe ({level.slAudit.riskDistance != null ? `${Number(level.slAudit.riskDistance).toFixed(1)} ${level.slAudit.units?.unitLabel || "pts"}` : "verified"})
                          </span>
                        )}
                      </div>
                    )}
                    <DecisionReasons vetoes={level.vetoes} reason={level.rejectionReason || level.rationale} title="Candidate decision" />
                    <ConfluenceBreakdown breakdown={level.confluenceBreakdown} score={scoreVal} />
                    <EvidenceDetails evidence={level.evidence} />
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
