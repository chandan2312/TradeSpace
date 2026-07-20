// Drawing tools core: data shapes, defaults, geometry, hit-testing.
//
// ── Anchor model ────────────────────────────────────────────────────────────
// Every anchor is { time, price }:
//   - `time`  = unix seconds. The ONLY horizontal anchor. It is universal
//     across timeframes: a point at 10:15 is the same instant on 5M and 1D.
//   - `price` = raw price, universal by nature.
// There is deliberately NO bar-index (`logical`) in stored data: a bar index
// is only meaningful for the exact bars array it was captured against, so any
// code path that renders one on another timeframe is a bug by construction.
//
// Rendering x-coordinate: time → fractional bar index via the CURRENT bars
// (timeToLogical: binary search + linear interpolation, extrapolates past
// both ends) → timeScale().logicalToCoordinate. This is how a 15M-aligned
// time lands between two 1H bars at the right pixel, and how anchors in the
// future whitespace (right of the last bar) stay put.
//
// Drawing types:
//   trendline  { id, type:"trendline",  p1, p2, color, width, style, extendLeft, extendRight, showLabel, hidden, locked }
//   horizontal { id, type:"horizontal", price, color, width, style, showLabel, hidden, locked }
//   rectangle  { id, type:"rectangle",  p1, p2, color, fill, fillOpacity, width, style, hidden, locked }
//   rrtool     { id, type:"rrtool", entry:{time,price}, p2Time, stop, target, ratio, ... }
//              — a bounded box: left edge = entry.time, right edge = p2Time
//   measure    { id, type:"measure", p1, p2, transient }
//   fib        { id, type:"fib", p1, p2, levels, ... }
//   text       { id, type:"text", p1, text, fontSize, ... }
//
// `style` is one of: "solid" | "dashed" | "dotted"

export const TOOLS = [
  { id: "cursor", label: "Cursor", icon: "MousePointer2" },
  { id: "trendline", label: "Trend line", icon: "TrendingUp" },
  { id: "horizontal", label: "Horizontal line", icon: "Minus" },
  { id: "rectangle", label: "Rectangle", icon: "Square" },
  { id: "rrtool", label: "Risk / Reward", icon: "GitCompareArrows" },
  { id: "measure", label: "Measure", icon: "Ruler" },
  { id: "fib", label: "Fibonacci", icon: "GripHorizontal" },
  { id: "text", label: "Text", icon: "Type" },
];

export const PALETTE = [
  "#2962ff", "#ff9800", "#26a69a", "#ef5350",
  "#ab47bc", "#26c6da", "#ffd54f", "#d7dce6",
];

export const DEFAULT_STYLE = {
  color: "#2962ff",
  width: 2,
  style: "solid",
  fillOpacity: 0.12,
  showLabel: true,
};

// line style -> canvas dash pattern
export const DASH = {
  solid: [],
  dashed: [6, 4],
  dotted: [2, 4],
};

const ID_PREFIX = "dw_";
let _seq = 0;
export function makeId() {
  _seq = (_seq + 1) % 1e9;
  return `${ID_PREFIX}${Date.now().toString(36)}_${_seq}`;
}

// ---------------- time <-> bar index (the one horizontal mapping) ----------
// `bars` is the currently loaded series data, sorted by time ascending.
// Fractional indices interpolate between bars; out-of-range times extrapolate
// using the neighbouring bar spacing so future-whitespace anchors resolve.

export function timeToLogical(bars, t, spanSec) {
  if (t == null || !Number.isFinite(t) || !bars || bars.length === 0) return null;
  const last = bars.length - 1;
  const defaultSpan = spanSec || (last > 0 ? bars[last].time - bars[last - 1].time : 1);
  if (t <= bars[0].time) {
    return (t - bars[0].time) / defaultSpan;
  }
  if (t >= bars[last].time) {
    return last + (t - bars[last].time) / defaultSpan;
  }
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= t) lo = mid; else hi = mid;
  }
  const span = bars[hi].time - bars[lo].time || defaultSpan;
  return lo + (t - bars[lo].time) / span;
}

