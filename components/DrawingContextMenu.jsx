"use client";

import { useState, useEffect, useRef } from "react";
import { Copy, Trash2, Lock, Unlock, Eye, EyeOff, BringToFront, SendToBack, Settings, Crosshair } from "lucide-react";

// Right-click menu for a drawing. Positioned at the click point; closes on
// any outside click or action. Actions mutate the drawing via the api.
export default function DrawingContextMenu({ api }) {
  const { ctxMenu, setCtxMenu, selected, setSettingsOpen,
    cloneSelected, deleteSelected, bringToFront, sendToBack, toggleLock, toggleHide, sendToExecutor } = api;

  const menuRef = useRef(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setCtxMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close, { passive: true });
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [ctxMenu, setCtxMenu]);

  if (!ctxMenu || !selected) return null;

  const stop = (e) => { e.stopPropagation(); };
  const Item = ({ icon: Icon, label, onClick, danger }) => {
    const [h, setH] = useState(false);
    return (
      <div
        onTouchStart={(e) => { e.stopPropagation(); }}
        onPointerDown={(e) => { e.stopPropagation(); }}
        onMouseDown={(e) => { e.stopPropagation(); }}
        onClick={(e) => { e.stopPropagation(); onClick(); setCtxMenu(null); }}
        onMouseEnter={() => setH(true)}
        onMouseLeave={() => setH(false)}
        style={{
          padding: "8px 12px", cursor: "pointer", fontSize: 12, display: "flex",
          alignItems: "center", gap: 8, whiteSpace: "nowrap",
          background: h ? (danger ? "rgba(239,83,80,.15)" : "var(--accent-soft)") : "transparent",
          color: danger && h ? "var(--red)" : "var(--text)",
        }}
      >
        <Icon size={14} /> {label}
      </div>
    );
  };

  return (
    <div
      ref={menuRef}
      onMouseDown={stop}
      onPointerDown={stop}
      onTouchStart={stop}
      style={{
        position: "absolute", left: ctxMenu.x, top: ctxMenu.y, zIndex: 50, minWidth: 180,
        background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8,
        boxShadow: "0 8px 28px rgba(0,0,0,.6)", overflow: "hidden",
      }}
    >
      <div style={{ padding: "6px 12px", fontSize: 11, textTransform: "uppercase", opacity: 0.5, fontWeight: 600, borderBottom: "1px solid var(--border)" }}>
        {selected.type}
      </div>
      <Item icon={Settings} label="Edit settings" onClick={() => setSettingsOpen(true)} />
      {selected.type === "rrtool" && sendToExecutor && (
        <Item icon={Crosshair} label="Send to Executor" onClick={async () => {
          const res = await sendToExecutor();
          if (!res?.ok) window.alert(`Executor: ${res?.error || "failed"}`);
        }} />
      )}
      <Item icon={Copy} label="Clone" onClick={cloneSelected} />
      <Item icon={BringToFront} label="Bring to front" onClick={bringToFront} />
      <Item icon={SendToBack} label="Send to back" onClick={sendToBack} />
      <Item icon={selected.locked ? Unlock : Lock} label={selected.locked ? "Unlock" : "Lock"} onClick={() => toggleLock(selected.id)} />
      <Item icon={selected.hidden ? Eye : EyeOff} label={selected.hidden ? "Show" : "Hide"} onClick={() => toggleHide(selected.id)} />
      <div style={{ height: 1, background: "var(--border)" }} />
      <Item icon={Trash2} label="Delete (Del)" danger onClick={deleteSelected} />
    </div>
  );
}
