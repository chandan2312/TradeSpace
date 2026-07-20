"use client";

// /currency-algo — auto-strategy dashboard (paper trading).
// Left: currency strength (reused component) + config. Right: pipeline board
// (watching → approaching → confirmed → filled) with live tick distances,
// then the journal (closed trades) + stats strip.

import { useCallback, useEffect, useRef, useState } from "react";
import CurrencyStrengthMeter from "../CurrencyStrengthMeter";
import CurrencyHeatmap from "./CurrencyHeatmap";

const STAGES = [
  { id: "tracking", label: "Tracking", color: "var(--purple)" },
  { id: "watching", label: "Watching", color: "var(--muted)" },
  { id: "approaching", label: "Approaching", color: "var(--orange)" },
  { id: "confirmed", label: "Confirmed", color: "var(--accent)" },
  { id: "filled", label: "Filled", color: "var(--green)" },
];
const CLOSED = ["won", "lost", "expired", "invalidated", "rejected"];
const CLOSED_COLOR = { won: "var(--green)", lost: "var(--red)", expired: "var(--muted)", invalidated: "var(--orange)", rejected: "var(--muted)" };

const panel = { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 14 };
const label = { fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 };

export default function AlgoDashboard() {
  const [state, setState] = useState(null); // { config, stats, trades, lastScan }
  const [ticks, setTicks] = useState({});
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState(null);
  const wsRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/algo");
      const d = await r.json();
      if (d.ok) setState(d);
    } catch {}
  }, []);

  useEffect(() => { load(); const iv = setInterval(load, 15_000); return () => clearInterval(iv); }, [load]);

  // live ticks for open-trade distances + algo_changed push
  useEffect(() => {
    let dead = false;
    const connect = () => {
      if (dead) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        const syms = [...new Set((stateRef.current?.trades || []).filter((t) => !CLOSED.includes(t.status)).map((t) => t.symbol))];
        if (syms.length) ws.send(JSON.stringify({ type: "subscribe", symbols: syms }));
      };
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m.type === "ticks") setTicks((prev) => ({ ...prev, ...m.ticks }));
          if (m.type === "algo_changed") load();
        } catch {}
      };
      ws.onclose = () => { if (!dead) setTimeout(connect, 2000); };
    };
    connect();
    return () => { dead = true; wsRef.current?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // keep the WS subscription covering open symbols
  const stateRef = useRef(null);
  useEffect(() => {
    stateRef.current = state;
    const ws = wsRef.current;
    if (ws?.readyState === 1 && state?.trades) {
      const syms = [...new Set(state.trades.filter((t) => !CLOSED.includes(t.status)).map((t) => t.symbol))];
      if (syms.length) ws.send(JSON.stringify({ type: "subscribe", symbols: syms }));
    }
  }, [state]);

  const patchConfig = useCallback(async (patch) => {
    try {
      const r = await fetch("/api/algo/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const d = await r.json();
      if (d.ok) setState((s) => (s ? { ...s, config: d.config } : s));
    } catch {}
  }, []);

  const forceScan = useCallback(async () => {
    setScanning(true);
    try {
      const r = await fetch("/api/algo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "scan" }) });
      const d = await r.json();
      setToast(d.scan?.ok ? `Scan: ${d.scan.candidates} candidates, ${d.scan.created} new` : `Scan failed: ${d.scan?.error || d.error}`);
      load();
    } catch (e) { setToast("Scan failed: " + e.message); }
    setScanning(false);
    setTimeout(() => setToast(null), 4000);
  }, [load]);

  const cfg = state?.config;
  const trades = state?.trades || [];
  const open = trades.filter((t) => !CLOSED.includes(t.status));
  const closed = trades.filter((t) => CLOSED.includes(t.status));
  const stats = state?.stats;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font)", padding: 16 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <a href="/" style={{ color: "var(--muted)", textDecoration: "none", fontSize: 13 }}>← Charts</a>
        <h1 style={{ fontSize: 18, margin: 0 }}>Currency Algo</h1>
        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "var(--accent-soft, rgba(41,98,255,.15))", color: "var(--accent)", fontWeight: 700 }}>PAPER</span>
        <div style={{ flex: 1 }} />
        {cfg && (
          <button className="button" style={{ borderColor: cfg.enabled ? "var(--green)" : "var(--border)", color: cfg.enabled ? "var(--green)" : "var(--muted)" }}
            onClick={() => patchConfig({ enabled: !cfg.enabled })}>
            {cfg.enabled ? "● Engine ON" : "○ Engine OFF"}
          </button>
        )}
        <button className="button" onClick={forceScan} disabled={scanning}>{scanning ? "Scanning…" : "Scan now"}</button>
      </div>

      {toast && <div style={{ ...panel, marginBottom: 12, borderColor: "var(--accent)", fontSize: 13 }}>{toast}</div>}

      {/* stats strip */}
      {stats && (
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <Stat label="Closed" value={stats.closed} />
          <Stat label="Win rate" value={`${stats.winRate}%`} color={stats.winRate >= 50 ? "var(--green)" : "var(--red)"} />
          <Stat label="Total R" value={`${stats.totalR > 0 ? "+" : ""}${stats.totalR}R`} color={stats.totalR >= 0 ? "var(--green)" : "var(--red)"} />
          <Stat label="Avg R" value={`${stats.avgR > 0 ? "+" : ""}${stats.avgR}R`} color={stats.avgR >= 0 ? "var(--green)" : "var(--red)"} />
          <Stat label="Open" value={open.length} />
          {state?.lastScan && <Stat label="Last scan" value={new Date(state.lastScan.at).toLocaleTimeString()} />}
        </div>
      )}

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* left column: strength + config */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: "1 1 320px", maxWidth: 420 }}>
          <div style={{ ...panel, padding: 0, overflow: "hidden" }}>
            <CurrencyStrengthMeter onSelectSuggested={() => {}} />
          </div>
          <CurrencyHeatmap />
          {cfg && <ConfigPanel cfg={cfg} onPatch={patchConfig} />}
        </div>

        {/* right column: pipeline + journal */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: "2 1 420px", minWidth: 0 }}>
          {closed.length > 0 && (
            <div style={panel}>
              <div style={{ ...label, marginBottom: 8 }}>Equity curve (cumulative R)</div>
              <EquityCurve trades={closed} />
              {stats?.bySymbol && Object.keys(stats.bySymbol).length > 0 && <SymbolBars bySymbol={stats.bySymbol} />}
            </div>
          )}
          <div style={panel}>
            <div style={{ ...label, marginBottom: 10 }}>Pipeline — {open.length} active</div>
            {open.length === 0 && (
              <div style={{ color: "var(--muted)", fontSize: 13, padding: "32px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                <div style={{ position: "relative", width: 40, height: 40, display: "flex", justifyContent: "center", alignItems: "center" }}>
                  <div className="sonar-blue" style={{ position: "absolute", inset: 0, border: "2px solid rgba(41, 98, 255, 0.5)", borderRadius: "50%" }} />
                  <div style={{ width: 8, height: 8, background: "var(--accent)", borderRadius: "50%", boxShadow: "0 0 10px var(--accent)" }} />
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ color: "var(--text)", fontWeight: 600, marginBottom: 4 }}>Monitoring Markets</div>
                  {cfg?.enabled ? "Scanner running every 3 minutes..." : "Engine is OFF. Arm it or press Scan now."}
                </div>
              </div>
            )}
            {STAGES.map((st) => {
              const rows = open.filter((t) => t.status === st.id);
              if (!rows.length) return null;
              
              // Decide sonar color based on stage urgency
              let sonarCls = "";
              if (st.id === "filled") sonarCls = "sonar-green";
              else if (st.id === "approaching" || st.id === "confirmed") sonarCls = "sonar-orange";
              else if (st.id === "watching" || st.id === "tracking") sonarCls = "sonar-blue";

              return (
                <div key={st.id} style={{ marginBottom: 10 }} className="animate-in">
                  <div style={{ fontSize: 11, fontWeight: 700, color: st.color, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                    <div className={sonarCls} style={{ width: 6, height: 6, background: st.color }} />
                    {st.label.toUpperCase()} ({rows.length})
                  </div>
                  {rows.map((t, i) => <div key={String(t._id)} style={{ animationDelay: `${i * 0.05}s` }} className="animate-in"><TradeCard t={t} tick={ticks[t.symbol]} /></div>)}
                </div>
              );
            })}
          </div>

          <div style={panel}>
            <div style={{ ...label, marginBottom: 10 }}>Journal — last {closed.length}</div>
            {closed.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No closed trades yet.</div>}
            {closed.map((t) => <ClosedRow key={String(t._id)} t={t} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label: l, value, color }) {
  return (
    <div style={{ ...panel, padding: "8px 14px", minWidth: 90 }}>
      <div style={label}>{l}</div>
      <div className="num" style={{ fontSize: 16, fontWeight: 700, color: color || "var(--text)" }}>{value}</div>
    </div>
  );
}

function TradeCard({ t, tick }) {
  const [expanded, setExpanded] = useState(false);
  const isBuy = t.dir === "buy";
  const px = tick ? (isBuy ? tick.ask ?? tick.bid : tick.bid ?? tick.ask) : null;
  const dist = px != null ? (isBuy ? px - t.entry.price : t.entry.price - px) : null;
  const digits = tick?.digits ?? 5;

  // live R for filled trades
  let liveR = null;
  if (t.status === "filled" && px != null) {
    const risk = Math.abs((t.filledPrice ?? t.entry.price) - t.sl);
    liveR = risk > 0 ? ((isBuy ? px - (t.filledPrice ?? t.entry.price) : (t.filledPrice ?? t.entry.price) - px) / risk) : 0;
  }

  return (
    <div style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", marginBottom: 6, cursor: "pointer" }}
      onClick={() => setExpanded((e) => !e)}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <b style={{ fontSize: 14 }}>{t.symbol}</b>
        <span style={{ fontSize: 11, fontWeight: 700, color: isBuy ? "var(--green)" : "var(--red)" }}>{isBuy ? "▲ LONG" : "▼ SHORT"}</span>
        <span className="num" style={{ fontSize: 12, color: "var(--muted)" }}>
          E {t.entry.price} · SL {t.sl} · TP {t.tp} · RR {t.rr}
        </span>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>score {t.score}</span>
        <div style={{ flex: 1 }} />
        {liveR != null && <span className="num" style={{ fontSize: 13, fontWeight: 700, color: liveR >= 0 ? "var(--green)" : "var(--red)" }}>{liveR >= 0 ? "+" : ""}{liveR.toFixed(2)}R</span>}
        {liveR == null && px != null && <span className="num" style={{ fontSize: 12, color: "var(--muted)" }}>
          {px.toFixed(digits)} {dist != null && <span style={{ color: dist <= 0 ? "var(--green)" : "var(--orange)" }}>({dist > 0 ? "+" : ""}{(dist).toFixed(digits)})</span>}
        </span>}
      </div>
      <PriceLadder t={t} px={px} />
      {expanded && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
          <div><b style={{ color: "var(--text)" }}>Strength:</b> {t.strength?.base} {fmtS(t.strength?.baseScore)} vs {t.strength?.quote} {fmtS(t.strength?.quoteScore)} (edge {t.strength?.edge})</div>
          <div><b style={{ color: "var(--text)" }}>Zone:</b> {t.entry.tf} {t.entry.kind?.toUpperCase()} {t.entry.zoneBottom}–{t.entry.zoneTop} · target pool {t.pool?.name} @ {t.pool?.price}</div>
          {(t.reasons || []).map((r, i) => <div key={i}>• {r}</div>)}
          {t.confirm?.checks && (
            <div style={{ marginTop: 4 }}>
              <b style={{ color: "var(--text)" }}>Confirmation:</b>
              {t.confirm.checks.map((c, i) => <div key={i} style={{ color: c.pass ? "var(--green)" : "var(--red)" }}>{c.pass ? "✓" : "✗"} {c.name}: {c.note}</div>)}
            </div>
          )}
          <div style={{ marginTop: 4, fontSize: 11 }}>{new Date(t.createdAt).toLocaleString()}</div>
        </div>
      )}
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
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
          <div>E {t.entry?.price} · SL {t.sl} · TP {t.tp} · RR {t.rr} · score {t.score}</div>
          {(t.events || []).map((e, i) => <div key={i}>• {new Date(e.at).toLocaleTimeString()} — <b>{e.type}</b>: {e.note}</div>)}
        </div>
      )}
    </div>
  );
}

