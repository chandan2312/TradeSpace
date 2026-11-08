import "dotenv/config";
import { getCols, mongo } from "../lib/mongo.js";
import { getConfig, getMetrics } from "../lib/autonomous/store.js";

async function run() {
  const cfg = await getConfig();
  console.log("=== AUTONOMOUS CONFIG ===");
  console.log("Enabled:", cfg.enabled);
  console.log("Execution Mode:", cfg.executionMode);
  console.log("Live Trading:", cfg.liveTrading);
  console.log("Horizon Mode:", cfg.horizonMode);
  console.log("Enabled Horizons:", cfg.enabledHorizons);
  console.log("Min RR:", cfg.minRR);
  console.log("Min Conviction:", cfg.minConviction);
  console.log("Enabled Models:", cfg.enabledModels);
  console.log("Universe:", cfg.universe);
  console.log("Breakeven Trigger R:", cfg.breakevenTriggerR);
  console.log("Management Logic:", cfg.defaultManagementLogic);

  const metrics = await getMetrics();
  console.log("\n=== METRICS ===");
  console.log(JSON.stringify(metrics, null, 2));

  const db = mongo.db(process.env.MONGODB_DB || "TradeSpace");
  const trades = await db.collection("autonomous_trades").find({}).sort({ createdAt: -1 }).limit(10).toArray();
  console.log(`\n=== LAST ${trades.length} TRADES ===`);
  for (const t of trades) {
    console.log(`[${t.status}] ${t.symbol} | Dir: ${t.dir} | Model: ${t.modelId || t.model} | Entry: ${t.entryPrice} | SL: ${t.sl} | TP: ${t.tp} | Result: ${t.resultR ?? "N/A"}R | Reason: ${t.exitReason || t.invalidationReason || "N/A"}`);
  }

  const logs = await db.collection("autonomous_logs").find({}).sort({ createdAt: -1 }).limit(10).toArray();
  console.log(`\n=== LAST ${logs.length} LOGS ===`);
  for (const l of logs) {
    console.log(`[${l.createdAt?.toISOString?.() || l.createdAt}] ${l.type || l.event}: ${l.message || l.note || JSON.stringify(l)}`);
  }

  await mongo.close();
  process.exit(0);
}

run().catch(err => {
  console.error("Error inspecting autonomous:", err);
  process.exit(1);
});
