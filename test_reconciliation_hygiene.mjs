// Test suite verifying broker reconciliation, cancellation hygiene, and ACCOUNT_STALE resilience
import assert from "node:assert/strict";
import { createAutonomousEngine } from "./lib/autonomous/engine.js";
import { DEFAULT_AUTONOMOUS_CONFIG } from "./lib/autonomous/store.js";

console.log("\n=======================================================");
console.log("TEST SUITE: Broker Reconciliation & Cancellation Hygiene");
console.log("=======================================================");

// In-memory mock database collection
function createMockCols() {
  const trades = [];
  const logs = [];
  const tradesCol = {
    find: (query = {}, options = {}) => ({
      toArray: async () => {
        return trades.filter((t) => {
          if (query.status?.$in && !query.status.$in.includes(t.status)) return false;
          if (query.isLive !== undefined && t.isLive !== query.isLive) return false;
          if (query.groupId && t.groupId !== query.groupId) return false;
          if (query._id?.$in && !query._id.$in.map(String).includes(String(t._id))) return false;
          return true;
        });
      },
    }),
    findOne: async (query) => {
      return trades.find((t) => {
        if (query._id && String(t._id) === String(query._id)) return true;
        return false;
      }) || null;
    },
    updateOne: async (filter, update) => {
      const doc = trades.find((t) => {
        if (filter._id && String(t._id) !== String(filter._id)) return false;
        if (filter.status && t.status !== filter.status) return false;
        if (filter["operation.requestId"] && t.operation?.requestId !== filter["operation.requestId"]) return false;
        if (filter.$or) {
          const matchOr = filter.$or.some((clause) => {
            if (clause.operation?.$exists === false && !t.operation) return true;
            if (clause.operation === null && t.operation === null) return true;
            if (clause["operation.state"] && t.operation?.state === clause["operation.state"]) return true;
            return false;
          });
          if (!matchOr) return false;
        }
        return true;
      });
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$push?.events) {
        doc.events = doc.events || [];
        doc.events.push(update.$push.events);
      }
      return { matchedCount: 1, modifiedCount: 1 };
    },
    insertOne: async (doc) => {
      trades.push({ ...doc, _id: doc._id || Math.random().toString(36).slice(2) });
      return { insertedId: doc._id };
    },
  };
  const logsCol = { insertOne: async () => {}, countDocuments: async () => 0 };
  const controlCol = {
    updateOne: async () => ({ modifiedCount: 1, matchedCount: 1 }),
    findOne: async () => ({ slots: [] }),
  };
  return { tradesCol, logsCol, controlCol, trades };
}

// TEST 1: accountFreshnessMs defaults to 60000ms
assert.equal(DEFAULT_AUTONOMOUS_CONFIG.accountFreshnessMs, 60000, "accountFreshnessMs must default to 60000ms");
console.log("✅ PASS: accountFreshnessMs default is 60,000ms (60s tolerance)");

// TEST 2: Reconciling cancelling order with absent broker orders resolves to terminal cancelled
{
  const mock = createMockCols();
  const tradeDoc = {
    _id: "trade_test_cancelling",
    symbol: "XAUUSD",
    dir: 1,
    entryPrice: 2650,
    slPrice: 2640,
    tpPrice: 2670,
    lotSize: 0.1,
    status: "cancelling",
    brokerStatus: "reconciliation_required",
    isLive: true,
    orderTicket: "66631824",
    operation: {
      kind: "cancel",
      state: "unknown",
      requestId: "req_timeout_1",
      response: { ok: false, ambiguous: true, error: "The operation was aborted due to timeout" },
    },
  };
  mock.trades.push(tradeDoc);

  const engine = createAutonomousEngine({
    autonomousCols: async () => mock,
    getConfig: async () => ({ ...DEFAULT_AUTONOMOUS_CONFIG, liveTrading: true, enabled: true }),
    getMainWatchlistSymbols: async () => ["XAUUSD"],
    isTradingPermittedNow: () => ({ permitted: true }),
    getStartOfTradingDay: () => new Date(),
    broadcast: () => {},
    sendTelegram: async () => {},
    now: () => Date.now(),
    releaseTradeCapacity: async () => true,
    logEvent: async () => {},
    getMT5State: async () => ({
      ok: true,
      account: { login: 12345, balance: 50000, equity: 50000 },
      positions: [], // No positions open
      orders: [],    // No pending orders open (order was removed on MT5)
      history: [],
      order_history: [],
      requests: [],
      dailyPnl: 0,
      dayStartEquity: 50000,
      brokerDayStart: Math.floor(Date.now() / 1000) - 3600,
      at: Math.floor(Date.now() / 1000),
    }),
  });

  await engine.pollBroker();

  const resolvedTrade = mock.trades.find((t) => t._id === "trade_test_cancelling");
  assert.equal(resolvedTrade.status, "cancelled", "Trade must be resolved to cancelled");
  assert.equal(resolvedTrade.brokerStatus, "cancelled", "Broker status must be cancelled");
  console.log("✅ PASS: Stuck cancelling trade automatically resolved to cancelled via broker reconciliation");
}

