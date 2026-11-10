// API route: /api/autonomous/config — Configuration management for Autonomous Brain Trader.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import { getConfig, setConfig, autonomousCols } from "../../../../lib/autonomous/store.js";
import { runAutonomousScan } from "../../../../lib/autonomous/engine.js";
import { broadcast } from "../../../../lib/realtime.js";
import { getCurrentTimeSlot, isTradingPermittedNow, getSymbolSessionProfile } from "../../../../lib/autonomous/timeslots.js";

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

    // Immediately synchronize in-memory and persisted leaderboard to the new session config
    if (g._tsAutonomousLeaderboard?.rankedPairs) {
      const now = new Date();
      const currentSlot = getCurrentTimeSlot(now, config);
      g._tsAutonomousLeaderboard.rankedPairs = g._tsAutonomousLeaderboard.rankedPairs.map((p) => {
        const sym = p.symbol || p.tradeableSymbol;
        const live = isTradingPermittedNow(now, config, sym);
        const profile = getSymbolSessionProfile(sym, config);
        let status = p.status;
        let vetoes = p.vetoes || [];
        if (live.permitted && (status === "OFF_SESSION_DEAD_ZONE" || status === "BLOCKED_TIMING" || status === "BLOCKED_DEAD_ZONE")) {
          status = p.dir !== 0 ? "WATCHING_RETRACE" : "SCANNING_NEUTRAL";
          vetoes = vetoes.filter((v) => v.code !== "TIMING" && v.code !== "DEAD_ZONE" && v.code !== "OFF_SESSION");
        }
        return {
          ...p,
          activeTimeSlot: currentSlot,
          sessionProfile: { ...profile, isCurrentlyActive: Boolean(live.permitted), reason: live.reason },
          status,
          vetoes,
        };
      });
      g._tsAutonomousLeaderboard.activeTimeSlot = currentSlot;

      try {
        const { controlCol } = await autonomousCols();
        if (controlCol) {
          await controlCol.updateOne(
            { _id: "latest_autonomous_scan" },
            { $set: { leaderboard: g._tsAutonomousLeaderboard, updatedAt: new Date() } },
            { upsert: true }
          ).catch(() => {});
        }
      } catch (_) {}
    } else {
      g._tsAutonomousLeaderboard = null;
    }

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
