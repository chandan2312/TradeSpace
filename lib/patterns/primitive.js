import { FAINT } from "./core.js";

// Single lightweight-charts series primitive that renders every pattern
// drawing. zOrder "bottom" paints beneath the candles so patterns stay a
// faint backdrop instead of covering price action.
export class PatternsPrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._drawings = [];
    const renderer = { draw: (target) => this._draw(target) };
    this._paneView = { renderer: () => renderer, zOrder: () => "bottom" };
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

  paneViews() {
    return [this._paneView];
  }

  setDrawings(drawings) {
    this._drawings = drawings || [];
    this._requestUpdate?.();
  }

  _draw(target) {
    const chart = this._chart;
    const series = this._series;
    if (!chart || !series || !this._drawings.length) return;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const ts = chart.timeScale();
      const X = (i) => ts.logicalToCoordinate(i);
      const Y = (p) => series.priceToCoordinate(p);
      const W = mediaSize.width;

      for (const d of this._drawings) {
        if (d.kind === "zone") drawZone(ctx, d, X, Y, W);
        else if (d.kind === "segment") drawSegment(ctx, d, X, Y, W);
        else if (d.kind === "marker") drawMarker(ctx, d, X, Y);
      }
    });
  }
}

function drawZone(ctx, d, X, Y, W) {
  const x1 = X(d.i1);
  const x2 = d.i2 == null ? W : X(d.i2);
  const yT = Y(d.top);
  const yB = Y(d.bottom);
  if (x1 == null || x2 == null || yT == null || yB == null) return;
  if (x2 < 0 || x1 > W) return;

  ctx.fillStyle = d.fill;
  ctx.fillRect(x1, yT, x2 - x1, yB - yT);
  ctx.strokeStyle = d.color;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeRect(x1 + 0.5, yT + 0.5, x2 - x1 - 1, yB - yT - 1);
  if (d.label) label(ctx, d.label, Math.max(x1, 0) + 4, yT + 10);
}

function drawSegment(ctx, d, X, Y, W) {
  const x1 = X(d.i1);
  const y1 = Y(d.p1);
  const x2 = X(d.i2);
  const y2 = Y(d.p2);
  if (x1 == null || y1 == null || x2 == null || y2 == null) return;

  let xe = x2;
  let ye = y2;
  if (d.extendRight && x2 > x1) {
    xe = W;
    ye = y2 + ((W - x2) * (y2 - y1)) / (x2 - x1);
  }

  ctx.strokeStyle = d.color;
  ctx.lineWidth = d.width || 1;
  ctx.setLineDash(d.dash || []);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(xe, ye);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const dot of d.dots || []) {
    const dx = X(dot.i);
    const dy = Y(dot.p);
    if (dx == null || dy == null) continue;
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(dx, dy, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  if (d.label) label(ctx, d.label, x1 + 4, y1 - 5);
}

function drawMarker(ctx, d, X, Y) {
  const x = X(d.i);
  const y = Y(d.p);
  if (x == null || y == null) return;
  const off = d.side === "below" ? 14 : -8;
  ctx.fillStyle = d.color || FAINT.text;
  ctx.font = "600 10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(d.text, x, y + off);
  ctx.textAlign = "left";
}

function label(ctx, text, x, y) {
  ctx.fillStyle = FAINT.text;
  ctx.font = "9px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(text, x, y);
}
