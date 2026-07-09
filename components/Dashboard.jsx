"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import TopBar from "./TopBar";
import ChartPanel from "./ChartPanel";
import Watchlist from "./Watchlist";
import AlertsPanel from "./AlertsPanel";
import SymbolPalette from "./SymbolPalette";
import AlertDialog from "./AlertDialog";
import ChecklistPanel from "./ChecklistPanel";
import SaveLayoutModal from "./SaveLayoutModal";
import { CheckSquare, Maximize2, Minimize2, Play, Pause, SkipBack, SkipForward, Square, ArrowUp, ArrowDown } from "lucide-react";
import BiasPanel from "./BiasPanel";
import MiniBiasHeader from "./MiniBiasHeader";
import ChartSettingsModal from "./ChartSettingsModal";
import { useChartSettings } from "../lib/chartSettings";

const api = async (path, opts) => {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return res.json();
};

function playAlertSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  try {
    const ctx = new AudioContext();
    const beeps = 5;
    for (let i = 0; i < beeps; i++) {
      const time = ctx.currentTime + i * 1.0;
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(880, time);
      osc1.frequency.exponentialRampToValueAtTime(440, time + 0.1);
      gain1.gain.setValueAtTime(0, time);
      gain1.gain.linearRampToValueAtTime(0.5, time + 0.05);
      gain1.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(time);
      osc1.stop(time + 0.2);
    }
  } catch (e) {}
}

function showBrowserNotification(alert) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification(`TradeSpace Alert: ${alert.symbol}`, {
    body: `${alert.condition} ${alert.price} triggered @ ${alert.triggeredPrice}`,
  });
}

