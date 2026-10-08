"use client";

import { useState } from "react";
import { AlertTriangle, RefreshCw, Trash2, ShieldAlert, CheckCircle2, Clock } from "lucide-react";
import { BrokerTelemetry, formatPrice } from "./TradeTelemetry";
import DecisionReasons from "./DecisionReasons";

export default function ExecutionDiagnostics({ trades = [], diagnostics, onRefresh }) {
  const [resolvingId, setResolvingId] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState(null);

  if (!trades.length) return null;

  const handleForceResolve = async (tradeId) => {
    if (resolvingId) return;
    setResolvingId(tradeId);
    setFeedback(null);
    try {
      const res = await fetch("/api/autonomous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss", tradeId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Failed to resolve trade");
      }
      setFeedback({ type: "success", text: "Trade reconciled and cleared" });
      onRefresh?.();
    } catch (err) {
      setFeedback({ type: "error", text: err.message });
    } finally {
      setResolvingId(null);
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  const handleSyncBroker = async () => {
    if (syncing) return;
    setSyncing(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/autonomous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_broker" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Broker sync failed");
      }
      setFeedback({ type: "success", text: "Broker order book synchronized" });
      onRefresh?.();
    } catch (err) {
      setFeedback({ type: "error", text: err.message });
    } finally {
      setSyncing(false);
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  return (
    <section
      style={{
        minWidth: 0,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ShieldAlert size={16} style={{ color: "var(--orange)" }} />
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
            Pending Execution & Reconciliation ({diagnostics?.pendingCount ?? trades.length})
          </h2>
        </div>

        <button
          onClick={handleSyncBroker}
          disabled={syncing}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            background: "rgba(56, 189, 248, 0.12)",
            border: "1px solid rgba(56, 189, 248, 0.3)",
            color: "var(--accent)",
            cursor: syncing ? "wait" : "pointer",
            opacity: syncing ? 0.6 : 1,
          }}
          title="Query MT5 broker ground-truth orders and positions"
        >
          <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing MT5..." : "Re-sync Broker"}
        </button>
      </div>

      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12, lineHeight: 1.4 }}>
        The engine maintains strict ground-truth verification. When broker REST requests encounter network latency spikes, operations enter reconciliation mode to prevent duplicate orders or orphaned risk.
      </div>

      {feedback && (
        <div
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 11,
            fontWeight: 600,
            background: feedback.type === "success" ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
            color: feedback.type === "success" ? "var(--green)" : "var(--red)",
            border: `1px solid ${feedback.type === "success" ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
          }}
        >
          {feedback.text}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
          gap: 12,
        }}
      >
        {trades.map((trade) => {
          const isCancelling = trade.status === "cancelling" || trade.brokerStatus === "reconciliation_required";
          const isBusy = resolvingId === trade._id;
          const dirLabel = trade.dir === 1 ? "BUY" : trade.dir === -1 ? "SELL" : "NEUTRAL";
          const dirColor = trade.dir === 1 ? "var(--green)" : "var(--red)";

          return (
            <article
              key={trade._id}
              style={{
                minWidth: 0,
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                background: "var(--panel-2)",
                overflowWrap: "anywhere",
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <strong style={{ fontSize: 13, color: "var(--fg)" }}>{trade.symbol}</strong>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: "1px 5px",
                      borderRadius: 3,
                      background: trade.dir === 1 ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                      color: dirColor,
                    }}
                  >
                    {dirLabel}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: isCancelling ? "rgba(234, 179, 8, 0.15)" : "rgba(56, 189, 248, 0.15)",
                      color: isCancelling ? "var(--orange)" : "var(--accent)",
                    }}
                  >
                    {trade.status.toUpperCase()}
                  </span>
                </div>

                <button
                  onClick={() => handleForceResolve(trade._id)}
                  disabled={isBusy}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "4px 8px",
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    background: "rgba(239, 68, 68, 0.12)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "var(--red)",
                    cursor: isBusy ? "wait" : "pointer",
                    opacity: isBusy ? 0.5 : 1,
                  }}
                  title="Force resolve this pending order and discard from active queue"
                >
                  <Trash2 size={11} />
                  {isBusy ? "Resolving..." : "Force Resolve"}
                </button>
              </div>

              {/* Order Parameters Grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 6,
                  background: "rgba(0, 0, 0, 0.15)",
                  padding: "6px 8px",
                  borderRadius: 6,
                  fontFamily: "monospace",
                  fontSize: 11,
                }}
              >
                <div>
                  <div style={{ color: "var(--muted)", fontSize: 9 }}>Planned Entry</div>
                  <div>{formatPrice(trade.entryPrice)}</div>
                </div>
                <div>
                  <div style={{ color: "var(--muted)", fontSize: 9 }}>Stop Loss</div>
                  <div style={{ color: "var(--red)" }}>{formatPrice(trade.slPrice)}</div>
                </div>
                <div>
                  <div style={{ color: "var(--muted)", fontSize: 9 }}>Take Profit</div>
                  <div style={{ color: "var(--green)" }}>{formatPrice(trade.tpPrice)}</div>
                </div>
              </div>

              {/* Operational Advisory Banner */}
              {isCancelling && (
                <div
                  style={{
                    background: "rgba(234, 179, 8, 0.08)",
                    border: "1px solid rgba(234, 179, 8, 0.25)",
                    borderRadius: 6,
                    padding: "6px 8px",
                    fontSize: 10,
                    color: "var(--orange)",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                    lineHeight: 1.4,
                  }}
                >
                  <Clock size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <strong>Reconciling with Broker:</strong> Order cancel request in-flight. If the remote bridge dropped connection, the engine will confirm removal on the next MT5 poll, or click Force Resolve to dismiss immediately.
                  </div>
                </div>
              )}

              {/* Detailed Broker Telemetry */}
              <BrokerTelemetry trade={trade} />

              {/* Decision Evidence (vetoes / reason) */}
              <DecisionReasons
                vetoes={trade.vetoes}
                reason={trade.statusReason || trade.reconciliationReason}
              />
            </article>
          );
        })}
      </div>
    </section>
  );
}
