import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

async function check() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "Tradespace");
  const trades = await db.collection("autonomous_trades").find({
    status: { $in: ["closed_tp", "closed_sl", "closed_be"] }
  }).toArray();

  const modelStats = {};
  for (const t of trades) {
    const m = t.stagedLevel?.modelId || t.stagedLevel?.modelName || t.entryModel?.id || t.entryModel?.name || t.brokerComment || "UNKNOWN";
    modelStats[m] = modelStats[m] || { tp: 0, sl: 0, be: 0, trades: 0 };
    modelStats[m].trades++;
    if (t.status === "closed_tp") modelStats[m].tp++;
    else if (t.status === "closed_sl") modelStats[m].sl++;
    else modelStats[m].be++;
  }

  console.log("Live DB Performance by Entry Model / Comment:");
  console.log(JSON.stringify(modelStats, null, 2));

  // Also check candidate models in stagedLevel
  console.log("\nSample Trades with Staged Level details:");
  for (const t of trades.slice(0, 5)) {
    console.log({
      symbol: t.symbol,
      status: t.status,
      modelId: t.stagedLevel?.modelId || t.stagedLevel?.modelName || t.candidateLevel?.modelId,
      managementLogic: t.managementLogic,
      brokerComment: t.brokerComment,
    });
  }

  await client.close();
}
check().catch(console.error);
