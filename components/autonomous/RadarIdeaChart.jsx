"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { RotateCcw, Maximize2, AlertCircle, Loader2 } from "lucide-react";
import { buildRadarTradeIdeaDrawing } from "../../lib/autonomous/tradeDrawing";
import { formatPrice, finiteNumber } from "./TradeTelemetry";
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

  const symbol = pair?.tradeableSymbol || pair?.symbol;
  const dir = pair?.dir === 1 ? 1 : pair?.dir === -1 ? -1 : 0;
  const isLong = dir === 1;

  // Staged / candidate levels preview
  const staged = pair?.stagedLevel;
  const entryVal = finiteNumber(staged?.entry ?? pair?.candidates?.[0]?.entry ?? pair?.currentPrice);
  const slVal = finiteNumber(staged?.sl ?? pair?.candidates?.[0]?.sl);
  const tpVal = finiteNumber(staged?.tp ?? pair?.candidates?.[0]?.tp ?? staged?.targets?.[0]?.price);
  const rrVal = finiteNumber(staged?.rr ?? staged?.targetRR);

  // Initialize and update Lightweight Charts
  useEffect(() => {
    let isCancelled = false;
    let resizeObserver = null;

    async function initChart() {
      if (!containerRef.current || !symbol) return;
      setLoading(true);
      setError(null);

      try {
        const { createChart, CrosshairMode, CandlestickSeries } = await import("lightweight-charts");
        const { DrawingManager } = await import("lightweight-charts-drawing");

        if (isCancelled) return;

        // Cleanup existing chart instance if any
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
        const gridCol = isCreamy ? "rgba(44, 40, 37, 0.04)" : isLight ? "rgba(0, 0, 0, 0.04)" : "rgba(255, 255, 255, 0.04)";

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
          },
          rightPriceScale: {
            borderColor: borderCol,
            autoScale: true,
            scaleMargins: { top: 0.12, bottom: 0.12 },
          },
          handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
          handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        });

        chartRef.current = chart;

        const series = typeof chart.addSeries === "function" && CandlestickSeries
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

        // Fetch bars from rates endpoint
        const activeTf = TF_OPTIONS.find((t) => t.id === selectedTf) || TF_OPTIONS[1];
        const tfSec = activeTf.sec || 900;
        const tfParam = activeTf.apiTf || "M15";
        const res = await fetch(`/api/rates?symbol=${encodeURIComponent(symbol)}&tf=${tfParam}&count=200`, { cache: "no-store" });
        const data = await res.json();

        if (isCancelled) return;

        if (!data.ok || !Array.isArray(data.bars) || data.bars.length === 0) {
          setError(data.message || `No candle data returned for ${symbol}`);
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
        series.setData(bars);

        // DrawingManager integration for Radar RR Tool
        const drawingManager = new DrawingManager(chart, series, {
          initial: [],
          bars: () => barsRef.current || [],
          onListChange: () => {},
        });
        drawingManagerRef.current = drawingManager;

        // Construct radar trade idea drawing
        const radarDrawing = buildRadarTradeIdeaDrawing(pair, bars, tfSec, 0);
        if (radarDrawing) {
          drawingManager.list = [radarDrawing];
          drawingManager.redraw();
        }

        chart.timeScale().fitContent();
        setLoading(false);

        // Resize observer
        resizeObserver = new ResizeObserver((entries) => {
          if (!entries || !entries[0]) return;
          const { width } = entries[0].contentRect;
          if (width > 0 && chartRef.current) {
            chartRef.current.applyOptions({ width });
          }
        });
        resizeObserver.observe(containerRef.current);
      } catch (err) {
        if (!isCancelled) {
          console.error("RadarIdeaChart error:", err);
          setError(err.message);
          setLoading(false);
        }
      }
    }

    initChart();

    return () => {
      isCancelled = true;
      if (resizeObserver) resizeObserver.disconnect();
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch {}
        chartRef.current = null;
      }
    };
  }, [symbol, selectedTf, pair, height]);

  const handleFit = useCallback(() => {
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
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

        {/* Center: Trade Idea Geometry Quick Telemetry */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "monospace", fontSize: 10 }}>
          <span
            style={{
              padding: "1px 5px",
              borderRadius: 3,
              fontWeight: 800,
              background: isLong ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
              color: isLong ? "var(--green)" : "var(--red)",
            }}
          >
            {isLong ? "BUY" : dir === -1 ? "SELL" : "NEUTRAL"}
          </span>

          {entryVal !== null && (
            <span>
              <strong style={{ color: "var(--fg)" }}>Entry:</strong> {formatPrice(entryVal)}
            </span>
          )}

          {slVal !== null && (
            <span>
              <strong style={{ color: "#ea580c" }}>SL:</strong> {formatPrice(slVal)}
            </span>
          )}

          {tpVal !== null && (
            <span>
              <strong style={{ color: "#a855f7" }}>TP:</strong> {formatPrice(tpVal)}
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
        </div>

        {/* Right: Reset Zoom / Fit */}
        <button
          onClick={handleFit}
          title="Fit Chart Content"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 6px",
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

      {/* Chart Canvas Area */}
      <div style={{ position: "relative", width: "100%", height }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

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
        <span>Pinch or scroll to zoom · Drag to pan</span>
      </div>
    </div>
  );
}
