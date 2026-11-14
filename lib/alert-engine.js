import { getCols, allWatchlists } from "./mongo.js";
import { bridge } from "./bridge.js";
import { sendTelegram } from "./telegram.js";
import { broadcast, broadcastTicks, subscribedSymbols, activeChartSymbols, getWss } from "./realtime.js";
import { executorOnTicks } from "./executor/engine.js";
import { autonomousOnTicks, getAutonomousTickSymbols } from "./autonomous/engine.js";
import { getMT5Ticks } from "./autonomous/mt5.js";
import { toCanonicalSymbol, toBrokerSymbol } from "./symbols/mapping.js";
import { brokerTimestampToUtcMs, getTradingDayKey, getTradingDayStartSec } from "./time.js";

const g = globalThis;

// 3-Tier Demand-Driven Polling Engine Constants:
// Tier 1: 1500ms for symbols with charts actively viewed on screen
// Tier 2: 5000ms for symbols with active alerts or open execution positions (day-trading cadence)
// Tier 3: 60000ms (1 min) for passive background watchlist & bias symbols
export const TIER_1_CHART_POLL_MS = Number(process.env.TIER_1_CHART_POLL_MS || 1500);
export const TIER_2_ALERT_POLL_MS = Number(process.env.TIER_2_ALERT_POLL_MS || 5000);
export const TIER_3_BIAS_POLL_MS  = Number(process.env.TIER_3_BIAS_POLL_MS  || 60000);

// lastPrice survives across poll cycles (needed for "cross" semantics).
if (!g._tsLastPrice) g._tsLastPrice = new Map();
const lastPrice = g._tsLastPrice;

export function invalidateAlertsCache() {
  g._tsAlertsCache = null;
  g._tsAlertsAt = 0;
  if (g._tsAlertsRouteCache) g._tsAlertsRouteCache.clear();
}

/**
 * Prunes triggered alerts from previous trading days permanently from MongoDB.
 * Strictly uses Europe/Athens trading day boundaries (Rule 1.7).
 * Active and pending_chain alerts are preserved indefinitely until triggered or deleted.
 */
export async function pruneStaleTriggeredAlerts() {
  try {
    const { alertsCol } = await getCols();
    const todayStartSec = getTradingDayStartSec(new Date());
    const todayStartDate = new Date(todayStartSec * 1000);

    const cleanupRes = await alertsCol.deleteMany({
      status: "triggered",
      $or: [
        { triggeredAt: { $lt: todayStartDate } },
        { triggeredAt: null, createdAt: { $lt: todayStartDate } }
      ]
    });

    if (cleanupRes.deletedCount > 0) {
      console.log(`[alert-engine] pruned ${cleanupRes.deletedCount} stale triggered alerts from prior trading days`);
      invalidateAlertsCache();
      broadcast({ type: "alerts_changed" });
    }
    return cleanupRes.deletedCount || 0;
  } catch (err) {
    console.error("[alert-engine] error pruning stale triggered alerts:", err?.message);
    return 0;
  }
}

export function shouldTrigger(step, prev, price) {
  const p = Number(step?.price);
  const cur = Number(price);
  if (!Number.isFinite(p) || !Number.isFinite(cur)) return false;

  if (step.condition === "above") return cur >= p;
  if (step.condition === "below") return cur <= p;

  // condition === "cross":
  const ref = prev != null && Number.isFinite(Number(prev))
    ? Number(prev)
    : (step.initialPrice != null && Number.isFinite(Number(step.initialPrice)) ? Number(step.initialPrice) : null);

  if (ref == null) {
    // Cold start with no prior reference:
    // If current quote is right at the target price (within 0.05% tolerance), trigger on first touch
    const tolerance = Math.max(Math.abs(p) * 0.0005, 0.0001);
    return Math.abs(cur - p) <= tolerance;
  }

  // Crossing detection:
  // 1. Upward touch/cross: was <= p and is now >= p (with cur !== ref)
  if (ref <= p && cur >= p && cur !== ref) return true;
  // 2. Downward touch/cross: was >= p and is now <= p (with cur !== ref)
  if (ref >= p && cur <= p && cur !== ref) return true;

  return false;
}

