"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  X,
  Shield,
  Target,
  Zap,
  CheckCircle2,
  ArrowRight,
  Layers,
  Sparkles,
} from "lucide-react";
import {
  BrokerTelemetry,
  TargetLadder,
  TelemetryValue,
  finiteNumber,
  formatPrice,
  formatR,
  formatUsd,
  formatIR,
  formatAR,
  IRARBadge,
  tradeRiskTelemetry,
} from "./TradeTelemetry";
import ModelBadge from "./ModelBadge";

// Helper: Determine if a trade is a Prop-Firm Safe model or Default model
const isPropTrade = (t) =>
  Boolean(
    t.isPropFirm ||
    t.managementLogic === "prop_firm_safe" ||
    t.legId === "prop_firm"
  );

// Helper: Resolve linked sibling from active trade list (without merging them)
function getSiblingTrade(trade, allTrades) {
  if (!trade || !Array.isArray(allTrades)) return null;
  return allTrades.find(
    (other) =>
      other !== trade &&
      other._id !== trade._id &&
      (
        (trade.groupId && other.groupId === trade.groupId) ||
        (trade.symbol === other.symbol &&
          trade.dir === other.dir &&
          Math.abs((trade.entryPrice ?? 0) - (other.entryPrice ?? 0)) < 0.0001)
      )
  );
}

