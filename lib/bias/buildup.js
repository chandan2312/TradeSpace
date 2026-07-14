import { findPivots, avgRange, detectGaps } from "../patterns/core.js";

// Liquidity Buildup & Compression Detector
// Maps complex, multi-phase trendline liquidity, curvy boundaries, and compression blocks.
// Experienced traders know trendlines aren't perfect straight lines—they are zones of grinding price action
// that engineer liquidity before a sweep.

export function detectTrendlineLiquidity(bars, avg, lookback = 120) {
  const n = bars.length;
  if (n < 20) return { draws: [] };

  const start = Math.max(0, n - lookback);
  const win = bars.slice(start);
  const { highs, lows } = findPivots(win, 3, 3);
  
  const draws = [];
  const sweeps = [];
  const px = bars[n - 1].close;
  const eps = 0.5 * avg;
  const gaps = detectGaps(win, avg, 3.0);

  // 1. Descending Compression / Trendline (BSL - Above Price)
  // Logic: Group highs that form a general downward cascade. 
  // Internal higher-highs are allowed (curvy TL or multi-phase) as long as they don't break the anchor 
  // or show massive upside displacement.
  let bslGroups = [];
  let currentBsl = [];

  for (let i = 0; i < highs.length; i++) {
    const H = highs[i];

    if (currentBsl.length === 0) {
      currentBsl.push(H);
    } else {
      const anchor = currentBsl[0];
      const prev = currentBsl[currentBsl.length - 1];
      
      const gapFound = gaps.some(g => g.i > prev.i && g.i <= H.i);

      if (H.price > anchor.price + eps) {
        if (currentBsl.length >= 3) bslGroups.push(currentBsl);
        currentBsl = [H];
      } 
      else if (H.price > prev.price && (H.price - prev.price) > 3 * avg) {
        if (currentBsl.length >= 3) bslGroups.push(currentBsl);
        currentBsl = [H];
      } 
      else if (H.i - prev.i > 40) { // Temporal break: Too much time passed
        if (currentBsl.length >= 3) bslGroups.push(currentBsl);
        currentBsl = [H];
      }
      else if (gapFound) { // Anomaly break: Massive gap invalidates compression
        if (currentBsl.length >= 3) bslGroups.push(currentBsl);
        currentBsl = [H];
      }
      else {
        currentBsl.push(H);
      }
    }
  }
  if (currentBsl.length >= 3) bslGroups.push(currentBsl);

  for (const grp of bslGroups) {
    const startH = grp[0];
    const endH = grp[grp.length - 1];
    
    if (endH.price < startH.price + eps) {
      const note = grp.length >= 5 ? "Massive multi-phase compression" : "Curvy trendline liquidity";
      
      // Classification: Is the anchor swept, broken, or untapped?
      // Check the candles after the last pivot in the group, inside the `win` slice.
      let state = "untapped";
      let sweptAt = null;
      const nWin = win.length;
      for (let j = endH.i + 1; j < nWin; j++) {
        if (win[j].high > startH.price + eps / 2) {
          // It pierced the anchor. Did it close back down?
          let closedBack = false;
          for (let k = j; k < Math.min(j + 4, nWin); k++) {
             if (win[k].close < startH.price) { closedBack = true; break; }
          }
          if (closedBack) {
            state = "swept";
            sweptAt = start + j; // Translate back to absolute index for age calculation
            break;
          } else {
            state = "broken";
            break;
          }
        }
      }

      if (state === "untapped" && startH.price > px) {
        draws.push({ type: "Descending BSL", side: 1, touches: grp.length, start: startH, end: endH, note });
      } else if (state === "swept") {
        sweeps.push({ type: "Descending BSL Swept", side: 1, touches: grp.length, start: startH, end: endH, note, age: n - 1 - sweptAt });
      }
    }
  }


  // 2. Ascending Compression / Trendline (SSL - Below Price)
  // Mirror logic for Ascending Lows building Sell-Side Liquidity.
  let sslGroups = [];
  let currentSsl = [];

  for (let i = 0; i < lows.length; i++) {
    const L = lows[i];

    if (currentSsl.length === 0) {
      currentSsl.push(L);
    } else {
      const anchor = currentSsl[0];
      const prev = currentSsl[currentSsl.length - 1];
      
      const gapFound = gaps.some(g => g.i > prev.i && g.i <= L.i);

      if (L.price < anchor.price - eps) {
        if (currentSsl.length >= 3) sslGroups.push(currentSsl);
        currentSsl = [L];
      }
      else if (L.price < prev.price && (prev.price - L.price) > 3 * avg) {
        if (currentSsl.length >= 3) sslGroups.push(currentSsl);
        currentSsl = [L];
      }
      else if (L.i - prev.i > 40) { // Temporal break
        if (currentSsl.length >= 3) sslGroups.push(currentSsl);
        currentSsl = [L];
      }
      else if (gapFound) { // Anomaly break
        if (currentSsl.length >= 3) sslGroups.push(currentSsl);
        currentSsl = [L];
      }
      else {
        currentSsl.push(L);
      }
    }
  }
  if (currentSsl.length >= 3) sslGroups.push(currentSsl);

  for (const grp of sslGroups) {
    const startL = grp[0];
    const endL = grp[grp.length - 1];
    
    if (endL.price > startL.price - eps) {
      const note = grp.length >= 5 ? "Massive multi-phase compression" : "Curvy trendline liquidity";
      
      let state = "untapped";
      let sweptAt = null;
      const nWin = win.length;
      for (let j = endL.i + 1; j < nWin; j++) {
        if (win[j].low < startL.price - eps / 2) {
          let closedBack = false;
          for (let k = j; k < Math.min(j + 4, nWin); k++) {
             if (win[k].close > startL.price) { closedBack = true; break; }
          }
          if (closedBack) {
            state = "swept";
            sweptAt = start + j; // Translate to absolute index
            break;
          } else {
            state = "broken";
            break;
          }
        }
      }

      if (state === "untapped" && startL.price < px) {
        draws.push({ type: "Ascending SSL", side: -1, touches: grp.length, start: startL, end: endL, note });
      } else if (state === "swept") {
        sweeps.push({ type: "Ascending SSL Swept", side: -1, touches: grp.length, start: startL, end: endL, note, age: n - 1 - sweptAt });
      }
    }
  }

  return { draws, sweeps };
}
