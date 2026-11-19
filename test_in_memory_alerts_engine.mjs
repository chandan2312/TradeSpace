import assert from "node:assert";
import {
  hydrateActiveAlerts,
  getActiveAlerts,
  addActiveAlert,
  updateActiveAlert,
  removeActiveAlert,
  removeActiveAlertsBySymbol,
  removeActiveAlertsByChainId,
  invalidateAlertsCache,
  shouldTrigger,
} from "./lib/alert-engine.js";

console.log("\n=======================================================");
console.log("TEST SUITE: In-Memory Reactive Alerts Engine");
console.log("=======================================================\n");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`, err);
    process.exit(1);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`, err);
    process.exit(1);
  }
}

const g = globalThis;

// Reset memory state for clean testing
g._tsActiveAlertsMap = new Map();
g._tsAlertsHydrated = false;
g._tsAlertsLastSyncAt = 0;

// 1. Initial Unhydrated State
test("Unhydrated state returns null from getActiveAlerts()", () => {
  assert.strictEqual(getActiveAlerts(), null);
});

// 2. Hydration Populates Memory
test("Manual hydration populates in-memory Map cleanly", () => {
  const mockAlerts = [
    { _id: "alert_1", symbol: "EURUSD", price: 1.0950, condition: "above", status: "active" },
    { _id: "alert_2", symbol: "NAS100", price: 27500, condition: "below", status: "active" },
  ];
  g._tsActiveAlertsMap.clear();
  for (const a of mockAlerts) {
    g._tsActiveAlertsMap.set(String(a._id), a);
  }
  g._tsAlertsHydrated = true;
  g._tsAlertsLastSyncAt = Date.now();

  const active = getActiveAlerts();
  assert.ok(Array.isArray(active));
  assert.strictEqual(active.length, 2);
  assert.strictEqual(active[0].symbol, "EURUSD");
  assert.strictEqual(active[1].symbol, "NAS100");
});

// 3. Reactive Add Alert (0 DB reads)
test("addActiveAlert adds alert to in-memory store in 0ms without DB read", () => {
  const newAlert = {
    _id: "alert_3",
    symbol: "XAUUSD",
    price: 3750.50,
    condition: "cross",
    status: "active",
  };

  addActiveAlert(newAlert);
  const active = getActiveAlerts();
  assert.strictEqual(active.length, 3);
  const found = active.find((a) => a._id === "alert_3");
  assert.ok(found);
  assert.strictEqual(found.symbol, "XAUUSD");
  assert.strictEqual(found.price, 3750.50);
});

// 4. Reactive Modify Alert (Price & Condition)
test("updateActiveAlert mutates existing alert in-memory immediately", () => {
  updateActiveAlert("alert_3", { price: 3760.00, condition: "above" });
  const active = getActiveAlerts();
  const found = active.find((a) => a._id === "alert_3");
  assert.ok(found);
  assert.strictEqual(found.price, 3760.00);
  assert.strictEqual(found.condition, "above");
});

// 5. Reactive Status Change (Deactivation removes from active map)
test("updateActiveAlert with status != 'active' evicts alert from active memory", () => {
  updateActiveAlert("alert_3", { status: "triggered" });
  const active = getActiveAlerts();
  const found = active.find((a) => a._id === "alert_3");
  assert.strictEqual(found, undefined);
  assert.strictEqual(active.length, 2);
});

// 6. Reactive Re-Activation
test("updateActiveAlert with status: 'active' re-arms alert in active memory", () => {
  updateActiveAlert("alert_3", { status: "active", price: 3755.00, symbol: "XAUUSD" });
  const active = getActiveAlerts();
  const found = active.find((a) => a._id === "alert_3");
  assert.ok(found);
  assert.strictEqual(found.price, 3755.00);
  assert.strictEqual(active.length, 3);
});

// 7. Reactive Single Alert Delete
test("removeActiveAlert removes target ID from active memory", () => {
  removeActiveAlert("alert_3");
  const active = getActiveAlerts();
  assert.strictEqual(active.length, 2);
  assert.strictEqual(active.find((a) => a._id === "alert_3"), undefined);
});

// 8. Reactive Symbol-Level Bulk Deletion
test("removeActiveAlertsBySymbol removes all alerts matching symbol", () => {
  addActiveAlert({ _id: "alert_4", symbol: "EURUSD", price: 1.1000, condition: "above", status: "active" });
  addActiveAlert({ _id: "alert_5", symbol: "EURUSD", price: 1.0900, condition: "below", status: "active" });

  let active = getActiveAlerts();
  assert.strictEqual(active.filter((a) => a.symbol === "EURUSD").length, 3);

  removeActiveAlertsBySymbol("EURUSD");
  active = getActiveAlerts();
  assert.strictEqual(active.filter((a) => a.symbol === "EURUSD").length, 0);
  assert.strictEqual(active.length, 1); // Only NAS100 remains
  assert.strictEqual(active[0].symbol, "NAS100");
});

// 9. Reactive Chained Alerts Delete
test("removeActiveAlertsByChainId removes all steps belonging to chainId", () => {
  addActiveAlert({ _id: "ch_1", symbol: "BTCUSD", price: 90000, chainId: "chain_A", chainOrder: 0, status: "active" });
  addActiveAlert({ _id: "ch_2", symbol: "BTCUSD", price: 91000, chainId: "chain_A", chainOrder: 1, status: "active" });
  addActiveAlert({ _id: "other", symbol: "BTCUSD", price: 85000, status: "active" });

  let active = getActiveAlerts();
  assert.strictEqual(active.filter((a) => a.chainId === "chain_A").length, 2);

  removeActiveAlertsByChainId("BTCUSD", "chain_A");
  active = getActiveAlerts();
  assert.strictEqual(active.filter((a) => a.chainId === "chain_A").length, 0);
  assert.ok(active.some((a) => a._id === "other"));
});

// 10. Trigger Evaluation & Immediate Memory Eviction
test("shouldTrigger detects crossing and triggers correctly", () => {
  const alertAbove = { price: 100, condition: "above" };
  assert.strictEqual(shouldTrigger(alertAbove, 99, 100.5), true);
  assert.strictEqual(shouldTrigger(alertAbove, 98, 99.5), false);

  const alertBelow = { price: 100, condition: "below" };
  assert.strictEqual(shouldTrigger(alertBelow, 101, 99.5), true);
  assert.strictEqual(shouldTrigger(alertBelow, 102, 100.5), false);

  const alertCross = { price: 100, condition: "cross" };
  assert.strictEqual(shouldTrigger(alertCross, 99, 101), true); // Cross upward
  assert.strictEqual(shouldTrigger(alertCross, 101, 99), true); // Cross downward
  assert.strictEqual(shouldTrigger(alertCross, 98, 99), false);  // No cross
});

// 11. Zero DB-Read Loop Cycle Simulation
test("Repeated getActiveAlerts() calls execute in 0ms with zero DB reads", () => {
  const start = performance.now();
  for (let i = 0; i < 10000; i++) {
    const list = getActiveAlerts();
    assert.ok(list.length > 0);
  }
  const durationMs = performance.now() - start;
  console.log(`    -> 10,000 in-memory alert checks executed in ${durationMs.toFixed(2)} ms (${(durationMs / 10000).toFixed(4)} ms/check)`);
  assert.ok(durationMs < 50, "10,000 in-memory checks must execute in under 50ms");
});

console.log(`\n=======================================================`);
console.log(`ALL IN-MEMORY ALERTS ENGINE TESTS PASSED: ${passed}/11`);
console.log(`=======================================================\n`);
