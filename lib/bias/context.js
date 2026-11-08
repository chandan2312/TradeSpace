import { avgRange, findPivots } from "../patterns/core.js";
import { analyzeStructure } from "./structure.js";
import { getFrames } from "./data.js";
import { toCanonicalSymbol, toBrokerSymbol } from "../symbols/mapping.js";

// Beyond-candles input #2: Cross-Asset Market Context & SMT Divergence Engine
//
// Key Responsibilities:
//   1. Cross-Asset Risk Tape: Measures systemic equity/speculative market regime with balanced scoring.
//   2. Institutional SMT Divergence: Compares contemporaneous corresponding swing legs between
//      correlated assets with ATR tolerance gating, epoch unit normalization, and causal asOf truncation.
//   3. Refined Risk Beta: Economically grounded cross-asset sensitivities (e.g. Gold decoupled from equities,
//      USDCAD inverse to commodity rally, XXXJPY carry trade).
//   4. Canonical SMT Pairs: Deduplicated, symmetric correlation universe with canonical alias resolution.

const g = globalThis;
if (!g._tsRiskCtx) g._tsRiskCtx = { at: 0, risk: null };
let inFlightRiskPromise = null;

/**
 * Normalizes any timestamp to epoch seconds.
 */
export function toSec(t) {
  if (typeof t !== "number" || !Number.isFinite(t)) return 0;
  return t > 1e11 ? Math.floor(t / 1000) : Math.floor(t);
}

// Canonical candidate lists to resolve broker naming variances
const DEFAULT_EQUITY_PROXIES = ["SP500", "US500", "SPX500", "SPX"];
const DEFAULT_CRYPTO_PROXIES = ["BTCUSD", "BITCOIN", "BTC"];

/**
 * Fetches market risk sentiment from cross-asset proxies.
 * Dynamically resolves broker symbols via toBrokerSymbol() or options.framesMap.
 */
export async function getMarketContext(options = {}) {
  // 1. If pre-sliced frames are provided (e.g. from backtest or scanner), evaluate point-in-time causally
  if (options.framesMap) {
    return evaluateRiskContextFromFrames(options.framesMap);
  }

  // 2. Wall-clock cache check for live trading (120-second TTL)
  const now = Date.now();
  if (now - g._tsRiskCtx.at < 120_000 && g._tsRiskCtx.risk !== null) {
    return g._tsRiskCtx;
  }

  // 3. Deduplicate in-flight promises to prevent bridge socket congestion
  if (inFlightRiskPromise) {
    return inFlightRiskPromise;
  }

  inFlightRiskPromise = (async () => {
    try {
      const framesMap = {};

      // Resolve Equity Proxy: check user's configured broker mapping first
      const brokerEquity = toBrokerSymbol("SP500");
      const equityCandidates = Array.from(new Set([brokerEquity, ...DEFAULT_EQUITY_PROXIES].filter(Boolean)));
      for (const cand of equityCandidates) {
        try {
          const f = await getFrames(cand);
          if (f?.H1 || f?.H4) {
            framesMap["EQUITIES"] = { symbol: cand, frames: f };
            break;
          }
        } catch {}
      }

      // Resolve Crypto Proxy: check user's configured broker mapping first
      const brokerCrypto = toBrokerSymbol("BTCUSD");
      const cryptoCandidates = Array.from(new Set([brokerCrypto, ...DEFAULT_CRYPTO_PROXIES].filter(Boolean)));
      for (const cand of cryptoCandidates) {
        try {
          const f = await getFrames(cand);
          if (f?.H1 || f?.H4) {
            framesMap["CRYPTO"] = { symbol: cand, frames: f };
            break;
          }
        } catch {}
      }

      const evaluated = evaluateRiskContextFromFrames(framesMap);
      g._tsRiskCtx = { at: Date.now(), risk: evaluated.risk };
      return g._tsRiskCtx;
    } finally {
      inFlightRiskPromise = null;
    }
  })();

  return inFlightRiskPromise;
}

/**
 * Evaluates risk context from proxy frames with balanced scoring (neutral does not inflate score).
 */
