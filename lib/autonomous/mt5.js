import { calculateRiskSize } from "./risk.js";
import { canonOf } from "./symbols.js";

export function autonomousRemoteConfig(env = process.env) {
  const raw = env.AUTONOMOUS_MT5_REMOTE_URL || env.NEXUS_MT5_REMOTE_URL || env.MT5_BRIDGE_URL || "http://127.0.0.1:8765";
  const token = env.AUTONOMOUS_MT5_REMOTE_TOKEN || env.NEXUS_MT5_REMOTE_TOKEN || env.MT5_TOKEN || env.MT5_BRIDGE_TOKEN || "";
  return { url: raw.replace(/\/$/, ""), token };
}

export async function autonomousBridge(method, path, payload, { timeoutMs = 15000 } = {}) {
  const { url, token } = autonomousRemoteConfig();
  const response = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: method === "POST" ? JSON.stringify(payload || {}) : undefined, signal: AbortSignal.timeout(timeoutMs), cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error(`Remote MT5 bridge HTTP ${response.status}`);
  return response.json();
}

async function read(path, payload, method = "POST") {
  try { return await autonomousBridge(method, path, payload, { timeoutMs: 15000 }); }
  catch (err) { return { ok: false, error: err.message }; }
}
async function write(path, payload) {
  try {
    const res = await autonomousBridge("POST", path, payload, { timeoutMs: 15000 });
    return { ...res, error: res.ok ? undefined : res.error || res.message, ambiguous: res.ambiguous === true };
  } catch (err) {
    // Once dispatched a timeout is not rejection. Callers persist the operation.
    return { ok: false, ambiguous: true, error: err.message };
  }
}

