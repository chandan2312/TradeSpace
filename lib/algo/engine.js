// Algo engine — the auto-strategy loop (paper trading only, no broker orders).
//
// Two cadences:
//   Scanner (default 3 min): currency strength → candidate pairs → findSetup()
//     → new "watching" (near) or "tracking" (fat, > trackMult × zone away)
//     candidates in Mongo. Tracking persists across scans until fully rejected.
//   Monitor (piggybacks every tick broadcast the alert-engine already makes —
//     subscribed via onTicks() so we add ZERO extra bridge load):
//       tracking    → price returns to approachMult × zone → "watching"
//       watching    → price within approachMult × zone-height → "approaching"
//                     → run confirmation (strength still aligned, no fresh
//                       opposing M15 shift, correlated partner not diverging,
//                       retracement not reversal-type)
//                     → "confirmed" | soft-fail re-arm to "watching" (cooldown,
//                       up to maxConfirmFails) | hard-fail "rejected"
//       confirmed   → price enters zone → "filled" (paper fill @ zone edge)
//       filled      → SL hit → "lost" (−1R) | TP hit → "won" (+R)
//       any pre-fill → TTL expiry → "expired" (trackHours for tracking,
//                     ttlHours otherwise); price through SL side → "invalidated"
//
// State lives in Mongo `algo_trades`; every transition appends to events[]
// and broadcasts {type:"algo_changed"} so the /currency-algo page stays live.

import { getFrames } from "../bias/data.js";
import { computeSymbolBias, aggregate } from "../bias/engine.js";
import { analyzeStructure } from "../bias/structure.js";
import { liquidityMap } from "../bias/liquidity.js";
import { detectTrendlineLiquidity } from "../bias/buildup.js";
import { avgRange } from "../patterns/core.js";
import { sendTelegram } from "../telegram.js";
import { broadcast } from "../realtime.js";
import { buildCandidates, TRADEABLE_FX } from "./pairs.js";
import { findSetup } from "./setup.js";
import { classifyRetracement } from "./retracement.js";
import { algoCols, getConfig } from "./store.js";
import { bridge } from "../bridge.js";

const g = globalThis;

// ---------------- scanner ----------------

export async function scanOnce(reason = "interval") {
  if (g._tsAlgoScanning) return { ok: false, error: "scan in progress" };
  g._tsAlgoScanning = true;
  try {
    const cfg = await getConfig();
    if (!cfg.enabled && reason !== "manual") return { ok: false, error: "disabled" };
    const { tradesCol } = await algoCols();

    // 1. currency strength from the FX universe (bias pipeline, cached per-TF)
    const framesMap = {};
    for (let i = 0; i < TRADEABLE_FX.length; i += 5) {
      await Promise.all(TRADEABLE_FX.slice(i, i + 5).map(async (sym) => {
        try {
          const frames = await getFrames(sym);
          if (frames.M15 && frames.H1) framesMap[sym] = frames;
        } catch {}
      }));
    }
    const results = Object.keys(framesMap).map((sym) => computeSymbolBias(sym, framesMap[sym], {}));
    if (!results.length) return { ok: false, error: "no bridge data" };
    const { currencyStrength } = aggregate(results);

    // 2. candidate pairs
    const candidates = buildCandidates(currencyStrength, cfg);

    // 3. setups → new watching entries (one open candidate per symbol max)
    const open = await tradesCol.find({ status: { $in: ["tracking", "watching", "approaching", "confirmed", "filled"] } }).toArray();
    const openSyms = new Set(open.map((t) => t.symbol));
    const created = [];
    for (const c of candidates) {
      if (openSyms.has(c.symbol)) continue;
      const setup = findSetup(c.symbol, framesMap[c.symbol], c.dir, cfg);
      if (!setup) continue;
      const now = new Date();
      // fat setup: price too far from entry to fill now → TRACK (persists across
      // scans even if the symbol later drops out of the strength meter, until
      // the algo fully rejects it). Near setups go straight to watching.
      // Entry is a PULLBACK zone: buy entry sits below price, sell above —
      // distance matches the monitor's distToEntry orientation.
      const zoneH = Math.abs(setup.entry.zoneTop - setup.entry.zoneBottom) || Math.abs(setup.entry.price - setup.sl);
      const lastPx = framesMap[c.symbol]?.M15?.slice?.(-1)?.[0]?.close ?? setup.entry.price;
      const dist = setup.dir === "buy" ? lastPx - setup.entry.price : setup.entry.price - lastPx;
      const isFat = zoneH > 0 && dist > cfg.trackMult * zoneH;
      const status = isFat ? "tracking" : "watching";
      const doc = {
        ...setup,
        status,
        strength: { base: c.base, quote: c.quote, baseScore: c.baseScore, quoteScore: c.quoteScore, edge: c.edge },
        createdAt: now,
        updatedAt: now,
        events: [{ at: now, type: "created", note: `scan (${reason}); edge ${c.edge}${isFat ? "; fat → tracking" : ""}` }],
      };
      await tradesCol.insertOne(doc);
      created.push(doc);
    }
    if (created.length) {
      broadcast({ type: "algo_changed" });
      if (cfg.telegram) {
        for (const t of created) {
          sendTelegram(
            `🤖 <b>ALGO ${t.status === "tracking" ? "tracking" : "watching"} ${t.symbol}</b> ${t.dir === "buy" ? "🟢 LONG" : "🔴 SHORT"}\n` +
            `entry ${t.entry.price} · SL ${t.sl} · TP ${t.tp} (RR ${t.rr})\n` +
            `score ${t.score} · ${t.strength.base}(${fmtS(t.strength.baseScore)}) vs ${t.strength.quote}(${fmtS(t.strength.quoteScore)})`,
            "SETUP"
          ).catch(() => {});
        }
      }
    }
    g._tsAlgoLastScan = { at: Date.now(), candidates: candidates.length, created: created.length };
    return { ok: true, candidates: candidates.length, created: created.length };
  } catch (err) {
    console.error("[algo] scan error:", err.message);
    return { ok: false, error: err.message };
  } finally {
    g._tsAlgoScanning = false;
  }
}

