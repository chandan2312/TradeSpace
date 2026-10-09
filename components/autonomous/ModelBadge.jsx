"use client";

import React from "react";

export const MODEL_META_REGISTRY = {
  ict_2022: {
    id: "ict_2022",
    badge: "2022 Mentorship",
    name: "ICT 2022 Mentorship Model",
    short: "ICT 2022",
    color: "#38bdf8", // Sky blue
    bg: "rgba(56, 189, 248, 0.14)",
    border: "rgba(56, 189, 248, 0.35)",
    icon: "🏛",
    description: "Liquidity Sweep → Displaced MSS → FVG CE Limit",
  },
  turtle_soup: {
    id: "turtle_soup",
    badge: "Turtle Soup",
    name: "Turtle Soup Liquidity Raid",
    short: "Turtle Soup",
    color: "#fbbf24", // Amber/Gold
    bg: "rgba(245, 158, 11, 0.14)",
    border: "rgba(245, 158, 11, 0.35)",
    icon: "🐢",
    description: "External Liquidity Raid → Wick Rejection → Level Reclaim",
  },
  breaker_block: {
    id: "breaker_block",
    badge: "Breaker Block",
    name: "Breaker Block Retest",
    short: "Breaker",
    color: "#818cf8", // Indigo
    bg: "rgba(129, 140, 248, 0.14)",
    border: "rgba(129, 140, 248, 0.35)",
    icon: "⚡",
    description: "Failed Opposing OB → Displaced Structure Failure → Retest",
  },
  ote_continuation: {
    id: "ote_continuation",
    badge: "OTE Sweetspot",
    name: "OTE Trend Expansion",
    short: "OTE 70.5%",
    color: "#c084fc", // Purple / Magenta
    bg: "rgba(192, 132, 252, 0.14)",
    border: "rgba(192, 132, 252, 0.35)",
    icon: "🎯",
    description: "Aligned Impulse → 62%–79% Fibonacci Deep Discount/Premium",
  },
  silver_bullet: {
    id: "silver_bullet",
    badge: "Silver Bullet",
    name: "ICT Silver Bullet Window",
    short: "Silver Bullet",
    color: "#2dd4bf", // Teal / Cyan
    bg: "rgba(45, 212, 191, 0.14)",
    border: "rgba(45, 212, 191, 0.35)",
    icon: "⏱",
    description: "Algorithmic 60-Min Window (10-11 or 17-18 EET) → FVG Delivery",
  },
};

/**
 * Resolves normalized model metadata from any trade, setup, level, pair or string
 */
export function resolveModelMeta(input) {
  if (!input) {
    return {
      id: "unknown",
      badge: "Institutional SMC",
      name: "Institutional Entry Model",
      short: "SMC",
      color: "var(--muted)",
      bg: "rgba(255, 255, 255, 0.05)",
      border: "rgba(255, 255, 255, 0.12)",
      icon: "📐",
      description: "Autonomous SMC Entry Model",
    };
  }

  // Extract candidate string identifiers
  let raw = "";
  if (typeof input === "string") {
    raw = input;
  } else if (typeof input === "object") {
    raw =
      input.modelId ||
      input.entryModel?.id ||
      input.levelDetails?.modelId ||
      input.stagedLevel?.modelId ||
      input.primaryTrade?.modelId ||
      input.modelBadge ||
      input.entryModel?.badge ||
      input.modelName ||
      input.entryModel?.name ||
      input.levelDetails?.modelName ||
      input.stagedLevel?.modelName ||
      input.model ||
      input.type ||
      "";
  }

  const s = String(raw).toLowerCase().trim();

  if (s.includes("turtle") || s.includes("soup") || s.includes("raid")) {
    return MODEL_META_REGISTRY.turtle_soup;
  }
  if (s.includes("breaker") || s.includes("mitigation") || s.includes("order_block")) {
    return MODEL_META_REGISTRY.breaker_block;
  }
  if (s.includes("silver") || s.includes("bullet") || s === "sb") {
    return MODEL_META_REGISTRY.silver_bullet;
  }
  if (s.includes("2022") || s.includes("ict") || s.includes("mentorship") || s.includes("fvg")) {
    return MODEL_META_REGISTRY.ict_2022;
  }
  if (s.includes("ote") || s.includes("fib") || s.includes("sweetspot") || s.includes("continuation")) {
    return MODEL_META_REGISTRY.ote_continuation;
  }

  // Fallback for scanning / analyzing
  return {
    id: "scanning",
    badge: "Scanning Model",
    name: "Scanning Market Structure",
    short: "Scanning",
    color: "var(--muted)",
    bg: "rgba(255, 255, 255, 0.05)",
    border: "rgba(255, 255, 255, 0.12)",
    icon: "🔍",
    description: "Evaluating order flow retracements & institutional reaction levels",
  };
}

/**
 * Institutional Entry Model Badge Component
 */
export default function ModelBadge({
  item,
  size = "sm",
  showIcon = true,
  showName = false,
  variant = "badge",
  style = {},
}) {
  const meta = resolveModelMeta(item);

  const sizeStyles = {
    xs: {
      fontSize: 9,
      padding: "1px 5px",
      borderRadius: variant === "pill" ? 10 : 3,
      gap: 3,
      iconSize: 9,
    },
    sm: {
      fontSize: 10,
      padding: "2px 7px",
      borderRadius: variant === "pill" ? 12 : 4,
      gap: 4,
      iconSize: 10,
    },
    md: {
      fontSize: 11,
      padding: "3px 9px",
      borderRadius: variant === "pill" ? 14 : 5,
      gap: 5,
      iconSize: 11,
    },
    lg: {
      fontSize: 12,
      padding: "4px 11px",
      borderRadius: variant === "pill" ? 16 : 6,
      gap: 6,
      iconSize: 12,
    },
  }[size] || {
    fontSize: 10,
    padding: "2px 7px",
    borderRadius: 4,
    gap: 4,
    iconSize: 10,
  };

  const displayText = showName ? meta.name : meta.badge;

  return (
    <span
      title={`${meta.name} — ${meta.description}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sizeStyles.gap,
        fontSize: sizeStyles.fontSize,
        fontWeight: 800,
        fontFamily: "inherit",
        letterSpacing: "0.01em",
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.borderRadius,
        background: meta.bg,
        color: meta.color,
        border: `1px solid ${meta.border}`,
        whiteSpace: "nowrap",
        userSelect: "none",
        lineHeight: 1.2,
        ...style,
      }}
    >
      {showIcon && (
        <span style={{ fontSize: sizeStyles.iconSize, lineHeight: 1 }} aria-hidden="true">
          {meta.icon}
        </span>
      )}
      <span>{displayText}</span>
    </span>
  );
}
