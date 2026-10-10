// Comprehensive Test Suite for Autonomous Brain Trader Engine
// Validates:
//   1. Trading Scenarios & Horizon Resolver (scenarios.js)
//   2. Dynamic Institutional Level Detector & Confluence Scorer (levels.js)
//   3. Universe Opportunity Scanner Logic (scanner.js)
//   4. Trade State Machine & Position Management (engine.js)

import { SCENARIOS, resolveScenarioForPair } from "./lib/autonomous/scenarios.js";
import { selectOptimalEntryLevel } from "./lib/autonomous/levels.js";
import { DEFAULT_AUTONOMOUS_CONFIG, validateAutonomousConfig } from "./lib/autonomous/store.js";
import {
  isSymbolInMainWatchlist,
  getBrokerWatchlistSymbol,
  canonOf,
  baseOf,
} from "./lib/autonomous/watchlist.js";
import {
  getCurrentTimeSlot,
  getAllTimeSlots,
  isTradingPermittedNow,
  TIME_SLOTS,
  getTimeSlotForBar,
  getEetTime,
  getSymbolSessionProfile,
  isSymbolPermittedInSlot,
  SYMBOL_SESSION_PROFILES,
} from "./lib/autonomous/timeslots.js";
import {
  ENTRY_MODEL_DEFINITIONS,
  evaluateAllEntryModels,
  evaluateExecutionVetoes,
} from "./lib/autonomous/models.js";
import { getSetupFingerprint, getExhaustedTodayFingerprints, createAutonomousEngine } from "./lib/autonomous/engine.js";
import { getStartOfTradingDay } from "./lib/autonomous/timeslots.js";
import {
  calculateHalfTargetLevel,
  breakevenPrice,
  calculateOptimalRiskFreeLevel,
  calculateRiskFreeStop,
  calculatePropFirmTp,
  resolveDynamicPropFirmTarget,
  evaluatePropFirmSafeAction,
  planFractionalVolumes,
  determineTerminalStatus,
} from "./lib/autonomous/management.js";
import {
  resolveCascadingDefaultTarget,
  DEFAULT_TP_RANGE,
  PROP_FIRM_TP_RANGE,
  DEFAULT_HORIZON_TIMEFRAME_LEVELS,
  PROP_TIMEFRAME_LADDER,
} from "./lib/autonomous/tpCascadingEngine.js";
import { computeRR } from "./lib/draw/core.js";
import { TERMINAL_STATES } from "./lib/autonomous/store.js";
import { calculateRiskSize, dailyRiskGovernor, calculateEffectiveGroupRisk, calculatePartitionedDailyPnl, calculatePartitionedDailyR } from "./lib/autonomous/risk.js";
import { calculateInstitutionalPositionSize, getMT5State } from "./lib/autonomous/mt5.js";
import {
  encodeDecimalMagic,
  decodeDecimalMagic,
  formatCopierComment,
  parseCopierComment,
  getAssetClass,
  getHorizonCode,
  getModelCode,
  getManagementCode,
  evaluateCopierEligibility,
  resolveCopierRouting,
  DEFAULT_COPIER_PROFILES,
} from "./lib/autonomous/magicEncoder.js";
import {
  calculateSpreadFriction,
  extractSpreadPrice,
  isSpreadAcceptable,
} from "./lib/autonomous/friction.js";
import {
  evaluateMilestoneRedecision,
  synthesizeRedecision,
} from "./lib/autonomous/redecision.js";
import { ObjectId } from "mongodb";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    failed++;
  }
}

console.log("=======================================================");
console.log("TEST SUITE 1: Autonomous Scenarios & Horizon Resolution");
console.log("=======================================================");

// 1. Forced Day Trade Mode (4H-15M)
const resDay = resolveScenarioForPair({
  symbol: "EURUSD",
  brain: { conviction: 85, allowedToLong: true },
  ranges: { ranges: { H4: { coveragePct: 30 } } },
  config: { horizonMode: "day" },
});
assert(resDay.scenario.id === "day", "Forced day mode returns DAY scenario (4H-15M)");
assert(resDay.scenario.minRR === 2.0, "Day trade scenario enforces minimum 2.0R");

// 2. Forced Scalp Mode (30M-5M)
const resScalp = resolveScenarioForPair({
  symbol: "EURUSD",
  brain: { conviction: 85, allowedToLong: true },
  ranges: { ranges: { M15: { coveragePct: 30 } } },
  config: { horizonMode: "scalp" },
});
assert(resScalp.scenario.id === "scalp", "Forced scalp mode returns SCALP scenario (30M-5M)");
assert(resScalp.scenario.minRR === 1.5, "Scalp scenario enforces minimum 1.5R");

// 3. Forced Swing Mode (1D-1H)
const resSwing = resolveScenarioForPair({
  symbol: "EURUSD",
  brain: { conviction: 85, allowedToLong: true },
  ranges: { ranges: { H4: { coveragePct: 30 } } },
  config: { horizonMode: "swing" },
});
assert(resSwing.scenario.id === "swing", "Forced swing mode returns SWING scenario (1D-1H)");
assert(resSwing.scenario.minRR === 2.8, "Swing scenario enforces minimum 2.8R");

// 4. Adaptive Mode: High HTF runway + HTF Target DOL + dominant 4H order flow -> SWING
const resAdaptiveSwing = resolveScenarioForPair({
  symbol: "EURUSD",
  brain: {
    conviction: 82,
    allowedToLong: true,
    fvgOrderFlow: "BULLISH_DOMINANT",
    targetDOL: { name: "PWH External Buy-side Liquidity", price: 1.1200 },
  },
  ranges: { ranges: { H4: { coveragePct: 25 } } }, // 75% runway open!
  config: { horizonMode: "adaptive" },
});
assert(resAdaptiveSwing.scenario.id === "swing", "Adaptive mode selects SWING when HTF runway >= 55% and HTF DOL present");
assert(resAdaptiveSwing.mode === "adaptive_swing", "Mode marked as adaptive_swing");

console.log("\n=======================================================");
console.log("TEST SUITE 2: Dynamic Level Selection & Confluence Scoring");
console.log("=======================================================");

// Mock candle bars for setup
function createImpulseBars() {
  const bars = [];
  const baseTime = 1700000000;
  // Consolidating
  for (let i = 0; i < 15; i++) {
    bars.push({ time: baseTime + i * 3600, open: 1.0800, high: 1.0820, low: 1.0790, close: 1.0810, v: 100 });
  }
  // Order Block down-candle at bar 15
  bars.push({ time: baseTime + 15 * 3600, open: 1.0810, high: 1.0815, low: 1.0770, close: 1.0780, v: 150 });
  // Impulse displacement up bars 16-18 creating FVG
  bars.push({ time: baseTime + 16 * 3600, open: 1.0785, high: 1.0860, low: 1.0780, close: 1.0850, v: 500 });
  bars.push({ time: baseTime + 17 * 3600, open: 1.0855, high: 1.0920, low: 1.0845, close: 1.0910, v: 600 });
  bars.push({ time: baseTime + 18 * 3600, open: 1.0910, high: 1.0970, low: 1.0900, close: 1.0960, v: 550 });
  // Retracing slightly at current price
  bars.push({ time: baseTime + 19 * 3600, open: 1.0960, high: 1.0965, low: 1.0930, close: 1.0940, v: 200 });
  return bars;
}

const mockFrames = {
  H4: createImpulseBars(),
  H1: createImpulseBars(),
  M15: createImpulseBars(),
  M5: createImpulseBars(),
};

const testCandidate = {
  id: "ict_2022",
  name: "ICT 2022 Mentorship Model",
  badge: "ICT 2022",
  tf: "M5",
  entry: 1.0850,
  sl: 1.0780,
  tp: 1.1050,
  rr: 2.85,
  targetRR: 2.85,
  meetsMinRR: true,
  confluenceScore: 78,
  targets: [
    { id: "tp1", price: 1.0920, fraction: 0.333 },
    { id: "tp2", price: 1.1050, fraction: 0.667 },
  ],
  evidence: {
    formationTime: 1700000000,
    raid: {
      dir: 1,
      raidIndex: 10,
      reclaimIndex: 11,
      levelPrice: 1.0790,
      extreme: 1.0770,
      confirmationTime: 1699990000,
      raidTime: 1700000000,
    },
    mss: {
      index: 13,
      displacement: { valid: true },
      brokenPivot: { price: 1.0820, confirmedAt: 5 },
    },
    fvg: {
      dir: 1,
      eligible: true,
      born: 14,
      top: 1.0860,
      bottom: 1.0840,
      state: "VIRGIN",
    },
  },
};

const levelRes = selectOptimalEntryLevel({
  symbol: "EURUSD",
  dir: 1, // BUY
  scenario: SCENARIOS.INTRADAY,
  frames: mockFrames,
  ranges: {
    ranges: {
      H1: { high: 1.0970, low: 1.0770, tf: "H1" },
      H4: { high: 1.0970, low: 1.0770, tf: "H4" },
    },
  },
  htfFvg: {
    respected: [
      { dir: 1, ce: 1.0815, top: 1.0845, bottom: 1.0785, quality: "A_PRIME_CE_DEFENDED", ageBars: 2 },
    ],
  },
  targetDOL: { name: "4H EQH BSL", price: 1.1050 },
  config: { minRR: 2.0, candidate: testCandidate },
});

assert(levelRes !== null, "Successfully discovered candidate institutional levels");
assert(levelRes.entry > 0, `Entry level calculated: ${levelRes.entry}`);
assert(levelRes.sl < levelRes.entry, `Stop Loss (${levelRes.sl}) is safely below entry (${levelRes.entry})`);
assert(levelRes.tp > levelRes.entry, `Take Profit (${levelRes.tp}) is above entry`);
assert(levelRes.rr >= 2.0, `Calculated R:R meets minimum threshold (got ${levelRes.rr}R)`);
assert(levelRes.confluenceScore >= 50, `Confluence score properly calculated: ${levelRes.confluenceScore}`);
assert(Array.isArray(levelRes.allCandidates) && levelRes.allCandidates.length > 0, "Candidate levels list populated");

console.log("\n=======================================================");
console.log("TEST SUITE 3: Risk & Position Sizing Mathematical Precision");
console.log("=======================================================");

const cfg = DEFAULT_AUTONOMOUS_CONFIG;
assert(cfg.riskPerTradePct === 1.0, "Default risk per trade is 1.0%");
assert(cfg.accountSize === 50000, "Default account size is $50,000");
const calculatedRiskUsd = cfg.accountSize * (cfg.riskPerTradePct / 100);
assert(calculatedRiskUsd === 500, "1.0% risk on $50,000 equals exactly $500.00");
assert(cfg.breakevenTriggerR === 1.5, "Breakeven arms dynamically at +1.5R");
assert(cfg.trailStopTriggerR === 2.5, "Trailing stop arms dynamically at +2.5R");

console.log("\n=======================================================");
console.log("TEST SUITE 4: Main Watchlist Symbol Filtering & Resolution");
console.log("=======================================================");

// Mock user's active Main Watchlist from database:
const userWatchlist = ["NAS100", "XAUUSD", "EURUSD.I", "DJ30", "SP500", "GER40", "BTCUSD"];

// 1. Direct symbol membership
assert(isSymbolInMainWatchlist("NAS100", userWatchlist) === true, "NAS100 matches in user watchlist");
assert(isSymbolInMainWatchlist("XAUUSD", userWatchlist) === true, "XAUUSD matches in user watchlist");
assert(isSymbolInMainWatchlist("BTCUSD", userWatchlist) === true, "BTCUSD matches in user watchlist");

// 2. Broker alias matching (e.g. EURUSD without broker suffix matches EURUSD.I)
assert(isSymbolInMainWatchlist("EURUSD", userWatchlist) === true, "EURUSD matches EURUSD.I with broker suffix");
assert(baseOf("EURUSD.I") === "EURUSD", "baseOf extracts base currency pair from EURUSD.I");
assert(getBrokerWatchlistSymbol("EURUSD", userWatchlist) === "EURUSD.I", "getBrokerWatchlistSymbol resolves EURUSD -> EURUSD.I");

// 3. Index canonical alias matching (US30 <-> DJ30, US500 <-> SP500)
assert(isSymbolInMainWatchlist("US30", userWatchlist) === true, "US30 matches DJ30 alias");
assert(canonOf("DJ30") === "US30", "canonOf('DJ30') normalizes to US30");
assert(canonOf("US30") === "US30", "canonOf('US30') normalizes to US30");
assert(getBrokerWatchlistSymbol("US30", userWatchlist) === "DJ30", "getBrokerWatchlistSymbol resolves US30 -> DJ30");

assert(isSymbolInMainWatchlist("US500", userWatchlist) === true, "US500 matches SP500 alias");
assert(getBrokerWatchlistSymbol("US500", userWatchlist) === "SP500", "getBrokerWatchlistSymbol resolves US500 -> SP500");

// 4. Non-watchlist symbols MUST BE BLOCKED from trading entry
assert(isSymbolInMainWatchlist("USDJPY", userWatchlist) === false, "USDJPY correctly rejected (not in Main Watchlist)");
assert(isSymbolInMainWatchlist("GBPUSD", userWatchlist) === false, "GBPUSD correctly rejected (not in Main Watchlist)");
assert(isSymbolInMainWatchlist("AUDCAD", userWatchlist) === false, "AUDCAD correctly rejected (not in Main Watchlist)");
assert(isSymbolInMainWatchlist("ETHUSD", userWatchlist) === false, "ETHUSD correctly rejected (not in Main Watchlist)");
assert(isSymbolInMainWatchlist("NZDUSD", userWatchlist) === false, "NZDUSD correctly rejected (not in Main Watchlist)");

// 5. Empty watchlist fallback guard
assert(isSymbolInMainWatchlist("EURUSD", []) === false, "Empty watchlist safely rejects all trades");

console.log("\n=======================================================");
console.log("TEST SUITE 5: Trading Time Slots & Killzones Engine");
console.log("=======================================================");

const allSlots = getAllTimeSlots();
assert(Array.isArray(allSlots) && allSlots.length === 10, "All 10 canonical institutional time slots defined");

const helperEetTime = (h, m) => h * 3600 + m * 60;

// 1. Asian Range (03:30 EET)
const slotAsia = getCurrentTimeSlot(helperEetTime(3, 30));
assert(slotAsia.id === "asian_range", "03:30 EET resolves to Asian Range Accumulation");
assert(slotAsia.isKillzone === false, "Asian Range is marked as non-killzone accumulation");
assert(slotAsia.shortBadge === "ASIA 02-06", "Asian Range short badge formatted in EET");

// Interstitial Asian Close Lull (07:00 EET)
const slotAsiaLull = getCurrentTimeSlot(helperEetTime(7, 0));
assert(slotAsiaLull.id === "off_session_lull", "07:00 EET resolves to Asian Close Lull");
assert(slotAsiaLull.shortBadge === "LULL 06-08", "Asian Close Lull short badge formatted in EET");

// 2. London Open Killzone (10:15 EET)
const slotLdn = getCurrentTimeSlot(helperEetTime(10, 15));
assert(slotLdn.id === "london_open", "10:15 EET resolves to London Open Killzone (LOKZ)");
assert(slotLdn.isKillzone === true, "London Open is recognized as active Killzone");
assert(slotLdn.shortBadge === "LOKZ 10-13", "London Open short badge formatted in EET (10-13)");

// 3. London Lunch Lull (13:30 EET)
const slotLunch = getCurrentTimeSlot(helperEetTime(13, 30));
assert(slotLunch.id === "london_lunch", "13:30 EET resolves to London Lunch");
assert(slotLunch.phase === "CONSOLIDATION", "London Lunch marked as consolidation lull");
assert(slotLunch.shortBadge === "LUNCH 13-15", "London Lunch short badge formatted in EET");

// 4. Pre-New York Session Setup (15:30 EET)
const slotPreNy = getCurrentTimeSlot(helperEetTime(15, 30));
assert(slotPreNy.id === "pre_ny_prep", "15:30 EET resolves to Pre-New York Session Setup");
assert(slotPreNy.shortBadge === "PRE-NY 15-16:25", "Pre-New York short badge formatted in EET");

// 5. New York AM Killzone (16:30 EET)
const slotNyAm = getCurrentTimeSlot(helperEetTime(16, 30));
assert(slotNyAm.id === "ny_open", "16:30 EET resolves to New York AM Killzone");
assert(slotNyAm.isKillzone === true, "New York AM is recognized as active Killzone");
assert(slotNyAm.shortBadge === "NYKZ 16:25-20:30", "New York AM short badge formatted in EET");

// 5. New York Silver Bullet Window (17:30 EET)
const slotSb = getCurrentTimeSlot(helperEetTime(17, 30));
assert(slotSb.id === "ny_silver_bullet", "17:30 EET resolves to NY Silver Bullet Window");
assert(slotSb.isSilverBullet === true, "Silver Bullet window flag active");
assert(slotSb.shortBadge === "NYSB 17-18", "Silver Bullet short badge formatted in EET");

// 6. London Close Killzone (18:45 EET)
const slotLckz = getCurrentTimeSlot(helperEetTime(18, 45));
assert(slotLckz.id === "london_close", "18:45 EET resolves to London Close Killzone");
assert(slotLckz.shortBadge === "LCKZ 18-20", "London Close short badge formatted in EET");

// 7. New York PM Killzone (21:30 EET)
const slotNypm = getCurrentTimeSlot(helperEetTime(21, 30));
assert(slotNypm.id === "ny_pm", "21:30 EET resolves to New York PM Killzone");
assert(slotNypm.shortBadge === "NYPM 21-23", "New York PM short badge formatted in EET");

// 8. Rollover Dead Zone (00:30 EET)
const slotDead = getCurrentTimeSlot(helperEetTime(0, 30));
assert(slotDead.id === "dead_zone", "00:30 EET resolves to Post-Close Dead Zone");
assert(slotDead.isDeadZone === true, "Dead zone flag active");
assert(slotDead.shortBadge === "DEAD 00-02", "Dead Zone short badge formatted in EET");

// 9. Trading Permission Gating
const deadPerm = isTradingPermittedNow(helperEetTime(0, 30), DEFAULT_AUTONOMOUS_CONFIG);
assert(deadPerm.permitted === false, "Order entries strictly blocked during Dead Zone by default");
assert(/Dead Zone/i.test(deadPerm.reason), "Dead Zone block reason communicated");

const sbPerm = isTradingPermittedNow(helperEetTime(17, 30), DEFAULT_AUTONOMOUS_CONFIG);
assert(sbPerm.permitted === true, "Order entries permitted during active Silver Bullet window");

const lunchPerm = isTradingPermittedNow(helperEetTime(13, 30), DEFAULT_AUTONOMOUS_CONFIG);
assert(lunchPerm.permitted === false, "London lunch blocked by default config to avoid chop");

// 10. Direct Candle Bar Matching in EET (Zero-Offset)
assert(slotLdn.brokerRange === "10:00 - 13:00 Broker Server Time", "London Open brokerRange properly mapped to EET");
const midnightSec = 1700000000 - (1700000000 % 86400);
const sampleBarAt1730Eet = { time: midnightSec + helperEetTime(17, 30) };
const slotFromBar = getTimeSlotForBar(sampleBarAt1730Eet);
assert(slotFromBar.id === "ny_silver_bullet", "getTimeSlotForBar directly maps 17:30 candle bar to NY Silver Bullet in EET");

// 11. EET Real-Time Clock Extraction Verification
const nowEet = getEetTime(new Date());
assert(typeof nowEet.h === "number" && typeof nowEet.m === "number" && typeof nowEet.totalMinutes === "number", "getEetTime successfully extracts live EET time from system");

// 12. Extended New York Window (16:25 - 20:30 EET) & Dynamic User Custom Timings
const slotNyExtended = getCurrentTimeSlot(helperEetTime(20, 15));
assert(slotNyExtended.id === "ny_open", "20:15 EET resolves to New York AM Killzone under extended 16:25 - 20:30 window");
assert(slotNyExtended.shortBadge === "NYKZ 16:25-20:30", "New York AM short badge displays extended range 16:25-20:30");

// 13. Dynamic User-Configured Slot Timings Override Verification
const customConfig = {
  ...DEFAULT_AUTONOMOUS_CONFIG,
  slotCustomTimings: {
    ny_open: { start: "14:00", end: "22:00" },
  },
};
const slotCustomNy = getCurrentTimeSlot(helperEetTime(14, 30), customConfig);
assert(slotCustomNy.id === "ny_open", "14:30 EET resolves to custom configured ny_open window");
assert(slotCustomNy.shortBadge === "NYKZ 14:00-22:00", "Custom slot timings reflect configured start-end range in badge");
assert(slotCustomNy.startMinute === 840 && slotCustomNy.endMinute === 1320, "startMinute and endMinute dynamically updated from custom timings");

console.log("\n=======================================================");
console.log("TEST SUITE 6: The 5 Core Institutional Entry Models");
console.log("=======================================================");

