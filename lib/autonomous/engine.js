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
import { calculateRiskSize, dailyRiskGovernor, planPartialVolumes } from "./risk.js";
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
  planFractionalVolumes,
  determineTerminalStatus,
  calculateHalfTargetLevel,
} from "./management.js";
import { resolveCopierRouting } from "./magicEncoder.js";
import { calculateSpreadFriction, extractSpreadPrice, isSpreadAcceptable } from "./friction.js";

const g = globalThis;
const oid = (id) => ObjectId.isValid(id) ? new ObjectId(id) : null;
const event = (type, note, now) => ({ type, note, time: new Date(now) });

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

// Ports make database, time, quotes, context and broker writes testable offline.
export function createAutonomousEngine(overrides = {}) {
  const p = { ...store, ...broker, bridge, getFrames, scanUniverse: (...args) => scanner.scanUniverse(...args), revalidateTradeIdea: (...args) => scanner.revalidateTradeIdea(...args), getMainWatchlistSymbols, isTradingPermittedNow, getStartOfTradingDay, broadcast, sendTelegram, now: Date.now, id: randomUUID, ...overrides };
  let pendingTicks = {}, tickRun = null, scanRun = false, brokerRead = null, snapshot = null, snapshotAt = 0;
  let work = Promise.resolve();
  const serialize = (fn) => { const next = work.then(fn); work = next.catch(() => {}); return next; };
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
  const findOpen = async () => (await (await cols()).tradesCol.find({ status: { $in: store.OPEN_STATES } }).toArray());
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
      }
      if (msg) {
        notify(cfg, msg, `${trade.groupId || trade.symbol}:EXIT`);
      }
    }
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
          state = {
            ok: true,
            account: acc.account,
            positions: [],
            orders: [],
            history: [],
            order_history: [],
            requests: [],
            dailyPnl: Number(acc.account.profit || 0),
            dayStartEquity: Number(acc.account.balance),
            brokerDayStart: Math.floor(p.getStartOfTradingDay(new Date(p.now())).getTime() / 1000),
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
    if (reservedSetupCount >= cfg.maxConcurrentTrades) vetoes.push({ code: "CAPACITY", reason: "Reserved concurrent trade capacity is full" });
    if (!snapshot) await refreshBrokerState();
    const live = liveIntent(trade, cfg);
    if (live && trade.brokerAccountLogin && String(trade.brokerAccountLogin) !== String(snapshot?.account?.login)) vetoes.push({ code: "ACCOUNT_CHANGED", reason: "Remote broker account changed after arming" });
    if (live && (!snapshot?.account || p.now() - snapshotAt > cfg.accountFreshnessMs)) vetoes.push({ code: "ACCOUNT_STALE", reason: "Fresh remote account equity unavailable" });
    const paperClosed = live ? [] : await (await cols()).tradesCol.find({ isLive: false, status: { $in: store.TERMINAL_STATES } }).toArray();
    const brokerEquity = Number(snapshot?.account?.equity ?? snapshot?.account?.balance);
    const baseCapital = (brokerEquity > 0)
      ? brokerEquity
      : (Number(cfg.accountSize) > 0 ? Number(cfg.accountSize) : 25000);
    const equity = live
      ? baseCapital
      : baseCapital + [...paperClosed, ...all.filter((t) => !t.isLive)].reduce((s, t) => s + Number(t.realizedPnl || 0) + (store.ACTIVE_STATES.includes(t.status) ? Number(t.unrealizedPnl || 0) : 0), 0);
    if (equity > 0) {
      if (trade.initialRiskUsd > equity * cfg.riskPerTradePct / 100 + 1e-8) vetoes.push({ code: "RISK_CHANGED", reason: "Reserved position risk exceeds the current equity risk budget" });
      const start = live && Number(snapshot?.brokerDayStart) > 0 ? new Date(snapshot.brokerDayStart * 1000) : p.getStartOfTradingDay(new Date(p.now()));
      const dayKey = `${live ? snapshot?.account?.login || "live" : "paper"}:${new Date(start).toISOString()}`;
      const daily = await (await cols()).tradesCol.find({ closedAt: { $gte: new Date(start) }, isLive: live }).toArray();
      const paperDayPnl = [...paperClosed, ...all.filter((t) => !t.isLive)].reduce((sum, t) => sum + (t.partialExits?.length ? t.partialExits.filter((e) => new Date(e.time).getTime() >= new Date(start).getTime()).reduce((total, e) => total + Number(e.pnl || 0), 0) : new Date(t.closedAt).getTime() >= new Date(start).getTime() ? Number(t.realizedPnl || 0) : 0), 0);
      const pnl = live && Number.isFinite(snapshot?.dailyPnl) ? snapshot.dailyPnl : live ? daily.reduce((sum, t) => sum + Number(t.realizedPnl || 0), 0) : paperDayPnl;
      const startEquity = await p.getDailyBaseline(dayKey, live && Number(snapshot.dayStartEquity) > 0 ? snapshot.dayStartEquity : equity - pnl);
      const reservedRisk = reserved.filter((t) => Boolean(t.isLive) === live || (!t.isLive && liveIntent(t, cfg) === live)).reduce((sum, t) => sum + Number(t.initialRiskUsd || t.riskUsd || 0), 0);
      const risk = sizedRisk || equity * cfg.riskPerTradePct / 100;
      const governor = dailyRiskGovernor({ startEquity, equity, realizedPnl: pnl, maxDailyLossPct: cfg.maxDailyLossPct, reservedRisk, newRisk: risk });
      capacityRiskLimit = Math.max(0, governor.limit - governor.drawdown);
      if (!governor.permitted) vetoes.push({ code: "DAILY_DRAWDOWN", reason: governor.reason });
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
    const result = calculateRiskSize({ equity, riskPct: cfg.riskPerTradePct, entryPrice: trade.entryPrice, slPrice: trade.initialSlPrice ?? trade.slPrice, symInfo: spec, lossPerLot, requirePartials: trade.requirePartials === true });
    return { ...result, spec };
  }

  async function arm(trade, cfg) {
    await refreshBrokerState();
    const check = await guard(trade, cfg);
    if (!check.permitted) { await update(trade, { vetoes: check.vetoes }); return { ok: false, error: check.vetoes.map((v) => v.reason).join(" · "), vetoes: check.vetoes }; }
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
    const filter = { _id: trade._id, status: trade.status, $or: [{ operation: { $exists: false } }, { operation: null }, ...(explicit ? [{ "operation.state": "failed" }] : [])] };
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
    if (!check.permitted) { await terminal(trade, "invalidated", check.vetoes.map((v) => v.reason).join(" · "), { vetoes: check.vetoes }); return; }
    if (liveIntent(trade, cfg)) {
      const sizing = await size(trade, cfg, check.equity);
      if (!(sizing.lotSize > 0)) { await terminal(trade, "invalidated", sizing.reason); return; }
      if (!await p.reserveTradeCapacity(trade, { ...cfg, capacityRiskLimit: check.capacityRiskLimit }, sizing.riskUsd)) return;
      const routing = resolveCopierRouting(trade, cfg.copierProfiles);
      const computedMagic = trade.magicNumber || routing.magicNumber;
      const computedComment = (trade.brokerComment || routing.comment || `TS:${String(trade._id)}`).slice(0, 31);
      if (!await update(trade, { isLive: true, lotSize: sizing.lotSize, initialVolume: sizing.lotSize, remainingVolume: sizing.lotSize, initialRiskUsd: sizing.riskUsd, riskUsd: sizing.riskUsd, partialVolumes: sizing.allocations, symbolSpec: sizing.spec, brokerComment: computedComment, magicNumber: computedMagic, eligibleAccounts: routing.eligibleAccounts, copierRouting: routing })) return;
      const orderType = isResting ? "limit" : "market";
      const brokerSl = trade.brokerLevels?.sl || trade.initialSlPrice;
      const brokerTp = trade.brokerLevels?.tp || trade.targets?.at(-1)?.price || trade.tpPrice;
      const brokerEntry = isResting ? (trade.brokerLevels?.entry || trade.entryPrice) : price;
      const payload = { symbol: trade.symbol, action: trade.dir === 1 ? "buy" : "sell", volume: trade.lotSize, sl: brokerSl, tp: brokerTp, entryPrice: brokerEntry, orderType, expiresAt: trade.expiresAt, comment: computedComment, magic: computedMagic, accountLogin: trade.brokerAccountLogin };
      const op = await claim(trade, "place", payload, "placing");
      if (!op) return;
      const res = await p.executeMT5Order({ ...payload, requestId: op.requestId });
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
    if (!trade.orderTicket) return { ok: false, pending: true, error: "Order identifier awaiting reconciliation" };
    // An acknowledged placement is a settled lease for order management.
    if (trade.operation?.kind === "place" && trade.operation.state === "acknowledged") await update(trade, { operation: null });
    const op = await claim(trade, "cancel", { orderTicket: trade.orderTicket, reason }, "cancelling", explicit);
    if (!op) return { ok: false, pending: true, error: "Broker operation awaiting reconciliation" };
    const res = await p.cancelMT5Order({ orderTicket: trade.orderTicket, requestId: op.requestId, accountLogin: trade.brokerAccountLogin });
    await resultOf(trade, res);
    // /cancel success proves removal, but a missing order may already be filled.
    if (res.ok && res.status === "cancelled") await terminal(trade, "cancelled", reason, { brokerStatus: "cancelled" });
    return { ...res, pending: !res.ok };
  }

  async function confirmFill(trade, filledPrice, volume, extra = {}) {
    if (!(filledPrice > 0 && volume > 0)) return false;
    const initialSlPrice = trade.initialSlPrice ?? trade.slPrice;
    const distance = Math.abs(filledPrice - initialSlPrice);
    const monetaryRisk = trade.initialRiskUsd * distance / trade.initialRiskDistance * volume / trade.initialVolume;
    const partialVolumes = trade.targets?.length === 3 ? planPartialVolumes(volume, trade.symbolSpec) : null;
    const fractionalVolumes = planFractionalVolumes(volume, trade.symbolSpec);
    const ok = await update(trade, { ...extra, status: "active", filledAt: new Date(p.now()), filledPrice, initialSlPrice, initialRiskDistance: distance, initialRiskUsd: monetaryRisk, initialVolume: volume, remainingVolume: volume, remainingFraction: 1, brokerVolume: volume, lotSize: volume, partialVolumes, fractionalVolumes, fillAllocationInvalid: trade.targets?.length === 3 && !partialVolumes, fillRiskInvalid: !(trade.dir * (filledPrice - initialSlPrice) > 0), operation: null, brokerStatus: trade.isLive ? "position_confirmed" : "paper_filled" }, event("FILLED", `Confirmed fill @ ${filledPrice} · ${volume} volume`, p.now()));
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
    // Position/deal snapshot confirms quantity and realized account-currency PnL.
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
      // Mark BE/trailing only after position SL independently matches the request.
    }
    const cfg = await p.getConfig();
    if (kind === "breakeven") {
      notify(cfg, `🛡 <b>${trade.symbol}</b> | BREAKEVEN @ ${sl} | Risk-Free`, `${trade.groupId || trade.symbol}:BE`);
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
      const check = await guard(trade, cfg, { sizedRisk: trade.initialRiskUsd });
      await update(trade, { status: "confirming", ticket: rec.position?.ticket || trade.ticket, positionId: rec.positionId, entryVetoPending: !check.permitted, vetoes: check.vetoes });
      if (trade.operation?.kind === "place") await update(trade, { operation: null });
      if (!trade.operation) {
        const op = await claim(trade, "cancel_remainder", { orderTicket: rec.pending.ticket });
        if (op) await resultOf(trade, await p.cancelMT5Order({ orderTicket: rec.pending.ticket, requestId: op.requestId, accountLogin: trade.brokerAccountLogin }));
      }
      return;
    }
    if (rec.position && !trade.filledAt) {
      const check = await guard(trade, cfg, { sizedRisk: trade.initialRiskUsd }); // Fill already happened: record truth, then enforce veto via a confirmed close.
      const volume = rec.entries?.reduce((sum, d) => sum + Number(d.volume), 0) || Number(rec.position.volume);
      const price = rec.entries?.length ? rec.entries.reduce((sum, d) => sum + Number(d.volume) * Number(d.price), 0) / volume : Number(rec.position.price_open);
      const openingCosts = rec.entries.reduce((sum, d) => sum + Number(d.commission || 0) + Number(d.swap || 0) + Number(d.fee || 0), 0);
      if (await confirmFill(trade, price, volume, { ticket: rec.position.ticket, positionId: rec.positionId, vetoes: check.vetoes, openingCosts })) {
        if (!check.permitted || trade.entryVetoPending || trade.fillAllocationInvalid || trade.fillRiskInvalid) await exit(trade, cfg, "entry_veto", 0, trade.remainingVolume, "Entry permission/allocation changed before broker fill");
      }
    } else if (!trade.filledAt && rec.entries?.length) {
      const check = await guard(trade, cfg, { sizedRisk: trade.initialRiskUsd });
      const volume = rec.entries.reduce((sum, d) => sum + Number(d.volume), 0);
      const price = rec.entries.reduce((sum, d) => sum + Number(d.volume) * Number(d.price), 0) / volume;
      const openingCosts = rec.entries.reduce((sum, d) => sum + Number(d.commission || 0) + Number(d.swap || 0) + Number(d.fee || 0), 0);
      await confirmFill(trade, price, volume, { positionId: rec.positionId, ticket: rec.position?.ticket || trade.ticket, vetoes: check.vetoes, entryVetoPending: !check.permitted, openingCosts });
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
          await update(trade, { status: "managing", operation: null, brokerStatus: "partial_confirmed", ...(op.payload.id === "tp1" ? { tp1Done: true } : op.payload.id === "tp2" ? { tp2Done: true } : {}) });
        }
      } else if (op?.kind === "cancel_remainder" && !rec.pending && op.state !== "failed") {
        await update(trade, { operation: null, brokerStatus: "remainder_cancelled" });
      } else if (op?.kind === "modify" && op.state !== "failed" && rec.position && Math.abs(Number(rec.position.sl) - op.payload.sl) <= Number(trade.symbolSpec?.point || 1e-8) / 2) {
        await update(trade, { slPrice: Number(rec.position.sl), status: "managing", operation: null, brokerStatus: "sl_confirmed", ...(op.payload.kind === "breakeven" ? { isBreakeven: true } : op.payload.kind === "reduced_risk_half" ? { isHalfRisk: true, slHalfMoved: true } : op.payload.kind === "risk_free" ? { isRiskFree: true } : { isTrailing: true }) });
      }
      if (rec.position) await update(trade, { ticket: rec.position.ticket, brokerVolume: Number(rec.position.volume) });
    } else if (!rec.pending && rec.orderHistory && [2, 5, 6].includes(Number(rec.orderHistory.state))) {
      await terminal(trade, Number(rec.orderHistory.state) === 6 ? "expired" : "cancelled", "Broker pending order terminal state confirmed", { brokerStatus: "order_terminal_confirmed" });
    } else if (rec.pending && ["placing", "reconciling"].includes(trade.status)) {
      await update(trade, { status: "pending", orderTicket: rec.pending.ticket, operation: null, brokerStatus: "pending_limit" });
    }
    // Durable remote journal can conclusively report a rejected operation after timeout.
    if (trade.operation && rec.request?.state === "finished" && rec.request.response?.ok === false && !rec.request.response.ambiguous) {
      await resultOf(trade, rec.request.response);
      if (trade.operation.kind === "place") await terminal(trade, "invalidated", rec.request.response.message || "Order rejected", { brokerStatus: "rejected" });
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
    if (trade.entryVetoPending || trade.fillAllocationInvalid || trade.fillRiskInvalid) { await exit(trade, cfg, "entry_veto", price, trade.remainingVolume, "Entry permission/allocation vetoed after broker fill"); return; }
    const effectiveSl = (!trade.isBreakeven && !trade.slHalfMoved && trade.brokerLevels?.sl) ? trade.brokerLevels.sl : trade.slPrice;
    const stop = trade.dir === 1 ? price <= trade.slPrice : price >= effectiveSl;
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
    }
    // MODEL 1: Milestone 50 + Runner (Default Mode)
    else {
      // 1. At 50% target milestone -> book 40% quantity, move SL to breakeven!
      if (!trade.halfTargetBooked && !trade.tp1Done) {
        const halfTarget = calculateHalfTargetLevel(trade);
        const reachedHalf = (halfTarget.price && hit(halfTarget.price)) || (mark.unrealizedR >= halfTarget.halfRR);
        if (reachedHalf) {
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
          const beSl = breakevenPrice(trade, trade.symbolSpec);
          if (beSl && !trade.operation && (trade.dir === 1 ? beSl > trade.slPrice && beSl < price : beSl < trade.slPrice && beSl > price)) {
            await modify(trade, beSl, "breakeven");
          }
          return;
        }
      }

      // If 50% target was booked but stop loss has not yet transitioned to breakeven (e.g. while partial close was in-flight on MT5)
      if (trade.halfTargetBooked && !trade.isBreakeven) {
        const beSl = breakevenPrice(trade, trade.symbolSpec);
        if (beSl && (trade.dir === 1 ? beSl > trade.slPrice && beSl < price : beSl < trade.slPrice && beSl > price)) {
          await modify(trade, beSl, "breakeven");
          return;
        }
      }

      // 2. Full Target Exit (For Swing: NO 5R clamp! Target is unrestricted as per model/DOL)
      const isSwing = trade.scenario?.id === "swing" || trade.horizon === "swing" || trade.horizonCode === 1;
      const targetR = Number(trade.targetRR || (isSwing ? 10.0 : 5.0));
      const maxTargetPrice = Number((trade.entryPrice + trade.dir * (targetR * (trade.initialRiskDistance || 0))).toFixed(trade.symbolSpec?.digits || 5));
      const effectiveTpPrice = trade.tpPrice ? (isSwing ? trade.tpPrice : (trade.dir === 1 ? Math.min(trade.tpPrice, maxTargetPrice) : Math.max(trade.tpPrice, maxTargetPrice))) : maxTargetPrice;

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
        const tick = ticks[trade.symbol] || ticks[trade.canonicalSymbol];
        if (tick && (!(entryQuote(trade.dir, tick) > 0) || !(exitQuote(trade.dir, tick) > 0) || (tick.time && p.now() - Number(tick.time) > cfg.accountFreshnessMs))) continue;
        // Already filled positions remain managed when master/session/watchlist changes.
        if (store.ACTIVE_STATES.includes(trade.status)) { if (tick) await manage(trade, cfg, tick); continue; }
        if (trade.status === "staged") continue;
        if (["placing", "reconciling", "cancelling", "confirming"].includes(trade.status)) continue;
        if (trade.expiresAt && new Date(trade.expiresAt).getTime() <= p.now()) { await cancel(trade, "Pending entry expired"); continue; }
        if (trade.status === "armed") { if (tick) await place(trade, cfg, tick); continue; }
        if (trade.status !== "pending") continue;
        const check = await guard(trade, cfg, { cached: true });
        if (!check.permitted) { await update(trade, { vetoes: check.vetoes }); await cancel(trade, "Entry permission revoked"); continue; }
        if (!tick) continue;
        const price = entryQuote(trade.dir, tick);
        const stopPrice = trade.dir === 1 ? trade.initialSlPrice : (trade.brokerLevels?.sl || trade.initialSlPrice);
        const invalid = trade.dir === 1 ? exitQuote(trade.dir, tick) <= trade.initialSlPrice : exitQuote(trade.dir, tick) >= stopPrice;
        if (invalid) { await cancel(trade, "Invalidation breached before entry"); continue; }
        const entryTriggerPrice = trade.brokerLevels?.entry || trade.entryPrice;
        if (!trade.isLive && price > 0 && (trade.dir === 1 ? price <= entryTriggerPrice : price >= entryTriggerPrice)) {
          const fillCheck = await guard(trade, cfg, { cached: true });
          if (fillCheck.permitted) await confirmFill(trade, price, trade.lotSize);
          else await terminal(trade, "invalidated", "Thesis vetoed on entry tap", { vetoes: fillCheck.vetoes });
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
      for (const trade of (await findOpen()).filter((t) => t.isLive)) await reconcile(trade, cfg, state);
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
      g._tsAutonomousLeaderboard = { ...scan, scannedAt: new Date(p.now()), summary: { total: scan.totalScanned, prime: scan.primeCount, watching: scan.watchingCount, blocked: scan.blockedCount } };
      const { tradesCol } = await cols();
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
          return (sameSymbol && store.OPEN_STATES.includes(t.status)) || (t.fingerprint === fingerprint && age < cfg.dedupFingerprintWindowMinutes * 60000) || (sameSymbol && age < cfg.cooldownMinutes * 60000) || (sameSymbol && t.dir === setup.dir && ["closed_sl", "invalidated"].includes(t.status) && age < cfg.lossCooldownMinutes * 60000);
        })) continue;
        const groupId = `grp_${setup.symbol}_${setup.dir}_${p.now()}`;
        const riskDist = Math.abs(level.entry - level.sl);
        const isSwing = setup.scenario?.id === "swing" || setup.scenario?.horizonCode === 1;
        const defaultTargetRR = isSwing ? (level.targetRR || Math.abs(level.tp - level.entry) / riskDist) : Math.min(5.0, level.targetRR || Math.abs(level.tp - level.entry) / riskDist);

        // CFD Spread Friction & Microstructure Analysis
        const tick = pendingTicks[symbol] || pendingTicks[setup.symbol] || g._tsAutonomousTicks?.[symbol] || g._tsAutonomousTicks?.[setup.symbol];
        const spec = cfg.paperSymbolSpecs?.[symbol] || cfg.paperSymbolSpecs?.[setup.symbol] || specCache.get(symbol)?.spec || {};
        const spreadPrice = extractSpreadPrice(tick, spec);
        const digits = Number(spec.digits || 5);

        // Gatekeeper: Veto trade if spread exceeds 15% of Stop Loss distance
        if (cfg.vetoExcessiveFriction && !isSpreadAcceptable(spreadPrice, riskDist, cfg.maxSpreadToRisk || 0.15)) {
          notify(cfg, `⚠️ <b>${symbol}</b> | SPREAD VETO | ${spreadPrice} > 15% SL`, `${symbol}:VETO_SPREAD`);
          continue;
        }

        const frictionDefault = calculateSpreadFriction({
          dir: setup.dir,
          entryPrice: level.entry,
          slPrice: level.sl,
          tpPrice: level.tp,
          spread: spreadPrice,
          digits,
        });

        // 1. Leg A: Default Mode (50% Milestone + Runner)
        const routingDefault = resolveCopierRouting({
          symbol,
          canonicalSymbol: setup.symbol,
          scenario: setup.scenario,
          tf: level.tf,
          entryModel: setup.entryModel,
          modelId: level.modelId,
          managementLogic: "milestone_50",
        }, cfg.copierProfiles);

        const tradeDefault = {
          symbol, canonicalSymbol: setup.symbol, fingerprint, groupId, legId: "default", legLabel: "Default (50% Milestone + Runner)",
          dir: setup.dir, dirLabel: setup.dirLabel, status: "staged", executionMode: cfg.executionMode, isLive: Boolean(cfg.liveTrading),
          ticket: null, orderTicket: null, positionId: null, operation: null, brokerStatus: "not_submitted",
          entryPrice: level.entry, slPrice: level.sl, tpPrice: level.tp, initialSlPrice: level.sl, initialRiskDistance: riskDist, initialRiskUsd: 0,
          filledPrice: null, targets: level.targets || null, orderType: "limit", tf: level.tf, dealingRange: level.dealingRange,
          thesisId: level.thesisId, ideaId: level.ideaId, targetDOL: level.targetDOL || setup.brain?.targetDOL, modelId: level.modelId,
          confluenceBreakdown: level.confluenceBreakdown, evidence: level.evidence, partialExits: [], remainingFraction: 1,
          scenario: setup.scenario, stagedPrice: setup.currentPrice, currentPrice: setup.currentPrice, targetRR: Math.round(defaultTargetRR * 100) / 100,
          spreadPrice: frictionDefault.spreadPrice, spreadToRiskPct: frictionDefault.spreadToRiskPct, isFrictionExcessive: frictionDefault.isFrictionExcessive,
          idleRR: frictionDefault.idleRR, coveredRR: frictionDefault.coveredRR, frictionDragR: frictionDefault.frictionDragR, recoveryPct: frictionDefault.recoveryPct, brokerLevels: frictionDefault.brokerLevels,
          riskUsd: 0, lotSize: 0, unrealizedR: 0, unrealizedPnl: 0, levelDetails: level, stagedLevel: level, entryModel: setup.entryModel,
          brainSnapshot: setup.brain, brain: setup.brain, activeTimeSlot: setup.activeTimeSlot, opportunityScore: setup.opportunityScore,
          magicNumber: routingDefault.magicNumber, brokerComment: routingDefault.comment, copierRouting: routingDefault,
          eligibleAccounts: routingDefault.eligibleAccounts, managementLogic: "milestone_50",
          createdAt: new Date(p.now()), updatedAt: new Date(p.now()), events: [event("STAGED", "Qualified structural limit idea (Default Leg)", p.now())],
        };
        const insDefault = await tradesCol.insertOne(tradeDefault); tradeDefault._id = insDefault.insertedId;
        recent.push(tradeDefault); stagedCount++;

        // 2. Leg B: Prop-Firm Safe Mode (1.5R - 2.5R Bracket)
        const propTarget = resolveDynamicPropFirmTarget({
          entry: level.entry,
          sl: level.sl,
          dir: setup.dir,
          brain: setup.brain,
          ranges: setup.ranges || setup.brain?.ranges,
          htfFvg: setup.brain?.htfFvg,
          htfLiq: setup.brain?.htfLiquidity,
          evidence: level.evidence || setup.evidence,
          targets: level.targets,
          dealingRange: level.dealingRange || setup.dealingRange,
          scenario: setup.scenario,
          targetRR: level.targetRR,
          digits: 5,
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
          canonicalSymbol: setup.symbol,
          scenario: setup.scenario,
          tf: level.tf,
          entryModel: setup.entryModel,
          modelId: level.modelId,
          managementLogic: "prop_firm_safe",
        }, cfg.copierProfiles);

        const tradeProp = {
          symbol, canonicalSymbol: setup.symbol, fingerprint: `${fingerprint}_prop`, groupId, legId: "prop_firm", legLabel: "Prop-Firm Safe (1.5R–2.5R)",
          dir: setup.dir, dirLabel: setup.dirLabel, status: "staged", executionMode: cfg.executionMode, isLive: Boolean(cfg.liveTrading),
          ticket: null, orderTicket: null, positionId: null, operation: null, brokerStatus: "not_submitted",
          entryPrice: level.entry, slPrice: level.sl, tpPrice: propTp, initialSlPrice: level.sl, initialRiskDistance: riskDist, initialRiskUsd: 0,
          filledPrice: null, targets: [{ id: "tp1", price: propTp, fraction: 1.0, kind: "target", source: propTarget.source, landmarkType: propTarget.landmarkType, tf: propTarget.tf }], orderType: "limit", tf: level.tf, dealingRange: level.dealingRange,
          thesisId: level.thesisId, ideaId: `${level.ideaId}_prop`, targetDOL: level.targetDOL || setup.brain?.targetDOL, modelId: level.modelId,
          confluenceBreakdown: level.confluenceBreakdown, evidence: level.evidence, partialExits: [], remainingFraction: 1,
          scenario: setup.scenario, stagedPrice: setup.currentPrice, currentPrice: setup.currentPrice, targetRR: propRR,
          spreadPrice: frictionProp.spreadPrice, spreadToRiskPct: frictionProp.spreadToRiskPct, isFrictionExcessive: frictionProp.isFrictionExcessive,
          idleRR: frictionProp.idleRR, coveredRR: frictionProp.coveredRR, frictionDragR: frictionProp.frictionDragR, recoveryPct: frictionProp.recoveryPct, brokerLevels: frictionProp.brokerLevels,
          propTarget, targetLandmark: propTarget.source,
          riskUsd: 0, lotSize: 0, unrealizedR: 0, unrealizedPnl: 0, levelDetails: { ...level, tp: propTp, rr: propRR, propTarget }, stagedLevel: { ...level, tp: propTp, rr: propRR, propTarget }, entryModel: setup.entryModel,
          brainSnapshot: setup.brain, brain: setup.brain, activeTimeSlot: setup.activeTimeSlot, opportunityScore: setup.opportunityScore,
          magicNumber: routingProp.magicNumber, brokerComment: routingProp.comment, copierRouting: routingProp,
          eligibleAccounts: routingProp.eligibleAccounts, managementLogic: "prop_firm_safe",
          createdAt: new Date(p.now()), updatedAt: new Date(p.now()), events: [event("STAGED", `Qualified structural limit idea (Prop-Firm Leg: ${propTarget.source} @ ${propRR}R)`, p.now())],
        };
        const insProp = await tradesCol.insertOne(tradeProp); tradeProp._id = insProp.insertedId;
        recent.push(tradeProp); stagedCount++;

        if (cfg.executionMode !== "copilot" && cfg.enabled) {
          await arm(tradeDefault, cfg);
          await arm(tradeProp, cfg);
        }
      }
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
    for (const t of siblings) {
      t.executionMode = cfg.executionMode;
      t.isLive = Boolean(cfg.liveTrading);
      await update(t, { executionMode: cfg.executionMode, isLive: Boolean(cfg.liveTrading) });
      await arm(t, cfg);
    }
    return { ok: true, armedCount: siblings.length };
  }
  async function dismissStagedTrade(tradeId) {
    const { tradesCol } = await cols();
    const trade = await tradesCol.findOne({ _id: oid(tradeId) });
    if (!trade || !["staged", "armed", "pending", "placing", "reconciling", "cancelling"].includes(trade.status)) return { ok: false, error: "Entry already executed or unavailable" };
    const siblings = trade.groupId ? await tradesCol.find({ groupId: trade.groupId, status: { $in: ["staged", "armed", "pending", "placing", "reconciling", "cancelling"] } }).toArray() : [trade];
    for (const t of siblings) {
      await cancel(t, "Trader dismissed setup", true);
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
        : isSwing
          ? Math.max(0.5, Number(targetRR))
          : Math.min(5.0, Math.max(0.5, Number(targetRR)));
      newTp = Number((risk.entry + trade.dir * (distance * newRR)).toFixed(trade.symbolSpec?.digits || 5));
    } else if (tpPrice != null && Number.isFinite(Number(tpPrice))) {
      const rawRR = trade.dir * (Number(tpPrice) - risk.entry) / distance;
      if (rawRR <= 0) return { ok: false, error: "Target price must be in trade profit direction" };
      newRR = isPropFirm
        ? Math.min(2.5, Math.max(1.5, Math.round(rawRR * 100) / 100))
        : isSwing
          ? Math.max(0.5, Math.round(rawRR * 100) / 100)
          : Math.min(5.0, Math.max(0.5, Math.round(rawRR * 100) / 100));
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

