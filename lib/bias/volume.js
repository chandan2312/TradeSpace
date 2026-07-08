import { analyzeStructure } from "./structure.js";

// Volume intelligence — tick-volume based (MT5 proxy, all thresholds are
// RELATIVE ratios so the proxy nature doesn't skew levels).
//
//   volumeProfile — price-binned histogram → POC, VAH/VAL (70% value area),
//                   HVNs (acceptance shelves) and LVNs (rejection voids)
//   profiles      — the profile on SMART ranges: prior completed day (fixed
//                   reference), today (developing), and the current dealing
//                   range (since the last displaced MSS — the active leg)
//   volRatio      — bar volume vs its recent mean (climax / dead read)
//   relParticipation — is the market awake right now (fast/slow vol SMA)
//
// Everything returns null when volume data is absent — the engine then
// behaves exactly like v4 (fail-soft).

export function volumeProfile(bars, avg) {
  if (!bars?.length || !(avg > 0)) return null;
  const withV = bars.filter((b) => b.v > 0);
  if (withV.length < 20 || withV.length < bars.length * 0.5) return null;

  let lo = Infinity;
  let hi = -Infinity;
  for (const b of withV) {
    if (b.low < lo) lo = b.low;
    if (b.high > hi) hi = b.high;
  }
  if (hi <= lo) return null;

  // bin ≈ 0.25×avg, clamped to 20–60 bins
  const nBins = Math.round(Math.min(60, Math.max(20, (hi - lo) / (0.25 * avg))));
  const binSize = (hi - lo) / nBins;
  const hist = new Array(nBins).fill(0);
  for (const b of withV) {
    const k0 = Math.min(nBins - 1, Math.max(0, Math.floor((b.low - lo) / binSize)));
    const k1 = Math.min(nBins - 1, Math.max(0, Math.floor((b.high - lo) / binSize)));
    const share = b.v / (k1 - k0 + 1); // spread the bar's volume across its span
    for (let k = k0; k <= k1; k++) hist[k] += share;
  }
  const total = hist.reduce((s, v) => s + v, 0);
  if (!total) return null;
  const price = (k) => lo + (k + 0.5) * binSize;

  let pocIdx = 0;
  for (let k = 1; k < nBins; k++) if (hist[k] > hist[pocIdx]) pocIdx = k;

  // value area: expand around POC until 70% of volume is inside
  let vaLo = pocIdx;
  let vaHi = pocIdx;
  let acc = hist[pocIdx];
  while (acc < 0.7 * total && (vaLo > 0 || vaHi < nBins - 1)) {
    const dn = vaLo > 0 ? hist[vaLo - 1] : -1;
    const up = vaHi < nBins - 1 ? hist[vaHi + 1] : -1;
    if (up >= dn) acc += hist[++vaHi];
    else acc += hist[--vaLo];
  }

  // nodes on a 3-bin smoothed histogram, filtered vs the mean bin
  const sm = hist.map((_, k) => {
    const a = Math.max(0, k - 1);
    const b = Math.min(nBins - 1, k + 1);
    let s = 0;
    for (let j = a; j <= b; j++) s += hist[j];
    return s / (b - a + 1);
  });
  const mean = total / nBins;
  const hvns = [];
  const lvns = [];
  for (let k = 1; k < nBins - 1; k++) {
    if (sm[k] >= sm[k - 1] && sm[k] >= sm[k + 1] && sm[k] >= 1.3 * mean) hvns.push({ price: price(k), v: sm[k] });
    else if (sm[k] <= sm[k - 1] && sm[k] <= sm[k + 1] && sm[k] <= 0.6 * mean) lvns.push({ price: price(k), v: sm[k] });
  }
  hvns.sort((a, b) => b.v - a.v);
  lvns.sort((a, b) => a.v - b.v);

  return {
    poc: price(pocIdx),
    vah: lo + (vaHi + 1) * binSize,
    val: lo + vaLo * binSize,
    hvns: hvns.slice(0, 3),
    lvns: lvns.slice(0, 3),
    total,
  };
}

// smart ranges: prior completed day / today developing / current dealing leg
export function profiles(bars, avg) {
  const out = { prior: null, today: null, dealing: null };
  if (!bars?.length) return out;
  const DAY = 86400;
  const lastDay = Math.floor(bars[bars.length - 1].time / DAY);
  const today = bars.filter((b) => Math.floor(b.time / DAY) === lastDay);
  const before = bars.filter((b) => Math.floor(b.time / DAY) < lastDay);
  const priorKey = before.length ? Math.floor(before[before.length - 1].time / DAY) : null;
  const prior = priorKey != null ? before.filter((b) => Math.floor(b.time / DAY) === priorKey) : [];

  // dealing range: since the last displaced MSS (the active structural leg)
  let start = Math.max(0, bars.length - 120);
  const st = analyzeStructure(bars, avg);
  for (let k = st.events.length - 1; k >= 0; k--) {
    const ev = st.events[k];
    if (ev.type === "MSS" && ev.displaced) {
      start = Math.max(0, ev.i - 10);
      break;
    }
  }

  out.prior = prior.length >= 20 ? volumeProfile(prior, avg) : null;
  out.today = today.length >= 20 ? volumeProfile(today, avg) : null;
  out.dealing = volumeProfile(bars.slice(start), avg);
  return out;
}

// bar i's volume vs the mean of the preceding lookback — the confirmation
// primitive (≥1.8 climax, ≤0.7 thin)
export function volRatio(bars, i, lookback = 60) {
  const b = bars?.[i];
  if (!(b?.v > 0)) return null;
  let s = 0;
  let n = 0;
  for (let k = Math.max(0, i - lookback); k < i; k++) {
    if (bars[k].v > 0) {
      s += bars[k].v;
      n++;
    }
  }
  if (n < 10) return null;
  return Math.round((b.v / (s / n)) * 10) / 10;
}

// fast/slow volume SMA — is the market participating right now?
export function relParticipation(bars) {
  if (!bars?.length) return null;
  const sma = (m, min) => {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, bars.length - m); k < bars.length; k++) {
      if (bars[k].v > 0) {
        s += bars[k].v;
        n++;
      }
    }
    return n >= min ? s / n : null;
  };
  const fast = sma(5, 3);
  const slow = sma(60, 30);
  return fast && slow ? Math.round((fast / slow) * 100) / 100 : null;
}
