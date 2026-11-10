// API route: /api/autonomous/config — Configuration management for Autonomous Brain Trader.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import { getConfig, setConfig, autonomousCols } from "../../../../lib/autonomous/store.js";
import { runAutonomousScan } from "../../../../lib/autonomous/engine.js";
import { broadcast } from "../../../../lib/realtime.js";

const g = globalThis;

export async function GET() {
  try {
    const config = await getConfig();
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const patch = await req.json();
    const config = await setConfig(patch);

    // Invalidate route-level HTTP response cache
    if (typeof g._tsInvalidateAutonomousRouteCache === "function") {
      g._tsInvalidateAutonomousRouteCache();
    }

    // Immediately discard in-memory leaderboard so stale setups are removed
    g._tsAutonomousLeaderboard = null;

    // Auto-dismiss any active staged/armed setups for models that are now disabled
    if (patch.enabledModels && typeof patch.enabledModels === "object") {
      try {
        const disabledIds = Object.entries(patch.enabledModels)
          .filter(([, val]) => val === false)
          .map(([k]) => k);

        if (disabledIds.length > 0) {
          const { tradesCol } = await autonomousCols();
          await tradesCol.updateMany(
            {
              status: { $in: ["staged", "armed", "confirming"] },
              modelId: { $in: disabledIds },
            },
            {
              $set: {
                status: "dismissed",
                dismissReason: "Entry model disabled in configuration settings",
                updatedAt: new Date(),
              },
            }
          );
        }
      } catch (e) {
        console.warn("[config/route.js] Error cleaning disabled model trades:", e.message);
      }
    }

    // Trigger an immediate background scan with the new configuration
    runAutonomousScan("config_model_updated").catch(() => {});

    broadcast({ type: "autonomous_changed" });
    broadcast({ type: "autonomous_scan" });

    return NextResponse.json({ ok: true, config });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function PUT(req) {
  return POST(req);
}
