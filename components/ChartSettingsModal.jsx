import React, { useState, useRef, useEffect } from "react";
import { X, RotateCcw } from "lucide-react";
import { 
  useChartSettings, 
  useRecentColors, 
  addRecentColor, 
  switchTheme,
  updateThemeCustomColor,
  resetThemeToDefaults,
  getThemeActiveColors,
  THEME_PRESETS
} from "../lib/chartSettings";
import BrokerSymbolMapping from "./BrokerSymbolMapping";

import ModernColorPicker from "./ColorPicker";

const ColorPicker = ({ label, settingKey, settings, handleChange }) => {
  const val = settings[settingKey] || "#ffffff";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12 }}>
      {label ? <label style={{ fontSize: 13, color: "var(--text-muted)", flex: 1 }}>{label}</label> : null}
      <ModernColorPicker
        value={val}
        onChange={(newColor) => {
          handleChange(settingKey, newColor);
          addRecentColor(newColor);
        }}
        size={24}
        label={label || settingKey}
      />
    </div>
  );
};

const ThemeColorRow = ({ label, desc, varName, colorKey, activeColors, onColorChange }) => {
  const val = activeColors[colorKey] || "#ffffff";
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "10px 12px",
      borderRadius: 6,
      background: "rgba(255,255,255,0.02)",
      border: "1px solid var(--border)",
      gap: 12,
    }}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{label}</span>
          {varName && (
            <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", opacity: 0.75 }}>
              {varName}
            </span>
          )}
        </div>
        {desc && (
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.3 }}>
            {desc}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>
          {val}
        </span>
        <ModernColorPicker
          value={val}
          onChange={(newColor) => {
            onColorChange(colorKey, newColor);
            addRecentColor(newColor);
          }}
          size={24}
          label={label}
        />
      </div>
    </div>
  );
};

const Checkbox = ({ label, settingKey, settings, handleChange }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
    <input
      type="checkbox"
      checked={!!settings[settingKey]}
      onChange={(e) => handleChange(settingKey, e.target.checked)}
      style={{ accentColor: "var(--accent)" }}
    />
    <label style={{ fontSize: 13, color: "var(--text)" }}>{label}</label>
  </div>
);

