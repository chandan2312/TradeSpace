"use client";

import { Settings, Copy, Trash2, Lock, Unlock, Eye, EyeOff } from "lucide-react";
import { PALETTE } from "../lib/draw/core.js";

export default function MiniDrawingToolbar({ api }) {
  const { selected, setSettingsOpen, updateSelected, cloneSelected, deleteSelected, toggleLock, toggleHide, activeTool } = api;

  if (!selected || activeTool) return null;

  const set = (patch) => updateSelected(patch);

  const Btn = ({ icon: Icon, onClick, danger, active }) => (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={active ? "primary" : "ghost"}
      style={{
        padding: "6px", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
        color: danger ? "var(--red)" : "inherit"
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
        boxShadow: "0 4px 16px rgba(0,0,0,.4)", display: "flex", alignItems: "center", gap: 4, padding: "4px 6px"
      }}
    >
      <div style={{ display: "flex", gap: 2, paddingRight: 6, borderRight: "1px solid var(--border)" }}>
        {PALETTE.slice(0, 4).map(c => (
          <button
            key={c} onClick={() => set({ color: c, fill: selected.type === "rectangle" ? c : selected.fill })}
            style={{
              width: 16, height: 16, padding: 0, borderRadius: 4, cursor: "pointer",
              background: c, border: selected.color === c ? "2px solid #fff" : "1px solid transparent",
            }}
          />
        ))}
      </div>
      
      <Btn icon={Settings} onClick={() => setSettingsOpen(true)} />
      <Btn icon={Copy} onClick={cloneSelected} />
      <Btn icon={selected.locked ? Unlock : Lock} onClick={() => toggleLock(selected.id)} active={selected.locked} />
      <Btn icon={selected.hidden ? EyeOff : Eye} onClick={() => toggleHide(selected.id)} active={selected.hidden} />
      <div style={{ width: 1, height: 16, background: "var(--border)", margin: "0 2px" }} />
      <Btn icon={Trash2} onClick={deleteSelected} danger />
    </div>
  );
}
