"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PatternsPrimitive } from "../lib/patterns/primitive.js";
import { runPatterns } from "../lib/patterns/index.js";
import { useDrawings } from "../lib/draw/useDrawings.js";
import { useChartSettings } from "../lib/chartSettings.js";
import { Loader2, ChevronRight, ZoomIn, Settings } from "lucide-react";
import DrawingToolbar from "./DrawingToolbar.jsx";
import DrawingContextMenu from "./DrawingContextMenu.jsx";
import DrawingSettings from "./DrawingSettings.jsx";
import MiniDrawingToolbar from "./MiniDrawingToolbar.jsx";
import {
  tradeToPositionDrawing,
  tradeToPositionDrawings,
  tradeToStagedPositionDrawings,
  pairToRadarTradeIdeaDrawings,
  resolveRadarTradeIdeaPricing,
} from "../lib/autonomous/tradeDrawing.js";
import { normalizeCandles } from "../lib/candleNormalization.js";
import { getEetTime, getTradingDateString, getEetOffsetSec, getTradingDayKey } from "../lib/time.js";
import { BiasEnginePrimitive } from "../lib/bias/primitive.js";

const TF_SEC = {
  M1: 60, "1M": 60,
  M5: 300, "5M": 300,
  M15: 900, "15M": 900,
  M30: 1800, "30M": 1800,
  H1: 3600, "1H": 3600,
  H4: 14400, "4H": 14400,
  D1: 86400, "1D": 86400,
};

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
        
        // Calibrate alert color with active theme background
        const domTheme = typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") : "dark";
        const isMatrix = domTheme === "matrix";
        const isLight = domTheme === "light" || domTheme === "creamy";

        let color = isMatrix
          ? "rgba(0, 255, 102, 0.45)"
          : isLight
          ? "rgba(217, 119, 6, 0.55)"
          : "rgba(245, 158, 11, 0.45)"; // Soft institutional amber

        if (a.status === "triggered") {
          color = isLight ? "rgba(220, 38, 38, 0.3)" : "rgba(239, 83, 80, 0.3)";
        } else if (a.chainId) {
          color = getChainColor(a.chainId);
        }
        
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
        let lineDash = [3, 5];
        
        if (n.rating) {
          if (n.rating === 3) lineDash = [6, 2];
          else if (n.rating === 2) lineDash = [4, 4];
          else if (n.rating === 1) lineDash = [3, 5];
          
          if (n.status !== "triggered") {
            const domTheme = typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") : "dark";
            lineColor = domTheme === "matrix" ? "rgba(0, 255, 102, 0.55)" : domTheme === "light" || domTheme === "creamy" ? "rgba(217, 119, 6, 0.6)" : "rgba(251, 191, 36, 0.5)";
          } else {
            lineColor = "rgba(239, 83, 80, 0.25)";
          }
        }

        const startX = Math.max(n.x, 0);

        // Extended faint line to the left of the touch for priority alerts
        if (n.rating >= 2 && startX > 0) {
          ctx.strokeStyle = "rgba(128, 128, 128, 0.25)";
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
  symbol, tf, tick, alerts, barsCache, onAddAlert, onAddAlertLayer, onDeleteAlert, onMoveAlert, onRearmAlert, onRateAlert, onCreateChainAlert, onJoinChainAlert, indicators, onToggleIndicator, onAutoAlert,
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
  const biasPrimRef = useRef(null);   // BiasEnginePrimitive attached to the series
  const drawingManagerRef = useRef(null); // DrawingManager from lightweight-charts-drawing
  const barsRef = useRef([]);        // full bar array the detectors run on
  const [dataVersion, setDataVersion] = useState(0); // bumped on load + bar close
  const hoverPriceRef = useRef(null);
  const [barsDigits, setBarsDigits] = useState(null);
  // broker-reported digits (live tick) win; decimals seen in the bars are the fallback
  const digits = tick?.digits ?? barsDigits ?? 5;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bridgeOfflineInfo, setBridgeOfflineInfo] = useState(null);
  const [autoReconnectCountdown, setAutoReconnectCountdown] = useState(null);
  const [isAutoReconnecting, setIsAutoReconnecting] = useState(false);
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
  const staleStreakRef = useRef(0); // Tracks consecutive stale/offline occurrences to suppress false alarms

  const [chartReady, setChartReady] = useState(false);
  const [isScrolledLeft, setIsScrolledLeft] = useState(false);

  const fmt = useCallback((p) => Number(p).toFixed(digits), [digits]);

  // keep latest alerts accessible to the stable mousemove handler
  const alertsRef = useRef(alerts);
  useEffect(() => { alertsRef.current = alerts; }, [alerts]);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => {
      if (typeof window === "undefined") return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      setIsMobile(w <= 768 || (h <= 550 && w <= 1080));
    };
    check();
    const delayed = () => {
      check();
      setTimeout(check, 80);
      setTimeout(check, 250);
    };
    window.addEventListener('resize', delayed);
    window.addEventListener('orientationchange', delayed);
    screen?.orientation?.addEventListener?.('change', delayed);
    return () => {
      window.removeEventListener('resize', delayed);
      window.removeEventListener('orientationchange', delayed);
      screen?.orientation?.removeEventListener?.('change', delayed);
    };
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

    const isMobileScreen = typeof window !== "undefined" && (window.innerWidth <= 768 || (window.innerHeight <= 550 && window.innerWidth <= 1080));
    chart.applyOptions({
      layout: { 
        background: settings.bgType === "Solid" 
          ? { type: "solid", color: settings.bgColor } 
          : { type: "gradient", topColor: settings.bgGradientTop, bottomColor: settings.bgGradientBottom },
        textColor: settings.textColor,
        fontSize: isMobileScreen ? 8.5 : 10,
      },
      grid: { 
        vertLines: { color: settings.gridVertColor, visible: settings.gridVertEnabled !== false }, 
        horzLines: { color: settings.gridHorzColor, visible: settings.gridHorzEnabled !== false } 
      },
      // Note: watermark was moved to a plugin in LWC v5; skip here to avoid errors.
      timeScale: { 
        borderColor: settings.linesColor,
        rightOffset: isMobileScreen ? 6 : 12,
      },
      rightPriceScale: { 
        borderColor: settings.linesColor,
        scaleMargins: { top: 0.08, bottom: 0.08 },
        alignLabels: true,
      },
    });

    series.applyOptions({
      upColor: settings.upColor,
      downColor: settings.downColor,
      wickUpColor: settings.wickUpColor,
      wickDownColor: settings.wickDownColor,
      borderUpColor: settings.borderUpColor,
      borderDownColor: settings.borderDownColor,
      borderVisible: settings.borderVisible,
      priceFormat: {
        type: "custom",
        formatter: (price) => {
          if (price == null || !Number.isFinite(price)) return "";
          const abs = Math.abs(price);
          if (isMobileScreen) {
            if (abs >= 1000) {
              const s = Number(price).toFixed(2);
              return s.endsWith(".00") ? s.slice(0, -3) : s.endsWith("0") ? s.slice(0, -1) : s;
            }
            if (abs >= 100) {
              const s = Number(price).toFixed(2);
              return s.endsWith(".00") ? s.slice(0, -3) : s;
            }
          }
          return Number(price).toFixed(digits);
        },
      },
    });
  }, [settings, symbol, tf, digits]);

  // ---------- create chart once ----------
  useEffect(() => {
    let disposed = false;
    (async () => {
      const { createChart, CrosshairMode, CandlestickSeries } = await import("lightweight-charts");
      const { DrawingManager } = await import("lightweight-charts-drawing");
      if (disposed || !wrapRef.current) return;
      const isMobileInit = typeof window !== "undefined" && (window.innerWidth <= 768 || (window.innerHeight <= 550 && window.innerWidth <= 1080));
      const chart = createChart(wrapRef.current, {
        layout: { 
          background: settings.bgType === "Solid" 
            ? { type: "solid", color: settings.bgColor } 
            : { type: "gradient", topColor: settings.bgGradientTop, bottomColor: settings.bgGradientBottom },
          textColor: settings.textColor,
          fontSize: isMobileInit ? 8.5 : 10,
        },
        grid: { 
          vertLines: { color: settings.gridVertColor, visible: settings.gridVertEnabled !== false }, 
          horzLines: { color: settings.gridHorzColor, visible: settings.gridHorzEnabled !== false } 
        },
        crosshair: { mode: CrosshairMode.Normal },
        timeScale: { 
          rightOffset: isMobileInit ? 6 : 12, 
          timeVisible: true, 
          secondsVisible: false, 
          borderColor: settings.linesColor,
          tickMarkFormatter: (time, tickMarkType) => {
            const eet = getEetTime(time);
            const dateStr = getTradingDateString(time);
            const [year, monthNum, day] = dateStr ? dateStr.split("-") : ["", "", ""];
            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const month = monthNames[parseInt(monthNum, 10) - 1] || monthNum;
            const hh = String(eet.h).padStart(2, "0");
            const mm = String(eet.m).padStart(2, "0");

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
            const eet = getEetTime(time);
            const dateStr = getTradingDateString(time);
            const hh = String(eet.h).padStart(2, "0");
            const mm = String(eet.m).padStart(2, "0");
            return `${dateStr} ${hh}:${mm} EET`;
          },
        },
        rightPriceScale: { 
          borderColor: settings.linesColor,
          scaleMargins: { top: 0.08, bottom: 0.08 },
          alignLabels: true,
        },
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
        priceFormat: {
          type: "custom",
          minMove: Math.pow(10, -(digits || 5)),
          formatter: (price) => {
            if (price == null || !Number.isFinite(price)) return "";
            const abs = Math.abs(price);
            if (isMobileInit) {
              if (abs >= 1000) {
                const s = Number(price).toFixed(2);
                return s.endsWith(".00") ? s.slice(0, -3) : s.endsWith("0") ? s.slice(0, -1) : s;
              }
              if (abs >= 100) {
                const s = Number(price).toFixed(2);
                return s.endsWith(".00") ? s.slice(0, -3) : s;
              }
            }
            return Number(price).toFixed(digits);
          },
        },
      });
      
      const patterns = new PatternsPrimitive();
      series.attachPrimitive(patterns);
      patternsRef.current = patterns;
      
      const alertsPrim = new AlertsPrimitive();
      series.attachPrimitive(alertsPrim);
      alertsPrimRef.current = alertsPrim;

      const biasPrim = new BiasEnginePrimitive();
      series.attachPrimitive(biasPrim);
      biasPrimRef.current = biasPrim;

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
      patternsRef.current = null;
      alertsPrimRef.current = null;
      biasPrimRef.current = null;
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
  const fetchGenerationRef = useRef(0);
  const activeFetchKeyRef = useRef(`${symbol}:${tf}`);
  const lastSyncTimeRef = useRef(0);
  const lastClientActiveRef = useRef(Date.now());
  const retryTimerRef = useRef(null);
  const retryCountRef = useRef(0);

  const applyBars = useCallback((bars, isSilent = false, expectedKey = null) => {
    if (!seriesRef.current || !Array.isArray(bars) || !bars.length) return;
    const currentKey = `${symbol}:${tf}`;
    if (expectedKey && expectedKey !== currentKey) return; // Strict cross-symbol/tf isolation

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
      lastBarRef.current = { key: currentKey, bar: cleanBars[cleanBars.length - 1] };
      barsRef.current = cleanBars;
      setDataVersion((v) => v + 1);
      lastClientActiveRef.current = Date.now();
      retryCountRef.current = 0;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

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

      // Ensure drawings are redrawn after the time scale has applied the new range
      requestAnimationFrame(() => {
        drawingManagerRef.current?.redraw();
      });

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

  const loadBars = useCallback(async (key, genId, isSilent = false, forceRefresh = false) => {
    const [sym, curTf] = key.split(":");
    try {
      // Wait for seriesRef if chart is mounting
      for (let i = 0; i < 40 && !seriesRef.current; i++) {
        await new Promise((r) => setTimeout(r, 50));
        if (fetchGenerationRef.current !== genId) return;
      }
      if (fetchGenerationRef.current !== genId) return;

      const cached = barsCache.current.get(key);
      const hasExistingBars = Array.isArray(cached?.bars) && cached.bars.length > 0;

      // Smart bar counts:
      // - Silent background gap-heal / refresh: only 80 bars needed! (Transfers in ~10ms)
      // - Initial fresh load: 300 bars for LTF (M1-M15), 200 bars for HTF (H1-D1)
      let count = 300;
      if (isSilent && hasExistingBars && !forceRefresh) {
        count = 80;
      } else if (["M1", "M5", "M15"].includes(curTf)) {
        count = 300;
      } else if (["H1", "H4", "D1"].includes(curTf)) {
        count = 200;
      }

      // Robust retry: allows mobile connections and sleeping tabs to wake up smoothly
      let data = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (fetchGenerationRef.current !== genId) return;
        try {
          const res = await fetch(`/api/rates?symbol=${encodeURIComponent(sym)}&tf=${curTf}&count=${count}${forceRefresh ? "&refresh=1" : ""}`, { cache: "no-store" });
          if (res.ok) {
            data = await res.json();
            if (data?.ok && Array.isArray(data.bars) && data.bars.length > 0) break;
          }
        } catch (e) {
          if (attempt === 2) throw e;
        }
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }

      if (fetchGenerationRef.current !== genId) return;

      if (!data?.ok || !data.bars?.length) {
        if (cached?.bars?.length) {
          applyBars(cached.bars, false, key);
          const hasActiveTicks = lastClientActiveRef.current && (Date.now() - lastClientActiveRef.current < 25_000);
          staleStreakRef.current += 1;
          // Suppress false popup if ticks are active or on first transient failure
          if (staleStreakRef.current >= 2 && !hasActiveTicks) {
            setBridgeOfflineInfo({ message: data?.message || "Bridge offline", time: cached.at });
          } else {
            setTimeout(() => {
              if (fetchGenerationRef.current === genId) loadBars(key, genId, true, true);
            }, 1500);
          }
          setError(null);
          setLoading(false);
        } else if (!isSilent) {
          if (retryCountRef.current < 3) {
            retryCountRef.current += 1;
            retryTimerRef.current = setTimeout(() => {
              if (fetchGenerationRef.current === genId) loadBars(key, genId, false, forceRefresh);
            }, 2000);
          } else {
            setError(data?.message || data?.error || `No data for ${sym}`);
            setLoading(false);
          }
        }
        return;
      }

      let newBars = data.bars.map((b) => ({ time: b.t / 1000, open: b.o, high: b.h, low: b.l, close: b.c }));
      newBars = newBars.filter(b => b.close > 0 && b.high > 0 && b.low > 0 && b.high < b.low * 10);
      newBars = normalizeCandles(newBars, curTf);
      if (fetchGenerationRef.current !== genId) return;

      // Seamless delta stitching: merge delta bars with existing historical bars
      let finalBars = newBars;
      if (hasExistingBars && count < 200) {
        const timeMap = new Map();
        for (const b of cached.bars) timeMap.set(b.time, b);
        for (const b of newBars) timeMap.set(b.time, b);
        finalBars = Array.from(timeMap.values()).sort((a, b) => a.time - b.time);
      }

      barsCache.current.set(key, { at: Date.now(), bars: finalBars });
      lastSyncTimeRef.current = Date.now();
      lastClientActiveRef.current = Date.now();
      retryCountRef.current = 0;

      // Throttled persistence: keep only 8 recent symbols with 250 bars each
      if (typeof window !== "undefined") {
        clearTimeout(window._tsCacheSaveTimer);
        window._tsCacheSaveTimer = setTimeout(() => {
          try {
            const entries = Array.from(barsCache.current.entries())
              .sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0))
              .slice(0, 8);
            const slimCache = {};
            for (const [k, v] of entries) {
              slimCache[k] = { at: v.at, bars: (v.bars || []).slice(-250) };
            }
            localStorage.setItem("ts_bars_cache", JSON.stringify(slimCache));
          } catch (_) {}
        }, 3000);
      }

      applyBars(finalBars, isSilent, key);
      setError(null);
      if (data?.stale || data?.offline) {
        const hasActiveTicks = lastClientActiveRef.current && (Date.now() - lastClientActiveRef.current < 25_000);
        staleStreakRef.current += 1;
        // Suppress false popup if live ticks are actively streaming or if this is just a single transient hitch
        if (staleStreakRef.current >= 2 && !hasActiveTicks) {
          setBridgeOfflineInfo({ message: data?.error || "Bridge offline (serving cached bars)", time: cached?.at });
        } else {
          setTimeout(() => {
            if (fetchGenerationRef.current === genId) loadBars(key, genId, true, true);
          }, 1500);
        }
      } else {
        staleStreakRef.current = 0;
        setBridgeOfflineInfo(null);
        setAutoReconnectCountdown(null);
        setIsAutoReconnecting(false);
      }
    } catch (err) {
      if (fetchGenerationRef.current !== genId) return;
      const cached = barsCache.current.get(key);
      if (!isSilent) {
        if (cached?.bars?.length) {
          applyBars(cached.bars, false, key);
          const hasActiveTicks = lastClientActiveRef.current && (Date.now() - lastClientActiveRef.current < 25_000);
          staleStreakRef.current += 1;
          if (staleStreakRef.current >= 2 && !hasActiveTicks) {
            setBridgeOfflineInfo({ message: err.message || "Connection error", time: cached.at });
          } else {
            setTimeout(() => {
              if (fetchGenerationRef.current === genId) loadBars(key, genId, true, true);
            }, 1500);
          }
          setError(null);
          setLoading(false);
        } else if (retryCountRef.current < 3) {
          retryCountRef.current += 1;
          retryTimerRef.current = setTimeout(() => {
            if (fetchGenerationRef.current === genId) loadBars(key, genId, false);
          }, 2000);
        } else {
          setError(err.message || "Failed to load candles.");
          setLoading(false);
        }
      }
    }
  }, [barsCache, applyBars]);

  // Initial and symbol/tf change bar fetch with instantaneous visual isolation
  useEffect(() => {
    fetchGenerationRef.current += 1;
    const currentGen = fetchGenerationRef.current;
    const key = `${symbol}:${tf}`;
    activeFetchKeyRef.current = key;

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    const cached = barsCache.current.get(key);
    const cacheAge = cached?.at ? Date.now() - cached.at : Infinity;
    const hasBars = Array.isArray(cached?.bars) && cached.bars.length > 0;

    // Cache Freshness Tiers:
    // 1. FRESH (< 60s): 0ms INSTANT SWITCH. Cached bars are fresh; live ticks update the current candle.
    //    Zero network requests!
    if (hasBars && cacheAge < 60_000) {
      applyBars(cached.bars, false, key);
      setLoading(false);
      setError(null);
      return;
    }

    // 2. USABLE (< 30m): 0ms INSTANT SWITCH with SILENT BACKGROUND REFRESH.
    //    Render cached candles immediately so user never sees a spinner or blank screen.
    //    Then silently fetch fresh delta in background without resetting zoom.
    if (hasBars && cacheAge < 30 * 60_000) {
      applyBars(cached.bars, false, key);
      setLoading(false);
      setError(null);
      loadBars(key, currentGen, true, false);
      return;
    }

    // 3. COLD CACHE: clear stale candles from prior symbol, show clean spinner, and load initial bars
    lastBarRef.current = null;
    barsRef.current = [];
    setLoading(true);
    setError(null);
    if (seriesRef.current) seriesRef.current.setData([]);
    if (patternsRef.current) patternsRef.current.setDrawings([]);
    if (drawingManagerRef.current) {
      drawingManagerRef.current.list = (drawingManagerRef.current.list || []).filter(
        (d) => !String(d.id).startsWith("auto_")
      );
      drawingManagerRef.current.redraw();
    }

    loadBars(key, currentGen, false, false);

    return () => {
      fetchGenerationRef.current += 1;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [symbol, tf, barsCache, applyBars, loadBars]);

  // Reactive reload when broker symbol mapping is updated in settings
  useEffect(() => {
    const onMappingUpdated = () => {
      fetchGenerationRef.current += 1;
      const key = `${symbol}:${tf}`;
      loadBars(key, fetchGenerationRef.current, false, true);
    };
    window.addEventListener("ts_symbol_mapping_updated", onMappingUpdated);
    return () => window.removeEventListener("ts_symbol_mapping_updated", onMappingUpdated);
  }, [symbol, tf, loadBars]);

  const reconcileBackgroundGaps = useCallback((forceRefresh = false) => {
    const key = `${symbol}:${tf}`;
    if (activeFetchKeyRef.current !== key) return;
    loadBars(key, fetchGenerationRef.current, true, forceRefresh);
  }, [symbol, tf, loadBars]);

  // Automatic gap-healing when switching back to tab, focusing window, or unlocking screen
  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        const elapsedClientSec = (Date.now() - lastClientActiveRef.current) / 1000;
        // Only trigger gap-healing if user was away for at least 60s
        if (elapsedClientSec >= 60) {
          reconcileBackgroundGaps();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
    };
  }, [reconcileBackgroundGaps]);

  // Continuous background candle alignment loop:
  // Dynamically scaled by timeframe so we don't hammer the API when candles haven't even changed!
  useEffect(() => {
    const tfSec = TF_SEC[tf] || 300;
    // Scale interval with timeframe:
    // M1: 90s (1.5m) | M5: 180s (3m) | M15: 360s (6m) | H1+: 600s (10m)
    const intervalMs = Math.max(90_000, Math.min(tfSec * 600, 600_000));

    const timer = setInterval(() => {
      const now = Date.now();
      const timeSinceLastSync = now - lastSyncTimeRef.current;
      const isVisible = document.visibilityState === "visible";
      if (isVisible && timeSinceLastSync >= intervalMs) {
        reconcileBackgroundGaps();
      }
    }, 15_000);

    return () => clearInterval(timer);
  }, [tf, reconcileBackgroundGaps]);

  // Reconnection listener: when WebSocket reconnects or network comes online
  useEffect(() => {
    const onReconnect = () => {
      reconcileBackgroundGaps(true);
    };
    window.addEventListener("ts_ws_reconnected", onReconnect);
    window.addEventListener("online", onReconnect);
    return () => {
      window.removeEventListener("ts_ws_reconnected", onReconnect);
      window.removeEventListener("online", onReconnect);
    };
  }, [reconcileBackgroundGaps]);

  // Auto-reconnect watchdog: When MT5 bridge is offline or showing stale data,
  // automatically retry connection every 3 seconds in the background so the user
  // never has to manually click "Reconnect". As soon as fresh bars arrive,
  // the popup automatically dismisses itself and refreshes live!
  const autoReconnectTimerRef = useRef(null);

  useEffect(() => {
    if (!bridgeOfflineInfo) {
      if (autoReconnectTimerRef.current) {
        clearInterval(autoReconnectTimerRef.current);
        autoReconnectTimerRef.current = null;
      }
      setAutoReconnectCountdown(null);
      setIsAutoReconnecting(false);
      return;
    }

    let secondsLeft = 3;
    setAutoReconnectCountdown(secondsLeft);

    autoReconnectTimerRef.current = setInterval(async () => {
      secondsLeft -= 1;
      if (secondsLeft > 0) {
        setAutoReconnectCountdown(secondsLeft);
      } else {
        setAutoReconnectCountdown(0);
        setIsAutoReconnecting(true);
        const key = `${symbol}:${tf}`;
        try {
          await loadBars(key, fetchGenerationRef.current, true, true);
        } catch (e) {
          // ignore background errors; watchdog retries
        } finally {
          setIsAutoReconnecting(false);
          secondsLeft = 3;
          setAutoReconnectCountdown(secondsLeft);
        }
      }
    }, 1000);

    return () => {
      if (autoReconnectTimerRef.current) {
        clearInterval(autoReconnectTimerRef.current);
        autoReconnectTimerRef.current = null;
      }
    };
  }, [bridgeOfflineInfo, symbol, tf, loadBars]);

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
    lastClientActiveRef.current = Date.now();
    const price = tick.bid || tick.ask;
    if (!price) return;

    // Real-time heal: if live ticks are actively flowing, dismiss stale banner and reset streak
    staleStreakRef.current = 0;
    if (bridgeOfflineInfo) {
      setBridgeOfflineInfo(null);
      setAutoReconnectCountdown(null);
      setIsAutoReconnecting(false);
    }
    const sec = TF_SEC[tf] || 300;
    const rawTime = tick.time != null && tick.time > 0 ? tick.time : null;
    let tickSec = rawTime ? (rawTime > 1e11 ? Math.floor(rawTime / 1000) : rawTime) : entry.bar.time;
    // Ultra-defensive guard: if incoming tick has un-normalized broker naive time (+2h or +3h ahead of last bar), normalize to UTC
    if (tickSec && entry.bar && tickSec - entry.bar.time > 6500 && tickSec - entry.bar.time < 12000) {
      const offsetSec = getEetOffsetSec(tickSec);
      if (Math.abs(tickSec - offsetSec - entry.bar.time) < Math.max(sec * 10, 7200)) {
        tickSec -= offsetSec;
      }
    }
    const barTime = Math.floor(tickSec / sec) * sec;
    const last = entry.bar;
    const isNewBar = barTime > last.time;
    const gap = barTime - last.time;
    const isNextConsecutive = (tf === "D1" || tf === "1D")
      ? (gap >= 86400 && gap <= 86400 * 1.5)
      : (Math.abs(gap - sec) <= 2);

    // If a new candle arrives across a gap (e.g. background tab / session break / weekend):
    // Trigger background reconciliation to fetch intermediate bars, BUT never block the active candle!
    if (isNewBar && !isNextConsecutive) {
      const now = Date.now();
      if (now - lastSyncTimeRef.current > 2000) {
        reconcileBackgroundGaps();
      }
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
  }, [tick, symbol, tf, reconcileBackgroundGaps]);

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
    const currentDayKey = getTradingDayKey(new Date());
    const visibleAlerts = (alerts || []).filter(a => {
      if (a.note?.includes("[RR:")) return false;
      if (a.status === "triggered") {
        // Double removal: strictly show triggered alert lines from TODAY only
        const alertDayKey = getTradingDayKey(a.triggeredAt || a.updatedAt || a.createdAt);
        return alertDayKey === currentDayKey;
      }
      return true;
    });
    alertsPrimRef.current?.update(visibleAlerts, dragging, barsRef.current);
  }, [alerts, dragging, dataVersion]);

  // ---------- Bias Engine & Market Brain visual overlays ----------
  useEffect(() => {
    const prim = biasPrimRef.current;
    if (!prim) return;
    const isEnabled = indicators?.biasEngine !== false;
    const symBias = biasData?.symbols?.find((s) => s.symbol === symbol);
    prim.update(symBias, tf, barsRef.current, isEnabled, digits);
  }, [biasData, symbol, tf, dataVersion, indicators?.biasEngine, digits]);

  // ---------- autonomous trades overlay via DrawingManager (lightweight-charts-drawing native RR tool) ----------
  useEffect(() => {
    const mgr = drawingManagerRef.current;
    if (!mgr || !chartReady) return;

    const isEnabled = indicators?.autoTrades !== false;
    const isStagedEnabled = indicators?.stagedTrades !== false;
    const isRadarEnabled = indicators?.radarTrades !== false;
    const currentList = mgr.list || [];
    const userDrawings = currentList.filter((d) => !String(d.id).startsWith("auto_"));

    const sNorm = String(symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const isSymbolMatch = (item) => {
      if (!item || !sNorm) return false;
      const tNorm = String(item.symbol || item.canonicalSymbol || item.tradeableSymbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      return tNorm === sNorm;
    };

    const symAutoTrades = (autonomousTrades || []).filter(isSymbolMatch);
    const symRadarPairs = (radarPairs || []).filter(isSymbolMatch);

    const hasAutoTrades = symAutoTrades.length > 0;
    const hasRadarPairs = symRadarPairs.length > 0;

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

    for (const t of symAutoTrades) {
      if (!t) continue;
      const statusLower = String(t.status || "").toLowerCase();
      const isPendingLimit = ["pending", "placing", "resting"].includes(statusLower) || (Boolean(t.orderType === "limit" || t.isLimit) && !t.filledAt);
      const isOpenTrade = ["active", "managing", "open", "filling", "armed_fill"].includes(statusLower) || isPendingLimit;
      const isClosedTrade =
        !isOpenTrade &&
        (["closed_tp", "closed_sl", "closed_be", "closed"].includes(statusLower) ||
        Boolean(t.closedAt) ||
        Boolean(t.closeTime));

      if (isClosedTrade) {
        const closedTime = new Date(t.closedAt || t.closeTime || t.updatedAt || t.createdAt || t.entryTime || 0).getTime();
        closedList.push({ trade: t, time: Number.isFinite(closedTime) ? closedTime : 0 });
      } else if (["staged", "confirming", "armed"].includes(statusLower)) {
        stagedList.push(t);
      } else if (isPendingLimit) {
        // Pending limit orders are live resting orders: add to activeList; also add to stagedList as fallback if Live Trades toggle is off
        activeList.push(t);
        stagedList.push(t);
      } else {
        activeList.push(t);
      }
    }

    closedList.sort((a, b) => (b.time || 0) - (a.time || 0));

    // Deduplicate sibling legs (e.g. grouped legs with same groupId or symbol/dir/entry/sl)
    const deduplicateTrades = (list) => {
      const seen = new Set();
      const result = [];
      for (const t of list) {
        if (!t) continue;
        const entryKey = Number(t.entryPrice ?? t.levelDetails?.entry ?? 0).toFixed(5);
        const slKey = Number(t.initialSlPrice ?? t.slPrice ?? t.levelDetails?.sl ?? 0).toFixed(5);
        const key = t.groupId || `${t.symbol}_${t.dir}_${entryKey}_${slKey}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(t);
        }
      }
      return result;
    };

    const deduplicatedStagedList = deduplicateTrades(stagedList);
    const deduplicatedActiveList = deduplicateTrades(activeList);
    const liveAndStagedTrades = [...deduplicatedActiveList, ...deduplicatedStagedList];

    // Check if a raw radar trade idea has been superseded by an active or staged trade setup
    const isRadarPairCovered = (pair) => {
      if (!pair) return true;
      const pricing = resolveRadarTradeIdeaPricing(pair);
      if (!pricing.hasSetup) return true;

      const pSym = String(pair.symbol || pair.tradeableSymbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const pDir = pricing.dir;
      const pEntry = pricing.entry;
      const pModel = String(pair.entryModel?.id || pair.stagedLevel?.modelId || pair.modelId || "").toLowerCase();
      const pHorizon = String(pair.horizon || pair.scenario?.id || "").toLowerCase();

      // If an active live trade is already running on this symbol and direction, ALWAYS suppress raw radar idea
      if (deduplicatedActiveList.length > 0) {
        const hasActiveInDir = deduplicatedActiveList.some((t) => {
          const tDir = t.dir === -1 || String(t.direction || t.dirLabel).toLowerCase() === "sell" ? -1 : 1;
          return pDir === 0 || tDir === 0 || pDir === tDir;
        });
        if (hasActiveInDir) return true;
      }

      return liveAndStagedTrades.some((t) => {
        if (!t) return false;
        const tSym = String(t.canonicalSymbol || t.symbol || t.tradeableSymbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (tSym !== pSym) return false;

        const tDir = t.dir === -1 || String(t.direction || t.dirLabel).toLowerCase() === "sell" ? -1 : 1;
        if (pDir !== 0 && tDir !== 0 && pDir !== tDir) return false;

        // 1. Direct ID / Key matching
        if (t.radarKey && pair.radarKey && t.radarKey === pair.radarKey) return true;
        if (t.ideaId && pair.ideaId && t.ideaId === pair.ideaId) return true;
        if (t.thesisId && pair.thesisId && t.thesisId === pair.thesisId) return true;
        if (t.fingerprint && pair.fingerprint && t.fingerprint === pair.fingerprint) return true;

        // 2. Horizon matching
        const tHorizon = String(t.horizon || t.scenario?.id || "").toLowerCase();
        const horizonMatch = !pHorizon || !tHorizon || pHorizon === tHorizon;

        // 3. Model matching
        const tModel = String(t.modelId || t.entryModel?.id || "").toLowerCase();
        const modelMatch = !pModel || !tModel || pModel === tModel;

        // 4. Entry proximity match (within 2% price distance on same symbol & dir)
        const tEntry = Number(t.entryPrice ?? t.stagedPrice ?? t.levelDetails?.entry ?? 0);
        if (pEntry && tEntry > 0) {
          const diffPct = Math.abs(pEntry - tEntry) / tEntry;
          if (diffPct < 0.02) return true;
        }

        // 5. If same symbol, same direction and matching horizon: suppress raw radar idea
        if (horizonMatch) return true;

        // 6. Generic symbol + direction guard: suppress raw radar idea if trade is already staged/active in this direction
        return true;
      });
    };

    const chartTrades = [...deduplicatedActiveList, ...closedList.slice(0, 50).map((item) => item.trade)];

    const autoDrawings = isEnabled
      ? chartTrades
          .flatMap((t) => tradeToPositionDrawings(t, barsRef.current, tfSec, { includeMilestones: true }))
          .filter((d) => d && !isDismissed(d.id))
      : [];

    // Filter out staged trade if an active live trade is already running on this symbol & direction
    const unactiveStagedList = deduplicatedStagedList.filter((staged) => {
      if (!staged) return false;
      // If autoDrawings already rendered this exact trade, suppress duplicate staged drawing
      if (isEnabled && autoDrawings.some((d) => d.id === `auto_${staged._id || staged.id}`)) {
        return false;
      }
      const sDir = staged.dir === -1 || String(staged.direction || staged.dirLabel).toLowerCase() === "sell" ? -1 : 1;
      const hasActiveInDir = deduplicatedActiveList.some((act) => {
        if (act._id && staged._id && String(act._id) === String(staged._id)) return isEnabled;
        const aDir = act.dir === -1 || String(act.direction || act.dirLabel).toLowerCase() === "sell" ? -1 : 1;
        return aDir === sDir || sDir === 0;
      });
      return !hasActiveInDir;
    });

    const stagedDrawings = isStagedEnabled
      ? unactiveStagedList
          .flatMap((t, idx) => tradeToStagedPositionDrawings(t, barsRef.current, tfSec, idx))
          .filter((d) => d && !isDismissed(d.id))
      : [];

    const radarDrawings = isRadarEnabled
      ? symRadarPairs
          .filter((p) => !isRadarPairCovered(p))
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

    // Alerts are selected via explicit click (subscribeClick) or context menu.
    // We intentionally suppress hover-triggered badges over the Y-axis so the price
    // scale stays 100% clean, legible, and unhindered for vertical scaling.
    let hit = null;

    // Only show the "+" alert add button when pointer is on the chart canvas (not over the Y-axis)
    if (isYAxisArea && !isHoveringBtn) {
      pendingHoverRef.current = null;
    } else {
      pendingHoverRef.current = { y, price, time, isYAxisArea: false };
    }

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
          if (!last || last.y !== p.y || last.price !== p.price) {
            lastHoverRef.current = p;
            setHoverBtn(p);
          }
        } else if (lastHoverRef.current !== null) {
          lastHoverRef.current = null;
          setHoverBtn(null);
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
    const currentDayKey = getTradingDayKey(new Date());
    const nearAlerts = alerts.filter((a) => {
      if (a.note?.includes("[RR:")) return false;
      if (a.status === "triggered") {
        const alertDayKey = getTradingDayKey(a.triggeredAt || a.updatedAt || a.createdAt);
        if (alertDayKey !== currentDayKey) return false;
      }
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

  // ---------- maintain crosshair while hovering the add button ----------
  const wasForcingCrosshairRef = useRef(false);
  useEffect(() => {
    if (isHoveringBtn && hoverBtn && chartRef.current && seriesRef.current && hoverBtn.time) {
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
      const currentDayKey = getTradingDayKey(new Date());
      for (const a of alertsRef.current) {
        if (a.status === "triggered") {
          const alertDayKey = getTradingDayKey(a.triggeredAt || a.updatedAt || a.createdAt);
          if (alertDayKey !== currentDayKey) continue;
        }
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
      } else {
        setDragHandle(null);
        setLockedAlertId(null);
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
          setHoverBtn(null);
          if (!lockedAlertId) setDragHandle(null); 
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
          <button
            className="ghost"
            style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 6, padding: "4px 12px", fontSize: 11 }}
            onClick={() => loadBars(`${symbol}:${tf}`, fetchGenerationRef.current, false)}
          >
            Retry Connection
          </button>
        </div>
      )}

      {bridgeOfflineInfo && !loading && (
        <div
          style={{
            position: "absolute",
            top: 38,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 15,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "2px 8px",
            background: "rgba(234, 88, 12, 0.16)",
            border: "1px solid rgba(234, 88, 12, 0.35)",
            borderRadius: 9999,
            backdropFilter: "blur(6px)",
            color: "#fb923c",
            fontSize: 10,
            fontWeight: 600,
            lineHeight: 1,
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            pointerEvents: "auto",
            userSelect: "none",
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: isAutoReconnecting ? "#22c55e" : "#fb923c",
              animation: "pulse 1.2s infinite",
              flexShrink: 0,
            }}
          />
          <span>
            {isAutoReconnecting
              ? "Connecting..."
              : `MT5 Stale (${autoReconnectCountdown ?? 3}s)`}
          </span>
          <button
            className="ghost"
            disabled={isAutoReconnecting}
            style={{
              fontSize: 9,
              padding: "1px 5px",
              height: 16,
              minHeight: 16,
              lineHeight: "14px",
              border: "1px solid rgba(234, 88, 12, 0.45)",
              borderRadius: 3,
              opacity: isAutoReconnecting ? 0.5 : 0.9,
              cursor: isAutoReconnecting ? "wait" : "pointer",
              color: "#fdba74",
            }}
            onClick={() => loadBars(`${symbol}:${tf}`, fetchGenerationRef.current, false, true)}
            title="Reconnect immediately"
          >
            Retry
          </button>
        </div>
      )}

      {hoverBtn && !loading && !dragHandle && (
        <button
          className="primary alert-add-btn"
          onMouseEnter={() => setIsHoveringBtn(true)}
          onMouseLeave={() => setIsHoveringBtn(false)}
          style={{
            position: "absolute",
            right: (chartRef.current?.priceScale("right")?.width() || 65) + 4,
            top: hoverBtn.y,
            transform: "translateY(-50%)",
            zIndex: 20,
            fontWeight: 700,
            lineHeight: 1,
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
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onDeleteAlert(dragHandle.id);
                setDragHandle(null);
                setLockedAlertId(null);
              }}
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

      {/* Zoom & Settings corner controls */}
      <div 
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          height: 26,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
          padding: "0 3px",
          background: "transparent",
          userSelect: "none",
        }}
      >
        <button
          className="ghost"
          style={{
            padding: "2px 4px",
            height: 22,
            minWidth: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: zoomMenuOpen ? "var(--accent)" : "var(--muted)",
            borderRadius: 3,
            cursor: "pointer",
            background: "transparent",
            border: "none",
          }}
          title="Zoom Range"
          onClick={(e) => { e.stopPropagation(); setZoomMenuOpen(!zoomMenuOpen); }}
        >
          <ZoomIn size={13} />
        </button>
        {onOpenSettings && (
          <button
            className="ghost"
            style={{
              padding: "2px 4px",
              height: 22,
              minWidth: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--muted)",
              borderRadius: 3,
              cursor: "pointer",
              background: "transparent",
              border: "none",
            }}
            title="Chart & Theme Settings"
            onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
          >
            <Settings size={13} />
          </button>
        )}
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
