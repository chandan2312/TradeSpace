"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  ModuleRegistry,
  AllCommunityModule,
  themeQuartz,
  colorSchemeDark,
  colorSchemeLight,
} from "ag-grid-community";
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Download,
  Search,
  Filter,
  Layers,
  Shield,
  Zap,
  Target,
  Clock,
  Calendar,
  CheckCircle2,
  XCircle,
  Activity,
  Maximize2,
  BarChart2,
  ExternalLink,
  Table,
  Check,
  ChevronDown,
  FileSpreadsheet,
} from "lucide-react";
import JournalDrawerModal from "./JournalDrawerModal";
import { useChartSettings } from "../../lib/chartSettings";

// Register AG Grid Community modules (required for AG Grid v33+)
ModuleRegistry.registerModules([AllCommunityModule]);

// Helper: Format EET & UTC date
function formatDateEET(iso) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return (
      d.toLocaleString("en-GB", {
        timeZone: "Europe/Athens",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }) + " EET"
    );
  } catch {
    return String(iso);
  }
}

function formatCurrency(val) {
  const num = Number(val);
  if (!Number.isFinite(num)) return "-";
  return num < 0 ? `-$${Math.abs(num).toFixed(2)}` : `$${num.toFixed(2)}`;
}

// Helper: Format price/number with at most 5 decimal places (zero bloated decimals)
function formatPrice5(val) {
  if (val == null) return "-";
  const num = Number(val);
  if (!Number.isFinite(num)) return "-";
  const factor = 100000;
  const rounded = Math.round(num * factor) / factor;
  const s = rounded.toFixed(5);
  // Trim trailing zeroes, but keep at least 2 decimal places if there is a decimal point
  return s.replace(/(\.\d{2,}?)0+$/, "$1");
}

/**
 * Institutional Multi-Select Filter Component with Dark Theme Popover
 * Completely eliminates ugly native <select> elements and white backgrounds.
 */