// TEST 3: Force Resolve via dismissStagedTrade immediately cancels stuck trade
{
  const mock = createMockCols();
  const tradeDoc = {
    _id: "trade_test_stuck_sp500",
    symbol: "SP500",
    dir: -1,
    entryPrice: 5700,
    slPrice: 5720,
    tpPrice: 5650,
    lotSize: 0.05,
    status: "cancelling",
    brokerStatus: "reconciliation_required",
    isLive: true,
    orderTicket: "66626531",
    operation: {
      kind: "cancel",
      state: "unknown",
      requestId: "req_fetch_failed",
      response: { ok: false, ambiguous: true, error: "fetch failed" },
    },
  };
  mock.trades.push(tradeDoc);

  let cancelCalled = false;
  const engine = createAutonomousEngine({
    autonomousCols: async () => mock,
    getConfig: async () => ({ ...DEFAULT_AUTONOMOUS_CONFIG, liveTrading: true, enabled: true }),
    cancelMT5Order: async () => {
      cancelCalled = true;
      return { ok: false, error: "Order not found" };
    },
    broadcast: () => {},
    sendTelegram: async () => {},
    releaseTradeCapacity: async () => true,
    logEvent: async () => {},
    now: () => Date.now(),
  });

  const res = await engine.dismissStagedTrade("trade_test_stuck_sp500");
  assert.equal(res.ok, true, "dismissStagedTrade must return ok: true");

  const resolved = mock.trades.find((t) => t._id === "trade_test_stuck_sp500");
  assert.equal(resolved.status, "cancelled", "Force resolve must transition trade to cancelled");
  assert.equal(resolved.brokerStatus, "cancelled", "Broker status must be cancelled");
  console.log("✅ PASS: dismissStagedTrade / Force Resolve cleanly frees stuck zombie trades");
}

// TEST 4: Cancel returns "Order not found" (10013) completes cleanly to terminal cancelled
{
  const mock = createMockCols();
  const tradeDoc = {
    _id: "trade_test_not_found",
    symbol: "NAS100",
    dir: 1,
    entryPrice: 20000,
    slPrice: 19950,
    tpPrice: 20100,
    lotSize: 0.1,
    status: "pending",
    brokerStatus: "pending_limit",
    isLive: true,
    orderTicket: "888888",
  };
  mock.trades.push(tradeDoc);

  const engine = createAutonomousEngine({
    autonomousCols: async () => mock,
    getConfig: async () => ({ ...DEFAULT_AUTONOMOUS_CONFIG, liveTrading: true, enabled: true }),
    cancelMT5Order: async () => ({ ok: false, error: "Order not found (code 10013)" }),
    broadcast: () => {},
    sendTelegram: async () => {},
    releaseTradeCapacity: async () => true,
    logEvent: async () => {},
    now: () => Date.now(),
  });

  const res = await engine.dismissStagedTrade("trade_test_not_found");
  assert.equal(res.ok, true);

  const resolved = mock.trades.find((t) => t._id === "trade_test_not_found");
  assert.equal(resolved.status, "cancelled", "Order not found must resolve to cancelled");
  console.log("✅ PASS: MT5 'Order not found' error is recognized as confirmation of order removal");
}

console.log("\n=======================================================");
console.log("🎯 ALL BROKER RECONCILIATION & CANCELLATION HYGIENE TESTS PASSED!");
console.log("=======================================================\n");
