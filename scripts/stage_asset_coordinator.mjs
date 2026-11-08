import fs from "fs";
import path from "path";
import { fork } from "child_process";

const MAX_WORKERS = parseInt(process.env.MAX_WORKERS || "2", 10);

function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i].startsWith("--")) {
      const key = process.argv[i].slice(2);
      const val = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

const SYMBOL_CONFIGS = {
  EURUSD: {
    primaryFile: "eurusd_15m.json",
    partnerSymbol: "GBPUSD",
    partnerFile: "gbpusd_15m.json",
    windowType: "ldn_ny",
    defaultChunks: 32,
    outputFile: "eurusd_staged_candidates.json",
    chunksDirName: "chunks_eurusd",
  },
  GER40: {
    primaryFile: "ger40_15m.json",
    partnerSymbol: "SPX500",
    partnerFile: "spx500_15m.json",
    windowType: "eu_cash",
    defaultChunks: 32,
    outputFile: "ger40_staged_candidates.json",
    chunksDirName: "chunks_ger40",
  },
  NAS100: {
    primaryFile: "nas100_15m.json",
    partnerSymbol: "SPX500",
    partnerFile: "spx500_15m.json",
    windowType: "nas_sessions",
    defaultChunks: 32,
    outputFile: "nas100_expanded_staged_candidates.json",
    chunksDirName: "chunks_nas100_expanded",
  },
  XAUUSD: {
    primaryFile: "xauusd_15m.json",
    partnerSymbol: "XAGUSD",
    partnerFile: "xagusd_15m.json",
    windowType: "22h",
    defaultChunks: 48,
    outputFile: "xauusd_expanded_staged_candidates.json",
    chunksDirName: "chunks_xauusd_expanded",
  },
};

async function runCoordinator() {
  const args = parseArgs();
  const sym = (args.symbol || "EURUSD").toUpperCase();
  const cfg = SYMBOL_CONFIGS[sym];
  if (!cfg) {
    console.error(`Unknown symbol: ${sym}. Available: ${Object.keys(SYMBOL_CONFIGS).join(", ")}`);
    process.exit(1);
  }

  const numChunks = parseInt(args.chunks || cfg.defaultChunks, 10);
  const dataDir = path.resolve("quant_service/data");
  const chunksDir = path.join(dataDir, cfg.chunksDirName);
  const pauseSignalFile = path.join(dataDir, `PAUSE_${sym}`);

  if (args.resume && fs.existsSync(pauseSignalFile)) {
    fs.unlinkSync(pauseSignalFile);
  }

  if (!fs.existsSync(chunksDir)) fs.mkdirSync(chunksDir, { recursive: true });

  const primaryData = JSON.parse(fs.readFileSync(path.join(dataDir, cfg.primaryFile), "utf-8"));
  const startIdx = 500;
  const totalBars = primaryData.length;

  console.log("===============================================================================");
  console.log(` MULTI-ASSET STAGING COORDINATOR: ${sym}`);
  console.log(` SMT Partner: ${cfg.partnerSymbol} | Window: ${cfg.windowType}`);
  console.log(` Mode: ${MAX_WORKERS} Workers (Thermal & RAM Safe)`);
  console.log(` Chunks: ${numChunks} checkpoints | Bars: ${startIdx}..${totalBars}`);
  console.log("===============================================================================");
  console.log(`Chunks Directory: ${chunksDir}`);

  const range = totalBars - startIdx;
  const chunkSize = Math.ceil(range / numChunks);
  const chunks = [];

  for (let i = 0; i < numChunks; i++) {
    const s = startIdx + i * chunkSize;
    const e = Math.min(totalBars - 1, s + chunkSize - 1);
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
          continue;
        }
      } catch (_) {}
    }
    pendingChunks.push(ch);
  }

  console.log(`Status: ${alreadyCompleted}/${numChunks} chunks already completed.`);
  console.log(`Pending: ${pendingChunks.length} chunks to process.\n`);

  if (pendingChunks.length === 0) {
    console.log("All chunks are already completed! Stitching now...");
    stitchChunks(chunksDir, dataDir, chunks, cfg.outputFile, sym);
    return;
  }

  const t0 = performance.now();
  let completedCount = alreadyCompleted;
  const workerScript = path.resolve("scripts/worker_universal_chunk.mjs");

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
          console.log(`\n[PAUSE SIGNAL DETECTED] Finishing active workers and pausing...`);
          isPaused = true;
        }
      }

      if (isPaused) {
        if (activeWorkers === 0) {
          console.log(`\n[GRACEFULLY PAUSED] Progress saved (${completedCount}/${numChunks} chunks done).`);
          return resolve();
        }
        return;
      }

      if (completedCount === numChunks) {
        return resolve();
      }

      while (activeWorkers < MAX_WORKERS && chunkIdx < pendingChunks.length) {
        const ch = pendingChunks[chunkIdx++];
        activeWorkers++;

        const workerArgs = {
          symbol: sym,
          primaryFile: cfg.primaryFile,
          partnerSymbol: cfg.partnerSymbol,
          partnerFile: cfg.partnerFile,
          windowType: cfg.windowType,
          chunkId: ch.id,
          startIdx: ch.start,
          endIdx: ch.end,
          dataDir,
          chunksDirName: cfg.chunksDirName,
        };

        const proc = fork(workerScript, [JSON.stringify(workerArgs)], {
          stdio: ["inherit", "pipe", "pipe", "ipc"],
          execArgv: ["--max-old-space-size=512"],
        });

        let outputData = "";
        proc.stdout.on("data", (d) => { outputData += d.toString(); });
        proc.stderr.on("data", (d) => { process.stderr.write(d); });

        proc.on("exit", (code) => {
          activeWorkers--;
          if (code === 0) {
            completedCount++;
            let res = {};
            try { res = JSON.parse(outputData.trim().split("\n").pop()); } catch (_) {}
            const pct = ((completedCount / numChunks) * 100).toFixed(1);
            console.log(`[${sym} COMPLETE ${completedCount}/${numChunks} | ${pct}%] Chunk ${String(ch.id).padStart(2, "0")} (Bars ${ch.start}..${ch.end}) -> ${res.candidateCount || 0} candidates in ${res.durationSec || "?"}s`);
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

  if (completedCount === numChunks) {
    const totalSec = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(`\nAll ${numChunks} chunks finished in ${totalSec}s!`);
    stitchChunks(chunksDir, dataDir, chunks, cfg.outputFile, sym);
  }
}

function stitchChunks(chunksDir, dataDir, chunks, outputFile, sym) {
  console.log(`\nStitching all completed chunk files for ${sym}...`);
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

  const outPath = path.join(dataDir, outputFile);
  fs.writeFileSync(outPath, JSON.stringify(allCandidates, null, 2), "utf-8");
  console.log(`===============================================================================`);
  console.log(`MASTER ${sym} CANDIDATE DATASET READY: ${outPath}`);
  console.log(`Total Staged Candidates: ${allCandidates.length}`);
  console.log(`File Size: ${(fs.statSync(outPath).size / (1024*1024)).toFixed(2)} MB`);
  console.log(`Date Span: ${allCandidates[0]?.isoTime} to ${allCandidates[allCandidates.length - 1]?.isoTime}`);
  console.log(`===============================================================================`);
}

runCoordinator().catch(console.error);
