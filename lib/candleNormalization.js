/**
 * Candle Normalization & Continuous Session Stitching Engine
 *
 * In MetaTrader 5 and OTC broker feeds, each candle's Open is recorded from the
 * FIRST tick received inside that timeframe bucket, while Close was the LAST tick
 * of the previous bucket. Because quotes stream with fluctuating spreads and tick intervals,
 * raw broker candles display artificial micro-gaps and friction between almost every candle body.
 *
 * This utility seamlessly stitches consecutive continuous-session candles so that
 * Candle[N].open === Candle[N-1].close, while strictly preserving legitimate weekend gaps,
 * daily rollover breaks, and market holidays.
 */

export const TF_SECONDS = {
  M1: 60, "1M": 60,
  M5: 300, "5M": 300,
  M15: 900, "15M": 900,
  M30: 1800, "30M": 1800,
  H1: 3600, "1H": 3600,
  H4: 14400, "4H": 14400,
  D1: 86400, "1D": 86400,
};

/**
 * Normalizes continuous intra-session candles by seamlessly aligning
 * each consecutive candle's open to the previous candle's close.
 *
 * Supports both:
 * - Bridge / API format: { t, o, h, l, c } (t in ms)
 * - Lightweight-Charts format: { time, open, high, low, close } (time in seconds)
 *
 * @param {Array<Object>} bars - Array of candle objects
 * @param {string} tf - Timeframe code (e.g. "M5", "H1", "D1")
 * @returns {Array<Object>} Normalized continuous bars
 */
export function normalizeCandles(bars, tf) {
  if (!Array.isArray(bars) || bars.length <= 1) return bars || [];

  const tfKey = String(tf || "M5").toUpperCase();
  const sec = TF_SECONDS[tfKey] || 300;
  const isDaily = tfKey === "D1" || tfKey === "1D";

  // Sort ascending by time
  const sorted = [...bars].sort((a, b) => {
    const ta = a.time != null ? a.time : (a.t != null ? a.t / 1000 : 0);
    const tb = b.time != null ? b.time : (b.t != null ? b.t / 1000 : 0);
    return ta - tb;
  });

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const tPrev = prev.time != null ? prev.time : (prev.t != null ? prev.t / 1000 : 0);
    const tCurr = curr.time != null ? curr.time : (curr.t != null ? curr.t / 1000 : 0);
    const dt = tCurr - tPrev;

    // Check if these are immediate consecutive bars in the continuous session:
    // - Intraday: dt matches timeframe within 2-second tolerance
    // - Daily: dt between 1 day (86400) and 1.5 days (86400 * 1.5) for weekday-to-weekday
    // Real weekend gaps (Fri->Mon ~259200s) and multi-hour session breaks are preserved!
    const isConsecutive = isDaily
      ? (dt >= 86400 && dt <= 86400 * 1.5)
      : (Math.abs(dt - sec) <= 2);

    if (isConsecutive) {
      const prevClose = prev.close != null ? prev.close : prev.c;
      if (prevClose != null && prevClose > 0) {
        if ("open" in curr) {
          curr.open = prevClose;
          curr.high = Math.max(curr.high, curr.open);
          curr.low = Math.min(curr.low, curr.open);
        }
        if ("o" in curr) {
          curr.o = prevClose;
          curr.h = Math.max(curr.h, curr.o);
          curr.l = Math.min(curr.l, curr.o);
        }
      }
    }
  }

  return sorted;
}
