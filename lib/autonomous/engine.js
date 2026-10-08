// Durable broker operations are claimed before dispatch. Ticks never retry a write.
import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { broadcast } from "../realtime.js";
import { sendTelegram } from "../telegram.js";
import { getFrames } from "../bias/data.js";
import { bridge } from "../bridge.js";
import * as store from "./store.js";
import * as scanner from "./scanner.js";
import * as broker from "./mt5.js";
import { getMainWatchlistSymbols, isSymbolInMainWatchlist } from "./watchlist.js";
import { isTradingPermittedNow, getStartOfTradingDay } from "./timeslots.js";
import { calculateRiskSize, dailyRiskGovernor, planPartialVolumes, calculateEffectiveGroupRisk, calculatePartitionedDailyPnl, calculatePartitionedDailyR } from "./risk.js";
import {
  entryQuote,
  exitQuote,
  initialTradeRisk,
  markToMarket,
  partialExitLedger,
  breakevenPrice,
  confirmedTrailPrice,
  validateTargetLadder,
  calculateOptimalRiskFreeLevel,
  calculateRiskFreeStop,
  evaluatePropFirmSafeAction,
  calculatePropFirmTp,
  resolveDynamicPropFirmTarget,
  resolveCascadingDefaultTarget,
  planFractionalVolumes,
  determineTerminalStatus,
  calculateHalfTargetLevel,
} from "./management.js";
import { resolveCopierRouting } from "./magicEncoder.js";
import { calculateSpreadFriction, extractSpreadPrice, isSpreadAcceptable } from "./friction.js";
import { evaluateMilestoneRedecision } from "./redecision.js";
import { validatePreEntrySetup } from "./preEntryValidation.js";
import { canonOf } from "./symbols.js";

const g = globalThis;
const oid = (id) => (ObjectId.isValid(id) && String(new ObjectId(id)) === String(id)) ? new ObjectId(id) : id;
const event = (type, note, now) => ({ type, note, time: new Date(now) });
const toMs = (v) => {
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (v && typeof v.getTime === "function") return v.getTime();
  return Number(v) || Date.now();
};

export function getSetupFingerprint(symbol, dir, level, modelId = null, tf = null) {
  if (!symbol || !level) return null;
  const quantize = (price) => Number(price) ? (Math.round(Number(price) * 1000) / 1000).toFixed(3) : "0";
  return `${symbol.toUpperCase()}:${dir}:${(tf || level.tf || "15M").toUpperCase()}:${modelId || level.modelId || level.type || "DEFAULT"}:${quantize(level.entry)}:${quantize(level.sl)}:${quantize(level.tp)}`;
}
export async function getExhaustedTodayFingerprints(tradesCol, todayStart) {
  const trades = await tradesCol.find({
    status: { $in: ["closed_tp", "closed_sl", "closed_be"] },
    fingerprint: { $exists: true, $ne: null },
    $or: [{ closedAt: { $gte: new Date(todayStart) } }, { updatedAt: { $gte: new Date(todayStart) } }],
  }).toArray();
  return new Set(trades.map((t) => t.fingerprint));
}

export function sanitizeScannedPair(pair) {
  if (!pair) return pair;
  const { snapshot, brain, ranges, primeSetups, stagedLevel, entryModel, ...rest } = pair;
  const leanBrain = brain ? {
    conviction: brain.conviction,
    bias: brain.bias,
    biasLabel: brain.biasLabel,
    htfLiquidity: brain.htfLiquidity ? {
      drawOnLiquidity: brain.htfLiquidity.drawOnLiquidity,
    } : null,
    targetDOL: brain.targetDOL,
    dealingRange: pair.dealingRange || brain.dealingRange || null,
    summary: brain.summary,
    verdict: brain.verdict,
    narrative: brain.narrative,
    action: brain.action,
  } : null;

  let leanStagedLevel = null;
  if (stagedLevel) {
    const { allCandidates, candidateDetails, ...stagedRest } = stagedLevel;
    leanStagedLevel = stagedRest;
  }

  let leanEntryModel = null;
  if (entryModel) {
    const { allCandidates, candidateDetails, ...modelRest } = entryModel;
    leanEntryModel = modelRest;
  }

  return {
    ...rest,
    stagedLevel: leanStagedLevel,
    entryModel: leanEntryModel,
    brain: leanBrain,
  };
}

