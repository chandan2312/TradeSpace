"use client";

import { useState } from "react";
import { Sliders, X, Check, Shield, Layers, Compass, Save, Clock, Target, Zap } from "lucide-react";

export default function ControlConsole({ config, onSaveConfig, onClose }) {
  const [form, setForm] = useState({
    executionMode: config?.executionMode || "paper",
    horizonMode: config?.horizonMode || "adaptive",
    minConviction: config?.minConviction || 70,
    minRunwayPct: config?.minRunwayPct || 25,
    maxConcurrentTrades: config?.maxConcurrentTrades || 3,
    minRR: config?.minRR || 2.2,
    riskPerTradePct: config?.riskPerTradePct || 1.0,
    accountSize: config?.accountSize || 50000,
    maxDailyLossPct: config?.maxDailyLossPct || 3.0,
    breakevenTriggerR: config?.breakevenTriggerR || 1.5,
    trailStopTriggerR: config?.trailStopTriggerR || 2.5,
    avoidExhaustion: config?.avoidExhaustion ?? true,
    requireSmtConfirm: config?.requireSmtConfirm ?? false,
    enforceSymbolSessions: config?.enforceSymbolSessions ?? true,
    sessionAsia: config?.sessionFilters?.asia ?? true,
    sessionLondon: config?.sessionFilters?.london ?? true,
    sessionNewyork: config?.sessionFilters?.newyork ?? true,
    telegram: config?.telegram ?? true,
    models: {
      ict_2022: config?.enabledModels?.ict_2022 ?? true,
      turtle_soup: config?.enabledModels?.turtle_soup ?? true,
      breaker_block: config?.enabledModels?.breaker_block ?? true,
      ote_continuation: config?.enabledModels?.ote_continuation ?? true,
      silver_bullet: config?.enabledModels?.silver_bullet ?? true,
    },
    timeSlots: {
      asian_range: config?.allowedTimeSlots?.asian_range ?? true,
      london_open: config?.allowedTimeSlots?.london_open ?? true,
      london_lunch: config?.allowedTimeSlots?.london_lunch ?? false,
      ny_open: config?.allowedTimeSlots?.ny_open ?? true,
      ny_silver_bullet: config?.allowedTimeSlots?.ny_silver_bullet ?? true,
      london_close: config?.allowedTimeSlots?.london_close ?? true,
      ny_pm: config?.allowedTimeSlots?.ny_pm ?? true,
      dead_zone: config?.allowedTimeSlots?.dead_zone ?? false,
    },
  });

  const handleChange = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));
  const handleModelToggle = (modelId) => {
    setForm((prev) => ({
      ...prev,
      models: { ...prev.models, [modelId]: !prev.models[modelId] },
    }));
  };
  const handleSlotToggle = (slotId) => {
    setForm((prev) => ({
      ...prev,
      timeSlots: { ...prev.timeSlots, [slotId]: !prev.timeSlots[slotId] },
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSaveConfig({
      ...form,
      enforceSymbolSessions: form.enforceSymbolSessions,
      enabledModels: form.models,
      allowedTimeSlots: form.timeSlots,
      sessionFilters: {
        asia: form.sessionAsia,
        london: form.sessionLondon,
        newyork: form.sessionNewyork,
      },
    });
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 680,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          boxShadow: "0 16px 40px rgba(0, 0, 0, 0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border)",
            paddingBottom: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Sliders size={18} style={{ color: "var(--accent)" }} />
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
              Autonomous Brain Trader Configuration
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Watchlist Scope Notice */}
        <div
          style={{
            background: "rgba(16, 185, 129, 0.08)",
            border: "1px solid rgba(16, 185, 129, 0.25)",
            borderRadius: 8,
            padding: "8px 12px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 11,
            color: "#d1fae5",
          }}
        >
          <Shield size={16} style={{ color: "#10b981", flexShrink: 0 }} />
          <div>
            <strong style={{ color: "#10b981" }}>Strict Execution Guard Active:</strong> Order staging and execution are strictly restricted to symbols in your <strong>Main Watchlist</strong>. The broader market universe is utilized for currency correlation, SMT divergence, and regime context.
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Section 1: Execution Mode & Horizon */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase" }}>
              1. Operational Horizon & Execution Mode
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {/* Execution Mode */}
              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Execution Mode
                </label>
                <select
                  value={form.executionMode}
                  onChange={(e) => handleChange("executionMode", e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 6,
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--border)",
                    color: "var(--fg)",
                    fontSize: 12,
                  }}
                >
                  <option value="paper">Paper Trading (Safe Simulation)</option>
                  <option value="copilot">Copilot (1-Click Approval Card)</option>
                  <option value="auto">Full Auto (Autonomous Orders)</option>
                </select>
              </div>

              {/* Horizon Mode */}
              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Horizon Mode
                </label>
                <select
                  value={form.horizonMode}
                  onChange={(e) => handleChange("horizonMode", e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 6,
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--border)",
                    color: "var(--fg)",
                    fontSize: 12,
                  }}
                >
                  <option value="adaptive">Adaptive (Brain Auto-Selects)</option>
                  <option value="intraday">Intraday Focus (15M-1M)</option>
                  <option value="swing">Swing Focus (4H-1D)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: Quality & Qualification Thresholds */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase" }}>
              2. Opportunity Qualification Thresholds
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Min Brain Conviction: {form.minConviction}%
                </label>
                <input
                  type="range"
                  min={50}
                  max={90}
                  step={5}
                  value={form.minConviction}
                  onChange={(e) => handleChange("minConviction", Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Min Range Runway: {form.minRunwayPct}%
                </label>
                <input
                  type="range"
                  min={15}
                  max={50}
                  step={5}
                  value={form.minRunwayPct}
                  onChange={(e) => handleChange("minRunwayPct", Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Min Risk:Reward: {form.minRR}R
                </label>
                <input
                  type="range"
                  min={1.5}
                  max={4.0}
                  step={0.1}
                  value={form.minRR}
                  onChange={(e) => handleChange("minRR", Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>
            </div>
          </div>

          {/* Section 3: Risk Guardrails & Circuit Breakers */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase" }}>
              3. Risk Guardrails & Trade Management
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Account Size ($)
                </label>
                <input
                  type="number"
                  value={form.accountSize}
                  onChange={(e) => handleChange("accountSize", Number(e.target.value))}
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    borderRadius: 6,
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--border)",
                    color: "var(--fg)",
                    fontSize: 12,
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Risk Per Trade (%)
                </label>
                <input
                  type="number"
                  step={0.25}
                  value={form.riskPerTradePct}
                  onChange={(e) => handleChange("riskPerTradePct", Number(e.target.value))}
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    borderRadius: 6,
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--border)",
                    color: "var(--fg)",
                    fontSize: 12,
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Breakeven Arm (R)
                </label>
                <input
                  type="number"
                  step={0.5}
                  value={form.breakevenTriggerR}
                  onChange={(e) => handleChange("breakevenTriggerR", Number(e.target.value))}
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    borderRadius: 6,
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--border)",
                    color: "var(--fg)",
                    fontSize: 12,
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Max Positions
                </label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={form.maxConcurrentTrades}
                  onChange={(e) => handleChange("maxConcurrentTrades", Number(e.target.value))}
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    borderRadius: 6,
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--border)",
                    color: "var(--fg)",
                    fontSize: 12,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Section 4: 5 Institutional Entry Models */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase" }}>
              <Target size={14} style={{ color: "var(--accent)" }} /> 4. Institutional Entry Models (Dynamic Selection)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
              {[
                {
                  id: "ict_2022",
                  name: "ICT 2022 Mentorship Model",
                  badge: "2022 Mentorship",
                  color: "#38bdf8",
                  desc: "Liquidity Sweep + Market Structure Shift (MSS) + Displacement FVG CE Retracement.",
                },
                {
                  id: "turtle_soup",
                  name: "Turtle Soup Liquidity Raid",
                  badge: "Turtle Soup",
                  color: "#f59e0b",
                  desc: "External Range Liquidity Raid (PDH/PDL/Session Extreme) + Immediate Wick Rejection & Fast Reclamation.",
                },
                {
                  id: "breaker_block",
                  name: "Breaker Block & Mitigation Retest",
                  badge: "Breaker Block",
                  color: "#a855f7",
                  desc: "Failed Order Block Flip — Displacement breaches prior high/low order block; retest offers high-probability mitigation.",
                },
                {
                  id: "ote_continuation",
                  name: "OTE Trend Expansion (Optimal Trade Entry)",
                  badge: "OTE Sweetspot",
                  color: "#10b981",
                  desc: "Trend Continuation Retracement into 62% - 79% Fibonacci Golden Pocket with Order Block defense.",
                },
                {
                  id: "silver_bullet",
                  name: "ICT Silver Bullet Window",
                  badge: "Silver Bullet",
                  color: "#ec4899",
                  desc: "Time-Window Algorithmic Delivery (London 11-12, NY AM 17-18, NY PM 22-23 EET) with clean FVG retest.",
                },
              ].map((m) => (
                <label
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: form.models[m.id] ? "rgba(255, 255, 255, 0.04)" : "rgba(255, 255, 255, 0.01)",
                    border: `1px solid ${form.models[m.id] ? "rgba(255, 255, 255, 0.12)" : "rgba(255, 255, 255, 0.04)"}`,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!form.models[m.id]}
                    onChange={() => handleModelToggle(m.id)}
                    style={{ marginTop: 3 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: form.models[m.id] ? "var(--fg)" : "var(--muted)" }}>
                        {m.name}
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: "1px 5px",
                          borderRadius: 4,
                          background: `${m.color}22`,
                          color: m.color,
                        }}
                      >
                        {m.badge}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{m.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Section 5: Trading Time Slots & Killzones */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase" }}>
              <Clock size={14} style={{ color: "var(--accent)" }} /> 5. Trading Time Slots & Killzones (EET / Broker Server Time)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { id: "asian_range", name: "Asian Range Accumulation", hours: "02:00 - 08:00 EET", badge: "ASIA" },
                { id: "london_open", name: "London Open Killzone (LOKZ)", hours: "10:00 - 13:00 EET", badge: "LOKZ" },
                { id: "london_lunch", name: "London Lunch Lull", hours: "13:00 - 15:00 EET", badge: "LUNCH" },
                { id: "ny_open", name: "New York AM Killzone", hours: "15:00 - 18:00 EET", badge: "NYKZ" },
                { id: "ny_silver_bullet", name: "NY Silver Bullet Window", hours: "17:00 - 18:00 EET", badge: "NYSB" },
                { id: "london_close", name: "London Close Killzone", hours: "18:00 - 20:00 EET", badge: "LCKZ" },
                { id: "ny_pm", name: "New York PM Killzone", hours: "21:00 - 23:00 EET", badge: "NYPM" },
                { id: "dead_zone", name: "Rollover Dead Zone (High Spread)", hours: "00:00 - 02:00 EET", badge: "DEAD" },
              ].map((s) => (
                <label
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 8px",
                    borderRadius: 6,
                    background: form.timeSlots[s.id] ? "rgba(255, 255, 255, 0.04)" : "rgba(255, 255, 255, 0.01)",
                    border: `1px solid ${form.timeSlots[s.id] ? "rgba(255, 255, 255, 0.1)" : "rgba(255, 255, 255, 0.03)"}`,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!form.timeSlots[s.id]}
                    onChange={() => handleSlotToggle(s.id)}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: form.timeSlots[s.id] ? "var(--fg)" : "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.name}
                    </div>
                    <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "monospace" }}>{s.hours}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Section 6: Institutional Symbol Session Gating Matrix */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                <Shield size={14} style={{ color: "#c084fc" }} /> 6. Symbol-Specific Allowed Trading Hours Matrix
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, cursor: "pointer", fontWeight: 600, color: "var(--fg)" }}>
                <input
                  type="checkbox"
                  checked={form.enforceSymbolSessions}
                  onChange={(e) => handleChange("enforceSymbolSessions", e.target.checked)}
                />
                Enforce Symbol Session Rules
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                {
                  label: "US Indices (NAS100, DJ30, SP500)",
                  hours: "15:00 - 23:00 EET",
                  badge: "NY ONLY",
                  badgeColor: "#3b82f6",
                  desc: "Gated during Asian & European morning hours to avoid low-liquidity whipsaws.",
                },
                {
                  label: "European Indices (GER40 / DAX)",
                  hours: "08:00 - 20:00 EET",
                  badge: "LDN ONLY",
                  badgeColor: "#10b981",
                  desc: "Gated outside Frankfurt/London cash hours (08:00-13:00 & 18:00-20:00 EET).",
                },
                {
                  label: "Metals & Crypto (XAUUSD, BTCUSD)",
                  hours: "02:00 - 23:30 EET",
                  badge: "ASIA, LDN & NY",
                  badgeColor: "#eab308",
                  desc: "24-hr global liquidity. Continuous delivery; blocked only in Rollover Dead Zone.",
                },
                {
                  label: "European FX (EURUSD, GBPUSD)",
                  hours: "08:00 - 23:00 EET",
                  badge: "LDN & NY",
                  badgeColor: "#6366f1",
                  desc: "Gated during Asian accumulation (02:00 - 08:00 EET) to prevent tight range chop.",
                },
                {
                  label: "Yen & Pacific FX (USDJPY, AUDUSD)",
                  hours: "02:00 - 08:00 & 15:00 - 23:00 EET",
                  badge: "ASIA & NY",
                  badgeColor: "#ec4899",
                  desc: "Active during Tokyo interbank hours and NY Dollar expansion flows.",
                },
              ].map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: form.enforceSymbolSessions ? "rgba(255, 255, 255, 0.03)" : "rgba(255, 255, 255, 0.01)",
                    border: `1px solid ${form.enforceSymbolSessions ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.03)"}`,
                    opacity: form.enforceSymbolSessions ? 1 : 0.5,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--fg)" }}>
                      {item.label}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "1px 5px",
                        borderRadius: 4,
                        background: `${item.badgeColor}22`,
                        color: item.badgeColor,
                        border: `1px solid ${item.badgeColor}44`,
                      }}
                    >
                      {item.badge}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--accent)", fontFamily: "monospace" }}>
                    {item.hours}
                  </div>
                  <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 2 }}>
                    {item.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 7: Additional Safeguard Toggles */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.avoidExhaustion}
                onChange={(e) => handleChange("avoidExhaustion", e.target.checked)}
              />
              Block Pairs with Range Exhaustion (&ge; 85% or &le; 15%)
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.telegram}
                onChange={(e) => handleChange("telegram", e.target.checked)}
              />
              Send Telegram Notifications on Staged/Filled Setups
            </label>
          </div>

          {/* Save Button */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--muted)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 20px",
                borderRadius: 6,
                background: "var(--accent)",
                border: "none",
                color: "#000",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <Save size={14} /> Save Configuration
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
