import { bridge } from "@/lib/bridge";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return json({ ok: false, error: "symbol required" }, 400);
  try {
    const data = await bridge("POST", "/tick", { sym: String(symbol).toUpperCase() });
    return json(data);
  } catch (err) {
    return json({ ok: false, error: err.message }, 502);
  }
}
