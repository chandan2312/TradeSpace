// Institutional Trading Time Slots & Killzone Engine (EET / Broker Server Time Standard)
// Sessions use Europe/Athens (EET/EEST). Wall-clock inputs are UTC instants;
// broker-naive bars must explicitly carry timestampSemantics: BROKER_NAIVE.

import { baseOf, canonOf } from "./symbols.js";

// Canonical Institutional Phases (EET):
//   - Rollover Dead Zone / Spread Expansion (00:00 - 02:00 EET)
//   - Asian Range Accumulation (02:00 - 08:00 EET)
//   - Pre-London Preparation / Frankfurt (08:00 - 10:00 EET)
//   - London Open Killzone (10:00 - 13:00 EET)
//   - London Lunch Lull (13:00 - 15:00 EET)
//   - New York AM Killzone (15:00 - 18:00 EET)
//   - New York Silver Bullet Window (17:00 - 18:00 EET)
//   - London Close Killzone (18:00 - 20:00 EET)
//   - New York PM Killzone (21:00 - 23:00 EET)

export const TIME_SLOTS = {
  ASIAN_RANGE: {
    id: "asian_range",
    name: "Asian Range Accumulation",
    shortBadge: "ASIA 02-08",
    phase: "ACCUMULATION",
    startMinute: 120,         // 02:00 EET
    endMinute: 480,           // 08:00 EET
    eetRange: "02:00 - 08:00 EET",
    brokerRange: "02:00 - 08:00 Broker Server Time",
    utcRange: "23:00 - 05:00 UTC",
    startUtcMinute: 0,
    endUtcMinute: 360,
    isKillzone: false,
    isSilverBullet: false,
    isDeadZone: false,
    tradingAllowedByDefault: true,
    volatility: "LOW_TO_MEDIUM",
    description: "Range building & liquidity accumulation. Sets Asian High/Low as key reference targets for London Judas sweeps.",
    favoredAssets: ["JPY", "AUD", "NZD", "BTCUSD"],
    modelAffinities: {
      ote_continuation: 10,
      turtle_soup: 15,
      ict_2022: 5,
      breaker_block: 5,
      silver_bullet: -20,
    },
  },
  LONDON_OPEN: {
    id: "london_open",
    name: "London Open Killzone (LOKZ)",
    shortBadge: "LOKZ 10-13",
    phase: "KILLZONE",
    startMinute: 600,         // 10:00 EET
    endMinute: 780,           // 13:00 EET
    eetRange: "10:00 - 13:00 EET",
    brokerRange: "10:00 - 13:00 Broker Server Time",
    utcRange: "07:00 - 10:00 UTC",
    startUtcMinute: 420,
    endUtcMinute: 600,
    isKillzone: true,
    isSilverBullet: false,
    isDeadZone: false,
    tradingAllowedByDefault: true,
    volatility: "VERY_HIGH",
    description: "Peak European liquidity. Classic Judas Swing manipulations sweeping Asian extremes before true trend of the day.",
    favoredAssets: ["EUR", "GBP", "GER40", "XAUUSD"],
    modelAffinities: {
      turtle_soup: 35,        // Prime for Asian high/low raids
      ict_2022: 30,           // Judas swing + MSS + FVG
      breaker_block: 25,
      ote_continuation: 20,
      silver_bullet: 15,
    },
  },
  LONDON_LUNCH: {
    id: "london_lunch",
    name: "London Lunch Lull",
    shortBadge: "LUNCH 13-15",
    phase: "CONSOLIDATION",
    startMinute: 780,         // 13:00 EET
    endMinute: 900,           // 15:00 EET
    eetRange: "13:00 - 15:00 EET",
    brokerRange: "13:00 - 15:00 Broker Server Time",
    utcRange: "10:00 - 12:00 UTC",
    startUtcMinute: 600,
    endUtcMinute: 720,
    isKillzone: false,
    isSilverBullet: false,
    isDeadZone: false,
    tradingAllowedByDefault: false, // Disabled by default to avoid midday chop
    volatility: "LOW",
    description: "Midday liquidity dip and consolidation ahead of New York news drops. Chop risk is elevated.",
    favoredAssets: ["EUR", "GBP"],
    modelAffinities: {
      ote_continuation: 10,
      turtle_soup: -15,
      ict_2022: -10,
      breaker_block: -10,
      silver_bullet: -25,
    },
  },
  NEW_YORK_AM: {
    id: "ny_open",
    name: "New York AM Killzone (NYKZ)",
    shortBadge: "NYKZ 15-18",
    phase: "KILLZONE",
    startMinute: 900,         // 15:00 EET
    endMinute: 1080,          // 18:00 EET
    eetRange: "15:00 - 18:00 EET",
    brokerRange: "15:00 - 18:00 Broker Server Time",
    utcRange: "12:00 - 15:00 UTC",
    startUtcMinute: 720,
    endUtcMinute: 900,
    isKillzone: true,
    isSilverBullet: false,    // Overlaps with NY Silver Bullet at 17:00
    isDeadZone: false,
    tradingAllowedByDefault: true,
    volatility: "MAXIMUM",
    description: "Maximum global volume overlap (London + NY). US Macro economic data & US Equities cash open (16:30 EET).",
    favoredAssets: ["NAS100", "US30", "SP500", "XAUUSD", "EURUSD", "GBPUSD"],
    modelAffinities: {
      ict_2022: 35,
      silver_bullet: 30,
      breaker_block: 30,
      ote_continuation: 25,
      turtle_soup: 25,
    },
  },
  NY_SILVER_BULLET: {
    id: "ny_silver_bullet",
    name: "New York Silver Bullet Window",
    shortBadge: "NYSB 17-18",
    phase: "SILVER_BULLET",
    startMinute: 1020,        // 17:00 EET (10:00 AM NY)
    endMinute: 1080,          // 18:00 EET (11:00 AM NY)
    eetRange: "17:00 - 18:00 EET",
    brokerRange: "17:00 - 18:00 Broker Server Time",
    utcRange: "14:00 - 15:00 UTC",
    startUtcMinute: 840,
    endUtcMinute: 900,
    isKillzone: true,
    isSilverBullet: true,
    isDeadZone: false,
    tradingAllowedByDefault: true,
    volatility: "HIGH",
    description: "ICT 60-Minute Algorithmic Delivery Window (10:00 - 11:00 NY = 17:00 - 18:00 EET). Clean institutional FVG sweeps.",
    favoredAssets: ["NAS100", "SP500", "US30", "XAUUSD", "EURUSD"],
    modelAffinities: {
      silver_bullet: 45,      // Dominant model in this window
      ict_2022: 25,
      breaker_block: 20,
      ote_continuation: 15,
      turtle_soup: 10,
    },
  },
  LONDON_CLOSE: {
    id: "london_close",
    name: "London Close Killzone (LCKZ)",
    shortBadge: "LCKZ 18-20",
    phase: "KILLZONE",
    startMinute: 1080,        // 18:00 EET
    endMinute: 1200,          // 20:00 EET
    eetRange: "18:00 - 20:00 EET",
    brokerRange: "18:00 - 20:00 Broker Server Time",
    utcRange: "15:00 - 17:00 UTC",
    startUtcMinute: 900,
    endUtcMinute: 1020,
    isKillzone: true,
    isSilverBullet: false,
    isDeadZone: false,
    tradingAllowedByDefault: true,
    volatility: "HIGH",
    description: "European fixing, counter-trend profit taking, or daily high/low formation completion.",
    favoredAssets: ["EUR", "GBP", "XAUUSD"],
    modelAffinities: {
      turtle_soup: 30,        // Profit taking reversals
      ict_2022: 20,
      ote_continuation: 15,
      breaker_block: 15,
      silver_bullet: -10,
    },
  },
  NEW_YORK_PM: {
    id: "ny_pm",
    name: "New York PM Killzone",
    shortBadge: "NYPM 21-23",
    phase: "KILLZONE",
    startMinute: 1260,        // 21:00 EET
    endMinute: 1380,          // 23:00 EET
    eetRange: "21:00 - 23:00 EET",
    brokerRange: "21:00 - 23:00 Broker Server Time",
    utcRange: "18:00 - 20:00 UTC",
    startUtcMinute: 1080,
    endUtcMinute: 1200,
    isKillzone: true,
    isSilverBullet: false,
    isDeadZone: false,
    tradingAllowedByDefault: true,
    volatility: "MEDIUM_TO_HIGH",
    description: "Afternoon continuation & US cash close positioning (13:00 - 15:00 NY = 21:00 - 23:00 EET).",
    favoredAssets: ["NAS100", "US30", "SP500"],
    modelAffinities: {
      silver_bullet: 30,
      ote_continuation: 25,
      ict_2022: 20,
      breaker_block: 20,
      turtle_soup: 10,
    },
  },
  DEAD_ZONE: {
    id: "dead_zone",
    name: "Post-Close Rollover / Spread Widening",
    shortBadge: "DEAD 00-02",
    phase: "DEAD_ZONE",
    startMinute: 0,           // 00:00 EET
    endMinute: 120,           // 02:00 EET
    eetRange: "00:00 - 02:00 EET",
    brokerRange: "00:00 - 02:00 Broker Server Time",
    utcRange: "21:00 - 23:00 UTC",
    startUtcMinute: 1260,
    endUtcMinute: 1440,
    isKillzone: false,
    isSilverBullet: false,
    isDeadZone: true,
    tradingAllowedByDefault: false, // STRICTLY FALSE by default!
    volatility: "UNPREDICTABLE",
    description: "Daily rollover, broker settlement, and extreme spread expansion. Staging/entering new trades is blocked.",
    favoredAssets: [],
    modelAffinities: {
      silver_bullet: -50,
      ict_2022: -50,
      turtle_soup: -50,
      breaker_block: -50,
      ote_continuation: -50,
    },
  },
};

