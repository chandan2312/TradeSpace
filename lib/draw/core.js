// Drawing tools core: data shapes, defaults, geometry, hit-testing.
//
// A drawing is anchored to chart coordinates that survive pan/zoom/new bars:
//   point = { logical: Number, price: Number }
//   - `logical` is the bar's logical index (timeScale().logicalToCoordinate).
//     Unlike raw time, a logical index stays fixed as new bars append, so a
//     trendline drawn on bar N doesn't drift when bar N+1 arrives.
//   - `price` is a raw price (series.priceToCoordinate).
//
// Drawing types:
//   trendline  { id, type:"trendline",  p1, p2, color, width, style, extendLeft, extendRight, showLabel, hidden, locked }
//   horizontal { id, type:"horizontal", price, color, width, style, showLabel, hidden, locked }
//   rectangle  { id, type:"rectangle",  p1, p2, color, fill, fillOpacity, width, style, hidden, locked }
//   rrtool     { id, type:"rrtool", entry:{logical,price}, stop, target, ratio, color, showLabel, hidden, locked }
//   measure    { id, type:"measure", p1, p2, transient }
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

// Create a fresh drawing of a given type from two anchor points.
// `p1`/`p2` are { logical, price }. For horizontal/rrtool the second point
// only contributes price.
export function createDrawing(type, p1, p2, style) {
  const s = { ...DEFAULT_STYLE, ...style };
  const base = { id: makeId(), type, hidden: false, locked: false };
  switch (type) {
    case "trendline":
      return { ...base, p1, p2, color: s.color, width: s.width, style: s.style, extendLeft: false, extendRight: false, showLabel: s.showLabel };
    case "horizontal":
      // price is taken from p1; the line spans the full chart width
      return { ...base, price: p1.price, color: s.color, width: s.width, style: s.style, showLabel: s.showLabel };
    case "rectangle":
      return { ...base, p1, p2, color: s.color, fill: s.color, fillOpacity: s.fillOpacity, width: s.width, style: s.style };
    case "rrtool": {
      const defaultRisk = p1.price * 0.0025; // 0.25%
      const defaultReward = p1.price * 0.005; // 0.5%
      return {
        ...base,
        entry: { logical: p1.logical, price: p1.price, time: p1.time ?? null },
        p2Logical: p2.logical !== p1.logical ? p2.logical : p1.logical + 10,
        p2Time: p2.time != null && p2.time !== p1.time ? p2.time : null,
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

// Clone a drawing with a new id and a small pixel offset on its points.
export function cloneDrawing(d) {
  const copy = { ...d, id: makeId() };
  const shift = 3;
  if (copy.p1) copy.p1 = { ...copy.p1, logical: copy.p1.logical + shift };
  if (copy.p2) copy.p2 = { ...copy.p2, logical: copy.p2.logical + shift };
  if (copy.type === "horizontal") copy.price = d.price;
  if (copy.type === "rrtool") {
    copy.entry = { ...copy.entry, logical: copy.entry.logical + shift };
  }
  return copy;
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

// Resolve a drawing's anchor points into pixel space using the chart's
// coordinate converters. Returns { handles: [{name,x,y}], body: [...] }
// describing draggable handles and body geometry for hit-testing.
//
// `conv` = { X:(point|logical)->x|null, Y:(price)->y|null, W: width }
// X accepts either a point object ({time, logical}) — preferring time so
// drawings survive TF switches — or a bare logical number (legacy call sites).
export function drawingToPx(d, conv) {
  const { X, Y, W } = conv;
  const handles = [];
  const bodies = []; // each: { kind, ... } tested with pointToSegmentDist / pointInRect

  switch (d.type) {
    case "trendline": {
      const x1 = X(d.p1), y1 = Y(d.p1.price);
      let x2 = X(d.p2), y2 = Y(d.p2.price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) break;
      // extension endpoints
      let xe = x2, ye = y2, xs = x1, ys = y1;
      if (d.extendRight && x2 !== x1) {
        xe = W; ye = y2 + ((W - x2) * (y2 - y1)) / (x2 - x1);
      }
      if (d.extendLeft && x2 !== x1) {
        xs = 0; ys = y1 + ((0 - x1) * (y2 - y1)) / (x2 - x1);
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
      const x1 = X(d.p1), y1 = Y(d.p1.price);
      const x2 = X(d.p2), y2 = Y(d.p2.price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) break;
      handles.push({ name: "p1", x: x1, y: y1 });
      handles.push({ name: "p2", x: x2, y: y2 });
      handles.push({ name: "p1x", x: x2, y: y1 }); // corner helpers for resize feel
      handles.push({ name: "p2x", x: x1, y: y2 });
      bodies.push({ kind: "rect", x1, y1, x2, y2 });
      break;
    }
    case "rrtool": {
      const ex = X(d.entry), ey = Y(d.entry.price);
      const ex2 = X({ time: d.p2Time, logical: d.p2Logical });
      const sy = Y(d.stop), ty = Y(d.target);
      if (ey == null || sy == null || ty == null || ex == null || ex2 == null) break;
      handles.push({ name: "entry", x: ex, y: ey });
      handles.push({ name: "stop", x: ex2, y: sy });
      handles.push({ name: "target", x: ex2, y: ty });
      handles.push({ name: "p2Logical", x: ex2, y: ey });
      bodies.push({ kind: "rect", x1: Math.min(ex, ex2), y1: Math.min(sy, ty), x2: Math.max(ex, ex2), y2: Math.max(sy, ty) });
      break;
    }
    case "measure": {
      const x1 = X(d.p1), y1 = Y(d.p1.price);
      const x2 = X(d.p2), y2 = Y(d.p2.price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) break;
      handles.push({ name: "p1", x: x1, y: y1 });
      handles.push({ name: "p2", x: x2, y: y2 });
      bodies.push({ kind: "segment", x1, y1, x2, y2 });
      break;
    }
    case "fib": {
      const x1 = X(d.p1), y1 = Y(d.p1.price);
      const x2 = X(d.p2), y2 = Y(d.p2.price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) break;
      handles.push({ name: "p1", x: x1, y: y1 });
      handles.push({ name: "p2", x: x2, y: y2 });
      // hit test the main trendline for the fib
      bodies.push({ kind: "segment", x1, y1, x2, y2 });
      // optionally hit test the horizontal levels
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
      const x1 = X(d.p1), y1 = Y(d.p1.price);
      if (x1 == null || y1 == null) break;
      handles.push({ name: "p1", x: x1, y: y1 });
      // approximate text box for hit-testing (assumes ~8px per char, 20px height)
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
// `handle` is the handle name when a handle is grabbed, else null (body hit).
export function hitTest(drawings, px, py, conv) {
  // iterate from topmost (end of array) to bottom
  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i];
    if (d.hidden) continue;
    const { handles, bodies } = drawingToPx(d, conv);
    // handles take priority
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
      } else if (b.kind === "rr") {
        // hit anywhere in the band between target and stop
        const top = Math.min(b.ty, b.sy), bot = Math.max(b.ty, b.sy);
        if (py >= top && py <= bot) return { drawing: d, handle: null };
      }
    }
  }
  return null;
}

// Map a pixel coordinate back to a { logical, price, time } anchor.
// `time` is what survives TF switches — logical is a bar-index tied to the
// current setData() call and shifts when bars refetch.
// `inv` = { XtoL:(x)->logical|null, XtoT:(x)->time|null, YtoP:(y)->price|null }
export function pxToPoint(px, py, inv) {
  const logical = inv.XtoL(px);
  const price = inv.YtoP(py);
  const time = inv.XtoT ? inv.XtoT(px) : null;
  if (logical == null || price == null || !Number.isFinite(price)) return null;
  return { logical, price, time };
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
      if (handle === "p1x") return { ...d, p1: { ...d.p1, price: point.price }, p2: { ...d.p2, logical: point.logical, time: point.time } };
      if (handle === "p2x") return { ...d, p1: { ...d.p1, logical: point.logical, time: point.time }, p2: { ...d.p2, price: point.price } };
      return d;
    case "horizontal":
      if (handle === "price") return { ...d, price: point.price };
      return d;
    case "text":
      if (handle === "p1") return { ...d, p1: point };
      return d;
    case "rrtool":
      if (handle === "p2") {
        // during create or drag of the p2 handle: target follows Y, stop mirrors,
        // p2Logical/p2Time follow X so the box extends from entry to the drag point.
        const target = point.price;
        const stop = d.entry.price - (point.price - d.entry.price);
        const next = { ...d, p2Logical: point.logical, p2Time: point.time ?? null, target, stop };
        next.ratio = computeRR(next);
        return next;
      }
      if (handle === "entry") return { ...d, entry: { logical: point.logical, price: point.price, time: point.time ?? null } };
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
      if (handle === "p2Logical") {
        return { ...d, p2Logical: point.logical, p2Time: point.time ?? d.p2Time };
      }
      return d;
    default:
      return d;
  }
}

// Translate a whole drawing by a delta in logical/time/price units.
// `dTime` is optional — omit or 0 for pure price-shifts (horizontal, stop/target).
export function translate(d, dLog, dTime, dPrice) {
  const shift = (pt) => ({
    logical: pt.logical + dLog,
    price: pt.price + dPrice,
    time: pt.time != null ? pt.time + dTime : null,
  });
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
        p2Logical: d.p2Logical + dLog,
        p2Time: d.p2Time != null ? d.p2Time + dTime : null,
        stop: d.stop + dPrice,
        target: d.target + dPrice,
      };
    default:
      return d;
  }
}

// Risk/reward ratio for an rr drawing.
export function computeRR(d) {
  const risk = Math.abs(d.entry.price - d.stop);
  const reward = Math.abs(d.target - d.entry.price);
  if (!risk) return 0;
  return reward / risk;
}
