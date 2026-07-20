// Executor engine — executes user-placed setups (paper by default, live via a
// per-setup + global toggle). Runs the context stack to pick an entry mode,
// manages the position, and rides the SAME tick stream the alert-engine and
// currency-algo already consume (zero extra bridge load).
//
// State machine:
//   armed        → setup accepted; waiting for price to approach the entry
//   validating   → within approachMult × zone-height; context assessed, mode set
//   awaiting_entry → zone tapped; direct fills, candle/structural wait to confirm
//   filled       → position opened (paper or live)
//   managing     → post-fill (BE / trail); same state as filled, just labelled
//   won | lost | expired | invalidated | cancelled  → terminal
//
// State lives in Mongo `executor_trades`; every transition appends events[] and
// broadcasts {type:"executor_changed"}.

import { getFrames } from "../bias/data.js";
import { computeSymbolBias, aggregate } from "../bias/engine.js";
import { sendTelegram } from "../telegram.js";
import { broadcast } from "../realtime.js";
import { bridge } from "../bridge.js";
import { TRADEABLE_FX } from "../algo/pairs.js";
import { avgRange } from "../patterns/core.js";
import { ObjectId } from "mongodb";
import { executorCols, getConfig, OPEN_STATES, isClosed } from "./store.js";

const oid = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);
import { assessContext } from "./context.js";
import { decideMode, candleConfirm, structuralConfirm, hardInvalidation } from "./modes.js";

const g = globalThis;

// ---------------- arm (called from the API when the user sends a setup) -----

export async function armSetup(setup, cfg) {
  cfg = cfg || (await getConfig());
  const { tradesCol } = await executorCols();
  const { symbol, tf, entry, sl, tp, drawingId } = setup;
  if (!symbol || !Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(tp)) {
    return { ok: false, error: "setup needs symbol, entry, sl, tp" };
  }
  const dir = tp > entry ? "buy" : "sell";
  const dirN = dir === "buy" ? 1 : -1;
  // sanity: SL must be on the losing side of entry, TP on the winning side
  if (dirN === 1 ? !(sl < entry && tp > entry) : !(sl > entry && tp < entry)) {
    return { ok: false, error: "SL/TP on wrong side of entry for derived direction" };
  }
  // one open executor trade per drawing
  if (drawingId) {
    const existing = await tradesCol.findOne({ drawingId, status: { $in: OPEN_STATES } });
    if (existing) return { ok: false, error: "this drawing already has an open executor trade" };
  }
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  const rr = risk > 0 ? Math.round((reward / risk) * 100) / 100 : 0;
  const now = new Date();
  const doc = {
    symbol, tf: tf || "M15", dir,
    entry, sl, tp,
    originalEntry: entry, originalSl: sl, originalTp: tp,
    rr,
    live: !!setup.live,
    drawingId: drawingId || null,
    status: "armed",
    mode: null,
    context: null,
    createdAt: now,
    updatedAt: now,
    events: [{ at: now, type: "armed", note: `armed ${dir} ${symbol} @ ${entry} (SL ${sl} / TP ${tp}, RR ${rr})${setup.live ? " [LIVE]" : ""}` }],
  };
  await tradesCol.insertOne(doc);
  broadcast({ type: "executor_changed" });
  notify(cfg, `🎯 <b>EXECUTOR ARMED ${symbol}</b> ${dir === "buy" ? "🟢" : "🔴"} @ ${entry}\nSL ${sl} · TP ${tp} · RR ${doc.rr}${doc.live ? "\n⚠️ LIVE" : " (paper)"}`);
  return { ok: true, trade: doc };
}

export async function cancelSetup(id) {
  const { tradesCol } = await executorCols();
  const t = await tradesCol.findOne({ _id: idFilter(id) });
  if (!t) return { ok: false, error: "not found" };
  if (isClosed(t.status)) return { ok: false, error: `already ${t.status}` };
  if (t.status === "filled" || t.status === "managing") {
    return { ok: false, error: "use flatten for a filled position" };
  }
  await transition(tradesCol, t, "cancelled", "cancelled by user", await getConfig());
  return { ok: true };
}

