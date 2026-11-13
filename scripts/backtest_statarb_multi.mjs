import fs from "fs";

function runPairBacktest(pairName, fileA, fileB, config = {}) {
  const {
    windowSize = 80,
    entryZMin = 2.0,
    entryZMax = 3.0,
    exitZ = 0.0,
    stopZ = 3.8,
    maxHoldHours = 48,
    minHalfLife = 2,
    maxHalfLife = 20,
    cooldownBars = 12,
    spreadA = 1.0,
    spreadB = 0.5,
    accountSize = 100000,
    riskPercent = 1.0,
  } = config;

  const rawA = JSON.parse(fs.readFileSync(fileA, "utf8"));
  const rawB = JSON.parse(fs.readFileSync(fileB, "utf8"));

  const mapB = new Map();
  for (const b of rawB) mapB.set(b.t, b);

  const aligned = [];
  for (const a of rawA) {
    const b = mapB.get(a.t);
    if (b) {
      aligned.push({
        t: a.t,
        openA: a.open, highA: a.high, lowA: a.low, closeA: a.close,
        openB: b.open, highB: b.high, lowB: b.low, closeB: b.close,
      });
    }
  }

  // Aggregate to H1
  const bars = [];
  for (let i = 0; i < aligned.length; i += 4) {
    const chunk = aligned.slice(i, i + 4);
    if (chunk.length < 4) break;
    bars.push({
      t: chunk[0].t,
      openA: chunk[0].openA,
      highA: Math.max(...chunk.map((c) => c.highA)),
      lowA: Math.min(...chunk.map((c) => c.lowA)),
      closeA: chunk[3].closeA,
      openB: chunk[0].openB,
      highB: Math.max(...chunk.map((c) => c.highB)),
      lowB: Math.min(...chunk.map((c) => c.lowB)),
      closeB: chunk[3].closeB,
    });
  }

  let balance = accountSize;
  let peak = accountSize;
  let maxDD = 0;
  const trades = [];
  let currentPos = null;
  let lastStopBar = -999;
  let prevZ = 0;

  for (let i = windowSize; i < bars.length; i++) {
    const bar = bars[i];
    const N = windowSize;

    let sX = 0, sY = 0, sXX = 0, sXY = 0;
    for (let k = i - N; k < i; k++) {
      const y = Math.log(bars[k].closeA);
      const x = Math.log(bars[k].closeB);
      sX += x; sY += y; sXX += x * x; sXY += x * y;
    }
    const mX = sX / N, mY = sY / N;
    const vX = sXX / N - mX * mX;
    const cov = sXY / N - mX * mY;
    if (vX <= 1e-12) continue;
    const beta = cov / vX;
    const alpha = mY - beta * mX;

    const spreadHist = [];
    let sSpread = 0, sSpreadSq = 0;
    for (let k = i - N; k < i; k++) {
      const sp = Math.log(bars[k].closeA) - (alpha + beta * Math.log(bars[k].closeB));
      spreadHist.push(sp);
      sSpread += sp;
      sSpreadSq += sp * sp;
    }
    const mSpread = sSpread / N;
    const stdSpread = Math.sqrt(Math.max(1e-12, sSpreadSq / N - mSpread * mSpread));

    // OU Half-life check
    let sP = 0, sPSq = 0, sDS = 0, sPDS = 0;
    const M = spreadHist.length - 1;
    for (let k = 0; k < M; k++) {
      const p = spreadHist[k] - mSpread;
      const n = spreadHist[k + 1] - mSpread;
      const d = n - p;
      sP += p; sPSq += p * p; sDS += d; sPDS += p * d;
    }
    const mP = sP / M;
    const vP = sPSq / M - mP * mP;
    const covPD = sPDS / M - mP * (sDS / M);
    const lambda = vP > 1e-12 ? covPD / vP : 0;
    const isMR = lambda < -0.01;
    const hl = isMR ? -Math.log(2) / lambda : 9999;

    const currentSpread = Math.log(bar.closeA) - (alpha + beta * Math.log(bar.closeB));
    const currentZ = (currentSpread - mSpread) / stdSpread;

    if (currentPos) {
      const holdHours = (bar.t - currentPos.entryT) / 3600;
      let exit = false;
      let reason = "";

      if (currentPos.dir === 1 && currentZ >= -exitZ) {
        exit = true; reason = "TP_MEAN";
      } else if (currentPos.dir === -1 && currentZ <= exitZ) {
        exit = true; reason = "TP_MEAN";
      } else if (Math.abs(currentZ) >= stopZ) {
        exit = true; reason = "SL_DIVERGENCE";
        lastStopBar = i;
      } else if (holdHours >= maxHoldHours) {
        exit = true; reason = "TIME_EXIT";
      }

      if (exit) {
        const stopDist = Math.max(0.005, (stopZ - entryZMin) * stdSpread);
        const notional = (accountSize * (riskPercent / 100)) / stopDist;

        const retA = (bar.closeA - currentPos.entryA) / currentPos.entryA;
        const retB = (bar.closeB - currentPos.entryB) / currentPos.entryB;
        const pairRet = currentPos.dir * (retA - currentPos.beta * retB);

        const friction = (spreadA * 2) / currentPos.entryA + (spreadB * 2 * currentPos.beta) / currentPos.entryB;
        const netRet = pairRet - friction;
        const pnl = notional * netRet;

        balance += pnl;
        if (balance > peak) peak = balance;
        const dd = peak - balance;
        if (dd > maxDD) maxDD = dd;

        trades.push({ pnl, reason, holdHours, dir: currentPos.dir });
        currentPos = null;
      }
    } else {
      const isCooled = i - lastStopBar >= cooldownBars;
      const validHL = isMR && hl >= minHalfLife && hl <= maxHalfLife;

      if (isCooled && validHL) {
        if (prevZ > -entryZMin && currentZ <= -entryZMin && currentZ >= -entryZMax) {
          currentPos = { dir: 1, entryT: bar.t, entryA: bar.closeA, entryB: bar.closeB, beta };
        } else if (prevZ < entryZMin && currentZ >= entryZMin && currentZ <= entryZMax) {
          currentPos = { dir: -1, entryT: bar.t, entryA: bar.closeA, entryB: bar.closeB, beta };
        }
      }
    }
    prevZ = currentZ;
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : Infinity;

  console.log(`\n-------------------------------------------------------------`);
  console.log(`PAIR: ${pairName}`);
  console.log(`Total Bars: ${bars.length} H1 | Trades: ${trades.length}`);
  console.log(`Win Rate  : ${winRate.toFixed(1)}% | Profit Factor: ${pf.toFixed(2)}`);
  console.log(`Net P&L   : ${balance - accountSize >= 0 ? "+" : ""}$${Math.round(balance - accountSize).toLocaleString()} (${((balance - accountSize) / accountSize * 100).toFixed(1)}%)`);
  console.log(`Max DD    : -$${Math.round(maxDD).toLocaleString()} (-${(maxDD / peak * 100).toFixed(2)}%)`);
  console.log(`Avg Win   : +$${Math.round(grossWin / (wins.length || 1))} | Avg Loss: -$${Math.round(grossLoss / ((trades.length - wins.length) || 1))}`);
  const tpCount = trades.filter(t => t.reason === "TP_MEAN").length;
  console.log(`Exits     : TP Reverted: ${tpCount} (${(tpCount / (trades.length || 1) * 100).toFixed(1)}%) | SL: ${trades.filter(t => t.reason === "SL_DIVERGENCE").length} | Timeout: ${trades.filter(t => t.reason === "TIME_EXIT").length}`);
  console.log(`-------------------------------------------------------------`);
}

console.log("RUNNING MULTI-ASSET COINTEGRATION BENCHMARK (5 YEARS DATA)...");

runPairBacktest("NAS100 vs SPX500", "quant_service/data/nas100_15m.json", "quant_service/data/spx500_15m.json", {
  windowSize: 120, entryZMin: 2.2, entryZMax: 3.2, exitZ: 0.1, stopZ: 3.8, maxHoldHours: 48, minHalfLife: 2, maxHalfLife: 24, spreadA: 1.5, spreadB: 0.5
});

runPairBacktest("XAUUSD vs XAGUSD (Gold / Silver)", "quant_service/data/xauusd_15m.json", "quant_service/data/xagusd_15m.json", {
  windowSize: 100, entryZMin: 2.1, entryZMax: 3.2, exitZ: 0.1, stopZ: 3.8, maxHoldHours: 48, minHalfLife: 2, maxHalfLife: 24, spreadA: 0.25, spreadB: 0.02
});

runPairBacktest("EURUSD vs GBPUSD", "quant_service/data/eurusd_15m.json", "quant_service/data/gbpusd_15m.json", {
  windowSize: 100, entryZMin: 2.0, entryZMax: 3.0, exitZ: 0.1, stopZ: 3.6, maxHoldHours: 48, minHalfLife: 2, maxHalfLife: 20, spreadA: 0.00012, spreadB: 0.00015
});
