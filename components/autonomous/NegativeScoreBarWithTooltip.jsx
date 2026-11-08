"use client";

import { useState } from "react";

/**
 * Institutional Negative Scoring & Friction Progress Bar with Tooltip Popup
 * Renders a red progress bar matching Opportunity/Conviction meters, and reveals
 * an itemized breakdown of adverse friction/drag factors upon hover.
 */
export default function NegativeScoreBarWithTooltip({
  label = "Negative Drag",
  value = 0,
  barPercent = 0,
  factors = [],
  tooltipTitle = "Negative Factors",
  emptyText = "No adverse friction detected (0 drag).",
  align = "left", // "left" | "right" | "center"
  placement = "bottom", // "bottom" | "top"
}) {
  const [isHovered, setIsHovered] = useState(false);
  const numericVal = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const isNegative = numericVal < 0;
  const activePercent = Math.min(100, Math.max(0, barPercent > 0 ? barPercent : Math.abs(numericVal)));

  const popupStyle = {
    position: "absolute",
    ...(placement === "top" ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }),
    ...(align === "right"
      ? { right: 0 }
      : align === "center"
      ? { left: "50%", transform: "translateX(-50%)" }
      : { left: 0 }),
    zIndex: 120,
    minWidth: 175,
    maxWidth: 250,
    padding: "7px 10px",
    background: "rgba(15, 23, 42, 0.98)",
    backdropFilter: "blur(10px)",
    border: `1px solid ${isNegative ? "rgba(239, 68, 68, 0.45)" : "rgba(34, 197, 94, 0.35)"}`,
    borderRadius: 6,
    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.7), 0 0 10px rgba(239, 68, 68, 0.15)",
    pointerEvents: "none",
    transition: "opacity 0.15s ease",
  };

  return (
    <div
      style={{ position: "relative", width: "100%" }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Label and Value Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 9.5,
          color: "var(--muted)",
          marginBottom: 3,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ color: isNegative ? "var(--red, #ef4444)" : "var(--muted)", fontSize: 8.5 }}>
            {isNegative ? "⚠️" : "🛡️"}
          </span>
          {label}
        </span>
        <strong
          style={{
            fontFamily: "monospace",
            color: isNegative ? "var(--red, #ef4444)" : "var(--muted)",
            fontWeight: isNegative ? 800 : 600,
          }}
        >
          {isNegative ? `${numericVal} pts` : "0 Drag"}
        </strong>
      </div>

      {/* Progress Bar Track matching Opportunity/Conviction Bar */}
      <div
        style={{
          width: "100%",
          height: 4,
          borderRadius: 2,
          background: "var(--panel-2, rgba(255, 255, 255, 0.08))",
          overflow: "hidden",
          cursor: "help",
        }}
      >
        <div
          style={{
            width: isNegative ? `${activePercent}%` : "0%",
            height: "100%",
            background: "var(--red, #ef4444)",
            borderRadius: 2,
            transition: "width 0.25s ease",
          }}
        />
      </div>

      {/* Tooltip Popup on Hover */}
      {isHovered && (
        <div style={popupStyle}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
              marginBottom: 4,
            }}
          >
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 800,
                color: isNegative ? "var(--red, #ef4444)" : "var(--green, #22c55e)",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span>{isNegative ? "⚠️" : "✅"}</span> {tooltipTitle}
            </span>
            <span
              style={{
                fontSize: 9.5,
                fontFamily: "monospace",
                fontWeight: 800,
                color: isNegative ? "var(--red, #ef4444)" : "var(--green, #22c55e)",
              }}
            >
              {isNegative ? `${numericVal} pts` : "0 pts"}
            </span>
          </div>

          {factors && factors.length > 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 3.5,
                borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                paddingTop: 4,
              }}
            >
              {factors.map((f, i) => {
                const itemVal = f.val ?? f.pts ?? "";
                const isNumericItem = typeof itemVal === "number" && Number.isFinite(itemVal);
                const displayItemVal = isNumericItem
                  ? (itemVal > 0 ? `-${itemVal} pts` : `${itemVal} pts`)
                  : itemVal ? `${itemVal}` : "active";
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      fontSize: 9,
                      fontFamily: "monospace",
                    }}
                  >
                    <span style={{ color: "rgba(255, 255, 255, 0.85)" }}>{f.label}</span>
                    <span style={{ color: "var(--red, #ef4444)", fontWeight: 700 }}>
                      {displayItemVal}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              style={{
                fontSize: 9,
                color: "var(--muted)",
                borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                paddingTop: 4,
              }}
            >
              {emptyText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