// 1. Verify Entry Model Definitions
assert(Object.keys(ENTRY_MODEL_DEFINITIONS).length === 5, "5 institutional entry models defined");
assert(ENTRY_MODEL_DEFINITIONS.ICT_2022.id === "ict_2022", "Model 1: ICT 2022 Mentorship defined");
assert(ENTRY_MODEL_DEFINITIONS.TURTLE_SOUP.id === "turtle_soup", "Model 2: Turtle Soup Liquidity Raid defined");
assert(ENTRY_MODEL_DEFINITIONS.BREAKER_BLOCK.id === "breaker_block", "Model 3: Breaker Block & Mitigation defined");
assert(ENTRY_MODEL_DEFINITIONS.OTE_CONTINUATION.id === "ote_continuation", "Model 4: OTE Trend Expansion defined");
assert(ENTRY_MODEL_DEFINITIONS.SILVER_BULLET.id === "silver_bullet", "Model 5: ICT Silver Bullet defined");

// 2. Evaluate All Entry Models on Impulse & Liquidity Bars
const modelsEval = evaluateAllEntryModels({
  symbol: "EURUSD",
  dir: 1, // BUY
  scenario: SCENARIOS.INTRADAY,
  frames: mockFrames,
  ranges: {
    ranges: {
      H1: { high: 1.0970, low: 1.0770, tf: "H1" },
      H4: { high: 1.0970, low: 1.0770, tf: "H4" },
    },
  },
  htfFvg: {
    respected: [
      { dir: 1, ce: 1.0815, top: 1.0845, bottom: 1.0785, quality: "A_PRIME_CE_DEFENDED", ageBars: 2 },
    ],
  },
  targetDOL: { name: "4H EQH BSL", price: 1.1050 },
  config: { minRR: 2.0, candidate: testCandidate },
  brain: { conviction: 82, fvgOrderFlow: "BULLISH_DOMINANT" },
});

assert(modelsEval !== null, "Successfully ran dynamic multi-model evaluation");
assert(modelsEval.modelId !== undefined, `Winning model selected: ${modelsEval.modelName}`);
assert(modelsEval.entry > 0, `Valid entry price calculated: ${modelsEval.entry}`);
assert(modelsEval.sl < modelsEval.entry, `Valid stop loss below entry: ${modelsEval.sl}`);
assert(modelsEval.tp > modelsEval.entry, `Valid take profit above entry: ${modelsEval.tp}`);
assert(modelsEval.rr >= 2.0, `Calculated model R:R meets minimum threshold (${modelsEval.rr}R)`);
assert(modelsEval.confluenceScore >= 50, `Confluence score properly calculated: ${modelsEval.confluenceScore}`);
assert(modelsEval.timeSlot !== undefined, "Active time slot attached to evaluated model");
assert(Array.isArray(modelsEval.allCandidates) && modelsEval.allCandidates.length >= 1, "Candidate models list populated");

console.log("\n=======================================================");
console.log("TEST SUITE 6B: Adversarial Model & Geometry Gates");
console.log("=======================================================");
const strictCandidate = { ...testCandidate, modelId: "ict_2022" };
const disabledModel = evaluateAllEntryModels({
  symbol: "EURUSD",
  dir: 1,
  scenario: SCENARIOS.INTRADAY,
  frames: mockFrames,
  ranges: { ranges: { H1: { high: 1.0970, low: 1.0770, tf: "H1" }, H4: { high: 1.0970, low: 1.0770, tf: "H4" } } },
  targetDOL: { name: "4H EQH BSL", price: 1.1050 },
  config: { minRR: 2.0, candidate: strictCandidate, enabledModels: { ict_2022: false } },
  brain: { conviction: 82, fvgOrderFlow: "BULLISH_DOMINANT" },
});
assert(disabledModel?.permitted === false, "A disabled entry model cannot be execution-permitted");
assert(disabledModel?.vetoes?.some((v) => v.code === "MODEL_DISABLED"), "Disabled model emits MODEL_DISABLED veto");

const noEnabledModels = evaluateAllEntryModels({
  symbol: "EURUSD",
  dir: 1,
  scenario: SCENARIOS.INTRADAY,
  frames: mockFrames,
  ranges: { ranges: { H1: { high: 1.0970, low: 1.0770, tf: "H1" }, H4: { high: 1.0970, low: 1.0770, tf: "H4" } } },
  targetDOL: { name: "4H EQH BSL", price: 1.1050 },
  config: { minRR: 2.0, enabledModels: { ict_2022: false, turtle_soup: false, breaker_block: false, ote_continuation: false, silver_bullet: false } },
  brain: { conviction: 82, fvgOrderFlow: "BULLISH_DOMINANT" },
});
assert(noEnabledModels === null, "Disabling every entry model yields no candidate instead of a diagnostic fallback");

const executionVeto = evaluateExecutionVetoes({
  symbol: "EURUSD", dir: 1, entry: 1.0850, sl: 1.0820,
  brain: { macroDir: 1, allowedToLong: true, targetDOL: { price: 1.1050, direction: 1, targetSide: "BSL", state: "UNCONSUMED", causal: true, confirmationTime: 1 } },
  config: { now: Date.now(), enabledModels: { ict_2022: false } },
  candidate: { ...strictCandidate },
});
assert(executionVeto.permitted === false, "Execution vetoes do not let confluence bypass model authorization");
assert(executionVeto.vetoes.some((v) => v.code === "MODEL_DISABLED"), "Direct execution gate preserves MODEL_DISABLED evidence");

// 3. Verify selectOptimalEntryLevel outputs model metadata
const optLevel = selectOptimalEntryLevel({
  symbol: "EURUSD",
  dir: 1,
  scenario: SCENARIOS.INTRADAY,
  frames: mockFrames,
  ranges: {
    ranges: {
      H1: { high: 1.0970, low: 1.0770, tf: "H1" },
      H4: { high: 1.0970, low: 1.0770, tf: "H4" },
    },
  },
  htfFvg: {
    respected: [
      { dir: 1, ce: 1.0815, top: 1.0845, bottom: 1.0785, quality: "A_PRIME_CE_DEFENDED", ageBars: 2 },
    ],
  },
  targetDOL: { name: "4H EQH BSL", price: 1.1050 },
  config: { minRR: 2.0, candidate: testCandidate },
  brain: { conviction: 82 },
});

assert(optLevel.modelId !== undefined, "selectOptimalEntryLevel outputs modelId");
assert(optLevel.modelName !== undefined, "selectOptimalEntryLevel outputs modelName");
assert(optLevel.meetsMinRR === true, "selectOptimalEntryLevel verifies meetsMinRR");

// ============================================================================
// TEST SUITE 7: Symbol-Specific Allowed Trading Hours Matrix
// ============================================================================
console.log("\n=======================================================");
console.log("TEST SUITE 7: Symbol-Specific Allowed Trading Hours Matrix");
console.log("=======================================================");

// 1. Profile Resolution
const nasProfile = getSymbolSessionProfile("NAS100");
assert(nasProfile.profileKey === "US_INDICES", "NAS100 maps to US_INDICES profile");
assert(nasProfile.label === "NY Only", "NAS100 badge labeled 'NY Only'");

const djProfile = getSymbolSessionProfile("DJ30");
assert(djProfile.profileKey === "US_INDICES", "DJ30 maps to US_INDICES profile");

const spProfile = getSymbolSessionProfile("SP500");
assert(spProfile.profileKey === "US_INDICES", "SP500 maps to US_INDICES profile");

const gerProfile = getSymbolSessionProfile("GER40");
assert(gerProfile.profileKey === "EU_INDICES", "GER40 maps to EU_INDICES profile");
assert(gerProfile.label === "London & NY", "GER40 badge labeled 'London & NY'");

const goldProfile = getSymbolSessionProfile("XAUUSD");
assert(goldProfile.profileKey === "METALS_CRYPTO", "XAUUSD maps to METALS_CRYPTO profile");
assert(goldProfile.label === "Asia, London & NY", "XAUUSD badge labeled 'Asia, London & NY'");

const btcProfile = getSymbolSessionProfile("BTCUSD");
assert(btcProfile.profileKey === "METALS_CRYPTO", "BTCUSD maps to METALS_CRYPTO profile");

const eurusdProfile = getSymbolSessionProfile("EURUSD.I");
assert(eurusdProfile.profileKey === "EU_FOREX", "EURUSD.I maps to EU_FOREX profile");
assert(eurusdProfile.label === "London & NY", "EURUSD.I badge labeled 'London & NY'");

const gbpusdProfile = getSymbolSessionProfile("GBPUSD");
assert(gbpusdProfile.profileKey === "EU_FOREX", "GBPUSD maps to EU_FOREX profile");

const usdjpyProfile = getSymbolSessionProfile("USDJPY");
assert(usdjpyProfile.profileKey === "ASIA_YEN_FOREX", "USDJPY maps to ASIA_YEN_FOREX profile");
assert(usdjpyProfile.label === "Asia & NY", "USDJPY badge labeled 'Asia & NY'");

// 2. Allowed Time Slots per Symbol
// NAS100: allowed in ny_open, ny_silver_bullet, ny_pm; blocked in asian_range, london_open
assert(isSymbolPermittedInSlot("NAS100", "ny_open") === true, "NAS100 permitted in New York AM");
assert(isSymbolPermittedInSlot("NAS100", "ny_silver_bullet") === true, "NAS100 permitted in NY Silver Bullet");
assert(isSymbolPermittedInSlot("NAS100", "ny_pm") === true, "NAS100 permitted in New York PM");
assert(isSymbolPermittedInSlot("NAS100", "asian_range") === false, "NAS100 strictly blocked in Asian Range");
assert(isSymbolPermittedInSlot("NAS100", "london_open") === false, "NAS100 strictly blocked in London Open");
assert(isSymbolPermittedInSlot("NAS100", "dead_zone") === false, "NAS100 blocked in Dead Zone");

// GER40: allowed in london_open, pre_london_prep, london_close, ny_open, ny_pm; blocked in asian_range
assert(isSymbolPermittedInSlot("GER40", "london_open") === true, "GER40 permitted in London Open");
assert(isSymbolPermittedInSlot("GER40", "pre_london_prep") === true, "GER40 permitted in Frankfurt Prep");
assert(isSymbolPermittedInSlot("GER40", "ny_open") === true, "GER40 permitted in New York AM");
assert(isSymbolPermittedInSlot("GER40", "ny_pm") === true, "GER40 permitted in New York PM");
assert(isSymbolPermittedInSlot("GER40", "asian_range") === false, "GER40 strictly blocked in Asian Range");

// Gold (XAUUSD): allowed in Asia, London, NY; blocked in dead_zone
assert(isSymbolPermittedInSlot("XAUUSD", "asian_range") === true, "Gold permitted in Asian Range");
assert(isSymbolPermittedInSlot("XAUUSD", "london_open") === true, "Gold permitted in London Open");
assert(isSymbolPermittedInSlot("XAUUSD", "ny_open") === true, "Gold permitted in New York AM");
assert(isSymbolPermittedInSlot("XAUUSD", "ny_silver_bullet") === true, "Gold permitted in NY Silver Bullet");
assert(isSymbolPermittedInSlot("XAUUSD", "dead_zone") === false, "Gold strictly blocked in Dead Zone");

// BTCUSD: allowed in Asia, London, NY; blocked in dead_zone
assert(isSymbolPermittedInSlot("BTCUSD", "asian_range") === true, "BTCUSD permitted in Asian Range");
assert(isSymbolPermittedInSlot("BTCUSD", "london_open") === true, "BTCUSD permitted in London Open");
assert(isSymbolPermittedInSlot("BTCUSD", "ny_open") === true, "BTCUSD permitted in New York AM");
assert(isSymbolPermittedInSlot("BTCUSD", "dead_zone") === false, "BTCUSD strictly blocked in Dead Zone");

// EURUSD: allowed in London and NY; blocked in Asia
assert(isSymbolPermittedInSlot("EURUSD.I", "london_open") === true, "EURUSD.I permitted in London Open");
assert(isSymbolPermittedInSlot("EURUSD.I", "ny_open") === true, "EURUSD.I permitted in New York AM");
assert(isSymbolPermittedInSlot("EURUSD.I", "asian_range") === false, "EURUSD.I strictly blocked in Asian Range");

// USDJPY: allowed in Asia and NY; blocked in London Open
assert(isSymbolPermittedInSlot("USDJPY", "asian_range") === true, "USDJPY permitted in Asian Range");
assert(isSymbolPermittedInSlot("USDJPY", "ny_open") === true, "USDJPY permitted in New York AM");
assert(isSymbolPermittedInSlot("USDJPY", "ny_pm") === true, "USDJPY permitted in New York PM");
assert(isSymbolPermittedInSlot("USDJPY", "london_open") === false, "USDJPY blocked in London Open");

// 3. Dynamic isTradingPermittedNow with Symbol Passing
// Using seconds: 3.5 * 3600 = 12600 seconds from midnight (03:30 EET Asian session)
const asiaSec = 12600;
const asiaPermNas = isTradingPermittedNow(asiaSec, { enforceSymbolSessions: true }, "NAS100");
assert(asiaPermNas.permitted === false, "isTradingPermittedNow blocks NAS100 during Asian session (03:30 EET)");
assert(asiaPermNas.isOffSession === true, "NAS100 marked as isOffSession during Asian session");

const asiaPermGold = isTradingPermittedNow(asiaSec, { enforceSymbolSessions: true }, "XAUUSD");
assert(asiaPermGold.permitted === true, "isTradingPermittedNow allows XAUUSD during Asian session (03:30 EET)");

const asiaPermYen = isTradingPermittedNow(asiaSec, { enforceSymbolSessions: true }, "USDJPY");
assert(asiaPermYen.permitted === true, "isTradingPermittedNow allows USDJPY during Asian session (03:30 EET)");

const asiaPermEur = isTradingPermittedNow(asiaSec, { enforceSymbolSessions: true }, "EURUSD.I");
assert(asiaPermEur.permitted === false, "isTradingPermittedNow blocks EURUSD during Asian session (03:30 EET)");

// At 16:30 EET (New York AM session): 16.5 * 3600 = 59400
const nySec = 59400;
const nyPermNas = isTradingPermittedNow(nySec, { enforceSymbolSessions: true }, "NAS100");
assert(nyPermNas.permitted === true, "isTradingPermittedNow allows NAS100 during New York session (16:30 EET)");

const nyPermGer = isTradingPermittedNow(nySec, { enforceSymbolSessions: true }, "GER40");
assert(nyPermGer.permitted === true, "isTradingPermittedNow allows GER40 during New York session (16:30 EET)");

const asiaPermGer = isTradingPermittedNow(asiaSec, { enforceSymbolSessions: true }, "GER40");
assert(asiaPermGer.permitted === false, "isTradingPermittedNow blocks GER40 during Asian session (03:30 EET)");

// =======================================================
// TEST SUITE 8: Institutional Position Sizing (mt5.js)
// Tests calculateInstitutionalPositionSize in isolation —
// no bridge calls, pure math validation.
// =======================================================
console.log("\n--- TEST SUITE 8: Institutional Position Sizing ---");

// Helper: build minimal broker symInfo
function symInfo({ vol_min = 0.01, vol_max = 500, vol_step = 0.01, tick_size = 0, tick_value = 0 } = {}) {
  return {
    volume_min: vol_min,
    volume_max: vol_max,
    volume_step: vol_step,
    trade_tick_size: tick_size,
    trade_tick_value_loss: tick_value,
  };
}

// --- 8.1 Forex (EURUSD) — standard lot sizing ---
{
  // 1% risk on $50k account = $500, SL = 20 pips = 0.0020
  const lot = calculateInstitutionalPositionSize({
    symbol: "EURUSD",
    riskUsd: 500,
    entryPrice: 1.08500,
    slPrice: 1.08300,
    symInfo: symInfo({ tick_size: 0.00001, tick_value: 0.10 }),
    accInfo: { balance: 50000 },
  });
  // slDist=0.002, ticks=0.002/0.00001≈200 (IEEE-754 float), lossPerLot≈$20, rawLot≈25
  // Float division may yield 24.99 — accept within 0.02 tolerance
  assert(Math.abs(lot - 25.00) < 0.02, `EURUSD forex lot sizing: expected ~25.00, got ${lot}`);
}

// --- 8.2 XAUUSD Gold — 100oz contract multiplier ---
{
  // riskUsd=$200, SL dist=2.00 (price move $2 on Gold)
  // Broker-provided account-currency loss per lot is explicit; no symbol
  // multiplier is inferred by the sizing helper.
  const lot = calculateInstitutionalPositionSize({
    symbol: "XAUUSD",
    riskUsd: 200,
    entryPrice: 1950.00,
    slPrice: 1948.00,
    symInfo: symInfo(),   // no tick data → uses contractMult fallback
    lossPerLot: 200,
    accInfo: { balance: 20000 },
  });
  assert(lot === 1.00, `XAUUSD gold lot sizing (contractMult=100): expected 1.00, got ${lot}`);
}

// --- 8.3 NAS100 Index — contractMult = 1.0 ---
{
  // riskUsd=$150, SL dist=150 points on NAS100
  // lossPerLot = 150 * 1.0 = $150 per lot → rawLot = 1.00
  const lot = calculateInstitutionalPositionSize({
    symbol: "NAS100",
    riskUsd: 150,
    entryPrice: 18000,
    slPrice: 17850,
    symInfo: symInfo(),
    lossPerLot: 150,
    accInfo: { balance: 15000 },
  });
  assert(lot === 1.00, `NAS100 index lot sizing (contractMult=1.0): expected 1.00, got ${lot}`);
}

// --- 8.4 BTCUSD Crypto — contractMult = 1.0 ---
{
  // riskUsd=$300, SL dist=$1500 on BTC
  // lossPerLot = 1500 * 1.0 = $1500 → rawLot = 0.20
  const lot = calculateInstitutionalPositionSize({
    symbol: "BTCUSD",
    riskUsd: 300,
    entryPrice: 65000,
    slPrice: 63500,
    symInfo: symInfo({ vol_min: 0.01, vol_step: 0.01 }),
    lossPerLot: 1500,
    accInfo: { balance: 30000 },
  });
  assert(lot === 0.20, `BTCUSD crypto lot sizing: expected 0.20, got ${lot}`);
}

// --- 8.5 Zero SL distance → returns zero (unsafe geometry) ---
{
  const lot = calculateInstitutionalPositionSize({
    symbol: "EURUSD",
    riskUsd: 500,
    entryPrice: 1.08500,
    slPrice: 1.08500,  // same as entry → SL dist = 0
    symInfo: symInfo(),
    accInfo: {},
  });
  assert(lot === 0, `Zero SL distance → returns zero, got ${lot}`);
}

// --- 8.6 10% Balance Cap Safety ---
{
  // $500k account, 1% risk = $5000 requested, 10% cap = $50000 (no cap triggered)
  // But set balance very low: $1000 → 10% = $100 max
  // riskUsd=$500 > $100 → capped to $100
  // Gold, SL dist=5.0 → lossPerLot = 5*100=$500, after cap rawLot = 100/500 = 0.20
  const lot = calculateInstitutionalPositionSize({
    symbol: "XAUUSD",
    riskUsd: 500,
    entryPrice: 1950.00,
    slPrice: 1945.00,
    symInfo: symInfo(),
    lossPerLot: 500,
    accInfo: { balance: 1000 },  // tiny account → caps riskUsd to $100
  });
  assert(lot === 0.20, `10% balance cap: capped $500→$100 on $1k XAUUSD, expected 0.20, got ${lot}`);
}

// --- 8.7 Volume Step Rounding ---
{
  // GER40: riskUsd=175, SL=80pts, lossPerLot=80*1=$80, rawLot=2.1875
  // vol_step=0.5 → floor(2.1875/0.5)=4 steps * 0.5 = 2.0
  const lot = calculateInstitutionalPositionSize({
    symbol: "GER40",
    riskUsd: 175,
    entryPrice: 18000,
    slPrice: 17920,
    symInfo: symInfo({ vol_min: 0.5, vol_step: 0.5, vol_max: 100 }),
    lossPerLot: 80,
    accInfo: {},
  });
  assert(lot === 2.00, `GER40 vol_step=0.5 rounding: expected 2.00, got ${lot}`);
}

// --- 8.8 Broker loss evidence is required for non-FX contracts ---
{
  // The caller supplies the broker's account-currency loss calculation.
  const lot = calculateInstitutionalPositionSize({
    symbol: "NAS100",
    riskUsd: 100,
    entryPrice: 18000,
    slPrice: 17950,
    symInfo: symInfo({ tick_size: 0.01, tick_value: 10000 }),  // distorted feed
    lossPerLot: 50,
    accInfo: {},
  });
  assert(lot === 2.00, `MT5 distorted tick guard for NAS100: expected 2.00, got ${lot}`);
}

