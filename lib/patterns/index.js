import { avgRange } from "./core.js";
import { detectDoubleTopsBottoms } from "./doubleTop.js";
import { detectTrendlineLiquidity } from "./trendline.js";
import { detectFVG } from "./fvg.js";
import { detectAMD } from "./amd.js";

// Pattern registry — add a detector here and it appears in the ƒx menu.
export const PATTERN_DEFS = [
  { id: "dtb", label: "Double / Triple Top & Bottom", hint: "equal highs/lows liquidity, unswept" },
  { id: "tll", label: "Trendline Liquidity", hint: "unhunted 3+ touch lines, quality-scored" },
  { id: "fvg", label: "FVG / Inverse FVG", hint: "3-candle gaps; iFVG after close-through" },
  { id: "amd", label: "AMD · Power of 3", hint: "coil + judas sweep, auto-alert on distribution trigger" },
];

const DETECTORS = {
  dtb: detectDoubleTopsBottoms,
  tll: detectTrendlineLiquidity,
  fvg: detectFVG,
  amd: detectAMD,
};

// enabled: { patternId: bool }.
// Returns { drawings, autoAlerts } — detectors may emit { kind: "auto-alert" }
// suggestions (e.g. AMD distribution trigger) which the Dashboard turns into
// real alerts.
export function runPatterns(bars, enabled, tfSec) {
  const empty = { drawings: [], autoAlerts: [] };
  if (!bars || bars.length < 30) return empty;
  const ctx = { avgRange: avgRange(bars), tfSec };
  if (!ctx.avgRange) return empty;
  const out = [];
  for (const def of PATTERN_DEFS) {
    if (!enabled?.[def.id]) continue;
    try {
      out.push(...DETECTORS[def.id](bars, ctx));
    } catch (err) {
      console.error(`[patterns] ${def.id} failed:`, err);
    }
  }
  return {
    drawings: out.filter((d) => d.kind !== "auto-alert"),
    autoAlerts: out.filter((d) => d.kind === "auto-alert"),
  };
}
