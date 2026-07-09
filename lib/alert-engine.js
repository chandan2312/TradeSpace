import { getCols, allWatchlists } from "./mongo.js";
import { bridge } from "./bridge.js";
import { sendTelegram } from "./telegram.js";
import { broadcast, subscribedSymbols, getWss } from "./realtime.js";

const g = globalThis;
const POLL_MS = Number(process.env.ALERT_POLL_MS || 500);

// lastPrice survives across poll cycles (needed for "cross" semantics).
if (!g._tsLastPrice) g._tsLastPrice = new Map();
const lastPrice = g._tsLastPrice;

export function shouldTrigger(alert, prev, price) {
  const p = alert.price;
  if (alert.condition === "above") return price >= p;
  if (alert.condition === "below") return price <= p;
  // cross: requires a prior sample on the opposite side
  if (prev === undefined || prev === null) return false;
  return (prev < p && price >= p) || (prev > p && price <= p);
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
      
      const cleanupRes = await alertsCol.deleteMany({ 
        status: "triggered", 
        triggeredAt: { $lt: yesterday } 
      });
      if (cleanupRes.deletedCount > 0) {
        console.log(`[alert-engine] cleaned up ${cleanupRes.deletedCount} stale alerts`);
        broadcast({ type: "alerts_changed" });
      }
    }

    const watchlists = await allWatchlists();
    const activeAlerts = await alertsCol.find({ status: "active" }).toArray();

    const symbols = new Set([
      ...activeAlerts.map((a) => a.symbol),
      ...watchlists.flatMap((w) => w.symbols || []),
    ]);
    for (const s of subscribedSymbols()) symbols.add(s);
    if (!symbols.size) return;

    const data = await bridge("POST", "/ticks", { symbols: [...symbols] });
    if (!data?.ticks) return;

    // 1) broadcast ticks to every client (watchlist sidebar + chart current-bar)
    const tickBatch = {};
    for (const [symbol, tick] of Object.entries(data.ticks)) {
      if (!tick.ok) continue;
      tickBatch[symbol] = {
        bid: tick.bid,
        ask: tick.ask,
        digits: tick.digits,
        time: tick.time_msc || (tick.time || 0) * 1000,
      };
    }
    if (Object.keys(tickBatch).length) broadcast({ type: "ticks", ticks: tickBatch });

    // 2) evaluate alerts
    for (const [symbol, tick] of Object.entries(data.ticks)) {
      if (!tick.ok) continue;
      const price = tick.bid || tick.last || tick.ask;
      if (!price) continue;

      const prev = lastPrice.get(symbol);
      lastPrice.set(symbol, price);

      for (const alert of activeAlerts.filter((a) => a.symbol === symbol)) {
        if (!shouldTrigger(alert, prev, price)) continue;
        // atomic active→triggered so overlapping polls can't double-fire
        const flipped = await alertsCol.updateOne(
          { _id: alert._id, status: "active" },
          { $set: { status: "triggered", triggeredAt: new Date(), triggeredPrice: price } }
        );
        if (!flipped.modifiedCount) continue;
        const dir = alert.condition === "above" ? "🟢 above" : alert.condition === "below" ? "🔴 below" : "⚪ crossed";
        const msg = `🔔 <b>${alert.symbol}</b> ${dir} <b>${alert.price}</b>` + (alert.note ? `\n📝 ${alert.note}` : "");
        sendTelegram(msg);
        broadcast({
          type: "alert_triggered",
          alert: { ...alert, status: "triggered", triggeredPrice: price },
        });
        console.log(`[alert] triggered ${alert.symbol} ${alert.condition} ${alert.price} @ ${price}`);
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
  pollOnce();
  setInterval(() => pollOnce(), POLL_MS);
  console.log(`[alert-engine] poll loop started (${POLL_MS}ms)`);
}