// Ports make database, time, quotes, context and broker writes testable offline.
export function createAutonomousEngine(overrides = {}) {
  const p = { ...store, ...broker, bridge, getFrames, scanUniverse: (...args) => scanner.scanUniverse(...args), revalidateTradeIdea: (...args) => scanner.revalidateTradeIdea(...args), validatePreEntrySetup: (...args) => validatePreEntrySetup(...args), getMainWatchlistSymbols, isTradingPermittedNow, getStartOfTradingDay, broadcast, sendTelegram, now: Date.now, id: randomUUID, ...overrides };
  let pendingTicks = {}, tickRun = null, scanRun = false, brokerRead = null, snapshot = null, snapshotAt = 0;
  let work = Promise.resolve();
  let pendingTasks = 0;
  const serialize = (fn) => {
    pendingTasks++;
    const next = work.then(fn);
    work = next.catch(() => {}).finally(() => {
      pendingTasks--;
      if (pendingTasks === 0) work = Promise.resolve();
    });
    return next;
  };
  const validationCache = new Map(), microCache = new Map(), specCache = new Map();
  const changed = () => p.broadcast({ type: "autonomous_changed" });
  const notifyDedup = new Map();
  const notify = (cfg, text, dedupKey = null) => {
    if (!cfg?.telegram || !text) return;
    const key = dedupKey || text;
    const now = p.now();
    const lastSent = notifyDedup.get(key);
    if (lastSent && now - lastSent < 30_000) return; // 30s sibling & repeat deduplication
    notifyDedup.set(key, now);
    if (notifyDedup.size > 200) {
      for (const [k, t] of notifyDedup.entries()) {
        if (now - t > 60_000) notifyDedup.delete(k);
      }
    }
    p.sendTelegram(text).catch(() => {});
  };
  const cols = () => p.autonomousCols();

  let cachedOpen = null;
  let lastOpenTime = 0;
  const OPEN_CACHE_TTL = 2500; // 2.5s hot cache prevents 500ms Atlas query barrage

  const invalidateOpenCache = () => {
    cachedOpen = null;
    lastOpenTime = 0;
  };

  const findOpen = async (forceRefresh = false) => {
    const now = p.now();
    if (!forceRefresh && cachedOpen && (now - lastOpenTime < OPEN_CACHE_TTL)) {
      return cachedOpen;
    }
    const { tradesCol } = await cols();
    cachedOpen = await tradesCol.find({ status: { $in: store.OPEN_STATES } }).toArray();
    lastOpenTime = now;
    return cachedOpen;
  };
  const liveIntent = (trade, cfg) => Boolean(trade.isLive || cfg.liveTrading);
  const strategyConfig = (cfg) => ({
    ...cfg,
    getFrames: (symbol, options) => p.getFrames(symbol, {
      ...options,
      forceRefresh: true,
      timestampSemantics: cfg.timestampSemantics || "BROKER_NAIVE",
      fetchRates: async (sym, timeframe, count) => {
        try {
          const res = await p.autonomousBridge("POST", "/rates", { sym, timeframe, count }, { timeoutMs: 20000 });
          if (res?.ok && res.bars?.length) return res;
        } catch {}
        return p.bridge("POST", "/rates", { sym, timeframe, count }, { timeoutMs: 20000 });
      }
    })
  });

  async function update(trade, fields, note) {
    invalidateOpenCache();
    const { tradesCol } = await cols();
    const result = await tradesCol.updateOne({ _id: trade._id, status: trade.status }, { $set: { ...fields, updatedAt: new Date(p.now()) }, ...(note ? { $push: { events: note } } : {}) });
    if (result.modifiedCount) {
      Object.assign(trade, fields);
      if (note || Object.keys(fields).some((key) => !["currentPrice", "unrealizedR", "unrealizedPnl", "idealR", "actualR", "actualPnl", "floatingR", "priceR", "brokerVolume", "ticket"].includes(key))) changed();
      if (note) await p.logEvent(note.type, `${trade.symbol}: ${note.note}`, { tradeId: String(trade._id), symbol: trade.symbol });
    }
    return result.modifiedCount > 0;
  }
  async function terminal(trade, status, reason, extra = {}) {
    const risk = initialTradeRisk(trade);
    const exitPrice = extra.exitPrice || trade.exitPrice || trade.currentPrice || (status === "closed_tp" ? trade.tpPrice : trade.slPrice);
    const idealR = extra.idealR !== undefined
      ? extra.idealR
      : (risk.distance > 0 && exitPrice !== null
        ? Number(((trade.dir * (Number(exitPrice) - risk.entry)) / risk.distance).toFixed(2))
        : null);
    const actualR = extra.actualR !== undefined
      ? extra.actualR
      : (typeof extra.realizedR === "number"
        ? extra.realizedR
        : (typeof trade.realizedR === "number" ? trade.realizedR : idealR));
    const ok = await update(trade, { ...extra, idealR, actualR, status, closedAt: new Date(p.now()), closeReason: reason, operation: null }, event(status.toUpperCase(), reason, p.now()));
    if (ok) {
      invalidateOpenCache();
      p.invalidateMetricsCache?.();
      await p.releaseTradeCapacity(trade._id);
      const cfg = await p.getConfig();
      const r = typeof actualR === "number" ? actualR : typeof extra.realizedR === "number" ? extra.realizedR : typeof trade.realizedR === "number" ? trade.realizedR : null;
      const rText = r !== null ? `${r >= 0 ? "+" : ""}${r.toFixed(2)}R` : "";
      const pxText = exitPrice ? `@ ${exitPrice}` : "";

      let msg = null;
      if (status === "closed_tp") {
        msg = [`🏆 <b>${trade.symbol}</b>`, "TP HIT", pxText, rText].filter(Boolean).join(" | ");
      } else if (status === "closed_sl") {
        msg = [`🛑 <b>${trade.symbol}</b>`, "SL HIT", pxText, rText || (trade.isBreakeven ? "0.00R" : "-1.00R")].filter(Boolean).join(" | ");
      } else if (status === "closed_be") {
        msg = [`🛡 <b>${trade.symbol}</b>`, "BE EXIT", pxText, rText || "0.00R"].filter(Boolean).join(" | ");
      } else if (status === "cancelled" || status === "invalidated") {
        msg = [`⚠️ <b>${trade.symbol}</b>`, `${status.toUpperCase()}: ${reason}`, pxText, rText].filter(Boolean).join(" | ");
      }
      if (msg) {
        notify(cfg, msg, `${trade.groupId || trade.symbol}:EXIT`);
      }
    }
  }

  function getStagedMaxAgeMs(trade, cfg = {}) {
    const horizon = String(trade.horizon || trade.scenario?.id || (trade.horizonCode === 1 ? "swing" : trade.horizonCode === 3 ? "scalp" : "day")).toLowerCase();
    if (horizon === "swing") {
      return (cfg.swingStagedExpiryHours ?? 120) * 3600_000; // 5 days for swing
    }
    if (horizon === "scalp") {
      return (cfg.scalpStagedExpiryHours ?? 6) * 3600_000; // 6 hours for scalp
    }
    return (cfg.dayStagedExpiryHours ?? 24) * 3600_000; // 24 hours for day trade
  }

  async function refreshBrokerState(force = false) {
    if (brokerRead) return brokerRead;
    const cfg = await p.getConfig();
    if (!force && snapshot && p.now() - snapshotAt < cfg.brokerPollMs) return snapshot;
    brokerRead = (async () => {
      let state = await p.getMT5State({ days: 7 });
      if (!state?.ok) {
        const acc = await p.getMT5Account().catch(() => null);
        if (acc?.ok && acc.account) {
          const [posRes, ordRes] = await Promise.all([
            p.getMT5Positions().catch(() => ({ positions: [] })),
            p.getMT5Orders().catch(() => ({ orders: [] })),
          ]);
          state = {
            ok: true,
            account: acc.account,
            positions: Array.isArray(posRes?.positions) ? posRes.positions : [],
            orders: Array.isArray(ordRes?.orders) ? ordRes.orders : [],
            history: [],
            order_history: [],
            requests: [],
            dailyPnl: Number(acc.account.profit || 0),
            dayStartEquity: Number(acc.account.balance),
            brokerDayStart: Math.floor(toMs(p.getStartOfTradingDay(new Date(p.now()))) / 1000),
            at: Math.floor(p.now() / 1000),
          };
        }
      }
      if (state?.ok) { snapshot = state; snapshotAt = p.now(); }
      return state?.ok ? snapshot : null;
    })();
    try { return await brokerRead; } finally { brokerRead = null; }
  }

  async function legacySpec(trade, cfg) {
    if (trade.symbolSpec) return;
    let spec = cfg.paperSymbolSpecs?.[trade.symbol] || cfg.paperSymbolSpecs?.[trade.canonicalSymbol];
    if (!spec) {
      const hit = specCache.get(trade.symbol);
      if (hit && p.now() - hit.at < 60000) spec = hit.spec;
      else {
        const result = await p.getMT5Symbol(trade.symbol);
        spec = result?.ok ? result.symbol : null;
        specCache.set(trade.symbol, { at: p.now(), spec });
      }
    }
    if (spec) await update(trade, { symbolSpec: spec });
  }

  async function guard(trade, cfg, { cached = false, sizedRisk = 0 } = {}) {
    const vetoes = [];
    let capacityRiskLimit = null;
    if (![1, -1].includes(trade.dir) || !(trade.entryPrice > 0) || !(trade.slPrice > 0) || !(trade.dir * (trade.entryPrice - (trade.initialSlPrice ?? trade.slPrice)) > 0) || !validateTargetLadder(trade)) vetoes.push({ code: "STRUCTURAL_RISK", reason: "Invalid initial stop/direction/target ladder" });
    if (!cfg.enabled) vetoes.push({ code: "MASTER_PAUSED", reason: "Autonomous master switch is paused" });
    if (trade.isLive && !cfg.liveTrading) vetoes.push({ code: "LIVE_PAUSED", reason: "Live execution switch is paused" });
    if (trade.executionMode !== cfg.executionMode) vetoes.push({ code: "MODE_CHANGED", reason: "Execution mode changed; re-stage the idea" });
    if (!(cfg.riskPerTradePct > 0)) vetoes.push({ code: "ZERO_RISK", reason: "Risk budget is zero" });
    const watchlist = await p.getMainWatchlistSymbols();
    if (![trade.symbol, trade.canonicalSymbol].some((s) => s && isSymbolInMainWatchlist(s, watchlist))) vetoes.push({ code: "WATCHLIST", reason: "Symbol removed from Main Watchlist" });
    const session = p.isTradingPermittedNow(new Date(p.now()), cfg, trade.canonicalSymbol || trade.symbol);
    if (!session.permitted) vetoes.push({ code: "SESSION", reason: session.reason });
    const key = String(trade._id), hit = validationCache.get(key);
    let context = cached && hit && p.now() - hit.at < cfg.entryValidationMs ? hit.context : null;
    if (!context) {
      try { context = await p.revalidateTradeIdea(trade, strategyConfig(cfg), new Date(p.now())); }
      catch (err) { context = { permitted: false, vetoes: [{ code: "CONTEXT_UNAVAILABLE", reason: err.message }] }; }
      validationCache.set(key, { at: p.now(), context });
    }
    if (!context.permitted) vetoes.push(...(context.vetoes?.length ? context.vetoes : [{ code: "CONTEXT", reason: "HTF thesis not permitted" }]));
    const all = await findOpen();
    const reserved = all.filter((t) => store.RESERVED_STATES.includes(t.status) && String(t._id) !== key);
    const reservedGroups = new Set();
    let reservedSetupCount = 0;
    for (const t of reserved) {
      if (t.groupId) {
        if (!reservedGroups.has(t.groupId)) {
          reservedGroups.add(t.groupId);
          if (!trade.groupId || trade.groupId !== t.groupId) {
            reservedSetupCount++;
          }
        }
      } else {
        reservedSetupCount++;
      }
    }
    const maxConcurrent = cfg.maxConcurrentTrades ?? 10;
    if (reservedSetupCount >= maxConcurrent) vetoes.push({ code: "CAPACITY", reason: "Reserved concurrent trade capacity is full" });
    const live = liveIntent(trade, cfg);
    const isPlacedOrActive = Boolean(trade.filledAt || store.ACTIVE_STATES.includes(trade.status) || (trade.status === "pending" && (trade.orderTicket || trade.ticket)));
    const freshnessBudget = Number(cfg.accountFreshnessMs) > 0 ? Number(cfg.accountFreshnessMs) : 60000;
    if (live && !isPlacedOrActive && (!snapshot || p.now() - snapshotAt > freshnessBudget)) {
      await refreshBrokerState(true);
    } else if (!snapshot) {
      await refreshBrokerState();
    }
    if (live && !isPlacedOrActive && trade.brokerAccountLogin && String(trade.brokerAccountLogin) !== String(snapshot?.account?.login)) vetoes.push({ code: "ACCOUNT_CHANGED", reason: "Remote broker account changed after arming" });
    if (live && !isPlacedOrActive && (!snapshot?.account || p.now() - snapshotAt > freshnessBudget)) vetoes.push({ code: "ACCOUNT_STALE", reason: "Fresh remote account equity unavailable" });
    const paperClosed = live ? [] : await (await cols()).tradesCol.find({ isLive: false, status: { $in: store.TERMINAL_STATES } }).toArray();
    const brokerEquity = Number(snapshot?.account?.equity ?? snapshot?.account?.balance);
    const baseCapital = (brokerEquity > 0)
      ? brokerEquity
      : (Number(cfg.accountSize) > 0 ? Number(cfg.accountSize) : 25000);
    const calculatedEquity = live
      ? baseCapital
      : baseCapital + [...paperClosed, ...all.filter((t) => !t.isLive)].reduce((s, t) => s + Number(t.realizedPnl || 0) + (store.ACTIVE_STATES.includes(t.status) ? Number(t.unrealizedPnl || 0) : 0), 0);
    const equity = (calculatedEquity > 0) ? calculatedEquity : (cfg.enforceDollarRiskCaps === false ? baseCapital : 0);
    if (equity > 0) {
      if (cfg.enforceDollarRiskCaps === true) {
        if (trade.initialRiskUsd > equity * cfg.riskPerTradePct / 100 + 1e-8) vetoes.push({ code: "RISK_CHANGED", reason: "Reserved position risk exceeds the current equity risk budget" });
      }
      const start = live && Number(snapshot?.brokerDayStart) > 0 ? new Date(snapshot.brokerDayStart * 1000) : p.getStartOfTradingDay(new Date(p.now()));
      const dayKey = `${live ? snapshot?.account?.login || "live" : "paper"}:${new Date(start).toISOString()}`;
      const daily = await (await cols()).tradesCol.find({ closedAt: { $gte: new Date(start) }, isLive: live }).toArray();

      if (cfg.enforceDollarRiskCaps === true) {
        let pnl;
        if (cfg.partitionedCopierRisk !== false) {
          if (live) {
            if (daily.length > 0) {
              pnl = calculatePartitionedDailyPnl(daily, start);
            } else if (Number.isFinite(snapshot?.dailyPnl)) {
              pnl = snapshot.dailyPnl / 2;
            } else {
              pnl = 0;
            }
          } else {
            const paperTrades = [...paperClosed, ...all.filter((t) => !t.isLive)];
            pnl = calculatePartitionedDailyPnl(paperTrades, start);
          }
        } else {
          const paperDayPnl = [...paperClosed, ...all.filter((t) => !t.isLive)].reduce((sum, t) => sum + (t.partialExits?.length ? t.partialExits.filter((e) => new Date(e.time).getTime() >= new Date(start).getTime()).reduce((total, e) => total + Number(e.pnl || 0), 0) : new Date(t.closedAt).getTime() >= new Date(start).getTime() ? Number(t.realizedPnl || 0) : 0), 0);
          pnl = live && Number.isFinite(snapshot?.dailyPnl) ? snapshot.dailyPnl : live ? daily.reduce((sum, t) => sum + Number(t.realizedPnl || 0), 0) : paperDayPnl;
        }

        const startEquity = await p.getDailyBaseline(dayKey, live && Number(snapshot.dayStartEquity) > 0 ? snapshot.dayStartEquity : equity - pnl);
        const relevantReserved = reserved.filter((t) => (Boolean(t.isLive) === live || (!t.isLive && liveIntent(t, cfg) === live)) && String(t._id) !== key);
        const candidateRisk = sizedRisk || equity * cfg.riskPerTradePct / 100;

        let reservedRisk;
        let risk;
        if (cfg.partitionedCopierRisk !== false) {
          const groupRiskCalc = calculateEffectiveGroupRisk(relevantReserved, { ...trade, initialRiskUsd: candidateRisk });
          reservedRisk = groupRiskCalc.reservedRisk;
          risk = groupRiskCalc.incrementalRisk;
        } else {
          reservedRisk = relevantReserved.reduce((sum, t) => sum + Number(t.initialRiskUsd || t.riskUsd || 0), 0);
          risk = candidateRisk;
        }

        const governor = dailyRiskGovernor({ startEquity, equity, realizedPnl: pnl, maxDailyLossPct: cfg.maxDailyLossPct, reservedRisk, newRisk: risk, partitioned: cfg.partitionedCopierRisk !== false });
        capacityRiskLimit = Math.max(0, governor.limit - governor.drawdown);
        if (!governor.permitted) vetoes.push({ code: "DAILY_DRAWDOWN", reason: governor.reason });
      } else {
        // Pure R-measurement architecture: Dollar caps disabled for demo sender
        capacityRiskLimit = null;
        if (Number.isFinite(cfg.maxDailyLossR) && cfg.maxDailyLossR > 0) {
          const relevantTrades = live ? daily : [...paperClosed, ...all.filter((t) => !t.isLive)];
          const dailyR = calculatePartitionedDailyR(relevantTrades, start);
          if (dailyR <= -cfg.maxDailyLossR) {
            vetoes.push({ code: "DAILY_DRAWDOWN_R", reason: `Daily loss limit of -${cfg.maxDailyLossR}R reached (current: ${dailyR.toFixed(2)}R)` });
          }
        }
      }
    } else vetoes.push({ code: "EQUITY", reason: "Equity is unavailable" });
    return { permitted: vetoes.length === 0, vetoes, equity, brain: context.brain, capacityRiskLimit };
  }

  async function size(trade, cfg, equity) {
    const live = liveIntent(trade, cfg);
    let spec = cfg.paperSymbolSpecs?.[trade.symbol] || cfg.paperSymbolSpecs?.[trade.canonicalSymbol];
    let lossPerLot;
    if (live || !spec) {
      const result = await p.getMT5Symbol(trade.symbol);
      if (!result?.ok) return { lotSize: 0, reason: result?.error || "Broker specification unavailable" };
      spec = result.symbol;
      if (!(spec.trade_tick_value_loss > 0 && spec.trade_tick_size > 0)) {
        const calc = await p.getMT5LossPerLot({ symbol: trade.symbol, dir: trade.dir, entryPrice: trade.entryPrice, slPrice: trade.initialSlPrice ?? trade.slPrice });
        if (calc?.ok) lossPerLot = calc.lossPerLot;
      }
    }
    const allowMinLotFallback = cfg?.enforceDollarRiskCaps === false || cfg?.allowMinLotFallback === true;
    const result = calculateRiskSize({
      equity,
      riskPct: cfg.riskPerTradePct,
      entryPrice: trade.entryPrice,
      slPrice: trade.initialSlPrice ?? trade.slPrice,
      symInfo: spec,
      lossPerLot,
      requirePartials: trade.requirePartials === true,
      allowMinLotFallback,
    });
    return { ...result, spec };
  }

  async function arm(trade, cfg) {
    await refreshBrokerState();
    const check = await guard(trade, cfg);
    if (!check.permitted) { await update(trade, { vetoes: check.vetoes }); return { ok: false, error: check.vetoes.map((v) => v.reason).join(" · "), vetoes: check.vetoes }; }
    let frames = null;
    if (p.getFrames) {
      frames = await p.getFrames(trade.symbol).catch(() => null);
    }
    const preEntry = await p.validatePreEntrySetup({
      trade,
      frames: frames || {},
      currentPrice: trade.currentPrice,
      config: cfg,
      now: new Date(p.now()),
    });
    if (!preEntry.ok) {
      const err = preEntry.vetoes?.[0]?.reason || "Pre-entry thesis invalidated before arming";
      await update(trade, { vetoes: preEntry.vetoes });
      return { ok: false, error: err, vetoes: preEntry.vetoes, preEntry };
    }
    const sizing = await size(trade, cfg, check.equity);
    if (!(sizing.lotSize > 0)) { await update(trade, { sizingError: sizing.reason }); return { ok: false, error: sizing.reason }; }
    if (!await p.reserveTradeCapacity(trade, { ...cfg, capacityRiskLimit: check.capacityRiskLimit }, sizing.riskUsd)) return { ok: false, error: "Concurrent/symbol/daily-risk capacity already reserved" };
    const initialRiskDistance = trade.initialRiskDistance ?? Math.abs(Number(trade.entryPrice) - Number(trade.initialSlPrice ?? trade.slPrice));
    const ok = await update(trade, { status: "armed", isLive: liveIntent(trade, cfg), lotSize: sizing.lotSize, riskUsd: sizing.riskUsd, initialSlPrice: trade.initialSlPrice ?? trade.slPrice, initialRiskDistance, initialRiskUsd: sizing.riskUsd, initialVolume: sizing.lotSize, remainingVolume: sizing.lotSize, remainingFraction: 1, partialExits: [], partialVolumes: sizing.allocations, symbolSpec: sizing.spec, brokerAccountLogin: liveIntent(trade, cfg) ? snapshot?.account?.login : null, accountCurrency: liveIntent(trade, cfg) ? snapshot?.account?.currency : sizing.spec?.account_currency || "USD", vetoes: [], expiresAt: new Date(p.now() + cfg.pendingExpiryMinutes * 60000) }, event("ARMED", "Entry thesis and risk revalidated; capacity reserved", p.now()));
    if (!ok) {
      const latest = await (await cols()).tradesCol.findOne({ _id: trade._id });
      if (latest && store.TERMINAL_STATES.includes(latest.status)) await p.releaseTradeCapacity(trade._id);
    }
    return { ok };
  }

  async function claim(trade, kind, payload, status = trade.status, explicit = false) {
    const { tradesCol } = await cols();
    const requestId = p.id();
    const operation = { kind, requestId, state: "submitted", payload, baselineVolume: trade.remainingVolume ?? trade.brokerVolume ?? trade.lotSize, createdAt: new Date(p.now()) };
    const filter = { _id: trade._id, status: trade.status, $or: [{ operation: { $exists: false } }, { operation: null }, ...(explicit ? [{ "operation.state": "failed" }, { "operation.state": "unknown" }] : [])] };
    const result = await tradesCol.updateOne(filter, { $set: { status, operation, brokerStatus: `${kind}_requested`, updatedAt: new Date(p.now()) } });
    if (!result.modifiedCount) return null;
    Object.assign(trade, { status, operation });
    changed();
    return operation;
  }
  async function resultOf(trade, res) {
    const { tradesCol } = await cols();
    const state = res?.ok ? "acknowledged" : res?.ambiguous ? "unknown" : "failed";
    const operation = { ...trade.operation, state, response: res };
    await tradesCol.updateOne({ _id: trade._id, "operation.requestId": operation.requestId }, { $set: { operation, brokerStatus: state === "unknown" ? "reconciliation_required" : state === "failed" ? "rejected" : `${operation.kind}_acknowledged`, updatedAt: new Date(p.now()) } });
    trade.operation = operation;
    changed();
  }

  async function place(trade, cfg, tick) {
    if (trade.operation) return;
    const price = entryQuote(trade.dir, tick);
    if (!price) return;
    const isResting = trade.dir === 1 ? trade.entryPrice < price : trade.entryPrice > price;
    if (liveIntent(trade, cfg)) await refreshBrokerState();
    const check = await guard(trade, cfg, { cached: true });
    if (!check.permitted) {
      const isTransientVeto = check.vetoes.every((v) =>
        ["SESSION", "TIMING", "DEAD_ZONE", "MASTER_PAUSED", "LIVE_PAUSED", "ACCOUNT_STALE", "ACCOUNT_CHANGED", "CAPACITY", "ZERO_RISK"].includes(v.code)
      );
      if (!isTransientVeto) {
        await terminal(trade, "invalidated", check.vetoes.map((v) => v.reason).join(" · "), { vetoes: check.vetoes });
      }
      return;
    }
    let frames = null;
    if (p.getFrames) {
      frames = await p.getFrames(trade.symbol).catch(() => null);
    }
    const preEntry = await p.validatePreEntrySetup({
      trade,
      frames: frames || {},
      currentPrice: price,
      config: cfg,
      now: new Date(p.now()),
    });
    if (!preEntry.ok) {
      const isTransientPreEntry = preEntry.vetoes?.every((v) =>
        ["DEAD_ZONE_RESTRICTION", "TIME_SLOT_UNAVAILABLE", "ADVERSE_FREIGHT_TRAIN"].includes(v.code)
      );
      if (isTransientPreEntry) {
        return;
      }
      const err = preEntry.vetoes?.[0]?.reason || "Pre-entry thesis invalidated before order placement";
      await terminal(trade, "invalidated", err, { vetoes: preEntry.vetoes, preEntry });
      return;
    }
    if (liveIntent(trade, cfg)) {
      const sizing = await size(trade, cfg, check.equity);
      if (!(sizing.lotSize > 0)) { await terminal(trade, "invalidated", sizing.reason); return; }
      if (!await p.reserveTradeCapacity(trade, { ...cfg, capacityRiskLimit: check.capacityRiskLimit }, sizing.riskUsd)) return;
      const routing = resolveCopierRouting(trade, cfg.copierProfiles);
      const computedMagic = trade.magicNumber || routing.magicNumber;
      const computedComment = (trade.brokerComment || routing.comment || `TS:${String(trade._id)}`).slice(0, 31);
      if (!await update(trade, { isLive: true, lotSize: sizing.lotSize, initialVolume: sizing.lotSize, remainingVolume: sizing.lotSize, initialRiskUsd: sizing.riskUsd, riskUsd: sizing.riskUsd, partialVolumes: sizing.allocations, symbolSpec: sizing.spec, brokerComment: computedComment, magicNumber: computedMagic, eligibleAccounts: routing.eligibleAccounts, copierRouting: routing })) return;
      const orderType = isResting ? "limit" : "market";
      const brokerSl = trade.brokerLevels?.sl || trade.initialSlPrice || trade.slPrice;
      const brokerTp = trade.brokerLevels?.tp || trade.targets?.at(-1)?.price || trade.tpPrice;
      const brokerEntry = isResting ? (trade.brokerLevels?.entry || trade.entryPrice) : price;
      const payload = { symbol: trade.symbol, action: trade.dir === 1 ? "buy" : "sell", volume: trade.lotSize, sl: brokerSl, tp: brokerTp, entryPrice: brokerEntry, orderType, expiresAt: trade.expiresAt, comment: computedComment, magic: computedMagic, accountLogin: trade.brokerAccountLogin };
      const op = await claim(trade, "place", payload, "placing");
      if (!op) return;
      let res = await p.executeMT5Order({ ...payload, requestId: op.requestId });
      if (!res.ok && String(res.error || res.message || "").toLowerCase().includes("invalid expiration")) {
        res = await p.executeMT5Order({ ...payload, expiresAt: undefined, requestId: p.id() });
      }
      await resultOf(trade, res);
      if (res.ok && res.status === "order-filled") {
        await confirmFill(trade, res.price || price, res.volume || sizing.lotSize, { ticket: res.dealTicket || res.ticket, positionId: res.positionId });
      } else if (res.ok) {
        await update(trade, { status: "pending", orderTicket: res.orderTicket || res.ticket, brokerStatus: "pending_limit" });
      } else if (!res.ambiguous) {
        await terminal(trade, "invalidated", res.error || res.message || "Broker rejected order", { brokerStatus: "rejected" });
      }
    } else {
      if (!isResting) return;
      await update(trade, { status: "pending", brokerStatus: "paper_limit" }, event("PAPER_LIMIT", "Simulated resting limit placed", p.now()));
    }
  }

  async function cancel(trade, reason, explicit = false) {
    if (!trade.isLive) { await terminal(trade, "cancelled", reason); return { ok: true }; }
    const ticketToCancel = trade.orderTicket || trade.ticket;
    if (!ticketToCancel) {
      await terminal(trade, "cancelled", reason, { brokerStatus: "cancelled" });
      return { ok: true };
    }
    // An acknowledged placement is a settled lease for order management.
    if (trade.operation?.kind === "place" && trade.operation.state === "acknowledged") await update(trade, { operation: null });
    const op = await claim(trade, "cancel", { orderTicket: ticketToCancel, reason }, "cancelling", explicit);
    if (!op && !explicit) return { ok: false, pending: true, error: "Broker operation awaiting reconciliation" };
    const res = await p.cancelMT5Order({ orderTicket: ticketToCancel, requestId: op?.requestId || p.id(), accountLogin: trade.brokerAccountLogin });
    if (op) await resultOf(trade, res);
    const errMsg = String(res?.error || res?.message || "").toLowerCase();
    const isOrderNotFound = errMsg.includes("order not found") || errMsg.includes("not found") || errMsg.includes("invalid ticket") || errMsg.includes("unknown order") || errMsg.includes("10013") || errMsg.includes("404");
    // /cancel success proves removal, and order not found on broker confirms order is already dead.
    if ((res.ok && res.status === "cancelled") || isOrderNotFound) {
      await terminal(trade, "cancelled", isOrderNotFound ? "Order confirmed removed from broker" : reason, { brokerStatus: "cancelled" });
      return { ok: true };
    }
    return { ...res, pending: !res.ok };
  }

  async function confirmFill(trade, filledPrice, volume, extra = {}) {
    if (!(filledPrice > 0 && volume > 0)) return false;
    const initialSlPrice = trade.initialSlPrice ?? trade.slPrice;
    const distance = Math.abs(filledPrice - initialSlPrice);
    const monetaryRisk = trade.initialRiskUsd * distance / trade.initialRiskDistance * volume / trade.initialVolume;
    const partialVolumes = trade.targets?.length === 3 ? planPartialVolumes(volume, trade.symbolSpec) : null;
    const fractionalVolumes = planFractionalVolumes(volume, trade.symbolSpec);
    const ok = await update(trade, { ...extra, status: "active", filledAt: new Date(p.now()), filledPrice, initialSlPrice, initialRiskDistance: distance, initialRiskUsd: monetaryRisk, initialVolume: volume, remainingVolume: volume, remainingFraction: 1, brokerVolume: volume, lotSize: volume, partialVolumes, fractionalVolumes, entryVetoPending: false, vetoes: [], fillAllocationInvalid: trade.targets?.length === 3 && !partialVolumes, fillRiskInvalid: !(trade.dir * (filledPrice - initialSlPrice) > 0), operation: null, brokerStatus: trade.isLive ? "position_confirmed" : "paper_filled" }, event("FILLED", `Confirmed fill @ ${filledPrice} · ${volume} volume`, p.now()));
    if (ok) {
      const cfg = await p.getConfig();
      const dir = trade.dir === 1 ? "BUY" : "SELL";
      const targetRR = trade.targetRR ? `${Number(trade.targetRR).toFixed(2)}R` : "";
      const tpText = trade.tpPrice ? `TP ${trade.tpPrice}` : "";
      const slText = initialSlPrice ? `SL ${initialSlPrice}` : "";
      const msg = [`⚡ <b>${trade.symbol}</b>`, `${dir} @ ${filledPrice}`, slText, tpText, targetRR].filter(Boolean).join(" | ");
      notify(cfg, msg, `${trade.groupId || trade.symbol}:FILL`);
    }
    return ok;
  }

  async function exit(trade, cfg, id, price, volume, reason, explicit = false) {
    if (!trade.isLive) {
      const ledger = partialExitLedger(trade, { id, price, volume, time: new Date(p.now()) });
      if (!ledger) return { ok: false, error: "Invalid partial quantity" };
      await update(trade, { ...ledger, status: ledger.remainingVolume > 0 ? "managing" : trade.status, ...(id === "tp1" || id === "tp1_fraction" ? { tp1Done: true } : id === "tp2" ? { tp2Done: true } : {}) }, event("PARTIAL_EXIT", `${id}: ${volume} @ ${price}`, p.now()));
      if (!ledger.remainingVolume) {
        const termStatus = determineTerminalStatus(trade, ledger.realizedR, reason);
        await terminal(trade, termStatus, reason, { ...ledger, exitPrice: price });
      }
      return { ok: true };
    }
    const op = await claim(trade, "close", { id, volume, reason }, volume >= trade.remainingVolume ? "closing" : trade.status, explicit);
    if (!op) return { ok: false, pending: true, error: "Position operation awaiting reconciliation" };
    const res = await p.closeMT5Position({ ticket: trade.ticket, volume, requestId: op.requestId, accountLogin: trade.brokerAccountLogin });
    await resultOf(trade, res);
    if (res?.ok && volume < trade.remainingVolume) {
      const dealTicket = res.dealTicket || res.ticket || res.order;
      const ledger = partialExitLedger(trade, { id, price, volume, dealTicket, time: new Date(p.now()) });
      if (ledger) {
        await update(trade, { ...ledger, status: "managing", operation: null, brokerStatus: "partial_confirmed", ...(id === "tp1" || id === "tp1_fraction" ? { tp1Done: true } : id === "tp2" ? { tp2Done: true } : {}) }, event("PARTIAL_EXIT", `${id}: ${volume} @ ${price} confirmed by MT5`, p.now()));
      }
    }
    return { ...res, pending: true };
  }

  async function modify(trade, sl, kind) {
    if (!(sl > 0)) return;
    if (!trade.isLive) {
      await update(trade, { slPrice: sl, status: "managing", ...(kind === "breakeven" ? { isBreakeven: true } : kind === "reduced_risk_half" ? { isHalfRisk: true, slHalfMoved: true } : { isTrailing: true }) }, event(kind.toUpperCase(), `Confirmed SL @ ${sl}`, p.now()));
    } else {
      const op = await claim(trade, "modify", { sl, kind });
      if (!op) return;
      const res = await p.modifyMT5Order({ ticket: trade.ticket, sl, tp: trade.targets?.at(-1)?.price || trade.tpPrice, requestId: op.requestId, accountLogin: trade.brokerAccountLogin });
      await resultOf(trade, res);
      if (res?.ok) {
        await update(trade, {
          slPrice: sl,
          status: "managing",
          operation: null,
          brokerStatus: "sl_modified",
          ...(kind === "breakeven" ? { isBreakeven: true } : kind === "reduced_risk_half" ? { isHalfRisk: true, slHalfMoved: true } : { isTrailing: true }),
        }, event(kind.toUpperCase(), `Confirmed MT5 SL @ ${sl}`, p.now()));
      }
    }
    const cfg = await p.getConfig();
    if (kind === "breakeven") {
      notify(cfg, `🛡 <b>${trade.symbol}</b> | BREAKEVEN @ ${sl} | Risk-Free`, `${trade.groupId || trade.symbol}:BE`);
    } else if (kind === "reduced_risk_half") {
      notify(cfg, `🛡 <b>${trade.symbol}</b> | RISK REDUCED 50% @ ${sl} (-0.5R remaining)`, `${trade.groupId || trade.symbol}:HALF_RISK_${sl}`);
    } else if (kind === "trailing") {
      notify(cfg, `🎯 <b>${trade.symbol}</b> | TRAIL SL @ ${sl}`, `${trade.groupId || trade.symbol}:TRAIL_${sl}`);
    }
  }

  async function reconcile(trade, cfg, state) {
    if (trade.brokerAccountLogin && String(trade.brokerAccountLogin) !== String(state.account?.login)) {
      await update(trade, { brokerStatus: "account_mismatch" });
      return;
    }
    const rec = p.reconcileBrokerSnapshot(trade, state);
    if (!rec.known) return;
    if (rec.orderTicket && !trade.orderTicket) await update(trade, { orderTicket: rec.orderTicket });
    if (!trade.filledAt && rec.pending && (rec.position || rec.entries?.length)) {
      // Finalize initial risk only once all entry deals are known. A partially
      // filled limit's remainder is cancelled, never allowed to enlarge a
      // position whose original-volume ledger has already been frozen.
      await update(trade, { status: "confirming", ticket: rec.position?.ticket || trade.ticket, positionId: rec.positionId, entryVetoPending: false, vetoes: [] });
      if (trade.operation?.kind === "place") await update(trade, { operation: null });
      if (!trade.operation) {
        const op = await claim(trade, "cancel_remainder", { orderTicket: rec.pending.ticket });
        if (op) await resultOf(trade, await p.cancelMT5Order({ orderTicket: rec.pending.ticket, requestId: op.requestId, accountLogin: trade.brokerAccountLogin }));
      }
      return;
    }
    if (rec.position && !trade.filledAt) {
      const volume = rec.entries?.reduce((sum, d) => sum + Number(d.volume), 0) || Number(rec.position.volume);
      const price = rec.entries?.length ? rec.entries.reduce((sum, d) => sum + Number(d.volume) * Number(d.price), 0) / volume : Number(rec.position.price_open);
      const openingCosts = rec.entries.reduce((sum, d) => sum + Number(d.commission || 0) + Number(d.swap || 0) + Number(d.fee || 0), 0);
      if (await confirmFill(trade, price, volume, { ticket: rec.position.ticket, positionId: rec.positionId, openingCosts })) {
        if (trade.fillRiskInvalid) await exit(trade, cfg, "risk_invalidation", 0, trade.remainingVolume, "Fill price breached initial stop loss geometry");
      }
    } else if (!trade.filledAt && rec.entries?.length) {
      const volume = rec.entries.reduce((sum, d) => sum + Number(d.volume), 0);
      const price = rec.entries.reduce((sum, d) => sum + Number(d.volume) * Number(d.price), 0) / volume;
      const openingCosts = rec.entries.reduce((sum, d) => sum + Number(d.commission || 0) + Number(d.swap || 0) + Number(d.fee || 0), 0);
      await confirmFill(trade, price, volume, { positionId: rec.positionId, ticket: rec.position?.ticket || trade.ticket, openingCosts });
    }
    if (trade.filledAt) {
      await legacySpec(trade, cfg);
      // Bootstrap legacy positions' original risk once; preserve their single target.
      const risk = initialTradeRisk(trade);
      if (!trade.initialRiskDistance) await update(trade, { initialSlPrice: risk.sl, initialRiskDistance: risk.distance, initialRiskUsd: risk.riskUsd, initialVolume: risk.volume, remainingVolume: trade.remainingVolume ?? risk.volume, remainingFraction: trade.remainingFraction ?? 1 });
      for (const deal of rec.exits || []) {
        const op = trade.operation;
        const operationResponse = op?.response || rec.request?.response;
        const requestedId = op?.kind === "close" && (!operationResponse?.dealTicket || String(operationResponse.dealTicket) === String(deal.ticket)) ? op.payload.id : null;
        const ledger = partialExitLedger(trade, { id: requestedId || "broker_exit", dealTicket: deal.ticket, price: Number(deal.price), volume: Number(deal.volume), pnl: Number(deal.profit || 0) + Number(deal.swap || 0) + Number(deal.commission || 0) + Number(deal.fee || 0), time: new Date(Number(deal.time) * 1000) });
        if (ledger) await update(trade, ledger, event("BROKER_EXIT", `${deal.volume} @ ${deal.price} confirmed by deal ${deal.ticket}`, p.now()));
      }
      if (rec.closed && trade.remainingVolume <= 1e-8) {
        const termStatus = determineTerminalStatus(trade, trade.realizedR, trade.operation?.payload?.reason || "Broker close confirmed by exit deals");
        await terminal(trade, termStatus, trade.operation?.payload?.reason || "Broker close confirmed by exit deals", { exitPrice: rec.exits.at(-1)?.price, brokerStatus: "closed_confirmed", realizedR: trade.realizedR });
        return;
      }
      const op = trade.operation;
      if (op?.kind === "close") {
        const closedVolume = (op.baselineVolume || 0) - trade.remainingVolume;
        if (closedVolume >= op.payload.volume - 1e-8 && closedVolume > 0 && rec.position && Math.abs(Number(rec.position.volume) - trade.remainingVolume) < 1e-8) {
          await update(trade, { status: "managing", operation: null, brokerStatus: "partial_confirmed", ...(op.payload.id === "tp1" || op.payload.id === "tp1_fraction" ? { tp1Done: true } : op.payload.id === "tp2" ? { tp2Done: true } : {}) });
        }
      } else if (op?.kind === "cancel_remainder" && !rec.pending && op.state !== "failed") {
        await update(trade, { operation: null, brokerStatus: "remainder_cancelled" });
      } else if (op?.kind === "modify" && op.state !== "failed" && rec.position) {
        const point = Number(trade.symbolSpec?.point) || Math.pow(10, -(Number(trade.symbolSpec?.digits) || 5));
        if (Math.abs(Number(rec.position.sl) - op.payload.sl) <= point * 1.5) {
          await update(trade, { slPrice: Number(rec.position.sl), status: "managing", operation: null, brokerStatus: "sl_confirmed", ...(op.payload.kind === "breakeven" ? { isBreakeven: true } : op.payload.kind === "reduced_risk_half" ? { isHalfRisk: true, slHalfMoved: true } : op.payload.kind === "risk_free" ? { isRiskFree: true } : { isTrailing: true }) });
        }
      }
      if (rec.position) await update(trade, { ticket: rec.position.ticket, brokerVolume: Number(rec.position.volume) });
    } else if (!trade.filledAt) {
      if (!rec.pending && rec.orderHistory && [2, 5, 6].includes(Number(rec.orderHistory.state))) {
        await terminal(trade, Number(rec.orderHistory.state) === 6 ? "expired" : "cancelled", "Broker pending order terminal state confirmed", { brokerStatus: "order_terminal_confirmed" });
      } else if (["cancelling", "reconciling"].includes(trade.status) && !rec.pending && !rec.position && !rec.entries?.length) {
        // Pending order was requested to cancel and broker state confirms order is absent from open orders and no position was opened
        await terminal(trade, "cancelled", trade.operation?.payload?.reason || trade.closeReason || "Broker confirmed pending order removal during reconciliation", { brokerStatus: "cancelled" });
      } else if (["cancelling", "reconciling"].includes(trade.status) && rec.pending) {
        // Pending order cancel was requested, but MT5 snapshot confirms the limit order is still resting on broker.
        // Retry cancellation immediately to prevent orphaned risk.
        const ticketToCancel = rec.pending.ticket || trade.orderTicket || trade.ticket;
        const op = trade.operation?.kind === "cancel" ? trade.operation : await claim(trade, "cancel", { orderTicket: ticketToCancel, reason: trade.closeReason || "Reconciliation pending cancel retry" }, "cancelling");
        const res = await p.cancelMT5Order({ orderTicket: ticketToCancel, requestId: op?.requestId || p.id(), accountLogin: trade.brokerAccountLogin });
        if (op) await resultOf(trade, res);
        const errMsg = String(res?.error || res?.message || "").toLowerCase();
        const isOrderNotFound = errMsg.includes("order not found") || errMsg.includes("not found") || errMsg.includes("invalid ticket") || errMsg.includes("unknown order") || errMsg.includes("10013") || errMsg.includes("404");
        if ((res?.ok && res?.status === "cancelled") || isOrderNotFound) {
          await terminal(trade, "cancelled", isOrderNotFound ? "Order confirmed removed from broker" : (trade.closeReason || "Broker confirmed pending order removal on retry"), { brokerStatus: "cancelled" });
        }
      } else if (trade.status === "pending" && (trade.orderTicket || trade.ticket) && !rec.pending && !rec.position && !rec.entries?.length && Array.isArray(state.orders)) {
        // Pending limit was cancelled or expired directly on broker (e.g. session end)
        await terminal(trade, "cancelled", "Pending order no longer present on broker", { brokerStatus: "order_absent" });
      } else if (rec.pending && ["placing", "reconciling"].includes(trade.status)) {
        await update(trade, { status: "pending", orderTicket: rec.pending.ticket, operation: null, brokerStatus: "pending_limit" });
      }
    }
    // Durable remote journal can conclusively report a rejected operation after timeout.
    if (trade.operation && rec.request?.state === "finished" && rec.request.response?.ok === false && !rec.request.response.ambiguous) {
      await resultOf(trade, rec.request.response);
      if (trade.operation.kind === "place") await terminal(trade, "invalidated", rec.request.response.message || "Order rejected", { brokerStatus: "rejected" });
    }
  }

  async function executeMilestoneRedecision(trade, price, beSl, cfg, tick) {
    if (trade.redecisionDone) return;
    try {
      let frames = null;
      if (p.getFrames) {
        frames = await p.getFrames(trade.symbol).catch(() => null);
      }
      const redecision = await evaluateMilestoneRedecision({
        trade,
        currentPrice: price,
        frames: frames || {},
        ticks: tick ? { [trade.symbol]: tick } : {},
      });

      if (!redecision?.ok) return;

      const patch = {
        redecisionDone: true,
        redecisionAction: redecision.action,
        redecisionScore: redecision.score,
        redecisionConfidence: redecision.confidence,
        redecisionReason: redecision.reason,
        redecisionPillars: redecision.pillars,
        redecisionHorizon: redecision.horizon,
        redecisionHorizonTag: redecision.horizonTag,
        redecisionOldTp: trade.tpPrice,
        redecisionNewTp: redecision.newTpPrice,
        redecisionOldRR: trade.targetRR,
        redecisionNewRR: redecision.newTargetRR,
        redecisionAt: new Date(p.now()),
      };

      // 1. Action: CLOSE_FULL_NOW (Emergency or structural shift exit)
      if (redecision.action === "CLOSE_FULL_NOW") {
        await update(trade, patch, event("REDECISION_CLOSE", redecision.reason, p.now()));
        notify(cfg, `🚨 <b>${trade.symbol}</b> | REDECISION [${redecision.horizonTag || "DAY"}]: CLOSE FULL @ 50% | ${redecision.reason}`, `${trade.groupId || trade.symbol}:REDECISION_CLOSE`);
        await exit(trade, cfg, "redecision_close", price, trade.remainingVolume, redecision.reason);
        return redecision;
      }

      // 2. Action: REDUCE_TP or EXPAND_TP (Target recalibration)
      if (redecision.action === "REDUCE_TP" || redecision.action === "EXPAND_TP") {
        const newTp = redecision.newTpPrice;
        const newRR = redecision.newTargetRR;
        patch.tpPrice = newTp;
        patch.targetRR = newRR;

        if (Array.isArray(trade.targets) && trade.targets.length > 0) {
          const updatedTargets = [...trade.targets];
          const lastIdx = updatedTargets.length - 1;
          updatedTargets[lastIdx] = { ...updatedTargets[lastIdx], price: newTp };
          patch.targets = updatedTargets;
        }

        if (beSl) {
          patch.slPrice = beSl;
          patch.isBreakeven = true;
        }

        await update(trade, patch, event("REDECISION_TARGET", `${redecision.action} [${redecision.horizonTag || "DAY"}]: ${newRR}R @ ${newTp} (${redecision.reason})`, p.now()));
        notify(cfg, `🎯 <b>${trade.symbol}</b> | REDECISION [${redecision.horizonTag || "DAY"}]: ${redecision.action} -> ${newRR}R @ ${newTp} | ${redecision.reason}`, `${trade.groupId || trade.symbol}:REDECISION_TARGET`);

        // Synchronize target modification AND Breakeven to MT5 broker
        if (trade.isLive && trade.ticket && store.ACTIVE_STATES.includes(trade.status)) {
          try {
            await p.modifyMT5Order({
              ticket: trade.ticket,
              sl: beSl || trade.slPrice,
              tp: newTp,
              requestId: p.id(),
              accountLogin: trade.brokerAccountLogin,
            });
          } catch (err) {
            console.error(`Failed to update MT5 TP on redecision for ${trade.symbol}:`, err.message);
          }
        }
        return redecision;
      }

      // 3. Action: HOLD_FULL_TP (Conviction hold)
      if (beSl) {
        patch.slPrice = beSl;
        patch.isBreakeven = true;
      }
      await update(trade, patch, event("REDECISION_HOLD", redecision.reason, p.now()));
      notify(cfg, `💎 <b>${trade.symbol}</b> | REDECISION [${redecision.horizonTag || "DAY"}]: HOLD FULL TP | ${redecision.reason}`, `${trade.groupId || trade.symbol}:REDECISION_HOLD`);

      // Synchronize Breakeven SL to MT5 broker on HOLD_FULL_TP
      if (trade.isLive && trade.ticket && store.ACTIVE_STATES.includes(trade.status)) {
        try {
          await p.modifyMT5Order({
            ticket: trade.ticket,
            sl: beSl || trade.slPrice,
            tp: trade.tpPrice,
            requestId: p.id(),
            accountLogin: trade.brokerAccountLogin,
          });
        } catch (err) {
          console.error(`Failed to update MT5 SL to Breakeven on HOLD_FULL_TP for ${trade.symbol}:`, err.message);
        }
      }
      return redecision;
    } catch (err) {
      console.error(`Milestone redecision failed for ${trade.symbol}:`, err);
      await update(trade, { redecisionDone: true, redecisionError: err.message });
      return null;
    }
  }

  async function manage(trade, cfg, tick) {
    const price = exitQuote(trade.dir, tick);
    if (!price) return;
    if (!trade.initialRiskDistance) {
      const risk = initialTradeRisk(trade);
      await update(trade, { initialSlPrice: risk.sl, initialRiskDistance: risk.distance, initialRiskUsd: risk.riskUsd, initialVolume: risk.volume, remainingVolume: trade.remainingVolume ?? risk.volume, remainingFraction: trade.remainingFraction ?? 1 });
    }
    const mark = markToMarket(trade, price);
    const currentPeak = Number(trade.peakPrice || price);
    const peakPrice = trade.dir === 1 ? Math.max(currentPeak, price) : Math.min(currentPeak, price);
    const peakR = Math.max(Number(trade.peakR || 0), Number(mark.idealR ?? mark.unrealizedR ?? 0));
    const currentTrough = Number(trade.troughPrice || price);
    const troughPrice = trade.dir === 1 ? Math.min(currentTrough, price) : Math.max(currentTrough, price);
    const maxDrawdownR = Math.min(Number(trade.maxDrawdownR ?? 0), Number(mark.idealR ?? mark.unrealizedR ?? 0));
    await update(trade, { currentPrice: price, peakPrice, peakR, troughPrice, maxDrawdownR, ...mark });
    if (trade.operation) return;
    if (trade.isLive && (!snapshot || p.now() - snapshotAt > cfg.accountFreshnessMs)) return;
    if (trade.isLive && trade.brokerAccountLogin && String(trade.brokerAccountLogin) !== String(snapshot?.account?.login)) { await update(trade, { brokerStatus: "account_mismatch" }); return; }
    if (trade.fillRiskInvalid) { await exit(trade, cfg, "risk_invalidation", price, trade.remainingVolume, "Fill price breached initial stop loss geometry"); return; }
    const effectiveSl = (!trade.isBreakeven && !trade.slHalfMoved && trade.brokerLevels?.sl)
      ? trade.brokerLevels.sl
      : (trade.slPrice ?? trade.initialSlPrice);
    const stop = trade.dir === 1 ? price <= effectiveSl : price >= effectiveSl;
    if (stop) { await exit(trade, cfg, "stop", price, trade.remainingVolume, "Stop price reached"); return; }
    const hit = (target) => trade.dir === 1 ? price >= target : price <= target;

    let micro = microCache.get(trade.symbol);
    if (!micro || p.now() - micro.at >= cfg.trailingPollMs) {
      const result = await p.getMT5MicroBars(trade.symbol);
      const bars = result?.ok ? result.bars?.map((b) => ({ time: b.t / 1000, open: b.o, high: b.h, low: b.l, close: b.c })) : [];
      micro = { at: p.now(), bars };
      microCache.set(trade.symbol, micro);
    }

    // =========================================================================
    // TWO OFFICIAL RISK MANAGEMENT MODELS
    // =========================================================================

    // MODEL 2: Prop-Firm Safe Mode (1.5R - 2.5R Bracket)
    if (trade.managementLogic === "prop_firm_safe") {
      const propAction = evaluatePropFirmSafeAction(trade, price, mark.unrealizedR, trade.symbolSpec);
      if (propAction) {
        if (propAction.action === "reduce_sl_half") {
          await modify(trade, propAction.newSl, "reduced_risk_half");
          await update(trade, { slHalfMoved: true });
          return;
        } else if (propAction.action === "breakeven") {
          await modify(trade, propAction.newSl, "breakeven");
          await update(trade, { isBreakeven: true });
          return;
        } else if (propAction.action === "exit_full_tp") {
          await exit(trade, cfg, "target", price, trade.remainingVolume, propAction.reason);
          return;
        }
      }

      // Trailing on Prop-Firm Safe trades once Breakeven is locked
      if (!trade.operation && trade.isBreakeven) {
        if (micro?.bars?.length >= 5) {
          const trailPrice = confirmedTrailPrice(trade, micro.bars, p.now());
          if (trailPrice != null && Number.isFinite(trailPrice)) {
            const isBetter = trade.dir === 1 ? trailPrice > trade.slPrice : trailPrice < trade.slPrice;
            const isSafeFromMarket = trade.dir === 1 ? trailPrice < price : trailPrice > price;
            const minStop = (Number(trade.symbolSpec?.trade_stops_level || 0) * Number(trade.symbolSpec?.point || 0.0001)) || 0;
            if (isBetter && isSafeFromMarket && Math.abs(price - trailPrice) >= minStop) {
              await modify(trade, trailPrice, "trailing");
            }
          }
        }
      }
    }
    // MODEL 1: Milestone 50 + Runner (Default Mode)
    else {
      // 1. At 50% target milestone -> evaluate redecision, then book 40% quantity & move SL to breakeven!
      if (!trade.halfTargetBooked && !trade.tp1Done) {
        const halfTarget = calculateHalfTargetLevel(trade);
        const reachedHalf = (halfTarget.price && hit(halfTarget.price)) || (mark.unrealizedR >= halfTarget.halfRR);
        if (reachedHalf) {
          const beSl = breakevenPrice(trade, trade.symbolSpec);

          // Evaluate Milestone Redecision Engine (AMRE) first
          if (!trade.redecisionDone) {
            const redec = await executeMilestoneRedecision(trade, price, beSl, cfg, tick);
            if (redec?.action === "CLOSE_FULL_NOW" || trade.status === "closed" || trade.status === "closing") {
              return;
            }
          }

          // Book 40% quantity on MT5 broker (or paper)
          const planned = trade.fractionalVolumes || planFractionalVolumes(trade.initialVolume, trade.symbolSpec, 0.40);
          const fracVol = planned?.tp1 ?? Number((trade.initialVolume * 0.40).toFixed(2));
          if (fracVol > 0 && fracVol < trade.remainingVolume) {
            await exit(trade, cfg, "tp1_fraction", price, fracVol, `Booked 40% at 50% target milestone (+${halfTarget.halfRR}R)`);
          }
          await update(trade, {
            halfTargetBooked: true,
            fractionalBooked: true,
            tp1Done: true,
          });

          // Ensure Breakeven is recorded and applied to MT5 if not already completed by redecision
          if (beSl && !trade.isBreakeven) {
            await modify(trade, beSl, "breakeven");
          }
          return;
        }
      }

      // If 50% target was booked but stop loss has not yet transitioned to breakeven (e.g. while partial close was in-flight on MT5)
      if (trade.halfTargetBooked && !trade.isBreakeven) {
        const beSl = breakevenPrice(trade, trade.symbolSpec);
        const isBetter = trade.dir === 1 ? beSl > trade.slPrice : beSl < trade.slPrice;
        if (beSl && isBetter) {
          await modify(trade, beSl, "breakeven");
          return;
        }
      }

      // Edge recovery: 50% was booked but redecision has not executed yet
      if (trade.halfTargetBooked && !trade.redecisionDone) {
        await executeMilestoneRedecision(trade, price, trade.slPrice, cfg, tick);
        if (trade.status === "closed" || (trade.remainingVolume ?? 0) <= 0) return;
      }

      // 2. Trailing Stop-Loss on active runner (M5 confirmed swing fractals)
      if (!trade.operation && (trade.isBreakeven || trade.halfTargetBooked || mark.unrealizedR >= (cfg.trailStopTriggerR || 2.5))) {
        if (micro?.bars?.length >= 5) {
          const trailPrice = confirmedTrailPrice(trade, micro.bars, p.now());
          if (trailPrice != null && Number.isFinite(trailPrice)) {
            const isBetter = trade.dir === 1 ? trailPrice > trade.slPrice : trailPrice < trade.slPrice;
            const isSafeFromMarket = trade.dir === 1 ? trailPrice < price : trailPrice > price;
            const minStop = (Number(trade.symbolSpec?.trade_stops_level || 0) * Number(trade.symbolSpec?.point || 0.0001)) || 0;
            const hasMinDistance = Math.abs(price - trailPrice) >= minStop;
            if (isBetter && isSafeFromMarket && hasMinDistance) {
              await modify(trade, trailPrice, "trailing");
            }
          }
        }
      }

      // 3. Full Target Exit (Target is unrestricted as per structural model/DOL)
      const targetR = Number(trade.targetRR || (trade.initialRiskDistance > 0 && trade.tpPrice ? Math.abs(trade.tpPrice - trade.entryPrice) / trade.initialRiskDistance : 5.0));
      const effectiveTpPrice = trade.tpPrice || Number((trade.entryPrice + trade.dir * (targetR * (trade.initialRiskDistance || 0))).toFixed(trade.symbolSpec?.digits || 5));

      if (hit(effectiveTpPrice) || (mark.unrealizedR >= targetR) || (trade.targets?.at(-1)?.price && hit(trade.targets.at(-1).price))) {
        await exit(trade, cfg, "runner", price, trade.remainingVolume, `Target reached at ${trade.targetRR || targetR}R`);
        return;
      }
    }
  }

  async function processTicks(ticks) {
    const cfg = await p.getConfig();
    const open = await findOpen();
    g._tsAutonomousSymbols = new Set(open.map((t) => t.symbol));
    for (const trade of open) {
      try {
        const sym = trade.symbol || "";
        const canonSym = trade.canonicalSymbol || canonOf(sym);
        const cleanSym = sym.replace(/[._-].*$/, "").toUpperCase();
        const tick = ticks[sym]
          || ticks[canonSym]
          || ticks[cleanSym]
          || ticks[sym.toLowerCase()]
          || ticks[sym.toUpperCase()]
          || ticks[canonOf(sym)]
          || ticks[canonOf(sym).toLowerCase()]
          || Object.entries(ticks).find(([k]) => canonOf(k) === canonSym || canonOf(k) === canonOf(sym))?.[1];
        if (tick && (!(entryQuote(trade.dir, tick) > 0) || !(exitQuote(trade.dir, tick) > 0) || (tick.time && p.now() - Number(tick.time) > cfg.accountFreshnessMs))) continue;
        // Already filled positions remain managed when master/session/watchlist changes.
        if (store.ACTIVE_STATES.includes(trade.status)) { if (tick) await manage(trade, cfg, tick); continue; }
        if (trade.status === "staged") {
          const isSwing = String(trade.horizon || trade.scenario?.id || (trade.horizonCode === 1 ? "swing" : "")).toLowerCase() === "swing";
          const ageMs = p.now() - new Date(trade.createdAt || trade.updatedAt).getTime();
          const maxAgeMs = getStagedMaxAgeMs(trade, cfg);
          const dayStart = toMs(p.getStartOfTradingDay(new Date(p.now())));
          const isPriorDay = new Date(trade.createdAt).getTime() < dayStart;

          // Horizon-aware time expiry: Swing trades live across multiple days (up to 5 days); Day trades expire at daily session rollover
          if (ageMs > maxAgeMs || (!isSwing && cfg.exhaustedIdeaScope !== "none" && isPriorDay)) {
            await terminal(trade, "expired", isSwing ? "Swing trade idea exceeded 5-day structural window" : "Day trade idea expired at daily session rollover");
            continue;
          }

          if (tick) {
            const stopPrice = trade.dir === 1
              ? (trade.initialSlPrice ?? trade.slPrice)
              : (trade.brokerLevels?.sl || trade.initialSlPrice || trade.slPrice);
            if (stopPrice != null && Number.isFinite(Number(stopPrice))) {
              const slHit = trade.dir === 1 ? exitQuote(trade.dir, tick) <= stopPrice : exitQuote(trade.dir, tick) >= stopPrice;
              if (slHit) {
                await terminal(trade, "invalidated", "Structural invalidation stop breached prior to entry fill");
                continue;
              }
            }
            const targetPrice = trade.tpPrice || trade.targets?.at(-1)?.price;
            if (targetPrice > 0 && Number.isFinite(Number(targetPrice))) {
              const tpHit = trade.dir === 1 ? exitQuote(trade.dir, tick) >= targetPrice : exitQuote(trade.dir, tick) <= targetPrice;
              if (tpHit) {
                await terminal(trade, "invalidated", "Target reached prior to limit entry fill (move already completed / liquidity consumed)");
                continue;
              }
            }
          }
          continue;
        }
        if (trade.expiresAt && new Date(trade.expiresAt).getTime() <= p.now()) { await cancel(trade, "Pending entry expired"); continue; }
        if (trade.status === "armed") { if (tick) await place(trade, cfg, tick); continue; }
        if (trade.status !== "pending") continue;
        const check = await guard(trade, cfg, { cached: true });
        // Only fatal structural or explicit switch vetoes revoke an active resting limit order.
        // Transient timing/equity/session vetoes must never revoke placed orders.
        const fatalVeto = check.vetoes?.find((v) =>
          ["MASTER_PAUSED", "LIVE_PAUSED", "MODE_CHANGED", "WATCHLIST", "STRUCTURAL_RISK", "TARGET_ALREADY_HIT", "STRUCTURE_INVALIDATED", "THESIS_CHANGED", "DOL_CHANGED"].includes(v.code)
        );
        if (fatalVeto) {
          await update(trade, { vetoes: check.vetoes });
          await cancel(trade, `Thesis invalidated: ${fatalVeto.reason || fatalVeto.code}`);
          continue;
        }
        if (!tick) continue;
        const price = entryQuote(trade.dir, tick);
        const stopPrice = trade.dir === 1
          ? (trade.initialSlPrice ?? trade.slPrice)
          : (trade.brokerLevels?.sl || trade.initialSlPrice || trade.slPrice);
        const invalid = trade.dir === 1
          ? exitQuote(trade.dir, tick) <= stopPrice
          : exitQuote(trade.dir, tick) >= stopPrice;
        if (invalid) { await cancel(trade, "Invalidation breached before entry"); continue; }
        const entryTriggerPrice = trade.brokerLevels?.entry || trade.entryPrice;
        if (!trade.isLive && price > 0 && (trade.dir === 1 ? price <= entryTriggerPrice : price >= entryTriggerPrice)) {
          let frames = null;
          if (p.getFrames) {
            frames = await p.getFrames(trade.symbol).catch(() => null);
          }
          const preEntry = await p.validatePreEntrySetup({
            trade,
            frames: frames || {},
            currentPrice: price,
            config: cfg,
            now: new Date(p.now()),
          });
          if (!preEntry.ok) {
            const isTransientPreEntry = preEntry.vetoes?.every((v) =>
              ["DEAD_ZONE_RESTRICTION", "TIME_SLOT_UNAVAILABLE", "ADVERSE_FREIGHT_TRAIN"].includes(v.code)
            );
            if (isTransientPreEntry) continue;
            const firstReason = preEntry.vetoes?.[0]?.reason || "Pre-entry thesis invalidated on entry tap";
            await terminal(trade, "invalidated", firstReason, { vetoes: preEntry.vetoes, preEntry });
            continue;
          }
          const fillCheck = await guard(trade, cfg, { cached: true });
          if (fillCheck.permitted) {
            await confirmFill(trade, price, trade.lotSize);
          } else {
            const isTransient = fillCheck.vetoes?.every((v) =>
              ["SESSION", "TIMING", "DEAD_ZONE", "MASTER_PAUSED", "LIVE_PAUSED", "ACCOUNT_STALE", "ACCOUNT_CHANGED", "CAPACITY", "ZERO_RISK"].includes(v.code)
            );
            if (!isTransient) {
              await terminal(trade, "invalidated", fillCheck.vetoes.map((v) => v.reason).join(" · "), { vetoes: fillCheck.vetoes });
            }
          }
        }
      } catch (err) { await p.logEvent("ENGINE_ERROR", err.message, { tradeId: String(trade._id), symbol: trade.symbol }); }
    }
  }
  function autonomousOnTicks(ticks) {
    if (!ticks || !Object.keys(ticks).length) return Promise.resolve();
    Object.assign(pendingTicks, ticks);
    if (!tickRun) {
      tickRun = (async () => { while (Object.keys(pendingTicks).length) { const batch = pendingTicks; pendingTicks = {}; await serialize(() => processTicks(batch)); } })().finally(() => { tickRun = null; });
    }
    return tickRun;
  }

  async function pollBroker() {
    const open = await findOpen();
    g._tsAutonomousSymbols = new Set(open.map((t) => t.symbol));
    const cfg = await p.getConfig();
    // Migration reads are throttled and performed on the broker cadence, never
    // once per hot tick. Legacy paper docs still use their original one target.
    await serialize(async () => {
      for (const trade of (await findOpen()).filter((t) => store.ACTIVE_STATES.includes(t.status) && !t.symbolSpec)) await legacySpec(trade, cfg);
    });
    if (!open.some((t) => t.isLive) && !cfg.liveTrading) return;
    const state = await refreshBrokerState();
    if (!state) return;
    await serialize(async () => {
      // Reload after queued tick writes; snapshots do not overwrite stale trade docs.
      const openLive = (await findOpen()).filter((t) => t.isLive);
      for (const trade of openLive) await reconcile(trade, cfg, state);

      // Sweep orphaned resting orders from broker if TradeSpace no longer tracks them as open
      if (Array.isArray(state.orders) && state.orders.length > 0) {
        const activeOrderTickets = new Set(
          openLive
            .map((t) => t.orderTicket || t.ticket)
            .filter(Boolean)
            .map(Number)
        );
        for (const bo of state.orders) {
          const boTicket = Number(bo.ticket);
          if (!boTicket || activeOrderTickets.has(boTicket)) continue;
          const isTSComment = typeof bo.comment === "string" && bo.comment.startsWith("TS:");
          const isTSMagic = String(bo.magic || "").startsWith("23") || (cfg.magicNumber && Number(bo.magic) === Number(cfg.magicNumber));
          if (isTSComment || isTSMagic) {
            console.warn(`[pollBroker] Detected orphaned TradeSpace order #${boTicket} (${bo.symbol}) on MT5. Cleaning up...`);
            await p.cancelMT5Order({
              orderTicket: boTicket,
              requestId: p.id(),
              accountLogin: state.account?.login,
            }).catch((err) => console.error(`[pollBroker] Failed to cancel orphan order #${boTicket}:`, err.message));
          }
        }
      }
    });
  }

  async function runAutonomousScan(reason = "interval") {
    if (scanRun) return { ok: false, error: "Scan already in progress" };
    scanRun = true;
    g._tsAutonomousScanning = true;
    try {
      const cfg = await p.getConfig();
      if (!cfg.enabled && reason !== "manual") return { ok: false, error: "Autonomous engine paused" };
      const watchlist = await p.getMainWatchlistSymbols();
      const scan = await p.scanUniverse(strategyConfig(cfg), watchlist);
      const sanitizedRanked = (scan.rankedPairs || []).map(sanitizeScannedPair);
      g._tsAutonomousLeaderboard = {
        ...scan,
        rankedPairs: sanitizedRanked,
        primeSetups: [],
        scannedAt: new Date(p.now()),
        summary: { total: scan.totalScanned, prime: scan.primeCount, watching: scan.watchingCount, blocked: scan.blockedCount },
      };
      const { tradesCol, controlCol } = await cols();
      if (controlCol) {
        await controlCol.updateOne(
          { _id: "latest_autonomous_scan" },
          { $set: { leaderboard: g._tsAutonomousLeaderboard, updatedAt: new Date(p.now()) } },
          { upsert: true }
        ).catch((e) => console.warn("[autonomous scan persist]", e.message));
      }

      // Staged Trade Lifecycle Sweep: revalidate and dynamically re-anchor open staged setups
      const openStaged = await tradesCol.find({ status: "staged" }).toArray();
      const dayStart = toMs(p.getStartOfTradingDay(new Date(p.now())));
      const revalCache = new Map();
      for (const t of openStaged) {
        const isSwing = String(t.horizon || t.scenario?.id || (t.horizonCode === 1 ? "swing" : "")).toLowerCase() === "swing";
        const maxAgeMs = getStagedMaxAgeMs(t, cfg);
        const ageMs = p.now() - new Date(t.createdAt || t.updatedAt).getTime();
        const isPriorDay = new Date(t.createdAt).getTime() < dayStart;

        // Horizon-aware time expiry: Swing trades live across multiple days (up to 5 days); Day trades expire at daily session rollover
        if (ageMs > maxAgeMs || (!isSwing && cfg.exhaustedIdeaScope !== "none" && isPriorDay)) {
          await terminal(t, "expired", isSwing ? "Swing trade idea exceeded 5-day structural window" : "Day trade idea expired at daily session rollover");
          continue;
        }

        // Structural revalidation check: target hit, stop breached, macro thesis inverted, or DOL consumed
        let reval = null;
        try {
          const cacheKey = `${t.symbol}_${t.dir}_${t.horizon || "day"}`;
          if (revalCache.has(cacheKey)) {
            reval = revalCache.get(cacheKey);
          } else {
            reval = await p.revalidateTradeIdea(t, strategyConfig(cfg), new Date(p.now()));
            revalCache.set(cacheKey, reval);
          }
          if (!reval?.permitted && reval?.vetoes?.some(v => ["TARGET_ALREADY_HIT", "STRUCTURE_INVALIDATED", "THESIS_CHANGED", "DOL_CHANGED"].includes(v.code))) {
            const fatal = reval.vetoes.find(v => ["TARGET_ALREADY_HIT", "STRUCTURE_INVALIDATED", "THESIS_CHANGED", "DOL_CHANGED"].includes(v.code));
            await terminal(t, "invalidated", fatal.reason || "Structural thesis invalidated before fill", { vetoes: reval.vetoes });
            continue;
          }
        } catch (_) {}

        // DYNAMIC STAGED RE-ANCHORING:
        // Update stale staged setups when fresh institutional levels are generated from evolving order flow
        const fresh = reval?.freshLevel;
        if (fresh && fresh.dir === t.dir && [fresh.entry, fresh.sl, fresh.tp].every(v => Number(v) > 0)) {
          const validGeometry = t.dir === 1 ? (fresh.entry > fresh.sl && fresh.tp > fresh.entry) : (fresh.entry < fresh.sl && fresh.tp < fresh.entry);
          const entryDiff = Math.abs(Number(t.entryPrice) - Number(fresh.entry));
          const slDiff = Math.abs(Number(t.slPrice) - Number(fresh.sl));
          const tpDiff = Math.abs(Number(t.tpPrice) - Number(fresh.tp));
          const hasChanged = entryDiff > 1e-5 || slDiff > 1e-5 || tpDiff > 1e-5;

          if (hasChanged && validGeometry) {
            const riskDist = Math.abs(fresh.entry - fresh.sl);
            if (riskDist <= 0) continue;
            const spec = cfg.paperSymbolSpecs?.[t.symbol] || cfg.paperSymbolSpecs?.[t.canonicalSymbol] || specCache.get(t.symbol)?.spec || {};
            const digits = Number(spec.digits || 5);
            const tick = pendingTicks[t.symbol] || g._tsAutonomousTicks?.[t.symbol];
            const spreadPrice = extractSpreadPrice(tick, spec);
            const freshFp = getSetupFingerprint(t.symbol, t.dir, fresh, fresh.modelId, fresh.tf);

            if (t.legId === "prop_firm") {
              const propTarget = resolveDynamicPropFirmTarget({
                entry: fresh.entry,
                sl: fresh.sl,
                dir: t.dir,
                scenario: t.scenario,
                horizon: t.horizon,
                frames: reval.evaluation?.frames || {},
                ranges: reval.evaluation?.bias?.ranges || reval.brain?.ranges,
                brain: reval.brain,
                htfFvg: reval.evaluation?.bias?.htfFvg,
                htfLiq: reval.brain?.htfLiquidity,
                evidence: fresh.evidence,
                targets: fresh.targets,
                dealingRange: fresh.dealingRange,
                targetRR: fresh.targetRR,
                digits,
              });
              const propRR = propTarget.targetRR;
              const propTp = propTarget.tpPrice;
              const frictionProp = calculateSpreadFriction({
                dir: t.dir,
                entryPrice: fresh.entry,
                slPrice: fresh.sl,
                tpPrice: propTp,
                spread: spreadPrice,
                digits,
              });

              const patch = {
                entryPrice: fresh.entry,
                slPrice: fresh.sl,
                initialSlPrice: fresh.sl,
                initialRiskDistance: riskDist,
                tpPrice: propTp,
                targets: [{ id: "tp1", price: propTp, fraction: 1.0, kind: "target", source: propTarget.source, landmarkType: propTarget.landmarkType, tf: propTarget.tf }],
                targetRR: propRR,
                fingerprint: `${freshFp}_prop`,
                confluenceScore: fresh.confluenceScore || t.confluenceScore,
                confluenceBreakdown: fresh.confluenceBreakdown || t.confluenceBreakdown,
                modelId: fresh.modelId || t.modelId,
                entryModel: fresh.entryModel || t.entryModel,
                targetDOL: fresh.targetDOL || reval.brain?.targetDOL || t.targetDOL,
                dealingRange: fresh.dealingRange || reval.brain?.dealingRange || t.dealingRange,
                brokerLevels: frictionProp.brokerLevels,
                spreadPrice: frictionProp.spreadPrice,
                spreadToRiskPct: frictionProp.spreadToRiskPct,
                isFrictionExcessive: frictionProp.isFrictionExcessive,
                idleRR: frictionProp.idleRR,
                coveredRR: frictionProp.coveredRR,
                frictionDragR: frictionProp.frictionDragR,
                recoveryPct: frictionProp.recoveryPct,
                levelDetails: { ...fresh, fullTp: propTp, fullRR: propRR, targets: [{ id: "tp1", price: propTp, fraction: 1.0, kind: "target" }] },
                stagedLevel: { ...fresh, fullTp: propTp, fullRR: propRR },
                brain: reval.brain || t.brain,
                brainSnapshot: reval.brain || t.brainSnapshot,
                lastRefinedAt: new Date(p.now()),
                updatedAt: new Date(p.now()),
              };
              await update(t, patch, event("STAGED_REFINED", `Dynamically re-anchored Prop-Firm Leg to fresh ${fresh.modelName || fresh.modelId || 'structure'} (Entry: ${fresh.entry}, SL: ${fresh.sl}, TP: ${propTp} @ ${propRR}R)`, p.now()));
            } else {
              // Default Leg
              const defaultTargetRR = fresh.targetRR || (riskDist > 0 ? Math.abs(fresh.tp - fresh.entry) / riskDist : t.targetRR);
              const defaultTp = fresh.tp;
              const defaultTargets = fresh.targets || t.targets;

              const frictionDefault = calculateSpreadFriction({
                dir: t.dir,
                entryPrice: fresh.entry,
                slPrice: fresh.sl,
                tpPrice: defaultTp,
                spread: spreadPrice,
                digits,
              });

              const halfTarget = calculateHalfTargetLevel({
                entryPrice: fresh.entry,
                slPrice: fresh.sl,
                tpPrice: defaultTp,
                dir: t.dir,
                targetRR: defaultTargetRR,
                symbolSpec: spec,
              });

              const patch = {
                entryPrice: fresh.entry,
                slPrice: fresh.sl,
                initialSlPrice: fresh.sl,
                initialRiskDistance: riskDist,
                tpPrice: defaultTp,
                targets: defaultTargets,
                targetRR: Math.round(defaultTargetRR * 100) / 100,
                fingerprint: freshFp,
                confluenceScore: fresh.confluenceScore || t.confluenceScore,
                confluenceBreakdown: fresh.confluenceBreakdown || t.confluenceBreakdown,
                modelId: fresh.modelId || t.modelId,
                entryModel: fresh.entryModel || t.entryModel,
                targetDOL: fresh.targetDOL || reval.brain?.targetDOL || t.targetDOL,
                dealingRange: fresh.dealingRange || reval.brain?.dealingRange || t.dealingRange,
                halfTarget,
                fullTp: defaultTp,
                fullRR: Math.round(defaultTargetRR * 100) / 100,
                brokerLevels: frictionDefault.brokerLevels,
                spreadPrice: frictionDefault.spreadPrice,
                spreadToRiskPct: frictionDefault.spreadToRiskPct,
                isFrictionExcessive: frictionDefault.isFrictionExcessive,
                idleRR: frictionDefault.idleRR,
                coveredRR: frictionDefault.coveredRR,
                frictionDragR: frictionDefault.frictionDragR,
                recoveryPct: frictionDefault.recoveryPct,
                levelDetails: { ...fresh, fullTp: defaultTp, fullRR: Math.round(defaultTargetRR * 100) / 100, halfTarget, targets: defaultTargets },
                stagedLevel: { ...fresh, fullTp: defaultTp, fullRR: Math.round(defaultTargetRR * 100) / 100, halfTarget, targets: defaultTargets },
                brain: reval.brain || t.brain,
                brainSnapshot: reval.brain || t.brainSnapshot,
                lastRefinedAt: new Date(p.now()),
                updatedAt: new Date(p.now()),
              };
              await update(t, patch, event("STAGED_REFINED", `Dynamically re-anchored to fresh ${fresh.modelName || fresh.modelId || 'structure'} (Entry: ${fresh.entry}, SL: ${fresh.sl}, TP: ${defaultTp} @ ${Math.round(defaultTargetRR * 100) / 100}R)`, p.now()));
            }
          }
        }

        // Autonomous Pre-Entry Validation Engine (APVE) lightweight sweep
        try {
          let frames = null;
          if (p.getFrames) frames = await p.getFrames(t.symbol).catch(() => null);
          const freshPrice = frames?.M5?.at(-1)?.close ?? frames?.M15?.at(-1)?.close ?? frames?.H1?.at(-1)?.close ?? t.currentPrice;
          const preEntry = await p.validatePreEntrySetup({
            trade: t,
            frames: frames || {},
            currentPrice: freshPrice,
            config: cfg,
            now: new Date(p.now()),
          });
          if (freshPrice !== t.currentPrice) {
            await tradesCol.updateOne({ _id: t._id }, { $set: { currentPrice: freshPrice, updatedAt: new Date(p.now()) } }).catch(() => {});
            t.currentPrice = freshPrice;
          }
          if (!preEntry.ok && preEntry.vetoes?.length > 0) {
            const fatalVeto = preEntry.vetoes.find((v) =>
              ["STOP_ALREADY_BREACHED", "TARGET_ALREADY_REACHED", "MACRO_BIAS_INVERTED", "FVG_INVERTED_FAILURE", "BREAKER_STRUCTURE_BROKEN", "SWEEP_FAILED_BREAKOUT"].includes(v.code)
            );
            if (fatalVeto) {
              await terminal(t, "invalidated", fatalVeto.reason || "Pre-entry thesis invalidated during scan sweep", { vetoes: preEntry.vetoes, preEntry });
              continue;
            }
          }
        } catch (_) {}

        // In Auto execution mode: Attempt arming for eligible staged setups whose transient vetoes cleared
        if (cfg.executionMode !== "copilot" && cfg.enabled && t.status === "staged") {
          try {
            const armRes = await arm(t, cfg);
            if (!armRes?.ok && armRes?.vetoes?.some(v => ["TARGET_ALREADY_HIT", "STRUCTURE_INVALIDATED", "INVALID_GEOMETRY", "STOP_ALREADY_BREACHED"].includes(v.code))) {
              await terminal(t, "invalidated", armRes.error || "Fatal structural thesis veto on auto-arm sweep");
            }
          } catch (_) {}
        }
      }

      const cutoff = new Date(p.now() - Math.max(cfg.cooldownMinutes, cfg.lossCooldownMinutes, cfg.dedupFingerprintWindowMinutes) * 60000);
      const recent = await tradesCol.find({ $or: [{ status: { $in: store.OPEN_STATES } }, { createdAt: { $gte: cutoff } }, { closedAt: { $gte: cutoff } }] }).toArray();
      const exhausted = cfg.exhaustedIdeaScope === "none" ? new Set() : await getExhaustedTodayFingerprints(tradesCol, p.getStartOfTradingDay(new Date(p.now())));
      let stagedCount = 0;
      for (const setup of scan.primeSetups || []) {
        const level = setup.stagedLevel, symbol = setup.tradeableSymbol || setup.symbol;
        if (!level || ![level.entry, level.sl, level.tp].every((v) => Number(v) > 0)) continue;
        const fingerprint = getSetupFingerprint(setup.symbol, setup.dir, level, setup.entryModel?.id, level.tf);
        if (exhausted.has(fingerprint)) continue;
        if (recent.some((t) => {
          const sameSymbol = [t.symbol, t.canonicalSymbol].includes(symbol) || [t.symbol, t.canonicalSymbol].includes(setup.symbol);
          const age = p.now() - new Date(t.closedAt || t.updatedAt || t.createdAt).getTime();
          const setupHorizon = setup.scenario?.id || setup.horizon || "day";
          const tradeHorizon = t.horizon || t.scenario?.id || "day";
          const sameHorizon = tradeHorizon === setupHorizon;
          return (sameSymbol && sameHorizon && store.OPEN_STATES.includes(t.status)) ||
            (t.fingerprint === fingerprint && age < cfg.dedupFingerprintWindowMinutes * 60000) ||
            (sameSymbol && sameHorizon && age < cfg.cooldownMinutes * 60000) ||
            (sameSymbol && sameHorizon && t.dir === setup.dir && ["closed_sl", "invalidated"].includes(t.status) && age < cfg.lossCooldownMinutes * 60000);
        })) continue;
        const groupId = `grp_${setup.symbol}_${setup.dir}_${p.now()}`;
        const riskDist = Math.abs(level.entry - level.sl);

        // CFD Spread Friction & Microstructure Analysis
        const tick = pendingTicks[symbol] || pendingTicks[setup.symbol] || g._tsAutonomousTicks?.[symbol] || g._tsAutonomousTicks?.[setup.symbol];
        const spec = cfg.paperSymbolSpecs?.[symbol] || cfg.paperSymbolSpecs?.[setup.symbol] || specCache.get(symbol)?.spec || {};
        const spreadPrice = extractSpreadPrice(tick, spec);
        const digits = Number(spec.digits || 5);

        // Gatekeeper: Veto trade if spread exceeds max spread tolerance (default 25% of Stop Loss distance)
        if (cfg.vetoExcessiveFriction && !isSpreadAcceptable(spreadPrice, riskDist, cfg.maxSpreadToRisk || 0.25)) {
          notify(cfg, `⚠️ <b>${symbol}</b> | SPREAD VETO | ${spreadPrice} > ${((cfg.maxSpreadToRisk || 0.25) * 100).toFixed(0)}% SL`, `${symbol}:VETO_SPREAD`);
          continue;
        }

        // 1. Leg A: Default Mode (Downwards Cascading Structural Targets in 3R - 7R preferred range)
        const defaultTarget = resolveCascadingDefaultTarget({
          entry: level.entry,
          sl: level.sl,
          dir: setup.dir,
          scenario: setup.scenario,
          horizon: setup.scenario?.id || setup.horizon,
          frames: setup.frames,
          ranges: setup.ranges || setup.brain?.ranges,
          brain: setup.brain,
          htfFvg: setup.brain?.htfFvg,
          htfLiq: setup.brain?.htfLiquidity,
          evidence: level.evidence || setup.evidence,
          targets: level.targets,
          targetDOL: level.targetDOL || setup.brain?.targetDOL,
          dealingRange: level.dealingRange || setup.dealingRange,
          digits,
        });

        const defaultTargetRR = defaultTarget?.targetRR || level.targetRR || (riskDist > 0 ? Math.abs(level.tp - level.entry) / riskDist : 3.5);
        const defaultTp = defaultTarget?.tpPrice || level.tp;
        const defaultTargets = defaultTarget?.targets || level.targets;

        const frictionDefault = calculateSpreadFriction({
          dir: setup.dir,
          entryPrice: level.entry,
          slPrice: level.sl,
          tpPrice: defaultTp,
          spread: spreadPrice,
          digits,
        });

        const halfTarget = calculateHalfTargetLevel({
          entryPrice: level.entry,
          slPrice: level.sl,
          tpPrice: defaultTp,
          dir: setup.dir,
          targetRR: defaultTargetRR,
          symbolSpec: spec,
        });

        const cleanCanonical = canonOf(setup.symbol || symbol);
        const routingDefault = resolveCopierRouting({
          symbol,
          canonicalSymbol: cleanCanonical,
          scenario: setup.scenario,
          tf: level.tf,
          entryModel: setup.entryModel,
          modelId: level.modelId,
          managementLogic: "milestone_50",
        }, cfg.copierProfiles);

        const tradeDefault = {
          symbol, canonicalSymbol: cleanCanonical, fingerprint, groupId, legId: "default", legLabel: "Default (50% Milestone + Runner)",
          dir: setup.dir, dirLabel: setup.dirLabel, status: "staged", executionMode: cfg.executionMode, isLive: Boolean(cfg.liveTrading),
          ticket: null, orderTicket: null, positionId: null, operation: null, brokerStatus: "not_submitted",
          entryPrice: level.entry, slPrice: level.sl, tpPrice: defaultTp, initialSlPrice: level.sl, initialRiskDistance: riskDist, initialRiskUsd: 0,
          filledPrice: null, targets: defaultTargets || null, orderType: "limit", tf: level.tf, dealingRange: level.dealingRange,
          thesisId: level.thesisId, ideaId: level.ideaId, targetDOL: level.targetDOL || setup.brain?.targetDOL, modelId: level.modelId,
          confluenceBreakdown: level.confluenceBreakdown, evidence: level.evidence, partialExits: [], remainingFraction: 1,
          scenario: setup.scenario, horizon: setup.scenario?.id || "day", horizonCode: setup.scenario?.horizonCode || 2,
          stagedPrice: setup.currentPrice, currentPrice: setup.currentPrice, targetRR: Math.round(defaultTargetRR * 100) / 100,
          spreadPrice: frictionDefault.spreadPrice, spreadToRiskPct: frictionDefault.spreadToRiskPct, isFrictionExcessive: frictionDefault.isFrictionExcessive,
          idleRR: frictionDefault.idleRR, coveredRR: frictionDefault.coveredRR, frictionDragR: frictionDefault.frictionDragR, recoveryPct: frictionDefault.recoveryPct, brokerLevels: frictionDefault.brokerLevels,
          riskUsd: 0, lotSize: 0, unrealizedR: 0, unrealizedPnl: 0,
          halfTarget, fullTp: defaultTp, fullRR: Math.round(defaultTargetRR * 100) / 100,
          slAudit: level.slAudit,
          levelDetails: { ...level, fullTp: defaultTp, fullRR: Math.round(defaultTargetRR * 100) / 100, halfTarget, targets: defaultTargets },
          stagedLevel: { ...level, fullTp: defaultTp, fullRR: Math.round(defaultTargetRR * 100) / 100, halfTarget, targets: defaultTargets },
          entryModel: setup.entryModel,
          brainSnapshot: setup.brain, brain: setup.brain, activeTimeSlot: setup.activeTimeSlot, opportunityScore: setup.opportunityScore,
          magicNumber: routingDefault.magicNumber, brokerComment: routingDefault.comment, copierRouting: routingDefault,
          eligibleAccounts: routingDefault.eligibleAccounts, managementLogic: "milestone_50",
          createdAt: new Date(p.now()), updatedAt: new Date(p.now()), events: [event("STAGED", `Qualified structural limit idea (Default Leg: ${defaultTarget?.source || 'Structural'} @ ${Math.round(defaultTargetRR * 100) / 100}R)`, p.now())],
        };
        const insDefault = await tradesCol.insertOne(tradeDefault); tradeDefault._id = insDefault.insertedId;
        recent.push(tradeDefault); stagedCount++;

        // 2. Leg B: Prop-Firm Safe Mode (1.5R - 2.5R Bracket via Upward Gradual Cascading)
        const propTarget = resolveDynamicPropFirmTarget({
          entry: level.entry,
          sl: level.sl,
          dir: setup.dir,
          scenario: setup.scenario,
          horizon: setup.scenario?.id || setup.horizon,
          frames: setup.frames,
          ranges: setup.ranges || setup.brain?.ranges,
          brain: setup.brain,
          htfFvg: setup.brain?.htfFvg,
          htfLiq: setup.brain?.htfLiquidity,
          evidence: level.evidence || setup.evidence,
          targets: level.targets,
          dealingRange: level.dealingRange || setup.dealingRange,
          targetRR: level.targetRR,
          digits,
        });
        const propRR = propTarget.targetRR;
        const propTp = propTarget.tpPrice;

        const frictionProp = calculateSpreadFriction({
          dir: setup.dir,
          entryPrice: level.entry,
          slPrice: level.sl,
          tpPrice: propTp,
          spread: spreadPrice,
          digits,
        });

        const routingProp = resolveCopierRouting({
          symbol,
          canonicalSymbol: cleanCanonical,
          scenario: setup.scenario,
          tf: level.tf,
          entryModel: setup.entryModel,
          modelId: level.modelId,
          managementLogic: "prop_firm_safe",
        }, cfg.copierProfiles);

        const tradeProp = {
          symbol, canonicalSymbol: cleanCanonical, fingerprint: `${fingerprint}_prop`, groupId, legId: "prop_firm", legLabel: "Prop-Firm Safe (1.5R–2.5R)",
          dir: setup.dir, dirLabel: setup.dirLabel, status: "staged", executionMode: cfg.executionMode, isLive: Boolean(cfg.liveTrading),
          ticket: null, orderTicket: null, positionId: null, operation: null, brokerStatus: "not_submitted",
          entryPrice: level.entry, slPrice: level.sl, tpPrice: propTp, initialSlPrice: level.sl, initialRiskDistance: riskDist, initialRiskUsd: 0,
          filledPrice: null, targets: [{ id: "tp1", price: propTp, fraction: 1.0, kind: "target", source: propTarget.source, landmarkType: propTarget.landmarkType, tf: propTarget.tf }], orderType: "limit", tf: level.tf, dealingRange: level.dealingRange,
          thesisId: level.thesisId, ideaId: `${level.ideaId}_prop`, targetDOL: level.targetDOL || setup.brain?.targetDOL, modelId: level.modelId,
          confluenceBreakdown: level.confluenceBreakdown, evidence: level.evidence, partialExits: [], remainingFraction: 1,
          scenario: setup.scenario, horizon: setup.scenario?.id || "day", horizonCode: setup.scenario?.horizonCode || 2,
          stagedPrice: setup.currentPrice, currentPrice: setup.currentPrice, targetRR: propRR,
          spreadPrice: frictionProp.spreadPrice, spreadToRiskPct: frictionProp.spreadToRiskPct, isFrictionExcessive: frictionProp.isFrictionExcessive,
          idleRR: frictionProp.idleRR, coveredRR: frictionProp.coveredRR, frictionDragR: frictionProp.frictionDragR, recoveryPct: frictionProp.recoveryPct, brokerLevels: frictionProp.brokerLevels,
          propTarget, targetLandmark: propTarget.source,
          halfTarget, fullTp: defaultTp, fullRR: Math.round(defaultTargetRR * 100) / 100,
          slAudit: level.slAudit,
          riskUsd: 0, lotSize: 0, unrealizedR: 0, unrealizedPnl: 0,
          levelDetails: { ...level, fullTp: defaultTp, fullRR: Math.round(defaultTargetRR * 100) / 100, halfTarget, tp: propTp, rr: propRR, propTarget },
          stagedLevel: { ...level, fullTp: defaultTp, fullRR: Math.round(defaultTargetRR * 100) / 100, halfTarget, tp: propTp, rr: propRR, propTarget },
          entryModel: setup.entryModel,
          brainSnapshot: setup.brain, brain: setup.brain, activeTimeSlot: setup.activeTimeSlot, opportunityScore: setup.opportunityScore,
          magicNumber: routingProp.magicNumber, brokerComment: routingProp.comment, copierRouting: routingProp,
          eligibleAccounts: routingProp.eligibleAccounts, managementLogic: "prop_firm_safe",
          createdAt: new Date(p.now()), updatedAt: new Date(p.now()), events: [event("STAGED", `Qualified structural limit idea (Prop-Firm Leg: ${propTarget.source} @ ${propRR}R)`, p.now())],
        };
        const insProp = await tradesCol.insertOne(tradeProp); tradeProp._id = insProp.insertedId;
        recent.push(tradeProp); stagedCount++;

        if (cfg.executionMode !== "copilot" && cfg.enabled) {
          const armDef = await arm(tradeDefault, cfg);
          const armProp = await arm(tradeProp, cfg);
          if (!armDef?.ok && armDef?.vetoes?.some(v => ["TARGET_ALREADY_HIT", "STRUCTURE_INVALIDATED", "INVALID_GEOMETRY", "DOL_MISALIGNED", "PREMIUM_DISCOUNT"].includes(v.code))) {
            await terminal(tradeDefault, "invalidated", armDef.error || "Fatal structural thesis veto on auto-arm");
          }
          if (!armProp?.ok && armProp?.vetoes?.some(v => ["TARGET_ALREADY_HIT", "STRUCTURE_INVALIDATED", "INVALID_GEOMETRY", "DOL_MISALIGNED", "PREMIUM_DISCOUNT"].includes(v.code))) {
            await terminal(tradeProp, "invalidated", armProp.error || "Fatal structural thesis veto on auto-arm");
          }
        }
      }
      invalidateOpenCache();
      changed();
      return { ok: true, scannedCount: scan.totalScanned, stagedCount };
    } catch (err) { return { ok: false, error: err.message }; }
    finally { scanRun = false; g._tsAutonomousScanning = false; }
  }

  async function approveStagedTrade(tradeId) {
    const { tradesCol } = await cols();
    const trade = await tradesCol.findOne({ _id: oid(tradeId) });
    if (!trade || trade.status !== "staged") return { ok: false, error: "Trade is not staged" };
    const cfg = await p.getConfig();
    if (cfg.exhaustedIdeaScope !== "none" && (await getExhaustedTodayFingerprints(tradesCol, p.getStartOfTradingDay(new Date(p.now())))).has(trade.fingerprint)) return { ok: false, error: "Trade idea exhausted for this broker day" };
    const siblings = trade.groupId ? await tradesCol.find({ groupId: trade.groupId, status: "staged" }).toArray() : [trade];
    let lastArmRes = null;
    let armedCount = 0;
    for (const t of siblings) {
      t.executionMode = cfg.executionMode;
      t.isLive = Boolean(cfg.liveTrading);
      await update(t, { executionMode: cfg.executionMode, isLive: Boolean(cfg.liveTrading) });
      lastArmRes = await arm(t, cfg);
      if (!lastArmRes?.ok && lastArmRes?.vetoes?.length) {
        const isTransient = lastArmRes.vetoes.every((v) =>
          ["SESSION", "TIMING", "DEAD_ZONE", "ACCOUNT_STALE", "ACCOUNT_CHANGED", "CAPACITY", "DEAD_ZONE_RESTRICTION", "TIME_SLOT_UNAVAILABLE"].includes(v.code)
        );
        if (isTransient) {
          const initialRiskDistance = t.initialRiskDistance ?? Math.abs(Number(t.entryPrice) - Number(t.initialSlPrice ?? t.slPrice));
          await update(t, {
            status: "armed",
            approvedByTrader: true,
            executionMode: cfg.executionMode,
            isLive: Boolean(cfg.liveTrading),
            initialRiskDistance,
            vetoes: lastArmRes.vetoes,
            expiresAt: new Date(p.now() + (cfg.pendingExpiryMinutes || 60) * 60000),
          }, event("ARMED", `Approved by trader; queued waiting for session/capacity (${lastArmRes.vetoes.map(v => v.code).join(", ")})`, p.now()));
          lastArmRes = { ok: true, queued: true };
          armedCount++;
          continue;
        }
        await terminal(t, "invalidated", lastArmRes.error || "Pre-entry thesis invalidated on approval", { vetoes: lastArmRes.vetoes });
      } else if (lastArmRes?.ok) {
        armedCount++;
      }
    }
    if (!lastArmRes?.ok && armedCount === 0) {
      return { ok: false, error: lastArmRes?.error || "Setup invalidated before entry" };
    }
    return { ok: true, armedCount: armedCount || siblings.length };
  }
  async function dismissStagedTrade(tradeId) {
    const { tradesCol } = await cols();
    const trade = await tradesCol.findOne({ _id: oid(tradeId) });
    if (!trade || !["staged", "armed", "pending", "placing", "reconciling", "cancelling"].includes(trade.status)) return { ok: false, error: "Entry already executed or unavailable" };
    const siblings = trade.groupId ? await tradesCol.find({ groupId: trade.groupId, status: { $in: ["staged", "armed", "pending", "placing", "reconciling", "cancelling"] } }).toArray() : [trade];
    for (const t of siblings) {
      if (["cancelling", "reconciling"].includes(t.status)) {
        const ticketToCancel = t.orderTicket || t.ticket;
        if (t.isLive && ticketToCancel) {
          await p.cancelMT5Order({ orderTicket: ticketToCancel, requestId: p.id(), accountLogin: t.brokerAccountLogin }).catch(() => {});
        }
        await terminal(t, "cancelled", "Trader manual resolution", { brokerStatus: "cancelled" });
      } else {
        await cancel(t, "Trader dismissed setup", true);
      }
    }
    return { ok: true, dismissedCount: siblings.length };
  }
  async function closeActiveTrade(tradeId, reason = "Trader manual close", closeSiblings = false) {
    const { tradesCol } = await cols();
    const trade = await tradesCol.findOne({ _id: oid(tradeId) });
    if (!trade || !store.ACTIVE_STATES.includes(trade.status)) return { ok: false, error: "Trade is not active" };
    const cfg = await p.getConfig();
    const tradesToClose = (closeSiblings && trade.groupId)
      ? await tradesCol.find({ groupId: trade.groupId, status: { $in: store.ACTIVE_STATES } }).toArray()
      : [trade];
    let lastRes = { ok: true, closedCount: tradesToClose.length };
    for (const t of tradesToClose) {
      const risk = initialTradeRisk(t);
      if (!t.initialVolume) await update(t, { initialSlPrice: risk.sl, initialRiskDistance: risk.distance, initialRiskUsd: risk.riskUsd, initialVolume: risk.volume, remainingVolume: risk.volume, remainingFraction: 1 });
      lastRes = await exit(t, cfg, "manual", t.currentPrice, t.remainingVolume, reason, true);
    }
    return { ...lastRes, closedCount: tradesToClose.length };
  }

  async function modifyTradeTarget(tradeId, { targetRR, tpPrice }) {
    const { tradesCol } = await cols();
    const trade = await tradesCol.findOne({ _id: oid(tradeId) });
    if (!trade) return { ok: false, error: "Trade not found" };

    const risk = initialTradeRisk(trade);
    const distance = risk.distance || Math.abs(Number(trade.entryPrice) - Number(trade.slPrice));
    if (!distance || distance <= 0) return { ok: false, error: "Initial risk distance unavailable" };

    let newRR = null;
    let newTp = null;
    const isSwing = trade.scenario?.id === "swing" || trade.horizon === "swing" || trade.horizonCode === 1;
    const isPropFirm = trade.managementLogic === "prop_firm_safe";

    if (targetRR != null && Number.isFinite(Number(targetRR))) {
      newRR = isPropFirm
        ? Math.min(2.5, Math.max(1.5, Number(targetRR)))
        : Math.max(0.5, Number(targetRR));
      newTp = Number((risk.entry + trade.dir * (distance * newRR)).toFixed(trade.symbolSpec?.digits || 5));
    } else if (tpPrice != null && Number.isFinite(Number(tpPrice))) {
      const rawRR = trade.dir * (Number(tpPrice) - risk.entry) / distance;
      if (rawRR <= 0) return { ok: false, error: "Target price must be in trade profit direction" };
      newRR = isPropFirm
        ? Math.min(2.5, Math.max(1.5, Math.round(rawRR * 100) / 100))
        : Math.max(0.5, Math.round(rawRR * 100) / 100);
      newTp = Number((risk.entry + trade.dir * (distance * newRR)).toFixed(trade.symbolSpec?.digits || 5));
    } else {
      return { ok: false, error: "Must specify targetRR or tpPrice" };
    }

    const patch = {
      targetRR: newRR,
      tpPrice: newTp,
      updatedAt: new Date(p.now()),
    };

    if (Array.isArray(trade.targets) && trade.targets.length > 0) {
      const updatedTargets = [...trade.targets];
      const lastIdx = updatedTargets.length - 1;
      updatedTargets[lastIdx] = { ...updatedTargets[lastIdx], price: newTp };
      patch.targets = updatedTargets;
    }

    let brokerResult = null;
    if (trade.isLive && trade.ticket && store.ACTIVE_STATES.includes(trade.status)) {
      try {
        brokerResult = await p.modifyMT5Order({
          ticket: trade.ticket,
          sl: trade.slPrice,
          tp: newTp,
          requestId: p.id(),
          accountLogin: trade.brokerAccountLogin,
        });
      } catch (e) { return { ok: false, pending: true, error: e.message }; }
      if (!brokerResult?.ok) return { ok: false, pending: brokerResult?.ambiguous === true, error: brokerResult?.error || brokerResult?.message || "Broker rejected target modification" };
    }

    await tradesCol.updateOne({ _id: trade._id }, { $set: patch, $push: { events: event("TARGET_MODIFIED", `Target modified to ${newRR}R @ ${newTp}`, p.now()) } });
    Object.assign(trade, patch);
    invalidateOpenCache();
    changed();
    return { ok: true, tradeId, targetRR: newRR, tpPrice: newTp, broker: brokerResult };
  }

  return { autonomousOnTicks, runAutonomousScan, approveStagedTrade: (...args) => serialize(() => approveStagedTrade(...args)), dismissStagedTrade: (...args) => serialize(() => dismissStagedTrade(...args)), closeActiveTrade: (...args) => serialize(() => closeActiveTrade(...args)), modifyTradeTarget: (...args) => serialize(() => modifyTradeTarget(...args)), pollBroker, refreshBrokerState, guard, reconcile };
}