export default function ActivePositions({
  activeTrades = [],
  onCloseTrade,
  ticks = {},
  pendingAction,
}) {
  // Strategy filter: "all" | "default" | "prop_firm"
  const [modelFilter, setModelFilter] = useState("all");

  const defaultTrades = useMemo(
    () => activeTrades.filter((t) => !isPropTrade(t)),
    [activeTrades]
  );
  const propTrades = useMemo(
    () => activeTrades.filter((t) => isPropTrade(t)),
    [activeTrades]
  );

  const displayedTrades = useMemo(() => {
    if (modelFilter === "default") return defaultTrades;
    if (modelFilter === "prop_firm") return propTrades;
    return activeTrades;
  }, [activeTrades, defaultTrades, propTrades, modelFilter]);

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
        minWidth: 0,
      }}
    >
      {/* 1. Header Bar with Independent Counts & Strategy Filter */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 16,
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          paddingBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Activity size={17} style={{ color: "var(--green)" }} />
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0, letterSpacing: "-0.01em" }}>
              Active Positions & Live Cockpit
            </h2>
          </div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 4,
              background: "rgba(34, 197, 94, 0.15)",
              color: "var(--green)",
            }}
          >
            {activeTrades.length} Live {activeTrades.length === 1 ? "Position" : "Positions"}
          </span>
        </div>

        {/* Strategy Switcher Tabs: Show All vs TradeDefault Only vs TradeProp Only */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 3,
          }}
        >
          <button
            onClick={() => setModelFilter("all")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              borderRadius: 6,
              border: "none",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              background: modelFilter === "all" ? "var(--accent)" : "transparent",
              color: modelFilter === "all" ? "#fff" : "var(--muted)",
              transition: "all 0.15s ease",
            }}
          >
            <Layers size={12} />
            <span>All Positions</span>
            <span
              style={{
                fontSize: 9,
                padding: "1px 5px",
                borderRadius: 4,
                background: modelFilter === "all" ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.08)",
                color: modelFilter === "all" ? "#fff" : "var(--muted)",
                fontFamily: "monospace",
              }}
            >
              {activeTrades.length}
            </span>
          </button>

          <button
            onClick={() => setModelFilter("default")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              borderRadius: 6,
              border: "none",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              background: modelFilter === "default" ? "rgba(56, 189, 248, 0.2)" : "transparent",
              color: modelFilter === "default" ? "var(--accent)" : "var(--muted)",
              transition: "all 0.15s ease",
            }}
          >
            <Zap size={12} style={{ color: modelFilter === "default" ? "var(--accent)" : "var(--muted)" }} />
            <span>TradeDefault</span>
            <span
              style={{
                fontSize: 9,
                padding: "1px 5px",
                borderRadius: 4,
                background: modelFilter === "default" ? "var(--accent)" : "rgba(255, 255, 255, 0.08)",
                color: modelFilter === "default" ? "#fff" : "var(--muted)",
                fontFamily: "monospace",
              }}
            >
              {defaultTrades.length}
            </span>
          </button>

          <button
            onClick={() => setModelFilter("prop_firm")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              borderRadius: 6,
              border: "none",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              background: modelFilter === "prop_firm" ? "rgba(168, 85, 247, 0.2)" : "transparent",
              color: modelFilter === "prop_firm" ? "var(--purple, #c084fc)" : "var(--muted)",
              transition: "all 0.15s ease",
            }}
          >
            <Shield size={12} style={{ color: modelFilter === "prop_firm" ? "var(--purple, #c084fc)" : "var(--muted)" }} />
            <span>TradeProp</span>
            <span
              style={{
                fontSize: 9,
                padding: "1px 5px",
                borderRadius: 4,
                background: modelFilter === "prop_firm" ? "var(--purple, #c084fc)" : "rgba(255, 255, 255, 0.08)",
                color: modelFilter === "prop_firm" ? "#fff" : "var(--muted)",
                fontFamily: "monospace",
              }}
            >
              {propTrades.length}
            </span>
          </button>
        </div>
      </div>

      {/* 2. Position List */}
      {displayedTrades.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: 36,
            color: "var(--muted)",
            fontSize: 13,
            border: "1px dashed var(--border)",
            borderRadius: 8,
          }}
        >
          {activeTrades.length === 0
            ? "No open positions currently running. Qualified SMC limits enter on broker fill."
            : modelFilter === "default"
            ? "No active TradeDefault positions currently running."
            : "No active TradeProp positions currently running."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {displayedTrades.map((trade) => {
            const isProp = isPropTrade(trade);
            const sibling = getSiblingTrade(trade, activeTrades);
            const isClosing =
              !!pendingAction ||
              trade.status === "closing" ||
              (!!trade.operation && trade.operation.state !== "failed");

            return isProp ? (
              <StandalonePropTradeCard
                key={trade._id || trade.id || `${trade.symbol}_prop_${trade.ticket}`}
                trade={trade}
                sibling={sibling}
                ticks={ticks}
                onCloseTrade={onCloseTrade}
                isClosing={isClosing}
              />
            ) : (
              <StandaloneDefaultTradeCard
                key={trade._id || trade.id || `${trade.symbol}_def_${trade.ticket}`}
                trade={trade}
                sibling={sibling}
                ticks={ticks}
                onCloseTrade={onCloseTrade}
                isClosing={isClosing}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// STANDALONE TRADEDEFAULT CARD (Milestone 50 + Runner)
// ============================================================================
function StandaloneDefaultTradeCard({
  trade,
  sibling,
  ticks,
  onCloseTrade,
  isClosing,
}) {
  const tel = tradeRiskTelemetry(trade, ticks);
  const dir =
    trade.dir ??
    (String(trade.direction || trade.dirLabel || "").toLowerCase() === "sell"
      ? -1
      : 1);
  const targets = Array.isArray(trade.targets) ? trade.targets : [];
  const fill = tel.fill ?? trade.entryPrice;
  const mark = tel.mark;
  const target =
    targets.find((t) => t.id === "runner")?.price ??
    trade.tpPrice ??
    trade.targetPrice;
  const targetDistance =
    typeof target === "number" && typeof fill === "number"
      ? Math.abs(target - fill)
      : null;
  const targetRR =
    finiteNumber(trade.targetRR) ||
    (targetDistance && tel.initialRisk
      ? targetDistance / tel.initialRisk
      : 2.0);

  // Current Progress %
  let currentProgress = 0;
  if (targetDistance > 0 && mark !== null && fill !== null) {
    currentProgress = Math.min(
      100,
      Math.max(0, ((dir * (mark - fill)) / targetDistance) * 100)
    );
  } else if (targetRR > 0 && tel.priceR !== null) {
    currentProgress = Math.min(100, Math.max(0, (tel.priceR / targetRR) * 100));
  }

  // Peak Excursion %
  const peakPrice = tel.peakPrice ?? trade.peakPrice;
  const peakR = tel.peakR ?? trade.peakR;
  let maxExcursion = currentProgress;
  if (
    targetDistance > 0 &&
    peakPrice !== null &&
    fill !== null &&
    Number.isFinite(peakPrice)
  ) {
    const pFromPrice = Math.min(
      100,
      Math.max(0, ((dir * (peakPrice - fill)) / targetDistance) * 100)
    );
    maxExcursion = Math.max(maxExcursion, pFromPrice);
  }
  if (targetRR > 0 && peakR !== null && Number.isFinite(peakR)) {
    const pFromR = Math.min(100, Math.max(0, (peakR / targetRR) * 100));
    maxExcursion = Math.max(maxExcursion, pFromR);
  }
  maxExcursion = Math.max(currentProgress, maxExcursion);

  const isMilestoneBooked = trade.halfTargetBooked || trade.isBreakeven;

  // Horizon tag
  const isSwing =
    trade.scenario?.id === "swing" ||
    trade.scenario?.horizon === "1D-1H" ||
    trade.horizonCode === 1;
  const isDay =
    trade.scenario?.id === "day" ||
    trade.scenario?.horizon === "4H-15M" ||
    trade.horizonCode === 2;
  const horizonLabel = isSwing
    ? "1D-1H Swing"
    : isDay
    ? "4H-15M Day"
    : "30M-5M Scalp";

  return (
    <article
      style={{
        background: "rgba(56, 189, 248, 0.025)",
        border: "1px solid rgba(56, 189, 248, 0.3)",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minWidth: 0,
        boxShadow: "0 4px 18px rgba(0, 0, 0, 0.2)",
      }}
    >
      {/* 1. Header: Symbol, Side, Prominent Strategy Badge, Tickets & Telemetry */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          paddingBottom: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em" }}>
            {trade.symbol}
          </span>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 800,
              background:
                dir === 1 ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)",
              color: dir === 1 ? "var(--green)" : "var(--red)",
            }}
          >
            {trade.dirLabel || (dir === 1 ? "BUY" : "SELL")}
          </span>

          {/* Primary Strategy Identifier Badge */}
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              padding: "2px 8px",
              borderRadius: 4,
              background: "rgba(56, 189, 248, 0.18)",
              color: "var(--accent)",
              border: "1px solid rgba(56, 189, 248, 0.45)",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Zap size={11} /> TRADEDEFAULT · 50% MILESTONE + RUNNER
          </span>

          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              background: isSwing
                ? "rgba(168, 85, 247, 0.15)"
                : isDay
                ? "rgba(56, 189, 248, 0.15)"
                : "rgba(234, 179, 8, 0.15)",
              color: isSwing
                ? "var(--purple, #c084fc)"
                : isDay
                ? "var(--accent)"
                : "var(--orange)",
            }}
          >
            {horizonLabel}
          </span>
          <ModelBadge item={trade} size="sm" />
          <span
            style={{
              fontSize: 10,
              color: "var(--muted)",
              fontFamily: "monospace",
              background: "var(--panel-2)",
              padding: "1px 5px",
              borderRadius: 3,
              border: "1px solid var(--border)",
            }}
          >
            {trade.tf || "15M"}
          </span>
          <span
            style={{
              fontSize: 10,
              fontFamily: "monospace",
              color: "var(--muted)",
              background: "rgba(255, 255, 255, 0.05)",
              padding: "1px 6px",
              borderRadius: 3,
            }}
          >
            MT5 #{trade.ticket || trade.orderTicket || "--"} ·{" "}
            {finiteNumber(trade.remainingVolume) ?? trade.lotSize ?? trade.lot ?? "--"}L
          </span>

          {/* Sibling Link Notification (Independent reference, not combined) */}
          {sibling && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: 4,
                background: "rgba(168, 85, 247, 0.12)",
                color: "var(--purple, #c084fc)",
                border: "1px solid rgba(168, 85, 247, 0.3)",
              }}
            >
              🔗 Sibling: TradeProp #{sibling.ticket || sibling.orderTicket || "Open"}
            </span>
          )}
        </div>

        {/* Right side: Live Telemetry & Dedicated Close Button */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 800,
                color: (tel.actualR ?? 0) >= 0 ? "var(--green)" : "var(--red)",
              }}
            >
              Actual R {formatAR(tel.actualR)}
              <span
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                  fontWeight: 600,
                  marginLeft: 6,
                }}
              >
                ({formatIR(tel.idealR)})
              </span>
            </div>
            <div style={{ color: (tel.floatingUsd ?? 0) >= 0 ? "var(--green)" : "var(--red)", fontSize: 11 }}>
              {formatUsd(tel.totalUsd ?? tel.floatingUsd)}
            </div>
          </div>

          <button
            disabled={isClosing}
            onClick={() => onCloseTrade(trade._id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "6px 12px",
              borderRadius: 6,
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              color: "var(--red)",
              fontSize: 11,
              fontWeight: 700,
              cursor: isClosing ? "wait" : "pointer",
              opacity: isClosing ? 0.5 : 1,
            }}
            title="Close this TradeDefault position on broker"
          >
            <X size={13} />
            {isClosing ? "Closing..." : "Close TradeDefault"}
          </button>
        </div>
      </div>

      {/* 2. Strategy Logic Descriptor */}
      <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>
        <strong>Execution Model:</strong> 50% target distance books 40% position & moves SL to Breakeven · Remaining 60% runner targets structural TP ({targetRR}R)
      </div>

      {/* 3. Key Telemetry Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 80px), 1fr))",
          gap: 6,
          background: "var(--panel-2)",
          padding: 8,
          borderRadius: 6,
        }}
      >
        <TelemetryValue label="Fill" value={formatPrice(fill)} />
        <TelemetryValue label="Mark" value={formatPrice(mark)} color="var(--accent)" />
        <TelemetryValue
          label={
            trade.isBreakeven
              ? "SL (BE)"
              : trade.isTrailing
              ? "SL (Trail)"
              : trade.isHalfRisk || trade.slHalfMoved
              ? "SL (50%)"
              : "SL"
          }
          value={formatPrice(trade.confirmedSlPrice ?? trade.slPrice)}
          color={
            isMilestoneBooked || trade.isBreakeven
              ? "var(--green)"
              : trade.isHalfRisk
              ? "var(--orange)"
              : "var(--red)"
          }
        />
        <TelemetryValue
          label="Runner TP"
          value={formatPrice(target)}
          color="var(--green)"
        />
        <TelemetryValue
          label="Ideal R (IR)"
          value={formatR(tel.idealR)}
          color="var(--accent)"
        />
        <TelemetryValue
          label="Actual R (AR)"
          value={formatR(tel.actualR)}
          color={(tel.actualR ?? 0) >= 0 ? "var(--green)" : "var(--red)"}
        />
      </div>

      {/* 4. 50% Milestone Progress Bar */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: "var(--muted)",
            marginBottom: 4,
          }}
        >
          <span>Milestone 50% Progress</span>
          <span style={{ fontFamily: "monospace" }}>
            {isMilestoneBooked ? (
              <span style={{ color: "var(--green)", fontWeight: 700 }}>
                ✓ 40% Booked · SL @ BE
              </span>
            ) : (
              <span>
                Live {Math.round(currentProgress)}% (Peak {Math.round(maxExcursion)}%)
              </span>
            )}
          </span>
        </div>
        <div
          style={{
            width: "100%",
            height: 7,
            borderRadius: 4,
            background: "rgba(255, 255, 255, 0.08)",
            position: "relative",
            overflow: "visible",
          }}
        >
          {maxExcursion > 0 && (
            <div
              title={`Peak Reached: ${Math.round(maxExcursion)}%`}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: `${Math.min(100, Math.max(0, maxExcursion))}%`,
                height: "100%",
                background: "rgba(34, 197, 94, 0.28)",
                borderRadius: 4,
                transition: "width 0.3s ease",
                zIndex: 1,
              }}
            />
          )}

          {maxExcursion > 0 && (
            <div
              title={`Highest Reach Point: ${Math.round(maxExcursion)}%`}
              style={{
                position: "absolute",
                left: `calc(${Math.min(100, Math.max(0, maxExcursion))}% - 1px)`,
                top: -2,
                width: 2,
                height: 11,
                background: "#34d399",
                borderRadius: 1,
                zIndex: 2,
                boxShadow: "0 0 5px rgba(52, 211, 153, 0.9)",
              }}
            />
          )}

          <div
            title="50% Target Milestone: books 40% lot & moves SL to BE"
            style={{
              position: "absolute",
              left: "calc(50% - 1px)",
              top: -2,
              width: 2,
              height: 11,
              background: isMilestoneBooked
                ? "var(--green)"
                : "rgba(255, 255, 255, 0.4)",
              borderRadius: 1,
              zIndex: 3,
            }}
          />

          <div
            title={`Current Progress: ${Math.round(currentProgress)}%`}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: `${Math.min(100, Math.max(0, currentProgress))}%`,
              height: "100%",
              background: "var(--green)",
              borderRadius: 4,
              transition: "width 0.3s ease",
              zIndex: 4,
            }}
          />
        </div>
      </div>

      {/* 5. Spread Friction Telemetry */}
      {trade.coveredRR && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 10,
            background: "var(--panel-2)",
            padding: "4px 8px",
            borderRadius: 4,
            fontFamily: "monospace",
          }}
        >
          <span style={{ color: "var(--muted)" }}>Friction Mitigation:</span>
          <span>
            <strong style={{ color: "var(--accent)" }}>{trade.coveredRR}R net</strong>
            <span style={{ color: "var(--muted)" }}>
              {" "}
              (nominal {trade.idleRR ?? trade.targetRR}R · drag -
              {trade.frictionDragR ?? "0.00"}R)
            </span>
          </span>
        </div>
      )}

      {/* 6. 50% Milestone Redecision Banner */}
      {trade.redecisionDone && (
        <div
          style={{
            background:
              trade.redecisionAction === "CLOSE_FULL_NOW"
                ? "rgba(239, 68, 68, 0.08)"
                : trade.redecisionAction === "REDUCE_TP"
                ? "rgba(56, 189, 248, 0.08)"
                : trade.redecisionAction === "EXPAND_TP"
                ? "rgba(168, 85, 247, 0.08)"
                : "rgba(34, 197, 94, 0.08)",
            border: `1px solid ${
              trade.redecisionAction === "CLOSE_FULL_NOW"
                ? "rgba(239, 68, 68, 0.3)"
                : trade.redecisionAction === "REDUCE_TP"
                ? "rgba(56, 189, 248, 0.3)"
                : trade.redecisionAction === "EXPAND_TP"
                ? "rgba(168, 85, 247, 0.3)"
                : "rgba(34, 197, 94, 0.3)"
            }`,
            borderRadius: 6,
            padding: "6px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            fontSize: 10,
            fontFamily: "monospace",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span
              style={{
                fontWeight: 800,
                color:
                  trade.redecisionAction === "CLOSE_FULL_NOW"
                    ? "var(--red)"
                    : trade.redecisionAction === "REDUCE_TP"
                    ? "var(--accent)"
                    : trade.redecisionAction === "EXPAND_TP"
                    ? "var(--purple, #c084fc)"
                    : "var(--green)",
                fontSize: 9,
                letterSpacing: 0.3,
              }}
            >
              {trade.redecisionAction === "CLOSE_FULL_NOW"
                ? "⚡ 50% REDECISION: CLOSE FULL RUNNER"
                : trade.redecisionAction === "REDUCE_TP"
                ? `🎯 50% REDECISION: TP REDUCED TO ${trade.redecisionNewRR || trade.targetRR}R`
                : trade.redecisionAction === "EXPAND_TP"
                ? `🚀 50% REDECISION: TP EXPANDED TO ${trade.redecisionNewRR || trade.targetRR}R`
                : `💎 50% REDECISION: CONVICTION HOLD (${trade.targetRR}R)`}
            </span>
            <span style={{ color: "var(--muted)", fontSize: 9 }}>
              Score: {trade.redecisionScore > 0 ? `+${trade.redecisionScore}` : trade.redecisionScore}/100
            </span>
          </div>
          {trade.redecisionReason && (
            <div style={{ color: "var(--fg)", fontSize: 9, lineHeight: 1.3, opacity: 0.85 }}>
              {trade.redecisionReason}
            </div>
          )}
          {trade.redecisionAction === "REDUCE_TP" && trade.redecisionOldTp && (
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)", fontSize: 9 }}>
              <span>Old TP: {formatPrice(trade.redecisionOldTp)} ({trade.redecisionOldRR}R)</span>
              <span style={{ color: "var(--accent)", fontWeight: 700 }}>
                New TP: {formatPrice(trade.redecisionNewTp || trade.tpPrice)} ({trade.redecisionNewRR || trade.targetRR}R)
              </span>
            </div>
          )}
        </div>
      )}

      {/* 7. Broker Telemetry & Status */}
      <BrokerTelemetry trade={trade} />
    </article>
  );
}

