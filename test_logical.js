function timeToLogical(bars, t, spanSec) {
  if (t == null || !Number.isFinite(t) || !bars || bars.length === 0) return null;
  const last = bars.length - 1;
  const defaultSpan = spanSec || (last > 0 ? bars[last].time - bars[last - 1].time : 1);
  if (t <= bars[0].time) {
    return (t - bars[0].time) / defaultSpan;
  }
  if (t >= bars[last].time) {
    return last + (t - bars[last].time) / defaultSpan;
  }
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= t) lo = mid; else hi = mid;
  }
  const span = bars[hi].time - bars[lo].time || defaultSpan;
  return lo + (t - bars[lo].time) / span;
}

// 4H bars (14400 seconds)
const bars4H = [];
let time = 1000000000;
for(let i=0; i<100; i++) {
  bars4H.push({ time: time + i * 14400 });
}

// 5M points
const t1 = bars4H[50].time + 300; // 5 mins inside the 50th bar
const t2 = bars4H[50].time + 600; // 10 mins inside the 50th bar

const l1 = timeToLogical(bars4H, t1, 14400);
const l2 = timeToLogical(bars4H, t2, 14400);

console.log("t1:", t1, "t2:", t2);
console.log("l1:", l1, "l2:", l2);
console.log("l1 < l2?", l1 < l2);

// What if they are in the whitespace?
const t3 = bars4H[99].time + 300;
const t4 = bars4H[99].time + 1500;
const l3 = timeToLogical(bars4H, t3, 14400);
const l4 = timeToLogical(bars4H, t4, 14400);
console.log("l3:", l3, "l4:", l4);