export async function executeMT5Order({ symbol, action, volume, sl, tp, entryPrice, orderType = "limit", expiresAt, requestId, accountLogin, comment = "TradeSpace Brain", magic = 231223 }) {
  if (!(Number(volume) > 0) || !["buy", "sell"].includes(action)) return { ok: false, error: "Invalid order direction/volume" };
  // Many brokers strictly reject custom expiration timestamps on Index/Commodity CFDs (e.g. GER40, US30, NAS100).
  // TradeSpace autonomously monitors trade.expiresAt and cancels expired pending orders internally.
  const clean = canonOf(symbol || "");
  const isCfdIndex = /^(GER|DE|DAX|US|NAS|NDX|SPX|UK|FTSE|JP|NIK)/i.test(clean) || /^(GER|DE|DAX|US|NAS|NDX|SPX|UK|FTSE|JP|NIK)/i.test(symbol || "");
  const expirationEpoch = (!isCfdIndex && expiresAt) ? Math.floor(new Date(expiresAt).getTime() / 1000) : undefined;
  return write("/order", { symbol, action, volume: Number(volume), sl: Number(sl), tp: Number(tp), entry_price: Number(entryPrice), order_type: orderType, expiration: expirationEpoch, request_id: requestId, account_login: accountLogin, comment: comment.slice(0, 31), magic, structural_levels: true });
}
export function modifyMT5Order({ ticket, sl, tp, requestId, accountLogin }) {
  if (!ticket) return Promise.resolve({ ok: false, error: "Position ticket required" });
  return write("/modify", { ticket, sl, tp, request_id: requestId, account_login: accountLogin });
}
export function closeMT5Position({ ticket, volume, requestId, accountLogin }) {
  if (!ticket || (volume !== undefined && !(volume > 0))) return Promise.resolve({ ok: false, error: "Valid position ticket/volume required" });
  return write("/close", { ticket, volume, request_id: requestId, account_login: accountLogin }); // Never retry via another endpoint.
}
export function cancelMT5Order({ orderTicket, requestId, accountLogin }) { return write("/cancel", { ticket: orderTicket, request_id: requestId, account_login: accountLogin }); }
export function getMT5Positions(symbol) { return read("/positions", symbol ? { sym: symbol } : {}); }
export function getMT5Orders(symbol) { return read("/orders", symbol ? { sym: symbol } : {}); }
export function getMT5Account() { return read("/account", undefined, "GET"); }
export function getMT5Symbol(symbol) { return read("/symbol", { sym: symbol }); }
export function getMT5History({ days = 7, symbol } = {}) { return read("/history", { days, ...(symbol ? { sym: symbol } : {}) }); }
function completeBrokerSnapshot(snapshot) {
  const finite = value => value != null && Number.isFinite(Number(value));
  return snapshot?.ok === true && snapshot.account && finite(snapshot.account.login) && snapshot.account.login > 0 &&
    finite(snapshot.account.balance) && finite(snapshot.account.equity) &&
    ["positions", "orders", "history", "order_history", "requests"].every(key => Array.isArray(snapshot[key])) &&
    finite(snapshot.dailyPnl) && finite(snapshot.dayStartEquity) && finite(snapshot.at) && snapshot.at > 0 &&
    finite(snapshot.brokerDayStart) && snapshot.brokerDayStart > 0 && Number(snapshot.brokerDayStart) <= Number(snapshot.at);
}
export async function getMT5State({ days = 7 } = {}) {
  const direct = await read("/state", { days });
  if (direct?.ok) {
    if (!completeBrokerSnapshot(direct)) return { ok: false, error: "Incomplete remote broker snapshot" };
    return direct;
  }
  // Resilient fallback: if /state endpoint is not available on the remote server (e.g. HTTP 404),
  // query /account, /positions, and /history to construct a complete snapshot.
  try {
    const acc = await getMT5Account();
    if (acc?.ok && acc.account && Number(acc.account.login) > 0) {
      const [posRes, ordRes, histRes] = await Promise.all([
        getMT5Positions().catch(() => ({ positions: [] })),
        getMT5Orders().catch(() => ({ orders: [] })),
        getMT5History({ days }).catch(() => ({ history: [] })),
      ]);
      const nowSec = Math.floor(Date.now() / 1000);
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const brokerDayStart = Math.floor(startOfDay.getTime() / 1000);
      const account = acc.account;
      const history = Array.isArray(histRes?.history) ? histRes.history : [];
      const positions = Array.isArray(posRes?.positions) ? posRes.positions : [];
      const orders = Array.isArray(ordRes?.orders) ? ordRes.orders : [];
      const dailyDeals = history.filter((d) => Number(d.time) >= brokerDayStart && (Number(d.entry) === 1 || (d.symbol && Number(d.volume) > 0 && d.type !== "OTHER")));
      const dailyPnl = dailyDeals.reduce((sum, d) => sum + Number(d.profit || 0) + Number(d.swap || 0) + Number(d.commission || 0) + Number(d.fee || 0), 0) + Number(account.profit || 0);
      const dayStartEquity = Number(account.balance) - dailyPnl;

      const synth = {
        ok: true,
        account,
        positions,
        orders,
        history,
        order_history: [],
        requests: [],
        dailyPnl,
        dayStartEquity: dayStartEquity > 0 ? dayStartEquity : Number(account.balance),
        brokerDayStart,
        at: nowSec,
      };
      return synth;
    }
  } catch { /* ignore fallback errors */ }
  return { ok: false, error: direct?.error || direct?.message || "Remote broker snapshot unavailable" };
}
export function getMT5Ticks(symbols) { return read("/ticks", { symbols }); }
export function getMT5MicroBars(symbol) { return read("/rates", { sym: symbol, timeframe: "M5", count: 120 }); }
export async function getMT5LossPerLot({ symbol, dir, entryPrice, slPrice }) {
  const direct = await read("/calc-profit", { symbol, action: dir === 1 ? "buy" : "sell", entry_price: entryPrice, sl: slPrice, volume: 1 });
  if (direct?.ok && Number(direct.lossPerLot) > 0) return direct;
  try {
    const symRes = await getMT5Symbol(symbol);
    if (symRes?.ok && symRes.symbol) {
      const sym = symRes.symbol;
      const size = Number(sym.trade_tick_size);
      const value = Number(sym.trade_tick_value_loss || sym.trade_tick_value);
      if (size > 0 && value > 0 && Number(entryPrice) > 0 && Number(slPrice) > 0) {
        const lossPerLot = Math.abs(Number(entryPrice) - Number(slPrice)) / size * value;
        return { ok: true, lossPerLot };
      }
    }
  } catch { /* ignore fallback calculation error */ }
  return direct;
}

