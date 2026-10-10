// Lens ensemble — the final bias is a REGIME-WEIGHTED VOTE of eight models
// that each read the same market through one concept:
//   structure — continuation: swing sequences, breaks holding, displacement
//   liquidity — pools: sweeps (against), draws/magnets, weekly stop hunts
//   reversal  — the trap: sweeps→MSS, QML, wicks, V-shapes; the user's playbook
//               (pool sweep → 1M/5M MSS) lives here with the largest weight
//   fvg       — imbalance: unfilled gap stacks, inversions (iFVG)
//   ob        — order blocks: unmitigated origin candles of displacement legs
//   sr        — levels: defended strong highs/lows, SR flips, premium/discount
//   volume    — participation: volume profile POC, value area acceptance (VAH/VAL), HVN/LVN
//   flow      — the group: SMT, risk tape, currency/category consensus
//
// Each lens has a FITNESS for the current regime (a reversal lens is most
// credible right after a sweep; structure/fvg during expansion; sr in ranges;
// ob when price is actually at a zone; flow when several group signals
// corroborate). Disagreement is output, not noise — and stability()
// stress-tests the verdict by jittering model and drive weights across 200 seeded
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
//        obDist (distance to nearest OB in avg units), hasFreshOb (displacement left fresh block),
//        relPart (fast/slow volume SMA — participation) }
export function lensFitness(ctx) {
  // Smoothstep transition over a wider band [0.15, 0.50] to eliminate the 1-candle knife-edge cliff
  const rawEr = clamp(((ctx.er ?? 0) - 0.15) / 0.35, 0, 1);
  const erNorm = rawEr * rawEr * (3 - 2 * rawEr);

  // Continuous exponential distance decay for Order Block fitness + fresh displacement OB awareness
  let obFit;
  if (Number.isFinite(ctx.obDist)) {
    obFit = Math.max(ctx.hasFreshOb ? 0.85 : 0.60, 0.60 + 0.35 * Math.exp(-ctx.obDist / 0.8));
  } else {
    obFit = ctx.hasFreshOb ? 0.85 : (ctx.obNear ? 0.9 : 0.6);
  }

  const revPush = ctx.reversalPush != null ? Math.abs(ctx.reversalPush) : (ctx.setupActive ? 25 : 0);

  return {
    structure: 0.55 + 0.45 * erNorm,
    liquidity: 0.6 + 0.08 * Math.min(ctx.liveLevels ?? 0, 5),
    reversal: 0.55 + 0.45 * clamp(revPush / 25, 0, 1),
    fvg: 0.55 + 0.35 * erNorm,
    ob: obFit,
    sr: 0.55 + 0.45 * (1 - erNorm),
    volume: 0.5 + 0.4 * clamp((ctx.relPart ?? 0) / 1.25, 0, 1), // trusted when the tape is awake
    flow: 0.5 + 0.1 * Math.min(ctx.flowN ?? 0, 5),
  };
}

