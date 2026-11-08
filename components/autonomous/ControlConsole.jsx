"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
  Sliders,
  X,
  Shield,
  Save,
  Clock,
  Check,
  RotateCcw,
  Search,
  Layers,
  Wand2,
  Target,
  Plus,
  Trash2,
  Activity,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import BrokerSymbolMapping from "../BrokerSymbolMapping";

const grid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))",
  gap: 12,
};

const inputStyle = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  padding: "8px 10px",
  borderRadius: 6,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  color: "var(--fg)",
  fontSize: 12,
};

const sectionStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

export const DEFAULT_SLOT_TIMINGS = {
  asian_range: { start: "02:00", end: "06:00" },
  pre_london_prep: { start: "08:00", end: "10:00" },
  london_open: { start: "10:00", end: "13:00" },
  london_lunch: { start: "13:00", end: "15:00" },
  pre_ny_prep: { start: "15:00", end: "16:25" },
  ny_open: { start: "16:25", end: "20:30" },
  ny_silver_bullet: { start: "17:00", end: "18:00" },
  london_close: { start: "18:00", end: "20:30" },
  ny_pm: { start: "21:00", end: "23:00" },
};

export const CONFIGURABLE_SLOTS = [
  { id: "asian_range", name: "Asian Range Accumulation", defaultRange: "02:00 - 06:00 EET", short: "Asian Range", badge: "ASIA", phase: "ACCUMULATION" },
  { id: "pre_london_prep", name: "Pre-London Session Setup", defaultRange: "08:00 - 10:00 EET", short: "Pre-London", badge: "PRE-LDN", phase: "PREP" },
  { id: "london_open", name: "London Open Killzone (LOKZ)", defaultRange: "10:00 - 13:00 EET", short: "London Open (LOKZ)", badge: "LOKZ", phase: "KILLZONE" },
  { id: "london_lunch", name: "London Lunch Lull", defaultRange: "13:00 - 15:00 EET", short: "London Lunch", badge: "LUNCH", phase: "CONSOLIDATION" },
  { id: "pre_ny_prep", name: "Pre-New York Session Setup", defaultRange: "15:00 - 16:25 EET", short: "Pre-New York", badge: "PRE-NY", phase: "PREP" },
  { id: "ny_open", name: "New York Session / AM Killzone (NYKZ)", defaultRange: "16:25 - 20:30 EET", short: "New York AM (NYKZ)", badge: "NYKZ", phase: "KILLZONE" },
  { id: "ny_silver_bullet", name: "New York Silver Bullet Window (NYSB)", defaultRange: "17:00 - 18:00 EET", short: "Silver Bullet (NYSB)", badge: "NYSB", phase: "SILVER_BULLET" },
  { id: "london_close", name: "London Close Killzone (LCKZ)", defaultRange: "18:00 - 20:30 EET", short: "London Close (LCKZ)", badge: "LCKZ", phase: "KILLZONE" },
  { id: "ny_pm", name: "New York PM Killzone (NYPM)", defaultRange: "21:00 - 23:00 EET", short: "New York PM (NYPM)", badge: "NYPM", phase: "KILLZONE" },
];

export const DEFAULT_MODEL_THRESHOLDS = {
  ict_2022: { minConviction: 70, minConfluence: 70, minRR: 1.8, requireSmt: false },
  turtle_soup: { minConviction: 58, minConfluence: 70, minRR: 2.2, requireSmt: false },
  breaker_block: { minConviction: 65, minConfluence: 70, minRR: 1.8, requireSmt: false },
  ote_continuation: { minConviction: 75, minConfluence: 65, minRR: 2.0, requireSmt: false },
  silver_bullet: { minConviction: 62, minConfluence: 65, minRR: 1.5, requireSmt: false },
  displacement_breakout: { minConviction: 78, minConfluence: 70, minRR: 2.0, requireSmt: false },
  judas_swing: { minConviction: 60, minConfluence: 65, minRR: 2.0, requireSmt: false },
  smt_divergence_sweep: { minConviction: 60, minConfluence: 70, minRR: 2.0, requireSmt: true },
  fvg_rejection: { minConviction: 65, minConfluence: 65, minRR: 2.0, requireSmt: false },
  po3_daily_cycle: { minConviction: 60, minConfluence: 65, minRR: 2.0, requireSmt: false },
};

export const FALLBACK_ENTRY_MODELS = [
  { id: "ict_2022", name: "ICT 2022 Mentorship Model", badge: "2022 Mentorship", description: "Sweep → displaced MSS → associated eligible virgin FVG → CE limit." },
  { id: "turtle_soup", name: "Turtle Soup Liquidity Raid", badge: "Turtle Soup", description: "Major external raid of 3–15 symbol units → rejection → reclaim within two bars." },
  { id: "breaker_block", name: "Breaker Block & Mitigation Retest", badge: "Breaker Block", description: "Failed opposing OB → raid/displaced structure failure → retest of the breaker." },
  { id: "ote_continuation", name: "OTE Trend Expansion", badge: "OTE Sweetspot", description: "Aligned impulse → .618–.786 retracement with an embedded valid FVG/OB." },
  { id: "silver_bullet", name: "ICT Silver Bullet Window", badge: "Silver Bullet", description: "London 10–11 or NY 17–18 EET only; in-window displacement and opposing unconsumed session target." },
  { id: "displacement_breakout", name: "Displacement Momentum Breakout", badge: "Momentum Breakout", description: "Violent institutional expansion beyond swing/range without pullback → momentum continuation entry with stop at candle origin/extreme." },
  { id: "judas_swing", name: "London Judas Swing Reversal", badge: "Judas Swing", description: "London Open (07:00-09:30 UTC) false raid of Asian Range or PDH/PDL with 15M displacement MSS reversal back into HTF trend." },
  { id: "smt_divergence_sweep", name: "SMT Intermarket Sweep", badge: "SMT Divergence", description: "Liquidity extreme raid accompanied by contemporaneous non-confirmation divergence from correlated benchmark partner." },
  { id: "fvg_rejection", name: "Virgin FVG Volume Imbalance Rejection", badge: "FVG Rejection", description: "Runaway trend momentum impulse with immediate 50% CE tap of a fresh virgin displacement FVG." },
  { id: "po3_daily_cycle", name: "Power of 3 Daily Cycle", badge: "PO3 Cycle", description: "NY Midnight / Daily Open manipulation into discount/premium followed by 15M displacement reclaim." },
];

const TABS = [
  { id: "execution", label: "Mode & Execution", icon: Sliders },
  { id: "risk", label: "Risk & Capital", icon: Shield },
  { id: "models", label: "Entry Models", icon: Target },
  { id: "sessions", label: "Session Hours", icon: Clock },
  { id: "matrix", label: "Symbol Matrix", icon: Layers },
  { id: "broker", label: "Broker Mapping", icon: Wand2 },
];

function NumberField({ label, name, form, onChange, min, max, step = "any" }) {
  return (
    <label style={{ display: "block", color: "var(--muted)", fontSize: 11 }}>
      {label}
      <input
        type="number"
        name={name}
        value={form[name] ?? ""}
        onChange={(event) => {
          const val = event.target.value;
          onChange(name, val === "" ? "" : Number(val));
        }}
        min={min}
        max={max}
        step={step}
        style={{ ...inputStyle, marginTop: 4 }}
      />
    </label>
  );
}

