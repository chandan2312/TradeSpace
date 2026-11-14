import { getCols } from "@/lib/mongo";
import { json } from "@/lib/http";
import { getServerSymbolMapping, setServerSymbolMapping } from "@/lib/symbols/mapping";

export const dynamic = "force-dynamic";

const SETTINGS_DOC_ID = "global_user_settings";
const g = globalThis;
if (!g._tsSettingsInFlight) g._tsSettingsInFlight = null;
let cachedSettings = null;
let cachedSettingsAt = 0;
const SETTINGS_CACHE_MS = 2500;

export async function GET() {
  const now = Date.now();
  if (cachedSettings && now - cachedSettingsAt < SETTINGS_CACHE_MS) {
    return json({ ok: true, settings: cachedSettings });
  }

  if (g._tsSettingsInFlight) {
    try {
      const settings = await g._tsSettingsInFlight;
      return json({ ok: true, settings });
    } catch (err) {
      return json({ ok: false, error: err.message }, 500);
    }
  }

  g._tsSettingsInFlight = (async () => {
    try {
      const { settingsCol } = await getCols();
      const doc = await settingsCol.findOne({ _id: SETTINGS_DOC_ID });
      let settings = doc?.settings || {};

      if (settings.bridgeUrl) {
        globalThis._tsBridgeUrlOverride = String(settings.bridgeUrl).trim().replace(/\/$/, "");
      }

      if (settings.symbolMapping) {
        setServerSymbolMapping(settings.symbolMapping);
      } else {
        settings.symbolMapping = getServerSymbolMapping();
      }

      cachedSettings = settings;
      cachedSettingsAt = Date.now();
      return settings;
    } finally {
      g._tsSettingsInFlight = null;
    }
  })();

  try {
    const settings = await g._tsSettingsInFlight;
    return json({ ok: true, settings });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function PATCH(req) {
  try {
    cachedSettings = null;
    cachedSettingsAt = 0;
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

    if (updates.symbolMapping) {
      setServerSymbolMapping(updates.symbolMapping);
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
