import { getCols } from "@/lib/mongo";
import { json } from "@/lib/http";

// Store all flags in a single document for simplicity (key-value: symbol -> color)
const FLAGS_DOC_ID = "global_symbol_flags";

export async function GET() {
  try {
    const { flagsCol } = await getCols();
    const doc = await flagsCol.findOne({ _id: FLAGS_DOC_ID });
    return json({ ok: true, flags: doc?.flags || {} });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function PUT(req) {
  try {
    const { flags } = await req.json();
    if (!flags || typeof flags !== 'object') {
      return json({ ok: false, error: "invalid body" }, 400);
    }
    
    const { flagsCol } = await getCols();
    await flagsCol.updateOne(
      { _id: FLAGS_DOC_ID },
      { $set: { flags, updatedAt: new Date() } },
      { upsert: true }
    );
    
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