export function logicalToTime(bars, l, spanSec) {
  if (l == null || !Number.isFinite(l) || !bars || bars.length === 0) return null;
  const last = bars.length - 1;
  const defaultSpan = spanSec || (last > 0 ? bars[last].time - bars[last - 1].time : 1);
  if (l <= 0) {
    return bars[0].time + l * defaultSpan;
  }
  if (l >= last) {
    return bars[last].time + (l - last) * defaultSpan;
  }
  const lo = Math.floor(l);
  return bars[lo].time + (l - lo) * (bars[lo + 1].time - bars[lo].time);
}

// ---------------- creation / mutation ----------------

const validPt = (p) => p && Number.isFinite(p.time) && Number.isFinite(p.price);

// Create a fresh drawing of a given type from two anchor points ({time,price}).
// For horizontal the second point is ignored; for rrtool p2 contributes the
// right boundary time (null → caller stamps a default width).
export function createDrawing(type, p1, p2, style) {
  const s = { ...DEFAULT_STYLE, ...style };
  const base = { id: makeId(), type, hidden: false, locked: false };
  switch (type) {
    case "trendline":
      return { ...base, p1, p2, color: s.color, width: s.width, style: s.style, extendLeft: false, extendRight: false, showLabel: s.showLabel };
    case "horizontal":
      return { ...base, price: p1.price, color: s.color, width: s.width, style: s.style, showLabel: s.showLabel };
    case "rectangle":
      return { ...base, p1, p2, color: s.color, fill: s.color, fillOpacity: s.fillOpacity, width: s.width, style: s.style };
    case "rrtool": {
      // Starts as a Long; flip in settings. Boundaries: entry.time .. p2Time.
      const defaultRisk = p1.price * 0.0025;  // 0.25%
      const defaultReward = p1.price * 0.005; // 0.5%
      return {
        ...base,
        entry: { time: p1.time, price: p1.price },
        p2Time: p2.time !== p1.time ? p2.time : null, // null → caller stamps default width
        stop: p1.price - defaultRisk,
        target: p1.price + defaultReward,
        ratio: 2,
        color: s.color,
        stopColor: "#ef5350",
        targetColor: "#26a69a",
        accountSize: 10000,
        riskPercent: 1.0,
        showLabel: s.showLabel,
      };
    }
    case "measure":
      return { ...base, p1, p2, transient: true };
    case "fib":
      return { ...base, p1, p2, color: s.color, width: s.width, style: s.style, levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618] };
    case "text":
      return { ...base, p1, text: "Text", color: s.color, fontSize: 14 };
    default:
      return null;
  }
}

// Clone with a new id, shifted by (dTime, dPrice).
export function cloneDrawing(d, dTime = 0, dPrice = 0) {
  return { ...translate(d, dTime, dPrice), id: makeId() };
}

// Drop drawings whose anchors can't be placed by time — pre-time-model data
// (bar-index anchors) is unplaceable on any timeframe but its origin, which
// was never recorded. Rendering it wrong is worse than dropping it.
export function sanitizeDrawings(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter((d) => {
    if (!d || !d.type) return false;
    switch (d.type) {
      case "horizontal": return Number.isFinite(d.price);
      case "rrtool": return validPt(d.entry) && Number.isFinite(d.p2Time) && Number.isFinite(d.stop) && Number.isFinite(d.target);
      case "text": return validPt(d.p1);
      default: return validPt(d.p1) && validPt(d.p2);
    }
  });
}

// Update a single handle of a drawing to a new point (returns a new drawing).
export function moveHandle(d, handle, point) {
  switch (d.type) {
    case "trendline":
    case "rectangle":
    case "measure":
    case "fib":
      if (handle === "p1") return { ...d, p1: point };
      if (handle === "p2") return { ...d, p2: point };
      if (handle === "p1x") return { ...d, p1: { ...d.p1, price: point.price }, p2: { ...d.p2, time: point.time } };
      if (handle === "p2x") return { ...d, p1: { ...d.p1, time: point.time }, p2: { ...d.p2, price: point.price } };
      return d;
    case "horizontal":
      if (handle === "price") return { ...d, price: point.price };
      return d;
    case "text":
      if (handle === "p1") return { ...d, p1: point };
      return d;
    case "rrtool": {
      if (handle === "entry") {
        // entry drags the whole position: stop/target keep their distances
        const dPrice = point.price - d.entry.price;
        const dTime = point.time - d.entry.time;
        return {
          ...d,
          entry: { time: point.time, price: point.price },
          p2Time: d.p2Time + dTime,
          stop: d.stop + dPrice,
          target: d.target + dPrice,
        };
      }
      if (handle === "stop") {
        const next = { ...d, stop: point.price };
        next.ratio = computeRR(next);
        return next;
      }
      if (handle === "target") {
        const next = { ...d, target: point.price };
        next.ratio = computeRR(next);
        return next;
      }
      if (handle === "right") {
        // resize the box width; never collapse past the entry
        return { ...d, p2Time: Math.max(point.time, d.entry.time + 1) };
      }
      return d;
    }
    default:
      return d;
  }
}