function ConfigPanel({ cfg, onPatch }) {
  const fields = [
    ["minStrong", "Min currency |score|", 1],
    ["minEdge", "Min strength edge", 1],
    ["minScore", "Min setup score", 1],
    ["minRR", "Min risk:reward", 0.1],
    ["approachMult", "Approach × zone", 0.1],
    ["trackMult", "Track (fat) × zone", 0.5],
    ["ttlHours", "Candidate TTL (h)", 1],
    ["trackHours", "Tracking TTL (h)", 1],
    ["maxConcurrent", "Max open fills", 1],
    ["maxConfirmFails", "Max confirm fails", 1],
    ["reconfirmCooldownMin", "Re-confirm cooldown (min)", 1],
  ];
  return (
    <div style={panel}>
      <div style={{ ...label, marginBottom: 10 }}>Engine Config</div>
      {fields.map(([key, name, step]) => (
        <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{name}</span>
          <input type="number" step={step} defaultValue={cfg[key]} key={`${key}:${cfg[key]}`}
            onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== cfg[key]) onPatch({ [key]: v }); }}
            style={{ width: 80, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", padding: "4px 8px", fontSize: 13, textAlign: "right" }} />
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Telegram alerts</span>
        <button className="button" style={{ padding: "3px 10px", fontSize: 12, color: cfg.telegram ? "var(--green)" : "var(--muted)" }}
          onClick={() => onPatch({ telegram: !cfg.telegram })}>{cfg.telegram ? "ON" : "OFF"}</button>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10, lineHeight: 1.5 }}>
        Paper trading only — no broker orders. The scanner picks strong-vs-weak pairs, finds a pullback
        zone with liquidity ahead, and re-confirms against the correlated market before each paper fill.
      </div>
    </div>
  );
}

