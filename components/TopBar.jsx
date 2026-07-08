"use client";

import { useState, useRef, useEffect } from "react";
import { Save, Repeat, Bell, Sidebar, LayoutGrid, Activity, ExternalLink, Power, Menu, X, Settings } from "lucide-react";
import IndicatorsMenu from "./IndicatorsMenu";

const TFS = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
const TF_LABEL = { M1: "1m", M5: "5m", M15: "15m", M30: "30m", H1: "1h", H4: "4h", D1: "1D" };

export default function TopBar({ 
  symbol, tf, setTf, tick, connected, onOpenPalette, onAddAlert, 
  onOpenAlerts, activeAlertCount, onOpenMarketBias, biasEnabled, onToggleBias,
  onOpenPip, isPipActive,
  layout, setLayout, syncOpts, setSyncOpts,
  watchlistOpen, setWatchlistOpen,
  savedLayouts, onLoadLayout, onOpenSaveLayout, onOpenLoop,
  indicators, setIndicators
}) {
  const digits = tick?.digits ?? 5;
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const layoutMenuRef = useRef(null);

  useEffect(() => {
    if (!showLayoutMenu) return;
    const handleClick = (e) => {
      if (layoutMenuRef.current && !layoutMenuRef.current.contains(e.target)) {
        setShowLayoutMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showLayoutMenu]);
  
  const toggleSync = (key) => setSyncOpts(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <header className="topbar-header" style={{
      display: "flex", alignItems: "center", gap: 12, padding: "8px 14px",
      background: "var(--panel)", borderBottom: "1px solid var(--border)",
      flexWrap: "wrap", position: "relative", zIndex: 100
    }}>
      <div className="logo-text" style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.2 }}>
        Trade<span style={{ color: "var(--accent)" }}>Space</span>
      </div>

      <button className="primary symbol-btn" onClick={onOpenPalette} title="Switch symbol (Ctrl+K or /)"
        style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
        <span style={{ opacity: 0.8 }}>⌕</span> {symbol}
      </button>

      <div className="tf-container" style={{ display: "flex", gap: 4 }}>
        {TFS.map((t) => (
          <button
            key={t}
            onClick={() => setTf(t)}
            className={`tf-btn ${tf === t ? "primary" : "ghost"}`}
            style={{ padding: "4px 9px", fontSize: 12 }}
          >
            {TF_LABEL[t]}
          </button>
        ))}
      </div>

      <button className="ghost hide-desktop" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} style={{ marginLeft: "auto", padding: "4px 8px" }}>
        {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      <div className="hide-mobile" style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
        <div style={{ position: "relative", borderLeft: "1px solid var(--border)", paddingLeft: 12 }}>
        <button 
          className={showLayoutMenu ? "primary" : "ghost"} 
          onClick={() => setShowLayoutMenu(!showLayoutMenu)} 
          title="Layout Settings"
          style={{ padding: "4px 8px", display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
        >
          <LayoutGrid size={14} /> Layout
        </button>

        {showLayoutMenu && (
          <div ref={layoutMenuRef} style={{
            position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 100,
            background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6,
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)", padding: 12, width: 220,
            display: "flex", flexDirection: "column", gap: 12
          }}>
            <div>
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4, textTransform: "uppercase", fontWeight: 600 }}>Grid</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                <button className={layout === "1" ? "primary" : "ghost"} onClick={() => setLayout("1")} style={{padding: "2px 6px"}}>1</button>
                <button className={layout === "2v" ? "primary" : "ghost"} onClick={() => setLayout("2v")} style={{padding: "2px 6px"}}>2v</button>
                <button className={layout === "2h" ? "primary" : "ghost"} onClick={() => setLayout("2h")} style={{padding: "2px 6px"}}>2h</button>
                <button className={layout === "4" ? "primary" : "ghost"} onClick={() => setLayout("4")} style={{padding: "2px 6px"}}>4</button>
                <button className={layout === "6" ? "primary" : "ghost"} onClick={() => setLayout("6")} style={{padding: "2px 6px"}}>6</button>
                <button className={layout === "8" ? "primary" : "ghost"} onClick={() => setLayout("8")} style={{padding: "2px 6px"}}>8</button>
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
                <select 
                  onChange={(e) => {
                    if (e.target.value) onLoadLayout(e.target.value);
                    e.target.value = "";
                    setShowLayoutMenu(false);
                  }} 
                  style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", padding: "4px", borderRadius: 4, fontSize: 12, outline: "none", cursor: "pointer", flex: 1, marginRight: 8 }}
                >
                  <option value="">Load template...</option>
                  {savedLayouts && savedLayouts.map(l => (
                    <option key={l._id} value={l._id}>{l.name}</option>
                  ))}
                </select>
                <button className="ghost" onClick={() => { onOpenSaveLayout(); setShowLayoutMenu(false); }} title="Save Layout" style={{padding: "4px", display: "flex", alignItems: "center"}}><Save size={14} /></button>
              </div>
              {layout === "1" && (
                <button className="ghost" onClick={() => { onOpenLoop(); setShowLayoutMenu(false); }} title="Start Slideshow Loop" style={{padding: "4px 8px", display: "flex", alignItems: "center", gap: 6, justifyContent: "center"}}>
                  <Repeat size={14} /> Start Loop Mode
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <IndicatorsMenu indicators={indicators} setIndicators={setIndicators} />

      <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
        <button className="ghost" onClick={onOpenMarketBias} title="Master Bias" style={{ fontSize: 12, padding: "4px 8px", display: "flex", alignItems: "center", gap: 6 }}>
          <Activity size={14} /> <span className="hide-mobile">Market Bias</span>
        </button>
        <button 
          className={biasEnabled ? "primary" : "ghost"} 
          onClick={onToggleBias} 
          title={biasEnabled ? "Bias Engine is ON (Click to disable)" : "Bias Engine is OFF (Click to enable)"}
          style={{ 
            fontSize: 12, padding: "4px 8px", display: "flex", alignItems: "center", gap: 6, 
            background: biasEnabled ? "var(--green)" : "transparent", 
            borderColor: biasEnabled ? "var(--green)" : "var(--border)",
            color: biasEnabled ? "#fff" : "var(--muted)"
          }}
        >
          <Power size={14} /> <span className="hide-mobile">Engine {biasEnabled ? "ON" : "OFF"}</span>
        </button>
        {layout === "1" && (
          <button 
            className="ghost" 
            onClick={onOpenPip} 
            title="Pop out chart to floating window (PiP)" 
            style={{ fontSize: 12, padding: "4px 8px", display: "flex", alignItems: "center", gap: 6, color: isPipActive ? "var(--brand)" : "inherit" }}
          >
            <ExternalLink size={14} /> <span className="hide-mobile">{isPipActive ? "Floating" : "Pop Out"}</span>
          </button>
        )}
        <button className="ghost" onClick={onOpenAlerts} title="View alerts" style={{ fontSize: 12, padding: "4px 8px", display: "flex", alignItems: "center", gap: 6 }}>
          <Bell size={14} /> Alerts
        </button>
        <button onClick={onAddAlert} title="Create alert at market price" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <Bell size={14} /> <span className="hide-mobile">Alert</span>{activeAlertCount ? ` · ${activeAlertCount}` : ""}
        </button>
        <button className="ghost hide-mobile" onClick={() => setWatchlistOpen(!watchlistOpen)} title="Toggle Watchlist" style={{ fontSize: 12, padding: "4px 8px", display: "flex", alignItems: "center", gap: 6 }}>
          <Sidebar size={14} /> {watchlistOpen ? "Hide" : "Show"}
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
            <IndicatorsMenu indicators={indicators} setIndicators={setIndicators} />
          </div>

          {showLayoutMenu && (
            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                <button className={layout === "1" ? "primary" : "ghost"} onClick={() => { setLayout("1"); setShowLayoutMenu(false); setMobileMenuOpen(false); }} style={{padding: "2px 6px"}}>1</button>
                <button className={layout === "2v" ? "primary" : "ghost"} onClick={() => { setLayout("2v"); setShowLayoutMenu(false); setMobileMenuOpen(false); }} style={{padding: "2px 6px"}}>2v</button>
                <button className={layout === "2h" ? "primary" : "ghost"} onClick={() => { setLayout("2h"); setShowLayoutMenu(false); setMobileMenuOpen(false); }} style={{padding: "2px 6px"}}>2h</button>
                <button className={layout === "4" ? "primary" : "ghost"} onClick={() => { setLayout("4"); setShowLayoutMenu(false); setMobileMenuOpen(false); }} style={{padding: "2px 6px"}}>4</button>
                <button className={layout === "6" ? "primary" : "ghost"} onClick={() => { setLayout("6"); setShowLayoutMenu(false); setMobileMenuOpen(false); }} style={{padding: "2px 6px"}}>6</button>
                <button className={layout === "8" ? "primary" : "ghost"} onClick={() => { setLayout("8"); setShowLayoutMenu(false); setMobileMenuOpen(false); }} style={{padding: "2px 6px"}}>8</button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button className="ghost" onClick={() => { setMobileMenuOpen(false); onOpenMarketBias(); }} style={{ fontSize: 12, padding: "8px", display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-start" }}>
              <Activity size={14} /> Market Bias
            </button>
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