/**
 * Extracts the exact EET / Broker Server Time hours, minutes, and total minutes.
 * Handles Date objects, MT5 raw bar objects, or epoch seconds.
 * @param {Date|Object|number} input
 * @returns {{ h: number, m: number, s: number, totalMinutes: number }}
 */
export function getEetTime(input = new Date(), options = {}) {
  let value = input;
  const isBar = input && typeof input === "object" && !(input instanceof Date);
  if (isBar) value = input.time ?? input.t;
  const numeric = typeof value === "number";
  // Legacy clock-only callers pass seconds since local midnight (for example
  // 17:30 => 63,000). Treat those as an EET wall-clock value; real epoch
  // timestamps are much larger and continue through timezone conversion.
  if (numeric && value >= 0 && value < 86400 && !isBar) {
    const totalMinutes = Math.floor(value / 60) % 1440;
    return { h: Math.floor(totalMinutes / 60), m: totalMinutes % 60, s: Math.floor(value % 60), totalMinutes };
  }
  const ms = numeric && value < 1e11 ? value * 1000 : value;
  const semantics = isBar ? input.timestampSemantics || options.timestampSemantics : options.timestampSemantics;
  // Legacy broker clocks are opt-in. The canonical data feed converts them to UTC.
  if (semantics === "BROKER_NAIVE" && numeric) {
    const date = new Date(ms);
    const h = date.getUTCHours(), m = date.getUTCMinutes(), s = date.getUTCSeconds();
    return { h, m, s, totalMinutes: h * 60 + m };
  }
  const date = value instanceof Date ? value : new Date(ms);
  try {
    const dtf = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Athens",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    });
    const parts = dtf.formatToParts(date);
    const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    const s = parseInt(parts.find((p) => p.type === "second")?.value ?? "0", 10);
    return { h, m, s, totalMinutes: h * 60 + m };
  } catch {
    return { h: NaN, m: NaN, s: NaN, totalMinutes: NaN };
  }
}

