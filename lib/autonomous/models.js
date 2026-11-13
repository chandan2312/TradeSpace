// Strict causal entry models. A model is eligible only after its complete
// chronological sequence exists in closed bars; there is deliberately no
// auction/ATR fallback. T1 owns the institutional primitives used here.
import { confirmedFractals, displacementAt, detectPDArrays, detectLiquidityRaids } from "../bias/institutional.js";
import { avgRange } from "../patterns/core.js";
import { getSilverBulletWindow, getEetTime, getCurrentTimeSlot, getStartOfTradingDay, isTradingPermittedNow } from "./timeslots.js";
import { canonOf } from "./symbols.js";
import { FRAME_SPEC, normalizeClosedBars } from "../bias/data.js";
import { evaluateEntryModelDecisionEngine } from "./entryDecisionEngine.js";
import { calculateStructuralStopLoss, auditStopLossIntegrity } from "./slEngine.js";

export const ENTRY_MODEL_DEFINITIONS = {
  ICT_2022: { id: "ict_2022", name: "ICT 2022 Mentorship Model", badge: "2022 Mentorship", description: "Sweep → displaced MSS → associated eligible virgin FVG → CE limit." },
  TURTLE_SOUP: { id: "turtle_soup", name: "Turtle Soup Liquidity Raid", badge: "Turtle Soup", description: "Major external raid of 3–15 symbol units → rejection → reclaim within two bars." },
  BREAKER_BLOCK: { id: "breaker_block", name: "Breaker Block & Mitigation Retest", badge: "Breaker Block", description: "Failed opposing OB → raid/displaced structure failure → retest of the breaker." },
  OTE_CONTINUATION: { id: "ote_continuation", name: "OTE Trend Expansion", badge: "OTE Sweetspot", description: "Aligned impulse → .618–.786 retracement with an embedded valid FVG/OB." },
  SILVER_BULLET: { id: "silver_bullet", name: "ICT Silver Bullet Window", badge: "Silver Bullet", description: "London 10–11 or NY 17–18 EET only; in-window displacement and opposing unconsumed session target." },
  DISPLACEMENT_BREAKOUT: { id: "displacement_breakout", name: "Displacement Momentum Breakout (Deprecated)", badge: "Momentum Breakout", description: "Disabled: Retail momentum chase that buys tops and sells bottoms." },
  JUDAS_SWING: { id: "judas_swing", name: "London Judas Swing Reversal", badge: "Judas Swing", description: "London Open (07:00-09:30 UTC) false raid of Asian Range or PDH/PDL with 15M displacement MSS reversal back into HTF trend." },
  SMT_DIVERGENCE_SWEEP: { id: "smt_divergence_sweep", name: "SMT Intermarket Sweep", badge: "SMT Divergence", description: "Liquidity extreme raid accompanied by contemporaneous non-confirmation divergence from correlated benchmark partner." },
  FVG_REJECTION: { id: "fvg_rejection", name: "Virgin FVG Volume Imbalance Rejection (Deprecated)", badge: "FVG Rejection", description: "Disabled: Unbounded momentum chase that buys tops / sells drops without structural discount or liquidity sweep." },
  PO3_DAILY_CYCLE: { id: "po3_daily_cycle", name: "Power of 3 Daily Cycle", badge: "PO3 Cycle", description: "NY Midnight / Daily Open manipulation into discount/premium followed by 15M displacement reclaim." },
};

const BREAKDOWN_WEIGHTS = {
  // Positive Confluence Factors
  dolAlignment: 25,
  premiumDiscount: 20,
  displacement: 20,
  retracementQuality: 15,
  killzone: 15,
  smt: 10,
  htfPdArray: 10,
  // Negative Friction & Hazard Deductions
  opposingFriction: -10,
  velocityDrag: -14,
  staleAge: -8,
  runwayExhaustion: -10,
  spreadDrag: -6,
  macroHeadwind: -15,
  timingLull: -15,
};
const finite = value => value != null && Number.isFinite(Number(value));
const timeOf = b => Number(b?.time ?? b?.t) * (Number(b?.time ?? b?.t) < 1e11 ? 1000 : 1);
const side = (dir, a, b) => dir === 1 ? a > b : a < b;
const opposite = (dir, a, b) => dir === 1 ? a < b : a > b;
const confirmedRange = r => Boolean(r && finite(r.high) && finite(r.low) && r.high > r.low);

export function symbolUnits(symbol, config = {}) {
  const meta = config.symbolMeta?.[symbol] || config.symbolMeta?.[canonOf(symbol)] || config.brokerMeta?.[symbol] || config.symbolMeta || {};
  const canonical = canonOf(symbol);
  const category = /^(US30|NAS100|US500|GER40|UK100|JP225)/.test(canonical) ? "index" : /^(XAUUSD|XAGUSD)/.test(canonical) ? "metal" : /^(BTC|ETH)/.test(canonical) ? "crypto" : /^[A-Z]{6}$/.test(canonical) ? "fx" : "unknown";
  // Price units for analysis only. Tick/contract values are NOT inferred here.
  const canonicalPip = category === "fx" ? (canonical.endsWith("JPY") ? .01 : .0001) : canonical === "XAUUSD" ? .1 : canonical === "XAGUSD" ? .01 : category === "index" || category === "crypto" ? 1 : null;
  const pip = Number(meta.pipSize ?? meta.pip ?? meta.analysisUnit ?? canonicalPip);
  const point = Number(meta.point ?? meta.pointSize ?? meta.tickSize ?? (meta.digits != null ? 10 ** -Number(meta.digits) : canonicalPip));
  const spread = Number(config.spreadPrice ?? meta.spreadPrice ?? (finite(meta.spreadPoints) ? meta.spreadPoints * point : 0));
  const defaultDigits = category === "fx" ? (canonical.endsWith("JPY") ? 3 : 5) : category === "metal" ? (canonical === "XAUUSD" ? 2 : 3) : category === "crypto" ? 2 : category === "index" ? 1 : 4;
  const digits = meta.digits != null ? Number(meta.digits) : defaultDigits;
  return { category, pip: pip > 0 ? pip : null, point: point > 0 ? point : null, spread: Math.max(0, spread), unitLabel: category === "fx" ? "pip" : "price point", source: meta.point || meta.pipSize ? "broker_metadata" : "canonical_analysis_only", name: meta.name || symbol, digits };
}

export function formatPrice(price, units) {
  if (!finite(price)) return price;
  const digits = units?.digits ?? 5;
  return Number(Number(price).toFixed(digits));
}

export function getFrameBars(frames, tf) {
  if (!frames) return [];
  if (frames[tf]?.length) return frames[tf];
  const map = {
    "15M": "M15", "M15": "15M",
    "5M": "M5", "M5": "5M",
    "30M": "M30", "M30": "30M",
    "1H": "H1", "H1": "1H",
    "4H": "H4", "H4": "4H",
    "1D": "D1", "D1": "1D",
  };
  const alt = map[tf];
  if (alt && frames[alt]?.length) return frames[alt];
  return [];
}

function barsFor(frames, scenario) {
  const sId = String(scenario?.id || "").toLowerCase();
  if (sId === "scalp") {
    const m5 = getFrameBars(frames, "M5");
    if (m5.length) return m5;
    const m15 = getFrameBars(frames, "M15");
    if (m15.length) return m15;
    return getFrameBars(frames, "M30");
  }
  if (sId === "swing") {
    const h4 = getFrameBars(frames, "H4");
    if (h4.length) return h4;
    const d1 = getFrameBars(frames, "D1");
    if (d1.length) return d1;
    return getFrameBars(frames, "H1");
  }
  const m15 = getFrameBars(frames, "M15");
  if (m15.length) return m15;
  return getFrameBars(frames, "H1");
}

function freshPda(frames, tf, dir) {
  const bars = getFrameBars(frames, tf);
  if (!bars?.length) return { fvgs: [], orderBlocks: [], ifvgs: [], breakers: [] };
  const pd = detectPDArrays(bars, { tf });
  const eligible = z => z && z.dir === dir && z.eligible !== false && ["VIRGIN", "PARTIALLY_MITIGATED", "RESPECTED"].includes(String(z.state || "").toUpperCase()) && finite(z.top) && finite(z.bottom);
  const eligibleIfvgs = (pd?.ifvgs || []).filter(z => z && z.dir === dir && !["INVALIDATED", "RECLAIMED"].includes(String(z.state || "").toUpperCase()) && finite(z.top) && finite(z.bottom));
  return {
    fvgs: (pd?.fvgs || pd?.fvg || []).filter(eligible),
    orderBlocks: (pd?.orderBlocks || pd?.obs || []).filter(eligible),
    breakers: (pd?.breakers || []).filter(z => z && z.dir === dir && finite(z.top) && finite(z.bottom)),
    ifvgs: eligibleIfvgs,
    all: pd,
  };
}

const bornAt = z => Number(z.born ?? z.i ?? z.formationIndex);
const ceUntouched = (z, bars) => !bars.slice(bornAt(z) + 1).some(b => z.dir === 1 ? b.low <= z.ce : b.high >= z.ce);
const liveTarget = z => z && z.causal !== false && z.consumed !== true && !["swept", "broken", "consumed", "invalidated", "fully_mitigated"].includes(String(z.state || "").toLowerCase());
const alignedTargetSide = (target, dir) => {
  if (!target) return false;
  if (target.direction != null && target.direction !== dir) return false;
  if (target.side != null && (target.side === 1 || target.side === -1) && target.side !== dir) return false;
  if (target.targetSide != null) {
    const s = String(target.targetSide).toUpperCase();
    if (dir === 1 && !["BSL", "BUY", "LONG", "UP", "HIGH", "ABOVE"].includes(s)) return false;
    if (dir === -1 && !["SSL", "SELL", "SHORT", "DOWN", "LOW", "BELOW"].includes(s)) return false;
  }
  return true;
};

// Only completed sessions/days provide major raid levels; formation timestamps
// make them causal even when evaluated on another timeframe.
function majorLevels(frames, now) {
  const levels = [];
  const today = getStartOfTradingDay(new Date(now));
  const d1 = getFrameBars(frames, "D1");
  const previous = d1.filter(b => (b.closeTime ? b.closeTime * 1000 : timeOf(b) + 86400000) <= today).at(-1);
  if (previous) {
    const confirmationTime = previous.closeTime ?? previous.time + 86400;
    levels.push({ id: `PDH:${previous.time}`, name: "PDH", price: previous.high, side: 1, confirmationTime, major: true },
      { id: `PDL:${previous.time}`, name: "PDL", price: previous.low, side: -1, confirmationTime, major: true });
  }
  const m15 = getFrameBars(frames, "M15");
  const groups = new Map();
  const sessions = [{ name: "ASIA", start: 120, end: 480 }, { name: "LONDON", start: 600, end: 900 }, { name: "NY", start: 900, end: 1380 }];
  for (const b of m15) {
    const minute = getEetTime(new Date(timeOf(b))).totalMinutes;
    const session = sessions.find(s => minute >= s.start && minute < s.end);
    if (!session) continue;
    const day = getStartOfTradingDay(new Date(timeOf(b)));
    const key = `${day}:${session.name}`;
    if (!groups.has(key)) groups.set(key, { session, day, bars: [] });
    groups.get(key).bars.push(b);
  }
  for (const [key, group] of groups) {
    const last = group.bars.at(-1);
    const closedMinute = getEetTime(new Date((last.closeTime ?? last.time + 900) * 1000)).totalMinutes;
    const expected = (group.session.end - group.session.start) / 15;
    if (group.bars.length !== expected || getEetTime(new Date(timeOf(group.bars[0]))).totalMinutes !== group.session.start ||
      group.bars.some((b, i) => i && b.time - group.bars[i - 1].time !== 900)) continue;
    if (closedMinute !== group.session.end || (last.closeTime ?? last.time + 900) * 1000 > now) continue;
    const confirmationTime = last.closeTime ?? last.time + 900;
    levels.push({ id: `${key}:HIGH`, name: `${group.session.name} High`, price: Math.max(...group.bars.map(b => b.high)), side: 1, confirmationTime, major: true, session: group.session.name },
      { id: `${key}:LOW`, name: `${group.session.name} Low`, price: Math.min(...group.bars.map(b => b.low)), side: -1, confirmationTime, major: true, session: group.session.name });
  }
  return levels;
}