// ---------------- confirmation (the "second look" before entry) -------------

async function confirmCandidate(t, cfg) {
  const checks = [];
  const dirN = t.dir === "buy" ? 1 : -1;
  try {
    // 1. currency strength still aligned?
    const framesMap = {};
    for (let i = 0; i < TRADEABLE_FX.length; i += 5) {
      await Promise.all(TRADEABLE_FX.slice(i, i + 5).map(async (sym) => {
        try {
          const frames = await getFrames(sym);
          if (frames.M15 && frames.H1) framesMap[sym] = frames;
        } catch {}
      }));
    }
    const results = Object.keys(framesMap).map((sym) => computeSymbolBias(sym, framesMap[sym], {}));
    const { currencyStrength } = aggregate(results);
    const by = Object.fromEntries(currencyStrength.map((c) => [c.ccy, c.score]));
    const baseNow = by[t.strength.base] ?? 0;
    const quoteNow = by[t.strength.quote] ?? 0;
    const edgeNow = baseNow - quoteNow;
    const strengthOk = edgeNow >= cfg.minEdge * 0.6; // allow some decay, not a flip
    checks.push({ name: "currency strength", pass: strengthOk, note: `edge ${Math.round(edgeNow)} (was ${t.strength.edge})` });

    // 2. target pool intact (if our fuel got used by someone else, thesis is dead)
    const frames = framesMap[t.symbol] || (await getFrames(t.symbol));
    let shiftOk = true, shiftNote = "target pool intact";
    if (frames?.M15?.length > 60) {
      // NOTE: We do NOT reject based on opposing M15 MSS here. Deep pullbacks into 
      // H1 support inherently cause M15 downtrends. classifyRetracement handles
      // actual origin breaks.
      const avgM15 = avgRange(frames.M15);
      const liq = liquidityMap(frames.M15, avgM15);
      const tlLiq = detectTrendlineLiquidity(frames.M15, avgM15);
      const allSweeps = [...liq.sweeps, ...tlLiq.sweeps.map(s => ({ name: `${s.touches}-touch ${s.type}`, side: s.side, age: s.age }))];
      
      const poolGone = allSweeps.find((s) => s.name === t.pool?.name && s.age <= 20);
      if (poolGone) { shiftOk = false; shiftNote = `target pool ${t.pool.name} already swept`; }
      // pool swept = thesis dead — unrecoverable
      checks.push({ name: "market structure", pass: shiftOk, note: shiftNote, hard: !!poolGone });
    } else {
      checks.push({ name: "market structure", pass: shiftOk, note: shiftNote });
    }

    // 3. correlated market: the symbol's own bias & market brain should not oppose us
    const self = results.find((r) => r.symbol === t.symbol);
    let biasOk = !self || Math.sign(self.score) !== -dirN || Math.abs(self.score) < 25;
    let biasNote = self ? `score ${self.score}` : "n/a";
    if (self?.brain?.executionReadiness) {
      const allowed = dirN === 1 ? self.brain.executionReadiness.allowedToLong : self.brain.executionReadiness.allowedToShort;
      if (!allowed && self.brain.executionReadiness.blockReasons?.length > 0) {
        biasOk = false;
        biasNote += ` (Brain blocked: ${self.brain.executionReadiness.blockReasons[0]})`;
      } else if (allowed) {
        biasNote += ` (Brain ${self.brain.executionReadiness.action})`;
      }
    }
    checks.push({ name: "symbol bias", pass: biasOk, note: biasNote });

    // 4. retracement type: a reversal-type pullback at confirm time = structure
    //    flipped against us while we waited → reject. Other retrace types pass.
    if (cfg.retrace !== false && t.dir) {
      try {
        const rt = classifyRetracement(frames?.M15 || [], t.dir, cfg);
        const retraceOk = !rt || rt.type !== "reversal";
        // structure flip is unrecoverable — no point re-arming
        checks.push({ name: "retracement", pass: retraceOk, note: rt ? `${rt.type} (${Math.round(rt.depth*100)}%)` : "n/a", hard: !retraceOk });
      } catch {
        checks.push({ name: "retracement", pass: true, note: "n/a" });
      }
    }

    return { pass: checks.every((c) => c.pass), hard: checks.some((c) => !c.pass && c.hard), checks };
  } catch (err) {
    checks.push({ name: "confirm error", pass: false, note: err.message });
    return { pass: false, hard: false, checks };
  }
}