// Independent of configurable/general slots: Silver Bullet cannot be enabled
// outside its exact half-open hour, nor inherited from NY PM/other killzones.
export function getSilverBulletWindow(input = new Date()) {
  const { totalMinutes } = getEetTime(input);
  if (totalMinutes >= 600 && totalMinutes < 660) return { id: "london_sb", startMinute: 600, endMinute: 660, eetRange: "10:00 - 11:00 EET" };
  if (totalMinutes >= 1020 && totalMinutes < 1080) return { id: "ny_sb", startMinute: 1020, endMinute: 1080, eetRange: "17:00 - 18:00 EET" };
  return null;
}

/**
 * Returns the Unix timestamp (ms) for the start of the current ICT trading day.
 * The ICT/broker trading day resets at midnight EET (00:00 Europe/Athens),
 * which is equivalent to 5 PM New York time (NY Close = Daily Candle Rollover).
 *
 * Used by the Trade Idea Day Exhaustion Guard to scope "today's" consumed trade ideas
 * within a single broker trading session.
 *
 * @param {Date} [now=new Date()] - Reference point, defaults to current wall-clock time.
 * @returns {number} Unix timestamp (ms) for 00:00:00 EET of the current trading day.
 */
export function getStartOfTradingDay(now = new Date()) {
  try {
    // Format date parts in Europe/Athens timezone to get the EET calendar date
    const dtf = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Athens",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = dtf.formatToParts(now);
    const year  = parseInt(parts.find((p) => p.type === "year")?.value  ?? "0", 10);
    const month = parseInt(parts.find((p) => p.type === "month")?.value ?? "1", 10) - 1; // 0-indexed
    const day   = parseInt(parts.find((p) => p.type === "day")?.value   ?? "1", 10);

    // Build candidate midnight UTC for that EET calendar date
    const midnightUtcCandidate = Date.UTC(year, month, day, 0, 0, 0, 0);

    // Determine the EET offset (UTC+2 or UTC+3 depending on DST) at that point
    const { h: eetHourAtMidnightUtc } = getEetTime(new Date(midnightUtcCandidate));
    // eetHourAtMidnightUtc tells us how many hours past midnight UTC = EET time
    // e.g., if eetH === 2 then UTC+00:00 is 02:00 EET → midnight EET was 2h earlier
    const eetOffsetMs = eetHourAtMidnightUtc * 3_600_000;
    return midnightUtcCandidate - eetOffsetMs;
  } catch {
    // Fallback: EET is UTC+3 in summer (EEST) which covers most trading sessions
    const EET_OFFSET_MS = 3 * 3_600_000;
    const nowMs = now.getTime();
    return nowMs - ((nowMs + EET_OFFSET_MS) % 86_400_000) - EET_OFFSET_MS;
  }
}

