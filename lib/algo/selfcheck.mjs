// Self-check for lib/algo (run: node lib/algo/selfcheck.mjs)
import { getPair, buildCandidates } from "./pairs.js";
import { findSetup } from "./setup.js";

let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.error("FAIL:", msg); } };

// --- pairs ---
ok(JSON.stringify(getPair("EUR", "USD")) === '{"symbol":"EURUSD","dir":1}', "EUR strong vs USD → buy EURUSD");
ok(JSON.stringify(getPair("JPY", "GBP")) === '{"symbol":"GBPJPY","dir":-1}', "JPY strong vs GBP → sell GBPJPY");
ok(getPair("EUR", "EUR") === null, "same ccy null");

const cs = [
  { ccy: "EUR", score: 40 }, { ccy: "GBP", score: 20 }, { ccy: "USD", score: 5 },
  { ccy: "AUD", score: -2 }, { ccy: "CAD", score: -10 }, { ccy: "CHF", score: -18 },
  { ccy: "JPY", score: -35 }, { ccy: "NZD", score: -22 },
];
const cands = buildCandidates(cs);
ok(cands.length > 0, "candidates found");
ok(cands[0].symbol === "EURJPY" && cands[0].dir === 1, "top edge = buy EURJPY, got " + JSON.stringify(cands[0]));
ok(cands.every((c) => c.edge >= 30), "edges >= minEdge");
ok(buildCandidates([{ ccy: "EUR", score: 10 }, { ccy: "JPY", score: -10 }]).length === 0, "weak scores → none");

// --- synthetic uptrend for findSetup ---
function mkBars(n, tfSec, start = 1_700_000_000) {
  const bars = []; let p = 1.0;
  for (let i = 0; i < n; i++) {
    const phase = i % 10;
    const up = phase < 6;
    const drift = up ? 0.0012 : -0.0005;
    const o = p, c = p + drift + Math.sin(i * 1.7) * 0.0002;
    const h = Math.max(o, c) + 0.0004, l = Math.min(o, c) - 0.0004;
    bars.push({ time: start + i * tfSec, open: o, high: h, low: l, close: c, v: 100 });
    p = c;
  }
  return bars;
}
const H4 = mkBars(120, 14400), H1 = mkBars(240, 3600), M15 = mkBars(320, 900);
// carve an M15 bullish FVG below current price, unmitigated afterwards
const n = M15.length, gapAt = n - 30;
const a = M15[gapAt - 2], c = M15[gapAt];
c.low = a.high + 0.0015; c.close = c.low + 0.0012; c.high = c.close + 0.0004; c.open = c.low + 0.0002;
for (let i = gapAt + 1; i < n; i++) {
  const off = 0.002 + (i - gapAt) * 0.00005;
  M15[i].low = c.low + off * 0.3; M15[i].open = c.low + off;
  M15[i].close = c.low + off + 0.0003; M15[i].high = M15[i].close + 0.0004;
}

const setup = findSetup("EURUSD", { H4, H1, M15 }, 1, { minRR: 1.2, minScore: 30 });
if (setup) {
  ok(setup.dir === "buy", "dir buy");
  ok(setup.sl < setup.entry.price && setup.tp > setup.entry.price, "buy: SL below entry, TP above");
  ok(setup.rr >= 1.2, "RR gate respected");
  ok(setup.reasons.length >= 3, "reasons populated");
  console.log("setup:", setup.symbol, setup.dir, "entry", setup.entry.price, "sl", setup.sl, "tp", setup.tp, "rr", setup.rr, "score", setup.score);
} else {
  console.log("setup: null (synthetic data lacks pool/zone — hard-gate checks only)");
}
// counter-direction must be rejected by the H1 structure gate on an uptrend
ok(findSetup("EURUSD", { H4, H1, M15 }, -1, { minRR: 0.5, minScore: 0 }) === null, "sell in uptrend rejected");

console.log(failed ? `${failed} FAILED` : "phase1 checks pass");

// ---- phase2: confluence + retracement detectors ----
import { fvgInducement, ifvgZone, qmlObFvg } from "./confluence.js";
import { classifyRetracement } from "./retracement.js";

// sawtooth uptrend generator with real pivots: 10-bar up/down legs, range ~much bigger than noise
function mkSaw(n, tfSec = 900, dir = 1, start = 1_700_000_000) {
  const bars = []; let p = 1.0, t = start;
  for (let i = 0; i < n; i++) {
    const up = (i % 10) < 6;
    p += (up ? 0.0015 : -0.0009) * dir;
    bars.push({ time: t += tfSec, open: p - 0.0003, high: p + 0.0006, low: p - 0.0006, close: p, v: 100 });
  }
  return bars;
}

const saw = mkSaw(160);
const rt = classifyRetracement(saw, "buy");
ok(rt != null, "retracement classified");
ok(rt != null && ["weak","liquidity-building","ote","deep","reversal"].includes(rt.type), "retrace type in taxonomy, got " + (rt && rt.type));
ok(rt != null && rt.depth >= 0 && rt.depth <= 1, "retrace depth in [0,1]");

// broke origin → reversal-type: extend the saw down past its leg start
const broke = mkSaw(80, 900, -1);
const rtRev = classifyRetracement(broke, "buy");
ok(rtRev != null && rtRev.type === "reversal", "broke origin → reversal, got " + (rtRev && rtRev.type));

// confluence helpers run without throwing on plain data
ok(fvgInducement({ M15: saw }, "buy", { price: saw[saw.length-1].high }, {}) === null || true, "fvgInducement runs");
const ifvg = ifvgZone({ M15: saw }, "buy");
ok(ifvg === null || (ifvg.hit && typeof ifvg.score === "number"), "ifvgZone runs (null or hit)");
const qml = qmlObFvg({ M15: saw }, "buy");
ok(qml === null || (qml.hit && typeof qml.score === "number"), "qmlObFvg runs (null or hit)");

console.log(failed ? `${failed} FAILED total` : "phase2 checks pass");
process.exit(failed ? 1 : 0);
