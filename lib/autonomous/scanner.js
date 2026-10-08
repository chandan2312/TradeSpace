import { getFrames, normalizeClosedBars, FRAME_SPEC } from "../bias/data.js";
import { computeSymbolBias } from "../bias/engine.js";
import { SMT_PAIRS, smtDivergence } from "../bias/context.js";
import { analyzeStructure } from "../bias/structure.js";
import { avgRange } from "../patterns/core.js";
import { SCENARIOS, resolveScenarioForPair } from "./scenarios.js";
import { selectOptimalEntryLevel, evaluateExecutionVetoes } from "./levels.js";
import { symbolUnits } from "./models.js";
import { getMainWatchlistSymbols, isSymbolInMainWatchlist, getBrokerWatchlistSymbol } from "./watchlist.js";
import { canonOf } from "./symbols.js";
import { isTradingPermittedNow, getCurrentTimeSlot, getSymbolSessionProfile } from "./timeslots.js";

function normalizeFrames(frames = {}, now, semantics = "BROKER_NAIVE") {
  if (!frames) return {};
  const result = { ...frames };
  for (const tf of Object.keys(FRAME_SPEC)) {
    if (frames?.[tf]?.length) {
      const sample = frames[tf][0];
      if (sample?.closed && sample?.timestampSemantics === "UTC_INSTANT") {
        result[tf] = frames[tf];
      } else {
        result[tf] = normalizeClosedBars(frames[tf], tf, { now, timestampSemantics: semantics });
      }
    }
  }
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

export function computeMacroConfluenceBreakdown({ dir = 0, brain = {}, bias = {}, activeTimeSlot, currentPrice }) {
  const dol = brain.targetDOL || bias.htfLiquidity?.drawOnLiquidity;
  const dolAligned = Boolean(
    dol?.price && dir !== 0 && (dir === 1 ? dol.price > currentPrice : dol.price < currentPrice)
  );

  const range = brain.dealingRange || bias.ranges?.H4 || bias.ranges?.D1;
  const eq = range?.eq || (range?.high && range?.low ? (range.high + range.low) / 2 : null);
  const inDiscountOrPremium = Boolean(
    dir !== 0 && eq != null && currentPrice != null && (dir === 1 ? currentPrice <= eq : currentPrice >= eq)
  );

  const hasDisplacement = Boolean(
    brain.displacement?.valid ||
    bias.displacement?.valid ||
    brain.dayTraderContext?.ltfGatekeeper?.triggerStatus === "CONFIRMED" ||
    brain.dayTraderContext?.displacement
  );

  const isKillzone = Boolean(activeTimeSlot?.isKillzone);
  const hasSmt = Boolean(brain.smtEvidence?.some(x => x.dir === dir && x.confirmed !== false));
  const isHtfPdArray = Boolean(bias.htfFvg?.respected?.length || brain.htfPdArray);

  return {
    dolAlignment: dolAligned ? 25 : 0,
    premiumDiscount: inDiscountOrPremium ? 20 : 0,
    displacement: hasDisplacement ? 20 : 0,
    killzone: isKillzone ? 15 : 0,
    smt: hasSmt ? 10 : 0,
    htfPdArray: isHtfPdArray ? 10 : 0,
  };
}

export function evaluateSymbol(symbol, frames, gathered, cfg, now, targetScenario = null, precomputedBias = null) {
  const extras = contextExtras(symbol, frames, gathered, cfg, now);
  const bias = precomputedBias || (cfg.computeBias || computeSymbolBias)(canonOf(symbol), frames, extras);
  const htfLiq = bias.htfLiquidity || {};

  // Resolve target scenario if not explicitly provided
  let resolution;
  let scenario;
  if (targetScenario) {
    scenario = targetScenario;
    resolution = { scenario, mode: `configured_${scenario.id}`, rationale: scenario.description };
  } else {
    resolution = resolveScenarioForPair({ symbol, brain: bias.brain, ranges: bias.ranges, config: cfg });
    scenario = resolution.scenario;
  }

  const horizonKey = scenario.id === "swing" ? "SWING" : scenario.id === "scalp" ? "SCALP" : "DAY";
  const horizonData = bias.brain?.horizons?.[horizonKey] || {};

  // Horizon-specific macro compass and directional bias
  let macroBias = horizonData.macroCompass;
  if (!macroBias || macroBias === "NEUTRAL") {
    if (scenario.id === "swing") {
      macroBias = htfLiq.macroBias || (bias.score > 15 ? "BULLISH" : bias.score < -15 ? "BEARISH" : "NEUTRAL");
    } else if (scenario.id === "scalp") {
      macroBias = horizonData.macroCompass || (bias.score > 15 ? "BULLISH" : bias.score < -15 ? "BEARISH" : "NEUTRAL");
    } else {
      macroBias = htfLiq.macroBias || bias.brain?.dayTraderContext?.macroCompass || (bias.score > 15 ? "BULLISH" : bias.score < -15 ? "BEARISH" : "NEUTRAL");
    }
  }
  const macroDir = macroBias === "BULLISH" ? 1 : macroBias === "BEARISH" ? -1 : 0;

  // Horizon-specific gatekeeper
  const ltfGate = horizonData.gatekeeper || (scenario.id === "day" ? bias.brain?.dayTraderContext?.ltfGatekeeper : {}) || {};

  // Horizon-specific dealing range:
  // Swing uses D1 / H4, Day uses H4 / H1, Scalp uses 30M / 15M / 5M
  const horizonDealingRange = scenario.id === "swing"
    ? (bias.ranges?.D1 || bias.ranges?.H4 || null)
    : scenario.id === "scalp"
    ? (bias.ranges?.M30 || bias.ranges?.["30M"] || bias.ranges?.M15 || bias.ranges?.M5 || null)
    : (bias.ranges?.H4 || bias.ranges?.H1 || null);

  // Horizon-specific Draw on Liquidity (DOL):
  // Swing: Macro DOL (Weekly / Daily external liquidity pool)
  // Day: Session / H1 / H4 dealing range extreme or session liquidity pool
  // Scalp: 30M / 15M dealing range extreme or intraday session liquidity pool
  let horizonTargetDOL = bias.brain?.targetDOL || htfLiq.drawOnLiquidity || null;
  const dirGuess = macroDir || (bias.score > 0 ? 1 : bias.score < 0 ? -1 : 0);
  const isDolAligned = horizonTargetDOL && (
    dirGuess === 1
      ? (horizonTargetDOL.targetSide === "BSL" || horizonTargetDOL.direction === 1 || horizonTargetDOL.side === 1)
      : (horizonTargetDOL.targetSide === "SSL" || horizonTargetDOL.direction === -1 || horizonTargetDOL.side === -1)
  );
  if (!isDolAligned) {
    horizonTargetDOL = null;
  }

  if (dirGuess !== 0) {
    if (scenario.id === "scalp" && horizonDealingRange) {
      const rangeTargetPrice = dirGuess === 1 ? horizonDealingRange.high : horizonDealingRange.low;
      if (Number.isFinite(rangeTargetPrice)) {
        horizonTargetDOL = {
          id: `range_${scenario.id}_${dirGuess === 1 ? "bsl" : "ssl"}`,
          price: rangeTargetPrice,
          targetSide: dirGuess === 1 ? "BSL" : "SSL",
          direction: dirGuess,
          side: dirGuess,
          causal: true,
          state: "UNCONSUMED",
          name: "30M/5M Dealing Range Extreme",
          catalyst: "Intraday Range Expansion toward Liquidity",
          tf: horizonDealingRange.tf || "30M",
        };
      }
    } else if (scenario.id === "day" && horizonDealingRange) {
      const rangeTargetPrice = dirGuess === 1 ? horizonDealingRange.high : horizonDealingRange.low;
      const macroPrice = Number(horizonTargetDOL?.price);
      const span = Math.abs((horizonDealingRange.high || 0) - (horizonDealingRange.low || 0));
      if (Number.isFinite(rangeTargetPrice)) {
        if (!macroPrice || (span > 0 && Math.abs(macroPrice - rangeTargetPrice) > span * 2.5)) {
          horizonTargetDOL = {
            id: `range_${scenario.id}_${dirGuess === 1 ? "bsl" : "ssl"}`,
            price: rangeTargetPrice,
            targetSide: dirGuess === 1 ? "BSL" : "SSL",
            direction: dirGuess,
            side: dirGuess,
            causal: true,
            state: "UNCONSUMED",
            name: "4H/1H Dealing Range Extreme",
            catalyst: "Day Trade Range Expansion toward Session Liquidity",
            tf: "H4",
          };
        }
      }
    } else if (scenario.id === "swing") {
      const rangeTargetPrice = dirGuess === 1
        ? (bias.ranges?.D1?.high || horizonDealingRange?.high || bias.ranges?.H4?.high)
        : (bias.ranges?.D1?.low || horizonDealingRange?.low || bias.ranges?.H4?.low);
      const macroPrice = Number(horizonTargetDOL?.price);
      if (Number.isFinite(rangeTargetPrice)) {
        if (!macroPrice || (dirGuess === 1 ? macroPrice < rangeTargetPrice : macroPrice > rangeTargetPrice)) {
          horizonTargetDOL = {
            id: `macro_${scenario.id}_${dirGuess === 1 ? "bsl" : "ssl"}`,
            price: rangeTargetPrice,
            targetSide: dirGuess === 1 ? "BSL" : "SSL",
            direction: dirGuess,
            side: dirGuess,
            causal: true,
            state: "UNCONSUMED",
            name: "Daily Macro Range Extreme",
            catalyst: "Macro Horizon Expansion toward Major Pool",
            tf: "D1",
          };
        }
      }
    }
  }

  const brain = {
    ...bias.brain,
    macroBias,
    macroDir,
    macroCompass: macroBias,
    thesisId: htfLiq.drawOnLiquidity?.catalyst || bias.brain?.verdict || "HTF_STRUCTURE",
    gatekeeperStatus: ltfGate.triggerStatus || "NEUTRAL",
    gatekeeperVeto: Boolean(ltfGate.vetoActive),
    gatekeeperReason: ltfGate.vetoReason || null,
    targetDOL: horizonTargetDOL,
    dealingRange: horizonDealingRange,
    ranges: bias.ranges || {},
    htfLiquidity: bias.htfLiquidity,
    smtEvidence: extras.smtEvidence,
    snapshot: frames.snapshot,
    currentHorizon: scenario.id,
  };
  const dir = brain.macroDir || 0;
  const config = { ...cfg, scenario, now, symbolMeta: frames.symbolMeta || cfg.symbolMeta };
  const stagedLevel = dir ? selectOptimalEntryLevel({ symbol, dir, scenario, frames, ranges: bias.ranges, htfFvg: bias.htfFvg, targetDOL: horizonTargetDOL, config, brain }) : null;
  
  let execution;
  if (stagedLevel) {
    // Two-Way Team Harmonization between Brain and Entry Model:
    const modelScore = Number(stagedLevel.confluenceScore || 70);
    const macroConviction = Number(brain.conviction || 70);
    const unifiedConviction = Math.round(0.5 * macroConviction + 0.5 * modelScore);
    brain.conviction = unifiedConviction;
    brain.macroConviction = macroConviction;
    brain.modelScore = modelScore;
    stagedLevel.conviction = unifiedConviction;

    execution = evaluateExecutionVetoes({ symbol, dir, entry: stagedLevel.entry, sl: stagedLevel.sl, brain, frames, config: { ...config, candidate: stagedLevel }, now: new Date(now) });
    const minConviction = cfg.minConviction ?? 60;
    if (!(brain.conviction >= minConviction)) execution.vetoes.push({ code: "CONVICTION", reason: `Brain conviction (${brain.conviction}) is below ${minConviction}.` });
    const range = brain.dealingRange || bias.ranges?.H4;
    const remainingRunwayPct = range && dir ? (dir === 1 ? 100 - range.coveragePct : range.coveragePct) : 0;
    if (remainingRunwayPct < (cfg.minRunwayPct ?? 15)) execution.vetoes.push({ code: "RUNWAY", reason: "Insufficient protected HTF runway." });
    execution.permitted = execution.vetoes.length === 0;
    Object.assign(stagedLevel, { permitted: execution.permitted, vetoes: execution.vetoes });
  } else {
    const clock = isTradingPermittedNow(new Date(now), config, symbol);
    const vetoes = [];
    if (!clock.permitted) vetoes.push({ code: clock.isDeadZone ? "DEAD_ZONE" : "TIMING", reason: clock.reason });
    if (dir === 0) {
      vetoes.push({ code: "MACRO_NEUTRAL", reason: `Market structure on ${scenario.macroTf || "HTF"} is in consolidation equilibrium; awaiting directional expansion.` });
    } else {
      vetoes.push({ code: "SCANNING_RETRACE", reason: `Holding ${macroBias} macro bias on ${scenario.macroTf || "HTF"}. Scanning for ${scenario.gatekeeperTf || "LTF"} entry retracement.` });
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

  // Determine active horizons to evaluate:
  // If config.horizonMode is set to a specific horizon ("day", "swing", "scalp"), only evaluate that horizon.
  // Otherwise, evaluate all 3 official horizons: Day (4H-15M), Swing (1D-1H), Scalp (30M-5M).
  const requestedMode = String(config.horizonMode || "all").toLowerCase().trim();
  const activeHorizons = requestedMode === "day" || requestedMode === "day_trade"
    ? [SCENARIOS.DAY]
    : requestedMode === "swing"
    ? [SCENARIOS.SWING]
    : requestedMode === "scalp"
    ? [SCENARIOS.SCALP]
    : [SCENARIOS.DAY, SCENARIOS.SWING, SCENARIOS.SCALP];

  // Stage two: evaluate horizons for each symbol
  for (const [canonical, symbol] of universe) {
    const isInMainWatchlist = isSymbolInMainWatchlist(symbol, watchlist);
    const tradeableSymbol = getBrokerWatchlistSymbol(symbol, watchlist);
    const frames = gathered.get(canonical);
    try {
      if (!frames?.M15?.length || !frames?.H4?.length) {
        const detail = errors.get(canonical)
          || frames?.snapshot?.timeframes?.M15?.error
          || frames?.snapshot?.timeframes?.H4?.error
          || "Required closed timeframe data unavailable";
        throw new Error(detail);
      }

      const extras = contextExtras(symbol, frames, gathered, config, now);
      const precomputedBias = (config.computeBias || computeSymbolBias)(canonical, frames, extras);

      const symbolResolvedLevels = [];
      for (const scenario of activeHorizons) {
        // Skip scalp if M5 frames are required but not present and M15 is not available
        if (scenario.id === "scalp" && !frames.M5?.length && !frames.M15?.length) continue;

        const evaluation = evaluateSymbol(symbol, frames, gathered, config, now, scenario, precomputedBias);
        const { brain, dir, stagedLevel, execution, resolution, remainingRunwayPct } = evaluation;

        // Anti-Collision & Horizon Differentiation Guard:
        // Ensure that a lower-timeframe horizon does not duplicate or cluster within micro distance of another horizon for this symbol
        if (stagedLevel) {
          const units = symbolUnits(symbol, config);
          const m15Bars = frames.M15 || frames.H1 || frames.M5 || [];
          const m15Range = avgRange(m15Bars);
          const minSeparation = scenario.id === "swing"
            ? Math.max(m15Range * 1.25, (units.point || 0.0001) * 10)
            : scenario.id === "day"
            ? Math.max(m15Range * 0.6, (units.point || 0.0001) * 5)
            : Math.max((units.point || 0.0001) * 2, 0.00001);

          let duplicate = symbolResolvedLevels.find((prev) =>
            prev.dir === dir &&
            (Math.abs(prev.entry - stagedLevel.entry) < minSeparation ||
             Math.abs(prev.sl - stagedLevel.sl) < minSeparation)
          );

          if (duplicate && Array.isArray(stagedLevel.allCandidates) && stagedLevel.allCandidates.length > 1) {
            const separatedCandidate = stagedLevel.allCandidates.find((c) =>
              c.permitted &&
              !symbolResolvedLevels.some((prev) =>
                prev.dir === dir &&
                (Math.abs(prev.entry - c.entry) < minSeparation ||
                 Math.abs(prev.sl - c.sl) < minSeparation)
              )
            );
            if (separatedCandidate) {
              Object.assign(stagedLevel, separatedCandidate);
              duplicate = null;
            }
          }

          if (duplicate) {
            stagedLevel.permitted = false;
            execution.permitted = false;
            execution.vetoes.push({
              code: "HORIZON_LEVEL_COLLISION",
              reason: `Entry level (${stagedLevel.entry}) is clustered too close to active ${duplicate.horizon.toUpperCase()} setup (within ${minSeparation.toFixed(4)} pts). Awaiting distinct ${scenario.gatekeeperTf || "HTF"} structural retracement.`
            });
          } else {
            symbolResolvedLevels.push({
              horizon: scenario.id,
              dir,
              entry: stagedLevel.entry,
              sl: stagedLevel.sl,
              tp: stagedLevel.tp,
            });
          }
        }
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
        const sessionProfile = getSymbolSessionProfile(symbol, config);
        const currentPrice = frames.M5?.at(-1)?.close ?? frames.M15?.at(-1)?.close;
        const macroConfluenceBreakdown = computeMacroConfluenceBreakdown({
          dir,
          brain,
          bias: evaluation.bias,
          activeTimeSlot,
          currentPrice,
        });
        const macroScore = Object.values(macroConfluenceBreakdown).reduce((a, b) => a + b, 0);
        const effectiveBreakdown = stagedLevel?.confluenceBreakdown || macroConfluenceBreakdown;
        const rawScore = stagedLevel?.confluenceScore ?? macroScore;
        const opportunityScore = permitted
          ? stagedLevel.confluenceScore
          : (stagedLevel ? Math.min(stagedLevel.confluenceScore, 59) : Math.min(macroScore, dir !== 0 ? 55 : 25));

        const radarKey = `${symbol}:${scenario.id}`;
        rankedPairs.push({
          radarKey,
          symbol, tradeableSymbol, isInMainWatchlist, isTradeable: isInMainWatchlist, permitted,
          dir, dirLabel: dir === 1 ? "BUY" : dir === -1 ? "SELL" : "NEUTRAL", status, statusReason,
          opportunityScore, rawScore,
          vetoes: execution.vetoes, scenario: { ...scenario, mode: resolution.mode, rationale: resolution.rationale },
          horizon: scenario.id,
          horizonBadge: scenario.badge,
          horizonLabel: scenario.label,
          brain,
          ranges: evaluation.bias.ranges, dealingRange: brain.dealingRange, thesisId: brain.thesisId,
          ideaId: stagedLevel?.ideaId, evidence: stagedLevel?.evidence || brain.evidence,
          targets: stagedLevel?.targets || [], confluenceBreakdown: effectiveBreakdown,
          range: { ...(brain.dealingRange || {}), h4Zone: brain.h4Zone, h4CoveragePct: brain.h4CoveragePct, remainingRunwayPct, isExhausted: brain.dealingRange?.isExhausted || false },
          stagedLevel,
          entryModel: stagedLevel ? { ...stagedLevel, id: stagedLevel.modelId, name: stagedLevel.modelName, badge: stagedLevel.modelBadge } : null,
          snapshot: frames.snapshot, activeTimeSlot,
          sessionProfile: { ...sessionProfile, isCurrentlyActive: isTradingPermittedNow(new Date(now), config, symbol).permitted },
          currentPrice,
          isWhitelisted: whitelist.has(canonical),
        });
      }
    } catch (error) {
      rankedPairs.push({
        symbol, tradeableSymbol, radarKey: `${symbol}:day:error`,
        isInMainWatchlist, isTradeable: isInMainWatchlist, permitted: false, dir: 0,
        status: isInMainWatchlist ? "BLOCKED_DATA_ERROR" : "RESTRICTED_CONTEXT_ONLY",
        statusReason: error.message, opportunityScore: 0, rawScore: 0, brain: {}, stagedLevel: null,
        vetoes: [{ code: "DATA_UNAVAILABLE", reason: error.message }], snapshot: frames?.snapshot || null,
        scenario: SCENARIOS.DAY, horizon: "day", horizonBadge: "4H-15M", horizonLabel: SCENARIOS.DAY.label,
      });
    }
  }
  const statusTier = (s) => (s === "PRIME_QUALIFIED" ? 4 : s?.startsWith("WATCHING") ? 3 : s?.startsWith("SCANNING") ? 2 : 1);
  rankedPairs.sort((a, b) =>
    Number(b.isInMainWatchlist) - Number(a.isInMainWatchlist) ||
    statusTier(b.status) - statusTier(a.status) ||
    (b.opportunityScore || 0) - (a.opportunityScore || 0) ||
    (b.rawScore || b.stagedLevel?.confluenceScore || 0) - (a.rawScore || a.stagedLevel?.confluenceScore || 0) ||
    (b.brain?.conviction || 0) - (a.brain?.conviction || 0) ||
    (b.stagedLevel?.zoneScore || 0) - (a.stagedLevel?.zoneScore || 0) ||
    (b.stagedLevel?.rr || b.stagedLevel?.targetRR || 0) - (a.stagedLevel?.rr || a.stagedLevel?.targetRR || 0) ||
    a.symbol.localeCompare(b.symbol) ||
    ((a.scenario?.horizonCode || 0) - (b.scenario?.horizonCode || 0))
  );
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
  let evaluation = null;
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

    const isFilledOrActive = Boolean(trade.filledAt || ["active", "managing", "closing"].includes(trade.status));

    // 1. Structural stop breach before fill (only for pre-fill resting limit orders)
    if (!isFilledOrActive && current != null && sl != null && (trade.dir === 1 ? current <= sl : current >= sl)) {
      vetoes.push({ code: "STRUCTURE_INVALIDATED", reason: "Structural invalidation has already traded before entry fill." });
    }
    // 2. Full target already achieved before limit retracement (only for pre-fill resting limit orders)
    if (!isFilledOrActive && current != null && tp != null && (trade.dir === 1 ? current >= tp : current <= tp)) {
      vetoes.push({ code: "TARGET_ALREADY_HIT", reason: "Target has already traded prior to limit entry fill." });
    }

    const beforeBrain = trade.brain || trade.snapshot?.brain || {};
    const targetScenario = trade.scenario || (trade.horizon === "swing" ? SCENARIOS.SWING : trade.horizon === "scalp" ? SCENARIOS.SCALP : SCENARIOS.DAY);
    evaluation = evaluateSymbol(symbol, frames, gathered, { ...cfg, priorState: beforeBrain }, nowMs, targetScenario);
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
    const fresh = evaluation.stagedLevel;
    const dolConsumed = dol && brain.targetDOL && (
      brain.targetDOL.consumed === true ||
      ["swept", "consumed", "broken"].includes(String(brain.targetDOL.state || "").toLowerCase())
    );
    if (dolConsumed) {
      // Target Progression: if original DOL was consumed favorably and fresh setup establishes next target in same direction, do not veto
      const hasNextValidSetup = fresh && fresh.dir === trade.dir && (fresh.targetRR >= (cfg.minRR || 1.8) || fresh.confluenceScore >= 60);
      const dirAligned = (trade.dir === 1 ? (macroDir >= 0) : (macroDir <= 0));
      if (!hasNextValidSetup || !dirAligned) {
        vetoes.push({ code: "DOL_CHANGED", reason: "Original draw on liquidity was consumed and no active forward target runway remains." });
      }
    }

    // 6. Retain candidate identity and score without demanding a new synthetic bar trigger
    const originalConfluence = Number(original.confluenceScore || trade.confluenceScore || original.opportunityScore || 70);
    const confluenceScore = (fresh && fresh.dir === trade.dir) ? (fresh.confluenceScore || originalConfluence) : originalConfluence;
    const candidate = {
      ...original,
      modelId: trade.modelId || original.modelId || trade.entryModel?.id || original.id || "fvg_retest",
      tf: original.tf || trade.tf || "M15",
      targets: trade.targets || original.targets,
      confluenceScore,
      isExistingTrade: true,
    };

    const gate = evaluateExecutionVetoes({
      symbol,
      dir: trade.dir,
      entry,
      sl,
      brain,
      frames,
      config: { ...cfg, scenario: evaluation.resolution.scenario, candidate, isExistingTrade: true, skipLimitGeometryCheck: true },
      now,
    });
    vetoes.push(...gate.vetoes);
  } catch (error) {
    vetoes.push({ code: "REVALIDATION_UNAVAILABLE", reason: `Fresh thesis validation failed: ${error.message}` });
  }
  return { permitted: vetoes.length === 0, vetoes: vetoes.filter((v, i, all) => all.findIndex(x => x.code === v.code) === i), brain, freshLevel: evaluation?.stagedLevel, evaluation };
}

function liveDolMatch(before, after) {
  if (!before || !after) return true;
  return after.consumed !== true && !["swept", "consumed", "broken"].includes(String(after.state || "").toLowerCase());
}

