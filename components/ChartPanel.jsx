"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PatternsPrimitive } from "../lib/patterns/primitive.js";
import { runPatterns } from "../lib/patterns/index.js";
import { DrawingsPrimitive } from "../lib/draw/primitive.js";
import { useDrawings } from "../lib/draw/useDrawings.js";
import { useChartSettings } from "../lib/chartSettings.js";
import { Loader2 } from "lucide-react";
import DrawingToolbar from "./DrawingToolbar.jsx";
import DrawingContextMenu from "./DrawingContextMenu.jsx";
import DrawingSettings from "./DrawingSettings.jsx";

const TF_SEC = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };

class AlertsPrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._alerts = [];
    this._dragging = null;
    this._bars = [];
    this._paneView = { renderer: () => ({ draw: (target) => this._draw(target) }), zOrder: () => "top" };
  }
  attached({ chart, series, requestUpdate }) {
    this._chart = chart; this._series = series; this._requestUpdate = requestUpdate;
  }
  detached() { this._chart = null; this._series = null; this._requestUpdate = null; }
  updateAllViews() {}
  paneViews() { return [this._paneView]; }

  update(alerts, dragging, bars) {
    this._alerts = alerts || [];
    this._dragging = dragging;
    this._bars = bars || [];
    this._requestUpdate?.();
  }

  _draw(target) {
    const chart = this._chart;
    const series = this._series;
    const bars = this._bars;
    if (!chart || !series || !bars.length) return;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const ts = chart.timeScale();
      const X = (i) => ts.logicalToCoordinate(i);
      const Y = (p) => series.priceToCoordinate(p);
      const W = mediaSize.width;

      const drawRay = (price, condition, isTriggered) => {
        let found = false;
        let startIdx = 0;
        for (let i = bars.length - 1; i >= 0; i--) {
          const b = bars[i];
          if (b.low <= price && b.high >= price) {
            startIdx = i;
            found = true;
            break;
          }
        }
        if (!found) {
          startIdx = Math.max(0, bars.length - 1 - 25);
        }
        
        const x1 = X(startIdx);
        const y1 = Y(price);
        if (x1 == null || y1 == null) return;
        
        const color = isTriggered ? "rgba(239, 83, 80, 0.75)" : "rgba(255, 152, 0, 0.75)";
        
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(Math.max(x1, 0), y1);
        ctx.lineTo(W, y1);
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.save();
        // position the 12x12 bell right above the line, near the right edge
        ctx.translate(W - 16, y1 - 14);
        ctx.scale(0.5, 0.5);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3; // 1.5px visual
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const bell = new Path2D("M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0");
        ctx.stroke(bell);
        ctx.restore();
      };

      for (const a of this._alerts) {
        const livePrice = this._dragging?.id === a._id ? this._dragging.price : a.price;
        drawRay(livePrice, a.condition, a.status === "triggered");
      }
    });
  }
}

