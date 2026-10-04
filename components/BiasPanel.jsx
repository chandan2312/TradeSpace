"use client";

import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { RefreshCw, AlertTriangle, Maximize2, Loader2, LayoutGrid } from "lucide-react";

// Intraday bias panel (sidebar, below the watchlist).
// Diagrams: risk-sentiment gauge, FX currency-strength bars, per-symbol
// pillar breakdown (HTF / Intraday / Liquidity / Context), plus the factor
// audit trail split into drives (▲▼) and dampeners (⚠, score reducers).
const REFRESH_MS = 300_000;

const PHASE = {
  trend: { tag: "T", title: "Trending — layers agree", color: "var(--accent)" },
  "reversal-watch": { tag: "R", title: "Reversal watch — fresh sweep/MSS against HTF", color: "var(--orange)" },
  setup: { tag: "⚡", title: "Setup — pool swept + M15 MSS confirmed", color: "var(--orange)" },
  chop: { tag: "C", title: "Chop — no edge", color: "var(--muted)" },
};

const scoreColor = (s) =>
  s > 15 ? "var(--green)" : s < -15 ? "var(--red)" : "var(--muted)";

export default function BiasPanel({ enabled = true, symbols, onJump, onClose, onOpenCorrelated }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const timer = useRef(null);

  const load = useCallback(async () => {
    if (!enabled) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/bias?symbols=ALL`);
      const body = await res.json();
      if (body.ok) setData(body);
    } catch { /* keep last read */ }
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    load();
    clearInterval(timer.current);
    timer.current = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [load]);

  // Esc closes the fullscreen view
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filteredSymbols = React.useMemo(() => {
    if (!data) return [];
    // only watchlist/open-pane symbols are SHOWN — the full-market scan stays
    // backend-side (currency strength, categories, group confirmation)
    const norm = (s) => s.replace(/[._-].*$/, "").replace(/m$/, "").toUpperCase();
    const watch = new Set((symbols || []).map(norm));
    let syms = watch.size ? data.symbols.filter((s) => watch.has(norm(s.symbol))) : data.symbols;
    if (filter === "TOP") {
      syms = syms.filter(s => Math.abs(s.score) >= 15 || s.setup);
    } else if (filter !== "ALL") {
      const cat = data.categories.find(c => c.id === filter);
      if (cat) syms = syms.filter(s => cat.members.includes(s.symbol));
    }
    // Sort by absolute score so highest momentum/trend is on top
    return syms.slice().sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  }, [data, filter]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,.55)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: "min(1240px, 95vw)", height: "90vh", display: "flex", flexDirection: "column",
          background: "var(--panel)", border: "1px solid var(--border-hi)", borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,.6)", overflow: "hidden",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <span className="muted" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 }}>
            Market Bias {data?.session ? ` · ${data.session}` : ""}
          </span>
          {onOpenCorrelated && (
            <button className="ghost" onClick={onOpenCorrelated} title="Cross-reference correlated pairs" style={{ padding: "2px 8px", fontSize: 11, display: "flex", alignItems: "center", gap: 4, background: "rgba(41,98,255,0.15)", color: "var(--accent)", border: "1px solid rgba(41,98,255,0.3)", borderRadius: 4 }}>
              <LayoutGrid size={12} /> Correlated
            </button>
          )}
          <button
            className="ghost"
            onClick={load}
            title="Refresh now (auto every 300s)"
            style={{ marginLeft: "auto", padding: "2px 6px", display: "flex", alignItems: "center" }}
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} />
          </button>
          <button className="ghost" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px 14px" }}>
          {!data && (
            <div className="muted" style={{ padding: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              {loading ? (
                <>
                  <Loader2 size={28} className="spin" style={{ color: "var(--accent)" }} />
                  <div style={{ fontSize: 13 }}>Scanning market structure...</div>
                </>
              ) : !enabled ? (
                <div style={{ textAlign: "center", fontSize: 13 }}>Bias Engine is currently OFF.<br/>Enable it in the top menu.</div>
              ) : (
                "No data"
              )}
            </div>
          )}

          {data && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0 18px" }}>
                {data.risk && <RiskGauge risk={data.risk} />}
                <div style={{ flex: 1, minWidth: 260 }}>
                  <CategoryChips categories={data.categories} activeFilter={filter} onFilter={setFilter} />
                </div>
                {data.currencyStrength?.length > 1 && (
                  <div style={{ minWidth: 320 }}>
                    <StrengthBars items={data.currencyStrength} />
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 8, padding: "14px 6px" }}>
                {filteredSymbols.map((r) => (
                  <div key={r.symbol} style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--panel-2)" }}>
                    <SymbolRow
                      r={r}
                      expanded
                      onToggle={() => {}}
                      onJump={(s) => { onClose?.(); onJump?.(s); }}
                    />
                  </div>
                ))}
              </div>

              {data.errors && (
                <div className="muted" style={{ padding: "6px 12px", fontSize: 11 }}>
                  No data: {Object.keys(data.errors).join(", ")}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const fmtS = (v) => `${v > 0 ? "+" : ""}${v}`;

function CategoryChips({ categories, activeFilter, onFilter }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "2px 12px 6px" }}>
      <button
        onClick={() => onFilter("ALL")}
        style={{
          fontSize: 10, padding: "2px 7px", borderRadius: 10, cursor: "pointer",
          border: "1px solid var(--border)", color: activeFilter === "ALL" ? "#fff" : "var(--muted)",
          background: activeFilter === "ALL" ? "var(--brand)" : "var(--panel-2)", fontWeight: 600,
        }}
      >
        ALL
      </button>
      <button
        onClick={() => onFilter("TOP")}
        style={{
          fontSize: 10, padding: "2px 7px", borderRadius: 10, cursor: "pointer",
          border: "1px solid var(--orange)", color: activeFilter === "TOP" ? "#fff" : "var(--orange)",
          background: activeFilter === "TOP" ? "var(--orange)" : "var(--panel-2)", fontWeight: 600,
        }}
      >
        🔥 TOP CHOICES
      </button>
      {categories.map((c) => (
        <button
          key={c.id}
          onClick={() => onFilter(c.id)}
          title={`${c.label}: ${fmtS(c.score)} · ${c.alignment}% aligned · ${c.members.join(", ")}`}
          style={{
            fontSize: 10, padding: "2px 7px", borderRadius: 10, cursor: "pointer",
            border: activeFilter === c.id ? "1px solid var(--brand)" : "1px solid var(--border)", 
            color: activeFilter === c.id ? "var(--brand)" : scoreColor(c.score),
            background: activeFilter === c.id ? "rgba(var(--brand-rgb), 0.15)" : "var(--panel-2)", fontWeight: 600,
          }}
        >
          {c.label} {fmtS(c.score)}
          {c.members.length > 1 && <span style={{ opacity: 0.55, fontWeight: 400 }}> · {c.alignment}%</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- diagram: risk sentiment gauge (semicircle needle) ----------
function RiskGauge({ risk }) {
  const angle = (risk.score / 100) * 80; // −80°..+80°
  const col = scoreColor(risk.score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 12px 6px" }}>
      <svg width="64" height="36" viewBox="0 0 64 36">
        <path d="M 6 32 A 26 26 0 0 1 58 32" fill="none" stroke="var(--panel-2)" strokeWidth="5" strokeLinecap="round" />
        <path d="M 6 32 A 26 26 0 0 1 32 6" fill="none" stroke="rgba(239,83,80,.25)" strokeWidth="5" strokeLinecap="round" />
        <path d="M 32 6 A 26 26 0 0 1 58 32" fill="none" stroke="rgba(38,166,154,.25)" strokeWidth="5" strokeLinecap="round" />
        <line
          x1="32" y1="32" x2={32 + 22 * Math.sin((angle * Math.PI) / 180)} y2={32 - 22 * Math.cos((angle * Math.PI) / 180)}
          stroke={col} strokeWidth="2" strokeLinecap="round"
        />
        <circle cx="32" cy="32" r="2.5" fill={col} />
      </svg>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: col }}>
          {risk.score > 20 ? "Risk-on" : risk.score < -20 ? "Risk-off" : "Risk neutral"} {fmtS(risk.score)}
        </div>
        <div className="muted" style={{ fontSize: 10 }}>{risk.note}</div>
      </div>
    </div>
  );
}

// ---------- diagram: FX currency strength bars ----------
function StrengthBars({ items }) {
  const max = Math.max(...items.map((c) => Math.abs(c.score)), 1);
  return (
    <div style={{ padding: "0 12px 8px" }}>
      <div className="muted" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>
        Currency strength
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "2px 12px" }}>
        {items.map((c) => (
          <div key={c.ccy} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span className="num" style={{ fontSize: 10, fontWeight: 700, width: 26 }}>{c.ccy}</span>
            <CenterBar value={(c.score / max) * 100} height={4} />
            <span className="num" style={{ fontSize: 9, color: scoreColor(c.score), width: 24, textAlign: "right" }}>{fmtS(c.score)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// centered −100..+100 bar used everywhere
function CenterBar({ value, height = 4 }) {
  return (
    <span style={{ flex: 1, height, background: "var(--panel-2)", borderRadius: height / 2, position: "relative", overflow: "hidden" }}>
      <span style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--border-hi)" }} />
      <span style={{
        position: "absolute", top: 0, bottom: 0,
        left: value >= 0 ? "50%" : `${50 + value / 2}%`,
        width: `${Math.abs(value) / 2}%`,
        background: scoreColor(value), borderRadius: height / 2,
      }} />
    </span>
  );
}

function BrainCard({ brain }) {
  if (!brain) return null;
  const isLong = brain.action === "READY_FOR_LONG";
  const isShort = brain.action === "READY_FOR_SHORT";
  const isPullback = brain.action === "WAIT_FOR_RETRACEMENT" || brain.action === "WAIT_FOR_15M_PULLBACK";
  const isTrigger = brain.action === "WAIT_FOR_15M_TRIGGER";
  const col = isLong ? "var(--green)" : isShort ? "var(--red)" : (isPullback || isTrigger) ? "var(--orange)" : "var(--muted)";
  const bg = isLong ? "rgba(38,166,154,0.08)" : isShort ? "rgba(239,83,80,0.08)" : (isPullback || isTrigger) ? "rgba(255,152,0,0.08)" : "var(--panel-2)";
  const borderCol = isLong ? "rgba(38,166,154,0.3)" : isShort ? "rgba(239,83,80,0.3)" : (isPullback || isTrigger) ? "rgba(255,152,0,0.3)" : "var(--border)";

  const dt = brain.dayTraderContext;
  const macroCol = dt?.macroCompass === "BULLISH" ? "var(--green)" : dt?.macroCompass === "BEARISH" ? "var(--red)" : "var(--muted)";
  const veto = dt?.ltfGatekeeper?.vetoActive;

  return (
    <div style={{ background: bg, border: `1px solid ${borderCol}`, borderRadius: 6, padding: "8px 10px", margin: "4px 0 8px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: col }}>
            🧠 {brain.verdict?.replace(/_/g, " ")}
          </span>
          <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, fontWeight: 700, background: "rgba(255,255,255,0.08)", color: col }}>
            {brain.action?.replace(/_/g, " ")}
          </span>
        </div>
        <span className="num" style={{ fontSize: 9, fontWeight: 700, color: col }}>
          {brain.conviction}% Conviction
        </span>
      </div>

      {dt && (
        <div style={{
          display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px",
          background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: "4px 6px", margin: "4px 0 6px",
          fontSize: 8.5, border: "1px solid rgba(255,255,255,0.04)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span className="muted">🧭 Macro Compass:</span>
            <span style={{ fontWeight: 700, color: macroCol }}>{dt.macroCompass}</span>
          </div>
          {dt.sessionRoadmap?.h1Zone && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span className="muted">🗺 1H Session:</span>
              <span>{dt.sessionRoadmap.h1Zone} ({dt.sessionRoadmap.h1CoveragePct}%)</span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
            <span className="muted">🎯 15M Gatekeeper:</span>
            {veto ? (
              <span style={{
                color: "var(--orange)", fontWeight: 700, background: "rgba(255,152,0,0.12)",
                padding: "1px 4px", borderRadius: 3, border: "1px solid rgba(255,152,0,0.3)"
              }}>
                🚫 VETO ({dt.ltfGatekeeper?.triggerStatus?.replace(/_/g, " ")})
              </span>
            ) : (
              <span style={{
                color: "var(--green)", fontWeight: 700, background: "rgba(38,166,154,0.12)",
                padding: "1px 4px", borderRadius: 3, border: "1px solid rgba(38,166,154,0.3)"
              }}>
                ⚡ APPROVED
              </span>
            )}
          </div>
        </div>
      )}

      <div style={{ fontSize: 10, lineHeight: 1.4, opacity: 0.9, marginBottom: 5 }}>
        {brain.narrative}
      </div>

      {brain.warning && (
        <div style={{ fontSize: 9.5, color: "var(--orange)", display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
          <span>⚠</span> <span>{brain.warning}</span>
        </div>
      )}

      {brain.targetDOL && (
        <div style={{ fontSize: 9, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
          <span className="muted">Draw On Liquidity (DOL):</span>
          <span style={{ fontWeight: 600, color: "var(--accent)" }}>
            {brain.targetDOL.name} ({brain.targetDOL.targetSide})
          </span>
          {brain.targetDOL.price && (
            <span className="num muted">@{brain.targetDOL.price.toFixed(5)}</span>
          )}
        </div>
      )}
    </div>
  );
}

function DealingRangesView({ ranges }) {
  if (!ranges || !Object.keys(ranges).length) return null;
  const tfs = ["M15", "H1", "H4", "D1"].filter((tf) => ranges[tf]);
  if (!tfs.length) return null;

  return (
    <div style={{ margin: "4px 0 8px" }}>
      <div className="muted" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
        Structural Dealing Ranges (% Covered)
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${tfs.length}, 1fr)`, gap: 6 }}>
        {tfs.map((tf) => {
          const r = ranges[tf];
          const pct = r.coveragePct;
          const zoneColor = r.zone.includes("DISCOUNT") ? "var(--green)" : r.zone.includes("PREMIUM") ? "var(--red)" : "var(--muted)";
          return (
            <div key={tf} style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 5, padding: "4px 6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <span style={{ fontSize: 9, fontWeight: 700 }}>{tf}</span>
                <span className="num" style={{ fontSize: 9, fontWeight: 700, color: zoneColor }}>{pct}%</span>
              </div>
              <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 1.5, overflow: "hidden", marginBottom: 3 }}>
                <div style={{ height: "100%", width: `${pct}%`, background: zoneColor, borderRadius: 1.5 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8 }}>
                <span className="muted">{r.zone.replace(/_/g, " ")}</span>
                <span style={{ color: r.isExhausted ? "var(--orange)" : "var(--muted)" }}>
                  {r.status.replace(/_/g, " ")}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HTFContextView({ htfFvg, htfLiq }) {
  if (!htfFvg && !htfLiq) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, margin: "2px 0 7px" }}>
      {htfFvg?.orderFlowState && (
        <span style={{
          fontSize: 8.5, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
          background: htfFvg.orderFlowState.includes("BULLISH") ? "rgba(38,166,154,0.12)" : htfFvg.orderFlowState.includes("BEARISH") ? "rgba(239,83,80,0.12)" : "var(--panel-2)",
          color: htfFvg.orderFlowState.includes("BULLISH") ? "var(--green)" : htfFvg.orderFlowState.includes("BEARISH") ? "var(--red)" : "var(--muted)",
          border: "1px solid var(--border)",
        }}>
          4H FVG Flow: {htfFvg.orderFlowState.replace(/_/g, " ")}
          {htfFvg.bullishRespectedCount > 0 ? ` (+${htfFvg.bullishRespectedCount} defended)` : ""}
          {htfFvg.bearishRespectedCount > 0 ? ` (-${htfFvg.bearishRespectedCount} defended)` : ""}
        </span>
      )}

      {htfLiq?.activeCycle && (
        <span style={{
          fontSize: 8.5, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
          background: "rgba(41,98,255,0.1)", color: "var(--accent)", border: "1px solid rgba(41,98,255,0.25)",
        }}>
          Cycle: {htfLiq.activeCycle.replace(/_/g, " ")}
        </span>
      )}

      {htfLiq?.sweeps?.slice(0, 1).map((s, idx) => (
        <span key={idx} style={{
          fontSize: 8.5, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
          background: "rgba(255,152,0,0.12)", color: "var(--orange)", border: "1px solid rgba(255,152,0,0.25)",
        }}>
          HTF Raid: {s.name} swept ({s.age * 4}h ago)
        </span>
      ))}
    </div>
  );
}

