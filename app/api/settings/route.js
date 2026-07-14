import { getCols } from "@/lib/mongo";
import { json } from "@/lib/http";

const SETTINGS_DOC_ID = "global_user_settings";

export async function GET() {
  try {
    const { settingsCol } = await getCols();
    const doc = await settingsCol.findOne({ _id: SETTINGS_DOC_ID });
    return json({ ok: true, settings: doc?.settings || {} });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function PATCH(req) {
  try {
    const updates = await req.json();
    if (!updates || typeof updates !== 'object') {
      return json({ ok: false, error: "invalid body" }, 400);
    }
    
    const { settingsCol } = await getCols();
    
    // Construct dot-notation updates for specific fields to merge rather than overwrite
    const setQuery = {};
    for (const [k, v] of Object.entries(updates)) {
      setQuery[`settings.${k}`] = v;
    }
    setQuery["updatedAt"] = new Date();

    await settingsCol.updateOne(
      { _id: SETTINGS_DOC_ID },
      { $set: setQuery },
      { upsert: true }
    );
    
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
