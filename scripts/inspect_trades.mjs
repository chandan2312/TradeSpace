import { MongoClient } from "mongodb";

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "Tradespace";
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);
  
  const proj = {
    symbol: 1, status: 1, legId: 1, groupId: 1, ticket: 1, orderTicket: 1, positionId: 1,
    magicNumber: 1, lotSize: 1, filledPrice: 1, entryPrice: 1, slPrice: 1, tpPrice: 1,
    isBreakeven: 1, tp1Done: 1, partialExits: 1, managementLogic: 1, brokerComment: 1,
    createdAt: 1, tags: 1, journalTags: 1, horizon: 1, scenario: 1
  };

  const autoTrades = await db.collection("autonomous_trades").find({}, { projection: proj }).sort({ createdAt: -1 }).toArray();
  console.log(`Total autonomous_trades: ${autoTrades.length}`);
  
  const running = autoTrades.filter(t => ["active", "managing", "closing", "pending", "armed"].includes(t.status));
  console.log(`\n--- RUNNING / ACTIVE TRADES (${running.length}) ---`);
  for (const t of running) {
    console.log(JSON.stringify(t, null, 2));
  }

  const otherTrades = autoTrades.filter(t => !["active", "managing", "closing", "pending", "armed"].includes(t.status));
  console.log(`\n--- OTHER TRADES (${otherTrades.length}) ---`);
  const statusCounts = {};
  for (const t of otherTrades) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  }
  console.log("Status counts of other trades:", statusCounts);

  const nas100All = autoTrades.filter(t => ["NAS100", "NAS100.cash", "USTEC"].includes(t.symbol));
  console.log(`\n--- ALL NAS100 TRADES (${nas100All.length}) ---`);
  for (const t of nas100All.slice(0, 5)) {
    console.log({
      id: String(t._id),
      symbol: t.symbol,
      status: t.status,
      legId: t.legId,
      groupId: t.groupId,
      ticket: t.ticket,
      orderTicket: t.orderTicket,
      positionId: t.positionId,
      filledPrice: t.filledPrice,
      isBreakeven: t.isBreakeven,
      tp1Done: t.tp1Done,
      partialExits: t.partialExits,
      tags: t.tags,
      journalTags: t.journalTags,
      createdAt: t.createdAt
    });
  }

  const journalColCount = await db.collection("journal_trades").countDocuments();
  console.log(`\nTotal journal_trades collection count: ${journalColCount}`);

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
