import fs from "fs";
import path from "path";
import { fork } from "child_process";

const MAX_WORKERS = parseInt(process.env.MAX_WORKERS || "2", 10);
const NUM_CHUNKS = 48;
const START_IDX = 500;
const TOTAL_BARS = 156050;

async function runParallelMaster() {
  const dataDir = path.resolve("quant_service/data");
  const chunksDir = path.join(dataDir, "chunks_xauusd_22h");
  const pauseSignalFile = path.join(dataDir, "PAUSE_XAUUSD_22H");

  if (process.argv.includes("--resume") && fs.existsSync(pauseSignalFile)) {
    fs.unlinkSync(pauseSignalFile);
  }

  os_ensure_dir(chunksDir);

  console.log("===============================================================================");
  console.log(` 22-HOUR CONTINUOUS MARKET BRAIN ENGINE: XAUUSD (GOLD)`);
  console.log(` SMT Partner: XAGUSD (Silver) | Timeframe: 4H-15M Day Horizon`);
  console.log(` Trading Hours: 22h Continuous (Excluding 21:00-23:00 UTC rollover dead zone)`);
  console.log(` Mode: ${MAX_WORKERS} Workers (Laptop Thermal & RAM Safe)`);
  console.log(` Chunks: ${NUM_CHUNKS} granular checkpoints | Span: Bars ${START_IDX}..${TOTAL_BARS}`);
  console.log("===============================================================================");
  console.log(`Chunks Directory: ${chunksDir}`);

  const range = TOTAL_BARS - START_IDX;
  const chunkSize = Math.ceil(range / NUM_CHUNKS);
  const chunks = [];

  for (let i = 0; i < NUM_CHUNKS; i++) {
    const s = START_IDX + i * chunkSize;
    const e = Math.min(TOTAL_BARS, s + chunkSize - 1);
    chunks.push({ id: i, start: s, end: e });
  }

  let alreadyCompleted = 0;
  const pendingChunks = [];
  for (const ch of chunks) {
    const chunkFile = path.join(chunksDir, `chunk_${String(ch.id).padStart(2, "0")}.json`);
    if (fs.existsSync(chunkFile)) {
      try {
        const d = JSON.parse(fs.readFileSync(chunkFile, "utf-8"));
        if (Array.isArray(d)) {
          alreadyCompleted++;
          console.log(`[RESUME CHECK] Chunk ${String(ch.id).padStart(2, "0")} already done (${d.length} candidates) -> SKIPPED`);
          continue;
        }
      } catch (_) {}
    }
    pendingChunks.push(ch);
  }

  console.log(`\nResumption Status: ${alreadyCompleted}/${NUM_CHUNKS} chunks already completed.`);
  console.log(`Pending Chunks to process: ${pendingChunks.length}\n`);

  if (pendingChunks.length === 0) {
    console.log("All chunks are already completed! Stitching now...");
    stitchChunks(chunksDir, dataDir, chunks);
    return;
  }

  const t0 = performance.now();
  let completedCount = alreadyCompleted;
  const workerScript = path.resolve("scripts/worker_xauusd_22h_chunk.mjs");

  let activeWorkers = 0;
  let chunkIdx = 0;
  let isPaused = false;

  const handleInterrupt = () => {
    console.log("\n[INTERRUPT DETECTED] Pausing after active chunks complete. Do not hard-kill...");
    isPaused = true;
  };
  process.on("SIGINT", handleInterrupt);
  process.on("SIGTERM", handleInterrupt);

  await new Promise((resolve) => {
    function next() {
      if (fs.existsSync(pauseSignalFile)) {
        if (!isPaused) {
          console.log(`\n[PAUSE SIGNAL DETECTED via ${pauseSignalFile}] Finishing active workers and pausing...`);
          isPaused = true;
        }
      }

      if (isPaused) {
        if (activeWorkers === 0) {
          console.log(`\n[GRACEFULLY PAUSED] Progress saved (${completedCount}/${NUM_CHUNKS} chunks done). Re-run anytime to resume.`);
          return resolve();
        }
        return;
      }

      if (completedCount === NUM_CHUNKS) {
        return resolve();
      }

      while (activeWorkers < MAX_WORKERS && chunkIdx < pendingChunks.length && !isPaused) {
        const ch = pendingChunks[chunkIdx++];
        activeWorkers++;

        const child = fork(workerScript, [ch.id, ch.start, ch.end, dataDir], {
          stdio: ["inherit", "pipe", "pipe", "ipc"],
          execArgv: ["--max-old-space-size=512"],
        });

        let outputData = "";
        child.stdout.on("data", (d) => { outputData += d.toString(); });
        child.stderr.on("data", (d) => { process.stderr.write(d.toString()); });

        child.on("close", (code) => {
          activeWorkers--;

          if (code === 0) {
            completedCount++;
            let res = {};
            try { res = JSON.parse(outputData.trim().split("\n").pop()); } catch (_) {}
            const pct = ((completedCount / NUM_CHUNKS) * 100).toFixed(1);
            console.log(`[XAU 22H COMPLETE ${completedCount}/${NUM_CHUNKS} | ${pct}%] Chunk ${String(ch.id).padStart(2, "0")} (Bars ${ch.start}..${ch.end}) -> ${res.candidateCount || 0} candidates in ${res.durationSec || "?"}s`);
            next();
          } else {
            console.error(`Chunk ${ch.id} failed with exit code ${code}! Retrying...`);
            pendingChunks.push(ch);
            next();
          }
        });
      }
    }

    next();
  });

  if (completedCount === NUM_CHUNKS) {
    const totalSec = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(`\nAll ${NUM_CHUNKS} chunks finished in ${totalSec}s!`);
    stitchChunks(chunksDir, dataDir, chunks);
  }
}

function os_ensure_dir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function stitchChunks(chunksDir, dataDir, chunks) {
  console.log("\nStitching all completed chunk files into master 22H candidate store...");
  let allCandidates = [];

  for (const ch of chunks) {
    const chunkFile = path.join(chunksDir, `chunk_${String(ch.id).padStart(2, "0")}.json`);
    if (fs.existsSync(chunkFile)) {
      const data = JSON.parse(fs.readFileSync(chunkFile, "utf-8"));
      allCandidates.push(...data);
    } else {
      console.warn(`Warning: Missing ${chunkFile}!`);
    }
  }

  allCandidates.sort((a, b) => a.t - b.t);

  const outPath = path.join(dataDir, "xauusd_22h_staged_candidates.json");
  fs.writeFileSync(outPath, JSON.stringify(allCandidates, null, 2), "utf-8");
  console.log(`===============================================================================`);
  console.log(`MASTER XAUUSD 22H CANDIDATE DATASET READY: ${outPath}`);
  console.log(`Total Staged Candidates: ${allCandidates.length}`);
  console.log(`File Size: ${(fs.statSync(outPath).size / (1024*1024)).toFixed(2)} MB`);
  console.log(`Date Span: ${allCandidates[0]?.isoTime} to ${allCandidates[allCandidates.length - 1]?.isoTime}`);
  console.log(`===============================================================================`);
}

runParallelMaster().catch(console.error);
