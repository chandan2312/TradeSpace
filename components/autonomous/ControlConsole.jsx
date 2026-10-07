"use client";

import { useEffect, useRef, useState } from "react";
import { Sliders, X, Shield, Save } from "lucide-react";

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))", gap: 12 };
const inputStyle = { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "8px 10px", borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--fg)", fontSize: 12 };
const sectionStyle = { borderTop: "1px solid var(--border)", paddingTop: 14 };

function NumberField({ label, name, form, onChange, min, max, step = 1 }) {
  return <label style={{ display: "block", color: "var(--muted)", fontSize: 11 }}>{label}<input type="number" name={name} value={form[name]} onChange={(event) => onChange(name, Number(event.target.value))} min={min} max={max} step={step} required style={{ ...inputStyle, marginTop: 4 }} /></label>;
}

export default function ControlConsole({ config = {}, brokerAccount = null, allTimeSlots = [], allEntryModels = {}, onSaveConfig, onClose }) {
  const brokerEquity = Number(brokerAccount?.equity ?? brokerAccount?.balance);
  const [form, setForm] = useState(() => ({
    executionMode: config.executionMode ?? "paper", liveTrading: config.liveTrading ?? false,
    horizonMode: config.horizonMode ?? "adaptive", minConviction: config.minConviction ?? 60,
    minRunwayPct: config.minRunwayPct ?? 15, confluenceThreshold: config.confluenceThreshold ?? 60,
    maxConcurrentTrades: config.maxConcurrentTrades ?? 10, minRR: config.minRR ?? 1.8,
    riskPerTradePct: config.riskPerTradePct ?? 1,
    enforceDollarRiskCaps: config.enforceDollarRiskCaps ?? false,
    measureRiskInR: config.measureRiskInR ?? true,
    accountSize: brokerEquity > 0 ? brokerEquity : (config.accountSize ?? 25000),
    maxDailyLossPct: config.maxDailyLossPct ?? 10, requireSmtConfirm: config.requireSmtConfirm ?? false,
    enforceSymbolSessions: config.enforceSymbolSessions ?? true, telegram: config.telegram ?? true,
    enabledModels: { ...(config.enabledModels || {}) },
    allowedTimeSlots: { ...(config.allowedTimeSlots || {}), dead_zone: false },
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const dialogRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previousFocus?.focus(); };
  }, [onClose]);
  const change = (name, value) => setForm((previous) => ({ ...previous, [name]: value }));
  const toggleGroup = (group, id) => {
    if (id === "dead_zone") return;
    setForm((previous) => ({ ...previous, [group]: { ...previous[group], [id]: !previous[group][id] } }));
  };
  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSaveConfig({ ...form, allowedTimeSlots: { ...form.allowedTimeSlots, dead_zone: false } });
      onClose();
    } catch (err) { setError(err.message || "Configuration save failed"); }
    finally { setSaving(false); }
  };
  const models = Object.values(allEntryModels || {});
  const slots = Array.isArray(allTimeSlots) ? allTimeSlots : Object.values(allTimeSlots || {});
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: "min(4vw,16px)" }} onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="autonomous-config-title" tabIndex={-1} onClick={(event) => event.stopPropagation()} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, width: "100%", maxWidth: 680, maxHeight: "90dvh", overflowY: "auto", padding: "clamp(10px,3vw,22px)", minWidth: 0, boxSizing: "border-box", overflowWrap: "anywhere" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 14 }}><h2 id="autonomous-config-title" style={{ fontSize: 16, margin: 0 }}><Sliders size={17} style={{ color: "var(--accent)" }} /> Autonomous Configuration</h2><button onClick={onClose} aria-label="Close configuration" style={{ background: "transparent", border: "none", color: "var(--muted)", padding: 4, cursor: "pointer" }}><X size={18} /></button></div>
        <div style={{ background: "rgba(16,185,129,.06)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, fontSize: 11, lineHeight: 1.5, marginBottom: 14 }}>
          <strong style={{ color: "var(--green)" }}><Shield size={13} /> Strict hard vetoes</strong>
          <div>Only Main Watchlist symbols may execute. Macro / direction alignment, eligible unconsumed DOL, valid premium-discount location, displacement and complete model evidence are evaluated before weighted confluence.</div>
          <div>Exhausted range, invalidated PD array, stale setup, closed session and rollover dead zone veto entry. A score or priority whitelist never overrides a veto. Approval revalidates the thesis.</div>
        </div>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section>
            <h3 style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>Execution & horizon</h3>
            <div style={grid}>
              <label style={{ color: "var(--muted)", fontSize: 11 }}>Execution mode<select style={{ ...inputStyle, marginTop: 4 }} value={form.executionMode} onChange={(event) => change("executionMode", event.target.value)}><option value="paper">Paper simulation</option><option value="copilot">Copilot approval</option><option value="auto">Autonomous execution</option></select></label>
              <label style={{ color: "var(--muted)", fontSize: 11 }}>Horizon<select style={{ ...inputStyle, marginTop: 4 }} value={form.horizonMode} onChange={(event) => change("horizonMode", event.target.value)}><option value="adaptive">Adaptive</option><option value="swing">Swing (1D-1H)</option><option value="day">Day Trade (4H-15M)</option><option value="scalp">Scalp (15M-1M)</option></select></label>
            </div>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, paddingTop: 12, fontSize: 12 }}><input type="checkbox" checked={form.liveTrading} onChange={(event) => change("liveTrading", event.target.checked)} style={{ marginTop: 3 }} /><div><strong>Direct MT5 broker execution</strong><div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>Submits planned limit orders through the configured bridge. Fills, partial exits, stop updates and closes remain requested until confirmed; ambiguous responses await reconciliation.</div></div></label>
          </section>
          <section style={sectionStyle}>
            <h3 style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>Qualification thresholds</h3>
            <div style={grid}>
              <NumberField label="Min conviction (%)" name="minConviction" form={form} onChange={change} min={30} max={95} />
              <NumberField label="Min range runway (%)" name="minRunwayPct" form={form} onChange={change} min={0} max={100} />
              <NumberField label="Min risk:reward (R)" name="minRR" form={form} onChange={change} min={1} step={0.1} />
              <NumberField label="Min confluence (of 100)" name="confluenceThreshold" form={form} onChange={change} min={0} max={100} />
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 8 }}>DOL 25 · Premium/discount 20 · Displacement 20 · Killzone 15 · SMT 10 · HTF PD array 10</div>
            <label style={{ display: "flex", gap: 7, fontSize: 11, marginTop: 8 }}><input type="checkbox" checked={form.requireSmtConfirm} onChange={(event) => change("requireSmtConfirm", event.target.checked)} /> Require SMT confirmation</label>
          </section>
          <section style={sectionStyle}>
            <h3 style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>Risk & Dual Trade Management Models</h3>
            <div style={grid}>
              <div>
                <NumberField label="Account size ($)" name="accountSize" form={form} onChange={change} min={1} />
                {brokerEquity > 0 && (
                  <button
                    type="button"
                    onClick={() => change("accountSize", brokerEquity)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--green)",
                      fontSize: 10,
                      cursor: "pointer",
                      padding: 0,
                      marginTop: 4,
                      textAlign: "left",
                      display: "block",
                    }}
                  >
                    Sync to MT5 equity (${brokerEquity.toLocaleString()})
                  </button>
                )}
              </div>
              <NumberField label="Risk per trade (%)" name="riskPerTradePct" form={form} onChange={change} min={0.01} step={0.25} />
              <NumberField label="Max concurrent trades" name="maxConcurrentTrades" form={form} onChange={change} min={1} max={50} />
              <NumberField label="Max daily loss (%)" name="maxDailyLossPct" form={form} onChange={change} min={0.1} max={50} step={0.25} />
            </div>
            <label style={{ display: "flex", gap: 7, fontSize: 11, marginTop: 10, alignItems: "center", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!form.enforceDollarRiskCaps}
                onChange={(e) => change("enforceDollarRiskCaps", !e.target.checked)}
              />
              <span><strong>Pure R-Measurement Mode (Demo Master Sender)</strong> — Bypass dollar risk caps &amp; dollar drawdown limits</span>
            </label>
            <div style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 8, marginTop: 10, fontSize: 11, lineHeight: 1.5 }}>
              <strong style={{ color: "var(--accent)" }}>Dual Execution Architecture (Default + Prop-Firm Safe)</strong>
              <div style={{ marginTop: 4 }}>• <strong>Default Leg (MG1)</strong>: At 50% TP distance, books 40% lot size & moves SL to breakeven; 60% runner continues to full TP. (Swing setups exempt from 5R clamp).</div>
              <div style={{ marginTop: 2 }}>• <strong>Prop-Firm Safe (MG2)</strong>: Short 1.5R–2.5R TP bracket. 1.0R halves risk (-0.5R); 1.5R moves SL to breakeven (full exit if TP is 1.5R); full exit at TP.</div>
              <div style={{ color: "var(--muted)", marginTop: 4, fontSize: 10 }}>Every qualified setup executes both legs simultaneously on MT5 with institutional magic numbers and comments.</div>
            </div>
          </section>
          <section style={sectionStyle}>
            <h3 style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>Institutional entry models</h3>
            {models.length === 0 && <div style={{ fontSize: 11, color: "var(--muted)" }}>Model definitions unavailable</div>}
            {models.map((model) => <label key={model.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, border: "1px solid var(--border)", borderRadius: 8, padding: 9, marginBottom: 6 }}><input type="checkbox" checked={!!form.enabledModels[model.id]} onChange={() => toggleGroup("enabledModels", model.id)} style={{ marginTop: 3 }} /><div style={{ minWidth: 0 }}><strong style={{ fontSize: 12 }}>{model.name}</strong><div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>{model.description || "Model description unavailable"}</div></div></label>)}
          </section>
          <section style={sectionStyle}>
            <h3 style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>Time slots · Europe/Athens (EET/EEST)</h3>
            <div style={grid}>{slots.map((slot) => <label key={slot.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: 8, borderRadius: 6, border: "1px solid var(--border)" }}><input type="checkbox" disabled={slot.id === "dead_zone" || slot.isDeadZone} checked={slot.id === "dead_zone" ? false : !!form.allowedTimeSlots[slot.id]} onChange={() => toggleGroup("allowedTimeSlots", slot.id)} style={{ marginTop: 3 }} /><div style={{ minWidth: 0, fontSize: 11 }}><strong>{slot.name}</strong><div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>{slot.eetRange || "Hours unavailable"}</div>{slot.id === "dead_zone" && <div style={{ color: "var(--red)", fontSize: 10 }}>Hard veto · cannot be enabled</div>}</div></label>)}</div>
            <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 10 }}>Silver Bullet uses its exact half-open hour window; toggling another session cannot extend it.</div>
            <label style={{ display: "flex", gap: 7, fontSize: 11, marginTop: 8 }}><input type="checkbox" checked={form.enforceSymbolSessions} onChange={(event) => change("enforceSymbolSessions", event.target.checked)} /> Enforce additional symbol-specific session rules</label>
          </section>
          <label style={{ display: "flex", gap: 7, fontSize: 11 }}><input type="checkbox" checked={form.telegram} onChange={(event) => change("telegram", event.target.checked)} /> Telegram execution notifications</label>
          {error && <div role="alert" style={{ fontSize: 11, color: "var(--red)" }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}><button type="button" onClick={onClose} style={{ ...inputStyle, width: "auto", cursor: "pointer" }}>Cancel</button><button type="submit" disabled={saving} style={{ ...inputStyle, width: "auto", color: "var(--bg)", background: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 6, cursor: saving ? "wait" : "pointer" }}><Save size={13} /> {saving ? "Saving…" : "Save configuration"}</button></div>
        </form>
      </div>
    </div>
  );
}