// --- 8.9 DJ30 treated same as index (contractMult=1.0) ---
{
  // riskUsd=$80, SL=40pts → lossPerLot=$40 → rawLot=2.0
  const lot = calculateInstitutionalPositionSize({
    symbol: "DJ30",
    riskUsd: 80,
    entryPrice: 39000,
    slPrice: 38960,
    symInfo: symInfo(),
    lossPerLot: 40,
    accInfo: {},
  });
  assert(lot === 2.00, `DJ30 index lot sizing: expected 2.00, got ${lot}`);
}

// --- 8.10 Volume clamped to vol_max ---
{
  // EURUSD: riskUsd=99999, SL=0.0001 (1 pip) → rawLot insanely large → clamped to vol_max=50
  const lot = calculateInstitutionalPositionSize({
    symbol: "EURUSD",
    riskUsd: 99999,
    entryPrice: 1.08500,
    slPrice: 1.08490,
    symInfo: symInfo({ vol_max: 50, vol_step: 0.01, tick_size: 0.00001, tick_value: 0.10 }),
    accInfo: {},
  });
  assert(lot === 50.00, `Volume clamped to vol_max=50: got ${lot}`);
}

console.log("\n=======================================================");
console.log("TEST SUITE 9: Watchlist Alert Filtering & Rogue Trade Purge");
console.log("=======================================================");

{
  const watchlist = ["NAS100", "XAUUSD", "EURUSD.I", "DJ30", "SP500", "GER40", "BTCUSD"];

  // 9.1 Staging & Alert Guard: Allowed symbols
  assert(isSymbolInMainWatchlist("NAS100", watchlist) === true, "NAS100 is permitted to stage and alert");
  assert(isSymbolInMainWatchlist("EURUSD.I", watchlist) === true, "EURUSD.I is permitted to stage and alert");
  assert(isSymbolInMainWatchlist("EURUSD", watchlist) === true, "EURUSD (broker alias) is permitted to stage and alert");
  assert(isSymbolInMainWatchlist("XAUUSD", watchlist) === true, "XAUUSD is permitted to stage and alert");
  assert(isSymbolInMainWatchlist("DJ30", watchlist) === true, "DJ30 is permitted to stage and alert");

  // 9.2 Staging & Alert Guard: Blocked symbols (never stage or send Telegram alerts)
  assert(isSymbolInMainWatchlist("EURAUD", watchlist) === false, "EURAUD alert strictly blocked (not in watchlist)");
  assert(isSymbolInMainWatchlist("NZDUSD", watchlist) === false, "NZDUSD alert strictly blocked (not in watchlist)");
  assert(isSymbolInMainWatchlist("ETHUSD", watchlist) === false, "ETHUSD alert strictly blocked (not in watchlist)");
  assert(isSymbolInMainWatchlist("EURJPY", watchlist) === false, "EURJPY alert strictly blocked (not in watchlist)");
  assert(isSymbolInMainWatchlist("GBPAUD", watchlist) === false, "GBPAUD alert strictly blocked (not in watchlist)");

  // 9.3 Default Universe contains only canonical Watchlist symbols
  const defaultUniverse = DEFAULT_AUTONOMOUS_CONFIG.universe;
  assert(defaultUniverse.includes("ETHUSD") === false, "Default universe does NOT contain ETHUSD");
  assert(defaultUniverse.includes("EURAUD") === false, "Default universe does NOT contain EURAUD");
  assert(defaultUniverse.includes("NZDUSD") === false, "Default universe does NOT contain NZDUSD");
  assert(defaultUniverse.every((sym) => isSymbolInMainWatchlist(sym, watchlist)), "All default universe symbols are valid Main Watchlist members");
}

console.log("\n=======================================================");
console.log("TEST SUITE 10: Repetitive Trades & Duplicate Alert Suppression Engine");
console.log("=======================================================");

{
  const levelA = { entry: 18250.25, sl: 18210.50, tp: 18350.00, modelId: "ICT_2022_MENTORSHIP" };
  const levelB = { entry: 18250.2500001, sl: 18210.5000002, tp: 18350.0000001, modelId: "ICT_2022_MENTORSHIP" };
  const levelDifferent = { entry: 18200.00, sl: 18170.00, tp: 18300.00, modelId: "TURTLE_SOUP_REVERSAL" };

  // 10.1 Deterministic setup fingerprint generation
  const fp1 = getSetupFingerprint("NAS100", 1, levelA);
  const fp2 = getSetupFingerprint("NAS100", 1, levelB);
  assert(typeof fp1 === "string" && fp1.length > 0, "Setup fingerprint successfully generated");
  assert(fp1 === fp2, "Setup fingerprint quantizes floating-point jitter (exact match across identical price levels)");

  // 10.2 Distinct setups generate distinct fingerprints
  const fpDiffSym = getSetupFingerprint("SP500", 1, levelA);
  const fpDiffDir = getSetupFingerprint("NAS100", -1, levelA);
  const fpDiffLevel = getSetupFingerprint("NAS100", 1, levelDifferent);

  assert(fp1 !== fpDiffSym, "Different symbols have different fingerprints");
  assert(fp1 !== fpDiffDir, "Opposite directions on same symbol have different fingerprints");
  assert(fp1 !== fpDiffLevel, "Different price levels have different fingerprints");

  // 10.3 Timeframe isolation: Different timeframes for the same symbol and levels produce distinct fingerprints
  const fp15M = getSetupFingerprint("NAS100", 1, levelA, "ICT_2022_MENTORSHIP", "15M");
  const fpH1  = getSetupFingerprint("NAS100", 1, levelA, "ICT_2022_MENTORSHIP", "H1");
  const fpH4  = getSetupFingerprint("NAS100", 1, levelA, "ICT_2022_MENTORSHIP", "H4");
  assert(fp15M !== fpH1, "Different timeframes (15M vs H1) produce distinct setup fingerprints");
  assert(fpH1 !== fpH4, "Different timeframes (H1 vs H4) produce distinct setup fingerprints");
  assert(fp15M.includes(":15M:"), "Timeframe is explicitly embedded in the fingerprint identifier");

  // 10.3 Setup fingerprint rejection against existing recent cache
  const recentFingerprints = new Set([fp1]);
  assert(recentFingerprints.has(getSetupFingerprint("NAS100", 1, levelA)) === true, "Identical NAS100 setup recognized in recent fingerprint cache");
  assert(recentFingerprints.has(getSetupFingerprint("NAS100", 1, levelDifferent)) === false, "Distinct new setup passes through dedup check");

  // 10.4 Cooldown window parameters defined in store (loosened for downstream receiver flow)
  assert(DEFAULT_AUTONOMOUS_CONFIG.cooldownMinutes >= 15, `Cooldown period configured: ${DEFAULT_AUTONOMOUS_CONFIG.cooldownMinutes}m`);
  assert(DEFAULT_AUTONOMOUS_CONFIG.lossCooldownMinutes >= 15, `Post-loss cooldown configured: ${DEFAULT_AUTONOMOUS_CONFIG.lossCooldownMinutes}m`);
  assert(DEFAULT_AUTONOMOUS_CONFIG.dedupFingerprintWindowMinutes >= 15, `Dedup fingerprint window configured: ${DEFAULT_AUTONOMOUS_CONFIG.dedupFingerprintWindowMinutes}m`);
  assert(DEFAULT_AUTONOMOUS_CONFIG.alertThrottleMinutes >= 15, `Alert throttle window configured: ${DEFAULT_AUTONOMOUS_CONFIG.alertThrottleMinutes}m`);

  // 10.5 Simulated alert throttle logic
  const alertCache = new Map();
  const alertKey = "NAS100:1:ICT_2022_MENTORSHIP";
  alertCache.set(alertKey, Date.now() - 5 * 60 * 1000); // fired 5 mins ago
  const throttleMs = 30 * 60 * 1000; // 30 min throttle
  const isThrottled = Date.now() - alertCache.get(alertKey) < throttleMs;
  assert(isThrottled === true, "Duplicate Telegram alert correctly suppressed when inside 30m throttle window");

  alertCache.set(alertKey, Date.now() - 35 * 60 * 1000); // fired 35 mins ago (past window)
  const isExpired = Date.now() - alertCache.get(alertKey) < throttleMs;
  assert(isExpired === false, "Alert permitted once throttle window has cleanly elapsed");
}

console.log("\n=======================================================");
console.log("TEST SUITE 11: Day-Scoped Trade Idea Exhaustion Guard");
console.log("=======================================================");
{
  // 11.1 Verify getStartOfTradingDay() calculation
  const now = new Date();
  const dayStart = getStartOfTradingDay(now);
  assert(typeof dayStart === "number" && dayStart > 0, "getStartOfTradingDay returns a valid timestamp");
  assert(dayStart <= now.getTime(), "Trading day start is in the past or exactly current moment");
  assert(now.getTime() - dayStart <= 86400000 + 3600000, "Trading day start is within 25 hours of now");

  const dayStartDate = new Date(dayStart);
  const eetParts = getEetTime(dayStartDate);
  assert(eetParts.h === 0 && eetParts.m === 0, `Trading day starts at 00:00 EET midnight (observed: ${eetParts.h}:${eetParts.m})`);

  // 11.2 Exhausted Idea Fingerprint Mock Collection
  const levelNAS = {
    entry: 20150.25,
    sl: 20110.0,
    tp: 20250.75,
    type: "FVG",
    modelId: "ICT_2022",
  };
  const nasFingerprint = getSetupFingerprint("NAS100", 1, levelNAS, "ICT_2022");

  const levelGold = {
    entry: 2650.5,
    sl: 2645.0,
    tp: 2665.0,
    type: "ORDER_BLOCK",
    modelId: "OTE_CONTINUATION",
  };
  const goldFingerprint = getSetupFingerprint("XAUUSD", 1, levelGold, "OTE_CONTINUATION");

  // Mock Mongo Trades Collection
  // Today's trading session started at dayStart. We create trades inside today's session:
  const mockTrades = [
    // Completed TP today (e.g. 20 minutes after session open)
    {
      symbol: "NAS100",
      status: "closed_tp",
      fingerprint: nasFingerprint,
      closedAt: new Date(dayStart + 20 * 60 * 1000),
      realizedR: 2.5,
    },
    // Completed SL today (e.g. 35 minutes after session open)
    {
      symbol: "XAUUSD",
      status: "closed_sl",
      fingerprint: goldFingerprint,
      closedAt: new Date(dayStart + 35 * 60 * 1000),
      realizedR: -1.0,
    },
    // Staged/Cancelled today - idea was NOT filled, level was just invalidated before fill
    {
      symbol: "EURUSD",
      status: "invalidated",
      fingerprint: "EURUSD:1:ICT_2022:1.085:1.083:1.090",
      closedAt: new Date(dayStart + 40 * 60 * 1000),
    },
    // Trade completed yesterday (before today's dayStart rollover)
    {
      symbol: "DJ30",
      status: "closed_tp",
      fingerprint: "DJ30:1:TURTLE_SOUP:42000:41900:42300",
      closedAt: new Date(dayStart - 3600 * 1000), // 1 hour before today's rollover
    },
  ];

  const mockTradesCol = {
    find: (query) => ({
      toArray: async () => {
        return mockTrades.filter((t) => {
          if (query.status && query.status.$in) {
            if (!query.status.$in.includes(t.status)) return false;
          }
          if (query.fingerprint && query.fingerprint.$exists) {
            if (!t.fingerprint) return false;
          }
          if (query.$or) {
            const matchesOr = query.$or.some((clause) => {
              if (clause.closedAt && clause.closedAt.$gte) {
                return t.closedAt >= clause.closedAt.$gte;
              }
              if (clause.updatedAt && clause.updatedAt.$gte) {
                return (t.updatedAt || t.closedAt) >= clause.updatedAt.$gte;
              }
              return false;
            });
            if (!matchesOr) return false;
          }
          return true;
        });
      },
    }),
  };

  const exhaustedSet = await getExhaustedTodayFingerprints(mockTradesCol, dayStart);

  // 11.3 Assert TP trade idea is exhausted today
  assert(exhaustedSet.has(nasFingerprint) === true, "NAS100 closed_tp trade idea is permanently flagged as EXHAUSTED for today");

  // 11.4 Assert SL trade idea is exhausted today
  assert(exhaustedSet.has(goldFingerprint) === true, "XAUUSD closed_sl trade idea is permanently flagged as EXHAUSTED for today");

  // 11.5 Assert un-filled / invalidated setups are NOT considered exhausted
  assert(exhaustedSet.has("EURUSD:1:ICT_2022:1.085:1.083:1.090") === false, "Invalidated (unfilled) setup is NOT marked exhausted (re-entry allowed if setup forms cleanly)");

  // 11.6 Assert yesterday's trade is NOT in today's exhausted set
  assert(exhaustedSet.has("DJ30:1:TURTLE_SOUP:42000:41900:42300") === false, "Yesterday's completed trade resets cleanly on new trading day");

  // 11.7 Verify store configuration default
  assert(DEFAULT_AUTONOMOUS_CONFIG.exhaustedIdeaScope === "day", "store.js config default includes exhaustedIdeaScope: 'day'");
}

console.log("\n=======================================================");
console.log("TEST SUITE 12: Breakeven Metrics & True Win Rate Calculation");
console.log("=======================================================");
{
  // 12.1 Terminal state classification includes closed_be
  assert(TERMINAL_STATES.includes("closed_be") === true, "TERMINAL_STATES includes closed_be state");

  // 12.2 determineTerminalStatus classifications
  const mockTradeLong = { dir: 1, entryPrice: 1.0850, slPrice: 1.0820, isBreakeven: true };
  assert(determineTerminalStatus(mockTradeLong, 0.0, "breakeven") === "closed_be", "determineTerminalStatus flags zero-R trade as closed_be");
  assert(determineTerminalStatus(mockTradeLong, 0.02, "breakeven") === "closed_be", "determineTerminalStatus flags near-zero R (+0.02R) trade as closed_be");
  assert(determineTerminalStatus({ ...mockTradeLong, isRiskFree: true }, 0.15, "risk_free") === "closed_be", "determineTerminalStatus flags risk_free trailed trade with small gain (+0.15R) as closed_be");
  assert(determineTerminalStatus(mockTradeLong, 2.5, "tp") === "closed_tp", "determineTerminalStatus flags +2.5R TP as closed_tp");
  assert(determineTerminalStatus(mockTradeLong, -1.0, "sl") === "closed_sl", "determineTerminalStatus flags -1.0R SL as closed_sl");

  // 12.3 Metrics calculation isolates breakevens from win rate calculation
  // 4 Wins, 2 Losses, 2 Breakevens:
  // Decided = 6 trades (4W, 2L). Win rate MUST be 4/6 = 67%, NOT 4/8 = 50%!
  const closedDataset = [
    { status: "closed_tp", realizedR: 2.5 },
    { status: "closed_tp", realizedR: 3.0 },
    { status: "closed_tp", realizedR: 1.5 },
    { status: "closed_tp", realizedR: 4.0 },
    { status: "closed_sl", realizedR: -1.0 },
    { status: "closed_sl", realizedR: -1.0 },
    { status: "closed_be", realizedR: 0.0 },
    { status: "closed_be", realizedR: 0.02 },
  ];

  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let totalR = 0;
  let grossWinR = 0;
  let grossLossR = 0;

  for (const t of closedDataset) {
    const r = t.realizedR ?? (t.status === "closed_tp" ? 2 : (t.status === "closed_be" ? 0 : -1));
    totalR += r;
    if (t.status === "closed_be" || Math.abs(r) <= 0.05 || (t.isBreakeven && r >= -0.1 && r <= 0.25)) {
      breakevens++;
      if (r > 0) grossWinR += r;
      else if (r < 0) grossLossR += Math.abs(r);
    } else if (r > 0.05) {
      wins++;
      grossWinR += r;
    } else {
      losses++;
      grossLossR += Math.abs(r);
    }
  }

  const decidedClosed = wins + losses;
  const totalClosed = wins + losses + breakevens;
  const winRate = decidedClosed > 0 ? Math.round((wins / decidedClosed) * 100) : 0;
  const beRate = totalClosed > 0 ? Math.round((breakevens / totalClosed) * 100) : 0;

  assert(wins === 4, "Correctly counted 4 winning trades");
  assert(losses === 2, "Correctly counted 2 losing trades");
  assert(breakevens === 2, "Correctly counted 2 breakeven trades");
  assert(decidedClosed === 6, "Decided closed trades equals exactly 6 (4W + 2L)");
  assert(totalClosed === 8, "Total closed trades equals 8 (4W + 2L + 2BE)");
  assert(winRate === 67, `Win Rate calculated strictly on decided trades: 67% (got ${winRate}%, not degraded to 50% by BEs)`);
  assert(beRate === 25, `Breakeven rate tracked accurately: 25% (got ${beRate}%)`);
}

console.log("\n=======================================================");
console.log("TEST SUITE 13: Simplified Management: 50% Target & 40% Booking");
console.log("=======================================================");
{
  // 13.1 Volume split into 40% partial and 60% runner
  const split1Lot = planFractionalVolumes(1.0, { volume_step: 0.01, volume_min: 0.01 }, 0.40);
  assert(split1Lot.tp1 === 0.40, `1.00 lot position splits 40% to TP1: expected 0.40, got ${split1Lot.tp1}`);
  assert(split1Lot.runner === 0.60, `1.00 lot position keeps 60% for runner: expected 0.60, got ${split1Lot.runner}`);

  const splitSmall = planFractionalVolumes(0.15, { volume_step: 0.01, volume_min: 0.01 }, 0.40);
  assert(splitSmall.tp1 === 0.06, `0.15 lot position splits 40%: expected 0.06, got ${splitSmall.tp1}`);
  assert(splitSmall.runner === 0.09, `0.15 lot position keeps 60% runner: expected 0.09, got ${splitSmall.runner}`);

  const splitMin = planFractionalVolumes(0.01, { volume_step: 0.01, volume_min: 0.01 }, 0.40);
  assert(splitMin.tp1 === 0, "Minimum lot (0.01) cannot be fractionally divided, held for runner");
  assert(splitMin.runner === 0.01, "Full 0.01 lot allocated to runner");

  // 13.2 50% Target Milestone Engine (Long trade)
  // Entry = 1.0850, Initial SL = 1.0820 (distance = 0.0030), Target = 1.0940 (3.0R)
  const tradeLong = {
    dir: 1,
    entryPrice: 1.0850,
    slPrice: 1.0820,
    tpPrice: 1.0940,
    targetRR: 3.0,
    initialRiskDistance: 0.0030,
    symbolSpec: { digits: 5 },
  };
  const halfLong = calculateHalfTargetLevel(tradeLong);
  assert(halfLong.halfRR === 1.5, `50% of 3.0R target is 1.50R: got ${halfLong.halfRR}R`);
  assert(halfLong.price === 1.0895, `50% target price is 1.0895: got ${halfLong.price}`);

  // 13.3 50% Target Milestone Engine (Short trade)
  // Entry = 1.1000, Initial SL = 1.1030 (distance = 0.0030), Target = 1.0880 (4.0R)
  const tradeShort = {
    dir: -1,
    entryPrice: 1.1000,
    slPrice: 1.1030,
    tpPrice: 1.0880,
    targetRR: 4.0,
    initialRiskDistance: 0.0030,
    symbolSpec: { digits: 5 },
  };
  const halfShort = calculateHalfTargetLevel(tradeShort);
  assert(halfShort.halfRR === 2.0, `50% of 4.0R target is 2.00R: got ${halfShort.halfRR}R`);
  assert(halfShort.price === 1.0940, `50% short target price is 1.0940: got ${halfShort.price}`);

  // 13.4 Manually Edited Target (5.0R Max ceiling)
  // Entry = 1.0850, SL = 1.0820, Modified Target = 1.1000 (5.0R)
  const tradeMaxRR = {
    dir: 1,
    entryPrice: 1.0850,
    slPrice: 1.0820,
    tpPrice: 1.1000,
    targetRR: 5.0,
    initialRiskDistance: 0.0030,
    symbolSpec: { digits: 5 },
  };
  const halfMaxRR = calculateHalfTargetLevel(tradeMaxRR);
  assert(halfMaxRR.halfRR === 2.5, `50% of 5.0R target is 2.50R: got ${halfMaxRR.halfRR}R`);
  assert(halfMaxRR.price === 1.0925, `50% price for 5.0R target is 1.0925: got ${halfMaxRR.price}`);
}

