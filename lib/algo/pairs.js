// Currency-pair conventions + candidate selection from currency strength.
//
// Pair direction convention (same hierarchy the strength meter uses):
// conventional quote order EUR > GBP > AUD > NZD > USD > CAD > CHF > JPY.
// A strong/weak currency combo maps to exactly one tradeable symbol and a
// side: if the strong currency ranks earlier it's the base → BUY, otherwise
// the pair is quoted the other way round → SELL.

export const CCY_ORDER = ["EUR", "GBP", "AUD", "NZD", "USD", "CAD", "CHF", "JPY"];

// symbols the bridge actually serves (mirror of the bias engine's FX universe)
export const TRADEABLE_FX = [
  "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY", "USDCHF", "USDCAD",
  "EURJPY", "GBPJPY", "AUDJPY", "EURGBP", "EURAUD", "GBPAUD",
];

// The complete 28 conventional crosses of the G8 FX currencies.
// Retained for historical fixture export scripts and offline parity tests.
export const TELEMETRY_ANALYSIS_FX = [
  "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY", "USDCHF", "USDCAD",
  "EURGBP", "EURAUD", "EURNZD", "EURJPY", "EURCHF", "EURCAD",
  "GBPAUD", "GBPNZD", "GBPJPY", "GBPCHF", "GBPCAD",
  "AUDNZD", "AUDJPY", "AUDCHF", "AUDCAD",
  "NZDJPY", "NZDCHF", "NZDCAD",
  "CADJPY", "CADCHF", "CHFJPY",
];


// strong+weak → { symbol, dir: 1 buy | -1 sell } (dir is on the SYMBOL)
export function getPair(strong, weak) {
  const si = CCY_ORDER.indexOf(strong);
  const wi = CCY_ORDER.indexOf(weak);
  if (si === -1 || wi === -1 || strong === weak) return null;
  return si < wi
    ? { symbol: `${strong}${weak}`, dir: 1 }
    : { symbol: `${weak}${strong}`, dir: -1 };
}

// currencyStrength = [{ ccy, score }] (bias-engine output, -100..100, sorted desc).
// Returns candidate pairs where a genuinely strong currency faces a genuinely
// weak one and the symbol is tradeable, ranked by strength divergence (edge).
export function buildCandidates(currencyStrength, {
  minStrong = 15,        // |score| a currency must clear to count
  minEdge = 30,          // strong.score - weak.score minimum divergence
  maxPairs = 4,
  tradeable = TRADEABLE_FX,
} = {}) {
  if (!Array.isArray(currencyStrength) || currencyStrength.length < 2) return [];
  const sorted = [...currencyStrength].sort((a, b) => b.score - a.score);
  const strongs = sorted.filter((c) => c.score >= minStrong).slice(0, 3);
  const weaks = sorted.filter((c) => c.score <= -minStrong).slice(-3);

  const out = [];
  const seen = new Set();
  for (const s of strongs) {
    for (const w of weaks) {
      const pair = getPair(s.ccy, w.ccy);
      if (!pair || seen.has(pair.symbol)) continue;
      if (!tradeable.includes(pair.symbol)) continue;
      const edge = s.score - w.score;
      if (edge < minEdge) continue;
      seen.add(pair.symbol);
      out.push({
        symbol: pair.symbol,
        dir: pair.dir,
        base: s.ccy, quote: w.ccy,
        baseScore: s.score, quoteScore: w.score,
        edge,
      });
    }
  }
  out.sort((a, b) => b.edge - a.edge);
  return out.slice(0, maxPairs);
}