function unconsumedLevel(level, bars) {
  return liveTarget(level) && !bars.some(b => b.time > level.confirmationTime && (level.side === 1 ? b.high >= level.price : b.low <= level.price));
}

function externalLevels(frames, ranges, targetDOL, brain, dir, entry) {
  const out = [];
  const push = (id, price, kind, source, tf) => {
    if (finite(price) && side(dir, Number(price), entry)) out.push({ id, price: Number(price), kind, source, tf });
  };
  if (targetDOL?.price != null && liveTarget(targetDOL) && alignedTargetSide(targetDOL, dir)) push(targetDOL.id || "dol", targetDOL.price, "DOL", targetDOL.name || "draw on liquidity", targetDOL.tf);
  const map = ranges?.ranges || ranges || {};
  for (const tf of ["M15", "H1", "H4", "D1"]) {
    const r = map[tf];
    const anchor = dir > 0 ? r?.highAnchor : r?.lowAnchor;
    const price = dir > 0 ? r?.high : r?.low;
    const bars = getFrameBars(frames, tf);
    if (confirmedRange(r) && finite(price) && bars?.length && anchor?.confirmationTime != null &&
        unconsumedLevel({ price, side: dir, confirmationTime: anchor.confirmationTime }, bars)) {
      push(`${r.id}:${dir}`, price, tf === "M15" || tf === "H1" ? "internal" : "external", "protected dealing-range extreme", tf);
    }
  }
  for (const pool of [
    ...(brain?.htfLiquidity?.pools?.bsl || []), ...(brain?.htfLiquidity?.pools?.ssl || []),
    ...(brain?.liquidity?.draws?.above || []), ...(brain?.liquidity?.draws?.below || []),
  ]) if (liveTarget(pool) && alignedTargetSide(pool, dir)) push(pool.id || pool.name || `pool_${out.length}`, pool.price, "external", pool.name || "liquidity pool", pool.tf);
  return out;
}

function buildTargets({ entry, dir, ranges, targetDOL, brain, frames, config, requiredTarget = null }) {
  const units = symbolUnits(config.symbol || "", config);
  const candidates = externalLevels(frames, ranges, targetDOL, brain, dir, entry);
  if (requiredTarget) candidates.push({ id: requiredTarget.id, price: requiredTarget.price, kind: "external", source: requiredTarget.name, tf: "SESSION" });
  const sId = String(config?.scenario?.id || "").toLowerCase();
  const opposingTf = sId === "swing" ? "H4" : sId === "scalp" ? (frames?.M15?.length ? "M15" : "5M") : "H1";
  const pd = freshPda(frames, opposingTf, -dir);
  for (const zone of pd.fvgs.concat(pd.orderBlocks)) {
    const price = dir === 1 ? Math.min(zone.top, zone.bottom) : Math.max(zone.top, zone.bottom);
    if (side(dir, price, entry)) candidates.push({ id: `internal_${zone.id || candidates.length}`, price, kind: "internal", source: zone.type || "PD array", tf: opposingTf });
  }
  const unique = [];
  for (const candidate of candidates.sort((a, b) => dir === 1 ? a.price - b.price : b.price - a.price)) {
    if (!unique.some(x => Math.abs(x.price - candidate.price) <= (units.point || 0.0001) / 2)) unique.push(candidate);
  }
  // Three structural levels are prioritized: internal opposing zone, external pool, and macro DOL.
  const internal = unique.find(x => x.kind === "internal");
  const external = internal && (requiredTarget ? unique.find(x => x.id === requiredTarget.id && side(dir, x.price, internal.price)) : unique.find(x => x.kind === "external" && side(dir, x.price, internal.price)));
  const dol = external && unique.find(x => x.kind === "DOL" && side(dir, x.price, external.price));
  let selected = [internal, external, dol].filter(Boolean);
  if (selected.length < 3) {
    const forwardLevels = unique.filter(x => side(dir, x.price, entry));
    if (forwardLevels.length >= 3) {
      selected = forwardLevels.slice(0, 3);
    } else if (forwardLevels.length >= 2) {
      const p1 = forwardLevels[0].price;
      const p2 = forwardLevels[1].price;
      const mid = formatPrice((p1 + p2) / 2, units);
      selected = [
        forwardLevels[0],
        { id: "structural_mid", price: mid, kind: "intermediate_milestone", source: "50% between structural targets", tf: forwardLevels[0].tf },
        forwardLevels[1],
      ];
    } else if (forwardLevels.length === 1) {
      const finalPrice = forwardLevels[0].price;
      const step1 = formatPrice(entry + (finalPrice - entry) * 0.5, units);
      const step2 = formatPrice(entry + (finalPrice - entry) * 0.75, units);
      selected = [
        { id: "tp1_milestone", price: step1, kind: "intermediate_milestone", source: "50% CE to Target", tf: forwardLevels[0].tf || "H4" },
        { id: "tp2_milestone", price: step2, kind: "intermediate_milestone", source: "75% to Target", tf: forwardLevels[0].tf || "H4" },
        forwardLevels[0],
      ];
    } else if (targetDOL?.price != null && side(dir, Number(targetDOL.price), entry)) {
      const finalPrice = Number(targetDOL.price);
      const step1 = formatPrice(entry + (finalPrice - entry) * 0.5, units);
      const step2 = formatPrice(entry + (finalPrice - entry) * 0.75, units);
      selected = [
        { id: "tp1_milestone", price: step1, kind: "intermediate_milestone", source: "50% CE to DOL", tf: targetDOL.tf || "H4" },
        { id: "tp2_milestone", price: step2, kind: "intermediate_milestone", source: "75% to DOL", tf: targetDOL.tf || "H4" },
        { id: targetDOL.id || "dol", price: finalPrice, kind: "DOL", source: targetDOL.name || "Draw on Liquidity", tf: targetDOL.tf || "H4" },
      ];
    } else {
      const map = ranges?.ranges || ranges || {};
      for (const rTf of ["H4", "D1", "H1"]) {
        const r = map[rTf];
        const ext = dir === 1 ? r?.high : r?.low;
        if (finite(ext) && side(dir, ext, entry)) {
          const step1 = formatPrice(entry + (ext - entry) * 0.5, units);
          const step2 = formatPrice(entry + (ext - entry) * 0.75, units);
          selected = [
            { id: "tp1_milestone", price: step1, kind: "intermediate_milestone", source: `50% to ${rTf} Extreme`, tf: rTf },
            { id: "tp2_milestone", price: step2, kind: "intermediate_milestone", source: `75% to ${rTf} Extreme`, tf: rTf },
            { id: `range_${rTf}`, price: ext, kind: "external", source: `${rTf} Range Extreme`, tf: rTf },
          ];
          break;
        }
      }
    }
  }
  if (selected.length < 3) return null;
  selected.sort((a, b) => dir === 1 ? a.price - b.price : b.price - a.price);
  const [tp1, tp2, runner] = selected.slice(0, 3);
  if (![tp1, tp2, runner].every(x => side(dir, x.price, entry)) || !side(dir, tp2.price, tp1.price) || !side(dir, runner.price, tp2.price)) return null;
  return [
    { id: "tp1", price: tp1.price, fraction: 0.5, kind: tp1.kind, source: tp1.source, tf: tp1.tf },
    { id: "tp2", price: tp2.price, fraction: 0.3, kind: tp2.kind, source: tp2.source, tf: tp2.tf },
    { id: "runner", price: runner.price, fraction: 0.2, kind: runner.kind, source: runner.source, tf: runner.tf },
  ];
}

function structuralStop({ dir, zoneLow, zoneHigh, extreme, frames, symbol, config, ranges, brain, tf, modelId = "", evidence = {} }) {
  const units = symbolUnits(symbol, config);
  const anchors = [dir === 1 ? zoneLow : zoneHigh, extreme].filter(finite).map(Number);
  const structural = dir === 1 ? Math.min(...anchors) : Math.max(...anchors);
  if (!finite(structural)) return null;
  const catBuffer = units.category === "crypto" ? 50 : units.category === "metal" ? 15 : units.category === "index" ? 10 : 5;
  const buffer = units.pip ? units.pip * catBuffer : (Math.abs(structural) * 0.002);
  return dir === 1 ? structural - buffer : structural + buffer;
}

