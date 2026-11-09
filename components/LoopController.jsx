"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  ChevronDown,
  Clock,
  Flag,
  ListFilter,
  Zap,
  Radar,
  Layers,
  Check,
  Sparkles,
  GripVertical,
} from "lucide-react";

const FLAG_CONFIG = [
  { id: "red", label: "Red Flags", color: "#ef5350" },
  { id: "blue", label: "Blue Flags", color: "#2962ff" },
  { id: "green", label: "Green Flags", color: "#26a69a" },
  { id: "yellow", label: "Yellow Flags", color: "#eab308" },
];

const INTERVAL_OPTIONS = [
  { label: "3s", value: 3000 },
  { label: "5s", value: 5000 },
  { label: "10s", value: 10000 },
  { label: "15s", value: 15000 },
  { label: "20s", value: 20000 },
  { label: "30s", value: 30000 },
  { label: "60s", value: 60000 },
];

/**
 * LoopController — Minimal, Modern Slideshow & Watchlist Loop Toolbar.
 *
 * Replaces the old full-width rectangle with a sleek, compact floating pill.
 * Features:
 * - Unified Source Dropdown: select between Watchlists (Main, custom, all),
 *   Auto-generated lists (Autonomous Setups, Radar Ideas), or Flag groups (Red, Blue, Green, Yellow, All Flags).
 * - Minimal, modern playback controls (Prev, Play/Pause, Next, Speed, Stop/Close).
 * - Real-time position tracking (e.g. EURUSD • 3/14).
 * - 100% compact: wraps tightly around buttons with zero wasted screen space.
 */