// One poll tick: fetch ticks for the union of {active alerts ∪ watchlists ∪
// subscribed charts}, broadcast them, then evaluate every active alert.
export async function pollOnce() {
  if (g._tsPolling) return;
  g._tsPolling = true;
  try {
    const { alertsCol } = await getCols();

    // Auto-delete triggered alerts from previous trading days permanently from MongoDB
    // Evaluated dynamically on trading day rollover, at initial startup, or every 5 minutes
    const currentDayKey = getTradingDayKey(new Date());
    const isDayRollover = g._tsLastTradingDayKey && g._tsLastTradingDayKey !== currentDayKey;
    g._tsLastTradingDayKey = currentDayKey;

    if (!g._tsLastCleanup || isDayRollover || Date.now() - g._tsLastCleanup > 300_000) {
      g._tsLastCleanup = Date.now();
      await pruneStaleTriggeredAlerts();
    }

    const now = Date.now();
    if (!g._tsWatchlistsCache || now - (g._tsWatchlistsAt || 0) > 3000) {
      g._tsWatchlistsCache = await allWatchlists().catch(() => []);
      g._tsWatchlistsAt = now;
    }
    const watchlists = g._tsWatchlistsCache;

    if (!g._tsAlertsCache || now - (g._tsAlertsAt || 0) > 2000) {
      g._tsAlertsCache = await alertsCol.find({ status: "active" }).toArray().catch(() => []);
      g._tsAlertsAt = now;
    }
    const activeAlerts = g._tsAlertsCache;
    const autonomousSymbols = await getAutonomousTickSymbols().catch(() => []);

    const activeCharts = activeChartSymbols();
    const alertSymbols = new Set((activeAlerts || []).map((a) => String(a.symbol).toUpperCase()));
    const execSymbols = new Set([
      ...(g._tsAlgoSymbols || []).map((s) => String(s).toUpperCase()),
      ...(g._tsExecSymbols || []).map((s) => String(s).toUpperCase()),
    ]);

    const allCandidates = new Set([
      ...activeCharts,
      ...alertSymbols,
      ...execSymbols,
      ...watchlists.flatMap((w) => w.symbols || []).map((s) => String(s).toUpperCase()),
      ...autonomousSymbols.map((s) => String(s).toUpperCase()),
      ...Array.from(subscribedSymbols()).map((s) => String(s).toUpperCase()),
    ]);
    if (!allCandidates.size) return;

    if (!g._tsSymbolLastPoll) g._tsSymbolLastPoll = new Map();
    if (!g._tsUnmappedSymbols) g._tsUnmappedSymbols = new Map();
    const symbolsToPoll = new Set();

    for (const rawSym of allCandidates) {
      if (!rawSym) continue;
      const sym = String(rawSym).toUpperCase();

      // Suppress polling symbols that MT5 failed to map/find for 60 seconds
      const unmappedAt = g._tsUnmappedSymbols.get(sym);
      if (unmappedAt && (now - unmappedAt < 60_000)) {
        continue;
      }

      const lastPoll = g._tsSymbolLastPoll.get(sym) || 0;
      const elapsed = now - lastPoll;

      if (activeCharts.has(sym)) {
        // Tier 1: Active chart symbol viewed on screen -> 1500ms
        if (elapsed >= TIER_1_CHART_POLL_MS) {
          symbolsToPoll.add(sym);
        }
      } else if (alertSymbols.has(sym) || execSymbols.has(sym)) {
        // Tier 2: Active alert or open trade -> 5000ms
        if (elapsed >= TIER_2_ALERT_POLL_MS) {
          symbolsToPoll.add(sym);
        }
      } else {
        // Tier 3: Passive background watchlist / bias symbol -> 60000ms (1 min)
        if (elapsed >= TIER_3_BIAS_POLL_MS) {
          symbolsToPoll.add(sym);
        }
      }
    }

    if (!symbolsToPoll.size) return;

    // Immediately advance lastPoll for all polled candidates to prevent rapid-fire retries on omissions or failures
    for (const sym of symbolsToPoll) {
      g._tsSymbolLastPoll.set(sym, now);
      const broker = toBrokerSymbol(sym).toUpperCase();
      if (broker !== sym) g._tsSymbolLastPoll.set(broker, now);
    }

    // Autonomous quotes are sourced from remote bridge if distinct, otherwise unified in 1 call:
    const brokerSymbols = Array.from(new Set(Array.from(symbolsToPoll).map((s) => toBrokerSymbol(s))));
    const brokerAutonomousSymbols = Array.from(new Set(autonomousSymbols.filter((s) => symbolsToPoll.has(String(s).toUpperCase())).map((s) => toBrokerSymbol(s))));
    const isDistinctRemote = Boolean(process.env.AUTONOMOUS_MT5_REMOTE_URL && process.env.AUTONOMOUS_MT5_REMOTE_URL !== process.env.MT5_BRIDGE_URL);

    let shared = null;
    let remote = null;

    if (!isDistinctRemote) {
      // Unified single-batch fetch to eliminate duplicate bridge calls and MT5 GIL lock contention
      const allBrokerSymbols = Array.from(new Set([...brokerSymbols, ...brokerAutonomousSymbols]));
      shared = allBrokerSymbols.length ? await bridge("POST", "/ticks", { symbols: allBrokerSymbols }, { timeoutMs: 4_000, priority: true }).catch(() => null) : null;
      remote = shared;
    } else {
      [shared, remote] = await Promise.all([
        brokerSymbols.length ? bridge("POST", "/ticks", { symbols: brokerSymbols }, { timeoutMs: 4_000, priority: true }).catch(() => null) : null,
        brokerAutonomousSymbols.length ? getMT5Ticks(brokerAutonomousSymbols) : null,
      ]);
    }
    const remoteTicks = Object.fromEntries(Object.entries(remote?.ticks || {}).filter(([, tick]) => tick.ok));
    const rawTicks = { ...(shared?.ticks || {}), ...remoteTicks };

    // Record last poll timestamp and unmapped status for each returned symbol
    for (const [brokerSym, tick] of Object.entries(rawTicks)) {
      const canonSym = toCanonicalSymbol(brokerSym);
      const canonUpper = canonSym.toUpperCase();
      const brokerUpper = brokerSym.toUpperCase();

      // Always advance lastPoll to prevent infinite 0-delay hammering of missing symbols
      g._tsSymbolLastPoll.set(canonUpper, now);
      g._tsSymbolLastPoll.set(brokerUpper, now);

      if (!tick.ok) {
        if (tick.status === "symbol-missing" || tick.status === "symbol-unavailable" || !tick.bid) {
          g._tsUnmappedSymbols.set(canonUpper, now);
          g._tsUnmappedSymbols.set(brokerUpper, now);
        }
        continue;
      }

      // If tick is valid, clear any prior unmapped flag
      g._tsUnmappedSymbols.delete(canonUpper);
      g._tsUnmappedSymbols.delete(brokerUpper);
    }

    // 1) Delta-filtering: broadcast to clients only when price changes or on 15s heartbeat
    // Eliminates redundant WebSocket traffic and prevents needless React re-render churn
    if (!g._tsLastBroadcastTick) g._tsLastBroadcastTick = new Map();
    const tickBatch = {};
    for (const [brokerSym, tick] of Object.entries(rawTicks)) {
      if (!tick.ok) continue;
      const canonSym = toCanonicalSymbol(brokerSym);
      const prev = g._tsLastBroadcastTick.get(canonSym);
      const isHeartbeat = !prev || (now - (prev.broadcastAt || 0) > 15000);
      const priceChanged = !prev || prev.bid !== tick.bid || prev.ask !== tick.ask;

      if (priceChanged || isHeartbeat) {
        const formatted = {
          bid: tick.bid,
          ask: tick.ask,
          digits: tick.digits,
          time: brokerTimestampToUtcMs(tick.time_msc || (tick.time || 0) * 1000),
          symbol: canonSym,
          brokerSymbol: brokerSym,
        };
        tickBatch[canonSym] = formatted;
        if (brokerSym !== canonSym && !tickBatch[brokerSym]) {
          tickBatch[brokerSym] = formatted;
        }
        g._tsLastBroadcastTick.set(canonSym, { bid: tick.bid, ask: tick.ask, broadcastAt: now });
      }
    }

    if (Object.keys(tickBatch).length) {
      broadcastTicks(tickBatch);
      executorOnTicks(tickBatch).catch(() => {}); // executor monitor rides the same feed
      const autonomousBatch = {};
      for (const [brokerSym, tick] of Object.entries(remote?.ticks || {})) {
        if (!tick.ok) continue;
        const canonSym = toCanonicalSymbol(brokerSym);
        const formatted = {
          bid: tick.bid,
          ask: tick.ask,
          digits: tick.digits,
          time: brokerTimestampToUtcMs(tick.time_msc || (tick.time || 0) * 1000),
          symbol: canonSym,
          brokerSymbol: brokerSym,
        };
        autonomousBatch[canonSym] = formatted;
        if (brokerSym !== canonSym && !autonomousBatch[brokerSym]) {
          autonomousBatch[brokerSym] = formatted;
        }
      }
      // Never execute autonomous positions against a local/default quote feed.
      if (Object.keys(autonomousBatch).length) autonomousOnTicks(autonomousBatch).catch(() => {});
    }

    // 2) evaluate alerts
    for (const [sym, tick] of Object.entries(tickBatch)) {
      const price = tick.bid || tick.last || tick.ask;
      if (!price) continue;

      const canonSym = toCanonicalSymbol(sym);
      const prev = lastPrice.get(canonSym) ?? lastPrice.get(sym);
      lastPrice.set(canonSym, price);
      lastPrice.set(sym, price);

      const matching = activeAlerts.filter((a) => {
        if (a.status !== "active") return false;
        return a.symbol === sym || a.symbol === canonSym || toCanonicalSymbol(a.symbol) === canonSym;
      });

      for (const alert of matching) {
        if (!shouldTrigger(alert, prev, price)) continue;

        // atomic active→triggered so overlapping polls can't double-fire
        const flipped = await alertsCol.updateOne(
          { _id: alert._id, status: "active" },
          { $set: { status: "triggered", triggeredAt: new Date(), triggeredPrice: price } }
        );
        if (!flipped.modifiedCount) continue;
        alert.status = "triggered";

        const fmtPrice = (p) => parseFloat(Number(p).toFixed(5));
        console.log(`[alert] triggered ${alert.symbol} ${alert.condition} ${fmtPrice(alert.price)} @ ${fmtPrice(price)}`);

        // Group Chaining Logic: check if there's a NEXT alert in this chain
        if (alert.chainId) {
           const nextAlert = await alertsCol.findOne({ chainId: alert.chainId, chainOrder: alert.chainOrder + 1, status: "pending_chain" });
           if (nextAlert) {
              // Activate next alert! Do NOT send telegram/broadcast for THIS intermediate alert triggering.
              const activated = await alertsCol.updateOne(
                 { _id: nextAlert._id, status: "pending_chain" },
                 { $set: { status: "active" } }
              );
              if (activated.modifiedCount) {
                 console.log(`[alert] chain link ${alert.chainOrder} triggered. Activated link ${nextAlert.chainOrder}.`);
                 broadcast({ type: "alerts_changed" });
              }
              continue; // skip the notification for this intermediate alert
           }
        }

        // If no next alert (or no chainId), this is the FINAL or standalone alert. Fire notification!
        const dir = alert.condition === "above" ? "🟢 above" : alert.condition === "below" ? "🔴 below" : "⚪ crossed";
        const msgPrefix = alert.chainId ? `🔗 <b>Chain Alert Complete</b>\n` : ``;
        const msg = `${msgPrefix}🔔 <b>${alert.symbol}</b> ${dir} <b>${fmtPrice(alert.price)}</b>` + (alert.note ? `\n📝 ${alert.note}` : "");
        
        const telegramType = (alert.rating === 3 || alert.rating === 2) ? "PRIORITY" : "PRICE";
        sendTelegram(msg, telegramType);
        broadcast({
          type: "alert_triggered",
          alert: { ...alert, status: "triggered", triggeredPrice: price },
        });
      }
    }
  } catch (err) {
    console.error("[poll] error:", err.message);
  } finally {
    g._tsPolling = false;
  }
}

