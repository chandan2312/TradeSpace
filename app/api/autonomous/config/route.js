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
        let statusReason = p.statusReason;
        let vetoes = Array.isArray(p.vetoes) ? [...p.vetoes] : [];
        let stagedLevel = p.stagedLevel ? { ...p.stagedLevel } : null;
        let permitted = p.permitted;

        const isTimingStatus = /OFF_SESSION|DEAD_ZONE|TIMING|SESSION_RESTRICTED/i.test(status || "");
        const hasTimingVeto = vetoes.some((v) => ["TIMING", "DEAD_ZONE", "OFF_SESSION", "SESSION_RESTRICTED"].includes(v.code));

        if (live.permitted) {
          if (isTimingStatus || hasTimingVeto) {
            vetoes = vetoes.filter((v) => !["TIMING", "DEAD_ZONE", "OFF_SESSION", "SESSION_RESTRICTED"].includes(v.code));
            if (stagedLevel) {
              const stagedVetoes = (stagedLevel.vetoes || []).filter((v) => !["TIMING", "DEAD_ZONE", "OFF_SESSION", "SESSION_RESTRICTED"].includes(v.code));
              stagedLevel.vetoes = stagedVetoes;
              if (stagedVetoes.length === 0 && p.isInMainWatchlist) {
                stagedLevel.permitted = true;
                permitted = true;
                status = "PRIME_QUALIFIED";
                statusReason = "Causal model, macro/DOL, fresh closed frames and all execution vetoes approved.";
              } else {
                status = p.dir !== 0 ? "WATCHING_RETRACE" : "SCANNING_NEUTRAL";
                statusReason = p.dir !== 0 ? "Monitoring 15M/5M order flow for institutional retracement." : "Market structure in consolidation equilibrium.";
              }
            } else {
              status = p.dir !== 0 ? "WATCHING_RETRACE" : "SCANNING_NEUTRAL";
              statusReason = p.dir !== 0 ? "Monitoring 15M/5M order flow for institutional retracement." : "Market structure in consolidation equilibrium.";
            }
          }
        } else {
          if (!/BLOCKED_DATA|RESTRICTED_CONTEXT/i.test(status || "")) {
            status = live.isDeadZone ? "OFF_SESSION_DEAD_ZONE" : "BLOCKED_TIMING";
            statusReason = live.reason || "Outside Permitted Execution Hours";
            permitted = false;
            if (stagedLevel) stagedLevel.permitted = false;
            if (!hasTimingVeto) {
              vetoes.unshift({ code: live.isDeadZone ? "DEAD_ZONE" : "TIMING", reason: statusReason });
            }
          }
        }

        return {
          ...p,
          activeTimeSlot: currentSlot,
          sessionProfile: { ...profile, isCurrentlyActive: Boolean(live.permitted), reason: live.reason },
          status,
          statusReason,
          stagedLevel,
          permitted,
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
