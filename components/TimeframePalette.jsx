"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";

const TFS = [
  { id: "M1", label: "1 minute", search: ["1", "1m", "m1"] },
  { id: "M5", label: "5 minutes", search: ["5", "5m", "m5"] },
  { id: "M15", label: "15 minutes", search: ["15", "15m", "m15"] },
  { id: "M30", label: "30 minutes", search: ["30", "30m", "m30"] },
  { id: "H1", label: "1 hour", search: ["1h", "60", "h1", "1"] },
  { id: "H4", label: "4 hours", search: ["4h", "240", "h4", "4"] },
  { id: "D1", label: "1 day", search: ["1d", "d1", "d", "1440"] },
];

export default function TimeframePalette({ initialQuery = "", onClose, onPick }) {
  const [q, setQ] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const items = TFS.filter(t => 
    !q || 
    t.id.toLowerCase().includes(q.toLowerCase()) || 
    t.label.toLowerCase().includes(q.toLowerCase()) ||
    t.search.some(s => s.startsWith(q.toLowerCase()))
  );

  const choose = useCallback((tfId) => onPick(tfId), [onPick]);

  const onKeyDown = useCallback((e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const it = items[active];
      if (it) choose(it.id);
    }
  }, [items, active, choose, onClose]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,.55)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh"
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: "min(400px, 92vw)", background: "var(--panel)",
          border: "1px solid var(--border-hi)", borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,.6)", overflow: "hidden",
          display: "flex", flexDirection: "column"
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", gap: 12 }}>
          <Clock size={16} color="var(--muted)" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Change interval (e.g. 15, 1h, D)"
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "var(--fg)", fontSize: 16, fontFamily: "var(--mono)"
            }}
          />
        </div>
        <div style={{ maxHeight: "40vh", overflowY: "auto", paddingBottom: 8 }}>
          {items.map((it, i) => (
            <div
              key={it.id}
              onMouseMove={() => setActive(i)}
              onClick={() => choose(it.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", cursor: "pointer",
                background: i === active ? "var(--accent-soft)" : "transparent",
                borderLeft: i === active ? "2px solid var(--accent)" : "2px solid transparent",
              }}
            >
              <span className="num" style={{ fontWeight: 600, width: 40, color: "var(--fg)" }}>{it.id}</span>
              <span className="muted" style={{ fontSize: 13 }}>{it.label}</span>
            </div>
          ))}
          {items.length === 0 && (
             <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontStyle: "italic", fontSize: 13 }}>
                No timeframes found
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