export function startPollLoop() {
  // ensure we actually have a WS to broadcast to (custom server boot order)
  if (!getWss()) {
    setTimeout(startPollLoop, 250);
    return;
  }
  // 3-Tier Demand-Driven Pacing Loop:
  let active = false;
  const cycle = async () => {
    if (active) return;
    active = true;
    try {
      await pollOnce();
    } catch (err) {
      console.error("[alert poll error]", err?.message || err);
    } finally {
      active = false;
      // Dynamic loop pacing:
      // Tier 1 (1500ms): When user is viewing an active chart on screen
      // Tier 2 (5000ms): When user is away but active alerts or open positions exist
      // Tier 3 (15000ms): When completely idle
      const activeCharts = activeChartSymbols();
      const hasAlerts = (g._tsAlertsCache?.length || 0) > 0;
      const hasExec = (g._tsExecSymbols?.length || 0) > 0 || (g._tsAlgoSymbols?.length || 0) > 0;

      let nextDelay;
      if (activeCharts.size > 0) {
        nextDelay = TIER_1_CHART_POLL_MS;
      } else if (hasAlerts || hasExec) {
        nextDelay = TIER_2_ALERT_POLL_MS;
      } else {
        nextDelay = 15000;
      }
      setTimeout(cycle, nextDelay);
    }
  };
  cycle();
  console.log(`[alert-engine] 3-tier demand-driven poll loop active (Tier 1: ${TIER_1_CHART_POLL_MS}ms, Tier 2: ${TIER_2_ALERT_POLL_MS}ms, Tier 3: ${TIER_3_BIAS_POLL_MS}ms)`);
}
