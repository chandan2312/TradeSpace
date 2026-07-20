// DrawingsPrimitive — canvas renderer for all user drawing tools.
// Mirrors PatternsPrimitive/AlertsPrimitive: an ISeriesPrimitive attached to
// the candlestick series. Paints on top (zOrder "top") so drawings sit above
// candles, alerts, and pattern backdrops.
//
// State pushed in via setDrawings(state):
//   state = { drawings:[], selectedId, hover:{drawing,handle}|null, preview: drawing|null }
import { DASH, drawingToPx, computeRR, timeToLogical } from "./core.js";

export class DrawingsPrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._state = { drawings: [], selectedId: null, hover: null, preview: null };
    const renderer = { draw: (target) => this._draw(target) };
    this._paneView = { renderer: () => renderer, zOrder: () => "top" };
  }

  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }
  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }
  updateAllViews() {}
  paneViews() { return [this._paneView]; }

  setDrawings(state) {
    // Merge, don't replace: interaction paths push partial state (preview,
    // selection) without bars/symbol. Losing `bars` silently breaks the
    // time→logical mapping and drawings fall back to stale bar-indexes —
    // wrong or invisible on any other timeframe.
    this._state = { ...this._state, ...(state || {}) };
    this._requestUpdate?.();
  }

  _draw(target) {
    const chart = this._chart;
    const series = this._series;
    if (!chart || !series) return;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const ts = chart.timeScale();
      const { drawings, selectedId, hover, preview, symbol, currentPrice, bars } = this._state;

      // time (unix s) → x pixel: time → fractional bar index against the
      // CURRENT bars → logicalToCoordinate. Works across timeframes and in
      // the future whitespace. Without bars nothing can be placed — skip.
      const X = (t) => {
        const l = timeToLogical(bars, t, this._state.tfSec);
        return l == null ? null : ts.logicalToCoordinate(l);
      };
      const Y = (p) => (p == null ? null : series.priceToCoordinate(p));
      const W = mediaSize.width;
      const H = mediaSize.height;
      const conv = { X, Y, W, H, symbol, currentPrice, bars };

      // bodies first, then handles/labels on top
      for (const d of drawings) {
        if (d.hidden) continue;
        drawOne(ctx, d, conv, selectedId === d.id, hover && hover.drawing?.id === d.id ? hover.handle : null);
      }
      if (preview) drawOne(ctx, preview, conv, false, null, true);

      // selection handles drawn last so they're always grabbable visually
      for (const d of drawings) {
        if (d.hidden || selectedId !== d.id) continue;
        drawHandles(ctx, d, conv, hover && hover.drawing?.id === d.id ? hover.handle : null);
      }
    });
  }
}

