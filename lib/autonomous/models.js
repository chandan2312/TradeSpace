// Strict causal entry models. A model is eligible only after its complete
// chronological sequence exists in closed bars; there is deliberately no
// auction/ATR fallback. T1 owns the institutional primitives used here.
import { confirmedFractals, displacementAt, detectPDArrays, detectLiquidityRaids } from "../bias/institutional.js";
import { getSilverBulletWindow, getEetTime, getCurrentTimeSlot, getStartOfTradingDay, isTradingPermittedNow } from "./timeslots.js";
import { canonOf } from "./symbols.js";
import { FRAME_SPEC, normalizeClosedBars } from "../bias/data.js";
import { evaluateEntryModelDecisionEngine } from "./entryDecisionEngine.js";

export const ENTRY_MODEL_DEFINITIONS = {
  ICT_2022: { id: "ict_2022", name: "ICT 2022 Mentorship Model", badge: "2022 Mentorship", description: "Sweep → displaced MSS → associated eligible virgin FVG → CE limit." },
  TURTLE_SOUP: { id: "turtle_soup", name: "Turtle Soup Liquidity Raid", badge: "Turtle Soup", description: "Major external raid of 3–15 symbol units → rejection → reclaim within two bars." },
  BREAKER_BLOCK: { id: "breaker_block", name: "Breaker Block & Mitigation Retest", badge: "Breaker Block", description: "Failed opposing OB → raid/displaced structure failure → retest of the breaker." },
  OTE_CONTINUATION: { id: "ote_continuation", name: "OTE Trend Expansion", badge: "OTE Sweetspot", description: "Aligned impulse → .618–.786 retracement with an embedded valid FVG/OB." },
  SILVER_BULLET: { id: "silver_bullet", name: "ICT Silver Bullet Window", badge: "Silver Bullet", description: "London 10–11 or NY 17–18 EET only; in-window displacement and opposing unconsumed session target." },
};

const BREAKDOWN_WEIGHTS = { dolAlignment: 25, premiumDiscount: 20, displacement: 20, killzone: 15, smt: 10, htfPdArray: 10 };
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
  return { category, pip: pip > 0 ? pip : null, point: point > 0 ? point : null, spread: Math.max(0, spread), unitLabel: category === "fx" ? "pip" : "price point", source: meta.point || meta.pipSize ? "broker_metadata" : "canonical_analysis_only", name: meta.name || symbol, digits: meta.digits };
}

function barsFor(frames, scenario) {
  const triggerTf = scenario?.triggerTf || "M15";
  const mappedTf = (triggerTf === "1H" || triggerTf === "H1") ? "H1" : (triggerTf === "15M" || triggerTf === "M15") ? "M15" : (triggerTf === "1M" || triggerTf === "M1") ? "M1" : (triggerTf === "5M" || triggerTf === "M5") ? "M5" : triggerTf;
  return frames?.[mappedTf] || frames?.[triggerTf] || frames?.M15 || frames?.M5 || frames?.H1 || [];
}

