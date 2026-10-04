// Executor context stack — the validation the Executor runs against a
// user-placed setup before/while deciding HOW to enter. Pure function of
// (symbol, frames, dir, setup, cfg): no I/O, no Mongo, no bridge.
//
// Returns { score 0..100, grade, checks[], snapshot }:
//   score    — weighted, normalized confidence in the setup's context
//   grade    — "strong" | "ok" | "weak" (drives entry-mode escalation)
//   checks   — per-category { name, score -1..1, weight, note, applies }
//   snapshot — the auto-judged range/level picture ("auto-adjustable mode")
//
// Category-aware via classifySymbol: currency-strength + correlation only
// apply to fx (and a metals-vs-USD variant); their weight is redistributed
// to the always-on checks for non-fx symbols so the score stays 0..100.

import { computeSymbolBias, aggregate, classifySymbol } from "../bias/engine.js";
import { analyzeStructure } from "../bias/structure.js";
import { liquidityMap, detectQML } from "../bias/liquidity.js";
import { fvgZones, detectOrderBlocks } from "../bias/zones.js";
import { strongLevels } from "../bias/reversals.js";
import { avgRange } from "../patterns/core.js";
import { fvgInducement, ifvgZone, qmlObFvg } from "../algo/confluence.js";
import { classifyRetracement } from "../algo/retracement.js";

const CCY = ["EUR", "GBP", "AUD", "NZD", "USD", "CAD", "CHF", "JPY"];

