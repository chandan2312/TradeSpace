"use client";

import { isValidElement } from "react";

// Display-only math: never infer fills, stop confirmations, or terminal state from ticks.
export function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatPrice(value) {
  const n = finiteNumber(value);
  return n === null ? "Unavailable" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

export function formatR(value) {
  const n = finiteNumber(value);
  return n === null ? "Unavailable" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

export function formatUsd(value) {
  const n = finiteNumber(value);
  return n === null ? "Unavailable" : n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function formatIR(value) {
  const n = finiteNumber(value);
  return n === null ? "IR: --" : `IR ${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

export function formatAR(value) {
  const n = finiteNumber(value);
  return n === null ? "AR: --" : `AR ${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

export function IRARBadge({ idealR, actualR, size = "md", style = {} }) {
  const ir = finiteNumber(idealR);
  const ar = finiteNumber(actualR);
  const isDiff = ir !== null && ar !== null && Math.abs(ir - ar) >= 0.05;
  const arColor = (ar ?? 0) >= 0 ? "var(--green)" : "var(--red)";

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "monospace", ...style }}>
      <span style={{ fontWeight: 800, fontSize: size === "lg" ? 15 : size === "sm" ? 11 : 13, color: arColor }}>
        AR {ar !== null ? `${ar >= 0 ? "+" : ""}${ar.toFixed(2)}R` : "--"}
      </span>
      {isDiff ? (
        <span style={{ fontSize: size === "lg" ? 12 : size === "sm" ? 9 : 10, color: "var(--muted)", fontWeight: 600 }}>
          (IR {ir !== null ? `${ir >= 0 ? "+" : ""}${ir.toFixed(2)}R` : "--"})
        </span>
      ) : (
        <span style={{ fontSize: size === "lg" ? 11 : size === "sm" ? 8 : 9, color: "var(--muted)", opacity: 0.6 }}>
          (IR = AR)
        </span>
      )}
    </div>
  );
}

export function markPriceFor(record, ticks = {}) {
  const symUpper = (record?.tradeableSymbol || record?.symbol || record?.canonicalSymbol || "").toUpperCase();
  const symClean = symUpper.replace(/\.I$/i, "");
  const tick = ticks[record?.tradeableSymbol] || ticks[record?.symbol] || ticks[record?.canonicalSymbol] || ticks[symUpper] || ticks[symClean];
  // Liquidation-side mark: bid for longs, ask for shorts.
  const isShort = record?.dir === -1 || String(record?.direction || record?.dirLabel || "").toLowerCase() === "sell";
  const quote = isShort ? tick?.ask : tick?.bid;
  const fresh = !tick?.receivedAt || Date.now() - tick.receivedAt < 30_000;
  return (fresh ? finiteNumber(quote) : null) ?? finiteNumber(record?.currentPrice);
}

export function tradeRiskTelemetry(trade, ticks = {}) {
  const mark = markPriceFor(trade, ticks);
  const fill = finiteNumber(trade.filledPrice) ?? finiteNumber(trade.entryPrice);
  const initialRisk = finiteNumber(trade.initialRiskDistance)
    ?? (fill !== null && finiteNumber(trade.initialSlPrice) !== null ? Math.abs(fill - trade.initialSlPrice) : null)
    ?? (fill !== null && finiteNumber(trade.levelDetails?.sl) !== null ? Math.abs(fill - trade.levelDetails.sl) : null)
    ?? (fill !== null && finiteNumber(trade.slPrice) !== null && !trade.isBreakeven ? Math.abs(fill - trade.slPrice) : null)
    ?? (fill !== null && finiteNumber(trade.tpPrice) !== null ? Math.abs(trade.tpPrice - fill) / 2 : null);
  const initialRiskUsd = finiteNumber(trade.initialRiskUsd) ?? finiteNumber(trade.riskUsd);
  const fraction = finiteNumber(trade.remainingFraction);
  const remaining = fraction !== null && fraction >= 0 && fraction <= 1 ? fraction : 1;
  const dir = trade.dir ?? (String(trade.direction || trade.dirLabel || "").toLowerCase() === "sell" ? -1 : 1);

  // 1. Ideal R (IR): 100% full lot size held from start to finish without partials
  const priceR = mark !== null && fill !== null && initialRisk > 0 && [1, -1].includes(dir)
    ? (mark - fill) * dir / initialRisk : finiteNumber(trade.idealR ?? trade.unrealizedR);
  const idealR = priceR;

  // 2. Partials and Realized R
  const partials = Array.isArray(trade.partialExits) ? trade.partialExits : [];
  const realizedR = finiteNumber(trade.realizedR) ?? (partials.length > 0 && partials.every((p) => finiteNumber(p.weightedR ?? p.realizedR) !== null)
    ? partials.reduce((sum, p) => sum + (p.weightedR ?? p.realizedR), 0) : null);
  const floatingR = priceR !== null && remaining !== null ? priceR * remaining : null;
  const floatingUsd = floatingR !== null && initialRiskUsd > 0 ? floatingR * initialRiskUsd : null;

  // 3. Actual R (AR): Realized R already booked + Floating R on remaining runner fraction
  const hasPartials = Boolean(
    (remaining !== null && remaining < 0.99) ||
    (partials.length > 0) ||
    (trade.halfTargetBooked && trade.isBreakeven) ||
    (realizedR !== null && Math.abs(realizedR) > 1e-4)
  );

  const isClosed = ["closed_tp", "closed_sl", "closed_be", "closed"].includes(trade.status) || Boolean(trade.closedAt);
  const actualR = isClosed
    ? (finiteNumber(trade.actualR) ?? finiteNumber(trade.realizedR) ?? realizedR ?? idealR)
    : (hasPartials
        ? ((floatingR ?? 0) + (realizedR ?? (trade.halfTargetBooked ? (idealR !== null ? 0.4 * Math.min(idealR, trade.targetRR ? trade.targetRR / 2 : 1.5) : 0) : 0)))
        : idealR);

  const totalR = actualR;
  const realizedPnl = finiteNumber(trade.realizedPnl) ?? (trade.halfTargetBooked && initialRiskUsd ? (realizedR || 0) * initialRiskUsd : 0);
  const totalUsd = (floatingUsd !== null ? floatingUsd : 0) + realizedPnl;

  const storedPeakPrice = finiteNumber(trade.peakPrice);
  const livePrice = finiteNumber(mark) ?? fill;
  let peakPrice = storedPeakPrice;
  if (dir === 1) {
    if (livePrice !== null) peakPrice = storedPeakPrice !== null ? Math.max(storedPeakPrice, livePrice) : livePrice;
  } else {
    if (livePrice !== null) peakPrice = storedPeakPrice !== null ? Math.min(storedPeakPrice, livePrice) : livePrice;
  }
  const liveCalculatedPeakR = (peakPrice !== null && fill !== null && initialRisk > 0)
    ? (peakPrice - fill) * dir / initialRisk
    : priceR;
  const storedPeakR = finiteNumber(trade.peakR);
  const peakR = storedPeakR !== null
    ? (liveCalculatedPeakR !== null ? Math.max(storedPeakR, liveCalculatedPeakR) : storedPeakR)
    : (liveCalculatedPeakR ?? (priceR !== null ? Math.max(0, priceR) : null));
  return { mark, fill, priceR, idealR, actualR, floatingR, floatingUsd, realizedR, totalR, totalUsd, peakPrice, peakR, remainingFraction: remaining, hasPartials };
}

export function TelemetryValue({ label, value, color = "var(--fg)" }) {
  let displayVal;
  if (isValidElement(value)) {
    displayVal = value;
  } else if (value && typeof value === "object") {
    displayVal = value.name || value.label || value.title || value.target;
    if (!displayVal) {
      try {
        displayVal = JSON.stringify(value);
      } catch {
        displayVal = String(value);
      }
    }
  } else {
    displayVal = value ?? "Unavailable";
  }

  return (
    <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      <div style={{ color: "var(--muted)", fontSize: 10, marginBottom: 3 }}>{label}</div>
      <div style={{ color, fontFamily: "monospace", fontSize: 11 }}>{displayVal}</div>
    </div>
  );
}

export function TargetLadder({ targets, legacyTarget, partialExits, tp1Done, tp2Done }) {
  const ladder = Array.isArray(targets) ? targets : [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 90px), 1fr))", gap: 8 }}>
      {["tp1", "tp2", "runner"].map((id) => {
        const target = ladder.find((t) => t.id === id);
        const completed = target?.completed === true || (id === "tp1" && tp1Done === true) || (id === "tp2" && tp2Done === true);
        const fraction = finiteNumber(target?.fraction);
        const exited = (Array.isArray(partialExits) ? partialExits : []).some((p) => p.id === id || p.targetId === id);
        return <TelemetryValue key={id} label={`${id.toUpperCase()}${fraction !== null ? ` · ${Math.round(fraction * 100)}%` : ""}`} value={target
          ? `${formatPrice(target.price)} · ${completed ? "Completed" : exited ? "Partial recorded" : "Planned"}`
          : id === "runner" && finiteNumber(legacyTarget) !== null ? `${formatPrice(legacyTarget)} · Legacy TP` : "Unavailable"} color={completed ? "var(--green)" : "var(--fg)"} />;
      })}
    </div>
  );
}