function makeCandidate({ id, symbol, dir, entry, zoneLow, zoneHigh, extreme, evidence, frames, ranges, targetDOL, brain, config, minRR, tf }) {
  if (![entry, zoneLow, zoneHigh].every(finite) || !(zoneLow <= entry && entry <= zoneHigh)) return null;
  const isMomentum = id === "displacement_breakout" || evidence?.isMomentum;
  const setupBars = barsFor(frames, config?.scenario);
  const currentClose = setupBars?.at(-1)?.close ?? frames?.[tf]?.at(-1)?.close;
  if (!isMomentum && finite(currentClose) && !side(dir, currentClose, entry)) return null;
  const slRes = calculateStructuralStopLoss({
    dir,
    entry,
    modelId: id,
    zoneLow,
    zoneHigh,
    extreme,
    evidence,
    scenario: config?.scenario,
    frames,
    ranges,
    brain,
    symbol,
    config,
    tf,
  });
  const sl = slRes?.sl ?? structuralStop({ dir, zoneLow, zoneHigh, extreme, frames, symbol, config, ranges, brain, tf, modelId: id, evidence });
  if (!finite(sl) || !opposite(dir, sl, entry)) return null;
  const targets = buildTargets({ entry, dir, ranges, targetDOL, brain, frames, config: { ...config, symbol }, requiredTarget: evidence.opposingTarget });
  if (!targets) return null;
  const risk = Math.abs(entry - sl);
  const rawRR = (dir === 1 ? targets[0].price - entry : entry - targets[0].price) / risk;
  if (!(rawRR > 0)) return null;

  const r1 = risk > 0 ? (dir * (targets[0].price - entry)) / risk : 0;
  const r2 = risk > 0 ? (dir * (targets[1].price - entry)) / risk : 0;
  const r3 = risk > 0 ? (dir * (targets[2].price - entry)) / risk : 0;
  const f1 = Number(targets[0].fraction ?? 0.5);
  const f2 = Number(targets[1].fraction ?? 0.3);
  const f3 = Number(targets[2].fraction ?? 0.2);
  const weightedRR = Math.round((f1 * r1 + f2 * r2 + f3 * r3) * 100) / 100;
  const runnerR = risk > 0 ? Math.round(r3 * 100) / 100 : 0;
  const tp1RR = Math.round(r1 * 100) / 100;
  const rr = runnerR;

  const model = ENTRY_MODEL_DEFINITIONS[id.toUpperCase()] || Object.values(ENTRY_MODEL_DEFINITIONS).find(x => x.id === id);
  const range = brain.dealingRange;
  const htfPdArray = ["H4", "D1"].some(frame => {
    const pd = freshPda(frames, frame, dir);
    return [...pd.fvgs, ...pd.orderBlocks, ...(pd.ifvgs || [])].some(z => entry >= z.bottom && entry <= z.top);
  });
  const smt = brain.smtEvidence?.find(x => x.dir === dir && x.confirmed !== false);

  // Dynamic continuous dual-sided scoring (Positive Confluence + Negative Deductions)
  const isDolAligned = liveTarget(targetDOL) && alignedTargetSide(targetDOL, dir) && side(dir, Number(targetDOL?.price), entry);
  const riskDist = Math.abs(entry - sl);
  const dolDist = isDolAligned ? Math.abs(Number(targetDOL.price) - entry) : 0;
  const dolRR = (riskDist > 0 && dolDist > 0) ? (dolDist / riskDist) : 0;
  const dolScore = !isDolAligned ? 0 : (dolRR >= 2.0 ? 25 : (dolRR >= 1.0 ? 20 : 16));

  const inDiscount = confirmedRange(range) && finite(range?.eq) && opposite(dir, entry, range.eq);
  const rangeSpan = confirmedRange(range) && range.high > range.low ? (range.high - range.low) : 0;
  const rangePos = rangeSpan > 0 ? (dir === 1 ? (entry - range.low) / rangeSpan : (range.high - entry) / rangeSpan) : 0.5;
  const pdScore = inDiscount ? (rangePos <= 0.40 ? 20 : 18) : (rangePos <= 0.55 ? 12 : 0);

  const hasDisp = evidence.displacement?.valid || evidence.mss?.displacement?.valid || evidence.impulse?.displacement?.valid;
  const hasMSS = Boolean(evidence.mss || evidence.structureShift);
  const dispScore = hasDisp ? 20 : (hasMSS ? 16 : 14);

  const retrace = brain.retracement?.m15 || brain.retracements?.M15;
  let retraceScore = 10;
  if (retrace) {
    const qGrade = retrace.qualityGrade || retrace.grade;
    if (qGrade === "A+") retraceScore = 15;
    else if (qGrade === "A") retraceScore = 13;
    else if (retrace.stage === "EQUILIBRIUM_DISCOUNT") retraceScore = 11;
    else if (qGrade === "F") retraceScore = 0;
    else retraceScore = 8;
  }

  const slot = getCurrentTimeSlot(new Date(config.now ?? Date.now()), config);
  const kzScore = slot.isKillzone ? 15 : (slot.isDeadZone ? 0 : 10);
  const smtScore = smt ? 10 : 0;
  const pdaScore = htfPdArray ? 10 : 0;

  const positiveBreakdown = {
    dolAlignment: dolScore,
    premiumDiscount: pdScore,
    displacement: dispScore,
    retracementQuality: retraceScore,
    killzone: kzScore,
    smt: smtScore,
    htfPdArray: pdaScore,
  };
  const positiveScore = Object.values(positiveBreakdown).reduce((a, b) => a + b, 0);

  // Negative Friction & Risk Deductions
  const opposingTf = config?.scenario?.id === "swing" ? "D1" : "H4";
  const oppPd = freshPda(frames, opposingTf, -dir);
  const firstTp = targets[0]?.price;
  const opposingWall = oppPd.fvgs.concat(oppPd.orderBlocks).find(z => {
    const top = Math.max(z.top, z.bottom);
    const bottom = Math.min(z.top, z.bottom);
    if (dir === 1) {
      return bottom > entry && bottom <= (firstTp || entry + riskDist * 1.5);
    } else {
      return top < entry && top >= (firstTp || entry - riskDist * 1.5);
    }
  });
  const frictionPenalty = opposingWall ? -10 : 0;

  let velocityPenalty = 0;
  if (retrace?.isFreightTrain || (retrace?.qualityGrade || retrace?.grade) === "F") {
    velocityPenalty = -14;
  } else if (retrace?.velocityRatio != null && Number(retrace.velocityRatio) >= 1.35) {
    velocityPenalty = -6;
  }

  let stalePenalty = 0;
  const formationTime = evidence.formationTime ?? evidence.fvg?.bornTime ?? evidence.raid?.time;
  if (formationTime && setupBars?.length) {
    const ageBars = setupBars.filter(b => (b.time ? b.time : timeOf(b) / 1000) >= formationTime).length;
    if (ageBars >= 10) stalePenalty = -8;
    else if (ageBars >= 6) stalePenalty = -4;
  }

  let runwayPenalty = 0;
  if (isDolAligned && targetDOL?.price) {
    const dolTargetPx = Number(targetDOL.price);
    const rangeApex = dir === 1 ? (range?.low ?? entry) : (range?.high ?? entry);
    const totalDist = Math.abs(dolTargetPx - rangeApex);
    const remainDist = Math.abs(dolTargetPx - entry);
    if (totalDist > 0 && (remainDist / totalDist) < 0.25) {
      runwayPenalty = -10;
    }
  }

  const units = symbolUnits(symbol, config);
  const spreadDist = Number(units?.spread || 0);
  const spreadPenalty = (riskDist > 0 && spreadDist > 0 && (spreadDist / riskDist) >= 0.12) ? -6 : 0;

  const macroDir = brain?.macroDir ?? (brain?.macroBias === "BULLISH" ? 1 : brain?.macroBias === "BEARISH" ? -1 : 0);
  let headwindPenalty = 0;
  if (macroDir !== 0 && macroDir !== dir) {
    headwindPenalty = -15;
  } else if (brain?.action?.includes("STAND_ASIDE") || brain?.verdict?.includes("CHOP")) {
    headwindPenalty = -8;
  }

  let timingPenalty = 0;
  if (slot.isDeadZone) timingPenalty = -15;
  else if (slot.name?.includes("Lull") || slot.name?.includes("Lunch")) timingPenalty = -5;

  const negativeBreakdown = {
    opposingFriction: frictionPenalty,
    velocityDrag: velocityPenalty,
    staleAge: stalePenalty,
    runwayExhaustion: runwayPenalty,
    spreadDrag: spreadPenalty,
    macroHeadwind: headwindPenalty,
    timingLull: timingPenalty,
  };
  const negativeScore = Object.values(negativeBreakdown).reduce((a, b) => a + b, 0);

  const netConfluence = Math.max(10, Math.min(100, Math.round(positiveScore + negativeScore)));
  const confluenceScore = netConfluence;

  const confluenceBreakdown = {
    ...positiveBreakdown,
    ...negativeBreakdown,
    positiveScore,
    negativeScore,
    netScore: netConfluence,
  };
  const rawConfluence = netConfluence;
  const fullEvidence = { ...evidence, formationTime: evidence.formationTime ?? evidence.fvg?.bornTime ?? evidence.raid?.time, smt: smt || null, symbol, dir, entry, sl, slAudit: slRes, structuralStop: true, units: symbolUnits(symbol, config), targets, confluenceBreakdown, positiveScore, negativeScore, positiveBreakdown, negativeBreakdown };
  const candidate = {
    id, modelId: id, name: model?.name || id, modelName: model?.name || id, badge: model?.badge || id,
    modelBadge: model?.badge || id, type: id.toUpperCase(), orderType: isMomentum ? "market" : "limit", tf, entry, price: entry,
    sl, slAudit: slRes, tp: targets[2].price, targets, rr: Math.round(rr * 100) / 100, targetRR: Math.round(runnerR * 100) / 100,
    weightedRR, tp1RR, minRR,
    meetsMinRR: rr >= minRR, confluenceScore, positiveScore, negativeScore, confluenceBreakdown,
    positiveBreakdown, negativeBreakdown,
    confluenceTags: Object.entries(positiveBreakdown).filter(([, v]) => v > 0).map(([k]) => k.toUpperCase()),
    negativeTags: Object.entries(negativeBreakdown).filter(([, v]) => v < 0).map(([k]) => k.toUpperCase()),
    evidence: fullEvidence, rationale: model?.description || id,
    label: `${model?.name || id} ${isMomentum ? "market" : "limit"} @ ${entry}`,
  };
  return hasModelEvidence(candidate, dir) ? candidate : null;
}

function raiding(bars, dir, levels, config) {
  const scenarioId = String(config.scenario?.id || "").toLowerCase();
  const maxReclaimBars = scenarioId === "scalp" ? 2 : (scenarioId === "swing" ? 3 : 4);
  const atr = avgRange(bars);
  const raids = detectLiquidityRaids(bars, { levels, maxReclaimBars, atr }) || [];
  const list = Array.isArray(raids) ? raids : raids ? [raids] : [];
  const units = symbolUnits(config.symbol || "", config);
  if (!units.pip) return [];
  let defaultMin = 3;
  let defaultMax = 25;
  if (units.category === "metal") {
    defaultMin = 5;
    defaultMax = 120;
  } else if (units.category === "index") {
    defaultMin = 5;
    defaultMax = 70;
  } else if (units.category === "crypto") {
    defaultMin = 20;
    defaultMax = 600;
  } else if (units.category === "fx") {
    defaultMin = 2;
    defaultMax = 35;
  }
  const minUnits = Math.max(1, Number(config.turtleMinRaidUnits ?? defaultMin));
  const maxUnits = Number(config.turtleMaxRaidUnits ?? defaultMax);
  return list.filter(r => r.dir === dir && finite(r.levelPrice) && finite(r.extreme) &&
    Math.abs(r.extreme - r.levelPrice) / units.pip >= minUnits && Math.abs(r.extreme - r.levelPrice) / units.pip <= maxUnits);
}

function detectIct({ symbol, dir, bars, frames, ranges, targetDOL, brain, config, minRR, tf }) {
  const raids = detectLiquidityRaids(bars, { maxReclaimBars: 2 }) || [];
  const list = Array.isArray(raids) ? raids : raids ? [raids] : [];
  let pivots = confirmedFractals(bars, 5) || {};
  if (!pivots.highs?.length || !pivots.lows?.length) {
    pivots = confirmedFractals(bars, 3) || {};
  }
  const pd = freshPda(frames, tf, dir);
  for (const raid of list.filter(r => r.dir === dir).sort((a, b) => (b.reclaimIndex ?? b.i) - (a.reclaimIndex ?? a.i))) {
    const reclaim = raid.reclaimIndex ?? raid.i;
    if (bars.length - 1 - reclaim > (config.maxModelAgeBars ?? 14)) continue;
    const pivot = (dir === 1 ? pivots.highs : pivots.lows).filter(p => p.confirmedAt < raid.raidIndex).at(-1);
    if (!pivot) continue;
    for (let i = reclaim + 1; i < Math.min(bars.length - 1, reclaim + 11); i++) {
      // MSS is the first CLOSE through a swing that was confirmed before the raid.
      if (!side(dir, bars[i].close, pivot.price) || side(dir, bars[i - 1].close, pivot.price)) continue;
      const disp = displacementAt(bars, i, dir);
      if (!disp?.valid) continue;
      const fvg = pd.fvgs.find(z => Math.abs(bornAt(z) - (i + 1)) <= 1 && ceUntouched(z, bars));
      if (!fvg) continue;
      const entry = Number(fvg.ce ?? fvg.cePrice ?? (fvg.top + fvg.bottom) / 2);
      if (!side(dir, bars.at(-1).close, entry) || bars.slice(reclaim + 1).some(b => dir === 1 ? b.low < raid.extreme : b.high > raid.extreme)) continue;
      const candidate = makeCandidate({ id: "ict_2022", symbol, dir, entry, zoneLow: Math.min(fvg.top, fvg.bottom), zoneHigh: Math.max(fvg.top, fvg.bottom), extreme: raid.extreme, frames, ranges, targetDOL, brain, config, minRR, tf,
        evidence: { sequence: ["liquidity_sweep", "displaced_mss", "associated_eligible_fvg", "ce_limit"], raid, mss: { index: i, time: bars[i].time, brokenPivot: pivot, dir, displacement: disp }, fvg, formationTime: fvg.bornTime } });
      if (candidate) return candidate;
    }
  }
  return null;
}

