import React, { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { useChartSettings, useRecentColors, addRecentColor, switchTheme } from "../lib/chartSettings";

function parseColor(val) {
  if (!val) return { hex: "#ffffff", alpha: 100 };
  if (val.startsWith("rgba")) {
    const match = val.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (match) {
      const r = parseInt(match[1]).toString(16).padStart(2, '0');
      const g = parseInt(match[2]).toString(16).padStart(2, '0');
      const b = parseInt(match[3]).toString(16).padStart(2, '0');
      const a = match[4] ? Math.round(parseFloat(match[4]) * 100) : 100;
      return { hex: `#${r}${g}${b}`, alpha: a };
    }
  }
  if (val.startsWith("#")) {
    const hex = val.substring(0, 7);
    let alpha = 100;
    if (val.length === 9) {
      alpha = Math.round((parseInt(val.substring(7, 9), 16) / 255) * 100);
    }
    return { hex, alpha };
  }
  return { hex: "#ffffff", alpha: 100 };
}

function buildColor(hex, alpha) {
  if (alpha === 100) return hex;
  const aHex = Math.round((alpha / 100) * 255).toString(16).padStart(2, '0');
  return `${hex}${aHex}`;
}

const ColorPicker = ({ label, settingKey, showAlpha, settings, handleChange }) => {
  const { hex, alpha } = parseColor(settings[settingKey]);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef();
  const recentColors = useRecentColors();

  // Close popup on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Live update the chart
  const handleLiveChange = (colorStr) => {
    handleChange(settingKey, buildColor(colorStr, alpha));
  };

  // Add to recents ONLY when finished picking (dialog closes)
  const handleFinishedPicking = (colorStr) => {
    addRecentColor(colorStr);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12, position: "relative" }}>
      <label style={{ fontSize: 13, color: "var(--text-muted)", flex: 1 }}>{label}</label>
      
      {/* The main swatch that opens the popup */}
      <div 
        onClick={() => setOpen(!open)}
        style={{ width: 24, height: 24, borderRadius: 4, background: buildColor(hex, alpha), cursor: "pointer", border: "1px solid var(--border-hi)", flexShrink: 0 }}
      />

      {open && (
        <div ref={popoverRef} style={{
          position: "absolute", top: 28, right: 0, background: "var(--panel)", border: "1px solid var(--border-hi)",
          borderRadius: 8, padding: 12, zIndex: 100, boxShadow: "0 8px 32px rgba(0,0,0,0.6)", width: 220
        }}>
          
          {/* Custom OS Color Picker Button */}
          <div style={{ position: "relative", height: 32, borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", marginBottom: 12, overflow: "hidden" }}>
             <span style={{ fontSize: 12, color: "var(--text)", pointerEvents: "none" }}>Open Color Map</span>
             <input 
               type="color" 
               value={hex} 
               onChange={(e) => handleLiveChange(e.target.value)} 
               onBlur={(e) => handleFinishedPicking(e.target.value)}
               style={{ opacity: 0, position: "absolute", inset: -10, width: "150%", height: "150%", cursor: "pointer" }} 
             />
          </div>

          <div style={{ height: 1, background: "var(--border)", margin: "8px 0" }} />

          {/* Recent Colors */}
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Recently Used</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: showAlpha ? 12 : 0 }}>
            {recentColors.map(c => (
              <div key={c} onClick={() => { handleLiveChange(c); handleFinishedPicking(c); setOpen(false); }} style={{
                width: 20, height: 20, borderRadius: 4, background: c, cursor: "pointer", boxSizing: "border-box",
                border: hex === c ? "2px solid var(--accent)" : "1px solid transparent"
              }} />
            ))}
          </div>

          {/* Opacity */}
          {showAlpha && (
            <>
              <div style={{ height: 1, background: "var(--border)", margin: "8px 0" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)", width: 40 }}>Opacity</span>
                <input type="range" min="0" max="100" value={alpha} onChange={(e) => handleChange(settingKey, buildColor(hex, parseInt(e.target.value)))} style={{ flex: 1, accentColor: "var(--accent)" }} />
                <span style={{ fontSize: 11, color: "var(--text-muted)", width: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{alpha}%</span>
              </div>
            </>
          )}
        </div>
      )}
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

export default function ChartSettingsModal({ onClose }) {
  const [settings, updateSettings] = useChartSettings();
  const [activeTab, setActiveTab] = useState("Symbol");

  const TABS = ["Symbol", "Canvas", "Advanced"];

  const handleChange = (key, value) => {
    updateSettings({ [key]: value });
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.5)"
    }}>
      <div style={{
        background: "var(--panel)", width: 700, height: 500, borderRadius: 12,
        display: "flex", flexDirection: "column", border: "1px solid var(--border)",
        boxShadow: "0 20px 40px rgba(0,0,0,0.5)", overflow: "hidden"
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Chart settings</h2>
          <X size={20} style={{ cursor: "pointer", color: "var(--text-muted)" }} onClick={onClose} />
        </div>

        {/* Body */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Sidebar */}
          <div style={{ width: 160, borderRight: "1px solid var(--border)", padding: "12px 0", overflowY: "auto" }}>
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

          {/* Content */}
          <div style={{ flex: 1, padding: "24px", overflowY: "auto" }}>
            {activeTab === "Symbol" && (
              <div>
                <h3 style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 16 }}>Candles</h3>
                
                <div style={{ display: "flex", gap: 32 }}>
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
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "16px 24px", borderTop: "1px solid var(--border)" }}>
          <button className="primary" onClick={onClose} style={{ padding: "6px 24px" }}>Ok</button>
        </div>
      </div>
    </div>
  );
}