export function getEngine(forceNew = false) {
  if (forceNew || !g._tsAutonomousEngine) g._tsAutonomousEngine = createAutonomousEngine();
  return g._tsAutonomousEngine;
}
export const autonomousOnTicks = (...args) => getEngine().autonomousOnTicks(...args);
export const runAutonomousScan = (reason) => getEngine(reason === "manual").runAutonomousScan(reason);
export const approveStagedTrade = (...args) => getEngine().approveStagedTrade(...args);
export const dismissStagedTrade = (...args) => getEngine().dismissStagedTrade(...args);
export const closeActiveTrade = (...args) => getEngine().closeActiveTrade(...args);
export const modifyTradeTarget = (...args) => getEngine().modifyTradeTarget(...args);
export const pollBroker = (...args) => getEngine().pollBroker(...args);

let symbolsAt = 0;
export async function getAutonomousTickSymbols() {
  if (Date.now() - symbolsAt > 2000 || !g._tsAutonomousSymbols) {
    const { tradesCol } = await store.autonomousCols();
    const open = await tradesCol.find({ status: { $in: store.OPEN_STATES } }, { projection: { symbol: 1 } }).toArray();
    g._tsAutonomousSymbols = new Set(open.map((t) => t.symbol)); symbolsAt = Date.now();
  }
  return [...g._tsAutonomousSymbols];
}
export function startAutonomousLoop() {
  if (g._tsAutonomousStarted) return;
  g._tsAutonomousStarted = true;
  const scan = async () => { const cfg = await store.getConfig(); if (cfg.enabled) await runAutonomousScan(); };
  const poll = () => getEngine().pollBroker().catch((err) => console.warn("[autonomous broker poll]", err.message));
  setTimeout(() => scan().catch(() => {}), 18000);
  setInterval(() => scan().catch(() => {}), 180000);
  setInterval(poll, 5000); // batched orders, positions and deals; separate from hot ticks
  poll();
}

