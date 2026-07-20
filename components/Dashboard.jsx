"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast as sonnerToast } from "sonner";
import TopBar from "./TopBar";
import ChartPanel from "./ChartPanel";
import Watchlist from "./Watchlist";
import AlertsPanel from "./AlertsPanel";
import SymbolPalette from "./SymbolPalette";
import AlertDialog from "./AlertDialog";
import ChecklistPanel from "./ChecklistPanel";
import SaveLayoutModal from "./SaveLayoutModal";
import { CheckSquare, Maximize2, Minimize2, Play, Pause, SkipBack, SkipForward, Square, ArrowUp, ArrowDown, Flag, LayoutGrid } from "lucide-react";
import BiasPanel from "./BiasPanel";
import MiniBiasHeader from "./MiniBiasHeader";
import ChartSettingsModal from "./ChartSettingsModal";
import CorrelatedPairsModal from "./CorrelatedPairsModal";
import CurrencyStrengthMeter from "./CurrencyStrengthMeter";
import { useChartSettings } from "../lib/chartSettings";
import { LAYOUT_CONFIG } from "../lib/layouts";
import { sanitizeDrawings } from "../lib/draw/core.js";

// Strip un-anchored (pre-time-model) drawings from a stored {symbol:[...]} blob
// so loading an old layout can't reintroduce drawings that won't place on TF.
function sanitizeDrawingsBlob(str) {
  try {
    const all = JSON.parse(str || "{}");
    for (const k of Object.keys(all)) {
      if (k.includes(":")) { delete all[k]; continue; } // legacy per-TF keys
      all[k] = sanitizeDrawings(all[k]);
    }
    return JSON.stringify(all);
  } catch { return "{}"; }
}

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
  const [loopColors, setLoopColors] = useState(["red"]);

  const [alerts, setAlerts] = useState([]);
  const [watchlists, setWatchlists] = useState([]);
  const [activeListId, setActiveListId] = useState(null);
  const watchlistsRef = useRef(watchlists);
  const activeListIdRef = useRef(activeListId);
  const [watchlistLayouts, setWatchlistLayouts] = useState({});
  const watchlistLayoutsRef = useRef({});
  const layoutStateRef = useRef({ panes, layout, activePaneId });

  useEffect(() => {
    watchlistsRef.current = watchlists;
    activeListIdRef.current = activeListId;
  }, [watchlists, activeListId]);
  
  useEffect(() => { 
    layoutStateRef.current = { panes, layout, activePaneId }; 
  }, [panes, layout, activePaneId]);
  const [ticks, setTicks] = useState({}); // SYM -> {bid, ask, digits, dir}
  const [connected, setConnected] = useState(false);
  const [palette, setPalette] = useState(null); // null | "switch" | "add"
  const [alertDraft, setAlertDraft] = useState(null); // {price} | null
  const [error, setError] = useState(null);
  const [alertsOpen, setAlertsOpen] = useState(false); // Global modal now
  const [marketBiasOpen, setMarketBiasOpen] = useState(false);
  const [correlatedOpen, setCorrelatedOpen] = useState(false);
  const [strengthOpen, setStrengthOpen] = useState(false);
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
  const [joinChainAlertId, setJoinChainAlertId] = useState(null);
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
        
        const wl = localStorage.getItem("ts_watchlist_layouts");
        if (wl) {
           const parsed = JSON.parse(wl);
           setWatchlistLayouts(parsed);
           watchlistLayoutsRef.current = parsed;
        }
      } catch {}
    };

    syncFromStorage();
    setIsHydrated(true);

    fetch("/api/settings").then(r => r.json()).then(d => {
      if (d.ok && d.settings) {
        if (d.settings.flags) {
          setSymbolFlags(d.settings.flags);
          localStorage.setItem("ts_symbol_flags", JSON.stringify(d.settings.flags));
        }
        if (d.settings.indicators) {
          setIndicators(d.settings.indicators);
          localStorage.setItem("ts_indicators", JSON.stringify(d.settings.indicators));
        }
        if (typeof d.settings.biasEnabled === "boolean") {
          setBiasEnabled(d.settings.biasEnabled);
          localStorage.setItem("ts_bias_enabled", String(d.settings.biasEnabled));
        }
        if (d.settings.watchlistLayouts) {
          setWatchlistLayouts(d.settings.watchlistLayouts);
          watchlistLayoutsRef.current = d.settings.watchlistLayouts;
          localStorage.setItem("ts_watchlist_layouts", JSON.stringify(d.settings.watchlistLayouts));
        }
      }
    }).catch(console.error);

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
  
  useEffect(() => { 
    if (isHydrated) {
      localStorage.setItem("ts_symbol_flags", JSON.stringify(symbolFlags)); 
      fetch("/api/settings", { method: "PATCH", body: JSON.stringify({ flags: symbolFlags }) }).catch(()=>{});
    }
  }, [symbolFlags, isHydrated]);

  useEffect(() => { 
    if (isHydrated) {
      localStorage.setItem("ts_indicators", JSON.stringify(indicators)); 
      fetch("/api/settings", { method: "PATCH", body: JSON.stringify({ indicators }) }).catch(()=>{});
    }
  }, [indicators, isHydrated]);

  // Continuously sync current layout state to the active list profile
  useEffect(() => {
    if (!isHydrated || !activeListId) return;
    const stored = watchlistLayoutsRef.current[activeListId];
    const isSame = stored && 
                   JSON.stringify(stored.panes) === JSON.stringify(panes) && 
                   stored.layout === layout && 
                   stored.activePaneId === activePaneId;
    
    if (!isSame) {
      const currentLayout = { panes, layout, activePaneId };
      const nextLayouts = { ...watchlistLayoutsRef.current, [activeListId]: currentLayout };
      watchlistLayoutsRef.current = nextLayouts;
      setWatchlistLayouts(nextLayouts);
      localStorage.setItem("ts_watchlist_layouts", JSON.stringify(nextLayouts));
      
      clearTimeout(window._wlSyncTimer);
      window._wlSyncTimer = setTimeout(() => {
        fetch("/api/settings", { method: "PATCH", body: JSON.stringify({ watchlistLayouts: nextLayouts }) }).catch(()=>{});
      }, 2000);
    }
  }, [panes, layout, activePaneId, activeListId, isHydrated]);

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
    return Object.keys(symbolFlags).filter(sym => loopColors.includes(symbolFlags[sym]));
  }, [symbolFlags, loopColors]);

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

  const showToast = useCallback((text, type = "default") => {
    if (type === "success") sonnerToast.success(text);
    else if (type === "error") sonnerToast.error(text);
    else if (text.includes("🔔")) sonnerToast(text, { style: { background: "var(--panel)", border: "1px solid var(--accent)", color: "#fff", padding: "12px 16px", borderRadius: "12px", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" } });
    else sonnerToast(text);
  }, []);

  const loadAlerts = useCallback(async () => {
    const data = await api("/api/alerts");
    if (data.ok) {
      const yesterday = Date.now() - 24 * 3600000;
      const sevenDaysAgo = Date.now() - 7 * 24 * 3600000;
      const filtered = data.alerts.filter(a => {
        if (a.status === "triggered") {
           const time = new Date(a.triggeredAt || a.updatedAt || a.createdAt).getTime();
           if (a.rating === 2 || a.rating === 3) {
             return time > sevenDaysAgo;
           }
           return time > yesterday;
        }
        return true;
      });
      setAlerts(filtered);
    }
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

  // bias engine scope: all symbols in all watchlists ∪ open panes
  const biasSymbols = useMemo(() => {
    let allSyms = panes.map(p => p.symbol);
    watchlists.forEach(w => {
      if (w.symbols) allSyms.push(...w.symbols);
    });
    return [...new Set(allSyms)].sort();
  }, [watchlists, panes]);

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
      const existingPane = panes.find(p => p.symbol === newSym);
      if (existingPane) {
        setActivePaneId(existingPane.id);
        setTimeout(() => {
          document.getElementById(`pane-${existingPane.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 50);
      } else {
        setPanes(prev => prev.map(p => p.id === activePaneId ? { ...p, symbol: newSym } : p));
      }
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

  const handleDoubleJump = (sym) => {
    if (layout === "1") return;
    const pane = panes.find(p => p.symbol === sym);
    if (pane) {
      toggleFullscreen(pane.id);
    }
  };

  const toggleFullscreen = (id) => {
    if (fullScreenPaneId) {
      if (preFullScreenPanes) {
        const currentFsPane = panes.find(p => p.id === fullScreenPaneId);
        if (currentFsPane) {
          setPanes(preFullScreenPanes.map(p => p.id === fullScreenPaneId ? { ...p, symbol: currentFsPane.symbol, tf: currentFsPane.tf } : p));
        } else {
          setPanes(preFullScreenPanes);
        }
      }
      setFullScreenPaneId(null);
      setPreFullScreenPanes(null);
    } else {
      setPreFullScreenPanes(panes);
      setFullScreenPaneId(id);
      setActivePaneId(id);
    }
  };

  const changeLayout = (newLayout) => {
    const required = LAYOUT_CONFIG[newLayout]?.count || 1;

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
      localStorage.setItem("ts_drawings", sanitizeDrawingsBlob(l.drawings));
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

  const handleGridify = (symbols, chosenLayout, newSyncOpts) => {
    if (!symbols || !symbols.length) return;
    const count = Math.min(symbols.length, 8);
    let newLayout = chosenLayout;
    if (!newLayout) {
      if (count === 2) newLayout = "2h";
      else if (count === 3) newLayout = "3v";
      else if (count === 4) newLayout = "4";
      else if (count === 5) newLayout = "5a";
      else if (count === 6) newLayout = "6";
      else if (count === 7 || count === 8) newLayout = "8";
      else newLayout = "1";
    }

    if (newSyncOpts) {
      setSyncOpts(newSyncOpts);
    }

    const required = LAYOUT_CONFIG[newLayout]?.count || count;

    const currentTf = panes.find(p => p.id === activePaneId)?.tf || "M15";

    setPanes(() => {
      const next = [];
      for (let i = 0; i < required; i++) {
        next.push({
          id: i + 1,
          symbol: symbols[i] || symbols[0],
          tf: currentTf
        });
      }
      return next;
    });
    setLayout(newLayout);
    setActivePaneId(1);
    if (fullScreenPaneId) toggleFullscreen(fullScreenPaneId);
  };

  const handleWatchlistChange = (newListId) => {
    // 1. Force save current layout to outgoing listId immediately just in case
    if (activeListIdRef.current) {
      const currentLayout = layoutStateRef.current;
      const nextLayouts = { ...watchlistLayoutsRef.current, [activeListIdRef.current]: currentLayout };
      watchlistLayoutsRef.current = nextLayouts;
      setWatchlistLayouts(nextLayouts);
      localStorage.setItem("ts_watchlist_layouts", JSON.stringify(nextLayouts));
    }

    // 2. Load new layout for incoming listId if it exists
    const saved = watchlistLayoutsRef.current[newListId];
    if (saved) {
      if (saved.panes) setPanes(saved.panes);
      if (saved.layout) setLayout(saved.layout);
      if (saved.activePaneId) setActivePaneId(saved.activePaneId);
      setFullScreenPaneId(null);
    }
    setActiveListId(newListId);
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

  const addAlertLayer = useCallback(async (id, price) => {
    const target = alerts.find(a => a._id === id);
    if (!target) return;
    
    let chainId = target.chainId;
    let newOrder = 2;

    // If it's a standalone alert, promote it to Chain Order 1 first
    if (!chainId) {
      const symbolAlerts = alerts.filter(a => a.symbol === target.symbol && a.chainId);
      const existingIds = new Set(symbolAlerts.map(a => a.chainId));
      let nextChar = 'A';
      for (let i = 0; i < 26; i++) {
         const char = String.fromCharCode(65 + i);
         if (!existingIds.has(char)) { nextChar = char; break; }
      }
      chainId = nextChar;
      await api(`/api/alerts/${id}`, { method: "PATCH", body: JSON.stringify({ chainId, chainOrder: 1 }) });
    } else {
      // Find the highest order in this chain to append
      const chainNodes = alerts.filter(a => a.chainId === chainId);
      newOrder = Math.max(...chainNodes.map(n => n.chainOrder)) + 1;
    }

    const currentPrice = ticks[target.symbol]?.bid;
    let cond = "cross";
    if (Number.isFinite(currentPrice)) {
       cond = price > currentPrice ? "above" : "below";
    }

    const data = await api("/api/alerts", { 
       method: "POST", 
       body: JSON.stringify({ 
         symbol: target.symbol, 
         price, 
         condition: cond, 
         chainId, 
         chainOrder: newOrder,
         status: "pending_chain" 
       }) 
    });

    if (data.ok) {
      showToast(`Added link ${chainId}${newOrder}`);
      loadAlerts();
    } else {
      showToast(`Failed to add link: ${data.error}`);
    }
  }, [alerts, ticks, loadAlerts, showToast]);

  const createChainAlert = useCallback(async (id) => {
    const target = alerts.find(a => a._id === id);
    if (!target) return;
    const symbolAlerts = alerts.filter(a => a.symbol === target.symbol && a.chainId);
    const existingIds = new Set(symbolAlerts.map(a => a.chainId));
    let nextChar = 'A';
    for (let i = 0; i < 26; i++) {
       const char = String.fromCharCode(65 + i);
       if (!existingIds.has(char)) { nextChar = char; break; }
    }
    const data = await api(`/api/alerts/${id}`, { method: "PATCH", body: JSON.stringify({ chainId: nextChar, chainOrder: 1 }) });
    if (data.ok) loadAlerts();
  }, [alerts, loadAlerts]);

  const joinChainAlert = useCallback((id) => {
    setJoinChainAlertId(id);
  }, []);

  const deleteAlert = useCallback(async (id, deleteChain = false) => {
    await api(`/api/alerts/${id}${deleteChain ? '?deleteChain=true' : ''}`, { method: "DELETE" });
    loadAlerts();
  }, [loadAlerts]);

  const rearmAlert = useCallback(async (id) => {
    await api(`/api/alerts/${id}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) });
    loadAlerts();
  }, [loadAlerts]);

  const rateAlert = useCallback(async (id, rating) => {
    await api(`/api/alerts/${id}`, { method: "PATCH", body: JSON.stringify({ rating }) });
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
  
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;

  if (fullScreenPaneId || isMobile) {
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
  } else {
    const config = LAYOUT_CONFIG[layout] || LAYOUT_CONFIG["1"];
    gridStyle.gridTemplateColumns = `repeat(${config.cols}, 1fr)`;
    gridStyle.gridTemplateRows = `repeat(${config.rows}, 1fr)`;
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
          fetch("/api/settings", { method: "PATCH", body: JSON.stringify({ biasEnabled: next }) }).catch(()=>{});
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
        onOpenCorrelated={() => setCorrelatedOpen(true)}
        onOpenStrength={() => setStrengthOpen(true)}
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
            <div className={`responsive-chart-grid ${layout === "1" || fullScreenPaneId ? "single-chart" : ""}`} style={{ ...gridStyle, height: pipWindow ? "100vh" : gridStyle.height }}>
              {panes.map((pane, idx) => {
                const isHiddenByFullscreen = fullScreenPaneId && pane.id !== fullScreenPaneId;
                const symBias = biasData?.symbols?.find((s) => s.symbol === pane.symbol);
                const catBias = biasData?.categories?.find((c) => c.members.includes(pane.symbol));
                
                const layoutConfig = LAYOUT_CONFIG[layout];
                let spanStyle = {};
                if (!isMobile && !fullScreenPaneId && layoutConfig?.spans && layoutConfig.spans[idx]) {
                  const [cStart, rStart, cEnd, rEnd] = layoutConfig.spans[idx];
                  spanStyle = {
                    gridColumn: `${cStart} / span ${cEnd - cStart}`,
                    gridRow: `${rStart} / span ${rEnd - rStart}`
                  };
                }

                return (
                  <div 
                    id={`pane-${pane.id}`}
                    key={pane.id} 
                    onClick={() => setActivePaneId(pane.id)}
                    onDoubleClick={() => toggleFullscreen(pane.id)}
                    style={{
                      position: "relative",
                      display: isHiddenByFullscreen ? "none" : "flex",
                      flexDirection: "column",
                      minWidth: 0,
                      minHeight: 0,
                      background: "var(--bg)",
                      boxShadow: (panes.length > 1 && activePaneId === pane.id) ? "inset 0 0 0 2px var(--accent)" : "none",
                      zIndex: activePaneId === pane.id ? 2 : 1,
                      ...spanStyle
                    }}
                  >
                    {loopMenuOpen && layout === "1" ? (
                      <div className="loop-controller" style={{ position: "absolute", top: 8, left: 12, right: 12, zIndex: 10, display: "flex", gap: 8, alignItems: "center", background: "var(--panel)", padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", boxShadow: "0 4px 12px rgba(0,0,0,0.5)", overflowX: "auto" }}>
                        <div style={{ display: "flex", gap: 4, marginRight: 4 }}>
                          {["red", "blue", "green", "yellow"].map(color => (
                            <button
                              key={color}
                              className="ghost"
                              onClick={() => {
                                setLoopColors(prev => 
                                  prev.includes(color) 
                                    ? prev.length > 1 ? prev.filter(c => c !== color) : prev
                                    : [...prev, color]
                                );
                              }}
                              style={{
                                padding: "4px", 
                                borderRadius: 4,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: color === "red" ? "#ef5350" : color === "blue" ? "#2962ff" : color === "green" ? "#26a69a" : color === "yellow" ? "#ffeb3b" : "var(--text)",
                                opacity: loopColors.includes(color) ? 1 : 0.2,
                                background: loopColors.includes(color) ? "rgba(255,255,255,0.05)" : "transparent"
                              }}
                              title={`Toggle ${color} flag`}
                            >
                              <Flag size={14} fill={loopColors.includes(color) ? "currentColor" : "none"} strokeWidth={loopColors.includes(color) ? 0 : 2} />
                            </button>
                          ))}
                        </div>
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
                        {(panes.length > 1 || fullScreenPaneId) && (
                          <button className="ghost" onClick={(e) => { e.stopPropagation(); toggleFullscreen(pane.id); }} title="Fullscreen" style={{ padding: "4px", background: "var(--panel)", border: "1px solid var(--border)", display: "flex", alignItems: "center" }}>
                            {fullScreenPaneId ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                          </button>
                        )}
                        {panes.length > 1 && !fullScreenPaneId && (
                          <div style={{ fontSize: 14, fontWeight: 700, pointerEvents: "none", opacity: 0.8, textShadow: "0 1px 4px var(--bg)", display: "flex", alignItems: "center", gap: 6 }}>
                            {pane.symbol} <span style={{fontSize: 11, fontWeight: 500, opacity: 0.7}}>{pane.tf}</span>
                          </div>
                        )}
                        <button className="ghost" onClick={() => { setActivePaneId(pane.id); setCorrelatedOpen(true); }} title="View Correlated Pairs" style={{ padding: "4px 8px", background: "var(--panel)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                          <LayoutGrid size={14} color="var(--accent)" /> <span className="hide-mobile">Correlated</span>
                        </button>
                      </div>
                    )}
                    <ChartPanel
                      paneId={pane.id}
                      symbol={pane.symbol}
                      tf={pane.tf}
                      tick={ticks[pane.symbol]}
                      alerts={alerts.filter(a => a.symbol === pane.symbol && (a.status === "active" || a.status === "triggered" || a.status === "pending_chain"))}
                      barsCache={barsCache}
                      onAddAlert={(price) => { setActivePaneId(pane.id); setAlertDraft({ price }); }}
                      onAddAlertLayer={addAlertLayer}
                      onDeleteAlert={deleteAlert}
                      onMoveAlert={moveAlert}
                      onRearmAlert={rearmAlert}
                      onRateAlert={rateAlert}
                      onCreateChainAlert={createChainAlert}
                      onJoinChainAlert={joinChainAlert}
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
                      biasData={biasData}
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
            <div id="mobile-drawing-portal"></div>
            <Watchlist
              watchlists={watchlists}
              activeListId={activeListId}
              setActiveListId={handleWatchlistChange}
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
              onGridify={handleGridify}
              onDoubleJump={handleDoubleJump}
              biasData={biasData}
              onSelectAutoList={() => {
                if (layout !== "1") {
                  setLayout("1");
                  setPanes((prev) => [prev.find((p) => p.id === activePaneId) || prev[0]]);
                  setGridFractions({ col: 50, row: 50 });
                }
              }}
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
          onOpenCorrelated={() => { setMarketBiasOpen(false); setCorrelatedOpen(true); }}
        />
      )}

      {chartSettingsOpen && (
        <ChartSettingsModal onClose={() => setChartSettingsOpen(false)} />
      )}

      {correlatedOpen && (
        <CorrelatedPairsModal
          symbol={panes.find(p => p.id === activePaneId)?.symbol || "EURUSD"}
          indicators={indicators}
          onClose={() => setCorrelatedOpen(false)}
        />
      )}

      {strengthOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 110, display: "flex", justifyContent: "center", alignItems: "center", background: "rgba(0,0,0,0.5)" }}>
          <div style={{ position: "absolute", inset: 0 }} onClick={() => setStrengthOpen(false)} />
          <div style={{ position: "relative", zIndex: 111, width: 400, maxWidth: "90vw" }}>
            <CurrencyStrengthMeter 
              onSelectSuggested={(sym) => {
                setLayout("1");
                setPanes([{ id: 1, symbol: sym, tf: panes[0]?.tf || "H1" }]);
                setActivePaneId(1);
                setStrengthOpen(false);
              }}
            />
          </div>
        </div>
      )}


      {joinChainAlertId && (
        <JoinChainModal
          alerts={alerts}
          targetId={joinChainAlertId}
          onClose={() => setJoinChainAlertId(null)}
          onJoin={async (chainId, order) => {
            const data = await api(`/api/alerts/${joinChainAlertId}`, { method: "PATCH", body: JSON.stringify({ chainId, chainOrder: order }) });
            if (data.ok) loadAlerts();
            setJoinChainAlertId(null);
          }}
        />
      )}
    </div>
  );
}

function JoinChainModal({ alerts, targetId, onClose, onJoin }) {
  const targetAlert = alerts.find(a => a._id === targetId);
  if (!targetAlert) return null;

  const symbolAlerts = alerts.filter(a => a.symbol === targetAlert.symbol && a.chainId);
  const chains = {};
  for (const a of symbolAlerts) {
    if (!chains[a.chainId]) chains[a.chainId] = [];
    chains[a.chainId].push(a);
  }
  Object.values(chains).forEach(arr => arr.sort((a,b) => a.chainOrder - b.chainOrder));
  
  const [selectedChain, setSelectedChain] = useState(Object.keys(chains)[0] || null);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center"
    }} onClick={onClose}>
      <div style={{
        background: "var(--panel)", padding: 24, borderRadius: 12, border: "1px solid var(--border)",
        width: 340, boxShadow: "0 20px 40px rgba(0,0,0,0.5)"
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ marginTop: 0, marginBottom: 16 }}>Join Chain Group</h3>
        
        {Object.keys(chains).length === 0 ? (
           <p style={{ color: "var(--text-muted)", fontSize: 14 }}>No active chains for {targetAlert.symbol}.</p>
        ) : (
           <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
             <select 
                value={selectedChain} 
                onChange={(e) => setSelectedChain(e.target.value)}
                style={{ padding: "8px 12px", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6 }}
             >
                {Object.keys(chains).map(c => <option key={c} value={c}>Chain {c}</option>)}
             </select>

             {selectedChain && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 300, overflowY: "auto" }}>
                  <label style={{ fontSize: 13, color: "var(--text-muted)" }}>Select Position to Insert:</label>
                  {chains[selectedChain].map((a) => (
                    <button 
                       key={a._id}
                       onClick={() => onJoin(selectedChain, a.chainOrder)}
                       style={{ 
                         textAlign: "left", padding: "8px 12px", background: "var(--accent-soft)", 
                         border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", color: "var(--text)",
                         transition: "background 0.2s"
                       }}
                       onMouseEnter={e => e.currentTarget.style.background = "var(--accent)"}
                       onMouseLeave={e => e.currentTarget.style.background = "var(--accent-soft)"}
                    >
                       Insert at {a.chainOrder} (Pushes {a.chainOrder} down)
                    </button>
                  ))}
                  <button 
                     onClick={() => onJoin(selectedChain, chains[selectedChain].length + 1)}
                     style={{ 
                       textAlign: "left", padding: "8px 12px", background: "var(--orange)", 
                       border: "none", borderRadius: 6, cursor: "pointer", color: "#1a1206", fontWeight: "bold"
                     }}
                  >
                     Append to End (Position {chains[selectedChain].length + 1})
                  </button>
                </div>
             )}
           </div>
        )}
      </div>

      <Toaster position={isMobile ? "top-center" : "bottom-right"} richColors expand={true} theme="dark" toastOptions={{ style: { background: "var(--panel)", border: "1px solid var(--border)", color: "var(--fg)", fontSize: "14px" } }} />
    </div>
  );
}
