"use client";

import { useMemo } from "react";
import { Activity, X, Shield, Target, Zap, CheckCircle2, ArrowRight } from "lucide-react";
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

export default function ActivePositions({
  activeTrades = [],
  onCloseTrade,
  ticks = {},
  pendingAction,
}) {
  // Cluster active trades into unified setup cards by groupId or setup fingerprint
  const groupedSetups = useMemo(() => {
    const map = new Map();
    for (const trade of activeTrades) {
      const key =
        trade.groupId ||
        `${trade.symbol}_${trade.dir}_${(trade.entryPrice ?? 0).toFixed(4)}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          groupId: trade.groupId || null,
          symbol: trade.symbol || "Unknown",
          dir: trade.dir,
          dirLabel: trade.dirLabel || (trade.dir === 1 ? "BUY" : trade.dir === -1 ? "SELL" : "NEUTRAL"),
          tf: trade.tf || trade.scenario?.tf || "15M",
          scenario: trade.scenario || {},
          modelId: trade.modelId || trade.entryModel?.id || "ICT 2022",
          entryPrice: trade.entryPrice,
          initialSlPrice: trade.initialSlPrice ?? trade.slPrice,
          initialRiskDistance: trade.initialRiskDistance,
          createdAt: trade.createdAt,
          trades: [],
        });
      }
      map.get(key).trades.push(trade);
    }
    return Array.from(map.values());
  }, [activeTrades]);

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
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Activity size={16} style={{ color: "var(--green)" }} />
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
            Active Positions & Live Management
          </h2>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(34, 197, 94, 0.15)",
              color: "var(--green)",
            }}
          >
            {groupedSetups.length} Setup{groupedSetups.length === 1 ? "" : "s"} ({activeTrades.length} Legs)
          </span>
        </div>
        <span style={{ color: "var(--muted)", fontSize: 10 }}>
          Dual Execution (Default + Prop-Firm) · Broker state remains authoritative
        </span>
      </div>

      {groupedSetups.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: 28,
            color: "var(--muted)",
            fontSize: 13,
            border: "1px dashed var(--border)",
            borderRadius: 8,
          }}
        >
          No open positions. Armed setups will enter only when the execution engine confirms a fill.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {groupedSetups.map((setup) => {
            // Aggregate telemetry across all legs in this setup
            let combinedLiveR = 0;
            let combinedTotalR = 0;
            let combinedUsd = 0;
            let hasValidR = false;
            let anyClosePending = false;

            const legsWithTel = setup.trades.map((trade) => {
              const tel = tradeRiskTelemetry(trade, ticks);
              if (tel.priceR !== null) {
                combinedLiveR += tel.priceR;
                hasValidR = true;
              }
              if (tel.totalR !== null) {
                combinedTotalR += tel.totalR;
              }
              if (tel.floatingUsd !== null) {
                combinedUsd += tel.floatingUsd;
              }
              const isClosing =
                !!pendingAction ||
                trade.status === "closing" ||
                (!!trade.operation && trade.operation.state !== "failed");
              if (isClosing) anyClosePending = true;
              return { trade, tel, isClosing };
            });

            const defaultLeg = legsWithTel.find(
              (l) => l.trade.managementLogic === "milestone_50" || l.trade.legId === "default"
            );
            const propLeg = legsWithTel.find(
              (l) => l.trade.managementLogic === "prop_firm_safe" || l.trade.legId === "prop_firm"
            );
            const remainingLegs = legsWithTel.filter(
              (l) => l !== defaultLeg && l !== propLeg
            );

            // Horizon tag
            const isSwing =
              setup.scenario?.id === "swing" ||
              setup.scenario?.horizon === "1D-1H" ||
              setup.trades[0]?.horizonCode === 1;
            const isDay =
              setup.scenario?.id === "day" ||
              setup.scenario?.horizon === "4H-15M" ||
              setup.trades[0]?.horizonCode === 2;
            const horizonLabel = isSwing
              ? "1D-1H Swing"
              : isDay
              ? "4H-15M Day"
              : "30M-5M Scalp";

            return (
              <article
                key={setup.key}
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  minWidth: 0,
                  boxShadow: "0 4px 18px rgba(0, 0, 0, 0.2)",
                }}
              >
                {/* 1. SETUP MASTER HEADER */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                    borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
                    paddingBottom: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em" }}>
                      {setup.symbol}
                    </span>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 800,
                        background:
                          setup.dir === 1 ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)",
                        color: setup.dir === 1 ? "var(--green)" : "var(--red)",
                      }}
                    >
                      {setup.dirLabel}
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
                    <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
                      {setup.modelId} · {setup.tf}
                    </span>
                    {setup.trades.length > 1 && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: "rgba(34, 197, 94, 0.12)",
                          color: "var(--green)",
                          border: "1px solid rgba(34, 197, 94, 0.3)",
                        }}
                      >
                        ⚡ DUAL EXECUTION LINKED
                      </span>
                    )}
                  </div>

                  {/* Combined Live Telemetry + Setup Close Action */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 800,
                          color: !hasValidR
                            ? "var(--muted)"
                            : combinedTotalR >= 0
                            ? "var(--green)"
                            : "var(--red)",
                        }}
                      >
                        Setup AR {hasValidR ? formatR(combinedTotalR) : "--"}
                        {hasValidR && Math.abs(combinedLiveR - combinedTotalR) >= 0.05 && (
                          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginLeft: 6 }}>
                            ({formatIR(combinedLiveR)})
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          color: "var(--muted)",
                          fontSize: 11,
                          display: "flex",
                          gap: 6,
                          justifyContent: "flex-end",
                        }}
                      >
                        <span style={{ color: combinedUsd >= 0 ? "var(--green)" : "var(--red)" }}>
                          {formatUsd(combinedUsd)}
                        </span>
                      </div>
                    </div>

                    {/* Master setup close button */}
                    {setup.trades.length > 1 && (
                      <button
                        disabled={anyClosePending}
                        onClick={() => onCloseTrade(setup.trades[0]._id, { closeSiblings: true })}
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
                          cursor: anyClosePending ? "wait" : "pointer",
                          opacity: anyClosePending ? 0.5 : 1,
                        }}
                        title="Close both linked orders simultaneously"
                      >
                        <X size={13} />
                        {anyClosePending ? "Closing..." : "Close Setup (Both Legs)"}
                      </button>
                    )}
                  </div>
                </div>

                {/* 2. DUAL LEGS SUB-PANELS (SIDE-BY-SIDE ON DESKTOP, STACKED ON MOBILE) */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
                    gap: 12,
                  }}
                >
                  {/* LEG A: DEFAULT MODE (Milestone 50 + Runner) */}
                  {defaultLeg && (
                    <DefaultLegCard
                      item={defaultLeg}
                      setup={setup}
                      ticks={ticks}
                      onCloseTrade={onCloseTrade}
                    />
                  )}

                  {/* LEG B: PROP-FIRM SAFE MODE (1.5R - 2.5R Bracket) */}
                  {propLeg && (
                    <PropFirmLegCard
                      item={propLeg}
                      setup={setup}
                      ticks={ticks}
                      onCloseTrade={onCloseTrade}
                    />
                  )}

                  {/* Fallback for additional or standalone legs */}
                  {remainingLegs.map((item) => (
                    <DefaultLegCard
                      key={item.trade._id || item.trade.id}
                      item={item}
                      setup={setup}
                      ticks={ticks}
                      onCloseTrade={onCloseTrade}
                    />
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Sub-component: Default Leg Panel (Milestone 50 + Runner)
function DefaultLegCard({ item, setup, ticks, onCloseTrade }) {
  const { trade, tel, isClosing } = item;
  const dir = trade.dir ?? (String(trade.direction || trade.dirLabel || "").toLowerCase() === "sell" ? -1 : 1);
  const targets = Array.isArray(trade.targets) ? trade.targets : [];
  const fill = tel.fill ?? trade.entryPrice;
  const mark = tel.mark;
  const target = targets.find((t) => t.id === "runner")?.price ?? trade.tpPrice ?? trade.targetPrice;
  const targetDistance =
    typeof target === "number" && typeof fill === "number" ? Math.abs(target - fill) : null;
  const targetRR = finiteNumber(trade.targetRR) || (targetDistance && tel.initialRisk ? targetDistance / tel.initialRisk : 2.0);

  // 1. Current Progress % (clamped 0 to 100)
  let currentProgress = 0;
  if (targetDistance > 0 && mark !== null && fill !== null) {
    currentProgress = Math.min(100, Math.max(0, ((dir * (mark - fill)) / targetDistance) * 100));
  } else if (targetRR > 0 && tel.priceR !== null) {
    currentProgress = Math.min(100, Math.max(0, (tel.priceR / targetRR) * 100));
  }

  // 2. Highest Reach Point / Max Excursion % (clamped 0 to 100, always >= currentProgress)
  const peakPrice = tel.peakPrice ?? trade.peakPrice;
  const peakR = tel.peakR ?? trade.peakR;
  let maxExcursion = currentProgress;
  if (targetDistance > 0 && peakPrice !== null && fill !== null && Number.isFinite(peakPrice)) {
    const pFromPrice = Math.min(100, Math.max(0, ((dir * (peakPrice - fill)) / targetDistance) * 100));
    maxExcursion = Math.max(maxExcursion, pFromPrice);
  }
  if (targetRR > 0 && peakR !== null && Number.isFinite(peakR)) {
    const pFromR = Math.min(100, Math.max(0, (peakR / targetRR) * 100));
    maxExcursion = Math.max(maxExcursion, pFromR);
  }
  maxExcursion = Math.max(currentProgress, maxExcursion);

  const isMilestoneBooked = trade.halfTargetBooked || trade.isBreakeven;

  return (
    <div
      style={{
        background: "rgba(56, 189, 248, 0.03)",
        border: "1px solid rgba(56, 189, 248, 0.2)",
        borderRadius: 8,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      {/* Leg Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              background: "rgba(56, 189, 248, 0.15)",
              color: "var(--accent)",
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            DEFAULT LEG (MG1)
          </span>
          {trade.magicNumber && (
            <span
              style={{
                fontSize: 9,
                fontFamily: "monospace",
                color: "var(--accent)",
                background: "rgba(255, 255, 255, 0.05)",
                padding: "1px 5px",
                borderRadius: 3,
              }}
            >
              #{trade.magicNumber}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 800, color: (tel.actualR ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>
            {formatAR(tel.actualR)}
          </span>
          <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--muted)", fontWeight: 600 }}>
            ({formatIR(tel.idealR)})
          </span>
          <span style={{ color: "var(--muted)", fontSize: 10 }}>·</span>
          <span style={{ fontSize: 11, fontFamily: "monospace", color: (tel.floatingUsd ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>
            {formatUsd(tel.totalUsd ?? tel.floatingUsd)}
          </span>
        </div>
      </div>

      <div style={{ fontSize: 10, color: "var(--muted)", lineHeight: 1.4 }}>
        <strong>Model:</strong> 50% TP distance books 40% & locks BE · 60% runner targets full TP
      </div>

      {/* Telemetry Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 75px), 1fr))",
          gap: 6,
          background: "rgba(0, 0, 0, 0.25)",
          padding: 8,
          borderRadius: 6,
        }}
      >
        <TelemetryValue label="Fill" value={formatPrice(fill)} />
        <TelemetryValue label="Mark" value={formatPrice(mark)} color="var(--accent)" />
        <TelemetryValue label="SL" value={formatPrice(trade.confirmedSlPrice ?? trade.slPrice)} color={isMilestoneBooked ? "var(--green)" : "var(--red)"} />
        <TelemetryValue label="Runner TP" value={formatPrice(target)} color="var(--green)" />
        <TelemetryValue label="Ideal R (IR)" value={formatR(tel.idealR)} color="var(--accent)" />
        <TelemetryValue label="Actual R (AR)" value={formatR(tel.actualR)} color={(tel.actualR ?? 0) >= 0 ? "var(--green)" : "var(--red)"} />
      </div>

      {/* Milestone 50 Progress Bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>
          <span>Milestone 50% Progress</span>
          <span style={{ fontFamily: "monospace" }}>
            {isMilestoneBooked ? (
              <span style={{ color: "var(--green)", fontWeight: 700 }}>✓ 40% Booked · SL @ BE</span>
            ) : (
              <span>Live {Math.round(currentProgress)}% (Peak {Math.round(maxExcursion)}%)</span>
            )}
          </span>
        </div>
        <div
          style={{
            width: "100%",
            height: 7,
            borderRadius: 4,
            background: "rgba(255, 255, 255, 0.08)", // Layer 1: Progress below line
            position: "relative",
            overflow: "visible",
          }}
        >
          {/* Layer 2: Max Reached Range (Darker background color showing peak excursion) */}
          {maxExcursion > 0 && (
            <div
              title={`Peak Reached: ${Math.round(maxExcursion)}%`}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: `${Math.min(100, Math.max(0, maxExcursion))}%`,
                height: "100%",
                background: "rgba(34, 197, 94, 0.28)", // Darker green background
                borderRadius: 4,
                transition: "width 0.3s ease",
                zIndex: 1,
              }}
            />
          )}

          {/* Layer 2 Peak Boundary Notch */}
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

          {/* 50% milestone target line */}
          <div
            title="50% Target Milestone: books 40% lot & moves SL to BE"
            style={{
              position: "absolute",
              left: "calc(50% - 1px)",
              top: -2,
              width: 2,
              height: 11,
              background: isMilestoneBooked ? "var(--green)" : "rgba(255, 255, 255, 0.4)",
              borderRadius: 1,
              zIndex: 3,
            }}
          />

          {/* Layer 3: Current Progress Bar (Bright active fill) */}
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

      {/* Volume & Targets status */}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", flexWrap: "wrap" }}>
        <span>Volume: {finiteNumber(trade.remainingVolume) ?? trade.lotSize ?? "--"} lots ({finiteNumber(trade.remainingFraction) !== null ? `${(trade.remainingFraction * 100).toFixed(0)}%` : "100%"})</span>
        <span>Initial Risk: {formatPrice(trade.initialRiskDistance)}</span>
      </div>

      {/* Spread Friction Mitigation Telemetry */}
      {trade.coveredRR && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, background: "rgba(0, 0, 0, 0.2)", padding: "4px 8px", borderRadius: 4, fontFamily: "monospace" }}>
          <span style={{ color: "var(--muted)" }}>Friction Mitigation:</span>
          <span>
            <strong style={{ color: "var(--accent)" }}>{trade.coveredRR}R net</strong>
            <span style={{ color: "var(--muted)" }}> (nominal {trade.idleRR ?? trade.targetRR}R · drag -{trade.frictionDragR ?? "0.00"}R)</span>
          </span>
        </div>
      )}

      {/* 50% Milestone Redecision Telemetry Banner */}
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
              <span style={{ color: "var(--accent)", fontWeight: 700 }}>New TP: {formatPrice(trade.redecisionNewTp || trade.tpPrice)} ({trade.redecisionNewRR || trade.targetRR}R)</span>
            </div>
          )}
        </div>
      )}

      <BrokerTelemetry trade={trade} />

      <button
        disabled={isClosing}
        onClick={() => onCloseTrade(trade._id)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          padding: "5px 10px",
          borderRadius: 5,
          background: "rgba(239, 68, 68, 0.1)",
          border: "1px solid rgba(239, 68, 68, 0.25)",
          color: "var(--red)",
          fontSize: 10,
          fontWeight: 700,
          cursor: isClosing ? "wait" : "pointer",
          opacity: isClosing ? 0.5 : 1,
        }}
      >
        <X size={12} /> {isClosing ? "Closing..." : `Close Default Leg (${formatR(tel.priceR)})`}
      </button>
    </div>
  );
}

// Sub-component: Prop-Firm Safe Leg Panel (1.5R - 2.5R Bracket)
function PropFirmLegCard({ item, setup, ticks, onCloseTrade }) {
  const { trade, tel, isClosing } = item;
  const dir = trade.dir ?? (String(trade.direction || trade.dirLabel || "").toLowerCase() === "sell" ? -1 : 1);
  const fill = tel.fill ?? trade.entryPrice;
  const mark = tel.mark;
  const target = trade.tpPrice;
  const targetDistance =
    typeof target === "number" && typeof fill === "number" ? Math.abs(target - fill) : null;
  const currentR = tel.priceR ?? 0;
  const targetRR = trade.targetRR ?? 2.0;

  // 1. Current Progress % (clamped 0 to 100)
  let currentProgress = 0;
  if (targetDistance > 0 && mark !== null && fill !== null) {
    currentProgress = Math.min(100, Math.max(0, ((dir * (mark - fill)) / targetDistance) * 100));
  } else if (targetRR > 0 && tel.priceR !== null) {
    currentProgress = Math.min(100, Math.max(0, (tel.priceR / targetRR) * 100));
  }

  // 2. Highest Reach Point / Max Excursion % (clamped 0 to 100, always >= currentProgress)
  const peakPrice = tel.peakPrice ?? trade.peakPrice;
  const peakR = tel.peakR ?? trade.peakR ?? currentR;
  let maxExcursion = currentProgress;
  if (targetDistance > 0 && peakPrice !== null && fill !== null && Number.isFinite(peakPrice)) {
    const pFromPrice = Math.min(100, Math.max(0, ((dir * (peakPrice - fill)) / targetDistance) * 100));
    maxExcursion = Math.max(maxExcursion, pFromPrice);
  }
  if (targetRR > 0 && peakR !== null && Number.isFinite(peakR)) {
    const pFromR = Math.min(100, Math.max(0, (peakR / targetRR) * 100));
    maxExcursion = Math.max(maxExcursion, pFromR);
  }
  maxExcursion = Math.max(currentProgress, maxExcursion);

  const is1RReached = trade.isHalfRisk || trade.isBreakeven || peakR >= 1.0;
  const is1_5RReached = trade.isBreakeven || peakR >= 1.5;

  return (
    <div
      style={{
        background: "rgba(168, 85, 247, 0.03)",
        border: "1px solid rgba(168, 85, 247, 0.25)",
        borderRadius: 8,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      {/* Leg Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              background: "rgba(168, 85, 247, 0.15)",
              color: "var(--purple, #c084fc)",
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            PROP-FIRM SAFE (MG2)
          </span>
          {trade.magicNumber && (
            <span
              style={{
                fontSize: 9,
                fontFamily: "monospace",
                color: "var(--purple, #c084fc)",
                background: "rgba(255, 255, 255, 0.05)",
                padding: "1px 5px",
                borderRadius: 3,
              }}
            >
              #{trade.magicNumber}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 800, color: (tel.actualR ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>
            {formatAR(tel.actualR)}
          </span>
          <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--muted)", fontWeight: 600 }}>
            ({formatIR(tel.idealR)})
          </span>
          <span style={{ color: "var(--muted)", fontSize: 10 }}>·</span>
          <span style={{ fontSize: 11, fontFamily: "monospace", color: (tel.floatingUsd ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>
            {formatUsd(tel.totalUsd ?? tel.floatingUsd)}
          </span>
        </div>
      </div>

      <div style={{ fontSize: 10, color: "var(--muted)", lineHeight: 1.4 }}>
        <strong>Model:</strong> 1.0R halves risk (-0.5R) · 1.5R moves SL to BE · Target {targetRR}R (1.5R–2.5R safe bracket)
      </div>

      {(trade.targetLandmark || trade.propTarget?.source || trade.targets?.[0]?.source) && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--accent)", background: "rgba(56, 189, 248, 0.08)", padding: "4px 8px", borderRadius: 4, border: "1px solid rgba(56, 189, 248, 0.2)" }}>
          <Target size={12} />
          <span>
            <strong>Landmark:</strong> {trade.targetLandmark || trade.propTarget?.source || trade.targets?.[0]?.source}
          </span>
        </div>
      )}

      {/* Telemetry Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 75px), 1fr))",
          gap: 6,
          background: "rgba(0, 0, 0, 0.25)",
          padding: 8,
          borderRadius: 6,
        }}
      >
        <TelemetryValue label="Fill" value={formatPrice(fill)} />
        <TelemetryValue label="Mark" value={formatPrice(mark)} color="var(--accent)" />
        <TelemetryValue label="SL" value={formatPrice(trade.confirmedSlPrice ?? trade.slPrice)} color={is1_5RReached ? "var(--green)" : is1RReached ? "var(--orange)" : "var(--red)"} />
        <TelemetryValue label="Target TP" value={`${formatPrice(target)} (${targetRR}R)`} color="var(--green)" />
        <TelemetryValue label="Ideal R (IR)" value={formatR(tel.idealR)} color="var(--accent)" />
        <TelemetryValue label="Actual R (AR)" value={formatR(tel.actualR)} color={(tel.actualR ?? 0) >= 0 ? "var(--green)" : "var(--red)"} />
      </div>

      {/* 3-Stage Milestone Stepper */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 6,
          background: "rgba(0, 0, 0, 0.2)",
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

      {/* Three-Layered Trade Progress Bar to TP */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>
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
            background: "rgba(255, 255, 255, 0.08)", // Layer 1: Progress below line
            position: "relative",
            overflow: "visible",
          }}
        >
          {/* Layer 2: Max Reached Range (Darker background color showing peak excursion) */}
          {maxExcursion > 0 && (
            <div
              title={`Peak Reached: ${Math.round(maxExcursion)}%`}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: `${Math.min(100, Math.max(0, maxExcursion))}%`,
                height: "100%",
                background: "rgba(168, 85, 247, 0.28)", // Darker purple background
                borderRadius: 4,
                transition: "width 0.3s ease",
                zIndex: 1,
              }}
            />
          )}

          {/* Layer 2 Peak Boundary Notch */}
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

          {/* Layer 3: Current Progress Bar (Bright active purple bar) */}
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

      {/* Volume & Initial Risk */}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", flexWrap: "wrap" }}>
        <span>Volume: {finiteNumber(trade.remainingVolume) ?? trade.lotSize ?? "--"} lots (100% full exit)</span>
        <span>Initial Risk: {formatPrice(trade.initialRiskDistance)}</span>
      </div>

      {/* Spread Friction Mitigation Telemetry */}
      {trade.coveredRR && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, background: "rgba(0, 0, 0, 0.2)", padding: "4px 8px", borderRadius: 4, fontFamily: "monospace" }}>
          <span style={{ color: "var(--muted)" }}>Friction Mitigation:</span>
          <span>
            <strong style={{ color: "var(--purple, #c084fc)" }}>{trade.coveredRR}R net</strong>
            <span style={{ color: "var(--muted)" }}> (nominal {trade.idleRR ?? trade.targetRR}R · drag -{trade.frictionDragR ?? "0.00"}R)</span>
          </span>
        </div>
      )}

      <BrokerTelemetry trade={trade} />

      <button
        disabled={isClosing}
        onClick={() => onCloseTrade(trade._id)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          padding: "5px 10px",
          borderRadius: 5,
          background: "rgba(239, 68, 68, 0.1)",
          border: "1px solid rgba(239, 68, 68, 0.25)",
          color: "var(--red)",
          fontSize: 10,
          fontWeight: 700,
          cursor: isClosing ? "wait" : "pointer",
          opacity: isClosing ? 0.5 : 1,
        }}
      >
        <X size={12} /> {isClosing ? "Closing..." : `Close Prop Leg (${formatR(tel.priceR)})`}
      </button>
    </div>
  );
}
