"use client";

import { useState, useEffect } from "react";
import { Settings, Copy, Trash2, Lock, Unlock, Eye, EyeOff, BringToFront, SendToBack } from "lucide-react";
import ColorPicker from "./ColorPicker.jsx";

export default function MiniDrawingToolbar({ api }) {
  const { selected, setSettingsOpen, updateSelected, cloneSelected, deleteSelected, bringToFront, sendToBack, toggleLock, toggleHide, activeTool } = api;

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (!selected || activeTool || isMobile) return null;

  const set = (patch) => updateSelected(patch);

  const Btn = ({ icon: Icon, onClick, danger, active, title }) => (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={active ? "primary" : "ghost"}
      title={title}
      style={{
        padding: "6px", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
        color: danger ? "var(--red)" : "inherit", cursor: "pointer"
      }}
    >
      <Icon size={14} />
    </button>
  );

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 40,
        background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,.5)", display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
        whiteSpace: "nowrap", overflowX: "auto", maxWidth: "90vw"
      }}
    >
      {/* Drawing type badge */}
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "capitalize", color: "var(--muted)", paddingRight: 4, borderRight: "1px solid var(--border)" }}>
        {selected.kind || selected.type}
      </span>

      {/* Color Picker — full picker replaces the old 5-6 swatches */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ display: "flex", alignItems: "center", gap: 4 }}
        title="Line color"
      >
        <span style={{ fontSize: 10, color: "var(--muted)" }}>Color</span>
        <ColorPicker
          value={selected.color || selected.style?.color || "#2962ff"}
          onChange={(c) => set({ color: c, fill: c })}
          label="Line color"
          size={20}
        />
      </div>

      <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px" }} />

      {/* Width Buttons */}
      <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
        {[1, 2, 3, 4].map((w) => (
          <button
            key={w}
            onClick={() => set({ width: w })}
            title={`Width ${w}px`}
            className={selected.width === w ? "primary" : "ghost"}
            style={{ padding: "2px 5px", fontSize: 11, minWidth: 20, cursor: "pointer", borderRadius: 4 }}
          >
            {w}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px" }} />

      {/* Style Buttons */}
      <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
        {[
          { v: "solid", label: "—" },
          { v: "dashed", label: "╌" },
          { v: "dotted", label: "┄" },
        ].map((s) => (
          <button
            key={s.v}
            onClick={() => set({ style: s.v })}
            title={s.v}
            className={selected.lineStyleName === s.v ? "primary" : "ghost"}
            style={{ padding: "2px 5px", fontSize: 12, minWidth: 22, cursor: "pointer", borderRadius: 4 }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px" }} />

      <Btn icon={Settings} onClick={() => setSettingsOpen(true)} title="Settings (full options)" />
      <Btn icon={Copy} onClick={cloneSelected} title="Clone" />
      <Btn icon={BringToFront} onClick={bringToFront} title="Bring to front ( ] )" />
      <Btn icon={SendToBack} onClick={sendToBack} title="Send to back ( [ )" />
      <Btn icon={selected.locked ? Unlock : Lock} onClick={() => toggleLock(selected.id)} active={selected.locked} title={selected.locked ? "Unlock" : "Lock"} />
      <Btn icon={selected.hidden ? EyeOff : Eye} onClick={() => toggleHide(selected.id)} active={selected.hidden} title={selected.hidden ? "Show" : "Hide"} />

      <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px" }} />
      <Btn icon={Trash2} onClick={deleteSelected} danger title="Delete (Del)" />
    </div>
  );
}
