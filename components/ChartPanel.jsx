"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PatternsPrimitive } from "../lib/patterns/primitive.js";
import { runPatterns } from "../lib/patterns/index.js";
import { useDrawings } from "../lib/draw/useDrawings.js";
import { useChartSettings } from "../lib/chartSettings.js";
import { Loader2, ChevronRight } from "lucide-react";
import DrawingToolbar from "./DrawingToolbar.jsx";
import DrawingContextMenu from "./DrawingContextMenu.jsx";
import DrawingSettings from "./DrawingSettings.jsx";
import MiniDrawingToolbar from "./MiniDrawingToolbar.jsx";
import { tradeToPositionDrawing, tradeToPositionDrawings, tradeToStagedPositionDrawings, pairToRadarTradeIdeaDrawings } from "../lib/autonomous/tradeDrawing.js";
import { normalizeCandles } from "../lib/candleNormalization.js";

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

  autoscaleInfo() {
    if (!this._dragging) return null;
    return {
      priceRange: {
        minValue: this._dragging.price,
        maxValue: this._dragging.price,
      }
    };
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

      const getChainColor = (id) => {
        let hash = 0;
        for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
        return `hsl(${Math.abs(hash) % 360}, 85%, 60%)`;
      };

      // Calculate coordinates for all alerts
      const renderNodes = this._alerts.map((a) => {
        const livePrice = this._dragging?.id === a._id ? this._dragging.price : a.price;
        const y = Y(livePrice);
        
        let startIdx = 0, found = false;
        for (let i = bars.length - 1; i >= 0; i--) {
          const b = bars[i];
          if (b.low <= livePrice && b.high >= livePrice) { startIdx = i; found = true; break; }
        }
        if (!found) startIdx = bars.length - 1; // Start from newest bar if no touch found
        const x = X(startIdx);
        
        let color = "rgba(255, 152, 0, 0.75)";
        if (a.status === "triggered") color = "rgba(239, 83, 80, 0.75)";
        else if (a.chainId) color = getChainColor(a.chainId);
        
        return { ...a, x, y, livePrice, color };
      }).filter(n => n.x != null && n.y != null);

      // Group by chainId to draw vertical links
      const chains = {};
      for (const n of renderNodes) {
        if (n.chainId) {
          if (!chains[n.chainId]) chains[n.chainId] = [];
          chains[n.chainId].push(n);
        }
      }

      // Draw vertical arrows for chains
      for (const [chainId, nodes] of Object.entries(chains)) {
        if (nodes.length < 2) continue;
        nodes.sort((a, b) => a.chainOrder - b.chainOrder);
        const color = getChainColor(chainId);
        
        // Find left-most x to draw the vertical link
        const minX = Math.max(0, Math.min(...nodes.map(n => n.x)) - 10);
        
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        
        for (let i = 0; i < nodes.length - 1; i++) {
          const curr = nodes[i];
          const next = nodes[i+1];
          ctx.beginPath();
          ctx.moveTo(minX, curr.y);
          ctx.lineTo(minX, next.y);
          ctx.stroke();
          
          // Draw arrowhead pointing to the next node
          ctx.beginPath();
          const dir = next.y > curr.y ? -1 : 1;
          ctx.moveTo(minX - 4, next.y + dir * 6);
          ctx.lineTo(minX, next.y);
          ctx.lineTo(minX + 4, next.y + dir * 6);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      // Draw individual horizontal lines and badges
      for (const n of renderNodes) {
        let lineColor = n.color;
        let lineDash = [4, 4];
        
        if (n.rating) {
          if (n.rating === 3) lineDash = [];
          else if (n.rating === 2) lineDash = [8, 4];
          else if (n.rating === 1) lineDash = [4, 4];
          
          if (n.status !== "triggered") {
            lineColor = "#ffb300";
          } else {
            lineColor = "rgba(239, 83, 80, 0.4)";
          }
        }

        const startX = Math.max(n.x, 0);

        // Extended faint line to the left of the touch for priority alerts
        if (n.rating >= 2 && startX > 0) {
          ctx.strokeStyle = "rgba(128, 128, 128, 0.4)";
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 4]); // faint dotted
          ctx.beginPath();
          ctx.moveTo(0, n.y);
          ctx.lineTo(startX, n.y);
          ctx.stroke();
        }

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1;
        ctx.setLineDash(lineDash);
        ctx.beginPath();
        ctx.moveTo(startX, n.y);
        ctx.lineTo(W, n.y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Star Rating on the left edge (shifted right to avoid vertical toolbar on desktop)
        if (n.rating) {
          const leftPad = (typeof window !== "undefined" && window.innerWidth <= 768) ? 8 : 52;
          ctx.fillStyle = lineColor;
          ctx.font = "9px sans-serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          let stars = "";
          for(let i=0; i<n.rating; i++) stars += "★";
          ctx.fillText(stars, leftPad, n.y);
        }
        
        // Chain Order Number Badge on left side
        if (n.chainId) {
          ctx.fillStyle = n.color;
          ctx.font = "bold 10px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const bx = Math.max(n.x, 0) - 10;
          const label = `${n.chainId}${n.chainOrder}`;
          const w = ctx.measureText(label).width + 8;
          ctx.fillRect(bx - w/2, n.y - 8, w, 16);
          ctx.fillStyle = "#1a1206"; // dark text
          ctx.fillText(label, bx, n.y);
        }
        
        // Bell icon on the right side
        ctx.save();
        ctx.translate(W - 16, n.y - 14);
        ctx.scale(0.5, 0.5);
        ctx.strokeStyle = n.color;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const bell = new Path2D("M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0");
        ctx.stroke(bell);
        if (n.status === "triggered") {
          const slash = new Path2D("M 3 3 L 21 21");
          ctx.stroke(slash);
        }
        ctx.restore();
      }
    });
  }
}

