import { getFrames, normalizeClosedBars, FRAME_SPEC } from "../bias/data.js";
import { computeSymbolBias } from "../bias/engine.js";
import { SMT_PAIRS, smtDivergence } from "../bias/context.js";
import { analyzeStructure } from "../bias/structure.js";
import { avgRange } from "../patterns/core.js";
import { resolveScenarioForPair } from "./scenarios.js";
import { selectOptimalEntryLevel, evaluateExecutionVetoes } from "./levels.js";
import { getMainWatchlistSymbols, isSymbolInMainWatchlist, getBrokerWatchlistSymbol } from "./watchlist.js";
import { canonOf } from "./symbols.js";
import { isTradingPermittedNow, getCurrentTimeSlot, getSymbolSessionProfile } from "./timeslots.js";

function normalizeFrames(frames = {}, now) {
  const result = { ...frames };
  for (const tf of Object.keys(FRAME_SPEC)) if (frames?.[tf]) result[tf] = normalizeClosedBars(frames[tf], tf, { now, timestampSemantics: "UTC_INSTANT" });
  return result;
}

async function fetchFrameSet(symbol, cfg, now, forceRefresh = false) {
  const supplied = cfg.frames?.[symbol] || cfg.frames?.[canonOf(symbol)] || (cfg.frames?.H4 ? cfg.frames : null);
  if (supplied) return normalizeFrames(supplied, now);
  const provider = cfg.getFrames || getFrames;
  return normalizeFrames(await provider(symbol, {
    ...cfg.feedOptions, now, forceRefresh, includeM1: cfg.useM1Refinement === true,
    timestampSemantics: cfg.timestampSemantics || cfg.feedOptions?.timestampSemantics,
    brokerUtcOffsetMinutes: cfg.brokerUtcOffsetMinutes ?? cfg.feedOptions?.brokerUtcOffsetMinutes,
    brokerTimeZone: cfg.brokerTimeZone || cfg.feedOptions?.brokerTimeZone,
  }), now);
}

function contextExtras(symbol, frames, gathered, cfg, now) {
  const partnerFrames = {};
  const smtEvidence = [];
  for (const partner of SMT_PAIRS[canonOf(symbol)] || []) {
    const data = gathered.get(canonOf(partner)) || cfg.partnerFrames?.[partner];
    if (!data) continue;
    partnerFrames[partner] = data;
    if (frames.snapshot?.timeframes?.M15?.stale || data.snapshot?.timeframes?.M15?.stale) continue;
    const evidence = smtDivergence(frames.M15, data.M15, partner);
    if (evidence && now - evidence.time * 1000 <= 12 * 900000) smtEvidence.push({ ...evidence, partner, confirmed: true });
  }
  const riskDirs = ["US500", "BTCUSD"].map(s => gathered.get(s)?.H1).filter(b => b?.length >= 12).map(b => analyzeStructure(b, avgRange(b)).dir).filter(d => d !== 0);
  const risk = cfg.risk || (riskDirs.length ? { score: Math.round(riskDirs.reduce((a, b) => a + b, 0) / riskDirs.length * 100), note: "Closed H1 cross-asset structure" } : null);
  return { now, partnerFrames, smtEvidence, risk, news: cfg.news || [], snapshot: frames.snapshot, priorState: cfg.priorStates?.[canonOf(symbol)] || cfg.priorState || null };
}