export function lensVote(drives, fitness, options = {}) {
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

  // ICT Sequential Override:
  // When a verified Sweep -> MSS reversal is active, the prior trend continuation
  // was merely the precondition building the swept liquidity pool.
  // Temporarily subordinate the weight of opposing structure and FVG continuation lenses
  // so the textbook reversal is not diluted to ~0 by the democracy paradox.
  const revLens = lenses.reversal;
  const hasActiveReversal = Boolean(options.setupActive || (revLens && Math.abs(revLens.score) >= 40 && revLens.fitness >= 0.70));
  const revDir = options.setupDir || (revLens ? Math.sign(revLens.score) : 0);

  // regime-weighted vote over lenses that actually have evidence
  // Scaled by evidence mass to prevent lone micro-signals from hijacking the consensus
  let num = 0;
  let den = 0;
  for (const [id, l] of Object.entries(lenses)) {
    if (!l.n) continue;
    const members = drives.filter((d) => d.lens === id);
    const wTotal = members.reduce((s, d) => s + d.w, 0);

    // Calibrated saturation ceiling: Volume and Flow have lower maximum concurrent drive capacity (~9)
    const cap = (id === "volume" || id === "flow") ? 9 : 16;
    const massMult = clamp(wTotal / cap, 0.45, 1.0);

    let baseWeight = BASE[id];
    if (hasActiveReversal && revDir !== 0) {
      if ((id === "structure" || id === "fvg") && Math.sign(l.score) !== revDir && Math.abs(l.score) >= 15) {
        baseWeight *= 0.35; // Reversal regime override: subordinate opposing continuation
      } else if (id === "reversal" && (Math.sign(l.score) === revDir || l.score === 0)) {
        baseWeight *= 1.35; // Elevate active reversal authority
      }
    }

    const wt = baseWeight * l.fitness * massMult;

    // Intra-Lens Deadlock correction:
    // When a lens is internally conflicted (score near 0), scale denominator weight by directional conviction
    // so it doesn't act as a 1.0x dead-weight anchor pulling the entire market bias to zero
    const conviction = Math.abs(l.score) / 100;
    const effWeight = wt * (0.35 + 0.65 * conviction);

    num += l.score * wt;
    den += effWeight;
  }
  const final = den ? clamp(num / den, -100, 100) : 0;

  // agreement: share of (fitness × magnitude) pointing with the verdict
  // Internally deadlocked lenses (split mass) are included in total mass to accurately reflect contestation
  let agreeMass = 0;
  let mass = 0;
  for (const [id, l] of Object.entries(lenses)) {
    if (!l.n) continue;
    const members = drives.filter((d) => d.lens === id);
    const wTotal = members.reduce((s, d) => s + d.w, 0);
    const cap = (id === "volume" || id === "flow") ? 9 : 16;
    const massMult = clamp(wTotal / cap, 0.45, 1.0);

    let baseWeight = BASE[id];
    if (hasActiveReversal && revDir !== 0) {
      if ((id === "structure" || id === "fvg") && Math.sign(l.score) !== revDir && Math.abs(l.score) >= 15) {
        baseWeight *= 0.35;
      } else if (id === "reversal" && Math.sign(l.score) === revDir) {
        baseWeight *= 1.35;
      }
    }

    const wt = baseWeight * l.fitness * massMult;
    const posW = members.filter((d) => d.dir > 0).reduce((s, d) => s + d.w, 0);
    const negW = members.filter((d) => d.dir < 0).reduce((s, d) => s + d.w, 0);
    const conflictRatio = wTotal > 0 ? (2 * Math.min(posW, negW)) / wTotal : 0;
    const effMag = Math.max(Math.abs(l.score), conflictRatio * 100);
    const m = wt * effMag;
    mass += m;
    if (Math.abs(l.score) >= 10 && Math.sign(l.score) === Math.sign(final)) {
      agreeMass += wt * Math.abs(l.score);
    }
  }
  const agreement = mass ? Math.round((agreeMass / mass) * 100) : 100;
  const contested = agreement < 65;

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

export function stability(drives, fitness, finalScore, trials = 200, options = {}) {
  if (Math.abs(finalScore) < 5) return null; // no verdict to stress-test
  const sign = Math.sign(finalScore);
  const rand = mulberry32(drives.length * 7919 + Math.round(Math.abs(finalScore)));
  let survived = 0;
  const jittered = drives.map((d) => ({ ...d }));

  for (let t = 0; t < trials; t++) {
    // Model-level perturbation to prevent Central Limit Theorem distortion
    // (Ensures multi-drive lenses aren't unfairly smoothed while single-drive lenses take full variance)
    const lensJitter = {};
    for (const { id } of LENSES) {
      lensJitter[id] = 0.75 + 0.50 * rand(); // ±25% model-level shock
    }
    for (let i = 0; i < jittered.length; i++) {
      const lj = lensJitter[jittered[i].lens] ?? 1.0;
      jittered[i].w = drives[i].w * lj * (0.92 + 0.16 * rand()); // model + idiosyncratic micro-variance
    }
    if (Math.sign(lensVote(jittered, fitness, options).final) === sign) survived++;
  }
  return Math.round((survived / trials) * 100);
}
