"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Fast, keyboard-first symbol search across the entire broker universe.
// Two modes: "switch" (load chart) or "add" (append to active watchlist).
export default function SymbolPalette({ mode, onClose, onPick, onAddToList }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const reqId = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced search against the cached broker symbol list.
  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/symbols?q=${encodeURIComponent(q)}&limit=100`);
        const data = await res.json();
        if (id !== reqId.current) return; // a newer search superseded us
        setItems(data.ok ? data.symbols : []);
        setTotal(data.ok ? data.total : 0);
        setActive(0);
      } catch {
        /* network blip — keep last results */
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 160);
    return () => clearTimeout(handle);
  }, [q]);

  const choose = useCallback((sym) => onPick(sym), [onPick]);

  const onKeyDown = useCallback((e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const it = items[active];
      if (it) choose(it.name);
    }
  }, [items, active, onClose, choose]);

  // keep the highlighted row scrolled into view during keyboard nav
  useEffect(() => {
    const row = listRef.current?.querySelector(`[data-idx="${active}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const title = mode === "add" ? "Add to watchlist" : "Switch chart";
  const hint = mode === "add" ? "Enter to add · Esc to close" : "Enter to load · Esc to close";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,.55)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "12vh",
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: "min(620px, 92vw)", maxHeight: "70vh", display: "flex", flexDirection: "column",
          background: "var(--panel)", border: "1px solid var(--border-hi)", borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,.6)", overflow: "hidden",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <span className="muted" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 }}>{title}</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search symbol or name…  (e.g. EUR, gold, US30)"
            style={{ flex: 1, background: "var(--bg)" }}
          />
          <button className="ghost" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div ref={listRef} style={{ flex: 1, overflowY: "auto", minHeight: 120 }}>
          {loading && !items.length && (
            <div style={{ padding: 14 }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 30, marginBottom: 6 }} />
              ))}
            </div>
          )}

          {!loading && !items.length && (
            <div className="muted" style={{ padding: 24, textAlign: "center" }}>
              {q ? `No symbols match “${q}”.` : "Start typing to search the broker universe."}
            </div>
          )}

          {items.map((s, i) => (
            <Row
              key={s.name + i}
              idx={i}
              active={i === active}
              symbol={s}
              mode={mode}
              onHover={() => setActive(i)}
              onPick={() => choose(s.name)}
              onAddToList={onAddToList ? () => onAddToList(s.name) : undefined}
            />
          ))}
        </div>

        <div style={{
          padding: "7px 12px", borderTop: "1px solid var(--border)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 11, color: "var(--muted)",
        }}>
          <span>{hint}</span>
          <span>{total.toLocaleString()} symbols</span>
        </div>
      </div>
    </div>
  );
}

function Row({ idx, active, symbol, mode, onHover, onPick, onAddToList }) {
  return (
    <div
      data-idx={idx}
      onMouseMove={onHover}
      onClick={onPick}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer",
        background: active ? "var(--accent-soft)" : "transparent",
        borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="num" style={{ fontWeight: 600, fontSize: 13 }}>{symbol.name}</div>
        {symbol.description && (
          <div className="muted" style={{ fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {symbol.description}
          </div>
        )}
      </div>
      {symbol.path && (
        <div className="muted" style={{ fontSize: 10, fontFamily: "var(--mono)" }}>{symbol.path}</div>
      )}
      {mode === "switch" && onAddToList && (
        <button
          className="ghost"
          title="Add to active watchlist"
          onClick={(e) => { e.stopPropagation(); onAddToList(); }}
          style={{ padding: "2px 8px", fontSize: 16, lineHeight: 1 }}
        >
          ＋
        </button>
      )}
    </div>
  );
}