const fmtS = (v) => (v > 0 ? `+${v}` : `${v}`);

// ---------- visualizations (inline SVG, no deps) ----------

// cumulative R over closed trades (oldest → newest), zero-line anchored
function EquityCurve({ trades }) {
  const seq = [...trades]
    .filter((t) => t.resultR != null)
    .sort((a, b) => new Date(a.closedAt || a.updatedAt) - new Date(b.closedAt || b.updatedAt));
  if (!seq.length) return null;
  const W = 560, H = 120, PAD = 6;
  let acc = 0;
  const pts = [{ x: 0, r: 0 }];
  seq.forEach((t, i) => { acc += t.resultR; pts.push({ x: i + 1, r: acc }); });
  const rMin = Math.min(0, ...pts.map((p) => p.r));
  const rMax = Math.max(0, ...pts.map((p) => p.r));
  const span = Math.max(rMax - rMin, 1);
  const X = (x) => PAD + (x / (pts.length - 1)) * (W - 2 * PAD);
  const Y = (r) => PAD + (1 - (r - rMin) / span) * (H - 2 * PAD);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.r).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const up = last.r >= 0;
  const color = up ? "var(--green)" : "var(--red)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {/* zero line */}
      <line x1={PAD} x2={W - PAD} y1={Y(0)} y2={Y(0)} stroke="var(--border)" strokeDasharray="4 4" />
      {/* area fill to zero */}
      <path d={`${path} L${X(last.x)},${Y(0)} L${X(0)},${Y(0)} Z`} fill={up ? "rgba(38,166,154,.12)" : "rgba(239,83,80,.12)"} stroke="none" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      {/* win/loss dots */}
      {seq.map((t, i) => (
        <circle key={i} cx={X(i + 1)} cy={Y(pts[i + 1].r)} r="2.5"
          fill={t.resultR >= 0 ? "var(--green)" : "var(--red)"} />
      ))}
      <text x={W - PAD} y={Y(last.r) - 6} textAnchor="end" fontSize="12" fontWeight="700"
        fill={color} fontFamily="var(--mono)">{last.r > 0 ? "+" : ""}{last.r.toFixed(2)}R</text>
    </svg>
  );
}