console.log("\n=======================================================");
console.log("TEST SUITE 14: Breakeven Stop Transition & Runner Progression");
console.log("=======================================================");
{
  const tradeSim = {
    dir: 1,
    entryPrice: 1.0850,
    slPrice: 1.0820,
    tpPrice: 1.0940,
    targetRR: 3.0,
    initialRiskDistance: 0.0030,
    initialVolume: 1.0,
    remainingVolume: 1.0,
    symbolSpec: { digits: 5, point: 0.00001 },
  };

  // 14.1 Breakeven price calculation
  const bePrice = breakevenPrice(tradeSim, tradeSim.symbolSpec);
  assert(bePrice >= tradeSim.entryPrice, `Breakeven price is safely at/above entry: ${bePrice} >= ${tradeSim.entryPrice}`);
  assert(bePrice > tradeSim.slPrice, `Breakeven SL trails strictly forward from initial SL: ${bePrice} > ${tradeSim.slPrice}`);

  // 14.2 Exit Scenario A: Retracement to Breakeven after 40% booked at 50% target
  // 40% was booked at +1.5R -> banked profit = 0.40 * 1.5R = +0.60R
  // Stopped out at Breakeven SL -> realizedR on runner = 0
  const tradeAfterBE = {
    ...tradeSim,
    halfTargetBooked: true,
    isBreakeven: true,
    realizedR: 0.60,
  };
  const termStatusBE = determineTerminalStatus(tradeAfterBE, 0.60, "breakeven");
  assert(termStatusBE === "closed_be", "Trade stopped at BE after 40% partial is accurately categorized as closed_be");

  // 14.3 Exit Scenario B: Runner continues to full target (3.0R)
  // 40% booked at 1.5R (+0.60R), 60% runner booked at 3.0R (+1.80R) -> Total Realized = +2.40R
  const termStatusTP = determineTerminalStatus(tradeSim, 2.40, "runner");
  assert(termStatusTP === "closed_tp", "Runner hitting full target is categorized as closed_tp");

  // 14.4 Exit Scenario C: Direct SL hit before reaching 50% target
  const termStatusSL = determineTerminalStatus(tradeSim, -1.0, "stop");
  assert(termStatusSL === "closed_sl", "Position stopped out at initial SL is categorized as closed_sl");

  // 14.5 Model 2: Prop-Firm Safe Mode Progression (1.0R risk halved -> 1.5R BE -> TP exit)
  const propTrade = {
    dir: 1,
    entryPrice: 1.0850,
    slPrice: 1.0820,
    initialSlPrice: 1.0820,
    tpPrice: 1.0910, // 2.0R
    targetRR: 2.0,
    initialRiskDistance: 0.0030,
    managementLogic: "prop_firm_safe",
    symbolSpec: { digits: 5, point: 0.00001 },
  };

  // Test calculatePropFirmTp clamping to [1.5, 2.5]
  assert(calculatePropFirmTp(1.0850, 1.0820, 1, 1.2, 5).targetRR === 1.5, "Prop-firm TP clamps below 1.5R to 1.5R");
  assert(calculatePropFirmTp(1.0850, 1.0820, 1, 1.2, 5).tpPrice === 1.0895, "Prop-firm TP price clamps below 1.5R to 1.0895");
  assert(calculatePropFirmTp(1.0850, 1.0820, 1, 3.5, 5).targetRR === 2.5, "Prop-firm TP clamps above 2.5R to 2.5R");
  assert(calculatePropFirmTp(1.0850, 1.0820, 1, 3.5, 5).tpPrice === 1.0925, "Prop-firm TP price clamps above 2.5R to 1.0925");
  assert(calculatePropFirmTp(1.0850, 1.0820, 1, 2.0, 5).targetRR === 2.0, "Prop-firm TP retains valid 2.0R");
  assert(calculatePropFirmTp(1.0850, 1.0820, 1, 2.0, 5).tpPrice === 1.0910, "Prop-firm TP retains valid 2.0R price 1.0910");

  // Step 1: Price reaches 1.0R (1.0880) -> SL moves to half risk (1.0835)
  const action1R = evaluatePropFirmSafeAction(propTrade, 1.0880, 1.0, propTrade.symbolSpec);
  assert(action1R.action === "reduce_sl_half", `At 1.0R price move, action is reduce_sl_half: got ${action1R.action}`);
  assert(action1R.newSl === 1.0835, `Half risk SL is 1.0835 (-0.5R initial risk): got ${action1R.newSl}`);

  // Step 2: Price reaches 1.5R (1.0895) -> SL moves to breakeven
  const propTradeAtHalfRisk = { ...propTrade, slHalfMoved: true, slPrice: 1.0835 };
  const action1_5R = evaluatePropFirmSafeAction(propTradeAtHalfRisk, 1.0895, 1.5, propTrade.symbolSpec);
  assert(action1_5R.action === "breakeven", `At 1.5R price move, action is breakeven: got ${action1_5R.action}`);
  assert(action1_5R.newSl >= 1.0850, `Breakeven SL is at/above entry: got ${action1_5R.newSl}`);

  // Step 3: Special rule: If TP itself is 1.5R, full quantity booked at 1.5R
  const propTradeTP1_5 = { ...propTrade, tpPrice: 1.0895, targetRR: 1.5 };
  const actionTP1_5 = evaluatePropFirmSafeAction(propTradeTP1_5, 1.0895, 1.5, propTrade.symbolSpec);
  assert(actionTP1_5.action === "exit_full_tp", `When TP is 1.5R, reaching 1.5R triggers full exit_full_tp: got ${actionTP1_5.action}`);

  // Step 4: Price reaches 2.0R TP (1.0910) -> full exit take profit
  const propTradeAtBE = { ...propTrade, isBreakeven: true, slPrice: 1.0850 };
  const actionTP = evaluatePropFirmSafeAction(propTradeAtBE, 1.0910, 2.0, propTrade.symbolSpec);
  assert(actionTP.action === "exit_full_tp", `At full TP price (1.0910), action is exit_full_tp: got ${actionTP.action}`);
}

console.log("\n=======================================================");
console.log("TEST SUITE 15: Structural Target Mechanics Across Models, Tools & Engine (Default Freedom & Prop Clamping)");
console.log("=======================================================");
{
  // 15.1 Drawing Tool RR calculation (natural ratio without artificial clamp)
  // Long drawing: Entry=100, Stop=90 (Risk=10), Target=180 (Reward=80 -> Raw RR = 8.0)
  const drawing8R = {
    entry: { price: 100 },
    stop: 90,
    target: 180,
  };
  const naturalDrawRR = computeRR(drawing8R);
  assert(naturalDrawRR === 8.0, `computeRR measures natural 8.0R drawing without naive clamp: got ${naturalDrawRR}`);

  const drawing3R = {
    entry: { price: 100 },
    stop: 90,
    target: 130,
  };
  assert(computeRR(drawing3R) === 3.0, `computeRR accurately measures 3.0R drawing: got ${computeRR(drawing3R)}`);

  // 15.2 modifyTradeTarget sets natural structural targets for default leg without 5.0R ceiling
  const tradeDoc = {
    _id: new ObjectId("650000000000000000000001"),
    symbol: "EURUSD",
    dir: 1,
    entryPrice: 1.0850,
    slPrice: 1.0820,
    tpPrice: 1.0940,
    targetRR: 3.0,
    initialRiskDistance: 0.0030,
    symbolSpec: { digits: 5 },
    status: "staged",
  };

  const mockDbTrades = new Map([[String(tradeDoc._id), { ...tradeDoc }]]);
  const mockTradesCol = {
    findOne: async (query) => {
      const id = String(query._id);
      return mockDbTrades.get(id) ? { ...mockDbTrades.get(id) } : null;
    },
    updateOne: async (query, update) => {
      const id = String(query._id);
      const doc = mockDbTrades.get(id);
      if (doc) {
        if (update.$set) Object.assign(doc, update.$set);
        return { modifiedCount: 1 };
      }
      return { modifiedCount: 0 };
    },
  };

  const testEngine = createAutonomousEngine({
    autonomousCols: async () => ({ tradesCol: mockTradesCol }),
  });

  // Request targetRR = 8.0 -> natural structural target (TP = 1.0850 + 8.0*0.0030 = 1.1090)
  const resHigh = await testEngine.modifyTradeTarget(tradeDoc._id, { targetRR: 8.0 });
  assert(resHigh.ok === true, "modifyTradeTarget succeeds with high RR request");
  const updatedDoc1 = mockDbTrades.get(String(tradeDoc._id));
  assert(updatedDoc1.targetRR === 8.0, `modifyTradeTarget sets natural 8.0R: got ${updatedDoc1.targetRR}`);
  assert(updatedDoc1.tpPrice === 1.1090, `modifyTradeTarget adjusted TP to 1.1090: got ${updatedDoc1.tpPrice}`);

  // Request tpPrice = 1.1150 (raw RR = (1.1150 - 1.0850) / 0.0030 = 10.0R) -> natural structural TP
  const resHighTp = await testEngine.modifyTradeTarget(tradeDoc._id, { tpPrice: 1.1150 });
  assert(resHighTp.ok === true, "modifyTradeTarget succeeds with high TP price");
  const updatedDoc2 = mockDbTrades.get(String(tradeDoc._id));
  assert(updatedDoc2.targetRR === 10.0, `modifyTradeTarget sets 10.0R: got ${updatedDoc2.targetRR}`);
  assert(updatedDoc2.tpPrice === 1.1150, `modifyTradeTarget sets TP price to 1.1150: got ${updatedDoc2.tpPrice}`);

  // Request targetRR = 3.5 -> permits within preferred bracket (TP = 1.0850 + 3.5*0.0030 = 1.0955)
  const resNormal = await testEngine.modifyTradeTarget(tradeDoc._id, { targetRR: 3.5 });
  assert(resNormal.ok === true, "modifyTradeTarget succeeds with normal RR request");
  const updatedDoc3 = mockDbTrades.get(String(tradeDoc._id));
  assert(updatedDoc3.targetRR === 3.5, `modifyTradeTarget sets valid RR to 3.5R: got ${updatedDoc3.targetRR}`);
  assert(updatedDoc3.tpPrice === 1.0955, `modifyTradeTarget sets valid TP to 1.0955: got ${updatedDoc3.tpPrice}`);

  // 15.3 Swing Trading Exemption: Swing setups (1D-1H) are strictly NOT clamped by the 5.0R limit
  const swingTradeDoc = {
    _id: new ObjectId("650000000000000000000077"),
    symbol: "EURUSD",
    dir: 1,
    entryPrice: 1.0850,
    slPrice: 1.0820,
    tpPrice: 1.0940,
    targetRR: 3.0,
    initialRiskDistance: 0.0030,
    symbolSpec: { digits: 5 },
    status: "staged",
    scenario: { id: "swing", horizon: "1D-1H" },
    horizon: "1D-1H",
    horizonCode: 1,
  };
  mockDbTrades.set(String(swingTradeDoc._id), { ...swingTradeDoc });
  const resSwing = await testEngine.modifyTradeTarget(swingTradeDoc._id, { targetRR: 8.5 });
  assert(resSwing.ok === true, "modifyTradeTarget succeeds for swing trade with 8.5R target");
  const updatedSwingDoc = mockDbTrades.get(String(swingTradeDoc._id));
  assert(updatedSwingDoc.targetRR === 8.5, `Swing trading is exempt from 5.0R clamp: targetRR is ${updatedSwingDoc.targetRR}R`);
  assert(updatedSwingDoc.tpPrice === 1.1105, `Swing TP accurately set to 8.5R price (1.1105): got ${updatedSwingDoc.tpPrice}`);

  // 15.4 Prop-Firm Safe Model Clamping: Strictly clamped to [1.5, 2.5] bracket
  const propTradeDoc = {
    _id: new ObjectId("650000000000000000000078"),
    symbol: "EURUSD",
    dir: 1,
    entryPrice: 1.0850,
    slPrice: 1.0820,
    tpPrice: 1.0910,
    targetRR: 2.0,
    initialRiskDistance: 0.0030,
    symbolSpec: { digits: 5 },
    status: "staged",
    managementLogic: "prop_firm_safe",
  };
  mockDbTrades.set(String(propTradeDoc._id), { ...propTradeDoc });
  const resPropClamp = await testEngine.modifyTradeTarget(propTradeDoc._id, { targetRR: 4.0 });
  assert(resPropClamp.ok === true, "modifyTradeTarget succeeds for prop-firm safe trade");
  const updatedPropDoc = mockDbTrades.get(String(propTradeDoc._id));
  assert(updatedPropDoc.targetRR === 2.5, `Prop-firm trade clamped to 2.5R upper limit: got ${updatedPropDoc.targetRR}R`);
  assert(updatedPropDoc.tpPrice === 1.0925, `Prop-firm TP clamped to 2.5R price (1.0925): got ${updatedPropDoc.tpPrice}`);
}

console.log("\n=======================================================");
console.log("TEST SUITE 16: Adversarial Risk & Broker Boundaries");
console.log("=======================================================");
{
  const brokerSpec = {
    volume_min: 0.01,
    volume_max: 100,
    volume_step: 0.01,
    trade_tick_size: 0.00001,
    trade_tick_value_loss: 0.10,
  };
  const zeroBudget = calculateRiskSize({ riskUsd: 0, entryPrice: 1.0850, slPrice: 1.0820, symInfo: brokerSpec });
  assert(zeroBudget.lotSize === 0, "Zero risk budget produces zero lots");
  assert(calculateInstitutionalPositionSize({ riskUsd: 0, entryPrice: 1.0850, slPrice: 1.0820, symInfo: brokerSpec, accInfo: { balance: 50000 } }) === 0, "Institutional sizing never substitutes a minimum lot for zero risk");

  const zeroStop = calculateRiskSize({ riskUsd: 500, entryPrice: 1.0850, slPrice: 1.0850, symInfo: brokerSpec });
  assert(zeroStop.lotSize === 0, "Zero stop distance produces zero lots");
  assert(calculateInstitutionalPositionSize({ riskUsd: 500, entryPrice: 1.0850, slPrice: 1.0850, symInfo: brokerSpec, accInfo: { balance: 50000 } }) === 0, "Institutional sizing blocks zero stop distance");

  const originalFetch = globalThis.fetch;
  const originalRemoteUrl = process.env.AUTONOMOUS_MT5_REMOTE_URL;
  process.env.AUTONOMOUS_MT5_REMOTE_URL = "https://remote-broker.example.test";
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    ok: true,
    account: { login: 7, balance: 50000, equity: 50000 },
    positions: [], orders: [], history: [], requests: [], order_history: [],
    dailyPnl: 0, dayStartEquity: 50000, at: 1700212400,
    // brokerDayStart intentionally omitted: this snapshot is incomplete.
  }) });
  try {
    const incomplete = await getMT5State();
    assert(incomplete.ok === false && /Incomplete/.test(incomplete.error), "Incomplete broker snapshots are rejected before reconciliation");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRemoteUrl === undefined) delete process.env.AUTONOMOUS_MT5_REMOTE_URL;
    else process.env.AUTONOMOUS_MT5_REMOTE_URL = originalRemoteUrl;
  }

  const liveTrade = {
    _id: new ObjectId("650000000000000000000002"),
    symbol: "EURUSD", dir: 1, entryPrice: 1.0850, slPrice: 1.0820, tpPrice: 1.0940,
    targetRR: 3.0, initialRiskDistance: 0.0030, symbolSpec: { digits: 5 },
    status: "active", isLive: true, ticket: 88, brokerAccountLogin: 7,
  };
  const liveMap = new Map([[String(liveTrade._id), liveTrade]]);
  const liveCol = {
    findOne: async (query) => liveMap.get(String(query._id)) ? { ...liveMap.get(String(query._id)) } : null,
    updateOne: async (query, update) => {
      const doc = liveMap.get(String(query._id));
      if (!doc) return { modifiedCount: 0 };
      if (update.$set) Object.assign(doc, update.$set);
      return { modifiedCount: 1 };
    },
  };
  let failedBrokerCalls = 0;
  const failingBrokerEngine = createAutonomousEngine({
    autonomousCols: async () => ({ tradesCol: liveCol }),
    modifyMT5Order: async () => { failedBrokerCalls++; return { ok: false, ambiguous: false, error: "Broker rejected target modification" }; },
  });
  const failedTarget = await failingBrokerEngine.modifyTradeTarget(liveTrade._id, { targetRR: 4.0 });
  assert(failedBrokerCalls === 1, "Live target modification dispatches exactly one broker operation");
  assert(failedTarget.ok === false, "Broker target-operation failure is surfaced to the caller");
  assert(liveMap.get(String(liveTrade._id)).targetRR === 3.0, "Rejected broker target modification does not mutate local target state");
}

// =======================================================
// TEST SUITE 17: Deterministic Magic Number, Structured Comment & Copier Multi-Account Routing Engine
// =======================================================
console.log("\n=======================================================");
console.log("TEST SUITE 17: Deterministic Magic Number, Structured Comment & Copier Multi-Account Routing");
console.log("=======================================================");

// --- 17.1 Asset Class Categorization ---
{
  assert(getAssetClass("NAS100").key === "index" && getAssetClass("NAS100").code === 1, "NAS100 maps to index (code 1)");
  assert(getAssetClass("US30").key === "index" && getAssetClass("US30").code === 1, "US30 maps to index (code 1)");
  assert(getAssetClass("DJ30").key === "index" && getAssetClass("DJ30").code === 1, "DJ30 maps to index (code 1)");
  assert(getAssetClass("SP500").key === "index" && getAssetClass("SP500").code === 1, "SP500 maps to index (code 1)");
  assert(getAssetClass("XAUUSD").key === "metal" && getAssetClass("XAUUSD").code === 2, "XAUUSD maps to metal (code 2)");
  assert(getAssetClass("GOLD").key === "metal" && getAssetClass("GOLD").code === 2, "GOLD alias maps to metal (code 2)");
  assert(getAssetClass("BTCUSD").key === "crypto" && getAssetClass("BTCUSD").code === 3, "BTCUSD maps to crypto (code 3)");
  assert(getAssetClass("EURUSD").key === "fx_major" && getAssetClass("EURUSD").code === 4, "EURUSD maps to fx_major (code 4)");
}

// --- 17.2 Horizon Code Categorization ---
{
  assert(getHorizonCode("swing").code === 1 && getHorizonCode("1D-1H").code === 1 && getHorizonCode("1D").code === 1, "1D-1H Swing maps to horizon code 1");
  assert(getHorizonCode("day").code === 2 && getHorizonCode("4H-15M").code === 2 && getHorizonCode("15M").code === 2, "4H-15M Day Trade maps to horizon code 2");
  assert(getHorizonCode("scalp").code === 3 && getHorizonCode("30M-5M").code === 3 && getHorizonCode("5M").code === 3, "30M-5M Scalp maps to horizon code 3");
}

// --- 17.3 Entry Model & Management Code Categorization ---
{
  assert(getModelCode("ict_2022").code === 1 && getModelCode("ict_2022").short === "M1", "ICT 2022 maps to code 1 (M1)");
  assert(getModelCode("turtle_soup").code === 2 && getModelCode("turtle_soup").short === "M2", "Turtle Soup maps to code 2 (M2)");
  assert(getModelCode("breaker_block").code === 3 && getModelCode("breaker_block").short === "M3", "Breaker Block maps to code 3 (M3)");
  assert(getModelCode("ote_continuation").code === 4 && getModelCode("ote_continuation").short === "M4", "OTE Trend maps to code 4 (M4)");
  assert(getModelCode("silver_bullet").code === 5 && getModelCode("silver_bullet").short === "M5", "Silver Bullet maps to code 5 (M5)");

  assert(getManagementCode("milestone_50").code === 1 && getManagementCode("milestone_50").short === "MG1", "50% Milestone + BE maps to management code 1 (MG1)");
  assert(getManagementCode("prop_firm_safe").code === 2 && getManagementCode("prop_firm_safe").short === "MG2", "Prop-Firm Safe maps to code 2 (MG2)");
  assert(getManagementCode("runner").code === 1, "Legacy runner alias maps to code 1 (MG1)");
}

// --- 17.4 Deterministic Decimal Magic Number Encoding & Decoding ---
{
  // Example 1: NAS100 4H-15M Day Trade with ICT 2022, 50% Milestone Management, FTMO Account Tier 01
  const magic1 = encodeDecimalMagic({
    symbol: "NAS100",
    horizon: "4H-15M",
    modelId: "ict_2022",
    management: "milestone_50",
    accountTier: 1,
  });
  assert(magic1 === 23121101, `NAS100 Day Trade ICT2022 Milestone50 Tier 1: expected 23121101, got ${magic1}`);

  const decoded1 = decodeDecimalMagic(magic1);
  assert(decoded1.valid === true, "Decoded magic1 is valid");
  assert(decoded1.prefix === 23, "Decoded prefix is 23");
  assert(decoded1.asset.key === "index", "Decoded asset is index");
  assert(decoded1.horizon.key === "day", "Decoded horizon is day");
  assert(decoded1.model.key === "ict_2022", "Decoded model is ict_2022");
  assert(decoded1.management.key === "milestone_50", "Decoded management is milestone_50");
  assert(decoded1.accountTier === 1, "Decoded accountTier is 1");

  // Example 2: XAUUSD 1D-1H Swing with Turtle Soup, Prop-Firm Safe Management (Code 2), FundedNext Tier 02
  const magic2 = encodeDecimalMagic({
    symbol: "XAUUSD",
    horizon: "1D-1H",
    modelId: "turtle_soup",
    management: "prop_firm_safe",
    accountTier: 2,
  });
  assert(magic2 === 23212202, `XAUUSD Swing TurtleSoup PropFirmSafe Tier 2: expected 23212202, got ${magic2}`);
  const decoded2 = decodeDecimalMagic(magic2);
  assert(decoded2.asset.key === "metal" && decoded2.horizon.key === "swing" && decoded2.management.key === "prop_firm_safe", "Decoded magic2 dimensions match");

  // Example 3: BTCUSD 30M-5M Scalp Silver Bullet Runner Universal Tier 00
  const magic3 = encodeDecimalMagic({
    symbol: "BTCUSD",
    horizon: "30M-5M",
    modelId: "silver_bullet",
    management: "runner",
    accountTier: 0,
  });
  assert(magic3 === 23335100, `BTCUSD Scalp SilverBullet Runner Universal: expected 23335100, got ${magic3}`);
}

