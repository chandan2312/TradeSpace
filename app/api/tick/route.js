import { bridge } from "@/lib/bridge";
import { json } from "@/lib/http";
import { toCanonicalSymbol, toBrokerSymbol } from "@/lib/symbols/mapping";
import { brokerTimestampToUtcMs } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const rawSymbol = req.nextUrl.searchParams.get("symbol");
  if (!rawSymbol) return json({ ok: false, error: "symbol required" }, 400);
  
  const canonicalSym = toCanonicalSymbol(rawSymbol);
  const brokerSym = toBrokerSymbol(canonicalSym);

  try {
    const data = await bridge("POST", "/tick", { sym: brokerSym });
    if (data.ok && data.tick) {
      if (data.tick.time || data.tick.time_msc) {
        data.tick.time = brokerTimestampToUtcMs(data.tick.time_msc || (data.tick.time || 0) * 1000);
      }
      data.tick.symbol = canonicalSym;
      data.tick.brokerSymbol = brokerSym;
      data.symbol = canonicalSym;
      data.brokerSymbol = brokerSym;
    }
    return json(data);
  } catch (err) {
    return json({ ok: false, error: err.message }, 502);
  }
}
