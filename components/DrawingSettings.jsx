"use client";

import React, { useState, useEffect } from "react";
import ColorPicker from "./ColorPicker.jsx";
import { defaultStyleFor } from "lightweight-charts-drawing";
import {
  Settings, Bookmark, Trash2, Check, RotateCcw, Plus,
  ChevronDown, Type, Eye, EyeOff, Sliders, Layers
} from "lucide-react";

const TEMPLATES_KEY = "ts_tool_templates";

export default function DrawingSettings({ api }) {
  const { settingsOpen, setSettingsOpen, selected, updateSelected } = api;

  const [activeTab, setActiveTab] = useState("Style");
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [saveTemplateModalOpen, setSaveTemplateModalOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [templates, setTemplates] = useState([]);

  const toolKind = selected?.kind || selected?.type || "tool";

  // Load templates for current tool kind
  useEffect(() => {
    if (!toolKind) return;
    try {
      const all = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "{}");
      setTemplates(all[toolKind] || []);
    } catch {
      setTemplates([]);
    }
  }, [toolKind, settingsOpen]);

  if (!settingsOpen || !selected) return null;

  const style = selected.style || {};

  const set = (patch) => {
    updateSelected(patch);
  };

  const setStyle = (patch) => {
    updateSelected({ style: patch });
  };

  // Tool classifications
  const isFib = toolKind.includes("fib") || toolKind.includes("pitchfan");
  const isPosition = toolKind === "long-position" || toolKind === "short-position";
  const isLine = toolKind.includes("line") || toolKind.includes("ray") || toolKind === "trend-angle";
  const isChannel = toolKind.includes("channel") || toolKind.includes("pitchfork");
  const isShape = toolKind === "rectangle" || toolKind === "rotated-rectangle" || toolKind === "circle" ||
                  toolKind === "ellipse" || toolKind === "triangle" || toolKind === "arc" ||
                  toolKind === "curve" || toolKind === "double-curve" || toolKind === "polyline" ||
                  toolKind === "path" || toolKind === "brush" || toolKind === "highlighter" || toolKind.includes("arrow");
  const isText = toolKind === "text" || toolKind === "note" || toolKind === "pin" || toolKind === "callout" ||
                 toolKind === "comment" || toolKind === "price-note" || toolKind === "signpost" ||
                 toolKind === "price-label" || toolKind === "flag-mark" || toolKind === "table";

  // Template Handlers
  const handleSaveTemplate = () => {
    const name = newTemplateName.trim();
    if (!name) return;
    try {
      const all = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "{}");
      const list = all[toolKind] || [];
      const updated = [...list.filter((t) => t.name !== name), { name, style: { ...style } }];
      all[toolKind] = updated;
      localStorage.setItem(TEMPLATES_KEY, JSON.stringify(all));
      setTemplates(updated);
      setNewTemplateName("");
      setSaveTemplateModalOpen(false);
      setTemplateMenuOpen(false);
    } catch (e) {
      console.error("Failed to save template:", e);
    }
  };

  const handleApplyTemplate = (tmpl) => {
    setStyle(tmpl.style);
    // Explicitly persist template style as the last-used style for this tool kind.
    // This ensures the NEXT fresh drawing of this tool starts with these settings,
    // regardless of whether updateSelected's selectedId path resolves in time.
    try {
      const saved = JSON.parse(localStorage.getItem("ts_tool_last_style") || "{}");
      saved[toolKind] = { ...(saved[toolKind] || {}), ...tmpl.style };
      localStorage.setItem("ts_tool_last_style", JSON.stringify(saved));
    } catch {}
    setTemplateMenuOpen(false);
  };

  const handleDeleteTemplate = (e, name) => {
    e.stopPropagation();
    try {
      const all = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "{}");
      const list = all[toolKind] || [];
      const updated = list.filter((t) => t.name !== name);
      all[toolKind] = updated;
      localStorage.setItem(TEMPLATES_KEY, JSON.stringify(all));
      setTemplates(updated);
    } catch {}
  };

  const handleResetDefaults = () => {
    try {
      const def = defaultStyleFor(toolKind);
      if (def) {
        setStyle(def);
      }
    } catch {}
    setTemplateMenuOpen(false);
  };

  // ── Reusable UI components ──────────────────────────────────────────────────

  const Row = ({ label, children, description }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>{children}</div>
      </div>
      {description && <span style={{ fontSize: 10, color: "var(--muted)", opacity: 0.7 }}>{description}</span>}
    </div>
  );

  const WidthSelector = ({ val, onChange }) => (
    <div style={{ display: "flex", gap: 2 }}>
      {[1, 2, 3, 4].map((w) => (
        <button
          key={w}
          onClick={() => onChange(w)}
          className={val === w ? "primary" : "ghost"}
          style={{ padding: "2px 6px", fontSize: 11, minWidth: 22, borderRadius: 4 }}
        >
          {w}px
        </button>
      ))}
    </div>
  );

  const StyleSelector = ({ val, onChange }) => {
    const vStr = typeof val === "number" ? (val === 1 ? "dotted" : val === 2 ? "dashed" : "solid") : val;
    return (
      <div style={{ display: "flex", gap: 2 }}>
        {[
          { v: "solid", label: "—" },
          { v: "dashed", label: "╌" },
          { v: "dotted", label: "┄" },
        ].map((s) => (
          <button
            key={s.v}
            onClick={() => onChange(s.v)}
            className={vStr === s.v ? "primary" : "ghost"}
            style={{ padding: "2px 7px", fontSize: 12, minWidth: 24, borderRadius: 4 }}
          >
            {s.label}
          </button>
        ))}
      </div>
    );
  };

  // Opacity slider with % display
  const OpacitySlider = ({ value, onChange, label: sliderLabel }) => {
    // value is 0–100 transparency (0=opaque, 100=transparent) — convert to opacity %
    const opacityPct = 100 - (value ?? 80);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {sliderLabel && <span style={{ fontSize: 11, color: "var(--muted)" }}>{sliderLabel}</span>}
        <input
          type="range" min={0} max={100} step={5}
          value={opacityPct}
          onChange={(e) => onChange(100 - Number(e.target.value))}
          style={{ width: 90 }}
        />
        <span style={{ fontSize: 11, minWidth: 30, textAlign: "right" }}>{opacityPct}%</span>
      </div>
    );
  };

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        zIndex: 100000, width: "95vw", maxWidth: 480, maxHeight: "88vh",
        background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10,
        boxShadow: "0 12px 40px rgba(0,0,0,.75)", display: "flex", flexDirection: "column",
        overflow: "hidden", color: "var(--text)",
      }}
    >
      {/* ── Modal Header ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderBottom: "1px solid var(--border)",
        background: "rgba(255,255,255,0.02)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Settings size={16} className="text-brand" />
          <span style={{ fontSize: 13, fontWeight: 700, textTransform: "capitalize" }}>
            {toolKind.replace(/-/g, " ")} Settings
          </span>
        </div>
        <button
          className="ghost"
          onClick={() => setSettingsOpen(false)}
          style={{ padding: "4px 8px", fontSize: 14, borderRadius: 4, cursor: "pointer" }}
        >
          ✕
        </button>
      </div>

      {/* ── Navigation Tabs ── */}
      <div style={{
        display: "flex", gap: 4, padding: "6px 12px", borderBottom: "1px solid var(--border)",
        background: "rgba(0,0,0,0.15)",
      }}>
        {["Style", ...(isPosition || isLine || isText ? ["Inputs"] : []), "Visibility"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={activeTab === tab ? "primary" : "ghost"}
            style={{ padding: "4px 12px", fontSize: 12, borderRadius: 6, fontWeight: 600 }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Modal Body Content ── */}
      <div style={{ padding: "14px 18px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>

        {/* ═════════ TAB 1: STYLE ═════════ */}
        {activeTab === "Style" && (
          <>
            {/* Primary Line / Border Color */}
            <Row label="Line Color">
              <ColorPicker
                value={style.color || "#2962ff"}
                onChange={(c) => setStyle({ color: c })}
                label="Line Color"
                size={24}
              />
            </Row>

            <Row label="Line Width">
              <WidthSelector
                val={style.width || 1}
                onChange={(w) => setStyle({ width: w })}
              />
            </Row>

            <Row label="Line Style">
              <StyleSelector
                val={style.lineStyle || "solid"}
                onChange={(s) => setStyle({ lineStyle: s === "dotted" ? 1 : s === "dashed" ? 2 : 0 })}
              />
            </Row>

            {/* ── FIBONACCI LEVELS TABLE ── */}
            {isFib && style.levels && (
              <div style={{ marginTop: 8, padding: "8px 0", borderTop: "1px solid var(--border)" }}>

                {/* ─ Section header ─ */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--muted)", letterSpacing: 0.5 }}>
                    Fibonacci Levels
                  </span>
                  {/* Quick: extend 0 & 1 anchor levels left to first candle contact */}
                  <button
                    className="ghost"
                    title="Extend 0 & 1 level lines left to touch the first candle contact without shifting middle levels or background"
                    onClick={() => {
                      const nextState = !style.extendAnchorLevelsLeft;
                      setStyle({
                        extendAnchorLevelsLeft: nextState,
                        ...(nextState ? { extendLeft: false } : {}),
                      });
                    }}
                    style={{
                      fontSize: 10, padding: "2px 8px", borderRadius: 4,
                      border: `1px solid ${style.extendAnchorLevelsLeft ? "var(--brand)" : "var(--border)"}`,
                      cursor: "pointer",
                      color: style.extendAnchorLevelsLeft ? "var(--brand)" : "var(--muted)",
                      background: style.extendAnchorLevelsLeft ? "rgba(41,98,255,0.15)" : "transparent",
                    }}
                  >
                    {style.extendAnchorLevelsLeft ? "✓ 0 & 1 Candle Contact" : "⬅ 0 & 1 Candle Contact"}
                  </button>
                </div>

                {/* ─ Column headers ─ */}
                <div style={{ display: "grid", gridTemplateColumns: "16px 54px 22px 60px 58px 60px", gap: 4, paddingBottom: 4, paddingLeft: 4 }}>
                  <span style={{ fontSize: 9, color: "var(--muted)", textAlign: "center" }}>✓</span>
                  <span style={{ fontSize: 9, color: "var(--muted)" }}>Level</span>
                  <span style={{ fontSize: 9, color: "var(--muted)" }}>Color</span>
                  <span style={{ fontSize: 9, color: "var(--muted)" }}>Style</span>
                  <span style={{ fontSize: 9, color: "var(--muted)" }}>Width</span>
                  <span style={{ fontSize: 9, color: "var(--muted)" }}>Label</span>
                </div>

                {/* ─ Level rows ─ */}
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {style.levels.map((lvl, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "grid", gridTemplateColumns: "16px 54px 22px 60px 58px 60px",
                        gap: 4, alignItems: "center",
                        padding: "3px 4px", background: "rgba(255,255,255,0.02)",
                        borderRadius: 4, border: "1px solid rgba(255,255,255,0.04)",
                      }}
                    >
                      {/* Visible */}
                      <input
                        type="checkbox"
                        checked={lvl.visible}
                        onChange={(e) => {
                          const updated = [...style.levels];
                          updated[idx] = { ...lvl, visible: e.target.checked };
                          setStyle({ levels: updated });
                        }}
                        style={{ cursor: "pointer", margin: 0 }}
                      />
                      {/* Coefficient */}
                      <input
                        type="number"
                        step="0.001"
                        value={lvl.coeff}
                        onChange={(e) => {
                          const updated = [...style.levels];
                          updated[idx] = { ...lvl, coeff: parseFloat(e.target.value) || 0 };
                          setStyle({ levels: updated });
                        }}
                        style={{ fontSize: 10, padding: "2px 3px", background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", borderRadius: 3, color: "var(--text)", width: "100%" }}
                      />
                      {/* Color picker */}
                      <ColorPicker
                        value={lvl.color || "#2962ff"}
                        onChange={(c) => {
                          const updated = [...style.levels];
                          updated[idx] = { ...lvl, color: c };
                          setStyle({ levels: updated });
                        }}
                        label={`Level ${lvl.coeff} — color also controls zone fill`}
                        size={18}
                      />
                      {/* Line style — solid/dashed/dotted per level */}
                      <div style={{ display: "flex", gap: 2 }}>
                        {[
                          { v: "solid", label: "─" },
                          { v: "dashed", label: "╌" },
                          { v: "dotted", label: "·" },
                        ].map((s) => (
                          <button
                            key={s.v}
                            onClick={() => {
                              const updated = [...style.levels];
                              updated[idx] = { ...lvl, style: s.v };
                              setStyle({ levels: updated });
                            }}
                            title={s.v}
                            style={{
                              padding: "1px 5px", fontSize: 11, borderRadius: 3, cursor: "pointer",
                              background: (lvl.style || "solid") === s.v ? "var(--brand)" : "rgba(255,255,255,0.06)",
                              border: "1px solid var(--border)", color: "var(--text)",
                            }}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                      {/* Width per level */}
                      <div style={{ display: "flex", gap: 2 }}>
                        {[1, 2, 3].map((w) => (
                          <button
                            key={w}
                            onClick={() => {
                              const updated = [...style.levels];
                              updated[idx] = { ...lvl, width: w };
                              setStyle({ levels: updated });
                            }}
                            style={{
                              padding: "1px 4px", fontSize: 10, borderRadius: 3, cursor: "pointer",
                              background: (lvl.width || style.width || 2) === w ? "var(--brand)" : "rgba(255,255,255,0.06)",
                              border: "1px solid var(--border)", color: "var(--text)",
                            }}
                          >
                            {w}
                          </button>
                        ))}
                      </div>
                      {/* Label (coeff as percent) */}
                      <span style={{ fontSize: 9, color: "var(--muted)", textAlign: "center" }}>
                        {lvl.coeff === 0 ? "0" : lvl.coeff === 1 ? "1" : `${(lvl.coeff * 100).toFixed(1)}%`}
                      </span>
                    </div>
                  ))}
                </div>

                {/* ─ Trend Line ─ */}
                <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--muted)", letterSpacing: 0.5, display: "block", marginBottom: 6 }}>
                    Trend Line (Anchor)
                  </span>
                  <Row label="Trend Line Visible">
                    <input
                      type="checkbox"
                      checked={(style.fibTrendLine?.visible) !== false}
                      onChange={(e) => setStyle({ fibTrendLine: { ...(style.fibTrendLine || {}), visible: e.target.checked } })}
                      style={{ cursor: "pointer" }}
                    />
                  </Row>
                  {(style.fibTrendLine?.visible) !== false && (<>
                    <Row label="Trend Line Color">
                      <ColorPicker
                        value={style.fibTrendLine?.color || "#808080"}
                        onChange={(c) => setStyle({ fibTrendLine: { ...(style.fibTrendLine || { visible: true, width: 1, style: "solid" }), color: c } })}
                        size={22}
                      />
                    </Row>
                    <Row label="Trend Line Style">
                      <StyleSelector
                        val={style.fibTrendLine?.style || "solid"}
                        onChange={(s) => setStyle({ fibTrendLine: { ...(style.fibTrendLine || { visible: true, color: "#808080", width: 1 }), style: s } })}
                      />
                    </Row>
                    <Row label="Trend Line Width">
                      <WidthSelector
                        val={style.fibTrendLine?.width || 1}
                        onChange={(w) => setStyle({ fibTrendLine: { ...(style.fibTrendLine || { visible: true, color: "#808080", style: "solid" }), width: w } })}
                      />
                    </Row>
                  </>)}
                </div>

                {/* ─ Zone fill ─ */}
                <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--muted)", letterSpacing: 0.5, display: "block", marginBottom: 6 }}>
                    Zone Fill
                  </span>
                  <Row label="Fill Between Levels" description="Zone fill color is taken from each level's color">
                    <input
                      type="checkbox"
                      checked={style.fillBackground !== false}
                      onChange={(e) => setStyle({ fillBackground: e.target.checked })}
                      style={{ cursor: "pointer" }}
                    />
                  </Row>
                  <Row label="Fill Opacity">
                    <OpacitySlider
                      value={style.transparency ?? 80}
                      onChange={(v) => setStyle({ transparency: v })}
                    />
                  </Row>
                </div>

                {/* ─ Display & Extend ─ */}
                <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--muted)", letterSpacing: 0.5, display: "block", marginBottom: 6 }}>
                    Display & Extend
                  </span>
                  <Row label="Show Prices">
                    <input
                      type="checkbox"
                      checked={style.showPrices !== false}
                      onChange={(e) => setStyle({ showPrices: e.target.checked })}
                      style={{ cursor: "pointer" }}
                    />
                  </Row>
                  <Row label="Show Level Numbers">
                    <input
                      type="checkbox"
                      checked={style.showCoeffs !== false}
                      onChange={(e) => setStyle({ showCoeffs: e.target.checked })}
                      style={{ cursor: "pointer" }}
                    />
                  </Row>
                  <Row label="Levels as Percents" description="61.8% instead of 0.618">
                    <input
                      type="checkbox"
                      checked={!!style.fibLevelsAsPercents}
                      onChange={(e) => setStyle({ fibLevelsAsPercents: e.target.checked })}
                      style={{ cursor: "pointer" }}
                    />
                  </Row>
                  <Row label="Extend 0 & 1 to Candle" description="Project 0 & 1 dotted lines left to first candle contact">
                    <input
                      type="checkbox"
                      checked={!!style.extendAnchorLevelsLeft}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setStyle({
                          extendAnchorLevelsLeft: checked,
                          ...(checked ? { extendLeft: false } : {}),
                        });
                      }}
                      style={{ cursor: "pointer" }}
                    />
                  </Row>
                  <Row label="Extend Lines Left" description="Extend all levels infinitely to chart left edge">
                    <input
                      type="checkbox"
                      checked={!!style.extendLeft}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setStyle({
                          extendLeft: checked,
                          ...(checked ? { extendAnchorLevelsLeft: false } : {}),
                        });
                      }}
                      style={{ cursor: "pointer" }}
                    />
                  </Row>
                  <Row label="Extend Lines Right">
                    <input
                      type="checkbox"
                      checked={!!style.extendRight}
                      onChange={(e) => setStyle({ extendRight: e.target.checked })}
                      style={{ cursor: "pointer" }}
                    />
                  </Row>
                  <Row label="Reverse Direction" description="Invert 0→1 direction">
                    <input
                      type="checkbox"
                      checked={!!style.reverse}
                      onChange={(e) => setStyle({ reverse: e.target.checked })}
                      style={{ cursor: "pointer" }}
                    />
                  </Row>
                </div>
              </div>
            )}


            {/* ── POSITION TOOL (LONG / SHORT) STYLE ── */}
            {isPosition && (
              <div style={{ marginTop: 8, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--muted)", letterSpacing: 0.5 }}>
                  Target & Stop Zones
                </span>

                <Row label="Profit Zone (Target)">
                  <ColorPicker
                    value={style.targetColor || "#089981"}
                    onChange={(c) => setStyle({ targetColor: c })}
                    label="Target color"
                    size={22}
                  />
                  <OpacitySlider
                    value={style.targetTransparency ?? 80}
                    onChange={(v) => setStyle({ targetTransparency: v })}
                  />
                </Row>

                <Row label="Stop Zone (Loss)">
                  <ColorPicker
                    value={style.stopColor || "#f23645"}
                    onChange={(c) => setStyle({ stopColor: c })}
                    label="Stop color"
                    size={22}
                  />
                  <OpacitySlider
                    value={style.stopTransparency ?? 80}
                    onChange={(v) => setStyle({ stopTransparency: v })}
                  />
                </Row>

                <Row label="Compact Stats Mode">
                  <input
                    type="checkbox"
                    checked={!!style.compactStats}
                    onChange={(e) => setStyle({ compactStats: e.target.checked })}
                    style={{ cursor: "pointer" }}
                  />
                </Row>
              </div>
            )}

            {/* ── SHAPES & RECTANGLE FILL ── */}
            {(isShape || isChannel) && (
              <>
                <Row label="Fill Background">
                  <input
                    type="checkbox"
                    checked={style.fillBackground !== false}
                    onChange={(e) => setStyle({ fillBackground: e.target.checked })}
                    style={{ cursor: "pointer" }}
                  />
                </Row>

                <Row label="Fill Color">
                  <ColorPicker
                    value={style.backgroundColor || style.color || "#2962ff"}
                    onChange={(c) => setStyle({ backgroundColor: c })}
                    label="Fill color"
                    size={24}
                  />
                </Row>

                <Row label="Fill Opacity">
                  <OpacitySlider
                    value={style.transparency ?? 50}
                    onChange={(v) => setStyle({ transparency: v })}
                  />
                </Row>
              </>
            )}

            {/* ── LINE EXTENSIONS ── */}
            {isLine && (
              <>
                <Row label="Extend Left">
                  <button
                    className={style.extendLeft ? "primary" : "ghost"}
                    onClick={() => setStyle({ extendLeft: !style.extendLeft })}
                    style={{ padding: "2px 10px", fontSize: 11, borderRadius: 4 }}
                  >
                    {style.extendLeft ? "On" : "Off"}
                  </button>
                </Row>
                <Row label="Extend Right">
                  <button
                    className={style.extendRight ? "primary" : "ghost"}
                    onClick={() => setStyle({ extendRight: !style.extendRight })}
                    style={{ padding: "2px 10px", fontSize: 11, borderRadius: 4 }}
                  >
                    {style.extendRight ? "On" : "Off"}
                  </button>
                </Row>
              </>
            )}

            {/* ── TEXT / LABEL COLOR ── */}
            {(isText || isLine) && (
              <Row label="Text Color">
                <ColorPicker
                  value={style.textColor || "#2962ff"}
                  onChange={(c) => setStyle({ textColor: c })}
                  label="Text color"
                  size={24}
                />
              </Row>
            )}
          </>
        )}

        {/* ═════════ TAB 2: INPUTS ═════════ */}
        {activeTab === "Inputs" && (
          <>
            {/* Position tool specific inputs */}
            {isPosition && (
              <>
                {/* Text Edit Mode for Position Entry, SL, TP, and Target RR */}
                {(() => {
                  const isShort = toolKind === "short-position" || selected.rrSide === "short" || style.rrSide === "short";
                  const dir = isShort ? -1 : 1;
                  const entryPrice = selected.points?.[0]?.price ?? selected.entry?.price ?? 0;
                  const currentStopLevel = style.stopLevel ?? (selected.points?.[1] ? Math.abs(selected.points[1].price - entryPrice) : (selected.stop ? Math.abs(entryPrice - selected.stop) : 10));
                  const currentProfitLevel = style.profitLevel ?? (selected.points?.[1] ? Math.abs(selected.points[1].price - entryPrice) : (selected.target ? Math.abs(selected.target - entryPrice) : 20));
                  const currentStopPrice = selected.stop ?? Number((entryPrice - dir * currentStopLevel).toFixed(4));
                  const currentTpPrice = selected.target ?? Number((entryPrice + dir * currentProfitLevel).toFixed(4));
                  const currentRR = currentStopLevel > 0 ? Math.min(5.0, Math.round((currentProfitLevel / currentStopLevel) * 100) / 100) : (selected.ratio ? Math.min(5.0, selected.ratio) : 2.0);

                  return (
                    <div style={{ marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--accent)", letterSpacing: 0.5, marginBottom: 8 }}>
                        Position Parameters (Max 5.0 R:R)
                      </div>

                      <Row label="Target R:R (Max 5.0R)">
                        <input
                          type="number"
                          step={0.1}
                          min={0.1}
                          max={5.0}
                          value={currentRR}
                          onChange={(e) => {
                            const newRR = Math.min(5.0, Math.max(0.1, Number(e.target.value) || 0.1));
                            const newProfitLevel = newRR * (currentStopLevel || 1);
                            const newTargetPrice = Number((entryPrice + dir * newProfitLevel).toFixed(4));
                            set({
                              style: { ...style, profitLevel: newProfitLevel },
                              target: newTargetPrice,
                              ratio: newRR,
                            });
                          }}
                          style={{ width: 120, fontSize: 12, padding: "4px 8px", background: "rgba(0,0,0,0.3)", border: "1px solid var(--green)", borderRadius: 4, color: "var(--green)", fontWeight: 700 }}
                        />
                      </Row>

                      <Row label="Take Profit (TP) Price">
                        <input
                          type="number"
                          step="any"
                          value={currentTpPrice}
                          onChange={(e) => {
                            const newTp = Number(e.target.value) || 0;
                            const profitDist = Math.abs(newTp - entryPrice);
                            const stopDist = currentStopLevel || 1;
                            const calculatedRR = Math.min(5.0, Math.max(0.1, Math.round((profitDist / stopDist) * 100) / 100));
                            const clampedProfit = calculatedRR * stopDist;
                            const finalTp = Number((entryPrice + dir * clampedProfit).toFixed(4));
                            set({
                              style: { ...style, profitLevel: clampedProfit },
                              target: finalTp,
                              ratio: calculatedRR,
                            });
                          }}
                          style={{ width: 120, fontSize: 12, padding: "4px 8px", background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
                        />
                      </Row>

                      <Row label="Stop Loss (SL) Price">
                        <input
                          type="number"
                          step="any"
                          value={currentStopPrice}
                          onChange={(e) => {
                            const newSl = Number(e.target.value) || 0;
                            const newStopDist = Math.max(0.0001, Math.abs(entryPrice - newSl));
                            const clampedProfit = Math.min(5.0 * newStopDist, currentProfitLevel);
                            const newRR = Math.min(5.0, Math.round((clampedProfit / newStopDist) * 100) / 100);
                            set({
                              style: { ...style, stopLevel: newStopDist, profitLevel: clampedProfit },
                              stop: newSl,
                              ratio: newRR,
                            });
                          }}
                          style={{ width: 120, fontSize: 12, padding: "4px 8px", background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
                        />
                      </Row>

                      <Row label="Entry Price">
                        <input
                          type="number"
                          step="any"
                          value={entryPrice}
                          onChange={(e) => {
                            const newEntry = Number(e.target.value) || 0;
                            const newPoints = selected.points ? [{ ...selected.points[0], price: newEntry }, ...(selected.points.slice(1))] : null;
                            const newTarget = Number((newEntry + dir * currentProfitLevel).toFixed(4));
                            const newStop = Number((newEntry - dir * currentStopLevel).toFixed(4));
                            set({
                              ...(newPoints ? { points: newPoints } : {}),
                              ...(selected.entry ? { entry: { ...selected.entry, price: newEntry } } : {}),
                              target: newTarget,
                              stop: newStop,
                            });
                          }}
                          style={{ width: 120, fontSize: 12, padding: "4px 8px", background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
                        />
                      </Row>
                    </div>
                  );
                })()}

                <Row label="Account Size ($)">
                  <input
                    type="number"
                    value={style.accountSize ?? 100000}
                    onChange={(e) => setStyle({ accountSize: Math.max(0, Number(e.target.value) || 0) })}
                    style={{ width: 120, fontSize: 12, padding: "4px 8px", background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
                  />
                </Row>

                <Row label="Risk Amount">
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="number"
                      step={0.1}
                      value={style.riskPercent ?? 1}
                      onChange={(e) => setStyle({ riskPercent: Math.max(0, Number(e.target.value) || 0) })}
                      style={{ width: 70, fontSize: 12, padding: "4px 8px", background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
                    />
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>%</span>
                  </div>
                </Row>

                <Row label="Lot / Contract Size">
                  <input
                    type="number"
                    step={0.1}
                    value={style.lotSize ?? 1}
                    onChange={(e) => setStyle({ lotSize: Math.max(0.01, Number(e.target.value) || 1) })}
                    style={{ width: 120, fontSize: 12, padding: "4px 8px", background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
                  />
                </Row>
              </>
            )}

            {/* Text tool input */}
            {(isText || isLine) && (
              <>
                <Row label="Label Text">
                  <input
                    type="text"
                    value={selected.text || style.text || ""}
                    onChange={(e) => {
                      set({ text: e.target.value });
                      setStyle({ text: e.target.value });
                    }}
                    placeholder="Enter annotation..."
                    style={{ width: "100%", fontSize: 12, padding: "4px 8px", background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
                  />
                </Row>

                <Row label="Font Size">
                  <input
                    type="number"
                    min={8}
                    max={72}
                    value={style.fontSize || 14}
                    onChange={(e) => setStyle({ fontSize: Number(e.target.value) || 14 })}
                    style={{ width: 70, fontSize: 12, padding: "4px 8px", background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
                  />
                </Row>
              </>
            )}
          </>
        )}

        {/* ═════════ TAB 3: VISIBILITY & OPTIONS ═════════ */}
        {activeTab === "Visibility" && (
          <>
            <Row label="Price Axis Labels">
              <input
                type="checkbox"
                checked={style.showPriceLabels !== false}
                onChange={(e) => setStyle({ showPriceLabels: e.target.checked })}
                style={{ cursor: "pointer" }}
              />
            </Row>

            {isFib && (
              <Row label="Fib Settings">
                <span style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>
                  All fib options are in the Style tab ↑
                </span>
              </Row>
            )}

            {isChannel && (
              <Row label="Middle Median Line">
                <input
                  type="checkbox"
                  checked={style.middleLine !== false}
                  onChange={(e) => setStyle({ middleLine: e.target.checked })}
                  style={{ cursor: "pointer" }}
                />
              </Row>
            )}
          </>
        )}

      </div>

      {/* ── Modal Footer with Template Management ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px", borderTop: "1px solid var(--border)",
        background: "rgba(0,0,0,0.2)", position: "relative",
      }}>
        {/* Template Button & Dropdown */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setTemplateMenuOpen(!templateMenuOpen)}
            className="ghost"
            style={{
              padding: "5px 10px", fontSize: 12, borderRadius: 6, display: "flex",
              alignItems: "center", gap: 6, border: "1px solid var(--border)",
              cursor: "pointer",
            }}
          >
            <Bookmark size={13} className="text-brand" />
            <span>Template</span>
            <ChevronDown size={11} />
          </button>

          {/* Template Menu Popover */}
          {templateMenuOpen && (
            <div
              style={{
                position: "absolute", bottom: 36, left: 0, zIndex: 100001,
                minWidth: 200, background: "var(--panel)", border: "1px solid var(--border)",
                borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.7)", overflow: "hidden",
              }}
            >
              <div style={{ padding: "6px 10px", fontSize: 10, textTransform: "uppercase", opacity: 0.5, fontWeight: 700, borderBottom: "1px solid var(--border)" }}>
                Saved Templates ({templates.length})
              </div>

              {templates.map((t) => (
                <div
                  key={t.name}
                  onClick={() => handleApplyTemplate(t)}
                  style={{
                    padding: "7px 10px", fontSize: 12, display: "flex", alignItems: "center",
                    justifyContent: "space-between", cursor: "pointer",
                    borderBottom: "1px solid rgba(255,255,255,0.03)",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--accent-soft)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <span>{t.name}</span>
                  <button
                    onClick={(e) => handleDeleteTemplate(e, t.name)}
                    style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", padding: 2 }}
                    title="Delete template"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}

              <div
                onClick={() => setSaveTemplateModalOpen(true)}
                style={{
                  padding: "8px 10px", fontSize: 12, display: "flex", alignItems: "center",
                  gap: 6, cursor: "pointer", color: "var(--brand)", fontWeight: 600,
                  borderTop: "1px solid var(--border)",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--accent-soft)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <Plus size={13} />
                <span>Save As...</span>
              </div>

              <div
                onClick={handleResetDefaults}
                style={{
                  padding: "8px 10px", fontSize: 12, display: "flex", alignItems: "center",
                  gap: 6, cursor: "pointer", color: "var(--muted)",
                  borderTop: "1px solid var(--border)",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <RotateCcw size={12} />
                <span>Reset to Factory Defaults</span>
              </div>
            </div>
          )}
        </div>

        {/* Save Template Prompt Modal */}
        {saveTemplateModalOpen && (
          <div
            style={{
              position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              zIndex: 100005, background: "var(--panel)", border: "1px solid var(--border)",
              borderRadius: 8, padding: 14, boxShadow: "0 10px 30px rgba(0,0,0,.8)", width: 280,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Save Template</div>
            <input
              type="text"
              placeholder="Template name (e.g. Golden Fib)"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              autoFocus
              style={{
                width: "100%", padding: "6px 8px", fontSize: 12, background: "rgba(0,0,0,0.3)",
                border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", marginBottom: 12,
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
              <button
                className="ghost"
                onClick={() => setSaveTemplateModalOpen(false)}
                style={{ padding: "4px 10px", fontSize: 11, borderRadius: 4 }}
              >
                Cancel
              </button>
              <button
                className="primary"
                onClick={handleSaveTemplate}
                style={{ padding: "4px 12px", fontSize: 11, borderRadius: 4 }}
              >
                Save
              </button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="primary"
            onClick={() => setSettingsOpen(false)}
            style={{ padding: "6px 18px", fontSize: 12, borderRadius: 6, fontWeight: 600, cursor: "pointer" }}
          >
            Ok
          </button>
        </div>
      </div>
    </div>
  );
}
