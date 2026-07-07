"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const TF_SEC = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };

function lineOpts(price, condition, status) {
  const isTriggered = status === "triggered";
  return {
    price,
    color: isTriggered ? "rgba(239, 83, 80, 0.5)" : "rgba(255, 152, 0, 0.5)",
    lineWidth: 1,
    lineStyle: 2, // dashed
    axisLabelVisible: false,
    title: `🔔 ${condition}`,
  };
}

export default function ChartPanel({ 
  symbol, tf, tick, alerts, barsCache, onAddAlert, onDeleteAlert, onMoveAlert, onRearmAlert,
  syncOpts, paneId, syncedLogicalRange, setSyncedLogicalRange, syncedCrosshair, setSyncedCrosshair 
}) {
  const wrapRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const lastBarRef = useRef(null);
  const priceLinesRef = useRef([]);            // array of {id, line}
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

  // ---------- create chart once ----------
  useEffect(() => {
    let disposed = false;
    (async () => {
      const { createChart, CrosshairMode } = await import("lightweight-charts");
      if (disposed || !wrapRef.current) return;
      const chart = createChart(wrapRef.current, {
        layout: { background: { color: "#0e1116" }, textColor: "#d7dce6" },
        grid: { vertLines: { color: "#151a23" }, horzLines: { color: "#151a23" } },
        crosshair: { mode: CrosshairMode.Normal },
        timeScale: { rightOffset: 12, timeVisible: true, secondsVisible: false, borderColor: "#232a38" },
        rightPriceScale: { borderColor: "#232a38" },
        watermark: {
          visible: true,
          fontSize: 64,
          horzAlign: 'center',
          vertAlign: 'center',
          color: 'rgba(255, 255, 255, 0.04)',
          text: `${symbol} ${tf}`,
        },
        autoSize: true,
      });
      const series = chart.addCandlestickSeries({
        upColor: "#26a69a", downColor: "#ef5350",
        wickUpColor: "#26a69a", wickDownColor: "#ef5350",
        borderVisible: false,
      });
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
        const res = await fetch(`/api/rates?symbol=${encodeURIComponent(symbol)}&tf=${tf}&count=600`, { cache: "no-store" });
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
    const nextBar = barTime > last.time
      ? { time: barTime, open: price, high: price, low: price, close: price }
      : { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
    lastBarRef.current = { key: entry.key, bar: nextBar };
    seriesRef.current.update(nextBar);
  }, [tick, symbol, tf]);

  // ---------- alert price lines ----------
  // Keep a {id -> line} map so a drag can update one line without rebuilding all.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const existing = new Map(priceLinesRef.current.map((p) => [p.id, p.line]));
    const next = [];

    for (const a of alerts) {
      // live price follows the pointer during an active drag
      const livePrice = dragging?.id === a._id ? dragging.price : a.price;
      let line = existing.get(a._id);
      if (line) {
        // reuse — but only re-create if price changed (createPriceLine has no setter)
        // lightweight-charts has no movePriceLine, so on price change we replace.
        // To keep this effect simple we replace whenever the price differs.
        series.removePriceLine(line);
        line = series.createPriceLine(lineOpts(livePrice, a.condition, a.status));
      } else {
        line = series.createPriceLine(lineOpts(livePrice, a.condition, a.status));
      }
      next.push({ id: a._id, line });
    }
    // drop lines for alerts that disappeared
    for (const [id, line] of existing) {
      if (!alerts.some((a) => a._id === id)) series.removePriceLine(line);
    }
    priceLinesRef.current = next;
  }, [alerts, loading, dragging]);

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

  return (
    <div
      style={{ flex: 1, position: "relative", minWidth: 0, cursor: dragHandle ? "ns-resize" : "default" }}
      onContextMenu={onContextMenu}
      onMouseMove={onMouseMove}
      onMouseLeave={() => { setHoverBtn(null); setDragHandle(null); }}
    >
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }} />

      {loading && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
          <div style={{ width: "70%", height: "55%", display: "flex", alignItems: "flex-end", gap: 6 }}>
            {Array.from({ length: 32 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ flex: 1, height: `${25 + ((i * 37) % 60)}%` }} />
            ))}
          </div>
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