function detectTurtle({ symbol, dir, bars, frames, ranges, targetDOL, brain, config, minRR, tf }) {
  const units = symbolUnits(symbol, config);
  const normalizedKeyLevels = Object.values(brain.htfLiquidity?.keyLevels || {}).map(l => {
    if (!l) return null;
    let s = l.side;
    if (s === "BSL" || l.type === "SWING_HIGH" || l.kind === "HIGH") s = 1;
    if (s === "SSL" || l.type === "SWING_LOW" || l.kind === "LOW") s = -1;
    return { ...l, side: s };
  }).filter(l => l && [1, -1].includes(l.side) && finite(l.price));

  const rawPools = brain.htfLiquidity?.pools;
  const poolList = Array.isArray(rawPools)
    ? rawPools
    : [...(rawPools?.bsl || []), ...(rawPools?.ssl || [])];
  const eqHighs = Array.isArray(brain.htfLiquidity?.equalHighs)
    ? brain.htfLiquidity.equalHighs
    : (Array.isArray(brain.htfLiquidity?.eqh) ? brain.htfLiquidity.eqh : []);
  const eqLows = Array.isArray(brain.htfLiquidity?.equalLows)
    ? brain.htfLiquidity.equalLows
    : (Array.isArray(brain.htfLiquidity?.eql) ? brain.htfLiquidity.eql : []);

  const pools = [
    ...poolList,
    ...eqHighs.map(p => ({ ...p, side: 1, price: p.price ?? p.level })),
    ...eqLows.map(p => ({ ...p, side: -1, price: p.price ?? p.level })),
  ].map(p => ({
    ...p,
    id: p.id || `POOL:${p.side}:${p.price}`,
    confirmationTime: p.confirmationTime ?? (bars[0]?.time || 0),
    side: p.side ?? (p.type === "EQH" || p.kind === "BSL" ? 1 : -1),
  })).filter(p => [1, -1].includes(p.side) && finite(p.price));

  const htfSwings = [
    ...majorLevels(frames, config.now ?? Date.now()),
    ...normalizedKeyLevels,
    ...pools,
    ...(Array.isArray(brain.htfLiquidity?.dailySwings) ? brain.htfLiquidity.dailySwings : []),
  ].filter(l => l && finite(l.price) && [1, -1].includes(l.side));

  const levels = htfSwings.length > 0 ? htfSwings : null;

  for (const raid of raiding(bars, dir, levels, { ...config, symbol }).sort((a, b) => (b.reclaimIndex ?? b.i) - (a.reclaimIndex ?? a.i))) {
    const reclaim = raid.reclaimIndex ?? raid.i;
    const age = bars.length - 1 - reclaim;
    if (age > (config.maxTurtleAgeBars ?? 10)) continue;
    const bar = bars[raid.raidIndex], reclaimBar = bars[reclaim];
    const candleRange = bar.high - bar.low;
    const wick = dir === 1 ? Math.min(bar.open, bar.close) - bar.low : bar.high - Math.max(bar.open, bar.close);
    const rejection = candleRange > 0 && wick >= Math.max(Math.abs(bar.close - bar.open) * 0.4, candleRange * 0.35) && side(dir, reclaimBar.close, raid.levelPrice);
    const scenarioId = String(config.scenario?.id || "").toLowerCase();
    const maxReclaimBars = scenarioId === "scalp" ? 2 : (scenarioId === "swing" ? 3 : 4);
    if (!rejection || reclaim - raid.raidIndex > maxReclaimBars || !side(dir, bars.at(-1).close, raid.levelPrice)) continue;
    if (bars.slice(reclaim + 1).some(b => dir === 1 ? b.close < raid.extreme : b.close > raid.extreme)) continue;
    const buffer = units.pip ? units.pip * 4 : 0;
    if (bars.slice(reclaim + 1).some(b => dir === 1 ? b.close < raid.levelPrice - buffer : b.close > raid.levelPrice + buffer)) continue;
    const entry = raid.levelPrice;
    const candidate = makeCandidate({ id: "turtle_soup", symbol, dir, entry, zoneLow: entry, zoneHigh: entry, extreme: raid.extreme, frames, ranges, targetDOL, brain, config, minRR, tf,
      evidence: { sequence: ["major_external_raid", "wick_rejection", maxReclaimBars === 2 ? "reclaim_within_2_bars" : `reclaim_within_${maxReclaimBars}_bars`, "reclaimed_level_limit"], majorLevel: levels?.find?.(l => l.id === raid.levelId) || raid, raid, rejectionBar: { index: raid.raidIndex, bar }, reclaimBar: { index: reclaim, bar: reclaimBar }, formationTime: reclaimBar.time } });
    if (candidate) return candidate;
  }
  return null;
}

function detectBreaker({ symbol, dir, bars, frames, ranges, targetDOL, brain, config, minRR, tf }) {
  const pd = detectPDArrays(bars, { tf });
  const raids = detectLiquidityRaids(bars, { maxReclaimBars: 2 }) || [];
  const listRaids = Array.isArray(raids) ? raids : raids ? [raids] : [];
  let pivots = confirmedFractals(bars, 5) || {};
  if (!pivots.highs?.length || !pivots.lows?.length) {
    pivots = confirmedFractals(bars, 3) || {};
  }
  for (const ob of (pd.orderBlocks || []).filter(z => z.originalDir === -dir && z.state === "INVALIDATED").reverse()) {
    const top = Math.max(ob.top, ob.bottom), bottom = Math.min(ob.top, ob.bottom);
    const failedAt = ob.invalidatedAt;
    if (!(failedAt > ob.born) || bars.length - 1 - failedAt > (config.maxModelAgeBars ?? 14)) continue;
    const disp = displacementAt(bars, failedAt, dir);
    if (!disp?.valid) continue;
    const raid = listRaids.find(r => r.dir === dir && r.raidIndex > ob.born && r.reclaimIndex < failedAt);
    const pivot = (dir === 1 ? pivots.highs : pivots.lows).filter(p => p.confirmedAt < (raid?.raidIndex ?? failedAt)).at(-1);
    if (!raid || !pivot || !side(dir, bars[failedAt].close, pivot.price) || side(dir, bars[failedAt - 1].close, pivot.price)) continue;
    // OB entry is its BODY mean threshold, never the midpoint of wick extrema.
    const entry = Number(ob.mt);
    if (!finite(entry)) continue;
    if (bars.slice(failedAt + 1).some(b => dir === 1 ? b.close < bottom : b.close > top)) continue;
    if (!side(dir, bars.at(-1).close, entry)) continue;
    const retest = bars.findIndex((b, i) => i > failedAt && b.low <= top && b.high >= bottom);
    const candidate = makeCandidate({ id: "breaker_block", symbol, dir, entry, zoneLow: bottom, zoneHigh: top, extreme: dir === 1 ? bottom : top, frames, ranges, targetDOL, brain, config, minRR, tf,
      evidence: { sequence: ["opposing_order_block", "liquidity_raid", "displaced_ob_and_structure_failure", "breaker_retest", "body_mt_limit"], failedOrderBlock: ob, raid, failedAt, brokenPivot: pivot, displacement: disp, retestIndex: retest >= 0 ? retest : failedAt, formationTime: bars[failedAt].time } });
    if (candidate) return candidate;
  }

  // Pure Price Action Breaker Sequence (Oct 5 Architecture)
  const highs = pivots.highs || [], lows = pivots.lows || [];
  if (highs.length >= 2 && lows.length >= 2) {
    let breakerCandle = null;
    let failedAt = -1;
    let interveningPivot = null;
    let raidRef = null;
    let dispRef = null;
    if (dir === 1) {
      for (let li = lows.length - 1; li >= 1; li--) {
        const lastLow = lows[li];
        const prevLow = lows[li - 1];
        if (!(lastLow.price < prevLow.price)) continue;
        const interveningHigh = highs.find(h => h.i > prevLow.i && h.i < lastLow.i);
        if (!interveningHigh) continue;
        const breakIdx = bars.findIndex((b, idx) => idx > lastLow.i && b.close > interveningHigh.price);
        if (breakIdx > 0 && bars.length - 1 - breakIdx <= (config.maxModelAgeBars ?? 14)) {
          const disp = displacementAt(bars, breakIdx, dir);
          if (disp?.valid) {
            // Bullish Breaker: last UP-CLOSE candle (bearish OB) before the low that swept liquidity
            for (let i = interveningHigh.i; i >= Math.max(0, interveningHigh.i - 5); i--) {
              if (bars[i].close > bars[i].open) { breakerCandle = bars[i]; break; }
            }
            if (breakerCandle) {
              failedAt = breakIdx;
              interveningPivot = interveningHigh;
              raidRef = { raidIndex: lastLow.i, extreme: lastLow.price, levelPrice: prevLow.price, dir: 1 };
              dispRef = disp;
              break;
            }
          }
        }
      }
    } else {
      for (let hi = highs.length - 1; hi >= 1; hi--) {
        const lastHigh = highs[hi];
        const prevHigh = highs[hi - 1];
        if (!(lastHigh.price > prevHigh.price)) continue;
        const interveningLow = lows.find(l => l.i > prevHigh.i && l.i < lastHigh.i);
        if (!interveningLow) continue;
        const breakIdx = bars.findIndex((b, idx) => idx > lastHigh.i && b.close < interveningLow.price);
        if (breakIdx > 0 && bars.length - 1 - breakIdx <= (config.maxModelAgeBars ?? 14)) {
          const disp = displacementAt(bars, breakIdx, dir);
          if (disp?.valid) {
            // Bearish Breaker: last DOWN-CLOSE candle (bullish OB) before the high that swept liquidity
            for (let i = interveningLow.i; i >= Math.max(0, interveningLow.i - 5); i--) {
              if (bars[i].close < bars[i].open) { breakerCandle = bars[i]; break; }
            }
            if (breakerCandle) {
              failedAt = breakIdx;
              interveningPivot = interveningLow;
              raidRef = { raidIndex: lastHigh.i, extreme: lastHigh.price, levelPrice: prevHigh.price, dir: -1 };
              dispRef = disp;
              break;
            }
          }
        }
      }
    }

    if (breakerCandle && failedAt > 0) {
      const top = Math.max(breakerCandle.high, breakerCandle.low);
      const bottom = Math.min(breakerCandle.high, breakerCandle.low);
      const entry = Number((breakerCandle.open + breakerCandle.close) / 2);
      if (finite(entry) && side(dir, bars.at(-1).close, entry) && !bars.slice(failedAt + 1).some(b => dir === 1 ? b.close < bottom : b.close > top)) {
        const retest = bars.findIndex((b, i) => i > failedAt && b.low <= top && b.high >= bottom);
        const candidate = makeCandidate({ id: "breaker_block", symbol, dir, entry, zoneLow: bottom, zoneHigh: top, extreme: dir === 1 ? bottom : top, frames, ranges, targetDOL, brain, config, minRR, tf,
          evidence: { sequence: ["price_action_sweep", "displaced_structure_failure", "breaker_retest", "breaker_midline_limit"], failedOrderBlock: null, raid: raidRef, failedAt, brokenPivot: interveningPivot, displacement: dispRef, retestIndex: retest >= 0 ? retest : failedAt, formationTime: bars[failedAt].time } });
        if (candidate) return candidate;
      }
    }
  }
  return null;
}

