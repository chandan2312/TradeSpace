"use client";

import { TelemetryValue, formatPrice, finiteNumber } from "./TradeTelemetry";

export default function RangeTelemetry({ brain = {}, range = {}, dealingRange, price, compact = false }) {
  brain = brain || {};
  range = range || {};
  const htf = dealingRange || brain.dealingRange || range.dealingRange || range.h4Range || range;
  const low = finiteNumber(htf?.low);
  const high = finiteNumber(htf?.high);
  const eq = finiteNumber(htf?.eq);
  const mark = finiteNumber(price);
  const zone = mark !== null && eq !== null ? (mark > eq ? "PREMIUM" : mark < eq ? "DISCOUNT" : "EQUILIBRIUM") : "Unavailable";
  const dol = brain.targetDOL;
  const dolPrice = finiteNumber(dol?.price);
  const distance = dolPrice !== null && mark !== null ? Math.abs(dolPrice - mark) : null;
  const distancePct = distance !== null && mark > 0 ? distance / mark * 100 : null;
  const coverage = finiteNumber(htf?.coveragePct ?? range.h4CoveragePct);
  const runway = finiteNumber(range.remainingRunwayPct);
  const position = high !== null && low !== null && high > low && mark !== null ? (mark - low) / (high - low) * 100 : null;
  return (
    <div style={{ minWidth: 0, fontSize: 11, overflowWrap: "anywhere" }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>HTF dealing range {htf?.tf || htf?.timeframe || ""}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 85px), 1fr))", gap: 6 }}>
        <TelemetryValue label="Low" value={formatPrice(low)} />
        <TelemetryValue label="EQ" value={formatPrice(eq)} />
        <TelemetryValue label="High" value={formatPrice(high)} />
        <TelemetryValue label="Mark / zone" value={`${formatPrice(mark)} · ${zone}`} color="var(--accent)" />
      </div>
      {position !== null && <div aria-label={`Price at ${Math.round(position)}% of HTF range`} style={{ position: "relative", height: 5, background: "var(--border)", borderRadius: 3, margin: "8px 0" }}>
        <span style={{ position: "absolute", left: "50%", height: 5, width: 1, background: "var(--muted)" }} />
        <span style={{ position: "absolute", left: `calc(${Math.min(100, Math.max(0, position))}% - 2px)`, height: 5, width: 4, background: "var(--accent)" }} />
      </div>}
      {!compact && <div style={{ color: "var(--muted)", marginTop: 6 }}>
        Coverage: {coverage === null ? "Unavailable" : `${coverage.toFixed(1)}%`} · Runway: {runway === null ? "Unavailable" : `${runway.toFixed(1)}%`}
      </div>}
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 6, lineHeight: 1.5 }}>
        <strong style={{ color: "var(--accent)" }}>DOL · {dol?.name || dol?.type || "Unavailable"}</strong>
        <div>{formatPrice(dolPrice)} · Distance: {formatPrice(distance)}{distancePct !== null ? ` (${distancePct.toFixed(2)}%)` : ""}</div>
        <div style={{ color: "var(--muted)" }}>State: {dol?.state || dol?.status || "Unavailable"}</div>
      </div>
    </div>
  );
}
