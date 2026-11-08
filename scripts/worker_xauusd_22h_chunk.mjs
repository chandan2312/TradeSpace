import fs from "fs";
import path from "path";
import { computeSymbolBias } from "../lib/bias/engine.js";
import { evaluateSymbol } from "../lib/autonomous/scanner.js";

function resampleSeries(bars, intervalSec) {
  const buckets = new Map();
  for (const b of bars) {
    const bucketTime = Math.floor(b.t / intervalSec) * intervalSec;
    let buck = buckets.get(bucketTime);
    if (!buck) {
      buck = { time: bucketTime, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0, count: 0 };
      buckets.set(bucketTime, buck);
    } else {
      if (b.high > buck.high) buck.high = b.high;
      if (b.low < buck.low) buck.low = b.low;
      buck.close = b.close;
      buck.volume += (b.volume || 0);
    }
    buck.count++;
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

// 22-hour continuous Gold trading (excluding the 2-hour rollover dead zone: 21:00 - 23:00 UTC)
function isAllowed22hWindow(epochSec) {
  const d = new Date(epochSec * 1000);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const totalMin = hour * 60 + minute;
  // 21:00 to 23:00 UTC = minutes 1260 to 1380
  const isDeadZone = totalMin >= 1260 && totalMin < 1380;
  return !isDeadZone;
}

export async function processChunk(chunkId, startIdx, endIdx, dataDir) {
  const chunksDir = path.join(dataDir, "chunks_xauusd_22h");
  if (!fs.existsSync(chunksDir)) fs.mkdirSync(chunksDir, { recursive: true });

  const chunkFile = path.join(chunksDir, `chunk_${String(chunkId).padStart(2, "0")}.json`);
  const tmpFile = `${chunkFile}.tmp`;

  // Resume check
  if (fs.existsSync(chunkFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(chunkFile, "utf-8"));
      if (Array.isArray(existing)) {
        return { chunkId, skipped: true, candidateCount: existing.length };
      }
    } catch (_) {}
  }

  // Load datasets
  const xauBars = JSON.parse(fs.readFileSync(path.join(dataDir, "xauusd_15m.json"), "utf-8"));
  const xagBars = JSON.parse(fs.readFileSync(path.join(dataDir, "xagusd_15m.json"), "utf-8"));

  // Pre-normalize time
  for (let b of xauBars) b.time = b.t;
  for (let b of xagBars) b.time = b.t;

  const fullH1_xau = resampleSeries(xauBars, 3600);
  const fullH4_xau = resampleSeries(xauBars, 14400);
  const fullD1_xau = resampleSeries(xauBars, 86400);

  const fullM15_xag = xagBars;
  const fullH1_xag = resampleSeries(xagBars, 3600);
  const fullH4_xag = resampleSeries(xagBars, 14400);

  // Configuration: 22-Hour Day Trading across Asia, London, NY
  const cfg = {
    minConviction: 60,
    confluenceThreshold: 60,
    enforceSymbolSessions: false,
    sessionFilters: { london: true, newyork: true, asia: true },
    allowedTimeSlots: {
      asian_range: true,
      off_session_lull: true,
      pre_london_prep: true,
      london_open: true,
      london_lunch: true,
      pre_ny_prep: true,
      ny_open: true,
      ny_silver_bullet: true,
      london_close: true,
      ny_pm: true,
    },
    enabledHorizons: { day: true, scalp: false, swing: false },
    enabledModels: {
      ict_2022: true,
      turtle_soup: true,
      breaker_block: true,
      ote_continuation: true,
      silver_bullet: true,
      displacement_breakout: true,
    },
  };

  const stagedCandidates = [];
  const t0 = performance.now();

  let ptrH1 = 0, ptrH4 = 0, ptrD1 = 0;
  let ptrM15_xag = 0, ptrH1_xag = 0, ptrH4_xag = 0;

  for (let i = startIdx; i <= endIdx && i < xauBars.length; i++) {
    const curBar = xauBars[i];
    const targetT = curBar.t;
    const barCloseT = targetT + 900;

    if (!isAllowed22hWindow(targetT)) continue;

    const m15Slice = xauBars.slice(Math.max(0, i - 360), i + 1);

    while (ptrH1 + 1 < fullH1_xau.length && fullH1_xau[ptrH1 + 1].time + 3600 <= barCloseT) ptrH1++;
    const idxH1 = (fullH1_xau[ptrH1]?.time + 3600 <= barCloseT) ? ptrH1 : -1;
    const h1Bars = idxH1 >= 0 ? fullH1_xau.slice(Math.max(0, idxH1 - 259), idxH1 + 1) : [];

    while (ptrH4 + 1 < fullH4_xau.length && fullH4_xau[ptrH4 + 1].time + 14400 <= barCloseT) ptrH4++;
    const idxH4 = (fullH4_xau[ptrH4]?.time + 14400 <= barCloseT) ? ptrH4 : -1;
    const h4Bars = idxH4 >= 0 ? fullH4_xau.slice(Math.max(0, idxH4 - 219), idxH4 + 1) : [];

    while (ptrD1 + 1 < fullD1_xau.length && fullD1_xau[ptrD1 + 1].time + 86400 <= barCloseT) ptrD1++;
    const idxD1 = (fullD1_xau[ptrD1]?.time + 86400 <= barCloseT) ? ptrD1 : -1;
    const d1Bars = idxD1 >= 0 ? fullD1_xau.slice(Math.max(0, idxD1 - 99), idxD1 + 1) : [];

    const frames = { M15: m15Slice, H1: h1Bars, H4: h4Bars, D1: d1Bars };

    while (ptrM15_xag + 1 < fullM15_xag.length && fullM15_xag[ptrM15_xag + 1].time + 900 <= barCloseT) ptrM15_xag++;
    const idxM15_xag = (fullM15_xag[ptrM15_xag]?.time + 900 <= barCloseT) ? ptrM15_xag : -1;
    const xagSlice = idxM15_xag >= 0 ? fullM15_xag.slice(Math.max(0, idxM15_xag - 359), idxM15_xag + 1) : [];

    while (ptrH1_xag + 1 < fullH1_xag.length && fullH1_xag[ptrH1_xag + 1].time + 3600 <= barCloseT) ptrH1_xag++;
    const idxH1_xag = (fullH1_xag[ptrH1_xag]?.time + 3600 <= barCloseT) ? ptrH1_xag : -1;
    const xagH1 = idxH1_xag >= 0 ? fullH1_xag.slice(Math.max(0, idxH1_xag - 259), idxH1_xag + 1) : [];

    while (ptrH4_xag + 1 < fullH4_xag.length && fullH4_xag[ptrH4_xag + 1].time + 14400 <= barCloseT) ptrH4_xag++;
    const idxH4_xag = (fullH4_xag[ptrH4_xag]?.time + 14400 <= barCloseT) ? ptrH4_xag : -1;
    const xagH4 = idxH4_xag >= 0 ? fullH4_xag.slice(Math.max(0, idxH4 - 219), idxH4_xag + 1) : [];

    const partnerXAG = { M15: xagSlice, H1: xagH1, H4: xagH4 };
    const partnerFrames = { XAGUSD: partnerXAG };
    const gathered = new Map();
    gathered.set("XAGUSD", partnerXAG);

    const extras = { now: targetT * 1000, partnerFrames };

    const bias = computeSymbolBias("XAUUSD", frames, extras);
    const evalResult = evaluateSymbol("XAUUSD", frames, gathered, cfg, targetT * 1000, null, bias);

    if (evalResult.stagedLevel) {
      stagedCandidates.push({
        barIdx: i,
        t: targetT,
        isoTime: new Date(targetT * 1000).toISOString(),
        currentPrice: curBar.close,
        dir: evalResult.dir,
        tier: evalResult.execution?.tier || "watching",
        approved: evalResult.execution?.approved === true || (!evalResult.execution?.vetoes?.length),
        candidateLevel: {
          entry: evalResult.stagedLevel.entry,
          stopLoss: evalResult.stagedLevel.sl,
          takeProfit: evalResult.stagedLevel.tp,
          rr: evalResult.stagedLevel.rr,
          modelId: evalResult.stagedLevel.modelId || evalResult.stagedLevel.id,
          modelName: evalResult.stagedLevel.modelName || evalResult.stagedLevel.model,
          horizon: evalResult.resolution?.scenario?.id || "day",
          confluenceScore: evalResult.stagedLevel.confluenceScore,
        },
        execution: {
          vetoes: evalResult.execution?.vetoes || [],
          approved: evalResult.execution?.approved,
        },
        biasSnapshot: {
          score: bias.score,
          brainVerdict: bias.brain?.verdict,
          action: bias.brain?.action,
          conviction: bias.brain?.horizons?.DAY?.convictionScore || bias.score,
          dol: bias.brain?.targetDOL?.price || bias.htfLiquidity?.drawOnLiquidity?.price,
        },
      });
    }
  }

  // Atomic write
  fs.writeFileSync(tmpFile, JSON.stringify(stagedCandidates, null, 2), "utf-8");
  fs.renameSync(tmpFile, chunkFile);

  const durationSec = ((performance.now() - t0) / 1000).toFixed(1);
  return { chunkId, skipped: false, candidateCount: stagedCandidates.length, durationSec };
}

if (process.argv[1]?.endsWith("worker_xauusd_22h_chunk.mjs")) {
  const chunkId = parseInt(process.argv[2], 10);
  const startIdx = parseInt(process.argv[3], 10);
  const endIdx = parseInt(process.argv[4], 10);
  const dataDir = process.argv[5] || path.resolve("quant_service/data");

  processChunk(chunkId, startIdx, endIdx, dataDir)
    .then(res => {
      console.log(JSON.stringify(res));
      process.exit(0);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