function detectOte({ symbol, dir, bars, frames, ranges, targetDOL, brain, config, minRR, tf }) {
  let fractals = confirmedFractals(bars, 5) || {};
  let highs = fractals.highs || [], lows = fractals.lows || [];
  if (!highs.length || !lows.length) {
    const p3 = confirmedFractals(bars, 3) || {};
    highs = p3.highs || [];
    lows = p3.lows || [];
  }
  const high = highs.at(-1), low = lows.filter(x => x.i < (high?.i ?? bars.length)).at(-1);
  const impulseHigh = dir === 1 ? high : highs.filter(x => x.i < (lows.at(-1)?.i ?? 0)).at(-1);
  const impulseLow = dir === 1 ? low : lows.at(-1);
  if (!impulseHigh || !impulseLow || !(impulseHigh.price > impulseLow.price)) return null;
  const span = impulseHigh.price - impulseLow.price;
  const fib50 = dir === 1 ? impulseHigh.price - span * .50 : impulseLow.price + span * .50;
  const fib62 = dir === 1 ? impulseHigh.price - span * .618 : impulseLow.price + span * .618;
  const fib786 = dir === 1 ? impulseHigh.price - span * .786 : impulseLow.price + span * .786;
  const fib705 = dir === 1 ? impulseHigh.price - span * .705 : impulseLow.price + span * .705;

  const pd = freshPda(frames, tf, dir);
  const start = dir === 1 ? impulseLow.i : impulseHigh.i;
  const end = dir === 1 ? impulseHigh.i : impulseLow.i;
  if (!(start < end) || bars.length - 1 - end > (config.maxModelAgeBars ?? 14)) return null;

  const pdCenter = z => z.kind === "OB" ? z.mt : z.ce;
  
  // 50% Equilibrium Bounce Detection:
  // In strong trending institutional regimes, if an unmitigated virgin FVG or Order Block
  // overlaps the 0.50 - 0.618 zone, allow OTE to trigger from 0.50 Equilibrium!
  const eqLow = Math.min(fib50, fib62);
  const eqHigh = Math.max(fib50, fib62);
  const eqPda = pd.fvgs.concat(pd.orderBlocks).find(z => bornAt(z) >= start && bornAt(z) <= end + 1 &&
    String(z.state || "").toUpperCase() === "VIRGIN" && finite(pdCenter(z)) &&
    Math.max(z.bottom, eqLow) <= Math.min(z.top, eqHigh));

  const zoneLow = eqPda ? Math.min(fib50, fib786) : Math.min(fib62, fib786);
  const zoneHigh = eqPda ? Math.max(fib50, fib786) : Math.max(fib62, fib786);

  const macroDir = brain?.macroDir ?? (brain?.macroBias === "BULLISH" ? 1 : brain?.macroBias === "BEARISH" ? -1 : (brain?.bias === "BULLISH" ? 1 : brain?.bias === "BEARISH" ? -1 : 0));
  if (macroDir !== 0 && macroDir !== dir) return null;
  const flow = String(brain.fvgOrderFlow || "");
  const opposingFlow = dir === 1 ? /\bBEARISH_DOMINANT\b/i.test(flow) : /\bBULLISH_DOMINANT\b/i.test(flow);
  if (opposingFlow) return null;

  let hasImpulseDisplacement = false;
  let displacedBreak = null;
  const precedingPivot = (dir === 1 ? highs : lows).filter(p => p.confirmedAt < start).at(-1);
  for (let i = start + 1; i <= end; i++) {
    const displacement = displacementAt(bars, i, dir, { minBodyRatio: 0.55, minAtrRatio: 1.0 });
    if (displacement?.valid) {
      hasImpulseDisplacement = true;
      if (precedingPivot && side(dir, bars[i].close, precedingPivot.price) && !side(dir, bars[i - 1].close, precedingPivot.price)) {
        displacedBreak = { index: i, displacement, brokenPivot: precedingPivot };
        break;
      }
    }
  }

  // Institutional Rule: An impulse must be confirmed by displacement AND break prior structure (MSS/BOS)
  if (!hasImpulseDisplacement || !displacedBreak || !displacedBreak.brokenPivot) return null;

  if (bars.slice(end + 1).some(b => dir === 1 ? b.close < impulseLow.price : b.close > impulseHigh.price)) return null;

  const embedded = pd.fvgs.concat(pd.orderBlocks).find(z => bornAt(z) >= start && bornAt(z) <= end + 1 &&
    String(z.state || "").toUpperCase() === "VIRGIN" && finite(pdCenter(z)) &&
    pdCenter(z) >= Math.min(zoneLow, impulseLow.price + span * 0.5) && pdCenter(z) <= Math.max(zoneHigh, impulseHigh.price - span * 0.5));

  // Institutional Rule: Pure mathematical Fibonacci lines in empty space are strictly forbidden!
  // An entry limit MUST be anchored to a confirmed virgin institutional PD array in the OTE pocket.
  const chosenPda = embedded || eqPda;
  if (!chosenPda) return null;

  const entry = pdCenter(chosenPda);
  if (!finite(entry)) return null;

  const boundedZoneLow = Math.min(zoneLow, entry, chosenPda.bottom ?? entry);
  const boundedZoneHigh = Math.max(zoneHigh, entry, chosenPda.top ?? entry);

  if (!side(dir, bars.at(-1).close, dir === 1 ? impulseLow.price : impulseHigh.price)) return null;
  if (!side(dir, bars.at(-1).close, entry)) return null;

  return makeCandidate({ id: "ote_continuation", symbol, dir, entry, zoneLow: boundedZoneLow, zoneHigh: boundedZoneHigh, extreme: dir === 1 ? impulseLow.price : impulseHigh.price, frames, ranges, targetDOL, brain, config, minRR, tf,
    evidence: { sequence: ["aligned_displaced_impulse", eqPda ? "ote_50_equilibrium_bounce" : "ote_618_786", embedded ? "embedded_valid_pd_array" : "equilibrium_virgin_pd_array", "macro_flow_aligned", "pd_array_limit"], impulse: { high: impulseHigh, low: impulseLow, ...displacedBreak }, fib50, fib62, fib786, fib705, eqPda: eqPda || null, embedded: embedded || null, chosenPda, formationTime: bars[end].time } });
}


function detectSilverBullet({ symbol, dir, bars, frames, ranges, targetDOL, brain, config, minRR, tf }) {
  const window = getSilverBulletWindow(new Date(config.now ?? Date.now()));
  if (!window) return null;
  const units = symbolUnits(symbol, config);
  const pd = freshPda(frames, tf, dir);
  for (const fvg of [...pd.fvgs].reverse()) {
    const index = bornAt(fvg);
    const formation = bars[index];
    const displacementBar = bars[index - 1];
    const displacement = displacementAt(bars, index - 1, dir);
    const inWindow = formation && displacementBar && [formation, displacementBar].every(b => {
      const minute = getEetTime(new Date(timeOf(b))).totalMinutes;
      return minute >= window.startMinute && minute < window.endMinute &&
        getStartOfTradingDay(new Date(timeOf(b))) === getStartOfTradingDay(new Date(config.now ?? Date.now()));
    });
    let defMinUnits = 6;
    if (units.category === "metal") defMinUnits = 20;
    else if (units.category === "index") defMinUnits = 15;
    else if (units.category === "crypto") defMinUnits = 50;
    else if (units.category === "fx") defMinUnits = 6;
    const minimumUnits = Math.max(4, Math.min(200, Number(config.silverBulletMinUnits ?? defMinUnits)));
    if (!Number.isFinite(minimumUnits)) continue;
    if (!inWindow || !displacement?.valid || !units.pip || !ceUntouched(fvg, bars) || Math.abs(displacementBar.close - displacementBar.open) < minimumUnits * units.pip) continue;
    
    const candidateTargets = [
      ...majorLevels(frames, config.now ?? Date.now()),
      ...(targetDOL?.price ? [{ id: "DOL", name: "Target DOL", price: Number(targetDOL.price), side: dir, confirmationTime: targetDOL.confirmationTime ?? targetDOL.time ?? (bars[0]?.time ? bars[0].time - 1 : 0) }] : []),
    ].filter(l => l && l.side === dir && side(dir, l.price, fvg.ce) && unconsumedLevel(l, bars))
     .sort((a, b) => dir * (a.price - b.price));

    const target = candidateTargets[0];
    if (!target) continue;
    const entry = Number(fvg.ce ?? (fvg.top + fvg.bottom) / 2);
    if (!side(dir, bars.at(-1).close, entry)) continue;
    const candidate = makeCandidate({ id: "silver_bullet", symbol, dir, entry, zoneLow: Math.min(fvg.top, fvg.bottom), zoneHigh: Math.max(fvg.top, fvg.bottom), extreme: dir === 1 ? fvg.bottom : fvg.top, frames, ranges, targetDOL, brain, config, minRR, tf,
      evidence: { sequence: ["strict_sb_window", "in_window_formation", "symbol_unit_displacement", "opposing_unconsumed_session_target", "ce_limit"], window, formationIndex: index, formation, displacement, displacementIndex: index - 1, minimumUnits, fvg, opposingTarget: target, formationTime: formation.time } });
    if (candidate) return candidate;
  }
  return null;
}

function detectDisplacementBreakout({ symbol, dir, bars, frames, ranges, targetDOL, brain, config, minRR, tf }) {
  if (!bars?.length || bars.length < 5) return null;
  const macroDir = brain?.macroDir ?? (brain?.macroBias === "BULLISH" ? 1 : brain?.macroBias === "BEARISH" ? -1 : 0);
  if (macroDir !== 0 && macroDir !== dir) return null;

  let pivots = confirmedFractals(bars, 5) || {};
  if (!pivots.highs?.length || !pivots.lows?.length) {
    pivots = confirmedFractals(bars, 3) || {};
  }

  const rangeObj = ranges?.ranges?.[tf] || ranges?.ranges?.H1 || ranges?.ranges?.M15 || ranges;
  const levels = [
    ...(dir === 1 ? (pivots.highs || []) : (pivots.lows || [])),
    ...(rangeObj?.high && dir === 1 ? [{ price: rangeObj.high, confirmedAt: 0, type: "RANGE_HIGH" }] : []),
    ...(rangeObj?.low && dir === -1 ? [{ price: rangeObj.low, confirmedAt: 0, type: "RANGE_LOW" }] : []),
  ];

  if (!levels.length) return null;

  const units = symbolUnits(symbol, config);
  const buffer = units.pip ? units.pip * 2 : 0;
  const maxAge = Math.min(4, config.maxBreakoutAgeBars ?? 3);

  for (let i = bars.length - 1; i >= Math.max(1, bars.length - 1 - maxAge); i--) {
    const bar = bars[i];
    const prevBar = bars[i - 1];

    const brokenLevel = levels.find(l => {
      if (!l || !finite(l.price)) return false;
      if (l.confirmedAt != null && l.confirmedAt >= i) return false;
      if (dir === 1) {
        return prevBar.close <= l.price && bar.close > l.price;
      } else {
        return prevBar.close >= l.price && bar.close < l.price;
      }
    });

    if (!brokenLevel) continue;

    const priorBars = bars.slice(Math.max(0, brokenLevel.i ?? (i - 10)), i - 1);
    const alreadyBroken = priorBars.some(b => dir === 1 ? b.close > brokenLevel.price : b.close < brokenLevel.price);
    if (alreadyBroken) continue;

    const disp = displacementAt(bars, i, dir, { minBodyRatio: 0.50, minAtrRatio: 1.0 });
    if (!disp?.valid) continue;

    const range = bar.high - bar.low;
    if (range > 0) {
      if (dir === 1 && (bar.high - bar.close) / range > 0.40) continue;
      if (dir === -1 && (bar.close - bar.low) / range > 0.40) continue;
    }

    const subsequent = bars.slice(i + 1);
    const failed = subsequent.some(b => dir === 1 ? b.close < brokenLevel.price - buffer : b.close > brokenLevel.price + buffer);
    if (failed) continue;

    const currentBar = bars.at(-1);
    const entry = currentBar.close;
    if (!finite(entry)) continue;

    if (targetDOL?.price != null && finite(targetDOL.price)) {
      const dolDist = dir === 1 ? (targetDOL.price - brokenLevel.price) : (brokenLevel.price - targetDOL.price);
      const consumed = dir === 1 ? (entry - brokenLevel.price) : (brokenLevel.price - entry);
      if (dolDist > 0 && (consumed / dolDist) >= 0.80) continue;
    }

    const extreme = dir === 1 ? bar.low : bar.high;
    const zoneLow = dir === 1 ? Math.min(brokenLevel.price, bar.low, entry) : entry;
    const zoneHigh = dir === 1 ? entry : Math.max(brokenLevel.price, bar.high, entry);

    const candidate = makeCandidate({
      id: "displacement_breakout",
      symbol,
      dir,
      entry,
      zoneLow,
      zoneHigh,
      extreme,
      frames,
      ranges,
      targetDOL,
      brain,
      config,
      minRR,
      tf,
      evidence: {
        sequence: ["structural_level_break", "displacement_expansion", "institutional_momentum_close", "direct_momentum_entry"],
        isMomentum: true,
        breakoutBar: { index: i, ...bar },
        brokenLevel,
        displacement: disp,
        origin: extreme,
        formationTime: bar.time,
      },
    });

    if (candidate) return candidate;
  }

  return null;
}

