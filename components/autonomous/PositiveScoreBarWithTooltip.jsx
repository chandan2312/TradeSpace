"use client";

import { useState } from "react";

/**
 * Institutional Positive Scoring & Edge Progress Bar with Tooltip Popup
 * Renders a positive progress bar matching Opportunity/Conviction meters, and reveals
 * an itemized breakdown of confluence edge pillars / conviction drivers upon hover.
 */
export default function PositiveScoreBarWithTooltip({
  label = "Score",
  value = 0,
  valueDisplay = null,
  barPercent = 0,
  barColor = "var(--accent)",
  icon = "▲",
  factors = [],
  tooltipTitle = "Positive Edge Factors",
  emptyText = "Evaluating market structure...",
  align = "left", // "left" | "right" | "center"
  placement = "bottom", // "bottom" | "top"
}) {
  const [isHovered, setIsHovered] = useState(false);
  const activePercent = Math.min(100, Math.max(0, barPercent));
  const displayVal = valueDisplay !== null ? valueDisplay : (typeof value === "number" ? `${value}` : value || "—");

  const popupStyle = {
    position: "absolute",
    ...(placement === "top" ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }),
    ...(align === "right"
      ? { right: 0 }
      : align === "center"
      ? { left: "50%", transform: "translateX(-50%)" }
      : { left: 0 }),
    zIndex: 150,
    minWidth: 190,
    maxWidth: 270,
    padding: "8px 11px",
    background: "rgba(15, 23, 42, 0.98)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(34, 197, 94, 0.45)",
    borderRadius: 7,
    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.75), 0 0 12px rgba(34, 197, 94, 0.15)",
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
          {icon && <span style={{ color: barColor, fontSize: 8 }}>{icon}</span>}
          {label}
        </span>
        <strong
          style={{
            fontFamily: "monospace",
            color: barColor,
            fontWeight: 800,
          }}
        >
          {displayVal}
        </strong>
      </div>

      {/* Progress Bar Track */}
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
            width: `${activePercent}%`,
            height: "100%",
            background: barColor,
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
                color: "var(--green, #22c55e)",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span>⭐</span> {tooltipTitle}
            </span>
            <span
              style={{
                fontSize: 9.5,
                fontFamily: "monospace",
                fontWeight: 800,
                color: "var(--green, #22c55e)",
              }}
            >
              {displayVal}
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
                    <span style={{ color: "var(--green, #22c55e)", fontWeight: 700 }}>
                      {itemVal}
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