export default function ControlConsole({
  config = {},
  brokerAccount = null,
  allTimeSlots = [],
  allSymbolProfiles = {},
  allEntryModels = {},
  universe = [],
  onSaveConfig,
  onClose,
}) {
  const brokerEquity = Number(brokerAccount?.equity ?? brokerAccount?.balance);

  const [activeTab, setActiveTab] = useState("execution");
  const [newSymbolInput, setNewSymbolInput] = useState("");
  const [customAddedSymbols, setCustomAddedSymbols] = useState([]);
  const [customSymbolError, setCustomSymbolError] = useState("");

  const [form, setForm] = useState(() => ({
    executionMode: config.executionMode ?? "paper",
    liveTrading: config.liveTrading ?? false,
    horizonMode: config.horizonMode ?? "adaptive",
    enableScalpHorizon: config.enableScalpHorizon ?? config.enabledHorizons?.scalp ?? false,
    enabledHorizons: {
      swing: true,
      day: true,
      scalp: false,
      ...(config.enabledHorizons || {}),
      ...(config.enableScalpHorizon !== undefined ? { scalp: config.enableScalpHorizon } : {}),
    },
    minConviction: config.minConviction ?? 60,
    minRunwayPct: config.minRunwayPct ?? 15,
    confluenceThreshold: config.confluenceThreshold ?? 60,
    maxConcurrentTrades: config.maxConcurrentTrades ?? 10,
    minRR: config.minRR ?? 1.8,
    propFirmMinRR: config.propFirmMinRR ?? 1.5,
    riskPerTradePct: config.riskPerTradePct ?? 1,
    enforceDollarRiskCaps: config.enforceDollarRiskCaps ?? false,
    measureRiskInR: config.measureRiskInR ?? true,
    accountSize: brokerEquity > 0 ? brokerEquity : (config.accountSize ?? 25000),
    maxDailyLossPct: config.maxDailyLossPct ?? 10,
    pendingExpiryMinutes: config.pendingExpiryMinutes ?? 180,
    maxPendingRunawayR: config.maxPendingRunawayR ?? 2.0,
    scalpPendingExpiryMinutes: config.scalpPendingExpiryMinutes ?? 60,
    cancelledDedupWindowMinutes: config.cancelledDedupWindowMinutes ?? 120,
    requireSmtConfirm: config.requireSmtConfirm ?? false,
    enforceSymbolSessions: config.enforceSymbolSessions ?? true,
    telegram: config.telegram ?? true,
    enabledModels: { ...(config.enabledModels || {}) },
    modelThresholds: (() => {
      const merged = {};
      for (const [id, def] of Object.entries(DEFAULT_MODEL_THRESHOLDS)) {
        merged[id] = {
          ...def,
          ...(config.modelThresholds?.[id] || {}),
        };
      }
      if (config.modelThresholds) {
        for (const [id, custom] of Object.entries(config.modelThresholds)) {
          if (!merged[id]) merged[id] = { ...custom };
        }
      }
      return merged;
    })(),
    allowedTimeSlots: { ...(config.allowedTimeSlots || {}), dead_zone: false },
    symbolTimeSlots: (() => {
      const raw = { ...(config.symbolTimeSlots || {}) };
      if (raw.US30 && !raw.DJ30) raw.DJ30 = raw.US30;
      delete raw.US30;
      return raw;
    })(),
    sessionFilters: {
      asia: true,
      london: true,
      newyork: true,
      ...(config.sessionFilters || {}),
    },
    sessionTimings: {
      asia: { start: "02:00", end: "06:00" },
      london: { start: "10:00", end: "18:00" },
      newyork: { start: "16:25", end: "20:30" },
      ...(config.sessionTimings || {}),
    },
    slotCustomTimings: (() => {
      const merged = {
        ...DEFAULT_SLOT_TIMINGS,
        ...(config.slotCustomTimings || {}),
      };
      if (merged.london_lunch?.start === "15:00" && merged.london_lunch?.end === "16:25") {
        merged.london_lunch = { start: "13:00", end: "15:00" };
      }
      return merged;
    })(),
  }));

  const [symbolSearch, setSymbolSearch] = useState("");
  const [showBrokerMapping, setShowBrokerMapping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [onClose]);

  const change = (name, value) => setForm((previous) => ({ ...previous, [name]: value }));

  const toggleGroup = (group, id) => {
    if (id === "dead_zone") return;
    setForm((previous) => ({
      ...previous,
      [group]: { ...previous[group], [id]: !previous[group][id] },
    }));
  };

  const updateModelThreshold = (modelId, field, val) => {
    setForm((prev) => {
      const current = prev.modelThresholds?.[modelId] || DEFAULT_MODEL_THRESHOLDS[modelId] || {
        minConviction: 60,
        minConfluence: 60,
        minRR: 1.8,
        requireSmt: false,
      };
      return {
        ...prev,
        modelThresholds: {
          ...(prev.modelThresholds || {}),
          [modelId]: {
            ...current,
            [field]: val,
          },
        },
      };
    });
  };

  const resetModelThreshold = (modelId) => {
    const def = DEFAULT_MODEL_THRESHOLDS[modelId];
    if (!def) return;
    setForm((prev) => ({
      ...prev,
      modelThresholds: {
        ...(prev.modelThresholds || {}),
        [modelId]: { ...def },
      },
    }));
  };

  const resetAllModelThresholds = () => {
    setForm((prev) => ({
      ...prev,
      modelThresholds: { ...DEFAULT_MODEL_THRESHOLDS },
    }));
  };

  const updateSlotTiming = (slotId, field, val) => {
    setForm((prev) => {
      const current = prev.slotCustomTimings?.[slotId] || DEFAULT_SLOT_TIMINGS[slotId] || { start: "00:00", end: "00:00" };
      const updated = { ...current, [field]: val };
      const nextSlots = { ...(prev.slotCustomTimings || {}), [slotId]: updated };
      const nextSessions = { ...(prev.sessionTimings || {}) };
      if (slotId === "asian_range") nextSessions.asia = { ...updated };
      if (slotId === "ny_open") nextSessions.newyork = { ...updated };
      return { ...prev, slotCustomTimings: nextSlots, sessionTimings: nextSessions };
    });
  };

  const resetSlotTiming = (slotId) => {
    if (!DEFAULT_SLOT_TIMINGS[slotId]) return;
    setForm((prev) => {
      const def = { ...DEFAULT_SLOT_TIMINGS[slotId] };
      const nextSlots = { ...(prev.slotCustomTimings || {}), [slotId]: def };
      const nextSessions = { ...(prev.sessionTimings || {}) };
      if (slotId === "asian_range") nextSessions.asia = { ...def };
      if (slotId === "ny_open") nextSessions.newyork = { ...def };
      return { ...prev, slotCustomTimings: nextSlots, sessionTimings: nextSessions };
    });
  };

  const resetAllSlotTimings = () => {
    setForm((prev) => ({
      ...prev,
      slotCustomTimings: { ...DEFAULT_SLOT_TIMINGS },
      sessionTimings: {
        asia: { start: "02:00", end: "06:00" },
        london: { start: "10:00", end: "18:00" },
        newyork: { start: "16:25", end: "20:30" },
      },
    }));
  };

  // Helper to resolve institutional default slots for a symbol
  const getSymbolDefaultSlots = useMemo(() => {
    return (sym) => {
      const clean = String(sym || "").toUpperCase().replace(/\.I$/, "");
      if (allSymbolProfiles?.[clean]?.allowedSlotIds) {
        return allSymbolProfiles[clean].allowedSlotIds;
      }
      for (const prof of Object.values(allSymbolProfiles || {})) {
        if (prof.symbols?.includes(clean) || prof.symbols?.includes(sym)) {
          return prof.allowedSlotIds || [];
        }
      }
      if (/^(NAS|US|DJ|SP)/i.test(clean)) return ["ny_open", "ny_silver_bullet", "london_close", "ny_pm"];
      if (/^(GER|DAX|DE)/i.test(clean)) return ["pre_london_prep", "london_open", "london_lunch", "ny_open", "ny_silver_bullet", "london_close", "ny_pm"];
      if (/^(BTC|ETH|XAU|GOLD)/i.test(clean)) {
        return ["asian_range", "pre_london_prep", "london_open", "ny_open", "ny_silver_bullet", "london_close", "ny_pm"];
      }
      return ["pre_london_prep", "london_open", "ny_open", "ny_silver_bullet", "london_close", "ny_pm"];
    };
  }, [allSymbolProfiles]);

  // Helper to resolve symbol category label and color
  const getSymbolMeta = useMemo(() => {
    return (sym) => {
      const clean = String(sym || "").toUpperCase().replace(/\.I$/, "");
      if (allSymbolProfiles?.[clean]) return allSymbolProfiles[clean];
      for (const prof of Object.values(allSymbolProfiles || {})) {
        if (prof.symbols?.includes(clean) || prof.symbols?.includes(sym)) return prof;
      }
      if (/^(NAS|US|DJ|SP)/i.test(clean)) return { category: "US Indices", badgeColor: "#3b82f6" };
      if (/^(GER|DAX|DE)/i.test(clean)) return { category: "EU Indices (London & NY)", badgeColor: "#10b981" };
      if (/^(BTC|ETH|XAU|GOLD|XAG)/i.test(clean)) return { category: "Metals & Crypto", badgeColor: "#eab308" };
      return { category: "Forex Major", badgeColor: "#6366f1" };
    };
  }, [allSymbolProfiles]);

  // Universe list of symbols for the matrix
  const matrixSymbols = useMemo(() => {
    const raw = [
      ...(universe || []),
      ...(config.universe || []),
      ...Object.keys(form.symbolTimeSlots || {}),
      ...Object.keys(allSymbolProfiles || {}),
      ...customAddedSymbols,
      "NAS100", "DJ30", "SP500", "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD", "GER40", "XAUUSD", "BTCUSD", "ETHUSD",
    ];
    const normalized = raw
      .filter(Boolean)
      .map((s) => (String(s).toUpperCase().trim() === "US30" ? "DJ30" : String(s).toUpperCase().trim()));
    const list = Array.from(new Set(normalized));

    if (!symbolSearch.trim()) return list;
    const q = symbolSearch.trim().toLowerCase();
    return list.filter((s) => s.toLowerCase().includes(q));
  }, [universe, config.universe, form.symbolTimeSlots, allSymbolProfiles, customAddedSymbols, symbolSearch]);

  const handleAddCustomSymbol = (e) => {
    if (e) e.preventDefault();
    setCustomSymbolError("");
    const rawSym = newSymbolInput.trim().toUpperCase().replace(/\.I$/, "");
    if (!rawSym) return;
    const sym = rawSym === "US30" ? "DJ30" : rawSym;

    if (matrixSymbols.includes(sym)) {
      setCustomSymbolError(`Symbol ${sym} is already in the matrix list.`);
      return;
    }

    setCustomAddedSymbols((prev) => Array.from(new Set([...prev, sym])));
    const defaultSlots = getSymbolDefaultSlots(sym);

    setForm((prev) => ({
      ...prev,
      symbolTimeSlots: {
        ...(prev.symbolTimeSlots || {}),
        [sym]: defaultSlots,
        ...(sym === "DJ30" ? { US30: defaultSlots } : {}),
      },
    }));

    setNewSymbolInput("");
    setSymbolSearch(sym);
  };

  const handleRemoveCustomSymbol = (sym) => {
    setCustomAddedSymbols((prev) => prev.filter((s) => s !== sym));
    setForm((prev) => {
      const nextSlots = { ...(prev.symbolTimeSlots || {}) };
      delete nextSlots[sym];
      if (sym === "DJ30") delete nextSlots.US30;
      return {
        ...prev,
        symbolTimeSlots: nextSlots,
      };
    });
  };

  // Current active slots for a symbol
  const getActiveSlotsForSymbol = (sym) => {
    if (form.symbolTimeSlots?.[sym] && Array.isArray(form.symbolTimeSlots[sym])) {
      return form.symbolTimeSlots[sym];
    }
    if (sym === "DJ30" && form.symbolTimeSlots?.US30 && Array.isArray(form.symbolTimeSlots.US30)) {
      return form.symbolTimeSlots.US30;
    }
    return getSymbolDefaultSlots(sym);
  };

  // Toggle single slot for a symbol
  const toggleSymbolSlot = (sym, slotId) => {
    const current = getActiveSlotsForSymbol(sym);
    const next = current.includes(slotId)
      ? current.filter((id) => id !== slotId)
      : [...current, slotId];

    setForm((prev) => ({
      ...prev,
      symbolTimeSlots: {
        ...(prev.symbolTimeSlots || {}),
        [sym]: next,
        ...(sym === "DJ30" ? { US30: next } : {}),
      },
    }));
  };

  // Preset setter for a symbol
  const applyPresetForSymbol = (sym, presetType) => {
    let next = [];
    if (presetType === "default") {
      next = getSymbolDefaultSlots(sym);
    } else if (presetType === "ny") {
      next = ["pre_ny_prep", "ny_open", "ny_silver_bullet", "london_close", "ny_pm"];
    } else if (presetType === "london") {
      next = ["pre_london_prep", "london_open", "london_lunch", "london_close"];
    } else if (presetType === "all") {
      next = CONFIGURABLE_SLOTS.map((s) => s.id);
    } else if (presetType === "none") {
      next = [];
    }

    setForm((prev) => ({
      ...prev,
      symbolTimeSlots: {
        ...(prev.symbolTimeSlots || {}),
        [sym]: next,
        ...(sym === "DJ30" ? { US30: next } : {}),
      },
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const isScalp = Boolean(form.enabledHorizons?.scalp);
      const cleanedSlots = { ...form.symbolTimeSlots };
      if (cleanedSlots.DJ30) cleanedSlots.US30 = cleanedSlots.DJ30;

      await onSaveConfig({
        ...form,
        enableScalpHorizon: isScalp,
        enabledHorizons: {
          ...form.enabledHorizons,
          scalp: isScalp,
        },
        allowedTimeSlots: { ...form.allowedTimeSlots, dead_zone: false },
        symbolTimeSlots: cleanedSlots,
        modelThresholds: form.modelThresholds,
      });
      onClose();
    } catch (err) {
      setError(err.message || "Configuration save failed");
    } finally {
      setSaving(false);
    }
  };

  const models = useMemo(() => {
    const list = Object.values(allEntryModels || {});
    if (list.length > 0) return list;
    return FALLBACK_ENTRY_MODELS;
  }, [allEntryModels]);

  const slots = useMemo(() => {
    const serverMap = {};
    if (Array.isArray(allTimeSlots)) {
      for (const s of allTimeSlots) {
        if (s?.id) serverMap[s.id] = s;
      }
    }
    const combined = [
      ...CONFIGURABLE_SLOTS,
      { id: "dead_zone", name: "Rollover Dead Zone / Spread Expansion", defaultRange: "00:00 - 02:00 EET", short: "Dead Zone", badge: "DEAD ZONE", phase: "SETTLEMENT", isDeadZone: true },
    ];
    return combined.map((slot) => {
      const serverSlot = serverMap[slot.id] || {};
      const custom = form.slotCustomTimings?.[slot.id];
      const start = custom?.start || DEFAULT_SLOT_TIMINGS[slot.id]?.start;
      const end = custom?.end || DEFAULT_SLOT_TIMINGS[slot.id]?.end;
      const effectiveRange = (start && end) ? `${start} - ${end} EET` : (serverSlot.eetRange || slot.defaultRange || "Hours unavailable");
      return {
        ...serverSlot,
        ...slot,
        effectiveRange,
      };
    });
  }, [allTimeSlots, form.slotCustomTimings]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,.78)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "min(4vw,16px)",
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="autonomous-config-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 820,
          maxHeight: "92dvh",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          boxSizing: "border-box",
          overflow: "hidden",
          boxShadow: "0 24px 48px -12px rgba(0, 0, 0, 0.75)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            background: "var(--panel-2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "rgba(56, 189, 248, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent)",
              }}
            >
              <Sliders size={18} />
            </div>
            <div>
              <h2 id="autonomous-config-title" style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "var(--fg)" }}>
                Autonomous Brain Trader Configuration
              </h2>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                Institutional ICT/SMC Execution Architecture &amp; Calibrated Model Matrix
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close configuration"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              padding: 6,
              borderRadius: 6,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Navigation Bar */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid var(--border)",
            gap: 4,
            padding: "0 16px",
            overflowX: "auto",
            background: "var(--panel)",
            scrollbarWidth: "none",
          }}
        >
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            const Icon = tab.icon;
            const enabledModelCount = tab.id === "models"
              ? Object.values(form.enabledModels || {}).filter(Boolean).length
              : null;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "11px 13px",
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--accent)" : "var(--muted)",
                  borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
                  background: "transparent",
                  borderTop: "none",
                  borderLeft: "none",
                  borderRight: "none",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                }}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
                {enabledModelCount !== null && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: "1px 6px",
                      borderRadius: 10,
                      background: enabledModelCount > 0 ? "rgba(56, 189, 248, 0.15)" : "rgba(239, 68, 68, 0.15)",
                      color: enabledModelCount > 0 ? "var(--accent)" : "var(--red)",
                      fontWeight: 600,
                    }}
                  >
                    {enabledModelCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Scrollable Content Container */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "18px 20px",
            minWidth: 0,
            boxSizing: "border-box",
          }}
        >
          <form noValidate onSubmit={submit} id="autonomous-config-form">
            {/* TAB 1: MODE & EXECUTION */}
            {activeTab === "execution" && (
              <div style={sectionStyle}>
                {/* Institutional Protection Banner */}
                <div
                  style={{
                    background: "rgba(16,185,129,.06)",
                    border: "1px solid rgba(16,185,129,.25)",
                    borderRadius: 8,
                    padding: 12,
                    fontSize: 11,
                    lineHeight: 1.5,
                  }}
                >
                  <strong style={{ color: "var(--green)", display: "flex", alignItems: "center", gap: 6 }}>
                    <Shield size={14} /> Strict Hard Vetoes &amp; Session Alignment
                  </strong>
                  <div style={{ marginTop: 4 }}>
                    Only Main Watchlist symbols may execute. Macro/direction alignment, eligible unconsumed DOL, valid premium-discount location, displacement and complete model evidence are evaluated before weighted confluence.
                  </div>
                  <div style={{ color: "var(--muted)", marginTop: 2 }}>
                    Exhausted range, invalidated PD array, stale setup, closed session and rollover dead zone veto entry. Approval revalidates the thesis.
                  </div>
                </div>

                <div>
                  <h3 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 8px", color: "var(--fg)" }}>
                    Execution Environment
                  </h3>
                  <div style={grid}>
                    <label style={{ color: "var(--muted)", fontSize: 11 }}>
                      Execution mode
                      <select
                        style={{ ...inputStyle, marginTop: 4 }}
                        value={form.executionMode}
                        onChange={(event) => change("executionMode", event.target.value)}
                      >
                        <option value="paper">Paper simulation</option>
                        <option value="copilot">Copilot approval</option>
                        <option value="auto">Autonomous execution</option>
                      </select>
                    </label>
                    <label style={{ color: "var(--muted)", fontSize: 11 }}>
                      Horizon
                      <select
                        style={{ ...inputStyle, marginTop: 4 }}
                        value={form.horizonMode}
                        onChange={(event) => change("horizonMode", event.target.value)}
                      >
                        <option value="adaptive">Adaptive (Active Horizons)</option>
                        <option value="day">Day Trade (4H-15M)</option>
                        <option value="swing">Swing (1D-1H)</option>
                        <option value="scalp">Scalp (30M-5M)</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--fg)", marginBottom: 8 }}>
                    Active Trading Horizons &amp; Multi-Timeframe Alignment
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 220px), 1fr))", gap: 8 }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        border: `1px solid ${form.enabledHorizons?.day !== false ? "rgba(56, 189, 248, 0.3)" : "var(--border)"}`,
                        borderRadius: 8,
                        padding: 10,
                        background: form.enabledHorizons?.day !== false ? "rgba(56, 189, 248, 0.05)" : "var(--panel-2)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={form.enabledHorizons?.day !== false}
                        onChange={() => {
                          const nextVal = !(form.enabledHorizons?.day !== false);
                          setForm((prev) => ({
                            ...prev,
                            enabledHorizons: { ...(prev.enabledHorizons || {}), day: nextVal },
                          }));
                        }}
                        style={{ marginTop: 2 }}
                      />
                      <div style={{ fontSize: 11 }}>
                        <strong style={{ color: form.enabledHorizons?.day !== false ? "var(--fg)" : "var(--muted)" }}>Day Trade (4H-15M)</strong>
                        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                          4H compass · 15M gatekeeper &amp; execution
                        </div>
                      </div>
                    </label>

                    <label
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        border: `1px solid ${form.enabledHorizons?.swing !== false ? "rgba(56, 189, 248, 0.3)" : "var(--border)"}`,
                        borderRadius: 8,
                        padding: 10,
                        background: form.enabledHorizons?.swing !== false ? "rgba(56, 189, 248, 0.05)" : "var(--panel-2)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={form.enabledHorizons?.swing !== false}
                        onChange={() => {
                          const nextVal = !(form.enabledHorizons?.swing !== false);
                          setForm((prev) => ({
                            ...prev,
                            enabledHorizons: { ...(prev.enabledHorizons || {}), swing: nextVal },
                          }));
                        }}
                        style={{ marginTop: 2 }}
                      />
                      <div style={{ fontSize: 11 }}>
                        <strong style={{ color: form.enabledHorizons?.swing !== false ? "var(--fg)" : "var(--muted)" }}>Swing (1D-1H)</strong>
                        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                          1D external DOL · 1H gatekeeper &amp; execution
                        </div>
                      </div>
                    </label>

                    <label
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        border: `1px solid ${Boolean(form.enabledHorizons?.scalp) ? "rgba(56, 189, 248, 0.3)" : "var(--border)"}`,
                        borderRadius: 8,
                        padding: 10,
                        background: Boolean(form.enabledHorizons?.scalp) ? "rgba(56, 189, 248, 0.05)" : "var(--panel-2)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(form.enabledHorizons?.scalp)}
                        onChange={() => {
                          const nextVal = !Boolean(form.enabledHorizons?.scalp);
                          setForm((prev) => ({
                            ...prev,
                            enableScalpHorizon: nextVal,
                            enabledHorizons: {
                              ...(prev.enabledHorizons || {}),
                              scalp: nextVal,
                            },
                          }));
                        }}
                        style={{ marginTop: 2 }}
                      />
                      <div style={{ fontSize: 11 }}>
                        <strong style={{ color: Boolean(form.enabledHorizons?.scalp) ? "var(--fg)" : "var(--muted)" }}>Intraday Scalp (30M-5M)</strong>
                        <div style={{ fontSize: 10, color: Boolean(form.enabledHorizons?.scalp) ? "var(--muted)" : "var(--red)", marginTop: 2 }}>
                          {Boolean(form.enabledHorizons?.scalp)
                            ? "30M compass · 5M precision trigger inside killzones"
                            : "Unticked / Disabled (Blocks 30M-5M scalp setups & noise SLs)"}
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: 12,
                    borderRadius: 8,
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.liveTrading}
                    onChange={(event) => change("liveTrading", event.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  <div>
                    <strong style={{ fontSize: 12, color: "var(--fg)" }}>Direct MT5 Broker Live Execution</strong>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, lineHeight: 1.4 }}>
                      Submits planned limit orders directly through the configured MT5 bridge. Fills, partial exits, stop updates and closes remain requested until confirmed; ambiguous responses await automated reconciliation.
                    </div>
                  </div>
                </label>

                {/* Resting Limit Order Safeguards */}
                <div style={{ padding: 12, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fg)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <Clock size={14} style={{ color: "var(--accent)" }} />
                    Resting Limit Order &amp; Stale Order Safeguards
                  </div>
                  <div style={grid}>
                    <NumberField label="Limit expiry (mins)" name="pendingExpiryMinutes" form={form} onChange={change} min={5} max={1440} step={5} />
                    <NumberField label="Max runaway price (R)" name="maxPendingRunawayR" form={form} onChange={change} min={0.5} max={10} step={0.1} />
                    <NumberField label="Scalp limit expiry (mins)" name="scalpPendingExpiryMinutes" form={form} onChange={change} min={5} max={120} step={5} />
                    <NumberField label="Cancelled cooldown (mins)" name="cancelledDedupWindowMinutes" form={form} onChange={change} min={10} max={1440} step={10} />
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 8, lineHeight: 1.4 }}>
                    Resting limits are protected from churn: price must expand ≥ Max Runaway R past setup origin or complete ≥85% of target move to expire. Cancelled setups enter a cooldown before re-staging.
                  </div>
                </div>

                <label style={{ display: "flex", gap: 8, fontSize: 11, alignItems: "center", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={form.telegram}
                    onChange={(event) => change("telegram", event.target.checked)}
                  />
                  <span>Send real-time Telegram execution notifications &amp; trade lifecycle alerts</span>
                </label>
              </div>
            )}

            {/* TAB 2: RISK & CAPITAL */}
            {activeTab === "risk" && (
              <div style={sectionStyle}>
                <div>
                  <h3 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 10px", color: "var(--fg)" }}>
                    Account Capital &amp; Risk Sizing
                  </h3>
                  <div style={grid}>
                    <div>
                      <NumberField label="Account size ($)" name="accountSize" form={form} onChange={change} min={1} step="any" />
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
                    <NumberField label="Risk per trade (%)" name="riskPerTradePct" form={form} onChange={change} min={0.01} max={10} step="any" />
                    <NumberField label="Max concurrent trades" name="maxConcurrentTrades" form={form} onChange={change} min={1} max={50} step={1} />
                    <NumberField label="Max daily loss (%)" name="maxDailyLossPct" form={form} onChange={change} min={0.01} max={50} step="any" />
                  </div>
                </div>

                <label style={{ display: "flex", gap: 8, fontSize: 11, alignItems: "center", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={!form.enforceDollarRiskCaps}
                    onChange={(e) => change("enforceDollarRiskCaps", !e.target.checked)}
                  />
                  <span>
                    <strong>Pure R-Measurement Mode (Demo Master Sender)</strong> — Bypass dollar risk caps &amp; dollar drawdown limits
                  </span>
                </label>

                {/* Global Setup Qualification Thresholds */}
                <div style={{ padding: 12, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8 }}>
                  <h4 style={{ fontSize: 12, fontWeight: 700, margin: "0 0 8px", color: "var(--fg)" }}>
                    Global Qualification Fallbacks
                  </h4>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 10 }}>
                    These global thresholds apply to any setups where per-model specialized calibration is not defined.
                  </div>
                  <div style={grid}>
                    <NumberField label="Min conviction (%)" name="minConviction" form={form} onChange={change} min={30} max={95} step="any" />
                    <NumberField label="Min range runway (%)" name="minRunwayPct" form={form} onChange={change} min={0} max={100} step="any" />
                    <NumberField label="Min risk:reward (R)" name="minRR" form={form} onChange={change} min={0.1} max={50} step="any" />
                    <NumberField label="Min prop-firm target (R)" name="propFirmMinRR" form={form} onChange={change} min={0.1} max={50} step="any" />
                    <NumberField label="Min confluence (of 100)" name="confluenceThreshold" form={form} onChange={change} min={0} max={100} step="any" />
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 8 }}>
                    Confluence breakdown: DOL 25 · Premium/discount 20 · Displacement 20 · Killzone 15 · SMT 10 · HTF PD array 10
                  </div>
                  <label style={{ display: "flex", gap: 7, fontSize: 11, marginTop: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={form.requireSmtConfirm}
                      onChange={(event) => change("requireSmtConfirm", event.target.checked)}
                    />
                    Require SMT confirmation globally
                  </label>
                </div>

                {/* Dual Execution Architecture Box */}
                <div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 8, background: "rgba(56, 189, 248, 0.03)", fontSize: 11, lineHeight: 1.5 }}>
                  <strong style={{ color: "var(--accent)", display: "flex", alignItems: "center", gap: 6 }}>
                    <Activity size={14} /> Dual Execution Architecture (Default + Prop-Firm Safe)
                  </strong>
                  <div style={{ marginTop: 6 }}>
                    • <strong>Default Leg (MG1)</strong>: At 50% TP distance, books 40% lot size &amp; moves SL to breakeven; 60% runner continues to full TP. (Swing setups exempt from 5R clamp).
                  </div>
                  <div style={{ marginTop: 3 }}>
                    • <strong>Prop-Firm Safe (MG2)</strong>: Short 1.5R–2.5R TP bracket. 1.0R halves risk (-0.5R); 1.5R moves SL to breakeven (full exit if TP is 1.5R); full exit at TP.
                  </div>
                  <div style={{ color: "var(--muted)", marginTop: 5, fontSize: 10 }}>
                    Every qualified setup executes both legs simultaneously on MT5 with institutional magic numbers and comments.
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: ENTRY MODELS & CALIBRATION */}
            {activeTab === "models" && (
              <div style={sectionStyle}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0, color: "var(--fg)", display: "flex", alignItems: "center", gap: 6 }}>
                      <Target size={15} style={{ color: "var(--accent)" }} />
                      Per-Model Specialized Conviction &amp; Confluence Calibration
                    </h3>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      Customize specialized conviction, confluence, and risk:reward requirements per entry model. Different mechanics require tailored statistical thresholds.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={resetAllModelThresholds}
                    style={{
                      ...inputStyle,
                      width: "auto",
                      padding: "4px 8px",
                      fontSize: 10,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      background: "var(--panel-2)",
                    }}
                  >
                    <RotateCcw size={11} /> Reset All Model Calibrations
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {models.map((model) => {
                    const isEnabled = !!form.enabledModels[model.id];
                    const thresholds = form.modelThresholds?.[model.id] || DEFAULT_MODEL_THRESHOLDS[model.id] || {
                      minConviction: 60,
                      minConfluence: 60,
                      minRR: 1.8,
                      requireSmt: false,
                    };
                    const defThresholds = DEFAULT_MODEL_THRESHOLDS[model.id];
                    const isCustomized = defThresholds && (
                      thresholds.minConviction !== defThresholds.minConviction ||
                      thresholds.minConfluence !== defThresholds.minConfluence ||
                      thresholds.minRR !== defThresholds.minRR ||
                      thresholds.requireSmt !== defThresholds.requireSmt
                    );

                    return (
                      <div
                        key={model.id}
                        style={{
                          background: isEnabled ? "rgba(56, 189, 248, 0.04)" : "var(--panel-2)",
                          border: `1px solid ${isEnabled ? "rgba(56, 189, 248, 0.25)" : "var(--border)"}`,
                          borderRadius: 8,
                          padding: 12,
                          transition: "all 0.15s ease",
                        }}
                      >
                        {/* Top row: Checkbox, Name, Badge, Reset */}
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", flex: 1 }}>
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={() => toggleGroup("enabledModels", model.id)}
                              style={{ marginTop: 3 }}
                            />
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <strong style={{ fontSize: 12, color: isEnabled ? "var(--fg)" : "var(--muted)" }}>
                                  {model.name}
                                </strong>
                                {model.badge && (
                                  <span
                                    style={{
                                      fontSize: 9,
                                      fontWeight: 700,
                                      padding: "1px 6px",
                                      borderRadius: 4,
                                      background: isEnabled ? "rgba(56, 189, 248, 0.15)" : "rgba(255,255,255,0.05)",
                                      color: isEnabled ? "var(--accent)" : "var(--muted)",
                                      border: `1px solid ${isEnabled ? "rgba(56, 189, 248, 0.3)" : "var(--border)"}`,
                                    }}
                                  >
                                    {model.badge}
                                  </span>
                                )}
                                {isCustomized && (
                                  <span style={{ fontSize: 9, color: "#f59e0b", fontWeight: 600 }}>
                                    (Customized)
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3, lineHeight: 1.3 }}>
                                {model.description}
                              </div>
                            </div>
                          </label>

                          {isCustomized && (
                            <button
                              type="button"
                              onClick={() => resetModelThreshold(model.id)}
                              title="Reset model calibration to institutional defaults"
                              style={{
                                ...inputStyle,
                                width: "auto",
                                padding: "2px 6px",
                                fontSize: 9,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                                background: "rgba(245, 158, 11, 0.1)",
                                borderColor: "rgba(245, 158, 11, 0.3)",
                                color: "#f59e0b",
                              }}
                            >
                              <RotateCcw size={9} /> Reset
                            </button>
                          )}
                        </div>

                        {/* Per-model Calibration Panel */}
                        {isEnabled && (
                          <div
                            style={{
                              marginTop: 10,
                              paddingTop: 10,
                              borderTop: "1px dashed var(--border)",
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))",
                              gap: 10,
                              alignItems: "flex-end",
                            }}
                          >
                            <label style={{ display: "block", fontSize: 10, color: "var(--muted)" }}>
                              Min Conviction (%)
                              <input
                                type="number"
                                min={30}
                                max={95}
                                step={1}
                                value={thresholds.minConviction ?? 60}
                                onChange={(e) => updateModelThreshold(model.id, "minConviction", Number(e.target.value))}
                                style={{ ...inputStyle, marginTop: 3, padding: "5px 8px", fontSize: 11 }}
                              />
                            </label>

                            <label style={{ display: "block", fontSize: 10, color: "var(--muted)" }}>
                              Min Confluence (of 100)
                              <input
                                type="number"
                                min={30}
                                max={100}
                                step={1}
                                value={thresholds.minConfluence ?? 60}
                                onChange={(e) => updateModelThreshold(model.id, "minConfluence", Number(e.target.value))}
                                style={{ ...inputStyle, marginTop: 3, padding: "5px 8px", fontSize: 11 }}
                              />
                            </label>

                            <label style={{ display: "block", fontSize: 10, color: "var(--muted)" }}>
                              Min Target R:R (R)
                              <input
                                type="number"
                                min={0.5}
                                max={10}
                                step={0.1}
                                value={thresholds.minRR ?? 1.8}
                                onChange={(e) => updateModelThreshold(model.id, "minRR", Number(e.target.value))}
                                style={{ ...inputStyle, marginTop: 3, padding: "5px 8px", fontSize: 11 }}
                              />
                            </label>

                            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, cursor: "pointer", paddingBottom: 6 }}>
                              <input
                                type="checkbox"
                                checked={!!thresholds.requireSmt}
                                onChange={(e) => updateModelThreshold(model.id, "requireSmt", e.target.checked)}
                              />
                              <span style={{ fontSize: 10, color: thresholds.requireSmt ? "var(--accent)" : "var(--muted)" }}>
                                Require SMT Divergence
                              </span>
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB 4: SESSION HOURS (EET) */}
            {activeTab === "sessions" && (
              <div style={sectionStyle}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 6, color: "var(--fg)" }}>
                      <Clock size={15} style={{ color: "var(--accent)" }} />
                      Global Time Slots &amp; Custom Session Hours · Europe/Athens (EET/EEST)
                    </h3>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      Configure start &amp; end hours for each session. The autonomous engine and pair radar dynamically conform to these hours.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={resetAllSlotTimings}
                    title="Reset all session timings to institutional defaults"
                    style={{
                      ...inputStyle,
                      width: "auto",
                      padding: "4px 8px",
                      fontSize: 10,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      background: "var(--panel-2)",
                    }}
                  >
                    <RotateCcw size={11} /> Reset All Hours to Defaults
                  </button>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 330px), 1fr))",
                    gap: 8,
                  }}
                >
                  {slots.map((slot) => {
                    const isDeadZone = slot.id === "dead_zone" || slot.isDeadZone;
                    const isEnabled = !isDeadZone && !!form.allowedTimeSlots[slot.id];
                    const currentTiming = form.slotCustomTimings?.[slot.id] || DEFAULT_SLOT_TIMINGS[slot.id] || { start: "00:00", end: "00:00" };
                    const defaultTiming = DEFAULT_SLOT_TIMINGS[slot.id];
                    const isCustomized = !isDeadZone && defaultTiming && (currentTiming.start !== defaultTiming.start || currentTiming.end !== defaultTiming.end);

                    return (
                      <div
                        key={slot.id}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                          gap: 8,
                          padding: 10,
                          borderRadius: 8,
                          border: `1px solid ${isEnabled ? "rgba(56, 189, 248, 0.3)" : "var(--border)"}`,
                          background: isEnabled ? "rgba(56, 189, 248, 0.08)" : "var(--panel-2)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: isDeadZone ? "not-allowed" : "pointer", flex: 1 }}>
                            <input
                              type="checkbox"
                              disabled={isDeadZone}
                              checked={isDeadZone ? false : isEnabled}
                              onChange={() => toggleGroup("allowedTimeSlots", slot.id)}
                              style={{ marginTop: 2 }}
                            />
                            <div style={{ minWidth: 0, fontSize: 11 }}>
                              <strong style={{ color: isEnabled ? "var(--fg)" : "var(--muted)" }}>{slot.name}</strong>
                              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                                {slot.phase && (
                                  <span
                                    style={{
                                      display: "inline-block",
                                      padding: "1px 4px",
                                      borderRadius: 3,
                                      fontSize: 9,
                                      fontWeight: 600,
                                      background: isDeadZone ? "rgba(239, 68, 68, 0.15)" : "rgba(56, 189, 248, 0.1)",
                                      color: isDeadZone ? "var(--red)" : "var(--accent)",
                                      marginRight: 6,
                                    }}
                                  >
                                    {slot.phase}
                                  </span>
                                )}
                                <span style={{ color: isCustomized ? "#f59e0b" : "var(--muted)" }}>
                                  {slot.effectiveRange} {isCustomized ? "(Custom)" : ""}
                                </span>
                              </div>
                            </div>
                          </label>

                          {isCustomized && (
                            <button
                              type="button"
                              onClick={() => resetSlotTiming(slot.id)}
                              title={`Reset to default (${defaultTiming.start} - ${defaultTiming.end})`}
                              style={{
                                ...inputStyle,
                                width: "auto",
                                padding: "2px 6px",
                                fontSize: 10,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                                background: "rgba(245, 158, 11, 0.15)",
                                borderColor: "rgba(245, 158, 11, 0.3)",
                                color: "#f59e0b",
                              }}
                            >
                              <RotateCcw size={10} /> Reset
                            </button>
                          )}
                        </div>

                        {isDeadZone ? (
                          <div style={{ color: "var(--red)", fontSize: 10, padding: "4px 8px", background: "rgba(239, 68, 68, 0.08)", borderRadius: 4 }}>
                            Hard veto · 23:00 - 01:00 EET · Cannot be enabled or altered
                          </div>
                        ) : (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              paddingTop: 4,
                              borderTop: "1px dashed var(--border)",
                            }}
                          >
                            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--muted)" }}>
                              <span>Start:</span>
                              <input
                                type="time"
                                value={currentTiming.start}
                                onChange={(e) => updateSlotTiming(slot.id, "start", e.target.value)}
                                style={{
                                  ...inputStyle,
                                  width: "82px",
                                  padding: "2px 5px",
                                  fontSize: 11,
                                  color: "var(--fg)",
                                  background: "var(--bg)",
                                }}
                              />
                            </label>
                            <span style={{ color: "var(--muted)", fontSize: 11 }}>→</span>
                            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--muted)" }}>
                              <span>End:</span>
                              <input
                                type="time"
                                value={currentTiming.end}
                                onChange={(e) => updateSlotTiming(slot.id, "end", e.target.value)}
                                style={{
                                  ...inputStyle,
                                  width: "82px",
                                  padding: "2px 5px",
                                  fontSize: 11,
                                  color: "var(--fg)",
                                  background: "var(--bg)",
                                }}
                              />
                            </label>
                            <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: "auto" }}>EET</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ color: "var(--muted)", fontSize: 10 }}>
                  Times are in Europe/Athens (EET/EEST = UTC+2 in winter / UTC+3 in summer). Changes immediately adjust radar scan windows and execution filters when saved.
                </div>
              </div>
            )}

            {/* TAB 5: SYMBOL MATRIX */}
            {activeTab === "matrix" && (
              <div style={sectionStyle}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 6, color: "var(--fg)" }}>
                      <Layers size={15} style={{ color: "var(--accent)" }} />
                      Per-Symbol Trading Slots Matrix
                    </h3>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      Configure which specific time slots are permitted for each instrument. Multiple slots allowed.
                    </div>
                  </div>

                  <label style={{ display: "flex", gap: 6, fontSize: 11, alignItems: "center", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={form.enforceSymbolSessions}
                      onChange={(event) => change("enforceSymbolSessions", event.target.checked)}
                    />
                    <span>Enforce symbol session gating</span>
                  </label>
                </div>

                {/* Quick Add Custom Symbol Bar */}
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    background: "var(--panel-2)",
                    padding: 10,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                  }}
                >
                  <input
                    type="text"
                    value={newSymbolInput}
                    onChange={(e) => {
                      setNewSymbolInput(e.target.value);
                      if (customSymbolError) setCustomSymbolError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddCustomSymbol();
                      }
                    }}
                    placeholder="Add custom symbol (e.g. USDCHF, AUDUSD, NZDUSD, XAGUSD)..."
                    style={{
                      ...inputStyle,
                      flex: 1,
                      fontFamily: "monospace",
                      textTransform: "uppercase",
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomSymbol}
                    disabled={!newSymbolInput.trim()}
                    style={{
                      ...inputStyle,
                      width: "auto",
                      background: "var(--accent)",
                      color: "var(--bg)",
                      fontWeight: 700,
                      cursor: newSymbolInput.trim() ? "pointer" : "default",
                      opacity: newSymbolInput.trim() ? 1 : 0.6,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "8px 14px",
                    }}
                  >
                    <Plus size={14} /> Add Symbol
                  </button>
                </div>

                {customSymbolError && (
                  <div style={{ fontSize: 11, color: "var(--red)", display: "flex", alignItems: "center", gap: 4 }}>
                    <AlertCircle size={13} /> {customSymbolError}
                  </div>
                )}

                {/* Quick search input */}
                <div style={{ position: "relative" }}>
                  <Search
                    size={13}
                    style={{ position: "absolute", left: 10, top: 10, color: "var(--muted)", pointerEvents: "none" }}
                  />
                  <input
                    type="text"
                    value={symbolSearch}
                    onChange={(e) => setSymbolSearch(e.target.value)}
                    placeholder="Search symbols in matrix..."
                    style={{
                      ...inputStyle,
                      paddingLeft: 28,
                      fontSize: 11,
                      background: "var(--bg)",
                    }}
                  />
                </div>

                {/* Symbols Matrix List */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {matrixSymbols.map((sym) => {
                    const meta = getSymbolMeta(sym);
                    const activeSlots = getActiveSlotsForSymbol(sym);
                    const isCustomAdded = customAddedSymbols.includes(sym);

                    return (
                      <div
                        key={sym}
                        style={{
                          background: "var(--panel-2)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          padding: 12,
                        }}
                      >
                        {/* Symbol Header */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: 6,
                            marginBottom: 8,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <strong style={{ fontSize: 13, fontFamily: "monospace", letterSpacing: "0.02em" }}>
                              {sym}
                            </strong>
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                padding: "1px 6px",
                                borderRadius: 3,
                                color: meta.badgeColor || "var(--accent)",
                                background: `${meta.badgeColor || "#38bdf8"}18`,
                                border: `1px solid ${meta.badgeColor || "#38bdf8"}40`,
                              }}
                            >
                              {meta.category || "General"}
                            </span>
                            <span style={{ fontSize: 10, color: activeSlots.length === 0 ? "var(--red)" : "var(--muted)", fontWeight: activeSlots.length === 0 ? 600 : 400 }}>
                              {activeSlots.length === 0 ? "🔴 Trading Blocked (0 active slots)" : `(${activeSlots.length} active slot${activeSlots.length === 1 ? "" : "s"})`}
                            </span>
                            {isCustomAdded && (
                              <button
                                type="button"
                                onClick={() => handleRemoveCustomSymbol(sym)}
                                title="Remove symbol from custom matrix"
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  color: "var(--muted)",
                                  cursor: "pointer",
                                  padding: 2,
                                  display: "inline-flex",
                                  alignItems: "center",
                                }}
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>

                          {/* Quick Presets */}
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => applyPresetForSymbol(sym, "ny")}
                              title="Set to NY Sessions (AM, Silver Bullet, London Close / NY Mid, PM)"
                              style={{
                                ...inputStyle,
                                width: "auto",
                                padding: "2px 6px",
                                fontSize: 10,
                                cursor: "pointer",
                                background: "rgba(59, 130, 246, 0.1)",
                                borderColor: "rgba(59, 130, 246, 0.3)",
                                color: "#60a5fa",
                              }}
                            >
                              NY Slots
                            </button>
                            <button
                              type="button"
                              onClick={() => applyPresetForSymbol(sym, "london")}
                              title="Set to London Sessions (Pre-London, London Open, London Close)"
                              style={{
                                ...inputStyle,
                                width: "auto",
                                padding: "2px 6px",
                                fontSize: 10,
                                cursor: "pointer",
                                background: "rgba(16, 185, 129, 0.1)",
                                borderColor: "rgba(16, 185, 129, 0.3)",
                                color: "#34d399",
                              }}
                            >
                              London
                            </button>
                            <button
                              type="button"
                              onClick={() => applyPresetForSymbol(sym, "all")}
                              title="Allow all sessions for this symbol"
                              style={{
                                ...inputStyle,
                                width: "auto",
                                padding: "2px 6px",
                                fontSize: 10,
                                cursor: "pointer",
                                background: "var(--panel)",
                              }}
                            >
                              All Slots
                            </button>
                            <button
                              type="button"
                              onClick={() => applyPresetForSymbol(sym, "none")}
                              title="Untick all sessions to disable trading for this symbol completely"
                              style={{
                                ...inputStyle,
                                width: "auto",
                                padding: "2px 6px",
                                fontSize: 10,
                                cursor: "pointer",
                                background: "rgba(239, 68, 68, 0.1)",
                                borderColor: "rgba(239, 68, 68, 0.3)",
                                color: "var(--red)",
                              }}
                            >
                              Disable (None)
                            </button>
                            <button
                              type="button"
                              onClick={() => applyPresetForSymbol(sym, "default")}
                              title="Reset to institutional defaults"
                              style={{
                                ...inputStyle,
                                width: "auto",
                                padding: "2px 6px",
                                fontSize: 10,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                              }}
                            >
                              <RotateCcw size={10} /> Reset
                            </button>
                          </div>
                        </div>

                        {/* Slot Checkboxes Grid */}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 150px), 1fr))",
                            gap: 6,
                          }}
                        >
                          {CONFIGURABLE_SLOTS.map((slot) => {
                            const isChecked = activeSlots.includes(slot.id);

                            return (
                              <label
                                key={slot.id}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  padding: "5px 7px",
                                  borderRadius: 5,
                                  cursor: "pointer",
                                  fontSize: 10,
                                  background: isChecked ? "rgba(56, 189, 248, 0.12)" : "var(--panel)",
                                  border: `1px solid ${isChecked ? "rgba(56, 189, 248, 0.4)" : "var(--border)"}`,
                                  color: isChecked ? "var(--accent)" : "var(--muted)",
                                  transition: "all 0.12s ease",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleSymbolSlot(sym, slot.id)}
                                  style={{ margin: 0 }}
                                />
                                <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                                  <strong style={{ display: "block", color: isChecked ? "var(--fg)" : "inherit" }}>
                                    {slot.short}
                                  </strong>
                                  <span style={{ fontSize: 9, opacity: 0.7 }}>
                                    {(() => {
                                      const t = form.slotCustomTimings?.[slot.id] || DEFAULT_SLOT_TIMINGS[slot.id];
                                      if (t?.start && t?.end) return `${t.start} - ${t.end}`;
                                      return (slot.defaultRange || slot.eetRange || "").split(" EET")[0];
                                    })()}
                                  </span>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB 6: BROKER MAPPING */}
            {activeTab === "broker" && (
              <div style={sectionStyle}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 6, color: "var(--fg)" }}>
                      <Wand2 size={15} style={{ color: "var(--accent)" }} />
                      MT5 Broker Symbol Mappings &amp; Aliases
                    </h3>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      Map canonical symbols (NAS100, DJ30, SP500, XAUUSD) to your MT5 broker's specific naming convention (USTEC, US30, GOLD, EURUSD.i).
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 12,
                  }}
                >
                  <BrokerSymbolMapping onClose={() => setActiveTab("execution")} />
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Fixed Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            borderTop: "1px solid var(--border)",
            background: "var(--panel-2)",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          {error ? (
            <div role="alert" style={{ fontSize: 11, color: "var(--red)", display: "flex", alignItems: "center", gap: 5 }}>
              <AlertCircle size={13} /> {error}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              Changes immediately apply to the scanning engine upon saving.
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            <button
              type="button"
              onClick={onClose}
              style={{ ...inputStyle, width: "auto", cursor: "pointer", padding: "8px 14px" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="autonomous-config-form"
              disabled={saving}
              style={{
                ...inputStyle,
                width: "auto",
                color: "var(--bg)",
                background: "var(--accent)",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: saving ? "wait" : "pointer",
                fontWeight: 700,
                padding: "8px 16px",
              }}
            >
              <Save size={13} /> {saving ? "Saving…" : "Save Configuration"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