export async function flattenSetup(id) {
  const { tradesCol } = await executorCols();
  const t = await tradesCol.findOne({ _id: idFilter(id) });
  if (!t) return { ok: false, error: "not found" };
  if (t.status !== "filled" && t.status !== "managing") return { ok: false, error: "not a filled position" };
  const cfg = await getConfig();
  // live: close via bridge (opposite market order on the ticket)
  if (t.live && t.ticket && cfg.liveEnabled) {
    try { await bridge("POST", "/order", { action: t.dir === "buy" ? "sell" : "buy", symbol: t.symbol, volume: t.volume || cfg.lotSize, close: t.ticket }); }
    catch (err) { /* logged below */ }
  }
  await transition(tradesCol, t, "lost", "flattened by user", cfg, { resultR: 0, closedPrice: null, manualClose: true });
  return { ok: true };
}

// ---------------- context assessment (async, off the hot path) --------------
// Cache the fx universe strength briefly so per-setup validation doesn't
// recompute the whole TRADEABLE_FX sweep on every pass.
async function universeStrength() {
  const hit = g._tsExecStrength;
  if (hit && Date.now() - hit.at < 60_000) return hit.cs;
  const framesMap = {};
  for (let i = 0; i < TRADEABLE_FX.length; i += 5) {
    await Promise.all(TRADEABLE_FX.slice(i, i + 5).map(async (sym) => {
      try { const f = await getFrames(sym); if (f.M15 && f.H1) framesMap[sym] = f; } catch {}
    }));
  }
  const results = Object.keys(framesMap).map((sym) => computeSymbolBias(sym, framesMap[sym], {}));
  const { currencyStrength } = aggregate(results);
  g._tsExecStrength = { at: Date.now(), cs: currencyStrength };
  return currencyStrength;
}

// runValidation — assess context for a setup, store the report + entry mode,
// optionally apply auto-adjust nudges. Returns the fresh doc fields.
async function runValidation(tradesCol, t, cfg) {
  const frames = await getFrames(t.symbol).catch(() => null);
  if (!frames) return null;
  const cs = await universeStrength().catch(() => null);
  const ctx = assessContext(t.symbol, frames, t.dir, { entry: t.entry, sl: t.sl, tp: t.tp, tf: t.tf }, cfg, cs);
  const mode = decideMode(ctx.score, cfg);

  const set = { context: { score: ctx.score, grade: ctx.grade, checks: ctx.checks, snapshot: ctx.snapshot, at: new Date() }, mode, updatedAt: new Date() };

  // auto-adjust: widen SL behind a strong level (bounded), never silently tighten
  if (cfg.autoAdjust && ctx.snapshot?.slGuard && t.status !== "filled" && t.status !== "managing") {
    const dirN = t.dir === "buy" ? 1 : -1;
    const guard = ctx.snapshot.slGuard.price;
    const pad = 0.25 * avgRange(frames.M15 || []);
    const guarded = dirN === 1 ? guard - pad : guard + pad;
    const origRisk = Math.abs(t.originalEntry - t.originalSl);
    const newRisk = Math.abs(t.entry - guarded);
    const wider = dirN === 1 ? guarded < t.sl : guarded > t.sl;
    if (wider && newRisk <= (cfg.maxSlWidenMult ?? 1.5) * origRisk && newRisk > origRisk) {
      set.sl = round5(guarded);
      set.autoAdjusted = true;
    }
  }
  return { set, ctx, mode };
}

// ---------------- monitor (rides the alert-engine tick batch) ---------------

