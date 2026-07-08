// Synthetic-frame test for bias engine v5: 8 lenses + playbook setup + volume.
// Temporary — run with `node bias-v4-test.mjs`, then delete.
import { computeSymbolBias, aggregate } from "./lib/bias/engine.js";
import { LENSES } from "./lib/bias/lenses.js";
import { detectOrderBlocks, fvgZones } from "./lib/bias/zones.js";
import { confirmSetups } from "./lib/bias/group.js";
import { volumeProfile, volRatio } from "./lib/bias/volume.js";

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failed++;
};

// ---- bar builders --------------------------------------------------------
// Deterministic wiggle so structure/pivot detectors have texture.
const wig = (i, amp) => amp * Math.sin(i * 1.7) * 0.5;

function mkBars(t0, tfSec, closes, rangeMul = 1) {
  // per-bar deterministic wick jitter — without it, a local top at close[i]
  // gives bars i and i+1 IDENTICAL highs (open = prev close), and findPivots
  // demands a strict max, so no pivot would ever confirm
  const bars = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    const o = i ? closes[i - 1] : c;
    const hi = Math.max(o, c) + rangeMul * (0.4 + 0.12 * Math.abs(Math.sin(i * 2.31)));
    const lo = Math.min(o, c) - rangeMul * (0.4 + 0.12 * Math.abs(Math.sin(i * 3.17)));
    bars.push({ time: t0 + i * tfSec, open: o, high: hi, low: lo, close: c, v: 100 + 40 * Math.abs(Math.sin(i * 1.3)) });
  }
  return bars;
}

// ---- scenario: PDH sweep then M15 MSS down --------------------------------
// (the `m5` variable below IS the M15 frame — kept the name to minimize churn)
const DAY = 86400;
const day0 = 20000 * DAY; // arbitrary aligned day

// M15 yesterday (day0): a clean UPTREND 96→102 so structure dir = +1 and the
// day's top forms the PDH. 60×900s = 15h, stays inside day0 so the day-split
// in liquidityMap puts these bars in "prev day".
const yClo = [];
for (let i = 0; i < 60; i++) yClo.push(96 + (i / 59) * 6 + wig(i, 0.3));
const m5 = mkBars(day0 + 2 * 3600, 900, yClo, 1);
const pdh = Math.max(...m5.map((b) => b.high));

// M15 today (day1, 08:00–18:00): tight drift up UNDER the PDH (narrow ranges
// so no wick pokes it early) — no pivot breaks either way, dir stays +1.
const tClo = [];
for (let i = 0; i < 40; i++) tClo.push(101.5 + (i / 39) * 0.4 + wig(i, 0.15));
const m5t = mkBars(day0 + DAY + 8 * 3600, 900, tClo, 0.5);
m5.push(...m5t);

// hand-craft the sweep candle: wick above the PDH, close back below
const sweepBar = { time: m5[m5.length - 1].time + 900, open: 101.9, high: pdh + 0.6, low: 101.8, close: 102.0, v: 320 };
m5.push(sweepBar);
// displacement down on climactic volume: strong bodies breaking today's swing lows → MSS
let px = 102.0;
for (let i = 0; i < 10; i++) {
  const c = px - 1.5;
  m5.push({ time: sweepBar.time + (i + 1) * 900, open: px, high: px + 0.1, low: c - 0.2, close: c, v: 300 });
  px = c;
}

// HTF frames: mild uptrend (so the reversal fires AGAINST them)
const h1 = mkBars(day0 - 200 * 3600, 3600, Array.from({ length: 200 }, (_, i) => 95 + i * 0.05 + wig(i, 0.5)), 1.2);
const h4 = mkBars(day0 - 200 * 4 * 3600, 4 * 3600, Array.from({ length: 200 }, (_, i) => 80 + i * 0.12 + wig(i, 1)), 2);
const d1 = mkBars(day0 - 80 * DAY, DAY, Array.from({ length: 80 }, (_, i) => 60 + i * 0.5 + wig(i, 2)), 4);

const frames = { D1: d1, H4: h4, H1: h1, M15: m5 };
const r = computeSymbolBias("EURUSD", frames, {});

// ---- assertions -----------------------------------------------------------
ok(LENSES.length === 8, `LENSES registry has 8 entries (${LENSES.length})`);
const lensIds = Object.keys(r.lenses);
ok(lensIds.length === 8, `result.lenses has 8 keys: ${lensIds.join(",")}`);
ok(lensIds.every((k) => typeof r.lenses[k].label === "string"), "every lens carries a label");
ok(lensIds.every((k) => Math.abs(r.lenses[k].score) <= 100), "lens scores within -100..100");
ok(typeof r.agreement === "number", `agreement numeric (${r.agreement})`);
ok(r.stability === null || typeof r.stability === "number", `stability numeric/null (${r.stability})`);
ok(typeof r.score === "number" && Math.abs(r.score) <= 100, `score in range (${r.score})`);

console.log("\nsetup:", JSON.stringify(r.setup));
ok(!!r.setup, "playbook setup detected");
if (r.setup) {
  ok(r.setup.dir === -1, `setup dir is -1 (${r.setup.dir})`);
  ok(r.setup.mssTf === "M15", `MSS TF is M15 (${r.setup.mssTf})`);
  ok(r.phase === "setup", `phase is "setup" (${r.phase})`);
  ok(r.factors.some((f) => f.label.startsWith("sweep →")), "sweep→MSS factor present");
}

// aggregate must not overwrite the setup phase
const agg = aggregate([r]);
ok(!r.setup || r.phase === "setup", `aggregate kept phase (${r.phase})`);
ok(Array.isArray(agg.categories), "aggregate returns categories");

