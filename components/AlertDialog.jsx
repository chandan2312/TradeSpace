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
// Supports multi-layer chain alerts.
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

  useEffect(() => {
    if (draft?.condition || price !== "") return;
    const m = Number(marketPrice), p = Number(initial);
    if (Number.isFinite(m) && Number.isFinite(p)) {
      setCondition(p > m ? "above" : p < m ? "below" : "cross");
    }
  }, [draft, marketPrice, initial]);

  const submit = async () => {
    const rawPrice = Number(price);
    if (!Number.isFinite(rawPrice)) return;
    setBusy(true);
    await onSave({ symbol, price: rawPrice, condition, note: note.trim() });
    setBusy(false);
  };

  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || e.target === priceRef.current)) {
      e.preventDefault();
      submit();
    }
  };

  const isFormValid = Number.isFinite(Number(price));

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
          maxHeight: "90vh", display: "flex", flexDirection: "column"
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

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ padding: "12px", background: "var(--panel-2)", borderRadius: 8, border: "1px solid var(--border)", position: "relative" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input
                  ref={priceRef}
                  type="number"
                  step="any"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="num"
                  style={{ flex: 1, fontSize: 15, fontWeight: 600 }}
                  placeholder="Price"
                />
                {Number.isFinite(Number(marketPrice)) && (
                  <button
                    className="ghost"
                    onClick={() => setPrice(String(marketPrice))}
                    title="Use market price"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    market <span className="num">{marketPrice}</span>
                  </button>
                )}
              </div>
              
              {Number.isFinite(Number(marketPrice)) && Number.isFinite(Number(price)) && Number(price) > 0 && (
                <div className="muted" style={{ fontSize: 11, marginTop: -4, marginBottom: 8 }}>
                  <span className={(Number(price) - Number(marketPrice)) >= 0 ? "up" : "down"}>
                    {(Number(price) - Number(marketPrice)) >= 0 ? "▲" : "▼"} {Math.abs(Number(price) - Number(marketPrice)).toFixed(Math.max(5, String(marketPrice).split(".")[1]?.length || 0))}
                    {"  "}({(((Number(price) - Number(marketPrice)) / Number(marketPrice)) * 100).toFixed(2)}%)
                  </span>
                  {"  "}from market
                </div>
              )}

              <div style={{ display: "flex", gap: 6 }}>
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
          </div>

          <div style={{ marginTop: 8 }}>
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
          <button className="primary" onClick={submit} disabled={busy || !isFormValid}>
            {busy ? "Saving…" : "Create alert"}
          </button>
        </div>
      </div>
    </div>
  );
}