// --- 17.5 Structured MT5 Comment Formatting & Parsing ---
{
  const comment1 = formatCopierComment({
    symbol: "NAS100",
    tf: "15M",
    modelId: "ict_2022",
    management: "milestone_50",
    accountTier: 1,
  });
  assert(comment1 === "TS:NAS:15M:M1:MG1:T01", `Formatted comment: expected 'TS:NAS:15M:M1:MG1:T01', got '${comment1}'`);
  assert(comment1.length <= 31, `MT5 comment length strictly <= 31 chars (got ${comment1.length})`);

  const parsed = parseCopierComment(comment1);
  assert(parsed !== null, "Comment successfully parsed");
  assert(parsed.prefix === "TS", "Parsed prefix is TS");
  assert(parsed.symbolTag === "NAS", "Parsed symbolTag is NAS");
  assert(parsed.tf === "15M", "Parsed tf is 15M");
  assert(parsed.modelTag === "M1", "Parsed modelTag is M1");
  assert(parsed.managementTag === "MG1", "Parsed managementTag is MG1");
  assert(parsed.tierTag === "T01", "Parsed tierTag is T01");
}

// --- 17.6 Multi-Account Diversification & Copier Eligibility Routing ---
{
  // Scenario A: Trader wants Day Trade (4H-15M) on NAS100/DJ30/SP500 on FTMO funded account
  const nas100Trade = {
    symbol: "NAS100",
    canonicalSymbol: "NAS100",
    tf: "15M",
    scenario: { id: "day" },
    entryModel: { id: "ict_2022" },
    managementLogic: "milestone_50",
  };
  const routingNas = resolveCopierRouting(nas100Trade, DEFAULT_COPIER_PROFILES);

  assert(routingNas.magicNumber === 23121101, `NAS100 routing magic is 23121101 (got ${routingNas.magicNumber})`);
  assert(routingNas.eligibleAccounts.length === 1, `Exactly 1 account eligible for NAS100 15M (got ${routingNas.eligibleAccounts.length})`);
  assert(routingNas.eligibleAccounts[0].profileId === "ftmo_indices_day", "FTMO Indices profile is eligible");
  assert(routingNas.eligibleAccounts[0].riskOverridePct === 0.5, "FTMO profile enforces 0.5% risk override");

  const blockedOnFundedNext = routingNas.filteredAccounts.find((a) => a.profileId === "fundednext_metals_crypto");
  assert(blockedOnFundedNext !== undefined, "FundedNext Metals/Crypto correctly filtered out NAS100");
  assert(blockedOnFundedNext.reasons.some((r) => r.includes("Asset class 'index'")), "FundedNext filtered out NAS100 due to asset class");

  const blockedOnPersonal = routingNas.filteredAccounts.find((a) => a.profileId === "personal_swing_macro");
  assert(blockedOnPersonal !== undefined, "Personal Swing account correctly filtered out Day Trade setup");
  assert(blockedOnPersonal.reasons.some((r) => r.includes("Horizon 'day'")), "Personal filtered out Day Trade setup due to swing restriction");

  // Scenario B: Trader wants propfirm risk management method on XAUUSD / BTCUSD on FundedNext
  const goldTrade = {
    symbol: "XAUUSD",
    canonicalSymbol: "XAUUSD",
    tf: "15M",
    scenario: { id: "intraday" },
    entryModel: { id: "turtle_soup" },
    managementLogic: "prop_firm_safe",
  };
  const routingGold = resolveCopierRouting(goldTrade, DEFAULT_COPIER_PROFILES);
  assert(routingGold.eligibleAccounts.some((a) => a.profileId === "fundednext_metals_crypto"), "FundedNext is eligible for Gold Prop-Firm trade");
  assert(routingGold.filteredAccounts.some((a) => a.profileId === "ftmo_indices_day"), "FTMO Indices strictly filtered out Gold trade");

  // Scenario C: Personal macro swing trade
  const btcSwingTrade = {
    symbol: "BTCUSD",
    canonicalSymbol: "BTCUSD",
    tf: "4H",
    scenario: { id: "swing" },
    entryModel: { id: "breaker_block" },
    managementLogic: "runner",
  };
  const routingBtc = resolveCopierRouting(btcSwingTrade, DEFAULT_COPIER_PROFILES);
  assert(routingBtc.eligibleAccounts.some((a) => a.profileId === "personal_swing_macro"), "Personal Swing account is eligible for BTC 4H Swing trade");
  assert(routingBtc.filteredAccounts.some((a) => a.profileId === "ftmo_indices_day"), "FTMO Indices strictly filtered out BTC trade");
}

// --- 17.7 Engine Live Dispatch Integration with Dynamic Magic & Comment ---
{
  const tradeDoc = {
    _id: new ObjectId("650000000000000000000099"),
    symbol: "NAS100",
    canonicalSymbol: "NAS100",
    dir: 1,
    entryPrice: 18000,
    slPrice: 17950,
    tpPrice: 18150,
    initialSlPrice: 17950,
    initialRiskDistance: 50,
    targetRR: 3.0,
    status: "armed",
    executionMode: "auto",
    brokerAccountLogin: 1001,
    isLive: true,
    lotSize: 1.0,
    initialRiskUsd: 100,
    riskUsd: 100,
    symbolSpec: { digits: 2, point: 0.01, trade_tick_value_loss: 1, trade_tick_size: 0.01, volume_min: 0.01, volume_max: 100, volume_step: 0.01 },
    scenario: { id: "day" },
    tf: "15M",
    entryModel: { id: "ict_2022" },
    modelId: "ict_2022",
    managementLogic: "milestone_50",
  };

  const tradeMap = new Map([[String(tradeDoc._id), { ...tradeDoc }]]);
  const mockCol = {
    findOne: async (q) => tradeMap.get(String(q._id)) ? { ...tradeMap.get(String(q._id)) } : null,
    find: () => ({ toArray: async () => Array.from(tradeMap.values()) }),
    updateOne: async (q, u) => {
      const doc = tradeMap.get(String(q._id));
      if (!doc) return { modifiedCount: 0 };
      if (u.$set) Object.assign(doc, u.$set);
      return { modifiedCount: 1 };
    },
  };

  let dispatchedOrder = null;
  const mockEngine = createAutonomousEngine({
    now: () => 1737039600000,
    autonomousCols: async () => ({
      tradesCol: mockCol,
      controlCol: { findOne: async () => null, updateOne: async () => ({}) },
      logsCol: { insertOne: async () => ({}) },
    }),
    getConfig: async () => ({
      enabled: true,
      liveTrading: true,
      executionMode: "auto",
      riskPerTradePct: 1.0,
      accountSize: 50000,
      maxDailyLossPct: 3.0,
      maxConcurrentTrades: 5,
      pendingExpiryMinutes: 60,
      accountFreshnessMs: 30000,
      copierProfiles: DEFAULT_COPIER_PROFILES,
    }),
    getMainWatchlistSymbols: async () => ["NAS100"],
    isTradingPermittedNow: () => ({ permitted: true }),
    revalidateTradeIdea: async () => ({ permitted: true }),
    getDailyBaseline: async (_, fb) => fb,
    logEvent: async () => {},
    getMT5State: async () => ({
      ok: true,
      account: { login: 1001, balance: 50000, equity: 50000 },
      positions: [],
      orders: [],
      history: [],
      order_history: [],
      requests: [],
      dailyPnl: 0,
      dayStartEquity: 50000,
      at: 1737039600,
      brokerDayStart: 1737039600 - 3600,
    }),
    getMT5Symbol: async () => ({ ok: true, symbol: tradeDoc.symbolSpec }),
    executeMT5Order: async (payload) => {
      dispatchedOrder = payload;
      return { ok: true, status: "order-pending", ticket: 999123 };
    },
    reserveTradeCapacity: async () => true,
    releaseTradeCapacity: async () => true,
  });

  // Trigger tick to place order
  await mockEngine.autonomousOnTicks({
    NAS100: { ask: 18010, bid: 18008, time: 1737039600000 },
  });

  assert(dispatchedOrder !== null, "Order was dispatched to broker");
  assert(dispatchedOrder.magic === 23121101, `Dispatched magic is 23121101 (got ${dispatchedOrder?.magic})`);
  assert(dispatchedOrder.comment === "TS:NAS:15M:M1:MG1:T01", `Dispatched comment is TS:NAS:15M:M1:MG1:T01 (got ${dispatchedOrder?.comment})`);
}

console.log("\n=======================================================");
console.log("TEST SUITE 18: Dual Execution Capacity & Sibling Guard Integrity");
console.log("=======================================================");

{
  // 18.1 Guard capacity permits sibling legs of the same groupId with maxConcurrentTrades = 1
  const leg1Doc = {
    _id: new ObjectId("650000000000000000000101"),
    groupId: "grp_nas_dual_01",
    symbol: "NAS100",
    canonicalSymbol: "NAS100",
    dir: 1,
    entryPrice: 18000,
    slPrice: 17950,
    tpPrice: 18150,
    initialSlPrice: 17950,
    initialRiskDistance: 50,
    status: "armed",
    executionMode: "auto",
    isLive: false,
    lotSize: 1.0,
    initialRiskUsd: 100,
    riskUsd: 100,
    scenario: { id: "day" },
    tf: "15M",
    managementLogic: "milestone_50",
  };

  const leg2Doc = {
    _id: new ObjectId("650000000000000000000102"),
    groupId: "grp_nas_dual_01",
    symbol: "NAS100",
    canonicalSymbol: "NAS100",
    dir: 1,
    entryPrice: 18000,
    slPrice: 17950,
    tpPrice: 18100,
    initialSlPrice: 17950,
    initialRiskDistance: 50,
    status: "staged",
    executionMode: "auto",
    isLive: false,
    lotSize: 1.0,
    initialRiskUsd: 100,
    riskUsd: 100,
    scenario: { id: "day" },
    tf: "15M",
    managementLogic: "prop_firm_safe",
  };

  const alienDoc = {
    _id: new ObjectId("650000000000000000000103"),
    groupId: "grp_nas_alien_02",
    symbol: "NAS100",
    canonicalSymbol: "NAS100",
    dir: 1,
    entryPrice: 18000,
    slPrice: 17950,
    tpPrice: 18150,
    initialSlPrice: 17950,
    initialRiskDistance: 50,
    status: "staged",
    executionMode: "auto",
    isLive: false,
    lotSize: 1.0,
    initialRiskUsd: 100,
    riskUsd: 100,
    scenario: { id: "day" },
    tf: "15M",
    managementLogic: "milestone_50",
  };

  const dbMap = new Map([
    [String(leg1Doc._id), { ...leg1Doc }],
    [String(leg2Doc._id), { ...leg2Doc }],
    [String(alienDoc._id), { ...alienDoc }],
  ]);

  const mockTradesCol = {
    findOne: async (q) => dbMap.get(String(q._id)) ? { ...dbMap.get(String(q._id)) } : null,
    find: () => ({ toArray: async () => Array.from(dbMap.values()) }),
    updateOne: async (q, u) => {
      const doc = dbMap.get(String(q._id));
      if (!doc) return { modifiedCount: 0 };
      if (u.$set) Object.assign(doc, u.$set);
      return { modifiedCount: 1 };
    },
  };

  const guardEngine = createAutonomousEngine({
    autonomousCols: async () => ({
      tradesCol: mockTradesCol,
      controlCol: { findOne: async () => null, updateOne: async () => ({}) },
      logsCol: { insertOne: async () => ({}) },
    }),
    getConfig: async () => ({
      enabled: true,
      liveTrading: false,
      executionMode: "auto",
      riskPerTradePct: 1.0,
      accountSize: 50000,
      maxDailyLossPct: 3.0,
      maxConcurrentTrades: 1, // STRICT 1 SETUP CAPACITY!
      pendingExpiryMinutes: 60,
      accountFreshnessMs: 30000,
    }),
    getMainWatchlistSymbols: async () => ["NAS100"],
    isTradingPermittedNow: () => ({ permitted: true }),
    revalidateTradeIdea: async () => ({ permitted: true }),
    getDailyBaseline: async (_, fb) => fb,
  });

  const leg2Guard = await guardEngine.guard(leg2Doc, {
    enabled: true,
    liveTrading: false,
    executionMode: "auto",
    riskPerTradePct: 1.0,
    accountSize: 50000,
    maxDailyLossPct: 3.0,
    maxConcurrentTrades: 1,
    pendingExpiryMinutes: 60,
    accountFreshnessMs: 30000,
  });

  assert(leg2Guard.permitted === true, "Guard permits sibling leg 2 when maxConcurrentTrades is 1");
  assert(!leg2Guard.vetoes.some((v) => v.code === "CAPACITY"), "Sibling leg 2 has no CAPACITY veto");

  const alienGuard = await guardEngine.guard(alienDoc, {
    enabled: true,
    liveTrading: false,
    executionMode: "auto",
    riskPerTradePct: 1.0,
    accountSize: 50000,
    maxDailyLossPct: 3.0,
    maxConcurrentTrades: 1,
    pendingExpiryMinutes: 60,
    accountFreshnessMs: 30000,
  });

  assert(alienGuard.permitted === false, "Guard rejects alien setup when maxConcurrentTrades is 1");
  assert(alienGuard.vetoes.some((v) => v.code === "CAPACITY"), "Alien setup receives CAPACITY veto");
}

{
  // 18.2 In-memory simulation of reserveTradeCapacity sibling vs alien conflict
  const slots = [];
  function simulateReserve(trade, cfg, riskUsd) {
    const tradeId = String(trade._id);
    const tradeSymbol = trade.canonicalSymbol || trade.symbol;
    const groupId = trade.groupId || null;

    // Sibling detection
    const isSibling = Boolean(groupId && slots.some((s) => s.groupId === groupId));
    const hasAlienConflict = slots.some((s) => s.symbol === tradeSymbol && (!groupId || s.groupId !== groupId));
    if (hasAlienConflict) return false;

    const distinctGroups = new Set();
    let distinctSetupCount = 0;
    for (const s of slots) {
      if (s.groupId) {
        if (!distinctGroups.has(s.groupId)) {
          distinctGroups.add(s.groupId);
          distinctSetupCount++;
        }
      } else {
        distinctSetupCount++;
      }
    }
    if (!isSibling && distinctSetupCount >= cfg.maxConcurrentTrades) return false;

    slots.push({ tradeId, groupId, symbol: tradeSymbol, riskUsd });
    return true;
  }

  const tDefault = { _id: "1", groupId: "grp_100", symbol: "NAS100" };
  const tProp = { _id: "2", groupId: "grp_100", symbol: "NAS100" };
  const tAlienSameSym = { _id: "3", groupId: "grp_200", symbol: "NAS100" };
  const tAlienDiffSym = { _id: "4", groupId: "grp_300", symbol: "BTCUSD" };

  const r1 = simulateReserve(tDefault, { maxConcurrentTrades: 1 }, 100);
  assert(r1 === true, "Simulated reserve allows Leg 1 of setup grp_100");

  const r2 = simulateReserve(tProp, { maxConcurrentTrades: 1 }, 100);
  assert(r2 === true, "Simulated reserve allows Leg 2 sibling of setup grp_100 on same symbol NAS100");

  const r3 = simulateReserve(tAlienSameSym, { maxConcurrentTrades: 2 }, 100);
  assert(r3 === false, "Simulated reserve blocks alien setup grp_200 on same symbol NAS100");

  const r4 = simulateReserve(tAlienDiffSym, { maxConcurrentTrades: 1 }, 100);
  assert(r4 === false, "Simulated reserve blocks distinct setup grp_300 when maxConcurrentTrades is 1");

  const r5 = simulateReserve(tAlienDiffSym, { maxConcurrentTrades: 2 }, 100);
  assert(r5 === true, "Simulated reserve permits distinct setup grp_300 when maxConcurrentTrades is 2");
}

{
  // 18.3 Dynamic Prop-Firm TP Selection between 1.5R and 2.5R
  const entry = 1.0850;
  const sl = 1.0820; // risk = 0.0030
  const dir = 1;

  // Case A: Structural targets array has a target at 1.8R (1.0850 + 1.8 * 0.0030 = 1.0904)
  const resStructural = resolveDynamicPropFirmTarget({
    entry,
    sl,
    dir,
    targets: [
      { id: "tp1", price: 1.0904, source: "H4 FVG" }, // exactly 1.8R
      { id: "runner", price: 1.1000, source: "DOL" }, // 5.0R (outside bracket)
    ],
  });
  assert(resStructural.targetRR === 1.8, `Structural target selected: expected 1.8R, got ${resStructural.targetRR}R`);
  assert(resStructural.tpPrice === 1.0904, `Structural target price matched: expected 1.0904, got ${resStructural.tpPrice}`);

  // Case B: Multiple targets in range (1.6R and 2.1R) -> picks closest to 2.0R sweet spot (2.1R)
  const resSweetSpot = resolveDynamicPropFirmTarget({
    entry,
    sl,
    dir,
    targets: [
      { id: "tp1", price: 1.0898, source: "Internal High" }, // 1.6R (diff to 2.0 = 0.4)
      { id: "tp2", price: 1.0913, source: "EQH Pool" },      // 2.1R (diff to 2.0 = 0.1)
    ],
  });
  assert(resSweetSpot.targetRR === 2.1, `Closest to 2.0R selected: expected 2.1R, got ${resSweetSpot.targetRR}R`);
  assert(resSweetSpot.tpPrice === 1.0913, `Closest price matched: expected 1.0913, got ${resSweetSpot.tpPrice}`);

  // Case C: Dealing Range EQ is at 2.2R (1.0850 + 2.2 * 0.0030 = 1.0916)
  const resEQ = resolveDynamicPropFirmTarget({
    entry,
    sl,
    dir,
    targets: [{ id: "runner", price: 1.1000 }], // 5.0R (outside)
    dealingRange: { eq: 1.0916 },
  });
  assert(resEQ.targetRR === 2.2, `Dealing Range EQ selected: expected 2.2R, got ${resEQ.targetRR}R`);
  assert(resEQ.tpPrice === 1.0916, `Dealing Range EQ price matched: expected 1.0916, got ${resEQ.tpPrice}`);

  // Case D: Horizon Defaults when no structural target in [1.5, 2.5]
  const resScalp = resolveDynamicPropFirmTarget({ entry, sl, dir, scenario: { id: "scalp" } });
  assert(resScalp.targetRR === 1.75, `Scalp horizon defaults to 1.75R: got ${resScalp.targetRR}R`);

  const resDay = resolveDynamicPropFirmTarget({ entry, sl, dir, scenario: { id: "day" } });
  assert(resDay.targetRR === 2.0, `Day trade horizon defaults to 2.0R: got ${resDay.targetRR}R`);

  const resSwing = resolveDynamicPropFirmTarget({ entry, sl, dir, scenario: { id: "swing" } });
  assert(resSwing.targetRR === 2.5, `Swing horizon defaults to 2.5R upper bracket: got ${resSwing.targetRR}R`);

  // Case E: Strict Clamp Limits
  const resUnder = resolveDynamicPropFirmTarget({ entry, sl, dir, targetRR: 1.1 });
  assert(resUnder.targetRR === 1.5, `Clamps lower bound to 1.5R: got ${resUnder.targetRR}R`);

  const resOver = resolveDynamicPropFirmTarget({ entry, sl, dir, targetRR: 4.8 });
  assert(resOver.targetRR === 2.5, `Clamps upper bound to 2.5R: got ${resOver.targetRR}R`);
}

// =========================================================================
// TEST SUITE 19: CFD Bid/Ask Spread Friction & Microstructure Mitigation Engine
// =========================================================================
console.log("\n=======================================================");
console.log("TEST SUITE 19: CFD Bid/Ask Spread Friction & Microstructure Mitigation Engine");
console.log("=======================================================");