/**
 * Returns the currently active time slot object based on EET (Broker Server Time).
 * @param {Date|Object|number} input
 * @returns {Object} Active time slot with metadata and countdown
 */
export function getCurrentTimeSlot(input = new Date()) {
  const { totalMinutes } = getEetTime(input);

  // Specific high-priority window checks first:
  // 1. New York Silver Bullet (17:00 - 18:00 EET)
  if (totalMinutes >= 1020 && totalMinutes < 1080) {
    return enrichSlot(TIME_SLOTS.NY_SILVER_BULLET, totalMinutes);
  }

  // 2. Rollover Dead Zone (00:00 - 02:00 EET or 23:30 - 24:00 EET)
  if (totalMinutes < 120 || totalMinutes >= 1410) {
    return enrichSlot(TIME_SLOTS.DEAD_ZONE, totalMinutes);
  }

  // 3. New York PM Killzone (21:00 - 23:00 EET)
  if (totalMinutes >= 1260 && totalMinutes < 1380) {
    return enrichSlot(TIME_SLOTS.NEW_YORK_PM, totalMinutes);
  }

  // 4. London Close Killzone (18:00 - 20:00 EET)
  if (totalMinutes >= 1080 && totalMinutes < 1200) {
    return enrichSlot(TIME_SLOTS.LONDON_CLOSE, totalMinutes);
  }

  // 5. New York AM Killzone (15:00 - 18:00 EET)
  if (totalMinutes >= 900 && totalMinutes < 1080) {
    return enrichSlot(TIME_SLOTS.NEW_YORK_AM, totalMinutes);
  }

  // 6. London Lunch Lull (13:00 - 15:00 EET)
  if (totalMinutes >= 780 && totalMinutes < 900) {
    return enrichSlot(TIME_SLOTS.LONDON_LUNCH, totalMinutes);
  }

  // 7. London Open Killzone (10:00 - 13:00 EET)
  if (totalMinutes >= 600 && totalMinutes < 780) {
    return { ...enrichSlot(TIME_SLOTS.LONDON_OPEN, totalMinutes), isSilverBullet: totalMinutes < 660 };
  }

  // 8. Asian Range Accumulation (02:00 - 08:00 EET)
  if (totalMinutes >= 120 && totalMinutes < 480) {
    return enrichSlot(TIME_SLOTS.ASIAN_RANGE, totalMinutes);
  }

  // Interstitial Pre-London Prep (08:00 - 10:00 EET)
  if (totalMinutes >= 480 && totalMinutes < 600) {
    return {
      id: "pre_london_prep",
      name: "Pre-London Session Setup",
      shortBadge: "PRE-LDN 08-10",
      phase: "PREP",
      startMinute: 480,
      endMinute: 600,
      eetRange: "08:00 - 10:00 EET",
      brokerRange: "08:00 - 10:00 Broker Server Time",
      utcRange: "05:00 - 07:00 UTC",
      isKillzone: false,
      isSilverBullet: false,
      isDeadZone: false,
      tradingAllowedByDefault: true,
      volatility: "MEDIUM",
      description: "Asian range conclusion and pre-London order positioning.",
      favoredAssets: ["EUR", "GBP"],
      modelAffinities: {
        turtle_soup: 20,
        ict_2022: 15,
        ote_continuation: 10,
        breaker_block: 10,
        silver_bullet: -10,
      },
      minutesRemaining: 600 - totalMinutes,
    };
  }

  // Interstitial Evening Lull (20:00 - 21:00 EET & 23:00 - 23:30 EET)
  return {
    id: "off_session_lull",
    name: "Inter-Session Volume Lull",
    shortBadge: "LULL",
    phase: "LULL",
    startMinute: totalMinutes,
    endMinute: totalMinutes >= 1380 ? 1410 : 1260,
    eetRange: "Inter-Session Lull",
    brokerRange: "Inter-Session Lull",
    utcRange: "Inter-Session Lull",
    isKillzone: false,
    isSilverBullet: false,
    isDeadZone: false,
    tradingAllowedByDefault: true,
    volatility: "LOW",
    description: "Lower market participation window between primary institutional sessions.",
    favoredAssets: [],
    modelAffinities: {},
    minutesRemaining: totalMinutes >= 1380 ? 1410 - totalMinutes : 1260 - totalMinutes,
  };
}

