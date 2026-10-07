"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { PATTERN_DEFS } from "../lib/patterns/index.js";

// ƒx-style dropdown: toggle each pattern detector like an indicator.
export default function IndicatorsMenu({ indicators, setIndicators }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const activeCount = PATTERN_DEFS.filter((d) => indicators?.[d.id]).length;

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = (id) =>
    setIndicators((prev) => ({ ...prev, [id]: !prev?.[id] }));

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        className={open || activeCount ? "primary" : "ghost"}
        onClick={() => setOpen(!open)}
        title="Indicators & Overlays"
        aria-label="Indicators & Overlays"
        style={{ padding: "4px 8px", display: "flex", alignItems: "center", gap: 4, fontSize: 12, flexShrink: 0, whiteSpace: "nowrap" }}
      >
        <Sparkles size={14} />
        {activeCount > 0 && (
          <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 8, background: "var(--accent)", color: "#fff", fontWeight: 700 }}>
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 100,
          background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6,
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)", padding: 8, width: 270,
          display: "flex", flexDirection: "column", gap: 2,
        }}>
          <div style={{ fontSize: 11, opacity: 0.6, padding: "2px 6px 6px", textTransform: "uppercase", fontWeight: 600 }}>
            Indicators & Overlays
          </div>
          {PATTERN_DEFS.map((d) => (
            <button
              key={d.id}
              className="ghost"
              onClick={() => toggle(d.id)}
              style={{
                display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 8px",
                textAlign: "left", width: "100%",
              }}
            >
              <span style={{
                width: 14, height: 14, borderRadius: 3, flexShrink: 0, marginTop: 1,
                border: "1px solid var(--border-hi)",
                background: indicators?.[d.id] ? "var(--accent)" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, color: "#fff",
              }}>
                {indicators?.[d.id] ? "✓" : ""}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ fontSize: 12, display: "block" }}>{d.label}</span>
                <span className="muted" style={{ fontSize: 10, display: "block" }}>{d.hint}</span>
              </span>
            </button>
          ))}
          {activeCount > 0 && (
            <button
              className="ghost"
              onClick={() => setIndicators({})}
              style={{ fontSize: 11, padding: "5px 8px", color: "var(--muted)" }}
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