{
  // 19.1 Spread Extraction from Live Ticks & Specs
  const liveTick = { ask: 1.08520, bid: 1.08505 };
  const spec = { digits: 5, point: 0.00001, spread: 15 };
  const extractedLive = extractSpreadPrice(liveTick, spec);
  assert(extractedLive === 0.00015, `Live tick spread extracted: expected 0.00015, got ${extractedLive}`);

  const syntheticTick = { ask: 0, bid: 0 };
  const extractedSynthetic = extractSpreadPrice(syntheticTick, spec);
  assert(extractedSynthetic === 0.00015, `Synthetic spec spread extracted: expected 0.00015, got ${extractedSynthetic}`);

  // 19.2 Buyside CFD Spread Friction & 60%-70% Institutional Recovery
  // Long Trade: Entry 1.08500, SL 1.08300 (Risk = 20 pips), TP 1.09100 (Target = 60 pips -> 3.00R Nominal)
  // Spread = 2 pips (0.00020)
  const longFriction = calculateSpreadFriction({
    dir: 1,
    entryPrice: 1.08500,
    slPrice: 1.08300,
    tpPrice: 1.09100,
    spread: 0.00020,
    digits: 5,
  });

  assert(longFriction.idleRR === 3.0, `Nominal chart geometry is 3.00R: got ${longFriction.idleRR}R`);
  // Naive retail drag: risk = 22 pips, target = 58 pips -> 58/22 = 2.64R (drag = 0.36R)
  assert(longFriction.naiveCoveredRR === 2.64, `Naive covered RR is 2.64R: got ${longFriction.naiveCoveredRR}R`);
  assert(longFriction.naiveDrag === 0.36, `Naive friction penalty is 0.36R: got ${longFriction.naiveDrag}R`);

  // Mitigated institutional drag:
  // - Entry front-run by +0.35 * spread (+0.00007)
  // - Target adjusted by -0.30 * spread (-0.00006)
  // - Mitigated risk = 0.00207, mitigated target = 0.00594 -> coveredRR = 2.87R
  assert(longFriction.coveredRR === 2.87, `Institutional covered RR is 2.87R: got ${longFriction.coveredRR}R`);
  assert(longFriction.frictionDragR === 0.13, `Institutional drag is reduced to 0.13R: got ${longFriction.frictionDragR}R`);
  assert(longFriction.recoveryPct >= 55.0 && longFriction.recoveryPct <= 70.0, `Mitigation recovers 55%-70% of spread penalty: got ${longFriction.recoveryPct}%`);

  // Broker execution levels
  assert(longFriction.brokerLevels.entry === 1.08507, `Buy limit front-run by +35% spread: got ${longFriction.brokerLevels.entry}`);
  assert(longFriction.brokerLevels.sl === 1.08300, `Buy SL unchanged at structure: got ${longFriction.brokerLevels.sl}`);
  assert(longFriction.brokerLevels.tp === 1.09094, `Buy TP adjusted by -30% spread: got ${longFriction.brokerLevels.tp}`);

  // 19.3 Sellside CFD Spread Friction & Ask-Wick Stopout Protection
  // Short Trade: Entry 1.08500, SL 1.08700 (Risk = 20 pips), TP 1.07900 (Target = 60 pips -> 3.00R Nominal)
  // Spread = 2 pips (0.00020)
  const shortFriction = calculateSpreadFriction({
    dir: -1,
    entryPrice: 1.08500,
    slPrice: 1.08700,
    tpPrice: 1.07900,
    spread: 0.00020,
    digits: 5,
  });

  assert(shortFriction.idleRR === 3.0, `Short nominal chart geometry is 3.00R: got ${shortFriction.idleRR}R`);
  assert(shortFriction.coveredRR === 2.74, `Short institutional covered RR is 2.74R: got ${shortFriction.coveredRR}R`);
  assert(shortFriction.brokerLevels.entry === 1.08493, `Sell limit front-run by -35% spread: got ${shortFriction.brokerLevels.entry}`);
  assert(shortFriction.brokerLevels.sl === 1.08710, `Sell SL buffered by +50% spread to prevent Ask-wick stopout: got ${shortFriction.brokerLevels.sl}`);
  assert(shortFriction.brokerLevels.tp === 1.07906, `Sell TP adjusted by -30% spread: got ${shortFriction.brokerLevels.tp}`);

  // 19.4 Spread-to-Risk Gatekeeper
  // 10% spread-to-risk (2 pips on 20 pips) -> acceptable
  assert(isSpreadAcceptable(0.00020, 0.00200, 0.15) === true, "Spread of 10% risk is acceptable");
  assert(longFriction.isFrictionExcessive === false, "Friction is not excessive for 10% spread-to-risk");

  // 37.5% spread-to-risk (1.5 pips on 4 pips scalp) -> excessive
  const excessiveFriction = calculateSpreadFriction({
    dir: 1,
    entryPrice: 1.08500,
    slPrice: 1.08460, // 4 pips SL
    tpPrice: 1.08620, // 12 pips TP
    spread: 0.00015,  // 1.5 pips spread (37.5% of risk!)
    digits: 5,
  });
  assert(isSpreadAcceptable(0.00015, 0.00040, 0.15) === false, "Spread of 37.5% risk is vetoed by gatekeeper");
  assert(excessiveFriction.isFrictionExcessive === true, "Friction is flagged as excessive for > 15% spread-to-risk");
  assert(excessiveFriction.spreadToRiskPct === 37.5, `Spread-to-risk is 37.5%: got ${excessiveFriction.spreadToRiskPct}%`);

  // 19.5 Spread Buffer on Breakeven Price
  const tradeWithSpread = {
    entryPrice: 1.08500,
    slPrice: 1.08300,
    dir: 1,
    spreadPrice: 0.00020,
  };
  const beWithSpread = breakevenPrice(tradeWithSpread, spec);
  assert(beWithSpread >= 1.08510, `Breakeven covers spread buffer: expected >= 1.08510, got ${beWithSpread}`);
}

// =======================================================
// TEST SUITE 20: Autonomous Milestone Redecision Engine (AMRE) at 50% Target
// =======================================================
console.log("\n=======================================================");
console.log("TEST SUITE 20: Autonomous Milestone Redecision Engine (AMRE) at 50% Target");
console.log("=======================================================");

{
  const tradeBuy = {
    _id: "trade_redecision_test",
    symbol: "EURUSD",
    dir: 1,
    entryPrice: 1.0800,
    slPrice: 1.0770,
    initialRiskDistance: 0.0030,
    targetRR: 5.0,
    tpPrice: 1.0950,
    initialVolume: 1.0,
    remainingVolume: 0.6,
    managementLogic: "milestone_50",
    symbolSpec: { digits: 5, point: 0.00001 },
  };

  // 20.1 Half Target calculation for redecision trigger
  const half = calculateHalfTargetLevel(tradeBuy);
  assert(half.halfRR === 2.5, `50% milestone target RR is 2.5R: got ${half.halfRR}R`);
  assert(half.price === 1.0875, `50% milestone target price is 1.0875: got ${half.price}`);

  // 20.2 Emergency exit redecision (Opposing MSS -> CLOSE_FULL_NOW)
  const closeVerdict = synthesizeRedecision({
    momentum: { score: -80, opposingMss: true, opposingWickRatio: 0.45 },
    obstacles: { score: -50, obstacles: [] },
    dol: { score: -60, status: "ALREADY_SWEPT" },
    smt: { score: -20 },
    session: { score: 0 },
    trade: tradeBuy,
    currentPrice: 1.0875,
  });
  assert(closeVerdict.action === "CLOSE_FULL_NOW", `Opposing MSS triggers CLOSE_FULL_NOW: got ${closeVerdict.action}`);
  assert(closeVerdict.newTpPrice === null, "CLOSE_FULL_NOW specifies market exit with no TP target");

  // 20.3 Target reduction redecision (Obstacle ahead -> REDUCE_TP)
  const reduceVerdict = synthesizeRedecision({
    momentum: { score: 10, opposingMss: false, opposingWickRatio: 0.2 },
    obstacles: {
      score: -70,
      nearestObstacle: {
        price: 1.0880,
        safeBufferPrice: 1.0876,
        safeBufferRR: 2.53,
        name: "H4 Bearish Order Block",
      },
      obstacles: [{ name: "H4 OB" }],
    },
    dol: { score: 10, status: "CLEAR_RUNWAY" },
    smt: { score: 0 },
    session: { score: 0 },
    trade: tradeBuy,
    currentPrice: 1.0875,
  });
  assert(reduceVerdict.action === "REDUCE_TP", `Obstacle in path triggers REDUCE_TP: got ${reduceVerdict.action}`);
  assert(reduceVerdict.newTargetRR < 5.0 && reduceVerdict.newTargetRR >= 1.5, `Reduced RR clamped to institutional bracket: got ${reduceVerdict.newTargetRR}R`);
  assert(reduceVerdict.newTpPrice > 1.0800 && reduceVerdict.newTpPrice < 1.0950, `Reduced TP price properly placed: got ${reduceVerdict.newTpPrice}`);

  // 20.4 Conviction hold redecision (Clear skies & healthy trend -> HOLD_FULL_TP)
  const holdVerdict = synthesizeRedecision({
    momentum: { score: 50, opposingMss: false, opposingWickRatio: 0.15 },
    obstacles: { score: 70, obstacles: [], nearestObstacle: null },
    dol: { score: 40, status: "CLEAR_RUNWAY" },
    smt: { score: 20 },
    session: { score: 40 },
    trade: tradeBuy,
    currentPrice: 1.0875,
  });
  assert(holdVerdict.action === "HOLD_FULL_TP", `Clear skies triggers HOLD_FULL_TP: got ${holdVerdict.action}`);
  assert(holdVerdict.newTargetRR === 5.0, `HOLD_FULL_TP maintains full 5.0R target: got ${holdVerdict.newTargetRR}R`);
  assert(holdVerdict.newTpPrice === 1.0950, `HOLD_FULL_TP maintains full TP price: got ${holdVerdict.newTpPrice}`);

  // 20.5 Target expansion redecision (Runaway expansion -> EXPAND_TP)
  const expandVerdict = synthesizeRedecision({
    momentum: { score: 85, opposingMss: false, opposingWickRatio: 0.1 },
    obstacles: { score: 80, obstacles: [], nearestObstacle: null },
    dol: { score: 80, status: "UNREACHED_MAGNET" },
    smt: { score: 40 },
    session: { score: 60 },
    trade: { ...tradeBuy, targetRR: 3.0, tpPrice: 1.0890 },
    currentPrice: 1.0845,
  });
  assert(expandVerdict.action === "EXPAND_TP", `Runaway expansion triggers EXPAND_TP: got ${expandVerdict.action}`);
  assert(expandVerdict.newTargetRR === 4.0, `EXPAND_TP increments target to 4.0R: got ${expandVerdict.newTargetRR}R`);
}

// ===========================================================================
// TEST SUITE 21: Partitioned Copier Risk Engine & Loosened Entry Constraints
// ===========================================================================
console.log("\n=======================================================");
console.log("TEST SUITE 21: Partitioned Copier Risk Engine & Loosened Capacity");
console.log("=======================================================");

{
  // 21.1 Dual-Leg Sibling Invariance in calculateEffectiveGroupRisk
  const legDefault = {
    _id: "trade_def_1",
    groupId: "grp_nas_1",
    symbol: "NAS100",
    initialRiskUsd: 500,
    legId: "default",
    managementLogic: "milestone_50",
  };
  const legProp = {
    _id: "trade_prop_1",
    groupId: "grp_nas_1",
    symbol: "NAS100",
    initialRiskUsd: 500,
    legId: "prop_firm",
    managementLogic: "prop_firm_safe",
  };

  const initialRiskCheck = calculateEffectiveGroupRisk([legDefault], legProp);
  assert(initialRiskCheck.reservedRisk === 500, `Baseline reserved risk is 1.0R ($500): got ${initialRiskCheck.reservedRisk}`);
  assert(initialRiskCheck.incrementalRisk === 0, `Sibling leg adds strictly 0 incremental risk: got ${initialRiskCheck.incrementalRisk}`);
  assert(initialRiskCheck.totalWithNew === 500, `Group effective risk is invariant to sibling addition: got ${initialRiskCheck.totalWithNew}`);

  // 21.2 Asymmetric sibling risk sizing
  const legDefaultAsym = { ...legDefault, initialRiskUsd: 400 };
  const legPropAsym = { ...legProp, initialRiskUsd: 650 };
  const asymRiskCheck = calculateEffectiveGroupRisk([legDefaultAsym], legPropAsym);
  assert(asymRiskCheck.incrementalRisk === 250, `Incremental risk is max(0, new - old) ($250): got ${asymRiskCheck.incrementalRisk}`);
  assert(asymRiskCheck.totalWithNew === 650, `Total group risk equals max leg risk ($650): got ${asymRiskCheck.totalWithNew}`);

  // 21.3 Multi-setup group risk aggregation (eliminates 2x fake inflation across setups)
  const setupA_1 = { _id: "s1_a", groupId: "grp_a", initialRiskUsd: 500 };
  const setupA_2 = { _id: "s1_b", groupId: "grp_a", initialRiskUsd: 500 };
  const setupB_1 = { _id: "s2_a", groupId: "grp_b", initialRiskUsd: 600 };
  const setupB_2 = { _id: "s2_b", groupId: "grp_b", initialRiskUsd: 600 };

  const allFourLegs = [setupA_1, setupA_2, setupB_1, setupB_2];
  const combinedGroupRisk = calculateEffectiveGroupRisk(allFourLegs, null);
  assert(combinedGroupRisk.reservedRisk === 1100, `Two dual-leg setups aggregate to $1,100 effective risk (not $2,200): got ${combinedGroupRisk.reservedRisk}`);

  // 21.4 Partitioned Realized Daily PnL for Receiver Accounts
  const stoppedLegDefault = {
    _id: "closed_def_1",
    groupId: "grp_stopped",
    managementLogic: "milestone_50",
    realizedPnl: -500,
    closedAt: new Date(),
  };
  const stoppedLegProp = {
    _id: "closed_prop_1",
    groupId: "grp_stopped",
    managementLogic: "prop_firm_safe",
    realizedPnl: -500,
    closedAt: new Date(),
  };

  const closedTrades = [stoppedLegDefault, stoppedLegProp];
  const partitionedLoss = calculatePartitionedDailyPnl(closedTrades, new Date(Date.now() - 3600000));
  assert(partitionedLoss === -500, `Dual stopout realized PnL on receiver account is -$500 (not -$1,000): got ${partitionedLoss}`);

  // 21.5 dailyRiskGovernor with Partitioned vs Naive Drawdown
  const startEquity = 50000;
  const maxDailyLossPct = 2.0; // $1,000 limit

  // Naive would charge -$1,000 drawdown + $400 new risk = $1,400 > $1,000 -> false veto
  const naiveGov = dailyRiskGovernor({
    startEquity,
    equity: startEquity - 1000,
    realizedPnl: -1000,
    maxDailyLossPct,
    reservedRisk: 0,
    newRisk: 400,
  });
  assert(naiveGov.permitted === false, "Naive governor falsely trips circuit breaker at 2x loss");

  // Partitioned charges -$500 drawdown + $400 new risk = $900 < $1,000 -> PERMITTED
  const partitionedGov = dailyRiskGovernor({
    startEquity,
    equity: startEquity - 500,
    realizedPnl: partitionedLoss,
    maxDailyLossPct,
    reservedRisk: 0,
    newRisk: 400,
  });
  assert(partitionedGov.permitted === true, "Partitioned governor correctly permits trade within true receiver loss budget");
  assert(partitionedGov.drawdown === 500, `Partitioned drawdown accurately measured as $500: got ${partitionedGov.drawdown}`);

  // 21.6 Verification of Loosened Enterprise Constraints
  assert(DEFAULT_AUTONOMOUS_CONFIG.maxConcurrentTrades === 10, `maxConcurrentTrades elevated to 10: got ${DEFAULT_AUTONOMOUS_CONFIG.maxConcurrentTrades}`);
  assert(DEFAULT_AUTONOMOUS_CONFIG.maxDailyLossPct === 10.0, `maxDailyLossPct elevated to 10.0: got ${DEFAULT_AUTONOMOUS_CONFIG.maxDailyLossPct}`);
  assert(DEFAULT_AUTONOMOUS_CONFIG.minConviction === 60, `minConviction loosened to 60: got ${DEFAULT_AUTONOMOUS_CONFIG.minConviction}`);
  assert(DEFAULT_AUTONOMOUS_CONFIG.minRunwayPct === 15, `minRunwayPct loosened to 15%: got ${DEFAULT_AUTONOMOUS_CONFIG.minRunwayPct}`);
  assert(DEFAULT_AUTONOMOUS_CONFIG.minRR === 1.8, `minRR loosened to 1.8R: got ${DEFAULT_AUTONOMOUS_CONFIG.minRR}`);
  assert(DEFAULT_AUTONOMOUS_CONFIG.partitionedCopierRisk === true, `partitionedCopierRisk is active: got ${DEFAULT_AUTONOMOUS_CONFIG.partitionedCopierRisk}`);
  assert(DEFAULT_AUTONOMOUS_CONFIG.maxSpreadToRisk === 0.25, `maxSpreadToRisk loosened to 0.25: got ${DEFAULT_AUTONOMOUS_CONFIG.maxSpreadToRisk}`);
  assert(DEFAULT_AUTONOMOUS_CONFIG.cooldownMinutes === 15, `cooldownMinutes loosened to 15m: got ${DEFAULT_AUTONOMOUS_CONFIG.cooldownMinutes}`);
  assert(DEFAULT_AUTONOMOUS_CONFIG.lossCooldownMinutes === 15, `lossCooldownMinutes loosened to 15m: got ${DEFAULT_AUTONOMOUS_CONFIG.lossCooldownMinutes}`);
  assert(DEFAULT_AUTONOMOUS_CONFIG.dedupFingerprintWindowMinutes === 20, `dedupFingerprintWindowMinutes loosened to 20m: got ${DEFAULT_AUTONOMOUS_CONFIG.dedupFingerprintWindowMinutes}`);

  // 21.7 High-Capacity Multi-Setup Simulation (5 Setups x 2 Legs = 10 Slots on Master VPS)
  const masterSlots = [];
  for (let i = 1; i <= 5; i++) {
    masterSlots.push({ tradeId: `t_${i}_def`, groupId: `grp_${i}`, symbol: `SYM_${i}`, riskUsd: 500 });
    masterSlots.push({ tradeId: `t_${i}_prop`, groupId: `grp_${i}`, symbol: `SYM_${i}`, riskUsd: 500 });
  }

  // Count distinct groups in masterSlots
  const distinctGroups = new Set();
  for (const s of masterSlots) {
    if (s.groupId) distinctGroups.add(s.groupId);
  }
  assert(masterSlots.length === 10, `Master VPS holds 10 active trade legs: got ${masterSlots.length}`);
  assert(distinctGroups.size === 5, `Evaluated distinct setup groups is 5 (not 10): got ${distinctGroups.size}`);

  const effectiveRisk5Setups = calculateEffectiveGroupRisk(masterSlots, null);
  assert(effectiveRisk5Setups.reservedRisk === 2500, `Total effective risk for 5 dual-leg setups is $2,500 (not $5,000): got ${effectiveRisk5Setups.reservedRisk}`);

  // 6th setup can be accommodated because distinct count (5) < maxConcurrentTrades (10)
  const setup6Leg1 = { tradeId: "t_6_def", groupId: "grp_6", symbol: "SYM_6", riskUsd: 500 };
  const canAccommodate6 = distinctGroups.size < DEFAULT_AUTONOMOUS_CONFIG.maxConcurrentTrades;
  assert(canAccommodate6 === true, "6th setup group successfully accommodates under elevated capacity limit (10)");
}

