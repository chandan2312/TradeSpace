import { journalCols } from "@/lib/journal/store";
import { json } from "@/lib/http";
import { ObjectId } from "mongodb";

export const dynamic = "force-dynamic";

export async function PUT(req, { params }) {
  try {
    const id = params.id;
    if (!ObjectId.isValid(id)) return json({ ok: false, error: "invalid id" }, 400);
    
    const body = await req.json();
    const { journalCol } = await journalCols();
    
    const update = {
      ...body,
      updatedAt: new Date()
    };
    if (update.date) update.date = new Date(update.date);
    
    delete update._id; // prevent changing immutable ID
    
    await journalCol.updateOne({ _id: new ObjectId(id) }, { $set: update });
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function DELETE(req, { params }) {
  try {
    const id = params.id;
    if (!ObjectId.isValid(id)) return json({ ok: false, error: "invalid id" }, 400);
    
    const { journalCol } = await journalCols();
    await journalCol.deleteOne({ _id: new ObjectId(id) });
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