export default function LoopController({
  isLooping,
  onTogglePlay,
  onPrev,
  onNext,
  onClose,
  loopInterval,
  onChangeInterval,
  currentSymbol,
  loopSymbols = [],
  watchlists = [],
  symbolFlags = {},
  autonomousTrades = [],
  radarPairs = [],
  loopSource = "all_flags",
  onChangeSource,
  loopColors = ["red"],
  onToggleColor,
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const pillRef = useRef(null);
  const [position, setPosition] = useState(null); // { x: number, y: number } or null for top-center default
  const [isDragging, setIsDragging] = useState(false);

  // Hydrate saved position from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ts_loop_position");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
          setPosition({ x: parsed.x, y: parsed.y });
        }
      }
    } catch {}
  }, []);

  // Clamping on window resize
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => {
        if (!prev || !pillRef.current?.parentElement) return prev;
        const parent = pillRef.current.parentElement.getBoundingClientRect();
        const pill = pillRef.current.getBoundingClientRect();
        const maxX = Math.max(8, parent.width - pill.width - 8);
        const maxY = Math.max(8, parent.height - pill.height - 8);
        return {
          x: Math.min(Math.max(prev.x, 8), maxX),
          y: Math.min(Math.max(prev.y, 8), maxY),
        };
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Drag pointer down handler (operates from grip handle, padding, background, or dividers)
  const dragRef = useRef({
    startX: 0,
    startY: 0,
    initX: 0,
    initY: 0,
    parentWidth: 0,
    parentHeight: 0,
    pillWidth: 0,
    pillHeight: 0,
  });

  const handlePointerDown = (e) => {
    // Only primary mouse button or touch
    if (e.button !== 0) return;
    // Do not initiate drag if user clicked an interactive control
    if (e.target.closest("button, select, input, [data-interactive='true']")) return;

    const pill = pillRef.current;
    if (!pill) return;
    const parent = pill.parentElement;
    if (!parent) return;

    const pillRect = pill.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();

    const curX = pillRect.left - parentRect.left;
    const curY = pillRect.top - parentRect.top;

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: curX,
      initY: curY,
      parentWidth: parentRect.width,
      parentHeight: parentRect.height,
      pillWidth: pillRect.width,
      pillHeight: pillRect.height,
    };

    setIsDragging(true);
    setDropdownOpen(false);

    const handlePointerMove = (moveEv) => {
      const { startX, startY, initX, initY, parentWidth, parentHeight, pillWidth, pillHeight } = dragRef.current;
      const dx = moveEv.clientX - startX;
      const dy = moveEv.clientY - startY;

      const minX = 8;
      const maxX = Math.max(8, parentWidth - pillWidth - 8);
      const minY = 8;
      const maxY = Math.max(8, parentHeight - pillHeight - 8);

      const clampedX = Math.min(Math.max(initX + dx, minX), maxX);
      const clampedY = Math.min(Math.max(initY + dy, minY), maxY);

      setPosition({ x: clampedX, y: clampedY });
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      setIsDragging(false);

      setPosition((latestPos) => {
        if (latestPos) {
          try {
            localStorage.setItem("ts_loop_position", JSON.stringify({
              x: Math.round(latestPos.x),
              y: Math.round(latestPos.y),
            }));
          } catch {}
        }
        return latestPos;
      });
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  // Double-click reset to top center
  const handleResetPosition = (e) => {
    e.stopPropagation();
    setPosition(null);
    try {
      localStorage.removeItem("ts_loop_position");
    } catch {}
  };

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [dropdownOpen]);

  // Compute symbol counts for each source
  const counts = useMemo(() => {
    const flagCounts = { red: 0, blue: 0, green: 0, yellow: 0, all: 0 };
    Object.values(symbolFlags).forEach((col) => {
      if (col && flagCounts[col] !== undefined) {
        flagCounts[col]++;
        flagCounts.all++;
      }
    });

    const allWlSet = new Set();
    watchlists.forEach((w) => (w.symbols || []).forEach((s) => allWlSet.add(s)));

    const autoSet = new Set();
    (autonomousTrades || []).forEach((t) => {
      const s = t.tradeableSymbol || t.symbol || t.canonicalSymbol;
      if (s) autoSet.add(s);
    });

    const radarSet = new Set();
    (radarPairs || []).forEach((p) => {
      const s = p.tradeableSymbol || p.symbol;
      if (s) radarSet.add(s);
    });

    return {
      flags: flagCounts,
      allWatchlists: allWlSet.size,
      auto: autoSet.size,
      radar: radarSet.size,
    };
  }, [symbolFlags, watchlists, autonomousTrades, radarPairs]);

  // Get active source label and icon metadata
  const currentSourceMeta = useMemo(() => {
    if (!loopSource || loopSource === "all_flags") {
      return {
        label: "All Flags",
        count: counts.flags.all,
        icon: <Flag size={12} fill="#ef5350" color="#ef5350" />,
      };
    }
    if (loopSource.startsWith("flag:")) {
      const col = loopSource.replace("flag:", "");
      const f = FLAG_CONFIG.find((c) => c.id === col);
      return {
        label: f?.label || `${col} Flag`,
        count: counts.flags[col] || 0,
        icon: <Flag size={12} fill={f?.color || "currentColor"} color={f?.color || "currentColor"} />,
      };
    }
    if (loopSource === "flags_multi") {
      return {
        label: `${loopColors.length} Flags`,
        count: loopSymbols.length,
        icon: <Flag size={12} fill="#eab308" color="#eab308" />,
      };
    }
    if (loopSource.startsWith("wl:")) {
      const id = loopSource.replace("wl:", "");
      const wl = watchlists.find((w) => w._id === id);
      return {
        label: wl?.name || "Watchlist",
        count: wl?.symbols?.length || 0,
        icon: <ListFilter size={12} color="var(--accent, #38bdf8)" />,
      };
    }
    if (loopSource === "all_wl") {
      return {
        label: "All Watchlists",
        count: counts.allWatchlists,
        icon: <Layers size={12} color="var(--accent, #38bdf8)" />,
      };
    }
    if (loopSource === "auto") {
      return {
        label: "Auto Setups",
        count: counts.auto,
        icon: <Zap size={12} color="#22c55e" />,
      };
    }
    if (loopSource === "radar") {
      return {
        label: "Radar Ideas",
        count: counts.radar,
        icon: <Radar size={12} color="#a855f7" />,
      };
    }
    return {
      label: "Loop",
      count: loopSymbols.length,
      icon: <ListFilter size={12} />,
    };
  }, [loopSource, loopColors, counts, watchlists, loopSymbols.length]);

  // Calculate current item position index (e.g. 3 of 14)
  const currentIndex = useMemo(() => {
    if (!currentSymbol || !loopSymbols.length) return 0;
    const idx = loopSymbols.indexOf(currentSymbol);
    return idx >= 0 ? idx + 1 : 1;
  }, [currentSymbol, loopSymbols]);

  // Determine if dropdown should open upwards or downwards based on pill Y
  const dropdownUp = useMemo(() => {
    if (!position || !pillRef.current?.parentElement) return false;
    const parentH = pillRef.current.parentElement.clientHeight || window.innerHeight;
    return position.y > parentH - 360;
  }, [position]);

  const dropdownRight = useMemo(() => {
    if (!position || !pillRef.current?.parentElement) return false;
    const parentW = pillRef.current.parentElement.clientWidth || window.innerWidth;
    return position.x > parentW - 250;
  }, [position]);

  return (
    <div
      ref={pillRef}
      onPointerDown={handlePointerDown}
      style={{
        position: "absolute",
        top: position ? position.y : 8,
        left: position ? position.x : "50%",
        transform: position ? "none" : "translateX(-50%)",
        zIndex: 25,
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "3px 6px",
        background: "rgba(15, 23, 42, 0.94)",
        backdropFilter: "blur(14px)",
        border: isDragging
          ? "1px solid var(--accent, #38bdf8)"
          : "1px solid rgba(148, 163, 184, 0.22)",
        borderRadius: 8,
        boxShadow: isDragging
          ? "0 8px 25px rgba(0, 0, 0, 0.75), 0 0 0 1px var(--accent, #38bdf8)"
          : "0 4px 20px rgba(0, 0, 0, 0.5)",
        userSelect: "none",
        pointerEvents: "auto",
        whiteSpace: "nowrap",
        fontSize: 11,
        color: "var(--foreground, #f8fafc)",
        maxWidth: "calc(100% - 24px)",
        cursor: isDragging ? "grabbing" : "default",
        touchAction: "none",
        transition: isDragging
          ? "box-shadow 0.15s ease, border-color 0.15s ease"
          : "box-shadow 0.2s ease, border-color 0.2s ease",
      }}
    >
      {/* 0. DRAG HANDLE GRIP */}
      <div
        onDoubleClick={handleResetPosition}
        title="Drag anywhere to reposition (Double-click to reset position)"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 14,
          height: 24,
          cursor: isDragging ? "grabbing" : "grab",
          color: "var(--muted, #94a3b8)",
          opacity: isDragging ? 1 : 0.6,
          marginRight: 1,
          transition: "opacity 0.15s ease",
          touchAction: "none",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = 1)}
        onMouseLeave={(e) => {
          if (!isDragging) e.currentTarget.style.opacity = 0.6;
        }}
      >
        <GripVertical size={13} />
      </div>

      {/* 1. SOURCE SELECTOR DROPDOWN BUTTON */}
      <div style={{ position: "relative" }} ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          title="Change Loop Watchlist or Flag source"
          style={{
            height: 24,
            padding: "0 6px",
            display: "inline-flex",
            alignItems: "center",
            gap: 4.5,
            background: dropdownOpen ? "rgba(255, 255, 255, 0.08)" : "transparent",
            border: "none",
            borderRadius: 5,
            color: "var(--foreground, #f8fafc)",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            transition: "background 0.15s ease",
          }}
        >
          {currentSourceMeta.icon}
          <span style={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis" }}>
            {currentSourceMeta.label}
          </span>
          <span
            style={{
              fontSize: 9.5,
              opacity: 0.65,
              background: "rgba(255, 255, 255, 0.08)",
              padding: "1px 4px",
              borderRadius: 3,
            }}
          >
            {currentSourceMeta.count}
          </span>
          <ChevronDown size={11} style={{ opacity: 0.7, marginLeft: 1 }} />
        </button>

        {/* FLOATING DROPDOWN POPUP */}
        {dropdownOpen && (
          <div
            data-interactive="true"
            style={{
              position: "absolute",
              top: dropdownUp ? "auto" : 28,
              bottom: dropdownUp ? 28 : "auto",
              left: dropdownRight ? "auto" : 0,
              right: dropdownRight ? 0 : "auto",
              width: 230,
              maxHeight: 340,
              overflowY: "auto",
              background: "rgba(15, 23, 42, 0.98)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(148, 163, 184, 0.25)",
              borderRadius: 8,
              boxShadow: "0 8px 30px rgba(0, 0, 0, 0.65)",
              padding: 4,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              zIndex: 50,
            }}
          >
            {/* SECTION 1: WATCHLISTS */}
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                color: "var(--muted, #94a3b8)",
                padding: "4px 8px 2px",
              }}
            >
              Watchlists
            </div>

            {watchlists.map((wl) => {
              const isSelected = loopSource === `wl:${wl._id}`;
              const count = wl.symbols?.length || 0;
              return (
                <button
                  key={wl._id}
                  onClick={() => {
                    onChangeSource?.(`wl:${wl._id}`);
                    setDropdownOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 8px",
                    borderRadius: 5,
                    border: "none",
                    background: isSelected ? "rgba(56, 189, 248, 0.15)" : "transparent",
                    color: isSelected ? "var(--accent, #38bdf8)" : "#cbd5e1",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                    transition: "background 0.12s ease",
                  }}
                >
                  <ListFilter size={12} color={isSelected ? "var(--accent, #38bdf8)" : "#94a3b8"} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{wl.name}</span>
                  <span style={{ fontSize: 9.5, opacity: 0.65 }}>{count}</span>
                  {isSelected && <Check size={12} />}
                </button>
              );
            })}

            {watchlists.length > 1 && (
              <button
                onClick={() => {
                  onChangeSource?.("all_wl");
                  setDropdownOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 8px",
                  borderRadius: 5,
                  border: "none",
                  background: loopSource === "all_wl" ? "rgba(56, 189, 248, 0.15)" : "transparent",
                  color: loopSource === "all_wl" ? "var(--accent, #38bdf8)" : "#cbd5e1",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 11,
                }}
              >
                <Layers size={12} color="#94a3b8" />
                <span style={{ flex: 1 }}>All Watchlists Combined</span>
                <span style={{ fontSize: 9.5, opacity: 0.65 }}>{counts.allWatchlists}</span>
                {loopSource === "all_wl" && <Check size={12} />}
              </button>
            )}

            {/* SECTION 2: SMART & AUTO WATCHLISTS */}
            {(counts.auto > 0 || counts.radar > 0) && (
              <>
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    color: "var(--muted, #94a3b8)",
                    padding: "6px 8px 2px",
                    borderTop: "1px solid rgba(148, 163, 184, 0.12)",
                    marginTop: 2,
                  }}
                >
                  Auto & Scanner Lists
                </div>

                {counts.auto > 0 && (
                  <button
                    onClick={() => {
                      onChangeSource?.("auto");
                      setDropdownOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 8px",
                      borderRadius: 5,
                      border: "none",
                      background: loopSource === "auto" ? "rgba(34, 197, 94, 0.15)" : "transparent",
                      color: loopSource === "auto" ? "#22c55e" : "#cbd5e1",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 11,
                    }}
                  >
                    <Zap size={12} color="#22c55e" />
                    <span style={{ flex: 1 }}>Autonomous Setups</span>
                    <span style={{ fontSize: 9.5, opacity: 0.65 }}>{counts.auto}</span>
                    {loopSource === "auto" && <Check size={12} />}
                  </button>
                )}

                {counts.radar > 0 && (
                  <button
                    onClick={() => {
                      onChangeSource?.("radar");
                      setDropdownOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 8px",
                      borderRadius: 5,
                      border: "none",
                      background: loopSource === "radar" ? "rgba(168, 85, 247, 0.15)" : "transparent",
                      color: loopSource === "radar" ? "#a855f7" : "#cbd5e1",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 11,
                    }}
                  >
                    <Radar size={12} color="#a855f7" />
                    <span style={{ flex: 1 }}>Radar Ideas</span>
                    <span style={{ fontSize: 9.5, opacity: 0.65 }}>{counts.radar}</span>
                    {loopSource === "radar" && <Check size={12} />}
                  </button>
                )}
              </>
            )}

            {/* SECTION 3: FLAG GROUPS */}
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                color: "var(--muted, #94a3b8)",
                padding: "6px 8px 2px",
                borderTop: "1px solid rgba(148, 163, 184, 0.12)",
                marginTop: 2,
              }}
            >
              Flag Groups
            </div>

            <button
              onClick={() => {
                onChangeSource?.("all_flags");
                setDropdownOpen(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 8px",
                borderRadius: 5,
                border: "none",
                background: loopSource === "all_flags" ? "rgba(239, 83, 80, 0.15)" : "transparent",
                color: loopSource === "all_flags" ? "#ef5350" : "#cbd5e1",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 11,
              }}
            >
              <Flag size={12} fill="#ef5350" color="#ef5350" />
              <span style={{ flex: 1 }}>All Flagged Symbols</span>
              <span style={{ fontSize: 9.5, opacity: 0.65 }}>{counts.flags.all}</span>
              {loopSource === "all_flags" && <Check size={12} />}
            </button>

            {FLAG_CONFIG.map((f) => {
              const isSelected = loopSource === `flag:${f.id}`;
              const count = counts.flags[f.id] || 0;
              return (
                <button
                  key={f.id}
                  onClick={() => {
                    onChangeSource?.(`flag:${f.id}`);
                    setDropdownOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 8px",
                    borderRadius: 5,
                    border: "none",
                    background: isSelected ? "rgba(255, 255, 255, 0.08)" : "transparent",
                    color: isSelected ? f.color : "#cbd5e1",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                  }}
                >
                  <Flag size={12} fill={f.color} color={f.color} />
                  <span style={{ flex: 1 }}>{f.label}</span>
                  <span style={{ fontSize: 9.5, opacity: 0.65 }}>{count}</span>
                  {isSelected && <Check size={12} />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* DIVIDER */}
      <div style={{ width: 1, height: 14, background: "rgba(148, 163, 184, 0.25)" }} />

      {/* 2. PLAYBACK CONTROLS */}
      {/* PREVIOUS */}
      <button
        onClick={onPrev}
        title="Previous symbol (Left Arrow)"
        style={{
          width: 24,
          height: 24,
          padding: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          borderRadius: 4,
          color: "var(--foreground, #f8fafc)",
          cursor: "pointer",
          opacity: 0.85,
        }}
      >
        <SkipBack size={13} strokeWidth={2} />
      </button>

      {/* PLAY / PAUSE */}
      <button
        onClick={onTogglePlay}
        title={isLooping ? "Pause slideshow (Space)" : "Play slideshow (Space)"}
        style={{
          height: 24,
          padding: "0 8px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          background: isLooping ? "rgba(34, 197, 94, 0.18)" : "rgba(255, 255, 255, 0.08)",
          border: isLooping ? "1px solid rgba(34, 197, 94, 0.4)" : "1px solid transparent",
          borderRadius: 4,
          color: isLooping ? "#22c55e" : "var(--foreground, #f8fafc)",
          cursor: "pointer",
          fontWeight: 600,
          fontSize: 11,
          transition: "all 0.15s ease",
        }}
      >
        {isLooping ? (
          <>
            <Pause size={12} fill="currentColor" strokeWidth={0} />
            <span style={{ fontSize: 10 }}>Live</span>
          </>
        ) : (
          <>
            <Play size={12} fill="currentColor" strokeWidth={0} style={{ marginLeft: 1 }} />
            <span style={{ fontSize: 10 }}>Play</span>
          </>
        )}
      </button>

      {/* NEXT */}
      <button
        onClick={onNext}
        title="Next symbol (Right Arrow)"
        style={{
          width: 24,
          height: 24,
          padding: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          borderRadius: 4,
          color: "var(--foreground, #f8fafc)",
          cursor: "pointer",
          opacity: 0.85,
        }}
      >
        <SkipForward size={13} strokeWidth={2} />
      </button>

      {/* DIVIDER */}
      <div style={{ width: 1, height: 14, background: "rgba(148, 163, 184, 0.25)" }} />

      {/* 3. SPEED / INTERVAL SELECTOR */}
      <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        <select
          value={loopInterval}
          onChange={(e) => onChangeInterval?.(Number(e.target.value))}
          title="Loop interval / speed"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--foreground, #f8fafc)",
            outline: "none",
            fontSize: 11,
            cursor: "pointer",
            padding: "2px 4px",
            borderRadius: 4,
            fontWeight: 500,
          }}
        >
          {INTERVAL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} style={{ background: "#0f172a", color: "#f8fafc" }}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* DIVIDER */}
      <div style={{ width: 1, height: 14, background: "rgba(148, 163, 184, 0.25)" }} />

      {/* 4. CURRENT POSITION INDICATOR */}
      <div
        style={{
          fontSize: 10.5,
          fontFamily: "var(--mono, monospace)",
          opacity: 0.8,
          padding: "0 4px",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <span style={{ fontWeight: 700, color: "var(--accent, #38bdf8)" }}>{currentSymbol}</span>
        <span style={{ opacity: 0.5 }}>•</span>
        <span>
          {currentIndex}/{loopSymbols.length || 0}
        </span>
      </div>

      {/* DIVIDER */}
      <div style={{ width: 1, height: 14, background: "rgba(148, 163, 184, 0.25)" }} />

      {/* 5. STOP / CLOSE BUTTON */}
      <button
        onClick={onClose}
        title="Close Loop (Esc)"
        style={{
          width: 24,
          height: 24,
          padding: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          borderRadius: 4,
          color: "var(--muted, #94a3b8)",
          cursor: "pointer",
          transition: "color 0.15s ease, background 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "#ef4444";
          e.currentTarget.style.background = "rgba(239, 68, 68, 0.12)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--muted, #94a3b8)";
          e.currentTarget.style.background = "transparent";
        }}
      >
        <X size={13} strokeWidth={2.5} />
      </button>
    </div>
  );
}
