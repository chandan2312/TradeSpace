"use client";

import React from "react";
import { isTradingPermittedNow } from "../../lib/autonomous/timeslots";

/**
 * Universal session status resolver for any asset/symbol or radar pair.
 */
export function getSessionStatus(symbol, pair = null, config = {}, now = new Date()) {
  // 1. Backend scanner evaluated profile
  if (pair?.sessionProfile && typeof pair.sessionProfile.isCurrentlyActive === "boolean") {
    const slotName =
      pair.activeTimeSlot?.name ||
      pair.sessionProfile?.fullLabel ||
      pair.sessionProfile?.label ||
      "Trading Session";
    const allowed = pair.sessionProfile.isCurrentlyActive;
    return {
      allowed,
      slotName: pair.activeTimeSlot?.shortBadge || (allowed ? "ACTIVE" : "OFF"),
      fullName: slotName,
      tooltip: allowed
        ? `🟢 Allowed Trading Session: Active (${slotName})`
        : `🔴 Outside Allowed Session: ${pair.sessionProfile?.reason || pair.sessionProfile?.description || "Outside Permitted Execution Hours"}`,
    };
  }

  // 2. Client-side evaluation fallback
  try {
    const sym = symbol || pair?.symbol;
    const live = isTradingPermittedNow(now ? (now instanceof Date ? now : new Date(now)) : new Date(), config, sym);
    const slotName = live.slot?.name || pair?.activeTimeSlot?.name || "Trading Session";
    return {
      allowed: Boolean(live.permitted),
      slotName: live.slot?.shortBadge || (live.permitted ? "ACTIVE" : "OFF"),
      fullName: slotName,
      tooltip: live.permitted
        ? `🟢 Allowed Trading Session: Active (${slotName})`
        : `🔴 Outside Allowed Session: ${live.reason || "Outside Permitted Execution Hours"}`,
    };
  } catch {
    // 3. Fallback based on status & vetoes
    const hasTimingVeto = pair?.vetoes?.some(
      (v) =>
        v.code === "TIMING" ||
        v.code === "DEAD_ZONE" ||
        v.code === "OFF_SESSION" ||
        v.code === "SESSION_RESTRICTED"
    );
    const allowed = !hasTimingVeto && !/OFF_SESSION|DEAD_ZONE|TIMING/.test(pair?.status || "");
    return {
      allowed,
      slotName: allowed ? "ACTIVE" : "OFF",
      fullName: "Trading Window",
      tooltip: allowed ? "🟢 Allowed Trading Session: Active" : "🔴 Outside Allowed Session",
    };
  }
}

/**
 * Super-minimal Glowing Session LED Dot Component
 * Renders ONLY the glowing green/red circular dot (zero text labels, zero bulky frames).
 */
export default function SessionLedDot({
  symbol,
  pair = null,
  config = {},
  size = 7,
  style = {},
  className = "",
  now = null,
}) {
  const status = getSessionStatus(symbol || pair?.symbol, pair, config, now);

  return (
    <span
      className={`session-led-dot ${status.allowed ? "allowed" : "disallowed"} ${className}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        ...style,
      }}
      title={status.tooltip}
      aria-label={status.tooltip}
    />
  );
}
