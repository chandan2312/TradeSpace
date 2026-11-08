import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

async function check() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "Tradespace");
  const trades = await db.collection("autonomous_trades").find({
    status: { $in: ["closed_tp", "closed_sl", "closed_be"] }
  }).sort({ createdAt: -1 }).toArray();

  console.log(`Total decided trades in DB: ${trades.length}`);
  const bySymbol = {};
  let totalWins = 0, totalLosses = 0, totalBE = 0;
  let totalGrossR = 0;

  for (const t of trades) {
    const s = t.symbol;
    bySymbol[s] = bySymbol[s] || { tp: 0, sl: 0, be: 0, trades: [] };
    if (t.status === "closed_tp") {
      bySymbol[s].tp++;
      totalWins++;
    } else if (t.status === "closed_sl") {
      bySymbol[s].sl++;
      totalLosses++;
    } else {
      bySymbol[s].be++;
      totalBE++;
    }

    const risk = Math.abs(t.entryPrice - t.slPrice);
    const pnlR = t.status === "closed_tp" ? (Math.abs(t.tpPrice - t.entryPrice) / risk) : (t.status === "closed_be" ? 0.1 : -1.0);
    totalGrossR += pnlR;
    bySymbol[s].trades.push({
      date: t.createdAt,
      status: t.status,
      entry: t.entryPrice,
      sl: t.slPrice,
      tp: t.tpPrice,
      r: pnlR,
      legId: t.legId,
      managementLogic: t.managementLogic,
      brokerComment: t.brokerComment,
    });
  }

  console.log(`\nOverall: ${totalWins} TP, ${totalLosses} SL, ${totalBE} BE | Net R: +${totalGrossR.toFixed(2)}R`);
  console.log("\nBy Symbol:");
  for (const [sym, data] of Object.entries(bySymbol)) {
    console.log(`\n=== ${sym} (${data.trades.length} trades: ${data.tp} TP, ${data.sl} SL, ${data.be} BE) ===`);
    for (const tr of data.trades.slice(0, 5)) {
      console.log(`  ${new Date(tr.date).toISOString().slice(0,16)} | ${tr.status.padEnd(9)} | +${tr.r.toFixed(2)}R | Leg: ${tr.legId} (${tr.managementLogic})`);
    }
  }

  await client.close();
}

check().catch(console.error);
