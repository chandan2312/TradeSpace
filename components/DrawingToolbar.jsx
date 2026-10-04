"use client";

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

import {
  MousePointer2, TrendingUp, Minus, Square, Ruler,
  Lock, Unlock, Trash2, Undo2, Redo2, Settings, GripHorizontal, Type,
  Magnet, Camera, ChevronRight, ChevronDown, ChevronUp, ChevronLeft, ArrowUpRight, ArrowDownRight,
} from "lucide-react";

// Complete library-native tool groups with professional signs & labels
const TOOL_GROUPS = [
  {
    label: "Lines & Rays",
    badge: "9",
    icon: "╱",
    tools: [
      { id: "trend-line",       label: "Trend Line",       sign: "╱", desc: "Two-point ray/segment" },
      { id: "ray",              label: "Ray",               sign: "→", desc: "Infinite forward line" },
      { id: "extended-line",    label: "Extended Line",     sign: "↔", desc: "Bidirectional extended" },
      { id: "info-line",        label: "Info Line",         sign: "╱ᵢ", desc: "Line with stats & angles" },
      { id: "trend-angle",      label: "Trend Angle",       sign: "∠", desc: "Degree-measured slope" },
      { id: "horizontal-line",  label: "Horizontal Line",   sign: "—", desc: "Infinite price level" },
      { id: "horizontal-ray",   label: "Horizontal Ray",    sign: "⇁", desc: "Ray to the right" },
      { id: "vertical-line",    label: "Vertical Line",     sign: "│", desc: "Time marker" },
      { id: "cross-line",       label: "Cross Line",        sign: "✛", desc: "Time & price crosshair" },
    ],
  },
  {
    label: "Channels & Pitchforks",
    badge: "8",
    icon: "≡",
    tools: [
      { id: "parallel-channel",          label: "Parallel Channel",          sign: "≡",  desc: "3-point boundary channel" },
      { id: "regression-trend",          label: "Regression Trend",          sign: "⊿",  desc: "Linear regression band" },
      { id: "flat-top-bottom",           label: "Flat Top/Bottom",           sign: "⊟",  desc: "Horizontal baseline channel" },
      { id: "disjoint-channel",          label: "Disjoint Channel",          sign: "⟦⟧", desc: "Expanding channel" },
      { id: "pitchfork",                 label: "Pitchfork (Andrews)",       sign: "⑂",  desc: "Standard median lines" },
      { id: "schiff-pitchfork",          label: "Schiff Pitchfork",          sign: "⑂ˢ", desc: "Shifted median lines" },
      { id: "modified-schiff-pitchfork", label: "Mod. Schiff Pitchfork",     sign: "⑂ᵐ", desc: "Modified origin" },
      { id: "inside-pitchfork",          label: "Inside Pitchfork",          sign: "⑂ⁱ", desc: "Inside trendlines" },
    ],
  },
  {
    label: "Fibonacci & Gann",
    badge: "15",
    icon: "𝑓",
    tools: [
      { id: "fib-retracement",           label: "Fib Retracement",           sign: "𝑓",   desc: "Standard retracement ratios" },
      { id: "trend-based-fib-extension",  label: "Trend Fib Extension",       sign: "𝑓↗",  desc: "3-point expansion levels" },
      { id: "fib-channel",               label: "Fib Channel",               sign: "𝑓≡",  desc: "Ratio-based channels" },
      { id: "fib-time-zone",             label: "Fib Time Zone",             sign: "𝑓│",  desc: "Harmonic vertical intervals" },
      { id: "fib-speed-resistance-fan",  label: "Speed Resistance Fan",      sign: "𝑓⑂",  desc: "Angle harmonic fan" },
      { id: "fib-speed-resistance-arcs", label: "Speed Resistance Arcs",     sign: "𝑓⌒",  desc: "Circular ratio arcs" },
      { id: "fib-circles",               label: "Fib Circles",               sign: "𝑓◯",  desc: "Radial fib concentric circles" },
      { id: "fib-spiral",                label: "Fib Spiral",                sign: "🌀",  desc: "Golden spiral" },
      { id: "fib-wedge",                 label: "Fib Wedge",                 sign: "𝑓⊿",  desc: "Converging fib wedge" },
      { id: "pitchfan",                  label: "Pitchfan",                  sign: "𝑓𝄢",  desc: "Fan-pitchfork combo" },
      { id: "trend-based-fib-time",      label: "Trend Fib Time",            sign: "𝑓⏱",  desc: "Time cycle projection" },
      { id: "gann-box",                  label: "Gann Box",                  sign: "G⊞",  desc: "Gann square matrix" },
      { id: "gann-fan",                  label: "Gann Fan",                  sign: "G⑂",  desc: "Gann 1x1, 1x2, 2x1 angles" },
      { id: "gann-square-fixed",         label: "Gann Square Fixed",         sign: "G□",  desc: "Geometric square grid" },
      { id: "gann-square",               label: "Gann Square",               sign: "G⊡",  desc: "Ratio price-time square" },
    ],
  },
  {
    label: "Patterns & Elliott",
    badge: "11",
    icon: "W",
    tools: [
      { id: "xabcd-pattern",             label: "XABCD Harmonic",            sign: "𝒳",   desc: "Gartley / Bat / Butterfly" },
      { id: "cypher-pattern",            label: "Cypher Pattern",            sign: "𝒞",   desc: "Harmonic Cypher setup" },
      { id: "abcd-pattern",              label: "ABCD Pattern",              sign: "⚡",   desc: "4-point lightning wave" },
      { id: "head-and-shoulders",        label: "Head & Shoulders",          sign: "Ω",   desc: "Classic neckline reversal" },
      { id: "triangle-pattern",          label: "Triangle Pattern",          sign: "△",   desc: "Ascending / descending wedge" },
      { id: "three-drives-pattern",      label: "Three Drives",              sign: "3D",  desc: "Symmetrical trend exhaustion" },
      { id: "elliott-impulse",           label: "Elliott Impulse (12345)",   sign: "1-5", desc: "5-wave motive sequence" },
      { id: "elliott-correction",        label: "Elliott Correction (ABC)",  sign: "ABC", desc: "3-wave zigzag or flat" },
      { id: "elliott-triangle",          label: "Elliott Triangle (ABCDE)",  sign: "△E",  desc: "5-wave contracting triangle" },
      { id: "elliott-double-combo",      label: "Elliott Double (WXY)",      sign: "WXY", desc: "Complex corrective combo" },
      { id: "elliott-triple-combo",      label: "Elliott Triple (WXYXZ)",    sign: "WXZ", desc: "Triple 3 corrective structure" },
    ],
  },
  {
    label: "Positions & Forecasts",
    badge: "6",
    icon: "🎯",
    tools: [
      { id: "long-position",             label: "Long Position",             sign: "🟢↑", desc: "TV Institutional Risk/Reward Box" },
      { id: "short-position",            label: "Short Position",            sign: "🔴↓", desc: "TV Institutional Short Position" },
      { id: "position-forecast",         label: "Forecast Tool",             sign: "⇢",   desc: "Target & stop trajectory" },
      { id: "bar-pattern",               label: "Bars Pattern",              sign: "║",   desc: "Ghost candle sequence copy" },
      { id: "ghost-feed",                label: "Ghost Feed",                sign: "👻",  desc: "Simulated price path" },
      { id: "sector",                    label: "Projection Sector",         sign: "⌔",   desc: "Radial probability cone" },
    ],
  },
  {
    label: "Cycles",
    badge: "3",
    icon: "◑",
    tools: [
      { id: "cyclic-lines",              label: "Cyclic Lines",              sign: "◑",   desc: "Equidistant time bars" },
      { id: "time-cycles",               label: "Time Cycles",               sign: "⊙",   desc: "Harmonic concentric circles" },
      { id: "sine-line",                 label: "Sine Line",                 sign: "∿",   desc: "Periodic wave overlay" },
    ],
  },
  {
    label: "Shapes & Geometry",
    badge: "16",
    icon: "□",
    tools: [
      { id: "rectangle",                 label: "Rectangle",                 sign: "□",   desc: "Box / Consolidation zone" },
      { id: "rotated-rectangle",         label: "Rotated Rectangle",         sign: "◇",   desc: "Angled corridor box" },
      { id: "circle",                    label: "Circle",                    sign: "○",   desc: "Radial highlight" },
      { id: "ellipse",                   label: "Ellipse",                   sign: "⬭",   desc: "Curved highlight" },
      { id: "triangle",                  label: "Triangle",                  sign: "△",   desc: "3-point polygon" },
      { id: "arc",                       label: "Arc",                       sign: "⌒",   desc: "Curved arc" },
      { id: "curve",                     label: "Curve",                     sign: "⌣",   desc: "Spline curve" },
      { id: "double-curve",              label: "Double Curve",              sign: "S",   desc: "S-shaped boundary" },
      { id: "polyline",                  label: "Polyline",                  sign: "⌇",   desc: "Multi-point segment line" },
      { id: "path",                      label: "Path",                      sign: "✏",   desc: "Connected vector segments" },
      { id: "brush",                     label: "Brush",                     sign: "🖊",   desc: "Freehand canvas draw" },
      { id: "highlighter",               label: "Highlighter",               sign: "🖍",   desc: "Translucent marker" },
      { id: "arrow",                     label: "Arrow",                     sign: "➔",   desc: "Directed arrow line" },
      { id: "arrow-marker",              label: "Arrow Marker",              sign: "↑",   desc: "Vertical pointer" },
      { id: "arrow-mark-up",             label: "Arrow Up",                  sign: "▲",   desc: "Bullish pin" },
      { id: "arrow-mark-down",           label: "Arrow Down",                sign: "▼",   desc: "Bearish pin" },
    ],
  },
  {
    label: "Measurers",
    badge: "3",
    icon: "⊡",
    tools: [
      { id: "price-range",               label: "Price Range",               sign: "↕",   desc: "Pips, ticks & percent box" },
      { id: "date-range",                label: "Date Range",                sign: "↔",   desc: "Bar count & duration" },
      { id: "date-and-price-range",       label: "Date & Price Range",        sign: "⊡",   desc: "Full TradingView ruler" },
    ],
  },
  {
    label: "Annotations",
    badge: "11",
    icon: "T",
    tools: [
      { id: "text",                      label: "Text",                      sign: "T",   desc: "Standard on-chart text" },
      { id: "note",                      label: "Note",                      sign: "📝",  desc: "Anchored card note" },
      { id: "pin",                       label: "Pin",                       sign: "📍",  desc: "Sticky location pin" },
      { id: "price-note",                label: "Price Note",                sign: "📌",  desc: "Pinned label with price tag" },
      { id: "callout",                   label: "Callout",                   sign: "💬",  desc: "Speech bubble" },
      { id: "comment",                   label: "Comment",                   sign: "🗨",  desc: "Balloon annotation" },
      { id: "price-label",               label: "Price Label",               sign: "🏷",  desc: "Right-axis badge" },
      { id: "signpost",                  label: "Signpost",                  sign: "🪧",  desc: "Flagged pole marker" },
      { id: "flag-mark",                 label: "Flag Mark",                 sign: "🚩",  desc: "Flag checkpoint" },
      { id: "font-icon",                 label: "Font Icon",                 sign: "★",   desc: "TradingView icons & emojis" },
      { id: "table",                     label: "Table",                     sign: "⊞",   desc: "Embedded data grid" },
    ],
  },
  {
    label: "Volume Profiles",
    badge: "3",
    icon: "V",
    tools: [
      { id: "anchored-vwap",             label: "Anchored VWAP",             sign: "V",   desc: "Volume Weighted Average Price" },
      { id: "fixed-range-volume-profile", label: "Fixed Range VP",           sign: "VP",  desc: "Visible range volume distribution" },
      { id: "anchored-volume-profile",   label: "Anchored VP",               sign: "AVP", desc: "Anchor-to-date volume profile" },
    ],
  },
];

