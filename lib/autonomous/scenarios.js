// TradeSpace Standard: Strictly Day Trading Mode (4H-15M).
// Swing (1D-1H) and Scalp (30M-5M) modes have been completely excluded from the project.
import { getCurrentTimeSlot } from "./timeslots.js";

export const SCENARIOS = {
  DAY: {
    id: "day", label: "Day Trade Expansion (4H-15M)", badge: "4H-15M", tag: "DAY",
    horizonCode: 2,
    description: "4H compass and DOL; 1H session roadmap; 15M gatekeeper and closed-bar execution.",
    macroTf: "H4", compassTfs: ["H4", "D1"], sessionTf: "1H",
    gatekeeperTf: "15M", triggerTf: "15M", refinementTf: "5M",
    requiredTfs: ["D1", "H4", "H1", "M15", "M5"],
    minRR: 2.0, expectedHoldingHours: "2 - 8 hrs",
  },
};

// Full backward compatibility aliases for legacy database records and components
SCENARIOS.SWING = SCENARIOS.DAY;
SCENARIOS.SCALP = SCENARIOS.DAY;
SCENARIOS.INTRADAY = SCENARIOS.DAY;
SCENARIOS.DAY_TRADE = SCENARIOS.DAY;

export function isScalpEnabled() {
  return false;
}

export function resolveScenarioForPair() {
  return {
    scenario: SCENARIOS.DAY,
    mode: "day",
    rationale: "Day Trade (4H-15M): 4H order flow compass with 1H session roadmap and 15M gatekeeper trigger.",
  };
}
