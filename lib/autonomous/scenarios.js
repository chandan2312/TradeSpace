// Timeframe responsibilities are explicit: lower frames may refine a valid
// macro thesis, never replace it or turn off-session hours into a swing entry.
// TradeSpace Standard: Exactly 3 Official Horizons (1D-1H Swing, 4H-15M Day, 30M-5M Scalp).
import { getCurrentTimeSlot } from "./timeslots.js";

export const SCENARIOS = {
  SWING: {
    id: "swing", label: "Swing Expansion (1D-1H)", badge: "1D-1H", tag: "SWG",
    horizonCode: 1,
    description: "D1 compass and external DOL; 4H structural roadmap; 1H gatekeeper & execution refinement.",
    macroTf: "D1", compassTfs: ["D1"], sessionTf: "4H",
    gatekeeperTf: "1H", triggerTf: "1H", refinementTf: "15M",
    requiredTfs: ["D1", "H4", "H1"],
    minRR: 2.8, expectedHoldingHours: "1 - 5 days",
  },
  DAY: {
    id: "day", label: "Day Trade Expansion (4H-15M)", badge: "4H-15M", tag: "DAY",
    horizonCode: 2,
    description: "4H compass and DOL; 1H session roadmap; 15M gatekeeper and closed-bar execution.",
    macroTf: "H4", compassTfs: ["H4", "D1"], sessionTf: "1H",
    gatekeeperTf: "15M", triggerTf: "15M", refinementTf: "5M",
    requiredTfs: ["D1", "H4", "H1", "M15"],
    minRR: 2.0, expectedHoldingHours: "2 - 8 hrs",
  },
  SCALP: {
    id: "scalp", label: "Intraday Scalp (30M-5M)", badge: "30M-5M", tag: "SCP",
    horizonCode: 3,
    description: "30M session compass and DOL; 15M roadmap; 5M precision trigger inside killzones.",
    macroTf: "M30", compassTfs: ["M30", "H1"], sessionTf: "15M",
    gatekeeperTf: "M5", triggerTf: "M5", refinementTf: "5M",
    requiredTfs: ["H1", "M30", "M15", "M5"],
    minRR: 1.5, expectedHoldingHours: "45 mins - 2.5 hrs",
  },
};

// Aliases for compatibility
SCENARIOS.INTRADAY = SCENARIOS.DAY;
SCENARIOS.DAY_TRADE = SCENARIOS.DAY;

export function resolveScenarioForPair({ brain = {}, ranges = {}, config = {} }) {
  const mode = String(config.horizonMode || "adaptive").toLowerCase().trim();
  if (mode === "swing") {
    return { scenario: SCENARIOS.SWING, mode: "swing", rationale: "Configured Swing (1D-1H) timeframe responsibilities; all execution vetoes still apply." };
  }
  if (mode === "day" || mode === "day_trade") {
    return { scenario: SCENARIOS.DAY, mode: "day", rationale: "Configured Day Trade (4H-15M) timeframe responsibilities; all execution vetoes still apply." };
  }
  if (mode === "scalp") {
    return { scenario: SCENARIOS.SCALP, mode: "scalp", rationale: "Configured Scalp (30M-5M) timeframe responsibilities; all execution vetoes still apply." };
  }
  if (mode === "intraday") {
    return { scenario: SCENARIOS.DAY, mode: "intraday", rationale: "Configured Day Trade (4H-15M) timeframe responsibilities; all execution vetoes still apply." };
  }

  // Adaptive Horizon Resolution
  const rangeMap = ranges.ranges || ranges || {};
  const dol = brain.targetDOL;
  const dir = brain.macroDir || (brain.allowedToLong ? 1 : brain.allowedToShort ? -1 : 0);
  const rangeH4 = rangeMap.H4;
  const h4Runway = rangeH4 && dir ? (dir === 1 ? 100 - rangeH4.coveragePct : rangeH4.coveragePct) : 0;
  const isHtfDol = dol && (/^(D1|H4)$/.test(dol.tf || "") || /PWH|PWL|D1|4H|EXTERNAL/i.test(dol.name || dol.kind || ""));
  const flowAligned = dir === 1 ? /BULLISH/.test(brain.fvgOrderFlow || "") : dir === -1 && /BEARISH/.test(brain.fvgOrderFlow || "");

  // 1. Swing candidate: aligned HTF external liquidity thesis with >= 55% H4 runway
  if (isHtfDol && h4Runway >= 55 && flowAligned && dir !== 0) {
    return {
      scenario: SCENARIOS.SWING,
      mode: "adaptive_swing",
      rationale: "Aligned D1 external liquidity thesis with structural swing runway.",
    };
  }

  // 2. Scalp candidate: When within active killzone and HTF range is exhausted/consolidating
  const slot = config.activeTimeSlot || brain.snapshot?.activeTimeSlot || getCurrentTimeSlot(new Date(config.now ?? Date.now()));
  const isKillzone = slot?.isKillzone || false;
  const isExhaustedH4 = rangeH4 && (rangeH4.coveragePct >= 80 || rangeH4.coveragePct <= 20);
  if (isKillzone && isExhaustedH4 && dir !== 0) {
    return {
      scenario: SCENARIOS.SCALP,
      mode: "adaptive_scalp",
      rationale: "Killzone session timing with tight range consolidation favoring 30M-5M precision scalping.",
    };
  }

  // 3. Day Trading (institutional workhorse): 4H compass + 1H roadmap + 15M gatekeeper
  return {
    scenario: SCENARIOS.DAY,
    mode: "adaptive_day",
    rationale: "4H order flow compass with 1H session roadmap and 15M gatekeeper trigger.",
  };
}