export function BrokerTelemetry({ trade }) {
  const paper = trade.isLive === false || trade.brokerStatus?.startsWith("paper") || trade.executionMode === "paper";
  const hasConfirmedFill = finiteNumber(trade.filledPrice) !== null && !!trade.filledAt;
  const isFilledPosition = hasConfirmedFill || ["active", "managing", "closing"].includes(trade.status);
  const stopConfirmed = paper || trade.brokerStatus === "sl_confirmed" || trade.isBreakeven === true || trade.isTrailing === true;
  const confirmedSl = finiteNumber(trade.confirmedSlPrice) ?? (isFilledPosition && stopConfirmed ? finiteNumber(trade.slPrice) : null);
  const operation = trade.operation;
  const requestedSl = finiteNumber(trade.requestedSlPrice ?? operation?.payload?.sl ?? trade.pendingManagement?.slPrice);
  const requested = trade.requestedState || (operation ? `${operation.kind} · ${operation.state}` : trade.operation === null ? "None pending" : null);
  const confirmedState = trade.confirmedState || (hasConfirmedFill ? `Fill @ ${formatPrice(trade.filledPrice)}` : isFilledPosition ? "Active" : null);

  let rawError = operation?.response?.error || operation?.response?.message || trade.executionError;
  if (typeof rawError === "object" && rawError !== null) rawError = rawError.message || String(rawError);
  let friendlyError = rawError;
  if (rawError && typeof rawError === "string") {
    const lower = rawError.toLowerCase();
    if (lower.includes("timeout") || lower.includes("aborted")) {
      friendlyError = "Bridge timeout: MT5 response exceeded limit. Engine is auto-reconciling broker state.";
    } else if (lower.includes("fetch failed")) {
      friendlyError = "Bridge network dropped. Engine is re-syncing broker ground-truth.";
    } else if (lower.includes("account_stale")) {
      friendlyError = "Remote account equity verification delayed. Re-validating broker state.";
    }
  }

  const isCancelling = trade.status === "cancelling" || trade.brokerStatus === "reconciliation_required";

  return (
    <div style={{ minWidth: 0, fontSize: 11, lineHeight: 1.5, overflowWrap: "anywhere" }}>
      <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span>{paper ? "Paper execution" : "Broker execution"} · {trade.brokerStatus || (isCancelling ? "reconciling" : "State pending")}</span>
        {isCancelling && (
          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(234, 179, 8, 0.15)", color: "var(--orange)", fontWeight: 700 }}>
            Reconciliation in progress
          </span>
        )}
      </div>

      <div style={{ color: "var(--muted)" }}>
        {trade.orderTicket ? `Order ticket: ${trade.orderTicket}` : null}
        {trade.ticket || trade.mt5Ticket ? `${trade.orderTicket ? " · " : ""}Position ticket: ${trade.ticket ?? trade.mt5Ticket}` : null}
        {!trade.orderTicket && !trade.ticket && !trade.mt5Ticket && "Ticket: Pending broker assignment"}
      </div>

      {isFilledPosition ? (
        <>
          <div>
            Confirmed SL: {formatPrice(confirmedSl)}
            {typeof trade.isBreakeven === "boolean" && (
              <span> · BE: {trade.isBreakeven ? "Confirmed" : "Not confirmed"}</span>
            )}
          </div>
          {requestedSl !== null && (
            <div style={{ color: "var(--muted)" }}>
              Requested SL: {formatPrice(requestedSl)} · Stored SL: {formatPrice(trade.slPrice)}
            </div>
          )}
          {confirmedState && (
            <div style={{ color: "var(--muted)" }}>
              {requested ? `Requested: ${requested} · ` : ""}Confirmed: {confirmedState}
            </div>
          )}
        </>
      ) : (
        <div style={{ color: "var(--muted)" }}>
          Planned SL: {formatPrice(trade.slPrice)} · Planned TP: {formatPrice(trade.tpPrice)}
          {requested && <div>Requested: {requested}</div>}
        </div>
      )}

      {operation?.requestId && (
        <div style={{ color: "var(--muted)", fontSize: 10 }}>
          Request ID: {String(operation.requestId).slice(0, 16)}...
          {operation.payload?.id ? ` · Target ${operation.payload.id}` : ""}
        </div>
      )}

      {friendlyError && (
        <div style={{ color: "var(--red)", marginTop: 2, background: "rgba(239, 68, 68, 0.08)", padding: "3px 6px", borderRadius: 4 }}>
          {friendlyError}
        </div>
      )}
    </div>
  );
}
