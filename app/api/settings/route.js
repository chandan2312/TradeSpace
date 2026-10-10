import { getCols } from "@/lib/mongo";
import { json } from "@/lib/http";

const SETTINGS_DOC_ID = "global_user_settings";

export async function GET() {
  try {
    const { settingsCol } = await getCols();
    const doc = await settingsCol.findOne({ _id: SETTINGS_DOC_ID });
    let settings = doc?.settings || {};

    if (settings.bridgeUrl) {
      globalThis._tsBridgeUrlOverride = String(settings.bridgeUrl).trim().replace(/\/$/, "");
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
    
    if (updates.bridgeUrl) {
      const cleanUrl = String(updates.bridgeUrl).trim().replace(/\/$/, "");
      globalThis._tsBridgeUrlOverride = cleanUrl;
      // Reset circuit breaker on manual URL update so probe runs immediately
      if (globalThis._tsBridgeCircuit) {
        globalThis._tsBridgeCircuit.isOpen = false;
        globalThis._tsBridgeCircuit.failures = 0;
        globalThis._tsBridgeCircuit.lastFailureTime = 0;
      }
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
