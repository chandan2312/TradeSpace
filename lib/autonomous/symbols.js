// Pure symbol normalization and canonical aliasing utilities.
// Zero server / database dependencies — safe for both client and server bundling.

export const ALIASES = [
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