// ============================================================================
// STANDALONE TRADEPROP CARD (Prop-Firm Safe 1.5R–2.5R Bracket)
// ============================================================================
function StandalonePropTradeCard({
  trade,
  sibling,
  ticks,
  onCloseTrade,
  isClosing,
}) {
  const tel = tradeRiskTelemetry(trade, ticks);
  const dir =
    trade.dir ??
    (String(trade.direction || trade.dirLabel || "").toLowerCase() === "sell"
      ? -1
      : 1);
  const fill = tel.fill ?? trade.entryPrice;
  const mark = tel.mark;
  const target = trade.tpPrice;
  const targetDistance =
    typeof target === "number" && typeof fill === "number"
      ? Math.abs(target - fill)
      : null;
  const currentR = tel.priceR ?? 0;
  const targetRR = trade.targetRR ?? 2.0;

  // Current Progress %
  let currentProgress = 0;
  if (targetDistance > 0 && mark !== null && fill !== null) {
    currentProgress = Math.min(
      100,
      Math.max(0, ((dir * (mark - fill)) / targetDistance) * 100)
    );
  } else if (targetRR > 0 && tel.priceR !== null) {
    currentProgress = Math.min(100, Math.max(0, (tel.priceR / targetRR) * 100));
  }

  // Peak Excursion %
  const peakPrice = tel.peakPrice ?? trade.peakPrice;
  const peakR = tel.peakR ?? trade.peakR ?? currentR;
  let maxExcursion = currentProgress;
  if (
    targetDistance > 0 &&
    peakPrice !== null &&
    fill !== null &&
    Number.isFinite(peakPrice)
  ) {
    const pFromPrice = Math.min(
      100,
      Math.max(0, ((dir * (peakPrice - fill)) / targetDistance) * 100)
    );
    maxExcursion = Math.max(maxExcursion, pFromPrice);
  }
  if (targetRR > 0 && peakR !== null && Number.isFinite(peakR)) {
    const pFromR = Math.min(100, Math.max(0, (peakR / targetRR) * 100));
    maxExcursion = Math.max(maxExcursion, pFromR);
  }
  maxExcursion = Math.max(currentProgress, maxExcursion);

  const is1RReached = trade.isHalfRisk || trade.isBreakeven || peakR >= 1.0;
  const is1_5RReached = trade.isBreakeven || peakR >= 1.5;

  // Horizon tag
  const isSwing =
    trade.scenario?.id === "swing" ||
    trade.scenario?.horizon === "1D-1H" ||
    trade.horizonCode === 1;
  const isDay =
    trade.scenario?.id === "day" ||
    trade.scenario?.horizon === "4H-15M" ||
    trade.horizonCode === 2;
  const horizonLabel = isSwing
    ? "1D-1H Swing"
    : isDay
    ? "4H-15M Day"
    : "30M-5M Scalp";

  return (
    <article
      style={{
        background: "rgba(168, 85, 247, 0.025)",
        border: "1px solid rgba(168, 85, 247, 0.35)",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minWidth: 0,
        boxShadow: "0 4px 18px rgba(0, 0, 0, 0.2)",
      }}
    >
      {/* 1. Header: Symbol, Side, Prominent Strategy Badge, Tickets & Telemetry */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          paddingBottom: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em" }}>
            {trade.symbol}
          </span>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 800,
              background:
                dir === 1 ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)",
              color: dir === 1 ? "var(--green)" : "var(--red)",
            }}
          >
            {trade.dirLabel || (dir === 1 ? "BUY" : "SELL")}
          </span>

          {/* Primary Strategy Identifier Badge */}
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              padding: "2px 8px",
              borderRadius: 4,
              background: "rgba(168, 85, 247, 0.18)",
              color: "var(--purple, #c084fc)",
              border: "1px solid rgba(168, 85, 247, 0.45)",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Shield size={11} /> TRADEPROP · PROP-FIRM SAFE (1.5R–2.5R)
          </span>

          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              background: isSwing
                ? "rgba(168, 85, 247, 0.15)"
                : isDay
                ? "rgba(56, 189, 248, 0.15)"
                : "rgba(234, 179, 8, 0.15)",
              color: isSwing
                ? "var(--purple, #c084fc)"
                : isDay
                ? "var(--accent)"
                : "var(--orange)",
            }}
          >
            {horizonLabel}
          </span>
          <ModelBadge item={trade} size="sm" />
          <span
            style={{
              fontSize: 10,
              color: "var(--muted)",
              fontFamily: "monospace",
              background: "var(--panel-2)",
              padding: "1px 5px",
              borderRadius: 3,
              border: "1px solid var(--border)",
            }}
          >
            {trade.tf || "15M"}
          </span>
          <span
            style={{
              fontSize: 10,
              fontFamily: "monospace",
              color: "var(--muted)",
              background: "rgba(255, 255, 255, 0.05)",
              padding: "1px 6px",
              borderRadius: 3,
            }}
          >
            MT5 #{trade.ticket || trade.orderTicket || "--"} ·{" "}
            {finiteNumber(trade.remainingVolume) ?? trade.lotSize ?? trade.lot ?? "--"}L
          </span>

          {/* Sibling Link Notification (Independent reference, not combined) */}
          {sibling && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: 4,
                background: "rgba(56, 189, 248, 0.12)",
                color: "var(--accent)",
                border: "1px solid rgba(56, 189, 248, 0.3)",
              }}
            >
              🔗 Sibling: TradeDefault #{sibling.ticket || sibling.orderTicket || "Open"}
            </span>
          )}
        </div>

        {/* Right side: Live Telemetry & Dedicated Close Button */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 800,
                color: (tel.actualR ?? 0) >= 0 ? "var(--green)" : "var(--red)",
              }}
            >
              Actual R {formatAR(tel.actualR)}
              <span
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                  fontWeight: 600,
                  marginLeft: 6,
                }}
              >
                ({formatIR(tel.idealR)})
              </span>
            </div>
            <div style={{ color: (tel.floatingUsd ?? 0) >= 0 ? "var(--green)" : "var(--red)", fontSize: 11 }}>
              {formatUsd(tel.totalUsd ?? tel.floatingUsd)}
            </div>
          </div>

          <button
            disabled={isClosing}
            onClick={() => onCloseTrade(trade._id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "6px 12px",
              borderRadius: 6,
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              color: "var(--red)",
              fontSize: 11,
              fontWeight: 700,
              cursor: isClosing ? "wait" : "pointer",
              opacity: isClosing ? 0.5 : 1,
            }}
            title="Close this TradeProp position on broker"
          >
            <X size={13} />
            {isClosing ? "Closing..." : "Close TradeProp"}
          </button>
        </div>
      </div>

      {/* 2. Strategy Logic Descriptor */}
      <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>
        <strong>Execution Model:</strong> 1.0R halves risk (SL to -0.5R) · 1.5R moves SL to Breakeven · Target {targetRR}R (1.5R–2.5R tight safe bracket full exit)
      </div>

      {/* 3. Landmark Callout */}
      {(trade.targetLandmark || trade.propTarget?.source || trade.targets?.[0]?.source) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 10,
            color: "var(--purple, #c084fc)",
            background: "rgba(168, 85, 247, 0.08)",
            padding: "4px 8px",
            borderRadius: 4,
            border: "1px solid rgba(168, 85, 247, 0.2)",
          }}
        >
          <Target size={12} />
          <span>
            <strong>Landmark:</strong>{" "}
            {trade.targetLandmark || trade.propTarget?.source || trade.targets?.[0]?.source}
          </span>
        </div>
      )}

      {/* 4. Key Telemetry Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 80px), 1fr))",
          gap: 6,
          background: "var(--panel-2)",
          padding: 8,
          borderRadius: 6,
        }}
      >
        <TelemetryValue label="Fill" value={formatPrice(fill)} />
        <TelemetryValue label="Mark" value={formatPrice(mark)} color="var(--accent)" />
        <TelemetryValue
          label={
            trade.isBreakeven
              ? "SL (BE)"
              : trade.isTrailing
              ? "SL (Trail)"
              : trade.isHalfRisk || trade.slHalfMoved
              ? "SL (-0.5R)"
              : "SL"
          }
          value={formatPrice(trade.confirmedSlPrice ?? trade.slPrice)}
          color={
            is1_5RReached || trade.isBreakeven
              ? "var(--green)"
              : is1RReached || trade.isHalfRisk
              ? "var(--orange)"
              : "var(--red)"
          }
        />
        <TelemetryValue
          label="Target TP"
          value={`${formatPrice(target)} (${targetRR}R)`}
          color="var(--green)"
        />
        <TelemetryValue
          label="Ideal R (IR)"
          value={formatR(tel.idealR)}
          color="var(--accent)"
        />
        <TelemetryValue
          label="Actual R (AR)"
          value={formatR(tel.actualR)}
          color={(tel.actualR ?? 0) >= 0 ? "var(--green)" : "var(--red)"}
        />
      </div>

      {/* 5. 3-Stage Milestone Stepper */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 6,
          background: "var(--panel-2)",
          padding: "6px 8px",
          borderRadius: 6,
          fontSize: 9,
          textAlign: "center",
        }}
      >
        <div
          style={{
            padding: "4px 2px",
            borderRadius: 4,
            background: is1RReached ? "rgba(34, 197, 94, 0.15)" : "rgba(255, 255, 255, 0.03)",
            color: is1RReached ? "var(--green)" : "var(--muted)",
            fontWeight: is1RReached ? 700 : 500,
            border: is1RReached ? "1px solid rgba(34, 197, 94, 0.3)" : "1px solid transparent",
          }}
        >
          {is1RReached ? "✓ 1.0R (Risk -50%)" : "1.0R (Halve SL)"}
        </div>
        <div
          style={{
            padding: "4px 2px",
            borderRadius: 4,
            background: is1_5RReached ? "rgba(34, 197, 94, 0.15)" : "rgba(255, 255, 255, 0.03)",
            color: is1_5RReached ? "var(--green)" : "var(--muted)",
            fontWeight: is1_5RReached ? 700 : 500,
            border: is1_5RReached ? "1px solid rgba(34, 197, 94, 0.3)" : "1px solid transparent",
          }}
        >
          {is1_5RReached ? "✓ 1.5R (SL to BE)" : "1.5R (Move BE)"}
        </div>
        <div
          style={{
            padding: "4px 2px",
            borderRadius: 4,
            background: currentProgress >= 100 ? "rgba(34, 197, 94, 0.2)" : "rgba(255, 255, 255, 0.03)",
            color: currentProgress >= 100 ? "var(--green)" : "var(--muted)",
            fontWeight: currentProgress >= 100 ? 700 : 500,
            border: currentProgress >= 100 ? "1px solid rgba(34, 197, 94, 0.4)" : "1px solid transparent",
          }}
        >
          {currentProgress >= 100 ? "✓ Full TP Hit" : `${targetRR}R Safe TP`}
        </div>
      </div>

      {/* 6. Three-Layered Progress Bar to TP */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: "var(--muted)",
            marginBottom: 4,
          }}
        >
          <span>Distance to Safe TP</span>
          <span style={{ fontFamily: "monospace" }}>
            Live: {Math.round(currentProgress)}% · Peak: {Math.round(maxExcursion)}% (Current {formatR(currentR)})
          </span>
        </div>
        <div
          style={{
            width: "100%",
            height: 7,
            borderRadius: 4,
            background: "rgba(255, 255, 255, 0.08)",
            position: "relative",
            overflow: "visible",
          }}
        >
          {maxExcursion > 0 && (
            <div
              title={`Peak Reached: ${Math.round(maxExcursion)}%`}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: `${Math.min(100, Math.max(0, maxExcursion))}%`,
                height: "100%",
                background: "rgba(168, 85, 247, 0.28)",
                borderRadius: 4,
                transition: "width 0.3s ease",
                zIndex: 1,
              }}
            />
          )}

          {maxExcursion > 0 && (
            <div
              title={`Highest Reach Point: ${Math.round(maxExcursion)}%`}
              style={{
                position: "absolute",
                left: `calc(${Math.min(100, Math.max(0, maxExcursion))}% - 1px)`,
                top: -2,
                width: 2,
                height: 11,
                background: "#c084fc",
                borderRadius: 1,
                zIndex: 2,
                boxShadow: "0 0 5px rgba(192, 132, 252, 0.9)",
              }}
            />
          )}

          <div
            title={`Current Progress: ${Math.round(currentProgress)}%`}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: `${Math.min(100, Math.max(0, currentProgress))}%`,
              height: "100%",
              background: "var(--purple, #c084fc)",
              borderRadius: 4,
              transition: "width 0.3s ease",
              zIndex: 3,
            }}
          />
        </div>
      </div>

      {/* 7. Spread Friction Telemetry */}
      {trade.coveredRR && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 10,
            background: "var(--panel-2)",
            padding: "4px 8px",
            borderRadius: 4,
            fontFamily: "monospace",
          }}
        >
          <span style={{ color: "var(--muted)" }}>Friction Mitigation:</span>
          <span>
            <strong style={{ color: "var(--purple, #c084fc)" }}>{trade.coveredRR}R net</strong>
            <span style={{ color: "var(--muted)" }}>
              {" "}
              (nominal {trade.idleRR ?? trade.targetRR}R · drag -
              {trade.frictionDragR ?? "0.00"}R)
            </span>
          </span>
        </div>
      )}

      {/* 8. Broker Telemetry & Status */}
      <BrokerTelemetry trade={trade} />
    </article>
  );
}