function setStroke(ctx, d) {
  ctx.strokeStyle = d.color || "#2962ff";
  ctx.lineWidth = d.width || 2;
  ctx.setLineDash(DASH[d.style] || []);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

function drawOne(ctx, d, conv, selected, hoverHandle, isPreview) {
  if (isPreview) ctx.globalAlpha = 0.7;
  switch (d.type) {
    case "trendline": drawTrendline(ctx, d, conv, selected); break;
    case "horizontal": drawHorizontal(ctx, d, conv, selected); break;
    case "rectangle": drawRectangle(ctx, d, conv, selected); break;
    case "rrtool": drawRR(ctx, d, conv, selected); break;
    case "measure": drawMeasure(ctx, d, conv); break;
    case "fib": drawFib(ctx, d, conv, selected); break;
    case "text": drawText(ctx, d, conv, selected); break;
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

// ---------- fibonacci ----------
function drawFib(ctx, d, conv, selected) {
  const { X, Y, W } = conv;
  const x1 = X(d.p1.time), y1 = Y(d.p1.price);
  const x2 = X(d.p2.time), y2 = Y(d.p2.price);
  if (x1 == null || y1 == null || x2 == null || y2 == null) return;

  const diff = d.p1.price - d.p2.price;
  const xs = Math.min(x1, x2), xe = Math.max(x1, x2);

  // draw levels
  (d.levels || []).forEach((lvl, i) => {
    const lvlPrice = d.p1.price - diff * lvl;
    const ly = Y(lvlPrice);
    if (ly == null) return;
    
    // solid line for 0 and 1, dashed for others
    ctx.strokeStyle = d.color || "#2962ff";
    ctx.lineWidth = d.width || 1;
    ctx.setLineDash(lvl === 0 || lvl === 1 ? [] : [4, 4]);
    if (selected) { ctx.shadowColor = d.color; ctx.shadowBlur = 4; }
    
    line(ctx, xs, ly, xe, ly);
    ctx.shadowBlur = 0;
    
    if (d.showLabel) {
      drawPriceTag(ctx, xe, ly, `${lvl} (${fmt(lvlPrice)})`, d.color, "left");
    }
  });

  // draw connecting trendline
  ctx.strokeStyle = d.color || "#2962ff";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  line(ctx, x1, y1, x2, y2);
  ctx.setLineDash([]);
}

// ---------- text ----------
function drawText(ctx, d, conv, selected) {
  const { X, Y } = conv;
  const x1 = X(d.p1.time), y1 = Y(d.p1.price);
  if (x1 == null || y1 == null) return;

  ctx.font = `600 ${d.fontSize || 14}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillStyle = d.color || "#2962ff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  if (selected) { ctx.shadowColor = d.color; ctx.shadowBlur = 6; }
  ctx.fillText(d.text || "Text", x1, y1);
  ctx.shadowBlur = 0;
}

// ---------- trendline ----------
function drawTrendline(ctx, d, conv, selected) {
  const { X, Y, W, H } = conv;
  const x1 = X(d.p1.time), y1 = Y(d.p1.price);
  let x2 = X(d.p2.time), y2 = Y(d.p2.price);
  if (x1 == null || y1 == null || x2 == null || y2 == null) {
    ctx.fillText(`NULL! x1:${x1} x2:${x2} bars:${conv.bars?.length}`, 100, 100);
    return;
  }
  
  ctx.fillStyle = "white";
  ctx.font = "12px monospace";
  ctx.fillText(`x1:${Math.round(x1)} x2:${Math.round(x2)} y1:${Math.round(y1)} y2:${Math.round(y2)}`, x1, y1 - 20);

  let xs = x1, ys = y1, xe = x2, ye = y2;
  const limitX = W * 2 || 4000;
  const limitY = H * 2 || 2000;

  if (d.extendRight) {
    if (Math.abs(x2 - x1) < 0.001) {
      xe = x1;
      ye = y2 > y1 ? limitY : -limitY;
    } else {
      xe = limitX;
      ye = y1 + ((limitX - x1) * (y2 - y1)) / (x2 - x1);
      if (Math.abs(ye) > limitY) {
        ye = ye > 0 ? limitY : -limitY;
        xe = x1 + ((ye - y1) * (x2 - x1)) / (y2 - y1);
        if (Math.abs(xe) > limitX) xe = xe > 0 ? limitX : -limitX;
      }
    }
  }
  if (d.extendLeft) {
    if (Math.abs(x2 - x1) < 0.001) {
      xs = x1;
      ys = y1 > y2 ? limitY : -limitY; // opposite direction of p1 -> p2
    } else {
      xs = -limitX;
      ys = y1 + ((-limitX - x1) * (y2 - y1)) / (x2 - x1);
      if (Math.abs(ys) > limitY) {
        ys = ys > 0 ? limitY : -limitY;
        xs = x1 + ((ys - y1) * (x2 - x1)) / (y2 - y1);
        if (Math.abs(xs) > limitX) xs = xs > 0 ? limitX : -limitX;
      }
    }
  }

  setStroke(ctx, d);
  if (selected) { ctx.lineWidth += 1; ctx.shadowColor = d.color; ctx.shadowBlur = 8; }
  ctx.beginPath();
  ctx.moveTo(xs, ys);
  ctx.lineTo(xe, ye);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.setLineDash([]);

  if (d.showLabel && selected) {
    drawPriceTag(ctx, x1, y1 - 12, fmt(d.p1.price), d.color);
    drawPriceTag(ctx, x2, y2 - 12, fmt(d.p2.price), d.color);
  }
}

// ---------- horizontal ----------
function drawHorizontal(ctx, d, conv, selected) {
  const { Y, W } = conv;
  const y = Y(d.price);
  if (y == null) return;
  setStroke(ctx, d);
  if (selected) { ctx.lineWidth += 1; ctx.shadowColor = d.color; ctx.shadowBlur = 8; }
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(W, y);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.setLineDash([]);
  if (d.showLabel) drawPriceTag(ctx, W, y, fmt(d.price), d.color, "right");
}

// ---------- rectangle ----------
function drawRectangle(ctx, d, conv, selected) {
  const { X, Y } = conv;
  const x1 = X(d.p1.time), y1 = Y(d.p1.price);
  const x2 = X(d.p2.time), y2 = Y(d.p2.price);
  if (x1 == null || y1 == null || x2 == null || y2 == null) return;
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  const w = maxX - minX, h = maxY - minY;

  // fill
  ctx.fillStyle = hexA(d.fill || d.color, d.fillOpacity ?? 0.12);
  ctx.fillRect(minX, minY, w, h);
  // border
  setStroke(ctx, d);
  if (selected) { ctx.lineWidth += 1; ctx.shadowColor = d.color; ctx.shadowBlur = 8; }
  ctx.strokeRect(minX + 0.5, minY + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  ctx.shadowBlur = 0;
  ctx.setLineDash([]);
}

// ---------- risk / reward (bounded box: entry.time .. p2Time) ----------
function drawRR(ctx, d, conv, selected) {
  const { X, Y } = conv;
  const ex = X(d.entry.time), ex2 = X(d.p2Time);
  const ey = Y(d.entry.price), sy = Y(d.stop), ty = Y(d.target);
  if (ex == null || ex2 == null || ey == null || sy == null || ty == null) return;

  const xs = Math.min(ex, ex2), xe = Math.max(ex, ex2);
  const boxW = Math.max(1, xe - xs);
  const isLong = d.target >= d.entry.price;

  const stopColor = d.stopColor || "#ef5350";
  const targetColor = d.targetColor || "#26a69a";

  // Reward zone (entry → target) and risk zone (entry → stop), both bounded.
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = targetColor;
  ctx.fillRect(xs, Math.min(ty, ey), boxW, Math.abs(ty - ey));
  ctx.fillStyle = stopColor;
  ctx.fillRect(xs, Math.min(sy, ey), boxW, Math.abs(sy - ey));
  ctx.globalAlpha = 1;

  ctx.lineWidth = selected ? 2.5 : 2;
  ctx.setLineDash([]);
  ctx.strokeStyle = targetColor; line(ctx, xs, ty, xe, ty);
  ctx.strokeStyle = stopColor;   line(ctx, xs, sy, xe, sy);
  ctx.strokeStyle = d.color || "#2962ff"; line(ctx, xs, ey, xe, ey);

  // side borders so the box reads as bounded on both edges
  ctx.strokeStyle = hexA(d.color || "#2962ff", 0.5);
  ctx.lineWidth = 1;
  line(ctx, xs, Math.min(sy, ty), xs, Math.max(sy, ty));
  line(ctx, xe, Math.min(sy, ty), xe, Math.max(sy, ty));

  if (d.showLabel) {
    let mult = 10000; // default forex
    if (conv.symbol) {
      const s = conv.symbol.toUpperCase();
      if (s.includes("JPY")) mult = 100;
      else if (["XAUUSD", "GOLD"].includes(s)) mult = 10;
      else if (["BTCUSD", "ETHUSD", "NAS100", "US30", "DJ30", "SPX500"].includes(s)) mult = 1;
    }
    const riskPips = (Math.abs(d.entry.price - d.stop) * mult).toFixed(1);
    const rewPips = (Math.abs(d.target - d.entry.price) * mult).toFixed(1);

    // Y-axis markers (right edge of the pane)
    drawPriceTag(ctx, conv.W, ey, fmt(d.entry.price), d.color, "right");
    drawPriceTag(ctx, conv.W, sy, fmt(d.stop), stopColor, "right");
    drawPriceTag(ctx, conv.W, ty, fmt(d.target), targetColor, "right");

    const ratio = d.ratio != null ? d.ratio : computeRR(d);
    let centerText = `R:R ${ratio.toFixed(2)}`;
    if (conv.currentPrice != null) {
      const liveDiff = isLong ? (conv.currentPrice - d.entry.price) : (d.entry.price - conv.currentPrice);
      const riskPrice = Math.abs(d.entry.price - d.stop);
      const liveRR = riskPrice ? (liveDiff / riskPrice) : 0;
      centerText += ` | Live ${liveRR.toFixed(2)}R`;
      let riskAmount = d.fixedRisk;
      if (d.accountSize && d.riskPercent) riskAmount = (d.accountSize * d.riskPercent) / 100;
      if (riskAmount) {
        const livePnL = liveRR * riskAmount;
        centerText += ` | ${livePnL >= 0 ? "+" : ""}$${livePnL.toFixed(2)}`;
      }
    }
    drawPriceTag(ctx, (xs + xe) / 2, ey - 14, centerText, d.color, "center");

    if (selected) {
      drawPriceTag(ctx, xe, sy, `S ${fmt(d.stop)} (${riskPips})`, stopColor, "right");
      drawPriceTag(ctx, xe, ty, `T ${fmt(d.target)} (${rewPips})`, targetColor, "right");
    }
  }
}

// ---------- measure ----------
function drawMeasure(ctx, d, conv) {
  const { X, Y } = conv;
  const x1 = X(d.p1.time), y1 = Y(d.p1.price);
  const x2 = X(d.p2.time), y2 = Y(d.p2.price);
  if (x1 == null || y1 == null || x2 == null || y2 == null) return;

  const dPrice = d.p2.price - d.p1.price;
  const pct = d.p1.price ? (dPrice / d.p1.price) * 100 : 0;
  // bar count on the CURRENT timeframe (time-based, so it adapts per TF)
  const l1 = timeToLogical(conv.bars, d.p1.time);
  const l2 = timeToLogical(conv.bars, d.p2.time);
  const bars = l1 != null && l2 != null ? Math.round(Math.abs(l2 - l1)) : 0;
  
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  const up = dPrice >= 0;

  // Background rectangle (always faint blue)
  ctx.fillStyle = "rgba(41, 98, 255, 0.15)";
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY);

  // Internal crosshair arrows (centered)
  ctx.strokeStyle = "#2962ff";
  ctx.lineWidth = 1;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  
  // Horizontal line
  ctx.beginPath();
  ctx.moveTo(minX, my);
  ctx.lineTo(maxX, my);
  ctx.stroke();
  
  // Vertical line
  ctx.beginPath();
  ctx.moveTo(mx, minY);
  ctx.lineTo(mx, maxY);
  ctx.stroke();

  // Draw arrowheads (simple V shapes)
  const drawArrow = (fromX, fromY, toX, toY) => {
    if (toX === fromX && toY === fromY) return;
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const headLen = 5;
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  };
  
  if (x2 !== x1) drawArrow(minX, my, maxX, my);
  if (y2 !== y1) drawArrow(mx, up ? maxY : minY, mx, up ? minY : maxY); // Arrow points in drag Y direction

  // Dotted projection lines extending outside to axes
  ctx.strokeStyle = "rgba(41, 98, 255, 0.4)";
  ctx.setLineDash([2, 4]);
  // extend from box to right axis
  line(ctx, maxX, minY, conv.W, minY);
  line(ctx, maxX, maxY, conv.W, maxY);
  // extend from box to bottom axis
  line(ctx, minX, maxY, minX, conv.H || 1000);
  line(ctx, maxX, maxY, maxX, conv.H || 1000);
  ctx.setLineDash([]);

  // Readout Data
  let mult = 10000;
  if (conv.symbol) {
    const s = conv.symbol.toUpperCase();
    if (s.includes("JPY")) mult = 100;
    else if (["XAUUSD", "GOLD"].includes(s)) mult = 10;
    else if (["BTCUSD", "ETHUSD", "NAS100", "US30", "DJ30", "SPX500"].includes(s)) mult = 1;
  }
  const pips = (Math.abs(dPrice) * mult).toFixed(1);
  const sign = up ? "+" : "-";

  const lines = [
    `${fmt(Math.abs(dPrice))} (${sign}${Math.abs(pct).toFixed(2)}%) ${pips}`,
    `${bars} bars`
  ];
  
  // Badge Positioning: Centered horizontally, above the box if dragging up, below if down
  let badgeY = minY - 22; 
  if (badgeY < 20) badgeY = maxY + 22;

  drawReadout(ctx, mx, badgeY, lines, "#2962ff");
}

// ---------- handles ----------
function drawHandles(ctx, d, conv, hoverHandle) {
  const { handles } = drawingToPx(d, conv);
  for (const h of handles) {
    if (h.x == null || h.y == null) continue;
    const hovered = hoverHandle === h.name;
    ctx.beginPath();
    ctx.arc(h.x, h.y, hovered ? 6 : 5, 0, Math.PI * 2);
    ctx.fillStyle = "#0e1116";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hovered ? "#fff" : d.color || "#2962ff";
    ctx.stroke();
  }
}

// ---------- canvas helpers ----------
function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawPriceTag(ctx, x, y, text, color, align) {
  ctx.font = "600 10px ui-monospace, monospace";
  const tw = ctx.measureText(text).width + 8;
  const th = 14;
  let bx = x;
  if (align === "right") bx = x - tw;
  else if (align === "left") bx = x;
  else bx = x - tw / 2;
  // clamp inside chart
  bx = Math.max(2, Math.min(bx, (ctx.canvas?.width || 9999) - tw - 2));
  ctx.fillStyle = color;
  roundRect(ctx, bx, y - th / 2, tw, th, 3);
  ctx.fill();
  ctx.fillStyle = readableOn(color);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, bx + 4, y + 0.5);
}

function drawReadout(ctx, x, y, lines, color) {
  ctx.font = "600 11px ui-monospace, monospace";
  let maxW = 0;
  for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
  const pad = 8;
  const w = maxW + pad * 2;
  const h = lines.length * 15 + pad;
  let bx = x - w / 2;
  let by = y - h / 2;
  bx = Math.max(2, Math.min(bx, (ctx.canvas?.width || 9999) - w - 2));
  by = Math.max(2, by);
  ctx.fillStyle = "rgba(14,17,22,0.92)";
  roundRect(ctx, bx, by, w, h, 5);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  roundRect(ctx, bx + 0.5, by + 0.5, w - 1, h - 1, 5);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, bx + pad, by + 8 + i * 15));
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// hex (#rrggbb) + alpha (0..1) -> rgba string
export function hexA(hex, a) {
  if (!hex || hex[0] !== "#" || hex.length < 7) return `rgba(41,98,255,${a})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// pick black/white text for a given fill color
function readableOn(color) {
  if (!color || color[0] !== "#" || color.length < 7) return "#fff";
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#0e1116" : "#fff";
}

// lightweight price formatter (chart digits may not be known here)
function fmt(p) {
  if (p == null || !Number.isFinite(p)) return "—";
  const abs = Math.abs(p);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 5;
  return Number(p).toFixed(digits);
}
