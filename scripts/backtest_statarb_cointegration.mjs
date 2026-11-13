import fs from "fs";
import path from "path";

// Institutional Statistical Arbitrage (Pairs Trading / Cointegration) Backtester
// Features:
// 1. Rolling OLS Beta calculation
// 2. Ornstein-Uhlenbeck (OU) Mean-Reversion Half-Life Stationarity Filter
// 3. Fresh Cross & Sigma Clamping (no chasing blown-out decoupled spreads)
// 4. Post-Stop Cooldown Filter
// 5. Realistic Prop Broker Spreads & Slippage

function runStatArbBacktest(options = {}) {
  const {
    timeframe = "H1", // "H1" or "M15"
    windowSize = 100,  // rolling lookback window in bars
    entryZMin = 2.0,   // Min Z-score to enter
    entryZMax = 2.8,   // Max Z-score to enter (avoid blown-out earnings decouplings)
    exitZ = 0.2,       // Z-score threshold to take profit (mean reversion)
    stopZ = 3.6,       // Z-score threshold for stop-loss (broken leash cutoff)
    maxHoldBars = 24,  // Max holding period (24 hours)
    minHalfLife = 2,   // Min half-life in bars
    maxHalfLife = 18,  // Max half-life in bars (must mean-revert quickly!)
    cooldownBars = 16, // Bars to wait after a stop-loss before new trade
    accountSize = 100000,
    riskPercent = 1.0, // Risk 1% ($1,000) per trade
    nasSpreadPts = 1.5,// Realistic prop firm spread on NAS100
    spxSpreadPts = 0.5,// Realistic prop firm spread on SPX500
  } = options;

  console.log(`\n=====================================================================`);
  console.log(`INSTITUTIONAL COINTEGRATION & STATARB ENGINE (OU FILTERED)`);
  console.log(`Pair: NAS100 vs SPX500 | Timeframe: ${timeframe} | Lookback: ${windowSize} bars`);
  console.log(`Entry: ${entryZMin} <= |Z| <= ${entryZMax} | Exit: |Z| <= ${exitZ} | Stop: |Z| >= ${stopZ}`);
  console.log(`OU Half-Life Filter: ${minHalfLife}h to ${maxHalfLife}h | Cooldown: ${cooldownBars} bars`);
  console.log(`Friction: NAS spread ${nasSpreadPts} pts, SPX spread ${spxSpreadPts} pts`);
  console.log(`=====================================================================\n`);

  // 1. Load data
  const nasRaw = JSON.parse(fs.readFileSync("quant_service/data/nas100_15m.json", "utf8"));
  const spxRaw = JSON.parse(fs.readFileSync("quant_service/data/spx500_15m.json", "utf8"));

  const spxMap = new Map();
  for (const b of spxRaw) spxMap.set(b.t, b);

  // Align raw 15m bars
  const alignedM15 = [];
  for (const nBar of nasRaw) {
    const sBar = spxMap.get(nBar.t);
    if (sBar) {
      alignedM15.push({
        t: nBar.t,
        nasOpen: nBar.open,
        nasHigh: nBar.high,
        nasLow: nBar.low,
        nasClose: nBar.close,
        spxOpen: sBar.open,
        spxHigh: sBar.high,
        spxLow: sBar.low,
        spxClose: sBar.close,
      });
    }
  }

  // Aggregate to H1
  let bars = [];
  if (timeframe === "H1") {
    for (let i = 0; i < alignedM15.length; i += 4) {
      const chunk = alignedM15.slice(i, i + 4);
      if (chunk.length < 4) break;
      bars.push({
        t: chunk[0].t,
        nasOpen: chunk[0].nasOpen,
        nasHigh: Math.max(...chunk.map((c) => c.nasHigh)),
        nasLow: Math.min(...chunk.map((c) => c.nasLow)),
        nasClose: chunk[3].nasClose,
        spxOpen: chunk[0].spxOpen,
        spxHigh: Math.max(...chunk.map((c) => c.spxHigh)),
        spxLow: Math.min(...chunk.map((c) => c.spxLow)),
        spxClose: chunk[3].spxClose,
      });
    }
  } else {
    bars = alignedM15;
  }

  console.log(`Total aligned ${timeframe} bars: ${bars.length}`);
  const startDate = new Date(bars[0].t * 1000).toISOString().split("T")[0];
  const endDate = new Date(bars[bars.length - 1].t * 1000).toISOString().split("T")[0];
  console.log(`Backtest range: ${startDate} to ${endDate} (~5.1 trading years)\n`);

  // 2. Rolling Cointegration & Simulation
  const trades = [];
  let currentPosition = null;
  let balance = accountSize;
  let peakBalance = accountSize;
  let maxDrawdownDollars = 0;
  let maxDrawdownPct = 0;
  let lastStopBar = -999;
  let prevZ = 0;

  for (let i = windowSize; i < bars.length; i++) {
    const currentBar = bars[i];

    // Rolling OLS: ln(nas) = alpha + beta * ln(spx)
    let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
    const N = windowSize;
    for (let k = i - N; k < i; k++) {
      const y = Math.log(bars[k].nasClose);
      const x = Math.log(bars[k].spxClose);
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumXY += x * y;
    }
    const meanX = sumX / N;
    const meanY = sumY / N;
    const varX = sumXX / N - meanX * meanX;
    const covXY = sumXY / N - meanX * meanY;

    if (varX <= 1e-12) continue;
    const beta = covXY / varX;
    const alpha = meanY - beta * meanX;

    // Calculate spread history array
    const spreadHist = [];
    let sumSpread = 0, sumSpreadSq = 0;
    for (let k = i - N; k < i; k++) {
      const spreadK = Math.log(bars[k].nasClose) - (alpha + beta * Math.log(bars[k].spxClose));
      spreadHist.push(spreadK);
      sumSpread += spreadK;
      sumSpreadSq += spreadK * spreadK;
    }
    const meanSpread = sumSpread / N;
    const stdSpread = Math.sqrt(Math.max(1e-12, sumSpreadSq / N - meanSpread * meanSpread));

    // Calculate Ornstein-Uhlenbeck Half-Life of Mean Reversion on residuals
    // AR(1) model: deltaSpread_t = lambda * spread_{t-1} + error
    let sumSPrev = 0, sumSPrevSq = 0, sumDeltaS = 0, sumSPrevDeltaS = 0;
    const M = spreadHist.length - 1;
    for (let k = 0; k < M; k++) {
      const sPrev = spreadHist[k] - meanSpread;
      const sNext = spreadHist[k + 1] - meanSpread;
      const deltaS = sNext - sPrev;
      sumSPrev += sPrev;
      sumSPrevSq += sPrev * sPrev;
      sumDeltaS += deltaS;
      sumSPrevDeltaS += sPrev * deltaS;
    }
    const meanSPrev = sumSPrev / M;
    const varSPrev = sumSPrevSq / M - meanSPrev * meanSPrev;
    const covSPrevDelta = sumSPrevDeltaS / M - meanSPrev * (sumDeltaS / M);
    const lambda = varSPrev > 1e-12 ? covSPrevDelta / varSPrev : 0;
    // Half life = -ln(2) / lambda (only valid if lambda < 0, meaning mean reverting!)
    const isMeanReverting = lambda < -0.01;
    const halfLife = isMeanReverting ? -Math.log(2) / lambda : 9999;

    // Current bar spread & Z-score
    const currentSpread = Math.log(currentBar.nasClose) - (alpha + beta * Math.log(currentBar.spxClose));
    const currentZ = (currentSpread - meanSpread) / stdSpread;

    // Manage open trade
    if (currentPosition) {
      const holdTimeBars = i - currentPosition.entryIdx;
      let shouldExit = false;
      let exitReason = "";

      // Take Profit (mean reversion back to 0)
      if (currentPosition.dir === 1 && currentZ >= -exitZ) {
        shouldExit = true;
        exitReason = "MEAN_REVERSION_TP";
      } else if (currentPosition.dir === -1 && currentZ <= exitZ) {
        shouldExit = true;
        exitReason = "MEAN_REVERSION_TP";
      }
      // Stop Loss (broken leash divergence)
      else if (Math.abs(currentZ) >= stopZ) {
        shouldExit = true;
        exitReason = "STOP_LOSS_DIVERGENCE";
        lastStopBar = i;
      }
      // Max Time Expiration
      else if (holdTimeBars >= maxHoldBars) {
        shouldExit = true;
        exitReason = "MAX_TIME_EXPIRATION";
      }

      if (shouldExit) {
        // Trade sizing: normalize risk to $1,000 at stop loss distance
        const stopDistanceSpread = Math.max(0.005, (stopZ - entryZMin) * stdSpread);
        const positionNotional = (accountSize * (riskPercent / 100)) / stopDistanceSpread;

        const nasReturn = (currentBar.nasClose - currentPosition.nasEntry) / currentPosition.nasEntry;
        const spxReturn = (currentBar.spxClose - currentPosition.spxEntry) / currentPosition.spxEntry;
        const pairReturn = currentPosition.dir * (nasReturn - currentPosition.beta * spxReturn);

        // Deduct realistic prop spreads
        const nasFriction = (nasSpreadPts * 2) / currentPosition.nasEntry;
        const spxFriction = (spxSpreadPts * 2 * currentPosition.beta) / currentPosition.spxEntry;
        const totalFriction = nasFriction + spxFriction;

        const netReturn = pairReturn - totalFriction;
        const pnlDollars = positionNotional * netReturn;

        balance += pnlDollars;
        if (balance > peakBalance) peakBalance = balance;
        const ddDollars = peakBalance - balance;
        const ddPct = (ddDollars / peakBalance) * 100;
        if (ddDollars > maxDrawdownDollars) maxDrawdownDollars = ddDollars;
        if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

        trades.push({
          entryT: currentPosition.entryT,
          exitT: currentBar.t,
          holdHours: (currentBar.t - currentPosition.entryT) / 3600,
          dir: currentPosition.dir === 1 ? "LONG_SPREAD" : "SHORT_SPREAD",
          entryZ: currentPosition.entryZ.toFixed(2),
          exitZ: currentZ.toFixed(2),
          halfLife: currentPosition.halfLife.toFixed(1),
          pnlDollars: Math.round(pnlDollars * 100) / 100,
          exitReason,
          balance: Math.round(balance),
        });

        currentPosition = null;
      }
    } else {
      // Entry Filters:
      // 1. Not in cooldown after stop-loss
      const isCooledDown = i - lastStopBar >= cooldownBars;
      // 2. Spread must be strongly mean-reverting (OU Half-Life between bounds)
      const hasValidHalfLife = isMeanReverting && halfLife >= minHalfLife && halfLife <= maxHalfLife;

      if (isCooledDown && hasValidHalfLife) {
        // Condition A: Fresh cross into oversold (NAS underperforming SPX) -> Long NAS, Short SPX
        if (prevZ > -entryZMin && currentZ <= -entryZMin && currentZ >= -entryZMax) {
          currentPosition = {
            dir: 1,
            entryIdx: i,
            entryT: currentBar.t,
            nasEntry: currentBar.nasClose,
            spxEntry: currentBar.spxClose,
            beta,
            entryZ: currentZ,
            halfLife,
          };
        }
        // Condition B: Fresh cross into overbought (NAS outperforming SPX) -> Short NAS, Long SPX
        else if (prevZ < entryZMin && currentZ >= entryZMin && currentZ <= entryZMax) {
          currentPosition = {
            dir: -1,
            entryIdx: i,
            entryT: currentBar.t,
            nasEntry: currentBar.nasClose,
            spxEntry: currentBar.spxClose,
            beta,
            entryZ: currentZ,
            halfLife,
          };
        }
      }
    }

    prevZ = currentZ;
  }

  // 3. Performance Analytics
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    console.log("No trades taken with given criteria.");
    return;
  }

  const wins = trades.filter((t) => t.pnlDollars > 0);
  const losses = trades.filter((t) => t.pnlDollars <= 0);
  const winRate = (wins.length / totalTrades) * 100;
  const grossProfit = wins.reduce((sum, t) => sum + t.pnlDollars, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnlDollars, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;
  const netProfit = balance - accountSize;
  const returnPct = (netProfit / accountSize) * 100;

  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const avgHoldHours = trades.reduce((sum, t) => sum + t.holdHours, 0) / totalTrades;

  let maxWinStreak = 0, currentWinStreak = 0;
  let maxLossStreak = 0, currentLossStreak = 0;
  for (const t of trades) {
    if (t.pnlDollars > 0) {
      currentWinStreak++;
      currentLossStreak = 0;
      if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
    } else {
      currentLossStreak++;
      currentWinStreak = 0;
      if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
    }
  }

  console.log(`---------------------------------------------------------------------`);
  console.log(`📊 PERFORMANCE SUMMARY RESULTS (Prop Firm $100K Account)`);
  console.log(`---------------------------------------------------------------------`);
  console.log(`Total Trades Executed     : ${totalTrades}`);
  console.log(`Winning Trades            : ${wins.length} (${winRate.toFixed(1)}% Win Rate)`);
  console.log(`Losing Trades             : ${losses.length} (${(100 - winRate).toFixed(1)}%)`);
  console.log(`Profit Factor             : ${profitFactor.toFixed(2)}`);
  console.log(`---------------------------------------------------------------------`);
  console.log(`Initial Balance           : $${accountSize.toLocaleString()}`);
  console.log(`Final Balance             : $${Math.round(balance).toLocaleString()}`);
  console.log(`Net Profit                : +$${Math.round(netProfit).toLocaleString()} (+${returnPct.toFixed(1)}%)`);
  console.log(`Max Floating Drawdown     : -$${Math.round(maxDrawdownDollars).toLocaleString()} (-${maxDrawdownPct.toFixed(2)}%)`);
  console.log(`---------------------------------------------------------------------`);
  console.log(`Average Win               : +$${Math.round(avgWin).toLocaleString()}`);
  console.log(`Average Loss              : -$${Math.round(avgLoss).toLocaleString()}`);
  console.log(`Win / Loss Ratio          : ${(avgWin / (avgLoss || 1)).toFixed(2)} : 1`);
  console.log(`Average Holding Time      : ${avgHoldHours.toFixed(1)} hours`);
  console.log(`Max Win Streak            : ${maxWinStreak} trades in a row`);
  console.log(`Max Loss Streak           : ${maxLossStreak} trades in a row`);
  console.log(`---------------------------------------------------------------------`);

  console.log(`\nExit Reasons Breakdown:`);
  const exitCounts = {};
  for (const t of trades) exitCounts[t.exitReason] = (exitCounts[t.exitReason] || 0) + 1;
  for (const [r, c] of Object.entries(exitCounts)) {
    console.log(`  - ${r.padEnd(25)}: ${c} (${((c / totalTrades) * 100).toFixed(1)}%)`);
  }

  console.log(`\nRecent 5 Sample Trades:`);
  trades.slice(-5).forEach((t, idx) => {
    const entryDate = new Date(t.entryT * 1000).toISOString().replace("T", " ").slice(0, 16);
    const exitDate = new Date(t.exitT * 1000).toISOString().replace("T", " ").slice(0, 16);
    console.log(`  #${idx + 1} | ${entryDate} -> ${exitDate} | Hold: ${t.holdHours.toFixed(1)}h (HL: ${t.halfLife}h) | ${t.dir} | Entry Z: ${t.entryZ} -> Exit Z: ${t.exitZ} | PnL: ${t.pnlDollars >= 0 ? "+" : ""}$${t.pnlDollars} (${t.exitReason})`);
  });
  console.log(`=====================================================================\n`);
}

runStatArbBacktest();