function freshPda(frames, tf, dir) {
  const bars = frames?.[tf];
  if (!bars?.length) return { fvgs: [], orderBlocks: [] };
  const pd = detectPDArrays(bars, { tf });
  const eligible = z => z && z.dir === dir && z.eligible !== false && ["VIRGIN", "PARTIALLY_MITIGATED"].includes(String(z.state || "").toUpperCase()) && finite(z.top) && finite(z.bottom);
  return {
    fvgs: (pd?.fvgs || pd?.fvg || []).filter(eligible),
    orderBlocks: (pd?.orderBlocks || pd?.obs || []).filter(eligible),
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
  const d1 = frames.D1 || [];
  const previous = d1.filter(b => (b.closeTime ? b.closeTime * 1000 : timeOf(b) + 86400000) <= today).at(-1);
  if (previous) {
    const confirmationTime = previous.closeTime ?? previous.time + 86400;
    levels.push({ id: `PDH:${previous.time}`, name: "PDH", price: previous.high, side: 1, confirmationTime, major: true },
      { id: `PDL:${previous.time}`, name: "PDL", price: previous.low, side: -1, confirmationTime, major: true });
  }
  const m15 = frames.M15 || [];
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
    if (confirmedRange(r) && finite(price) && frames[tf]?.length && anchor?.confirmationTime != null &&
        unconsumedLevel({ price, side: dir, confirmationTime: anchor.confirmationTime }, frames[tf])) {
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
  const candidates = externalLevels(frames, ranges, targetDOL, brain, dir, entry);
  if (requiredTarget) candidates.push({ id: requiredTarget.id, price: requiredTarget.price, kind: "external", source: requiredTarget.name, tf: "SESSION" });
  const pd = freshPda(frames, "H4", -dir);
  for (const zone of pd.fvgs.concat(pd.orderBlocks)) {
    const price = dir === 1 ? Math.min(zone.top, zone.bottom) : Math.max(zone.top, zone.bottom);
    if (side(dir, price, entry)) candidates.push({ id: `internal_${zone.id || candidates.length}`, price, kind: "internal", source: zone.type || "PD array", tf: "H4" });
  }
  const unique = [];
  for (const candidate of candidates.sort((a, b) => dir === 1 ? a.price - b.price : b.price - a.price)) {
    if (!unique.some(x => Math.abs(x.price - candidate.price) <= symbolUnits(config.symbol || "", config).point / 2)) unique.push(candidate);
  }
  // Three structural levels are required. A model with only one target is not
  // a trade idea; inventing ATR multiples here would conceal missing structure.
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
      const mid = Number(((p1 + p2) / 2).toFixed(5));
      selected = [
        forwardLevels[0],
        { id: "structural_mid", price: mid, kind: "internal", source: "50% between structural targets", tf: forwardLevels[0].tf },
        forwardLevels[1],
      ];
    } else if (forwardLevels.length === 1 && targetDOL?.price != null && side(dir, Number(targetDOL.price), entry)) {
      const finalPrice = Number(targetDOL.price);
      const step1 = Number((entry + (finalPrice - entry) * 0.5).toFixed(5));
      const step2 = Number((entry + (finalPrice - entry) * 0.75).toFixed(5));
      selected = [
        { id: "tp1_milestone", price: step1, kind: "internal", source: "50% to DOL", tf: targetDOL.tf || "H4" },
        { id: "tp2_milestone", price: step2, kind: "external", source: "75% to DOL", tf: targetDOL.tf || "H4" },
        forwardLevels[0],
      ];
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

function structuralStop({ dir, zoneLow, zoneHigh, extreme, frames, symbol, config }) {
  const units = symbolUnits(symbol, config);
  const anchors = [dir === 1 ? zoneLow : zoneHigh, extreme].filter(finite).map(Number);
  const structural = dir === 1 ? Math.min(...anchors) : Math.max(...anchors);
  if (!finite(structural) || !units.point || !units.pip) return null;
  const buffer = units.spread + Math.max(units.point, units.pip * Number(config.stopBufferUnits ?? 1));
  return dir === 1 ? structural - buffer : structural + buffer;
}

function makeCandidate({ id, symbol, dir, entry, zoneLow, zoneHigh, extreme, evidence, frames, ranges, targetDOL, brain, config, minRR, tf }) {
  if (![entry, zoneLow, zoneHigh].every(finite) || !(zoneLow <= entry && entry <= zoneHigh)) return null;
  const sl = structuralStop({ dir, zoneLow, zoneHigh, extreme, frames, symbol, config });
  if (!finite(sl) || !opposite(dir, sl, entry)) return null;
  const targets = buildTargets({ entry, dir, ranges, targetDOL, brain, frames, config: { ...config, symbol }, requiredTarget: evidence.opposingTarget });
  if (!targets) return null;
  const risk = Math.abs(entry - sl);
  const rawRR = (dir === 1 ? targets[0].price - entry : entry - targets[0].price) / risk;
  if (!(rawRR > 0)) return null;
  // Enforce Max 5.0 RR clamp on targets (Swing trading is exempt from 5.0R restriction)
  const isSwing = config.scenario?.id === "swing" || config.scenario?.horizonCode === 1 || config.horizonMode === "swing";
  if (!isSwing) {
    const maxR = 5.0;
    const r2 = dir * (targets[2].price - entry) / risk;
    if (r2 > maxR) {
      targets[2].price = Number((entry + dir * (maxR * risk)).toFixed(5));
      const r1 = dir * (targets[1].price - entry) / risk;
      const target1R = Math.min(r1, maxR * 0.75);
      targets[1].price = Number((entry + dir * (target1R * risk)).toFixed(5));
      const r0 = dir * (targets[0].price - entry) / risk;
      const target0R = Math.min(r0, target1R * 0.7);
      targets[0].price = Number((entry + dir * (target0R * risk)).toFixed(5));
    } else {
      for (let i = 0; i < targets.length; i++) {
        const targetR = dir * (targets[i].price - entry) / risk;
        if (targetR > 5.0) {
          targets[i].price = Number((entry + dir * (5.0 * risk)).toFixed(5));
        }
      }
    }
  }
  const runnerR = isSwing ? Math.round((dir * (targets[2].price - entry) / risk) * 100) / 100 : Math.min(5.0, dir * (targets[2].price - entry) / risk);
  const rr = isSwing ? Math.round(rawRR * 100) / 100 : Math.min(5.0, rawRR);
  const model = ENTRY_MODEL_DEFINITIONS[id.toUpperCase()] || Object.values(ENTRY_MODEL_DEFINITIONS).find(x => x.id === id);
  const range = brain.dealingRange;
  const htfPdArray = ["H4", "D1"].some(frame => {
    const pd = freshPda(frames, frame, dir);
    return [...pd.fvgs, ...pd.orderBlocks].some(z => entry >= z.bottom && entry <= z.top);
  });
  const smt = brain.smtEvidence?.find(x => x.dir === dir && x.confirmed !== false);
  const confluenceBreakdown = {
    dolAlignment: liveTarget(targetDOL) && alignedTargetSide(targetDOL, dir) && side(dir, Number(targetDOL?.price), entry) ? 25 : 0,
    premiumDiscount: confirmedRange(range) && finite(range?.eq) && opposite(dir, entry, range.eq) ? 20 : 0,
    displacement: evidence.displacement?.valid || evidence.mss?.displacement?.valid || evidence.impulse?.displacement?.valid ? 20 : 0,
    killzone: getCurrentTimeSlot(new Date(config.now ?? Date.now())).isKillzone ? 15 : 0,
    smt: smt ? 10 : 0,
    htfPdArray: htfPdArray ? 10 : 0,
  };
  const confluenceScore = Object.values(confluenceBreakdown).reduce((a, b) => a + b, 0);
  const fullEvidence = { ...evidence, formationTime: evidence.formationTime ?? evidence.fvg?.bornTime ?? evidence.raid?.time, smt: smt || null, symbol, dir, entry, sl, structuralStop: true, units: symbolUnits(symbol, config), targets, confluenceBreakdown };
  const candidate = {
    id, modelId: id, name: model?.name || id, modelName: model?.name || id, badge: model?.badge || id,
    modelBadge: model?.badge || id, type: id.toUpperCase(), orderType: "limit", tf, entry, price: entry,
    sl, tp: targets[2].price, targets, rr: Math.round(rr * 100) / 100, targetRR: Math.round(runnerR * 100) / 100, minRR,
    meetsMinRR: rr >= minRR, confluenceScore, confluenceBreakdown,
    confluenceTags: Object.entries(confluenceBreakdown).filter(([, v]) => v > 0).map(([k]) => k.toUpperCase()),
    evidence: fullEvidence, rationale: model?.description || id,
    label: `${model?.name || id} limit @ ${entry}`,
  };
  return hasModelEvidence(candidate, dir) ? candidate : null;
}

function raiding(bars, dir, levels, config) {
  const raids = detectLiquidityRaids(bars, { levels, maxReclaimBars: 2 }) || [];
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
  const pivots = confirmedFractals(bars, 5);
  const pd = freshPda(frames, tf, dir);
  for (const raid of list.filter(r => r.dir === dir).sort((a, b) => (b.reclaimIndex ?? b.i) - (a.reclaimIndex ?? a.i))) {
    const reclaim = raid.reclaimIndex ?? raid.i;
    if (bars.length - 1 - reclaim > (config.maxModelAgeBars ?? 12)) continue;
    const pivot = (dir === 1 ? pivots.highs : pivots.lows).filter(p => p.confirmedAt < raid.raidIndex).at(-1);
    if (!pivot) continue;
    for (let i = reclaim + 1; i < Math.min(bars.length - 1, reclaim + 11); i++) {
      // MSS is the first CLOSE through a swing that was confirmed before the raid.
      if (!side(dir, bars[i].close, pivot.price) || side(dir, bars[i - 1].close, pivot.price)) continue;
      const disp = displacementAt(bars, i, dir);
      if (!disp?.valid) continue;
      const fvg = pd.fvgs.find(z => bornAt(z) === i + 1 && ceUntouched(z, bars));
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
    if (age > (config.maxTurtleAgeBars ?? 6)) continue;
    const bar = bars[raid.raidIndex], reclaimBar = bars[reclaim];
    const wick = dir === 1 ? Math.min(bar.open, bar.close) - bar.low : bar.high - Math.max(bar.open, bar.close);
    const rejection = wick >= Math.abs(bar.close - bar.open) * 0.4 && wick > 0 && side(dir, reclaimBar.close, raid.levelPrice);
    if (!rejection || reclaim - raid.raidIndex > 2 || !side(dir, bars.at(-1).close, raid.levelPrice)) continue;
    if (bars.slice(reclaim + 1).some(b => dir === 1 ? b.close < raid.extreme : b.close > raid.extreme)) continue;
    const buffer = units.pip ? units.pip * 2 : 0;
    if (bars.slice(reclaim + 1).some(b => dir === 1 ? b.close < raid.levelPrice - buffer : b.close > raid.levelPrice + buffer)) continue;
    const entry = raid.levelPrice;
    const candidate = makeCandidate({ id: "turtle_soup", symbol, dir, entry, zoneLow: entry, zoneHigh: entry, extreme: raid.extreme, frames, ranges, targetDOL, brain, config, minRR, tf,
      evidence: { sequence: ["major_external_raid", "wick_rejection", "reclaim_within_2_bars", "reclaimed_level_limit"], majorLevel: levels?.find?.(l => l.id === raid.levelId) || raid, raid, rejectionBar: { index: raid.raidIndex, bar }, reclaimBar: { index: reclaim, bar: reclaimBar }, formationTime: reclaimBar.time } });
    if (candidate) return candidate;
  }
  return null;
}

function detectBreaker({ symbol, dir, bars, frames, ranges, targetDOL, brain, config, minRR, tf }) {
  const pd = detectPDArrays(bars, { tf });
  const raids = detectLiquidityRaids(bars, { maxReclaimBars: 2 });
  const pivots = confirmedFractals(bars, 5);
  for (const ob of pd.orderBlocks.filter(z => z.originalDir === -dir && z.state === "INVALIDATED").reverse()) {
    const top = Math.max(ob.top, ob.bottom), bottom = Math.min(ob.top, ob.bottom);
    const failedAt = ob.invalidatedAt;
    if (!(failedAt > ob.born) || bars.length - 1 - failedAt > (config.maxModelAgeBars ?? 14)) continue;
    const disp = displacementAt(bars, failedAt, dir);
    if (!disp?.valid) continue;
    const raid = raids.find(r => r.dir === dir && r.raidIndex > ob.born && r.reclaimIndex < failedAt);
    const pivot = (dir === 1 ? pivots.highs : pivots.lows).filter(p => p.confirmedAt < (raid?.raidIndex ?? failedAt)).at(-1);
    if (!raid || !pivot || !side(dir, bars[failedAt].close, pivot.price) || side(dir, bars[failedAt - 1].close, pivot.price)) continue;
    // OB entry is its BODY mean threshold, never the midpoint of wick extrema.
    const entry = Number(ob.mt);
    if (!finite(entry)) continue;
    if (bars.slice(failedAt + 1).some(b => dir === 1 ? b.close < bottom : b.close > top)) continue;
    if (!side(dir, bars.at(-1).close, dir === 1 ? bottom : top)) continue;
    const retest = bars.findIndex((b, i) => i > failedAt && b.low <= top && b.high >= bottom);
    const candidate = makeCandidate({ id: "breaker_block", symbol, dir, entry, zoneLow: bottom, zoneHigh: top, extreme: dir === 1 ? bottom : top, frames, ranges, targetDOL, brain, config, minRR, tf,
      evidence: { sequence: ["opposing_order_block", "liquidity_raid", "displaced_ob_and_structure_failure", "breaker_retest", "body_mt_limit"], failedOrderBlock: ob, raid, failedAt, brokenPivot: pivot, displacement: disp, retestIndex: retest >= 0 ? retest : failedAt, formationTime: bars[failedAt].time } });
    if (candidate) return candidate;
  }
  return null;
}

function detectOte({ symbol, dir, bars, frames, ranges, targetDOL, brain, config, minRR, tf }) {
  const fractals = confirmedFractals(bars, 5) || {};
  const highs = fractals.highs || [], lows = fractals.lows || [];
  const high = highs.at(-1), low = lows.filter(x => x.i < (high?.i ?? bars.length)).at(-1);
  const impulseHigh = dir === 1 ? high : highs.filter(x => x.i < (lows.at(-1)?.i ?? 0)).at(-1);
  const impulseLow = dir === 1 ? low : lows.at(-1);
  if (!impulseHigh || !impulseLow || !(impulseHigh.price > impulseLow.price)) return null;
  const span = impulseHigh.price - impulseLow.price;
  const fib62 = dir === 1 ? impulseHigh.price - span * .618 : impulseLow.price + span * .618;
  const fib786 = dir === 1 ? impulseHigh.price - span * .786 : impulseLow.price + span * .786;
  const fib705 = dir === 1 ? impulseHigh.price - span * .705 : impulseLow.price + span * .705;
  const zoneLow = Math.min(fib62, fib786), zoneHigh = Math.max(fib62, fib786);
  const pd = freshPda(frames, tf, dir);
  const start = dir === 1 ? impulseLow.i : impulseHigh.i;
  const end = dir === 1 ? impulseHigh.i : impulseLow.i;
  if (!(start < end) || bars.length - 1 - end > (config.maxModelAgeBars ?? 14)) return null;

  const macroDir = brain?.macroDir ?? (brain?.macroBias === "BULLISH" ? 1 : brain?.macroBias === "BEARISH" ? -1 : (brain?.bias === "BULLISH" ? 1 : brain?.bias === "BEARISH" ? -1 : 0));
  if (macroDir !== 0 && macroDir !== dir) return null;
  const flow = String(brain.fvgOrderFlow || "");
  const opposingFlow = dir === 1 ? /\bBEARISH_DOMINANT\b/i.test(flow) : /\bBULLISH_DOMINANT\b/i.test(flow);
  if (opposingFlow) return null;

  let hasImpulseDisplacement = false;
  let displacedBreak = null;
  const precedingPivot = (dir === 1 ? highs : lows).filter(p => p.confirmedAt < start).at(-1);
  for (let i = start + 1; i <= end; i++) {
    const displacement = displacementAt(bars, i, dir);
    if (displacement?.valid) {
      hasImpulseDisplacement = true;
      if (precedingPivot && side(dir, bars[i].close, precedingPivot.price) && !side(dir, bars[i - 1].close, precedingPivot.price)) {
        displacedBreak = { index: i, displacement, brokenPivot: precedingPivot };
        break;
      }
    }
  }
  if (!displacedBreak) {
    if (!hasImpulseDisplacement) return null;
    displacedBreak = { index: end, displacement: { valid: true }, brokenPivot: null };
  }

  if (bars.slice(end + 1).some(b => dir === 1 ? b.close < impulseLow.price : b.close > impulseHigh.price)) return null;

  const pdCenter = z => z.kind === "OB" ? z.mt : z.ce;
  const embedded = pd.fvgs.concat(pd.orderBlocks).find(z => bornAt(z) >= start && bornAt(z) <= end + 1 &&
    finite(pdCenter(z)) && pdCenter(z) >= Math.min(zoneLow, impulseLow.price + span * 0.5) && pdCenter(z) <= Math.max(zoneHigh, impulseHigh.price - span * 0.5));

  let entry = embedded ? pdCenter(embedded) : fib705;
  if (!finite(entry)) entry = fib705;
  const boundedZoneLow = Math.min(zoneLow, entry);
  const boundedZoneHigh = Math.max(zoneHigh, entry);

  if (!side(dir, bars.at(-1).close, dir === 1 ? impulseLow.price : impulseHigh.price)) return null;

  return makeCandidate({ id: "ote_continuation", symbol, dir, entry, zoneLow: boundedZoneLow, zoneHigh: boundedZoneHigh, extreme: dir === 1 ? impulseLow.price : impulseHigh.price, frames, ranges, targetDOL, brain, config, minRR, tf,
    evidence: { sequence: ["aligned_displaced_impulse", "ote_618_786", embedded ? "embedded_valid_pd_array" : "ote_705_sweetspot", "macro_flow_aligned", "pd_array_limit"], impulse: { high: impulseHigh, low: impulseLow, ...displacedBreak }, fib62, fib786, fib705, embedded: embedded || null, formationTime: bars[end].time } });
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
    let defMinUnits = 8;
    if (units.category === "metal") defMinUnits = 8;
    else if (units.category === "index") defMinUnits = 8;
    else if (units.category === "crypto") defMinUnits = 30;
    else if (units.category === "fx") defMinUnits = 6;
    const minimumUnits = Math.max(4, Math.min(15, Number(config.silverBulletMinUnits ?? defMinUnits)));
    if (!Number.isFinite(minimumUnits)) continue;
    if (!inWindow || !displacement?.valid || !units.pip || !ceUntouched(fvg, bars) || Math.abs(displacementBar.close - displacementBar.open) < minimumUnits * units.pip) continue;
    
    const candidateTargets = [
      ...majorLevels(frames, config.now ?? Date.now()),
      ...(targetDOL?.price ? [{ id: "DOL", name: "Target DOL", price: Number(targetDOL.price), side: dir, confirmationTime: 0 }] : []),
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

export function evaluateAllEntryModels({ symbol, dir, scenario, frames = {}, ranges, targetDOL, config = {}, brain = {} }) {
  if (![1, -1].includes(dir)) return null;
  const now = config.now ?? config.mockTime ?? Date.now();
  config = { ...config, now, scenario, symbolMeta: config.symbolMeta || frames.symbolMeta };
  frames = Object.fromEntries(Object.entries(frames).map(([key, value]) => [key, FRAME_SPEC[key] ? normalizeClosedBars(value, key, { now, timestampSemantics: "UTC_INSTANT" }) : value]));
  const bars = barsFor(frames, scenario);
  const triggerTf = scenario?.triggerTf || "M15";
  const tf = (triggerTf === "1H" || triggerTf === "H1") ? "H1" : (triggerTf === "15M" || triggerTf === "M15") ? "M15" : (triggerTf === "1M" || triggerTf === "M1") ? "M1" : (triggerTf === "5M" || triggerTf === "M5") ? "M5" : triggerTf;
  if (!bars?.length) return null;
  const minRR = Math.max(config.minRR ?? 2.2, scenario?.minRR ?? 2.2);
  const enabled = config.enabledModels || {};
  const fns = [
    ["ict_2022", detectIct], ["turtle_soup", detectTurtle], ["breaker_block", detectBreaker],
    ["ote_continuation", detectOte], ["silver_bullet", detectSilverBullet],
  ];
  const candidates = [];
  if (config.candidate) candidates.push(config.candidate);
  for (const [id, fn] of fns) if (enabled[id] !== false) {
    const candidate = fn({ symbol, dir, bars, frames, ranges, targetDOL, brain, config: { ...config, symbol }, minRR, tf });
    if (candidate) candidates.push(candidate);
  }
  if (!candidates.length) return null;
  const activeSlot = getCurrentTimeSlot(new Date(now));
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
  const modelId = candidate.modelId || candidate.id || candidate.type?.toLowerCase();
  if (!modelId) return false;
  if (!finite(candidate.entry) || !finite(candidate.sl) || candidate.entry <= 0 || candidate.sl <= 0) return false;
  if (!opposite(dir, candidate.sl, candidate.entry)) return false;

  const e = candidate.evidence;
  if (e && finite(e.formationTime) && e.formationTime <= 0) return false;
  return true;
}

export function evaluateExecutionVetoes({ symbol, dir, entry, sl, brain = {}, frames = {}, config = {}, now = new Date(), candidate = null }) {
  candidate ||= config.candidate || config.tradeIdea || null;
  const nowMs = new Date(now).getTime();
  const vetoes = [];
  if (!candidate || !hasModelEvidence(candidate, dir)) vetoes.push(veto("NO_STRICT_MODEL", "A complete causal entry model with model-specific evidence is required."));
  if (candidate?.diagnosticOnly || candidate?.legacyDiagnostic || candidate?.evidence?.diagnosticOnly || candidate?.evidence?.legacyDiagnostic) vetoes.push(veto("DIAGNOSTIC_ONLY", "Diagnostic setups are not eligible for execution."));
  if (candidate && config.enabledModels?.[candidate.modelId] === false) vetoes.push(veto("MODEL_DISABLED", "This entry model is disabled."));
  if (candidate?.evidence && finite(candidate.evidence.formationTime) && timeOf({ time: candidate.evidence.formationTime }) > nowMs + 60_000) vetoes.push(veto("NON_CAUSAL_MODEL", "Entry model formation is in the future."));
  if (![1, -1].includes(dir) || !finite(entry) || !finite(sl) || entry <= 0 || sl <= 0 || !opposite(dir, sl, entry)) vetoes.push(veto("INVALID_GEOMETRY", "Direction, entry, and structural stop are not valid."));
  const clock = isTradingPermittedNow(now, config, symbol);
  if (!clock.permitted) vetoes.push(veto(clock.isDeadZone ? "DEAD_ZONE" : "TIMING", clock.reason));
  const dol = brain.targetDOL;
  if (dol && (!finite(dol?.price) || dol.price <= 0 || !liveTarget(dol) || !side(dir, Number(dol.price), entry) || !alignedTargetSide(dol, dir))) vetoes.push(veto("DOL_MISALIGNED", "Causal, unconsumed Draw on Liquidity is missing or its target side disagrees with the limit."));
  const macroDir = brain.macroDir ?? (brain.macroBias === "BULLISH" ? 1 : brain.macroBias === "BEARISH" ? -1 : 0);
  if (macroDir && macroDir !== dir) vetoes.push(veto("HTF_MACRO", "D1/H4 macro direction does not agree with the trade."));
  const scenarioId = String(config.scenario?.id || "").toLowerCase();
  const range = scenarioId === "swing"
    ? (brain.ranges?.D1 || brain.dealingRange || brain.ranges?.H4)
    : scenarioId === "scalp"
      ? (brain.ranges?.M15 || brain.ranges?.H1 || brain.dealingRange)
      : (brain.dealingRange || brain.ranges?.H4 || brain.ranges?.D1);
  if (range && (!finite(range?.high) || !finite(range?.low) || range.high <= range.low)) vetoes.push(veto("MISSING_DEALING_RANGE", "A causally confirmed HTF dealing range is required; fallback extremes are not executable."));
  else if (range && (dir === 1 ? range.coveragePct >= 92 : range.coveragePct <= 8)) vetoes.push(veto("PREMIUM_DISCOUNT", `Limit is not strictly in ${dir === 1 ? "discount" : "premium"} of the HTF dealing range (${range.eq}).`));
  const scenarioKey = scenarioId.toUpperCase();
  const gatekeeper = brain.horizons?.[scenarioKey]?.gatekeeper || brain.dayTraderContext?.ltfGatekeeper;
  if (gatekeeper?.vetoActive && gatekeeper?.triggerStatus === "WAIT_PULLBACK") vetoes.push(veto("LTF_GATEKEEPER", gatekeeper.vetoReason || "Lower-timeframe gatekeeper has not approved displaced delivery."));
  if (dir === 1 ? brain.allowedToLong === false && brain.action === "STAND_ASIDE" : brain.allowedToShort === false && brain.action === "STAND_ASIDE") vetoes.push(veto("BRAIN_NOT_PERMITTED", "Authoritative institutional brain has not approved this direction."));
  for (const reason of brain.vetoes || []) if (!vetoes.some(x => x.code === reason.code)) vetoes.push(reason);
  const risk = Math.abs(entry - sl);
  const targets = Array.isArray(candidate?.targets) ? candidate.targets : null;
  const targetPrice = targets?.at(-1)?.price || candidate?.tp;
  const fullReward = targetPrice ? dir * (targetPrice - entry) : 0;
  const fullRR = fullReward > 0 && risk > 0 ? Math.round((fullReward / risk) * 100) / 100 : (Number(candidate?.targetRR || candidate?.rr) || 0);
  const minRR = config.minRR ?? config.scenario?.minRR ?? (config.managementLogic === "prop_firm_safe" ? 1.5 : 1.8);
  if (risk > 0 && fullRR > 0 && fullRR < minRR - 0.05) vetoes.push(veto("MIN_RR", `First structural target reward is below minimum R:R (${minRR}).`));
  if (candidate) {
    if (targets?.length && !targets.every(t => t && finite(t.price) && t.price > 0 && alignedTargetSide(t, dir))) vetoes.push(veto("INVALID_TARGETS", "Three positive, directional, ordered structural targets (50/30/20) are required."));
    if (candidate.modelId === "silver_bullet" && !getSilverBulletWindow(now)) vetoes.push(veto("SILVER_BULLET_WINDOW", "Silver Bullet entry is outside London 10–11 / NY 17–18 EET."));
  }
  const snapshot = frames.snapshot;
  const requiredTfs = config.scenario?.requiredTfs || ["D1", "H4", "H1", "M15", candidate?.tf || "M5"];
  if (snapshot && !snapshot?.closedOnly && snapshot.semantics !== "UTC_INSTANT" && !Number.isFinite(nowMs)) vetoes.push(veto("STALE_DATA", "Closed UTC snapshot is missing; setup remains diagnostic only."));
  for (const tf of [...new Set(requiredTfs)]) {
    const bars = frames[tf];
    if (!bars?.length) continue;
    const meta = snapshot?.timeframes?.[tf], spec = FRAME_SPEC[tf];
    if (spec && bars.some(b => ![b.open, b.high, b.low, b.close, b.time].every(finite) || b.low <= 0 || b.high < Math.min(b.open, b.close) && b.low > Math.max(b.open, b.close))) {
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
  return { permitted: vetoes.length === 0, vetoes };
}

export { BREAKDOWN_WEIGHTS, evaluateEntryModelDecisionEngine };

