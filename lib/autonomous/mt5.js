// Institutional MetaTrader 5 Execution & Position Management Bridge
// Reference: Battle-tested Alpha Project execution architecture
// Provides direct broker market orders, SL/TP live modifications, ticket closing,
// position tracking, and historical deal reconciliation.

import { bridge } from "../bridge.js";

/**
 * Executes a direct market order on the remote MetaTrader 5 broker terminal.
 *
 * @param {Object} params
 * @param {string} params.symbol - Asset symbol (e.g. "EURUSD", "NAS100", "XAUUSD")
 * @param {"buy"|"sell"} params.action - Order direction
 * @param {number} params.volume - Lot size
 * @param {number} params.sl - Stop loss price
 * @param {number} params.tp - Take profit price
 * @param {number} [params.entryPrice] - Theoretical signal entry price for slippage delta compensation
 * @param {string} [params.comment] - Trade comment (max 31 chars)
 * @param {number} [params.magic] - Magic number
 * @returns {Promise<{ ok: boolean, ticket?: number, price?: number, volume?: number, error?: string }>}
 */
export async function executeMT5Order({
  symbol,
  action,
  volume,
  sl = 0,
  tp = 0,
  entryPrice,
  comment = "TradeSpace Brain",
  magic = 231223,
}) {
  try {
    const payload = {
      symbol,
      action: String(action).toLowerCase(),
      volume: Math.max(0.01, Number(volume) || 0.01),
      sl: Number(sl) || 0,
      tp: Number(tp) || 0,
      entry_price: entryPrice ? Number(entryPrice) : undefined,
      comment: String(comment).slice(0, 31),
      magic: Number(magic) || 231223,
      deviation: 20,
    };

    const res = await bridge("POST", "/order", payload, { timeoutMs: 10_000 });
    if (res && res.ok && res.ticket) {
      return {
        ok: true,
        ticket: res.ticket,
        price: res.price,
        volume: res.volume,
        status: res.status,
      };
    }

    return {
      ok: false,
      error: res?.message || "MT5 order execution failed without error detail",
      details: res,
    };
  } catch (err) {
    return {
      ok: false,
      error: `MT5 Bridge Connection Error: ${err.message}`,
    };
  }
}

/**
 * Modifies Stop Loss and/or Take Profit on an existing open position on MT5.
 * Used for Breakeven arming and Trailing Stop updates.
 *
 * @param {Object} params
 * @param {number} params.ticket - Position ticket
 * @param {number} params.sl - New stop loss price
 * @param {number} [params.tp] - New take profit price
 * @returns {Promise<{ ok: boolean, ticket?: number, sl?: number, tp?: number, error?: string }>}
 */
export async function modifyMT5Order({ ticket, sl, tp }) {
  try {
    if (!ticket) return { ok: false, error: "ticket required for MT5 modify" };

    const payload = {
      ticket: Number(ticket),
      sl: Number(sl) || 0,
      tp: tp ? Number(tp) : 0,
    };

    const res = await bridge("POST", "/modify", payload, { timeoutMs: 8_000 });
    if (res && res.ok) {
      return {
        ok: true,
        ticket: res.ticket,
        sl: res.sl,
        tp: res.tp,
      };
    }

    return {
      ok: false,
      error: res?.message || `MT5 modify failed on ticket ${ticket}`,
      details: res,
    };
  } catch (err) {
    return {
      ok: false,
      error: `MT5 Modify Bridge Error: ${err.message}`,
    };
  }
}

/**
 * Closes an active position on MT5 (full or partial volume).
 *
 * @param {Object} params
 * @param {number} params.ticket - Position ticket to close
 * @param {number} [params.volume] - Optional volume for partial close
 * @returns {Promise<{ ok: boolean, ticket?: number, volume?: number, price?: number, error?: string }>}
 */
export async function closeMT5Position({ ticket, volume }) {
  try {
    if (!ticket) return { ok: false, error: "ticket required for MT5 close" };

    const payload = {
      ticket: Number(ticket),
      volume: volume ? Number(volume) : undefined,
    };

    const res = await bridge("POST", "/close", payload, { timeoutMs: 10_000 });
    if (res && res.ok) {
      return {
        ok: true,
        ticket: res.ticket,
        volume: res.volume,
        price: res.price,
      };
    }

    // Fallback: try closing via reverse market order deal if /close is pending
    try {
      const fallbackRes = await bridge("POST", "/order", { close: Number(ticket) }, { timeoutMs: 10_000 });
      if (fallbackRes && fallbackRes.ok) {
        return {
          ok: true,
          ticket: fallbackRes.ticket || ticket,
          volume: fallbackRes.volume,
          price: fallbackRes.price,
        };
      }
    } catch {}

    return {
      ok: false,
      error: res?.message || `MT5 close failed on ticket ${ticket}`,
      details: res,
    };
  } catch (err) {
    return {
      ok: false,
      error: `MT5 Close Bridge Error: ${err.message}`,
    };
  }
}

