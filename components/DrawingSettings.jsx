"use client";

import { useState } from "react";
import { PALETTE } from "../lib/draw/core.js";

// Settings popover for the currently-selected drawing. Lets the user edit
// color, width, line style, fill opacity (rectangles), extend left/right
// (trendline), R:R ratio (rr tool), and label visibility.
// Floating panel anchored to the top-right of the chart pane.
export default function DrawingSettings({ api }) {
  const { settingsOpen, setSettingsOpen, selected, updateSelected } = api;
  const [tab, setTab] = useState("Inputs");

  if (!settingsOpen || !selected) return null;

  const set = (patch) => updateSelected(patch);

  const Row = ({ label, children }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "4px 0" }}>
      <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 600 }}>{label}</span>
      <div style={{ display: "flex", gap: 3 }}>{children}</div>
    </div>
  );

  const Swatch = ({ c }) => (
    <button
      onClick={() => set({ color: c, fill: selected.type === "rectangle" ? c : selected.fill })}
      title={c}
      style={{
        width: 18, height: 18, padding: 0, borderRadius: 4, cursor: "pointer",
        background: c, border: selected.color === c ? "2px solid #fff" : "1px solid var(--border)",
      }}
    />
  );

  const WidthBtn = ({ w }) => (
    <button
      onClick={() => set({ width: w })}
      className={selected.width === w ? "primary" : "ghost"}
      style={{ padding: "2px 6px", fontSize: 10, minWidth: 22 }}
    >{w}</button>
  );

  const StyleBtn = ({ v, label }) => (
    <button
      onClick={() => set({ style: v })}
      className={selected.style === v ? "primary" : "ghost"}
      style={{ padding: "2px 8px", fontSize: 12, minWidth: 26 }}
    >{label}</button>
  );

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
      position: "absolute", right: 8, top: 8, zIndex: 45,
      background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8,
      boxShadow: "0 8px 28px rgba(0,0,0,.6)", padding: 10, width: 220,
      display: "flex", flexDirection: "column",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: "capitalize" }}>{selected.type} settings</span>
        <button className="ghost" onClick={() => setSettingsOpen(false)} style={{ padding: "2px 6px" }}>✕</button>
      </div>

      <Row label="Color">
        {PALETTE.map((c) => <Swatch key={c} c={c} />)}
      </Row>
      <Row label="Width">{[1, 2, 3, 4].map((w) => <WidthBtn key={w} w={w} />)}</Row>
      <Row label="Style">
        <StyleBtn v="solid" label="—" />
        <StyleBtn v="dashed" label="╌" />
        <StyleBtn v="dotted" label="┄" />
      </Row>

      {selected.type === "rectangle" && (
        <Row label="Fill">
          <input
            type="range" min={0} max={0.5} step={0.02} value={selected.fillOpacity ?? 0.12}
            onChange={(e) => set({ fillOpacity: Number(e.target.value) })}
            style={{ width: 110 }}
          />
          <span className="num" style={{ fontSize: 10, width: 28, textAlign: "right" }}>
            {Math.round((selected.fillOpacity ?? 0.12) * 100)}%
          </span>
        </Row>
      )}

      {selected.type === "trendline" && (
        <>
          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          <Row label="Extend L">
            <button className={selected.extendLeft ? "primary" : "ghost"} onClick={() => set({ extendLeft: !selected.extendLeft })} style={{ padding: "2px 8px", fontSize: 11 }}>
              {selected.extendLeft ? "On" : "Off"}
            </button>
          </Row>
          <Row label="Extend R">
            <button className={selected.extendRight ? "primary" : "ghost"} onClick={() => set({ extendRight: !selected.extendRight })} style={{ padding: "2px 8px", fontSize: 11 }}>
              {selected.extendRight ? "On" : "Off"}
            </button>
          </Row>
        </>
      )}

      {selected.type === "rrtool" && (
        <>
          <div style={{ display: "flex", gap: 10, borderBottom: "1px solid var(--border)", marginBottom: 8, paddingBottom: 4 }}>
            {["Inputs", "Style"].map(t => (
              <button 
                key={t}
                className={tab === t ? "primary" : "ghost"}
                onClick={() => setTab(t)}
                style={{ padding: "2px 8px", fontSize: 11 }}
              >{t}</button>
            ))}
          </div>

          {tab === "Inputs" && (
            <>
              <Row label="Account size">
                <input
                  type="number" value={Number((selected.accountSize ?? 100000).toFixed(0))}
                  onChange={(e) => set({ accountSize: Math.max(0, Number(e.target.value) || 0) })}
                  style={{ width: 100, fontSize: 12 }}
                />
              </Row>
              <Row label="Risk (%)">
                <input
                  type="number" step={0.1} value={Number((selected.riskPercent ?? 1.0).toFixed(2))}
                  onChange={(e) => set({ riskPercent: Math.max(0, Number(e.target.value) || 0) })}
                  style={{ width: 100, fontSize: 12 }}
                />
              </Row>
              <Row label="Entry price">
                <input
                  type="number" step={0.0001} value={selected.entry.price}
                  onChange={(e) => set({ entry: { ...selected.entry, price: Number(e.target.value) } })}
                  style={{ width: 100, fontSize: 12 }}
                />
              </Row>
              <Row label="Profit level">
                <input
                  type="number" step={0.0001} value={selected.target}
                  onChange={(e) => set({ target: Number(e.target.value) })}
                  style={{ width: 100, fontSize: 12 }}
                />
              </Row>
              <Row label="Stop level">
                <input
                  type="number" step={0.0001} value={selected.stop}
                  onChange={(e) => set({ stop: Number(e.target.value) })}
                  style={{ width: 100, fontSize: 12 }}
                />
              </Row>
              <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
              <Row label="Direction">
                <button
                  className="ghost"
                  onClick={() => {
                    const isLong = selected.target >= selected.entry.price;
                    const risk = Math.abs(selected.entry.price - selected.stop);
                    const rew = Math.abs(selected.target - selected.entry.price);
                    set({ 
                      stop: isLong ? selected.entry.price + risk : selected.entry.price - risk,
                      target: isLong ? selected.entry.price - rew : selected.entry.price + rew 
                    });
                  }}
                  style={{ padding: "2px 8px", fontSize: 11, width: "100%" }}
                >
                  {selected.target >= selected.entry.price ? "Long (Flip to Short)" : "Short (Flip to Long)"}
                </button>
              </Row>
            </>
          )}

          {tab === "Style" && (
            <>
              <Row label="Stop color">
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap", width: 130 }}>
                  {PALETTE.map((c) => (
                    <button
                      key={c} onClick={() => set({ stopColor: c })} title={c}
                      style={{
                        width: 16, height: 16, padding: 0, borderRadius: 4, cursor: "pointer",
                        background: c, border: (selected.stopColor || "#ef5350") === c ? "2px solid #fff" : "1px solid var(--border)",
                      }}
                    />
                  ))}
                </div>
              </Row>
              <Row label="Target color">
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap", width: 130 }}>
                  {PALETTE.map((c) => (
                    <button
                      key={c} onClick={() => set({ targetColor: c })} title={c}
                      style={{
                        width: 16, height: 16, padding: 0, borderRadius: 4, cursor: "pointer",
                        background: c, border: (selected.targetColor || "#26a69a") === c ? "2px solid #fff" : "1px solid var(--border)",
                      }}
                    />
                  ))}
                </div>
              </Row>
            </>
          )}
        </>
      )}

      {selected.type === "fib" && (
        <>
          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          <Row label="Levels">
            <input
              type="text"
              value={(selected.levels || []).join(", ")}
              onChange={(e) => {
                const arr = e.target.value.split(",").map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
                set({ levels: arr });
              }}
              style={{ width: 140, fontSize: 11 }}
            />
          </Row>
        </>
      )}

      {selected.type === "text" && (
        <>
          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          <Row label="Text">
            <input
              type="text"
              value={selected.text || ""}
              onChange={(e) => set({ text: e.target.value })}
              style={{ width: 140, fontSize: 12 }}
            />
          </Row>
          <Row label="Size">
            <input
              type="number" min={8} max={72} value={selected.fontSize || 14}
              onChange={(e) => set({ fontSize: Number(e.target.value) || 14 })}
              style={{ width: 60, fontSize: 12 }}
            />
          </Row>
        </>
      )}

      {selected.type !== "text" && (
        <>
          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          <Row label="Label">
            <button className={selected.showLabel ? "primary" : "ghost"} onClick={() => set({ showLabel: !selected.showLabel })} style={{ padding: "2px 8px", fontSize: 11 }}>
              {selected.showLabel ? "On" : "Off"}
            </button>
          </Row>
        </>
      )}
    </div>
  );
}
