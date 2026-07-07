"use client";

import { useMemo, useState } from "react";
import { X, RotateCcw, Trash2 } from "lucide-react";

const FILTERS = [
  { id: "active", label: "Active" },
  { id: "triggered", label: "Triggered" },
  { id: "all", label: "All" },
];

const COND_LABEL = { cross: "×", above: "▲", below: "▼" };
const COND_COLOR = { cross: "var(--orange)", above: "var(--green)", below: "var(--red)" };

// Every alert across every symbol. Filter by status, jump the chart by clicking
// the symbol, re-arm a triggered alert, or delete.
export default function AlertsPanel({ alerts, symbol, setSymbol, onDelete, onRearm, onCloseMobile }) {
  const [filter, setFilter] = useState("active");

  const counts = useMemo(() => ({
    active: alerts.filter((a) => a.status === "active").length,
    triggered: alerts.filter((a) => a.status === "triggered").length,
    all: alerts.length,
  }), [alerts]);

  const rows = useMemo(() => {
    let list = alerts;
    if (filter !== "all") list = list.filter((a) => a.status === filter);
    // current symbol pinned to the top within each filter
    return [...list].sort((a, b) => {
      const ax = a.symbol === symbol ? 0 : 1;
      const bx = b.symbol === symbol ? 0 : 1;
      if (ax !== bx) return ax - bx;
      // active first, then newest
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [alerts, filter, symbol]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, borderTop: "1px solid var(--border)" }}>
      <div style={{
        padding: "9px 12px", display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--muted)" }}>
            Alerts
          </div>
          {onCloseMobile && (
            <button className="hide-desktop ghost" onClick={onCloseMobile} style={{ padding: "4px" }}><X size={14} /></button>
          )}
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={filter === f.id ? "primary" : "ghost"}
              style={{ padding: "2px 8px", fontSize: 11 }}
            >
              {f.label}{counts[f.id] ? ` · ${counts[f.id]}` : ""}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
        {!rows.length && (
          <div className="muted" style={{ padding: "20px 16px", textAlign: "center", fontSize: 12 }}>
            {filter === "active"
              ? "No active alerts. Hover the chart or right-click to add one."
              : `No ${filter} alerts.`}
          </div>
        )}

        {rows.map((a) => (
          <AlertRow
            key={a._id}
            a={a}
            current={a.symbol === symbol}
            onJump={() => setSymbol(a.symbol)}
            onDelete={() => onDelete(a._id)}
            onRearm={() => onRearm(a._id)}
          />
        ))}
      </div>
    </div>
  );
}

function AlertRow({ a, current, onJump, onDelete, onRearm }) {
  const triggered = a.status === "triggered";
  const time = triggered
    ? new Date(a.triggeredAt || a.createdAt)
    : new Date(a.createdAt);
  const timeStr = isNaN(time) ? "" : time.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div
      style={{
        padding: "8px 12px", borderTop: "1px solid var(--border)",
        display: "flex", flexDirection: "column", gap: 4,
        opacity: triggered ? 0.62 : 1,
        background: current ? "var(--accent-soft)" : "transparent",
        borderLeft: current ? "2px solid var(--accent)" : "2px solid transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: COND_COLOR[a.condition], fontWeight: 700, width: 12, textAlign: "center" }}>
          {COND_LABEL[a.condition]}
        </span>
        <button
          className="ghost"
          onClick={onJump}
          title={current ? "Current chart" : `Switch to ${a.symbol}`}
          style={{
            padding: "1px 4px", fontWeight: 700, fontSize: 12,
            color: current ? "var(--accent)" : "var(--text)",
          }}
        >
          {a.symbol}
        </button>
        <span className="num" style={{ fontWeight: 600, fontSize: 12 }}>{a.price}</span>
        <span className="muted" style={{ fontSize: 11 }}>{a.condition}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {triggered && (
            <button
              className="ghost"
              onClick={onRearm}
              title="Re-arm (reset to active)"
              style={{ fontSize: 11, padding: "4px 8px", display: "flex", alignItems: "center", gap: 4 }}
            >
              <RotateCcw size={12} /> re-arm
            </button>
          )}
          <button
            className="ghost danger"
            onClick={onDelete}
            title="Delete alert"
            style={{ padding: "4px", display: "flex", alignItems: "center" }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {a.note && (
        <div className="muted" style={{ fontSize: 11, paddingLeft: 18, fontStyle: "italic" }}>
          “{a.note}”
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", paddingLeft: 18, fontSize: 10 }}>
        <span className="muted">
          {triggered
            ? <>filled <span className="num up">@ {a.triggeredPrice ?? "—"}</span></>
            : "waiting"}
        </span>
        <span className="muted">{timeStr}</span>
      </div>
    </div>
  );
}
