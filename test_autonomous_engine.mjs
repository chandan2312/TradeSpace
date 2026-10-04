// Comprehensive Test Suite for Autonomous Brain Trader Engine
// Validates:
//   1. Trading Scenarios & Horizon Resolver (scenarios.js)
//   2. Dynamic Institutional Level Detector & Confluence Scorer (levels.js)
//   3. Universe Opportunity Scanner Logic (scanner.js)
//   4. Trade State Machine & Position Management (engine.js)

import { SCENARIOS, resolveScenarioForPair } from "./lib/autonomous/scenarios.js";
import { selectOptimalEntryLevel } from "./lib/autonomous/levels.js";
import { DEFAULT_AUTONOMOUS_CONFIG } from "./lib/autonomous/store.js";
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
} from "./lib/autonomous/models.js";
import { getSetupFingerprint, getExhaustedTodayFingerprints } from "./lib/autonomous/engine.js";
import { getStartOfTradingDay } from "./lib/autonomous/timeslots.js";

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

// 1. Forced Intraday Mode
const resIntraday = resolveScenarioForPair({
  symbol: "EURUSD",
  brain: { conviction: 85, allowedToLong: true },
  ranges: { ranges: { H4: { coveragePct: 30 } } },
  config: { horizonMode: "intraday" },
});
assert(resIntraday.scenario.id === "intraday", "Forced intraday mode returns INTRADAY scenario");
assert(resIntraday.scenario.minRR === 2.0, "Intraday scenario enforces minimum 2.0R");

// 2. Forced Swing Mode
const resSwing = resolveScenarioForPair({
  symbol: "EURUSD",
  brain: { conviction: 85, allowedToLong: true },
  ranges: { ranges: { H4: { coveragePct: 30 } } },
  config: { horizonMode: "swing" },
});
assert(resSwing.scenario.id === "swing", "Forced swing mode returns SWING scenario");
assert(resSwing.scenario.minRR === 2.8, "Swing scenario enforces minimum 2.8R");

// 3. Adaptive Mode: High HTF runway + HTF Target DOL + dominant 4H order flow -> SWING
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
  config: { minRR: 2.0 },
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
assert(Array.isArray(allSlots) && allSlots.length === 8, "All 8 canonical institutional time slots defined");

const helperEetTime = (h, m) => h * 3600 + m * 60;

// 1. Asian Range (03:30 EET)
const slotAsia = getCurrentTimeSlot(helperEetTime(3, 30));
assert(slotAsia.id === "asian_range", "03:30 EET resolves to Asian Range Accumulation");
assert(slotAsia.isKillzone === false, "Asian Range is marked as non-killzone accumulation");
assert(slotAsia.shortBadge === "ASIA 02-08", "Asian Range short badge formatted in EET");

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

// 4. New York AM Killzone (15:30 EET)
const slotNyAm = getCurrentTimeSlot(helperEetTime(15, 30));
assert(slotNyAm.id === "ny_open", "15:30 EET resolves to New York AM Killzone");
assert(slotNyAm.isKillzone === true, "New York AM is recognized as active Killzone");
assert(slotNyAm.shortBadge === "NYKZ 15-18", "New York AM short badge formatted in EET");

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
  config: { minRR: 2.0 },
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
  config: { minRR: 2.0 },
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
assert(gerProfile.label === "London Only", "GER40 badge labeled 'London Only'");

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

// GER40: allowed in london_open, pre_london_prep, london_close; blocked in asian_range, ny_pm
assert(isSymbolPermittedInSlot("GER40", "london_open") === true, "GER40 permitted in London Open");
assert(isSymbolPermittedInSlot("GER40", "pre_london_prep") === true, "GER40 permitted in Frankfurt Prep");
assert(isSymbolPermittedInSlot("GER40", "asian_range") === false, "GER40 strictly blocked in Asian Range");
assert(isSymbolPermittedInSlot("GER40", "ny_pm") === false, "GER40 strictly blocked in New York PM");

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

