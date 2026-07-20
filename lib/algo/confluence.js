// Setup-confluence detectors — the ICT/SMC composite setups layered ON TOP of
// findSetup's base checklist. All additive: each one returns a {hit, score, note}
// so findSetup can register confluence without surprise hard-kills.
//
// Concepts (definitions from the codebase primitives + ICT first principles;
// NOT copied from any source — see CURRENCY_ALGO.md for the mapping):
//
//   FVG + inducement: an inducement (IDM) is a minor liquidity pool sitting on
//   the entry-side of the zone — the last short-term high (buy) / low (sell)
//   that markets are drawn to before the real move. The sequence is: price
//   sweeps/grabs the inducement → taps the FVG → displaces in our direction.
//   Detected as: our FVG sits beyond an ungrabbed minor pivot on the same side.
//
//   IFVG (inversion FVG): an FVG that got closed-through on the far side (the
//   "inverted" state already tracked by fvgZones), now acting as CONTINUATION
//   support/resistance on the opposite side of price. We use the inverted FVG
//   that has NOT been reclaimed (state==="inverted") as a continuation zone in
//   the setup direction. The base findSetup only uses open FVGs; IFVGs let us
//   catch post-breakout continuation entries.
//
//   QML + OB + FVG: a quasimodo (sweep of a swing extreme then break of the
//   neck) has ALREADY fired (detectQML), and the reaction leg contains BOTH an
//   unmitigated OB and a fresh FVG on the reversal side — triple confluence
//   stacking the entry zone.
//
// All pure functions of (frames, dir, cfg) — no I/O.

import { fvgZones, detectOrderBlocks } from "../bias/zones.js";
import { detectQML } from "../bias/liquidity.js";
import { findPivots, avgRange } from "../patterns/core.js";

// FVG + inducement: a minor pivot (inducement) sitting between price and our
// entry zone, still ungrabbed — the bait markets hit before the real entry.
export function fvgInducement(frames, dir, entryZone, cfg = {}) {
  const M15 = frames?.M15;
  if (!M15?.length) return null;
  const n = M15.length;
  const { highs, lows } = findPivots(M15, 3, 3);
  const px = M15[n - 1].close;
  
  // inducement sits between current price and the entry zone, on the entry side
  const entry = entryZone?.price;
  if (entry == null) return null;
  
  // Buy: price is dropping to entry. We want a LOW between px and entry.
  // Sell: price is rising to entry. We want a HIGH between px and entry.
  const pools = dir === "buy" ? lows : highs;
  const inducement = pools
    .map((p) => ({ ...p, age: n - 1 - p.i }))
    .filter((p) => p.age >= 4 && p.age <= 40)
    .filter((p) => {
      // Must be between current price and the entry zone
      const between = dir === "buy" ? (p.price < px && p.price > entry) : (p.price > px && p.price < entry);
      if (!between) return false;
      
      // Ungrabbed: price never closed through it since it formed
      for (let i = p.i + 1; i < n; i++) {
        const grabbed = dir === "buy" ? M15[i].close < p.price : M15[i].close > p.price;
        if (grabbed) return false;
      }
      return true;
    })
    .sort((a, b) => a.age - b.age)[0];
    
  if (!inducement) return null;
  const w = cfg.fvgInducementW ?? 10;
  return { hit: true, score: w, note: `inducement ${dir === "buy" ? "low" : "high"} @ ${r5(inducement.price)} (${inducement.age} bars) ungrabbed` };
}

// IFVG continuation: a closed-then-inverted FVG (fvgZones state==="inverted",
// not reclaimed) acting as continuation zone on our side, beyond current price.
export function ifvgZone(frames, dir, cfg = {}) {
  const H1 = frames?.H1, M15 = frames?.M15;
  const px = M15?.[M15.length - 1]?.close;
  const dirN = dir === "buy" ? 1 : -1;
  for (const [tf, bars] of [["H1", H1], ["M15", M15]]) {
    if (!bars?.length) continue;
    for (const z of fvgZones(bars, avgRange(bars))) {
      // fvgZones inverts when price closes through the FAR side of a dir-matching
      // gap. The inverted zone's original dir is opposite to price's travel; we
      // want an inverted zone now acting as support (buy) / resistance (sell) on
      // OUR side — i.e. the inverted FVG whose original dir opposed us.
      if (z.state !== "inverted") continue;
      if (z.dir !== -dirN) continue; // original gap was opposite our dir → now inverted into our continuation zone
      if (!(dir === "buy" ? z.top < px : z.bottom > px)) continue; // must be beyond price (pullback into it)
      const w = cfg.ifvgW ?? 12;
      return { hit: true, score: w, note: `${tf} IFVG continuation ${r5(z.top)}/${r5(z.bottom)} (${z.age} bars)` };
    }
  }
  return null;
}

// QML + OB + FVG: a recent quasimodo reversal whose reaction contains a stacked
// OB + fresh FVG on the same side — triple confluence at the entry.
export function qmlObFvg(frames, dir, cfg = {}) {
  const M15 = frames?.M15;
  if (!M15?.length) return null;
  const dirN = dir === "buy" ? 1 : -1;
  const qml = detectQML(M15, avgRange(M15));
  if (!qml || qml.dir !== dirN || qml.age > 30) return null;
  const recent = M15.slice(-Math.max(20, qml.age + 8));
  if (recent.length < 10) return null;
  const obs = detectOrderBlocks(recent, avgRange(recent));
  const fvgs = fvgZones(recent, avgRange(recent));
  const ob = obs.find((o) => o.dir === dirN && !o.tapped);
  const fvg = fvgs.find((f) => f.dir === dirN && f.state === "open");
  if (!ob || !fvg) return null;
  const w = cfg.qmlObFvgW ?? 18;
  return { hit: true, score: w, note: `QML (${qml.age} bars) + OB + FVG stacked (dir ${dirN})` };
}

const r5 = (v) => (v == null ? "" : Math.round(v * 1e5) / 1e5);
