"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Save, Repeat, Bell, BellPlus, Sidebar, LayoutGrid, Activity, ExternalLink, Power, Menu, X, Settings, Trash2, Wrench, BookOpen, Sun, Moon, Palette, Coffee, Compass, Zap, ChevronDown, Clock, Radar } from "lucide-react";
import { LayoutIcon } from "../lib/layouts";
import IndicatorsMenu from "./IndicatorsMenu";
import { useChartSettings, switchTheme, THEME_PRESETS } from "../lib/chartSettings";
import { tradeRiskTelemetry, formatR } from "./autonomous/TradeTelemetry";

const TFS = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
const TF_LABEL = { M1: "1m", M5: "5m", M15: "15m", M30: "30m", H1: "1h", H4: "4h", D1: "1D" };

const THEME_LIST = [
  { id: "dark", label: "Dark", icon: Moon, desc: "Classic dark mode" },
  { id: "light", label: "Light", icon: Sun, desc: "Clean light mode" },
  { id: "navyblue", label: "Navy Blue", icon: Compass, desc: "Institutional navy" },
  { id: "creamy", label: "Creamy", icon: Coffee, desc: "Warm parchment" },
];

export default function TopBar({ 
  symbol, tf, setTf, tick, ticks, connected, onOpenPalette, onAddAlert, 
  onOpenAlerts, activeAlertCount, onOpenMarketBias, biasEnabled, onToggleBias,
  onOpenPip, isPipActive,
  layout, setLayout, syncOpts, setSyncOpts,
  watchlistOpen, setWatchlistOpen,
  savedLayouts, onLoadLayout, onOpenSaveLayout, onOpenLoop,
  indicators, setIndicators,
  loadedLayoutId, onUpdateLayout, onRenameLayout, onDeleteLayout,
  onOpenCorrelated, onOpenStrength,
  onOpenAutoCockpit, autoCockpitOpen, autonomousTrades = [],
  radarPairs = []
}) {
  const digits = tick?.digits ?? 5;
  const [settings] = useChartSettings();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeTheme = mounted ? (settings.appTheme || "dark") : "dark";

  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileTfOpen, setMobileTfOpen] = useState(false);
  const layoutMenuRef = useRef(null);
  const toolsMenuRef = useRef(null);
  const themeMenuRef = useRef(null);
  const mobileLayoutMenuRef = useRef(null);
  const mobileTfRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (showLayoutMenu) {
        const clickedDesktop = layoutMenuRef.current && layoutMenuRef.current.contains(e.target);
        const clickedMobile = mobileLayoutMenuRef.current && mobileLayoutMenuRef.current.contains(e.target);
        if (!clickedDesktop && !clickedMobile) setShowLayoutMenu(false);
      }
      if (toolsMenuOpen) {
        const clickedTools = toolsMenuRef.current && toolsMenuRef.current.contains(e.target);
        if (!clickedTools) setToolsMenuOpen(false);
      }
      if (themeMenuOpen) {
        const clickedTheme = themeMenuRef.current && themeMenuRef.current.contains(e.target);
        if (!clickedTheme) setThemeMenuOpen(false);
      }
      if (mobileTfOpen) {
        const clickedMobileTf = mobileTfRef.current && mobileTfRef.current.contains(e.target);
        if (!clickedMobileTf) setMobileTfOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showLayoutMenu, toolsMenuOpen, themeMenuOpen, mobileTfOpen]);
  
  const [isCompactTf, setIsCompactTf] = useState(false);

  useEffect(() => {
    const checkCompact = () => {
      if (typeof window === "undefined") return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const isLandscape = window.matchMedia("(orientation: landscape)").matches || (w > h && w <= 1024);
      const isMobileLandscape = isLandscape && h <= 550;
      setIsCompactTf(w <= 1080 || isMobileLandscape || h <= 500);
    };
    checkCompact();
    window.addEventListener("resize", checkCompact);
    window.addEventListener("orientationchange", checkCompact);
    return () => {
      window.removeEventListener("resize", checkCompact);
      window.removeEventListener("orientationchange", checkCompact);
    };
  }, []);

  const toggleSync = (key) => setSyncOpts(prev => ({ ...prev, [key]: !prev[key] }));

  // Autonomous Trades Telemetry for TopBar status badge
  const activeAutoTrades = (autonomousTrades || []).filter((t) =>
    ["active", "managing", "closing", "open", "filling", "armed_fill"].includes(t.status)
  );
  const stagedAutoTrades = (autonomousTrades || []).filter((t) =>
    ["staged", "confirming", "armed"].includes(t.status)
  );

  const symbolStagedTrades = stagedAutoTrades.filter((t) => {
    if (!t || !symbol) return false;
    const sCanon = symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const tCanon = (t.symbol || t.tradeableSymbol || t.canonicalSymbol || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    return tCanon.includes(sCanon) || sCanon.includes(tCanon);
  });
  const symbolStagedCount = symbolStagedTrades.length;

  const symbolRadarPairs = (radarPairs || []).filter((p) => {
    if (!p || !symbol || p.dir === 0) return false;
    const sCanon = symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const pCanon = (p.symbol || p.tradeableSymbol || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    return pCanon.includes(sCanon) || sCanon.includes(pCanon);
  });
  const symbolRadarCount = symbolRadarPairs.length;

  let autoNetR = 0;
  let hasAutoR = false;
  activeAutoTrades.forEach((t) => {
    const tel = tradeRiskTelemetry(t, ticks || {});
    if (tel.priceR !== null) {
      autoNetR += tel.priceR;
      hasAutoR = true;
    }
  });
  const isAutoNetProfit = autoNetR >= 0;

  return (
    <header className="topbar-header" style={{
      display: "flex", alignItems: "center", gap: 8, padding: "0 12px",
      height: 40, minHeight: 40, maxHeight: 40,
      background: "var(--panel)", borderBottom: "1px solid var(--border)",
      flexWrap: "nowrap", position: "relative", zIndex: 100
    }}>
      <div className="logo-text hide-mobile" style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.2, whiteSpace: "nowrap", flexShrink: 0 }}>
        Trade<span style={{ color: "var(--accent)" }}>Space</span>
      </div>

      <button className="primary symbol-btn" onClick={onOpenPalette} title="Switch symbol (Ctrl+K or /)"
        style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>
        <span style={{ opacity: 0.8 }}>⌕</span> {symbol}
      </button>

      <div style={{ position: "relative", flexShrink: 0 }}>
        <button 
          className={toolsMenuOpen ? "primary" : "ghost"} 
          onClick={() => setToolsMenuOpen(!toolsMenuOpen)} 
          title="Tools & Analytics" 
          aria-label="Tools & Analytics"
          style={{ padding: "4px 8px", fontSize: 12, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
        >
          <Wrench size={14} />
        </button>

        {toolsMenuOpen && (
          <div ref={toolsMenuRef} style={{
            position: "absolute", top: "100%", left: 0, marginTop: 8,
            background: "var(--panel)", border: "1px solid var(--border)",
            borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 4,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 110, width: 220
          }}>
            <button className="dropdown-btn" onClick={() => { onOpenStrength(); setToolsMenuOpen(false); }}>
              <Activity size={14} /> Currency Strength Meter
            </button>
            <button className="dropdown-btn" onClick={() => { onOpenCorrelated(); setToolsMenuOpen(false); }}>
              <LayoutGrid size={14} /> Correlated Pairs
            </button>
            <button className="dropdown-btn" onClick={() => { onOpenMarketBias(); setToolsMenuOpen(false); }}>
              <Activity size={14} /> Master Market Bias
            </button>
            <Link href="/autonomous" className="dropdown-btn" onClick={() => setToolsMenuOpen(false)}>
              <Zap size={14} style={{ color: "var(--accent)" }} /> Autonomous
            </Link>
            <Link href="/autonomous?section=journal" className="dropdown-btn" onClick={() => setToolsMenuOpen(false)}>
              <BookOpen size={14} /> Journal
            </Link>
            <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
            <button 
              className="dropdown-btn" 
              onClick={() => { onToggleBias(); setToolsMenuOpen(false); }}
              style={{ color: biasEnabled ? "var(--green)" : "var(--muted)", fontWeight: 600 }}
            >
              <Power size={14} style={{ color: biasEnabled ? "var(--green)" : "var(--muted)" }} /> Bias Engine: {biasEnabled ? "ON" : "OFF"}
            </button>
          </div>
        )}
      </div>

      {/* Desktop Timeframe Buttons (Full 7 buttons on wide screens) */}
      <div className={`tf-container tf-full-group ${isCompactTf ? "hidden-tf" : ""}`} style={{ gap: 4, flexShrink: 0 }}>
        {TFS.map((t) => (
          <button
            key={t}
            onClick={() => setTf(t)}
            className={`tf-btn ${tf === t ? "primary" : "ghost"}`}
            style={{ padding: "4px 9px", fontSize: 12, whiteSpace: "nowrap", flexShrink: 0 }}
          >
            {TF_LABEL[t]}
          </button>
        ))}
      </div>

      {/* Collapsed Timeframe Dropdown (Active on Mobile Portrait, Mobile Landscape, and Compact Viewports) */}
      <div className={`tf-dropdown-group ${isCompactTf ? "visible-tf" : ""}`} style={{ position: "relative", flexShrink: 0 }} ref={mobileTfRef}>
        <button
          className="primary"
          onClick={() => setMobileTfOpen(!mobileTfOpen)}
          title="Select Timeframe"
          aria-label="Select Timeframe"
          style={{
            padding: "4px 8px",
            fontSize: 12,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 4,
            borderRadius: 6,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          <span>{TF_LABEL[tf] || tf}</span>
          <ChevronDown size={12} />
        </button>

        {mobileTfOpen && (
          <>
            <div
              style={{ position: "fixed", inset: 0, zIndex: 120 }}
              onClick={() => setMobileTfOpen(false)}
            />
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                marginTop: 6,
                background: "var(--panel)",
                border: "1px solid var(--border-hi)",
                borderRadius: 8,
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.6)",
                zIndex: 130,
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 4,
                padding: 6,
                minWidth: 160,
              }}
            >
              {TFS.map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setTf(t);
                    setMobileTfOpen(false);
                  }}
                  className={tf === t ? "primary" : "ghost"}
                  style={{
                    padding: "6px 8px",
                    fontSize: 12,
                    fontWeight: tf === t ? 700 : 500,
                    borderRadius: 4,
                    textAlign: "center",
                    justifyContent: "center",
                  }}
                >
                  {TF_LABEL[t]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Mobile Top Controls: Quick Auto Cockpit Button + Hamburger Menu */}
      <div className="hide-desktop" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
        <button
          className={autoCockpitOpen ? "primary" : "ghost"}
          onClick={onOpenAutoCockpit}
          title="Open Autonomous Cockpit"
          style={{
            padding: "4px 8px",
            fontSize: 11,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 4,
            borderRadius: 6,
            border: activeAutoTrades.length > 0
              ? `1px solid ${isAutoNetProfit ? "rgba(38, 166, 154, 0.5)" : "rgba(239, 83, 80, 0.5)"}`
              : "1px solid var(--border)",
            background: activeAutoTrades.length > 0
              ? (isAutoNetProfit ? "rgba(38, 166, 154, 0.15)" : "rgba(239, 83, 80, 0.15)")
              : "transparent",
            color: activeAutoTrades.length > 0
              ? (isAutoNetProfit ? "var(--green)" : "var(--red)")
              : "var(--text)",
          }}
        >
          <Zap size={12} style={{ color: activeAutoTrades.length > 0 ? (isAutoNetProfit ? "var(--green)" : "var(--red)") : "var(--accent)" }} />
          <span>{activeAutoTrades.length > 0 ? `${activeAutoTrades.length}A` : "Auto"}</span>
          {activeAutoTrades.length > 0 && hasAutoR && (
            <span style={{ fontFamily: "monospace", fontSize: 10 }}>{formatR(autoNetR)}</span>
          )}
        </button>

        <button className="ghost" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} style={{ padding: "4px 8px" }}>
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      <div className="hide-mobile" style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
        <div style={{ position: "relative", borderLeft: "1px solid var(--border)", paddingLeft: 8, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <button 
          className={showLayoutMenu ? "primary" : "ghost"} 
          onClick={() => setShowLayoutMenu(!showLayoutMenu)} 
          title="Layout Settings"
          aria-label="Layout Settings"
          style={{ padding: "4px 8px", display: "flex", alignItems: "center", fontSize: 12, flexShrink: 0 }}
        >
          <LayoutGrid size={14} />
        </button>
        {layout === "1" && (
          <button className="ghost" onClick={onOpenLoop} title="Start Slideshow Loop" aria-label="Start Slideshow Loop" style={{ padding: "4px 8px", display: "flex", alignItems: "center", fontSize: 12, flexShrink: 0 }}>
            <Repeat size={14} />
          </button>
        )}

        {showLayoutMenu && (
          <div ref={layoutMenuRef} style={{
            position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 100,
            background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6,
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)", padding: 12, width: 280,
            display: "flex", flexDirection: "column", gap: 12
          }}>
            <div>
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8, textTransform: "uppercase", fontWeight: 600 }}>Grid</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  ["1"],
                  ["2v", "2h"],
                  ["3v", "3h", "3a", "3b", "3c", "3d"],
                  ["4", "4h", "4v", "4c", "4d"],
                  ["5a", "5b"],
                  ["6", "6h", "6v"],
                  ["8", "8v"]
                ].map((row, rIdx) => (
                  <div key={rIdx} style={{ display: "flex", gap: 8, alignItems: "center", borderBottom: rIdx < 6 ? "1px solid var(--border)" : "none", paddingBottom: rIdx < 6 ? 6 : 0 }}>
                    <div className="muted" style={{ width: 14, fontSize: 10, textAlign: "center", fontWeight: "bold" }}>{row[0].replace(/[^0-9]/g, '')}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
                      {row.map(l => (
                         <LayoutIcon key={l} layoutId={l} isActive={layout === l} onClick={() => setLayout(l)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4, textTransform: "uppercase", fontWeight: 600 }}>Sync Across Charts</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                <button className={syncOpts.symbol ? "primary" : "ghost"} onClick={() => toggleSync("symbol")} style={{padding: "2px 6px", fontSize: 11}}>SYM</button>
                <button className={syncOpts.tf ? "primary" : "ghost"} onClick={() => toggleSync("tf")} style={{padding: "2px 6px", fontSize: 11}}>TF</button>
                <button className={syncOpts.time ? "primary" : "ghost"} onClick={() => toggleSync("time")} style={{padding: "2px 6px", fontSize: 11}}>TIME</button>
                <button className={syncOpts.crosshair ? "primary" : "ghost"} onClick={() => toggleSync("crosshair")} style={{padding: "2px 6px", fontSize: 11}}>CROSS</button>
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", fontWeight: 600 }}>Saved Layouts</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {loadedLayoutId && (
                    <button className="ghost" onClick={() => { onUpdateLayout(loadedLayoutId); setShowLayoutMenu(false); }} title="Save Current" style={{padding: "2px 6px", fontSize: 11}}>Save</button>
                  )}
                  <button className="ghost" onClick={() => { onOpenSaveLayout(); setShowLayoutMenu(false); }} title="Save As New" style={{padding: "2px 6px", fontSize: 11}}>Save As</button>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 150, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 4, padding: 4 }}>
                {savedLayouts && savedLayouts.length > 0 ? savedLayouts.map(l => (
                  <div key={l._id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px", background: l._id === loadedLayoutId ? "rgba(41,98,255,0.15)" : "transparent", borderRadius: 4 }}>
                    <div onClick={() => { onLoadLayout(l._id); setShowLayoutMenu(false); }} style={{ cursor: "pointer", flex: 1, fontSize: 12, fontWeight: l._id === loadedLayoutId ? 700 : 400 }}>
                      {l.name}
                    </div>
                    <button className="ghost danger" onClick={(e) => { e.stopPropagation(); onDeleteLayout(l._id); }} style={{ padding: 4 }} title="Delete Layout">
                      <Trash2 size={12} />
                    </button>
                  </div>
                )) : (
                  <div className="muted" style={{ fontSize: 11, padding: 4, textAlign: "center" }}>No saved layouts</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <IndicatorsMenu indicators={indicators} setIndicators={setIndicators} />

      {/* Desktop Taskbar: Auto Trades Indicator Toggle */}
      <button
        className={`hide-mobile ${indicators?.autoTrades !== false ? "primary" : "ghost"}`}
        onClick={() => {
          setIndicators?.((prev) => ({ ...prev, autoTrades: prev?.autoTrades === false ? true : false }));
        }}
        title="Toggle Autonomous Trades Overlay on Chart (RR & Live P&L)"
        aria-label="Toggle Auto Trades Overlay"
        style={{
          padding: "4px 8px",
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          fontWeight: 600,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        <Zap size={14} style={{ color: indicators?.autoTrades !== false ? "#fff" : "var(--accent)" }} />
      </button>

      {/* Desktop Taskbar: Staged Trades Indicator Toggle */}
      <button
        className={`hide-mobile ${indicators?.stagedTrades !== false ? "primary" : "ghost"}`}
        onClick={() => {
          setIndicators?.((prev) => ({ ...prev, stagedTrades: prev?.stagedTrades === false ? true : false }));
        }}
        title="Toggle Staged Setups Overlay on Chart (Pending RR & Targets)"
        aria-label="Toggle Staged Setups Overlay"
        style={{
          padding: "4px 8px",
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontWeight: 600,
          whiteSpace: "nowrap",
          flexShrink: 0,
          background: indicators?.stagedTrades !== false ? "rgba(245, 158, 11, 0.2)" : "transparent",
          border: indicators?.stagedTrades !== false ? "1px solid rgba(245, 158, 11, 0.45)" : "1px solid transparent",
          color: indicators?.stagedTrades !== false ? "#fbbf24" : "var(--muted)",
        }}
      >
        <Clock size={14} style={{ color: indicators?.stagedTrades !== false ? "#fbbf24" : "var(--muted)" }} />
        {symbolStagedCount > 0 && (
          <span
            style={{
              fontSize: 10,
              padding: "1px 5px",
              borderRadius: 8,
              background: "#f59e0b",
              color: "#000",
              fontWeight: 800,
            }}
          >
            {symbolStagedCount}
          </span>
        )}
      </button>

      {/* Desktop Taskbar: Radar Ideas Indicator Toggle */}
      <button
        className={`hide-mobile ${indicators?.radarTrades !== false ? "primary" : "ghost"}`}
        onClick={() => {
          setIndicators?.((prev) => ({ ...prev, radarTrades: prev?.radarTrades === false ? true : false }));
        }}
        title="Toggle Market Opportunity Radar Ideas Overlay on Chart (Violet & Orange RR Box)"
        aria-label="Toggle Radar Ideas Overlay"
        style={{
          padding: "4px 8px",
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontWeight: 600,
          whiteSpace: "nowrap",
          flexShrink: 0,
          background: indicators?.radarTrades !== false ? "rgba(168, 85, 247, 0.2)" : "transparent",
          border: indicators?.radarTrades !== false ? "1px solid rgba(168, 85, 247, 0.45)" : "1px solid transparent",
          color: indicators?.radarTrades !== false ? "var(--purple, #c084fc)" : "var(--muted)",
        }}
      >
        <Radar size={14} style={{ color: indicators?.radarTrades !== false ? "#c084fc" : "var(--muted)" }} />
        {symbolRadarCount > 0 && (
          <span
            style={{
              fontSize: 10,
              padding: "1px 5px",
              borderRadius: 8,
              background: "#a855f7",
              color: "#ffffff",
              fontWeight: 800,
            }}
          >
            {symbolRadarCount}
          </span>
        )}
      </button>

      <div style={{ position: "relative", flexShrink: 0 }} className="hide-mobile">
        <button
          className={themeMenuOpen ? "primary" : "ghost"}
          onClick={() => setThemeMenuOpen(!themeMenuOpen)}
          title={`Theme: ${THEME_LIST.find(t => t.id === activeTheme)?.label || "Dark"}`}
          aria-label="Switch Theme"
          style={{ padding: "4px 8px", fontSize: 12, display: "flex", alignItems: "center", flexShrink: 0 }}
        >
          {activeTheme === "light" ? <Sun size={14} /> :
           activeTheme === "navyblue" ? <Compass size={14} /> :
           activeTheme === "creamy" ? <Coffee size={14} /> :
           <Moon size={14} />}
        </button>

        {themeMenuOpen && (
          <div ref={themeMenuRef} style={{
            position: "absolute", top: "100%", left: 0, marginTop: 4,
            background: "var(--panel)", border: "1px solid var(--border)",
            borderRadius: 8, padding: 6, display: "flex", flexDirection: "column", gap: 4,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 110, width: 170
          }}>
            <div style={{ fontSize: 10, opacity: 0.6, padding: "4px 8px", textTransform: "uppercase", fontWeight: 700 }}>Theme Mode</div>
            {THEME_LIST.map((t) => {
              const IconComp = t.icon;
              const isActive = activeTheme === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => { switchTheme(t.id); setThemeMenuOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
                    background: isActive ? "var(--accent-soft)" : "transparent",
                    color: isActive ? "var(--accent)" : "var(--text)",
                    fontWeight: isActive ? 600 : 400,
                    borderRadius: 6, border: "none", cursor: "pointer", textAlign: "left", width: "100%",
                    fontSize: 12
                  }}
                >
                  <IconComp size={14} />
                  <span style={{ flex: 1 }}>{t.label}</span>
                  {isActive && <span style={{ fontSize: 11 }}>✓</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginLeft: "auto", alignItems: "center", flexShrink: 0 }}>
        {/* Autonomous Live Cockpit Trigger */}
        <button
          className={autoCockpitOpen ? "primary" : "ghost"}
          onClick={onOpenAutoCockpit}
          title={`Autonomous Cockpit${activeAutoTrades.length > 0 ? ` (${activeAutoTrades.length} Active${hasAutoR ? ` · ${formatR(autoNetR)}` : ""})` : stagedAutoTrades.length > 0 ? ` (${stagedAutoTrades.length} Staged)` : " (Idle)"}`}
          aria-label="Toggle Autonomous Cockpit"
          style={{
            fontSize: 12,
            padding: "4px 8px",
            display: "flex",
            alignItems: "center",
            gap: 5,
            borderRadius: 6,
            border: activeAutoTrades.length > 0
              ? `1px solid ${isAutoNetProfit ? "rgba(38, 166, 154, 0.45)" : "rgba(239, 83, 80, 0.45)"}`
              : "1px solid var(--border)",
            background: activeAutoTrades.length > 0
              ? (isAutoNetProfit ? "rgba(38, 166, 154, 0.12)" : "rgba(239, 83, 80, 0.12)")
              : "transparent",
            color: activeAutoTrades.length > 0
              ? (isAutoNetProfit ? "var(--green)" : "var(--red)")
              : "var(--fg)",
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
            transition: "all 0.15s ease",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: activeAutoTrades.length > 0
                ? (isAutoNetProfit ? "var(--green)" : "var(--red)")
                : stagedAutoTrades.length > 0
                ? "var(--accent)"
                : "var(--muted)",
              boxShadow: activeAutoTrades.length > 0
                ? (isAutoNetProfit ? "0 0 6px var(--green)" : "0 0 6px var(--red)")
                : "none",
            }}
          />
          <Zap size={13} style={{ color: activeAutoTrades.length > 0 ? (isAutoNetProfit ? "var(--green)" : "var(--red)") : "var(--accent)" }} />
          {activeAutoTrades.length > 0 ? (
            <span style={{ fontFamily: "monospace", fontSize: 11 }}>
              {activeAutoTrades.length}A{hasAutoR ? ` · ${formatR(autoNetR)}` : ""}
            </span>
          ) : stagedAutoTrades.length > 0 ? (
            <span style={{ fontSize: 11, color: "var(--accent)" }}>{stagedAutoTrades.length}S</span>
          ) : null}
        </button>

        {layout === "1" && (
          <button 
            className="ghost" 
            onClick={onOpenPip} 
            title={isPipActive ? "Floating Window Active" : "Pop out chart to floating window (PiP)"} 
            aria-label="Picture in Picture"
            style={{ fontSize: 12, padding: "4px 8px", display: "flex", alignItems: "center", color: isPipActive ? "var(--brand)" : "inherit", flexShrink: 0 }}
          >
            <ExternalLink size={14} />
          </button>
        )}
        <button className="ghost" onClick={onOpenAlerts} title="View Alerts" aria-label="View Alerts" style={{ fontSize: 12, padding: "4px 8px", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <Bell size={14} />
          {activeAlertCount > 0 && (
            <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 8, background: "var(--accent)", color: "#fff", fontWeight: 700 }}>
              {activeAlertCount}
            </span>
          )}
        </button>
        <button onClick={onAddAlert} title="Create alert at market price" aria-label="Create Alert" style={{ fontSize: 12, padding: "4px 8px", display: "flex", alignItems: "center", flexShrink: 0 }}>
          <BellPlus size={14} />
        </button>
        <button className="ghost hide-mobile" onClick={() => setWatchlistOpen(!watchlistOpen)} title={watchlistOpen ? "Hide Watchlist" : "Show Watchlist"} aria-label="Toggle Watchlist" style={{ fontSize: 12, padding: "4px 8px", display: "flex", alignItems: "center", flexShrink: 0 }}>
          <Sidebar size={14} />
        </button>
      </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {tick && (
          <div className="num hide-mobile" style={{ fontSize: 15, fontWeight: 600 }}>
            <span className={tick.dir >= 0 ? "up" : "down"}>{Number(tick.bid).toFixed(digits)}</span>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }} className="muted">
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: connected ? "var(--green)" : "var(--red)",
            animation: connected ? "none" : "pulse 1.2s infinite",
          }} />
          <span className="hide-mobile">{connected ? "live" : "reconnecting"}</span>
        </div>
      </div>

      {/* Mobile Dropdown Menu */}
      {mobileMenuOpen && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100,
          background: "var(--panel)", borderBottom: "1px solid var(--border)",
          padding: 12, display: "flex", flexDirection: "column", gap: 12,
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)"
        }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className={showLayoutMenu ? "primary" : "ghost"} onClick={() => setShowLayoutMenu(!showLayoutMenu)} style={{ padding: "4px 8px", display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <LayoutGrid size={14} /> Layout
            </button>
            {layout === "1" && (
              <button className="ghost" onClick={() => { onOpenLoop(); setMobileMenuOpen(false); }} title="Start Slideshow Loop" style={{ padding: "4px 8px", display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <Repeat size={14} /> Loop
              </button>
            )}
            <IndicatorsMenu indicators={indicators} setIndicators={setIndicators} />
          </div>

          {/* Mobile Theme Selector */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}>
            <div style={{ fontSize: 10, opacity: 0.6, textTransform: "uppercase", fontWeight: 700 }}>Color Theme</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {THEME_LIST.map((t) => {
                const IconComp = t.icon;
                const isActive = activeTheme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => { switchTheme(t.id); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", fontSize: 12,
                      background: isActive ? "var(--accent)" : "var(--panel-2)",
                      color: isActive ? "#ffffff" : "var(--text)",
                      border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                      borderRadius: 6, cursor: "pointer", fontWeight: isActive ? 600 : 400,
                      justifyContent: "center"
                    }}
                  >
                    <IconComp size={14} />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {showLayoutMenu && (
            <div ref={mobileLayoutMenuRef} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8, textTransform: "uppercase", fontWeight: 600 }}>Grid</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[
                    ["1"],
                    ["2v", "2h"],
                    ["3v", "3h", "3a", "3b", "3c", "3d"],
                    ["4", "4h", "4v", "4c", "4d"],
                    ["5a", "5b"],
                    ["6", "6h", "6v"],
                    ["8", "8v"]
                  ].map((row, rIdx) => (
                    <div key={rIdx} style={{ display: "flex", gap: 8, alignItems: "center", borderBottom: rIdx < 6 ? "1px solid var(--border)" : "none", paddingBottom: rIdx < 6 ? 6 : 0 }}>
                      <div className="muted" style={{ width: 14, fontSize: 10, textAlign: "center", fontWeight: "bold" }}>{row[0].replace(/[^0-9]/g, '')}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
                        {row.map(l => (
                           <LayoutIcon 
                             key={l} 
                             layoutId={l} 
                             isActive={layout === l} 
                             onClick={() => { 
                               setLayout(l); 
                               setShowLayoutMenu(false); 
                               setMobileMenuOpen(false); 
                             }} 
                           />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4, textTransform: "uppercase", fontWeight: 600 }}>Sync Across Charts</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <button className={syncOpts.symbol ? "primary" : "ghost"} onClick={() => toggleSync("symbol")} style={{padding: "2px 6px", fontSize: 11}}>SYM</button>
                  <button className={syncOpts.tf ? "primary" : "ghost"} onClick={() => toggleSync("tf")} style={{padding: "2px 6px", fontSize: 11}}>TF</button>
                  <button className={syncOpts.time ? "primary" : "ghost"} onClick={() => toggleSync("time")} style={{padding: "2px 6px", fontSize: 11}}>TIME</button>
                  <button className={syncOpts.crosshair ? "primary" : "ghost"} onClick={() => toggleSync("crosshair")} style={{padding: "2px 6px", fontSize: 11}}>CROSS</button>
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", fontWeight: 600 }}>Saved Layouts</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {loadedLayoutId && (
                      <button className="ghost" onClick={() => { onUpdateLayout(loadedLayoutId); setShowLayoutMenu(false); setMobileMenuOpen(false); }} title="Save Current" style={{padding: "2px 6px", fontSize: 11}}>Save</button>
                    )}
                    <button className="ghost" onClick={() => { onOpenSaveLayout(); setShowLayoutMenu(false); setMobileMenuOpen(false); }} title="Save As New" style={{padding: "2px 6px", fontSize: 11}}>Save As</button>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 150, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 4, padding: 4 }}>
                  {savedLayouts && savedLayouts.length > 0 ? savedLayouts.map(l => (
                    <div key={l._id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px", background: l._id === loadedLayoutId ? "rgba(41,98,255,0.15)" : "transparent", borderRadius: 4 }}>
                      <div onClick={() => { onLoadLayout(l._id); setShowLayoutMenu(false); setMobileMenuOpen(false); }} style={{ cursor: "pointer", flex: 1, fontSize: 12, fontWeight: l._id === loadedLayoutId ? 700 : 400 }}>
                        {l.name}
                      </div>
                      <button className="ghost danger" onClick={(e) => { e.stopPropagation(); onDeleteLayout(l._id); }} style={{ padding: 4 }} title="Delete Layout">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )) : (
                    <div className="muted" style={{ fontSize: 11, padding: 4, textAlign: "center" }}>No saved layouts</div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              className="ghost"
              onClick={() => { setMobileMenuOpen(false); onOpenAutoCockpit?.(); }}
              style={{
                fontSize: 12,
                padding: "8px 10px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                justifyContent: "flex-start",
                borderRadius: 6,
                background: activeAutoTrades.length > 0
                  ? (isAutoNetProfit ? "rgba(38, 166, 154, 0.12)" : "rgba(239, 83, 80, 0.12)")
                  : "var(--panel-2)",
                border: "1px solid var(--border)",
                color: activeAutoTrades.length > 0
                  ? (isAutoNetProfit ? "var(--green)" : "var(--red)")
                  : "var(--text)",
                fontWeight: 600,
              }}
            >
              <Zap size={14} style={{ color: "var(--accent)" }} />
              <span>Live Autonomous Cockpit</span>
              {activeAutoTrades.length > 0 ? (
                <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 11, fontWeight: 700 }}>
                  {activeAutoTrades.length} Active {hasAutoR ? `(${formatR(autoNetR)})` : ""}
                </span>
              ) : stagedAutoTrades.length > 0 ? (
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--accent)" }}>
                  {stagedAutoTrades.length} Staged
                </span>
              ) : (
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>Idle</span>
              )}
            </button>
            <button
              className={indicators?.autoTrades !== false ? "primary" : "ghost"}
              onClick={() => {
                setIndicators?.((prev) => ({ ...prev, autoTrades: prev?.autoTrades === false ? true : false }));
              }}
              style={{
                fontSize: 12,
                padding: "8px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                justifyContent: "flex-start",
                background: indicators?.autoTrades !== false ? "rgba(41, 98, 255, 0.15)" : "transparent",
                color: indicators?.autoTrades !== false ? "var(--brand)" : "var(--text)",
                border: indicators?.autoTrades !== false ? "1px solid rgba(41, 98, 255, 0.3)" : "1px solid transparent",
                borderRadius: 6
              }}
            >
              <Zap size={14} style={{ color: "var(--accent)" }} />
              <span>Auto Trades Overlay</span>
              <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700 }}>
                {indicators?.autoTrades !== false ? "ON" : "OFF"}
              </span>
            </button>
            <button
              className={indicators?.stagedTrades !== false ? "primary" : "ghost"}
              onClick={() => {
                setIndicators?.((prev) => ({ ...prev, stagedTrades: prev?.stagedTrades === false ? true : false }));
              }}
              style={{
                fontSize: 12,
                padding: "8px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                justifyContent: "flex-start",
                background: indicators?.stagedTrades !== false ? "rgba(245, 158, 11, 0.15)" : "transparent",
                color: indicators?.stagedTrades !== false ? "#fbbf24" : "var(--text)",
                border: indicators?.stagedTrades !== false ? "1px solid rgba(245, 158, 11, 0.3)" : "1px solid transparent",
                borderRadius: 6
              }}
            >
              <Clock size={14} style={{ color: "#f59e0b" }} />
              <span>Staged Setups Overlay</span>
              {symbolStagedCount > 0 && (
                <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 8, background: "#f59e0b", color: "#000", fontWeight: 700 }}>
                  {symbolStagedCount}
                </span>
              )}
              <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700 }}>
                {indicators?.stagedTrades !== false ? "ON" : "OFF"}
              </span>
            </button>
            <button
              className={indicators?.radarTrades !== false ? "primary" : "ghost"}
              onClick={() => {
                setIndicators?.((prev) => ({ ...prev, radarTrades: prev?.radarTrades === false ? true : false }));
              }}
              style={{
                fontSize: 12,
                padding: "8px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                justifyContent: "flex-start",
                background: indicators?.radarTrades !== false ? "rgba(168, 85, 247, 0.15)" : "transparent",
                color: indicators?.radarTrades !== false ? "#c084fc" : "var(--text)",
                border: indicators?.radarTrades !== false ? "1px solid rgba(168, 85, 247, 0.3)" : "1px solid transparent",
                borderRadius: 6
              }}
            >
              <Radar size={14} style={{ color: "#c084fc" }} />
              <span>Radar Ideas Overlay</span>
              {symbolRadarCount > 0 && (
                <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 8, background: "#a855f7", color: "#ffffff", fontWeight: 700 }}>
                  {symbolRadarCount}
                </span>
              )}
              <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700 }}>
                {indicators?.radarTrades !== false ? "ON" : "OFF"}
              </span>
            </button>
            <button className="ghost" onClick={() => { setMobileMenuOpen(false); onOpenStrength(); }} style={{ fontSize: 12, padding: "8px", display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-start" }}>
              <Activity size={14} /> Currency Strength Meter
            </button>
            <button className="ghost" onClick={() => { setMobileMenuOpen(false); onOpenCorrelated(); }} style={{ fontSize: 12, padding: "8px", display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-start" }}>
              <LayoutGrid size={14} /> Correlated Pairs
            </button>
            <button className="ghost" onClick={() => { setMobileMenuOpen(false); onOpenMarketBias(); }} style={{ fontSize: 12, padding: "8px", display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-start" }}>
              <Activity size={14} /> Master Market Bias
            </button>
            {layout === "1" && (
              <button className="ghost" onClick={() => { setMobileMenuOpen(false); onOpenPip(); }} style={{ fontSize: 12, padding: "8px", display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-start", color: isPipActive ? "var(--brand)" : "inherit" }}>
                <ExternalLink size={14} /> {isPipActive ? "Close Pop Out" : "Pop Out Chart"}
              </button>
            )}
            <Link href="/autonomous" className="ghost" onClick={() => setMobileMenuOpen(false)} style={{ fontSize: 12, padding: "8px", display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-start", textDecoration: "none", color: "inherit" }}>
              <Zap size={14} style={{ color: "var(--accent)" }} /> Autonomous
            </Link>
            <Link href="/autonomous?section=journal" className="ghost" onClick={() => setMobileMenuOpen(false)} style={{ fontSize: 12, padding: "8px", display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-start", textDecoration: "none", color: "inherit" }}>
              <BookOpen size={14} /> Journal
            </Link>
            <button 
              className={biasEnabled ? "primary" : "ghost"} 
              onClick={onToggleBias} 
              style={{ fontSize: 12, padding: "8px", display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-start", background: biasEnabled ? "var(--green)" : "transparent", color: biasEnabled ? "#fff" : "var(--muted)" }}
            >
              <Power size={14} /> Engine {biasEnabled ? "ON" : "OFF"}
            </button>
          </div>

          <div style={{ display: "flex", gap: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <button className={watchlistOpen ? "primary" : "ghost"} onClick={() => setWatchlistOpen(!watchlistOpen)} style={{ padding: "8px", flex: 1, display: "flex", justifyContent: "center" }}><Sidebar size={16} /></button>
            <button className="ghost" onClick={() => { setMobileMenuOpen(false); onOpenAlerts(); }} style={{ padding: "8px", flex: 1, display: "flex", justifyContent: "center" }}><Bell size={16} /></button>
          </div>
        </div>
      )}
    </header>
  );
}
