"use client";

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

import { MousePointer2, TrendingUp, Minus, Square, GitCompareArrows, Ruler,
  Lock, Unlock, Trash2, Undo2, Redo2, Settings, GripHorizontal, Type, Magnet, Camera, Copy, Eye, EyeOff, BringToFront, SendToBack } from "lucide-react";
import { TOOLS, PALETTE } from "../lib/draw/core.js";

const ICONS = {
  cursor: MousePointer2,
  trendline: TrendingUp,
  horizontal: Minus,
  rectangle: Square,
  rrtool: GitCompareArrows,
  measure: Ruler,
  fib: GripHorizontal,
  text: Type,
};

let globalToolbarPos = null;

// Vertical drawing-tools icon bar pinned to the left edge of a chart pane.
// Only the active pane shows it to avoid clutter across a multi-pane grid.
export default function DrawingToolbar({ api }) {
  const {
    activeTool, setActiveTool, lockTool, setLockTool,
    drawStyle, setDrawStyle, selected, updateSelected,
    clearAll, undo, redo, canUndo, canRedo,
    setSettingsOpen, settingsOpen, drawings,
  } = api;

  const onPickTool = (id) => {
    if (id === "cursor") { setActiveTool(null); return; }
    setActiveTool((cur) => (cur === id ? null : id));
  };

  const setStyleField = (field, val) => {
    if (selected) {
      updateSelected({ [field]: val });
    } else {
      setDrawStyle((s) => ({ ...s, [field]: val }));
    }
  };

  const [pos, setPosState] = useState(globalToolbarPos);
  
  const setPos = (newPos) => {
    globalToolbarPos = newPos;
    setPosState(newPos);
  };

  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, startX: 0, startY: 0 });
  const toolbarRef = useRef(null);

  useEffect(() => {
    const handleMove = (e) => {
      if (!dragging.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setPos({
        x: Math.max(0, dragStart.current.startX + dx),
        y: Math.max(0, dragStart.current.startY + dy),
      });
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
    e.stopPropagation();
    e.preventDefault();
    dragging.current = true;
    const el = toolbarRef.current;
    if (el) {
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        startX: el.getBoundingClientRect().left,
        startY: el.getBoundingClientRect().top,
      };
      if (!pos) setPos({ x: el.getBoundingClientRect().left, y: el.getBoundingClientRect().top });
    }
  };

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const isRRSelected = selected && selected.type === "rrtool" && selected.entry && selected.entry.price !== undefined && selected.target !== undefined && selected.stop !== undefined;
  const currentRRSide = isRRSelected
    ? (selected.target >= selected.entry.price ? "long" : "short")
    : (drawStyle.rrSide || "long");

  const handleSelectRRSide = (side) => {
    setStyleField("rrSide", side);
    if (isRRSelected) {
      const isCurrentlyLong = selected.target >= selected.entry.price;
      const wantLong = side === "long";
      if (isCurrentlyLong !== wantLong) {
        const risk = Math.abs(selected.entry.price - selected.stop);
        const rew = Math.abs(selected.target - selected.entry.price);
        updateSelected({
          rrSide: side,
          stop: wantLong ? selected.entry.price - risk : selected.entry.price + risk,
          target: wantLong ? selected.entry.price + rew : selected.entry.price - rew,
        });
      }
    }
  };

  const rrButtonRef = useRef(null);
  const [rrPopupCoords, setRrPopupCoords] = useState(null);

  useEffect(() => {
    if (activeTool !== "rrtool") {
      setRrPopupCoords(null);
      return;
    }
    const updateCoords = () => {
      const el = rrButtonRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (isMobile) {
        setRrPopupCoords({
          position: "fixed",
          left: rect.left + rect.width / 2,
          bottom: window.innerHeight - rect.top + 8,
          top: "auto",
          transform: "translateX(-50%)",
          flexDirection: "row"
        });
      } else {
        setRrPopupCoords({
          position: "fixed",
          left: rect.right + 8,
          top: rect.top,
          bottom: "auto",
          transform: "none",
          flexDirection: "column"
        });
      }
    };
    updateCoords();
    window.addEventListener("resize", updateCoords);
    window.addEventListener("scroll", updateCoords, true);
    return () => {
      window.removeEventListener("resize", updateCoords);
      window.removeEventListener("scroll", updateCoords, true);
    };
  }, [activeTool, isMobile, pos]);

  const content = (
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
      padding: 4, boxShadow: "0 4px 14px rgba(0,0,0,.5)",
    }}>
      <div 
        className="drawing-toolbar-drag"
        onPointerDown={onDragStart}
        style={{ cursor: "grab", display: "flex", justifyContent: "center", padding: "4px 0", color: "var(--muted)", touchAction: "none" }}
      >
        <GripHorizontal size={14} />
      </div>

      {TOOLS.map((t) => {
        const Icon = ICONS[t.id];
        const on = t.id === "cursor" ? !activeTool : activeTool === t.id;
        return (
          <button
            key={t.id}
            ref={t.id === "rrtool" ? rrButtonRef : null}
            className={on ? "primary" : "ghost"}
            onClick={() => onPickTool(t.id)}
            title={t.label}
            style={{ padding: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >
            <Icon size={16} />
          </button>
        );
      })}

      <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />

      <button
        className={lockTool ? "primary" : "ghost"}
        onClick={() => setLockTool(!lockTool)}
        title={lockTool ? "Tool locked (stays active after drawing)" : "Lock tool"}
        style={{ padding: 6, display: "flex", justifyContent: "center" }}
      >
        {lockTool ? <Lock size={16} /> : <Unlock size={16} />}
      </button>
      <button
        className="ghost"
        onClick={undo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        style={{ padding: 6, display: "flex", justifyContent: "center", opacity: canUndo ? 1 : 0.35 }}
      >
        <Undo2 size={16} />
      </button>
      <button
        className="ghost"
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
        style={{ padding: 6, display: "flex", justifyContent: "center", opacity: canRedo ? 1 : 0.35 }}
      >
        <Redo2 size={16} />
      </button>
      <button
        className="ghost"
        onClick={() => setSettingsOpen(!settingsOpen)}
        title="Drawing settings"
        style={{ padding: 6, display: "flex", justifyContent: "center" }}
      >
        <Settings size={16} />
      </button>
      <button
        className="ghost"
        onClick={clearAll}
        disabled={!drawings.length}
        title="Clear all drawings"
        style={{ padding: 6, display: "flex", justifyContent: "center", opacity: drawings.length ? 1 : 0.35 }}
      >
        <Trash2 size={16} />
      </button>

      <button
        className={api.magnetMode ? "primary" : "ghost"}
        onClick={() => api.setMagnetMode(!api.magnetMode)}
        title="Magnet mode (snap to OHLC)"
        style={{ padding: 6, display: "flex", justifyContent: "center" }}
      >
        <Magnet size={16} />
      </button>

      <button
        className="ghost"
        onClick={() => {
          if (api.exportChart) api.exportChart();
        }}
        title="Export screenshot"
        style={{ padding: 6, display: "flex", justifyContent: "center" }}
      >
        <Camera size={16} />
      </button>
    </div>
  );

  const mobileEditToolbar = (isMobile && selected) ? (
    <div
      className="drawing-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        background: "var(--panel)",
        border: "none",
        width: "100%",
        overflowX: "auto",
        whiteSpace: "nowrap"
      }}
    >
      <button
        onClick={() => api.setSelectedId && api.setSelectedId(null)}
        className="ghost"
        title="Exit edit mode / Done"
        style={{ padding: "4px 10px", display: "flex", alignItems: "center", gap: 4, fontWeight: 700, color: "var(--brand)", flexShrink: 0, border: "1px solid var(--brand)", borderRadius: 6, cursor: "pointer" }}
      >
        <span>← Done</span>
      </button>

      <div style={{ width: 1, height: 20, background: "var(--border)", flexShrink: 0, margin: "0 2px" }} />

      {selected.type === "rrtool" && (
        <>
          <div style={{ display: "flex", background: "rgba(0,0,0,0.25)", border: "1px solid var(--border)", borderRadius: 6, padding: 2, gap: 2, flexShrink: 0 }}>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); handleSelectRRSide("long"); }}
              style={{
                padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: currentRRSide === "long" ? 600 : 500,
                color: currentRRSide === "long" ? "#fff" : "var(--muted)",
                background: currentRRSide === "long" ? "#26a69a" : "transparent", border: "none", cursor: "pointer",
                boxShadow: currentRRSide === "long" ? "0 2px 6px rgba(38,166,154,0.35)" : "none",
                display: "flex", alignItems: "center", gap: 4
              }}
            >
              Long
            </button>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); handleSelectRRSide("short"); }}
              style={{
                padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: currentRRSide === "short" ? 600 : 500,
                color: currentRRSide === "short" ? "#fff" : "var(--muted)",
                background: currentRRSide === "short" ? "#ef5350" : "transparent", border: "none", cursor: "pointer",
                boxShadow: currentRRSide === "short" ? "0 2px 6px rgba(239,83,80,0.35)" : "none",
                display: "flex", alignItems: "center", gap: 4
              }}
            >
              Short
            </button>
          </div>
          <div style={{ width: 1, height: 20, background: "var(--border)", flexShrink: 0, margin: "0 2px" }} />
        </>
      )}

      <div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>
        {PALETTE.map((c) => (
          <button
            key={c}
            onClick={() => updateSelected({ color: c, fill: selected.type === "rectangle" ? c : selected.fill })}
            style={{
              width: 20, height: 20, padding: 0, borderRadius: 4, cursor: "pointer", flexShrink: 0,
              background: c, border: selected.color === c ? "2px solid #fff" : "1px solid var(--border)",
            }}
          />
        ))}
      </div>

      <div style={{ width: 1, height: 20, background: "var(--border)", flexShrink: 0, margin: "0 2px" }} />

      <div style={{ display: "flex", gap: 3, flexShrink: 0, alignItems: "center" }}>
        {[1, 2, 3, 4].map((w) => (
          <button
            key={w}
            onClick={() => updateSelected({ width: w })}
            className={selected.width === w ? "primary" : "ghost"}
            style={{ padding: "4px 6px", fontSize: 11, minWidth: 22, flexShrink: 0, cursor: "pointer", borderRadius: 4 }}
          >
            {w}px
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 20, background: "var(--border)", flexShrink: 0, margin: "0 2px" }} />

      <div style={{ display: "flex", gap: 3, flexShrink: 0, alignItems: "center" }}>
        {[
          { v: "solid", label: "—" },
          { v: "dashed", label: "╌" },
          { v: "dotted", label: "┄" },
        ].map((s) => (
          <button
            key={s.v}
            onClick={() => updateSelected({ style: s.v })}
            className={selected.style === s.v ? "primary" : "ghost"}
            style={{ padding: "4px 6px", fontSize: 12, minWidth: 24, flexShrink: 0, cursor: "pointer", borderRadius: 4 }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 20, background: "var(--border)", flexShrink: 0, margin: "0 2px" }} />

      <button
        onClick={() => setSettingsOpen(true)}
        className="ghost"
        title="Settings"
        style={{ padding: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", borderRadius: 4 }}
      >
        <Settings size={16} />
      </button>

      <button
        onClick={() => api.cloneSelected && api.cloneSelected()}
        className="ghost"
        title="Copy"
        style={{ padding: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", borderRadius: 4 }}
      >
        <Copy size={16} />
      </button>

      <button
        onClick={() => api.bringToFront && api.bringToFront()}
        className="ghost"
        title="Bring to front ( ] )"
        style={{ padding: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", borderRadius: 4 }}
      >
        <BringToFront size={16} />
      </button>

      <button
        onClick={() => api.sendToBack && api.sendToBack()}
        className="ghost"
        title="Send to back ( [ )"
        style={{ padding: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", borderRadius: 4 }}
      >
        <SendToBack size={16} />
      </button>

      <button
        onClick={() => api.toggleLock && api.toggleLock(selected.id)}
        className={selected.locked ? "primary" : "ghost"}
        title={selected.locked ? "Unlock" : "Lock"}
        style={{ padding: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", borderRadius: 4 }}
      >
        {selected.locked ? <Unlock size={16} /> : <Lock size={16} />}
      </button>

      <button
        onClick={() => api.toggleHide && api.toggleHide(selected.id)}
        className={selected.hidden ? "primary" : "ghost"}
        title={selected.hidden ? "Show" : "Hide"}
        style={{ padding: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", borderRadius: 4 }}
      >
        {selected.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>

      <button
        onClick={() => api.deleteSelected && api.deleteSelected()}
        className="ghost"
        title="Delete"
        style={{ padding: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#ef5350", cursor: "pointer", borderRadius: 4 }}
      >
        <Trash2 size={16} />
      </button>
    </div>
  ) : null;

  const rrPopupPortal = (activeTool === "rrtool" && rrPopupCoords && typeof document !== "undefined") ? createPortal(
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        ...rrPopupCoords,
        zIndex: 100000,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "3px",
        boxShadow: "0 6px 20px rgba(0,0,0,0.6)",
        display: "flex",
        whiteSpace: "nowrap"
      }}
    >
      <div style={{ display: "flex", background: "rgba(0,0,0,0.25)", border: "1px solid var(--border)", borderRadius: 6, padding: 2, gap: 2 }}>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            handleSelectRRSide("long");
          }}
          style={{
            padding: "4px 12px", borderRadius: 4, display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: currentRRSide === "long" ? 600 : 500,
            color: currentRRSide === "long" ? "#fff" : "var(--muted)",
            background: currentRRSide === "long" ? "#26a69a" : "transparent", border: "none", cursor: "pointer",
            boxShadow: currentRRSide === "long" ? "0 2px 6px rgba(38,166,154,0.35)" : "none"
          }}
        >
          Long
        </button>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            handleSelectRRSide("short");
          }}
          style={{
            padding: "4px 12px", borderRadius: 4, display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: currentRRSide === "short" ? 600 : 500,
            color: currentRRSide === "short" ? "#fff" : "var(--muted)",
            background: currentRRSide === "short" ? "#ef5350" : "transparent", border: "none", cursor: "pointer",
            boxShadow: currentRRSide === "short" ? "0 2px 6px rgba(239,83,80,0.35)" : "none"
          }}
        >
          Short
        </button>
      </div>
    </div>,
    document.body
  ) : null;

  if (isMobile) {
    const portalDest = typeof document !== 'undefined' ? document.getElementById("mobile-drawing-portal") : null;
    if (portalDest) {
      return (
        <>
          {createPortal(selected ? mobileEditToolbar : content, portalDest)}
          {rrPopupPortal}
        </>
      );
    }
  } else if (typeof document !== 'undefined') {
    return (
      <>
        {createPortal(content, document.body)}
        {rrPopupPortal}
      </>
    );
  }

  return (
    <>
      {content}
      {rrPopupPortal}
    </>
  );
}
