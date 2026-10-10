import { avgRange, detectGaps } from "../patterns/core.js";
import { analyzeStructure } from "./structure.js";
import { liquidityMap, detectQML, sessionOf } from "./liquidity.js";
import { smtDivergence, riskBeta, SMT_PAIRS } from "./context.js";
import { newsRisk, symbolCurrencies } from "./news.js";
import { sweepWickCandle, vReversal, grindThenDisplacement, strongLevels } from "./reversals.js";
import { detectOrderBlocks, fvgZones } from "./zones.js";
import { detectSetup } from "./playbook.js";
import { profiles, volRatio, relParticipation } from "./volume.js";
import { lensFitness, lensVote, stability } from "./lenses.js";
import { detectTrendlineLiquidity } from "./buildup.js";
import { analyzeAllDealingRanges } from "./ranges.js";
import { analyze4HFVGs } from "./htfFvg.js";
import { analyzeHTFLiquidity } from "./htfLiquidity.js";
import { evaluateMarketBrain } from "./brain.js";

// Bias engine v5 — lens-ensemble scoring for one specific playbook:
//   HTF bias (1D/4H/1H) → M15 session/PD/PW sweeps → M15 MSS → FVG/iFVG/QML.
//
// Evidence pipeline:
//   1. DRIVES — directional facts. Each is tagged with a pillar (for the
//      HTF/Intraday/Liquidity/Context diagram) AND a lens (structure /
//      liquidity / reversal / fvg / ob / sr / flow — which concept-model of
//      the market it supports).
//   2. LENS VOTE — the final score is a regime-weighted vote of the seven
//      lenses (lenses.js), not a single weighted sum. Disagreement between
//      lenses is surfaced (agreement %, contested flag) and the verdict is
//      stress-tested by ±30% weight jitter (stability %).
//   3. DAMPENERS — reasons to distrust the number (chop, news, extension,
//      off-hours, counter-liquidity, mixed evidence) scale it multiplicatively.
//   4. GROUP PASS — aggregate() applies category consensus, FX currency
//      strength and USD spillover, then dampeners last.
//
// Anti-lag rules: sweeps score AGAINST their direction, a fresh displaced MSS
// overrides its TF's stale structure, untapped pools are magnets, everything
// decays with age.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const decay = (age, full, zero) => (age <= full ? 1 : clamp(1 - (age - full) / (zero - full), 0, 1));

const TF_CONF = {
  D1: { w: 4, mssFull: 3, mssZero: 10, pillar: "htf" },
  H4: { w: 6, mssFull: 6, mssZero: 18, pillar: "htf" },
  H1: { w: 4, mssFull: 8, mssZero: 24, pillar: "htf" },
  M15: { w: 3, mssFull: 12, mssZero: 40, pillar: "intraday" },
};

