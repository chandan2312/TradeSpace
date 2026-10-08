"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { RotateCcw, AlertCircle, Loader2, ZoomIn, ZoomOut, Target, Shield } from "lucide-react";
import { tradeToStagedPositionDrawings } from "../../lib/autonomous/tradeDrawing";
import { formatPrice, markPriceFor } from "./TradeTelemetry";
import { normalizeCandles } from "../../lib/candleNormalization";

const TF_OPTIONS = [
  { id: "5m", label: "5M", apiTf: "M5", sec: 300 },
  { id: "15m", label: "15M", apiTf: "M15", sec: 900 },
  { id: "1h", label: "1H", apiTf: "H1", sec: 3600 },
  { id: "4h", label: "4H", apiTf: "H4", sec: 14400 },
];

export default function StagedIdeaChart({
  trade,
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
  const tradeRef = useRef(trade);
  tradeRef.current = trade;

  const initialTf =
    defaultTf ||
    (trade?.horizon === "swing" || trade?.scenario?.id === "swing"
      ? "1h"
      : trade?.horizon === "scalp" || trade?.scenario?.id === "scalp"
      ? "5m"
      : "15m");

  const [selectedTf, setSelectedTf] = useState(initialTf);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chartReady, setChartReady] = useState(false);

  const symbol = trade?.tradeableSymbol || trade?.symbol;
  const dir = trade?.dir === -1 || String(trade?.direction || trade?.dirLabel).toLowerCase() === "sell" ? -1 : 1;
  const isShort = dir === -1;

  const level = trade?.levelDetails || trade?.stagedLevel || {};
  const entryVal = Number(trade?.entryPrice ?? level.entry ?? 0);
  const slVal = Number(trade?.initialSlPrice ?? trade?.slPrice ?? level.sl ?? 0);
  const fullTpVal = Number(trade?.fullTp ?? trade?.defaultLeg?.tpPrice ?? level.fullTp ?? trade?.tpPrice ?? 0);
  const propTpVal = Number(trade?.propTp ?? trade?.propLeg?.tpPrice ?? trade?.propTarget?.tpPrice ?? 0);
  const halfPriceVal = Number(trade?.halfPrice ?? trade?.halfTarget?.price ?? 0);

  const currentMark = markPriceFor(trade, ticks);

  // Redraw Staged RR drawings onto existing chart without reloading candles or resetting zoom
  const updateStagedDrawing = useCallback(
    (bars = barsRef.current) => {
      if (!drawingManagerRef.current) return;
      const currentTrade = tradeRef.current;
      if (!currentTrade) return;
      const activeTf = TF_OPTIONS.find((t) => t.id === selectedTf) || TF_OPTIONS[1];
      const tfSec = activeTf.sec || 900;
      const stagedDrawings = tradeToStagedPositionDrawings(currentTrade, bars || [], tfSec, 0);
      drawingManagerRef.current.list = stagedDrawings || [];
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
            vertLine: { color: "rgba(245, 158, 11, 0.4)", width: 1, style: 3 },
            horzLine: { color: "rgba(245, 158, 11, 0.4)", width: 1, style: 3 },
          },
          timeScale: {
            borderColor: borderCol,
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 18,
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
          typeof chart.addCandlestickSeries === "function"
            ? chart.addCandlestickSeries({
                upColor: "#26a69a",
                downColor: "#ef5350",
                borderUpColor: "#26a69a",
                borderDownColor: "#ef5350",
                wickUpColor: "#26a69a",
                wickDownColor: "#ef5350",
              })
            : chart.addSeries(CandlestickSeries, {
                upColor: "#26a69a",
                downColor: "#ef5350",
                borderUpColor: "#26a69a",
                borderDownColor: "#ef5350",
                wickUpColor: "#26a69a",
                wickDownColor: "#ef5350",
              });
        seriesRef.current = series;

        // DrawingManager integration for Staged RR Tool
        const drawingManager = new DrawingManager(chart, series, {
          magnet: "off",
          stayInDrawingMode: false,
          bars: () => barsRef.current || [],
          onListChange: () => {},
        });
        drawingManagerRef.current = drawingManager;

        // ResizeObserver for dynamic container dimensions
        resizeObserver = new ResizeObserver((entries) => {
          if (!entries || !entries.length || !chartRef.current) return;
          const entry = entries[0];
          const newWidth = entry.contentRect.width;
          if (newWidth > 0) {
            chartRef.current.applyOptions({ width: newWidth });
          }
        });
        resizeObserver.observe(containerRef.current);

        setChartReady(true);
      } catch (err) {
        console.error("StagedIdeaChart initialization error:", err);
        setError("Failed to initialize candlestick engine");
        setLoading(false);
      }
    }

    initChart();

    return () => {
      isCancelled = true;
      if (resizeObserver) resizeObserver.disconnect();
      if (drawingManagerRef.current) {
        try {
          drawingManagerRef.current.destroy?.();
        } catch {}
        drawingManagerRef.current = null;
      }
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch {}
        chartRef.current = null;
      }
      seriesRef.current = null;
      setChartReady(false);
    };
  }, [symbol, height]);

  // 2. Data Fetching Lifecycle: Strictly decoupled from trade updates
  // Changing trade or polling status will NEVER re-fetch rates or reset user zoom/pan!
  useEffect(() => {
    let isCancelled = false;

    async function loadRates() {
      if (!chartReady || !seriesRef.current || !symbol) return;

      const activeTf = TF_OPTIONS.find((t) => t.id === selectedTf) || TF_OPTIONS[1];
      const tfParam = activeTf.apiTf || "M15";
      const cacheKey = `${symbol}:${tfParam}`;
      const isAlreadyFramed = !!initialRangeFramedRef.current[cacheKey];

      // Instant cache retrieval for immediate display
      const cached = ratesCacheRef.current[cacheKey];
      if (cached && cached.length > 0) {
        barsRef.current = cached;
        seriesRef.current.setData(cached);
        if (!isAlreadyFramed && chartRef.current) {
          const totalBars = cached.length;
          chartRef.current.timeScale().setVisibleLogicalRange({
            from: Math.max(0, totalBars - 60),
            to: totalBars + 22,
          });
          initialRangeFramedRef.current[cacheKey] = true;
        }
        updateStagedDrawing(cached);
        setLoading(false);
        setError(null);
      } else {
        setLoading(true);
      }

      try {
        const res = await fetch(
          `/api/rates?symbol=${encodeURIComponent(symbol)}&tf=${tfParam}&count=220`,
          { cache: "no-store" }
        );
        const data = await res.json();

        if (isCancelled) return;

        if (!data.ok || !Array.isArray(data.bars) || data.bars.length === 0) {
          if (!cached || cached.length === 0) {
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

        barsRef.current = bars;
        ratesCacheRef.current[cacheKey] = bars;

        if (seriesRef.current) {
          seriesRef.current.setData(bars);
        }

        updateStagedDrawing(bars);

        // Autofit visible logical range strictly once per timeframe to preserve user manual zoom
        if (!initialRangeFramedRef.current[cacheKey] && chartRef.current) {
          const totalBars = bars.length;
          chartRef.current.timeScale().setVisibleLogicalRange({
            from: Math.max(0, totalBars - 60),
            to: totalBars + 22,
          });
          initialRangeFramedRef.current[cacheKey] = true;
        }

        setError(null);
      } catch (err) {
        console.error("StagedIdeaChart rates fetch error:", err);
        if (!cached || cached.length === 0) {
          setError("Failed to load historical candles");
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadRates();

    return () => {
      isCancelled = true;
    };
  }, [chartReady, symbol, selectedTf, updateStagedDrawing]);

  // 3. Separate Effect: Update staged drawing overlay when trade details change without reloading candles
  useEffect(() => {
    if (!chartReady || !drawingManagerRef.current || !barsRef.current.length) return;
    updateStagedDrawing(barsRef.current);
  }, [chartReady, trade, selectedTf, updateStagedDrawing]);

  // 4. Live Tick Streaming: Animate the live candle in real-time
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

  // Reset Zoom & Center Setup
  const handleResetZoom = useCallback(() => {
    if (!chartRef.current || !barsRef.current.length) return;
    const totalBars = barsRef.current.length;
    const from = Math.max(0, totalBars - 60);
    const to = totalBars + 22;
    chartRef.current.timeScale().setVisibleLogicalRange({ from, to });
    chartRef.current.priceScale("right").applyOptions({ autoScale: true });
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* 1. Chart Toolbar Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: "var(--panel-2)",
          borderBottom: "1px solid var(--border)",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        {/* Left: Symbol, Direction, Staged badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 13, color: "var(--fg)" }}>{symbol}</strong>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              padding: "2px 6px",
              borderRadius: 4,
              background: isShort ? "rgba(239, 68, 68, 0.18)" : "rgba(34, 197, 94, 0.18)",
              color: isShort ? "var(--red)" : "var(--green)",
            }}
          >
            {isShort ? "SELL SETUP ▼" : "BUY SETUP ▲"}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(245, 158, 11, 0.15)",
              color: "var(--orange, #f59e0b)",
              border: "1px solid rgba(245, 158, 11, 0.35)",
            }}
          >
            STAGED RR BOX
          </span>
        </div>

        {/* Center: Key Levels Quick Summary */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 10,
            fontFamily: "monospace",
            flexWrap: "wrap",
          }}
        >
          {entryVal > 0 && (
            <span>
              Entry: <strong style={{ color: "var(--accent)" }}>{formatPrice(entryVal)}</strong>
            </span>
          )}
          {slVal > 0 && (
            <span>
              SL: <strong style={{ color: "var(--red)" }}>{formatPrice(slVal)}</strong>
            </span>
          )}
          {halfPriceVal > 0 && (
            <span style={{ color: "#f59e0b" }}>
              50%: <strong>{formatPrice(halfPriceVal)}</strong>
            </span>
          )}
          {propTpVal > 0 && (
            <span style={{ color: "#06b6d4" }}>
              Prop: <strong>{formatPrice(propTpVal)}</strong>
            </span>
          )}
          {fullTpVal > 0 && (
            <span style={{ color: "var(--green)" }}>
              Full: <strong>{formatPrice(fullTpVal)}</strong>
            </span>
          )}
        </div>

        {/* Right: Timeframe Switcher & Zoom Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {TF_OPTIONS.map((tf) => (
            <button
              key={tf.id}
              onClick={() => setSelectedTf(tf.id)}
              style={{
                padding: "3px 7px",
                fontSize: 10,
                fontWeight: selectedTf === tf.id ? 700 : 500,
                borderRadius: 4,
                border: "1px solid",
                borderColor: selectedTf === tf.id ? "var(--accent)" : "var(--border)",
                background: selectedTf === tf.id ? "var(--accent-soft)" : "transparent",
                color: selectedTf === tf.id ? "var(--accent)" : "var(--muted)",
                cursor: "pointer",
              }}
            >
              {tf.label}
            </button>
          ))}

          <button
            onClick={handleZoomIn}
            title="Zoom In (+)"
            aria-label="Zoom in"
            style={{
              padding: "3px 6px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginLeft: 2,
            }}
          >
            <ZoomIn size={12} />
          </button>

          <button
            onClick={handleZoomOut}
            title="Zoom Out (-)"
            aria-label="Zoom out"
            style={{
              padding: "3px 6px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ZoomOut size={12} />
          </button>

          <button
            onClick={handleResetZoom}
            title="Reset Chart Zoom & Center Setup"
            aria-label="Reset zoom"
            style={{
              padding: "3px 6px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <RotateCcw size={12} />
          </button>
        </div>
      </div>

      {/* 2. Interactive Chart Canvas Container with touchAction: 'none' for smooth mobile swipe & gestures */}
      <div style={{ position: "relative", width: "100%", height: height || 320 }}>
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
              background: "rgba(0, 0, 0, 0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
              gap: 8,
              fontSize: 12,
              color: "var(--fg)",
            }}
          >
            <Loader2 size={16} className="animate-spin" />
            <span>Loading {symbol} candles...</span>
          </div>
        )}

        {/* Error Overlay */}
        {error && !loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0, 0, 0, 0.65)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
              gap: 6,
              fontSize: 12,
              color: "var(--red)",
            }}
          >
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* 3. Legend Footer: Explaining the 3 Target Boundaries */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "5px 12px",
          background: "var(--panel-2)",
          borderTop: "1px solid var(--border)",
          fontSize: 10,
          color: "var(--muted)",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, background: "rgba(250, 204, 21, 0.3)", border: "1px solid #facc15", borderRadius: 2 }} />
            <span>Full TP (TradeDefault Target)</span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 14, height: 2, borderTop: "2px dashed #06b6d4" }} />
            <span style={{ color: "#06b6d4" }}>Prop-Firm Target Line</span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 14, height: 2, borderTop: "2px dotted #f59e0b" }} />
            <span style={{ color: "#f59e0b" }}>50% Milestone Level Line</span>
          </span>
        </div>

        <span style={{ fontSize: 9.5, opacity: 0.8 }}>
          Pinch or scroll to zoom · Drag to pan · Drag price axis to scale
        </span>
      </div>
    </div>
  );
}