function enrichSlot(slot, currentMin) {
  let minutesRemaining = 0;
  if (slot.id === "dead_zone") {
    minutesRemaining = currentMin >= 1410 ? (1440 - currentMin + 120) : Math.max(0, 120 - currentMin);
  } else {
    minutesRemaining = Math.max(0, slot.endMinute - currentMin);
  }
  return {
    ...slot,
    minutesRemaining,
  };
}

/**
 * Returns all defined institutional time slots in chronological order.
 */
export function getAllTimeSlots() {
  return [
    TIME_SLOTS.DEAD_ZONE,
    TIME_SLOTS.ASIAN_RANGE,
    TIME_SLOTS.LONDON_OPEN,
    TIME_SLOTS.LONDON_LUNCH,
    TIME_SLOTS.NEW_YORK_AM,
    TIME_SLOTS.NY_SILVER_BULLET,
    TIME_SLOTS.LONDON_CLOSE,
    TIME_SLOTS.NEW_YORK_PM,
  ];
}

// ============================================================================
// Institutional Symbol-Specific Session Profiles & Gating Matrix
// ============================================================================
export const SYMBOL_SESSION_PROFILES = {
  // 1. US Equities / Indices: Strictly New York sessions (15:00 - 23:00 EET)
  US_INDICES: {
    category: "US Indices",
    profileKey: "US_INDICES",
    label: "NY Only",
    badgeColor: "#3b82f6", // Blue
    fullLabel: "New York Sessions Only",
    eetHoursLabel: "15:00 - 23:00 EET",
    symbols: ["NAS100", "US30", "DJ30", "US500", "SP500", "SPX500"],
    allowedSlotIds: ["ny_open", "ny_silver_bullet", "ny_pm"],
    description: "US cash equities & index futures volume strictly concentrated during New York sessions.",
  },

  // 2. European Indices: Strictly London session (08:00 - 20:00 EET)
  EU_INDICES: {
    category: "European Indices",
    profileKey: "EU_INDICES",
    label: "London Only",
    badgeColor: "#10b981", // Emerald
    fullLabel: "London Session Only",
    eetHoursLabel: "08:00 - 20:00 EET",
    symbols: ["GER40", "DAX", "DE40", "UK100", "FTSE100"],
    allowedSlotIds: ["pre_london_prep", "london_open", "london_close"],
    description: "European cash markets open at 09:00/10:00 EET with London morning expansion & European fix.",
  },

  // 3. Precious Metals & Crypto: Asia, London, and New York (24-hour continuous liquidity except dead zone)
  METALS_CRYPTO: {
    category: "Metals & Crypto",
    profileKey: "METALS_CRYPTO",
    label: "Asia, London & NY",
    badgeColor: "#eab308", // Amber
    fullLabel: "Asia, London & New York",
    eetHoursLabel: "02:00 - 23:30 EET",
    symbols: ["XAUUSD", "GOLD", "XAGUSD", "SILVER", "BTCUSD", "ETHUSD"],
    allowedSlotIds: [
      "asian_range",
      "pre_london_prep",
      "london_open",
      "ny_open",
      "ny_silver_bullet",
      "london_close",
      "ny_pm",
    ],
    description: "Global 24hr liquidity. Asian accumulation, London fix, and New York COMEX/spot delivery.",
  },

  // 4. European Forex Majors & Crosses: London and New York sessions (08:00 - 23:00 EET)
  EU_FOREX: {
    category: "European Forex",
    profileKey: "EU_FOREX",
    label: "London & NY",
    badgeColor: "#6366f1", // Indigo
    fullLabel: "London & New York Sessions",
    eetHoursLabel: "08:00 - 23:00 EET",
    symbols: ["EURUSD", "GBPUSD", "EURGBP", "EURCAD", "GBPCAD", "EURAUD", "GBPAUD", "USDCHF", "USDCAD"],
    allowedSlotIds: [
      "pre_london_prep",
      "london_open",
      "ny_open",
      "ny_silver_bullet",
      "london_close",
      "ny_pm",
    ],
    description: "European interbank flow and New York macro overlap. Asian session is low-liquidity accumulation.",
  },

  // 5. Yen Pairs & Asian Pacific: Asia and New York sessions (02:00 - 08:00 & 15:00 - 23:00 EET)
  ASIA_YEN_FOREX: {
    category: "Asian & Yen Forex",
    profileKey: "ASIA_YEN_FOREX",
    label: "Asia & NY",
    badgeColor: "#ec4899", // Pink
    fullLabel: "Asia & New York Sessions",
    eetHoursLabel: "02:00 - 08:00 & 15:00 - 23:00 EET",
    symbols: ["USDJPY", "AUDUSD", "NZDUSD", "AUDJPY"],
    allowedSlotIds: [
      "asian_range",
      "ny_open",
      "ny_silver_bullet",
      "ny_pm",
    ],
    description: "Active Tokyo interbank session (02:00 - 08:00 EET) and New York USD flow (15:00 - 23:00 EET).",
  },

  // 6. Cross Yen pairs that trade across Asia, London & NY
  CROSS_YEN_FOREX: {
    category: "Yen Crosses",
    profileKey: "CROSS_YEN_FOREX",
    label: "Asia, London & NY",
    badgeColor: "#a855f7", // Purple
    fullLabel: "Asia, London & New York",
    eetHoursLabel: "02:00 - 23:00 EET",
    symbols: ["GBPJPY", "EURJPY"],
    allowedSlotIds: [
      "asian_range",
      "pre_london_prep",
      "london_open",
      "ny_open",
      "ny_silver_bullet",
      "london_close",
      "ny_pm",
    ],
    description: "High volatility across Asian session and London/NY institutional cross flows.",
  },
};