function evaluateSymbol(symbol, frames, gathered, cfg, now) {
  const extras = contextExtras(symbol, frames, gathered, cfg, now);
  const bias = (cfg.computeBias || computeSymbolBias)(canonOf(symbol), frames, extras);
  const htfLiq = bias.htfLiquidity || {};
  const macroBias = htfLiq.macroBias || bias.brain?.dayTraderContext?.macroCompass || (bias.score > 15 ? "BULLISH" : bias.score < -15 ? "BEARISH" : "NEUTRAL");
  const macroDir = htfLiq.macroDir ?? (macroBias === "BULLISH" ? 1 : macroBias === "BEARISH" ? -1 : 0);
  const ltfGate = bias.brain?.dayTraderContext?.ltfGatekeeper || bias.brain?.horizons?.DAY?.gatekeeper || {};
  const brain = {
    ...bias.brain,
    macroBias,
    macroDir,
    macroCompass: macroBias,
    thesisId: htfLiq.drawOnLiquidity?.catalyst || bias.brain?.verdict || "HTF_STRUCTURE",
    gatekeeperStatus: ltfGate.triggerStatus || "NEUTRAL",
    gatekeeperVeto: Boolean(ltfGate.vetoActive),
    gatekeeperReason: ltfGate.vetoReason || null,
    targetDOL: bias.brain?.targetDOL || htfLiq.drawOnLiquidity || null,
    dealingRange: bias.ranges?.H4 || bias.ranges?.D1 || null,
    ranges: bias.ranges || {},
    htfLiquidity: bias.htfLiquidity,
    smtEvidence: extras.smtEvidence,
    snapshot: frames.snapshot,
  };
  const resolution = resolveScenarioForPair({ symbol, brain, ranges: bias.ranges, config: cfg });
  const dir = brain.macroDir || 0;
  const scenario = resolution.scenario;
  const config = { ...cfg, scenario, now, symbolMeta: frames.symbolMeta || cfg.symbolMeta };
  const stagedLevel = dir ? selectOptimalEntryLevel({ symbol, dir, scenario, frames, ranges: bias.ranges, htfFvg: bias.htfFvg, targetDOL: brain.targetDOL, config, brain }) : null;
  
  let execution;
  if (stagedLevel) {
    execution = evaluateExecutionVetoes({ symbol, dir, entry: stagedLevel.entry, sl: stagedLevel.sl, brain, frames, config: { ...config, candidate: stagedLevel }, now: new Date(now) });
    const minConviction = cfg.minConviction ?? 70;
    if (!(brain.conviction >= minConviction)) execution.vetoes.push({ code: "CONVICTION", reason: `Brain conviction is below ${minConviction}.` });
    const range = brain.dealingRange || bias.ranges?.H4;
    const remainingRunwayPct = range && dir ? (dir === 1 ? 100 - range.coveragePct : range.coveragePct) : 0;
    if (remainingRunwayPct < (cfg.minRunwayPct ?? 25)) execution.vetoes.push({ code: "RUNWAY", reason: "Insufficient protected HTF runway." });
    execution.permitted = execution.vetoes.length === 0;
    Object.assign(stagedLevel, { permitted: execution.permitted, vetoes: execution.vetoes });
  } else {
    const clock = isTradingPermittedNow(new Date(now), config, symbol);
    const vetoes = [];
    if (!clock.permitted) vetoes.push({ code: clock.isDeadZone ? "DEAD_ZONE" : "TIMING", reason: clock.reason });
    if (dir === 0) {
      vetoes.push({ code: "MACRO_NEUTRAL", reason: "Market structure is in consolidation equilibrium; awaiting directional expansion." });
    } else {
      vetoes.push({ code: "SCANNING_RETRACE", reason: `Holding ${macroBias} macro bias. Scanning for lower-timeframe FVG CE / OTE entry retracement.` });
    }
    execution = { permitted: false, vetoes };
  }
  const range = brain.dealingRange || bias.ranges?.H4;
  const remainingRunwayPct = range && dir ? (dir === 1 ? 100 - range.coveragePct : range.coveragePct) : 0;
  return { bias, brain, resolution, dir, stagedLevel, execution, remainingRunwayPct };
}