// assessContext — synchronous; caller supplies frames (getFrames) and, for fx
// strength, an optional prebuilt currencyStrength array (universeStrength) so
// we don't recompute the whole universe per setup on every tick.
export function assessContext(symbol, frames, dir, setup, cfg = {}, universeStrength = null) {
  const dirN = dir === "buy" ? 1 : -1;
  const cat = classifySymbol(symbol);
  const { H4, H1, M15 } = frames || {};
  const checks = [];

  if (!H1?.length || !M15?.length) {
    return { score: 0, grade: "weak", checks: [{ name: "data", score: -1, weight: 1, note: "missing frames", applies: true }], snapshot: null };
  }
  const avgM15 = avgRange(M15);
  const avgH1 = avgRange(H1);
  const px = M15[M15.length - 1].close;

  // ---- 1. structure alignment (H4 + H1 + M15) --------------------------
  const stH4 = H4?.length ? analyzeStructure(H4, avgRange(H4)) : null;
  const stH1 = analyzeStructure(H1, avgH1);
  const stM15 = analyzeStructure(M15, avgM15);
  let structScore = 0;
  const parts = [];
  for (const [tf, st, w] of [["H4", stH4, 0.35], ["H1", stH1, 0.4], ["M15", stM15, 0.25]]) {
    if (!st) continue;
    if (st.dir === dirN && !st.ranging) { structScore += w; parts.push(`${tf}✓`); }
    else if (st.dir === -dirN && !st.ranging) { structScore -= w; parts.push(`${tf}✗`); }
    else parts.push(`${tf}~`);
  }
  // fresh opposing displaced MSS is a strong negative (structure just flipped)
  const oppMss = stM15.lastEvent?.type === "MSS" && stM15.lastEvent.dir === -dirN
    && stM15.lastEvent.displaced && stM15.lastEvent.age <= 12;
  if (oppMss) structScore = Math.min(structScore, -0.6);
  checks.push({ name: "structure", score: clamp1(structScore), weight: cfg.wStructure ?? 22, note: `${parts.join(" ")}${oppMss ? " opposing MSS!" : ""}`, applies: true });

  // ---- 2. symbol's own bias & market brain ------------------------------
  const bias = computeSymbolBias(symbol, frames, {});
  let biasScore = clamp1((bias.score / 60) * dirN); // ±60 → full
  let biasNote = `own score ${bias.score} (${bias.dir || "n/a"})`;
  if (bias.brain?.executionReadiness) {
    const readiness = bias.brain.executionReadiness;
    const allowed = dirN === 1 ? readiness.allowedToLong : readiness.allowedToShort;
    if (!allowed && readiness.blockReasons?.length > 0) {
      biasScore = Math.min(biasScore, -0.5);
      biasNote += ` · BLOCKED by Brain: ${readiness.blockReasons[0]}`;
    } else if (allowed) {
      biasNote += ` · Brain ${readiness.action} (${readiness.conviction}%)`;
    }
  }
  checks.push({ name: "bias", score: biasScore, weight: cfg.wBias ?? 16, note: biasNote, applies: true });

  // ---- 3. currency strength (fx; metals vs USD; else n/a) --------------
  const strengthCheck = { name: "strength", weight: cfg.wStrength ?? 16 };
  if (cat === "fx" && symbol.length >= 6) {
    const by = strengthMap(universeStrength);
    if (by) {
      const base = symbol.slice(0, 3), quote = symbol.slice(3, 6);
      const edge = (by[base] ?? 0) - (by[quote] ?? 0);
      strengthCheck.score = clamp1((edge * dirN) / 50); // edge 50 → full
      strengthCheck.note = `${base}(${by[base] ?? "?"}) vs ${quote}(${by[quote] ?? "?"}) edge ${Math.round(edge)}`;
      strengthCheck.applies = true;
    } else { strengthCheck.applies = false; strengthCheck.note = "no universe strength"; }
  } else if (cat === "metals") {
    const by = strengthMap(universeStrength);
    // metals rise when USD falls: bullish metal wants weak USD
    if (by && by.USD != null) {
      strengthCheck.score = clamp1((-by.USD * dirN) / 50);
      strengthCheck.note = `USD ${by.USD} (metal inverse)`;
      strengthCheck.applies = true;
    } else { strengthCheck.applies = false; strengthCheck.note = "no USD strength"; }
  } else {
    strengthCheck.applies = false; strengthCheck.note = `n/a for ${cat}`;
  }
  checks.push(strengthCheck);

  // ---- 4. correlated market (fx only) ----------------------------------
  const corrCheck = { name: "correlation", weight: cfg.wCorrelation ?? 10 };
  if (cat === "fx" && universeStrength) {
    const by = strengthMap(universeStrength);
    const base = symbol.slice(0, 3), quote = symbol.slice(3, 6);
    // siblings sharing our base should agree with dir; sharing our quote, oppose
    const baseS = by?.[base] ?? 0, quoteS = by?.[quote] ?? 0;
    const agree = Math.sign(baseS) === dirN || Math.sign(quoteS) === -dirN;
    corrCheck.score = agree ? 0.5 : -0.4;
    corrCheck.note = agree ? "partners aligned" : "partners diverging";
    corrCheck.applies = true;
  } else {
    corrCheck.applies = false; corrCheck.note = `n/a for ${cat}`;
  }
  checks.push(corrCheck);

  // ---- 5. liquidity ----------------------------------------------------
  const liq = liquidityMap(M15, avgM15);
  const tp = setup?.tp;
  let liqScore = 0; const liqParts = [];
  const poolsAhead = dirN === 1 ? liq.draws.above : liq.draws.below;
  const poolBeyondTp = poolsAhead.find((p) => (dirN === 1 ? p.price >= tp : p.price <= tp));
  if (poolBeyondTp) { liqScore += 0.5; liqParts.push(`pool beyond TP`); }
  else if (poolsAhead.length) { liqScore += 0.2; liqParts.push(`pool ahead`); }
  const fuel = liq.sweeps.find((s) => s.side === -dirN && s.age <= 40);
  if (fuel) { liqScore += 0.4; liqParts.push(`${fuel.name} swept (fuel)`); }
  // target pool already swept = our draw is spent
  const spent = liq.sweeps.find((s) => (dirN === 1 ? s.price >= tp : s.price <= tp) && s.age <= 20);
  if (spent) { liqScore -= 0.5; liqParts.push(`TP pool already swept`); }
  checks.push({ name: "liquidity", score: clamp1(liqScore), weight: cfg.wLiquidity ?? 14, note: liqParts.join(", ") || "neutral", applies: true });

  // ---- 6. confluence around the user's zone ----------------------------
  const entryZone = { price: setup?.entry, top: setup?.entry, bottom: setup?.sl, kind: "user", tf: setup?.tf };
  let confScore = 0; const confParts = [];
  const induc = safe(() => fvgInducement({ M15 }, dir, entryZone, cfg));
  if (induc?.hit) { confScore += 0.4; confParts.push("FVG+inducement"); }
  const ifvg = safe(() => ifvgZone({ H1, M15 }, dir, cfg));
  if (ifvg?.hit) { confScore += 0.4; confParts.push("IFVG"); }
  const qml = safe(() => qmlObFvg({ M15 }, dir, cfg));
  if (qml?.hit) { confScore += 0.6; confParts.push("QML+OB+FVG"); }
  checks.push({ name: "confluence", score: clamp1(confScore), weight: cfg.wConfluence ?? 14, note: confParts.join(", ") || "none", applies: true });

  // ---- 7. retracement type ---------------------------------------------
  const rt = safe(() => classifyRetracement(M15, dir, cfg));
  let retrScore = 0;
  if (rt) {
    if (rt.type === "reversal") retrScore = -1;
    else if (rt.type === "ote" || rt.type === "liquidity-building") retrScore = 0.7;
    else if (rt.type === "deep") retrScore = -0.3;
    else retrScore = -0.1; // weak/premature
  }
  checks.push({ name: "retracement", score: retrScore, weight: cfg.wRetracement ?? 8, note: rt ? `${rt.type} (${Math.round((rt.depth || 0) * 100)}%)` : "n/a", applies: true });

  // ---- score: weighted mean over applicable checks, mapped 0..100 ------
  let wSum = 0, sSum = 0;
  for (const c of checks) {
    if (c.applies === false) continue;
    wSum += c.weight;
    sSum += c.weight * c.score; // score ∈ [-1,1]
  }
  const norm = wSum ? sSum / wSum : 0;          // [-1,1]
  const score = Math.round((norm + 1) * 50);    // 0..100
  const grade = score >= (cfg.directMin ?? 70) ? "strong" : score >= (cfg.confirmMin ?? 45) ? "ok" : "weak";

  // ---- auto-judge snapshot --------------------------------------------
  const snapshot = judgeSnapshot({ H4, H1, M15, avgH1, avgM15, dirN, px, setup });

  return { score, grade, checks, snapshot };
}

