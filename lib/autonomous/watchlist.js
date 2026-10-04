// Watchlist resolver and symbol matcher for Autonomous Brain Trader.
// Strictly enforces that order entries occur ONLY on symbols in the Main Watchlist,
// while permitting any symbols to be scanned for context, SMT, and correlation.

import { allWatchlists } from "../mongo.js";
import { ALIASES, baseOf, canonOf } from "./symbols.js";

export { ALIASES, baseOf, canonOf };

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