export async function scanUniverse(config = {}, preloadedWatchlist = null) {
  const now = new Date(config.now ?? Date.now()).getTime();
  const watchlist = preloadedWatchlist || config.mainWatchlistSymbols || await getMainWatchlistSymbols();
  const blacklist = new Set((config.blacklist || []).map(canonOf));
  const whitelist = new Set((config.whitelist || []).map(canonOf));
  // Canonical deduplication keeps the exact watchlist broker spelling first.
  const universe = new Map();
  for (const symbol of [...watchlist, ...(config.universe || [])]) if (!blacklist.has(canonOf(symbol)) && !universe.has(canonOf(symbol))) universe.set(canonOf(symbol), symbol);
  const fetchSymbols = new Map(universe);
  for (const symbol of universe.values()) for (const partner of SMT_PAIRS[canonOf(symbol)] || []) {
    if (!fetchSymbols.has(partner)) fetchSymbols.set(partner, getBrokerWatchlistSymbol(partner, watchlist));
  }
  // Stage one: gather the basket with controlled concurrency to prevent MT5 bridge socket/timeout exhaustion.
  const gathered = new Map();
  const errors = new Map();
  const fetchList = [...fetchSymbols];
  for (let i = 0; i < fetchList.length; i += 2) {
    const chunk = fetchList.slice(i, i + 2);
    await Promise.all(chunk.map(async ([canonical, symbol]) => {
      try { gathered.set(canonical, await fetchFrameSet(symbol, config, now)); }
      catch (error) { errors.set(canonical, error.message); }
    }));
  }
  const activeTimeSlot = getCurrentTimeSlot(new Date(now));
  const timeCheck = isTradingPermittedNow(new Date(now), config);
  const rankedPairs = [];
  // Stage two: complete partner frames, news/risk, and snapshot are supplied.
  for (const [canonical, symbol] of universe) {
    const isInMainWatchlist = isSymbolInMainWatchlist(symbol, watchlist);
    const tradeableSymbol = getBrokerWatchlistSymbol(symbol, watchlist);
    const frames = gathered.get(canonical);
    try {
      if (!frames?.M15?.length || !frames?.H4?.length) throw new Error(errors.get(canonical) || "Required closed timeframe data unavailable");
      const evaluation = evaluateSymbol(symbol, frames, gathered, config, now);
      const { brain, dir, stagedLevel, execution, resolution, remainingRunwayPct } = evaluation;
      if (!isInMainWatchlist) execution.vetoes.unshift({ code: "WATCHLIST_RESTRICTED", reason: "Context only: symbol is not in the Main Watchlist." });
      const permitted = isInMainWatchlist && execution.permitted;
      const first = execution.vetoes[0];
      const status = !isInMainWatchlist
        ? "RESTRICTED_CONTEXT_ONLY"
        : permitted
        ? "PRIME_QUALIFIED"
        : execution.vetoes.some(v => v.code === "STALE_DATA")
        ? "BLOCKED_STALE_DATA"
        : execution.vetoes.some(v => v.code === "DEAD_ZONE")
        ? "OFF_SESSION_DEAD_ZONE"
        : !stagedLevel
        ? (dir !== 0 ? "WATCHING_RETRACE" : "SCANNING_NEUTRAL")
        : `BLOCKED_${first?.code || "CONFLICT"}`;
      const statusReason = permitted
        ? "Causal model, macro/DOL, fresh closed frames and all execution vetoes approved."
        : execution.vetoes.map(v => v.reason).join(" · ");
      const sessionProfile = getSymbolSessionProfile(symbol);
      rankedPairs.push({
        symbol, tradeableSymbol, isInMainWatchlist, isTradeable: isInMainWatchlist, permitted,
        dir, dirLabel: dir === 1 ? "BUY" : dir === -1 ? "SELL" : "NEUTRAL", status, statusReason,
        opportunityScore: permitted ? stagedLevel.confluenceScore : Math.min(stagedLevel?.confluenceScore ?? 0, 59),
        vetoes: execution.vetoes, scenario: { ...resolution.scenario, mode: resolution.mode, rationale: resolution.rationale },
        brain,
        ranges: evaluation.bias.ranges, dealingRange: brain.dealingRange, thesisId: brain.thesisId,
        ideaId: stagedLevel?.ideaId, evidence: stagedLevel?.evidence || brain.evidence,
        targets: stagedLevel?.targets || [], confluenceBreakdown: stagedLevel?.confluenceBreakdown || null,
        range: { ...(brain.dealingRange || {}), h4Zone: brain.h4Zone, h4CoveragePct: brain.h4CoveragePct, remainingRunwayPct, isExhausted: brain.dealingRange?.isExhausted || false },
        stagedLevel,
        entryModel: stagedLevel ? { ...stagedLevel, id: stagedLevel.modelId, name: stagedLevel.modelName, badge: stagedLevel.modelBadge } : null,
        snapshot: frames.snapshot, activeTimeSlot,
        sessionProfile: { ...sessionProfile, isCurrentlyActive: isTradingPermittedNow(new Date(now), config, symbol).permitted },
        currentPrice: frames.M5?.at(-1)?.close ?? frames.M15.at(-1).close,
        isWhitelisted: whitelist.has(canonical),
      });
    } catch (error) {
      rankedPairs.push({ symbol, tradeableSymbol, isInMainWatchlist, isTradeable: isInMainWatchlist, permitted: false, dir: 0, status: isInMainWatchlist ? "BLOCKED_DATA_ERROR" : "RESTRICTED_CONTEXT_ONLY", statusReason: error.message, opportunityScore: 0, brain: {}, stagedLevel: null, vetoes: [{ code: "DATA_UNAVAILABLE", reason: error.message }], snapshot: frames?.snapshot || null });
    }
  }
  rankedPairs.sort((a, b) => Number(b.isInMainWatchlist) - Number(a.isInMainWatchlist) || b.opportunityScore - a.opportunityScore || a.symbol.localeCompare(b.symbol));
  const primeSetups = rankedPairs.filter(r => r.status === "PRIME_QUALIFIED" && r.isTradeable && r.permitted);
  return {
    scannedAt: new Date(now), activeTimeSlot, timeSlotPermitted: timeCheck.permitted, timeSlotReason: timeCheck.reason,
    totalScanned: rankedPairs.length, mainWatchlistCount: rankedPairs.filter(r => r.isInMainWatchlist).length,
    contextOnlyCount: rankedPairs.filter(r => !r.isTradeable).length, mainWatchlistSymbols: watchlist, rankedPairs, primeSetups,
    primeCount: primeSetups.length, watchingCount: rankedPairs.filter(r => r.status === "WATCHING_RETRACE").length,
    blockedCount: rankedPairs.filter(r => r.status.startsWith("BLOCKED") && r.isTradeable).length,
  };
}