// Translate a whole drawing by (dTime, dPrice).
export function translate(d, dTime, dPrice) {
  const shift = (pt) => ({ time: pt.time + dTime, price: pt.price + dPrice });
  switch (d.type) {
    case "trendline":
    case "rectangle":
    case "measure":
    case "fib":
      return { ...d, p1: shift(d.p1), p2: shift(d.p2) };
    case "horizontal":
      return { ...d, price: d.price + dPrice };
    case "text":
      return { ...d, p1: shift(d.p1) };
    case "rrtool":
      return {
        ...d,
        entry: shift(d.entry),
        p2Time: d.p2Time + dTime,
        stop: d.stop + dPrice,
        target: d.target + dPrice,
      };
    default:
      return d;
  }
}

// ---------------- geometry ----------------

export function dist(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return Math.hypot(dx, dy);
}

// distance from point P to segment AB
export function pointToSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return dist(px, py, ax + t * dx, ay + t * dy);
}

export function pointInRect(px, py, x1, y1, x2, y2) {
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}

// Resolve a drawing's anchors into pixel space for hit-testing/handles.
// `conv` = { X:(time)->x|null, Y:(price)->y|null, W: width }
// Returns { handles: [{name,x,y}], bodies: [...] }.
export function drawingToPx(d, conv) {
  const { X, Y, W, H } = conv;
  const handles = [];
  const bodies = [];

  switch (d.type) {
    case "trendline": {
      const x1 = X(d.p1.time), y1 = Y(d.p1.price);
      const x2 = X(d.p2.time), y2 = Y(d.p2.price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) break;
      let xe = x2, ye = y2, xs = x1, ys = y1;
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
          ys = y1 > y2 ? limitY : -limitY;
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
      handles.push({ name: "p1", x: x1, y: y1 });
      handles.push({ name: "p2", x: x2, y: y2 });
      bodies.push({ kind: "segment", x1: xs, y1: ys, x2: xe, y2: ye });
      break;
    }
    case "horizontal": {
      const y = Y(d.price);
      if (y == null) break;
      handles.push({ name: "price", x: W - 8, y });
      bodies.push({ kind: "segment", x1: 0, y1: y, x2: W, y2: y });
      break;
    }
    case "rectangle": {
      const x1 = X(d.p1.time), y1 = Y(d.p1.price);
      const x2 = X(d.p2.time), y2 = Y(d.p2.price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) break;
      handles.push({ name: "p1", x: x1, y: y1 });
      handles.push({ name: "p2", x: x2, y: y2 });
      handles.push({ name: "p1x", x: x2, y: y1 }); // corner helpers for resize feel
      handles.push({ name: "p2x", x: x1, y: y2 });
      bodies.push({ kind: "rect", x1, y1, x2, y2 });
      break;
    }
    case "rrtool": {
      const ex = X(d.entry.time), ex2 = X(d.p2Time);
      const ey = Y(d.entry.price), sy = Y(d.stop), ty = Y(d.target);
      if (ex == null || ex2 == null || ey == null || sy == null || ty == null) break;
      const xs = Math.min(ex, ex2), xe = Math.max(ex, ex2);
      // handles: entry (left edge), width (right edge), stop/target (right edge)
      handles.push({ name: "entry", x: xs, y: ey });
      handles.push({ name: "right", x: xe, y: ey });
      handles.push({ name: "stop", x: (xs + xe) / 2, y: sy });
      handles.push({ name: "target", x: (xs + xe) / 2, y: ty });
      // grabbing the level lines adjusts them; grabbing the zones moves the tool
      bodies.push({ kind: "rr_line", handle: "stop", x1: xs, x2: xe, y: sy });
      bodies.push({ kind: "rr_line", handle: "target", x1: xs, x2: xe, y: ty });
      bodies.push({ kind: "rr_line", handle: "entry", x1: xs, x2: xe, y: ey });
      bodies.push({ kind: "rect", x1: xs, y1: Math.min(sy, ty), x2: xe, y2: Math.max(sy, ty) });
      break;
    }
    case "measure": {
      const x1 = X(d.p1.time), y1 = Y(d.p1.price);
      const x2 = X(d.p2.time), y2 = Y(d.p2.price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) break;
      handles.push({ name: "p1", x: x1, y: y1 });
      handles.push({ name: "p2", x: x2, y: y2 });
      bodies.push({ kind: "segment", x1, y1, x2, y2 });
      break;
    }
    case "fib": {
      const x1 = X(d.p1.time), y1 = Y(d.p1.price);
      const x2 = X(d.p2.time), y2 = Y(d.p2.price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) break;
      handles.push({ name: "p1", x: x1, y: y1 });
      handles.push({ name: "p2", x: x2, y: y2 });
      bodies.push({ kind: "segment", x1, y1, x2, y2 });
      const diff = d.p1.price - d.p2.price;
      const xStart = Math.min(x1, x2), xEnd = Math.max(x1, x2);
      (d.levels || []).forEach(lvl => {
        const lvlPrice = d.p1.price - diff * lvl;
        const ly = Y(lvlPrice);
        if (ly != null) bodies.push({ kind: "segment", x1: xStart, y1: ly, x2: xEnd, y2: ly });
      });
      break;
    }
    case "text": {
      const x1 = X(d.p1.time), y1 = Y(d.p1.price);
      if (x1 == null || y1 == null) break;
      handles.push({ name: "p1", x: x1, y: y1 });
      const w = Math.max(20, (d.text || "").length * 8);
      bodies.push({ kind: "rect", x1: x1, y1: y1 - 20, x2: x1 + w, y2: y1 + 5 });
      break;
    }
  }
  return { handles, bodies };
}