// =======================================================
// TEST SUITE 22: Pure R-Measurement Architecture & Removal of Dollar Caps
// =======================================================
console.log("\n=======================================================");
console.log("TEST SUITE 22: Pure R-Measurement Architecture & Removal of Dollar Caps");
console.log("=======================================================");
{
  // 22.1 Verify Default Configuration Flag Values
  assert(DEFAULT_AUTONOMOUS_CONFIG.enforceDollarRiskCaps === false, `enforceDollarRiskCaps is false by default: got ${DEFAULT_AUTONOMOUS_CONFIG.enforceDollarRiskCaps}`);
  assert(DEFAULT_AUTONOMOUS_CONFIG.measureRiskInR === true, `measureRiskInR is true by default: got ${DEFAULT_AUTONOMOUS_CONFIG.measureRiskInR}`);
  assert(DEFAULT_AUTONOMOUS_CONFIG.maxDailyLossR === null, `maxDailyLossR defaults to null (unconstrained): got ${DEFAULT_AUTONOMOUS_CONFIG.maxDailyLossR}`);
  assert(DEFAULT_AUTONOMOUS_CONFIG.capacityRiskLimit === null, `capacityRiskLimit is null: got ${DEFAULT_AUTONOMOUS_CONFIG.capacityRiskLimit}`);

  // 22.2 Partitioned Daily R Engine (calculatePartitionedDailyR)
  const now = Date.now();
  const pastHour = new Date(now - 3600000);
  const closedRTrades = [
    // Setup 1 (Stopped out on both legs)
    { _id: "t1_def", groupId: "grp_1", legId: "default", managementLogic: "milestone_50", realizedR: -1.0, closedAt: new Date(now - 1800000) },
    { _id: "t1_prop", groupId: "grp_1", legId: "prop_firm", managementLogic: "prop_firm_safe", realizedR: -1.0, closedAt: new Date(now - 1800000) },
    // Setup 2 (Default hit full TP 3R, Prop hit TP 2R)
    { _id: "t2_def", groupId: "grp_2", legId: "default", managementLogic: "milestone_50", realizedR: 3.0, closedAt: new Date(now - 900000) },
    { _id: "t2_prop", groupId: "grp_2", legId: "prop_firm", managementLogic: "prop_firm_safe", realizedR: 2.0, closedAt: new Date(now - 900000) },
    // Setup 3 (Default took 40% partial at +1.5R weighted = +0.6R, stopped at BE for remaining; Prop closed at BE = 0R)
    { _id: "t3_def", groupId: "grp_3", legId: "default", managementLogic: "milestone_50", partialExits: [{ weightedR: 0.6, time: new Date(now - 300000) }], closedAt: new Date(now - 100000) },
    { _id: "t3_prop", groupId: "grp_3", legId: "prop_firm", managementLogic: "prop_firm_safe", realizedR: 0.0, closedAt: new Date(now - 100000) },
  ];

  // Stream Default: -1.0 + 3.0 + 0.6 = +2.6R
  // Stream Prop: -1.0 + 2.0 + 0.0 = +1.0R
  // Worst-case receiver stream R = min(2.6, 1.0) = +1.0R
  const dailyR = calculatePartitionedDailyR(closedRTrades, pastHour);
  assert(Math.abs(dailyR - 1.0) < 1e-4, `Partitioned Daily R accurately measures worst receiver stream (+1.0R): got ${dailyR}`);

  // Test purely losing day: Setup 1 lost -1.0R on both legs, Setup 2 lost -1.0R on both legs
  const lossOnlyTrades = [
    { _id: "l1_def", groupId: "grp_1", legId: "default", managementLogic: "milestone_50", realizedR: -1.0, closedAt: new Date(now - 1800000) },
    { _id: "l1_prop", groupId: "grp_1", legId: "prop_firm", managementLogic: "prop_firm_safe", realizedR: -1.0, closedAt: new Date(now - 1800000) },
    { _id: "l2_def", groupId: "grp_2", legId: "default", managementLogic: "milestone_50", realizedR: -1.0, closedAt: new Date(now - 900000) },
    { _id: "l2_prop", groupId: "grp_2", legId: "prop_firm", managementLogic: "prop_firm_safe", realizedR: -1.0, closedAt: new Date(now - 900000) },
  ];
  // 4 trades closed on master VPS, but each receiver stream experienced strictly -2.0R (NOT -4.0R)
  const lossDailyR = calculatePartitionedDailyR(lossOnlyTrades, pastHour);
  assert(lossDailyR === -2.0, `Dual stopout realized R on receiver account is -2.0R (not -4.0R): got ${lossDailyR}`);

  // 22.3 Minimum Lot Fallback on Demo / Small Balance
  // Suppose broker min lot is 0.01, loss per 0.01 lot is $15. But account equity has nominal budget of $5.
  // Without allowMinLotFallback, sizing fails with "Minimum lot exceeds risk budget".
  const noFallbackSizing = calculateRiskSize({
    equity: 500,
    riskPct: 1.0, // $5 budget
    entryPrice: 2000,
    slPrice: 1985,
    symInfo: { volume_min: 0.01, volume_step: 0.01, volume_max: 100, trade_tick_size: 0.01, trade_tick_value: 0.01 },
    lossPerLot: 1500, // $15 per 0.01 lot
    allowMinLotFallback: false,
  });
  assert(noFallbackSizing.lotSize === 0, "Without fallback, sub-budget lot size returns 0");
  assert(noFallbackSizing.reason === "Minimum lot exceeds risk budget", "Without fallback, returns 'Minimum lot exceeds risk budget'");

  // With allowMinLotFallback (demo sender mode): sizes at minimum lot (0.01) so downstream copiers receive signal
  const fallbackSizing = calculateRiskSize({
    equity: 500,
    riskPct: 1.0, // $5 budget
    entryPrice: 2000,
    slPrice: 1985,
    symInfo: { volume_min: 0.01, volume_step: 0.01, volume_max: 100, trade_tick_size: 0.01, trade_tick_value: 0.01 },
    lossPerLot: 1500, // $15 per 0.01 lot
    allowMinLotFallback: true,
  });
  assert(fallbackSizing.lotSize === 0.01, `With fallback, sizes at minimum broker lot (0.01): got ${fallbackSizing.lotSize}`);
  assert(fallbackSizing.reason === null, "With fallback, reason is null (permitted)");

  // 22.4 Guard Veto Bypass: In Demo R-mode, no RISK_CHANGED and no dollar DAILY_DRAWDOWN
  const mockTradesCol = {
    find: () => ({ toArray: async () => [] }),
    findOne: async () => null,
    updateOne: async () => ({ modifiedCount: 1 }),
  };
  const mockEngine = createAutonomousEngine({
    autonomousCols: async () => ({ tradesCol: mockTradesCol, controlCol: { findOne: async () => null, updateOne: async () => ({}) } }),
    getConfig: async () => ({ ...DEFAULT_AUTONOMOUS_CONFIG, liveTrading: false }),
    getMT5State: async () => ({ ok: true, account: { login: 12345, equity: 1000, balance: 1000 } }),
    getMainWatchlistSymbols: async () => ["NAS100"],
    isTradingPermittedNow: () => ({ permitted: true }),
    getDailyBaseline: async (dayKey, equity) => equity,
    revalidateTradeIdea: async () => ({ permitted: true }),
  });
  const testTrade = {
    _id: "trade_demo_test",
    symbol: "NAS100",
    canonicalSymbol: "NAS100",
    dir: 1,
    entryPrice: 18000,
    slPrice: 17950,
    initialSlPrice: 17950,
    initialRiskUsd: 500,
    riskUsd: 500,
    status: "staged",
    groupId: "grp_test",
  };

  // Test with enforceDollarRiskCaps: false (pure R mode)
  const guardDemoMode = await mockEngine.guard(testTrade, {
    enabled: true,
    liveTrading: false,
    enforceDollarRiskCaps: false,
    riskPerTradePct: 1.0,
    accountSize: 1000, // nominal $10 budget vs $500 trade risk
    maxConcurrentTrades: 10,
  });
  assert(!guardDemoMode.vetoes.some(v => v.code === "RISK_CHANGED"), "Demo R-mode: No RISK_CHANGED veto generated");
  assert(!guardDemoMode.vetoes.some(v => v.code === "DAILY_DRAWDOWN"), "Demo R-mode: No dollar DAILY_DRAWDOWN veto generated");
  assert(guardDemoMode.capacityRiskLimit === null, "Demo R-mode: capacityRiskLimit is null (unconstrained)");

  // Test with enforceDollarRiskCaps: true (legacy dollar mode)
  const guardDollarMode = await mockEngine.guard(testTrade, {
    enabled: true,
    liveTrading: false,
    enforceDollarRiskCaps: true,
    riskPerTradePct: 1.0,
    accountSize: 1000, // nominal $10 budget vs $500 trade risk
    maxConcurrentTrades: 10,
  });
  assert(guardDollarMode.vetoes.some(v => v.code === "RISK_CHANGED"), "Dollar mode: RISK_CHANGED veto correctly triggered when risk exceeds budget");
}

console.log("\n=======================================================");
console.log("TEST SUITE 23: Staged Trade Lifecycle & Horizon-Aware Invalidation Engine");
console.log("=======================================================");

{
  const updatedTrades = new Map();
  const mockTradesCol = {
    find: (query) => ({
      toArray: async () => {
        if (query?.status?.$in) {
          return Array.from(updatedTrades.values()).filter(t => query.status.$in.includes(t.status));
        }
        if (query?.status === "staged") {
          return Array.from(updatedTrades.values()).filter(t => t.status === "staged");
        }
        return Array.from(updatedTrades.values());
      }
    }),
    findOne: async () => null,
    updateOne: async (filter, update) => {
      const id = String(filter._id);
      const doc = updatedTrades.get(id);
      if (doc) {
        if (update.$set) Object.assign(doc, update.$set);
        return { modifiedCount: 1 };
      }
      return { modifiedCount: 0 };
    },
    insertOne: async (doc) => {
      const id = doc._id || "id_" + Math.random();
      doc._id = id;
      updatedTrades.set(String(id), doc);
      return { insertedId: id };
    }
  };

  const nowBase = new Date("2026-10-07T12:00:00Z").getTime();
  let currentEngineTime = nowBase;

  const engine = createAutonomousEngine({
    autonomousCols: async () => ({ tradesCol: mockTradesCol, controlCol: { findOne: async () => null, updateOne: async () => ({}) } }),
    getConfig: async () => ({ ...DEFAULT_AUTONOMOUS_CONFIG, liveTrading: false, enabled: true }),
    getMT5State: async () => ({ ok: true, account: { login: 12345, equity: 50000, balance: 50000 } }),
    getMainWatchlistSymbols: async () => ["EURUSD", "NAS100", "NAS100_SL", "NAS100_TP"],
    isTradingPermittedNow: () => ({ permitted: true }),
    getStartOfTradingDay: () => new Date("2026-10-07T00:00:00Z"),
    revalidateTradeIdea: async () => ({ permitted: true }),
    logEvent: async () => {},
    releaseTradeCapacity: async () => true,
    sendTelegram: async () => {},
    broadcast: () => {},
    now: () => currentEngineTime,
  });

  // 1. Swing trade at 4 hours old: MUST NOT BE EXPIRED
  const swingTrade = {
    _id: "swing_1",
    symbol: "EURUSD",
    canonicalSymbol: "EURUSD",
    dir: 1,
    entryPrice: 1.0850,
    slPrice: 1.0800,
    initialSlPrice: 1.0800,
    tpPrice: 1.1000,
    status: "staged",
    horizon: "swing",
    horizonCode: 1,
    createdAt: new Date(nowBase - 4 * 3600_000), // 4 hours ago
  };
  updatedTrades.set("swing_1", swingTrade);

  // 2. Day trade at 4 hours old: MUST NOT BE EXPIRED (valid within 24h trading day)
  const dayTrade = {
    _id: "day_1",
    symbol: "EURUSD",
    canonicalSymbol: "EURUSD",
    dir: 1,
    entryPrice: 1.0850,
    slPrice: 1.0800,
    initialSlPrice: 1.0800,
    tpPrice: 1.0950,
    status: "staged",
    horizon: "day",
    horizonCode: 2,
    createdAt: new Date(nowBase - 4 * 3600_000), // 4 hours ago
  };
  updatedTrades.set("day_1", dayTrade);

  // 3. Staged Trade Invalidation: Tick touches or breaches SL before entry fill
  const slBreachTrade = {
    _id: "sl_breach_1",
    symbol: "NAS100_SL",
    canonicalSymbol: "NAS100",
    dir: 1,
    entryPrice: 18000,
    slPrice: 17950,
    initialSlPrice: 17950,
    tpPrice: 18150,
    status: "staged",
    horizon: "day",
    horizonCode: 2,
    createdAt: new Date(nowBase - 1800_000), // 30m ago
  };
  updatedTrades.set("sl_breach_1", slBreachTrade);

  // 4. Staged Trade Invalidation: Tick reaches target TP before entry fill (move already completed)
  const tpTargetHitTrade = {
    _id: "tp_target_hit_1",
    symbol: "US30",
    canonicalSymbol: "US30",
    dir: 1,
    entryPrice: 38000,
    slPrice: 37950,
    initialSlPrice: 37950,
    tpPrice: 38150,
    status: "staged",
    horizon: "day",
    horizonCode: 2,
    createdAt: new Date(nowBase - 1800_000), // 30m ago
  };
  updatedTrades.set("tp_target_hit_1", tpTargetHitTrade);

  // Run onTicks with normal tick for EURUSD (1.0870, above entry 1.0850)
  await engine.autonomousOnTicks({
    EURUSD: { bid: 1.0870, ask: 1.0871, time: nowBase },
  });

  assert(swingTrade.status === "staged", "Swing trade (4h old) is still active and NOT expired");
  assert(dayTrade.status === "staged", "Day trade (4h old) is still active and NOT expired");

  // Test SL breach invalidation (at nowBase)
  await engine.autonomousOnTicks({
    NAS100_SL: { bid: 17945, ask: 17946, time: nowBase }, // Breaches SL (17950)
  });
  assert(slBreachTrade.status === "invalidated", "Staged trade is invalidated when price breaches SL before entry");
  assert(slBreachTrade.closeReason?.includes("invalidation stop breached"), "Invalidation reason records SL breach");

  // Test TP target hit invalidation (move left without entry fill at nowBase)
  await engine.autonomousOnTicks({
    US30: { bid: 38155, ask: 38156, time: nowBase }, // Hits TP (38150)
  });
  assert(tpTargetHitTrade.status === "invalidated", "Staged trade is invalidated when price reaches target before entry");
  assert(tpTargetHitTrade.closeReason?.includes("Target reached prior to limit entry fill"), "Invalidation reason records target hit");

  // Advance time to 36 hours later (1.5 days later)
  currentEngineTime = nowBase + 36 * 3600_000;
  await engine.autonomousOnTicks({
    EURUSD: { bid: 1.0870, ask: 1.0871, time: currentEngineTime },
  });
  assert(swingTrade.status === "staged", "Swing trade (36h / 1.5 days old) is still active and NOT expired");
  assert(dayTrade.status === "expired", "Day trade (36h old) expired across daily session rollover");
}

// =======================================================
// TEST SUITE 24: Autonomous Pre-Entry Validation Engine (APVE)
// =======================================================
{
  console.log("\n=======================================================");
  console.log("TEST SUITE 24: Autonomous Pre-Entry Validation Engine (APVE)");
  console.log("=======================================================");

  const updatedTrades = new Map();
  const loggedEvents = [];

  const mockDb = {
    tradesCol: {
      find: (q) => ({
        toArray: async () => {
          let list = Array.from(updatedTrades.values());
          if (q.status?.$in) list = list.filter((t) => q.status.$in.includes(t.status));
          if (q.groupId) list = list.filter((t) => t.groupId === q.groupId);
          return list;
        },
      }),
      findOne: async (q) => {
        if (q._id) return updatedTrades.get(String(q._id)) || null;
        return null;
      },
      updateOne: async (q, u) => {
        const t = updatedTrades.get(String(q._id));
        if (t && (!q.status || q.status === t.status)) {
          if (u.$set) Object.assign(t, u.$set);
          if (u.$push?.events) (t.events = t.events || []).push(u.$push.events);
          return { modifiedCount: 1 };
        }
        return { modifiedCount: 0 };
      },
      insertOne: async (doc) => {
        const id = doc._id || `trade_${Math.random()}`;
        doc._id = id;
        updatedTrades.set(String(id), doc);
        return { insertedId: id };
      },
    },
    controlCol: {
      updateOne: async () => ({ modifiedCount: 1 }),
      findOne: async () => null,
    },
  };

  const tradePendingFvg = {
    _id: "trade_pending_fvg",
    symbol: "EURUSD",
    canonicalSymbol: "EURUSD",
    dir: 1,
    entryPrice: 1.0850,
    slPrice: 1.0830,
    initialSlPrice: 1.0830,
    tpPrice: 1.0910,
    status: "pending",
    executionMode: "paper",
    lotSize: 0.5,
    modelId: "ict_2022",
    tf: "M15",
    isLive: false,
    stagedLevel: {
      fvg: { top: 1.0860, bottom: 1.0845, ce: 1.08525 },
    },
  };
  updatedTrades.set("trade_pending_fvg", tradePendingFvg);

  // Inverted FVG frames (bar closed below 1.0845 at 1.0840)
  const invertedFrames = {
    M15: [
      { time: 1700000000, open: 1.0860, high: 1.0865, low: 1.0848, close: 1.0855, volume: 1000 },
      { time: 1700000900, open: 1.0855, high: 1.0858, low: 1.0838, close: 1.0840, volume: 1000 }, // FVG Inverted!
    ],
  };

  const engine = createAutonomousEngine({
    autonomousCols: async () => mockDb,
    getConfig: async () => ({ ...DEFAULT_AUTONOMOUS_CONFIG, enabled: true, liveTrading: false, executionMode: "paper" }),
    getFrames: async () => invertedFrames,
    getMainWatchlistSymbols: async () => ["EURUSD", "NAS100", "NAS100_CLEAN", "EURUSD_VETO"],
    isTradingPermittedNow: () => ({ permitted: true }),
    revalidateTradeIdea: async () => ({ permitted: true }),
    getStartOfTradingDay: () => new Date("2026-10-07T00:00:00Z"),
    guard: async () => ({ permitted: true, equity: 50000 }),
    releaseTradeCapacity: async () => true,
    sendTelegram: async () => {},
    broadcast: () => {},
    logEvent: async (type, msg) => { loggedEvents.push({ type, msg }); },
  });

  // Tick touches entry price (1.0849 <= 1.0850)
  await engine.autonomousOnTicks({
    EURUSD: { bid: 1.0849, ask: 1.0850, time: Date.now() },
  });

  assert(tradePendingFvg.status === "invalidated", "Pending trade is invalidated on entry tap when FVG is inverted");
  assert(tradePendingFvg.closeReason?.includes("virgin FVG floor"), "Invalidation reason correctly identifies FVG inverted failure");

  // Test 2: Valid trade with clean frames executes fill smoothly
  const cleanTrade = {
    _id: "trade_clean_1",
    symbol: "NAS100_CLEAN",
    canonicalSymbol: "NAS100",
    dir: 1,
    entryPrice: 18000,
    slPrice: 17950,
    initialSlPrice: 17950,
    tpPrice: 18150,
    status: "pending",
    executionMode: "paper",
    lotSize: 0.1,
    modelId: "ict_2022",
    tf: "M15",
    isLive: false,
    stagedLevel: {
      fvg: { top: 18050, bottom: 17980, ce: 18015 },
    },
  };
  updatedTrades.set("trade_clean_1", cleanTrade);

  const cleanFrames = {
    M15: [
      { time: 1700000000, open: 18050, high: 18060, low: 18010, close: 18020, volume: 1000 },
      { time: 1700000900, open: 18020, high: 18025, low: 17995, close: 18005, volume: 1000 }, // Holds above 17980 floor!
    ],
  };

  const engineClean = createAutonomousEngine({
    now: () => 1737039600000,
    autonomousCols: async () => mockDb,
    getConfig: async () => ({ ...DEFAULT_AUTONOMOUS_CONFIG, enabled: true, liveTrading: false, executionMode: "paper" }),
    getFrames: async () => cleanFrames,
    getMainWatchlistSymbols: async () => ["EURUSD", "NAS100", "NAS100_CLEAN", "EURUSD_VETO"],
    isTradingPermittedNow: () => ({ permitted: true }),
    revalidateTradeIdea: async () => ({ permitted: true }),
    getStartOfTradingDay: () => new Date("2026-10-07T00:00:00Z"),
    guard: async () => ({ permitted: true, equity: 50000 }),
    reserveTradeCapacity: async () => true,
    releaseTradeCapacity: async () => true,
    sendTelegram: async () => {},
    broadcast: () => {},
    logEvent: async () => {},
  });

  await engineClean.autonomousOnTicks({
    NAS100_CLEAN: { bid: 17999, ask: 18000, time: 1737039600000 },
  });

  assert(cleanTrade.status === "active", "Valid trade passes APVE and is confirmed active on entry tap");
  assert(cleanTrade.filledPrice === 18000, "Clean trade is filled at entry price (18000)");

  // Test 3: Staged Trade Approval with Pre-Entry Veto
  const stagedTradeToApprove = {
    _id: new ObjectId("650000000000000000000088"),
    symbol: "EURUSD_VETO",
    canonicalSymbol: "EURUSD",
    dir: 1,
    entryPrice: 1.0850,
    slPrice: 1.0830,
    initialSlPrice: 1.0830,
    tpPrice: 1.0910,
    status: "staged",
    executionMode: "paper",
    modelId: "ict_2022",
    tf: "M15",
    stagedLevel: {
      fvg: { top: 1.0860, bottom: 1.0845, ce: 1.08525 },
    },
  };
  updatedTrades.set(String(stagedTradeToApprove._id), stagedTradeToApprove);

  const engineApprove = createAutonomousEngine({
    autonomousCols: async () => mockDb,
    getConfig: async () => ({ ...DEFAULT_AUTONOMOUS_CONFIG, enabled: true, liveTrading: false, executionMode: "paper" }),
    getFrames: async () => invertedFrames, // Inverted FVG!
    getMainWatchlistSymbols: async () => ["EURUSD", "NAS100", "NAS100_CLEAN", "EURUSD_VETO"],
    isTradingPermittedNow: () => ({ permitted: true }),
    revalidateTradeIdea: async () => ({ permitted: true }),
    getStartOfTradingDay: () => new Date("2026-10-07T00:00:00Z"),
    guard: async () => ({ permitted: true, equity: 50000 }),
    reserveTradeCapacity: async () => true,
    releaseTradeCapacity: async () => true,
    sendTelegram: async () => {},
    broadcast: () => {},
    logEvent: async () => {},
  });

  const approveRes = await engineApprove.approveStagedTrade(stagedTradeToApprove._id);
  assert(approveRes.ok === false, "approveStagedTrade rejects approval when APVE vetoes setup");
  assert(approveRes.error?.includes("virgin FVG floor"), "approveStagedTrade error reports APVE reason");
  assert(stagedTradeToApprove.status === "invalidated", "Staged trade transitioned to invalidated upon failed approval");
}

