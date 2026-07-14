import { useState, useEffect } from "react";

export const DEFAULT_CHART_SETTINGS = {
  // Symbol
  upColor: "#26a69a",
  downColor: "#ef5350",
  wickUpColor: "#26a69a",
  wickDownColor: "#ef5350",
  borderUpColor: "#000000",
  borderDownColor: "#000000",
  borderVisible: false,
  colorBasedOnPreviousClose: false,
  precision: "Default",
  timezone: "Local",
  
  // Canvas
  bgType: "Solid", // "Solid" or "Gradient"
  bgColor: "#0e1116",
  bgGradientTop: "#151a23",
  bgGradientBottom: "#0e1116",
  gridVertEnabled: true,
  gridHorzEnabled: true,
  gridVertColor: "#151a23",
  gridHorzColor: "#151a23",
  crosshairColor: "#758696",
  watermark: true,
  watermarkColor: "rgba(255, 255, 255, 0.04)",
  textColor: "#d7dce6",
  linesColor: "#232a38",
  
  // Margins
  marginTop: 10,
  marginBottom: 10,
  marginRight: 12,

  // Advanced / Institutional
  appTheme: "dark",         // Global UI theme: dark, light, midnight, matrix
  dynamicVolatility: false, // Glow candles on high volume/momentum
  pnlAtmosphere: false,     // Background hue shifts based on open positions
};

let currentSettings = { ...DEFAULT_CHART_SETTINGS };
const listeners = new Set();
const recentListeners = new Set();

let recentColors = ["#ef5350", "#26a69a", "#2962ff", "#ff9800", "#ffffff"];

try {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("ts_chart_settings");
    if (saved) {
      currentSettings = { ...DEFAULT_CHART_SETTINGS, ...JSON.parse(saved) };
    }
    const savedRecents = localStorage.getItem("ts_recent_colors");
    if (savedRecents) {
      recentColors = JSON.parse(savedRecents);
    }

    fetch("/api/settings").then(r => r.json()).then(d => {
      if (d.ok && d.settings) {
        let changed = false;
        if (d.settings.chartSettings) {
          currentSettings = { ...DEFAULT_CHART_SETTINGS, ...d.settings.chartSettings };
          localStorage.setItem("ts_chart_settings", JSON.stringify(currentSettings));
          changed = true;
          listeners.forEach((l) => l(currentSettings));
        }
        if (d.settings.recentColors) {
          recentColors = d.settings.recentColors;
          localStorage.setItem("ts_recent_colors", JSON.stringify(recentColors));
          recentListeners.forEach((l) => l(recentColors));
        }
      }
    }).catch(()=>{});
  }
} catch (err) {
  console.warn("Failed to load chart settings", err);
}

export function updateChartSettings(updates) {
  currentSettings = { ...currentSettings, ...updates };
  if (typeof window !== "undefined") {
    localStorage.setItem("ts_chart_settings", JSON.stringify(currentSettings));
    fetch("/api/settings", { method: "PATCH", body: JSON.stringify({ chartSettings: currentSettings }) }).catch(()=>{});
  }
  listeners.forEach((l) => l(currentSettings));
}

export function addRecentColor(hex) {
  if (!hex || hex === "transparent") return;
  const normalized = hex.substring(0, 7).toLowerCase(); // store base hex without alpha
  recentColors = [normalized, ...recentColors.filter(c => c !== normalized)].slice(0, 10);
  if (typeof window !== "undefined") {
    localStorage.setItem("ts_recent_colors", JSON.stringify(recentColors));
    fetch("/api/settings", { method: "PATCH", body: JSON.stringify({ recentColors }) }).catch(()=>{});
  }
  recentListeners.forEach((l) => l(recentColors));
}

export function useChartSettings() {
  const [settings, setSettings] = useState(currentSettings);

  useEffect(() => {
    const listener = (newSettings) => setSettings(newSettings);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);

  return [settings, updateChartSettings];
}

export function useRecentColors() {
  const [colors, setColors] = useState(recentColors);

  useEffect(() => {
    const listener = (newColors) => setColors(newColors);
    recentListeners.add(listener);
    return () => recentListeners.delete(listener);
  }, []);

  return colors;
}
