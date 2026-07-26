"use client";

import { useState, useEffect } from "react";
import { Settings, Copy, Trash2, Lock, Unlock, Eye, EyeOff, BringToFront, SendToBack } from "lucide-react";
import { PALETTE } from "../lib/draw/core.js";

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

  const isRR = selected.type === "rrtool" && selected.entry && selected.entry.price !== undefined && selected.target !== undefined && selected.stop !== undefined;
  const isLong = isRR ? selected.target >= selected.entry.price : true;
  const risk = isRR ? Math.abs(selected.entry.price - selected.stop) : 0;
  const rew = isRR ? Math.abs(selected.target - selected.entry.price) : 0;

  const handleSelectSide = (side) => {
    if (!isRR) return;
    const wantLong = side === "long";
    if (isLong !== wantLong) {
      updateSelected({
        rrSide: side,
        stop: wantLong ? selected.entry.price - risk : selected.entry.price + risk,
        target: wantLong ? selected.entry.price + rew : selected.entry.price - rew,
      });
    }
  };

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 40,
        background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,.4)", display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
        whiteSpace: "nowrap", overflowX: "auto", maxWidth: "90vw"
      }}
    >
      {selected.type === "rrtool" && (
        <>
          <div style={{ display: "flex", background: "rgba(0,0,0,0.25)", border: "1px solid var(--border)", borderRadius: 6, padding: 2, gap: 2 }}>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); handleSelectSide("long"); }}
              style={{
                padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: isLong ? 600 : 500,
                color: isLong ? "#fff" : "var(--muted)",
                background: isLong ? "#26a69a" : "transparent", border: "none", cursor: "pointer",
                boxShadow: isLong ? "0 2px 6px rgba(38,166,154,0.35)" : "none",
                display: "flex", alignItems: "center", gap: 4
              }}
            >
              Long
            </button>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); handleSelectSide("short"); }}
              style={{
                padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: !isLong ? 600 : 500,
                color: !isLong ? "#fff" : "var(--muted)",
                background: !isLong ? "#ef5350" : "transparent", border: "none", cursor: "pointer",
                boxShadow: !isLong ? "0 2px 6px rgba(239,83,80,0.35)" : "none",
                display: "flex", alignItems: "center", gap: 4
              }}
            >
              Short
            </button>
          </div>
          <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px" }} />
        </>
      )}

      <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
        {PALETTE.map(c => (
          <button
            key={c} onClick={() => set({ color: c, fill: selected.type === "rectangle" ? c : selected.fill })}
            title={c}
            style={{
              width: 16, height: 16, padding: 0, borderRadius: 3, cursor: "pointer", flexShrink: 0,
              background: c, border: selected.color === c ? "2px solid #fff" : "1px solid transparent",
            }}
          />
        ))}
      </div>

      <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px" }} />

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
            className={selected.style === s.v ? "primary" : "ghost"}
            style={{ padding: "2px 5px", fontSize: 12, minWidth: 22, cursor: "pointer", borderRadius: 4 }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px" }} />

      <Btn icon={Settings} onClick={() => setSettingsOpen(true)} title="Settings" />
      <Btn icon={Copy} onClick={cloneSelected} title="Copy" />
      <Btn icon={BringToFront} onClick={bringToFront} title="Bring to front ( ] )" />
      <Btn icon={SendToBack} onClick={sendToBack} title="Send to back ( [ )" />
      <Btn icon={selected.locked ? Unlock : Lock} onClick={() => toggleLock(selected.id)} active={selected.locked} title={selected.locked ? "Unlock" : "Lock"} />
      <Btn icon={selected.hidden ? EyeOff : Eye} onClick={() => toggleHide(selected.id)} active={selected.hidden} title={selected.hidden ? "Show" : "Hide"} />
      <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px" }} />
      <Btn icon={Trash2} onClick={deleteSelected} danger title="Delete" />
    </div>
  );
}
