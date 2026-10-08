"use client";

import { useState, useMemo } from "react";
import {
  Compass,
  Eye,
  Star,
  Search,
  X,
  Sparkles,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  Layers,
  Sun,
  TrendingUp,
  Zap,
  CandlestickChart,
  ChevronRight,
  Target,
} from "lucide-react";
import { finiteNumber, formatPrice, markPriceFor } from "./TradeTelemetry";
import { resolveRadarTradeIdeaPricing } from "../../lib/autonomous/tradeDrawing";

const HORIZON_ICONS = {
  all: Layers,
  day: Sun,
  swing: TrendingUp,
  scalp: Zap,
};

const DIRECTION_ICONS = {
  all: ArrowUpDown,
  long: ArrowUp,
  short: ArrowDown,
};

const HORIZON_FILTERS = [
  ["all", "All Horizons"],
  ["day", "Day (4H-15M)"],
  ["swing", "Swing (1D-1H)"],
  ["scalp", "Scalp (30M-5M)"],
];

const STATUS_FILTERS = [
  ["prime", "Prime A+"],
  ["all", "All Statuses"],
  ["top", "Top Setups ★"],
  ["watching", "Watching"],
  ["watchlist", "Watchlist"],
  ["starred", "Starred ★"],
  ["scanning", "Scanning"],
  ["blocked", "Blocked"],
];

const DIRECTION_FILTERS = [
  ["all", "All Dirs"],
  ["long", "Long ▲"],
  ["short", "Short ▼"],
];

const SORT_OPTIONS = [
  ["opportunity", "Best Opportunity"],
  ["score", "Opportunity Score"],
  ["conviction", "Brain Conviction"],
  ["confluence", "Confluence Score"],
  ["rr", "Risk / Reward"],
  ["symbol", "Symbol (A-Z)"],
];

const buttonStyle = {
  padding: "5px 10px",
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 6,
  cursor: "pointer",
  background: "transparent",
  color: "var(--muted)",
  border: "1px solid var(--border)",
  transition: "all 0.15s ease",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  whiteSpace: "nowrap",
};