/**
 * Fetches active open positions from the MT5 broker terminal.
 *
 * @param {string} [symbol] - Optional filter for specific symbol
 * @returns {Promise<{ ok: boolean, positions?: Array<Object>, error?: string }>}
 */
export async function getMT5Positions(symbol) {
  try {
    const payload = symbol ? { sym: symbol } : {};
    const res = await bridge("POST", "/positions", payload, { timeoutMs: 5_000 });
    if (res && res.ok) {
      return {
        ok: true,
        positions: res.positions || [],
      };
    }
    return {
      ok: false,
      positions: [],
      error: res?.message || "Failed to fetch MT5 positions",
    };
  } catch (err) {
    return {
      ok: false,
      positions: [],
      error: err.message,
    };
  }
}

/**
 * Fetches broker account statistics (balance, equity, margin, leverage).
 *
 * @returns {Promise<{ ok: boolean, account?: Object, error?: string }>}
 */
export async function getMT5Account() {
  try {
    const res = await bridge("GET", "/account", undefined, { timeoutMs: 5_000 });
    if (res && res.ok && res.account) {
      return {
        ok: true,
        account: res.account,
      };
    }
    return {
      ok: false,
      error: res?.message || "Failed to fetch MT5 account info",
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
    };
  }
}

/**
 * Fetches symbol specification details from the broker.
 *
 * @param {string} symbol
 * @returns {Promise<{ ok: boolean, symbol?: Object, error?: string }>}
 */
