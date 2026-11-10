import assert from "node:assert";
import { evaluateSymbol } from "./lib/autonomous/scanner.js";
import { resolveRadarTradeIdeaPricing, buildRadarTradeIdeaDrawing } from "./lib/autonomous/tradeDrawing.js";
import { SCENARIOS } from "./lib/autonomous/scenarios.js";

console.log("=======================================================");
console.log("TEST SUITE: Disabled Entry Models Zero-Leak Verification");
console.log("=======================================================");

// 1. Verify radar trade idea pricing returns hasSetup: false when model is disabled or null
const pairWithoutSetup = {
  symbol: "EURUSD",
  tradeableSymbol: "EURUSD",
  dir: 1,
  dirLabel: "BUY",
  stagedLevel: null,
  entryModel: null,
};
const pricingWithoutSetup = resolveRadarTradeIdeaPricing(pairWithoutSetup);
assert.strictEqual(pricingWithoutSetup.hasSetup, false, "Pair without stagedLevel/entryModel must have hasSetup: false");
assert.strictEqual(buildRadarTradeIdeaDrawing(pairWithoutSetup), null, "Drawing manager must return null for pair without setup");
console.log("✅ PASS: Pair without stagedLevel/entryModel returns hasSetup: false and null drawings");

// 2. Verify resolveRadarTradeIdeaPricing rejects disabled model explicitly
const pairWithDisabledModel = {
  symbol: "EURUSD",
  tradeableSymbol: "EURUSD",
  dir: 1,
  dirLabel: "BUY",
  enabledModels: { fvg_rejection: false },
  stagedLevel: {
    modelId: "fvg_rejection",
    entry: 1.1000,
    sl: 1.0950,
    tp: 1.1150,
    targets: [{ price: 1.1150 }],
  },
  entryModel: {
    id: "fvg_rejection",
    modelId: "fvg_rejection",
    entry: 1.1000,
    sl: 1.0950,
    tp: 1.1150,
  },
};
const pricingDisabled = resolveRadarTradeIdeaPricing(pairWithDisabledModel);
assert.strictEqual(pricingDisabled.hasSetup, false, "Pair with disabled model in enabledModels must have hasSetup: false");
assert.strictEqual(buildRadarTradeIdeaDrawing(pairWithDisabledModel), null, "Drawing manager must NOT render RR box for disabled model");
console.log("✅ PASS: Pair with disabled model in enabledModels returns hasSetup: false and null drawings");

// 3. Mock evaluateSymbol test with fvg_rejection disabled
const mockBars = [
  { time: 1000, open: 1.0800, high: 1.0850, low: 1.0790, close: 1.0840, v: 100 },
  { time: 1900, open: 1.0840, high: 1.0900, low: 1.0830, close: 1.0890, v: 150 },
  { time: 2800, open: 1.0890, high: 1.0950, low: 1.0880, close: 1.0940, v: 200 },
];
const mockFrames = {
  M15: mockBars,
  H1: mockBars,
  H4: mockBars,
  D1: mockBars,
};
const mockGathered = new Map([["EURUSD", mockFrames]]);

const evalResult = evaluateSymbol("EURUSD", mockFrames, mockGathered, {
  enabledModels: {
    ict_2022: false,
    turtle_soup: false,
    breaker_block: false,
    ote_continuation: false,
    silver_bullet: false,
    displacement_breakout: false,
    judas_swing: false,
    smt_divergence_sweep: false,
    fvg_rejection: false,
    po3_daily_cycle: false,
  },
  computeBias: () => ({
    macroBias: "BULLISH",
    macroDir: 1,
    ranges: { H4: { high: 1.10, low: 1.08, eq: 1.09, atr: 0.005 } },
    htfLiquidity: {},
    brain: { conviction: 75, verdict: "BULLISH_EXPANSION" },
  }),
}, Date.now(), SCENARIOS.DAY);

assert.strictEqual(evalResult.stagedLevel, null, "When all models are disabled, stagedLevel MUST be null");
console.log("✅ PASS: evaluateSymbol strictly returns stagedLevel: null when all models are disabled");

console.log("\n🎯 ALL DISABLED ENTRY MODEL TESTS PASSED WITH 100% SUCCESS!");
