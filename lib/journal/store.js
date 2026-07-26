import { mongo } from "../mongo.js";

let _journalCol = null;

export async function journalCols() {
  if (!_journalCol) {
    const db = await mongo.db();
    _journalCol = db.collection("journal_trades");
    // Ensure basic indexes
    await _journalCol.createIndex({ date: -1 });
    await _journalCol.createIndex({ asset: 1 });
  }
  return { journalCol: _journalCol };
}