export default function PairRadar({
  pairs = [],
  onInspectPair,
  onToggleWhitelist,
  whitelist = [],
  ticks = {},
}) {
  const [horizonFilter, setHorizonFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("prime");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("opportunity");
  const [sortDirection, setSortDirection] = useState("desc");

  const whitelistSet = useMemo(() => new Set(whitelist), [whitelist]);

  // Dynamic counts for horizon selector tabs
  const horizonCounts = useMemo(() => {
    const counts = { all: pairs.length, day: 0, swing: 0, scalp: 0 };
    pairs.forEach((p) => {
      const h = p.horizon || p.scenario?.id || "day";
      if (counts[h] !== undefined) counts[h]++;
    });
    return counts;
  }, [pairs]);

  // Dynamic counts for status filter pills conditioned on selected horizon
  const statusCounts = useMemo(() => {
    const inHorizon = pairs.filter((p) => {
      const h = p.horizon || p.scenario?.id || "day";
      return horizonFilter === "all" || h === horizonFilter;
    });

    const counts = {
      all: inHorizon.length,
      top: 0,
      prime: 0,
      watching: 0,
      watchlist: 0,
      starred: 0,
      scanning: 0,
      blocked: 0,
    };

    inHorizon.forEach((p) => {
      const s = p.status || "";
      const isTop =
        s === "PRIME_QUALIFIED" ||
        s.startsWith("WATCHING") ||
        (p.brain?.conviction || 0) >= 75 ||
        (p.opportunityScore || 0) >= 60 ||
        (p.rawScore || p.stagedLevel?.confluenceScore || 0) >= 70;

      if (isTop) counts.top++;
      if (s === "PRIME_QUALIFIED") counts.prime++;
      if (s.startsWith("WATCHING")) counts.watching++;
      if (p.isInMainWatchlist) counts.watchlist++;
      if (whitelistSet.has(p.symbol)) counts.starred++;
      if (s.startsWith("SCANNING")) counts.scanning++;
      if (s.startsWith("BLOCKED")) counts.blocked++;
    });

    return counts;
  }, [pairs, horizonFilter, whitelistSet]);

  // Combined filtering & institutional descending sorting
  const filteredAndSorted = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const filtered = pairs.filter((pair) => {
      const status = pair.status || "";
      const pairHorizon = pair.horizon || pair.scenario?.id || "day";

      // 1. Horizon filter
      if (horizonFilter !== "all" && pairHorizon !== horizonFilter) return false;

      // 2. Search query filter
      if (query) {
        const sym = (pair.symbol || "").toLowerCase();
        const tradeSym = (pair.tradeableSymbol || "").toLowerCase();
        const model = (pair.entryModel?.name || pair.stagedLevel?.modelName || "").toLowerCase();
        if (!sym.includes(query) && !tradeSym.includes(query) && !model.includes(query)) return false;
      }

      // 3. Direction filter
      if (directionFilter === "long" && pair.dir !== 1) return false;
      if (directionFilter === "short" && pair.dir !== -1) return false;

      // 4. Status / Quality filter
      if (statusFilter === "top") {
        return (
          status === "PRIME_QUALIFIED" ||
          status.startsWith("WATCHING") ||
          (pair.brain?.conviction || 0) >= 75 ||
          (pair.opportunityScore || 0) >= 60 ||
          (pair.rawScore || pair.stagedLevel?.confluenceScore || 0) >= 70
        );
      }
      if (statusFilter === "prime") return status === "PRIME_QUALIFIED";
      if (statusFilter === "watching") return status.startsWith("WATCHING");
      if (statusFilter === "watchlist") return Boolean(pair.isInMainWatchlist);
      if (statusFilter === "starred") return whitelistSet.has(pair.symbol);
      if (statusFilter === "scanning") return status.startsWith("SCANNING");
      if (statusFilter === "blocked") return status.startsWith("BLOCKED");

      return true;
    });

    const statusTier = (s) =>
      s === "PRIME_QUALIFIED" ? 4 : s?.startsWith("WATCHING") ? 3 : s?.startsWith("SCANNING") ? 2 : 1;

    filtered.sort((a, b) => {
      let diff = 0;
      if (sortField === "opportunity") {
        diff =
          Number(b.isInMainWatchlist) - Number(a.isInMainWatchlist) ||
          statusTier(b.status) - statusTier(a.status) ||
          (b.opportunityScore || 0) - (a.opportunityScore || 0) ||
          (b.rawScore || b.stagedLevel?.confluenceScore || 0) -
            (a.rawScore || a.stagedLevel?.confluenceScore || 0) ||
          (b.brain?.conviction || 0) - (a.brain?.conviction || 0) ||
          (b.stagedLevel?.zoneScore || 0) - (a.stagedLevel?.zoneScore || 0) ||
          (b.stagedLevel?.rr || b.stagedLevel?.targetRR || 0) -
            (a.stagedLevel?.rr || a.stagedLevel?.targetRR || 0);
      } else if (sortField === "score") {
        diff =
          (b.opportunityScore || 0) - (a.opportunityScore || 0) ||
          (b.rawScore || b.stagedLevel?.confluenceScore || 0) -
            (a.rawScore || a.stagedLevel?.confluenceScore || 0) ||
          (b.brain?.conviction || 0) - (a.brain?.conviction || 0);
      } else if (sortField === "conviction") {
        diff =
          (b.brain?.conviction || 0) - (a.brain?.conviction || 0) ||
          (b.opportunityScore || 0) - (a.opportunityScore || 0);
      } else if (sortField === "confluence") {
        diff =
          (b.rawScore || b.stagedLevel?.confluenceScore || 0) -
            (a.rawScore || a.stagedLevel?.confluenceScore || 0) ||
          (b.opportunityScore || 0) - (a.opportunityScore || 0);
      } else if (sortField === "rr") {
        diff =
          (b.stagedLevel?.rr || b.stagedLevel?.targetRR || 0) -
            (a.stagedLevel?.rr || a.stagedLevel?.targetRR || 0) ||
          (b.opportunityScore || 0) - (a.opportunityScore || 0);
      } else if (sortField === "symbol") {
        diff = a.symbol.localeCompare(b.symbol);
      }

      if (diff === 0) {
        diff =
          a.symbol.localeCompare(b.symbol) ||
          (a.scenario?.horizonCode || 0) - (b.scenario?.horizonCode || 0);
      }

      return sortDirection === "asc" ? -diff : diff;
    });

    return filtered;
  }, [pairs, horizonFilter, searchQuery, directionFilter, statusFilter, sortField, sortDirection, whitelistSet]);

  const hasActiveFilters =
    horizonFilter !== "all" ||
    statusFilter !== "prime" ||
    directionFilter !== "all" ||
    searchQuery.trim() !== "" ||
    sortField !== "opportunity" ||
    sortDirection !== "desc";

  const handleResetFilters = () => {
    setHorizonFilter("all");
    setStatusFilter("prime");
    setDirectionFilter("all");
    setSearchQuery("");
    setSortField("opportunity");
    setSortDirection("desc");
  };

  return (
    <section
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
        minWidth: 0,
      }}
      aria-label="Market Opportunity Radar"
    >
      {/* Top Header & Search / Sort Bar */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          {/* Section Title & Card Count */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Compass size={18} style={{ color: "var(--accent)" }} />
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>
              Market Opportunity Radar
            </h2>
            <span
              style={{
                fontSize: 11,
                color: "var(--muted)",
                fontFamily: "monospace",
                background: "rgba(255, 255, 255, 0.04)",
                padding: "2px 6px",
                borderRadius: 4,
              }}
            >
              ({filteredAndSorted.length} of {pairs.length} cards)
            </span>
          </div>

          {/* Search Bar & Sort Controls */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {/* Search Input */}
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
              }}
            >
              <Search
                size={13}
                style={{
                  position: "absolute",
                  left: 8,
                  color: "var(--muted)",
                  pointerEvents: "none",
                }}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search symbol..."
                aria-label="Search opportunity radar"
                style={{
                  padding: "5px 24px 5px 26px",
                  fontSize: 11,
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "#fff",
                  outline: "none",
                  width: 140,
                  transition: "border-color 0.15s ease",
                }}
                onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
                onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                  style={{
                    position: "absolute",
                    right: 6,
                    background: "transparent",
                    border: "none",
                    color: "var(--muted)",
                    cursor: "pointer",
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Sort Field Dropdown */}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <ArrowUpDown size={12} style={{ color: "var(--muted)" }} />
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value)}
                aria-label="Sort cards by"
                style={{
                  padding: "5px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  background: "rgba(255, 255, 255, 0.04)",
                  color: "var(--fg)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                {SORT_OPTIONS.map(([id, label]) => (
                  <option key={id} value={id} style={{ background: "#181a20", color: "#fff" }}>
                    {label}
                  </option>
                ))}
              </select>

              {/* Sort Direction Toggle */}
              <button
                onClick={() => setSortDirection((d) => (d === "desc" ? "asc" : "desc"))}
                title={`Sorted ${sortDirection === "desc" ? "Descending (High to Low)" : "Ascending (Low to High)"}`}
                aria-label={`Toggle sort direction, currently ${sortDirection}`}
                style={{
                  ...buttonStyle,
                  padding: "5px 8px",
                  color: "var(--accent)",
                  borderColor: "rgba(56, 189, 248, 0.3)",
                  background: "rgba(56, 189, 248, 0.08)",
                }}
              >
                {sortDirection === "desc" ? (
                  <>
                    <ArrowDown size={12} />
                    <span style={{ fontSize: 10 }}>Desc</span>
                  </>
                ) : (
                  <>
                    <ArrowUp size={12} />
                    <span style={{ fontSize: 10 }}>Asc</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Row 1: Horizon Selector Tabs with Counts */}
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            alignItems: "center",
            paddingBottom: 8,
            borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginRight: 2 }}>
            Horizon:
          </span>
          {HORIZON_FILTERS.map(([id, label]) => {
            const active = horizonFilter === id;
            const count = horizonCounts[id] ?? 0;
            const HorizonIcon = HORIZON_ICONS[id] || Layers;
            const activeBg =
              id === "swing"
                ? "rgba(192, 132, 252, 0.2)"
                : id === "scalp"
                ? "rgba(251, 191, 36, 0.2)"
                : id === "day"
                ? "rgba(56, 189, 248, 0.2)"
                : "var(--accent)";
            const activeBorder =
              id === "swing"
                ? "#c084fc"
                : id === "scalp"
                ? "#fbbf24"
                : id === "day"
                ? "#38bdf8"
                : "var(--accent)";
            const activeColor =
              id === "swing"
                ? "#c084fc"
                : id === "scalp"
                ? "#fbbf24"
                : id === "day"
                ? "#38bdf8"
                : "#fff";

            return (
              <button
                key={id}
                aria-pressed={active}
                onClick={() => setHorizonFilter(id)}
                title={label}
                aria-label={label}
                style={{
                  ...buttonStyle,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "5px 8px",
                  color: active ? activeColor : "var(--muted)",
                  background: active ? activeBg : "var(--panel-2)",
                  borderColor: active ? activeBorder : "var(--border)",
                }}
              >
                <HorizonIcon size={12} />
                <span
                  style={{
                    fontSize: 9,
                    fontFamily: "monospace",
                    opacity: active ? 1 : 0.6,
                    background: "var(--panel)",
                    padding: "1px 4px",
                    borderRadius: 3,
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Row 2: Status & Quality Filter Pills + Direction + Reset */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          {/* Status Pills */}
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginRight: 2 }}>
              Filter:
            </span>
            {STATUS_FILTERS.map(([id, label]) => {
              const active = statusFilter === id;
              const count = statusCounts[id] ?? 0;
              const isTop = id === "top";
              const isPrime = id === "prime";

              return (
                <button
                  key={id}
                  aria-pressed={active}
                  onClick={() => setStatusFilter(id)}
                  style={{
                    ...buttonStyle,
                    fontSize: 10,
                    padding: "3px 8px",
                    color: active
                      ? isTop
                        ? "#fbbf24"
                        : isPrime
                        ? "#38bdf8"
                        : "#fff"
                      : isTop
                      ? "#fbbf24"
                      : isPrime
                      ? "var(--accent)"
                      : "var(--muted)",
                    background: active
                      ? isTop
                        ? "rgba(251, 191, 36, 0.18)"
                        : isPrime
                        ? "rgba(56, 189, 248, 0.18)"
                        : "var(--accent)"
                      : isTop
                      ? "rgba(251, 191, 36, 0.05)"
                      : isPrime
                      ? "rgba(56, 189, 248, 0.06)"
                      : "var(--panel-2)",
                    borderColor: active
                      ? isTop
                        ? "#fbbf24"
                        : isPrime
                        ? "#38bdf8"
                        : "var(--accent)"
                      : isTop
                      ? "rgba(251, 191, 36, 0.25)"
                      : isPrime
                      ? "rgba(56, 189, 248, 0.3)"
                      : "var(--border)",
                  }}
                >
                  {isTop && <Sparkles size={10} />}
                  {isPrime && <Sparkles size={10} style={{ color: "#38bdf8" }} />}
                  <span>{label}</span>
                  <span
                    style={{
                      fontSize: 9,
                      fontFamily: "monospace",
                      opacity: 0.7,
                      marginLeft: 2,
                    }}
                  >
                    ({count})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Direction Filter & Reset Link */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {DIRECTION_FILTERS.map(([id, label]) => {
              const active = directionFilter === id;
              const DirIcon = DIRECTION_ICONS[id] || ArrowUpDown;
              return (
                <button
                  key={id}
                  aria-pressed={active}
                  onClick={() => setDirectionFilter(id)}
                  title={label}
                  aria-label={label}
                  style={{
                    ...buttonStyle,
                    fontSize: 10,
                    padding: "3px 8px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: active
                      ? id === "long"
                        ? "var(--green)"
                        : id === "short"
                        ? "var(--red)"
                        : "#fff"
                      : "var(--muted)",
                    background: active ? "rgba(255, 255, 255, 0.08)" : "transparent",
                    borderColor: active ? "var(--fg)" : "var(--border)",
                  }}
                >
                  <DirIcon size={12} />
                </button>
              );
            })}

            {hasActiveFilters && (
              <button
                onClick={handleResetFilters}
                style={{
                  ...buttonStyle,
                  fontSize: 10,
                  padding: "2px 7px",
                  color: "var(--muted)",
                  borderColor: "transparent",
                  textDecoration: "underline",
                }}
              >
                Reset filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Grid of Minimal Pair Cards */}
      {filteredAndSorted.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: 36,
            color: "var(--muted)",
            fontSize: 12,
            border: "1px dashed var(--border)",
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Filter size={20} style={{ opacity: 0.5 }} />
          <span>
            {statusFilter === "prime"
              ? "No Prime A+ qualified setups currently active. Markets are scanning or awaiting retracement."
              : "No market opportunity cards match the selected filter criteria."}
          </span>
          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap", justifyContent: "center" }}>
            {statusFilter === "prime" && (
              <button
                onClick={() => setStatusFilter("all")}
                style={{
                  ...buttonStyle,
                  color: "#fff",
                  background: "var(--accent)",
                  borderColor: "var(--accent)",
                }}
              >
                View All Statuses ({pairs.length})
              </button>
            )}
            {hasActiveFilters && (
              <button
                onClick={handleResetFilters}
                style={{
                  ...buttonStyle,
                  color: "var(--muted)",
                  borderColor: "var(--border)",
                }}
              >
                Reset filters
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))",
            gap: 12,
          }}
        >
          {filteredAndSorted.map((pair, index) => {
            const status = pair.status || "UNAVAILABLE";
            const prime = status === "PRIME_QUALIFIED";
            const isBlocked = status.startsWith("BLOCKED");
            const isWatching = status.startsWith("WATCHING");
            const isScanning = status.startsWith("SCANNING");
            const isOffSession = /OFF_SESSION|DEAD_ZONE|TIMING/.test(status);

            const statusColor = prime
              ? "var(--green)"
              : isWatching
              ? "var(--orange)"
              : isScanning
              ? "var(--accent)"
              : isOffSession
              ? "var(--muted)"
              : isBlocked
              ? "var(--red)"
              : "var(--muted)";

            const level = pair.stagedLevel;
            const pricing = resolveRadarTradeIdeaPricing(pair);
            const entry = pricing.entry;
            const sl = pricing.sl;
            const tp = pricing.tp;
            const displayRR = pricing.rr;

            const conviction = finiteNumber(pair.brain?.conviction);
            const isWhitelisted = whitelistSet.has(pair.symbol);
            const currentMark = markPriceFor(pair, ticks);

            const range = pair.dealingRange || pair.range || {};
            const rangeZone = range.h4Zone || range.zone || "EQUILIBRIUM";
            const coveragePct = finiteNumber(range.h4CoveragePct ?? range.coveragePct ?? range.coverage);
            const dolObj = pair.brain?.htfLiquidity?.drawOnLiquidity || pair.brain?.targetDOL;
            const dolTarget =
              (typeof dolObj === "string" ? dolObj : null) ||
              dolObj?.name ||
              dolObj?.target ||
              dolObj?.label ||
              (dolObj?.type ? `${dolObj.type} ${dolObj.targetSide || ""}`.trim() : null) ||
              (Array.isArray(pair.targets) && pair.targets[0]
                ? typeof pair.targets[0] === "string"
                  ? pair.targets[0]
                  : pair.targets[0]?.label || pair.targets[0]?.name || pair.targets[0]?.source
                : null) ||
              null;
            const modelName =
              (typeof pair.entryModel?.name === "string" && pair.entryModel.name) ||
              (typeof level?.modelName === "string" && level.modelName) ||
              (isWatching ? "Scanning Retracement (FVG / OTE)" : "Structure Shift");

            // Opportunity score calculation & rank styling
            const effectiveScore =
              pair.rawScore ??
              level?.confluenceScore ??
              pair.opportunityScore ??
              0;

            const scoreColor =
              effectiveScore >= 80
                ? "var(--green)"
                : effectiveScore >= 60
                ? "var(--accent)"
                : effectiveScore >= 40
                ? "var(--orange)"
                : "var(--muted)";

            const rankNum = index + 1;
            const rankBadgeColor =
              rankNum === 1
                ? "#fbbf24"
                : rankNum === 2
                ? "#cbd5e1"
                : rankNum === 3
                ? "#f97316"
                : "#64748b";
            const rankBadgeBg =
              rankNum === 1
                ? "rgba(251, 191, 36, 0.15)"
                : rankNum === 2
                ? "rgba(203, 213, 225, 0.12)"
                : rankNum === 3
                ? "rgba(249, 115, 22, 0.12)"
                : "var(--panel)";

            return (
              <article
                key={pair.radarKey || `${pair.symbol}:${pair.horizon || pair.scenario?.id || "day"}`}
                onClick={() => onInspectPair?.(pair)}
                style={{
                  background: prime
                    ? "rgba(34, 197, 94, 0.04)"
                    : isWatching
                    ? "rgba(249, 115, 22, 0.03)"
                    : "var(--panel-2)",
                  border: `1px solid ${
                    prime
                      ? "rgba(34, 197, 94, 0.45)"
                      : isWatching
                      ? "rgba(249, 115, 22, 0.35)"
                      : isScanning
                      ? "rgba(56, 189, 248, 0.25)"
                      : isBlocked
                      ? "rgba(239, 68, 68, 0.2)"
                      : "var(--border)"
                  }`,
                  borderRadius: 10,
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 9,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxShadow: prime ? "0 4px 14px rgba(34, 197, 94, 0.12)" : "none",
                  position: "relative",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--purple, #a855f7)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = prime
                    ? "rgba(34, 197, 94, 0.45)"
                    : isBlocked
                    ? "rgba(239, 68, 68, 0.2)"
                    : "var(--border)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {/* 1. Header: Rank, Star, Symbol, Direction, Horizon & Watchlist */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    {/* Rank Pill */}
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        fontFamily: "monospace",
                        color: rankBadgeColor,
                        background: rankBadgeBg,
                        border: `1px solid ${rankBadgeColor}33`,
                        padding: "1px 5px",
                        borderRadius: 3,
                        minWidth: 20,
                        textAlign: "center",
                      }}
                      title={`Radar Rank #${rankNum}`}
                    >
                      #{rankNum}
                    </span>

                    {/* Whitelist Priority Star */}
                    <button
                      aria-label={`${isWhitelisted ? "Remove" : "Add"} ${pair.symbol} priority whitelist`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleWhitelist?.(pair.symbol);
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: 2,
                        cursor: "pointer",
                        color: isWhitelisted ? "var(--orange)" : "var(--muted)",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <Star size={13} fill={isWhitelisted ? "currentColor" : "none"} />
                    </button>

                    <strong style={{ fontSize: 14 }}>
                      {pair.tradeableSymbol || pair.symbol}
                    </strong>

                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: "1px 6px",
                        borderRadius: 3,
                        background:
                          pair.dir === 1
                            ? "rgba(34, 197, 94, 0.15)"
                            : pair.dir === -1
                            ? "rgba(239, 68, 68, 0.15)"
                            : "var(--panel)",
                        color:
                          pair.dir === 1
                            ? "var(--green)"
                            : pair.dir === -1
                            ? "var(--red)"
                            : "var(--muted)",
                      }}
                    >
                      {pair.dir === 1 ? "LONG ▲" : pair.dir === -1 ? "SHORT ▼" : "NEUTRAL ⬌"}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    {/* Horizon Badge */}
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background:
                          pair.horizon === "swing" || pair.scenario?.id === "swing"
                            ? "rgba(192, 132, 252, 0.15)"
                            : pair.horizon === "scalp" || pair.scenario?.id === "scalp"
                            ? "rgba(251, 191, 36, 0.15)"
                            : "rgba(56, 189, 248, 0.15)",
                        color:
                          pair.horizon === "swing" || pair.scenario?.id === "swing"
                            ? "#c084fc"
                            : pair.horizon === "scalp" || pair.scenario?.id === "scalp"
                            ? "#fbbf24"
                            : "#38bdf8",
                        border: `1px solid ${
                          pair.horizon === "swing" || pair.scenario?.id === "swing"
                            ? "rgba(192, 132, 252, 0.3)"
                            : pair.horizon === "scalp" || pair.scenario?.id === "scalp"
                            ? "rgba(251, 191, 36, 0.3)"
                            : "rgba(56, 189, 248, 0.3)"
                        }`,
                        fontFamily: "monospace",
                      }}
                    >
                      {pair.horizonBadge ||
                        pair.scenario?.badge ||
                        (pair.horizon === "swing"
                          ? "1D-1H"
                          : pair.horizon === "scalp"
                          ? "30M-5M"
                          : "4H-15M")}
                    </span>

                    {/* Status Pill */}
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "1px 6px",
                        borderRadius: 3,
                        background: prime
                          ? "rgba(34, 197, 94, 0.18)"
                          : isWatching
                          ? "rgba(249, 115, 22, 0.15)"
                          : isBlocked
                          ? "rgba(239, 68, 68, 0.12)"
                          : "var(--panel)",
                        color: statusColor,
                        border: `1px solid ${statusColor}40`,
                      }}
                    >
                      {status.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>

                {/* 2. Opportunity & Conviction Visual Dual Meter Strip */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    padding: "6px 8px",
                    background: "var(--panel)",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                  }}
                >
                  {/* Opportunity Score Meter */}
                  <div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 9.5,
                        color: "var(--muted)",
                        marginBottom: 3,
                      }}
                    >
                      <span>Opportunity</span>
                      <strong style={{ fontFamily: "monospace", color: scoreColor }}>
                        {effectiveScore}/100
                      </strong>
                    </div>
                    <div
                      style={{
                        width: "100%",
                        height: 4,
                        borderRadius: 2,
                        background: "var(--panel-2)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, Math.max(0, effectiveScore))}%`,
                          height: "100%",
                          background: scoreColor,
                          borderRadius: 2,
                        }}
                      />
                    </div>
                  </div>

                  {/* Brain Conviction Meter */}
                  <div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 9.5,
                        color: "var(--muted)",
                        marginBottom: 3,
                      }}
                    >
                      <span>Conviction</span>
                      <strong
                        style={{
                          fontFamily: "monospace",
                          color: (conviction ?? 0) >= 75 ? "var(--green)" : "var(--accent)",
                        }}
                      >
                        {conviction !== null ? `${conviction}%` : "—"}
                      </strong>
                    </div>
                    <div
                      style={{
                        width: "100%",
                        height: 4,
                        borderRadius: 2,
                        background: "var(--panel-2)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, Math.max(0, conviction ?? 0))}%`,
                          height: "100%",
                          background: (conviction ?? 0) >= 75 ? "var(--green)" : "var(--accent)",
                          borderRadius: 2,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* 3. Setup Price Geometry Grid (The Core Trade Idea Data) */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: 6,
                    padding: "6px 8px",
                    background: "var(--panel)",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    fontFamily: "monospace",
                    fontSize: 10,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 8.5, color: "var(--muted)", textTransform: "uppercase" }}>Mark</div>
                    <div style={{ fontWeight: 700, color: "var(--fg)" }}>{formatPrice(currentMark)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 8.5, color: "var(--muted)", textTransform: "uppercase" }}>Entry</div>
                    <div style={{ fontWeight: 700, color: "var(--accent)" }}>{entry !== null ? formatPrice(entry) : "—"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 8.5, color: "var(--muted)", textTransform: "uppercase" }}>SL</div>
                    <div style={{ fontWeight: 700, color: "#ea580c" }}>{sl !== null ? formatPrice(sl) : "—"}</div>
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: 8.5, color: "var(--muted)", textTransform: "uppercase" }}>TP / RR</span>
                      {displayRR !== null && (
                        <span style={{ fontSize: 9, fontWeight: 800, color: "var(--purple, #c084fc)" }}>
                          {displayRR.toFixed(1)}R
                        </span>
                      )}
                    </div>
                    <div style={{ fontWeight: 700, color: "#a855f7" }}>{tp !== null ? formatPrice(tp) : "—"}</div>
                  </div>
                </div>

                {/* 4. HTF Dealing Range & DOL Landmark */}
                <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 9.5 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--muted)" }}>
                    <span>
                      Zone:{" "}
                      <strong
                        style={{
                          color: rangeZone.includes("DISCOUNT")
                            ? "var(--green)"
                            : rangeZone.includes("PREMIUM")
                            ? "var(--red)"
                            : "var(--fg)",
                        }}
                      >
                        {rangeZone.replace(/_/g, " ")}
                      </strong>
                      {coveragePct !== null && (
                        <span style={{ opacity: 0.7 }}> ({Math.round(coveragePct)}% EQ)</span>
                      )}
                    </span>
                    {typeof dolTarget === "string" && Boolean(dolTarget) && (
                      <span
                        style={{
                          color: "var(--accent)",
                          maxWidth: "52%",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        🎯 {dolTarget}
                      </span>
                    )}
                  </div>

                  {/* Mini range progress line */}
                  {coveragePct !== null && (
                    <div
                      style={{
                        position: "relative",
                        width: "100%",
                        height: 3,
                        background: "var(--panel)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          left: "50%",
                          top: 0,
                          bottom: 0,
                          width: 1,
                          background: "var(--border)",
                        }}
                      />
                      <div
                        style={{
                          width: `${Math.min(100, Math.max(0, coveragePct))}%`,
                          height: "100%",
                          background: rangeZone.includes("DISCOUNT") ? "var(--green)" : "var(--red)",
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* 5. Footer & CTA Prompt */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 6,
                    fontSize: 10,
                    color: "var(--muted)",
                    borderTop: "1px solid var(--border)",
                    paddingTop: 6,
                  }}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                      color: isBlocked ? "var(--red)" : "var(--muted)",
                    }}
                  >
                    {typeof pair.statusReason === "string" ? pair.statusReason : typeof modelName === "string" ? modelName : "Analyzing setup"}
                  </span>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      color: "var(--purple, #c084fc)",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    <CandlestickChart size={12} />
                    <span>Chart & Brain</span>
                    <ChevronRight size={11} />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
