"use client";

/**
 * ColorPicker — Full HSB color picker with opacity support.
 * Props:
 *   value      — current color string (hex "#rrggbb", hex8 "#rrggbbaa", or "rgba(r,g,b,a)")
 *   onChange   — (colorString) => void  — called with "#rrggbbaa" or "#rrggbb" if fully opaque
 *   label      — optional tooltip string
 *   size       — swatch trigger size in px (default 20)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

// ── Color math helpers ────────────────────────────────────────────────────────

/** Parse any hex / rgba / hsl string → { r, g, b, a } (r/g/b: 0–255, a: 0–1) */
function parseColor(str) {
  if (!str) return { r: 41, g: 98, b: 255, a: 1 };
  str = String(str).trim();
  if (str === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  // rgba(r, g, b, a) or rgb(r, g, b)
  const rgba = str.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgba) {
    const r = Math.max(0, Math.min(255, parseInt(rgba[1], 10) || 0));
    const g = Math.max(0, Math.min(255, parseInt(rgba[2], 10) || 0));
    const b = Math.max(0, Math.min(255, parseInt(rgba[3], 10) || 0));
    const a = rgba[4] != null ? Math.max(0, Math.min(1, parseFloat(rgba[4]) || 0)) : 1;
    return { r, g, b, a };
  }

  // Hex: #rgb, #rgba, #rrggbb, #rrggbbaa
  let hex = str.replace("#", "").trim();
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("") + "ff";
  else if (hex.length === 4) hex = hex.slice(0, 3).split("").map((c) => c + c).join("") + hex[3] + hex[3];
  else if (hex.length === 6) hex += "ff";

  if (hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = parseInt(hex.slice(6, 8), 16) / 255;
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) && Number.isFinite(a)) {
      return { r, g, b, a: Math.max(0, Math.min(1, a)) };
    }
  }

  return { r: 41, g: 98, b: 255, a: 1 };
}

/** { r, g, b, a } → "#rrggbb" or "#rrggbbaa" */
function toHex({ r, g, b, a }) {
  const hex = (v) => Math.round(Math.max(0, Math.min(255, Number(v) || 0))).toString(16).padStart(2, "0");
  const base = `#${hex(r)}${hex(g)}${hex(b)}`;
  const alphaVal = Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1;
  if (alphaVal >= 0.999) return base;
  return `${base}${hex(Math.round(alphaVal * 255))}`;
}

/** { r, g, b } → { h: 0–360, s: 0–1, v: 0–1 } */
function rgbToHsv(r, g, b) {
  r = Math.max(0, Math.min(255, Number(r) || 0)) / 255;
  g = Math.max(0, Math.min(255, Number(g) || 0)) / 255;
  b = Math.max(0, Math.min(255, Number(b) || 0)) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return {
    h: Math.round(((h * 360) % 360 + 360) % 360),
    s: max === 0 ? 0 : Math.max(0, Math.min(1, d / max)),
    v: Math.max(0, Math.min(1, max)),
  };
}

/** { h: 0–360, s: 0–1, v: 0–1 } → { r, g, b } (0–255) */
function hsvToRgb(h, s, v) {
  h = ((Number(h) || 0) % 360 + 360) % 360;
  s = Math.max(0, Math.min(1, Number(s) || 0));
  v = Math.max(0, Math.min(1, Number(v) || 0));
  const i = Math.floor(h / 60) % 6;
  const f = h / 60 - Math.floor(h / 60);
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, q, p, p, t, v],
    [t, v, v, q, p, p],
    [p, p, t, v, v, q],
  ].map((arr) => Math.round(Math.max(0, Math.min(255, arr[i] * 255))));
  return {
    r: Number.isFinite(r) ? r : 0,
    g: Number.isFinite(g) ? g : 0,
    b: Number.isFinite(b) ? b : 0,
  };
}

// ── Quick presets ─────────────────────────────────────────────────────────────
const PRESETS = [
  "#2962ff", "#1976d2", "#00bcd4", "#26a69a", "#089981", "#4caf50",
  "#8bc34a", "#cddc39", "#ffeb3b", "#ff9800", "#ff5722", "#f23645",
  "#e91e63", "#9c27b0", "#673ab7", "#ffffff", "#b2b5be", "#787b86",
  "#434651", "#131722", "transparent",
];

