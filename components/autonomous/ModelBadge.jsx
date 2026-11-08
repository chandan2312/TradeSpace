"use client";

import React from "react";
import { MODEL_META_REGISTRY, resolveModelMeta } from "./modelMeta.js";

export { MODEL_META_REGISTRY, resolveModelMeta };

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
