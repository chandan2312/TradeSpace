import { getCurrentTimeSlot, isTradingPermittedNow, getAllActiveSlotsAt } from "../lib/autonomous/timeslots.js";
import { isKillzone, sessionOf, getEetTime } from "../lib/time.js";
import { computeMacroConfluenceBreakdown } from "../lib/autonomous/scanner.js";

function makeUtcTimestamp(year, month, day, hour, minute) {
  return Date.UTC(year, month - 1, day, hour, minute, 0);
}

// Fixed EET dates (Winter: UTC+2; Summer: UTC+3)
// 2026-02-15 is Winter (UTC+2)
// 01:00 UTC = 03:00 EET (Asian session)
// 06:30 UTC = 08:30 EET (Pre-London / Frankfurt open)
// 09:00 UTC = 11:00 EET (London Open Killzone)
// 15:30 UTC = 17:30 EET (New York AM / Silver Bullet)

console.log("===============================================================================");
console.log("       TradeSpace Institutional Symbol-Aware Killzone Engine Verification     ");
console.log("===============================================================================\n");

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${message}`);
  } else {
    console.error(`  [FAIL] ${message}`);
  }
}

// -----------------------------------------------------------------------------
// Test Suite 1: Asian Session (03:00 EET)
// -----------------------------------------------------------------------------
console.log("--- Test Suite 1: Asian Session (03:00 EET) ---");
const asianTime = makeUtcTimestamp(2026, 2, 15, 1, 0); // 03:00 EET

// 1.1 Yen Pairs (USDJPY, GBPJPY)
for (const sym of ["USDJPY", "GBPJPY"]) {
  const slot = getCurrentTimeSlot(asianTime, {}, sym);
  const permitted = isTradingPermittedNow(asianTime, {}, sym);
  const timeKz = isKillzone(asianTime, sym);

  assert(slot.isKillzone === true, `${sym} in Asian session has isKillzone: true`);
  assert(slot.name.includes("Tokyo Open") || slot.name.includes("Asian Killzone"), `${sym} slot name is '${slot.name}'`);
  assert(timeKz === true, `${sym} in lib/time.js has isKillzone: true`);
  assert(permitted.permitted === true, `${sym} isTradingPermittedNow: permitted = true`);
}

// 1.2 24-Hour Assets (BTCUSD, XAUUSD)
for (const sym of ["BTCUSD", "XAUUSD"]) {
  const slot = getCurrentTimeSlot(asianTime, {}, sym);
  const permitted = isTradingPermittedNow(asianTime, {}, sym);
  const timeKz = isKillzone(asianTime, sym);

  assert(slot.isKillzone === true, `${sym} in Asian session has isKillzone: true (Session 1 of 3)`);
  assert(timeKz === true, `${sym} lib/time.js isKillzone: true`);
  assert(permitted.permitted === true, `${sym} permitted = true in Asia`);
}

// 1.3 European & US assets restricted in Asia
for (const sym of ["EURUSD", "UK100", "GER40", "NAS100"]) {
  const slot = getCurrentTimeSlot(asianTime, {}, sym);
  const permitted = isTradingPermittedNow(asianTime, {}, sym);
  const timeKz = isKillzone(asianTime, sym);

  assert(slot.isKillzone === false, `${sym} in Asian session has isKillzone: false`);
  assert(timeKz === false, `${sym} lib/time.js isKillzone: false`);
  assert(permitted.permitted === false, `${sym} correctly gated OFF during Asian session`);
}

// -----------------------------------------------------------------------------
// Test Suite 2: Frankfurt Cash Open (08:30 EET)
// -----------------------------------------------------------------------------
console.log("\n--- Test Suite 2: Frankfurt Cash Open (08:30 EET) ---");
const frankfurtTime = makeUtcTimestamp(2026, 2, 15, 6, 30); // 08:30 EET

// 2.1 German Index (GER40)
{
  const slot = getCurrentTimeSlot(frankfurtTime, {}, "GER40");
  const permitted = isTradingPermittedNow(frankfurtTime, {}, "GER40");
  const timeKz = isKillzone(frankfurtTime, "GER40");

  assert(slot.isKillzone === true, `GER40 in Frankfurt open has isKillzone: true`);
  assert(slot.name.includes("Frankfurt Cash Open"), `GER40 slot name is '${slot.name}'`);
  assert(timeKz === true, `GER40 lib/time.js isKillzone: true`);
  assert(permitted.permitted === true, `GER40 permitted = true at Frankfurt open`);
}

// 2.2 European Forex (EURUSD) in Pre-London
{
  const slot = getCurrentTimeSlot(frankfurtTime, {}, "EURUSD");
  const permitted = isTradingPermittedNow(frankfurtTime, {}, "EURUSD");
  const timeKz = isKillzone(frankfurtTime, "EURUSD");

  assert(slot.isKillzone === false, `EURUSD in Pre-London is setup phase (isKillzone: false)`);
  assert(timeKz === false, `EURUSD lib/time.js isKillzone: false`);
  assert(permitted.permitted === true, `EURUSD allowed to trade / stage in Pre-London`);
}

// 2.3 US Index (NAS100) locked out in European morning
{
  const permitted = isTradingPermittedNow(frankfurtTime, {}, "NAS100");
  assert(permitted.permitted === false, `NAS100 strictly blocked at 08:30 EET (US index lockout)`);
}

// -----------------------------------------------------------------------------
// Test Suite 3: London Open Killzone (11:00 EET)
// -----------------------------------------------------------------------------
console.log("\n--- Test Suite 3: London Open Killzone (11:00 EET) ---");
const londonTime = makeUtcTimestamp(2026, 2, 15, 9, 0); // 11:00 EET

for (const sym of ["UK100", "GER40", "EURUSD", "GBPUSD", "USDCHF", "XAUUSD", "BTCUSD"]) {
  const slot = getCurrentTimeSlot(londonTime, {}, sym);
  const permitted = isTradingPermittedNow(londonTime, {}, sym);
  const timeKz = isKillzone(londonTime, sym);

  assert(slot.isKillzone === true, `${sym} in London Open has isKillzone: true`);
  assert(timeKz === true, `${sym} lib/time.js isKillzone: true in LOKZ`);
  assert(permitted.permitted === true, `${sym} permitted = true in London Open`);
}

// -----------------------------------------------------------------------------
// Test Suite 4: New York Session / AM Killzone (17:30 EET)
// -----------------------------------------------------------------------------
console.log("\n--- Test Suite 4: New York Session / AM Killzone (17:30 EET) ---");
const nyTime = makeUtcTimestamp(2026, 2, 15, 15, 30); // 17:30 EET

for (const sym of ["NAS100", "US30", "SP500", "EURUSD", "GBPUSD", "XAUUSD", "BTCUSD", "USDJPY"]) {
  const slot = getCurrentTimeSlot(nyTime, {}, sym);
  const permitted = isTradingPermittedNow(nyTime, {}, sym);
  const timeKz = isKillzone(nyTime, sym);

  assert(slot.isKillzone === true, `${sym} in NY AM has isKillzone: true`);
  assert(timeKz === true, `${sym} lib/time.js isKillzone: true in NY`);
  assert(permitted.permitted === true, `${sym} permitted = true in NY`);
}

// -----------------------------------------------------------------------------
// Test Suite 5: Opportunity Confluence Breakdown Scoring
// -----------------------------------------------------------------------------
console.log("\n--- Test Suite 5: Opportunity Confluence Breakdown Scoring ---");
{
  const jpySlot = getCurrentTimeSlot(asianTime, {}, "USDJPY");
  const eurSlot = getCurrentTimeSlot(asianTime, {}, "EURUSD");

  const jpyConfluence = computeMacroConfluenceBreakdown({
    dir: 1,
    brain: { targetDOL: { price: 155.0 } },
    bias: { ranges: { H1: { atr: 0.5 } } },
    activeTimeSlot: jpySlot,
    currentPrice: 150.0,
  });

  const eurConfluence = computeMacroConfluenceBreakdown({
    dir: 1,
    brain: { targetDOL: { price: 1.10 } },
    bias: { ranges: { H1: { atr: 0.002 } } },
    activeTimeSlot: eurSlot,
    currentPrice: 1.08,
  });

  assert(jpyConfluence.killzone === 15, `USDJPY in Asian session receives full 15 killzone points`);
  assert(eurConfluence.killzone === 10, `EURUSD in Asian session receives base 10 points (no killzone bonus)`);
}

console.log(`\n===============================================================================`);
console.log(`Summary: ${passedTests} / ${totalTests} assertions passed (${Math.round(passedTests / totalTests * 100)}%)`);
console.log(`===============================================================================`);

if (passedTests !== totalTests) {
  process.exit(1);
}