// ---------------- monitor (called with every tick batch) ----------------

export async function onTicks(ticks) {
  const cfg = g._tsAlgoCfgCache;
  if (!cfg?.enabled) return;
  if (g._tsAlgoMonitoring) return;
  // ticks arrive every ~500ms; a 2s monitor cadence is plenty for M15 setups
  // and keeps Mongo out of the hot path
  if (g._tsAlgoLastMon && Date.now() - g._tsAlgoLastMon < 2000) return;
  g._tsAlgoLastMon = Date.now();
  g._tsAlgoMonitoring = true;
  try {
    const { tradesCol } = await algoCols();
    const open = await tradesCol.find({ status: { $in: ["tracking", "watching", "approaching", "confirmed", "filled"] } }).toArray();
    // keep the alert-engine's tick union covering our open symbols
    g._tsAlgoSymbols = [...new Set(open.map((t) => t.symbol))];
    if (!open.length) return;
    const now = new Date();

    for (const t of open) {
      const tick = ticks[t.symbol];
      if (!tick) continue;
      const dirN = t.dir === "buy" ? 1 : -1;
      // paper fills use the taker side: buy at ask, sell at bid; exits mirror
      const px = t.dir === "buy" ? (tick.ask ?? tick.bid) : (tick.bid ?? tick.ask);
      if (!px) continue;

      // TTL expiry for anything not yet filled (fat "tracking" setups get the
      // longer trackHours window — they persist until the algo fully rejects them)
      const ttlMs = (t.status === "tracking" ? cfg.trackHours : cfg.ttlHours) * 3600_000;
      if (t.status !== "filled" && now - new Date(t.createdAt) > ttlMs) {
        await transition(tradesCol, t, "expired", `${t.status === "tracking" ? "track" : "TTL"} ${ttlMs / 3600_000}h exceeded`, cfg);
        continue;
      }

      const zoneH = Math.abs(t.entry.zoneTop - t.entry.zoneBottom) || Math.abs(t.entry.price - t.sl);

      if (t.status === "tracking") {
        // fat setup: invalid if price runs through to the SL side before we ever
        // got close; otherwise promote to watching once price returns to approach
        // range (the setup is now fillable).
        if (dirN === 1 ? px <= t.sl : px >= t.sl) {
          await transition(tradesCol, t, "invalidated", `price through zone to ${px} while tracking`, cfg);
          continue;
        }
        if (dirN === 1 ? px >= t.tp : px <= t.tp) {
          await transition(tradesCol, t, "invalidated", `target ${t.tp} reached before entry (missed move)`, cfg);
          continue;
        }
        const distToEntry = dirN === 1 ? px - t.entry.price : t.entry.price - px;
        if (distToEntry <= cfg.approachMult * zoneH) {
          await transition(tradesCol, t, "watching", `price returned to ${cfg.approachMult}× zone (now fillable)`, cfg);
        }
      } else if (t.status === "watching") {
        const distToEntry = dirN === 1 ? px - t.entry.price : t.entry.price - px;
        // price moved through the zone past the SL side → setup gone
        if (dirN === 1 ? px <= t.sl : px >= t.sl) {
          await transition(tradesCol, t, "invalidated", `price through zone to ${px}`, cfg);
          continue;
        }
        if (dirN === 1 ? px >= t.tp : px <= t.tp) {
          await transition(tradesCol, t, "invalidated", `target ${t.tp} reached before entry (missed move)`, cfg);
          continue;
        }
        if (distToEntry <= cfg.approachMult * zoneH) {
          // re-armed candidates wait out their cooldown before re-approaching
          if (t.cooldownUntil && now < new Date(t.cooldownUntil)) continue;
          await transition(tradesCol, t, "approaching", `price ${px} within ${cfg.approachMult}× zone`, cfg);
          // run confirmation asynchronously; monitor keeps flowing
          queueConfirm(tradesCol, { ...t, status: "approaching" }, cfg);
        }
      } else if (t.status === "confirmed") {
        // Check terminal boundaries FIRST to prevent corrupted fills on massive gaps
        if (dirN === 1 ? px <= t.sl : px >= t.sl) {
          await transition(tradesCol, t, "invalidated", `ran through zone to ${px} before fill`, cfg);
          continue;
        }
        if (dirN === 1 ? px >= t.tp : px <= t.tp) {
          await transition(tradesCol, t, "invalidated", `target ${t.tp} reached before fill (missed move)`, cfg);
          continue;
        }

        const inZone = dirN === 1 ? px <= t.entry.price : px >= t.entry.price;
        if (inZone) {
          // Spread protection: if bid/ask spread is > 40% of our stop loss, do NOT fill.
          // This protects against NFP whipsaws, rollover spread widening, and instant toxic drawdowns.
          if (tick.ask && tick.bid) {
            const spread = Math.abs(tick.ask - tick.bid);
            const risk = Math.abs(t.entry.price - t.sl);
            if (spread > 0.4 * risk) continue; // skip this tick, wait for spread to normalize
          }
          const filledCount = open.filter((x) => x.status === "filled").length;
          if (filledCount >= cfg.maxConcurrent) {
            await transition(tradesCol, t, "expired", `maxConcurrent ${cfg.maxConcurrent} reached at fill time`, cfg);
            continue;
          }
          
          let fillMsg = `paper fill @ ${px}`;
          let ticketId = null;
          let executedPx = px;
          const spread = (tick.ask && tick.bid) ? (tick.ask - tick.bid) : 0;
          
          try {
            const res = await bridge("POST", "/order", {
              action: t.dir,
              symbol: t.symbol,
              volume: cfg.lotSize || 0.01,
              sl: t.sl,
              tp: t.tp,
            });
            if (res.ok) {
              ticketId = res.ticket;
              executedPx = res.price || px;
              fillMsg = `MT5 fill @ ${executedPx} (ticket: ${res.ticket}) | Spread: ${spread.toFixed(5)}`;
            } else {
              fillMsg = `Paper fill @ ${executedPx} | Spread: ${spread.toFixed(5)} (MT5 order failed: ${res.message})`;
              notify(cfg, `🤖⚠️ <b>ALGO EXECUTION FAILED ${t.symbol}</b>\n${res.message}\nTracking trade on paper.`);
            }
          } catch (err) {
            fillMsg = `Paper fill @ ${executedPx} | Spread: ${spread.toFixed(5)} (MT5 bridge error: ${err.message})`;
            notify(cfg, `🤖⚠️ <b>ALGO BRIDGE ERROR ${t.symbol}</b>\n${err.message}\nTracking trade on paper.`);
          }

          await tradesCol.updateOne({ _id: t._id, status: "confirmed" }, {
            $set: { 
              status: "filled", 
              filledAt: now, 
              filledPrice: executedPx, 
              updatedAt: now, 
              originalSl: t.sl, 
              ticket: ticketId,
              entrySpread: spread
            },
            $push: { events: { at: now, type: "filled", note: fillMsg } },
          });
          notify(cfg, `🤖✅ <b>ALGO FILLED ${t.symbol}</b> ${t.dir === "buy" ? "🟢" : "🔴"} @ ${executedPx}\nSL ${t.sl} · TP ${t.tp} · RR ${t.rr} (ticket: ${ticketId})`);
          broadcast({ type: "algo_changed" });
        }
      } else if (t.status === "filled") {
        const entryPx = t.filledPrice ?? t.entry.price;
        const originalSl = t.originalSl ?? t.sl;
        const risk = Math.abs(entryPx - originalSl);
        
        // exits valued on the closing side (buy closes at bid, sell at ask)
        const exitPx = t.dir === "buy" ? (tick.bid ?? px) : (tick.ask ?? px);
        const exitDist = dirN === 1 ? exitPx - entryPx : entryPx - exitPx;
        const liveR = risk > 0 ? exitDist / risk : 0;
        
        // Trailing SL Logic: Half-Risk at +1.0R, Breakeven at +1.5R
        const halfRiskSl = dirN === 1 ? originalSl + (risk / 2) : originalSl - (risk / 2);
        
        let targetSl = t.sl;
        let slNote = "";
        let tierHit = 0;
        
        if (liveR >= 1.5) {
          targetSl = entryPx;
          slNote = "Breakeven";
          tierHit = 1.5;
        } else if (liveR >= 1.0) {
          targetSl = halfRiskSl;
          slNote = "Half-Risk";
          tierHit = 1.0;
        }

        // Ensure we only move SL forward (never backwards if price fluctuates)
        const isBetterSl = dirN === 1 ? targetSl > t.sl : targetSl < t.sl;
        
        if (isBetterSl) {
          let modifyMsg = `SL moved to ${slNote} @ ${targetSl}`;
          if (t.ticket) {
            try {
              const res = await bridge("POST", "/modify", { ticket: t.ticket, sl: targetSl });
              if (!res.ok) modifyMsg += ` (MT5 modify failed: ${res.message})`;
            } catch (err) {
              modifyMsg += ` (MT5 bridge error: ${err.message})`;
            }
          }
          
          await tradesCol.updateOne({ _id: t._id }, {
            $set: { sl: targetSl, updatedAt: now },
            $push: { events: { at: now, type: "sl_move", note: modifyMsg } }
          });
          const prefix = tierHit === 1.5 ? "RISK-FREE" : "RISK REDUCED";
          notify(cfg, `🤖🛡 <b>ALGO ${prefix} ${t.symbol}</b>\nSL moved to ${slNote} @ ${targetSl} (+${tierHit}R hit)`);
          broadcast({ type: "algo_changed" });
          t.sl = targetSl;
        }

        const hitSL = dirN === 1 ? exitPx <= t.sl : exitPx >= t.sl;
        const hitTP = dirN === 1 ? exitPx >= t.tp : exitPx <= t.tp;
        
        if (hitSL || hitTP) {
          const exitSpread = (tick.ask && tick.bid) ? (tick.ask - tick.bid) : 0;
          const resultR = Math.round(liveR * 100) / 100;
          const dbStatus = hitTP ? "won" : (resultR >= 0 ? "won" : "lost"); 
          await transition(tradesCol, t, dbStatus, `${hitSL ? "SL" : "TP"} hit @ ${exitPx} (${resultR}R) | Exit Spread: ${exitSpread.toFixed(5)}`, cfg, { resultR, closedPrice: exitPx, exitSpread });
          
          const outcome = hitTP ? "WON" : (resultR >= 0 ? "BE" : "LOST");
          const emoji = hitTP ? "🏆" : (resultR >= 0 ? "🛡" : "❌");
          notify(cfg, `🤖${emoji} <b>ALGO ${outcome} ${t.symbol}</b> ${resultR >= 0 ? "+" : ""}${resultR}R @ ${exitPx}`);
          broadcast({ type: "algo_changed" });
        }
      }
      // "approaching" waits for its confirm to resolve; fills only from "confirmed"
    }
  } catch (err) {
    console.error("[algo] monitor error:", err.message);
  } finally {
    g._tsAlgoMonitoring = false;
  }
}

