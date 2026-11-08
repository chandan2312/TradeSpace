import fs from "fs";
import path from "path";
import { fork } from "child_process";

// Safe configuration for 8GB RAM and mobile laptop CPU (i5-11400H)
// Concurrency 2 prevents thermal trips and memory exhaustion while delivering 2x speedup.
const MAX_WORKERS = parseInt(process.env.MAX_WORKERS || "2", 10);
const NUM_CHUNKS = 32;
const START_IDX = 500;
const TOTAL_BARS = 132400;

async function runParallelMaster() {
  const dataDir = path.resolve("quant_service/data");
  const chunksDir = path.join(dataDir, "chunks");
  const pauseSignalFile = path.join(dataDir, "PAUSE_BACKTEST");

  // Remove any leftover pause file at startup if --resume flag is passed
  if (process.argv.includes("--resume") && fs.existsSync(pauseSignalFile)) {
    fs.unlinkSync(pauseSignalFile);
  }

  os_ensure_dir(chunksDir);

  console.log("===============================================================================");
  console.log(` THERMAL-SAFE RESUMABLE POINT-IN-TIME MARKET BRAIN ENGINE`);
  console.log(` Mode: ${MAX_WORKERS} Workers (Throttled for Laptop Thermal & 8GB RAM Safety)`);
  console.log(` Chunks: ${NUM_CHUNKS} granular checkpoints | Span: Bars ${START_IDX}..${TOTAL_BARS}`);
  console.log("===============================================================================");
  console.log(`Chunks Directory: ${chunksDir}`);

  // Calculate chunk ranges
  const range = TOTAL_BARS - START_IDX;
  const chunkSize = Math.ceil(range / NUM_CHUNKS);
  const chunks = [];

  for (let i = 0; i < NUM_CHUNKS; i++) {
    const s = START_IDX + i * chunkSize;
    const e = Math.min(TOTAL_BARS, s + chunkSize - 1);
    chunks.push({ id: i, start: s, end: e });
  }

  // Check existing chunks for resumption
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
  const workerScript = path.resolve("scripts/worker_brain_chunk.mjs");

  let activeWorkers = 0;
  let chunkIdx = 0;
  let isPaused = false;
  const activeProcesses = new Set();

  // Handle graceful exit / pause on SIGINT
  const handleInterrupt = () => {
    console.log("\n[INTERRUPT DETECTED] Pausing after active chunks complete. Do not hard-kill...");
    isPaused = true;
  };
  process.on("SIGINT", handleInterrupt);
  process.on("SIGTERM", handleInterrupt);

  await new Promise((resolve, reject) => {
    function next() {
      // Check for pause file
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
        return; // wait for remaining workers to complete
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
        activeProcesses.add(child);

        let outputData = "";
        child.stdout.on("data", (d) => { outputData += d.toString(); });
        child.stderr.on("data", (d) => { process.stderr.write(d.toString()); });

        child.on("close", (code) => {
          activeWorkers--;
          activeProcesses.delete(child);

          if (code === 0) {
            completedCount++;
            let res = {};
            try { res = JSON.parse(outputData.trim().split("\n").pop()); } catch (_) {}
            const pct = ((completedCount / NUM_CHUNKS) * 100).toFixed(1);
            console.log(`[CHUNK COMPLETE ${completedCount}/${NUM_CHUNKS} | ${pct}%] Chunk ${String(ch.id).padStart(2, "0")} (Bars ${ch.start}..${ch.end}) -> ${res.candidateCount || 0} candidates in ${res.durationSec || "?"}s`);
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
  console.log("\nStitching all completed chunk files into master candidate store...");
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

  // Sort by timestamp
  allCandidates.sort((a, b) => a.t - b.t);

  const outPath = path.join(dataDir, "nas100_staged_candidates.json");
  fs.writeFileSync(outPath, JSON.stringify(allCandidates, null, 2), "utf-8");
  console.log(`===============================================================================`);
  console.log(`MASTER CANDIDATE DATASET READY: ${outPath}`);
  console.log(`Total Staged Candidates: ${allCandidates.length}`);
  console.log(`File Size: ${(fs.statSync(outPath).size / (1024*1024)).toFixed(2)} MB`);
  console.log(`Date Span: ${allCandidates[0]?.isoTime} to ${allCandidates[allCandidates.length - 1]?.isoTime}`);
  console.log(`===============================================================================`);
}

runParallelMaster().catch(console.error);