// horizontal R bars per symbol
function SymbolBars({ bySymbol }) {
  const rows = Object.entries(bySymbol).sort((a, b) => b[1].r - a[1].r);
  const maxAbs = Math.max(0.5, ...rows.map(([, v]) => Math.abs(v.r)));
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ ...label, marginBottom: 6 }}>R by symbol</div>
      {rows.map(([sym, v]) => {
        const pct = Math.abs(v.r) / maxAbs * 50; // half-width each side of center
        const up = v.r >= 0;
        return (
          <div key={sym} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ width: 62, fontSize: 11, fontWeight: 700 }}>{sym}</span>
            <div style={{ flex: 1, height: 12, position: "relative", background: "var(--panel-2)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--border)" }} />
              <div style={{
                position: "absolute", top: 1, bottom: 1, borderRadius: 2,
                left: up ? "50%" : `${50 - pct}%`, width: `${pct}%`,
                background: up ? "var(--green)" : "var(--red)", opacity: 0.85,
              }} />
            </div>
            <span className="num" style={{ width: 70, fontSize: 11, textAlign: "right", color: up ? "var(--green)" : "var(--red)" }}>
              {v.r > 0 ? "+" : ""}{v.r.toFixed(2)}R · {v.wins}/{v.n}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// SL → entry(zone) → TP ladder with live price marker, oriented so TP is
// always on the right (reads left-to-right as "risk … reward")
function PriceLadder({ t, px }) {
  const isBuy = t.dir === "buy";
  const lo = Math.min(t.sl, t.tp), hi = Math.max(t.sl, t.tp);
  const span = hi - lo;
  if (!(span > 0)) return null;
  // map price → % with TP on the right regardless of direction
  const pos = (p) => {
    const raw = (p - lo) / span;
    return (isBuy ? raw : 1 - raw) * 100;
  };
  const clamp = (v) => Math.max(0, Math.min(100, v));
  const zA = clamp(pos(t.entry.zoneBottom)), zB = clamp(pos(t.entry.zoneTop));
  const zoneL = Math.min(zA, zB), zoneW = Math.max(Math.abs(zB - zA), 1);
  const pxPos = px != null ? clamp(pos(px)) : null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ position: "relative", height: 18, background: "var(--panel-2)", borderRadius: 4 }}>
        {/* risk segment: SL → entry */}
        <div style={{ position: "absolute", top: 6, bottom: 6, left: 0, width: `${clamp(pos(t.entry.price))}%`, background: "rgba(239,83,80,.25)", borderRadius: 3 }} />
        {/* reward segment: entry → TP */}
        <div style={{ position: "absolute", top: 6, bottom: 6, left: `${clamp(pos(t.entry.price))}%`, right: 0, background: "rgba(38,166,154,.25)", borderRadius: 3 }} />
        {/* entry zone band */}
        <div style={{ position: "absolute", top: 2, bottom: 2, left: `${zoneL}%`, width: `${zoneW}%`, background: "rgba(41,98,255,.35)", borderRadius: 3 }} />
        {/* markers */}
        <Marker at={0} color="var(--red)" />
        <Marker at={clamp(pos(t.entry.price))} color="var(--accent)" />
        <Marker at={100} color="var(--green)" />
        {pxPos != null && (
          <div style={{ position: "absolute", top: -3, bottom: -3, left: `calc(${pxPos}% - 1.5px)`, width: 3, background: "var(--text)", borderRadius: 2, boxShadow: "0 0 4px rgba(255,255,255,.6)" }} />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginTop: 2 }} className="num">
        <span style={{ color: "var(--red)" }}>SL {t.sl}</span>
        <span style={{ color: "var(--accent)" }}>E {t.entry.price}</span>
        <span style={{ color: "var(--green)" }}>TP {t.tp}</span>
      </div>
    </div>
  );
}

function Marker({ at, color }) {
  return <div style={{ position: "absolute", top: 0, bottom: 0, left: `calc(${at}% - 1px)`, width: 2, background: color }} />;
}