export async function executorOnTicks(ticks) {
  const cfg = g._tsExecCfgCache;
  if (!cfg) return;
  if (g._tsExecMonitoring) return;
  if (g._tsExecLastMon && Date.now() - g._tsExecLastMon < 2000) return;
  g._tsExecLastMon = Date.now();
  g._tsExecMonitoring = true;
  try {
    const { tradesCol } = await executorCols();
    const open = await tradesCol.find({ status: { $in: OPEN_STATES } }).toArray();
    g._tsExecSymbols = [...new Set(open.map((t) => t.symbol))];
    if (!open.length) return;
    const now = new Date();

    for (const t of open) {
      const tick = ticks[t.symbol];
      if (!tick) continue;
      const dirN = t.dir === "buy" ? 1 : -1;
      const px = t.dir === "buy" ? (tick.ask ?? tick.bid) : (tick.bid ?? tick.ask);
      if (!px) continue;
      const zoneH = Math.abs(t.entry - t.sl) || 1e-9;

      // TTL expiry for anything not yet filled
      if (t.status !== "filled" && t.status !== "managing"
        && now - new Date(t.createdAt) > (cfg.executorTtlHours ?? 48) * 3600_000) {
        await transition(tradesCol, t, "expired", `TTL ${cfg.executorTtlHours ?? 48}h exceeded (never filled)`, cfg);
        continue;
      }

      if (t.status === "armed") {
        const dist = dirN === 1 ? px - t.entry : t.entry - px;
        if (dist <= (cfg.approachMult ?? 1.5) * zoneH) {
          await transition(tradesCol, t, "validating", `price ${px} within ${cfg.approachMult ?? 1.5}× zone — validating`, cfg);
          queueValidation(tradesCol, { ...t, status: "validating" }, cfg);
        }
      } else if (t.status === "validating") {
        // validation runs async (queueValidation) and moves us to awaiting_entry;
        // guard against price blowing through the SL while we wait
        const kill = hardInvalidationTick(dirN, t, px);
        if (kill) await transition(tradesCol, t, "invalidated", kill, cfg);
      } else if (t.status === "awaiting_entry") {
        await handleAwaitingEntry(tradesCol, t, cfg, tick, px, dirN, zoneH);
      } else if (t.status === "filled" || t.status === "managing") {
        await handleManage(tradesCol, t, cfg, tick, px, dirN);
      }
    }
  } catch (err) {
    console.error("[executor] monitor error:", err.message);
  } finally {
    g._tsExecMonitoring = false;
  }
}

const hardInvalidationTick = (dirN, t, px) =>
  (dirN === 1 ? px < t.sl : px > t.sl) ? `price through SL side to ${px} before entry` : null;

// awaiting_entry: zone tapped? then per-mode gate (direct fills; candle/
// structural need a fresh frames check). Hard-invalidation can kill it.
async function handleAwaitingEntry(tradesCol, t, cfg, tick, px, dirN, zoneH) {
  const tappedZone = dirN === 1 ? px <= t.entry : px >= t.entry;
  // check hard invalidation on a frames pull (cheap: cached by data.js)
  const frames = await getFrames(t.symbol).catch(() => null);
  const kill = hardInvalidation(frames, t.dir, t, px);
  if (kill.dead) { await transition(tradesCol, t, "invalidated", kill.note, cfg); return; }
  if (!tappedZone) return;

  let ready = false, note = "";
  if (t.mode === "direct") { ready = true; note = "direct fill on zone tap"; }
  else if (t.mode === "candle") {
    const cc = candleConfirm(frames?.M15 || [], t.dir);
    ready = cc.pass; note = `candle: ${cc.note}`;
  } else { // structural
    const sc = structuralConfirm(frames, t.dir);
    ready = sc.pass; note = `structural: ${sc.note}`;
  }
  if (ready) await fillSetup(tradesCol, t, cfg, tick, px, dirN, note);
}

// ---------------- sizing ----------------
function computeVolume(t, cfg) {
  const risk = Math.abs(t.entry - t.sl);
  if (!cfg.accountEquity || !cfg.riskPct || risk <= 0) {
    return { volume: clampLot(cfg.lotSize || 0.01, cfg), how: `fixed ${cfg.lotSize || 0.01}` };
  }
  const riskCash = cfg.accountEquity * (cfg.riskPct / 100);
  // pipValue heuristic: value of one price-unit per 1.0 lot. FX majors ≈ 100000
  // units → 1.0 price move = $100000; per-pip on 5-digit ≈ $10/lot. We size off
  // price distance directly: lots = riskCash / (riskDistance × contract).
  const contract = contractValue(t.symbol);
  const lots = riskCash / (risk * contract);
  return { volume: clampLot(lots, cfg), how: `risk ${cfg.riskPct}% of ${cfg.accountEquity} → ${lots.toFixed(2)}` };
}
function contractValue(symbol) {
  const s = symbol.toUpperCase();
  if (/JPY$/.test(s)) return 1000;      // JPY pairs: ~1000 quote units effective
  if (/^XAU|GOLD/.test(s)) return 100;  // gold: 100 oz/lot
  if (/^XAG|SILVER/.test(s)) return 5000;
  if (s.length === 6) return 100000;    // fx standard lot
  return 1;                             // indices/crypto: 1 unit — approximate
}
function clampLot(v, cfg) {
  const step = cfg.lotStep || 0.01;
  const min = cfg.lotSize || 0.01;
  const max = cfg.maxLot || 5;
  let x = Math.round(v / step) * step;
  x = Math.max(min, Math.min(max, x));
  return Math.round(x * 100) / 100;
}