// ---- zone detectors sanity -----------------------------------------------
const obs = detectOrderBlocks(m5, 1);
console.log(`\norder blocks on M15: ${obs.length}`, obs.slice(-2));
ok(obs.every((z) => z.top >= z.bottom), "OB zones well-formed (top>=bottom)");
ok(obs.some((z) => z.dir === -1), "bearish OB left behind by the breakdown");

const gaps = fvgZones(m5, 1);
ok(Array.isArray(gaps), `fvgZones returns array (${gaps.length} zones)`);
ok(gaps.every((z) => z.state === "open" || z.state === "inverted"), "gap states valid");

// ---- volume ----------------------------------------------------------------
const vp = volumeProfile(m5.slice(0, 60), 1); // prior-day slice
console.log("\nprior-day profile:", vp && { poc: vp.poc.toFixed(2), vah: vp.vah.toFixed(2), val: vp.val.toFixed(2), hvns: vp.hvns.length, lvns: vp.lvns.length });
ok(!!vp, "volumeProfile builds from tick volume");
ok(vp && vp.val <= vp.poc && vp.poc <= vp.vah, `val ≤ poc ≤ vah (${vp?.val.toFixed(2)} ≤ ${vp?.poc.toFixed(2)} ≤ ${vp?.vah.toFixed(2)})`);
ok(vp && vp.hvns.every((h) => h.price >= vp.val - 10 && h.price <= vp.vah + 10), "HVNs within sane bounds");

const sweepIdx = m5.indexOf(sweepBar);
const svr = volRatio(m5, sweepIdx);
ok(svr != null && svr >= 1.8, `sweep bar reads climactic (${svr}×)`);
ok(r.factors.some((f) => f.label.endsWith("swept") && /climactic/.test(f.note)), "sweep factor annotated with climactic volume");
ok(r.setup?.volRatio >= 1.8, `setup volume-vetted (${r.setup?.volRatio}×)`);
ok(r.setup?.grade === "A", `climactic MSS keeps/earns grade A (${r.setup?.grade})`);
ok(r.lenses.volume.n > 0, `volume lens has drives (n=${r.lenses.volume.n})`);

// no-volume degradation: strip v → engine still works, volume lens silent
const stripV = (bars) => bars?.map(({ v, ...b }) => b) ?? null;
const framesNoV = Object.fromEntries(Object.entries(frames).map(([tf, b]) => [tf, stripV(b)]));
const r0 = computeSymbolBias("EURUSD", framesNoV, {});
ok(r0.lenses.volume.n === 0, "no volume data → volume lens silent");
ok(!!r0.setup && typeof r0.score === "number", `engine unchanged without volume (score ${r0.score}, setup ${!!r0.setup})`);
ok(r0.setup?.volRatio == null, "setup volRatio null without volume");

// ---- group confirmation v2 --------------------------------------------------
// FX: per-currency bias across the basket. EURUSD short needs EUR weak AND
// USD strong; GBP (correlated ccy) must not contradict. Basket pairs not in
// results are fetched — offline here, so those legs just drop out.
const mkResult = (symbol, score) => ({
  symbol, score, phase: "trend", damps: [], dampMult: 1, factors: [], setup: null,
});
const setupRes = (symbol = "EURUSD") => {
  const x = mkResult(symbol, -60);
  x.phase = "setup";
  x.setup = { dir: -1, pool: "PDH", sweptAgo: 5, mssTf: "M15", mssAgeMin: 15, grade: "A" };
  return x;
};

let a = setupRes();
await confirmSetups([a, mkResult("GBPUSD", -40), mkResult("USDCHF", 35)], {});
ok(a.setup.group?.confirmed === true, `FX confirms: EUR weak + USD strong + GBP weak (${JSON.stringify(a.setup.group?.checks)})`);
ok(a.phase === "setup", `confirmed setup keeps phase (${a.phase})`);

let b = setupRes();
await confirmSetups([b, mkResult("GBPUSD", 40), mkResult("USDCHF", 35)], {});
ok(b.setup.group?.confirmed === false, "GBP strong contradicts a EUR-weak setup → blocked");
ok(b.phase === "reversal-watch", `contradicted setup demoted (${b.phase})`);
ok(b.damps.some((d) => d.label === "group not aligned"), "contradiction adds dampener");
ok(Math.abs(b.dampMult - 0.8) < 1e-9, `dampMult scaled (${b.dampMult})`);

let c = setupRes();
await confirmSetups([c, mkResult("GBPUSD", 3), mkResult("USDCHF", -5)], {});
ok(c.setup.group?.confirmed === false, "USD legs not a majority → held (both currencies must align)");
ok(c.phase === "reversal-watch" && !c.damps.length, "held-not-contradicted: demoted but NOT damped");

// indices: US30 is standalone — never gated
let u = setupRes("US30");
await confirmSetups([u], {});
ok(u.setup.group?.confirmed === true && u.setup.group.checked === 0, "US30 standalone → auto-confirmed, zero checks");

// alias matching: GER30 on the watchlist satisfies a NAS100 partner check
let nx = setupRes("NDX100");
await confirmSetups([nx, mkResult("GER30", 40)], {});
ok(nx.setup.group?.confirmed === false, "NAS100 setup blocked by opposing GER30 (alias→GER40)");

console.log("\nlenses:", JSON.stringify(r.lenses, null, 1));
console.log("\ntop factors:", r.factors.slice(0, 6).map((f) => `${f.label} [${f.lens}] w${f.w}`).join(" | "));
console.log(`\n${failed ? `${failed} FAILURES` : "ALL PASS"}`);
process.exit(failed ? 1 : 0);