export default function ChartSettingsModal({ onClose, initialTab = "Symbol" }) {
  const [settings, updateSettings] = useChartSettings();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const m = typeof window !== "undefined" && (window.innerWidth <= 768 || (window.innerHeight <= 550 && window.innerWidth <= 1080));
      setIsMobile(m);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    window.addEventListener("orientationchange", checkMobile);
    return () => {
      window.removeEventListener("resize", checkMobile);
      window.removeEventListener("orientationchange", checkMobile);
    };
  }, []);

  const TABS = ["Symbol", "Theme", "Canvas", "Broker Mapping", "Advanced"];

  const activeTheme = settings.appTheme || "dark";
  const activeColors = getThemeActiveColors(activeTheme);

  const handleChange = (key, value) => {
    updateSettings({ [key]: value });
  };

  return (
    <div 
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
        padding: isMobile ? "8px" : "16px"
      }}
    >
      <div 
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
        background: "var(--panel)",
        width: isMobile ? "100%" : 780,
        maxWidth: isMobile ? "100%" : "95vw",
        height: isMobile ? "94vh" : 560,
        maxHeight: isMobile ? "96vh" : "92vh",
        borderRadius: isMobile ? 12 : 12,
        display: "flex",
        flexDirection: "column",
        border: "1px solid var(--border)",
        boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
        overflow: "hidden"
      }}>
        {/* Header */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: isMobile ? "12px 16px" : "16px 24px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0
        }}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 18, fontWeight: 600, color: "var(--text)" }}>Chart settings</h2>
          <X size={20} style={{ cursor: "pointer", color: "var(--text-muted)" }} onClick={onClose} />
        </div>

        {/* Mobile Horizontal Tabs */}
        {isMobile && (
          <div style={{
            display: "flex",
            flexDirection: "row",
            overflowX: "auto",
            borderBottom: "1px solid var(--border)",
            padding: "8px 12px",
            gap: 8,
            background: "rgba(0,0,0,0.18)",
            flexShrink: 0,
            WebkitOverflowScrolling: "touch",
            scrollbarWidth: "none"
          }}>
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                style={{
                  padding: "6px 12px",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: activeTab === t ? 600 : 500,
                  whiteSpace: "nowrap",
                  borderRadius: 6,
                  background: activeTab === t ? "var(--accent)" : "rgba(255,255,255,0.04)",
                  color: activeTab === t ? "#ffffff" : "var(--text-muted)",
                  border: activeTab === t ? "1px solid var(--accent)" : "1px solid var(--border)",
                  flexShrink: 0,
                  transition: "all 0.15s ease",
                  outline: "none"
                }}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden", flexDirection: isMobile ? "column" : "row" }}>
          {/* Desktop Sidebar */}
          {!isMobile && (
            <div style={{ width: 160, borderRight: "1px solid var(--border)", padding: "12px 0", overflowY: "auto", flexShrink: 0 }}>
              {TABS.map((t) => (
                <div
                  key={t}
                  onClick={() => setActiveTab(t)}
                  style={{
                    padding: "10px 24px", cursor: "pointer", fontSize: 14,
                    background: activeTab === t ? "var(--accent-soft)" : "transparent",
                    color: activeTab === t ? "var(--text)" : "var(--text-muted)",
                    borderLeft: activeTab === t ? "3px solid var(--accent)" : "3px solid transparent",
                  }}
                >
                  {t}
                </div>
              ))}
            </div>
          )}

          {/* Content */}
          <div style={{
            flex: 1,
            padding: isMobile ? "14px 12px" : "24px",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch"
          }}>
            {activeTab === "Symbol" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                  <h3 style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-muted)", margin: 0 }}>Candles</h3>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Configure For:</span>
                    <select
                      value={settings.appTheme || "dark"}
                      onChange={(e) => switchTheme(e.target.value)}
                      style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", padding: "2px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
                    >
                      <option value="dark">Dark Mode</option>
                      <option value="light">Light Mode</option>
                      <option value="navyblue">Navy Blue</option>
                      <option value="creamy">Creamy</option>
                      <option value="midnight">Midnight OLED</option>
                      <option value="matrix">Matrix</option>
                    </select>
                  </div>
                </div>

                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 16, padding: "6px 10px", background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: 4 }}>
                  Colors configured below are automatically preserved per theme. Switching themes preserves and recalls custom palettes.
                </div>
                
                <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 8 : 32 }}>
                  <div style={{ flex: 1 }}>
                    <ColorPicker label="Body Up" settingKey="upColor" settings={settings} handleChange={handleChange} />
                    <ColorPicker label="Borders Up" settingKey="borderUpColor" settings={settings} handleChange={handleChange} />
                    <ColorPicker label="Wick Up" settingKey="wickUpColor" settings={settings} handleChange={handleChange} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <ColorPicker label="Body Down" settingKey="downColor" settings={settings} handleChange={handleChange} />
                    <ColorPicker label="Borders Down" settingKey="borderDownColor" settings={settings} handleChange={handleChange} />
                    <ColorPicker label="Wick Down" settingKey="wickDownColor" settings={settings} handleChange={handleChange} />
                  </div>
                </div>

                <div style={{ marginTop: 16 }}>
                  <Checkbox label="Borders Visible" settingKey="borderVisible" settings={settings} handleChange={handleChange} />
                  <Checkbox label="Color bars based on previous close" settingKey="colorBasedOnPreviousClose" settings={settings} handleChange={handleChange} />
                </div>
              </div>
            )}

            {activeTab === "Theme" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Theme Preset Switcher Card */}
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  padding: isMobile ? "12px" : "16px",
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid var(--border)",
                  borderRadius: 8
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", margin: 0 }}>Base Preset</h3>
                      <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0" }}>Choose a foundation to customize with your own colors</p>
                    </div>
                    <button
                      onClick={() => resetThemeToDefaults(activeTheme)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "5px 10px",
                        fontSize: 12,
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                        borderRadius: 6,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                      title="Reset current theme to default palette"
                    >
                      <RotateCcw size={13} />
                      Reset to Defaults
                    </button>
                  </div>

                  <div style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(3, 1fr)",
                    gap: 8,
                  }}>
                    {Object.entries(THEME_PRESETS).map(([key, preset]) => {
                      const isSelected = activeTheme === key;
                      return (
                        <button
                          key={key}
                          onClick={() => switchTheme(key)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "8px 10px",
                            borderRadius: 6,
                            border: isSelected ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                            background: isSelected ? "var(--accent-soft)" : "rgba(255,255,255,0.02)",
                            color: isSelected ? "var(--text)" : "var(--text-muted)",
                            cursor: "pointer",
                            outline: "none",
                            textAlign: "left",
                            transition: "all 0.15s ease"
                          }}
                        >
                          <div style={{
                            width: 14,
                            height: 14,
                            borderRadius: "50%",
                            background: preset.bg || preset.bgColor,
                            border: "1px solid rgba(255,255,255,0.2)",
                            boxShadow: `0 0 6px ${preset.accent || preset.upColor}40`,
                            flexShrink: 0
                          }} />
                          <span style={{ fontSize: 12, fontWeight: isSelected ? 600 : 400, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {preset.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Surfaces & Layout Section */}
                <div>
                  <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", marginBottom: 10 }}>Workspace & Surfaces</h3>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
                    <ThemeColorRow
                      label="Canvas & Background"
                      desc="Main chart backdrop and app body background"
                      varName="--bg"
                      colorKey="bg"
                      activeColors={activeColors}
                      onColorChange={updateThemeCustomColor}
                    />
                    <ThemeColorRow
                      label="Panel Surface"
                      desc="Sidebar, headers, toolbars & modal backdrops"
                      varName="--panel"
                      colorKey="panel"
                      activeColors={activeColors}
                      onColorChange={updateThemeCustomColor}
                    />
                    <ThemeColorRow
                      label="Elevated Panel"
                      desc="Card containers, inputs, dropdowns & nested surfaces"
                      varName="--panel-2"
                      colorKey="panel2"
                      activeColors={activeColors}
                      onColorChange={updateThemeCustomColor}
                    />
                  </div>
                </div>

                {/* Borders & Dividers Section */}
                <div>
                  <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", marginBottom: 10 }}>Borders & Dividers</h3>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
                    <ThemeColorRow
                      label="Structural Border"
                      desc="Grid lines, table dividers, panel frames"
                      varName="--border"
                      colorKey="border"
                      activeColors={activeColors}
                      onColorChange={updateThemeCustomColor}
                    />
                    <ThemeColorRow
                      label="Border Highlight"
                      desc="Active borders, hover state outlines & splitters"
                      varName="--border-hi"
                      colorKey="borderHi"
                      activeColors={activeColors}
                      onColorChange={updateThemeCustomColor}
                    />
                  </div>
                </div>

                {/* Typography Section */}
                <div>
                  <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", marginBottom: 10 }}>Typography</h3>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
                    <ThemeColorRow
                      label="Primary Text"
                      desc="Headlines, price scale ticks, primary labels"
                      varName="--text"
                      colorKey="text"
                      activeColors={activeColors}
                      onColorChange={updateThemeCustomColor}
                    />
                    <ThemeColorRow
                      label="Muted Text"
                      desc="Secondary labels, timestamps, subtle info"
                      varName="--muted"
                      colorKey="muted"
                      activeColors={activeColors}
                      onColorChange={updateThemeCustomColor}
                    />
                  </div>
                </div>

                {/* Brand & Accents Section */}
                <div>
                  <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", marginBottom: 10 }}>Brand & Accents</h3>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
                    <ThemeColorRow
                      label="Primary Accent"
                      desc="Selected tabs, CTA buttons, focus indicators"
                      varName="--accent"
                      colorKey="accent"
                      activeColors={activeColors}
                      onColorChange={updateThemeCustomColor}
                    />
                    <ThemeColorRow
                      label="Soft Accent Tint"
                      desc="Active row highlights, badge background tints"
                      varName="--accent-soft"
                      colorKey="accentSoft"
                      activeColors={activeColors}
                      onColorChange={updateThemeCustomColor}
                    />
                  </div>
                </div>

                {/* Market Colors Section */}
                <div>
                  <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", marginBottom: 10 }}>Market & Signals</h3>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
                    <ThemeColorRow
                      label="Bullish / Positive"
                      desc="Bullish bars, long positions, floating profit"
                      varName="--green"
                      colorKey="green"
                      activeColors={activeColors}
                      onColorChange={updateThemeCustomColor}
                    />
                    <ThemeColorRow
                      label="Bearish / Negative"
                      desc="Bearish bars, short positions, floating loss"
                      varName="--red"
                      colorKey="red"
                      activeColors={activeColors}
                      onColorChange={updateThemeCustomColor}
                    />
                    <ThemeColorRow
                      label="Warning / Alert"
                      desc="Session boxes, pending orders, alerts"
                      varName="--orange"
                      colorKey="orange"
                      activeColors={activeColors}
                      onColorChange={updateThemeCustomColor}
                    />
                    <ThemeColorRow
                      label="Structure / Special"
                      desc="Key levels, liquidity pools, fair value gaps"
                      varName="--purple"
                      colorKey="purple"
                      activeColors={activeColors}
                      onColorChange={updateThemeCustomColor}
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === "Broker Mapping" && (
              <BrokerSymbolMapping onClose={onClose} />
            )}

            {activeTab === "Canvas" && (
              <div>
                <h3 style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 16 }}>Background</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
                  <select
                    value={settings.bgType}
                    onChange={(e) => handleChange("bgType", e.target.value)}
                    style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", padding: "4px 8px", borderRadius: 4 }}
                  >
                    <option value="Solid">Solid</option>
                    <option value="Gradient">Gradient</option>
                  </select>
                  {settings.bgType === "Solid" ? (
                    <ColorPicker label="" settingKey="bgColor" settings={settings} handleChange={handleChange} />
                  ) : (
                    <div style={{ display: "flex", gap: 8 }}>
                      <ColorPicker label="Top" settingKey="bgGradientTop" settings={settings} handleChange={handleChange} />
                      <ColorPicker label="Bottom" settingKey="bgGradientBottom" settings={settings} handleChange={handleChange} />
                    </div>
                  )}
                </div>

                <h3 style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-muted)", margin: "24px 0 16px" }}>Grid & Lines</h3>
                <Checkbox label="Vertical Grid Lines" settingKey="gridVertEnabled" settings={settings} handleChange={handleChange} />
                {settings.gridVertEnabled !== false && (
                  <ColorPicker label="Vertical grid color" settingKey="gridVertColor" showAlpha settings={settings} handleChange={handleChange} />
                )}
                <Checkbox label="Horizontal Grid Lines" settingKey="gridHorzEnabled" settings={settings} handleChange={handleChange} />
                {settings.gridHorzEnabled !== false && (
                  <ColorPicker label="Horizontal grid color" settingKey="gridHorzColor" showAlpha settings={settings} handleChange={handleChange} />
                )}
                <ColorPicker label="Crosshair" settingKey="crosshairColor" showAlpha settings={settings} handleChange={handleChange} />
                
                <h3 style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-muted)", margin: "24px 0 16px" }}>Scales & Text</h3>
                <ColorPicker label="Text Color" settingKey="textColor" settings={settings} handleChange={handleChange} />
                <ColorPicker label="Lines Color" settingKey="linesColor" settings={settings} handleChange={handleChange} />
                
                <h3 style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-muted)", margin: "24px 0 16px" }}>Other</h3>
                <Checkbox label="Show Watermark" settingKey="watermark" settings={settings} handleChange={handleChange} />
                <ColorPicker label="Watermark Color" settingKey="watermarkColor" showAlpha settings={settings} handleChange={handleChange} />
              </div>
            )}

            {activeTab === "Advanced" && (
              <div>
                <h3 style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 16 }}>Global Platform Theme</h3>
                <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
                  <label style={{ fontSize: 13, color: "var(--text)" }}>App Theme:</label>
                  <select
                    value={settings.appTheme || "dark"}
                    onChange={(e) => switchTheme(e.target.value)}
                    style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", padding: "4px 8px", borderRadius: 4, width: 150 }}
                  >
                    <option value="dark">Dark Mode</option>
                    <option value="light">Light Mode</option>
                    <option value="navyblue">Navy Blue</option>
                    <option value="creamy">Creamy</option>
                    <option value="midnight">Midnight OLED</option>
                    <option value="matrix">Matrix</option>
                  </select>
                </div>

                <h3 style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 16 }}>Pro Features</h3>
                <Checkbox label="Dynamic Volatility Coloring (Glow on momentum)" settingKey="dynamicVolatility" settings={settings} handleChange={handleChange} />
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -8, marginLeft: 24, marginBottom: 16 }}>
                  Dynamically shifts candle border saturation based on real-time volume and tick momentum.
                </p>

                <Checkbox label="P&L Atmosphere (Background Hue Shift)" settingKey="pnlAtmosphere" settings={settings} handleChange={handleChange} />
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -8, marginLeft: 24 }}>
                  Subtly blends background gradients to green/red based on active floating position P&L on this symbol.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: isMobile ? "10px 14px" : "16px 24px",
          borderTop: "1px solid var(--border)",
          flexShrink: 0,
          background: isMobile ? "rgba(0,0,0,0.1)" : "transparent"
        }}>
          <button className="primary" onClick={onClose} style={{ padding: "6px 24px", width: isMobile ? "100%" : "auto" }}>Ok</button>
        </div>
      </div>
    </div>
  );
}