// ---------------- fill (paper or live) ----------------
async function fillSetup(tradesCol, t, cfg, tick, px, dirN, gateNote) {
  const now = new Date();
  const { volume, how } = computeVolume(t, cfg);
  const spread = (tick.ask && tick.bid) ? (tick.ask - tick.bid) : 0;
  let executedPx = px, ticket = null, fillMsg = `paper fill @ ${px} (${gateNote}) · size ${volume} [${how}]`;

  const goLive = t.live && cfg.liveEnabled;
  if (goLive) {
    try {
      const res = await bridge("POST", "/order", { action: t.dir, symbol: t.symbol, volume, sl: t.sl, tp: t.tp });
      if (res.ok) { ticket = res.ticket; executedPx = res.price || px; fillMsg = `LIVE fill @ ${executedPx} (ticket ${ticket}) · size ${volume} · spread ${spread.toFixed(5)}`; }
      else { fillMsg = `paper fill @ ${executedPx} (LIVE order failed: ${res.message})`; notify(cfg, `🎯⚠️ <b>EXECUTOR LIVE FAILED ${t.symbol}</b>\n${res.message}\nTracking on paper.`); }
    } catch (err) {
      fillMsg = `paper fill @ ${executedPx} (LIVE bridge error: ${err.message})`;
      notify(cfg, `🎯⚠️ <b>EXECUTOR BRIDGE ERROR ${t.symbol}</b>\n${err.message}\nTracking on paper.`);
    }
  }
  const ok = await tradesCol.updateOne({ _id: t._id, status: "awaiting_entry" }, {
    $set: { status: "filled", filledAt: now, filledPrice: executedPx, filledLive: goLive && !!ticket, ticket, volume, entrySpread: spread, updatedAt: now },
    $push: { events: { at: now, type: "filled", note: fillMsg } },
  });
  if (!ok.modifiedCount) return; // raced to a terminal state
  notify(cfg, `🎯✅ <b>EXECUTOR FILLED ${t.symbol}</b> ${t.dir === "buy" ? "🟢" : "🔴"} @ ${executedPx}\nSL ${t.sl} · TP ${t.tp} · RR ${t.rr} · ${goLive && ticket ? `ticket ${ticket}` : "paper"}`);
  broadcast({ type: "executor_changed" });
}