function evaluateRiskContextFromFrames(framesMap = {}) {
  let sum = 0;
  let totalAvailable = 0;
  const notes = [];

  for (const [key, item] of Object.entries(framesMap)) {
    const f = item.frames || item;
    const bars = f.H1 || f.H4;
    if (!Array.isArray(bars) || bars.length < 12) continue;

    const sym = item.symbol || key;
    try {
      const st = analyzeStructure(bars, avgRange(bars));
      let d = (st.dir === 1 || st.dir === -1) ? st.dir : 0;
      const ev = st.lastEvent;
      if (ev?.type === "MSS" && ev.displaced && ev.age <= 12) {
        d = (ev.dir === 1 || ev.dir === -1) ? ev.dir : d;
      }

      totalAvailable++;
      sum += d;
      if (d !== 0) {
        notes.push(`${sym} ${d > 0 ? "↑" : "↓"}`);
      } else {
        notes.push(`${sym} ⬌ (Chop)`);
      }
    } catch {}
  }

  if (totalAvailable === 0) {
    return { at: Date.now(), risk: null };
  }

  // Score is balanced across all available proxies:
  // e.g. 1 bullish (+1) + 1 neutral (0) => (+1 / 2) * 100 = +50 (Moderate Risk-On, NOT +100!)
  const score = Math.round((sum / totalAvailable) * 100);
  const risk = {
    score,
    availableProxies: totalAvailable,
    note: notes.join(" · ") || "Equities & Speculative markets neutral",
  };

  return { at: Date.now(), risk };
}

/**
 * Institutional Cross-Asset Risk Beta
 * Quantifies how a symbol responds to systemic risk-on (+1 benefits, -1 suffers, 0 decoupled).
 */
export function riskBeta(symbol, category) {
  if (!symbol) return 0;
  const s = symbol.toUpperCase().replace(/[._-].*$/, "").replace(/m$/, "");

  if (category === "indices" || category === "crypto") return 1.0;

  if (category === "metals") {
    // Gold is decoupled from equity risk-on/off (driven by real yields, central banks, and DXY)
    if (/^(XAUUSD|GOLD)$/.test(s)) return 0.0;
    // Silver has mild industrial demand beta
    if (/^(XAGUSD|SILVER)$/.test(s)) return 0.25;
    return 0.0;
  }

  if (category === "fx") {
    // JPY carry trade: XXXJPY rallies during risk-on expansions
    if (s.endsWith("JPY")) return 1.0;

    // Commodity currencies: High positive beta against USD in risk expansions
    if (/^(AUDUSD|NZDUSD)$/.test(s)) return 0.7;

    // USDCAD: CAD rallies with oil/commodities, causing USDCAD to drop during risk-on
    if (/^USDCAD$/.test(s)) return -0.5;

    // USDCHF: CHF safe-haven flows cause USDCHF to fall during risk-off
    if (/^USDCHF$/.test(s)) return -0.5;

    // European majors: Mild positive beta against USD
    if (/^(EURUSD|GBPUSD)$/.test(s)) return 0.3;

    // Cross-commodity ratios: Neutral
    if (/^AUDNZD$/.test(s)) return 0.0;
  }

  return 0.0;
}

/**
 * Deduplicated, Canonical SMT Pair Correlation Map
 * Wrapped in a dynamic Proxy: Automatically resolves ANY broker-specific symbol
 * (e.g. "USTEC", "US100", "GOLD", "EURUSD.i") to its canonical partner list.
 */
const RAW_SMT_PAIRS = {
  // Indices
  NAS100: ["SP500", "DJ30", "GER40"],
  SP500:  ["NAS100", "DJ30", "GER40"],
  DJ30:   ["NAS100", "SP500"],
  GER40:  ["SP500", "NAS100", "UK100"],
  UK100:  ["GER40", "SP500"],

  // Precious Metals
  XAUUSD: ["XAGUSD"],
  XAGUSD: ["XAUUSD"],

  // FX Majors
  EURUSD: ["GBPUSD"],
  GBPUSD: ["EURUSD"],
  AUDUSD: ["NZDUSD"],
  NZDUSD: ["AUDUSD"],
  USDJPY: ["USDCHF"],
  USDCHF: ["USDJPY"],

  // Crypto
  BTCUSD: ["ETHUSD"],
  ETHUSD: ["BTCUSD"],
};

export const SMT_PAIRS = new Proxy(RAW_SMT_PAIRS, {
  get(target, prop) {
    if (typeof prop !== "string") return target[prop];
    const canon = toCanonicalSymbol(prop);
    return target[canon] || target[prop] || [];
  },
  has(target, prop) {
    if (typeof prop !== "string") return prop in target;
    const canon = toCanonicalSymbol(prop);
    return canon in target || prop in target;
  },
});

