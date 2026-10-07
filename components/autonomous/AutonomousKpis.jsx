"use client";

import { Activity, ShieldCheck, TrendingUp, Zap, Target, DollarSign } from "lucide-react";
import { finiteNumber, formatR, formatUsd } from "./TradeTelemetry";

export default function AutonomousKpis({ metrics, config, brokerAccount }) {
  const activeCount = finiteNumber(metrics?.activeCount);
  const maxConcurrent = finiteNumber(config?.maxConcurrentTrades);
  const stagedCount = finiteNumber(metrics?.stagedCount);
  const winRate = finiteNumber(metrics?.winRate);
  const wins = finiteNumber(metrics?.wins);
  const losses = finiteNumber(metrics?.losses);
  const breakevens = finiteNumber(metrics?.breakevens);
  const totalR = finiteNumber(metrics?.totalR);
  const profitFactor = finiteNumber(metrics?.profitFactor);
  const maxDailyLoss = finiteNumber(config?.maxDailyLossPct);
  const isBrokerLive = Number(brokerAccount?.equity ?? brokerAccount?.balance) > 0;
  const effectiveEquity = isBrokerLive ? Number(brokerAccount.equity ?? brokerAccount.balance) : finiteNumber(config?.accountSize);
  const riskPct = finiteNumber(config?.riskPerTradePct) ?? 1;
  const unavailable = "Unavailable";

  const cards = [
    {
      label: "Active Positions",
      value: activeCount !== null && maxConcurrent !== null ? `${activeCount} / ${maxConcurrent}` : unavailable,
      sub: "Open capacity includes pending reservations",
      icon: Activity,
      color: activeCount > 0 ? "var(--green)" : "var(--muted)",
    },
    {
      label: "Staged / Pending",
      value: stagedCount ?? unavailable,
      sub: "Includes broker reconciliation",
      icon: Zap,
      color: stagedCount > 0 ? "var(--accent)" : "var(--muted)",
    },
    {
      label: "Win Rate",
      value: winRate !== null ? `${winRate}%` : unavailable,
      sub: wins !== null && losses !== null ? `${wins}W · ${losses}L${breakevens !== null ? ` · ${breakevens}BE` : ""} closed` : "Closed metrics unavailable",
      icon: Target,
      color: winRate >= 50 ? "var(--green)" : winRate > 0 ? "var(--orange)" : "var(--muted)",
    },
    {
      label: "Net Realized R",
      value: formatR(totalR),
      sub: `Profit Factor: ${profitFactor ?? unavailable}`,
      icon: TrendingUp,
      color: totalR >= 0 ? "var(--green)" : "var(--red)",
    },
    {
      label: isBrokerLive ? "Live Broker Equity" : "Configured Account Size",
      value: formatUsd(effectiveEquity),
      sub: isBrokerLive
        ? `Risk/trade: ${riskPct}% (${formatUsd(effectiveEquity * riskPct / 100)}) · ${brokerAccount.server || "MT5"} #${brokerAccount.login}`
        : (effectiveEquity !== null ? `Risk/trade: ${riskPct}% (${formatUsd(effectiveEquity * riskPct / 100)}) · Paper Sim` : "Risk configuration unavailable"),
      icon: DollarSign,
      color: isBrokerLive ? "var(--green)" : "var(--fg)",
    },
    {
      label: "Daily Circuit Breaker",
      value: config?.enforceDollarRiskCaps === false
        ? (config?.maxDailyLossR ? `Max -${config.maxDailyLossR}R` : "Unconstrained (R-Mode)")
        : (maxDailyLoss !== null ? `Max -${maxDailyLoss}%` : unavailable),
      sub: config?.enforceDollarRiskCaps === false ? "Demo Sender (Copier R-Mode)" : "Auto-halt safeguard",
      icon: ShieldCheck,
      color: "var(--purple)",
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 170px), 1fr))",
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
