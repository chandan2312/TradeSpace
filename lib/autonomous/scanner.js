// Dynamic Universe Scanner & Opportunity Ranking Engine
// Evaluates pairs through the Master Market Bias Brain, Dealing Ranges, and Confluence Levels.
// STRICT ENFORCEMENT: Order entries and prime setups are restricted ONLY to Main Watchlist symbols.
// Non-watchlist symbols are analyzed purely for intermarket correlation, risk sentiment, and SMT.

import { getFrames } from "../bias/data.js";
import { computeSymbolBias } from "../bias/engine.js";
import { resolveScenarioForPair } from "./scenarios.js";
import { selectOptimalEntryLevel } from "./levels.js";
import {
  getMainWatchlistSymbols,
  isSymbolInMainWatchlist,
  getBrokerWatchlistSymbol,
} from "./watchlist.js";
import {
  isTradingPermittedNow,
  getCurrentTimeSlot,
  getSymbolSessionProfile,
} from "./timeslots.js";

/**
 * Scans the configured universe and dynamically classifies/ranks all opportunities.
 * @param {Object} config - autonomous configuration
 * @param {string[]|null} preloadedWatchlist - optional pre-fetched watchlist symbols
 */
export async function scanUniverse(config, preloadedWatchlist = null) {
  const mainWatchlistSymbols = preloadedWatchlist || (await getMainWatchlistSymbols());
  const universe = config.universe || [];
  const blacklist = new Set(config.blacklist || []);
  const whitelist = new Set(config.whitelist || []);

  // Union of main watchlist symbols + broader market context universe
  const symbolsToScan = Array.from(
    new Set([...mainWatchlistSymbols, ...universe])
  ).filter((s) => !blacklist.has(s));

  const activeTimeSlot = getCurrentTimeSlot();
  const timeSlotCheck = isTradingPermittedNow(new Date(), config);
  const results = [];

  for (const sym of symbolsToScan) {
    try {
      const frames = await getFrames(sym);
      if (!frames.M15 || !frames.H1) continue;

      const bias = computeSymbolBias(sym, frames, {});
      const brain = bias.brain || {};
      const ranges = bias.ranges || {};
      const htfFvg = bias.htfFvg || {};
      const htfLiq = bias.htfLiquidity || {};

      // Check if symbol belongs to user's Main Watchlist
      const isInMainWatchlist = isSymbolInMainWatchlist(sym, mainWatchlistSymbols);
      const tradeableSymbol = isInMainWatchlist
        ? getBrokerWatchlistSymbol(sym, mainWatchlistSymbols)
        : sym;

      // 1. Resolve Scenario (Intraday vs Swing) dynamically
      const scenarioRes = resolveScenarioForPair({
        symbol: sym,
        brain,
        ranges,
        config,
      });
      const scenario = scenarioRes.scenario;

      // 2. Determine directional candidate
      let dir = 0;
      if (brain.allowedToLong) dir = 1;
      else if (brain.allowedToShort) dir = -1;
      else if (brain.action === "WAIT_FOR_15M_TRIGGER" || brain.action === "WAIT_FOR_15M_PULLBACK") {
        if (brain.dayTraderContext?.macroCompass === "BULLISH") dir = 1;
        else if (brain.dayTraderContext?.macroCompass === "BEARISH") dir = -1;
      }

      // 3. Evaluate Range Coverage & Directional Exhaustion
      const h4R = ranges?.ranges?.H4;
      const isExhaustedHigh = h4R && h4R.coveragePct >= 85;
      const isExhaustedLow = h4R && h4R.coveragePct <= 15;
      let remainingRunwayPct = 50;
      if (h4R) {
        remainingRunwayPct = dir === 1 ? Math.max(0, 100 - h4R.coveragePct) : Math.max(0, h4R.coveragePct);
      }

      // 4. Select Optimal Entry Level & Verify R:R across 5 Institutional Entry Models
      let stagedLevel = null;
      if (dir !== 0) {
        stagedLevel = selectOptimalEntryLevel({
          symbol: sym,
          dir,
          scenario,
          frames,
          ranges,
          htfFvg,
          targetDOL: brain.targetDOL,
          config,
          brain,
        });
      }

      // 5. Dynamic Opportunity Classification
      let status = "CHOP_EQUILIBRIUM";
      let statusReason = "Market is in range equilibrium or lack of directional edge.";

      const isExhaustedForDir = (dir === 1 && isExhaustedHigh) || (dir === -1 && isExhaustedLow);

      if (!isInMainWatchlist) {
        // STRICT RULE: Symbols not in main watchlist are restricted to context/correlation only
        status = "RESTRICTED_CONTEXT_ONLY";
        statusReason = "Context & Correlation Only (Not in Main Watchlist - Entry prohibited).";
      } else if (!timeSlotCheck.permitted) {
        status = "BLOCKED_OFF_HOURS";
        statusReason = timeSlotCheck.reason;
      } else if (config.avoidExhaustion && isExhaustedForDir) {
        status = "BLOCKED_EXHAUSTED";
        statusReason = dir === 1
          ? "Blocked: Chasing Longs into Deep Premium ceiling (>=85%)."
          : "Blocked: Chasing Shorts into Deep Discount floor (<=15%).";
      } else if (brain.blockReasons?.length > 0 && !brain.allowedToLong && !brain.allowedToShort) {
        status = "BLOCKED_CONFLICT";
        statusReason = `Blocked: ${brain.blockReasons.join(" · ")}`;
      } else if (dir !== 0 && brain.conviction >= config.minConviction) {
        const symbolSlotCheck = isTradingPermittedNow(new Date(), config, sym);

        if (remainingRunwayPct < config.minRunwayPct) {
          status = "BLOCKED_RUNWAY";
          statusReason = `Insufficient runway (${Math.round(remainingRunwayPct)}% < ${config.minRunwayPct}% min).`;
        } else if (stagedLevel && stagedLevel.meetsMinRR) {
          if (brain.allowedToLong || brain.allowedToShort) {
            if (!symbolSlotCheck.permitted) {
              if (symbolSlotCheck.isOffSession) {
                status = "BLOCKED_OFF_SESSION";
                statusReason = symbolSlotCheck.reason;
              } else if (symbolSlotCheck.isDeadZone) {
                status = "BLOCKED_DEAD_ZONE";
                statusReason = symbolSlotCheck.reason;
              } else {
                status = "BLOCKED_TIME_SLOT";
                statusReason = symbolSlotCheck.reason;
              }
            } else {
              status = "PRIME_QUALIFIED";
              statusReason = "All institutional conditions met: Conviction, Gatekeeper approved, Session active, Level staged with valid R:R.";
            }
          } else {
            status = "WATCHING_RETRACE";
            statusReason = `Direction approved (${dir === 1 ? "BUY" : "SELL"}). Waiting for 15M Gatekeeper clearance / level tap.`;
          }
        } else if (stagedLevel && !stagedLevel.meetsMinRR) {
          status = "WATCHING_RR";
          statusReason = stagedLevel.rejectionReason || "Staged level does not meet minimum R:R threshold.";
        }
      }

      // 6. Calculate Overall Opportunity Score (0..100)
      let opportunityScore = 30;
      if (status === "PRIME_QUALIFIED" && isInMainWatchlist) {
        opportunityScore = Math.min(
          99,
          Math.round(
            (brain.conviction || 50) * 0.4 +
            remainingRunwayPct * 0.3 +
            (stagedLevel?.confluenceScore || 50) * 0.2 +
            (whitelist.has(sym) ? 10 : 0)
          )
        );
      } else if (status === "WATCHING_RETRACE" && isInMainWatchlist) {
        opportunityScore = Math.min(80, Math.round((brain.conviction || 50) * 0.5 + remainingRunwayPct * 0.3));
      } else if (status === "RESTRICTED_CONTEXT_ONLY") {
        opportunityScore = 20; // context only
      } else if (status.startsWith("BLOCKED")) {
        opportunityScore = 15;
      }

      results.push({
        symbol: sym,
        tradeableSymbol,
        isInMainWatchlist,
        isTradeable: isInMainWatchlist,
        dir,
        dirLabel: dir === 1 ? "BUY" : dir === -1 ? "SELL" : "NEUTRAL",
        status,
        statusReason,
        opportunityScore,
        scenario: {
          id: scenario.id,
          label: scenario.label,
          badge: scenario.badge,
          mode: scenarioRes.mode,
          rationale: scenarioRes.rationale,
        },
        brain: {
          verdict: brain.verdict,
          action: brain.action,
          conviction: brain.conviction,
          targetDOL: brain.targetDOL,
          narrative: brain.narrative,
          macroCompass: brain.dayTraderContext?.macroCompass,
          gatekeeperStatus: brain.dayTraderContext?.ltfGatekeeper?.triggerStatus,
          gatekeeperVeto: brain.dayTraderContext?.ltfGatekeeper?.vetoActive,
        },
        range: {
          h4Zone: h4R?.zone || "EQUILIBRIUM",
          h4CoveragePct: h4R?.coveragePct ?? 50,
          remainingRunwayPct: Math.round(remainingRunwayPct),
          isExhausted: isExhaustedHigh || isExhaustedLow,
        },
        stagedLevel,
        entryModel: stagedLevel ? {
          id: stagedLevel.modelId || stagedLevel.type,
          name: stagedLevel.modelName || stagedLevel.label,
          badge: stagedLevel.modelBadge || stagedLevel.type,
          rationale: stagedLevel.rationale || stagedLevel.label,
          confluenceTags: stagedLevel.confluenceTags || [],
          confluenceScore: stagedLevel.confluenceScore || 50,
          allCandidates: stagedLevel.allCandidates || [],
        } : null,
        activeTimeSlot: {
          id: activeTimeSlot.id,
          name: activeTimeSlot.name,
          shortBadge: activeTimeSlot.shortBadge,
          phase: activeTimeSlot.phase,
          isKillzone: activeTimeSlot.isKillzone,
          isSilverBullet: activeTimeSlot.isSilverBullet,
          eetRange: activeTimeSlot.eetRange,
          brokerRange: activeTimeSlot.brokerRange,
        },
        sessionProfile: {
          category: getSymbolSessionProfile(sym).category,
          label: getSymbolSessionProfile(sym).label,
          fullLabel: getSymbolSessionProfile(sym).fullLabel,
          badgeColor: getSymbolSessionProfile(sym).badgeColor,
          eetHoursLabel: getSymbolSessionProfile(sym).eetHoursLabel,
          isCurrentlyActive: isTradingPermittedNow(new Date(), config, sym).permitted,
        },
        currentPrice: frames.M15[frames.M15.length - 1].close,
        isWhitelisted: whitelist.has(sym),
      });
    } catch (err) {
      console.warn(`[autonomous scan failed for ${sym}]`, err.message);
    }
  }

  // Sort: Main Watchlist pairs first, then by opportunity score descending
  results.sort((a, b) => {
    if (a.isInMainWatchlist !== b.isInMainWatchlist) {
      return a.isInMainWatchlist ? -1 : 1;
    }
    return b.opportunityScore - a.opportunityScore;
  });

  // PRIME SETUPS STRICTLY FILTERED: Only symbols in the user's Main Watchlist!
  const primeSetups = results.filter((r) => r.status === "PRIME_QUALIFIED" && r.isTradeable);
  const watchingSetups = results.filter((r) => r.status === "WATCHING_RETRACE" && r.isTradeable);
  const blockedSetups = results.filter((r) => r.status.startsWith("BLOCKED") && r.isTradeable);
  const contextOnlySetups = results.filter((r) => !r.isTradeable);

  return {
    scannedAt: new Date(),
    activeTimeSlot,
    timeSlotPermitted: timeSlotCheck.permitted,
    timeSlotReason: timeSlotCheck.reason,
    totalScanned: results.length,
    mainWatchlistCount: results.filter((r) => r.isInMainWatchlist).length,
    contextOnlyCount: contextOnlySetups.length,
    mainWatchlistSymbols,
    rankedPairs: results,
    primeCount: primeSetups.length,
    watchingCount: watchingSetups.length,
    blockedCount: blockedSetups.length,
    primeSetups, // STRICTLY contains only Main Watchlist symbols!
  };
}