function detectJudasSwing({ symbol, dir, bars, frames, ranges, targetDOL, brain, config, minRR, tf }) {
  if (!bars?.length) return null;
  const now = config.now ?? config.mockTime ?? (bars.at(-1)?.time ? bars.at(-1).time * 1000 : Date.now());
  const nowSec = Math.floor(now / 1000);
  const eet = getEetTime(new Date(now));
  const totalMinutes = eet.totalMinutes;

  // Active during London Open Judas window (07:00 to 09:30 UTC = 09:00 to 11:30 EET = minutes 510 to 720)
  if (totalMinutes < 510 || totalMinutes > 720) return null;

  const levels = majorLevels(frames, now);
  const opposingSide = -dir;
  const sweepLevels = levels.filter(l => l.side === opposingSide && (l.session === "ASIA" || l.name?.includes("ASIA") || l.name === "PDL" || l.name === "PDH"));
  if (!sweepLevels.length) return null;

  const raids = detectLiquidityRaids(bars, { levels: sweepLevels, maxReclaimBars: 3 }) || [];
  const listRaids = Array.isArray(raids) ? raids : raids ? [raids] : [];
  const relevantRaids = listRaids.filter(r => r.dir === dir);
  if (!relevantRaids.length) return null;

  const pd = freshPda(frames, tf, dir);

  for (const raid of relevantRaids.sort((a, b) => (b.reclaimIndex ?? b.i) - (a.reclaimIndex ?? a.i))) {
    const raidIdx = raid.raidIndex ?? raid.i;
    const reclaimIdx = raid.reclaimIndex ?? raidIdx;
    if (bars.length - 1 - reclaimIdx > (config.maxJudasAgeBars ?? 10)) continue;

    const disp = displacementAt(bars, reclaimIdx, dir) || displacementAt(bars, Math.min(bars.length - 1, reclaimIdx + 1), dir);
    if (!disp?.valid) continue;

    const fvg = pd.fvgs.find(z => Math.abs(bornAt(z) - reclaimIdx) <= 2 && ceUntouched(z, bars));
    const entry = fvg ? Number(fvg.ce ?? (fvg.top + fvg.bottom) / 2) : raid.levelPrice;
    if (!finite(entry) || !side(dir, bars.at(-1).close, entry)) continue;

    const extreme = raid.extreme;
    const zoneLow = fvg ? Math.min(fvg.bottom, fvg.top) : entry;
    const zoneHigh = fvg ? Math.max(fvg.bottom, fvg.top) : entry;

    const candidate = makeCandidate({
      id: "judas_swing",
      symbol,
      dir,
      entry,
      zoneLow,
      zoneHigh,
      extreme,
      frames,
      ranges,
      targetDOL,
      brain,
      config,
      minRR,
      tf,
      evidence: {
        sequence: ["asian_session_liquidity_sweep", "frankfurt_london_judas_wick", "displaced_mss_reversal", "judas_re-entry_limit"],
        judasLevel: raid.levelPrice,
        raid,
        displacement: disp,
        fvg: fvg || null,
        extreme,
        formationTime: bars[reclaimIdx]?.time || nowSec,
      },
    });

    if (candidate) return candidate;
  }

  return null;
}

function detectSmtSweep({ symbol, dir, bars, frames, ranges, targetDOL, brain, config, minRR, tf }) {
  if (!bars?.length) return null;
  const smtList = brain.smtEvidence || [];
  const smt = smtList.find(x => x.dir === dir && x.confirmed !== false);
  if (!smt) return null;

  const raids = detectLiquidityRaids(bars, { maxReclaimBars: 3 }) || [];
  const listRaids = Array.isArray(raids) ? raids : raids ? [raids] : [];
  const maxAge = config.maxModelAgeBars ?? 14;
  const relevantRaid = listRaids.filter(r => r.dir === dir && (bars.length - 1 - (r.reclaimIndex ?? r.raidIndex)) <= maxAge).sort((a, b) => (b.reclaimIndex ?? b.i) - (a.reclaimIndex ?? a.i))[0];

  let pivots = confirmedFractals(bars, 3) || {};
  const recentSwing = dir === 1
    ? pivots.lows?.filter(l => bars.length - 1 - l.i <= maxAge).at(-1)
    : pivots.highs?.filter(h => bars.length - 1 - h.i <= maxAge).at(-1);

  if (!relevantRaid && !recentSwing) return null;

  const extreme = relevantRaid ? relevantRaid.extreme : recentSwing.price;
  const swingIdx = relevantRaid ? (relevantRaid.reclaimIndex ?? relevantRaid.raidIndex) : recentSwing.i;

  if (bars.slice(swingIdx + 1).some(b => dir === 1 ? b.low < extreme : b.high > extreme)) return null;

  let disp = null;
  let dispIndex = -1;
  for (let i = swingIdx; i < bars.length; i++) {
    const d = displacementAt(bars, i, dir);
    if (d?.valid) { disp = d; dispIndex = i; break; }
  }
  if (!disp?.valid) return null;

  const pd = freshPda(frames, tf, dir);
  const fvg = pd.fvgs.filter(z => bornAt(z) >= swingIdx - 1 && ceUntouched(z, bars)).at(-1);
  const entry = fvg ? Number(fvg.ce ?? (fvg.top + fvg.bottom) / 2) : (relevantRaid ? relevantRaid.levelPrice : (dir === 1 ? Math.min(bars[swingIdx].open, bars[swingIdx].close) : Math.max(bars[swingIdx].open, bars[swingIdx].close)));
  if (!finite(entry) || !side(dir, bars.at(-1).close, entry)) return null;

  const zoneLow = fvg ? Math.min(fvg.bottom, fvg.top) : (dir === 1 ? Math.min(entry, extreme) : entry);
  const zoneHigh = fvg ? Math.max(fvg.bottom, fvg.top) : (dir === 1 ? entry : Math.max(entry, extreme));

  const candidate = makeCandidate({
    id: "smt_divergence_sweep",
    symbol,
    dir,
    entry,
    zoneLow,
    zoneHigh,
    extreme,
    frames,
    ranges,
    targetDOL,
    brain,
    config,
    minRR,
    tf,
    evidence: {
      sequence: ["intermarket_liquidity_sweep", "smt_partner_divergence_confirmed", "displacement_absorption_reversal", "divergence_discount_limit"],
      smtEvidence: smt,
      extreme,
      displacement: disp,
      fvg: fvg || null,
      hasSmtDivergence: true,
      formationTime: bars[dispIndex]?.time || bars[swingIdx]?.time || bars.at(-1).time,
    },
  });

  return candidate;
}

function detectFvgRejection({ symbol, dir, bars, frames, ranges, targetDOL, brain, config, minRR, tf }) {
  if (!bars?.length) return null;
  if (!liveTarget(targetDOL) || !alignedTargetSide(targetDOL, dir)) return null;
  const macroDir = brain.macroDir ?? (brain.macroBias === "BULLISH" ? 1 : brain.macroBias === "BEARISH" ? -1 : 0);
  if (macroDir !== dir) return null;

  const pd = freshPda(frames, tf, dir);
  const eligibleFvgs = pd.fvgs.filter(z => ceUntouched(z, bars) && bars.length - 1 - bornAt(z) <= (config.maxFvgAgeBars ?? 8));
  // If no natural virgin FVG exists, allow pristine virgin/unreclaimed iFVGs in the trade direction
  const availableFvgs = eligibleFvgs.length > 0
    ? eligibleFvgs
    : (pd.ifvgs || []).filter(z => ceUntouched(z, bars) && bars.length - 1 - bornAt(z) <= (config.maxFvgAgeBars ?? 8));
  if (!availableFvgs.length) return null;

  for (const fvg of availableFvgs.reverse()) {
    const born = bornAt(fvg);
    if (born < 1) continue;

    const disp = displacementAt(bars, born - 1, dir) || displacementAt(bars, born, dir);
    if (!disp?.valid) continue;

    const ce = Number(fvg.ce ?? (fvg.top + fvg.bottom) / 2);
    if (!finite(ce)) continue;

    const entry = ce;
    const currentPrice = bars.at(-1).close;
    if (!side(dir, currentPrice, entry)) continue;

    const blownThrough = bars.slice(born + 1).some(b => dir === 1 ? b.close < fvg.bottom : b.close > fvg.top);
    if (blownThrough) continue;

    const origin = dir === 1 ? bars[born - 1].low : bars[born - 1].high;
    const extreme = origin;
    const zoneLow = Math.min(fvg.bottom, fvg.top);
    const zoneHigh = Math.max(fvg.bottom, fvg.top);

    const candidate = makeCandidate({
      id: "fvg_rejection",
      symbol,
      dir,
      entry,
      zoneLow,
      zoneHigh,
      extreme,
      frames,
      ranges,
      targetDOL,
      brain,
      config,
      minRR,
      tf,
      evidence: {
        sequence: ["runaway_trend_impulse", "virgin_fvg_created", "50pct_consequent_encroachment_tap", "trend_continuation_limit"],
        fvg,
        displacement: disp,
        ce,
        origin,
        formationTime: fvg.bornTime || bars[born]?.time,
      },
    });

    if (candidate) return candidate;
  }

  return null;
}