// The "auto-adjustable mode" picture: ranges, premium/discount, zone match,
// strong level behind SL, distance-to-entry. Advisory only — the engine
// decides whether to apply autoAdjust nudges from this.
function judgeSnapshot({ H4, H1, M15, avgH1, avgM15, dirN, px, setup }) {
  const rangeBars = (H4?.length ? H4 : H1).slice(-90);
  const rHi = Math.max(...rangeBars.map((b) => b.high));
  const rLo = Math.min(...rangeBars.map((b) => b.low));
  const entry = setup?.entry ?? px;
  const pos = (entry - rLo) / Math.max(rHi - rLo, 1e-9); // 0 range low, 1 range high
  const discount = dirN === 1 ? pos <= 0.5 : pos >= 0.5;

  // nearest FVG/OB overlapping the user's entry (zone match)
  const zones = [
    ...fvgZones(M15, avgM15).filter((z) => z.dir === dirN && z.state === "open").map((z) => ({ ...z, kind: "fvg", tf: "M15" })),
    ...fvgZones(H1, avgH1).filter((z) => z.dir === dirN && z.state === "open").map((z) => ({ ...z, kind: "fvg", tf: "H1" })),
    ...detectOrderBlocks(M15, avgM15).filter((z) => z.dir === dirN && !z.tapped).map((z) => ({ ...z, kind: "ob", tf: "M15" })),
    ...detectOrderBlocks(H1, avgH1).filter((z) => z.dir === dirN && !z.tapped).map((z) => ({ ...z, kind: "ob", tf: "H1" })),
  ];
  const zoneMatch = zones.find((z) => entry >= z.bottom && entry <= z.top)
    || zones.sort((a, b) => Math.abs((a.top + a.bottom) / 2 - entry) - Math.abs((b.top + b.bottom) / 2 - entry))[0] || null;

  // strong level just beyond the SL (for auto-widen)
  const strong = strongLevels(H1, avgH1);
  const slGuard = dirN === 1
    ? strong.filter((s) => s.side === "low" && s.price < setup?.sl).sort((a, b) => b.price - a.price)[0]
    : strong.filter((s) => s.side === "high" && s.price > setup?.sl).sort((a, b) => a.price - b.price)[0];

  const zoneH = Math.abs((setup?.entry ?? px) - (setup?.sl ?? px)) || avgM15;
  const distToEntry = dirN === 1 ? px - (setup?.entry ?? px) : (setup?.entry ?? px) - px;

  return {
    range: { hi: r5(rHi), lo: r5(rLo), pos: Math.round(pos * 100) },
    location: discount ? (dirN === 1 ? "discount" : "premium") : (dirN === 1 ? "premium" : "discount"),
    zoneMatch: zoneMatch ? { kind: zoneMatch.kind, tf: zoneMatch.tf, top: r5(zoneMatch.top), bottom: r5(zoneMatch.bottom) } : null,
    slGuard: slGuard ? { side: slGuard.side, price: r5(slGuard.price) } : null,
    zoneHeight: r5(zoneH),
    distToEntryZones: Math.round((distToEntry / zoneH) * 100) / 100,
  };
}

function strengthMap(universeStrength) {
  if (!Array.isArray(universeStrength) || !universeStrength.length) return null;
  return Object.fromEntries(universeStrength.map((c) => [c.ccy, c.score]));
}
const clamp1 = (v) => Math.max(-1, Math.min(1, v));
const safe = (fn) => { try { return fn(); } catch { return null; } };
const r5 = (v) => (v == null ? null : Math.round(v * 1e5) / 1e5);

export { CCY };
