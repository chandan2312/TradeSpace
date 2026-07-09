import { sendTelegram } from "../telegram.js";

// One-time Telegram ping when the playbook setup completes (pool swept +
// M15 MSS). Deduped per symbol/direction/pool/day — same pattern as the AMD
// auto-alert dedup — so a 90s panel refresh can't re-fire it.
const g = globalThis;
if (!g._tsSetupNotified) g._tsSetupNotified = new Set();

const FRESH_MIN = 45; // only ping while the M15 MSS is ≤3 bars old

export async function notifySetups(results) {
  for (const r of results) {
    const s = r.setup;
    if (!s || s.mssAgeMin > FRESH_MIN) continue;
    if (s.group && !s.group.confirmed) continue; // held until the group agrees
    const key = `SETUP:${r.symbol}:${s.dir}:${s.pool}:${Math.floor(Date.now() / 86_400_000)}`;
    if (g._tsSetupNotified.has(key)) continue;
    g._tsSetupNotified.add(key);
    const groupLine = s.group?.checked
      ? `\ngroup: ${s.group.checks.map((c) => `${c.symbol} ${c.verdict === "aligned" ? "✓" : c.verdict === "against" ? "✗" : "–"}`).join(" · ")}`
      : "";
    await sendTelegram(
      `⚡ <b>Setup — ${r.symbol} ${s.dir > 0 ? "🟢 LONG" : "🔴 SHORT"}</b>\n` +
      `${s.pool} swept → ${s.mssTf} MSS${s.volRatio ? ` on ${parseFloat(Number(s.volRatio).toFixed(2))}× vol` : ""} (grade ${s.grade})\n` +
      `MSS ${s.mssAgeMin}m ago · bias ${r.score > 0 ? "+" : ""}${parseFloat(Number(r.score).toFixed(2))} · confidence ${parseFloat(Number(r.confidence).toFixed(1))}%` +
      groupLine
    );
  }
}