// Quick Access Primary Bar (Most frequently used tools)
const QUICK_TOOLS = [
  { id: "cursor",                label: "Cursor (Esc)",          icon: <MousePointer2 size={16} /> },
  { id: "trend-line",            label: "Trend Line",            icon: <TrendingUp size={16} /> },
  { id: "horizontal-line",       label: "Horizontal Line",       icon: <Minus size={16} /> },
  { id: "fib-retracement",       label: "Fib Retracement",       icon: <GripHorizontal size={16} /> },
  { id: "rectangle",             label: "Rectangle",             icon: <Square size={16} /> },
  { id: "long-position",         label: "Long Position (TV)",    icon: <ArrowUpRight size={16} color="#26a69a" /> },
  { id: "short-position",        label: "Short Position (TV)",   icon: <ArrowDownRight size={16} color="#ef5350" /> },
  { id: "date-and-price-range",   label: "Measure (Ruler)",       icon: <Ruler size={16} /> },
  { id: "text",                  label: "Text Annotation",       icon: <Type size={16} /> },
];

let globalToolbarPos = null;

export default function DrawingToolbar({ api }) {
  const {
    activeTool, setActiveTool,
    lockTool, setLockTool,
    drawings,
    clearAll, undo, redo, canUndo, canRedo,
    magnetMode, setMagnetMode,
  } = api;

  const [pos, setPosState] = useState(globalToolbarPos);
  const setPos = (p) => { globalToolbarPos = p; setPosState(p); };

  const [openGroup, setOpenGroup] = useState(null);
  const [desktopExpanded, setDesktopExpanded] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  // If a tool from a collapsed group is active, find it so it can still be displayed
  const activeGroupTool = !QUICK_TOOLS.some((t) => t.id === activeTool)
    ? TOOL_GROUPS.flatMap((g) => g.tools).find((t) => t.id === activeTool)
    : null;
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, startX: 0, startY: 0 });
  const toolbarRef = useRef(null);
  const groupMenuRef = useRef(null);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Drag handling
  useEffect(() => {
    const handleMove = (e) => {
      if (!dragging.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setPos({ x: Math.max(0, dragStart.current.startX + dx), y: Math.max(0, dragStart.current.startY + dy) });
    };
    const handleUp = () => { dragging.current = false; };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, []);

  const onDragStart = (e) => {
    e.stopPropagation(); e.preventDefault();
    dragging.current = true;
    const el = toolbarRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      dragStart.current = { x: e.clientX, y: e.clientY, startX: rect.left, startY: rect.top };
      if (!pos) setPos({ x: rect.left, y: rect.top });
    }
  };

  const onPickTool = (id) => {
    setOpenGroup(null);
    if (id === "cursor") {
      setActiveTool(null);
      return;
    }
    setActiveTool(activeTool === id ? null : id);
  };

  // Close popup submenu on outside click
  useEffect(() => {
    if (!openGroup) return;
    const close = (e) => {
      if (groupMenuRef.current && groupMenuRef.current.contains(e.target)) return;
      setOpenGroup(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close, { passive: true });
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [openGroup]);

  // Take screenshot
  const handleScreenshot = () => {
    try {
      const canvas = document.querySelector("canvas");
      if (!canvas) return;
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `TradeSpace-${Date.now()}.png`;
      a.click();
    } catch {}
  };

  // ── Desktop Toolbar ──────────────────────────────────────────────────────
  const desktopToolbar = (
    <div
      className="drawing-toolbar"
      ref={toolbarRef}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: pos ? pos.x : 8,
        top: pos ? pos.y : "50%",
        transform: pos ? "none" : "translateY(-50%)",
        zIndex: 1000, display: "flex", flexDirection: "column", gap: 2,
        background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8,
        padding: 4, boxShadow: "0 4px 16px rgba(0,0,0,.55)",
      }}
    >
      {/* Drag handle */}
      <div
        className="drawing-toolbar-drag"
        onPointerDown={onDragStart}
        style={{ cursor: "grab", display: "flex", justifyContent: "center", padding: "4px 0", color: "var(--muted)", touchAction: "none" }}
      >
        <GripHorizontal size={14} />
      </div>

      {/* Quick Tools */}
      {QUICK_TOOLS.map((t) => {
        const isActive = t.id === "cursor" ? !activeTool : activeTool === t.id;
        return (
          <button
            key={t.id}
            className={isActive ? "primary" : "ghost"}
            onClick={() => onPickTool(t.id)}
            title={t.label}
            style={{
              padding: 6, display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", borderRadius: 4,
            }}
          >
            {t.icon}
          </button>
        );
      })}

      {/* Show active tool if chosen from collapsed groups */}
      {activeGroupTool && (
        <button
          className="primary"
          onClick={() => onPickTool(activeGroupTool.id)}
          title={`Active tool: ${activeGroupTool.label} (Click to deselect)`}
          style={{
            padding: 6, display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", borderRadius: 4, background: "var(--brand)", color: "#fff",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700 }}>{activeGroupTool.sign}</span>
        </button>
      )}

      {/* Collapse / Expand Toggle Button (collapsed by default) */}
      <button
        className={desktopExpanded ? "primary" : "ghost"}
        onClick={() => {
          setDesktopExpanded((prev) => {
            const next = !prev;
            if (!next) setOpenGroup(null);
            return next;
          });
        }}
        title={desktopExpanded ? "Collapse additional tools" : "More tools (10 categories, 85+ tools)"}
        style={{
          padding: "5px 6px", display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", borderRadius: 4,
          color: desktopExpanded ? "var(--brand)" : "var(--muted)",
          transition: "all 0.15s ease",
        }}
      >
        {desktopExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {/* Expandable Group Buttons — only shown when desktopExpanded is true */}
      {desktopExpanded && (
        <>
          <div style={{ height: 1, background: "var(--border)", margin: "3px 0" }} />
          {TOOL_GROUPS.map((group) => (
            <div key={group.label} style={{ position: "relative" }}>
              <button
                className="ghost"
                title={`${group.label} (${group.badge} tools)`}
                onClick={() => setOpenGroup((o) => (o === group.label ? null : group.label))}
                style={{
                  padding: "5px 6px", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700, gap: 2, width: "100%", cursor: "pointer",
                  background: openGroup === group.label ? "var(--accent-soft)" : undefined,
                  borderRadius: 4,
                }}
              >
                <span style={{ fontSize: 13, width: 14, textAlign: "center" }}>{group.icon}</span>
                <ChevronRight size={10} style={{ opacity: 0.5 }} />
              </button>

              {/* Submenu Dropdown */}
              {openGroup === group.label && (
                <div
                  ref={groupMenuRef}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    position: "fixed",
                    left: (pos ? pos.x : 8) + 44,
                    zIndex: 1001,
                    background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(0,0,0,.65)", overflow: "hidden",
                    minWidth: 220, maxHeight: "80vh", overflowY: "auto",
                  }}
                >
                  <div style={{ padding: "8px 12px", fontSize: 10, textTransform: "uppercase", opacity: 0.6, fontWeight: 700, borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
                    <span>{group.label}</span>
                    <span>{group.badge} tools</span>
                  </div>
                  {group.tools.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => onPickTool(t.id)}
                      style={{
                        padding: "7px 12px", cursor: "pointer", fontSize: 12, display: "flex",
                        alignItems: "center", gap: 10,
                        background: activeTool === t.id ? "var(--accent-soft)" : "transparent",
                        color: activeTool === t.id ? "var(--brand)" : "var(--text)",
                        borderBottom: "1px solid rgba(255,255,255,0.02)",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = activeTool === t.id ? "var(--accent-soft)" : "transparent"}
                    >
                      <span style={{ fontSize: 13, minWidth: 20, textAlign: "center", fontWeight: 700, opacity: 0.85 }}>{t.sign}</span>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontWeight: 600 }}>{t.label}</span>
                        <span style={{ fontSize: 10, color: "var(--muted)" }}>{t.desc}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      <div style={{ height: 1, background: "var(--border)", margin: "3px 0" }} />

      {/* Utilities */}
      <button
        className={lockTool ? "primary" : "ghost"}
        onClick={() => setLockTool(!lockTool)}
        title={lockTool ? "Tool locked (stay in drawing mode)" : "Lock tool"}
        style={{ padding: 6, display: "flex", justifyContent: "center", borderRadius: 4 }}
      >
        {lockTool ? <Lock size={16} /> : <Unlock size={16} />}
      </button>

      <button
        className={magnetMode ? "primary" : "ghost"}
        onClick={() => setMagnetMode(!magnetMode)}
        title="Magnet mode (snap anchors to candle OHLC)"
        style={{ padding: 6, display: "flex", justifyContent: "center", borderRadius: 4 }}
      >
        <Magnet size={16} />
      </button>

      <button
        className="ghost"
        onClick={undo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        style={{ padding: 6, display: "flex", justifyContent: "center", opacity: canUndo ? 1 : 0.35, borderRadius: 4 }}
      >
        <Undo2 size={16} />
      </button>

      <button
        className="ghost"
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
        style={{ padding: 6, display: "flex", justifyContent: "center", opacity: canRedo ? 1 : 0.35, borderRadius: 4 }}
      >
        <Redo2 size={16} />
      </button>

      <button
        className="ghost"
        onClick={handleScreenshot}
        title="Take screenshot"
        style={{ padding: 6, display: "flex", justifyContent: "center", borderRadius: 4 }}
      >
        <Camera size={16} />
      </button>

      <button
        className="ghost"
        onClick={clearAll}
        disabled={!drawings?.length}
        title="Clear all drawings"
        style={{ padding: 6, display: "flex", justifyContent: "center", opacity: drawings?.length ? 1 : 0.35, borderRadius: 4 }}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );

  // ── Mobile Toolbar ───────────────────────────────────────────────────────
  const mobileToolbar = (
    <div
      className="drawing-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: "flex", flexDirection: "row", alignItems: "center", gap: 6,
        padding: "4px 8px", background: "var(--panel)", border: "none",
        width: "100%", overflowX: "auto", whiteSpace: "nowrap",
      }}
    >
      {/* Quick Tools (Main Drawing Toolbar) */}
      {QUICK_TOOLS.map((t) => (
        <button
          key={t.id}
          className={(t.id === "cursor" ? !activeTool : activeTool === t.id) ? "primary" : "ghost"}
          onClick={() => onPickTool(t.id)}
          title={t.label}
          style={{ padding: "6px 8px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: 4 }}
        >
          {t.icon}
        </button>
      ))}

      {/* Show active tool if chosen from collapsed groups */}
      {activeGroupTool && (
        <button
          className="primary"
          onClick={() => onPickTool(activeGroupTool.id)}
          title={`Active: ${activeGroupTool.label}`}
          style={{
            padding: "6px 8px", display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, borderRadius: 4, fontWeight: 700, background: "var(--brand)", color: "#fff",
          }}
        >
          <span>{activeGroupTool.sign}</span>
        </button>
      )}

      {/* Expand / Collapse Button for Mobile (collapsed by default) */}
      <button
        className={mobileExpanded ? "primary" : "ghost"}
        onClick={() => {
          setMobileExpanded((prev) => {
            const next = !prev;
            if (!next) setOpenGroup(null);
            return next;
          });
        }}
        title={mobileExpanded ? "Collapse additional tools" : "More tools (10 categories, 85+ tools)"}
        style={{
          padding: "6px 8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 3,
          flexShrink: 0,
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 600,
          color: mobileExpanded ? "var(--brand)" : "var(--muted)",
          cursor: "pointer",
        }}
      >
        <span>{mobileExpanded ? "Less" : "More"}</span>
        {mobileExpanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>

      {/* Additional tool groups when expanded */}
      {mobileExpanded && (
        <>
          <div style={{ width: 1, height: 20, background: "var(--border)", flexShrink: 0 }} />
          {TOOL_GROUPS.map((group) => (
            <button
              key={group.label}
              className={openGroup === group.label ? "primary" : "ghost"}
              onClick={() => setOpenGroup((o) => (o === group.label ? null : group.label))}
              title={`${group.label} (${group.badge} tools)`}
              style={{
                padding: "6px 8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                flexShrink: 0,
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                background: openGroup === group.label ? "var(--accent-soft)" : undefined,
                color: openGroup === group.label ? "var(--brand)" : undefined,
              }}
            >
              <span style={{ fontSize: 13 }}>{group.icon}</span>
              <span>{group.label}</span>
            </button>
          ))}
        </>
      )}

      <div style={{ width: 1, height: 20, background: "var(--border)", flexShrink: 0 }} />

      {/* Utilities */}
      <button
        className={magnetMode ? "primary" : "ghost"}
        onClick={() => setMagnetMode(!magnetMode)}
        title="Magnet"
        style={{ padding: 6, display: "flex", alignItems: "center", flexShrink: 0, borderRadius: 4 }}
      >
        <Magnet size={16} />
      </button>

      <button
        className="ghost"
        onClick={undo}
        disabled={!canUndo}
        title="Undo"
        style={{ padding: 6, display: "flex", alignItems: "center", flexShrink: 0, opacity: canUndo ? 1 : 0.35, borderRadius: 4 }}
      >
        <Undo2 size={16} />
      </button>

      <button
        className="ghost"
        onClick={redo}
        disabled={!canRedo}
        title="Redo"
        style={{ padding: 6, display: "flex", alignItems: "center", flexShrink: 0, opacity: canRedo ? 1 : 0.35, borderRadius: 4 }}
      >
        <Redo2 size={16} />
      </button>

      <button
        className="ghost"
        onClick={clearAll}
        disabled={!drawings?.length}
        title="Clear all"
        style={{ padding: 6, display: "flex", alignItems: "center", flexShrink: 0, opacity: drawings?.length ? 1 : 0.35, borderRadius: 4 }}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );

  const mobileGroupMenu = isMobile && openGroup && (
    <div
      ref={groupMenuRef}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        bottom: 56,
        left: 8,
        right: 8,
        maxHeight: "55vh",
        zIndex: 1002,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 8px 32px rgba(0,0,0,.75)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {(() => {
        const currentGroup = TOOL_GROUPS.find((g) => g.label === openGroup);
        if (!currentGroup) return null;
        return (
          <>
            <div
              style={{
                padding: "8px 12px",
                fontSize: 11,
                fontWeight: 700,
                borderBottom: "1px solid var(--border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "rgba(255,255,255,0.02)",
                position: "sticky",
                top: 0,
                zIndex: 1,
              }}
            >
              <span>{currentGroup.label} ({currentGroup.badge} tools)</span>
              <button
                onClick={() => setOpenGroup(null)}
                className="ghost"
                style={{ padding: "2px 6px", cursor: "pointer", borderRadius: 4 }}
              >
                ✕
              </button>
            </div>
            {currentGroup.tools.map((t) => (
              <div
                key={t.id}
                onClick={() => {
                  onPickTool(t.id);
                  setOpenGroup(null);
                }}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: activeTool === t.id ? "var(--accent-soft)" : "transparent",
                  color: activeTool === t.id ? "var(--brand)" : "var(--text)",
                  borderBottom: "1px solid rgba(255,255,255,0.03)",
                }}
              >
                <span style={{ fontSize: 14, minWidth: 22, textAlign: "center", fontWeight: 700, opacity: 0.9 }}>{t.sign}</span>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 600 }}>{t.label}</span>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>{t.desc}</span>
                </div>
              </div>
            ))}
          </>
        );
      })()}
    </div>
  );

  if (isMobile) {
    const portalDest = typeof document !== "undefined" ? document.getElementById("mobile-drawing-portal") : null;
    return (
      <>
        {portalDest ? createPortal(mobileToolbar, portalDest) : mobileToolbar}
        {mobileGroupMenu && typeof document !== "undefined" && createPortal(mobileGroupMenu, document.body)}
      </>
    );
  }

  return typeof document !== "undefined" ? createPortal(desktopToolbar, document.body) : desktopToolbar;
}
