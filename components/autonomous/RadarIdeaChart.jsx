"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { RotateCcw, AlertCircle, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import {
  buildRadarTradeIdeaDrawing,
  resolveRadarTradeIdeaPricing,
} from "../../lib/autonomous/tradeDrawing";
import { formatPrice, markPriceFor } from "./TradeTelemetry";
import { normalizeCandles } from "../../lib/candleNormalization";

const TF_OPTIONS = [
  { id: "5m", label: "5M", apiTf: "M5", sec: 300 },
  { id: "15m", label: "15M", apiTf: "M15", sec: 900 },
  { id: "1h", label: "1H", apiTf: "H1", sec: 3600 },
  { id: "4h", label: "4H", apiTf: "H4", sec: 14400 },
];

export default function RadarIdeaChart({
  pair,
  ticks = {},
  defaultTf,
  height = 320,
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const drawingManagerRef = useRef(null);
  const barsRef = useRef([]);
  const ratesCacheRef = useRef({});
  const initialRangeFramedRef = useRef({});
  const pairRef = useRef(pair);
  pairRef.current = pair;

  const initialTf =
    defaultTf ||
    (pair?.horizon === "swing" || pair?.scenario?.id === "swing"
      ? "1h"
      : pair?.horizon === "scalp" || pair?.scenario?.id === "scalp"
      ? "5m"
      : "15m");

  const [selectedTf, setSelectedTf] = useState(initialTf);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chartReady, setChartReady] = useState(false);

  const symbol = pair?.tradeableSymbol || pair?.symbol;

  // Exact structural pricing from single source of truth
  const pricing = useMemo(() => resolveRadarTradeIdeaPricing(pair), [pair]);
  const { isLong, dir, entry: entryVal, sl: slVal, tp: tpVal, rr: rrVal, hasSetup } = pricing;
  const currentMark = markPriceFor(pair, ticks);

  // Redraw RR drawing onto existing chart without reloading candles or resetting zoom
  const updateRadarDrawing = useCallback(
    (bars = barsRef.current) => {
      if (!drawingManagerRef.current) return;
      const currentPair = pairRef.current;
      if (!currentPair) return;
      const activeTf = TF_OPTIONS.find((t) => t.id === selectedTf) || TF_OPTIONS[1];
      const tfSec = activeTf.sec || 900;
      const radarDrawing = buildRadarTradeIdeaDrawing(currentPair, bars || [], tfSec, 0);
      if (radarDrawing) {
        radarDrawing.locked = true;
      }
      drawingManagerRef.current.list = radarDrawing ? [radarDrawing] : [];
      drawingManagerRef.current.redraw();
    },
    [selectedTf]
  );

  // 1. Chart Instance Lifecycle: Create chart once on mount
  useEffect(() => {
    let isCancelled = false;
    let resizeObserver = null;

    async function initChart() {
      if (!containerRef.current || !symbol) return;

      try {
        const { createChart, CrosshairMode, CandlestickSeries } = await import("lightweight-charts");
        const { DrawingManager } = await import("lightweight-charts-drawing");

        if (isCancelled || !containerRef.current) return;

        // Clean previous chart instance if present
        if (chartRef.current) {
          try {
            chartRef.current.remove();
          } catch {}
          chartRef.current = null;
        }

        const isLight = document.documentElement.getAttribute("data-theme") === "light";
        const isCreamy = document.documentElement.getAttribute("data-theme") === "creamy";

        const bgCol = isCreamy ? "#f4eee0" : isLight ? "#ffffff" : "#10141d";
        const textCol = isCreamy ? "#2c2825" : isLight ? "#191919" : "#e1e8f5";
        const borderCol = isCreamy ? "#ded4c2" : isLight ? "#e0e3eb" : "#1e293b";
        const gridCol = isCreamy
          ? "rgba(44, 40, 37, 0.04)"
          : isLight
          ? "rgba(0, 0, 0, 0.04)"
          : "rgba(255, 255, 255, 0.04)";

        const chart = createChart(containerRef.current, {
          width: containerRef.current.clientWidth || 600,
          height: height || 320,
          layout: {
            background: { type: "solid", color: bgCol },
            textColor: textCol,
            fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
            fontSize: 10,
          },
          grid: {
            vertLines: { color: gridCol },
            horzLines: { color: gridCol },
          },
          crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: { color: "rgba(168, 85, 247, 0.4)", width: 1, style: 3 },
            horzLine: { color: "rgba(168, 85, 247, 0.4)", width: 1, style: 3 },
          },
          timeScale: {
            borderColor: borderCol,
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 16,
            barSpacing: 9,
            minBarSpacing: 3,
            fixLeftEdge: false,
            fixRightEdge: false,
          },
          rightPriceScale: {
            borderColor: borderCol,
            autoScale: true,
            scaleMargins: { top: 0.15, bottom: 0.15 },
            entireTextOnly: true,
          },
          handleScale: {
            axisPressedMouseMove: true,
            mouseWheel: true,
            pinch: true,
            axisDoubleClickReset: true,
          },
          handleScroll: {
            mouseWheel: true,
            pressedMouseMove: true,
            horzTouchDrag: true,
            vertTouchDrag: true,
          },
          kineticScroll: {
            touch: true,
            mouse: true,
          },
        });

        chartRef.current = chart;

        const series =
          typeof chart.addSeries === "function" && CandlestickSeries
            ? chart.addSeries(CandlestickSeries, {
                upColor: "#22c55e",
                downColor: "#ef4444",
                borderVisible: false,
                wickUpColor: "#22c55e",
                wickDownColor: "#ef4444",
              })
            : chart.addCandlestickSeries({
                upColor: "#22c55e",
                downColor: "#ef4444",
                borderVisible: false,
                wickUpColor: "#22c55e",
                wickDownColor: "#ef4444",
              });

        seriesRef.current = series;

        // Native TradingView drawing manager from lightweight-charts-drawing
        const drawingManager = new DrawingManager(chart, series, {
          magnet: "off",
          stayInDrawingMode: false,
          bars: () => barsRef.current || [],
          onListChange: () => {},
        });

        // Strictly prevent selection, dragging, or editing of the RR tool
        drawingManager.on("selection", (ids) => {
          if (ids && ids.length > 0) {
            drawingManager.select([]);
          }
        });

        drawingManagerRef.current = drawingManager;

        setChartReady(true);

        // Fluid responsive resizing without layout thrashing
        resizeObserver = new ResizeObserver((entries) => {
          if (!entries || !entries[0] || !chartRef.current) return;
          const { width } = entries[0].contentRect;
          if (width > 0) {
            chartRef.current.applyOptions({ width });
          }
        });
        resizeObserver.observe(containerRef.current);
      } catch (err) {
        if (!isCancelled) {
          console.error("RadarIdeaChart initialization error:", err);
          setError(err.message);
          setLoading(false);
        }
      }
    }

    initChart();

    return () => {
      isCancelled = true;
      setChartReady(false);
      if (resizeObserver) resizeObserver.disconnect();
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch {}
        chartRef.current = null;
      }
      drawingManagerRef.current = null;
      seriesRef.current = null;
    };
  }, [symbol, height]);

  // 2. Fetch and apply candle data strictly upon TF or symbol change
  // DECOUPLED FROM pair: updates to pair will NEVER re-fetch candles or reset user zoom/pan!
  useEffect(() => {
    if (!chartReady || !symbol) return;
    let isCancelled = false;

    async function loadCandles() {
      const activeTf = TF_OPTIONS.find((t) => t.id === selectedTf) || TF_OPTIONS[1];
      const tfParam = activeTf.apiTf || "M15";
      const cacheKey = `${symbol}:${tfParam}`;
      const isAlreadyFramed = !!initialRangeFramedRef.current[cacheKey];

      // Instant cache hit: render immediately with zero network delay or flicker
      const cachedBars = ratesCacheRef.current[cacheKey];
      if (cachedBars && cachedBars.length > 0) {
        barsRef.current = cachedBars;
        if (seriesRef.current) {
          seriesRef.current.setData(cachedBars);
          if (!isAlreadyFramed && chartRef.current) {
            const total = cachedBars.length;
            chartRef.current.timeScale().setVisibleLogicalRange({
              from: Math.max(0, total - 55),
              to: total + 14,
            });
            initialRangeFramedRef.current[cacheKey] = true;
          }
        }
        updateRadarDrawing(cachedBars);
        setLoading(false);
      } else {
        setLoading(true);
      }

      setError(null);

      try {
        const res = await fetch(
          `/api/rates?symbol=${encodeURIComponent(symbol)}&tf=${tfParam}&count=200`,
          { cache: "no-store" }
        );
        const data = await res.json();

        if (isCancelled) return;

        if (!data.ok || !Array.isArray(data.bars) || data.bars.length === 0) {
          if (!ratesCacheRef.current[cacheKey]) {
            setError(data.message || `No candle data returned for ${symbol}`);
          }
          setLoading(false);
          return;
        }

        let bars = data.bars.map((b) => ({
          time: Math.round(b.t / 1000),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
        }));
        bars = bars.filter((b) => b.close > 0 && b.high > 0 && b.low > 0);
        bars = normalizeCandles(bars, tfParam);

        ratesCacheRef.current[cacheKey] = bars;
        barsRef.current = bars;

        if (seriesRef.current) {
          seriesRef.current.setData(bars);
          // Only frame logical range on first initial load for this symbol & timeframe!
          // Strictly preserves user's manual zoom and pan on all subsequent calls!
          if (!initialRangeFramedRef.current[cacheKey] && chartRef.current) {
            const total = bars.length;
            chartRef.current.timeScale().setVisibleLogicalRange({
              from: Math.max(0, total - 55),
              to: total + 14,
            });
            initialRangeFramedRef.current[cacheKey] = true;
          }
          updateRadarDrawing(bars);
        }
      } catch (err) {
        if (!isCancelled && !ratesCacheRef.current[cacheKey]) {
          console.error("RadarIdeaChart rates fetch error:", err);
          setError(err.message);
        }
      } finally {
        if (!isCancelled) setLoading(false);
      }
    }

    loadCandles();

    return () => {
      isCancelled = true;
    };
  }, [chartReady, symbol, selectedTf, updateRadarDrawing]);

  // 3. Separate Effect: Update drawing overlays when pair evolves without touching candles or zoom
  useEffect(() => {
    if (!chartReady || !drawingManagerRef.current || !barsRef.current.length) return;
    updateRadarDrawing(barsRef.current);
  }, [chartReady, pair, selectedTf, updateRadarDrawing]);

  // 4. Live Tick Streaming: Animate the live candle wick/close in real-time without re-render or lag
  useEffect(() => {
    if (!seriesRef.current || !barsRef.current || barsRef.current.length === 0) return;
    const tickPrice = currentMark;
    if (!tickPrice) return;

    const lastIdx = barsRef.current.length - 1;
    const lastBar = barsRef.current[lastIdx];
    if (!lastBar) return;

    const updatedBar = {
      ...lastBar,
      close: tickPrice,
      high: Math.max(lastBar.high, tickPrice),
      low: Math.min(lastBar.low, tickPrice),
    };
    barsRef.current[lastIdx] = updatedBar;
    try {
      seriesRef.current.update(updatedBar);
    } catch {}
  }, [currentMark]);

  // Zoom In Handler
  const handleZoomIn = useCallback(() => {
    if (!chartRef.current) return;
    const timeScale = chartRef.current.timeScale();
    const range = timeScale.getVisibleLogicalRange();
    if (!range) return;
    const length = range.to - range.from;
    const newLength = Math.max(8, length * 0.7);
    const center = (range.from + range.to) / 2;
    timeScale.setVisibleLogicalRange({
      from: center - newLength / 2,
      to: center + newLength / 2,
    });
  }, []);

  // Zoom Out Handler
  const handleZoomOut = useCallback(() => {
    if (!chartRef.current) return;
    const timeScale = chartRef.current.timeScale();
    const range = timeScale.getVisibleLogicalRange();
    if (!range) return;
    const length = range.to - range.from;
    const newLength = length * 1.4;
    const center = (range.from + range.to) / 2;
    timeScale.setVisibleLogicalRange({
      from: center - newLength / 2,
      to: center + newLength / 2,
    });
  }, []);

  // Fit View: Frames the recent 55 bars + 14 bars future runway
  const handleFit = useCallback(() => {
    if (!chartRef.current || !barsRef.current.length) return;
    const total = barsRef.current.length;
    chartRef.current.timeScale().setVisibleLogicalRange({
      from: Math.max(0, total - 55),
      to: total + 14,
    });
    chartRef.current.priceScale("right").applyOptions({ autoScale: true });
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--panel)",
        borderRadius: 8,
        border: "1px solid var(--border)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Chart Control Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 6,
          padding: "6px 10px",
          background: "var(--panel-2)",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
        }}
      >
        {/* Left: Timeframe pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 10, color: "var(--muted)", marginRight: 4, fontWeight: 700 }}>
            TF:
          </span>
          {TF_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setSelectedTf(opt.id)}
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 4,
                border: "1px solid",
                borderColor: selectedTf === opt.id ? "var(--purple, #a855f7)" : "var(--border)",
                background: selectedTf === opt.id ? "rgba(168, 85, 247, 0.2)" : "transparent",
                color: selectedTf === opt.id ? "var(--purple, #c084fc)" : "var(--muted)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Center: Setup Price Geometry Telemetry */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "monospace",
            fontSize: 10,
            flexWrap: "wrap",
          }}
        >
          {/* Direction Pill */}
          <span
            style={{
              padding: "1px 5px",
              borderRadius: 3,
              fontWeight: 800,
              background:
                dir === 1
                  ? "rgba(34, 197, 94, 0.15)"
                  : dir === -1
                  ? "rgba(239, 68, 68, 0.15)"
                  : "var(--panel)",
              color: dir === 1 ? "var(--green)" : dir === -1 ? "var(--red)" : "var(--muted)",
            }}
          >
            {isLong ? "BUY ▲" : dir === -1 ? "SELL ▼" : "NEUTRAL ⬌"}
          </span>

          {/* Current Live Mark */}
          {currentMark !== null && (
            <span>
              <span style={{ color: "var(--muted)" }}>Mark: </span>
              <strong style={{ color: "var(--fg)" }}>{formatPrice(currentMark)}</strong>
            </span>
          )}

          {/* Structural Setup Levels */}
          {hasSetup ? (
            <>
              {entryVal !== null && (
                <span>
                  <span style={{ color: "var(--muted)" }}>Entry: </span>
                  <strong style={{ color: "var(--accent)" }}>{formatPrice(entryVal)}</strong>
                </span>
              )}

              {slVal !== null && (
                <span>
                  <span style={{ color: "var(--muted)" }}>SL: </span>
                  <strong style={{ color: "#ea580c" }}>{formatPrice(slVal)}</strong>
                </span>
              )}

              {tpVal !== null && (
                <span>
                  <span style={{ color: "var(--muted)" }}>TP: </span>
                  <strong style={{ color: "#a855f7" }}>{formatPrice(tpVal)}</strong>
                </span>
              )}

              {rrVal !== null && (
                <span
                  style={{
                    padding: "1px 6px",
                    borderRadius: 4,
                    fontWeight: 800,
                    background: "rgba(168, 85, 247, 0.2)",
                    color: "var(--purple, #c084fc)",
                    border: "1px solid rgba(168, 85, 247, 0.35)",
                  }}
                >
                  {rrVal.toFixed(1)}R
                </span>
              )}
            </>
          ) : (
            <span style={{ color: "var(--muted)", fontStyle: "italic", fontSize: 9.5 }}>
              Awaiting Retracement Level ({pair?.status?.replace(/_/g, " ") || "SCANNING"})
            </span>
          )}
        </div>

        {/* Right: Zoom In, Zoom Out, and Fit Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            onClick={handleZoomIn}
            title="Zoom In (+)"
            aria-label="Zoom in"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "3px 6px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
            }}
          >
            <ZoomIn size={12} />
          </button>

          <button
            onClick={handleZoomOut}
            title="Zoom Out (-)"
            aria-label="Zoom out"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "3px 6px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
            }}
          >
            <ZoomOut size={12} />
          </button>

          <button
            onClick={handleFit}
            title="Reset View & Center Setup"
            aria-label="Reset view"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 7px",
              fontSize: 10,
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
            }}
          >
            <RotateCcw size={10} />
            <span>Fit</span>
          </button>
        </div>
      </div>

      {/* Chart Canvas Area with touchAction: 'none' for smooth mobile swipe & gestures */}
      <div style={{ position: "relative", width: "100%", height }}>
        <div
          ref={containerRef}
          style={{
            width: "100%",
            height: "100%",
            touchAction: "none",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        />

        {/* Loading Overlay */}
        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
              backdropFilter: "blur(2px)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              zIndex: 10,
              color: "var(--purple, #c084fc)",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            <Loader2 size={20} className="animate-spin" />
            <span>Rendering institutional trade idea candles...</span>
          </div>
        )}

        {/* Error Overlay */}
        {error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.6)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              zIndex: 11,
              color: "var(--red)",
              fontSize: 11,
              padding: 16,
              textAlign: "center",
            }}
          >
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Footer Legend Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 10px",
          background: "var(--panel-2)",
          borderTop: "1px solid var(--border)",
          fontSize: 9.5,
          color: "var(--muted)",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "#a855f7" }} />
            Target (Violet)
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "#ea580c" }} />
            Stop Loss (Burnt Orange)
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 2, background: "#c084fc" }} />
            Planned Entry
          </span>
        </div>
        <span>Pinch or scroll to zoom · Drag to pan · Drag price axis to scale</span>
      </div>
    </div>
  );
}