// ---------------- manage (BE + trail + exits) ----------------
async function handleManage(tradesCol, t, cfg, tick, px, dirN) {
  const now = new Date();
  const entryPx = t.filledPrice ?? t.entry;
  const origSl = t.originalSl ?? t.sl;
  const risk = Math.abs(entryPx - origSl);
  const exitPx = t.dir === "buy" ? (tick.bid ?? px) : (tick.ask ?? px);
  const liveR = risk > 0 ? ((dirN === 1 ? exitPx - entryPx : entryPx - exitPx) / risk) : 0;

  // breakeven at beAtR
  let targetSl = t.sl;
  if (cfg.beAtR && liveR >= cfg.beAtR) targetSl = entryPx;
  // structure trail: behind the latest opposite M15 swing
  if (cfg.trailMode === "structure" && liveR >= (cfg.beAtR || 1)) {
    const frames = await getFrames(t.symbol).catch(() => null);
    const trail = trailStop(frames?.M15, dirN);
    if (trail != null) targetSl = dirN === 1 ? Math.max(targetSl, trail) : Math.min(targetSl, trail);
  }
  const better = dirN === 1 ? targetSl > t.sl : targetSl < t.sl;
  if (better) {
    let msg = `SL → ${round5(targetSl)} (${liveR >= (cfg.beAtR || 1) ? "BE+" : "trail"} at ${liveR.toFixed(2)}R)`;
    if (t.filledLive && t.ticket && cfg.liveEnabled) {
      try { const r = await bridge("POST", "/modify", { ticket: t.ticket, sl: round5(targetSl) }); if (!r.ok) msg += ` (modify failed: ${r.message})`; }
      catch (err) { msg += ` (bridge error: ${err.message})`; }
    }
    await tradesCol.updateOne({ _id: t._id }, {
      $set: { sl: round5(targetSl), status: "managing", updatedAt: now },
      $push: { events: { at: now, type: "sl_move", note: msg } },
    });
    t.sl = round5(targetSl);
    broadcast({ type: "executor_changed" });
  }

  const hitSL = dirN === 1 ? exitPx <= t.sl : exitPx >= t.sl;
  const hitTP = dirN === 1 ? exitPx >= t.tp : exitPx <= t.tp;
  if (hitSL || hitTP) {
    const resultR = Math.round(liveR * 100) / 100;
    const status = hitTP ? "won" : (resultR >= 0 ? "won" : "lost");
    await transition(tradesCol, t, status, `${hitSL ? "SL" : "TP"} hit @ ${exitPx} (${resultR}R)`, cfg, { resultR, closedPrice: exitPx });
    const emoji = hitTP ? "🏆" : (resultR >= 0 ? "🛡" : "❌");
    notify(cfg, `🎯${emoji} <b>EXECUTOR ${status.toUpperCase()} ${t.symbol}</b> ${resultR >= 0 ? "+" : ""}${resultR}R @ ${exitPx}`);
    broadcast({ type: "executor_changed" });
  }
}

// latest opposite-side M15 swing as a trailing stop reference
function trailStop(M15, dirN) {
  if (!M15?.length || M15.length < 10) return null;
  const look = M15.slice(-10);
  return dirN === 1 ? Math.min(...look.map((b) => b.low)) : Math.max(...look.map((b) => b.high));
}

// ---------------- validation queue (async, off the tick loop) ---------------
function queueValidation(tradesCol, t, cfg) {
  (async () => {
    const res = await runValidation(tradesCol, t, cfg);
    if (!res) return;
    const now = new Date();
    const ok = await tradesCol.updateOne({ _id: t._id, status: "validating" }, {
      $set: { ...res.set, status: "awaiting_entry" },
      $push: { events: { at: now, type: "validated", note: `context ${res.ctx.score}/100 (${res.ctx.grade}) → ${res.mode} entry${res.set.autoAdjusted ? `; SL auto-widened to ${res.set.sl}` : ""}` } },
    });
    if (!ok.modifiedCount) return;
    notify(cfg, `🎯🔎 <b>EXECUTOR VALIDATED ${t.symbol}</b> — ${res.ctx.score}/100 (${res.ctx.grade}) → <b>${res.mode}</b> entry\n` +
      res.ctx.checks.filter((c) => c.applies !== false).map((c) => `${c.score >= 0 ? "✅" : "⚠️"} ${c.name}: ${c.note}`).join("\n"));
    broadcast({ type: "executor_changed" });
  })().catch((err) => console.error("[executor] validation error:", err.message));
}

// ---------------- shared ----------------
async function transition(tradesCol, t, status, note, cfg, extras = {}) {
  const now = new Date();
  const res = await tradesCol.updateOne({ _id: t._id, status: t.status }, {
    $set: { status, updatedAt: now, ...(isClosed(status) ? { closedAt: now } : {}), ...extras },
    $push: { events: { at: now, type: status, note } },
  });
  if (res.modifiedCount) broadcast({ type: "executor_changed" });
  return res.modifiedCount > 0;
}

// accept ObjectId hex strings; fall back to the raw value otherwise
const idFilter = (id) => oid(id) || id;
const round5 = (v) => Math.round(v * 1e5) / 1e5;
function notify(cfg, msg) { if (cfg?.telegram) sendTelegram(msg, "SETUP").catch(() => {}); }

// ---------------- boot ----------------
export function startExecutorLoop() {
  if (g._tsExecStarted) return;
  g._tsExecStarted = true;
  const refreshCfg = async () => { try { g._tsExecCfgCache = await getConfig(); } catch {} };
  refreshCfg();
  setInterval(refreshCfg, 30_000);
  console.log("[executor] engine started (monitor on tick stream)");
}