function sameRange(before, after) {
  if (!before || !after) return true;
  return Math.abs(Number(before.high) - Number(after.high)) <= 0.05 * Math.abs(Number(before.high) - Number(before.low) || 1) &&
    Math.abs(Number(before.low) - Number(after.low)) <= 0.05 * Math.abs(Number(before.high) - Number(before.low) || 1);
}

// Arming and execution revalidate macro context, structural bounds, and risk boundaries.
// Resting limit orders are not discarded merely because price is in-between retracement.
export async function revalidateTradeIdea(trade, cfg = {}, now = new Date()) {
  const vetoes = [];
  let brain = null;
  try {
    const nowMs = new Date(now).getTime();
    const symbol = trade.symbol || trade.tradeableSymbol;
    const watchlist = cfg.mainWatchlistSymbols || await getMainWatchlistSymbols();
    if (!isSymbolInMainWatchlist(symbol, watchlist)) vetoes.push({ code: "WATCHLIST_RESTRICTED", reason: "Trade symbol is no longer in the Main Watchlist." });
    if ((cfg.blacklist || []).some(s => canonOf(s) === canonOf(symbol))) vetoes.push({ code: "BLACKLISTED", reason: "Trade symbol is blacklisted." });
    
    const gathered = new Map();
    const names = [symbol, ...(SMT_PAIRS[canonOf(symbol)] || []).map(s => getBrokerWatchlistSymbol(s, watchlist))];
    await Promise.all(names.map(async s => gathered.set(canonOf(s), await fetchFrameSet(s, cfg, nowMs, false))));
    const frames = gathered.get(canonOf(symbol));
    
    const original = trade.stagedLevel || trade.snapshot?.stagedLevel || trade;
    const entry = trade.entryPrice ?? original.entry;
    const sl = trade.initialSlPrice ?? trade.slPrice ?? original.sl;
    const tp = trade.tpPrice ?? original.tp ?? original.targets?.at(-1)?.price;
    const current = frames?.M5?.at(-1)?.close ?? frames?.M15?.at(-1)?.close;

    // 1. Structural stop breach before fill
    if (current != null && sl != null && (trade.dir === 1 ? current <= sl : current >= sl)) {
      vetoes.push({ code: "STRUCTURE_INVALIDATED", reason: "Structural invalidation has already traded before entry fill." });
    }
    // 2. Full target already achieved before limit retracement
    if (current != null && tp != null && (trade.dir === 1 ? current >= tp : current <= tp)) {
      vetoes.push({ code: "TARGET_ALREADY_HIT", reason: "Target has already traded prior to limit entry fill." });
    }

    const beforeBrain = trade.brain || trade.snapshot?.brain || {};
    const evaluation = evaluateSymbol(symbol, frames, gathered, { ...cfg, priorState: beforeBrain }, nowMs);
    brain = evaluation.brain;

    // 3. Macro directional inversion
    const macroDir = brain.macroDir ?? (brain.macroBias === "BULLISH" ? 1 : brain.macroBias === "BEARISH" ? -1 : 0);
    if (macroDir !== 0 && trade.dir !== 0 && macroDir !== trade.dir) {
      vetoes.push({ code: "THESIS_CHANGED", reason: `Macro directional thesis inverted to ${brain.macroBias} against trade.` });
    }

    // 4. Dealing range structural integrity
    const range = brain.dealingRange || evaluation.bias?.ranges?.H4;
    if (range && (!Number.isFinite(Number(range.high)) || !Number.isFinite(Number(range.low)) || Number(range.high) <= Number(range.low))) {
      vetoes.push({ code: "RANGE_CHANGED", reason: "Protected dealing range anchors are invalid." });
    }

    // 5. Target DOL consumed
    const dol = trade.targetDOL || original.targetDOL || beforeBrain.targetDOL;
    if (dol && brain.targetDOL && (brain.targetDOL.consumed === true || ["swept", "consumed", "broken"].includes(String(brain.targetDOL.state || "").toLowerCase()))) {
      vetoes.push({ code: "DOL_CHANGED", reason: "Original draw on liquidity was consumed, moved, or replaced." });
    }

    // 6. Retain candidate identity and score without demanding a new synthetic bar trigger
    const fresh = evaluation.stagedLevel;
    const originalConfluence = Number(original.confluenceScore || trade.confluenceScore || original.opportunityScore || 70);
    const confluenceScore = (fresh && fresh.dir === trade.dir) ? (fresh.confluenceScore || originalConfluence) : originalConfluence;
    const candidate = {
      ...original,
      modelId: trade.modelId || original.modelId || trade.entryModel?.id || original.id || "fvg_retest",
      tf: original.tf || trade.tf || "M15",
      targets: trade.targets || original.targets,
      confluenceScore,
    };

    const gate = evaluateExecutionVetoes({
      symbol,
      dir: trade.dir,
      entry,
      sl,
      brain,
      frames,
      config: { ...cfg, scenario: evaluation.resolution.scenario, candidate },
      now,
    });
    vetoes.push(...gate.vetoes);
  } catch (error) {
    vetoes.push({ code: "REVALIDATION_UNAVAILABLE", reason: `Fresh thesis validation failed: ${error.message}` });
  }
  return { permitted: vetoes.length === 0, vetoes: vetoes.filter((v, i, all) => all.findIndex(x => x.code === v.code) === i), brain };
}

function liveDolMatch(before, after) {
  if (!before || !after) return true;
  return after.consumed !== true && !["swept", "consumed", "broken"].includes(String(after.state || "").toLowerCase());
}