/**
 * Resolves the institutional session profile and allowed trading windows for a given symbol.
 * @param {string} symbol - e.g. "NAS100", "EURUSD.I", "GER40", "XAUUSD", "BTCUSD", "USDJPY"
 * @returns {Object} Session profile object with category, label, allowedSlotIds, and EET hours.
 */
export function getSymbolSessionProfile(symbol) {
  if (!symbol) {
    return {
      category: "General Market",
      profileKey: "DEFAULT",
      label: "All Active Sessions",
      badgeColor: "#94a3b8",
      fullLabel: "All Active Sessions",
      eetHoursLabel: "08:00 - 23:00 EET",
      allowedSlotIds: ["pre_london_prep", "london_open", "ny_open", "ny_silver_bullet", "london_close", "ny_pm"],
      description: "Default institutional session hours.",
    };
  }

  const base = baseOf(symbol);
  const canon = canonOf(symbol);

  // 1. Direct symbol check in predefined profiles
  for (const profile of Object.values(SYMBOL_SESSION_PROFILES)) {
    if (
      profile.symbols.includes(canon) ||
      profile.symbols.includes(base) ||
      profile.symbols.includes(symbol.toUpperCase())
    ) {
      return profile;
    }
  }

  // 2. Heuristic classification for unlisted or custom broker symbols:
  // Indices
  if (/^(US|NAS|SPX|SP5|DJ|DOW|NDX|DAX|GER|FTSE|UK)/i.test(base)) {
    if (/^(GER|DAX|DE|UK|FTSE)/i.test(base)) return SYMBOL_SESSION_PROFILES.EU_INDICES;
    return SYMBOL_SESSION_PROFILES.US_INDICES;
  }

  // Crypto & Metals
  if (/^(BTC|ETH|SOL|XAU|GOLD|XAG|SILVER)/i.test(base)) {
    return SYMBOL_SESSION_PROFILES.METALS_CRYPTO;
  }

  // Yen crosses & Asian FX
  if (base.endsWith("JPY") || base.startsWith("AUD") || base.startsWith("NZD")) {
    if (base.startsWith("GBP") || base.startsWith("EUR")) {
      return SYMBOL_SESSION_PROFILES.CROSS_YEN_FOREX;
    }
    return SYMBOL_SESSION_PROFILES.ASIA_YEN_FOREX;
  }

  // European Forex fallback
  return SYMBOL_SESSION_PROFILES.EU_FOREX;
}