export default function Dashboard() {
  const [isHydrated, setIsHydrated] = useState(false);
  const [panes, setPanes] = useState([{ id: 1, symbol: "EURUSD", tf: "M5" }]);
  const [activePaneId, setActivePaneId] = useState(1);
  const [fullScreenPaneId, setFullScreenPaneId] = useState(null);
  const [preFullScreenPanes, setPreFullScreenPanes] = useState(null);
  const [layout, setLayout] = useState("1"); // "1", "2v", "2h", "4", "6", "8"
  const [gridFractions, setGridFractions] = useState({ col: 50, row: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const [syncOpts, setSyncOpts] = useState({ symbol: false, tf: false, time: false, crosshair: false });
  const [watchlistOpen, setWatchlistOpen] = useState(true);
  const [symbolFlags, setSymbolFlags] = useState({}); // { symbol: "red" | "blue" | "green" | "yellow" }
  const [indicators, setIndicators] = useState({}); // { patternId: bool } — ƒx pattern toggles
  
  // Loop Mode State
  const [isLooping, setIsLooping] = useState(false);
  const [loopMenuOpen, setLoopMenuOpen] = useState(false);
  const [loopInterval, setLoopInterval] = useState(5000);
  const [loopColor, setLoopColor] = useState("red");

  const [alerts, setAlerts] = useState([]);
  const [watchlists, setWatchlists] = useState([]);
  const [activeListId, setActiveListId] = useState(null);
  const watchlistsRef = useRef(watchlists);
  const activeListIdRef = useRef(activeListId);
  useEffect(() => {
    watchlistsRef.current = watchlists;
    activeListIdRef.current = activeListId;
  }, [watchlists, activeListId]);
  const [ticks, setTicks] = useState({}); // SYM -> {bid, ask, digits, dir}
  const [connected, setConnected] = useState(false);
  const [palette, setPalette] = useState(null); // null | "switch" | "add"
  const [alertDraft, setAlertDraft] = useState(null); // {price} | null
  const [toast, setToast] = useState(null);
  const [alertsOpen, setAlertsOpen] = useState(false); // Global modal now
  const [marketBiasOpen, setMarketBiasOpen] = useState(false);
  const [biasEnabled, setBiasEnabled] = useState(false); // default off to save RAM on RDP

  const [savedLayouts, setSavedLayouts] = useState([]);
  const [saveLayoutOpen, setSaveLayoutOpen] = useState(false);
  const [activeNotesSymbol, setActiveNotesSymbol] = useState(null);
  const [notesPanelData, setNotesPanelData] = useState({ checklist: [], notes: "" });

  const wsRef = useRef(null);
  const symbolsRef = useRef([]); 
  const barsCache = useRef(new Map()); // `${sym}:${tf}` -> { bars, at }
  const toastTimer = useRef(null);

  const [syncedLogicalRange, setSyncedLogicalRange] = useState(null);
  const [syncedCrosshair, setSyncedCrosshair] = useState(null);
  const [chartSettingsOpen, setChartSettingsOpen] = useState(false);
  const [settings] = useChartSettings();

  // ---------- boot: restore prefs ----------
  useEffect(() => {
    const syncFromStorage = () => {
      try {
        const p = localStorage.getItem("ts_panes");
        if (p) {
          const parsed = JSON.parse(p);
          if (parsed.length) setPanes(parsed);
        }
        const l = localStorage.getItem("ts_layout");
        if (l) setLayout(l);
        const gf = localStorage.getItem("ts_grid_fractions");
        if (gf) setGridFractions(JSON.parse(gf));
        const s = localStorage.getItem("ts_sync");
        if (s) setSyncOpts(JSON.parse(s));
        const w = localStorage.getItem("ts_watchlist_open");
        if (w) setWatchlistOpen(w === "true");
        const f = localStorage.getItem("ts_symbol_flags");
        if (f) setSymbolFlags(JSON.parse(f));
        const ind = localStorage.getItem("ts_indicators");
        if (ind) setIndicators(JSON.parse(ind));
        const lid = localStorage.getItem("ts_loaded_layout_id");
        if (lid) setLoadedLayoutId(lid);
        const be = localStorage.getItem("ts_bias_enabled");
        if (be !== null) setBiasEnabled(be === "true");

        const bc = localStorage.getItem("ts_bars_cache");
        if (bc) {
          const parsed = JSON.parse(bc);
          for (const [k, v] of Object.entries(parsed)) barsCache.current.set(k, v);
        }
      } catch {}
    };

    syncFromStorage();
    setIsHydrated(true);
    window.addEventListener("storage", syncFromStorage);

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    
    return () => window.removeEventListener("storage", syncFromStorage);
  }, []);

  // ---------- App Theme Sync ----------
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.body.setAttribute("data-theme", settings.appTheme || "dark");
    }
  }, [settings.appTheme]);

  // Sync state to local storage
  // PiP State
  const [pipWindow, setPipWindow] = useState(null);

  const openPip = async () => {
    if (!("documentPictureInPicture" in window)) {
      showToast("Picture-in-Picture API not supported on this browser (use Chrome/Edge 116+).");
      return;
    }
    try {
      const pip = await window.documentPictureInPicture.requestWindow({
        width: 1000,
        height: 700,
      });

      // Copy stylesheets
      [...document.styleSheets].forEach((styleSheet) => {
        try {
          const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
          const style = document.createElement('style');
          style.textContent = cssRules;
          pip.document.head.appendChild(style);
        } catch (e) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.type = styleSheet.type;
          link.media = styleSheet.media;
          link.href = styleSheet.href;
          pip.document.head.appendChild(link);
        }
      });
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/index.css';
      pip.document.head.appendChild(link);

      pip.addEventListener("pagehide", () => {
        setPipWindow(null);
      });
      setPipWindow(pip);
    } catch (err) {
      console.error("PiP error:", err);
      showToast("Failed to open floating window.");
    }
  };

  useEffect(() => { if (isHydrated) localStorage.setItem("ts_panes", JSON.stringify(panes)); }, [panes, isHydrated]);
  useEffect(() => { if (isHydrated) localStorage.setItem("ts_layout", layout); }, [layout, isHydrated]);
  useEffect(() => { if (isHydrated) localStorage.setItem("ts_grid_fractions", JSON.stringify(gridFractions)); }, [gridFractions, isHydrated]);
  useEffect(() => { if (isHydrated) localStorage.setItem("ts_sync", JSON.stringify(syncOpts)); }, [syncOpts, isHydrated]);
  useEffect(() => { if (isHydrated) localStorage.setItem("ts_watchlist_open", String(watchlistOpen)); }, [watchlistOpen, isHydrated]);
  useEffect(() => { if (isHydrated) localStorage.setItem("ts_symbol_flags", JSON.stringify(symbolFlags)); }, [symbolFlags, isHydrated]);
  useEffect(() => { if (isHydrated) localStorage.setItem("ts_indicators", JSON.stringify(indicators)); }, [indicators, isHydrated]);

  // ---------- Keyboard Shortcuts ----------
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        toggleFullscreen(activePaneId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePaneId, fullScreenPaneId, panes, preFullScreenPanes]);

  // ---------- Loop Mode Logic ----------
  const loopSymbols = useMemo(() => {
    return Object.keys(symbolFlags).filter(sym => symbolFlags[sym] === loopColor);
  }, [symbolFlags, loopColor]);

  useEffect(() => {
    if (!isLooping || layout !== "1" || loopSymbols.length === 0) return;
    const interval = setInterval(() => {
      setPanes(prev => {
        const currentSym = prev[0].symbol;
        const currentIndex = loopSymbols.indexOf(currentSym);
        const nextIndex = (currentIndex + 1) % loopSymbols.length;
        return [{ ...prev[0], symbol: loopSymbols[nextIndex] }];
      });
    }, loopInterval);
    return () => clearInterval(interval);
  }, [isLooping, layout, loopSymbols, loopInterval]);

  const loopPrev = () => {
    if (loopSymbols.length === 0) return;
    setPanes(prev => {
      const currentSym = prev[0].symbol;
      const currentIndex = loopSymbols.indexOf(currentSym);
      const prevIndex = (currentIndex - 1 + loopSymbols.length) % loopSymbols.length;
      return [{ ...prev[0], symbol: loopSymbols[prevIndex] }];
    });
  };

  const loopNext = () => {
    if (loopSymbols.length === 0) return;
    setPanes(prev => {
      const currentSym = prev[0].symbol;
      const currentIndex = loopSymbols.indexOf(currentSym);
      const nextIndex = (currentIndex + 1) % loopSymbols.length;
      return [{ ...prev[0], symbol: loopSymbols[nextIndex] }];
    });
  };

  // ---------- WebSockets Subscriptions ----------
  useEffect(() => {
    const unique = [...new Set(panes.map(p => p.symbol))];
    symbolsRef.current = unique;
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "subscribe", symbols: unique }));
    }
  }, [panes]);

  const showToast = useCallback((text) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const loadAlerts = useCallback(async () => {
    const data = await api("/api/alerts");
    if (data.ok) setAlerts(data.alerts);
  }, []);

  const loadWatchlists = useCallback(async () => {
    const data = await api("/api/watchlists");
    if (data.ok) {
      setWatchlists(data.watchlists);
      setActiveListId((prev) =>
        data.watchlists.some((w) => w._id === prev) ? prev : data.watchlists[0]?._id ?? null
      );
    }
  }, []);

  const [loadedLayoutId, setLoadedLayoutId] = useState(null);

  useEffect(() => {
    if (loadedLayoutId) localStorage.setItem("ts_loaded_layout_id", loadedLayoutId);
    else localStorage.removeItem("ts_loaded_layout_id");
  }, [loadedLayoutId]);
  const [biasData, setBiasData] = useState(null);
  const [biasLoading, setBiasLoading] = useState(false);

  const loadSavedLayouts = useCallback(async () => {
    const data = await api("/api/layouts");
    if (data.ok) {
      setSavedLayouts(data.layouts);
      // ONLY load default if no recent panes were restored (e.g. fresh start)
      if (!localStorage.getItem("ts_panes")) {
        const defId = localStorage.getItem("ts_default_layout_id");
        if (defId) {
          const l = data.layouts.find((x) => x._id === defId);
          if (l) {
            setLayout(l.layoutMode);
            setPanes(l.panes);
            if (l.gridFractions) setGridFractions(l.gridFractions);
            if (l.syncOpts) setSyncOpts(l.syncOpts);
            setActivePaneId(l.panes[0]?.id || 1);
            setLoadedLayoutId(defId);
          }
        }
      }
    }
  }, []);

  // bias engine scope: active watchlist ∪ open panes
  const biasSymbols = useMemo(() => {
    const list = watchlists.find((w) => w._id === activeListId);
    return [...new Set([...(list?.symbols || []), ...panes.map((p) => p.symbol)])].sort();
  }, [watchlists, activeListId, panes]);

  const loadBias = useCallback(async () => {
    if (!biasEnabled || !biasSymbols.length) {
      setBiasData(null);
      return;
    }
    setBiasLoading(true);
    try {
      const data = await api(`/api/bias?symbols=${encodeURIComponent(biasSymbols.join(","))}`);
      if (data.ok) setBiasData(data);
    } catch {}
    setBiasLoading(false);
  }, [biasEnabled, biasSymbols.join(",")]);

  useEffect(() => {
    loadAlerts();
    loadWatchlists();
    loadSavedLayouts();
  }, [loadAlerts, loadWatchlists, loadSavedLayouts]);

  useEffect(() => {
    loadBias();
    const t = setInterval(loadBias, 90000);
    return () => clearInterval(t);
  }, [loadBias]);

  // ---------- websocket connect ----------
  useEffect(() => {
    let dead = false;
    let sock;
    const connect = () => {
      if (dead) return;
      sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      wsRef.current = sock;
      sock.onopen = () => {
        setConnected(true);
        sock.send(JSON.stringify({ type: "subscribe", symbols: symbolsRef.current }));
      };
      sock.onclose = () => {
        setConnected(false);
        if (!dead) setTimeout(connect, 2000);
      };
      sock.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "ticks") {
          setTicks((prev) => {
            const nextTicks = { ...prev };
            for (const [sym, t] of Object.entries(msg.ticks)) {
              const old = prev[sym];
              nextTicks[sym] = {
                ...t,
                dir: old ? Math.sign(t.bid - old.bid) || old.dir || 0 : 0,
              };
            }
            return nextTicks;
          });
        }
        if (msg.type === "alerts_changed") loadAlerts();
        if (msg.type === "watchlists_changed") loadWatchlists();
        if (msg.type === "alert_triggered") {
          loadAlerts();
          
          // Only notify if the symbol is in the active watchlist
          const activeList = watchlistsRef.current.find(w => w._id === activeListIdRef.current);
          const inWatchlist = activeList?.symbols?.includes(msg.alert.symbol);
          
          if (inWatchlist) {
            showToast(`🔔 ${msg.alert.symbol} ${msg.alert.condition} ${msg.alert.price} triggered @ ${msg.alert.triggeredPrice}`);
            playAlertSound();
            showBrowserNotification(msg.alert);
          }
        }
      };
    };
    connect();
    return () => { dead = true; sock?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Multi-Pane Logic ----------
  const activePane = panes.find(p => p.id === activePaneId) || panes[0];
  const symbol = activePane.symbol;
  const tf = activePane.tf;

  const changeSymbol = (newSym) => {
    if (fullScreenPaneId) {
      setPanes(prev => prev.map(p => p.id === fullScreenPaneId ? { ...p, symbol: newSym } : p));
    } else if (syncOpts.symbol) {
      setPanes(prev => prev.map(p => ({ ...p, symbol: newSym })));
    } else {
      setPanes(prev => prev.map(p => p.id === activePaneId ? { ...p, symbol: newSym } : p));
    }
  };

  const changeTf = (newTf) => {
    if (fullScreenPaneId) {
      setPanes(prev => prev.map(p => p.id === fullScreenPaneId ? { ...p, tf: newTf } : p));
    } else if (syncOpts.tf) {
      setPanes(prev => prev.map(p => ({ ...p, tf: newTf })));
    } else {
      setPanes(prev => prev.map(p => p.id === activePaneId ? { ...p, tf: newTf } : p));
    }
  };

  const handleNavUp = () => {
    const idx = panes.findIndex(p => p.id === activePaneId);
    if (idx > 0) {
      const nextId = panes[idx - 1].id;
      setActivePaneId(nextId);
      setTimeout(() => {
        document.getElementById(`pane-${nextId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 10);
    }
  };

  const handleNavDown = () => {
    const idx = panes.findIndex(p => p.id === activePaneId);
    if (idx < panes.length - 1) {
      const nextId = panes[idx + 1].id;
      setActivePaneId(nextId);
      setTimeout(() => {
        document.getElementById(`pane-${nextId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 10);
    }
  };

  const toggleFullscreen = (id) => {
    if (fullScreenPaneId) {
      if (preFullScreenPanes) setPanes(preFullScreenPanes);
      setFullScreenPaneId(null);
      setPreFullScreenPanes(null);
    } else {
      setPreFullScreenPanes(panes);
      setFullScreenPaneId(id);
      setActivePaneId(id);
    }
  };

  const changeLayout = (newLayout) => {
    let required = 1;
    if (newLayout === "2v" || newLayout === "2h") required = 2;
    if (newLayout === "4") required = 4;
    if (newLayout === "6") required = 6;
    if (newLayout === "8") required = 8;
    
    setPanes(prev => {
      const next = [...prev];
      while (next.length < required) {
        next.push({ id: Math.max(0, ...next.map(p => p.id)) + 1, symbol: next[0].symbol, tf: next[0].tf });
      }
      return next.slice(0, required);
    });
    setLayout(newLayout);
    if (fullScreenPaneId) toggleFullscreen(fullScreenPaneId);
  };

  const saveLayout = async ({ name, includeSync }) => {
    const data = await api("/api/layouts", {
      method: "POST",
      body: JSON.stringify({
        name,
        layoutMode: layout,
        panes,
        gridFractions,
        syncOpts: includeSync ? syncOpts : undefined,
        drawings: localStorage.getItem("ts_drawings") || "{}"
      })
    });
    if (data.ok) {
      setSavedLayouts(data.layouts);
      const newlyCreated = data.layouts[data.layouts.length - 1];
      if (newlyCreated) setLoadedLayoutId(newlyCreated._id);
      showToast("Layout saved");
    } else {
      showToast("Failed to save layout");
    }
    setSaveLayoutOpen(false);
  };

  const onLoadLayout = (id) => {
    const l = savedLayouts.find(x => x._id === id);
    if (!l) return;
    if (fullScreenPaneId) toggleFullscreen(fullScreenPaneId);
    setLayout(l.layoutMode);
    setPanes(l.panes);
    if (l.gridFractions) setGridFractions(l.gridFractions);
    if (l.syncOpts) setSyncOpts(l.syncOpts);
    if (l.drawings) {
      localStorage.setItem("ts_drawings", l.drawings);
      window.dispatchEvent(new Event("storage"));
    }
    setActivePaneId(l.panes[0]?.id || 1);
    setLoadedLayoutId(id);
    showToast(`Loaded layout: ${l.name}`);
  };

  const updateLayout = async (id) => {
    const data = await api(`/api/layouts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ layoutMode: layout, panes, gridFractions, syncOpts, drawings: localStorage.getItem("ts_drawings") || "{}" })
    });
    if (data.ok) {
      setSavedLayouts(data.layouts);
      showToast("Layout updated");
    } else {
      showToast("Update failed");
    }
  };

  const deleteLayout = async (id) => {
    if (!window.confirm("Delete this layout?")) return;
    const data = await api(`/api/layouts/${id}`, { method: "DELETE" });
    if (data.ok) {
      setSavedLayouts(data.layouts);
      if (loadedLayoutId === id) setLoadedLayoutId(null);
      if (defaultLayoutId === id) setDefaultLayoutId(null);
      showToast("Layout deleted");
    }
  };

  const renameLayout = async (id, currentName) => {
    const newName = window.prompt("New name for layout:", currentName);
    if (!newName || newName.trim() === currentName) return;
    const data = await api(`/api/layouts/${id}`, { method: "PATCH", body: JSON.stringify({ name: newName.trim() }) });
    if (data.ok) {
      setSavedLayouts(data.layouts);
      showToast("Layout renamed");
    }
  };

  const openNotesPanel = async (symbol) => {
    setActiveNotesSymbol(symbol);
    const data = await api(`/api/symbols/${encodeURIComponent(symbol)}/notes`);
    if (data.ok) setNotesPanelData({ checklist: data.checklist || [], notes: data.notes || "" });
  };

  const saveNotesPanel = async ({ checklist, notes }) => {
    if (!activeNotesSymbol) return;
    await api(`/api/symbols/${encodeURIComponent(activeNotesSymbol)}/notes`, { method: "PUT", body: JSON.stringify({ checklist, notes }) });
  };

  // ---------- alert actions ----------
  const createAlert = useCallback(async (draft) => {
    const data = await api("/api/alerts", { method: "POST", body: JSON.stringify(draft) });
    if (data.ok) {
      showToast(`Alert set: ${draft.symbol} ${draft.condition} ${draft.price}`);
      loadAlerts();
    } else {
      showToast(`Failed: ${data.error}`);
    }
    setAlertDraft(null);
  }, [loadAlerts, showToast]);

  const deleteAlert = useCallback(async (id) => {
    await api(`/api/alerts/${id}`, { method: "DELETE" });
    loadAlerts();
  }, [loadAlerts]);

  const rearmAlert = useCallback(async (id) => {
    await api(`/api/alerts/${id}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) });
    loadAlerts();
  }, [loadAlerts]);

  const moveAlert = useCallback(async (id, price) => {
    setAlerts((prev) => prev.map((a) => (a._id === id ? { ...a, price } : a)));
    const data = await api(`/api/alerts/${id}`, { method: "PATCH", body: JSON.stringify({ price }) });
    if (!data.ok) showToast("Move failed — reverting");
    loadAlerts();
  }, [loadAlerts, showToast]);

  // ---------- auto-alerts from pattern detectors (e.g. AMD) ----------
  // Deduped by a tag embedded in the note: once per symbol/day/side, across
  // panes, timeframes, reloads (existing alerts are checked) and this session.
  const alertsRef = useRef([]);
  useEffect(() => { alertsRef.current = alerts; }, [alerts]);
  const autoAlertTags = useRef(new Set());

  const handleAutoAlert = useCallback(async (sug) => {
    const tag = `[AMD:${sug.symbol}:${sug.tagPart}]`;
    if (autoAlertTags.current.has(tag)) return;
    autoAlertTags.current.add(tag);
    if (alertsRef.current.some((a) => a.note && a.note.includes(tag))) return;
    const note = `${sug.noteBase} ${tag}`.slice(0, 200);
    const price = Number(sug.price.toFixed(6));
    const data = await api("/api/alerts", {
      method: "POST",
      body: JSON.stringify({ symbol: sug.symbol, price, condition: sug.condition, note }),
    });
    if (data.ok) {
      showToast(`🤖 AMD auto-alert: ${sug.symbol} ${sug.condition} ${price}`);
      loadAlerts();
    }
  }, [loadAlerts, showToast]);

  // ---------- watchlist actions ----------
  const createWatchlist = useCallback(async (name) => {
    const data = await api("/api/watchlists", { method: "POST", body: JSON.stringify({ name }) });
    if (data.ok) {
      setWatchlists(data.watchlists);
      const created = data.watchlists[data.watchlists.length - 1];
      if (created) setActiveListId(created._id);
    }
  }, []);

  const renameWatchlist = useCallback(async (id, name) => {
    const data = await api(`/api/watchlists/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
    if (data.ok) setWatchlists(data.watchlists);
  }, []);

  const deleteWatchlist = useCallback(async (id) => {
    const data = await api(`/api/watchlists/${id}`, { method: "DELETE" });
    if (data.ok) {
      setWatchlists(data.watchlists);
      setActiveListId((prev) => (prev === id ? data.watchlists[0]?._id ?? null : prev));
    }
  }, []);

  const addSymbolToList = useCallback(async (listId, sym) => {
    const data = await api(`/api/watchlists/${listId}/symbols`, { method: "POST", body: JSON.stringify({ symbol: sym }) });
    if (data.ok) { setWatchlists(data.watchlists); showToast(`Added ${sym}`); }
  }, [showToast]);

  const removeSymbolFromList = useCallback(async (listId, sym) => {
    const data = await api(`/api/watchlists/${listId}/symbols/${encodeURIComponent(sym)}`, { method: "DELETE" });
    if (data.ok) setWatchlists(data.watchlists);
  }, []);

  // ---------- keyboard: Ctrl+K / "/" opens palette ----------
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette("switch"); }
      else if (e.key === "/" && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        e.preventDefault(); setPalette("switch");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------- render helpers ----------
  const cX = gridFractions.col;
  const cY = gridFractions.row;
  let gridStyle = { 
    flex: 1, display: "grid", gap: "1px", background: "var(--border)", minHeight: 0,
    transition: isDragging ? "none" : "grid-template-columns 0.2s, grid-template-rows 0.2s"
  };
  
  if (fullScreenPaneId) {
    gridStyle.gridTemplateColumns = "100%";
    gridStyle.gridTemplateRows = "100%";
  } else if (layout === "1") {
    gridStyle.gridTemplateColumns = "100%";
    gridStyle.gridTemplateRows = "100%";
  } else if (layout === "2v") {
    gridStyle.gridTemplateColumns = `${cX}% ${100 - cX}%`;
    gridStyle.gridTemplateRows = "100%";
  } else if (layout === "2h") {
    gridStyle.gridTemplateColumns = "100%";
    gridStyle.gridTemplateRows = `${cY}% ${100 - cY}%`;
  } else if (layout === "4") {
    gridStyle.gridTemplateColumns = `${cX}% ${100 - cX}%`;
    gridStyle.gridTemplateRows = `${cY}% ${100 - cY}%`;
  } else if (layout === "6") {
    gridStyle.gridTemplateColumns = "1fr 1fr 1fr";
    gridStyle.gridTemplateRows = "1fr 1fr";
  } else if (layout === "8") {
    gridStyle.gridTemplateColumns = "1fr 1fr 1fr 1fr";
    gridStyle.gridTemplateRows = "1fr 1fr";
  }

  // Define splitters
  const onDragStart = (e, type) => {
    e.preventDefault();
    setIsDragging(true);
    const startPos = type === "col" ? e.clientX : e.clientY;
    const startFrac = gridFractions[type];
    const container = e.target.parentElement;
    const size = type === "col" ? container.clientWidth : container.clientHeight;

    const onMove = (ev) => {
      const delta = type === "col" ? ev.clientX - startPos : ev.clientY - startPos;
      const deltaFrac = (delta / size) * 100;
      const newFrac = Math.max(10, Math.min(90, startFrac + deltaFrac));
      setGridFractions(p => ({ ...p, [type]: newFrac }));
    };

    const onUp = () => {
      setIsDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="dashboard-root" style={{ display: "flex", flexDirection: "column" }}>
      <TopBar
        symbol={symbol}
        tf={tf}
        setTf={changeTf}
        tick={ticks[symbol]}
        connected={connected}
        onOpenPalette={() => setPalette("switch")}
        onAddAlert={() => setAlertDraft({ price: ticks[symbol]?.bid ?? "" })}
        onOpenAlerts={() => setAlertsOpen(true)}
        onOpenMarketBias={() => setMarketBiasOpen(true)}
        biasEnabled={biasEnabled}
        onToggleBias={() => {
          const next = !biasEnabled;
          setBiasEnabled(next);
          localStorage.setItem("ts_bias_enabled", next);
        }}
        activeAlertCount={alerts.filter((a) => a.status === "active").length}
        onOpenPip={openPip}
        isPipActive={!!pipWindow}
        layout={layout}
        setLayout={changeLayout}
        syncOpts={syncOpts}
        setSyncOpts={setSyncOpts}
        watchlistOpen={watchlistOpen}
        setWatchlistOpen={setWatchlistOpen}
        savedLayouts={savedLayouts}
        onLoadLayout={onLoadLayout}
        onOpenSaveLayout={() => setSaveLayoutOpen(true)}
        onOpenLoop={() => { setLoopMenuOpen(true); setIsLooping(true); }}
        indicators={indicators}
        setIndicators={setIndicators}
        loadedLayoutId={loadedLayoutId}
        onUpdateLayout={updateLayout}
        onRenameLayout={renameLayout}
        onDeleteLayout={deleteLayout}
      />
      <div className="layout-row" style={{position: "relative"}}>
        {activeNotesSymbol && (
          <ChecklistPanel 
            symbol={activeNotesSymbol} 
            items={notesPanelData.checklist} 
            notes={notesPanelData.notes} 
            onSave={saveNotesPanel} 
            onClose={() => setActiveNotesSymbol(null)} 
          />
        )}

        {(() => {
          const gridNode = (
            <div className={`responsive-chart-grid ${layout === "1" ? "single-chart" : ""}`} style={{ ...gridStyle, height: pipWindow ? "100vh" : gridStyle.height }}>
              {panes.map((pane) => {
                if (fullScreenPaneId && pane.id !== fullScreenPaneId) return null;
                const symBias = biasData?.symbols?.find((s) => s.symbol === pane.symbol);
                const catBias = biasData?.categories?.find((c) => c.members.includes(pane.symbol));
                return (
                  <div 
                    id={`pane-${pane.id}`}
                    key={pane.id} 
                    onClick={() => setActivePaneId(pane.id)}
                    onDoubleClick={() => toggleFullscreen(pane.id)}
                    style={{
                      position: "relative",
                      display: "flex",
                      flexDirection: "column",
                      minWidth: 0,
                      minHeight: 0,
                      background: "var(--bg)",
                      boxShadow: (panes.length > 1 && activePaneId === pane.id) ? "inset 0 0 0 2px var(--accent)" : "none",
                      zIndex: activePaneId === pane.id ? 2 : 1
                    }}
                  >
                    {loopMenuOpen && layout === "1" ? (
                      <div className="loop-controller" style={{ position: "absolute", top: 8, left: 12, right: 12, zIndex: 10, display: "flex", gap: 8, alignItems: "center", background: "var(--panel)", padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", boxShadow: "0 4px 12px rgba(0,0,0,0.5)", overflowX: "auto" }}>
                        <select 
                          value={loopColor} 
                          onChange={e => setLoopColor(e.target.value)}
                          style={{ background: "transparent", border: "none", color: "var(--text)", outline: "none", fontSize: 12, marginRight: 4, cursor: "pointer" }}
                        >
                          <option value="red" style={{color: "#000"}}>Red Flags</option>
                          <option value="blue" style={{color: "#000"}}>Blue Flags</option>
                          <option value="green" style={{color: "#000"}}>Green Flags</option>
                          <option value="yellow" style={{color: "#000"}}>Yellow Flags</option>
                        </select>
                        <button className="ghost" onClick={loopPrev} title="Previous" style={{padding: "4px"}}><SkipBack size={16} /></button>
                        <button className={isLooping ? "primary" : "ghost"} onClick={() => setIsLooping(!isLooping)} title={isLooping ? "Pause" : "Play"} style={{padding: "4px 8px"}}>
                          {isLooping ? <Pause size={16} /> : <Play size={16} />}
                        </button>
                        <button className="ghost" onClick={loopNext} title="Next" style={{padding: "4px"}}><SkipForward size={16} /></button>
                        <button className="ghost" onClick={() => { setIsLooping(false); setLoopMenuOpen(false); }} title="Stop" style={{padding: "4px", color: "var(--orange)"}}><Square size={16} /></button>
                        <div style={{ width: 1, height: 16, background: "var(--border)", margin: "0 4px" }} />
                        <select 
                          value={loopInterval} 
                          onChange={e => setLoopInterval(Number(e.target.value))}
                          style={{ background: "transparent", border: "none", color: "var(--text)", outline: "none", fontSize: 12, cursor: "pointer" }}
                        >
                          <option value={3000} style={{color: "#000"}}>3s</option>
                          <option value={5000} style={{color: "#000"}}>5s</option>
                          <option value={10000} style={{color: "#000"}}>10s</option>
                          <option value={15000} style={{color: "#000"}}>15s</option>
                          <option value={20000} style={{color: "#000"}}>20s</option>
                          <option value={30000} style={{color: "#000"}}>30s</option>
                          <option value={45000} style={{color: "#000"}}>45s</option>
                          <option value={60000} style={{color: "#000"}}>60s</option>
                        </select>
                        <div style={{fontSize: 10, opacity: 0.5, marginLeft: 4, whiteSpace: "nowrap"}}>({loopSymbols.length} items)</div>
                      </div>
                    ) : (
                      <div style={{ position: "absolute", top: 8, left: 12, zIndex: 10, display: "flex", gap: 8, alignItems: "center" }}>
                        <button className="ghost" onClick={() => activeNotesSymbol === pane.symbol ? setActiveNotesSymbol(null) : openNotesPanel(pane.symbol)} title="Notes & Checklist" style={{ padding: "4px", background: "var(--panel)", border: "1px solid var(--border)", display: "flex", alignItems: "center" }}>
                          <CheckSquare size={16} />
                        </button>
                        <button className="ghost" onClick={(e) => { e.stopPropagation(); toggleFullscreen(pane.id); }} title="Fullscreen" style={{ padding: "4px", background: "var(--panel)", border: "1px solid var(--border)", display: "flex", alignItems: "center" }}>
                          {fullScreenPaneId ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                        </button>
                        <div style={{ fontSize: 14, fontWeight: 700, pointerEvents: "none", opacity: 0.8, textShadow: "0 1px 4px var(--bg)", display: "flex", alignItems: "center", gap: 6 }}>
                          {pane.symbol} <span style={{fontSize: 11, fontWeight: 500, opacity: 0.7}}>{pane.tf}</span>
                        </div>
                        <MiniBiasHeader symbol={pane.symbol} symBias={symBias} catBias={catBias} />
                      </div>
                    )}
                    <ChartPanel
                      paneId={pane.id}
                      symbol={pane.symbol}
                      tf={pane.tf}
                      tick={ticks[pane.symbol]}
                      alerts={alerts.filter(a => a.symbol === pane.symbol && (a.status === "active" || a.status === "triggered"))}
                      barsCache={barsCache}
                      onAddAlert={(price) => { setActivePaneId(pane.id); setAlertDraft({ price }); }}
                      onDeleteAlert={deleteAlert}
                      onMoveAlert={moveAlert}
                      onRearmAlert={rearmAlert}
                      indicators={indicators}
                      onAutoAlert={handleAutoAlert}
                      onOpenSettings={() => setChartSettingsOpen(true)}
                      isActive={activePaneId === pane.id}
                      // sync logic
                      syncOpts={fullScreenPaneId ? {} : syncOpts}
                      paneId={pane.id}
                      syncedLogicalRange={syncedLogicalRange}
                      setSyncedLogicalRange={setSyncedLogicalRange}
                      syncedCrosshair={syncedCrosshair}
                      setSyncedCrosshair={setSyncedCrosshair}
                    />
                  </div>
                );
              })}

              {/* Grid Splitters */}
              {!fullScreenPaneId && (layout === "2v" || layout === "4") && (
                <div 
                  className="hide-mobile"
                  onMouseDown={(e) => onDragStart(e, "col")}
                  style={{
                    position: "absolute", top: 0, left: `calc(${cX}% - 3px)`, width: 6, height: "100%",
                    cursor: "col-resize", zIndex: 5, background: isDragging ? "var(--brand)" : "transparent"
                  }}
                />
              )}
              {!fullScreenPaneId && (layout === "2h" || layout === "4") && (
                <div 
                  className="hide-mobile"
                  onMouseDown={(e) => onDragStart(e, "row")}
                  style={{
                    position: "absolute", left: 0, top: `calc(${cY}% - 3px)`, height: 6, width: "100%",
                    cursor: "row-resize", zIndex: 5, background: isDragging ? "var(--brand)" : "transparent"
                  }}
                />
              )}
            </div>
          );
          
          return pipWindow ? createPortal(gridNode, pipWindow.document.body) : gridNode;
        })()}
        {watchlistOpen && (
          <aside className="sidebar">
            <Watchlist
              watchlists={watchlists}
              activeListId={activeListId}
              setActiveListId={setActiveListId}
              symbol={symbol}
              setSymbol={changeSymbol}
              ticks={ticks}
              alerts={alerts}
              onCreate={createWatchlist}
              onRename={renameWatchlist}
              onDelete={deleteWatchlist}
              onAddSymbol={() => setPalette("add")}
              onRemoveSymbol={removeSymbolFromList}
              symbolFlags={symbolFlags}
              setSymbolFlags={setSymbolFlags}
              onNavUp={layout !== "1" ? handleNavUp : null}
              onNavDown={layout !== "1" ? handleNavDown : null}
            />
          </aside>
        )}
      </div>

      <div className={`alerts-wrap ${alertsOpen ? "mobile-open" : ""}`} style={alertsOpen ? {display: 'block'} : {display: 'none'}}>
        <AlertsPanel
          alerts={alerts}
          symbol={symbol}
          setSymbol={changeSymbol}
          onDelete={deleteAlert}
          onRearm={rearmAlert}
          onCloseMobile={() => setAlertsOpen(false)}
        />
      </div>

      {palette && (
        <SymbolPalette
          mode={palette}
          onClose={() => setPalette(null)}
          onPick={(sym) => {
            if (palette === "add" && activeListId) addSymbolToList(activeListId, sym);
            else changeSymbol(sym);
            setPalette(null);
          }}
          onAddToList={(sym) => activeListId && addSymbolToList(activeListId, sym)}
        />
      )}

      {alertDraft && (
        <AlertDialog
          symbol={symbol}
          draft={alertDraft}
          marketPrice={ticks[symbol]?.bid}
          onCancel={() => setAlertDraft(null)}
          onSave={createAlert}
        />
      )}

      {saveLayoutOpen && (
        <SaveLayoutModal
          onCancel={() => setSaveLayoutOpen(false)}
          onSave={saveLayout}
        />
      )}

      {marketBiasOpen && (
        <BiasPanel
          enabled={biasEnabled}
          symbols={biasSymbols}
          onJump={(s) => { setMarketBiasOpen(false); changeSymbol(s); }}
          onClose={() => setMarketBiasOpen(false)}
        />
      )}

      {chartSettingsOpen && (
        <ChartSettingsModal onClose={() => setChartSettingsOpen(false)} />
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
          background: "var(--accent)", color: "#fff", padding: "10px 18px",
          borderRadius: 8, zIndex: 90, boxShadow: "0 6px 24px rgba(0,0,0,.5)",
          animation: "toast-in 160ms ease-out",
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
