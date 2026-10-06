"use client";

import { Radio, WifiOff } from "lucide-react";
import RangeTelemetry from "./RangeTelemetry";
import { formatR, formatUsd, markPriceFor, tradeRiskTelemetry } from "./TradeTelemetry";

export default function CockpitTelemetry({ activeTrades = [], rankedPairs = [], ticks = {}, socketState, error, loading }) {
  const floating = activeTrades.map((trade) => tradeRiskTelemetry(trade, ticks)).filter((item) => item.floatingR !== null);
  const floatingR = floating.length ? floating.reduce((sum, item) => sum + item.floatingR, 0) : null;
  const floatingUsd = floating.length && floating.every((item) => item.floatingUsd !== null) ? floating.reduce((sum, item) => sum + item.floatingUsd, 0) : null;
  const lead = rankedPairs.find((pair) => pair.isInMainWatchlist) || rankedPairs[0];
  const statusColor = socketState === "connected" ? "var(--green)" : socketState === "error" ? "var(--red)" : "var(--orange)";
  return (
    <section style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 16, minWidth: 0 }} aria-label="Autonomous market telemetry">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700 }}><Radio size={15} style={{ color: statusColor }} /> Cockpit telemetry</div>
        <div style={{ color: statusColor, fontSize: 10, fontFamily: "monospace" }}>{socketState || "State unavailable"} · {Object.keys(ticks).length} live symbols</div>
      </div>
      {error && <div role="alert" style={{ padding: 7, marginBottom: 8, color: "var(--red)", background: "rgba(239,68,68,.08)", borderRadius: 6, fontSize: 11 }}>{error}</div>}
      {loading && <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 8 }}>Loading authoritative state…</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 10 }}>
        <div><div style={{ color: "var(--muted)", fontSize: 10 }}>Floating risk · {floating.length}/{activeTrades.length} positions available</div><div style={{ fontFamily: "monospace", color: floatingR !== null && floatingR >= 0 ? "var(--green)" : "var(--muted)" }}>{formatR(floatingR)} · {formatUsd(floatingUsd)}</div></div>
        <div><div style={{ color: "var(--muted)", fontSize: 10 }}>Execution source</div><div style={{ fontSize: 11 }}>{activeTrades.some((t) => t.isLive === true) ? "Live broker state" : activeTrades.some((t) => t.isLive === false) ? "Paper execution" : "Unavailable"}</div></div>
        <div style={{ minWidth: 0 }}>{lead ? <RangeTelemetry brain={lead.brain} range={lead.range} dealingRange={lead.dealingRange} price={markPriceFor(lead, ticks)} compact /> : <div style={{ color: "var(--muted)", fontSize: 11 }}><WifiOff size={14} /> Market range unavailable</div>}</div>
      </div>
    </section>
  );
}
