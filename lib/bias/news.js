// Beyond-candles input #1: the economic calendar.
// Free ForexFactory weekly feed (no API key). High-impact events within the
// next few hours are a DAMPENER — the cleanest technical setup is a coin
// flip into NFP. Recent releases mark post-news volatility.
// Fails soft: if the feed is unreachable, the engine simply runs without it.
const FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const g = globalThis;
if (!g._tsNews) g._tsNews = { at: 0, events: [] };
const TTL = 30 * 60_000;

export async function getNews() {
  const now = Date.now();
  if (now - g._tsNews.at < TTL) return g._tsNews.events;
  try {
    const res = await fetch(FEED, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    const raw = await res.json();
    const events = (Array.isArray(raw) ? raw : [])
      .filter((e) => e.impact === "High" && e.country && e.date)
      .map((e) => ({
        currency: String(e.country).toUpperCase(),
        title: e.title,
        at: Date.parse(e.date),
      }))
      .filter((e) => Number.isFinite(e.at));
    g._tsNews = { at: now, events };
  } catch {
    // keep whatever we had; empty on first failure
    g._tsNews.at = now - TTL + 5 * 60_000; // retry in 5 min
  }
  return g._tsNews.events;
}

// events relevant to a symbol's currencies, in the actionable window:
// upcoming ≤ soonMs or released within pastMs
export function newsRisk(events, currencies, { soonMs = 2 * 3600e3, pastMs = 3600e3 } = {}) {
  const now = Date.now();
  const relevant = [];
  for (const e of events) {
    if (!currencies.includes(e.currency)) continue;
    const dt = e.at - now;
    if (dt > 0 && dt <= soonMs) relevant.push({ ...e, when: "upcoming", inMin: Math.round(dt / 60e3) });
    else if (dt <= 0 && -dt <= pastMs) relevant.push({ ...e, when: "released", agoMin: Math.round(-dt / 60e3) });
  }
  relevant.sort((a, b) => a.at - b.at);
  return relevant;
}

// which currencies move this symbol
export function symbolCurrencies(symbol, category) {
  const s = symbol.toUpperCase().replace(/[._-].*$/, "").replace(/m$/, "");
  if (category === "fx" && s.length === 6) return [s.slice(0, 3), s.slice(3)];
  if (category === "indices") {
    if (/GER|DAX|DE40|STOXX/.test(s)) return ["EUR"];
    if (/UK100|FTSE/.test(s)) return ["GBP"];
    if (/JP225|NIK/.test(s)) return ["JPY"];
    if (/AUS200/.test(s)) return ["AUD"];
    return ["USD"];
  }
  return ["USD"]; // metals, crypto, energy, US stocks
}