function detectPo3Cycle({ symbol, dir, bars, frames, ranges, targetDOL, brain, config, minRR, tf }) {
  if (!bars?.length) return null;
  const d1 = getFrameBars(frames, "D1");
  const todayBar = d1.at(-1);
  const now = config.now ?? config.mockTime ?? (bars.at(-1)?.time ? bars.at(-1).time * 1000 : Date.now());
  const todayStartMs = getStartOfTradingDay(new Date(now));
  const todayStartSec = Math.floor(todayStartMs / 1000);

  const m15 = getFrameBars(frames, "M15");
  // Strictly filter M15 bars belonging to TODAY's trading day (>= todayStartSec)
  const todayM15 = m15.filter(b => b.time >= todayStartSec);
  if (todayM15.length < 4) return null; // Early Asian accumulation, PO3 cycle not yet staged

  // Time gating: PO3 manipulation/expansion typically develops during London / NY AM
  const eet = getEetTime(new Date(now));
  if (eet.totalMinutes > 1200) return null; // After 20:00 EET, PO3 expansion is complete

  const dailyOpen = todayM15[0]?.open;
  if (!finite(dailyOpen)) return null;

  const macroDir = brain.macroDir ?? (brain.macroBias === "BULLISH" ? 1 : brain.macroBias === "BEARISH" ? -1 : 0);
  if (macroDir !== dir) return null;

  const units = symbolUnits(symbol, config);
  const minManip = units.pip ? units.pip * 5 : 5;
  const benchmarkRange = (todayBar && todayBar.high > todayBar.low) ? (todayBar.high - todayBar.low) : (units.pip ? units.pip * 50 : 50);
  const dynManip = benchmarkRange * 0.08;
  const manipDist = Math.max(minManip, dynManip);

  const hasManipulated = dir === 1
    ? todayM15.some(b => b.low < dailyOpen - manipDist)
    : todayM15.some(b => b.high > dailyOpen + manipDist);

  if (!hasManipulated) return null;

  const manipulationExtreme = dir === 1
    ? Math.min(...todayM15.map(b => b.low))
    : Math.max(...todayM15.map(b => b.high));

  const lastBar = todayM15.at(-1);
  const isReclaimed = dir === 1 ? lastBar.close >= dailyOpen : lastBar.close <= dailyOpen;
  if (!isReclaimed) return null;

  const reclaimIdx = todayM15.length - 1;
  const disp = displacementAt(todayM15, reclaimIdx, dir) || displacementAt(todayM15, Math.max(0, reclaimIdx - 1), dir);
  if (!disp?.valid) return null;

  const entry = dailyOpen;
  const extreme = manipulationExtreme;
  const zoneLow = dir === 1 ? Math.min(entry, extreme) : entry;
  const zoneHigh = dir === 1 ? entry : Math.max(entry, extreme);

  const candidate = makeCandidate({
    id: "po3_daily_cycle",
    symbol,
    dir,
    entry,
    zoneLow,
    zoneHigh,
    extreme,
    frames,
    ranges,
    targetDOL,
    brain,
    config,
    minRR,
    tf,
    evidence: {
      sequence: ["daily_open_anchor", "intraday_manipulation_leg", "daily_open_displacement_reclaim", "distribution_expansion_limit"],
      dailyOpen,
      manipulationExtreme,
      displacement: disp,
      formationTime: lastBar.time,
    },
  });

  return candidate;
}

export function evaluateAllEntryModels({ symbol, dir, scenario, frames = {}, ranges, targetDOL, config = {}, brain = {} }) {
  if (![1, -1].includes(dir)) return null;
  const now = config.now ?? config.mockTime ?? Date.now();
  config = { ...config, now, scenario, symbolMeta: config.symbolMeta || frames.symbolMeta };
  frames = Object.fromEntries(Object.entries(frames).map(([key, value]) => [key, FRAME_SPEC[key] ? normalizeClosedBars(value, key, { now, timestampSemantics: "UTC_INSTANT" }) : value]));
  const aliasedFrames = { ...frames };
  const pairs = [["M5", "5M"], ["M15", "15M"], ["M30", "30M"], ["H1", "1H"], ["H4", "4H"], ["D1", "1D"]];
  for (const [k1, k2] of pairs) {
    if (aliasedFrames[k1] && !aliasedFrames[k2]) aliasedFrames[k2] = aliasedFrames[k1];
    else if (aliasedFrames[k2] && !aliasedFrames[k1]) aliasedFrames[k1] = aliasedFrames[k2];
  }
  frames = aliasedFrames;
  const bars = barsFor(frames, scenario);
  const sId = String(scenario?.id || "").toLowerCase();
  let tf;
  if (sId === "scalp") {
    tf = getFrameBars(frames, "M5").length ? "M5" : (getFrameBars(frames, "M15").length ? "M15" : "M30");
  } else if (sId === "swing") {
    tf = getFrameBars(frames, "H4").length ? "H4" : (getFrameBars(frames, "D1").length ? "D1" : "H1");
  } else {
    tf = getFrameBars(frames, "M15").length ? "M15" : (getFrameBars(frames, "H1").length ? "H1" : "M5");
  }
  if (!bars?.length) return null;
  const minRR = config.minRR ?? scenario?.minRR ?? 1.8;
  const enabled = config.enabledModels || {};
  const fns = [
    ["ict_2022", detectIct], ["turtle_soup", detectTurtle], ["breaker_block", detectBreaker],
    ["ote_continuation", detectOte], ["silver_bullet", detectSilverBullet],
    ["displacement_breakout", detectDisplacementBreakout],
    ["judas_swing", detectJudasSwing], ["smt_divergence_sweep", detectSmtSweep],
    ["fvg_rejection", detectFvgRejection], ["po3_daily_cycle", detectPo3Cycle],
  ];
  const candidates = [];
  if (config.candidate) candidates.push(config.candidate);
  for (const [id, fn] of fns) if (enabled[id] !== false) {
    const modelThresholds = config.modelThresholds?.[id] || {};
    const effectiveMinRR = modelThresholds.minRR ?? minRR;
    const candidate = fn({ symbol, dir, bars, frames, ranges, targetDOL, brain, config: { ...config, symbol }, minRR: effectiveMinRR, tf });
    if (candidate) candidates.push(candidate);
  }
  if (!candidates.length) return null;
  const activeSlot = getCurrentTimeSlot(new Date(now), config);
  for (const candidate of candidates) {
    const gate = evaluateExecutionVetoes({ symbol, dir, entry: candidate.entry, sl: candidate.sl, brain, frames, config, now: config.now, candidate });
    candidate.vetoes = gate.vetoes;
    candidate.permitted = gate.permitted;
    candidate.timeSlotAffinity = Number(activeSlot?.modelAffinities?.[candidate.id] || 0);
  }

  // Dedicated Entry Model Decision Engine:
  // Evaluates structural zone perfection, Dealing Range depth (Extreme vs Deep vs Shallow),
  // HTF Anchor confluence, Impending Extreme / Shallow Trap warnings, and resolves premier candidate.
  const decisionResult = evaluateEntryModelDecisionEngine({
    candidates,
    symbol,
    dir,
    scenario,
    frames,
    ranges,
    targetDOL,
    brain,
    config,
    now,
  });

  if (!decisionResult) return null;
  return {
    ...decisionResult,
    modelId: decisionResult.id,
    modelName: decisionResult.name,
    modelBadge: decisionResult.badge,
    timeSlot: activeSlot,
  };
}

function veto(code, reason) { return { code, reason }; }

// Check the detector's model-specific causal artifacts, not its badge, sequence
// labels, or confluence score. Detection itself remains responsible for bar scans.
export function hasModelEvidence(candidate, dir) {
  if (!candidate) return false;
  if (candidate.isExistingTrade || candidate.isBlended || String(candidate.modelId || "").includes("+")) return true;
  const modelId = candidate.modelId || candidate.id || candidate.type?.toLowerCase();
  if (!modelId) return false;
  if (!finite(candidate.entry) || !finite(candidate.sl) || candidate.entry <= 0 || candidate.sl <= 0) return false;
  if (!opposite(dir, candidate.sl, candidate.entry)) return false;

  const e = candidate.evidence;
  if (!e) return false;
  if (finite(e.formationTime) && e.formationTime <= 0) return false;

  // Strict Causal Artifact Verification per Model:
  if (modelId === "ote_continuation") {
    if (!e.impulse || !e.impulse.brokenPivot) return false;
    if (!e.embedded && !e.eqPda) return false;
  } else if (modelId === "ict_2022") {
    if (!e.raid || !e.mss || !e.fvg) return false;
  } else if (modelId === "turtle_soup") {
    if (!e.raid || !finite(e.raid.levelPrice)) return false;
  } else if (modelId === "breaker_block") {
    if (!e.failedAt && !e.brokenPivot) return false;
  } else if (modelId === "displacement_breakout") {
    if (!e.brokenLevel || !e.displacement?.valid) return false;
  } else if (modelId === "judas_swing") {
    if (!e.judasLevel || !e.displacement?.valid || !finite(e.extreme)) return false;
  } else if (modelId === "smt_divergence_sweep") {
    if (!e.smtEvidence || !e.displacement?.valid || !finite(e.extreme)) return false;
  } else if (modelId === "fvg_rejection") {
    if (!e.fvg || !e.displacement?.valid || !finite(e.ce)) return false;
  } else if (modelId === "po3_daily_cycle") {
    if (!finite(e.dailyOpen) || !e.displacement?.valid || !finite(e.manipulationExtreme)) return false;
  }
  return true;
}

