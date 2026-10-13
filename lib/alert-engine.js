import { getCols, allWatchlists } from "./mongo.js";
import { bridge } from "./bridge.js";
import { sendTelegram } from "./telegram.js";
import { broadcast, subscribedSymbols, getWss } from "./realtime.js";
import { onTicks as algoOnTicks } from "./algo/engine.js";
import { executorOnTicks } from "./executor/engine.js";
import { autonomousOnTicks, getAutonomousTickSymbols } from "./autonomous/engine.js";
import { getMT5Ticks } from "./autonomous/mt5.js";
import { toCanonicalSymbol, toBrokerSymbol } from "./symbols/mapping.js";

const g = globalThis;
const POLL_MS = Number(process.env.ALERT_POLL_MS || 1500);

// lastPrice survives across poll cycles (needed for "cross" semantics).
if (!g._tsLastPrice) g._tsLastPrice = new Map();
const lastPrice = g._tsLastPrice;

export function invalidateAlertsCache() {
  g._tsAlertsCache = null;
  g._tsAlertsAt = 0;
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

    // Auto-delete triggered alerts older than 24 hours (runs roughly once per hour)
    if (!g._tsLastCleanup || Date.now() - g._tsLastCleanup > 3600000) {
      g._tsLastCleanup = Date.now();
      const yesterday = new Date(Date.now() - 24 * 3600000);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000);
      
      const cleanupRes = await alertsCol.deleteMany({ 
        status: "triggered", 
        $or: [
          {
            rating: { $in: [2, 3] },
            $or: [
              { triggeredAt: { $lt: sevenDaysAgo } },
              { triggeredAt: null, createdAt: { $lt: sevenDaysAgo } }
            ]
          },
          {
            rating: { $nin: [2, 3] },
            $or: [
              { triggeredAt: { $lt: yesterday } },
              { triggeredAt: null, createdAt: { $lt: yesterday } }
            ]
          }
        ]
      });
      if (cleanupRes.deletedCount > 0) {
        console.log(`[alert-engine] cleaned up ${cleanupRes.deletedCount} stale alerts`);
        broadcast({ type: "alerts_changed" });
      }
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

    const symbols = new Set([
      ...activeAlerts.map((a) => a.symbol),
      ...watchlists.flatMap((w) => w.symbols || []),
      ...autonomousSymbols,
    ]);
    for (const s of subscribedSymbols()) symbols.add(s);
    for (const s of g._tsAlgoSymbols || []) symbols.add(s); // algo open-trade symbols
    for (const s of g._tsExecSymbols || []) symbols.add(s); // executor open-trade symbols
    if (!symbols.size) return;

    // Autonomous quotes are always sourced from the explicitly remote bridge.
    // Shared chart bridge clients keep their current market/data compatibility.
    const brokerSymbols = Array.from(new Set(Array.from(symbols).map((s) => toBrokerSymbol(s))));
    const brokerAutonomousSymbols = Array.from(new Set(autonomousSymbols.map((s) => toBrokerSymbol(s))));

    const [shared, remote] = await Promise.all([
      brokerSymbols.length ? bridge("POST", "/ticks", { symbols: brokerSymbols }).catch(() => null) : null,
      brokerAutonomousSymbols.length ? getMT5Ticks(brokerAutonomousSymbols) : null,
    ]);
    const remoteTicks = Object.fromEntries(Object.entries(remote?.ticks || {}).filter(([, tick]) => tick.ok));
    const rawTicks = { ...(shared?.ticks || {}), ...remoteTicks };

    // 1) broadcast ticks to every client (watchlist sidebar + chart current-bar)
    // Ticks are broadcast under CANONICAL symbol keys so entire app receives unified feed
    const tickBatch = {};
    for (const [brokerSym, tick] of Object.entries(rawTicks)) {
      if (!tick.ok) continue;
      const canonSym = toCanonicalSymbol(brokerSym);
      const formatted = {
        bid: tick.bid,
        ask: tick.ask,
        digits: tick.digits,
        time: tick.time_msc || (tick.time || 0) * 1000,
        symbol: canonSym,
        brokerSymbol: brokerSym,
      };
      tickBatch[canonSym] = formatted;
      if (brokerSym !== canonSym && !tickBatch[brokerSym]) {
        tickBatch[brokerSym] = formatted;
      }
    }

    if (Object.keys(tickBatch).length) {
      broadcast({ type: "ticks", ticks: tickBatch });
      algoOnTicks(tickBatch).catch(() => {}); // paper-trade monitor rides the same feed
      executorOnTicks(tickBatch).catch(() => {}); // executor monitor rides the same feed
      const autonomousBatch = {};
      for (const [brokerSym, tick] of Object.entries(remote?.ticks || {})) {
        if (!tick.ok) continue;
        const canonSym = toCanonicalSymbol(brokerSym);
        const formatted = {
          bid: tick.bid,
          ask: tick.ask,
          digits: tick.digits,
          time: tick.time_msc || (tick.time || 0) * 1000,
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
        
        let photoUrl = null;
        try {
          const { getFrames } = await import("./bias/data.js");
          const { generateSparklineUrl } = await import("./quickchart.js");
          const frames = await getFrames(alert.symbol);
          if (frames) {
             photoUrl = generateSparklineUrl(frames, alert.price, alert.condition === "above" ? "#4CAF50" : "#F44336");
          }
        } catch (e) {
          console.error("[alert] chart generation failed:", e);
        }

        const telegramType = (alert.rating === 3 || alert.rating === 2) ? "PRIORITY" : "PRICE";
        sendTelegram(msg, telegramType, photoUrl);
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
    setTimeout(startPollLoop, 500);
    return;
  }
  // immediate first tick, then interval. Re-arming avoids overlapping slow bridges.
  pollOnce().catch((err) => console.error("[alert poll error]", err?.message || err));
  setInterval(() => {
    pollOnce().catch((err) => console.error("[alert poll error]", err?.message || err));
  }, POLL_MS);
  console.log(`[alert-engine] poll loop started (${POLL_MS}ms)`);
}
