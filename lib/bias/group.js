import { avgRange } from "../patterns/core.js";
import { analyzeStructure } from "./structure.js";
import { getBars } from "./data.js";

// Group confirmation v2 — no symbol trades alone.
//
// Indices: asymmetric partner lists. US30 is deliberately STANDALONE (it
// diverges from NAS/SPX too often to be gated by them) — empty list means
// its setups pass on their own.
// Metals / crypto: twin symbol.
// FX: per-CURRENCY bias. Each currency is read across a fixed basket of
// crosses (EUR from EURUSD+EURGBP+EURJPY+EURCHF, …). A EURUSD short is
// confirmed only when EUR reads weak AND USD reads strong (both pair
// currencies must actively align), plus the correlated currency (EUR↔GBP,
// AUD↔NZD) must not contradict.
// Basket legs use the full bias score when the pair is watched, else a
// cached M15 structure read fetched on demand (only when a setup exists).

const ALIASES = [
  ["US30", /^(US30|DJ30|DOW30?)$/],
  ["NAS100", /^(NAS100|NDX100?|USTEC|US100)$/],
  ["US500", /^(US500|SPX500?|SP500)$/],
  ["GER40", /^(GER[34]0|DE[34]0|DAX40?)$/],
  ["UK100", /^(UK100|FTSE100?)$/],
  ["FR40", /^(FR40|CAC40?)$/],
];
const baseOf = (s) => s.replace(/[._-].*$/, "").replace(/m$/, "").toUpperCase();
const canonOf = (s) => {
  const b = baseOf(s);
  return ALIASES.find(([, re]) => re.test(b))?.[0] || b;
};

// non-FX partners (all positive correlation)
const PARTNERS = {
  US30: [], // standalone by design
  NAS100: ["US500", "GER40"],
  US500: ["NAS100", "GER40"],
  GER40: ["UK100", "FR40", "NAS100", "US500"],
  XAUUSD: ["XAGUSD"],
  XAGUSD: ["XAUUSD"],
  BTCUSD: ["ETHUSD"],
  ETHUSD: ["BTCUSD"],
};

// FX basket — every G8 currency gets ≥2 legs (CNY crosses skipped: rarely on MT5)
const BASKET = [
  "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD",
  "EURGBP", "EURJPY", "GBPJPY", "EURCHF", "AUDJPY", "CADJPY", "NZDJPY",
];
const CCY_PARTNER = { EUR: "GBP", GBP: "EUR", AUD: "NZD", NZD: "AUD" };
const CCY = ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"];
const isFxPair = (b) => b.length === 6 && CCY.includes(b.slice(0, 3)) && CCY.includes(b.slice(3));

function structDir(bars) {
  if (!bars || bars.length < 30) return null;
  const st = analyzeStructure(bars, avgRange(bars));
  let d = st.dir;
  const ev = st.lastEvent;
  if (ev?.type === "MSS" && ev.displaced && ev.age <= 12) d = ev.dir; // fresh shift wins
  return st.ranging ? 0 : d;
}

// directional read of one symbol: full bias score when watched (±10 dead
// zone), else M15/H1 structure
function readDir(name, results, framesMap) {
  const r = results.find((x) => canonOf(x.symbol) === name);
  if (r) return { dir: Math.abs(r.score) >= 10 ? Math.sign(r.score) : 0, src: `bias ${r.score > 0 ? "+" : ""}${r.score}` };
  const key = Object.keys(framesMap).find((k) => canonOf(k) === name);
  const bars = framesMap[key]?.M15 || framesMap[key]?.H1;
  if (!bars) return null;
  const d = structDir(bars);
  return d == null ? null : { dir: d, src: "structure" };
}

// currency bias = mean leg direction across the basket (base leg +, quote −);
// directional only when a MAJORITY of legs agree
function ccyBias(ccy, results, framesMap) {
  let sum = 0;
  let n = 0;
  for (const pair of BASKET) {
    if (!pair.includes(ccy)) continue;
    const read = readDir(pair, results, framesMap);
    if (!read) continue;
    sum += read.dir * (pair.startsWith(ccy) ? 1 : -1);
    n++;
  }
  if (!n) return null;
  const v = sum / n;
  return { dir: Math.abs(v) >= 0.5 ? Math.sign(v) : 0, v, n };
}

