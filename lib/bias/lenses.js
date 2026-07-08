// Lens ensemble — the final bias is a REGIME-WEIGHTED VOTE of seven models
// that each read the same market through one concept:
//   structure — continuation: swing sequences, breaks holding, displacement
//   liquidity — pools: sweeps (against), draws/magnets, weekly stop hunts
//   reversal  — the trap: sweeps→MSS, QML, wicks, V-shapes; the user's playbook
//               (pool sweep → 1M/5M MSS) lives here with the largest weight
//   fvg       — imbalance: unfilled gap stacks, inversions (iFVG)
//   ob        — order blocks: unmitigated origin candles of displacement legs
//   sr        — levels: defended strong highs/lows, SR flips, premium/discount
//   flow      — the group: SMT, risk tape, currency/category consensus
//
// Each lens has a FITNESS for the current regime (a reversal lens is most
// credible right after a sweep; structure/fvg during expansion; sr in ranges;
// ob when price is actually at a zone; flow when several group signals
// corroborate). Disagreement is output, not noise — and stability()
// stress-tests the verdict by jittering every weight ±30% across 200 seeded
// trials: a bias that flips under small perturbation is FRAGILE no matter how
// big its score.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const LENSES = [
  { id: "structure", label: "Structure", base: 1.0 },
  { id: "liquidity", label: "Liquidity", base: 1.0 },
  { id: "reversal", label: "Reversal", base: 1.1 }, // playbook priority
  { id: "fvg", label: "FVG", base: 0.8 },
  { id: "ob", label: "Order Blk", base: 0.85 },
  { id: "sr", label: "S/R", base: 0.9 },
  { id: "volume", label: "Volume", base: 0.9 },
  { id: "flow", label: "Flow", base: 0.7 },
];

const BASE = Object.fromEntries(LENSES.map((l) => [l.id, l.base]));

// ctx: { er (H1 efficiency ratio 0..1), reversalPush (signed), flowN,
//        liveLevels (pools+sweeps in play), obNear (price at an unmitigated OB),
//        relPart (fast/slow volume SMA — participation) }
export function lensFitness(ctx) {
  const erNorm = clamp(((ctx.er ?? 0) - 0.2) / 0.25, 0, 1);
  return {
    structure: 0.55 + 0.45 * erNorm,
    liquidity: 0.6 + 0.08 * Math.min(ctx.liveLevels ?? 0, 5),
    reversal: 0.55 + 0.45 * clamp(Math.abs(ctx.reversalPush ?? 0) / 25, 0, 1),
    fvg: 0.55 + 0.35 * erNorm,
    ob: ctx.obNear ? 0.9 : 0.6,
    sr: 0.55 + 0.45 * (1 - erNorm),
    volume: 0.5 + 0.4 * clamp((ctx.relPart ?? 0) / 1.25, 0, 1), // trusted when the tape is awake
    flow: 0.5 + 0.1 * Math.min(ctx.flowN ?? 0, 5),
  };
}

export function lensVote(drives, fitness) {
  const lenses = {};
  for (const { id, label } of LENSES) {
    const members = drives.filter((d) => d.lens === id);
    const w = members.reduce((s, d) => s + d.w, 0);
    lenses[id] = {
      label,
      score: w ? Math.round((members.reduce((s, d) => s + d.dir * d.w, 0) / w) * 100) : 0,
      fitness: Math.round(fitness[id] * 100) / 100,
      n: members.length,
    };
  }

  // regime-weighted vote over lenses that actually have evidence
  let num = 0;
  let den = 0;
  for (const [id, l] of Object.entries(lenses)) {
    if (!l.n) continue;
    const wt = BASE[id] * l.fitness;
    num += l.score * wt;
    den += wt;
  }
  const final = den ? clamp(num / den, -100, 100) : 0;

  // agreement: share of (fitness × magnitude) pointing with the verdict
  let agreeMass = 0;
  let mass = 0;
  for (const [id, l] of Object.entries(lenses)) {
    if (!l.n || Math.abs(l.score) < 10) continue;
    const m = BASE[id] * l.fitness * Math.abs(l.score);
    mass += m;
    if (Math.sign(l.score) === Math.sign(final)) agreeMass += m;
  }
  const agreement = mass ? Math.round((agreeMass / mass) * 100) : 100;
  const contested = agreement < 70;

  return { lenses, final, agreement, contested };
}

// ---- stability: does the verdict survive ±30% weight jitter? ----
// Deterministic PRNG so the same inputs always report the same number.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function stability(drives, fitness, finalScore, trials = 200) {
  if (Math.abs(finalScore) < 5) return null; // no verdict to stress-test
  const sign = Math.sign(finalScore);
  const rand = mulberry32(drives.length * 7919 + Math.round(Math.abs(finalScore)));
  let survived = 0;
  const jittered = drives.map((d) => ({ ...d }));
  for (let t = 0; t < trials; t++) {
    for (let i = 0; i < jittered.length; i++) {
      jittered[i].w = drives[i].w * (0.7 + 0.6 * rand());
    }
    if (Math.sign(lensVote(jittered, fitness).final) === sign) survived++;
  }
  return Math.round((survived / trials) * 100);
}
