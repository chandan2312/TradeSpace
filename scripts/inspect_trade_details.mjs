import "dotenv/config";
import { mongo } from "../lib/mongo.js";

async function run() {
  const db = mongo.db(process.env.MONGODB_DB || "TradeSpace");
  const trades = await db.collection("autonomous_trades").find({ symbol: { $in: ["GBPJPY.i", "GBPJPY", "USDJPY"] } }).sort({ createdAt: -1 }).limit(5).toArray();
  for (const t of trades) {
    console.log("=== TRADE ===");
    console.log(JSON.stringify(t, null, 2));
  }
  await mongo.close();
  process.exit(0);
}
run();