const verdictOf = (dir, expected) => (dir === 0 ? "neutral" : dir === expected ? "aligned" : "against");

// Mutates each setup result in place: setup.group = { confirmed, checks… };
// a held setup is demoted to reversal-watch, an actively-contradicted one
// is also dampened. Fetches missing group bars itself (fail-soft, cached).
export async function confirmSetups(results, framesMap) {
  const setups = results.filter((r) => r.setup);
  if (!setups.length) return;

  // lazily fetch M15 for group symbols we can't already read
  const need = new Set();
  for (const r of setups) {
    const c = canonOf(r.symbol);
    if (isFxPair(c)) for (const p of BASKET) need.add(p);
    else for (const p of PARTNERS[c] || []) need.add(p);
  }
  const missing = [...need].filter((p) =>
    !results.some((x) => canonOf(x.symbol) === p) &&
    !Object.keys(framesMap).some((k) => canonOf(k) === p));
  await Promise.all(missing.map(async (p) => {
    try {
      const bars = await getBars(p, "M15");
      if (bars) framesMap[p] = { M15: bars };
    } catch { /* pair not on this broker — the leg just drops out */ }
  }));

  for (const r of setups) {
    const c = canonOf(r.symbol);
    const checks = [];
    let confirmed;

    if (isFxPair(c)) {
      const B = c.slice(0, 3);
      const Q = c.slice(3);
      const push = (ccy, expected, sign) => {
        const b = ccyBias(ccy, results, framesMap);
        if (!b) return null;
        const chk = { symbol: ccy, sign, dir: b.dir, src: `${b.n} legs ${b.v >= 0 ? "+" : ""}${b.v.toFixed(2)}`, verdict: verdictOf(b.dir, expected) };
        checks.push(chk);
        return chk;
      };
      const bChk = push(B, r.setup.dir, 1);
      const qChk = push(Q, -r.setup.dir, -1);
      if (CCY_PARTNER[B] && CCY_PARTNER[B] !== Q) push(CCY_PARTNER[B], r.setup.dir, 1);
      if (CCY_PARTNER[Q] && CCY_PARTNER[Q] !== B) push(CCY_PARTNER[Q], -r.setup.dir, -1);
      const against = checks.some((x) => x.verdict === "against");
      // BOTH pair currencies must actively align; correlated ccy must not contradict
      confirmed = !checks.length ? true
        : bChk?.verdict === "aligned" && qChk?.verdict === "aligned" && !against;
    } else {
      for (const p of PARTNERS[c] || []) {
        const read = readDir(p, results, framesMap);
        if (!read) continue;
        checks.push({ symbol: p, sign: 1, dir: read.dir, src: read.src, verdict: verdictOf(read.dir, r.setup.dir) });
      }
      const aligned = checks.filter((x) => x.verdict === "aligned").length;
      const against = checks.filter((x) => x.verdict === "against").length;
      // US30 (standalone) or unavailable partners → nothing to check → not blocked
      confirmed = checks.length === 0 ? true : against === 0 && aligned >= 1;
    }

    const againstWho = checks.filter((x) => x.verdict === "against").map((x) => x.symbol);
    const reason = confirmed ? null
      : againstWho.length ? `${againstWho.join(", ")} point the other way` : "group not aligned yet";
    r.setup.group = {
      confirmed,
      aligned: checks.filter((x) => x.verdict === "aligned").length,
      against: againstWho.length,
      checked: checks.length,
      reason,
      checks,
    };

    if (!confirmed) {
      r.phase = "reversal-watch"; // setup HELD until the group agrees
      if (againstWho.length) {
        r.damps.push({ label: "group not aligned", mult: 0.8, note: reason });
        r.dampMult *= 0.8;
      }
    }
  }
}
