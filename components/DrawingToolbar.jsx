"use client";

import React, { useState, useRef, useEffect } from "react";

import { MousePointer2, TrendingUp, Minus, Square, GitCompareArrows, Ruler,
  Lock, Unlock, Trash2, Undo2, Redo2, Settings, GripHorizontal, Type, Magnet, Camera } from "lucide-react";
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

  // the style editor targets the selected drawing (if any) or the default style
  const styleTarget = selected || drawStyle;
  const setStyleField = (field, val) => {
    if (selected) {
      updateSelected({ [field]: val });
    } else {
      setDrawStyle((s) => ({ ...s, [field]: val }));
    }
  };

  const showStyleRow = !!activeTool || !!selected;
  const currentColor = selected ? selected.color : drawStyle.color;

  const [pos, setPos] = useState(null);
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
        startX: el.offsetLeft,
        startY: el.offsetTop,
      };
      if (!pos) setPos({ x: el.offsetLeft, y: el.offsetTop });
    }
  };

  return (
    <div 
      className="drawing-toolbar"
      ref={toolbarRef}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
      position: "absolute", 
      left: pos ? pos.x : 8, 
      top: pos ? pos.y : "50%", 
      transform: pos ? "none" : "translateY(-50%)",
      zIndex: 40, display: "flex", flexDirection: "column", gap: 2,
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

      <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />

      {showStyleRow && (
        <>
          <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 3, padding: 2 }}>
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => setStyleField("color", c)}
                title={c}
                style={{
                  width: 16, height: 16, padding: 0, borderRadius: 4, cursor: "pointer",
                  background: c, border: currentColor === c ? "2px solid #fff" : "1px solid var(--border)",
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", gap: 3, padding: 2 }}>
            {[1, 2, 3, 4].map((w) => (
              <button
                key={w}
                onClick={() => setStyleField("width", w)}
                title={`Width ${w}`}
                className={styleTarget.width === w ? "primary" : "ghost"}
                style={{ padding: "2px 4px", fontSize: 10, minWidth: 18 }}
              >
                {w}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 3, padding: 2 }}>
            {[
              { v: "solid", label: "—" },
              { v: "dashed", label: "╌" },
              { v: "dotted", label: "┄" },
            ].map((s) => (
              <button
                key={s.v}
                onClick={() => setStyleField("style", s.v)}
                title={s.v}
                className={styleTarget.style === s.v ? "primary" : "ghost"}
                style={{ padding: "2px 6px", fontSize: 12, minWidth: 22 }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
