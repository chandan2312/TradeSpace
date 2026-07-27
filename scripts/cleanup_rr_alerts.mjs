import { getCols } from "../lib/mongo.js";
async function run() {
  const { alertsCol } = await getCols();
  const res = await alertsCol.deleteMany({ note: { $regex: "\\[RR:" } });
  console.log(`Deleted ${res.deletedCount} old RR alerts`);
  process.exit(0);
}
run();
