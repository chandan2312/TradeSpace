// Watchlist resolver and symbol matcher for Autonomous Brain Trader.
// Strictly enforces that order entries occur ONLY on symbols in the Main Watchlist,
// while permitting any symbols to be scanned for context, SMT, and correlation.

import { allWatchlists } from "../mongo.js";

const ALIASES = [
  ["US30", /^(US30|DJ30|DOW30?)$/i],
  ["NAS100", /^(NAS100|NDX100?|USTEC|US100)$/i],
  ["US500", /^(US500|SPX500?|SP500)$/i],
  ["GER40", /^(GER[34]0|DE[34]0|DAX40?)$/i],
  ["UK100", /^(UK100|FTSE100?)$/i],
  ["XAUUSD", /^(XAUUSD|GOLD)$/i],
  ["XAGUSD", /^(XAGUSD|SILVER)$/i],
  ["BTCUSD", /^(BTCUSD|BITCOIN)$/i],
  ["ETHUSD", /^(ETHUSD|ETHEREUM)$/i],
];

export const baseOf = (s) => (s || "").replace(/[._-].*$/, "").replace(/m$/i, "").toUpperCase();

export const canonOf = (s) => {
  const b = baseOf(s);
  const found = ALIASES.find(([, re]) => re.test(b));
  return found ? found[0] : b;
};

/**
 * Retrieves the raw symbols array in the user's Main Watchlist.
 * If multiple watchlists exist, prioritizes one named "Main", otherwise the first watchlist.
 */
export async function getMainWatchlistSymbols() {
  try {
    const lists = await allWatchlists();
    if (!lists || !lists.length) return [];
    const mainList = lists.find((l) => /main/i.test(l.name || l.title || "")) || lists[0];
    return Array.isArray(mainList.symbols) ? mainList.symbols : [];
  } catch (err) {
    console.error("[getMainWatchlistSymbols error]", err);
    return [];
  }
}

/**
 * Checks if a symbol matches any symbol in the main watchlist, with canonical aliasing.
 * e.g. "EURUSD" matches "EURUSD.I", "US30" matches "DJ30", "US500" matches "SP500".
 * @param {string} symbol - candidate symbol
 * @param {string[]} mainWatchlistSymbols - list of symbols from main watchlist
 * @returns {boolean}
 */
export function isSymbolInMainWatchlist(symbol, mainWatchlistSymbols = []) {
  if (!symbol || !mainWatchlistSymbols.length) return false;
  const symCanon = canonOf(symbol);
  const symBase = baseOf(symbol);
  const symRaw = symbol.toUpperCase();

  return mainWatchlistSymbols.some((w) => {
    const wRaw = (w || "").toUpperCase();
    const wBase = baseOf(w);
    const wCanon = canonOf(w);
    return (
      wRaw === symRaw ||
      wBase === symBase ||
      wCanon === symCanon
    );
  });
}

/**
 * Resolves the exact broker symbol used in the main watchlist if an alias was analyzed.
 * e.g. analyzed "EURUSD" -> returns "EURUSD.I" if that is what the user has in their watchlist.
 */
export function getBrokerWatchlistSymbol(symbol, mainWatchlistSymbols = []) {
  if (!symbol || !mainWatchlistSymbols.length) return symbol;
  const symCanon = canonOf(symbol);
  const symBase = baseOf(symbol);
  const symRaw = symbol.toUpperCase();

  const matched = mainWatchlistSymbols.find((w) => {
    const wRaw = (w || "").toUpperCase();
    const wBase = baseOf(w);
    const wCanon = canonOf(w);
    return wRaw === symRaw || wBase === symBase || wCanon === symCanon;
  });

  return matched || symbol;
}