function MultiSelectFilter({
  label,
  icon: Icon,
  options = [],
  selected = [],
  onChange,
  placeholder = "All",
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const isSelected = (val) => selected.includes(val);

  const toggle = (val) => {
    if (selected.includes(val)) {
      onChange(selected.filter((x) => x !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  const selectAll = () => onChange(options.map((o) => o.value));
  const clearAll = () => onChange([]);

  let triggerLabel = placeholder;
  const isFiltered = selected.length > 0 && selected.length < options.length;
  if (isFiltered) {
    if (selected.length === 1) {
      const match = options.find((o) => o.value === selected[0]);
      triggerLabel = match?.short || match?.label || selected[0];
    } else {
      triggerLabel = `${label} (${selected.length})`;
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: isFiltered ? "rgba(41, 98, 255, 0.15)" : "var(--panel-2)",
          border: `1px solid ${isFiltered ? "rgba(41, 98, 255, 0.4)" : "var(--border)"}`,
          borderRadius: 6,
          color: isFiltered ? "var(--accent)" : "var(--fg)",
          padding: "6px 10px",
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.15s ease",
        }}
      >
        {Icon && <Icon size={12} style={{ color: isFiltered ? "var(--accent)" : "var(--muted)" }} />}
        <span>{triggerLabel}</span>
        <ChevronDown size={11} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 1000,
            minWidth: 210,
            background: "var(--panel)",
            border: "1px solid var(--border-hi)",
            borderRadius: 8,
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.25)",
            padding: "8px 6px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "2px 6px 6px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
              {label}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={selectAll}
                style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 10, cursor: "pointer", padding: "1px 4px" }}
              >
                All
              </button>
              <button
                type="button"
                onClick={clearAll}
                style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 10, cursor: "pointer", padding: "1px 4px" }}
              >
                Clear
              </button>
            </div>
          </div>

          <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {options.map((opt) => {
              const active = isSelected(opt.value);
              return (
                <label
                  key={opt.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 8px",
                    borderRadius: 5,
                    fontSize: 11,
                    cursor: "pointer",
                    background: active ? "rgba(41, 98, 255, 0.12)" : "transparent",
                    color: active ? "var(--fg)" : "var(--muted)",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = "var(--panel-2)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggle(opt.value)}
                    style={{ cursor: "pointer", accentColor: "var(--accent)" }}
                  />
                  <span style={{ flex: 1, whiteSpace: "nowrap" }}>{opt.label}</span>
                  {opt.badge && (
                    <span
                      style={{
                        fontSize: 9,
                        opacity: 0.8,
                        padding: "1px 4px",
                        borderRadius: 3,
                        background: "rgba(255, 255, 255, 0.06)",
                      }}
                    >
                      {opt.badge}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function JournalView() {
  const [chartSettings] = useChartSettings();
  const isLightOrCreamy = chartSettings?.appTheme === "light" || chartSettings?.appTheme === "creamy";

  const gridTheme = useMemo(() => {
    const basePart = isLightOrCreamy ? colorSchemeLight : colorSchemeDark;
    return themeQuartz.withPart(basePart).withParams({
      backgroundColor: "var(--panel)",
      foregroundColor: "var(--fg)",
      borderColor: "var(--border)",
      headerBackgroundColor: "var(--panel-2)",
      headerForegroundColor: "var(--fg)",
      rowHoverColor: "var(--accent-soft)",
      oddRowBackgroundColor: "var(--panel-2)",
      fontSize: 12,
      fontFamily: "var(--font, -apple-system, sans-serif)",
      headerHeight: 40,
      rowHeight: 42,
      cellHorizontalPadding: 12,
      headerCellHorizontalPadding: 12,
    });
  }, [isLightOrCreamy]);

  const [trades, setTrades] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [savingJournal, setSavingJournal] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [viewMode, setViewMode] = useState("spreadsheet"); // "spreadsheet" | "table"

  // 1. Sheet Tabs: All Trades vs Default Model Sheet vs Prop-Firm Safe Sheet
  const [activeSheet, setActiveSheet] = useState("ALL"); // "ALL" | "milestone_50" | "prop_firm_safe"

  // 2. Multi-Select Filters
  // Default: exclude CANCELLED outcome trades by default!
  const [selectedOutcomes, setSelectedOutcomes] = useState(["WIN", "LOSS", "BREAKEVEN", "OPEN"]);
  const [selectedModels, setSelectedModels] = useState([]); // Empty = all
  const [selectedHorizons, setSelectedHorizons] = useState([]); // Empty = all
  const [selectedSymbols, setSelectedSymbols] = useState([]); // Empty = all
  const [selectedSessions, setSelectedSessions] = useState([]); // Empty = all
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [quickSearch, setQuickSearch] = useState("");

  const gridRef = useRef(null);

  // Fetch journal trades from API
  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch("/api/journal");
      const data = await res.json();
      if (data.ok && Array.isArray(data.trades)) {
        setTrades(data.trades);
        setKpis(data.kpis);
      }
    } catch (err) {
      console.error("Failed to load journal trades", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  // Optional 30s auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchTrades, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchTrades]);

  // Sync quick search with AG Grid
  const onQuickSearchChange = (e) => {
    const val = e.target.value;
    setQuickSearch(val);
    if (gridRef.current?.api) {
      gridRef.current.api.setGridOption("quickFilterText", val);
    }
  };

  // Export to CSV
  const onExportCsv = () => {
    if (gridRef.current?.api) {
      gridRef.current.api.exportDataAsCsv({
        fileName: `TradeSpace-Journal-${new Date().toISOString().slice(0, 10)}.csv`,
      });
    }
  };

  // Save review notes to API
  const handleSaveJournal = async (tradeId, updates) => {
    setSavingJournal(true);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId, ...updates }),
      });
      const data = await res.json();
      if (data.ok) {
        setTrades((prev) =>
          prev.map((t) => (t.id === tradeId ? { ...t, ...updates } : t))
        );
        if (selectedTrade && selectedTrade.id === tradeId) {
          setSelectedTrade((prev) => ({ ...prev, ...updates }));
        }
      }
    } catch (err) {
      console.error("Failed to save journal notes", err);
    } finally {
      setSavingJournal(false);
    }
  };

  // Dynamic filter option lists
  const uniqueSymbols = useMemo(() => {
    return Array.from(new Set(trades.map((t) => t.symbol).filter(Boolean))).sort();
  }, [trades]);

  const uniqueSessions = useMemo(() => {
    return Array.from(new Set(trades.map((t) => t.session).filter(Boolean))).sort();
  }, [trades]);

  // Sheet counts (only count non-cancelled trades in tab badges)
  const sheetCounts = useMemo(() => {
    const validTrades = trades.filter((t) => t.outcome !== "CANCELLED");
    const all = validTrades.length;
    const def = validTrades.filter((t) => t.managementLogic === "milestone_50" && !t.isPropFirm).length;
    const prop = validTrades.filter((t) => t.managementLogic === "prop_firm_safe" || t.isPropFirm).length;
    return { all, def, prop };
  }, [trades]);

  // Filtered dataset
  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      // Staged, pending, or unexecuted setups have no place in the execution journal
      if (t.outcome === "STAGED" || t.outcome === "CANCELLED" || t.status === "staged") return false;

      // 1. Sheet selection filter
      if (activeSheet !== "ALL") {
        const isProp = t.managementLogic === "prop_firm_safe" || Boolean(t.isPropFirm);
        if (activeSheet === "prop_firm_safe" && !isProp) return false;
        if (activeSheet === "milestone_50" && isProp) return false;
      }

      // 2. Risk Model multi-select filter
      if (selectedModels.length > 0) {
        const isProp = t.managementLogic === "prop_firm_safe" || Boolean(t.isPropFirm);
        const modelKey = isProp ? "prop_firm_safe" : "milestone_50";
        if (!selectedModels.includes(modelKey)) return false;
      }

      // 3. Outcome multi-select filter (treats -0.2R to +0.2R as BREAKEVEN)
      const ar = Number(t.actualR ?? t.realizedR ?? 0);
      let effOutcome = t.outcome || "OPEN";
      if (effOutcome !== "OPEN") {
        if (ar >= -0.2 && ar <= 0.2) effOutcome = "BREAKEVEN";
        else if (ar > 0.2) effOutcome = "WIN";
        else effOutcome = "LOSS";
      }
      if (selectedOutcomes.length > 0 && !selectedOutcomes.includes(effOutcome)) return false;

      // 4. Horizon multi-select filter
      if (selectedHorizons.length > 0) {
        const hLow = (t.horizon || "").toLowerCase();
        const matches = selectedHorizons.some((h) => hLow.includes(h.toLowerCase()));
        if (!matches) return false;
      }

      // 5. Symbol multi-select filter
      if (selectedSymbols.length > 0 && !selectedSymbols.includes(t.symbol)) return false;

      // 6. Session multi-select filter
      if (selectedSessions.length > 0 && !selectedSessions.includes(t.session)) return false;

      // 7. Date range filters
      if (startDate && t.entryTime && t.entryTime < startDate) return false;
      if (endDate && t.entryTime && t.entryTime > endDate + "T23:59:59") return false;

      // 8. Quick search
      if (quickSearch.trim()) {
        const q = quickSearch.toLowerCase();
        const str = `${t.symbol} ${t.dirLabel} ${t.notes || ""} ${t.entryModel || ""} ${t.session || ""}`.toLowerCase();
        if (!str.includes(q)) return false;
      }

      return true;
    });
  }, [
    trades,
    activeSheet,
    selectedModels,
    selectedOutcomes,
    selectedHorizons,
    selectedSymbols,
    selectedSessions,
    startDate,
    endDate,
    quickSearch,
  ]);

  // Dynamic Sheet-Scoped KPIs (Properly excluding BE trades from Win Rate)
  const scopedKpis = useMemo(() => {
    const list = filteredTrades.filter((t) => t.outcome !== "CANCELLED");
    const closed = list.filter((t) => ["WIN", "LOSS", "BREAKEVEN"].includes(t.outcome));
    const wins = closed.filter((t) => t.outcome === "WIN");
    const losses = closed.filter((t) => t.outcome === "LOSS");
    const be = closed.filter((t) => t.outcome === "BREAKEVEN");
    const open = list.filter((t) => t.outcome === "OPEN");

    // Institutional Win Rate: Wins / (Wins + Losses) * 100 — excluding BE!
    const decisiveCount = wins.length + losses.length;
    const winRate = decisiveCount > 0 ? Number(((wins.length / decisiveCount) * 100).toFixed(1)) : 0;
    const totalR = Number(closed.reduce((s, t) => s + (t.actualR ?? t.realizedR ?? 0), 0).toFixed(2));
    const totalPnl = Number(closed.reduce((s, t) => s + (t.realizedPnlUsd ?? 0), 0).toFixed(2));

    const grossProfitR = closed.filter((t) => (t.actualR ?? t.realizedR) > 0).reduce((s, t) => s + (t.actualR ?? t.realizedR), 0);
    const grossLossR = Math.abs(closed.filter((t) => (t.actualR ?? t.realizedR) < 0).reduce((s, t) => s + (t.actualR ?? t.realizedR), 0));
    const profitFactor = grossLossR > 0 ? Number((grossProfitR / grossLossR).toFixed(2)) : (grossProfitR > 0 ? 99.9 : 0);
    const avgR = closed.length > 0 ? Number((totalR / closed.length).toFixed(2)) : 0;

    const maxEquityR = Number(list.reduce((m, t) => Math.max(m, t.peakR || 0), 0).toFixed(2));
    const maxDrawdownR = Number(list.reduce((m, t) => Math.min(m, t.maxDrawdownR || 0), 0).toFixed(2));

    return {
      total: list.length,
      closedCount: closed.length,
      openCount: open.length,
      winsCount: wins.length,
      lossesCount: losses.length,
      beCount: be.length,
      winRate,
      totalR,
      totalPnl,
      profitFactor,
      avgR,
      maxEquityR,
      maxDrawdownR,
    };
  }, [filteredTrades]);

  // AG Grid Default Column Configuration
  const defaultColDef = useMemo(() => {
    return {
      sortable: true,
      filter: true,
      floatingFilter: false,
      resizable: true,
      minWidth: 90,
    };
  }, []);

  // AG Grid Column Definitions
  const colDefs = useMemo(() => {
    return [
      {
        field: "entryTime",
        headerName: "Entry Time (EET)",
        width: 155,
        sort: "desc",
        valueFormatter: (params) => formatDateEET(params.value),
        filter: "agTextColumnFilter",
      },
      {
        field: "symbol",
        headerName: "Symbol",
        width: 105,
        cellStyle: { fontWeight: "700", fontFamily: "monospace" },
        filter: "agTextColumnFilter",
      },
      {
        field: "dirLabel",
        headerName: "Side",
        width: 90,
        filter: "agTextColumnFilter",
        cellRenderer: (params) => {
          const isBuy = params.value === "BUY";
          return (
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: "2px 7px",
                borderRadius: 4,
                background: isBuy ? "rgba(38, 166, 154, 0.18)" : "rgba(239, 83, 80, 0.18)",
                color: isBuy ? "var(--green)" : "var(--red)",
              }}
            >
              {isBuy ? "BUY ▲" : "SELL ▼"}
            </span>
          );
        },
      },
      {
        field: "managementModel",
        headerName: "Risk Model",
        width: 195,
        filter: "agTextColumnFilter",
        cellRenderer: (params) => {
          const isProp = params.data?.isPropFirm;
          return (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 4,
                background: isProp ? "rgba(171, 71, 188, 0.18)" : "rgba(41, 98, 255, 0.18)",
                color: isProp ? "var(--purple, #ab47bc)" : "var(--accent)",
              }}
            >
              {isProp ? "PROP-FIRM SAFE" : "DEFAULT (50%)"}
            </span>
          );
        },
      },
      {
        field: "redecisionAction",
        headerName: "Milestone Redecision",
        width: 175,
        filter: "agTextColumnFilter",
        cellRenderer: (params) => {
          const act = params.value;
          if (!act) {
            return (
              <span style={{ fontSize: 10, color: "var(--muted)", fontStyle: "italic" }}>
                {params.data?.isPropFirm ? "N/A (Prop Safe)" : "Pending / None"}
              </span>
            );
          }
          const isClose = act === "CLOSE_FULL_NOW";
          const isReduce = act === "REDUCE_TP";
          const isExpand = act === "EXPAND_TP";

          const bg = isClose
            ? "rgba(239, 83, 80, 0.18)"
            : isReduce
            ? "rgba(255, 179, 0, 0.18)"
            : isExpand
            ? "rgba(171, 71, 188, 0.18)"
            : "rgba(38, 166, 154, 0.18)";

          const color = isClose
            ? "var(--red)"
            : isReduce
            ? "var(--orange, #ffb300)"
            : isExpand
            ? "var(--purple, #ab47bc)"
            : "var(--green)";

          const label = isClose
            ? "CLOSE NOW"
            : isReduce
            ? `REDUCE (${params.data?.redecisionNewRR ?? "-"}R)`
            : isExpand
            ? `EXPAND (${params.data?.redecisionNewRR ?? "-"}R)`
            : "HOLD FULL";

          return (
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: "2px 8px",
                borderRadius: 4,
                background: bg,
                color: color,
                fontFamily: "monospace",
              }}
              title={params.data?.redecisionReason || `AMRE Score: ${params.data?.redecisionScore}`}
            >
              {label}
            </span>
          );
        },
      },
      {
        field: "outcome",
        headerName: "Outcome",
        width: 130,
        filter: "agTextColumnFilter",
        cellRenderer: (params) => {
          const ar = Number(params.data?.actualR ?? params.data?.realizedR ?? 0);
          let out = params.value || "OPEN";
          if (out !== "CANCELLED" && out !== "OPEN") {
            if (ar >= -0.2 && ar <= 0.2) out = "BREAKEVEN";
            else if (ar > 0.2) out = "WIN";
            else out = "LOSS";
          }

          let bg = "rgba(255, 255, 255, 0.08)";
          let col = "var(--fg)";
          let icon = "⚪";
          if (out === "WIN") {
            bg = "rgba(38, 166, 154, 0.2)";
            col = "var(--green)";
            icon = "🎯";
          } else if (out === "LOSS") {
            bg = "rgba(239, 83, 80, 0.2)";
            col = "var(--red)";
            icon = "🛑";
          } else if (out === "BREAKEVEN") {
            bg = "rgba(255, 255, 255, 0.1)";
            col = "var(--muted)";
            icon = "⚪";
          } else if (out === "OPEN") {
            bg = "rgba(41, 98, 255, 0.2)";
            col = "var(--accent)";
            icon = "🟢";
          }
          return (
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: "2px 8px",
                borderRadius: 4,
                background: bg,
                color: col,
              }}
            >
              {out} {icon}
            </span>
          );
        },
      },
      {
        field: "actualR",
        headerName: "Actual Return (AR)",
        width: 130,
        filter: "agNumberColumnFilter",
        cellStyle: (params) => {
          const v = Number(params.value);
          if (v > 0.2) return { color: "var(--green)", fontWeight: "800", fontFamily: "monospace", backgroundColor: "rgba(38, 166, 154, 0.08)" };
          if (v < -0.2) return { color: "var(--red)", fontWeight: "800", fontFamily: "monospace", backgroundColor: "rgba(239, 83, 80, 0.08)" };
          return { color: "var(--muted)", fontWeight: "700", fontFamily: "monospace" };
        },
        valueFormatter: (params) => {
          const v = Number(params.value);
          if (!Number.isFinite(v)) return "-";
          if (v >= -0.2 && v <= 0.2) return "0.00 AR (BE)";
          return v > 0 ? `+${v.toFixed(2)} AR` : `${v.toFixed(2)} AR`;
        },
      },
      {
        field: "idealR",
        headerName: "Ideal R (IR)",
        width: 115,
        filter: "agNumberColumnFilter",
        cellStyle: (params) => {
          const ar = Number(params.data?.actualR ?? params.data?.realizedR ?? 0);
          if (ar > 0.2) return { color: "var(--accent)", fontWeight: "700", fontFamily: "monospace" };
          return { color: "var(--muted)", fontFamily: "monospace" };
        },
        valueFormatter: (params) => {
          const ar = Number(params.data?.actualR ?? params.data?.realizedR ?? 0);
          const out = params.data?.outcome;
          // Rule: Ideal R is strictly for positive side (no partials taken in losses or BE)
          if (out === "LOSS" || out === "BREAKEVEN" || ar <= 0.2) return "—";
          const v = Number(params.value);
          if (!Number.isFinite(v) || v <= 0) return "—";
          return `+${v.toFixed(2)} IR`;
        },
      },
      {
        field: "realizedPnlUsd",
        headerName: "Profit ($)",
        width: 115,
        filter: "agNumberColumnFilter",
        cellStyle: (params) => {
          const v = Number(params.value);
          if (v > 0) return { color: "var(--green)", fontWeight: "700", fontFamily: "monospace" };
          if (v < 0) return { color: "var(--red)", fontWeight: "700", fontFamily: "monospace" };
          return { color: "var(--muted)", fontFamily: "monospace" };
        },
        valueFormatter: (params) => formatCurrency(params.value),
      },
      {
        field: "peakR",
        headerName: "Max Equity (R)",
        width: 125,
        filter: "agNumberColumnFilter",
        cellStyle: { color: "var(--green)", fontWeight: "700", fontFamily: "monospace" },
        valueFormatter: (params) => {
          const v = Number(params.value);
          return v > 0 ? `+${v.toFixed(2)} R` : "0.00 R";
        },
      },
      {
        field: "maxDrawdownR",
        headerName: "Max DD (R)",
        width: 115,
        filter: "agNumberColumnFilter",
        cellStyle: { color: "var(--red)", fontWeight: "700", fontFamily: "monospace" },
        valueFormatter: (params) => {
          const v = Number(params.value);
          return `${v.toFixed(2)} R`;
        },
      },
      {
        field: "horizon",
        headerName: "Horizon",
        width: 145,
        filter: "agTextColumnFilter",
      },
      {
        field: "entryModel",
        headerName: "Entry Model",
        width: 165,
        filter: "agTextColumnFilter",
      },
      {
        field: "session",
        headerName: "Session / Killzone",
        width: 155,
        filter: "agTextColumnFilter",
      },
      {
        field: "entryPrice",
        headerName: "Entry Price",
        width: 115,
        filter: "agNumberColumnFilter",
        cellStyle: { fontFamily: "monospace" },
        valueFormatter: (params) => formatPrice5(params.value),
      },
      {
        field: "slPrice",
        headerName: "Stop Loss",
        width: 110,
        filter: "agNumberColumnFilter",
        cellStyle: { color: "var(--red)", fontFamily: "monospace" },
        valueFormatter: (params) => formatPrice5(params.value),
      },
      {
        field: "tpPrice",
        headerName: "Take Profit",
        width: 110,
        filter: "agNumberColumnFilter",
        cellStyle: { color: "var(--green)", fontFamily: "monospace" },
        valueFormatter: (params) => formatPrice5(params.value),
      },
      {
        field: "fullTpPrice",
        headerName: "Full Assigned TP",
        width: 140,
        filter: "agNumberColumnFilter",
        cellStyle: { color: "var(--green)", fontWeight: 700, fontFamily: "monospace" },
        valueFormatter: (params) => {
          const p = formatPrice5(params.value);
          const rr = params.data?.fullTpRR || params.data?.targetRR;
          return rr ? `${p} (${rr}R)` : p;
        },
      },
      {
        field: "exitPrice",
        headerName: "Exit Price",
        width: 110,
        filter: "agNumberColumnFilter",
        cellStyle: { fontFamily: "monospace" },
        valueFormatter: (params) => formatPrice5(params.value),
      },
      {
        field: "lotSize",
        headerName: "Lots",
        width: 85,
        filter: "agNumberColumnFilter",
        cellStyle: { fontFamily: "monospace" },
        valueFormatter: (params) => formatPrice5(params.value),
      },
      {
        field: "initialRiskUsd",
        headerName: "Risk ($)",
        width: 100,
        filter: "agNumberColumnFilter",
        cellStyle: { color: "var(--orange)", fontFamily: "monospace" },
        valueFormatter: (params) => `$${params.value}`,
      },
      {
        field: "durationMinutes",
        headerName: "Hold Time",
        width: 105,
        filter: "agNumberColumnFilter",
        cellStyle: { fontFamily: "monospace" },
        valueFormatter: (params) => (params.value != null ? `${params.value}m` : "-"),
      },
      {
        field: "closeTime",
        headerName: "Close Time",
        width: 150,
        valueFormatter: (params) => (params.value ? formatDateEET(params.value) : "-"),
        filter: "agTextColumnFilter",
      },
      {
        headerName: "Actions",
        width: 120,
        sortable: false,
        filter: false,
        cellRenderer: (params) => {
          const sym = params.data?.symbol;
          return (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedTrade(params.data);
                }}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: "rgba(255, 255, 255, 0.08)",
                  color: "var(--fg)",
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                }}
              >
                Inspect
              </button>
              {sym && (
                <a
                  href={`/?symbol=${encodeURIComponent(sym)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: 4,
                    background: "rgba(41, 98, 255, 0.15)",
                    color: "var(--accent)",
                    border: "1px solid rgba(41, 98, 255, 0.3)",
                    textDecoration: "none",
                  }}
                  title="Open symbol chart with live RR tool"
                >
                  Chart ↗
                </a>
              )}
            </div>
          );
        },
      },
    ];
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: "100vh", gap: 12 }}>
      {/* 1. TOP HEADER & CONTROLS */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          padding: "14px 18px",
          background: "var(--panel, #151a23)",
          border: "1px solid var(--border)",
          borderRadius: 12,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
              Autonomous Trading Journal
            </h1>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 4,
                background: "rgba(41, 98, 255, 0.15)",
                color: "var(--accent)",
                border: "1px solid rgba(41, 98, 255, 0.3)",
              }}
            >
              MT5 RECONCILED
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            Multi-model institutional ledger logging dual risk models, MAE/MFE analytics, and broker executions.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          {/* Active Trades Count Badge */}
          <div
            style={{
              fontSize: 11,
              fontFamily: "monospace",
              padding: "6px 10px",
              borderRadius: 6,
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid var(--border)",
              color: "var(--fg)",
            }}
          >
            <span style={{ color: "var(--muted)" }}>Records: </span>
            <strong style={{ color: "var(--accent)" }}>{filteredTrades.length}</strong>
            <span style={{ color: "var(--muted)" }}> / {trades.length}</span>
          </div>

          {/* View Mode Switcher */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "var(--panel-2)",
              padding: 2,
              borderRadius: 6,
              border: "1px solid var(--border)",
            }}
          >
            <button
              onClick={() => setViewMode("spreadsheet")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "6px 9px",
                borderRadius: 5,
                border: "none",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                background: viewMode === "spreadsheet" ? "var(--accent)" : "transparent",
                color: viewMode === "spreadsheet" ? "#fff" : "var(--muted)",
                transition: "all 0.15s ease",
              }}
              title="Spreadsheet (AG-Grid)"
              aria-label="Spreadsheet View"
            >
              <BarChart2 size={13} />
            </button>
            <button
              onClick={() => setViewMode("table")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "6px 9px",
                borderRadius: 5,
                border: "none",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                background: viewMode === "table" ? "var(--accent)" : "transparent",
                color: viewMode === "table" ? "#fff" : "var(--muted)",
                transition: "all 0.15s ease",
              }}
              title="Table View"
              aria-label="Table View"
            >
              <Table size={13} />
            </button>
          </div>

          <button
            onClick={fetchTrades}
            disabled={loading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 12px",
              borderRadius: 6,
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid var(--border)",
              color: "var(--fg)",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
            title="Reload latest trades from MongoDB & MT5 broker history"
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} />
            Refresh
          </button>

          <button
            onClick={onExportCsv}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 12px",
              borderRadius: 6,
              background: "rgba(41, 98, 255, 0.12)",
              border: "1px solid rgba(41, 98, 255, 0.3)",
              color: "var(--accent)",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
            title="Download full journal as CSV spreadsheet"
          >
            <Download size={13} />
            Export CSV
          </button>
        </div>
      </header>

      {/* 2. INSTITUTIONAL SHEET TABS (ALL / DEFAULT MODEL / PROP-FIRM SAFE) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "var(--panel, #151a23)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "6px 10px",
        }}
      >
        <button
          onClick={() => setActiveSheet("ALL")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 12px",
            borderRadius: 7,
            border: activeSheet === "ALL" ? "1px solid rgba(41, 98, 255, 0.4)" : "1px solid transparent",
            background: activeSheet === "ALL" ? "rgba(41, 98, 255, 0.15)" : "transparent",
            color: activeSheet === "ALL" ? "var(--accent)" : "var(--muted)",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          title="All Trades Sheet"
          aria-label="All Trades Sheet"
        >
          <FileSpreadsheet size={13} />
          <span
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 10,
              background: activeSheet === "ALL" ? "var(--accent)" : "rgba(255, 255, 255, 0.08)",
              color: activeSheet === "ALL" ? "#fff" : "var(--muted)",
              fontWeight: 800,
            }}
          >
            {sheetCounts.all}
          </span>
        </button>

        <button
          onClick={() => setActiveSheet("milestone_50")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 12px",
            borderRadius: 7,
            border: activeSheet === "milestone_50" ? "1px solid rgba(41, 98, 255, 0.4)" : "1px solid transparent",
            background: activeSheet === "milestone_50" ? "rgba(41, 98, 255, 0.15)" : "transparent",
            color: activeSheet === "milestone_50" ? "var(--accent)" : "var(--muted)",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          title="Default Model Sheet (50% Milestone + Runner)"
          aria-label="Default Model Sheet (50% Milestone + Runner)"
        >
          <Zap size={13} />
          <span
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 10,
              background: activeSheet === "milestone_50" ? "var(--accent)" : "rgba(255, 255, 255, 0.08)",
              color: activeSheet === "milestone_50" ? "#fff" : "var(--muted)",
              fontWeight: 800,
            }}
          >
            {sheetCounts.def}
          </span>
        </button>

        <button
          onClick={() => setActiveSheet("prop_firm_safe")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 12px",
            borderRadius: 7,
            border: activeSheet === "prop_firm_safe" ? "1px solid rgba(171, 71, 188, 0.4)" : "1px solid transparent",
            background: activeSheet === "prop_firm_safe" ? "rgba(171, 71, 188, 0.15)" : "transparent",
            color: activeSheet === "prop_firm_safe" ? "var(--purple, #ab47bc)" : "var(--muted)",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          title="Prop-Firm Safe Sheet (1.5R–2.5R Target)"
          aria-label="Prop-Firm Safe Sheet (1.5R–2.5R Target)"
        >
          <Shield size={13} />
          <span
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 10,
              background: activeSheet === "prop_firm_safe" ? "var(--purple, #ab47bc)" : "rgba(255, 255, 255, 0.08)",
              color: activeSheet === "prop_firm_safe" ? "#fff" : "var(--muted)",
              fontWeight: 800,
            }}
          >
            {sheetCounts.prop}
          </span>
        </button>
      </div>

      {/* 3. EXECUTIVE PERFORMANCE KPIS (EXCLUDING BE FROM WIN RATE) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 170px), 1fr))",
          gap: 10,
        }}
      >
        <div style={{ background: "var(--panel, #151a23)", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700 }}>
            WIN RATE {activeSheet !== "ALL" ? `(${activeSheet === "milestone_50" ? "DEFAULT" : "PROP-FIRM"})` : "(ALL)"}
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: scopedKpis.winRate >= 50 ? "var(--green)" : "var(--orange)", fontFamily: "monospace" }}>
            {scopedKpis.winRate}%
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
            {scopedKpis.winsCount}W · {scopedKpis.lossesCount}L · {scopedKpis.beCount}BE <span style={{ opacity: 0.7 }}>(excl. BE)</span>
          </div>
        </div>

        <div style={{ background: "var(--panel, #151a23)", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700 }}>NET REALIZED RETURN</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: scopedKpis.totalR >= 0 ? "var(--green)" : "var(--red)", fontFamily: "monospace" }}>
            {scopedKpis.totalR >= 0 ? `+${scopedKpis.totalR}` : scopedKpis.totalR} R
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
            ${scopedKpis.totalPnl >= 0 ? `+${scopedKpis.totalPnl}` : scopedKpis.totalPnl} Net USD
          </div>
        </div>

        <div style={{ background: "var(--panel, #151a23)", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700 }}>PROFIT FACTOR / AVG R</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--accent)", fontFamily: "monospace" }}>
            {scopedKpis.profitFactor}x
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
            Avg: {scopedKpis.avgR > 0 ? `+${scopedKpis.avgR}` : scopedKpis.avgR} R / trade
          </div>
        </div>

        <div style={{ background: "var(--panel, #151a23)", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700 }}>ACTIVE & CLOSED TRADES</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--fg)", fontFamily: "monospace" }}>
            {scopedKpis.closedCount} closed
          </div>
          <div style={{ fontSize: 10, color: "var(--green)", marginTop: 2 }}>
            {scopedKpis.openCount} running positions
          </div>
        </div>

        <div style={{ background: "var(--panel, #151a23)", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700 }}>MAX EQUITY / MAX DD</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--green)", fontFamily: "monospace" }}>
            +{scopedKpis.maxEquityR} R
          </div>
          <div style={{ fontSize: 10, color: "var(--red)", marginTop: 2, fontFamily: "monospace" }}>
            Deepest DD: {scopedKpis.maxDrawdownR} R
          </div>
        </div>
      </div>

      {/* 4. MULTI-SELECT FILTER CONTROLS BAR (CUSTOM DARK POPOVERS - ZERO WHITE BACKGROUNDS) */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          background: "var(--panel, #151a23)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "10px 14px",
        }}
      >
        {/* Real-time Global Search */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "5px 10px",
            flex: "1 1 180px",
            minWidth: 160,
          }}
        >
          <Search size={13} style={{ color: "var(--muted)" }} />
          <input
            type="text"
            placeholder="Quick search symbol, notes, model..."
            value={quickSearch}
            onChange={onQuickSearchChange}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--fg)",
              fontSize: 11,
              outline: "none",
              width: "100%",
            }}
          />
        </div>

        {/* 1. Multi-Select Outcome Filter (Strictly executed outcomes: WIN, LOSS, BREAKEVEN, OPEN) */}
        <MultiSelectFilter
          label="Outcome"
          icon={CheckCircle2}
          options={[
            { value: "WIN", label: "Wins Only 🎯", badge: "TP" },
            { value: "LOSS", label: "Losses 🛑", badge: "SL" },
            { value: "BREAKEVEN", label: "Breakeven ⚪ (±0.2R)", badge: "BE" },
            { value: "OPEN", label: "Open Positions 🟢", badge: "Running" },
          ]}
          selected={selectedOutcomes}
          onChange={setSelectedOutcomes}
          placeholder="All Outcomes"
        />

        {/* 2. Multi-Select Risk Model Filter */}
        <MultiSelectFilter
          label="Model"
          icon={Shield}
          options={[
            { value: "milestone_50", label: "Default (50% Milestone)", short: "Default" },
            { value: "prop_firm_safe", label: "Prop-Firm Safe (1.5R–2.5R)", short: "Prop-Firm" },
          ]}
          selected={selectedModels}
          onChange={setSelectedModels}
          placeholder="All Risk Models"
        />

        {/* 3. Multi-Select Horizon Filter */}
        <MultiSelectFilter
          label="Horizon"
          icon={Layers}
          options={[
            { value: "swing", label: "Swing (1D-1H)", short: "Swing" },
            { value: "day", label: "Day Trade (4H-15M)", short: "Day" },
          ]}
          selected={selectedHorizons}
          onChange={setSelectedHorizons}
          placeholder="All Horizons"
        />

        {/* 4. Multi-Select Symbol Filter */}
        {uniqueSymbols.length > 0 && (
          <MultiSelectFilter
            label="Symbol"
            icon={Target}
            options={uniqueSymbols.map((s) => ({ value: s, label: s }))}
            selected={selectedSymbols}
            onChange={setSelectedSymbols}
            placeholder="All Symbols"
          />
        )}

        {/* 5. Multi-Select Session Filter */}
        {uniqueSessions.length > 0 && (
          <MultiSelectFilter
            label="Session"
            icon={Clock}
            options={uniqueSessions.map((s) => ({ value: s, label: s }))}
            selected={selectedSessions}
            onChange={setSelectedSessions}
            placeholder="All Sessions"
          />
        )}

        {/* Date Filters */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "var(--muted)" }}>From:</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--fg)",
              padding: "4px 8px",
              fontSize: 11,
            }}
          />
          <span style={{ fontSize: 10, color: "var(--muted)" }}>To:</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--fg)",
              padding: "4px 8px",
              fontSize: 11,
            }}
          />
          {(startDate ||
            endDate ||
            selectedModels.length > 0 ||
            selectedHorizons.length > 0 ||
            selectedSymbols.length > 0 ||
            selectedSessions.length > 0 ||
            selectedOutcomes.length !== 4 ||
            quickSearch) && (
            <button
              onClick={() => {
                setSelectedOutcomes(["WIN", "LOSS", "BREAKEVEN", "OPEN"]);
                setSelectedModels([]);
                setSelectedHorizons([]);
                setSelectedSymbols([]);
                setSelectedSessions([]);
                setStartDate("");
                setEndDate("");
                setQuickSearch("");
              }}
              style={{
                background: "rgba(239, 83, 80, 0.15)",
                border: "none",
                color: "var(--red)",
                borderRadius: 4,
                padding: "4px 8px",
                fontSize: 10,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* 5. DATA PRESENTATION CONTAINER (SPREADSHEET OR TABLE VIEW) */}
      {viewMode === "spreadsheet" ? (
        <div
          className={isLightOrCreamy ? "ag-theme-quartz" : "ag-theme-quartz-dark"}
          style={{
            width: "100%",
            height: "calc(100vh - 290px)",
            minHeight: 560,
            borderRadius: 12,
            border: "1px solid var(--border)",
            overflow: "hidden",
            background: "var(--panel)",
          }}
        >
          <AgGridReact
            ref={gridRef}
            theme={gridTheme}
            modules={[AllCommunityModule]}
            rowData={filteredTrades}
            columnDefs={colDefs}
            defaultColDef={defaultColDef}
            getRowId={(params) => String(params.data?.id || params.data?._id || params.data?.ticket)}
            rowSelection="single"
            animateRows={true}
            pagination={true}
            paginationPageSize={50}
            paginationPageSizeSelector={[25, 50, 100, 250, 500]}
            onRowClicked={(event) => setSelectedTrade(event.data)}
            onGridReady={(_params) => {
              // Maintain institutional column widths with horizontal scrolling
            }}
            reactiveCustomComponents={true}
            overlayLoadingTemplate={
              '<span style="color: var(--muted); font-size: 12px;">Loading institutional journal records...</span>'
            }
            overlayNoRowsTemplate={
              '<div style="padding: 32px; text-align: center; color: var(--muted); font-size: 12px;">No trade records matching active filters.</div>'
            }
          />
        </div>
      ) : (
        <div
          style={{
            width: "100%",
            height: "calc(100vh - 290px)",
            minHeight: 560,
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--panel, #151a23)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {filteredTrades.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: 40,
                color: "var(--muted)",
                fontSize: 13,
                gap: 10,
              }}
            >
              <div>No trade records matching active filters.</div>
              <button
                onClick={() => {
                  setSelectedOutcomes(["WIN", "LOSS", "BREAKEVEN", "OPEN"]);
                  setSelectedModels([]);
                  setSelectedHorizons([]);
                  setSelectedSymbols([]);
                  setSelectedSessions([]);
                  setStartDate("");
                  setEndDate("");
                  setQuickSearch("");
                }}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  background: "rgba(41, 98, 255, 0.15)",
                  border: "1px solid rgba(41, 98, 255, 0.3)",
                  color: "var(--accent)",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Reset All Filters
              </button>
            </div>
          ) : (
            <div style={{ overflowX: "auto", flex: 1 }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                  textAlign: "left",
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "var(--panel-2)",
                      borderBottom: "1px solid var(--border)",
                      color: "var(--muted)",
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <th style={{ padding: "10px 14px" }}>Entry Time (EET)</th>
                    <th style={{ padding: "10px 14px" }}>Symbol</th>
                    <th style={{ padding: "10px 14px" }}>Side</th>
                    <th style={{ padding: "10px 14px" }}>Risk Model</th>
                    <th style={{ padding: "10px 14px" }}>Milestone Redecision</th>
                    <th style={{ padding: "10px 14px" }}>Outcome</th>
                    <th style={{ padding: "10px 14px" }}>Actual R (AR)</th>
                    <th style={{ padding: "10px 14px" }}>Ideal R (IR)</th>
                    <th style={{ padding: "10px 14px" }}>Net Profit ($)</th>
                    <th style={{ padding: "10px 14px" }}>MFE / MAE</th>
                    <th style={{ padding: "10px 14px" }}>Entry → Exit</th>
                    <th style={{ padding: "10px 14px" }}>SL / Active TP</th>
                    <th style={{ padding: "10px 14px" }}>Full Assigned TP</th>
                    <th style={{ padding: "10px 14px" }}>Lots</th>
                    <th style={{ padding: "10px 14px" }}>Hold</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTrades.map((t) => {
                    const isBuy = t.dirLabel === "BUY" || t.dir === 1;
                    const isProp = t.isPropFirm;
                    const ar = Number(t.actualR ?? t.realizedR ?? 0);
                    const ir = Number(t.idealR ?? t.targetRR ?? 0);
                    const pnl = Number(t.realizedPnlUsd ?? 0);

                    // Classify outcome (-0.2R to +0.2R treated strictly as BREAKEVEN)
                    let out = t.outcome || "OPEN";
                    if (out !== "CANCELLED" && out !== "OPEN") {
                      if (ar >= -0.2 && ar <= 0.2) out = "BREAKEVEN";
                      else if (ar > 0.2) out = "WIN";
                      else out = "LOSS";
                    }

                    return (
                      <tr
                        key={t.id || t._id}
                        onClick={() => setSelectedTrade(t)}
                        style={{
                          borderBottom: "1px solid var(--border)",
                          cursor: "pointer",
                          transition: "background 0.12s ease",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <td style={{ padding: "10px 14px", color: "var(--fg)", whiteSpace: "nowrap" }}>
                          {formatDateEET(t.entryTime)}
                        </td>
                        <td style={{ padding: "10px 14px", fontWeight: 700, fontFamily: "monospace" }}>
                          {t.symbol}
                        </td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              padding: "2px 7px",
                              borderRadius: 4,
                              background: isBuy ? "rgba(38, 166, 154, 0.18)" : "rgba(239, 83, 80, 0.18)",
                              color: isBuy ? "var(--green)" : "var(--red)",
                            }}
                          >
                            {isBuy ? "BUY ▲" : "SELL ▼"}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: "2px 7px",
                              borderRadius: 4,
                              background: isProp ? "rgba(171, 71, 188, 0.18)" : "rgba(41, 98, 255, 0.18)",
                              color: isProp ? "var(--purple, #ab47bc)" : "var(--accent)",
                            }}
                          >
                            {isProp ? "PROP-FIRM" : "DEFAULT (50%)"}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                          {t.redecisionAction ? (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 800,
                                padding: "2px 7px",
                                borderRadius: 4,
                                background:
                                  t.redecisionAction === "CLOSE_FULL_NOW"
                                    ? "rgba(239, 83, 80, 0.18)"
                                    : t.redecisionAction === "REDUCE_TP"
                                    ? "rgba(255, 179, 0, 0.18)"
                                    : t.redecisionAction === "EXPAND_TP"
                                    ? "rgba(171, 71, 188, 0.18)"
                                    : "rgba(38, 166, 154, 0.18)",
                                color:
                                  t.redecisionAction === "CLOSE_FULL_NOW"
                                    ? "var(--red)"
                                    : t.redecisionAction === "REDUCE_TP"
                                    ? "var(--orange, #ffb300)"
                                    : t.redecisionAction === "EXPAND_TP"
                                    ? "var(--purple, #ab47bc)"
                                    : "var(--green)",
                                fontFamily: "monospace",
                              }}
                              title={t.redecisionReason || `AMRE Score: ${t.redecisionScore}`}
                            >
                              {t.redecisionAction === "CLOSE_FULL_NOW"
                                ? "CLOSE NOW"
                                : t.redecisionAction === "REDUCE_TP"
                                ? `REDUCE (${t.redecisionNewRR ?? "-"}R)`
                                : t.redecisionAction === "EXPAND_TP"
                                ? `EXPAND (${t.redecisionNewRR ?? "-"}R)`
                                : "HOLD FULL"}
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, color: "var(--muted)", fontStyle: "italic" }}>
                              {t.isPropFirm ? "N/A" : "-"}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              padding: "2px 7px",
                              borderRadius: 4,
                              background:
                                out === "WIN"
                                  ? "rgba(38, 166, 154, 0.2)"
                                  : out === "LOSS"
                                  ? "rgba(239, 83, 80, 0.2)"
                                  : out === "BREAKEVEN"
                                  ? "rgba(255, 255, 255, 0.1)"
                                  : "rgba(41, 98, 255, 0.2)",
                              color:
                                out === "WIN"
                                  ? "var(--green)"
                                  : out === "LOSS"
                                  ? "var(--red)"
                                  : out === "BREAKEVEN"
                                  ? "var(--muted)"
                                  : "var(--accent)",
                            }}
                          >
                            {out} {out === "WIN" ? "🎯" : out === "LOSS" ? "🛑" : out === "BREAKEVEN" ? "⚪" : "🟢"}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontWeight: 800, whiteSpace: "nowrap" }}>
                          <span
                            style={{
                              color: ar > 0.2 ? "var(--green)" : ar < -0.2 ? "var(--red)" : "var(--muted)",
                              background: ar > 0.2 ? "rgba(38, 166, 154, 0.1)" : ar < -0.2 ? "rgba(239, 83, 80, 0.1)" : "transparent",
                              padding: "2px 6px",
                              borderRadius: 4,
                            }}
                          >
                            {ar >= -0.2 && ar <= 0.2 ? "0.00 AR (BE)" : ar > 0 ? `+${ar.toFixed(2)} AR` : `${ar.toFixed(2)} AR`}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap" }}>
                          {out === "WIN" || (out === "OPEN" && ar > 0.2) ? (
                            <span style={{ color: "var(--accent)" }}>+{ir.toFixed(2)} IR</span>
                          ) : (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap" }}>
                          <span style={{ color: pnl > 0 ? "var(--green)" : pnl < 0 ? "var(--red)" : "var(--muted)" }}>
                            {formatCurrency(pnl)}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap" }}>
                          <span style={{ color: "var(--green)" }}>+{Number(t.peakR || 0).toFixed(2)}R</span>
                          <span style={{ color: "var(--muted)" }}> / </span>
                          <span style={{ color: "var(--red)" }}>{Number(t.maxDrawdownR || 0).toFixed(2)}R</span>
                        </td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap" }}>
                          {formatPrice5(t.entryPrice)} → {t.exitPrice ? formatPrice5(t.exitPrice) : "-"}
                        </td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap" }}>
                          <span style={{ color: "var(--red)" }}>{formatPrice5(t.slPrice)}</span>
                          <span style={{ color: "var(--muted)" }}> / </span>
                          <span style={{ color: "var(--green)" }}>{formatPrice5(t.tpPrice)}</span>
                        </td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap" }}>
                          <span style={{ color: "var(--green)", fontWeight: 700 }}>
                            {formatPrice5(t.fullTpPrice ?? t.tpPrice)}
                            {t.fullTpRR || t.targetRR ? ` (${t.fullTpRR || t.targetRR}R)` : ""}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap" }}>
                          {formatPrice5(t.lotSize)}
                        </td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap" }}>
                          {t.durationMinutes != null ? `${t.durationMinutes}m` : "-"}
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTrade(t);
                              }}
                              style={{
                                padding: "3px 8px",
                                fontSize: 10,
                                fontWeight: 700,
                                borderRadius: 4,
                                background: "rgba(255, 255, 255, 0.06)",
                                border: "1px solid var(--border)",
                                color: "var(--fg)",
                                cursor: "pointer",
                              }}
                            >
                              Inspect
                            </button>
                            <a
                              href={`/?symbol=${encodeURIComponent(t.symbol)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                padding: "3px 8px",
                                fontSize: 10,
                                fontWeight: 700,
                                borderRadius: 4,
                                background: "rgba(41, 98, 255, 0.15)",
                                border: "1px solid rgba(41, 98, 255, 0.3)",
                                color: "var(--accent)",
                                textDecoration: "none",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                              }}
                            >
                              Chart <ExternalLink size={10} />
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 6. DEEP INSPECTION & JOURNAL DRAWER MODAL */}
      {selectedTrade && (
        <JournalDrawerModal
          trade={selectedTrade}
          onClose={() => setSelectedTrade(null)}
          onSaveJournal={handleSaveJournal}
          saving={savingJournal}
        />
      )}
    </div>
  );
}
