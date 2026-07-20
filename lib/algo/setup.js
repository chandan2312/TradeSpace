// Setup finder — decides IF and WHERE a candidate pair is tradeable.
//
// Given multi-TF frames and a direction (from currency strength), this answers
// the checklist the user trades manually:
//   1. structure aligned?      H4/H1 structure agrees with dir (or fresh MSS)
//   2. liquidity story?        a sweep already fueled the move, or the draw sits ahead
//   3. trend room?             distance to the target pool ≥ minRR × risk — not exhausted
//   4. best area?              freshest unmitigated H1/M15 FVG or OB on our side,
//                              in discount (buy) / premium (sell) of the H4 range
//   5. SL placement?           beyond the zone AND beyond the nearest strong low/high
//   6. TP placement?           front-run the nearest opposing untapped pool
// Returns null (no trade) or a scored candidate ready for the monitor loop.
//
// Pure function of (frames, dir, cfg) — no I/O, fully unit-testable.

import { avgRange } from "../patterns/core.js";
import { analyzeStructure } from "../bias/structure.js";
import { liquidityMap, sessionOf } from "../bias/liquidity.js";
import { fvgZones, detectOrderBlocks } from "../bias/zones.js";
import { strongLevels } from "../bias/reversals.js";
import { fvgInducement, ifvgZone, qmlObFvg } from "./confluence.js";
import { classifyRetracement } from "./retracement.js";
import { detectTrendlineLiquidity } from "../bias/buildup.js";

