import { journalCols, updateJournalTrade } from "@/lib/journal/store";
import { json } from "@/lib/http";
import { ObjectId } from "mongodb";

export const dynamic = "force-dynamic";

export async function PUT(req, { params }) {
  try {
    const id = params.id;
    const body = await req.json();

    const res = await updateJournalTrade(id, body);
    if (!res.ok) {
      // Fallback to legacy journal_trades if exists
      const { journalCol } = await journalCols();
      if (ObjectId.isValid(id)) {
        await journalCol.updateOne({ _id: new ObjectId(id) }, { $set: { ...body, updatedAt: new Date() } });
      }
    }

    return json({ ok: true, id });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function DELETE(req, { params }) {
  try {
    const id = params.id;
    const { autonomousCol, journalCol } = await journalCols();
    const filter = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { id };

    await autonomousCol.deleteOne(filter);
    await journalCol.deleteOne(filter);

    return json({ ok: true, id });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