export function calculateInstitutionalPositionSize({
  riskUsd,
  entryPrice,
  slPrice,
  symInfo = {},
  accInfo = {},
  lossPerLot: explicitLoss,
  allowMinLotFallback = false,
  enforceDollarRiskCaps = true,
}) {
  const budget = Number(riskUsd);
  const balance = Number(accInfo.balance);
  if (!Number.isFinite(budget) || budget <= 0) return 0;
  const safeRiskUsd = (enforceDollarRiskCaps && Number.isFinite(balance) && balance > 0) ? Math.min(budget, balance * 0.1) : budget;
  return calculateRiskSize({
    riskUsd: safeRiskUsd,
    entryPrice,
    slPrice,
    symInfo,
    lossPerLot: explicitLoss,
    allowMinLotFallback: !enforceDollarRiskCaps || allowMinLotFallback,
  }).lotSize;
}

// A pending order ticket, position ticket and position identifier are distinct.
// Absence from positions is never, by itself, evidence of a close.
export function reconcileBrokerSnapshot(trade, snapshot) {
  if (!completeBrokerSnapshot(snapshot)) return { known: false, closed: false };
  const eq = (a, b) => a != null && b != null && String(a) === String(b);
  const request = snapshot.requests?.find((r) => r.request_id === trade.operation?.requestId);
  const orderTicket = trade.orderTicket || request?.response?.orderTicket || request?.response?.ticket || (!trade.brokerComment ? trade.ticket : null);
  const token = trade.brokerComment;
  const magic = trade.magicNumber ? Number(trade.magicNumber) : null;
  const matchMagic = (item) => magic != null && item?.magic != null && Number(item.magic) === magic;
  const matchToken = (item) => Boolean(token && item?.comment && (item.comment === token || item.comment.startsWith(token.slice(0, 20))));

  const pending = snapshot.orders?.find((o) =>
    eq(o.ticket, orderTicket) ||
    (matchMagic(o) && matchToken(o)) ||
    (matchMagic(o) && !orderTicket) ||
    (!trade.magicNumber && matchToken(o))
  );
  const entries = (snapshot.history || []).filter((d) =>
    Number(d.entry) === 0 &&
    (eq(d.order, orderTicket) || eq(d.position_id, trade.positionId) || (matchMagic(d) && matchToken(d)) || (matchMagic(d) && !trade.positionId) || (!trade.magicNumber && matchToken(d)))
  );
  const positionId = trade.positionId || entries[0]?.position_id;
  const position = (snapshot.positions || []).find((p) =>
    (trade.ticket && eq(p.ticket, trade.ticket)) ||
    (positionId && eq(p.identifier, positionId)) ||
    (matchMagic(p) && matchToken(p)) ||
    (matchMagic(p) && (!trade.ticket && !positionId)) ||
    (!trade.magicNumber && matchToken(p) && (!trade.ticket && !positionId))
  );
  const resolvedId = positionId || position?.identifier;
  const exits = (snapshot.history || []).filter((d) => [1, 3].includes(Number(d.entry)) && eq(d.position_id, resolvedId)).sort((a, b) => Number(a.time_msc || a.time * 1000) - Number(b.time_msc || b.time * 1000));
  const orderHistory = snapshot.order_history?.find((o) =>
    eq(o.ticket, orderTicket) ||
    (matchMagic(o) && matchToken(o)) ||
    (matchMagic(o) && !orderTicket) ||
    (!trade.magicNumber && matchToken(o))
  );
  const entryVolume = entries.reduce((sum, d) => sum + Number(d.volume), 0);
  const exitVolume = exits.reduce((sum, d) => sum + Number(d.volume), 0);
  const expectedVolume = entryVolume || trade.initialVolume || trade.brokerVolume;
  return { known: true, pending, position, positionId: resolvedId, entries, exits, orderTicket, orderHistory, request, closed: !position && exits.length > 0 && exitVolume >= Number(expectedVolume) - 1e-8 };
}

export async function reconcileTradeWithBroker(trade, snapshot) {
  return reconcileBrokerSnapshot(trade, snapshot || await getMT5State());
}