// ── Gradient canvas helpers ───────────────────────────────────────────────────
function drawSVPanel(canvas, hue) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  if (!w || !h) return;
  const hVal = Math.round(((Number(hue) || 0) % 360 + 360) % 360);
  // White → Hue
  const gradH = ctx.createLinearGradient(0, 0, w, 0);
  gradH.addColorStop(0, "#fff");
  gradH.addColorStop(1, `hsl(${hVal}, 100%, 50%)`);
  ctx.fillStyle = gradH;
  ctx.fillRect(0, 0, w, h);
  // transparent → black
  const gradV = ctx.createLinearGradient(0, 0, 0, h);
  gradV.addColorStop(0, "transparent");
  gradV.addColorStop(1, "#000");
  ctx.fillStyle = gradV;
  ctx.fillRect(0, 0, w, h);
}

function drawHueBar(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  if (!w || !h) return;
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  [0, 60, 120, 180, 240, 300, 360].forEach((deg, i) => {
    grad.addColorStop(i / 6, `hsl(${deg}, 100%, 50%)`);
  });
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function drawAlphaBar(canvas, r, g, b) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  if (!w || !h) return;
  const rVal = Math.max(0, Math.min(255, Math.round(Number(r) || 0)));
  const gVal = Math.max(0, Math.min(255, Math.round(Number(g) || 0)));
  const bVal = Math.max(0, Math.min(255, Math.round(Number(b) || 0)));
  // Checkerboard
  const sq = 6;
  for (let x = 0; x < w; x += sq) {
    for (let y = 0; y < h; y += sq) {
      ctx.fillStyle = (Math.floor(x / sq) + Math.floor(y / sq)) % 2 === 0 ? "#ccc" : "#fff";
      ctx.fillRect(x, y, sq, sq);
    }
  }
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, `rgba(${rVal},${gVal},${bVal},0)`);
  grad.addColorStop(1, `rgba(${rVal},${gVal},${bVal},1)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ColorPicker({ value, onChange, label, size = 20 }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updateCoords = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const popWidth = 230;
    const popHeight = 350;

    let left = rect.left + rect.width / 2 - popWidth / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - popWidth - 8));

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    let top;
    if (spaceBelow >= popHeight + 10 || spaceBelow >= spaceAbove) {
      top = rect.bottom + 6;
    } else {
      top = rect.top - popHeight - 6;
    }

    top = Math.max(8, Math.min(top, window.innerHeight - popHeight - 8));
    setCoords({ top, left });
  }, []);

  // Parsed state
  const initial = parseColor(value);
  const initHsv = rgbToHsv(initial.r, initial.g, initial.b);

  const [hsv, setHsv] = useState({ h: initHsv.h, s: initHsv.s, v: initHsv.v });
  const [alpha, setAlpha] = useState(initial.a ?? 1);
  const [hexInput, setHexInput] = useState("");

  // Canvas refs
  const svRef = useRef(null);
  const hueRef = useRef(null);
  const alphaRef = useRef(null);

  // Derived RGB
  const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);

  // Sync from external value changes
  useEffect(() => {
    const c = parseColor(value);
    const h = rgbToHsv(c.r, c.g, c.b);
    setHsv({ h: h.h, s: h.s, v: h.v });
    setAlpha(c.a ?? 1);
  }, [value]);

  // Redraw canvases when hue changes
  useEffect(() => {
    drawSVPanel(svRef.current, hsv.h);
  }, [hsv.h, open]);

  useEffect(() => {
    drawHueBar(hueRef.current);
  }, [open]);

  useEffect(() => {
    drawAlphaBar(alphaRef.current, r, g, b);
  }, [r, g, b, open]);

  // Compute output color string
  const computeOutput = useCallback((h, s, v, a) => {
    const rgb = hsvToRgb(h, s, v);
    return toHex({ ...rgb, a });
  }, []);

  const emit = useCallback((h, s, v, a) => {
    const out = computeOutput(h, s, v, a);
    onChange?.(out);
    setHexInput(out);
  }, [computeOutput, onChange]);

  // SV panel drag
  const svDrag = useRef(false);
  const handleSVInteract = (e, canvas) => {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const rawX = (e.clientX - rect.left) / rect.width;
    const rawY = (e.clientY - rect.top) / rect.height;
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return;
    const x = Math.max(0, Math.min(1, rawX));
    const y = Math.max(0, Math.min(1, rawY));
    const next = { ...hsv, s: x, v: 1 - y };
    setHsv(next);
    emit(next.h, next.s, next.v, alpha);
  };

  // Hue bar drag
  const hueDrag = useRef(false);
  const handleHueInteract = (e, canvas) => {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const rawX = (e.clientX - rect.left) / rect.width;
    if (!Number.isFinite(rawX)) return;
    const x = Math.max(0, Math.min(1, rawX));
    const next = { ...hsv, h: x * 360 };
    setHsv(next);
    emit(next.h, next.s, next.v, alpha);
    drawSVPanel(svRef.current, next.h);
  };

  // Alpha bar drag
  const alphaDrag = useRef(false);
  const handleAlphaInteract = (e, canvas) => {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const rawX = (e.clientX - rect.left) / rect.width;
    if (!Number.isFinite(rawX)) return;
    const x = Math.max(0, Math.min(1, rawX));
    setAlpha(x);
    emit(hsv.h, hsv.s, hsv.v, x);
  };

  // Global mouse up / move
  useEffect(() => {
    if (!open) return;
    const onMove = (e) => {
      if (svDrag.current) handleSVInteract(e, svRef.current);
      if (hueDrag.current) handleHueInteract(e, hueRef.current);
      if (alphaDrag.current) handleAlphaInteract(e, alphaRef.current);
    };
    const onUp = () => { svDrag.current = false; hueDrag.current = false; alphaDrag.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [open, hsv, alpha]); // eslint-disable-line

  // Reposition on window resize or scroll
  useEffect(() => {
    if (!open) return;
    updateCoords();
    const handleScrollOrResize = () => updateCoords();
    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("scroll", handleScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("scroll", handleScrollOrResize, true);
    };
  }, [open, updateCoords]);

  // Close on outside click — deferred so the opening click doesn't instantly trigger close
  useEffect(() => {
    if (!open) return;
    let onDown;
    const timer = setTimeout(() => {
      onDown = (e) => {
        // Don't close if click is on trigger button or inside popover
        if (btnRef.current && btnRef.current.contains(e.target)) return;
        if (popRef.current && popRef.current.contains(e.target)) return;
        setOpen(false);
      };
      document.addEventListener("mousedown", onDown, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      if (onDown) document.removeEventListener("mousedown", onDown, true);
    };
  }, [open]);

  // Hex input handler
  const handleHexChange = (raw) => {
    setHexInput(raw);
    let str = raw.trim();
    if (!str.startsWith("#")) str = "#" + str;
    // Only parse when length is valid
    if (str.length === 4 || str.length === 7 || str.length === 9) {
      const c = parseColor(str);
      const h = rgbToHsv(c.r, c.g, c.b);
      setHsv({ h: h.h, s: h.s, v: h.v });
      setAlpha(c.a ?? 1);
      onChange?.(str);
    }
  };

  // Preset click
  const handlePreset = (c) => {
    if (c === "transparent") {
      setAlpha(0);
      emit(hsv.h, hsv.s, hsv.v, 0);
      return;
    }
    const parsed = parseColor(c);
    const h = rgbToHsv(parsed.r, parsed.g, parsed.b);
    setHsv({ h: h.h, s: h.s, v: h.v });
    setAlpha(parsed.a ?? 1);
    emit(h.h, h.s, h.v, parsed.a ?? 1);
  };

  // Current display color
  const displayHex = toHex({ r, g, b, a: alpha });
  const swatchBg = value === "transparent" || alpha === 0
    ? "linear-gradient(45deg, #ccc 25%, #fff 25%, #fff 50%, #ccc 50%, #ccc 75%, #fff 75%)"
    : displayHex;

  // SV cursor position
  const svX = `${hsv.s * 100}%`;
  const svY = `${(1 - hsv.v) * 100}%`;
  const hueX = `${(hsv.h / 360) * 100}%`;
  const alphaX = `${alpha * 100}%`;

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      {/* Trigger swatch */}
      <button
        ref={btnRef}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          updateCoords();
          setOpen((o) => !o);
          setHexInput(displayHex);
        }}
        title={label || value}
        style={{
          width: size, height: size, padding: 0, borderRadius: 4, cursor: "pointer",
          background: swatchBg,
          backgroundSize: "8px 8px",
          border: "2px solid rgba(255,255,255,0.2)",
          flexShrink: 0, outline: open ? "2px solid var(--brand)" : "none",
        }}
      />

      {/* Popover panel — rendered via Portal to avoid overflow clipping and viewport cutoffs */}
      {open && mounted && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            zIndex: 99999999,
            width: 230,
            background: "var(--panel, #181c27)",
            border: "1px solid var(--border, #2a2e39)",
            borderRadius: 10,
            boxShadow: "0 12px 40px rgba(0,0,0,0.85)",
            padding: "10px 10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {/* SV Panel */}
          <div style={{ position: "relative", width: "100%", height: 140, borderRadius: 6, overflow: "hidden" }}>
            <canvas
              ref={svRef}
              width={210}
              height={140}
              style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
              onMouseDown={(e) => { svDrag.current = true; handleSVInteract(e, svRef.current); }}
              onClick={(e) => handleSVInteract(e, svRef.current)}
            />
            {/* Cursor */}
            <div style={{
              position: "absolute", left: svX, top: svY,
              width: 12, height: 12, borderRadius: "50%",
              border: "2px solid #fff", boxShadow: "0 0 3px rgba(0,0,0,0.6)",
              transform: "translate(-50%, -50%)", pointerEvents: "none",
            }} />
          </div>

          {/* Hue Bar */}
          <div style={{ position: "relative", width: "100%", height: 12, borderRadius: 6, overflow: "hidden" }}>
            <canvas
              ref={hueRef}
              width={210}
              height={12}
              style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
              onMouseDown={(e) => { hueDrag.current = true; handleHueInteract(e, hueRef.current); }}
              onClick={(e) => handleHueInteract(e, hueRef.current)}
            />
            <div style={{
              position: "absolute", top: "50%", left: hueX,
              width: 10, height: 10, borderRadius: "50%",
              border: "2px solid #fff", boxShadow: "0 0 3px rgba(0,0,0,0.6)",
              transform: "translate(-50%, -50%)", pointerEvents: "none",
            }} />
          </div>

          {/* Alpha Bar */}
          <div style={{ position: "relative", width: "100%", height: 12, borderRadius: 6, overflow: "hidden" }}>
            <canvas
              ref={alphaRef}
              width={210}
              height={12}
              style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
              onMouseDown={(e) => { alphaDrag.current = true; handleAlphaInteract(e, alphaRef.current); }}
              onClick={(e) => handleAlphaInteract(e, alphaRef.current)}
            />
            <div style={{
              position: "absolute", top: "50%", left: alphaX,
              width: 10, height: 10, borderRadius: "50%",
              border: "2px solid #fff", boxShadow: "0 0 3px rgba(0,0,0,0.6)",
              transform: "translate(-50%, -50%)", pointerEvents: "none",
            }} />
          </div>

          {/* Hex Input + Alpha % + Preview */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {/* Preview swatch */}
            <div style={{
              width: 30, height: 30, borderRadius: 5, flexShrink: 0,
              background: alpha === 0
                ? "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 0 0 / 8px 8px"
                : displayHex,
              border: "1px solid rgba(255,255,255,0.15)",
            }} />
            {/* Hex input */}
            <input
              type="text"
              value={hexInput || displayHex}
              onChange={(e) => handleHexChange(e.target.value)}
              spellCheck={false}
              style={{
                flex: 1, fontSize: 11, fontFamily: "monospace", padding: "4px 6px",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 4, color: "var(--text)", textTransform: "uppercase",
              }}
            />
            {/* Alpha % */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <input
                type="number"
                min={0}
                max={100}
                value={Math.round(alpha * 100)}
                onChange={(e) => {
                  const a = Math.max(0, Math.min(100, Number(e.target.value))) / 100;
                  setAlpha(a);
                  emit(hsv.h, hsv.s, hsv.v, a);
                }}
                style={{
                  width: 44, fontSize: 11, padding: "4px 4px", textAlign: "center",
                  background: "var(--bg)", border: "1px solid var(--border)",
                  borderRadius: 4, color: "var(--text)",
                }}
              />
              <span style={{ fontSize: 9, color: "var(--muted)" }}>Alpha</span>
            </div>
          </div>

          {/* Preset grid */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, paddingTop: 4, borderTop: "1px solid var(--border)" }}>
            {PRESETS.map((c, i) => (
              <button
                key={i}
                onClick={() => handlePreset(c)}
                title={c}
                style={{
                  width: 18, height: 18, padding: 0, borderRadius: 3, cursor: "pointer", flexShrink: 0,
                  background: c === "transparent"
                    ? "repeating-conic-gradient(#999 0% 25%, #fff 0% 50%) 0 0 / 8px 8px"
                    : c,
                  border: displayHex === c ? "2px solid var(--brand)" : "1px solid rgba(255,255,255,0.12)",
                }}
              />
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