/**
 * Returns correlated SMT partner symbols for any symbol (broker or canonical).
 * @param {string} symbol - Broker or canonical symbol name
 * @returns {Array<string>} - Array of canonical partner symbols
 */
export function getSmtPartners(symbol) {
  if (!symbol) return [];
  const canon = toCanonicalSymbol(symbol);
  return RAW_SMT_PAIRS[canon] || RAW_SMT_PAIRS[symbol] || [];
}

/**
 * Evaluates Smart Money Technique (SMT) Divergence across correlated instruments.
 *
 * Requirements for valid SMT:
 *   1. Compares corresponding swing extrema across contemporaneous time windows (within 1 hour).
 *   2. Enforces ATR-scaled tolerance gating to prevent 1-tick false positives.
 *   3. Enforces causal time cutoff: partner bars beyond primary's last closed bar are truncated.
 *   4. Returns confirmation time and bar age for zero-leakage execution.
 *
 * @param {Array} bars - Primary instrument M15 closed bars
 * @param {Array} partnerBars - Partner instrument M15 closed bars
 * @param {string} partnerName - Symbol name of the partner
 * @returns {Object|null} { dir, note, time, confirmedAt, age } or null
 */
export function smtDivergence(bars, partnerBars, partnerName) {
  if (!Array.isArray(bars) || !Array.isArray(partnerBars) || bars.length < 15 || partnerBars.length < 15) {
    return null;
  }

  // 1. Causal Time Truncation: Never allow partner bars to extend beyond primary's current bar time
  const maxPrimarySec = toSec(bars[bars.length - 1]?.time ?? bars[bars.length - 1]?.t);
  if (!maxPrimarySec) return null;

  const cleanPartner = partnerBars.filter(b => toSec(b.time ?? b.t) <= maxPrimarySec);
  if (cleanPartner.length < 15) return null;

  const avgA = avgRange(bars);
  const avgB = avgRange(cleanPartner);
  const tolA = 0.08 * avgA;
  const tolB = 0.08 * avgB;

  const { highs: highsA, lows: lowsA } = findPivots(bars, 3, 3);
  if (highsA.length < 2 && lowsA.length < 2) return null;

  let bearSmt = null;
  let bullSmt = null;

  // Window tolerance: +/- 4 M15 bars (3600 seconds = 1 hour)
  const WINDOW_SEC = 3600;

  // --- Evaluate Highs (Bearish SMT) ---
  if (highsA.length >= 2) {
    const h2A = highsA[highsA.length - 1];
    const h1A = highsA[highsA.length - 2];
    const t2A = toSec(bars[h2A.i]?.time ?? bars[h2A.i]?.t);
    const t1A = toSec(bars[h1A.i]?.time ?? bars[h1A.i]?.t);

    if (t2A > t1A) {
      // Find corresponding high extrema in Partner Asset B in matching time windows
      const pBarsH2 = cleanPartner.filter(b => Math.abs(toSec(b.time ?? b.t) - t2A) <= WINDOW_SEC);
      const pBarsH1 = cleanPartner.filter(b => Math.abs(toSec(b.time ?? b.t) - t1A) <= WINDOW_SEC);

      if (pBarsH2.length > 0 && pBarsH1.length > 0) {
        const h2B = pBarsH2.reduce((max, b) => b.high > max.high ? b : max, pBarsH2[0]);
        const h1B = pBarsH1.reduce((max, b) => b.high > max.high ? b : max, pBarsH1[0]);

        const deltaA = h2A.price - h1A.price;
        const deltaB = h2B.high - h1B.high;

        const aMadeHH = deltaA > tolA;
        const bMadeHH = deltaB > tolB;
        const aFailedHH = deltaA < -tolA;
        const bFailedHH = deltaB < -tolB;

        // Pattern 1: Primary ran stops (Higher High), but Partner failed to make Higher High
        if (aMadeHH && bFailedHH) {
          const pivotTime = Math.max(t2A, toSec(h2B.time ?? h2B.t));
          const confirmedAt = toSec(bars[Math.min(bars.length - 1, h2A.i + 3)]?.time ?? bars[Math.min(bars.length - 1, h2A.i + 3)]?.t);
          const age = bars.length - 1 - (h2A.i + 3);

          if (age <= 36) { // Active within 9 hours
            bearSmt = {
              dir: -1,
              note: `HH unconfirmed by ${partnerName} (LH divergence)`,
              time: pivotTime,
              confirmedAt,
              age,
              divergenceMagnitude: Math.abs(deltaA / avgA),
            };
          }
        }
        // Pattern 2: Primary failed (Lower High), but Partner printed Higher High (Partner is the aggressive runner)
        else if (aFailedHH && bMadeHH) {
          const pivotTime = Math.max(t2A, toSec(h2B.time ?? h2B.t));
          const confirmedAt = toSec(bars[Math.min(bars.length - 1, h2A.i + 3)]?.time ?? bars[Math.min(bars.length - 1, h2A.i + 3)]?.t);
          const age = bars.length - 1 - (h2A.i + 3);

          if (age <= 36) {
            bearSmt = {
              dir: -1,
              note: `LH divergence (${partnerName} printed HH)`,
              time: pivotTime,
              confirmedAt,
              age,
              divergenceMagnitude: Math.abs(deltaB / avgB),
            };
          }
        }
      }
    }
  }

  // --- Evaluate Lows (Bullish SMT) ---
  if (lowsA.length >= 2) {
    const l2A = lowsA[lowsA.length - 1];
    const l1A = lowsA[lowsA.length - 2];
    const t2A = toSec(bars[l2A.i]?.time ?? bars[l2A.i]?.t);
    const t1A = toSec(bars[l1A.i]?.time ?? bars[l1A.i]?.t);

    if (t2A > t1A) {
      // Find corresponding low extrema in Partner Asset B in matching time windows
      const pBarsL2 = cleanPartner.filter(b => Math.abs(toSec(b.time ?? b.t) - t2A) <= WINDOW_SEC);
      const pBarsL1 = cleanPartner.filter(b => Math.abs(toSec(b.time ?? b.t) - t1A) <= WINDOW_SEC);

      if (pBarsL2.length > 0 && pBarsL1.length > 0) {
        const l2B = pBarsL2.reduce((min, b) => b.low < min.low ? b : min, pBarsL2[0]);
        const l1B = pBarsL1.reduce((min, b) => b.low < min.low ? b : min, pBarsL1[0]);

        const deltaA = l2A.price - l1A.price;
        const deltaB = l2B.low - l1B.low;

        const aMadeLL = deltaA < -tolA;
        const bMadeLL = deltaB < -tolB;
        const aFailedLL = deltaA > tolA;
        const bFailedLL = deltaB > tolB;

        // Pattern 1: Primary swept sell-stops (Lower Low), but Partner failed to make Lower Low (Higher Low)
        if (aMadeLL && bFailedLL) {
          const pivotTime = Math.max(t2A, toSec(l2B.time ?? l2B.t));
          const confirmedAt = toSec(bars[Math.min(bars.length - 1, l2A.i + 3)]?.time ?? bars[Math.min(bars.length - 1, l2A.i + 3)]?.t);
          const age = bars.length - 1 - (l2A.i + 3);

          if (age <= 36) {
            bullSmt = {
              dir: 1,
              note: `LL unconfirmed by ${partnerName} (HL divergence)`,
              time: pivotTime,
              confirmedAt,
              age,
              divergenceMagnitude: Math.abs(deltaA / avgA),
            };
          }
        }
        // Pattern 2: Primary held Higher Low, but Partner swept Lower Low
        else if (aFailedLL && bMadeLL) {
          const pivotTime = Math.max(t2A, toSec(l2B.time ?? l2B.t));
          const confirmedAt = toSec(bars[Math.min(bars.length - 1, l2A.i + 3)]?.time ?? bars[Math.min(bars.length - 1, l2A.i + 3)]?.t);
          const age = bars.length - 1 - (l2A.i + 3);

          if (age <= 36) {
            bullSmt = {
              dir: 1,
              note: `HL divergence (${partnerName} printed LL)`,
              time: pivotTime,
              confirmedAt,
              age,
              divergenceMagnitude: Math.abs(deltaB / avgB),
            };
          }
        }
      }
    }
  }

  // Conflict resolution: If both Bullish and Bearish SMT qualify contemporaneously,
  // it indicates non-directional broadening range expansion / chop
  if (bearSmt && bullSmt) {
    if (Math.abs(bearSmt.age - bullSmt.age) <= 3) {
      return null; // Conflicting signals cancel out
    }
    return bearSmt.age < bullSmt.age ? bearSmt : bullSmt;
  }

  return bearSmt || bullSmt || null;
}