export function computeSymbolBias(symbol, frames, extras = {}) {
  const category = classifySymbol(symbol);
  const drives = []; // { pillar, lens, label, dir, w, note }
  const damps = [];  // { label, mult, note }
  const layers = {};
  const requiredTfs = Object.keys(TF_CONF);
  const missing = requiredTfs.filter((tf) => !frames[tf]);

  let reversalPush = 0;
  let htfSum = 0;
  let triggerSum = 0;
  let macroTrend = 0; // The true direction based on strong base/ceiling

  // ---------- structure per TF (MSS-aware; MSS flips the drive to the reversal lens) ----------
  const structures = {};
  for (const [tf, conf] of Object.entries(TF_CONF)) {
    const bars = frames[tf];
    if (!bars) continue;
    const avg = avgRange(bars);
    const st = analyzeStructure(bars, avg);
    structures[tf] = st;
    let dir = st.dir;
    let w = conf.w * (st.ranging ? 0.4 : st.strength);
    let note = st.seq;
    let lens = "structure";

    const ev = st.lastEvent;
    if (ev && ev.type === "MSS" && ev.displaced) {
      const k = decay(ev.age, conf.mssFull, conf.mssZero);
      if (k > 0) {
        dir = ev.dir;
        w = conf.w * (0.6 + 0.4 * k) + 4 * k;
        note = `MSS ${ev.dir > 0 ? "↑" : "↓"} ${ev.age} bars ago, displaced`;
        lens = "reversal";
        const vr = volRatio(bars, ev.i);
        if (vr != null && vr >= 1.5) { w *= 1.15; note += `, ${vr}× vol`; }
        else if (vr != null && vr <= 0.6) { w *= 0.85; note += `, thin ${vr}× vol`; }
        if (tf === "H1" || tf === "M15") {
          reversalPush += ev.dir * 10 * k;
          triggerSum += ev.dir * 10 * k;
        }
      }
    }

    layers[tf] = { dir, note };
    drives.push({ pillar: conf.pillar, lens, label: `${tf} structure`, dir, w, note });
    if (conf.pillar === "htf") htfSum += dir * w;
  }

  // Auxiliary structures for Market Brain & Horizon Gatekeepers (M30, M5)
  for (const tf of ["M30", "M5", ...(frames.M1 ? ["M1"] : [])]) {
    const bars = frames[tf] || (tf === "M30" ? frames["30M"] : null);
    if (bars && !structures[tf]) {
      const avg = avgRange(bars);
      structures[tf] = analyzeStructure(bars, avg);
    }
  }

  // Derive macroTrend objectively from higher timeframe structure
  macroTrend = structures.D1?.dir || structures.H4?.dir || 0;

  // ---------- HTF reversal anatomy: V-shapes, sweep-rejection wicks ----------
  for (const [tf, w, fullAge, zeroAge] of [["D1", 10, 3, 8], ["H4", 8, 6, 16]]) {
    const bars = frames[tf];
    if (!bars) continue;
    const avg = avgRange(bars);

    const sigs = [sweepWickCandle(bars, avg), vReversal(bars, avg)].filter(Boolean);
    const sig = sigs.sort((a, b) => a.age - b.age)[0];
    if (sig) {
      const k = decay(sig.age, fullAge, zeroAge);
      if (k > 0) {
        const wEff = w * k * (sig.grade === "A" ? 1.15 : 1);
        drives.push({
          pillar: "htf", lens: "reversal", label: `${tf} ${sig.kind}`, dir: sig.dir, w: wEff,
          note: `${sig.grade === "A" ? "swept liquidity, " : ""}${sig.age} bars ago`,
        });
        reversalPush += sig.dir * wEff * 0.7;
      }
    }

    // standing protected extremes — defended reversal-born levels (The Macro Base / Ceiling)
    // Only active when price is in reasonable proximity or formed recently
    const px = bars[bars.length - 1].close;
    const lvls = strongLevels(bars, avg);
    const low = lvls.filter((l) => l.side === "low" && l.price < px).sort((a, b) => b.price - a.price)[0];
    const high = lvls.filter((l) => l.side === "high" && l.price > px).sort((a, b) => a.price - b.price)[0];
    const baseW = tf === "D1" ? 18 : 14;
    
    if (low) {
      const distLow = px - low.price;
      if (distLow <= 4.5 * avg || low.age <= 16) {
        const prox = clamp(1 - (distLow / (6 * avg)), 0.5, 1.0);
        const effW = Math.round(baseW * prox);
        drives.push({ pillar: "htf", lens: "sr", label: `${tf} strong base holding`, dir: 1, w: effW, note: `${low.kind} low, macro support` });
        if (tf === "H4" || tf === "D1") htfSum += effW;
      }
    }
    if (high) {
      const distHigh = high.price - px;
      if (distHigh <= 4.5 * avg || high.age <= 16) {
        const prox = clamp(1 - (distHigh / (6 * avg)), 0.5, 1.0);
        const effW = Math.round(baseW * prox);
        drives.push({ pillar: "htf", lens: "sr", label: `${tf} strong ceiling holding`, dir: -1, w: effW, note: `${high.kind} high, macro resistance` });
        if (tf === "H4" || tf === "D1") htfSum -= effW;
      }
    }
  }

  // ---------- HTF POIs (FVGs and OBs for fractal sweep validation) ----------
  const htfPOIs = [];
  for (const tf of ["H1", "H4"]) {
    if (!frames[tf]) continue;
    const avg = avgRange(frames[tf]);
    fvgZones(frames[tf], avg).filter(z => z.state === "open").forEach(z => htfPOIs.push({ type: `${tf} FVG`, dir: z.dir, top: z.top, bottom: z.bottom }));
    detectOrderBlocks(frames[tf], avg).filter(z => z.age < 50).forEach(z => htfPOIs.push({ type: `${tf} OB`, dir: z.dir, top: z.top, bottom: z.bottom }));
  }

  // ---------- 4H FVGs (Respected vs Unrespected Lifecycle & Order Flow) ----------
  const htfFvgData = analyze4HFVGs(frames.H4);
  for (const g of htfFvgData.respected.filter(g => g.ageBars <= 16)) {
    const k = decay(g.ageBars, 4, 16);
    if (k > 0) {
      const w = 14 * k * (g.respectQuality === "A_PRIME_CE_DEFENDED" ? 1.15 : 1);
      drives.push({
        pillar: "htf", lens: "fvg",
        label: `4H ${g.dir > 0 ? "Bullish" : "Bearish"} FVG respected`,
        dir: g.dir, w,
        note: `defended ${g.ageBars} bars ago (${g.respectQuality.replace(/_/g, " ")})`,
      });
      htfSum += g.dir * w;
    }
  }

  for (const g of htfFvgData.unrespected.filter(g => g.violatedAt != null && g.violatedAt <= 16)) {
    const k = decay(g.violatedAt, 4, 16);
    if (k > 0) {
      const invDir = -g.dir;
      const w = 12 * k;
      drives.push({
        pillar: "htf", lens: "fvg",
        label: `4H ${g.dir > 0 ? "Bullish" : "Bearish"} FVG violated (iFVG)`,
        dir: invDir, w,
        note: `invalidation inverted ${g.violatedAt} bars ago into ${invDir > 0 ? "support" : "resistance"}`,
      });
      htfSum += invDir * w;
    }
  }

  if (htfFvgData.active) {
    drives.push({
      pillar: "htf", lens: "fvg",
      label: `Testing 4H ${htfFvgData.active.dir > 0 ? "Bull" : "Bear"} FVG`,
      dir: htfFvgData.active.dir, w: 7,
      note: "price actively inside 4H gap zone",
    });
  }

  const checkMitigation = (extremePx, expectedReactionDir) => {
    // If a sweep triggers a bearish reaction (expectedReactionDir = -1), the hunt spiked UP. 
    // We look for a Bearish HTF POI (dir = -1) that the spike tapped.
    return htfPOIs.find(z => z.dir === expectedReactionDir && extremePx >= z.bottom && extremePx <= z.top);
  };

  // ---------- liquidity: sweeps / breaks / draws / builds (M15) ----------
  const intraday = frames.M15;
  let session = null;
  let liq = null;
  let intradayAvg = 0;
  if (intraday) {
    intradayAvg = avgRange(intraday);
    const px = intraday[intraday.length - 1].close;
    liq = liquidityMap(intraday, intradayAvg);
    session = sessionOf(intraday[intraday.length - 1].time);

    for (const s of liq.sweeps) {
      const k = decay(s.age, 8, 48);
      if (k <= 0) continue;
      const dir = -s.side;
      const sBar = intraday[s.sweptAt];
      const killzone = sessionOf(sBar.time);
      const sessionMult = (killzone.id === "london" || killzone.id === "ny") ? 1.3 : 1.0;

      let w = 12 * s.weightMul * k * sessionMult;
      let note = `stop hunt ${s.age} bars ago`;
      if (sessionMult > 1) note += ` (${killzone.label} KZ)`;

      const vr = volRatio(intraday, s.sweptAt);
      if (vr != null && vr >= 1.8) { w *= 1.25; note += `, climactic ${vr}× vol`; }
      else if (vr != null && vr <= 0.7) { w *= 0.75; note += `, thin ${vr}× vol`; }

      const extremePx = s.side === 1 ? sBar.high : sBar.low;
      const mitigation = checkMitigation(extremePx, dir);
      if (mitigation) {
        w *= 1.5; // God Tier fractal alignment
        note += ` + tapped ${mitigation.type}`;
      }

      drives.push({ pillar: "liquidity", lens: "liquidity", label: `${s.name} swept`, dir, w, note });
      reversalPush += dir * w * 0.8;
      triggerSum += dir * w * 0.6;
    }

    for (const lv of liq.levels) {
      if (lv.state !== "broken" || lv.brokenAt == null) continue;
      const k = decay(intraday.length - 1 - lv.brokenAt, 12, 60);
      if (k <= 0) continue;
      let w = 7 * k;
      let note = "acceptance beyond level";
      const vr = volRatio(intraday, lv.brokenAt);
      if (vr != null && vr <= 0.7) { w *= 0.7; note = `low-volume break (${vr}×) — trap risk`; }
      drives.push({ pillar: "liquidity", lens: "sr", label: `${lv.name} broken & holding`, dir: lv.side, w, note });
    }

    const near = (arr) => arr.find((lv) => Math.abs(lv.price - px) <= 25 * intradayAvg);
    const up = near(liq.draws.above);
    const dn = near(liq.draws.below);
    if (up && (!dn || Math.abs(up.price - px) < Math.abs(dn.price - px))) {
      drives.push({ pillar: "liquidity", lens: "liquidity", label: `draw → ${up.name}`, dir: 1, w: 6, note: "untapped pool above" });
    } else if (dn) {
      drives.push({ pillar: "liquidity", lens: "liquidity", label: `draw → ${dn.name}`, dir: -1, w: 6, note: "untapped pool below" });
    }

    // EQH/EQL Buildups
    const activeEQH = liq.builds.filter(b => b.side === 1 && b.price > px);
    const activeEQL = liq.builds.filter(b => b.side === -1 && b.price < px);
    if (activeEQH.length > 0) {
      const w = macroTrend === 1 ? 14 : 7; // Highly bullish if aligned with macro trend
      drives.push({ pillar: "liquidity", lens: "liquidity", label: "EQH Buildup", dir: 1, w, note: `${activeEQH.length} equal high pools active` });
    }
    if (activeEQL.length > 0) {
      const w = macroTrend === -1 ? 14 : 7;
      drives.push({ pillar: "liquidity", lens: "liquidity", label: "EQL Buildup", dir: -1, w, note: `${activeEQL.length} equal low pools active` });
    }

    // Trendline Liquidity Buildups & Hunts
    const tlLiq = detectTrendlineLiquidity(intraday, intradayAvg);
    for (const d of (tlLiq?.draws || [])) {
      const w = (d.side === macroTrend && macroTrend !== 0) ? 16 : 8; // high weight for robust compression
      drives.push({ pillar: "liquidity", lens: "liquidity", label: d.type, dir: d.side, w, note: `${d.touches} touches: ${d.note}` });
    }
    for (const s of (tlLiq?.sweeps || [])) {
      const k = decay(s.age, 8, 48);
      if (k <= 0) continue;
      const dir = -s.side; // Sweep of BSL (side=1) causes Bearish push (dir=-1)
      
      const sBar = intraday[intraday.length - 1 - s.age];
      const killzone = sessionOf(sBar.time);
      const sessionMult = (killzone.id === "london" || killzone.id === "ny") ? 1.3 : 1.0;

      let w = 18 * k * sessionMult; // Massive trigger weight for hunting a multi-phase compression
      let note = `Hunted ${s.touches}-touch ${s.note}, ${s.age} bars ago`;
      if (sessionMult > 1) note += ` (${killzone.label} KZ)`;

      const extremePx = s.side === 1 ? sBar.high : sBar.low;
      const mitigation = checkMitigation(extremePx, dir);
      if (mitigation) {
        w *= 1.5;
        note += ` + tapped ${mitigation.type}`;
      }

      drives.push({ pillar: "liquidity", lens: "reversal", label: s.type, dir, w, note });
      reversalPush += dir * w * 0.9;
      triggerSum += dir * w * 0.9;
    }
  }

  // prior WEEK high/low from D1
  if (frames.D1) {
    const pw = priorWeekLevels(frames.D1);
    for (const lv of pw) {
      if (lv.state === "swept") {
        drives.push({ pillar: "liquidity", lens: "liquidity", label: `${lv.name} swept`, dir: -lv.side, w: 10, note: "weekly stop hunt" });
        reversalPush += -lv.side * 8;
      } else if (lv.state === "untapped" && lv.near) {
        drives.push({ pillar: "liquidity", lens: "liquidity", label: `draw → ${lv.name}`, dir: lv.side, w: 5, note: "weekly pool in reach" });
      }
    }
  }

  // ---------- HTF-only Liquidity Intelligence (4H & D1) ----------
  const htfLiqData = analyzeHTFLiquidity(frames, { structures });
  for (const s of htfLiqData.sweeps) {
    const k = decay(s.age, 4, 18);
    if (k > 0) {
      const w = 15 * k;
      drives.push({
        pillar: "htf", lens: "liquidity",
        label: `${s.name} swept on 4H`,
        dir: s.reversalDir, w,
        note: `HTF liquidity grab ${s.age * 4}h ago`,
      });
      reversalPush += s.reversalDir * w * 0.8;
      htfSum += s.reversalDir * w * 0.6;
    }
  }

  // HTF Equal Highs / Lows (4H EQH / EQL magnets)
  const active4HEQH = htfLiqData.pools.bsl.filter((p) => p.type === "MAGNET_BSL");
  const active4HEQL = htfLiqData.pools.ssl.filter((p) => p.type === "MAGNET_SSL");
  if (active4HEQH.length > 0) {
    const w = macroTrend === 1 ? 14 : 8;
    drives.push({ pillar: "htf", lens: "liquidity", label: "4H EQH Magnet", dir: 1, w, note: `${active4HEQH.length} equal high pools above` });
  }
  if (active4HEQL.length > 0) {
    const w = macroTrend === -1 ? 14 : 8;
    drives.push({ pillar: "htf", lens: "liquidity", label: "4H EQL Magnet", dir: -1, w, note: `${active4HEQL.length} equal low pools below` });
  }

  // HTF Draw on Liquidity (DOL)
  if (htfLiqData.drawOnLiquidity) {
    const dol = htfLiqData.drawOnLiquidity;
    const dolDir = dol.targetSide === "BSL" ? 1 : -1;
    drives.push({
      pillar: "htf", lens: "liquidity",
      label: `HTF DOL → ${dol.name}`,
      dir: dolDir, w: 9,
      note: `${dol.catalyst} (${Math.round(dol.distance)} pts away)`,
    });
  }

  // HTF Auction Cycle (IRL to ERL vs ERL to IRL)
  if (htfLiqData.activeCycle === "IRL_TO_ERL" && htfLiqData.drawOnLiquidity) {
    const cycleDir = htfLiqData.drawOnLiquidity.targetSide === "BSL" ? 1 : -1;
    drives.push({
      pillar: "htf", lens: "flow",
      label: "IRL → ERL expansion",
      dir: cycleDir, w: 7,
      note: htfLiqData.cycleNote,
    });
  }

  // ---------- intraday triggers: QML, FVG stack, reversal anatomy ----------
  const m15 = intraday;
  if (m15) {
    const m15avg = avgRange(m15);
    const qml = detectQML(m15, m15avg);
    if (qml) {
      const k = decay(qml.age, 10, 30);
      if (k > 0) {
        let w = 11 * k;
        let note = `sweep→neck break ${qml.age} bars ago`;
        const vr = volRatio(m15, qml.i);
        if (vr != null && vr >= 1.5) { w *= 1.15; note += `, ${vr}× vol`; }
        drives.push({ pillar: "intraday", lens: "reversal", label: "QML", dir: qml.dir, w, note });
        reversalPush += qml.dir * w;
        triggerSum += qml.dir * w;
      }
    }

    const gaps = fvgZones(m15, m15avg);

    // net unfilled-gap imbalance (single source of truth: zones.js lifecycle)
    const openBull = gaps.filter((z) => z.state === "open" && z.dir === 1).length;
    const openBear = gaps.filter((z) => z.state === "open" && z.dir === -1).length;
    const net = openBull - openBear;
    if (Math.abs(net) >= 2) {
      drives.push({ pillar: "intraday", lens: "fvg", label: "FVG stack", dir: Math.sign(net), w: 4, note: `${Math.max(openBull, openBear)} unfilled ${net > 0 ? "bullish" : "bearish"} gaps` });
    }

    // iFVG: a gap price CLOSED through now works the other way
    const inv = gaps
      .filter((z) => z.state === "inverted")
      .sort((a, b) => b.invertedAt - a.invertedAt)[0];
    if (inv) {
      const k = decay(m15.length - 1 - inv.invertedAt, 8, 30);
      if (k > 0) {
        drives.push({ pillar: "intraday", lens: "fvg", label: "iFVG flip", dir: -inv.dir, w: 7 * k, note: `${inv.dir > 0 ? "bullish" : "bearish"} gap inverted ${m15.length - 1 - inv.invertedAt} bars ago` });
      }
    }
    // nearest open gap supporting price from the pullback side
    const pxM15 = m15[m15.length - 1].close;
    const open = gaps
      .filter((z) => z.state === "open" && (z.dir === 1 ? z.top < pxM15 : z.bottom > pxM15))
      .filter((z) => Math.abs((z.dir === 1 ? z.top : z.bottom) - pxM15) <= 10 * m15avg)
      .sort((a, b) => Math.abs((a.dir === 1 ? a.top : a.bottom) - pxM15) - Math.abs((b.dir === 1 ? b.top : b.bottom) - pxM15))[0];
    if (open) {
      drives.push({ pillar: "intraday", lens: "fvg", label: open.dir > 0 ? "FVG support below" : "FVG resistance above", dir: open.dir, w: 4, note: "unfilled gap in the pullback path" });
    }

    const sw = sweepWickCandle(m15, m15avg);
    if (sw) {
      const k = decay(sw.age, 6, 24);
      if (k > 0) {
        const w = 7 * k * (sw.grade === "A" ? 1.2 : 1);
        drives.push({ pillar: "intraday", lens: "reversal", label: `M15 ${sw.kind}`, dir: sw.dir, w, note: sw.swept ? "wick ran a swing, closed back strong" : "strong rejection wick" });
        reversalPush += sw.dir * w * 0.8;
        triggerSum += sw.dir * w * 0.8;
      }
    }
    const v = vReversal(m15, m15avg);
    if (v) {
      const k = decay(v.age, 8, 30);
      if (k > 0) {
        drives.push({ pillar: "intraday", lens: "reversal", label: "M15 V-reversal", dir: v.dir, w: 7 * k, note: `sharp leg recovered ≥70% (${v.grade})` });
        reversalPush += v.dir * 7 * k * 0.7;
        triggerSum += v.dir * 7 * k * 0.7;
      }
    }
    const gd = grindThenDisplacement(m15, m15avg);
    if (gd) {
      const k = decay(gd.age, 5, 20);
      if (k > 0) {
        drives.push({ pillar: "intraday", lens: "structure", label: "grind → displacement", dir: gd.dir, w: 7 * k, note: `slow pullback broken ${gd.ratio}× faster` });
        triggerSum += gd.dir * 7 * k;
      }
    }
  }

  // ---------- multi-timeframe structural dealing ranges (15M, 1H, 4H, 1D) ----------
  const allRanges = analyzeAllDealingRanges(frames, structures);
  const h4R = allRanges.ranges?.H4;
  const m15R = allRanges.ranges?.M15;
  const h1R = allRanges.ranges?.H1;
  const d1R = allRanges.ranges?.D1;

  if (h4R) {
    if (h4R.pos <= 0.40) {
      if (macroTrend !== -1) {
        drives.push({
          pillar: "htf", lens: "sr",
          label: "4H discount pricing",
          dir: 1,
          w: Math.round(9 * (0.5 - h4R.pos) * 2),
          note: `${h4R.coveragePct}% of 4H range (${h4R.zone.replace(/_/g, " ")})`,
        });
      }
    } else if (h4R.pos >= 0.60) {
      if (macroTrend !== 1) {
        drives.push({
          pillar: "htf", lens: "sr",
          label: "4H premium pricing",
          dir: -1,
          w: Math.round(9 * (h4R.pos - 0.5) * 2),
          note: `${h4R.coveragePct}% of 4H range (${h4R.zone.replace(/_/g, " ")})`,
        });
      }
    }
  }

  // Dealing range uncovered runway vs exhaustion drives
  for (const al of allRanges.alignments) {
    drives.push({
      pillar: "htf", lens: "structure",
      label: al.type === "BULLISH_UNCOVERED_EXPANSION" ? "Uncovered upside runway" : "Uncovered downside runway",
      dir: al.dir, w: 9,
      note: al.note,
    });
  }

  // ---------- order blocks: unmitigated origins of displacement legs ----------
  let obNear = false;
  let minObDist = Infinity;
  let hasFreshOb = false;
  for (const [tf, bars, pillar] of [["H1", frames.H1, "htf"], ["M15", m15, "intraday"]]) {
    if (!bars) continue;
    const avg = avgRange(bars);
    const px = bars[bars.length - 1].close;
    const obs = detectOrderBlocks(bars, avg);

    for (const z of obs) {
      const dist = px > z.top ? px - z.top : (px < z.bottom ? z.bottom - px : 0);
      const distNorm = dist / Math.max(avg, 1e-10);
      if (distNorm < minObDist) minObDist = distNorm;
    }

    const at = obs
      .filter((z) => px <= z.top + 0.5 * avg && px >= z.bottom - 0.5 * avg)
      .sort((a, b) => a.age - b.age)[0];
    if (at) {
      const k = decay(at.age, 20, 80);
      if (k > 0) {
        obNear = true;
        const inside = px <= at.top && px >= at.bottom;
        drives.push({ pillar, lens: "ob", label: `${tf} ${at.dir > 0 ? "demand" : "supply"} OB`, dir: at.dir, w: 8 * (inside ? 1 : 0.7) * k, note: `price ${inside ? "inside" : "at"} unmitigated block` });
      }
    }

    const freshOb = obs.filter((z) => z.age <= 3).sort((a, b) => a.age - b.age)[0];
    if (freshOb && freshOb !== at) {
      hasFreshOb = true;
      drives.push({ pillar, lens: "ob", label: `fresh ${tf} OB`, dir: freshOb.dir, w: 5, note: "displacement just left a block behind" });
    }
  }

  // ---------- volume: profile location (POC / value area / HVN / LVN) ----------
  let relPart = null;
  if (intraday) {
    relPart = relParticipation(intraday);
    const px = intraday[intraday.length - 1].close;
    const vp = profiles(intraday, intradayAvg);

    if (vp.prior) {
      if (px > vp.prior.vah + 0.25 * intradayAvg) {
        drives.push({ pillar: "intraday", lens: "volume", label: "accepted above value", dir: 1, w: 5, note: "trading above prior-day VAH" });
      } else if (px < vp.prior.val - 0.25 * intradayAvg) {
        drives.push({ pillar: "intraday", lens: "volume", label: "accepted below value", dir: -1, w: 5, note: "trading below prior-day VAL" });
      } else if (Math.abs(vp.prior.poc - px) >= 2 * intradayAvg) {
        drives.push({ pillar: "intraday", lens: "volume", label: "rotation to PD POC", dir: Math.sign(vp.prior.poc - px), w: 4, note: "inside prior value — POC magnet" });
      }
    }

    if (vp.today && Math.abs(vp.today.poc - px) >= 2 * intradayAvg) {
      drives.push({ pillar: "intraday", lens: "volume", label: "draw → today's POC", dir: Math.sign(vp.today.poc - px), w: 3, note: "developing POC magnet" });
    }

    if (vp.dealing) {
      const shelf = vp.dealing.hvns.find((h) => h.price < px && px - h.price <= 2 * intradayAvg);
      const ceil = vp.dealing.hvns.find((h) => h.price > px && h.price - px <= 2 * intradayAvg);
      if (shelf) drives.push({ pillar: "intraday", lens: "volume", label: "HVN shelf below", dir: 1, w: 4, note: "high-volume acceptance under price" });
      if (ceil) drives.push({ pillar: "intraday", lens: "volume", label: "HVN ceiling above", dir: -1, w: 4, note: "high-volume acceptance over price" });

      // LVN void between price and the active liquidity draw = thin path
      if (liq) {
        const between = (t) => vp.dealing.lvns.some((l) => l.price > Math.min(px, t) && l.price < Math.max(px, t));
        const up = liq.draws.above[0];
        const dn = liq.draws.below[0];
        if (up && between(up.price)) {
          drives.push({ pillar: "intraday", lens: "volume", label: "LVN void above", dir: 1, w: 3, note: `thin path to ${up.name}` });
        } else if (dn && between(dn.price)) {
          drives.push({ pillar: "intraday", lens: "volume", label: "LVN void below", dir: -1, w: 3, note: `thin path to ${dn.name}` });
        }
      }
    }
  }

  // ---------- the playbook: pool swept → M15 displaced MSS ----------
  let setup = null;
  if (liq && intraday) {
    setup = detectSetup(liq.sweeps, intraday);
    if (setup) {
      const w = 18 * (setup.grade === "A" ? 1.15 : 1);
      drives.push({
        pillar: "intraday", lens: "reversal", label: `sweep → ${setup.mssTf} MSS`, dir: setup.dir, w,
        note: `${setup.pool} swept, MSS ${setup.mssAgeMin}m ago${setup.volRatio ? ` on ${setup.volRatio}× vol` : ""} (${setup.grade})`,
      });
      reversalPush += setup.dir * 16;
      triggerSum += setup.dir * 14;
    }
  }

  // ---------- context: SMT divergence + risk sentiment ----------
  const base = symbol.toUpperCase().replace(/[._-].*$/, "").replace(/m$/, "");
  for (const partner of SMT_PAIRS[base] || []) {
    const pFrames = extras.partnerFrames?.[partner];
    if (!pFrames?.M15) continue;
    const smt = smtDivergence(frames.M15, pFrames.M15, partner);
    if (smt) {
      drives.push({ pillar: "context", lens: "flow", label: "SMT divergence", dir: smt.dir, w: 9, note: smt.note });
      reversalPush += smt.dir * 7;
      break;
    }
  }

  const beta = riskBeta(symbol, category);
  if (extras.risk && beta !== 0 && Math.abs(extras.risk.score) >= 25) {
    const dir = Math.sign(extras.risk.score * beta);
    drives.push({
      pillar: "context", lens: "flow", label: extras.risk.score > 0 ? "risk-on tape" : "risk-off tape",
      dir, w: 6 * Math.abs(beta), note: extras.risk.note,
    });
  }

  // ---------- confluence: HTF and fresh triggers agree ----------
  if (Math.abs(htfSum) > 10 && Math.abs(triggerSum) > 8 && Math.sign(htfSum) === Math.sign(triggerSum)) {
    drives.push({ pillar: "intraday", lens: "structure", label: "A+ alignment", dir: Math.sign(htfSum), w: 8, note: "HTF bias + fresh trigger agree" });
  }

  // ---------- lens vote (replaces the single weighted sum) ----------
  // regime inputs: H1 efficiency ratio (expansion?), reversal freshness, flow depth
  let er = 0;
  if (frames.H1 && frames.H1.length > 21) {
    const cl = frames.H1.slice(-21).map((b) => b.close);
    let path = 0;
    for (let i = 1; i < cl.length; i++) path += Math.abs(cl[i] - cl[i - 1]);
    er = path ? Math.abs(cl[cl.length - 1] - cl[0]) / path : 0;
  }
  const liveLevels = liq ? liq.sweeps.length + liq.draws.above.length + liq.draws.below.length : 0;
  const fitness = lensFitness({
    er, reversalPush, liveLevels, obNear, relPart,
    obDist: Number.isFinite(minObDist) ? minObDist : null,
    hasFreshOb,
    flowN: drives.filter((d) => d.lens === "flow").length,
    setupActive: Boolean(setup),
  });
  const vote = lensVote(drives, fitness, { setupActive: Boolean(setup), setupDir: setup?.dir });
  let score = vote.final;

  let phase = "trend";
  if (setup) {
    phase = "setup";
  } else if (vote.contested && Math.abs(vote.lenses.reversal.score) >= 25 &&
      Math.sign(vote.lenses.reversal.score) !== Math.sign(vote.lenses.structure.score || htfSum)) {
    phase = "reversal-watch";
  }

  const stab = stability(drives, fitness, score, 200, { setupActive: Boolean(setup), setupDir: setup?.dir });

  // ---------- dampeners ----------
  if (structures.H1?.ranging && structures.M15?.ranging) {
    damps.push({ label: "structure chop", mult: 0.65, note: "H1 and M15 both ranging" });
  }

  const events = newsRisk(extras.news || [], symbolCurrencies(symbol, category));
  const upcoming = events.find((e) => e.when === "upcoming");
  const released = events.find((e) => e.when === "released");
  if (upcoming) {
    damps.push({ label: "news risk", mult: 0.6, note: `${upcoming.currency} ${upcoming.title} in ${fmtMin(upcoming.inMin)}` });
  } else if (released) {
    damps.push({ label: "post-news volatility", mult: 0.75, note: `${released.currency} ${released.title} ${fmtMin(released.agoMin)} ago` });
  }

  if (vote.contested && Math.abs(score) >= 15) {
    damps.push({ label: "lenses disagree", mult: 0.8, note: `only ${vote.agreement}% of lens mass agrees` });
  }
  if (stab != null && stab < 60) {
    damps.push({ label: "fragile verdict", mult: 0.85, note: `flips under small weight changes (${stab}%)` });
  }

  if (frames.H1 && frames.H1.length > 21) {
    const h1 = frames.H1;
    const mean = h1.slice(-20).reduce((s, b) => s + b.close, 0) / 20;
    const dist = Math.abs(h1[h1.length - 1].close - mean);
    const a = avgRange(h1);
    if (dist > 3 * a) damps.push({ label: "extended from mean", mult: 0.85, note: `${(dist / a).toFixed(1)}× H1 range off 20-bar mean` });
  }

  if (session?.id === "off") {
    damps.push({ label: "off-hours", mult: 0.7, note: "thin liquidity window" });
  }

  if (intraday) {
    const gaps = detectGaps(intraday, intradayAvg, 4.0);
    const freshGap = gaps.find((g) => g.age <= 1); // 15-minute periods immediately following a gap
    if (freshGap) {
      damps.push({ label: "post-gap anomaly", mult: 0.5, note: `massive price gap detected ${freshGap.age} bars ago, reducing confidence` });
    }
  }

  if (relPart != null && relPart < 0.55 && Math.abs(score) >= 15) {
    damps.push({ label: "dead tape", mult: 0.85, note: `participation ${Math.round(relPart * 100)}% of normal` });
  }

  if (liq && Math.abs(score) >= 15) {
    const against = score > 0 ? liq.draws.below[0] : liq.draws.above[0];
    if (against && Math.abs(against.price - intraday[intraday.length - 1].close) <= 5 * intradayAvg) {
      damps.push({ label: "counter-liquidity near", mult: 0.85, note: `${against.name} likely to be run first` });
    }
  }

  // Dealing range exhaustion dampeners
  if (h4R && h4R.coveragePct >= 85 && score > 10) {
    damps.push({
      label: "H4 range exhaustion (Premium)",
      mult: 0.78,
      note: `${h4R.coveragePct}% of H4 range covered, near ceiling`,
    });
  } else if (h4R && h4R.coveragePct <= 15 && score < -10) {
    damps.push({
      label: "H4 range exhaustion (Discount)",
      mult: 0.78,
      note: `${h4R.coveragePct}% of H4 range covered, near floor`,
    });
  }

  const dampMult = damps.reduce((m, d) => m * d.mult, 1);

  // ---------- pillars (diagram) ----------
  const pillars = {};
  for (const p of ["htf", "intraday", "liquidity", "context"]) {
    const fs = drives.filter((f) => f.pillar === p);
    const w = fs.reduce((s, f) => s + f.w, 0);
    pillars[p] = w ? Math.round((fs.reduce((s, f) => s + f.dir * f.w, 0) / w) * 100) : 0;
  }

  const completeness = 1 - missing.length / (requiredTfs.length || 1);
  const confidence = Math.round(clamp((vote.agreement / 100) * completeness * (0.5 + 0.5 * dampMult), 0, 1) * 100);

  // Dynamic synthesis via the Market Brain
  const brain = evaluateMarketBrain({
    symbol,
    ranges: allRanges,
    htfFvg: htfFvgData,
    htfLiq: htfLiqData,
    structures,
    intraday: { setup, liq },
    score,
  });

  drives.sort((a, b) => b.w - a.w);
  return {
    symbol,
    category,
    score: Math.round(score), // pre-group, pre-damp; finalized in aggregate()
    dampMult,
    phase,
    setup,
    confidence,
    stability: stab,
    agreement: vote.agreement,
    lenses: vote.lenses,
    session: session?.label || null,
    layers,
    pillars,
    factors: drives.slice(0, 9).map((f) => ({
      pillar: f.pillar, lens: f.lens, label: f.label, dir: f.dir, w: Math.round(f.w), note: f.note,
    })),
    damps,
    news: events.slice(0, 3),
    missing,
    ranges: allRanges.ranges,
    htfFvg: htfFvgData,
    htfLiquidity: htfLiqData,
    brain,
    executionReadiness: {
      action: brain.action,
      conviction: brain.conviction,
      allowedToLong: brain.allowedToLong,
      allowedToShort: brain.allowedToShort,
      invalidationPrice: brain.invalidationPrice,
      targetDOL: brain.targetDOL,
      catalysts: brain.catalysts,
      blockReasons: brain.blockReasons,
      warning: brain.warning,
    },
    at: Date.now(),
  };
}