function SymbolRow({ r, expanded, onToggle, onJump }) {
  const ph = PHASE[r.phase] || PHASE.chop;
  const col = scoreColor(r.score);
  const hasNews = r.news?.length > 0;
  return (
    <div style={{ borderTop: "1px solid var(--border)" }}>
      <div
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", cursor: "pointer" }}
        title="Click for the full breakdown"
      >
        <span
          className="num"
          style={{ fontWeight: 700, fontSize: 12, minWidth: 58 }}
          onClick={(e) => { e.stopPropagation(); onJump?.(r.symbol); }}
          title={`Open ${r.symbol} on the chart`}
        >
          {r.symbol}
        </span>

        <span
          title={r.setup
            ? `${r.setup.pool} swept ${r.setup.sweptAgo} bars ago → ${r.setup.mssTf} MSS ${r.setup.mssAgeMin}m ago · grade ${r.setup.grade}` +
              (r.setup.group && !r.setup.group.confirmed ? `\nHELD — ${r.setup.group.reason}` : r.setup.group?.checked ? "\ngroup aligned ✓" : "")
            : ph.title}
          style={{
            fontSize: 9, fontWeight: 700, color: ph.color, border: `1px solid ${ph.color}`,
            borderRadius: 3, padding: "0 4px",
            opacity: r.setup ? (r.setup.group && !r.setup.group.confirmed ? 0.55 : 1) : 0.85,
            background: r.setup && (!r.setup.group || r.setup.group.confirmed) ? "rgba(255,152,0,.15)" : "transparent",
          }}
        >
          {r.setup ? `⚡${r.setup.group && !r.setup.group.confirmed ? "…" : ""} ${r.setup.dir > 0 ? "↑" : "↓"}` : ph.tag}
        </span>

        {r.executionReadiness && (
          <span
            title={`Market Brain: ${r.brain?.verdict || ""}\nAction: ${r.executionReadiness.action}\n${r.brain?.narrative || ""}`}
            style={{
              fontSize: 8.5, fontWeight: 700,
              padding: "1px 4px", borderRadius: 3,
              background: r.executionReadiness.action === "READY_FOR_LONG"
                ? "rgba(38,166,154,0.18)"
                : r.executionReadiness.action === "READY_FOR_SHORT"
                ? "rgba(239,83,80,0.18)"
                : r.executionReadiness.action === "WAIT_FOR_RETRACEMENT"
                ? "rgba(255,152,0,0.18)"
                : "rgba(255,255,255,0.06)",
              color: r.executionReadiness.action === "READY_FOR_LONG"
                ? "var(--green)"
                : r.executionReadiness.action === "READY_FOR_SHORT"
                ? "var(--red)"
                : r.executionReadiness.action === "WAIT_FOR_RETRACEMENT"
                ? "var(--orange)"
                : "var(--muted)",
              border: `1px solid ${
                r.executionReadiness.action === "READY_FOR_LONG"
                  ? "rgba(38,166,154,0.35)"
                  : r.executionReadiness.action === "READY_FOR_SHORT"
                  ? "rgba(239,83,80,0.35)"
                  : r.executionReadiness.action === "WAIT_FOR_RETRACEMENT"
                  ? "rgba(255,152,0,0.35)"
                  : "var(--border)"
              }`,
            }}
          >
            {r.executionReadiness.action === "READY_FOR_LONG"
              ? "BUY"
              : r.executionReadiness.action === "READY_FOR_SHORT"
              ? "SELL"
              : r.executionReadiness.action === "WAIT_FOR_RETRACEMENT"
              ? "PULLBACK"
              : "WAIT"}
          </span>
        )}

        {hasNews && (
          <span title={r.news.map((e) => `${e.currency} ${e.title} ${e.when === "upcoming" ? `in ${e.inMin}m` : `${e.agoMin}m ago`}`).join("\n")}>
            <AlertTriangle size={11} color="var(--orange)" />
          </span>
        )}

        <CenterBar value={r.score} />

        <span className="num" style={{ fontSize: 12, fontWeight: 700, color: col, minWidth: 32, textAlign: "right" }}>
          {fmtS(r.score)}
        </span>
        <span className="muted num" style={{ fontSize: 9, minWidth: 24, textAlign: "right" }} title="Confidence">
          {r.confidence}%
        </span>
      </div>

      {expanded && (
        <div style={{ padding: "0 12px 10px 18px", fontSize: 10.5 }}>
          {/* Market Brain Synthesis */}
          <BrainCard brain={r.brain} />

          {/* HTF FVG & Liquidity context */}
          <HTFContextView htfFvg={r.htfFvg} htfLiq={r.htfLiquidity} />

          {/* Multi-Timeframe Structural Dealing Ranges */}
          <DealingRangesView ranges={r.ranges} />

          {/* lens vote — every lens model and how much each is trusted now */}
          {r.lenses && (
            <div style={{ margin: "2px 0 7px" }}>
              <div className="muted" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>
                Lens vote · agreement {r.agreement}%{r.stability != null ? ` · stability ${r.stability}%` : ""}
              </div>
              {Object.entries(r.lenses).map(([k, l]) => {
                const label = l.label || k;
                return (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, opacity: l.n ? 0.45 + 0.55 * l.fitness : 0.3 }}>
                    <span className="muted" style={{ fontSize: 9, width: 48 }}>{label}</span>
                    <CenterBar value={l.n ? l.score : 0} height={5} />
                    <span className="num" style={{ fontSize: 9, width: 26, textAlign: "right", color: scoreColor(l.n ? l.score : 0) }}>
                      {l.n ? fmtS(l.score) : "–"}
                    </span>
                    <span className="muted num" style={{ fontSize: 8, width: 30 }} title="Regime fitness — how much this lens is trusted right now">
                      f{l.fitness}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* pillar diagram */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, margin: "2px 0 7px" }}>
            {[["HTF", "htf"], ["Intraday", "intraday"], ["Liquidity", "liquidity"], ["Context", "context"]].map(([label, k]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="muted" style={{ fontSize: 9, width: 48 }}>{label}</span>
                <CenterBar value={r.pillars?.[k] ?? 0} height={5} />
                <span className="num" style={{ fontSize: 9, width: 26, textAlign: "right", color: scoreColor(r.pillars?.[k] ?? 0) }}>
                  {fmtS(r.pillars?.[k] ?? 0)}
                </span>
              </div>
            ))}
          </div>

          {/* group confirmation — correlated partners must agree with the setup */}
          {r.setup?.group?.checked > 0 && (
            <div style={{ margin: "2px 0 7px" }}>
              <div className="muted" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                Group check · {r.setup.group.confirmed ? "aligned ✓" : `held — ${r.setup.group.reason}`}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {r.setup.group.checks.map((c) => (
                  <span
                    key={c.symbol}
                    title={`${c.symbol} (${c.sign > 0 ? "correlated" : "inverse"}) · read: ${c.src}`}
                    style={{
                      fontSize: 9, padding: "1px 6px", borderRadius: 8, fontWeight: 600,
                      border: "1px solid var(--border)",
                      color: c.verdict === "aligned" ? "var(--green)" : c.verdict === "against" ? "var(--red)" : "var(--muted)",
                    }}
                  >
                    {c.symbol} {c.verdict === "aligned" ? "✓" : c.verdict === "against" ? "✗" : "–"}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* per-TF structure line */}
          <div className="muted num" style={{ marginBottom: 5 }}>
            {Object.entries(r.layers).map(([tf, l]) => (
              <span key={tf} style={{ marginRight: 8 }} title={l.note}>
                {tf} <b style={{ color: l.dir > 0 ? "var(--green)" : l.dir < 0 ? "var(--red)" : "var(--muted)" }}>
                  {l.dir > 0 ? "↑" : l.dir < 0 ? "↓" : "–"}
                </b>
              </span>
            ))}
          </div>

          {/* drives */}
          {r.factors.map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 6, padding: "1.5px 0", alignItems: "baseline" }}>
              <span style={{ color: f.dir > 0 ? "var(--green)" : f.dir < 0 ? "var(--red)" : "var(--muted)", width: 10 }}>
                {f.dir > 0 ? "▲" : f.dir < 0 ? "▼" : "•"}
              </span>
              <span>{f.label}</span>
              <span className="muted" style={{ fontSize: 9.5 }}>{f.note}</span>
              {f.lens && (
                <span className="muted" style={{ fontSize: 8, border: "1px solid var(--border)", borderRadius: 3, padding: "0 3px", opacity: 0.7 }}>
                  {f.lens}
                </span>
              )}
              <span className="muted num" style={{ marginLeft: "auto", fontSize: 9.5 }}>w{f.w}</span>
            </div>
          ))}

          {/* dampeners — the "bad" ledger */}
          {r.damps?.map((d, i) => (
            <div key={i} style={{ display: "flex", gap: 6, padding: "1.5px 0", alignItems: "baseline", color: "var(--orange)" }}>
              <span style={{ width: 10 }}>⚠</span>
              <span>{d.label}</span>
              <span className="muted" style={{ fontSize: 9.5 }}>{d.note}</span>
              <span className="num" style={{ marginLeft: "auto", fontSize: 9.5 }}>−{Math.round((1 - d.mult) * 100)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