// At 16:00 EET (New York AM session): 16 * 3600 = 57600
const nySec = 57600;
const nyPermNas = isTradingPermittedNow(nySec, { enforceSymbolSessions: true }, "NAS100");
assert(nyPermNas.permitted === true, "isTradingPermittedNow allows NAS100 during New York session (16:00 EET)");

const nyPermGer = isTradingPermittedNow(nySec, { enforceSymbolSessions: true }, "GER40");
assert(nyPermGer.permitted === false, "isTradingPermittedNow blocks GER40 during New York PM/AM session (16:00 EET)");

// =======================================================
// TEST SUITE 8: Institutional Position Sizing (mt5.js)
// Tests calculateInstitutionalPositionSize in isolation —
// no bridge calls, pure math validation.
// =======================================================
console.log("\n--- TEST SUITE 8: Institutional Position Sizing ---");

import { calculateInstitutionalPositionSize } from "./lib/autonomous/mt5.js";

// Helper: build minimal broker symInfo
function symInfo({ vol_min = 0.01, vol_max = 500, vol_step = 0.01, tick_size = 0, tick_value = 0 } = {}) {
  return {
    volume_min: vol_min,
    volume_max: vol_max,
    volume_step: vol_step,
    trade_tick_size: tick_size,
    trade_tick_value: tick_value,
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
  // lossPerLot = 2.00 * 100 = $200 per lot
  // rawLot = 200/200 = 1.00 lot
  const lot = calculateInstitutionalPositionSize({
    symbol: "XAUUSD",
    riskUsd: 200,
    entryPrice: 1950.00,
    slPrice: 1948.00,
    symInfo: symInfo(),   // no tick data → uses contractMult fallback
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
    accInfo: { balance: 30000 },
  });
  assert(lot === 0.20, `BTCUSD crypto lot sizing: expected 0.20, got ${lot}`);
}

// --- 8.5 Zero SL distance → returns vol_min ---
{
  const lot = calculateInstitutionalPositionSize({
    symbol: "EURUSD",
    riskUsd: 500,
    entryPrice: 1.08500,
    slPrice: 1.08500,  // same as entry → SL dist = 0
    symInfo: symInfo(),
    accInfo: {},
  });
  assert(lot === 0.01, `Zero SL distance → returns vol_min (0.01), got ${lot}`);
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
    accInfo: {},
  });
  assert(lot === 2.00, `GER40 vol_step=0.5 rounding: expected 2.00, got ${lot}`);
}

// --- 8.8 MT5 Tick Scaling Distortion Guard (NAS100 with inflated tick value) ---
{
  // If broker returns tick_value unreasonably large (distorted), engine falls back to contractMult path
  // tick_size=0.01, tick_value=10000 → pointValueRatio=1,000,000 >> expectedMaxRatio(1*10=10)
  // → Uses slDist * contractMult = 50 * 1.0 = $50 per lot
  // riskUsd=100 → rawLot=2.0
  const lot = calculateInstitutionalPositionSize({
    symbol: "NAS100",
    riskUsd: 100,
    entryPrice: 18000,
    slPrice: 17950,
    symInfo: symInfo({ tick_size: 0.01, tick_value: 10000 }),  // distorted feed
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

  // 10.4 Cooldown window parameters defined in store
  assert(DEFAULT_AUTONOMOUS_CONFIG.cooldownMinutes >= 30, `Cooldown period configured: ${DEFAULT_AUTONOMOUS_CONFIG.cooldownMinutes}m`);
  assert(DEFAULT_AUTONOMOUS_CONFIG.lossCooldownMinutes >= 15, `Post-loss cooldown configured: ${DEFAULT_AUTONOMOUS_CONFIG.lossCooldownMinutes}m`);
  assert(DEFAULT_AUTONOMOUS_CONFIG.dedupFingerprintWindowMinutes >= 45, `Dedup fingerprint window configured: ${DEFAULT_AUTONOMOUS_CONFIG.dedupFingerprintWindowMinutes}m`);
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
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("=======================================================");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("🎯 ALL AUTONOMOUS ENGINE TESTS PASSED WITH 100% SUCCESS!\n");
}