function fmtMin(m) {
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

// prior ISO-week high/low from daily bars, classified against this week
function priorWeekLevels(d1) {
  const week = (t) => Math.floor((Math.floor(t / 86400) + 3) / 7); // Monday-start
  const cur = week(d1[d1.length - 1].time);
  const prev = d1.filter((b) => week(b.time) === cur - 1);
  const thisWk = d1.filter((b) => week(b.time) === cur);
  if (!prev.length) return [];
  const pwh = Math.max(...prev.map((b) => b.high));
  const pwl = Math.min(...prev.map((b) => b.low));
  const px = d1[d1.length - 1].close;
  const a = avgRange(d1);

  const classify = (price, side) => {
    let crossed = false;
    for (const b of thisWk) {
      if (side === 1 ? b.high > price : b.low < price) { crossed = true; break; }
    }
    if (!crossed) return "untapped";
    const out = side === 1 ? px > price : px < price;
    return out ? "broken" : "swept";
  };

  return [
    { name: "PWH", price: pwh, side: 1, state: classify(pwh, 1), near: Math.abs(pwh - px) <= 3 * a },
    { name: "PWL", price: pwl, side: -1, state: classify(pwl, -1), near: Math.abs(pwl - px) <= 3 * a },
  ];
}

// ---------------------------------------------------------------- categories

const CCY = ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"];

export function classifySymbol(symbol) {
  const s = symbol.toUpperCase().replace(/[._-].*$/, "").replace(/m$/, "");
  if (/^(XAU|XAG|GOLD|SILVER|XPT|XPD)/.test(s)) return "metals";
  if (/^(BTC|ETH|XRP|SOL|LTC|DOGE|ADA|BNB)/.test(s)) return "crypto";
  if (/(US30|DJ30|NAS100|USTEC|NDX|US100|SPX|US500|SP500|GER40|DAX|DE40|UK100|FTSE|JP225|NIK|AUS200|HK50|STOXX)/.test(s)) return "indices";
  if (s.length === 6 && CCY.includes(s.slice(0, 3)) && CCY.includes(s.slice(3))) return "fx";
  if (/^(USOIL|UKOIL|WTI|BRENT|XTI|XBR|NGAS)/.test(s)) return "energy";
  return "stocks";
}

const CAT_LABEL = { fx: "Forex", indices: "Indices", metals: "Metals", crypto: "Crypto", energy: "Energy", stocks: "Stocks" };

// Group pass — category consensus, currency-strength consensus, USD spillover
// into metals; dampeners applied LAST.
export function aggregate(results) {
  const cats = new Map();
  for (const r of results) {
    if (!cats.has(r.category)) cats.set(r.category, []);
    cats.get(r.category).push(r);
  }

  const categories = [];
  for (const [id, members] of cats) {
    const mean = members.reduce((s, m) => s + m.score, 0) / members.length;
    const aligned = members.filter((m) => Math.sign(m.score) === Math.sign(mean) && m.score !== 0).length;
    const alignment = members.length > 1 ? Math.round((aligned / members.length) * 100) : 100;
    categories.push({ id, label: CAT_LABEL[id] || id, score: Math.round(mean), alignment, members: members.map((m) => m.symbol) });

    if (members.length >= 3) {
      for (const m of members) {
        const boost = clamp(mean * 0.12, -8, 8);
        if (Math.abs(boost) >= 2) {
          m.score = clamp(m.score + boost, -100, 100);
          m.factors.push({ pillar: "context", lens: "flow", label: `${CAT_LABEL[id]} ${boost > 0 ? "tailwind" : "headwind"}`, dir: Math.sign(boost), w: Math.abs(Math.round(boost)), note: `category mean ${Math.round(mean)}` });
        }
      }
    }
  }

  const fx = cats.get("fx") || [];
  const strength = {};
  for (const r of fx) {
    const s = r.symbol.toUpperCase().replace(/[._-].*$/, "").replace(/m$/, "");
    const b = s.slice(0, 3);
    const q = s.slice(3);
    (strength[b] = strength[b] || { sum: 0, n: 0 }).sum += r.score; strength[b].n++;
    (strength[q] = strength[q] || { sum: 0, n: 0 }).sum -= r.score; strength[q].n++;
  }
  const ccyScore = {};
  for (const [ccy, v] of Object.entries(strength)) ccyScore[ccy] = Math.round(v.sum / v.n);

  if (fx.length >= 3) {
    for (const r of fx) {
      const s = r.symbol.toUpperCase().replace(/[._-].*$/, "").replace(/m$/, "");
      const b = ccyScore[s.slice(0, 3)] ?? 0;
      const q = ccyScore[s.slice(3)] ?? 0;
      const consensus = (b - q) / 2;
      const adj = clamp((consensus - r.score) * 0.15, -6, 6);
      if (Math.abs(adj) >= 2) {
        r.score = clamp(r.score + adj, -100, 100);
        r.factors.push({ pillar: "context", lens: "flow", label: "currency consensus", dir: Math.sign(adj), w: Math.abs(Math.round(adj)), note: `${s.slice(0, 3)} ${fmtSigned(b)} vs ${s.slice(3)} ${fmtSigned(q)}` });
      }
    }
    const usd = ccyScore.USD ?? 0;
    for (const m of cats.get("metals") || []) {
      const adj = clamp(-usd * 0.06, -5, 5);
      if (Math.abs(adj) >= 2) {
        m.score = clamp(m.score + adj, -100, 100);
        m.factors.push({ pillar: "context", lens: "flow", label: "USD consensus (inverse)", dir: Math.sign(adj), w: Math.abs(Math.round(adj)), note: `USD ${fmtSigned(usd)}` });
      }
    }
  }

  for (const r of results) {
    r.score = clamp(Math.round(r.score * r.dampMult), -100, 100);
    r.dir = r.score > 15 ? "bullish" : r.score < -15 ? "bearish" : "neutral";
    if (Math.abs(r.score) < 15 && r.phase !== "reversal-watch" && r.phase !== "setup") r.phase = "chop";
  }
  for (const c of categories) {
    const members = cats.get(c.id);
    c.score = Math.round(members.reduce((s, m) => s + m.score, 0) / members.length);
  }

  const currencyStrength = Object.entries(ccyScore)
    .map(([ccy, score]) => ({ ccy, score }))
    .sort((a, b) => b.score - a.score);

  categories.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  return { categories, currencyStrength };
}

const fmtSigned = (v) => `${v > 0 ? "+" : ""}${v}`;