export default function ChartPanel({
  symbol, tf, tick, alerts, barsCache, onAddAlert, onDeleteAlert, onMoveAlert, onRearmAlert, indicators, onAutoAlert,
  syncOpts, paneId, syncedLogicalRange, setSyncedLogicalRange, syncedCrosshair, setSyncedCrosshair,
  isActive = true, onOpenSettings
}) {
  const wrapRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const lastBarRef = useRef(null);
  const patternsRef = useRef(null);  // PatternsPrimitive attached to the series
  const alertsPrimRef = useRef(null); // AlertsPrimitive
  const drawPrimRef = useRef(null);   // DrawingsPrimitive (user drawing tools)
  const barsRef = useRef([]);        // full bar array the detectors run on
  const [dataVersion, setDataVersion] = useState(0); // bumped on load + bar close
  const hoverPriceRef = useRef(null);
  const [barsDigits, setBarsDigits] = useState(null);
  // broker-reported digits (live tick) win; decimals seen in the bars are the fallback
  const digits = tick?.digits ?? barsDigits ?? 5;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hoverBtn, setHoverBtn] = useState(null); // {y, price}
  const [isHoveringBtn, setIsHoveringBtn] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);   // {x, y, price, nearAlerts:[]}
  const [dragHandle, setDragHandle] = useState(null); // {id, y, price} when pointer near a line
  const [dragging, setDragging] = useState(null);     // {id, price} while actively dragging
  const dragStateRef = useRef(null);
  const logicalRangeRef = useRef(null);

  const fmt = useCallback((p) => Number(p).toFixed(digits), [digits]);

  // keep latest alerts accessible to the stable mousemove handler
  const alertsRef = useRef(alerts);
  useEffect(() => { alertsRef.current = alerts; }, [alerts]);

  // ---------- drawing tools ----------
  const draw = useDrawings({ chartRef, seriesRef, wrapRef, symbol, tf, barsRef, isActive, primRef: drawPrimRef });

  // ---------- global settings ----------
  const [settings] = useChartSettings();

  // Apply settings whenever they change
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    chart.applyOptions({
      layout: { 
        background: settings.bgType === "Solid" 
          ? { type: "solid", color: settings.bgColor } 
          : { type: "gradient", topColor: settings.bgGradientTop, bottomColor: settings.bgGradientBottom },
        textColor: settings.textColor,
        fontSize: 10,
      },
      grid: { 
        vertLines: { color: settings.gridVertColor }, 
        horzLines: { color: settings.gridHorzColor } 
      },
      watermark: {
        visible: settings.watermark,
        color: settings.watermarkColor,
        text: `${symbol} ${tf}`
      },
      timeScale: { borderColor: settings.linesColor },
      rightPriceScale: { borderColor: settings.linesColor },
    });

    series.applyOptions({
      upColor: settings.upColor,
      downColor: settings.downColor,
      wickUpColor: settings.wickUpColor,
      wickDownColor: settings.wickDownColor,
      borderUpColor: settings.borderUpColor,
      borderDownColor: settings.borderDownColor,
      borderVisible: settings.borderVisible,
    });
  }, [settings, symbol, tf]);

  // ---------- create chart once ----------
  useEffect(() => {
    let disposed = false;
    (async () => {
      const { createChart, CrosshairMode } = await import("lightweight-charts");
      if (disposed || !wrapRef.current) return;
      const chart = createChart(wrapRef.current, {
        layout: { 
          background: settings.bgType === "Solid" 
            ? { type: "solid", color: settings.bgColor } 
            : { type: "gradient", topColor: settings.bgGradientTop, bottomColor: settings.bgGradientBottom },
          textColor: settings.textColor,
          fontSize: 10,
        },
        grid: { 
          vertLines: { color: settings.gridVertColor }, 
          horzLines: { color: settings.gridHorzColor } 
        },
        crosshair: { mode: CrosshairMode.Normal },
        timeScale: { rightOffset: 12, timeVisible: true, secondsVisible: false, borderColor: settings.linesColor },
        rightPriceScale: { borderColor: settings.linesColor },
        watermark: {
          visible: settings.watermark,
          fontSize: 64,
          horzAlign: 'center',
          vertAlign: 'center',
          color: settings.watermarkColor,
          text: `${symbol} ${tf}`,
        },
        autoSize: true,
      });
      const series = chart.addCandlestickSeries({
        upColor: settings.upColor, 
        downColor: settings.downColor,
        wickUpColor: settings.wickUpColor, 
        wickDownColor: settings.wickDownColor,
        borderUpColor: settings.borderUpColor,
        borderDownColor: settings.borderDownColor,
        borderVisible: settings.borderVisible,
      });
      
      const patterns = new PatternsPrimitive();
      series.attachPrimitive(patterns);
      patternsRef.current = patterns;
      
      const alertsPrim = new AlertsPrimitive();
      series.attachPrimitive(alertsPrim);
      alertsPrimRef.current = alertsPrim;

      const drawPrim = new DrawingsPrimitive();
      series.attachPrimitive(drawPrim);
      drawPrimRef.current = drawPrim;

      chartRef.current = chart;
      seriesRef.current = series;
    })();
    return () => {
      disposed = true;
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // ---------- load bars on symbol/tf change (cache-first for instant switch) ----------
  useEffect(() => {
    let cancelled = false;
    const key = `${symbol}:${tf}`;

    const apply = (bars) => {
      if (cancelled || !seriesRef.current) return;
      
      const currentRange = chartRef.current?.timeScale().getVisibleLogicalRange();
      if (currentRange) logicalRangeRef.current = currentRange;

      seriesRef.current.setData(bars);
      lastBarRef.current = { key, bar: bars[bars.length - 1] };
      barsRef.current = bars;
      setDataVersion((v) => v + 1);
      // a manual price-axis drag turns autoscale off for good — a new series
      // must re-fit both axes or it renders outside the visible range
      chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
      
      if (logicalRangeRef.current) {
        chartRef.current?.timeScale().setVisibleLogicalRange(logicalRangeRef.current);
      } else {
        const visibleBars = 120;
        const to = bars.length - 1 + 12;
        const from = Math.max(0, bars.length - visibleBars);
        chartRef.current?.timeScale().setVisibleLogicalRange({ from, to });
      }

      const est = Math.max(
        ...bars.slice(-50).map((b) => (String(b.close).split(".")[1] || "").length)
      );
      setBarsDigits(Math.min(est, 8));
      setLoading(false);
      setError(null);
    };

    const cached = barsCache.current.get(key);
    if (cached?.bars?.length) apply(cached.bars);
    else {
      // no cache for this series yet — stop ticks from mutating the old one
      lastBarRef.current = null;
      setLoading(true);
    }

    (async () => {
      // wait for the chart to exist (first mount races the dynamic import)
      for (let i = 0; i < 100 && !seriesRef.current; i++) await new Promise((r) => setTimeout(r, 50));
      try {
        let count = 600;
        if (["M1", "M5", "M15"].includes(tf)) count = 1200;
        else if (["H1", "H4", "D1"].includes(tf)) count = 900;
        const res = await fetch(`/api/rates?symbol=${encodeURIComponent(symbol)}&tf=${tf}&count=${count}`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (!data.ok || !data.bars?.length) {
          if (!cached) { setError(data.message || data.error || `No data for ${symbol}`); setLoading(false); }
          return;
        }
        const bars = data.bars.map((b) => ({ time: b.t / 1000, open: b.o, high: b.h, low: b.l, close: b.c }));
        barsCache.current.set(key, { at: Date.now(), bars });
        apply(bars);
      } catch (err) {
        if (!cancelled && !cached) { setError(err.message); setLoading(false); }
      }
    })();

    return () => { cancelled = true; };
  }, [symbol, tf, barsCache]);

  // ---------- axis label resolution ----------
  // The library default (precision 2 / minMove 0.01) can't label a 5-digit FX
  // range at all — labels vanish and the live price label snaps between two
  // coarse values. Match the format to the instrument's digits.
  useEffect(() => {
    seriesRef.current?.applyOptions({
      priceFormat: { type: "price", precision: digits, minMove: Math.pow(10, -digits) },
    });
  }, [digits, loading]);

  // ---------- live tick -> update current candle ----------
  useEffect(() => {
    const entry = lastBarRef.current;
    // only update the candle if the loaded series matches the current symbol/tf
    if (!tick || !seriesRef.current || !entry || entry.key !== `${symbol}:${tf}`) return;
    const price = tick.bid || tick.ask;
    if (!price) return;
    const sec = TF_SEC[tf];
    const barTime = Math.floor((tick.time / 1000) / sec) * sec;
    const last = entry.bar;
    const isNewBar = barTime > last.time;
    const nextBar = isNewBar
      ? { time: barTime, open: price, high: price, low: price, close: price }
      : { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
    lastBarRef.current = { key: entry.key, bar: nextBar };
    seriesRef.current.update(nextBar);
    // keep the detector bar array current; re-detect only on bar close
    if (isNewBar) {
      barsRef.current = [...barsRef.current, nextBar];
      setDataVersion((v) => v + 1);
    } else if (barsRef.current.length) {
      barsRef.current[barsRef.current.length - 1] = nextBar;
    }
    if (draw.pushPrimitive) draw.pushPrimitive();
  }, [tick, symbol, tf, draw]);

  // ---------- pattern indicators ----------
  useEffect(() => {
    const prim = patternsRef.current;
    if (!prim) return;
    const anyOn = indicators && Object.values(indicators).some(Boolean);
    if (!anyOn) {
      prim.setDrawings([]);
      return;
    }
    const { drawings, autoAlerts } = runPatterns(barsRef.current, indicators, TF_SEC[tf]);
    prim.setDrawings(drawings);
    // e.g. AMD distribution trigger — Dashboard dedupes and creates the alert
    if (onAutoAlert) for (const s of autoAlerts) onAutoAlert({ ...s, symbol });
  }, [dataVersion, indicators, tf, symbol, onAutoAlert]);

  // ---------- custom alert lines ----------
  useEffect(() => {
    alertsPrimRef.current?.update(alerts, dragging, barsRef.current);
  }, [alerts, dragging, dataVersion]);

  // ---------- pointer tracking for "+ price" button and drag handle ----------
  // A wrapper mousemove (NOT subscribeCrosshairMove) so the button stays alive
  // while the pointer travels over the price axis — crosshair events stop at
  // the pane edge, which made the button vanish before it could be clicked.
  const onMouseMove = useCallback((ev) => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || !wrapRef.current || dragStateRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const y = ev.clientY - rect.top;
    const x = ev.clientX - rect.left;
    const paneH = chart.paneSize?.().height;
    const price = paneH && y > paneH ? null : series.coordinateToPrice(y);
    if (price == null || !Number.isFinite(price)) {
      setHoverBtn(null); setDragHandle(null);
      hoverPriceRef.current = null;
      return;
    }
    hoverPriceRef.current = price;
    const time = chart.timeScale().coordinateToTime(x);
    setHoverBtn({ y, price, time });

    // proximity test for drag handle (within 7px of an alert line)
    let hit = null;
    for (const a of alertsRef.current) {
      const ay = series.priceToCoordinate(a.price);
      if (ay != null && Math.abs(ay - y) < 7) { hit = { id: a._id, y: ay, price: a.price, status: a.status }; break; }
    }
    setDragHandle(hit);
  }, []);

  // ---------- right-click: add alert / delete nearby alert ----------
  const onContextMenu = useCallback((ev) => {
    ev.preventDefault();
    const series = seriesRef.current;
    if (!series || !wrapRef.current || !hoverPriceRef.current) return;
    const price = hoverPriceRef.current;
    const rect = wrapRef.current.getBoundingClientRect();
    
    // find alerts near this price (within 10 pixels of y-space)
    const y = series.priceToCoordinate(price);
    const nearAlerts = alerts.filter((a) => {
      const ay = series.priceToCoordinate(a.price);
      return ay != null && Math.abs(ay - y) < 10;
    });

    setCtxMenu({
      x: Math.min(ev.clientX - rect.left, rect.width - 240),
      y: Math.min(y, rect.height - 40 - nearAlerts.length * 36),
      price,
      nearAlerts,
    });
  }, [alerts]);

  // ---------- maintain crosshair while hovering the add button ----------
  useEffect(() => {
    if (isHoveringBtn && hoverBtn && chartRef.current && seriesRef.current && hoverBtn.time) {
      chartRef.current.setCrosshairPosition(hoverBtn.price, hoverBtn.time, seriesRef.current);
    } else {
      chartRef.current?.clearCrosshairPosition();
    }
  }, [isHoveringBtn, hoverBtn]);

  useEffect(() => {
    const close = () => setCtxMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  // ---------- drag-to-move an alert price line ----------
  const beginDrag = useCallback((e, id) => {
    e.preventDefault();
    e.stopPropagation();
    const series = seriesRef.current;
    const wrap = wrapRef.current;
    if (!series || !wrap) return;
    const rect = wrap.getBoundingClientRect();

    const onMove = (ev) => {
      const y = ev.clientY - rect.top;
      const price = series.coordinateToPrice(y);
      if (price == null || !Number.isFinite(price) || price <= 0) return;
      dragStateRef.current = { id, price };
      setDragging({ id, price });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      const final = dragStateRef.current;
      dragStateRef.current = null;
      setDragging(null);
      setDragHandle(null);
      if (final && onMoveAlert) onMoveAlert(final.id, final.price);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";
  }, [onMoveAlert]);

  const programmaticRangeRef = useRef(null);

  // ---------- Sync Logical Range ----------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !syncOpts?.time) return;
    const timeScale = chart.timeScale();
    const handler = (range) => {
      const prog = programmaticRangeRef.current;
      if (prog && range && Math.abs(range.from - prog.from) < 0.05 && Math.abs(range.to - prog.to) < 0.05) {
        return; // Ignore programmatic echo
      }
      programmaticRangeRef.current = null; // Clear if user initiated
      if (range && setSyncedLogicalRange) {
        setSyncedLogicalRange({ range, sourceId: paneId });
      }
    };
    timeScale.subscribeVisibleLogicalRangeChange(handler);
    return () => timeScale.unsubscribeVisibleLogicalRangeChange(handler);
  }, [syncOpts?.time, paneId, setSyncedLogicalRange]);

  useEffect(() => {
    if (!chartRef.current || !syncOpts?.time || !syncedLogicalRange) return;
    if (syncedLogicalRange.sourceId !== paneId) {
      programmaticRangeRef.current = syncedLogicalRange.range;
      chartRef.current.timeScale().setVisibleLogicalRange(syncedLogicalRange.range);
    }
  }, [syncedLogicalRange, syncOpts?.time, paneId]);

  const programmaticCrosshairRef = useRef(null);

  // ---------- Sync Crosshair ----------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !syncOpts?.crosshair) return;
    const handler = (param) => {
      const prog = programmaticCrosshairRef.current;
      if (prog && prog.time === param.time) {
        return; // Ignore echo
      }
      programmaticCrosshairRef.current = null;
      if (!param.point) {
        if (setSyncedCrosshair) setSyncedCrosshair({ sourceId: paneId, clear: true });
        return;
      }
      if (setSyncedCrosshair) {
        const price = seriesRef.current ? seriesRef.current.coordinateToPrice(param.point.y) : null;
        setSyncedCrosshair({
          sourceId: paneId,
          time: param.time,
          price: price,
        });
      }
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, [syncOpts?.crosshair, paneId, setSyncedCrosshair]);

  useEffect(() => {
    if (!chartRef.current || !syncOpts?.crosshair || !syncedCrosshair || !seriesRef.current) return;
    if (syncedCrosshair.sourceId !== paneId) {
      if (syncedCrosshair.clear) {
        programmaticCrosshairRef.current = { clear: true };
        chartRef.current.clearCrosshairPosition();
      } else if (syncedCrosshair.time) {
        try {
          programmaticCrosshairRef.current = { time: syncedCrosshair.time };
          chartRef.current.setCrosshairPosition(syncedCrosshair.price || 0, syncedCrosshair.time, seriesRef.current);
        } catch (e) {
        }
      }
    }
  }, [syncedCrosshair, syncOpts?.crosshair, paneId]);

  // Merge drawing + alert pointer handlers. Drawing handlers stopPropagation
  // only when they actually grab a drawing/handle, so alert logic still runs
  // when the pointer is on empty chart area.
  const ph = draw.pointerHandlers;
  const mergedContext = (ev) => {
    ph.onContextMenu(ev);
    if (ev.defaultPrevented) return; // drawing consumed it
    onContextMenu(ev);
  };

  return (
    <div
      style={{ flex: 1, position: "relative", minWidth: 0,
        cursor: draw.cursorFor(draw.activeTool, draw.hover) || (dragHandle ? "ns-resize" : "default") }}
      onPointerDown={ph.onPointerDown}
      onPointerMove={(ev) => { ph.onPointerMove(ev); }}
      onPointerUp={ph.onPointerUp}
      onContextMenu={mergedContext}
      onMouseMove={onMouseMove}
      onMouseLeave={() => { setHoverBtn(null); setDragHandle(null); }}
    >
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }} />

      {isActive && !loading && !error && (
        <DrawingToolbar api={draw} />
      )}
      {isActive && !loading && !error && (
        <DrawingContextMenu api={draw} />
      )}
      {isActive && !loading && !error && (
        <DrawingSettings api={draw} />
      )}

      {loading && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--bg)", zIndex: 10 }}>
          <Loader2 size={36} className="spin" style={{ color: "var(--accent)", marginBottom: 12 }} />
          <div className="muted" style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>Loading {symbol} {tf}</div>
        </div>
      )}

      {error && !loading && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 15 }}>⚠ {error}</div>
          <div className="muted">Check the symbol exists in the MT5 Market Watch and the bridge is reachable.</div>
        </div>
      )}

      {hoverBtn && !loading && !dragHandle && (
        <button
          className="primary"
          onMouseEnter={() => setIsHoveringBtn(true)}
          onMouseLeave={() => setIsHoveringBtn(false)}
          style={{
            position: "absolute", right: 65, top: hoverBtn.y, transform: "translateY(-50%)",
            zIndex: 20, borderRadius: "6px", padding: "4px 8px", fontSize: 13,
            fontWeight: 700, lineHeight: 1,
          }}
          onClick={() => onAddAlert(hoverBtn.price)}
          title="Add alert at this price"
        >
          ＋
        </button>
      )}

      {/* alert badge on the price axis when pointer is near an alert line */}
      {dragHandle && !loading && !dragging && (
        <div
          style={{
            position: "absolute", right: 0, top: dragHandle.y, transform: "translateY(-50%)",
            zIndex: 25, display: "flex", alignItems: "center",
            background: dragHandle.status === "triggered" ? "rgba(239, 83, 80, 0.9)" : "var(--orange)", 
            color: "#1a1206", fontWeight: 700,
            borderRadius: "6px 0 0 6px",
            boxShadow: "0 2px 8px rgba(0,0,0,.4)", overflow: "hidden",
          }}
        >
          {dragHandle.status === "active" && (
            <div
              onPointerDown={(e) => beginDrag(e, dragHandle.id)}
              style={{ cursor: "ns-resize", padding: "4px 6px" }}
              title="Drag up/down to move this alert"
            >
              ⇅
            </div>
          )}
          <div style={{ padding: "4px 6px", fontSize: 12, whiteSpace: "nowrap" }}>
            {fmt(dragHandle.price)}
          </div>
          {dragHandle.status === "triggered" && (
            <button
              onClick={() => onRearmAlert(dragHandle.id)}
              style={{ background: "rgba(0,0,0,0.1)", border: "none", color: "inherit", padding: "4px 8px", cursor: "pointer", fontSize: 13 }}
              title="Renew (re-arm) alert"
            >
              ↻
            </button>
          )}
          <button
            onClick={() => onDeleteAlert(dragHandle.id)}
            style={{ background: "rgba(0,0,0,0.15)", border: "none", color: "inherit", padding: "4px 8px", cursor: "pointer", fontSize: 12 }}
            title="Delete alert"
          >
            ✕
          </button>
        </div>
      )}

      {/* live price badge while actively dragging */}
      {dragging && (
        <div
          style={{
            position: "absolute", right: 0, top: seriesRef.current?.priceToCoordinate(dragging.price) ?? 0,
            transform: "translateY(-50%)", zIndex: 26, padding: "4px 10px", fontSize: 13,
            background: "var(--orange)", color: "#1a1206", fontWeight: 700,
            borderRadius: "6px 0 0 6px", fontFamily: "var(--mono)",
            boxShadow: "0 4px 14px rgba(255,152,0,.5)",
          }}
        >
          ⇅ {fmt(dragging.price)}
        </div>
      )}

      {ctxMenu && (
        <div style={{
          position: "absolute", left: ctxMenu.x, top: ctxMenu.y, zIndex: 30, minWidth: 220,
          background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8,
          boxShadow: "0 8px 28px rgba(0,0,0,.6)", overflow: "hidden",
        }}>
          <MenuItem onClick={() => { onOpenSettings && onOpenSettings(); setCtxMenu(null); }}>
            ⚙️ Settings
          </MenuItem>
          <MenuItem onClick={() => { onAddAlert(ctxMenu.price); setCtxMenu(null); }}>
            🔔 Add alert at <b className="num">{fmt(ctxMenu.price)}</b>
          </MenuItem>
          {ctxMenu.nearAlerts.map((a) => (
            <div key={a._id}>
              <MenuItem danger onClick={() => { onDeleteAlert(a._id); setCtxMenu(null); }}>
                🗑 Delete alert {a.condition} <b className="num">{fmt(a.price)}</b>
              </MenuItem>
              {a.status === "triggered" && (
                <MenuItem onClick={() => { onRearmAlert(a._id); setCtxMenu(null); }}>
                  ↻ Renew alert {a.condition} <b className="num">{fmt(a.price)}</b>
                </MenuItem>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, danger }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "10px 14px", cursor: "pointer", fontSize: 13,
        background: hover ? (danger ? "rgba(239,83,80,.15)" : "var(--accent-soft)") : "transparent",
        color: danger && hover ? "var(--red)" : "var(--text)",
      }}
    >
      {children}
    </div>
  );
}