/**
 * Checks if a specific symbol is permitted to trade in a specific time slot ID.
 * @param {string} symbol
 * @param {string} slotId
 * @returns {boolean}
 */
export function isSymbolPermittedInSlot(symbol, slotId) {
  if (!symbol || !slotId) return false;
  if (slotId === "dead_zone") return false;
  const profile = getSymbolSessionProfile(symbol);
  return profile.allowedSlotIds.includes(slotId);
}

/**
 * Validates if order entry is permitted right now based on active time slot,
 * global user config, and symbol-specific session profiles.
 * @param {Date|Object|number} input - current time, bar object, or epoch seconds
 * @param {Object} config - autonomous configuration
 * @param {string|null} symbol - optional symbol to apply institutional asset gating
 * @returns {Object} { permitted: boolean, reason: string, slot: Object, profile?: Object }
 */
export function isTradingPermittedNow(input = new Date(), config = {}, symbol = null) {
  if (!Number.isFinite(getEetTime(input).totalMinutes)) {
    return { permitted: false, reason: "Trading blocked: invalid execution clock.", isInvalidClock: true, slot: null };
  }
  const slot = getCurrentTimeSlot(input);

  // 1. Strict Dead Zone Check (Spread Protection across ALL symbols)
  if (slot.isDeadZone) {
    return {
      permitted: false,
      isDeadZone: true,
      reason: `Trading Blocked: Market is in Dead Zone / Rollover (${slot.eetRange}).`,
      slot,
    };
  }

  if (config?.allowedTimeSlots?.[slot.id] !== true && !slot.tradingAllowedByDefault) {
    return { permitted: false, reason: `Trading Blocked: ${slot.name} is disabled by default.`, slot };
  }

  // 2. User Time Slot Filter Check
  if (config?.allowedTimeSlots && typeof config.allowedTimeSlots === "object") {
    if (config.allowedTimeSlots[slot.id] === false) {
      return {
        permitted: false,
        isUserSlotDisabled: true,
        reason: `Trading Blocked: Time slot '${slot.name}' (${slot.eetRange}) is disabled in user configuration.`,
        slot,
      };
    }
  }

  // 3. Fallback to legacy sessionFilters if allowedTimeSlots not defined
  if (config?.sessionFilters) {
    if (slot.id === "asian_range" && config.sessionFilters.asia === false) {
      return { permitted: false, isUserSlotDisabled: true, reason: "Trading Blocked: Asian session disabled.", slot };
    }
    if ((slot.id === "london_open" || slot.id === "london_lunch" || slot.id === "london_close") && config.sessionFilters.london === false) {
      return { permitted: false, isUserSlotDisabled: true, reason: "Trading Blocked: London session disabled.", slot };
    }
    if ((slot.id === "ny_open" || slot.id === "ny_silver_bullet" || slot.id === "ny_pm") && config.sessionFilters.newyork === false) {
      return { permitted: false, isUserSlotDisabled: true, reason: "Trading Blocked: New York session disabled.", slot };
    }
  }

  // 4. Institutional Symbol-Specific Session Gating (Active by default)
  if (symbol && config?.enforceSymbolSessions !== false) {
    const profile = getSymbolSessionProfile(symbol);
    const isSlotAllowedForSymbol = profile.allowedSlotIds.includes(slot.id);

    if (!isSlotAllowedForSymbol) {
      return {
        permitted: false,
        isOffSession: true,
        profile,
        slot,
        reason: `Off-Session Gating: ${symbol} (${profile.category}) is restricted to ${profile.fullLabel} (${profile.eetHoursLabel}). Current slot '${slot.name}' (${slot.eetRange}) is inactive for this asset.`,
      };
    }
  }

  return {
    permitted: true,
    reason: `Trading Approved: Active slot '${slot.name}' (${slot.eetRange}).`,
    slot,
    profile: symbol ? getSymbolSessionProfile(symbol) : null,
  };
}

/**
 * Resolves the institutional time slot for a historical candle bar or timestamp.
 * In TradeSpace, MT5 candle timestamps are natively in EET (Broker Server Time),
 * so passing the bar directly resolves into the exact matching institutional slot.
 * @param {Object|number} bar - Candle bar object ({ time, ... } or { t, ... }) or timestamp
 * @returns {Object} Active time slot
 */
export function getTimeSlotForBar(bar) {
  if (bar && typeof bar === "object" && bar.timestampSemantics == null) {
    return getCurrentTimeSlot({ ...bar, timestampSemantics: "BROKER_NAIVE" });
  }
  return getCurrentTimeSlot(bar);
}