function queueConfirm(tradesCol, t, cfg) {
  (async () => {
    const res = await confirmCandidate(t, cfg);
    const now = new Date();
    // soft fail → re-arm: back to "watching" with a cooldown so a transient
    // strength dip doesn't kill an otherwise-valid setup. Hard fail (pool swept,
    // structure flipped) or too many soft fails → terminal reject.
    const fails = (t.confirmFails || 0) + (res.pass ? 0 : 1);
    const rearm = !res.pass && !res.hard && fails < (cfg.maxConfirmFails ?? 3);
    const status = res.pass ? "confirmed" : rearm ? "watching" : "rejected";
    const cooldownUntil = rearm ? new Date(now.getTime() + (cfg.reconfirmCooldownMin ?? 15) * 60_000) : null;
    const flipped = await tradesCol.updateOne({ _id: t._id, status: "approaching" }, {
      $set: {
        status, confirm: { checks: res.checks, at: now }, updatedAt: now,
        confirmFails: fails, ...(cooldownUntil ? { cooldownUntil } : {}),
      },
      $push: { events: { at: now, type: res.pass ? "confirmed" : rearm ? "re-armed" : "rejected", note: res.checks.map((c) => `${c.pass ? "✓" : "✗"} ${c.name}: ${c.note}`).join("; ") } },
    });
    if (!flipped.modifiedCount) return; // expired/invalidated while confirming
    if (res.pass) {
      notify(cfg, `🤖👀 <b>ALGO CONFIRMED ${t.symbol}</b> ${t.dir === "buy" ? "🟢" : "🔴"} — waiting for entry @ ${t.entry.price}\n` +
        res.checks.map((c) => `${c.pass ? "✅" : "❌"} ${c.name}: ${c.note}`).join("\n"));
    }
    broadcast({ type: "algo_changed" });
  })().catch((err) => console.error("[algo] confirm error:", err.message));
}

