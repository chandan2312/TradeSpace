"use client";

import { useState, useMemo, useEffect, memo } from "react";
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
  Clock,
  Radio,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { finiteNumber, formatPrice, markPriceFor, calculateSlDistance } from "./TradeTelemetry";
import { resolveRadarTradeIdeaPricing } from "../../lib/autonomous/tradeDrawing";
import { isTradingPermittedNow } from "../../lib/autonomous/timeslots";
import ModelBadge from "./ModelBadge";
import NegativeScoreBarWithTooltip from "./NegativeScoreBarWithTooltip";
import PositiveScoreBarWithTooltip from "./PositiveScoreBarWithTooltip";
import SessionLedDot from "./SessionLedDot";
import RadarCard from "./RadarCard";

function formatTimeAgo(timestamp, now = Date.now()) {
  if (!timestamp) return "just now";
  const t = typeof timestamp === "string" ? new Date(timestamp).getTime() : (timestamp > 1e11 ? timestamp : timestamp * 1000);
  if (!Number.isFinite(t) || t <= 0) return "just now";
  const diffSec = Math.max(0, Math.round((now - t) / 1000));
  if (diffSec < 8) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

function checkSessionAllowed(pair, config, now) {
  // 1. Live dynamic evaluation based on latest user config and current clock
  try {
    const live = isTradingPermittedNow(now ? new Date(now) : new Date(), config, pair?.symbol);
    const slotName = live.slot?.name || pair?.activeTimeSlot?.name || "Trading Session";
    return {
      allowed: Boolean(live.permitted),
      slotName: live.slot?.shortBadge || (live.permitted ? "ACTIVE" : "OFF"),
      fullName: slotName,
      tooltip: live.permitted
        ? `🟢 Allowed Trading Session: Active (${slotName}) — Order Execution Permitted`
        : `🔴 Outside Allowed Session: ${live.reason || "Outside Permitted Execution Hours"}`,
    };
  } catch {
    // 2. Direct boolean if evaluated by backend scanner
    if (pair?.sessionProfile && typeof pair.sessionProfile.isCurrentlyActive === "boolean") {
      const slotName = pair.activeTimeSlot?.name || pair.sessionProfile?.fullLabel || pair.sessionProfile?.label || "Trading Session";
      const allowed = pair.sessionProfile.isCurrentlyActive;
      return {
        allowed,
        slotName: pair.activeTimeSlot?.shortBadge || (allowed ? "ACTIVE" : "OFF"),
        fullName: slotName,
        tooltip: allowed
          ? `🟢 Allowed Trading Session: Active (${slotName}) — Order Execution Permitted`
          : `🔴 Outside Allowed Session: ${pair.sessionProfile?.reason || pair.sessionProfile?.description || "Outside Permitted Execution Hours"}`,
      };
    }

    // 3. Fallback based on status & vetoes
    const hasTimingVeto = pair?.vetoes?.some(
      (v) => v.code === "TIMING" || v.code === "DEAD_ZONE" || v.code === "OFF_SESSION" || v.code === "SESSION_RESTRICTED"
    );
    const allowed = !hasTimingVeto && !/OFF_SESSION|DEAD_ZONE|TIMING/.test(pair?.status || "");
    return {
      allowed,
      slotName: allowed ? "ACTIVE" : "OFF",
      fullName: "Trading Window",
      tooltip: allowed
        ? "🟢 In Allowed Trading Session — Execution Permitted"
        : "🔴 Outside Allowed Trading Session — Execution Blocked",
    };
  }
}

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
  config = {},
  scannedAt = null,
}) {
  const [currentNow, setCurrentNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentNow(Date.now());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const [horizonFilter, setHorizonFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
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
          (pair.opportunityScore || 0) >= 60 ||
          (pair.brain?.conviction || 0) >= 75 ||
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

      {/* Dynamic Keyframes for Pulsing Session LED Beacons */}
      <style>{`
        @keyframes radar-led-pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
            box-shadow: 0 0 8px rgba(34, 197, 94, 0.95), 0 0 2px #22c55e;
          }
          50% {
            opacity: 0.6;
            transform: scale(0.85);
            box-shadow: 0 0 3px rgba(34, 197, 94, 0.4), 0 0 1px #22c55e;
          }
        }
        @keyframes radar-led-pulse-red {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
            box-shadow: 0 0 8px rgba(239, 68, 68, 0.85), 0 0 2px #ef4444;
          }
          50% {
            opacity: 0.6;
            transform: scale(0.85);
            box-shadow: 0 0 3px rgba(239, 68, 68, 0.35), 0 0 1px #ef4444;
          }
        }
      `}</style>

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
            const sym = pair.tradeableSymbol || pair.symbol;
            const pairTick = ticks[sym] || ticks[pair.symbol] || ticks[pair.tradeableSymbol];
            return (
              <RadarCard
                key={pair.radarKey || `${pair.symbol}:${pair.horizon || index}`}
                pair={pair}
                index={index}
                isWhitelisted={whitelistSet.has(pair.symbol)}
                onInspectPair={onInspectPair}
                onToggleWhitelist={onToggleWhitelist}
                config={config}
                currentNow={currentNow}
                tick={pairTick}
                scannedAt={scannedAt}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