export function evaluateExecutionVetoes({ symbol, dir, entry, sl, brain = {}, frames = {}, config = {}, now = new Date(), candidate = null }) {
  candidate ||= config.candidate || config.tradeIdea || null;
  const nowMs = new Date(now).getTime();
  const vetoes = [];
  if (symbol && (config.blacklist || []).some((s) => canonOf(s) === canonOf(symbol))) {
    vetoes.push(veto("BLACKLISTED", `Trade symbol ${symbol} is blacklisted in configuration.`));
  }
  if (!candidate || !hasModelEvidence(candidate, dir)) vetoes.push(veto("NO_STRICT_MODEL", "A complete causal entry model with model-specific evidence is required."));
  if (candidate?.diagnosticOnly || candidate?.legacyDiagnostic || candidate?.evidence?.diagnosticOnly || candidate?.evidence?.legacyDiagnostic) vetoes.push(veto("DIAGNOSTIC_ONLY", "Diagnostic setups are not eligible for execution."));
  if (candidate && config.enabledModels?.[candidate.modelId] === false) vetoes.push(veto("MODEL_DISABLED", "This entry model is disabled."));
  const scenarioId = String(config.scenario?.id || candidate?.scenario?.id || candidate?.horizon || "").toLowerCase();
  if (scenarioId === "scalp" || scenarioId === "swing") {
    vetoes.push(veto("HORIZON_DISABLED", "Only Day Trade horizon (4H-15M) is active in TradeSpace."));
  }
  const isDayDisabled = config.enabledHorizons && config.enabledHorizons.day === false;
  if ((scenarioId === "day" || scenarioId === "day_trade") && isDayDisabled) {
    vetoes.push(veto("HORIZON_DISABLED", "Day Trade horizon (4H-15M) is disabled in settings."));
  }
  if (candidate?.evidence && finite(candidate.evidence.formationTime) && timeOf({ time: candidate.evidence.formationTime }) > nowMs + 60_000) vetoes.push(veto("NON_CAUSAL_MODEL", "Entry model formation is in the future."));
  if (![1, -1].includes(dir) || !finite(entry) || !finite(sl) || entry <= 0 || sl <= 0 || !opposite(dir, sl, entry)) vetoes.push(veto("INVALID_GEOMETRY", "Direction, entry, and structural stop are not valid."));
  const isExistingTrade = Boolean(
    config.isExistingTrade ||
    config.skipLimitGeometryCheck ||
    candidate?.isExistingTrade ||
    candidate?.filledAt != null ||
    ["FILLED", "ACTIVE", "PARTIALLY_FILLED"].includes(String(candidate?.status || "").toUpperCase())
  );
  const isMomentum = candidate?.modelId === "displacement_breakout" || candidate?.id === "displacement_breakout" || candidate?.evidence?.isMomentum;
  if (!isExistingTrade) {
    const curPx = Number(candidate?.currentPrice ?? frames.M5?.at(-1)?.close ?? frames.M15?.at(-1)?.close ?? frames.H1?.at(-1)?.close);
    if (finite(curPx) && curPx > 0) {
      if (!isMomentum) {
        if (dir === 1 && entry > curPx) {
          vetoes.push(veto("INVERTED_LIMIT_ENTRY", `Buy limit entry (${entry}) is above market price (${curPx}); TradeSpace only stages structural retracement limits, not breakout stops.`));
        } else if (dir === -1 && entry < curPx) {
          vetoes.push(veto("INVERTED_LIMIT_ENTRY", `Sell limit entry (${entry}) is below market price (${curPx}); TradeSpace only stages structural retracement limits, not breakout stops.`));
        }
      }

      // 1. Target Runway Consumption Guard:
      // If price has already consumed >= 65% (80% for momentum breakouts) of the distance to the target, the move has already
      // largely played out without filling the entry. Reject upfront to prevent chasing exhausted delivery.
      const candidateTargets = Array.isArray(candidate?.targets) ? candidate.targets : null;
      const targetPrice = Number(candidateTargets?.at(-1)?.price ?? candidate?.tp ?? brain?.targetDOL?.price);
      if (finite(targetPrice) && targetPrice > 0) {
        const totalTargetDist = dir === 1 ? (targetPrice - entry) : (entry - targetPrice);
        if (totalTargetDist > 0) {
          const moveInDir = dir === 1 ? (curPx - entry) : (entry - curPx);
          if (moveInDir > 0) {
            const consumedRatio = moveInDir / totalTargetDist;
            const maxConsumedRatio = (isMomentum ? Math.min(85, (config.maxRunwayConsumedPct ?? 65) + 15) : (config.maxRunwayConsumedPct ?? 65)) / 100;
            if (consumedRatio >= maxConsumedRatio) {
              const pct = Math.round(consumedRatio * 100);
              vetoes.push(veto("TARGET_RUNWAY_EXHAUSTED", `Target distance already ${pct}% consumed before entry fill; awaiting retracement closer to limit entry.`));
            }
          }
        }
      }

      // 2. Maximum Entry Distance Proximity Guard:
      // Prevent staging orders that sit excessively far from current market price.
      const riskDist = Math.abs(entry - sl);
      const distFromEntry = Math.abs(curPx - entry);
      const maxDistanceR = config.maxEntryDistanceR ?? 2.5;
      if (riskDist > 0 && distFromEntry > 0) {
        const distInR = distFromEntry / riskDist;
        if (distInR >= maxDistanceR) {
          vetoes.push(veto("ENTRY_TOO_DISTANT", `Entry level (${entry}) is currently ${distInR.toFixed(1)}R away from market price (${curPx}); awaiting closer structural retracement.`));
        }
      }
    }
  }
  const clock = isTradingPermittedNow(now, config, symbol);
  if (!clock.permitted) vetoes.push(veto(clock.isDeadZone ? "DEAD_ZONE" : "TIMING", clock.reason));
  const dol = brain.targetDOL;
  if (dol && (!finite(dol?.price) || dol.price <= 0 || !liveTarget(dol) || !side(dir, Number(dol.price), entry) || !alignedTargetSide(dol, dir))) vetoes.push(veto("DOL_MISALIGNED", "Causal, unconsumed Draw on Liquidity is missing or its target side disagrees with the limit."));
  const macroDir = brain.macroDir ?? (brain.macroBias === "BULLISH" ? 1 : brain.macroBias === "BEARISH" ? -1 : 0);
  if (!macroDir || macroDir !== dir) vetoes.push(veto("HTF_MACRO", "D1/H4 macro direction is neutral, undefined, or opposes the trade direction."));
  const range = scenarioId === "swing"
    ? (brain.ranges?.D1 || brain.dealingRange || brain.ranges?.H4)
    : scenarioId === "scalp"
      ? (brain.ranges?.M30 || brain.ranges?.["30M"] || brain.ranges?.M15 || brain.dealingRange)
      : (brain.dealingRange || brain.ranges?.H4 || brain.ranges?.D1);
  if (range && (!finite(range?.high) || !finite(range?.low) || range.high <= range.low)) {
    vetoes.push(veto("MISSING_DEALING_RANGE", "A causally confirmed HTF dealing range is required; fallback extremes are not executable."));
  } else if (range) {
    if (dir === 1 ? range.coveragePct >= 92 : range.coveragePct <= 8) {
      vetoes.push(veto("EXHAUSTED_RANGE_CEILING", `Market price has consumed ${range.coveragePct}% of the HTF dealing range; longing near ceiling is high-risk.`));
    }
    if (finite(range.eq) && finite(range.high) && finite(range.low)) {
      const buffer = (range.high - range.low) * 0.15;
      if (dir === 1 && entry > range.eq + buffer) {
        vetoes.push(veto("PREMIUM_DISCOUNT", `Buy limit entry (${entry}) is deep in premium of the HTF dealing range (EQ: ${range.eq}).`));
      } else if (dir === -1 && entry < range.eq - buffer) {
        vetoes.push(veto("PREMIUM_DISCOUNT", `Sell limit entry (${entry}) is deep in discount of the HTF dealing range (EQ: ${range.eq}).`));
      }
    }
  }
  const scenarioKey = scenarioId.toUpperCase();
  const gatekeeper = brain.horizons?.[scenarioKey]?.gatekeeper || brain.dayTraderContext?.ltfGatekeeper;
  if (gatekeeper?.vetoActive) {
    if (gatekeeper.triggerStatus === "BLOCKED") {
      vetoes.push(veto("LTF_GATEKEEPER", gatekeeper.vetoReason || "Lower-timeframe gatekeeper has blocked delivery."));
    } else if (gatekeeper.triggerStatus === "WAIT_PULLBACK" && isMomentum) {
      vetoes.push(veto("LTF_GATEKEEPER", gatekeeper.vetoReason || "Lower-timeframe gatekeeper has not approved displaced delivery."));
    }
  }

  const isBrainWaitingPullback = brain.action === "WAIT_FOR_15M_PULLBACK" || brain.action === "WAIT_FOR_15M_TRIGGER";
  const isOpposingMacro = (dir === 1 && (brain.macroCompass === "BEARISH" || brain.macroDir === -1)) ||
                          (dir === -1 && (brain.macroCompass === "BULLISH" || brain.macroDir === 1));

  if (brain.action === "STAND_ASIDE" || isOpposingMacro) {
    vetoes.push(veto("BRAIN_NOT_PERMITTED", `Authoritative institutional brain has not approved ${dir === 1 ? "LONG" : "SHORT"} (action: ${brain.action || "BLOCKED"}, verdict: ${brain.verdict || "UNKNOWN"}).`));
  } else if (isBrainWaitingPullback) {
    if (isMomentum) {
      vetoes.push(veto("BRAIN_NOT_PERMITTED", `Breakout momentum entry requires confirmed 15M trigger; market is currently waiting for 15M pullback.`));
    }
  } else if (dir === 1 ? brain.allowedToLong !== true : brain.allowedToShort !== true) {
    vetoes.push(veto("BRAIN_NOT_PERMITTED", `Authoritative institutional brain has not approved ${dir === 1 ? "LONG" : "SHORT"} (action: ${brain.action || "BLOCKED"}, verdict: ${brain.verdict || "UNKNOWN"}).`));
  }
  if (brain.verdict && (brain.verdict.includes("CHOP") || brain.verdict.includes("EXHAUSTED"))) {
    vetoes.push(veto("MARKET_BRAIN_REGIME", `Market brain diagnosed non-executable regime: ${brain.verdict}`));
  }
  for (const reason of brain.vetoes || []) if (!vetoes.some(x => x.code === reason.code)) vetoes.push(reason);
  const risk = Math.abs(entry - sl);
  const targets = Array.isArray(candidate?.targets) ? candidate.targets : null;
  const targetPrice = targets?.at(-1)?.price || candidate?.tp;
  const fullReward = targetPrice ? dir * (targetPrice - entry) : 0;
  const fullRR = fullReward > 0 && risk > 0 ? Math.round((fullReward / risk) * 100) / 100 : (Number(candidate?.targetRR || candidate?.rr) || 0);
  const isPropFirm = config.managementLogic === "prop_firm_safe" ||
    config.isPropFirm === true ||
    candidate?.managementLogic === "prop_firm_safe" ||
    candidate?.isPropFirm === true ||
    config.legId === "prop_firm" ||
    candidate?.legId === "prop_firm";
  const candidateModelId = candidate?.modelId || candidate?.id;
  const modelThresholds = config.modelThresholds?.[candidateModelId] || {};
  const minRR = isPropFirm
    ? (config.propFirmMinRR ?? 1.5)
    : (modelThresholds.minRR ?? config.minRR ?? config.scenario?.minRR ?? 1.5);
  if (risk > 0 && fullRR > 0 && fullRR < minRR - 0.05) vetoes.push(veto("MIN_RR", `Target structural reward is below minimum R:R (${minRR}).`));
  if (candidate) {
    if (targets?.length && !targets.every(t => t && finite(t.price) && t.price > 0 && alignedTargetSide(t, dir))) vetoes.push(veto("INVALID_TARGETS", "Three positive, directional, ordered structural targets (50/30/20) are required."));
    if (candidate.modelId === "silver_bullet" && !getSilverBulletWindow(now)) vetoes.push(veto("SILVER_BULLET_WINDOW", "Silver Bullet entry is outside London 10–11 / NY 17–18 EET."));
  }
  const snapshot = frames.snapshot;
  const requiredTfs = config.scenario?.requiredTfs || ["D1", "H4", "H1", "M15", candidate?.tf || "M5"];
  if (snapshot && (!snapshot.closedOnly || snapshot.semantics !== "UTC_INSTANT" || snapshot.stale === true)) vetoes.push(veto("STALE_DATA", "Closed UTC snapshot is missing; setup remains diagnostic only."));
  for (const tf of [...new Set(requiredTfs)]) {
    const bars = frames[tf];
    if (!bars?.length) continue;
    const meta = snapshot?.timeframes?.[tf], spec = FRAME_SPEC[tf];
    if (spec && bars.some(b => ![b.open, b.high, b.low, b.close, b.time].every(finite) || b.low <= 0 || b.high < Math.max(b.open, b.close) || b.low > Math.min(b.open, b.close) || b.high < b.low)) {
      vetoes.push(veto("INVALID_FRAME", `${tf} contains invalid OHLC data.`));
      continue;
    }
    const lastClose = bars.at(-1).closeTime != null ? bars.at(-1).closeTime * 1000 : timeOf(bars.at(-1)) + (spec?.seconds || 300) * 1000;
    const maxAllowedAge = Math.max((spec?.seconds || 300) * 4 * 1000, 1800_000);
    if (nowMs - lastClose > maxAllowedAge) {
      if (!vetoes.some(v => v.code === "STALE_DATA")) vetoes.push(veto("STALE_DATA", `${tf} execution snapshot is stale or its freshness cannot be verified.`));
    }
  }
  if (config.requireSmtConfirm && !brain.smtEvidence?.some(x => x.dir === dir && x.confirmed !== false)) vetoes.push(veto("SMT_REQUIRED", "Configured directional SMT confirmation is absent."));
  const threshold = Number(config.confluenceThreshold ?? 60);
  const score = candidate?.confluenceScore ?? 0;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) vetoes.push(veto("INVALID_THRESHOLD", "Confluence threshold must be a finite 0–100 value."));
  if (candidate && !Number.isFinite(score)) vetoes.push(veto("INVALID_CONFLUENCE", "Confluence evidence score is not finite."));
  if ((config.enforceConfluenceThreshold || (config.confluenceThreshold != null && config.confluenceThreshold > 0)) && score < threshold) {
    vetoes.push(veto("LOW_CONFLUENCE", `Confluence score (${score}) is below required threshold (${threshold}).`));
  }
  const slAudit = auditStopLossIntegrity({
    dir,
    entry,
    sl,
    symbol,
    currentPrice: candidate?.currentPrice,
    scenario: config.scenario,
    config: { ...config, candidate },
    candidate,
    spreadPrice: config.spreadPrice,
  });
  if (!slAudit.pass) {
    for (const sv of slAudit.vetoes) {
      if (!vetoes.some(x => x.code === sv.code)) vetoes.push(veto(sv.code, sv.reason));
    }
  }
  return { permitted: vetoes.length === 0, vetoes };
}

export { BREAKDOWN_WEIGHTS, evaluateEntryModelDecisionEngine };