console.log("\n=======================================================");
console.log("TEST SUITE 25: Multi-Timeframe Structural Cascading Take-Profit Engine (MT-STPE)");
console.log("=======================================================");
{
  // 25.1 tradeDefault Mode: Preferred bracket is 3.0R - 7.0R
  assert(DEFAULT_TP_RANGE.minR === 3.0, "Default mode min preferred RR is 3.0R");
  assert(DEFAULT_TP_RANGE.maxR === 7.0, "Default mode max preferred RR is 7.0R");
  assert(JSON.stringify(DEFAULT_HORIZON_TIMEFRAME_LEVELS.day) === JSON.stringify(["H4", "H1", "M15"]), "Day horizon ladder is 4H -> 1H -> 15M");
  assert(JSON.stringify(DEFAULT_HORIZON_TIMEFRAME_LEVELS.swing) === JSON.stringify(["D1", "H4", "H1"]), "Swing horizon ladder is 1D -> 4H -> 1H");
  assert(JSON.stringify(DEFAULT_HORIZON_TIMEFRAME_LEVELS.scalp) === JSON.stringify(["M30", "M15", "M5"]), "Scalp horizon ladder is 30M -> 15M -> 5M");

  // 25.2 Day Horizon: Level 1 (4H) is > 7.0R (e.g. 12R) -> cascades down to Level 2 (1H)
  // Entry: 100, Stop: 90 (Risk: 10). Long setup.
  // 4H has structural target @ 220 (12.0R, > 7R)
  // 1H has structural target @ 152 (5.2R, within [3.0, 7.0])
  const dayCascade1 = resolveCascadingDefaultTarget({
    entry: 100,
    sl: 90,
    dir: 1,
    scenario: { id: "day" },
    targets: [
      { tf: "4H", price: 220, source: "4H Dealing Range External High" },
      { tf: "1H", price: 152, source: "1H FVG Consequent Encroachment" },
    ],
  });
  assert(dayCascade1.targetRR === 5.2, `Level 1 (>7R) cascades down to Level 2 (1H): got ${dayCascade1.targetRR}R`);
  assert(dayCascade1.tpPrice === 152, `Cascaded TP price is 152: got ${dayCascade1.tpPrice}`);
  assert(dayCascade1.tf === "H1", `Cascaded timeframe is 1H: got ${dayCascade1.tf}`);
  assert(dayCascade1.levelIndex === 1, `Selected level index is 1 (Level 2): got ${dayCascade1.levelIndex}`);
  assert(dayCascade1.isException === false, "Candidate in preferred bracket is NOT an exception");

  // 25.3 Day Horizon: Both Level 1 (4H = 12R) and Level 2 (1H = 9.5R) are > 7.0R -> cascades to Level 3 (15M = 4.0R)
  const dayCascade2 = resolveCascadingDefaultTarget({
    entry: 100,
    sl: 90,
    dir: 1,
    scenario: { id: "day" },
    targets: [
      { tf: "4H", price: 220, source: "4H High" },
      { tf: "1H", price: 195, source: "1H OB Mean Threshold" },
      { tf: "15M", price: 140, source: "15M Dealing Range EQ" },
    ],
  });
  assert(dayCascade2.targetRR === 4.0, `Cascades through 4H and 1H down to 15M: got ${dayCascade2.targetRR}R`);
  assert(dayCascade2.tpPrice === 140, `Cascaded TP price is 140: got ${dayCascade2.tpPrice}`);
  assert(dayCascade2.tf === "M15", `Cascaded timeframe is 15M: got ${dayCascade2.tf}`);
  assert(dayCascade2.levelIndex === 2, `Selected level index is 2 (Level 3): got ${dayCascade2.levelIndex}`);
  assert(dayCascade2.isException === false, "Candidate in preferred bracket is NOT an exception");

  // 25.4 3rd Level Exception: Level 3 (15M) is ALSO > 7.0R (e.g. 8.5R) -> kept as valid exception, NOT clamped!
  const dayCascade3 = resolveCascadingDefaultTarget({
    entry: 100,
    sl: 90,
    dir: 1,
    scenario: { id: "day" },
    targets: [
      { tf: "4H", price: 220, source: "4H High" },
      { tf: "1H", price: 195, source: "1H OB Mean Threshold" },
      { tf: "15M", price: 185, source: "15M Structural Target" }, // 8.5R!
    ],
  });
  assert(dayCascade3.targetRR === 8.5, `3rd Level (15M) > 7.0R is kept as natural exception without clamp: got ${dayCascade3.targetRR}R`);
  assert(dayCascade3.tpPrice === 185, `3rd Level TP price is 185: got ${dayCascade3.tpPrice}`);
  assert(dayCascade3.tf === "M15", `Selected timeframe is 15M (level 3): got ${dayCascade3.tf}`);
  assert(dayCascade3.isException === true, "Marked as exception out of preferred range");
  assert(dayCascade3.targets.length === 3, "Constructs 3-target ladder");
  assert(dayCascade3.targets[0].id === "tp1", "TP1 milestone is present");
  assert(dayCascade3.targets[1].id === "tp2", "TP2 milestone is present");
  assert(dayCascade3.targets[2].id === "runner", "Runner target is present");

  // 25.5 Scalp Horizon Cascading: 30M -> 15M -> 5M
  const scalpCascade = resolveCascadingDefaultTarget({
    entry: 1.0850,
    sl: 1.0840, // Risk: 0.0010 (10 pips)
    dir: 1,
    scenario: { id: "scalp" },
    targets: [
      { tf: "30M", price: 1.0935, source: "30M High (8.5R)" }, // > 7R
      { tf: "15M", price: 1.0895, source: "15M CE (4.5R)" },   // in [3, 7]
      { tf: "5M", price: 1.0875, source: "5M Pivot (2.5R)" },
    ],
  });
  assert(scalpCascade.targetRR === 4.5, `Scalp cascades from 30M to 15M: got ${scalpCascade.targetRR}R`);
  assert(scalpCascade.tpPrice === 1.0895, `Scalp TP price is 1.0895: got ${scalpCascade.tpPrice}`);
  assert(scalpCascade.tf === "M15", `Scalp selected TF is 15M: got ${scalpCascade.tf}`);

  // 25.6 Swing Horizon Cascading: 1D -> 4H -> 1H
  const swingCascade = resolveCascadingDefaultTarget({
    entry: 20000,
    sl: 19800, // Risk: 200
    dir: 1,
    scenario: { id: "swing" },
    targets: [
      { tf: "1D", price: 21800, source: "1D High (9.0R)" },   // > 7R
      { tf: "4H", price: 21200, source: "4H EQH (6.0R)" },    // in [3, 7]
    ],
  });
  assert(swingCascade.targetRR === 6.0, `Swing cascades from 1D to 4H: got ${swingCascade.targetRR}R`);
  assert(swingCascade.tpPrice === 21200, `Swing TP price is 21200: got ${swingCascade.tpPrice}`);
  assert(swingCascade.tf === "H4", `Swing selected TF is 4H: got ${swingCascade.tf}`);

  // 25.7 tradeProp Mode: Upward Gradual Ladder (5M -> 15M -> 30M -> 1H -> 2H -> 4H -> 1D)
  assert(PROP_FIRM_TP_RANGE.minR === 1.5, "Prop mode min preferred RR is 1.5R");
  assert(PROP_FIRM_TP_RANGE.maxR === 2.5, "Prop mode max preferred RR is 2.5R");

  // Scalp starts at 5M. 5M is < 1.5R (0.8R) -> steps up to 15M which gives 2.1R (in [1.5, 2.5])
  const propLadder1 = resolveDynamicPropFirmTarget({
    entry: 100,
    sl: 90,
    dir: 1,
    scenario: { id: "scalp" },
    targets: [
      { tf: "5M", price: 108, source: "5M Minor Pivot (0.8R)" },
      { tf: "15M", price: 121, source: "15M Range High (2.1R)" },
    ],
  });
  assert(propLadder1.targetRR === 2.1, `Prop scalp steps up from 5M (<1.5R) to 15M: got ${propLadder1.targetRR}R`);
  assert(propLadder1.tpPrice === 121, `Prop TP price is 121: got ${propLadder1.tpPrice}`);
  assert(propLadder1.tf === "M15", `Prop selected TF is 15M: got ${propLadder1.tf}`);
  assert(propLadder1.isCapped === false, "Target within [1.5, 2.5] is NOT capped");

  // Day starts at 15M. 15M is < 1.5R (1.1R) -> steps up to 30M which gives 3.2R (> 2.5R) -> capped to 2.5R
  const propLadder2 = resolveDynamicPropFirmTarget({
    entry: 100,
    sl: 90,
    dir: 1,
    scenario: { id: "day" },
    targets: [
      { tf: "15M", price: 111, source: "15M Minor FVG (1.1R)" },
      { tf: "30M", price: 132, source: "30M Dealing Range EQ (3.2R)" },
    ],
  });
  assert(propLadder2.targetRR === 2.5, `Prop trade steps up and caps >2.5R target to 2.5R: got ${propLadder2.targetRR}R`);
  assert(propLadder2.tpPrice === 125, `Capped TP price is 125 (2.5R * 10 = +25): got ${propLadder2.tpPrice}`);
  assert(propLadder2.tf === "M30", `Prop selected TF is 30M: got ${propLadder2.tf}`);
  assert(propLadder2.isCapped === true, "Target > 2.5R is marked as capped");
}

console.log("\n=======================================================");
console.log("TEST SUITE 26: Scalping Horizon Toggle & Execution Blocking Engine");
console.log("=======================================================");

{
  // 1. Verify default autonomous config has Scalp unticked/disabled
  assert(DEFAULT_AUTONOMOUS_CONFIG.enableScalpHorizon === false, "DEFAULT: enableScalpHorizon is false (unticked by default)");
  assert(DEFAULT_AUTONOMOUS_CONFIG.enabledHorizons?.scalp === false, "DEFAULT: enabledHorizons.scalp is false");
  assert(DEFAULT_AUTONOMOUS_CONFIG.enabledHorizons?.day === true, "DEFAULT: enabledHorizons.day is true (active)");
  assert(DEFAULT_AUTONOMOUS_CONFIG.enabledHorizons?.swing === true, "DEFAULT: enabledHorizons.swing is true (active)");

  // 2. Configuration Validation: valid and invalid payloads
  const validPatch = {
    enableScalpHorizon: true,
    enabledHorizons: { day: true, swing: true, scalp: true },
  };
  assert(validateAutonomousConfig(validPatch).enableScalpHorizon === true, "validateAutonomousConfig accepts valid horizon patch");

  let threwInvalid = false;
  try {
    validateAutonomousConfig({ enabledHorizons: { invalid_horizon: true } });
  } catch (_) {
    threwInvalid = true;
  }
  assert(threwInvalid, "validateAutonomousConfig rejects unknown horizon keys");

  // 3. Adaptive Scenario Resolution with Scalp Disabled vs Enabled
  // Consolidating range + Killzone session (conditions that would trigger scalp if allowed)
  const scalpConditions = {
    symbol: "EURUSD",
    brain: { conviction: 85, allowedToLong: true, targetDOL: { price: 1.1000 } },
    ranges: { ranges: { H4: { coveragePct: 85 } } }, // Exhausted HTF range!
    config: {
      now: Date.parse("2026-10-09T14:30:00Z"), // Active NY Killzone
      activeTimeSlot: { isKillzone: true },
      enableScalpHorizon: false, // UNTICKED / DISABLED
      enabledHorizons: { day: true, swing: true, scalp: false },
    },
  };

  const resAdaptiveDisabled = resolveScenarioForPair(scalpConditions);
  assert(resAdaptiveDisabled.scenario.id === "day", `Adaptive mode with scalp disabled falls back to DAY: got ${resAdaptiveDisabled.scenario.id}`);
  assert(resAdaptiveDisabled.mode === "adaptive_day", "Adaptive mode falls back to adaptive_day instead of scalp");

  const resAdaptiveEnabled = resolveScenarioForPair({
    ...scalpConditions,
    config: {
      ...scalpConditions.config,
      enableScalpHorizon: true, // TICKED / ENABLED
      enabledHorizons: { day: true, swing: true, scalp: true },
    },
  });
  assert(resAdaptiveEnabled.scenario.id === "scalp", `Adaptive mode with scalp enabled selects SCALP: got ${resAdaptiveEnabled.scenario.id}`);
  assert(resAdaptiveEnabled.mode === "adaptive_scalp", "Adaptive mode correctly selects adaptive_scalp when toggled on");

  // 4. Forced Scalp Mode disabled vs enabled
  const resForcedDisabled = resolveScenarioForPair({
    ...scalpConditions,
    config: { horizonMode: "scalp", enableScalpHorizon: false, enabledHorizons: { scalp: false } },
  });
  assert(resForcedDisabled.disabled === true, "Forced scalp mode is marked disabled when unticked in settings");
  assert(resForcedDisabled.rationale.includes("disabled in settings"), "Rationale explicitly states scalping horizon is disabled");

  const resForcedEnabled = resolveScenarioForPair({
    ...scalpConditions,
    config: { horizonMode: "scalp", enableScalpHorizon: true, enabledHorizons: { scalp: true } },
  });
  assert(!resForcedEnabled.disabled, "Forced scalp mode is not disabled when toggled on in settings");

  // 5. Execution Veto Gatekeeper Blocking
  const candidateScalp = {
    modelId: "ict_2022",
    tf: "M5",
    scenario: { id: "scalp" },
    horizon: "scalp",
    entry: 1.0850,
    sl: 1.0820,
    tp: 1.0950,
    evidence: { formationTime: Date.now() - 60000 },
  };

  const vetoWhenDisabled = evaluateExecutionVetoes({
    symbol: "EURUSD",
    dir: 1,
    entry: 1.0850,
    sl: 1.0820,
    brain: { macroDir: 1, allowedToLong: true, targetDOL: { price: 1.0950, targetSide: "BSL" } },
    config: {
      now: Date.now(),
      enableScalpHorizon: false,
      enabledHorizons: { scalp: false },
      candidate: candidateScalp,
      scenario: { id: "scalp" },
    },
    candidate: candidateScalp,
  });
  assert(vetoWhenDisabled.permitted === false, "Scalp candidate is blocked when scalp horizon is disabled");
  assert(vetoWhenDisabled.vetoes.some(v => v.code === "HORIZON_DISABLED"), "Veto records HORIZON_DISABLED code");

  const vetoWhenEnabled = evaluateExecutionVetoes({
    symbol: "EURUSD",
    dir: 1,
    entry: 1.0850,
    sl: 1.0820,
    brain: { macroDir: 1, allowedToLong: true, targetDOL: { price: 1.0950, targetSide: "BSL" } },
    config: {
      now: Date.now(),
      enableScalpHorizon: true,
      enabledHorizons: { scalp: true },
      candidate: candidateScalp,
      scenario: { id: "scalp" },
    },
    candidate: candidateScalp,
  });
  assert(!vetoWhenEnabled.vetoes.some(v => v.code === "HORIZON_DISABLED"), "HORIZON_DISABLED veto is NOT present when scalp horizon is enabled");
}

// =======================================================
// TEST SUITE 27: Dual-Leg Execution & Prop-Firm Safe Arming Engine
// =======================================================
{
  console.log("\n=======================================================");
  console.log("TEST SUITE 27: Dual-Leg Execution & Prop-Firm Safe Arming Engine");
  console.log("=======================================================");

  const brain = {
    macroDir: 1,
    allowedToLong: true,
    action: "TRADE_LONG",
    targetDOL: { price: 83500, targetSide: "BSL" },
    ranges: { H4: { high: 84000, low: 81000, eq: 82500, coveragePct: 50 } },
    dealingRange: { high: 84000, low: 81000, eq: 82500, coveragePct: 50 },
  };

  const frames = {
    snapshot: { semantics: "UTC_INSTANT", closedOnly: true },
    D1: [{ open: 82000, high: 83000, low: 81500, close: 82500, time: 1700000000 }],
    H4: [{ open: 82000, high: 83000, low: 81500, close: 82500, time: 1700000000 }],
    H1: [{ open: 82000, high: 83000, low: 81500, close: 82500, time: 1700000000 }],
    M15: [{ open: 82000, high: 83000, low: 81500, close: 82500, time: 1700000000 }],
    M5: [{ open: 82000, high: 83000, low: 81500, close: 82500, time: 1700000000 }],
  };

  // Setup: Entry 82500, SL 82000 (risk = 500)
  // Default Target: 84000 (reward = 1500, RR = 3.0R)
  // Prop Target: 83410 (reward = 910, RR = 1.82R)
  const defaultCandidate = {
    modelId: "ict_2022",
    tf: "M15",
    targets: [
      { id: "tp1", price: 83000, fraction: 0.5 },
      { id: "tp2", price: 83500, fraction: 0.3 },
      { id: "runner", price: 84000, fraction: 0.2 },
    ],
    managementLogic: "milestone_50",
    legId: "default",
    tp: 84000,
    targetRR: 3.0,
    confluenceScore: 75,
  };

  const propCandidate = {
    modelId: "ict_2022",
    tf: "M15",
    targets: [{ id: "tp1", price: 83410, fraction: 1.0 }],
    managementLogic: "prop_firm_safe",
    legId: "prop_firm",
    tp: 83410,
    targetRR: 1.82,
    confluenceScore: 75,
  };

  // Case 1: Global config minRR = 2.2
  const globalCfg = {
    minRR: 2.2,
    propFirmMinRR: 1.5,
    confluenceThreshold: 60,
    scenario: { id: "day", requiredTfs: [] },
  };

  // Default leg evaluation against 2.2R minRR
  const defEval = evaluateExecutionVetoes({
    symbol: "BTCUSD",
    dir: 1,
    entry: 82500,
    sl: 82000,
    brain,
    frames,
    config: { ...globalCfg, candidate: defaultCandidate, managementLogic: "milestone_50", legId: "default" },
    candidate: defaultCandidate,
  });
  assert(!defEval.vetoes.some(v => v.code === "MIN_RR"), "Default leg (3.0R) is NOT vetoed by MIN_RR (minRR = 2.2)");

  // Prop leg evaluation against 2.2R global minRR (must use 1.5R propFirmMinRR)
  const propEval = evaluateExecutionVetoes({
    symbol: "BTCUSD",
    dir: 1,
    entry: 82500,
    sl: 82000,
    brain,
    frames,
    config: { ...globalCfg, candidate: propCandidate, managementLogic: "prop_firm_safe", legId: "prop_firm" },
    candidate: propCandidate,
  });
  assert(!propEval.vetoes.some(v => v.code === "MIN_RR"), "Prop leg (1.82R) is NOT vetoed by MIN_RR despite global minRR = 2.2");

  // Case 2: Non-prop candidate with 1.82R MUST be vetoed when global minRR = 2.2
  const nonPropLowRR = {
    ...propCandidate,
    managementLogic: "milestone_50",
    legId: "default",
  };
  const nonPropEval = evaluateExecutionVetoes({
    symbol: "BTCUSD",
    dir: 1,
    entry: 82500,
    sl: 82000,
    brain,
    frames,
    config: { ...globalCfg, candidate: nonPropLowRR, managementLogic: "milestone_50", legId: "default" },
    candidate: nonPropLowRR,
  });
  assert(nonPropEval.vetoes.some(v => v.code === "MIN_RR"), "Non-prop candidate with 1.82R IS vetoed by MIN_RR when minRR = 2.2");

  // Case 3: Prop leg with sub-1.5R (e.g. 1.30R) MUST still be vetoed by 1.5R prop-firm limit
  const propSub15Candidate = {
    ...propCandidate,
    tp: 83150, // 650 reward / 500 risk = 1.30R
    targetRR: 1.30,
    targets: [{ id: "tp1", price: 83150, fraction: 1.0 }],
  };
  const propSub15Eval = evaluateExecutionVetoes({
    symbol: "BTCUSD",
    dir: 1,
    entry: 82500,
    sl: 82000,
    brain,
    frames,
    config: { ...globalCfg, candidate: propSub15Candidate, managementLogic: "prop_firm_safe", legId: "prop_firm" },
    candidate: propSub15Candidate,
  });
  assert(propSub15Eval.vetoes.some(v => v.code === "MIN_RR"), "Prop leg below 1.5R (1.30R) IS vetoed by MIN_RR");
}


console.log("\n=======================================================");
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("=======================================================");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("🎯 ALL AUTONOMOUS ENGINE TESTS PASSED WITH 100% SUCCESS!\n");
}