async function transition(tradesCol, t, status, note, cfg, extras = {}) {
  const now = new Date();
  const res = await tradesCol.updateOne({ _id: t._id, status: t.status }, {
    $set: { status, updatedAt: now, ...(isClosed(status) ? { closedAt: now } : {}), ...extras },
    $push: { events: { at: now, type: status, note } },
  });
  if (res.modifiedCount) {
    if (status === "approaching") notify(cfg, `🤖⏳ <b>ALGO ${t.symbol}</b> approaching entry ${t.entry.price} — running confirmation…`);
    broadcast({ type: "algo_changed" });
  }
  return res.modifiedCount > 0;
}

const isClosed = (s) => ["won", "lost", "expired", "invalidated", "rejected"].includes(s);
const fmtS = (v) => `${v > 0 ? "+" : ""}${v}`;
function notify(cfg, msg) { if (cfg.telegram) sendTelegram(msg, "SETUP").catch(() => {}); }

// ---------------- boot ----------------

export function startAlgoLoop() {
  if (g._tsAlgoStarted) return;
  g._tsAlgoStarted = true;

  // config cache refreshed each scan so onTicks (hot path) never hits Mongo for it
  const refreshCfg = async () => { try { g._tsAlgoCfgCache = await getConfig(); } catch {} };
  refreshCfg();
  setInterval(refreshCfg, 30_000);

  const tick = async () => {
    const cfg = g._tsAlgoCfgCache;
    if (cfg?.enabled) await scanOnce("interval");
  };
  setTimeout(tick, 15_000); // let the server settle before the first scan
  setInterval(tick, (g._tsAlgoCfgCache?.scanMs) || 180_000);
  console.log("[algo] engine started (scanner 3min, monitor on tick stream)");
}
