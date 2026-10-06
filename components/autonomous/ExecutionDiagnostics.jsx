"use client";

import { BrokerTelemetry, TargetLadder, TelemetryValue, formatPrice } from "./TradeTelemetry";
import DecisionReasons from "./DecisionReasons";

export default function ExecutionDiagnostics({ trades = [], diagnostics }) {
  if (!trades.length) return null;
  return (
    <section style={{ minWidth: 0, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
      <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>Pending Execution & Reconciliation · {diagnostics?.pendingCount ?? trades.length}</h2>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>Requested actions await execution-engine or broker confirmation.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 12 }}>
        {trades.map((trade) => <article key={trade._id} style={{ minWidth: 0, border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 10, overflowWrap: "anywhere" }}>
          <strong style={{ fontSize: 12, color: "var(--orange)" }}>{trade.symbol} · {trade.status}</strong>
          <TelemetryValue label="Planned entry / actual fill" value={`${formatPrice(trade.entryPrice)} / ${formatPrice(trade.filledPrice)}`} />
          <TargetLadder targets={trade.targets} legacyTarget={trade.tpPrice} partialExits={trade.partialExits} />
          <BrokerTelemetry trade={trade} />
          <DecisionReasons vetoes={trade.vetoes} reason={trade.statusReason || trade.reconciliationReason} />
        </article>)}
      </div>
    </section>
  );
}
