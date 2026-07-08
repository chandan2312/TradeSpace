import { avgRange, findPivots } from "../patterns/core.js";
import { analyzeStructure } from "./structure.js";
import { getFrames } from "./data.js";

// Beyond-candles input #2: the rest of the market.
// No symbol trades alone — indices and crypto set the risk tone, the dollar
// sets the FX tone, and correlated pairs expose engineered moves (SMT).

// ---- market risk sentiment from broker cross-asset proxies ----------------
// US500 (equities) + BTCUSD (speculative appetite). Structure-based, so it's
// the same narrative language as everything else. Cached via data.js TTLs.
const RISK_PROXIES = ["US500", "BTCUSD"];
const g = globalThis;
if (!g._tsRiskCtx) g._tsRiskCtx = { at: 0, risk: null };

export async function getMarketContext() {
  if (Date.now() - g._tsRiskCtx.at < 120_000) return g._tsRiskCtx;

  let sum = 0;
  let n = 0;
  const notes = [];
  for (const sym of RISK_PROXIES) {
    try {
      const frames = await getFrames(sym);
      const bars = frames.H1 || frames.H4;
      if (!bars) continue;
      const st = analyzeStructure(bars, avgRange(bars));
      let d = st.dir;
      const ev = st.lastEvent;
      if (ev?.type === "MSS" && ev.displaced && ev.age <= 12) d = ev.dir; // fresh shift wins
      if (d !== 0) {
        sum += d;
        n++;
        notes.push(`${sym} ${d > 0 ? "↑" : "↓"}`);
      }
    } catch { /* proxy unavailable on this broker — skip */ }
  }

  const risk = n ? { score: Math.round((sum / n) * 100), note: notes.join(" · ") } : null;
  g._tsRiskCtx = { at: Date.now(), risk };
  return g._tsRiskCtx;
}

// how a symbol responds to risk-on (+1 benefits, −1 suffers, 0 unrelated)
export function riskBeta(symbol, category) {
  const s = symbol.toUpperCase();
  if (category === "indices" || category === "crypto") return 1;
  if (category === "metals" && /^XAU|GOLD/.test(s)) return -1; // safe haven
  if (category === "fx") {
    if (/JPY$|JPYm?$/.test(s.replace(/[._-].*$/, ""))) return 1;  // XXXJPY = carry, risk-on up
    if (/^(AUD|NZD)/.test(s)) return 0.5;
    if (/CHF/.test(s) && !s.startsWith("CHF")) return 0.5;
  }
  return 0;
}

// ---- SMT divergence (ICT): correlated pair disagreement -------------------
// If this symbol printed a higher high but its partner failed to, smart money
// didn't sponsor the move — score against the lone runner. Mirrored for lows.
export const SMT_PAIRS = {
  EURUSD: ["GBPUSD"],
  GBPUSD: ["EURUSD"],
  AUDUSD: ["NZDUSD"],
  NZDUSD: ["AUDUSD"],
  USDJPY: ["USDCHF"],
  USDCHF: ["USDJPY"],
  US30: ["NAS100", "US500"],
  NAS100: ["US30", "US500"],
  US500: ["US30", "NAS100"],
  XAUUSD: ["XAGUSD"],
  XAGUSD: ["XAUUSD"],
  BTCUSD: ["ETHUSD"],
  ETHUSD: ["BTCUSD"],
};

// bars/partnerBars: M15 frames. Returns { dir, note } or null.
export function smtDivergence(bars, partnerBars, partnerName) {
  if (!bars || !partnerBars) return null;
  const a = lastTwoSwings(bars);
  const b = lastTwoSwings(partnerBars);
  if (!a || !b) return null;

  // swings must be roughly contemporaneous to compare legs
  const aligned = (x, y) => Math.abs(x - y) <= 12 * 900; // ≤ 12 M15 bars apart
  if (a.h2 && b.h2 && aligned(a.h2.time, b.h2.time)) {
    const aHH = a.h2.price > a.h1.price;
    const bHH = b.h2.price > b.h1.price;
    if (aHH && !bHH) return { dir: -1, note: `HH unconfirmed by ${partnerName}` };
  }
  if (a.l2 && b.l2 && aligned(a.l2.time, b.l2.time)) {
    const aLL = a.l2.price < a.l1.price;
    const bLL = b.l2.price < b.l1.price;
    if (aLL && !bLL) return { dir: 1, note: `LL unconfirmed by ${partnerName}` };
  }
  return null;
}

function lastTwoSwings(bars) {
  const { highs, lows } = findPivots(bars, 3, 3);
  if (highs.length < 2 || lows.length < 2) return null;
  const [h1, h2] = highs.slice(-2).map((p) => ({ price: p.price, time: bars[p.i].time }));
  const [l1, l2] = lows.slice(-2).map((p) => ({ price: p.price, time: bars[p.i].time }));
  return { h1, h2, l1, l2 };
}
