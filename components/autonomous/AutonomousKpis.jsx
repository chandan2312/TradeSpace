"use client";

import { Activity, ShieldCheck, TrendingUp, Zap, Target, DollarSign } from "lucide-react";

export default function AutonomousKpis({ metrics, config }) {
  const activeCount = metrics?.activeCount ?? 0;
  const maxConcurrent = config?.maxConcurrentTrades ?? 3;
  const stagedCount = metrics?.stagedCount ?? 0;
  const winRate = metrics?.winRate ?? 0;
  const wins = metrics?.wins ?? 0;
  const losses = metrics?.losses ?? 0;
  const totalR = metrics?.totalR ?? 0;
  const profitFactor = metrics?.profitFactor ?? 0;
  const maxDailyLoss = config?.maxDailyLossPct ?? 3.0;

  const cards = [
    {
      label: "Active Positions",
      value: `${activeCount} / ${maxConcurrent}`,
      sub: `${maxConcurrent - activeCount} slots open`,
      icon: Activity,
      color: activeCount > 0 ? "var(--green)" : "var(--muted)",
    },
    {
      label: "Staged Setups",
      value: stagedCount,
      sub: "Qualified by Brain",
      icon: Zap,
      color: stagedCount > 0 ? "var(--accent)" : "var(--muted)",
    },
    {
      label: "Win Rate",
      value: `${winRate}%`,
      sub: `${wins}W · ${losses}L closed`,
      icon: Target,
      color: winRate >= 50 ? "var(--green)" : winRate > 0 ? "var(--orange)" : "var(--muted)",
    },
    {
      label: "Net Realized R",
      value: `${totalR >= 0 ? "+" : ""}${totalR}R`,
      sub: `Profit Factor: ${profitFactor}`,
      icon: TrendingUp,
      color: totalR >= 0 ? "var(--green)" : "var(--red)",
    },
    {
      label: "Simulated Account",
      value: `$${(config?.accountSize || 50000).toLocaleString()}`,
      sub: `Risk/trade: ${config?.riskPerTradePct || 1}% ($${Math.round((config?.accountSize || 50000) * ((config?.riskPerTradePct || 1) / 100))})`,
      icon: DollarSign,
      color: "var(--fg)",
    },
    {
      label: "Daily Circuit Breaker",
      value: `Max -${maxDailyLoss}%`,
      sub: "Auto-halt safeguard",
      icon: ShieldCheck,
      color: "var(--purple)",
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
        gap: 12,
        marginBottom: 16,
      }}
    >
      {cards.map((c, idx) => {
        const Icon = c.icon;
        return (
          <div
            key={idx}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 11,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              <span>{c.label}</span>
              <Icon size={14} style={{ color: c.color }} />
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: c.color,
                fontFamily: "monospace",
              }}
            >
              {c.value}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{c.sub}</div>
          </div>
        );
      })}
    </div>
  );
}
