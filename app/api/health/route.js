import { bridge } from "@/lib/bridge";
import { getCols } from "@/lib/mongo";
import { telegramConfigured } from "@/lib/telegram";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  // Each dependency reports independently — a dead bridge must not hide
  // mongo/telegram status (and vice versa).
  const [health, mongoOk] = await Promise.all([
    bridge("GET", "/health").catch((err) => ({ ok: false, error: `bridge unreachable: ${err.message}` })),
    getCols().then(() => true).catch(() => false),
  ]);
  return json({
    ok: !!health?.ok && mongoOk,
    bridge: health,
    mongo: mongoOk,
    telegram: telegramConfigured(),
  });
}
