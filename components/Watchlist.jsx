"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2, Plus, GripVertical, Flag, X, ArrowUp, ArrowDown, Settings2 } from "lucide-react";

// Right-sidebar watchlist with multiple named lists (tabs), create/rename/delete,
// live bid/spread per symbol, click-to-switch, and drag-to-reorder rows.
export default function Watchlist({
  watchlists, activeListId, setActiveListId,
  symbol, setSymbol, ticks, alerts,
  onCreate, onRename, onDelete, onAddSymbol, onRemoveSymbol,
  symbolFlags, setSymbolFlags, onNavUp, onNavDown
}) {
  const list = watchlists.find((w) => w._id === activeListId) || null;
  const [editing, setEditing] = useState(null); // list id being renamed, or "new"
  const [name, setName] = useState("");
  const [drag, setDrag] = useState(null); // symbol being dragged
  const [over, setOver] = useState(null); // symbol currently hovered
  const [editModalOpen, setEditModalOpen] = useState(false);

  const activeAlertSymbols = new Set(
    alerts.filter((a) => a.status === "active").map((a) => a.symbol)
  );

  const startCreate = () => { setEditing("new"); setName(""); };
  const startRename = (w) => { setEditing(w._id); setName(w.name); };

  const commitName = async () => {
    const v = name.trim();
    if (editing === "new") {
      if (v) await onCreate(v);
    } else if (editing) {
      if (v) await onRename(editing, v);
    }
    setEditing(null);
    setName("");
  };

  const [dailyOpens, setDailyOpens] = useState({});
  useEffect(() => {
    const syms = list?.symbols || [];
    syms.forEach((sym) => {
      if (dailyOpens[sym] || dailyOpens[sym] === "loading") return;
      setDailyOpens((prev) => ({ ...prev, [sym]: "loading" }));
      fetch(`/api/rates?symbol=${sym}&tf=D1&count=1`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && data.bars?.length > 0) {
            setDailyOpens((prev) => ({ ...prev, [sym]: data.bars[0].o }));
          } else {
            setDailyOpens((prev) => ({ ...prev, [sym]: null }));
          }
        })
        .catch(() => setDailyOpens((prev) => ({ ...prev, [sym]: null })));
    });
  }, [list?.symbols]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, width: "100%" }}>
      {/* Tabs row */}
      {/* Tabs and mobile action buttons row */}
      <div style={{
        display: "flex", alignItems: "center",
        borderBottom: "1px solid var(--border)",
      }}>
        <div style={{
          flex: 1, display: "flex", alignItems: "center", gap: 4, padding: "6px 8px",
          overflowX: "auto", minWidth: 0
        }}>
        {watchlists.map((w) => (
          editing === w._id ? (
            <NameEditor
              key={w._id}
              value={name}
              setValue={setName}
              onCommit={commitName}
              onCancel={() => { setEditing(null); setName(""); }}
            />
          ) : (
            <button
              key={w._id}
              onClick={() => setActiveListId(w._id)}
              onDoubleClick={() => startRename(w)}
              className={w._id === activeListId ? "primary" : "ghost"}
              title={`${w.name} (${(w.symbols || []).length}) — double-click to rename`}
              style={{
                fontSize: 11, padding: "3px 9px", whiteSpace: "nowrap",
                display: "flex", alignItems: "center", gap: 5,
              }}
            >
              {w.name}
              <span style={{ opacity: 0.55 }}>{(w.symbols || []).length}</span>
            </button>
          )
        ))}
        {editing === "new" ? (
          <NameEditor
            value={name}
            setValue={setName}
            onCommit={commitName}
            onCancel={() => { setEditing(null); setName(""); }}
            placeholder="List name…"
          />
        ) : (
          <button className="ghost" onClick={startCreate} title="New watchlist" style={{ padding: "3px 7px" }}>＋</button>
        )}

        </div>

        {/* Mobile-only action buttons pinned to the right */}
        <div className="hide-desktop" style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", background: "var(--panel)" }}>
          {onNavUp && (
            <>
              <button 
                className="ghost" 
                style={{ padding: "4px", display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={onNavUp}
              >
                <ArrowUp size={14} />
              </button>
              <button 
                className="ghost" 
                style={{ padding: "4px", display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={onNavDown}
              >
                <ArrowDown size={14} />
              </button>
            </>
          )}
          {list && (
            <button className="ghost" onClick={() => setEditModalOpen(true)} title="Edit Watchlist" style={{ fontSize: 12, padding: "4px 8px", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
              <Settings2 size={14} /> Edit
            </button>
          )}
        </div>
      </div>

      {/* Header (Desktop Only) */}
      <div className="hide-mobile" style={{
        display: "flex", alignItems: "center", padding: "7px 12px",
        borderBottom: "1px solid var(--border)",
      }}>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600 }}>
          {list ? `${list.name} · ${(list.symbols || []).length}` : "No list"}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {list && watchlists.length > 0 && (
            <button
              className="ghost danger"
              onClick={() => {
                if (confirm(`Delete list “${list.name}”? Its symbols stay in your alerts.`)) onDelete(list._id);
              }}
              title="Delete this list"
              style={{ padding: "4px", display: "flex", alignItems: "center" }}
            >
              <Trash2 size={14} />
            </button>
          )}
          {list && (
            <button className="ghost" onClick={onAddSymbol} title="Add symbol to list" style={{ fontSize: 12, padding: "4px 8px", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
              <Plus size={14} /> Add
            </button>
          )}
        </div>
      </div>

      {/* Rows */}
      <div className="wl-rows">
        {!list && (
          <div className="muted" style={{ padding: 16, textAlign: "center", fontSize: 12 }}>
            No watchlist selected.
          </div>
        )}
        {list && !(list.symbols || []).length && (
          <div className="muted" style={{ padding: 16, textAlign: "center", fontSize: 12 }}>
            Empty list. Click <b><Plus size={12} style={{verticalAlign:"middle", display:"inline-block"}} /> Add</b> to search the broker universe.
          </div>
        )}

        {list && (list.symbols || []).map((sym, i) => (
          <WatchRow
            key={sym + i}
            sym={sym}
            tick={ticks[sym]}
            dailyOpen={typeof dailyOpens[sym] === "number" ? dailyOpens[sym] : null}
            current={sym === symbol}
            hasAlert={activeAlertSymbols.has(sym)}
            onJump={() => setSymbol(sym)}
            onRemove={() => onRemoveSymbol(list._id, sym)}
            dragging={drag === sym}
            dropTarget={over === sym && drag && drag !== sym}
            onDragStart={() => setDrag(sym)}
            onDragOver={(e) => { e.preventDefault(); setOver(sym); }}
            onDragLeave={() => setOver((o) => (o === sym ? null : o))}
            onDrop={() => {
              if (drag && drag !== sym) reorder(list, drag, sym);
              setDrag(null); setOver(null);
            }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            flag={symbolFlags?.[sym]}
            onFlag={(color) => setSymbolFlags(p => {
              const next = { ...p };
              if (color) next[sym] = color;
              else delete next[sym];
              return next;
            })}
          />
        ))}
      </div>

      {editModalOpen && list && (
        <WatchlistEditModal 
          list={list} 
          onClose={() => setEditModalOpen(false)} 
          onAddSymbol={onAddSymbol} 
          onRemoveSymbol={onRemoveSymbol} 
          onDeleteList={() => {
            if (confirm(`Delete list “${list.name}”?`)) {
              onDelete(list._id);
              setEditModalOpen(false);
            }
          }}
        />
      )}
    </div>
  );
}

// Reorder by persisting the new symbol order to the active list.
// We reuse the rename endpoint's "watchlists changed" broadcast path by
// POSTing the full symbol array to a small dedicated endpoint.
async function reorder(list, fromSym, toSym) {
  const syms = [...(list.symbols || [])];
  const from = syms.indexOf(fromSym);
  const to = syms.indexOf(toSym);
  if (from < 0 || to < 0 || from === to) return;
  syms.splice(from, 1);
  syms.splice(to, 0, fromSym);
  try {
    await fetch(`/api/watchlists/${list._id}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: syms }),
    });
  } catch { /* optimistic UI will self-heal on next WS broadcast */ }
}

function WatchRow({
  sym, tick, dailyOpen, current, hasAlert, onJump, onRemove,
  dragging, dropTarget, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
  flag, onFlag
}) {
  const [showPalette, setShowPalette] = useState(false);
  const paletteRef = useRef(null);
  const rowRef = useRef(null);

  useEffect(() => {
    if (current && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [current]);

  useEffect(() => {
    if (!showPalette) return;
    const close = (e) => {
      if (!paletteRef.current?.contains(e.target)) setShowPalette(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close, { passive: true });
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [showPalette]);

  const digits = tick?.digits ?? 5;
  const bid = tick?.bid;
  const spreadPips = tick?.bid && tick?.ask ? (tick.ask - tick.bid) * Math.pow(10, digits === 3 || digits === 5 ? digits - 1 : 0) : null;
  const dir = tick?.dir;

  return (
    <div
      ref={rowRef}
      className="wl-row-item"
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onJump}
      title={current ? "Current chart" : `Switch to ${sym}`}
      style={{
        background: dropTarget
          ? "var(--accent-soft)"
          : current ? "rgba(41,98,255,.08)" : "transparent",
        opacity: dragging ? 0.4 : 1,
        borderLeft: current ? "2px solid var(--accent)" : "2px solid transparent",
      }}
    >
      <div className="wl-row-drag muted hide-mobile" style={{ display: "flex", alignItems: "center", cursor: "grab", userSelect: "none", opacity: 0.5 }} title="Drag to reorder"><GripVertical size={14} /></div>
      
      {/* Flag */}
      <div ref={paletteRef} style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <button 
          className="ghost" 
          onPointerDown={(e) => { e.stopPropagation(); setShowPalette(!showPalette); }}
          onClick={(e) => { e.stopPropagation(); }}
          style={{ padding: "4px", color: flag === "red" ? "#ef5350" : flag === "blue" ? "#2962ff" : flag === "green" ? "#26a69a" : flag === "yellow" ? "#ffeb3b" : "var(--text)", opacity: flag ? 1 : 0.2 }}
        >
          <Flag size={14} fill={flag ? "currentColor" : "none"} strokeWidth={flag ? 0 : 2} />
        </button>
        {showPalette && (
          <div 
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            style={{
            position: "absolute", top: "100%", left: 0, zIndex: 100,
            background: "var(--panel)", border: "1px solid var(--border)",
            display: "flex", gap: 4, padding: 4, borderRadius: 4, boxShadow: "0 4px 12px rgba(0,0,0,0.3)"
          }}>
            <button className="ghost" onPointerDown={(e) => { e.stopPropagation(); onFlag("red"); setShowPalette(false); }} onClick={(e)=>e.stopPropagation()} style={{color: "#ef5350", padding: 4}}><Flag size={14} fill="currentColor" strokeWidth={0} /></button>
            <button className="ghost" onPointerDown={(e) => { e.stopPropagation(); onFlag("blue"); setShowPalette(false); }} onClick={(e)=>e.stopPropagation()} style={{color: "#2962ff", padding: 4}}><Flag size={14} fill="currentColor" strokeWidth={0} /></button>
            <button className="ghost" onPointerDown={(e) => { e.stopPropagation(); onFlag("green"); setShowPalette(false); }} onClick={(e)=>e.stopPropagation()} style={{color: "#26a69a", padding: 4}}><Flag size={14} fill="currentColor" strokeWidth={0} /></button>
            <button className="ghost" onPointerDown={(e) => { e.stopPropagation(); onFlag("yellow"); setShowPalette(false); }} onClick={(e)=>e.stopPropagation()} style={{color: "#ffeb3b", padding: 4}}><Flag size={14} fill="currentColor" strokeWidth={0} /></button>
            <button className="ghost" onPointerDown={(e) => { e.stopPropagation(); onFlag(null); setShowPalette(false); }} onClick={(e)=>e.stopPropagation()} style={{padding: 4}}><X size={14} /></button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span className="num" style={{ fontWeight: 700, fontSize: 12 }}>{sym}</span>
          {hasAlert && <span style={{ color: "var(--orange)", fontSize: 10 }} title="Has active alert">●</span>}
        </div>
        {spreadPips != null && (
          <div className="muted wl-row-spread" style={{ fontSize: 10 }}>{spreadPips.toFixed(1)} pips</div>
        )}
      </div>

      {bid != null && dailyOpen != null ? (
        <div className="num" style={{ textAlign: "right", fontSize: 13, fontWeight: 700 }}>
          <div className={bid > dailyOpen ? "up" : bid < dailyOpen ? "down" : ""}>
            {bid > dailyOpen ? "+" : ""}{(((bid - dailyOpen) / dailyOpen) * 100).toFixed(2)}%
          </div>
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 11 }}>—</div>
      )}

      <button
        className="ghost danger wl-row-remove hide-mobile"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title={`Remove ${sym} from list`}
        style={{ padding: "4px", display: "flex", alignItems: "center" }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function WatchlistEditModal({ list, onClose, onAddSymbol, onRemoveSymbol, onDeleteList }) {
  const syms = list?.symbols || [];

  const moveUp = async (idx) => {
    if (idx === 0) return;
    const fromSym = syms[idx];
    const toSym = syms[idx - 1];
    await reorder(list, fromSym, toSym);
  };
  const moveDown = async (idx) => {
    if (idx === syms.length - 1) return;
    const fromSym = syms[idx];
    const toSym = syms[idx + 1];
    await reorder(list, fromSym, toSym);
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.6)", zIndex: 1500,
      display: "flex", flexDirection: "column", justifyContent: "flex-end"
    }}>
      <div style={{
        background: "var(--bg)", borderTop: "1px solid var(--border)",
        borderTopLeftRadius: 16, borderTopRightRadius: 16,
        padding: 16, maxHeight: "80vh", display: "flex", flexDirection: "column"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Edit: {list.name}</div>
          <button className="ghost" onClick={onClose} style={{ padding: 4 }}><X size={20} /></button>
        </div>

        <div style={{ overflowY: "auto", flex: 1, marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {syms.map((sym, i) => (
            <div key={sym} style={{
              display: "flex", alignItems: "center", padding: "8px 12px",
              background: "var(--panel)", borderRadius: 8, border: "1px solid var(--border)"
            }}>
              <div style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{sym}</div>
              <div style={{ display: "flex", gap: 4 }}>
                <button className="ghost" onClick={() => moveUp(i)} disabled={i === 0} style={{ padding: 6 }}><ArrowUp size={16} /></button>
                <button className="ghost" onClick={() => moveDown(i)} disabled={i === syms.length - 1} style={{ padding: 6 }}><ArrowDown size={16} /></button>
                <button className="ghost danger" onClick={() => onRemoveSymbol(list._id, sym)} style={{ padding: 6, marginLeft: 8 }}><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
          {syms.length === 0 && <div className="muted" style={{ textAlign: "center", padding: 20 }}>List is empty.</div>}
        </div>
        
        <div style={{ display: "flex", gap: 8 }}>
          <button className="ghost danger" onClick={onDeleteList} style={{ padding: "12px", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Trash2 size={18} />
          </button>
          <button className="primary" onClick={onAddSymbol} style={{ padding: "12px", flex: 1, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Plus size={18} /> Add Symbol
          </button>
        </div>
      </div>
    </div>
  );
}

function NameEditor({ value, setValue, onCommit, onCancel, placeholder }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <input
      ref={ref}
      value={value}
      placeholder={placeholder || "Rename…"}
      onChange={(e) => setValue(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); onCommit(); }
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
      style={{ width: 120, fontSize: 11, padding: "3px 7px" }}
    />
  );
}