export function findSetup(symbol, frames, dir, cfg = {}) {
  const {
    minRR = 2,
    minScore = 60,
    maxZoneAgeBars = 60,   // stale zones lose relevance
  } = cfg;

  const { H4, H1, M15 } = frames || {};
  if (!H4?.length || !H1?.length || !M15?.length) return null;
  if (H1.length < 60 || M15.length < 80) return null;

  const px = M15[M15.length - 1].close;
  const avgH1 = avgRange(H1);
  const avgM15 = avgRange(M15);
  const reasons = [];
  let score = 0;
  let retraceType = null;

  // ---- 1. structure alignment (H4 + H1) --------------------------------
  const stH4 = analyzeStructure(H4, avgRange(H4));
  const stH1 = analyzeStructure(H1, avgH1);
  const freshMssH1 = stH1.lastEvent?.type === "MSS" && stH1.lastEvent.dir === dir
    && stH1.lastEvent.displaced && stH1.lastEvent.age <= 30;
  const h4Aligned = stH4.dir === dir && !stH4.ranging;
  const h1Aligned = stH1.dir === dir || freshMssH1;
  if (!h1Aligned) return null;                       // hard gate: never fade H1 structure
  score += 20; reasons.push(`H1 structure ${freshMssH1 ? "fresh displaced MSS" : stH1.seq} with dir`);
  if (h4Aligned) { score += 15; reasons.push(`H4 structure ${stH4.seq} aligned`); }
  else if (stH4.dir === -dir && !stH4.ranging) { score -= 10; reasons.push("H4 counter-trend (fade)"); }

  // ---- 2. liquidity story (M15 map) ------------------------------------
  const liq = liquidityMap(M15, avgM15);
  const tlLiq = detectTrendlineLiquidity(M15, avgM15);
  
  const allSweeps = [...liq.sweeps, ...tlLiq.sweeps.map(s => ({ name: `${s.touches}-touch ${s.type}`, side: s.side, age: s.age }))];
  allSweeps.sort((a, b) => a.age - b.age);

  // a recent sweep AGAINST our direction's opposing side = stop hunt fuel:
  // buy → a sell-side (low) sweep; sell → a buy-side (high) sweep
  const fuelSweep = allSweeps.find((s) => s.side === -dir && s.age <= 40);
  if (fuelSweep) { score += 20; reasons.push(`${fuelSweep.name} swept ${fuelSweep.age} bars ago (fuel)`); }

  // ---- 3. target pool + trend room --------------------------------------
  // TP target = nearest opposing untapped pool in our direction of travel
  const basePools = dir === 1 ? liq.draws.above : liq.draws.below;
  const tlPools = tlLiq.draws
    .filter(d => d.side === dir && (dir === 1 ? d.start.price > px : d.start.price < px))
    .map(d => ({ name: `${d.touches}-touch ${d.type}`, price: d.start.price, side: d.side }));
    
  const pools = [...basePools, ...tlPools];
  pools.sort((a, b) => dir === 1 ? a.price - b.price : b.price - a.price);

  const pool = pools[0] || null;
  if (!pool) return null;                            // nothing to run toward → no trade

  // ---- 4. entry zone -----------------------------------------------------
  // freshest unmitigated FVG/OB on our side, below (buy) / above (sell) price
  const zone = pickZone(H1, M15, dir, px, { avgH1, avgM15, maxZoneAgeBars });
  if (!zone) return null;
  score += zone.kind === "fvg" ? 12 : 10;
  reasons.push(`${zone.tf} ${zone.kind.toUpperCase()} entry zone (${zone.age} bars old)`);

  // premium/discount of the recent H4 range
  const rangeBars = H4.slice(-90);
  const rHi = Math.max(...rangeBars.map((b) => b.high));
  const rLo = Math.min(...rangeBars.map((b) => b.low));
  const zoneMid = (zone.top + zone.bottom) / 2;
  const pos = (zoneMid - rLo) / Math.max(rHi - rLo, 1e-9); // 0 = range low, 1 = range high
  const goodArea = dir === 1 ? pos <= 0.5 : pos >= 0.5;
  if (goodArea) { score += 12; reasons.push(`zone in ${dir === 1 ? "discount" : "premium"} (${Math.round(pos * 100)}% of H4 range)`); }
  else { score -= 8; reasons.push(`zone in ${dir === 1 ? "premium" : "discount"} — chasing`); }

  // ---- 5. SL: beyond zone, respecting strong levels ----------------------
  const entry = dir === 1 ? zone.top : zone.bottom;  // conservative: front edge
  let sl = dir === 1 ? zone.bottom - 0.25 * avgH1 : zone.top + 0.25 * avgH1;
  
  // enforce minimum risk (anchored to H1 to avoid spread/commission erosion on micro ranges)
  let risk = Math.abs(entry - sl);
  const minRisk = 0.75 * avgH1;
  if (risk < minRisk) {
    sl = dir === 1 ? entry - minRisk : entry + minRisk;
    risk = minRisk;
    reasons.push(`SL widened to H1 minimum ${minRisk.toFixed(5)}`);
  }

  const strong = strongLevels(H1, avgH1);
  const guard = dir === 1
    ? strong.filter((s) => s.side === "low" && s.price < entry).sort((a, b) => b.price - a.price)[0]
    : strong.filter((s) => s.side === "high" && s.price > entry).sort((a, b) => a.price - b.price)[0];
  if (guard) {
    const guarded = dir === 1 ? guard.price - 0.25 * avgH1 : guard.price + 0.25 * avgH1;
    // only widen to the strong level if it doesn't blow up risk (≤1.8× zone stop)
    if (Math.abs(entry - guarded) <= 1.8 * risk && Math.abs(entry - guarded) > risk) {
      sl = guarded;
      reasons.push(`SL behind strong ${guard.side} @ ${round5(guard.price)}`);
      score += 8;
    }
  }

  // ---- 6. TP: front-run the pool -----------------------------------------
  const tp = dir === 1 ? pool.price - 0.15 * avgH1 : pool.price + 0.15 * avgH1;
  // hard gate: TP must be logically beyond the entry
  if (dir === 1 && tp <= entry) return null;
  if (dir === -1 && tp >= entry) return null;
  
  const finalRisk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (finalRisk <= 0) return null;
  const rr = reward / finalRisk;
  if (rr < minRR) return null;                       // hard gate: not enough room
  score += Math.min(15, Math.round(rr * 4));
  reasons.push(`RR ${rr.toFixed(2)} into ${pool.name} @ ${round5(pool.price)}`);

  // exhaustion logic removed: penalizing strong impulses at the moment of 
  // FVG creation artificially blinded the engine to high-momentum breakouts.
  // RR and TP-hit invalidate clauses correctly protect against actual exhaustion.

  // killzone bonus: setups born in London/NY behave better
  const sess = sessionOf(M15[M15.length - 1].time);
  if (sess.id === "london" || sess.id === "ny") { score += 5; reasons.push(`${sess.label} session`); }

  // ---- 9. ICT composite confluence (FVG+inducement, IFVG, QML+OB+FVG) ------
  // additive + configurable — each can raise the score, none can hard-kill.
  const entryZone = { price: entry, top: zone.top, bottom: zone.bottom, kind: zone.kind, tf: zone.tf };
  if (cfg.confluence !== false) {
    const induc = fvgInducement({ M15 }, dirStr(dir), entryZone, cfg);
    if (induc?.hit) { score += induc.score; reasons.push(`+${induc.score} ${induc.note}`); }
    const ifvg = ifvgZone({ H1, M15 }, dirStr(dir), cfg);
    if (ifvg?.hit) { score += ifvg.score; reasons.push(`+${ifvg.score} ${ifvg.note}`); }
    const qml = qmlObFvg({ M15 }, dirStr(dir), cfg);
    if (qml?.hit) { score += qml.score; reasons.push(`+${qml.score} ${qml.note}`); }
  }

  // ---- 10. retracement type -----------------------------------------------
  if (cfg.retrace !== false) {
    const rt = classifyRetracement(M15, dirStr(dir), cfg);
    if (rt) { score += rt.score; reasons.push(`retrace ${rt.type} (${rt.note})`); retraceType = rt; }
  }

  if (score < minScore) return null;

  return {
    symbol,
    dir: dir === 1 ? "buy" : "sell",
    entry: { price: round5(entry), zoneTop: round5(zone.top), zoneBottom: round5(zone.bottom), kind: zone.kind, tf: zone.tf },
    sl: round5(sl),
    tp: round5(tp),
    rr: Math.round(rr * 100) / 100,
    score: Math.round(score),
    reasons,
    pool: { name: pool.name, price: round5(pool.price) },
    retraceType: retraceType || null,
  };
}

