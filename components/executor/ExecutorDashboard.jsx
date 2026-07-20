"use client";

// /executor — Executor dashboard. The Executor runs trades the USER places
// (drawn on a chart as an rrtool, then "Send to Executor"). It validates the
// context, picks an entry mode (direct / candle / structural), and manages the
// position. This page shows the pipeline, per-setup context reports, journal,
// stats, and config (incl. the LIVE master switch).

import { useCallback, useEffect, useRef, useState } from "react";

const STAGES = [
  { id: "armed", label: "Armed", color: "var(--muted)" },
  { id: "validating", label: "Validating", color: "var(--orange)" },
  { id: "awaiting_entry", label: "Awaiting entry", color: "var(--accent)" },
  { id: "filled", label: "Filled", color: "var(--green)" },
  { id: "managing", label: "Managing", color: "var(--green)" },
];
const CLOSED = ["won", "lost", "expired", "invalidated", "cancelled"];
const CLOSED_COLOR = { won: "var(--green)", lost: "var(--red)", expired: "var(--muted)", invalidated: "var(--orange)", cancelled: "var(--muted)" };
const MODE_COLOR = { direct: "var(--green)", candle: "var(--orange)", structural: "var(--purple)" };

const panel = { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 14 };
const label = { fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 };

export default function ExecutorDashboard() {
  const [state, setState] = useState(null); // { config, stats, trades }
  const [ticks, setTicks] = useState({});
  const [toast, setToast] = useState(null);
  const wsRef = useRef(null);
  const stateRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/executor");
      const d = await r.json();
      if (d.ok) setState(d);
    } catch {}
  }, []);

  useEffect(() => { load(); const iv = setInterval(load, 15_000); return () => clearInterval(iv); }, [load]);

  useEffect(() => {
    let dead = false;
    const connect = () => {
      if (dead) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        const syms = openSymbols(stateRef.current);
        if (syms.length) ws.send(JSON.stringify({ type: "subscribe", symbols: syms }));
      };
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m.type === "ticks") setTicks((prev) => ({ ...prev, ...m.ticks }));
          if (m.type === "executor_changed") load();
        } catch {}
      };
      ws.onclose = () => { if (!dead) setTimeout(connect, 2000); };
    };
    connect();
    return () => { dead = true; wsRef.current?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => {
    stateRef.current = state;
    const ws = wsRef.current;
    if (ws?.readyState === 1 && state?.trades) {
      const syms = openSymbols(state);
      if (syms.length) ws.send(JSON.stringify({ type: "subscribe", symbols: syms }));
    }
  }, [state]);

  const patchConfig = useCallback(async (patch) => {
    try {
      const r = await fetch("/api/executor/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const d = await r.json();
      if (d.ok) setState((s) => (s ? { ...s, config: d.config } : s));
    } catch {}
  }, []);

  const act = useCallback(async (action, id) => {
    try {
      const r = await fetch("/api/executor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) });
      const d = await r.json();
      setToast(d.ok ? `${action} ok` : `${action} failed: ${d.error}`);
      load();
    } catch (e) { setToast(`${action} failed: ${e.message}`); }
    setTimeout(() => setToast(null), 4000);
  }, [load]);

  const cfg = state?.config;
  const trades = state?.trades || [];
  const open = trades.filter((t) => !CLOSED.includes(t.status));
  const closed = trades.filter((t) => CLOSED.includes(t.status));
  const stats = state?.stats;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font)", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <a href="/" style={{ color: "var(--muted)", textDecoration: "none", fontSize: 13 }}>← Charts</a>
        <h1 style={{ fontSize: 18, margin: 0 }}>Executor</h1>
        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: cfg?.liveEnabled ? "rgba(239,83,80,.15)" : "var(--accent-soft, rgba(41,98,255,.15))", color: cfg?.liveEnabled ? "var(--red)" : "var(--accent)", fontWeight: 700 }}>
          {cfg?.liveEnabled ? "LIVE ARMED" : "PAPER"}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Draw an R/R tool on a chart, then "Send to Executor".</span>
      </div>

      {toast && <div style={{ ...panel, marginBottom: 12, borderColor: "var(--accent)", fontSize: 13 }}>{toast}</div>}

      {stats && (
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <Stat label="Closed" value={stats.closed} />
          <Stat label="Win rate" value={`${stats.winRate}%`} color={stats.winRate >= 50 ? "var(--green)" : "var(--red)"} />
          <Stat label="Total R" value={`${stats.totalR > 0 ? "+" : ""}${stats.totalR}R`} color={stats.totalR >= 0 ? "var(--green)" : "var(--red)"} />
          <Stat label="Avg R" value={`${stats.avgR > 0 ? "+" : ""}${stats.avgR}R`} color={stats.avgR >= 0 ? "var(--green)" : "var(--red)"} />
          <Stat label="Open" value={open.length} />
        </div>
      )}

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: "1 1 300px", maxWidth: 380 }}>
          {cfg && <ConfigPanel cfg={cfg} onPatch={patchConfig} />}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: "2 1 460px", minWidth: 0 }}>
          <div style={panel}>
            <div style={{ ...label, marginBottom: 10 }}>Pipeline — {open.length} active</div>
            {open.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: "12px 0" }}>
              No active setups. Draw a Risk/Reward tool on any chart and choose "Send to Executor".
            </div>}
            {STAGES.filter((st, i, arr) => arr.findIndex((x) => x.id === st.id) === i).map((st) => {
              const rows = open.filter((t) => t.status === st.id);
              if (!rows.length) return null;
              return (
                <div key={st.id} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: st.color, marginBottom: 6 }}>{st.label.toUpperCase()} ({rows.length})</div>
                  {rows.map((t) => <SetupCard key={String(t._id)} t={t} tick={ticks[t.symbol]} onAct={act} />)}
                </div>
              );
            })}
          </div>

          <div style={panel}>
            <div style={{ ...label, marginBottom: 10 }}>Journal — last {closed.length}</div>
            {closed.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No closed setups yet.</div>}
            {closed.map((t) => <ClosedRow key={String(t._id)} t={t} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function openSymbols(state) {
  return [...new Set((state?.trades || []).filter((t) => !CLOSED.includes(t.status)).map((t) => t.symbol))];
}

function Stat({ label: l, value, color }) {
  return (
    <div style={{ ...panel, padding: "8px 14px", minWidth: 90 }}>
      <div style={label}>{l}</div>
      <div className="num" style={{ fontSize: 16, fontWeight: 700, color: color || "var(--text)" }}>{value}</div>
    </div>
  );
}

const fmtS = (v) => (v > 0 ? `+${v}` : `${v}`);

function SetupCard({ t, tick, onAct }) {
  const [expanded, setExpanded] = useState(false);
  const isBuy = t.dir === "buy";
  const px = tick ? (isBuy ? tick.ask ?? tick.bid : tick.bid ?? tick.ask) : null;
  const digits = tick?.digits ?? 5;
  const dist = px != null ? (isBuy ? px - t.entry : t.entry - px) : null;

  let liveR = null;
  if ((t.status === "filled" || t.status === "managing") && px != null) {
    const entryPx = t.filledPrice ?? t.entry;
    const risk = Math.abs(entryPx - (t.originalSl ?? t.sl));
    liveR = risk > 0 ? ((isBuy ? px - entryPx : entryPx - px) / risk) : 0;
  }
  const ctx = t.context;

  return (
    <div style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", marginBottom: 6, cursor: "pointer" }}
      onClick={() => setExpanded((e) => !e)}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <b style={{ fontSize: 14 }}>{t.symbol}</b>
        <span style={{ fontSize: 11, fontWeight: 700, color: isBuy ? "var(--green)" : "var(--red)" }}>{isBuy ? "▲ LONG" : "▼ SHORT"}</span>
        {t.live && <span style={{ fontSize: 9, fontWeight: 700, color: "var(--red)", border: "1px solid var(--red)", borderRadius: 3, padding: "1px 4px" }}>LIVE</span>}
        {t.mode && <span style={{ fontSize: 10, fontWeight: 700, color: MODE_COLOR[t.mode] || "var(--muted)" }}>{t.mode.toUpperCase()}</span>}
        <span className="num" style={{ fontSize: 12, color: "var(--muted)" }}>E {t.entry} · SL {t.sl} · TP {t.tp} · RR {t.rr}</span>
        {ctx && <span style={{ fontSize: 11, fontWeight: 700, color: ctx.grade === "strong" ? "var(--green)" : ctx.grade === "ok" ? "var(--orange)" : "var(--muted)" }}>{ctx.score}/100</span>}
        <div style={{ flex: 1 }} />
        {liveR != null && <span className="num" style={{ fontSize: 13, fontWeight: 700, color: liveR >= 0 ? "var(--green)" : "var(--red)" }}>{liveR >= 0 ? "+" : ""}{liveR.toFixed(2)}R</span>}
        {liveR == null && px != null && <span className="num" style={{ fontSize: 12, color: "var(--muted)" }}>
          {px.toFixed(digits)} {dist != null && <span style={{ color: dist <= 0 ? "var(--green)" : "var(--orange)" }}>({dist > 0 ? "+" : ""}{dist.toFixed(digits)})</span>}
        </span>}
      </div>
      {expanded && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }} onClick={(e) => e.stopPropagation()}>
          {ctx?.checks && (
            <div style={{ marginBottom: 4 }}>
              <b style={{ color: "var(--text)" }}>Context {ctx.score}/100 ({ctx.grade}):</b>
              {ctx.checks.map((c, i) => (
                <div key={i} style={{ color: c.applies === false ? "var(--muted)" : c.score >= 0 ? "var(--green)" : "var(--orange)" }}>
                  {c.applies === false ? "○" : c.score >= 0 ? "✓" : "⚠"} {c.name}: {c.note}
                </div>
              ))}
            </div>
          )}
          {ctx?.snapshot && (
            <div style={{ marginBottom: 4 }}>
              <b style={{ color: "var(--text)" }}>Auto-judge:</b> {ctx.snapshot.location} ({ctx.snapshot.range?.pos}% of range)
              {ctx.snapshot.zoneMatch && ` · zone ${ctx.snapshot.zoneMatch.tf} ${ctx.snapshot.zoneMatch.kind.toUpperCase()}`}
              {ctx.snapshot.slGuard && ` · SL guard ${ctx.snapshot.slGuard.side} @ ${ctx.snapshot.slGuard.price}`}
              {t.autoAdjusted && <span style={{ color: "var(--accent)" }}> · SL auto-widened</span>}
            </div>
          )}
          {(t.events || []).slice(-5).map((e, i) => <div key={i}>• {new Date(e.at).toLocaleTimeString()} {e.type}: {e.note}</div>)}
          <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
            {(t.status === "armed" || t.status === "validating" || t.status === "awaiting_entry") &&
              <button className="button" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => onAct("cancel", t._id)}>Cancel</button>}
            {(t.status === "filled" || t.status === "managing") &&
              <button className="button" style={{ padding: "3px 10px", fontSize: 12, color: "var(--red)" }} onClick={() => onAct("flatten", t._id)}>Flatten</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigPanel({ cfg, onPatch }) {
  const fields = [
    ["directMin", "Direct entry ≥ score", 1],
    ["confirmMin", "Candle entry ≥ score", 1],
    ["approachMult", "Approach × zone", 0.1],
    ["executorTtlHours", "Setup TTL (h)", 1],
    ["riskPct", "Risk % per trade", 0.1],
    ["accountEquity", "Account equity (0=fixed lot)", 100],
    ["lotSize", "Fixed / min lot", 0.01],
    ["maxLot", "Max lot", 0.1],
    ["beAtR", "Breakeven at R (0=off)", 0.1],
    ["maxSlWidenMult", "Max SL widen ×", 0.1],
  ];
  return (
    <div style={panel}>
      <div style={{ ...label, marginBottom: 10 }}>Executor Config</div>
      {fields.map(([key, name, step]) => (
        <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{name}</span>
          <input type="number" step={step} defaultValue={cfg[key]} key={`${key}:${cfg[key]}`}
            onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== cfg[key]) onPatch({ [key]: v }); }}
            style={{ width: 90, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", padding: "4px 8px", fontSize: 13, textAlign: "right" }} />
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Auto-adjust SL/TP</span>
        <button className="button" style={{ padding: "3px 10px", fontSize: 12, color: cfg.autoAdjust ? "var(--green)" : "var(--muted)" }}
          onClick={() => onPatch({ autoAdjust: !cfg.autoAdjust })}>{cfg.autoAdjust ? "ON" : "OFF"}</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Structure trail</span>
        <button className="button" style={{ padding: "3px 10px", fontSize: 12, color: cfg.trailMode === "structure" ? "var(--green)" : "var(--muted)" }}
          onClick={() => onPatch({ trailMode: cfg.trailMode === "structure" ? "off" : "structure" })}>{cfg.trailMode === "structure" ? "ON" : "OFF"}</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Telegram alerts</span>
        <button className="button" style={{ padding: "3px 10px", fontSize: 12, color: cfg.telegram ? "var(--green)" : "var(--muted)" }}
          onClick={() => onPatch({ telegram: !cfg.telegram })}>{cfg.telegram ? "ON" : "OFF"}</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
        <span style={{ fontSize: 12, color: cfg.liveEnabled ? "var(--red)" : "var(--muted)", fontWeight: 700 }}>⚠️ LIVE EXECUTION</span>
        <button className="button"
          style={{ padding: "3px 12px", fontSize: 12, fontWeight: 700, borderColor: cfg.liveEnabled ? "var(--red)" : "var(--border)", color: cfg.liveEnabled ? "var(--red)" : "var(--muted)" }}
          onClick={() => { if (cfg.liveEnabled || confirm("Enable LIVE execution? Setups flagged live will send real MT5 orders.")) onPatch({ liveEnabled: !cfg.liveEnabled }); }}>
          {cfg.liveEnabled ? "● LIVE ON" : "○ LIVE OFF"}
        </button>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10, lineHeight: 1.5 }}>
        The Executor validates each setup's context, escalates the entry (direct → candle → structural) when context is weak, and never rejects your setup — only hard invalidation (structure flip, zone break, TTL) cancels it. Live orders require BOTH this master switch AND a per-setup live flag.
      </div>
    </div>
  );
}

function ClosedRow({ t }) {
  const [expanded, setExpanded] = useState(false);
  const color = CLOSED_COLOR[t.status] || "var(--muted)";
  return (
    <div style={{ borderBottom: "1px solid var(--border)", padding: "6px 0", cursor: "pointer", fontSize: 13 }} onClick={() => setExpanded((e) => !e)}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color, fontWeight: 700, fontSize: 11, width: 82 }}>{t.status.toUpperCase()}</span>
        <b>{t.symbol}</b>
        <span style={{ fontSize: 11, color: t.dir === "buy" ? "var(--green)" : "var(--red)" }}>{t.dir === "buy" ? "LONG" : "SHORT"}</span>
        {t.resultR != null && <span className="num" style={{ fontWeight: 700, color: t.resultR >= 0 ? "var(--green)" : "var(--red)" }}>{t.resultR > 0 ? "+" : ""}{t.resultR}R</span>}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{new Date(t.closedAt || t.updatedAt).toLocaleString()}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
          {(t.events || []).map((e, i) => <div key={i}>• {new Date(e.at).toLocaleTimeString()} {e.type}: {e.note}</div>)}
        </div>
      )}
    </div>
  );
}