export async function getMT5Symbol(symbol) {
  try {
    const res = await bridge("POST", "/symbol", { sym: symbol }, { timeoutMs: 5_000 });
    if (res && res.ok && res.symbol) {
      return {
        ok: true,
        symbol: res.symbol,
      };
    }
    return {
      ok: false,
      error: res?.message || `Failed to fetch MT5 symbol info for ${symbol}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
    };
  }
}

/**
 * Fetches historical deals executed on the MT5 terminal.
 *
 * @param {Object} [params]
 * @param {number} [params.days=7]
 * @param {string} [params.symbol]
 * @returns {Promise<{ ok: boolean, history?: Array<Object>, error?: string }>}
 */
export async function getMT5History({ days = 7, symbol } = {}) {
  try {
    const payload = { days };
    if (symbol) payload.sym = symbol;
    const res = await bridge("POST", "/history", payload, { timeoutMs: 8_000 });
    if (res && res.ok) {
      return {
        ok: true,
        history: res.history || [],
      };
    }
    return {
      ok: false,
      history: [],
      error: res?.message || "Failed to fetch MT5 history",
    };
  } catch (err) {
    return {
      ok: false,
      history: [],
      error: err.message,
    };
  }
}

/**
 * Institutional Position Sizing Algorithm (Battle-tested from Alpha project).
 * Calculates exact lot size based on USD risk, stop loss distance, and broker asset specifications.
 * Includes protection against MT5 tick scaling distortion and a 10% maximum balance risk cap.
 *
 * @param {Object} params
 * @param {string} params.symbol - Asset symbol
 * @param {number} params.riskUsd - Target risk amount in USD
 * @param {number} params.entryPrice - Entry price
 * @param {number} params.slPrice - Stop Loss price
 * @param {Object} [params.symInfo] - Optional MT5 symbol info
 * @param {Object} [params.accInfo] - Optional MT5 account info
 * @returns {number} - Safely calculated and rounded lot size
 */
export function calculateInstitutionalPositionSize({
  symbol,
  riskUsd,
  entryPrice,
  slPrice,
  symInfo = {},
  accInfo = {},
}) {
  const symUpper = (symbol || "").toUpperCase();
  const volMin = Number(symInfo.volume_min) || 0.01;
  const volMax = Number(symInfo.volume_max) || 100.0;
  const volStep = Number(symInfo.volume_step) || 0.01;

  const slDist = Math.abs(Number(entryPrice) - Number(slPrice));
  if (!slDist || isNaN(slDist) || slDist <= 0) {
    return volMin;
  }

  // 1. Determine asset physical contract multiplier
  let contractMult = 1.0;
  if (symUpper.includes("XAU") || symUpper.includes("GOLD")) {
    contractMult = 100.0; // 1 lot = 100 oz Gold ($100 per $1 move)
  } else if (symUpper.includes("JP225") || symUpper.includes("NI225")) {
    contractMult = 0.67;  // Nikkei 225 index point (~$0.67 USD / pt)
  } else if (symUpper.includes("BTC") || symUpper.includes("ETH")) {
    contractMult = 1.0;   // 1 lot = 1 crypto token
  } else if (
    symUpper.includes("NAS") ||
    symUpper.includes("US30") ||
    symUpper.includes("DJ30") ||
    symUpper.includes("SP500") ||
    symUpper.includes("US500") ||
    symUpper.includes("GER40") ||
    symUpper.includes("DE40") ||
    symUpper.includes("UK100")
  ) {
    contractMult = 1.0;   // Institutional CFDs: 1 lot = 1 contract ($1 per 1.0 pt)
  } else {
    // Forex standard lot: 100,000 units (~$10 per pip on EURUSD)
    contractMult = 100_000.0;
  }

  // 2. Compute loss per 1.0 lot in account currency (USD)
  const tickSize = Number(symInfo.trade_tick_size) || 0;
  const tickValue = Number(symInfo.trade_tick_value) || 0;
  let lossPerLot = 0;

  if (tickSize > 0 && tickValue > 0) {
    const pointValueRatio = tickValue / tickSize;
    const expectedMaxRatio = contractMult * 10.0;

    // Check for MT5 feed scaling distortion on indices
    if (
      pointValueRatio > expectedMaxRatio &&
      ["NAS", "US", "DJ", "GER", "JP", "BTC"].some((idx) => symUpper.includes(idx))
    ) {
      lossPerLot = slDist * contractMult;
    } else {
      const ticks = slDist / tickSize;
      lossPerLot = ticks * tickValue;
    }
  } else {
    lossPerLot = slDist * contractMult;
  }

  if (lossPerLot <= 0) {
    return volMin;
  }

  // 3. Capital Protection Failsafe: Cap risk at 10% of realized balance if known
  const balance = Number(accInfo.balance) || 0;
  let safeRiskUsd = Number(riskUsd) || 500;
  if (balance > 0) {
    const maxAllowedRisk = balance * 0.10;
    if (safeRiskUsd > maxAllowedRisk) {
      safeRiskUsd = maxAllowedRisk;
    }
  }

  // 4. Step rounding & clamping
  const rawLot = safeRiskUsd / lossPerLot;
  const steps = Math.floor(rawLot / volStep);
  const roundedLot = Math.max(volMin, Math.min(steps * volStep, volMax));

  return Math.round(roundedLot * 100) / 100;
}

/**
 * Reconciles an active trade with live MT5 broker state.
 * Detects whether the position was closed on the MT5 terminal (by broker SL/TP or trader manual close).
 *
 * @param {Object} trade - Trade Space active trade record
 * @returns {Promise<{ closed: boolean, exitPrice?: number, realizedPnl?: number, reason?: string }>}
 */
export async function reconcileTradeWithBroker(trade) {
  if (!trade?.ticket) return { closed: false };

  try {
    const posRes = await getMT5Positions();
    if (!posRes.ok) return { closed: false };

    const isOpen = (posRes.positions || []).some(
      (p) => Number(p.ticket) === Number(trade.ticket)
    );

    if (isOpen) {
      // Still active on broker
      return { closed: false };
    }

    // Ticket is no longer active in open positions! Check deals history to get the exact exit deal.
    const histRes = await getMT5History({ days: 3, symbol: trade.symbol });
    if (histRes.ok && histRes.history) {
      const exitDeals = histRes.history.filter(
        (d) => Number(d.position_id) === Number(trade.ticket) && Number(d.entry) === 1 // DEAL_ENTRY_OUT
      );

      if (exitDeals.length > 0) {
        const lastDeal = exitDeals[exitDeals.length - 1];
        return {
          closed: true,
          exitPrice: Number(lastDeal.price) || trade.currentPrice,
          realizedPnl: Number(lastDeal.profit) || 0,
          reason: lastDeal.comment || "Closed on broker terminal",
        };
      }
    }

    // Closed on broker but deal entry out not found in recent history
    return {
      closed: true,
      exitPrice: trade.currentPrice || trade.entryPrice,
      realizedPnl: 0,
      reason: "Position closed on MT5 broker terminal",
    };
  } catch (err) {
    return { closed: false, error: err.message };
  }
}