const dirStr = (dir) => (dir === 1 ? "buy" : "sell");

// freshest unmitigated FVG/OB on the dir side, strictly beyond current price
// (a zone price must RETRACE into — that's the pullback entry)
function pickZone(H1, M15, dir, px, { avgH1, avgM15, maxZoneAgeBars }) {
  const cands = [];
  for (const [tf, bars, avg] of [["H1", H1, avgH1], ["M15", M15, avgM15]]) {
    for (const z of fvgZones(bars, avg)) {
      if (z.dir !== dir || z.state !== "open" || z.age > maxZoneAgeBars) continue;
      // buy: price must be above the zone's bottom (can be inside or above)
      if (dir === 1 ? z.bottom < px : z.top > px)
        cands.push({ tf, kind: "fvg", top: z.top, bottom: z.bottom, age: z.age });
    }
    for (const z of detectOrderBlocks(bars, avg)) {
      if (z.dir !== dir || z.tapped || z.age > maxZoneAgeBars) continue;
      if (dir === 1 ? z.bottom < px : z.top > px)
        cands.push({ tf, kind: "ob", top: z.top, bottom: z.bottom, age: z.age });
    }
  }
  if (!cands.length) return null;
  // nearest to price wins (first zone price touches on the way back);
  // among near-equals prefer H1 (higher-TF zones are stronger)
  cands.sort((a, b) => {
    const da = dir === 1 ? px - a.top : a.bottom - px;
    const db = dir === 1 ? px - b.top : b.bottom - px;
    if (Math.abs(da - db) > 1e-9) return da - db;
    return a.tf === "H1" ? -1 : 1;
  });
  return cands[0];
}

// fraction of the current H1 leg already travelled (0 fresh → 1 fully extended)
function legTravel(H1, dir) {
  const n = H1.length;
  const look = H1.slice(-40);
  const px = H1[n - 1].close;
  const hi = Math.max(...look.map((b) => b.high));
  const lo = Math.min(...look.map((b) => b.low));
  const span = hi - lo;
  if (span <= 0) return null;
  return dir === 1 ? (px - lo) / span : (hi - px) / span;
}

const round5 = (v) => Math.round(v * 1e5) / 1e5;