export const HANDLE_RADIUS = 6; // px grab radius for a handle
export const BODY_HIT = 7;      // px tolerance for clicking a line/body

// Hit-test all drawings (topmost first). Returns { drawing, handle } or null.
// `handle` is the handle name when a handle/level-line is grabbed, else null.
export function hitTest(drawings, px, py, conv) {
  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i];
    if (d.hidden) continue;
    const { handles, bodies } = drawingToPx(d, conv);
    for (const h of handles) {
      if (h.x == null || h.y == null) continue;
      if (dist(px, py, h.x, h.y) <= HANDLE_RADIUS) {
        return { drawing: d, handle: h.name };
      }
    }
    for (const b of bodies) {
      if (b.kind === "segment") {
        if (pointToSegmentDist(px, py, b.x1, b.y1, b.x2, b.y2) <= BODY_HIT) {
          return { drawing: d, handle: null };
        }
      } else if (b.kind === "rect") {
        if (pointInRect(px, py, b.x1, b.y1, b.x2, b.y2)) {
          return { drawing: d, handle: null };
        }
      } else if (b.kind === "rr_line") {
        if (Math.abs(py - b.y) <= BODY_HIT && px >= b.x1 && px <= b.x2) {
          return { drawing: d, handle: b.handle };
        }
      }
    }
  }
  return null;
}

// Map a pixel coordinate back to a { time, price } anchor.
// `inv` = { XtoT:(x)->time|null, YtoP:(y)->price|null }
export function pxToPoint(px, py, inv) {
  const time = inv.XtoT(px);
  const price = inv.YtoP(py);
  if (!Number.isFinite(time) || !Number.isFinite(price)) return null;
  return { time, price };
}

// Risk/reward ratio for an rr drawing.
export function computeRR(d) {
  const risk = Math.abs(d.entry.price - d.stop);
  const reward = Math.abs(d.target - d.entry.price);
  if (!risk) return 0;
  return reward / risk;
}
