import { MongoClient, ObjectId } from "mongodb";

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "Tradespace";
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  
  const keepIds = [
    new ObjectId("6ad0e743fe15926b514bef7a"), // NAS100 prop_firm
    new ObjectId("6ad0e742fe15926b514bef79"), // NAS100 default
  ];

  const beforeCount = await db.collection("autonomous_trades").countDocuments();
  console.log(`Autonomous trades before: ${beforeCount}`);

  // Delete all autonomous_trades except the 2 running NAS100 trades
  const delAutoRes = await db.collection("autonomous_trades").deleteMany({
    _id: { $nin: keepIds }
  });
  console.log(`Deleted ${delAutoRes.deletedCount} old autonomous_trades.`);

  const afterCount = await db.collection("autonomous_trades").countDocuments();
  console.log(`Autonomous trades remaining: ${afterCount}`);

  // Clean legacy journal_trades if any
  const delJournRes = await db.collection("journal_trades").deleteMany({});
  console.log(`Deleted ${delJournRes.deletedCount} from journal_trades.`);

  // Clean capacity slots so only the 2 running trades occupy capacity
  const keepIdsStr = keepIds.map(id => String(id));
  await db.collection("autonomous_control").updateOne(
    { _id: "capacity" },
    { $pull: { slots: { tradeId: { $nin: keepIdsStr } } } }
  );
  console.log("Cleaned capacity slots in autonomous_control.");

  const remaining = await db.collection("autonomous_trades").find({}).toArray();
  console.log("Remaining trades in DB:", remaining.map(t => ({
    id: String(t._id),
    symbol: t.symbol,
    legId: t.legId,
    status: t.status,
    ticket: t.ticket
  })));

  await client.close();
}

main().catch(console.error);
