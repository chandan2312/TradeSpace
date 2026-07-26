import { getCols } from "@/lib/mongo";
import { json } from "@/lib/http";

const SETTINGS_DOC_ID = "global_user_settings";

export async function GET() {
  try {
    const { settingsCol } = await getCols();
    const doc = await settingsCol.findOne({ _id: SETTINGS_DOC_ID });
    let settings = doc?.settings || {};

    // Auto-clear flags if they belong to a previous day (using UTC to avoid dev vs prod server timezone mismatch)
    const today = new Date().toISOString().split('T')[0];
    if (settings.flags_date && settings.flags_date !== today) {
      settings.flags = {};
    }

    return json({ ok: true, settings });
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
      if (k === "flags") {
        setQuery[`settings.flags_date`] = new Date().toISOString().split('T')[0];
      }
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
