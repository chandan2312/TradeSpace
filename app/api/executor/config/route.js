import { json } from "@/lib/http";
import { getConfig, setConfig } from "@/lib/executor/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json({ ok: true, config: await getConfig() });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function PATCH(req) {
  try {
    const patch = await req.json();
    const config = await setConfig(patch);
    globalThis._tsExecCfgCache = config; // hot-path cache refresh, no 30s wait
    return json({ ok: true, config });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