export default function ChartPanel({
  symbol, tf, tick, alerts, barsCache, onAddAlert, onAddAlertLayer, onDeleteAlert, onMoveAlert, onRearmAlert, onRateAlert, onCreateChainAlert, onJoinChainAlert, indicators, onAutoAlert,
  autonomousTrades = [],
  radarPairs = [],
  syncOpts, paneId, syncedLogicalRange, setSyncedLogicalRange, syncedCrosshair, setSyncedCrosshair,
  isActive = true, onOpenSettings, biasData,
  storageKey,
  persistRemote = true,
}) {
  const wrapRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const lastBarRef = useRef(null);
  const patternsRef = useRef(null);  // PatternsPrimitive attached to the series
  const alertsPrimRef = useRef(null); // AlertsPrimitive
  const drawingManagerRef = useRef(null); // DrawingManager from lightweight-charts-drawing
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
  const [lockedAlertId, setLockedAlertId] = useState(null);
  const [dragging, setDragging] = useState(null);     // {id, price} while actively dragging
  const [layerSpawnAlertId, setLayerSpawnAlertId] = useState(null); // alert id currently spanning a new layer
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [spawnY, setSpawnY] = useState(null); // mouse Y for layer ghost line
  const dragStateRef = useRef(null);

  const [chartReady, setChartReady] = useState(false);
  const [isScrolledLeft, setIsScrolledLeft] = useState(false);

  const fmt = useCallback((p) => Number(p).toFixed(digits), [digits]);

  // keep latest alerts accessible to the stable mousemove handler
  const alertsRef = useRef(alerts);
  useEffect(() => { alertsRef.current = alerts; }, [alerts]);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const touchStartPos = useRef(null);
  const onScrollerPointerDown = (e) => {
    const mgr = drawingManagerRef.current;
    if (mgr) {
      const pt = mgr.panePoint(e);
      if (mgr.hitTopmost(pt)) {
        e.target.style.pointerEvents = "none";
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el) {
          el.dispatchEvent(new PointerEvent("pointerdown", e));
        }
        setTimeout(() => { if (e.target) e.target.style.pointerEvents = "auto"; }, 400);
        return;
      }
    }
    touchStartPos.current = { x: e.clientX, y: e.clientY };
  };
  const onScrollerPointerUp = (e) => {
    if (!touchStartPos.current) return;
    const dx = e.clientX - touchStartPos.current.x;
    const dy = e.clientY - touchStartPos.current.y;
    touchStartPos.current = null;
    
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      e.target.style.pointerEvents = "none";
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el) {
        el.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true, cancelable: true,
          clientX: e.clientX, clientY: e.clientY,
          button: 0, buttons: 1, pointerType: "touch"
        }));
        setTimeout(() => {
          if (el.isConnected) {
            el.dispatchEvent(new PointerEvent("pointerup", {
              bubbles: true, cancelable: true,
              clientX: e.clientX, clientY: e.clientY,
              button: 0, buttons: 0, pointerType: "touch"
            }));
          }
        }, 50);
      }
      e.target.style.pointerEvents = "auto";
    }
  };

  // ---------- drawing tools ----------
  const draw = useDrawings({ drawingManagerRef, chartReady, symbol, tf, barsRef, isActive, wrapRef, dataVersion, storageKey, persistRemote });

  // ---------- global settings ----------
  const [settings] = useChartSettings();

  const loadingFact = useMemo(() => {
    if (!loading) return null;
    
    if (biasData?.symbols) {
      const symData = biasData.symbols.find(s => s.symbol === symbol);
      if (symData) {
        if (symData.setup) return `⚡ ${symbol} has an active Setup!`;
        if (symData.phase === "uptrend") return `${symbol} is in a 📈 Uptrend`;
        if (symData.phase === "downtrend") return `${symbol} is in a 📉 Downtrend`;
        if (symData.phase === "chop") return `${symbol} is currently chopping ➖`;
        if (symData.phase === "reversal-watch") return `Watching ${symbol} for reversals 🔄`;
        if (symData.factors && symData.factors.length > 0) return `Fact: ${symData.factors[0].label}`;
      }
    }

    const tips = [
      "Liquidity rests above old highs and below old lows.",
      "A sweep without displacement is just a sweep.",
      "Higher timeframe structure supersedes lower timeframe noise.",
      "Wait for the M15 MSS to confirm a reversal.",
      "Session timings dictate volatility and sweeps.",
      "Don't trade the chop. Wait for expansion.",
      "Are you trading the Asian session or London?",
      "Stop losses go where the setup is invalidated.",
      "Patience pays more than frequency."
    ];
    let hash = 0;
    for (let i = 0; i < symbol.length; i++) hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
    return tips[Math.abs(hash) % tips.length];
  }, [loading, symbol, biasData]);

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
        vertLines: { color: settings.gridVertColor, visible: settings.gridVertEnabled !== false }, 
        horzLines: { color: settings.gridHorzColor, visible: settings.gridHorzEnabled !== false } 
      },
      // Note: watermark was moved to a plugin in LWC v5; skip here to avoid errors.
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
      const { createChart, CrosshairMode, CandlestickSeries } = await import("lightweight-charts");
      const { DrawingManager } = await import("lightweight-charts-drawing");
      if (disposed || !wrapRef.current) return;
      const chart = createChart(wrapRef.current, {
        layout: { 
          background: settings.bgType === "Solid" 
            ? { type: "solid", color: settings.bgColor } 
            : { type: "gradient", topColor: settings.bgGradientTop, bottomColor: settings.bgGradientBottom },
          textColor: settings.textColor,
          fontSize: (typeof window !== "undefined" && window.innerWidth <= 768) ? 9 : 10,
        },
        grid: { 
          vertLines: { color: settings.gridVertColor, visible: settings.gridVertEnabled !== false }, 
          horzLines: { color: settings.gridHorzColor, visible: settings.gridHorzEnabled !== false } 
        },
        crosshair: { mode: CrosshairMode.Normal },
        timeScale: { 
          rightOffset: 12, 
          timeVisible: true, 
          secondsVisible: false, 
          borderColor: settings.linesColor,
          tickMarkFormatter: (time, tickMarkType) => {
            const d = new Date(time * 1000);
            const day = String(d.getUTCDate()).padStart(2, "0");
            const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
            const year = d.getUTCFullYear();
            const hh = String(d.getUTCHours()).padStart(2, "0");
            const mm = String(d.getUTCMinutes()).padStart(2, "0");

            switch (tickMarkType) {
              case 0: return `${year}`;
              case 1: return `${month} ${year}`;
              case 2: return `${day} ${month}`;
              case 3:
              case 4:
              default:
                return `${hh}:${mm}`;
            }
          },
        },
        localization: {
          dateFormat: "yyyy-MM-dd",
          timeFormatter: (time) => {
            const d = new Date(time * 1000);
            const y = d.getUTCFullYear();
            const m = String(d.getUTCMonth() + 1).padStart(2, "0");
            const day = String(d.getUTCDate()).padStart(2, "0");
            const hh = String(d.getUTCHours()).padStart(2, "0");
            const mm = String(d.getUTCMinutes()).padStart(2, "0");
            return `${y}-${m}-${day} ${hh}:${mm} EET`;
          },
        },
        rightPriceScale: { borderColor: settings.linesColor },
        autoSize: true,
      });
      // LWC v5: addSeries(SeriesType, options) replaces addCandlestickSeries()
      const series = chart.addSeries(CandlestickSeries, {
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

      // Pure TradingView DrawingManager from lightweight-charts-drawing
      const drawingManager = new DrawingManager(chart, series, {
        magnet: "off",
        stayInDrawingMode: false,
        bars: () => barsRef.current || [],
      });
      drawingManagerRef.current = drawingManager;

      chartRef.current = chart;
      seriesRef.current = series;
      setChartReady(true);
    })();
    return () => {
      disposed = true;
      setChartReady(false);
      if (hoverRafRef.current != null) cancelAnimationFrame(hoverRafRef.current);
      try { drawingManagerRef.current?.destroy(); } catch {}
      drawingManagerRef.current = null;
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // ---------- PiP Media Session Actions ----------
  useEffect(() => {
    const handlePipAction = (e) => {
      if (!chartRef.current || !isActive) return;
      const timeScale = chartRef.current.timeScale();
      
      switch (e.detail) {
        case "play":
          timeScale.scrollToRealTime();
          break;
        case "zoom-in": {
          const lr = timeScale.getVisibleLogicalRange();
          if (lr) {
            const diff = (lr.to - lr.from) * 0.2;
            timeScale.setVisibleLogicalRange({ from: lr.from + diff, to: lr.to - diff });
          }
          break;
        }
        case "zoom-out": {
          const lr = timeScale.getVisibleLogicalRange();
          if (lr) {
            const diff = (lr.to - lr.from) * 0.2;
            timeScale.setVisibleLogicalRange({ from: lr.from - diff, to: lr.to + diff });
          }
          break;
        }
      }
    };
    window.addEventListener("pip-action", handlePipAction);
    return () => window.removeEventListener("pip-action", handlePipAction);
  }, [isActive]);

  // ---------- load and synchronize bars with auto-gap healing & retry ----------
  const syncingRef = useRef(false);
  const lastSyncTimeRef = useRef(0);

  const applyBars = useCallback((bars, isSilent = false) => {
    if (!seriesRef.current || !Array.isArray(bars) || !bars.length) return;
    const key = `${symbol}:${tf}`;

    try {
      // Deduplicate and sort bars by time ascending (required by lightweight-charts)
      const seen = new Set();
      const cleanBars = [];
      const sorted = [...bars].sort((a, b) => a.time - b.time);
      for (const b of sorted) {
        if (b.time != null && !seen.has(b.time)) {
          seen.add(b.time);
          cleanBars.push(b);
        }
      }
      if (!cleanBars.length) return;

      seriesRef.current.setData(cleanBars);
      lastBarRef.current = { key, bar: cleanBars[cleanBars.length - 1] };
      barsRef.current = cleanBars;
      setDataVersion((v) => v + 1);
      drawingManagerRef.current?.redraw();

      if (!isSilent) {
        chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
        const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
        const visibleBars = isMobile ? 60 : 80;
        const rightOffset = isMobile ? 8 : 12;
        const from = Math.max(0, cleanBars.length - visibleBars);
        const to = cleanBars.length + rightOffset;
        chartRef.current?.timeScale().setVisibleLogicalRange({ from, to });
        setTimeout(() => {
          if (chartRef.current) {
            try { chartRef.current.priceScale("right").applyOptions({ autoScale: false }); } catch {}
          }
        }, 100);
      }

      const est = Math.max(
        ...cleanBars.slice(-50).map((b) => (String(b.close).split(".")[1] || "").length)
      );
      setBarsDigits(Math.min(est, 8));
      setError(null);
    } catch (err) {
      console.error("Error applying chart bars:", err);
      if (!isSilent) setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [symbol, tf]);

  const syncBars = useCallback(async (isSilent = false) => {
    if (syncingRef.current) return;
    const key = `${symbol}:${tf}`;
    const cached = barsCache.current.get(key);

    if (!isSilent) {
      if (cached?.bars?.length) {
        applyBars(cached.bars, false);
      } else {
        setLoading(true);
      }
    }

    syncingRef.current = true;
    try {
      // Wait for seriesRef if chart is mounting
      for (let i = 0; i < 40 && !seriesRef.current; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }

      let count = 600;
      if (["M1", "M5", "M15"].includes(tf)) count = 800;
      else if (["H1", "H4", "D1"].includes(tf)) count = 600;

      // Robust retry: allows mobile connections and sleeping tabs to wake up smoothly
      let data = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(`/api/rates?symbol=${encodeURIComponent(symbol)}&tf=${tf}&count=${count}`, { cache: "no-store" });
          if (res.ok) {
            data = await res.json();
            if (data?.ok && Array.isArray(data.bars) && data.bars.length > 0) break;
          }
        } catch (e) {
          if (attempt === 2) throw e;
        }
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }

      if (!data?.ok || !data.bars?.length) {
        if (cached?.bars?.length) {
          applyBars(cached.bars, false);
        } else if (!isSilent) {
          setError(data?.message || data?.error || `No data for ${symbol}`);
        }
        return;
      }

      let bars = data.bars.map((b) => ({ time: b.t / 1000, open: b.o, high: b.h, low: b.l, close: b.c }));
      bars = bars.filter(b => b.close > 0 && b.high > 0 && b.low > 0 && b.high < b.low * 10);
      bars = normalizeCandles(bars, tf);
      barsCache.current.set(key, { at: Date.now(), bars });
      lastSyncTimeRef.current = Date.now();

      try {
        const slimCache = Array.from(barsCache.current.entries()).reduce((acc, [k, v]) => {
          acc[k] = { at: v.at, bars: v.bars.slice(-800) };
          return acc;
        }, {});
        localStorage.setItem("ts_bars_cache", JSON.stringify(slimCache));
      } catch (e) {}

      applyBars(bars, isSilent);
      setError(null);
    } catch (err) {
      if (!isSilent) {
        if (cached?.bars?.length) {
          applyBars(cached.bars, false);
        } else {
          setError(err.message);
        }
      }
    } finally {
      syncingRef.current = false;
      setLoading(false);
    }
  }, [symbol, tf, barsCache, applyBars]);

  // Initial and symbol/tf change bar fetch
  useEffect(() => {
    syncBars(false);
  }, [symbol, tf, syncBars]);

  // Automatic gap-healing when switching back to tab or unlocking mobile screen
  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        const last = lastBarRef.current?.bar;
        if (!last) {
          syncBars(false);
          return;
        }
        const sec = TF_SEC[tf] || 300;
        const elapsedSec = Math.floor(Date.now() / 1000) - last.time;
        // If elapsed time exceeded 1.5 bar intervals, intermediate candles formed while away.
        // Silently re-sync in background to fill missing candles with zero gaps.
        if (elapsedSec > sec * 1.5) {
          syncBars(true);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
    };
  }, [syncBars, tf]);

  // ---------- axis label resolution ----------
  useEffect(() => {
    seriesRef.current?.applyOptions({
      priceFormat: { type: "price", precision: digits, minMove: Math.pow(10, -digits) },
    });
  }, [digits, loading]);

  // ---------- live tick -> update current candle with auto gap-healing ----------
  useEffect(() => {
    const entry = lastBarRef.current;
    if (!tick || !seriesRef.current || !entry || entry.key !== `${symbol}:${tf}`) return;
    const price = tick.bid || tick.ask;
    if (!price) return;
    const sec = TF_SEC[tf] || 300;
    const rawTime = tick.time != null ? tick.time : Date.now();
    const tickSec = rawTime > 1e11 ? Math.floor(rawTime / 1000) : rawTime;
    const barTime = Math.floor(tickSec / sec) * sec;
    const last = entry.bar;
    const isNewBar = barTime > last.time;
    const gap = barTime - last.time;
    const isNextConsecutive = (tf === "D1" || tf === "1D")
      ? (gap >= 86400 && gap <= 86400 * 1.5)
      : (Math.abs(gap - sec) <= 2);

    // If a new candle arrives but intermediate candles are missing (e.g. background tab / mobile lock):
    // Do NOT push a skipped bar that creates a visual hole/gap on the chart!
    // Trigger an immediate background re-sync to fetch and stitch the complete sequence cleanly.
    if (isNewBar && !isNextConsecutive) {
      const now = Date.now();
      if (!syncingRef.current && (now - lastSyncTimeRef.current > 3000)) {
        syncBars(true);
      }
      return;
    }

    const nextBar = isNewBar
      ? { 
          time: barTime, 
          open: isNextConsecutive ? last.close : price, 
          high: isNextConsecutive ? Math.max(last.close, price) : price, 
          low: isNextConsecutive ? Math.min(last.close, price) : price, 
          close: price 
        }
      : { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
    lastBarRef.current = { key: entry.key, bar: nextBar };
    seriesRef.current.update(nextBar);
    if (isNewBar) {
      barsRef.current = [...barsRef.current, nextBar];
      setDataVersion((v) => v + 1);
    } else if (barsRef.current.length) {
      barsRef.current[barsRef.current.length - 1] = nextBar;
    }
  }, [tick, symbol, tf, syncBars]);

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
    const visibleAlerts = (alerts || []).filter(a => !a.note?.includes("[RR:"));
    alertsPrimRef.current?.update(visibleAlerts, dragging, barsRef.current);
  }, [alerts, dragging, dataVersion]);

  // ---------- autonomous trades overlay via DrawingManager (lightweight-charts-drawing native RR tool) ----------
  useEffect(() => {
    const mgr = drawingManagerRef.current;
    if (!mgr || !chartReady) return;

    const isEnabled = indicators?.autoTrades !== false;
    const isStagedEnabled = indicators?.stagedTrades !== false;
    const isRadarEnabled = indicators?.radarTrades !== false;
    const currentList = mgr.list || [];
    const userDrawings = currentList.filter((d) => !String(d.id).startsWith("auto_"));

    const hasAutoTrades = autonomousTrades && autonomousTrades.length > 0;
    const hasRadarPairs = radarPairs && radarPairs.length > 0;

    if ((!isEnabled && !isStagedEnabled && !isRadarEnabled) || (!hasAutoTrades && !hasRadarPairs)) {
      if (currentList.some((d) => String(d.id).startsWith("auto_"))) {
        mgr.list = userDrawings;
        if (Array.isArray(mgr.selected)) {
          mgr.select(mgr.selected.filter((id) => !String(id).startsWith("auto_")));
        }
        mgr.redraw();
      }
      return;
    }

    const tfSec = TF_SEC[tf] || 300;
    const isDismissed = (id) => draw.dismissedAutoIds?.current?.has(String(id));

    // Institutional chart display:
    // 1. Keep ALL active / managing / open trades
    // 2. Keep all previously executed closed trades for this symbol (historical RR review)
    // 3. Staged setups rendered to the right of current candle with 4-5 candle gap
    // 4. Radar ideas rendered with violet/burnt orange RR tool
    const activeList = [];
    const closedList = [];
    const stagedList = [];

    for (const t of (autonomousTrades || [])) {
      if (!t) continue;
      const isOpenTrade = ["active", "managing", "open"].includes(String(t.status || "").toLowerCase());
      const isClosedTrade =
        !isOpenTrade &&
        (["closed_tp", "closed_sl", "closed_be", "closed"].includes(t.status) ||
        Boolean(t.closedAt) ||
        Boolean(t.closeTime));

      if (isClosedTrade) {
        const closedTime = new Date(t.closedAt || t.closeTime || t.updatedAt || t.createdAt || t.entryTime || 0).getTime();
        closedList.push({ trade: t, time: Number.isFinite(closedTime) ? closedTime : 0 });
      } else if (["staged", "confirming", "armed"].includes(t.status)) {
        stagedList.push(t);
      } else {
        activeList.push(t);
      }
    }

    closedList.sort((a, b) => (b.time || 0) - (a.time || 0));
    const chartTrades = [...activeList, ...closedList.slice(0, 50).map((item) => item.trade)];

    const autoDrawings = isEnabled
      ? chartTrades
          .flatMap((t) => tradeToPositionDrawings(t, barsRef.current, tfSec))
          .filter((d) => d && !isDismissed(d.id))
      : [];

    const stagedDrawings = isStagedEnabled
      ? stagedList
          .flatMap((t, idx) => tradeToStagedPositionDrawings(t, barsRef.current, tfSec, idx))
          .filter((d) => d && !isDismissed(d.id))
      : [];

    const radarDrawings = isRadarEnabled
      ? (radarPairs || [])
          .flatMap((p, idx) => pairToRadarTradeIdeaDrawings(p, barsRef.current, tfSec, idx))
          .filter((d) => d && !isDismissed(d.id))
      : [];

    mgr.list = [...userDrawings, ...autoDrawings, ...stagedDrawings, ...radarDrawings];
    if (Array.isArray(mgr.selected)) {
      const allAutoDrawings = [...autoDrawings, ...stagedDrawings, ...radarDrawings];
      mgr.select(mgr.selected.filter((id) => !String(id).startsWith("auto_") || allAutoDrawings.some((d) => d.id === id)));
    }
    mgr.redraw();
  }, [autonomousTrades, radarPairs, indicators?.autoTrades, indicators?.stagedTrades, indicators?.radarTrades, chartReady, symbol, tf, dataVersion]);

  // ---------- pointer tracking for "+ price" button and drag handle ----------
  // A wrapper mousemove (NOT subscribeCrosshairMove) so the button stays alive
  // while the pointer travels over the price axis — crosshair events stop at
  // the pane edge, which made the button vanish before it could be clicked.
  //
  // Updates are coalesced into one rAF and dropped when nothing visible moved:
  // an x-axis zoom drag otherwise re-renders this whole pane (and its drawing
  // toolbars) on every mousemove, which is what made horizontal zoom feel laggy.
  const hoverRafRef = useRef(null);
  const pendingHoverRef = useRef(null);
  const pendingHitRef = useRef(null);
  const lastHoverRef = useRef(null);
  const lastDragHandleRef = useRef(null);

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
      if (hoverRafRef.current != null) {
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
      pendingHoverRef.current = null;
      pendingHitRef.current = null;
      hoverPriceRef.current = null;
      if (lastHoverRef.current !== null) { lastHoverRef.current = null; setHoverBtn(null); }
      if (lastDragHandleRef.current !== null) { lastDragHandleRef.current = null; setDragHandle(null); }
      return;
    }
    hoverPriceRef.current = price;
    const priceScaleW = chart.priceScale("right")?.width() || 65;
    const isYAxisArea = rect.width - x <= priceScaleW;
    let time = chart.timeScale().coordinateToTime(x);
    if (!time && barsRef.current.length > 0) {
      time = barsRef.current[barsRef.current.length - 1].time;
    }

    // proximity test for drag handle
    let hit = null;
    const hitRadius = isMobile ? 15 : 7;

    if (isYAxisArea) {
      for (const a of alertsRef.current) {
        const ay = series.priceToCoordinate(a.price);
        if (ay != null && Math.abs(ay - y) < hitRadius) {
          hit = { id: a._id, y: ay, price: a.price, status: a.status, chainLength: a.chain?.length || 1 };
          break;
        }
      }
    }

    pendingHoverRef.current = { y, price, time, isYAxisArea };
    // `undefined` = locked handle: leave dragHandle untouched (original behaviour
    // was to skip the setDragHandle call entirely while an alert is locked)
    pendingHitRef.current = lockedAlertId ? undefined : hit;
    if (hoverRafRef.current == null) {
      hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = null;
        const p = pendingHoverRef.current;
        if (p) {
          const last = lastHoverRef.current;
          // skip when the button-relevant fields are unchanged — a horizontal
          // zoom drag moves x only, so this drops its re-renders entirely
          if (!last || last.y !== p.y || last.isYAxisArea !== p.isYAxisArea || last.price !== p.price) {
            lastHoverRef.current = p;
            setHoverBtn(p);
          }
        }
        if (pendingHitRef.current === undefined) return;
        const h = pendingHitRef.current;
        const lastH = lastDragHandleRef.current;
        const same = (h == null && lastH == null) || (h && lastH && h.id === lastH.id && h.y === lastH.y);
        if (!same) { lastDragHandleRef.current = h; setDragHandle(h); }
      });
    }
  }, [isMobile, lockedAlertId]);

  // ---------- right-click: add alert / delete nearby alert ----------
  const onContextMenu = useCallback((ev) => {
    ev.preventDefault();
    const series = seriesRef.current;
    if (!series || !wrapRef.current || !hoverPriceRef.current) return;
    const price = hoverPriceRef.current;
    const rect = wrapRef.current.getBoundingClientRect();
    
    // find alerts near this price (within 10 pixels of y-space), ignoring RR tool auto-alerts
    const y = series.priceToCoordinate(price);
    const nearAlerts = alerts.filter((a) => {
      if (a.note?.includes("[RR:")) return false;
      const ay = series.priceToCoordinate(a.price);
      return ay != null && Math.abs(ay - y) < 10;
    });

    if (nearAlerts.length === 0) return;

    setCtxMenu({
      x: Math.min(ev.clientX - rect.left, rect.width - 240),
      y: Math.min(y, rect.height - 40 - nearAlerts.length * 36),
      price,
      nearAlerts,
    });
  }, [alerts]);

  const ctxMenuRef = useRef(null);
  useEffect(() => {
    const close = (e) => {
      if (ctxMenuRef.current && ctxMenuRef.current.contains(e.target)) return;
      setCtxMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close, { passive: true });
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, []);

  // ---------- maintain crosshair while hovering the add button or Y axis ----------
  const wasForcingCrosshairRef = useRef(false);
  useEffect(() => {
    if ((isHoveringBtn || hoverBtn?.isYAxisArea) && hoverBtn && chartRef.current && seriesRef.current && hoverBtn.time) {
      chartRef.current.setCrosshairPosition(hoverBtn.price, hoverBtn.time, seriesRef.current);
      wasForcingCrosshairRef.current = true;
    } else if (wasForcingCrosshairRef.current) {
      chartRef.current?.clearCrosshairPosition();
      wasForcingCrosshairRef.current = false;
    }
  }, [isHoveringBtn, hoverBtn]);

  // ---------- drag-to-move an alert price line ----------
  const beginDrag = useCallback((e, id) => {
    e.preventDefault();
    e.stopPropagation();
    const series = seriesRef.current;
    const wrap = wrapRef.current;
    if (!series || !wrap) return;
    const rect = wrap.getBoundingClientRect();

    const alert = alertsRef.current.find(a => a._id === id);
    if (!alert) return;

    const initialPrice = alert.price;
    setDragging({ id, price: initialPrice });
    dragStateRef.current = { id, price: initialPrice };

    const onMove = (ev) => {
      const y = ev.clientY - rect.top;
      const x = ev.clientX - rect.left;
      const price = series.coordinateToPrice(y);
      if (price == null || !Number.isFinite(price)) return;
      dragStateRef.current = { id, price };
      
      if (alertsPrimRef.current) {
        const visibleAlerts = alertsRef.current.filter(a => !a.note?.includes("[RR:"));
        alertsPrimRef.current.update(visibleAlerts, dragStateRef.current, barsRef.current);
      }

      // Force crosshair to follow drag
      if (chartRef.current && seriesRef.current) {
        let time = chartRef.current.timeScale().coordinateToTime(x);
        if (!time && barsRef.current.length > 0) {
          time = barsRef.current[barsRef.current.length - 1].time;
        }
        if (time) {
          chartRef.current.setCrosshairPosition(price, time, seriesRef.current);
        }
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      chartRef.current?.clearCrosshairPosition();
      const final = dragStateRef.current;
      dragStateRef.current = null;
      setDragging(null);
      setDragHandle(null);
      if (final && onMoveAlert) onMoveAlert(final.id, final.price);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";
  }, [onMoveAlert]);

  // Sync dragHandle position during chart panning/zooming
  useEffect(() => {
    // Only run if either dragHandle is active OR dragging is active
    if (!dragHandle && !dragStateRef.current) return;
    if (!seriesRef.current || !chartRef.current) return;
    
    let rafId;
    const updatePos = () => {
      if (seriesRef.current && chartRef.current) {
        const activePrice = dragStateRef.current ? dragStateRef.current.price : (dragHandle ? dragHandle.price : null);
        if (activePrice !== null) {
          const y = seriesRef.current.priceToCoordinate(activePrice);
          if (y !== null) {
            const badge = document.getElementById(`drag-handle-badge-${paneId}`);
            const icon = document.getElementById(`drag-handle-icon-${paneId}`);
            const liveBadge = document.getElementById(`live-price-badge-${paneId}`);
            const liveText = document.getElementById(`live-price-text-${paneId}`);
            
            if (badge) badge.style.top = `${y}px`;
            if (liveBadge) liveBadge.style.top = `${y}px`;
            if (liveText) liveText.innerText = isMobile ? Number(activePrice).toFixed(digits) : `⇅ ${Number(activePrice).toFixed(digits)}`;

            if (icon) {
              icon.style.top = `${y}px`;
              let iconX = "50%";
              if (!isMobile && barsRef.current?.length > 0) {
                const bars = barsRef.current;
                let startIdx = 0, found = false;
                for (let i = bars.length - 1; i >= 0; i--) {
                  const b = bars[i];
                  if (b.low <= activePrice && b.high >= activePrice) { startIdx = i; found = true; break; }
                }
                if (!found) startIdx = Math.max(0, bars.length - 1 - 25);
                const px = chartRef.current.timeScale().logicalToCoordinate(startIdx);
                if (px !== null && px > 60) {
                  iconX = `${px}px`;
                }
              }
              icon.style.left = iconX;
            }
          }
        }
      }
      rafId = requestAnimationFrame(updatePos);
    };
    rafId = requestAnimationFrame(updatePos);
    return () => cancelAnimationFrame(rafId);
  }, [dragHandle, dragging, paneId, isMobile, digits]);

  const programmaticRangeRef = useRef(null);
  const isFetchingHistory = useRef(false);

  // ---------- Sync Logical Range ----------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const timeScale = chart.timeScale();
    const handler = (range) => {
      if (range) {
        const totalBars = barsRef.current?.length || 0;
        if (totalBars > 0) {
          setIsScrolledLeft(range.to < totalBars + 5);
          
          if (range.from < 50 && !isFetchingHistory.current && totalBars < 5000) {
            isFetchingHistory.current = true;
            (async () => {
              try {
                const res = await fetch(`/api/rates?symbol=${encodeURIComponent(symbol)}&tf=${tf}&count=500&offset=${totalBars}`);
                const data = await res.json();
                if (data.ok && data.bars?.length) {
                  let newBars = data.bars.map((b) => ({ time: b.t / 1000, open: b.o, high: b.h, low: b.l, close: b.c }));
                  // Filter out completely anomalous MT5 glitches (0 prices or 100x spikes)
                  newBars = newBars.filter(b => b.close > 0 && b.high > 0 && b.low > 0 && b.high < b.low * 10);

                  // MT5 might return the current bars if offset is too far, ensure we don't overlap time
                  const oldestExistingTime = barsRef.current[0].time;
                  const filteredNewBars = newBars.filter(b => b.time < oldestExistingTime);
                  
                  if (filteredNewBars.length > 0) {
                    const combined = normalizeCandles([...filteredNewBars, ...barsRef.current], tf);
                    barsRef.current = combined;
                    // Preserve the scroll position by shifting logical indices
                    const currentRange = chart.timeScale().getVisibleLogicalRange();
                    seriesRef.current.setData(combined);
                    if (currentRange) {
                       chart.timeScale().setVisibleLogicalRange({
                         from: currentRange.from + filteredNewBars.length,
                         to: currentRange.to + filteredNewBars.length
                       });
                    }
                  }
                }
              } catch (e) {
                console.error("lazy load failed", e);
              } finally {
                isFetchingHistory.current = false;
              }
            })();
          }
        }
      }

      if (!syncOpts?.time) return;
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
  }, [syncOpts?.time, paneId, setSyncedLogicalRange, chartReady, symbol, tf]);

  useEffect(() => {
    if (!chartRef.current || !syncOpts?.time || !syncedLogicalRange) return;
    if (syncedLogicalRange.sourceId !== paneId) {
      programmaticRangeRef.current = syncedLogicalRange.range;
      chartRef.current.timeScale().setVisibleLogicalRange(syncedLogicalRange.range);
    }
  }, [syncedLogicalRange, syncOpts?.time, paneId]);

  const programmaticCrosshairRef = useRef(null);

  // ---------- Sync & Mobile Crosshair ----------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const handler = (param) => {
      const isTouch = typeof window !== 'undefined' && (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
      if (isTouch) {
        if (param.point && seriesRef.current) {
          const y = param.point.y;
          const x = param.point.x;
          const price = seriesRef.current.coordinateToPrice(y);
          if (price != null && Number.isFinite(price)) {
            const time = chart.timeScale().coordinateToTime(x);
            setHoverBtn({ y, price, time });
            hoverPriceRef.current = price;
          }
        }
      }

      // 2. Sync logic
      if (!syncOpts?.crosshair) return;
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
  }, [syncOpts?.crosshair, paneId, setSyncedCrosshair, chartReady]);

  // ---------- Click to Edit Alert ----------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartReady) return;
    
    const handler = (param) => {
      if (!param.point || !seriesRef.current) return;
      
      const y = param.point.y;
      let hit = null;
      for (const a of alertsRef.current) {
        const ay = seriesRef.current.priceToCoordinate(a.price);
        const threshold = (typeof window !== "undefined" && window.innerWidth <= 768) ? 20 : 10;
        if (ay != null && Math.abs(ay - y) < threshold) { 
          hit = { id: a._id, y: ay, price: a.price, status: a.status, chainLength: a.chain?.length || 1 }; 
          break; 
        }
      }
      if (hit) {
        setDragHandle(hit);
        setLockedAlertId(hit.id);
      }
    };
    chart.subscribeClick(handler);
    return () => chart.unsubscribeClick(handler);
  }, [chartReady]);


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
  const mergedPointerDown = (ev) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;

    if (lockedAlertId) {
      setLockedAlertId(null);
      setDragHandle(null);
    } else {
      const priceScaleW = chartRef.current?.priceScale("right")?.width() || 65;
      const isYAxisArea = rect.width - x <= priceScaleW;
      if (isYAxisArea && seriesRef.current) {
        let hit = null;
        for (const a of alertsRef.current) {
          const ay = seriesRef.current.priceToCoordinate(a.price);
          if (ay != null && Math.abs(ay - y) < (isMobile ? 15 : 7)) { 
            hit = { id: a._id, y: ay, price: a.price, status: a.status, chainLength: a.chain?.length || 1 }; 
            break; 
          }
        }
        if (hit) {
          setDragHandle(hit);
          setLockedAlertId(hit.id);
          ev.stopPropagation();
          return;
        }
      }
    }

    if (layerSpawnAlertId && seriesRef.current) {
       const price = seriesRef.current.coordinateToPrice(y);
       if (price !== null) {
          onAddAlertLayer(layerSpawnAlertId, price);
          setLayerSpawnAlertId(null);
       }
       ev.stopPropagation();
       ev.preventDefault();
       return;
    }
    if (!draw.activeTool && chartRef.current) {
      try { chartRef.current.priceScale("right").applyOptions({ autoScale: false }); } catch {}
    }
  };
  const mergedPointerMove = (ev) => {
    if (layerSpawnAlertId) {
       const rect = ev.currentTarget.getBoundingClientRect();
       setSpawnY(ev.clientY - rect.top);
    }
  };

  const onChartDoubleClick = (ev) => {
    const mgr = drawingManagerRef.current;
    if (!mgr) return;
    const hovered = mgr.hoveredId();
    if (hovered) {
      mgr.select([hovered]);
      draw.setSelectedId(hovered);
      draw.setSettingsOpen(true);
      ev.stopPropagation();
      return;
    }
    const sel = mgr.selection();
    if (sel && sel.length > 0) {
      draw.setSettingsOpen(true);
      ev.stopPropagation();
    }
  };

  return (
    <div
      style={{ flex: 1, position: "relative", minWidth: 0,
        cursor: layerSpawnAlertId ? "crosshair" : (draw.cursorFor(draw.activeTool) || (dragHandle ? "ns-resize" : "default")) }}
      onMouseMove={onMouseMove}
      onMouseLeave={() => { 
        const isTouch = typeof window !== 'undefined' && (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
        if (!isTouch) {
          setHoverBtn(null); setDragHandle(null); 
        }
      }}
    >
      <div 
        ref={wrapRef} 
        className="chart-wrap"
        style={{ position: "absolute", inset: 0, touchAction: "none" }}
        onPointerDownCapture={mergedPointerDown}
        onPointerMoveCapture={mergedPointerMove}
        onContextMenuCapture={mergedContext}
        onDoubleClickCapture={onChartDoubleClick}
      />

      {/* Mobile left-edge scroller: disabled when drawing or selecting to avoid hijacking touches */}
      {isMobile && !draw.activeTool && !draw.selected && (
        <div 
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "20%",
            zIndex: 10,
            touchAction: "pan-y",
          }}
          onPointerDown={onScrollerPointerDown}
          onPointerUp={onScrollerPointerUp}
        />
      )}

      {isActive && !loading && !error && (
        <DrawingToolbar api={draw} />
      )}
      {isActive && !loading && !error && (
        <DrawingContextMenu api={draw} />
      )}
      {(isActive || draw.settingsOpen) && !loading && !error && (
        <DrawingSettings api={draw} />
      )}
      {isActive && !loading && !error && (
        <MiniDrawingToolbar api={draw} />
      )}

      {loading && (
        <div style={{ position: "absolute", inset: 0, zIndex: 10, background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
          <div className="skeleton-pulse" style={{ padding: "8px 16px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: "var(--muted)", boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>
            Syncing {symbol}...
          </div>
          {loadingFact && (
            <div className="skeleton-pulse" style={{ fontSize: 13, color: "var(--accent)", maxWidth: "80%", textAlign: "center", fontStyle: "italic", opacity: 0.8 }}>
              {loadingFact}
            </div>
          )}
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
          className="primary alert-add-btn"
          onMouseEnter={() => setIsHoveringBtn(true)}
          onMouseLeave={() => setIsHoveringBtn(false)}
          style={{
            position: "absolute", right: 65, top: hoverBtn.y, transform: "translateY(-50%)",
            zIndex: 20, fontWeight: 700, lineHeight: 1,
          }}
          onClick={() => onAddAlert(hoverBtn.price)}
          title="Add alert at this price"
        >
          ＋
        </button>
      )}

      {/* layer spawn ghost line */}
      {layerSpawnAlertId && spawnY !== null && (
         <div
           style={{
             position: "absolute", left: 0, right: 0, top: spawnY,
             borderTop: "1px dashed var(--orange)", zIndex: 20, pointerEvents: "none", opacity: 0.6
           }}
         />
      )}

      {/* alert badge / edit mode buttons (Universal for Mobile & Desktop) */}
      {dragHandle && !loading && !dragging && (
        <>
          {/* 1. Y-Axis Badge (Price + Renew + Delete) */}
          <div
            id={`drag-handle-badge-${paneId}`}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            style={{
              position: "absolute", right: 0, top: dragHandle.y, transform: "translateY(-50%)",
              zIndex: 25, display: "flex", alignItems: "center",
              background: dragHandle.status === "triggered" ? "rgba(239, 83, 80, 0.9)" : "var(--orange)",
              color: "#1a1206", fontWeight: 700, borderRadius: "4px 0 0 4px",
              boxShadow: "0 2px 8px rgba(0,0,0,.4)", overflow: "hidden",
              userSelect: "none", WebkitUserSelect: "none"
            }}
          >
            <div style={{ padding: "4px 8px", fontSize: 10 }}>
              {fmt(dragHandle.price)}
            </div>
            
            {dragHandle.status === "triggered" && (
              <button
                onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onRearmAlert(dragHandle.id); }}
                style={{ background: "var(--panel-2)", border: "none", borderLeft: "1px solid var(--border)", color: "inherit", padding: "4px 8px", cursor: "pointer", fontSize: 12 }}
                title="Renew (re-arm) alert"
              >
                ↻
              </button>
            )}
            <button
              onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onDeleteAlert(dragHandle.id); }}
              style={{ background: "var(--panel-2)", border: "none", borderLeft: "1px solid var(--border)", color: "inherit", padding: "4px 8px", cursor: "pointer", fontSize: 12 }}
              title="Delete alert"
            >
              ✕
            </button>
          </div>
          
          {/* 2. Drag Handle Icon (Centered on both mobile and desktop) */}
          {dragHandle.status === "active" && (
            <div
              id={`drag-handle-icon-${paneId}`}
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              onPointerDown={(e) => beginDrag(e, dragHandle.id)}
              style={{
                position: "absolute", 
                left: "50%", 
                top: dragHandle.y, 
                transform: "translate(-50%, -50%)",
                zIndex: 25, cursor: "ns-resize", touchAction: "none",
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 28, height: 28, borderRadius: "50%",
                background: "rgba(255, 152, 0, 0.2)",
                border: "1px solid var(--orange)",
                color: "var(--orange)", fontSize: 16,
                boxShadow: "0 2px 8px rgba(0,0,0,.2)",
                userSelect: "none", WebkitUserSelect: "none"
              }}
              title="Drag up/down to move this alert"
            >
              ⇅
            </div>
          )}
        </>
      )}

      {/* live price badge while actively dragging */}
      {dragging && (
        <div
          id={`live-price-badge-${paneId}`}
          style={{
            position: "absolute", right: 0, top: seriesRef.current?.priceToCoordinate(dragging.price) ?? 0,
            transform: "translateY(-50%)", zIndex: 26, padding: "4px 10px", fontSize: 13,
            background: "var(--orange)", color: "#1a1206", fontWeight: 700,
            borderRadius: "6px 0 0 6px", fontFamily: "var(--mono)",
            boxShadow: "0 4px 14px rgba(255,152,0,.5)",
          }}
        >
          <span id={`live-price-text-${paneId}`}>
            {isMobile ? fmt(dragging.price) : `⇅ ${fmt(dragging.price)}`}
          </span>
        </div>
      )}

      {ctxMenu && (
        <div 
          ref={ctxMenuRef}
          onTouchStart={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
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
              {!a.chainId ? (
                <MenuItem danger onClick={() => { onDeleteAlert(a._id); setCtxMenu(null); }}>
                  🗑 Delete alert {a.condition} <b className="num">{fmt(a.price)}</b>
                </MenuItem>
              ) : (
                <>
                  {a.chainOrder === 1 && (
                    <MenuItem danger onClick={() => { onDeleteAlert(a._id, true); setCtxMenu(null); }}>
                      🗑 Delete Entire Chain {a.chainId}
                    </MenuItem>
                  )}
                  <MenuItem danger onClick={() => { onDeleteAlert(a._id, false); setCtxMenu(null); }}>
                    🗑 Delete Link {a.chainId}{a.chainOrder} (Shifts others up)
                  </MenuItem>
                </>
              )}
              {a.status === "triggered" && (
                <MenuItem onClick={() => { onRearmAlert(a._id); setCtxMenu(null); }}>
                  ↻ Renew alert {a.condition} <b className="num">{fmt(a.price)}</b>
                </MenuItem>
              )}
              <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderBottom: "1px solid var(--border-light)", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Rating:</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    onClick={() => { onRateAlert && onRateAlert(a._id, null); setCtxMenu(null); }}
                    style={{
                      background: !a.rating ? "var(--panel-2)" : "transparent",
                      color: "var(--text-muted)",
                      border: "1px solid var(--border)",
                      borderRadius: 4, padding: "2px 6px", fontSize: 12, cursor: "pointer",
                      outline: "none"
                    }}
                  >
                    None
                  </button>
                  {[1, 2, 3].map(star => (
                    <button 
                      key={star} 
                      onClick={() => { onRateAlert && onRateAlert(a._id, a.rating === star ? null : star); setCtxMenu(null); }}
                      style={{
                        background: a.rating >= star ? "var(--orange)" : "transparent",
                        color: a.rating >= star ? "#1a1206" : "var(--text)",
                        border: "1px solid var(--orange)",
                        borderRadius: 4, padding: "2px 6px", fontSize: 12, cursor: "pointer",
                        outline: "none"
                      }}
                    >
                      {star}★
                    </button>
                  ))}
                </div>
              </div>
              {!a.chainId && (
                <MenuItem onClick={() => { onCreateChainAlert && onCreateChainAlert(a._id); setCtxMenu(null); }}>
                  🔗 Create Chain Group
                </MenuItem>
              )}
              <MenuItem onClick={() => { onJoinChainAlert && onJoinChainAlert(a._id); setCtxMenu(null); }}>
                🔗 {a.chainId ? "Move / Join another Chain" : "Join Chain Group..."}
              </MenuItem>
            </div>
          ))}
        </div>
      )}
      
      {isScrolledLeft && (
        <button
          className="ghost scroll-right-btn"
          onClick={(e) => {
            e.stopPropagation();
            if (chartRef.current) {
              chartRef.current.timeScale().scrollToRealTime();
              setIsScrolledLeft(false);
            }
          }}
          title="Scroll to Real Time"
          style={{
            background: "var(--accent)", border: "1px solid var(--border)",
            color: "#fff",
            borderRadius: "50%", width: 32, height: 32, display: "flex", 
            alignItems: "center", justifyContent: "center", padding: 0,
            cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.5)"
          }}
        >
          <ChevronRight size={18} strokeWidth={2.5} />
        </button>
      )}

      {/* Zoom / Date Range selector corner button */}
      <div 
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          width: 58,
          height: 26,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          cursor: "pointer",
          color: "var(--muted)",
          fontSize: 10,
          fontWeight: 700,
          userSelect: "none",
          transition: "background 0.2s"
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        onClick={(e) => { e.stopPropagation(); setZoomMenuOpen(!zoomMenuOpen); }}
      >
        <span>ZOOM</span>
      </div>

      {zoomMenuOpen && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={(e) => { e.stopPropagation(); setZoomMenuOpen(false); }} />
          <div style={{
            position: "absolute", right: 60, bottom: 26, zIndex: 100,
            background: "var(--panel)", border: "1px solid var(--border-hi)",
            borderRadius: 6, boxShadow: "0 -4px 16px rgba(0,0,0,0.5)",
            display: "flex", flexDirection: "column", padding: 4, minWidth: 120
          }}>
            <div className="muted" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, padding: "4px 8px 6px" }}>Zoom To</div>
            {(["M1", "M5", "M15"].includes(tf) ? ["Session", "4H", "24H", "7D", "1M", "3M"] : ["24H", "7D", "1M", "3M"]).map(r => (
              <button
                key={r}
                className="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!chartRef.current || !barsRef.current.length) return;
                  const ts = chartRef.current.timeScale();
                  const lastTime = barsRef.current[barsRef.current.length - 1].time;
                  let fromTime;
                  if (r === "Session") fromTime = lastTime - 8 * 3600;
                  else if (r === "4H") fromTime = lastTime - 4 * 3600;
                  else if (r === "24H") fromTime = lastTime - 24 * 3600;
                  else if (r === "7D") fromTime = lastTime - 7 * 86400;
                  else if (r === "1M") fromTime = lastTime - 30 * 86400;
                  else if (r === "3M") fromTime = lastTime - 90 * 86400;
                  
                  let fromIndex = barsRef.current.findIndex(b => b.time >= fromTime);
                  if (fromIndex === -1) fromIndex = 0;
                  
                  ts.setVisibleLogicalRange({ from: fromIndex, to: barsRef.current.length - 1 + (isMobile ? 8 : 12) });
                  setZoomMenuOpen(false);
                }}
                style={{ textAlign: "left", padding: "6px 10px", fontSize: 12, borderRadius: 4 }}
              >
                {r === "Session" ? "Trading Session" : r === "4H" ? "4 Hours" : r === "24H" ? "1 Day" : r === "7D" ? "1 Week" : r === "1M" ? "1 Month" : "3 Months"}
              </button>
            ))}
          </div>
        </>
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
