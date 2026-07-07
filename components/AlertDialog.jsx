"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, X } from "lucide-react";

const CONDITIONS = [
  { id: "cross", label: "Crosses", hint: "price passes through either direction" },
  { id: "above", label: "Rises above", hint: "latches on first touch (≥)" },
  { id: "below", label: "Falls below", hint: "latches on first touch (≤)" },
];

// TradingView-style alert editor: pre-filled from chart hover/click or market price,
// quick condition chips, optional note. Enter saves, Esc cancels.
export default function AlertDialog({ symbol, draft, marketPrice, onCancel, onSave }) {
  const initial = useMemo(() => {
    // Number("") === 0, so an empty draft price must fall through to market
    // price (or stay blank) instead of prefilling "0".
    const src = [draft?.price, marketPrice].find((v) => v !== "" && v != null);
    const raw = Number(src);
    return src != null && Number.isFinite(raw) ? String(raw) : "";
  }, [draft, marketPrice]);

  const [price, setPrice] = useState(initial);
  const [condition, setCondition] = useState(draft?.condition || "cross");
  const [note, setNote] = useState(draft?.note || "");
  const [busy, setBusy] = useState(false);
  const priceRef = useRef(null);

  useEffect(() => { priceRef.current?.focus(); priceRef.current?.select(); }, []);

  // pick a sensible default condition based on where the price sits vs market
  useEffect(() => {
    if (draft?.condition) { setCondition(draft.condition); return; }
    const m = Number(marketPrice), p = Number(initial);
    if (Number.isFinite(m) && Number.isFinite(p)) {
      if (p > m) setCondition("above");
      else if (p < m) setCondition("below");
    }
  }, [draft, marketPrice, initial]);

  const submit = async () => {
    const p = Number(price);
    if (!Number.isFinite(p)) return;
    setBusy(true);
    await onSave({ symbol, price: p, condition, note: note.trim() });
    setBusy(false);
  };

  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || e.target === priceRef.current)) {
      e.preventDefault();
      submit();
    }
  };

  const m = Number(marketPrice);
  const p = Number(price);
  const hasMkt = Number.isFinite(m) && Number.isFinite(p) && p > 0;
  const diff = hasMkt ? p - m : 0;
  const diffPct = hasMkt ? (diff / m) * 100 : 0;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,.55)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onMouseDown={onCancel}
    >
      <div
        style={{
          width: "min(440px, 92vw)", background: "var(--panel)",
          border: "1px solid var(--border-hi)", borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,.6)", overflow: "hidden",
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <div style={{
          padding: "12px 16px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14 }}>
            <span style={{ color: "var(--orange)", display: "flex", alignItems: "center" }}><Bell size={16} /></span>
            Create alert · <span className="num">{symbol}</span>
          </div>
          <button className="ghost" onClick={onCancel} style={{ padding: "4px" }}><X size={14} /></button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
              Price
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
              <input
                ref={priceRef}
                type="number"
                step="any"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="num"
                style={{ flex: 1, fontSize: 15, fontWeight: 600 }}
              />
              {Number.isFinite(m) && (
                <button
                  className="ghost"
                  onClick={() => setPrice(String(m))}
                  title="Use market price"
                  style={{ whiteSpace: "nowrap" }}
                >
                  market <span className="num">{m}</span>
                </button>
              )}
            </div>
            {hasMkt && (
              <div className="muted" style={{ fontSize: 11, marginTop: 5 }}>
                <span className={diff >= 0 ? "up" : "down"}>
                  {diff >= 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(Math.max(5, String(m).split(".")[1]?.length || 0))}
                  {"  "}({diffPct >= 0 ? "+" : ""}{diffPct.toFixed(2)}%)
                </span>
                {"  "}from market
              </div>
            )}
          </div>

          <div>
            <label className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
              Condition
            </label>
            <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
              {CONDITIONS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCondition(c.id)}
                  className={condition === c.id ? "primary" : ""}
                  title={c.hint}
                  style={{ flex: 1, padding: "7px 4px", fontSize: 12 }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
              Note <span style={{ textTransform: "none", fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={onKey}
              placeholder="e.g. break-out long"
              maxLength={200}
              style={{ width: "100%", marginTop: 5 }}
            />
          </div>
        </div>

        <div style={{
          padding: "10px 16px", borderTop: "1px solid var(--border)",
          display: "flex", justifyContent: "flex-end", gap: 8,
          background: "var(--panel-2)",
        }}>
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={submit} disabled={busy || !Number.isFinite(Number(price))}>
            {busy ? "Saving…" : "Create alert"}
          </button>
        </div>
      </div>
    </div>
  );
}
