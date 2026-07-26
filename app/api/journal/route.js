import { journalCols } from "@/lib/journal/store";
import { json } from "@/lib/http";
import { ObjectId } from "mongodb";

export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const { journalCol } = await journalCols();
    const trades = await journalCol.find({}).sort({ date: -1, _id: -1 }).toArray();
    return json(trades);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { journalCol } = await journalCols();
    
    const doc = {
      title: body.title || "",
      date: body.date ? new Date(body.date) : new Date(),
      session: body.session || "",
      asset: body.asset || "",
      result: body.result || "", // Profit, Loss, Breakeven
      side: body.side || "", // Long, Short
      rr: Number(body.rr) || 0,
      pnl: Number(body.pnl) || 0, // Using pnl for the monetary value shown ($1,850.00)
      maxRr: Number(body.maxRr) || 0,
      maxRrType: body.maxRrType || "",
      tradeIdea: body.tradeIdea || "",
      learning: body.learning || "",
      account: body.account || "",
      imageUrl: body.imageUrl || "", // Data URI or URL
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const res = await journalCol.insertOne(doc);
    return json({ ok: true, trade: { ...doc, _id: res.insertedId } });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
