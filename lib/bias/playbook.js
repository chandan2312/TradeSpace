import { avgRange } from "../patterns/core.js";
import { analyzeStructure } from "./structure.js";
import { volRatio } from "./volume.js";

// The user's core playbook, detected as one signature:
//   a real liquidity pool gets SWEPT → M15 prints a DISPLACED MSS in the
//   reversal direction AFTER the sweep bar. (M1/M5 removed by design — they
//   added noise, M15 is the execution frame.)

const STRONG_POOLS = /^(PDH|PDL|PWH|PWL|EQH|EQL)$/;

// sweeps: liquidityMap() output ({ name, side, sweptAt, age } — indices into
// `bars`, the M15 series).
export function detectSetup(sweeps, bars) {
  if (!sweeps?.length || !bars) return null;

  const fresh = sweeps.filter((s) => s.age <= 12).sort((a, b) => a.age - b.age);
  for (const s of fresh) {
    const sweepTime = bars[s.sweptAt]?.time;
    if (!sweepTime) continue;
    const dir = -s.side; // reversal trades against the sweep
    const mss = mssConfirm(bars, dir, sweepTime, 16);
    if (!mss) continue;

    // volume vet: climactic MSS upgrades the grade, a thin one downgrades it
    const vr = mss.volRatio;
    let grade = STRONG_POOLS.test(s.name) ? "A" : "B";
    if (vr != null && vr >= 1.8) grade = "A";
    else if (vr != null && vr < 0.6) grade = "B";

    return {
      dir,
      pool: s.name,
      sweptAgo: s.age, // M15 bars
      mssTf: "M15",
      mssAgeMin: mss.age * 15,
      volRatio: vr,
      grade,
    };
  }
  return null;
}

// a fresh displaced MSS in `dir` printed after the sweep. Continuation BOS
// events after the MSS keep it valid; any opposite-direction event negates it.
function mssConfirm(bars, dir, sweepTime, maxAge) {
  if (!bars || bars.length < 30) return null;
  const st = analyzeStructure(bars, avgRange(bars));
  for (let k = st.events.length - 1; k >= 0; k--) {
    const ev = st.events[k];
    if (ev.dir !== dir) return null;
    if (ev.type !== "MSS" || !ev.displaced) continue;
    const age = bars.length - 1 - ev.i;
    if (age > maxAge) return null;
    if (bars[ev.i].time <= sweepTime) return null;
    return { ...ev, age, volRatio: volRatio(bars, ev.i) };
  }
  return null;
}
