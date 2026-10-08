import assert from "node:assert";
import { normalizeCandles, TF_SECONDS } from "./lib/candleNormalization.js";

console.log("=====================================================================");
console.log("TEST SUITE: Continuous Candle Normalization & Session Gap Handling");
console.log("=====================================================================\n");

// Test 1: Intraday consecutive candles with artificial broker gaps
{
  console.log("Test 1: Intraday Consecutive Candles (M5) with Artificial Broker Micro-Gaps");
  const rawBars = [
    { time: 1000, open: 1.1000, high: 1.1020, low: 1.0990, close: 1.1015 },
    { time: 1300, open: 1.1018, high: 1.1030, low: 1.1010, close: 1.1025 }, // Gap: 1.1018 != 1.1015
    { time: 1600, open: 1.1023, high: 1.1040, low: 1.1020, close: 1.1035 }, // Gap: 1.1023 != 1.1025
    { time: 1900, open: 1.1030, high: 1.1050, low: 1.1028, close: 1.1045 }, // Gap: 1.1030 != 1.1035
  ];

  const norm = normalizeCandles(rawBars, "M5");
  assert.strictEqual(norm.length, 4);

  // Bar 1 open must seamlessly match Bar 0 close
  assert.strictEqual(norm[1].open, 1.1015, "Bar 1 open should match Bar 0 close (1.1015)");
  assert.strictEqual(norm[2].open, 1.1025, "Bar 2 open should match Bar 1 close (1.1025)");
  assert.strictEqual(norm[3].open, 1.1035, "Bar 3 open should match Bar 2 close (1.1035)");

  // Verify candle bounds
  for (let i = 0; i < norm.length; i++) {
    const b = norm[i];
    assert(b.low <= b.open, `Bar ${i}: low (${b.low}) must be <= open (${b.open})`);
    assert(b.open <= b.high, `Bar ${i}: open (${b.open}) must be <= high (${b.high})`);
    assert(b.low <= b.close, `Bar ${i}: low (${b.low}) must be <= close (${b.close})`);
    assert(b.close <= b.high, `Bar ${i}: close (${b.close}) must be <= high (${b.high})`);
  }
  console.log("  ✅ PASS: All consecutive M5 candles seamlessly stitched with 100% valid bounds\n");
}

// Test 2: Real Weekend Gap Preservation
{
  console.log("Test 2: Real Weekend Gap Preservation (Intraday & Daily)");
  // Friday 21:00 UTC (time: 100000) -> Sunday 21:00 UTC (time: 100000 + 172800)
  const weekendBars = [
    { time: 100000, open: 1.1000, high: 1.1050, low: 1.0980, close: 1.1030 }, // Friday close
    { time: 272800, open: 1.1080, high: 1.1100, low: 1.1070, close: 1.1090 }, // Sunday open with 50-pip gap
  ];

  const norm = normalizeCandles(weekendBars, "H4");
  assert.strictEqual(norm[1].open, 1.1080, "Weekend gap MUST be strictly preserved (open remains 1.1080)");
  console.log("  ✅ PASS: Real weekend gap strictly preserved without artificial stitching\n");
}

// Test 3: Daily candles (D1) weekday continuity vs weekend gap
{
  console.log("Test 3: Daily Candles (D1) Weekday Continuity vs Weekend Gap");
  const daySec = 86400;
  const d1Bars = [
    { time: 1000000, open: 1.1000, high: 1.1050, low: 1.0980, close: 1.1040 }, // Monday
    { time: 1000000 + daySec, open: 1.1038, high: 1.1060, low: 1.1010, close: 1.1055 }, // Tuesday (micro-gap)
    { time: 1000000 + 2 * daySec, open: 1.1058, high: 1.1080, low: 1.1030, close: 1.1070 }, // Wednesday
    { time: 1000000 + 5 * daySec, open: 1.1120, high: 1.1150, low: 1.1100, close: 1.1130 }, // Next Monday (3-day weekend gap)
  ];

  const norm = normalizeCandles(d1Bars, "D1");
  // Tuesday open should match Monday close
  assert.strictEqual(norm[1].open, 1.1040, "Tuesday open should match Monday close (1.1040)");
  // Wednesday open should match Tuesday close
  assert.strictEqual(norm[2].open, 1.1055, "Wednesday open should match Tuesday close (1.1055)");
  // Monday open over weekend MUST NOT be stitched (gap of 3 days)
  assert.strictEqual(norm[3].open, 1.1120, "Monday open over weekend should remain true open (1.1120)");
  console.log("  ✅ PASS: D1 weekdays continuous while weekend gap preserved\n");
}

// Test 4: Bridge/API format support ({ t, o, h, l, c })
{
  console.log("Test 4: Bridge / API Format Support ({ t in ms, o, h, l, c })");
  const apiBars = [
    { t: 1700000000000, o: 2000.5, h: 2005.0, l: 1999.0, c: 2003.0 },
    { t: 1700000300000, o: 2003.8, h: 2008.0, l: 2002.0, c: 2006.0 }, // +300s (M5)
    { t: 1700000600000, o: 2005.5, h: 2010.0, l: 2004.0, c: 2008.0 }, // +300s (M5)
  ];

  const norm = normalizeCandles(apiBars, "M5");
  assert.strictEqual(norm[1].o, 2003.0, "API format Bar 1 open should match Bar 0 close (2003.0)");
  assert.strictEqual(norm[2].o, 2006.0, "API format Bar 2 open should match Bar 1 close (2006.0)");
  console.log("  ✅ PASS: API format seamlessly supported\n");
}

// Test 5: High/Low dynamic expansion when open is outside prior range
{
  console.log("Test 5: Wick & Range Mathematical Integrity When Open Stitched");
  // Suppose prev candle closed at 100. Next candle broker had open 105, high 108, low 103, close 107
  // Stitched open becomes 100. Low was 103. The candle MUST expand low to 100 so low <= open!
  const anomalyBars = [
    { time: 1000, open: 98, high: 102, low: 97, close: 100 },
    { time: 1060, open: 105, high: 108, low: 103, close: 107 }, // M1 (+60s)
  ];

  const norm = normalizeCandles(anomalyBars, "M1");
  assert.strictEqual(norm[1].open, 100);
  assert.strictEqual(norm[1].low, 100, "Low must expand downwards to 100 to encompass new open");
  assert(norm[1].low <= norm[1].open && norm[1].open <= norm[1].high);
  console.log("  ✅ PASS: Dynamic wick expansion preserves valid candlestick geometry\n");
}

console.log("=====================================================================");
console.log("🎯 ALL CANDLE NORMALIZATION & CONTINUOUS SESSION TESTS PASSED 100%!");
console.log("=====================================================================");
